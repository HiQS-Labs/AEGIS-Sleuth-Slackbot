'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// runs the real finder with a fake `gh` first on PATH: no network, fixtures per issue URL.
describe('find-closed-issue-reminders (GH-332)', () => {
  const script = path.join(__dirname, '../skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs');
  let directory;
  let calls;

  const responses = {
    'repos/o/r/issues/1': { state: 'closed', state_reason: 'completed', title: 'Closed issue' },
    'repos/o/r/issues/2': { state: 'closed', title: 'Merged PR', pull_request: { merged_at: '2026-11-16T00:00:00Z' } },
    'repos/o/r/issues/3': { state: 'open', title: 'Open issue' },
    'repos/o/r/issues/4': { state: 'closed', title: 'Closed unmerged PR', pull_request: { merged_at: null } },
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-closed-'));
    calls = path.join(directory, 'gh-calls.log');
    for(const [key, value] of Object.entries(responses))
      fs.writeFileSync(path.join(directory, key.replace(/\//g, '_') + '.json'), JSON.stringify(value));
    // issue 9 has no fixture, so the fake gh fails for it like a 404 or a rate limit would.
    fs.writeFileSync(path.join(directory, 'gh'), [
      '#!/bin/sh',
      `echo "$2" >> "${calls}"`,
      `f="${directory}/$(echo "$2" | tr / _).json"`,
      '[ -f "$f" ] || { echo "HTTP 404" >&2; exit 1; }',
      'cat "$f"',
    ].join('\n'), { mode: 0o755 });
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function run(ArgBackup) {
    const BackupPath = path.join(directory, 'backup.json');
    fs.writeFileSync(BackupPath, typeof ArgBackup === 'string' ? ArgBackup : JSON.stringify(ArgBackup));
    const result = spawnSync(process.execPath, [script, BackupPath], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
    });
    return { ...result, BackupPath };
  }

  const text = (ArgLinks, ArgTitle) => `<@U1> - please follow up on this:\n>${ArgLinks.join(' ')}\n\nKey task(s):\n• ${ArgTitle}`;

  test('classifies all-closed, mixed, open, unknown and none, and never treats a failed lookup as closed', () => {
    const result = run([
      { ReminderID: 'aaaaaaaa-1', GitHubUrls: ['https://github.com/o/r/issues/1'], ReminderMessageText: text([], 'Closed one') },
      { ReminderID: 'bbbbbbbb-2', GitHubUrls: [], ReminderMessageText: text(['https://github.com/o/r/pull/2', 'https://github.com/o/r/issues/3'], 'Mixed one') },
      { ReminderID: 'cccccccc-3', GitHubUrls: ['https://github.com/o/r/issues/3'], ReminderMessageText: text([], 'Open one') },
      { ReminderID: 'dddddddd-4', GitHubUrls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/9'], ReminderMessageText: text([], 'Unknown one') },
      { ReminderID: 'eeeeeeee-5', ReminderMessageText: text([], 'No links') },
      { ReminderID: 'ffffffff-6', GitHubUrls: ['https://github.com/o/r/pull/4'], ReminderMessageText: text(['https://github.com/o/r/pull/4'], 'Closed PR') },
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('reminders=6 links=5 all-closed=2 mixed=1 unknown=1 open=1 none=1');
    expect(result.stdout).toMatch(/^all-closed aaaaaaaa {2}Closed one {2}\[o\/r\/1:closed\]$/m);
    expect(result.stdout).toMatch(/^mixed {6}bbbbbbbb {2}Mixed one {2}\[o\/r\/2:merged, o\/r\/3:open\]$/m);
    expect(result.stdout).toMatch(/^unknown {4}dddddddd/m);
    expect(result.stdout).not.toMatch(/^all-closed dddddddd/m);
    expect(result.stdout).toMatch(/^all-closed ffffffff {2}Closed PR {2}\[o\/r\/4:closed\]$/m);
    expect(result.stdout).not.toContain('eeeeeeee');
    // one lookup per unique link, even when two reminders or both sources share it.
    expect(fs.readFileSync(calls, 'utf8').trim().split('\n').sort())
      .toEqual(['repos/o/r/issues/1', 'repos/o/r/issues/2', 'repos/o/r/issues/3', 'repos/o/r/issues/4', 'repos/o/r/issues/9']);

    const ReviewPath = `${result.BackupPath}.closed-issues.json`;
    expect(fs.statSync(ReviewPath).mode & 0o777).toBe(0o600);
    const review = JSON.parse(fs.readFileSync(ReviewPath, 'utf8'));
    expect(review.map(ArgRow => [ArgRow.ReminderID, ArgRow.class])).toEqual([
      ['aaaaaaaa-1', 'all-closed'], ['bbbbbbbb-2', 'mixed'], ['dddddddd-4', 'unknown'], ['ffffffff-6', 'all-closed'],
    ]);
    expect(review[2].links.find(ArgLink => ArgLink.ref === 'o/r/9')).toMatchObject({ state: 'unknown' });
  });

  test('a link written with a capitalised host still counts, so the reminder is mixed, not all-closed', () => {
    const result = run([
      { ReminderID: 'gggggggg-7', GitHubUrls: ['https://github.com/o/r/issues/1'], ReminderMessageText: text(['https://GitHub.com/o/r/issues/3'], 'Case one') },
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^mixed {6}gggggggg {2}Case one {2}\[o\/r\/1:closed, o\/r\/3:open\]$/m);
  });

  test('an empty backup reports zero reminders; a non-array or missing backup exits 2', () => {
    const empty = run([]);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain('reminders=0 links=0 all-closed=0 mixed=0 unknown=0 open=0 none=0');
    expect(fs.existsSync(calls)).toBe(false);

    const NotArray = run('{"reminders":[]}');
    expect(NotArray.status).toBe(2);
    expect(NotArray.stderr).toContain('is not a JSON array');

    const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('usage:');
  });
});
