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
    for(const [Key, Value] of Object.entries(responses))
      fs.writeFileSync(path.join(directory, Key.replace(/\//g, '_') + '.json'), JSON.stringify(Value));
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

  function Run(ArgBackup) {
    const BackupPath = path.join(directory, 'backup.json');
    fs.writeFileSync(BackupPath, typeof ArgBackup === 'string' ? ArgBackup : JSON.stringify(ArgBackup));
    const Result = spawnSync(process.execPath, [script, BackupPath], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
    });
    return { ...Result, BackupPath };
  }

  const Text = (ArgLinks, ArgTitle) => `<@U1> - please follow up on this:\n>${ArgLinks.join(' ')}\n\nKey task(s):\n• ${ArgTitle}`;

  test('classifies all-closed, mixed, open, unknown and none, and never treats a failed lookup as closed', () => {
    const Result = Run([
      { ReminderID: 'aaaaaaaa-1', GitHubUrls: ['https://github.com/o/r/issues/1'], ReminderMessageText: Text([], 'Closed one') },
      { ReminderID: 'bbbbbbbb-2', GitHubUrls: [], ReminderMessageText: Text(['https://github.com/o/r/pull/2', 'https://github.com/o/r/issues/3'], 'Mixed one') },
      { ReminderID: 'cccccccc-3', GitHubUrls: ['https://github.com/o/r/issues/3'], ReminderMessageText: Text([], 'Open one') },
      { ReminderID: 'dddddddd-4', GitHubUrls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/9'], ReminderMessageText: Text([], 'Unknown one') },
      { ReminderID: 'eeeeeeee-5', ReminderMessageText: Text([], 'No links') },
      { ReminderID: 'ffffffff-6', GitHubUrls: ['https://github.com/o/r/pull/4'], ReminderMessageText: Text(['https://github.com/o/r/pull/4'], 'Closed PR') },
    ]);

    expect(Result.status).toBe(0);
    expect(Result.stdout).toContain('reminders=6 links=5 all-closed=2 mixed=1 unknown=1 open=1 none=1');
    expect(Result.stdout).toMatch(/^all-closed aaaaaaaa {2}Closed one {2}\[o\/r\/1:closed\]$/m);
    expect(Result.stdout).toMatch(/^mixed {6}bbbbbbbb {2}Mixed one {2}\[o\/r\/2:merged, o\/r\/3:open\]$/m);
    expect(Result.stdout).toMatch(/^unknown {4}dddddddd/m);
    expect(Result.stdout).not.toMatch(/^all-closed dddddddd/m);
    expect(Result.stdout).toMatch(/^all-closed ffffffff {2}Closed PR {2}\[o\/r\/4:closed\]$/m);
    expect(Result.stdout).not.toContain('eeeeeeee');
    // one lookup per unique link, even when two reminders or both sources share it.
    expect(fs.readFileSync(calls, 'utf8').trim().split('\n').sort())
      .toEqual(['repos/o/r/issues/1', 'repos/o/r/issues/2', 'repos/o/r/issues/3', 'repos/o/r/issues/4', 'repos/o/r/issues/9']);

    const ReviewPath = `${Result.BackupPath}.closed-issues.json`;
    expect(fs.statSync(ReviewPath).mode & 0o777).toBe(0o600);
    const Review = JSON.parse(fs.readFileSync(ReviewPath, 'utf8'));
    expect(Review.map(ArgRow => [ArgRow.ReminderID, ArgRow.class])).toEqual([
      ['aaaaaaaa-1', 'all-closed'], ['bbbbbbbb-2', 'mixed'], ['dddddddd-4', 'unknown'], ['ffffffff-6', 'all-closed'],
    ]);
    expect(Review[2].links.find(ArgLink => ArgLink.ref === 'o/r/9')).toMatchObject({ state: 'unknown' });
  });

  test('an empty backup reports zero reminders; a non-array or missing backup exits 2', () => {
    const Empty = Run([]);
    expect(Empty.status).toBe(0);
    expect(Empty.stdout).toContain('reminders=0 links=0 all-closed=0 mixed=0 unknown=0 open=0 none=0');
    expect(fs.existsSync(calls)).toBe(false);

    const NotArray = Run('{"reminders":[]}');
    expect(NotArray.status).toBe(2);
    expect(NotArray.stderr).toContain('is not a JSON array');

    const Missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(Missing.status).toBe(2);
    expect(Missing.stderr).toContain('usage:');
  });
});
