'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// exercise the real CLI in a child process; intercept only HTTP so no credential or mutation leaves it.
describe('bulk reminder CLI bot contract', () => {
  let directory;
  let bootstrap;
  let logfile;
  const ReminderId = 'aaaaaaaa-1111-4111-8111-000000000001';
  const CreatedId = 'bbbbbbbb-1111-4111-8111-000000000002';
  const record = { ReminderID: ReminderId, version: 'a'.repeat(16), ReminderMessageText: 'Review the report', State: 'scheduled' };
  const script = path.join(__dirname, '../skills/bulk-edit-reminders/bulk-edit-reminders.mjs');

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sleuth-bulk-client-'));
    bootstrap = path.join(directory, 'fetch.mjs');
    logfile = path.join(directory, 'requests.jsonl');
    fs.writeFileSync(bootstrap, `import fs from 'node:fs';
      const write = fs.writeFileSync;
      fs.writeFileSync = (file, ...args) => {
        if(process.env.CLI_TEST_FAIL_RESULT === '1' && String(file).includes('.result-')) throw new Error('simulated full disk');
        return write(file, ...args);
      };
      globalThis.fetch = async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null;
        fs.appendFileSync(process.env.CLI_TEST_LOG, JSON.stringify({ method: options.method, redirect: options.redirect,
          agent: options.headers['User-Agent'], key: options.headers['Idempotency-Key'], hasAuth: Boolean(options.headers.Authorization), body })+'\\n');
        if(body && process.env.CLI_TEST_FAIL_POST === '1') throw new Error('simulated ambiguous transport failure');
        const data = body ? { results: body.actions.map(item => ({ action: item.action,
          status: ({create:'created',complete:'completed',cancel:'canceled'})[item.action] || 'updated',
          reminderId: item.reminderId || '${CreatedId}' })), counts: {} }
          : JSON.parse(process.env.CLI_TEST_RECORDS);
        return { ok: true, status: 200, json: async () => ({ success: true, data }) };
      };`);
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  /** Run the actual entrypoint with synthetic credentials and a private temporary backup directory. */
  function Run(ArgArgs, ArgEnv = {}) {
    return spawnSync(process.execPath, ['--import', bootstrap, '--', script, '--env-file', path.join(directory, 'absent.env'), '--backup-dir', directory, ...ArgArgs], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, SLEUTH_WEB_API_BASE_URL: 'https://api.example.test', SLEUTH_WEB_API_TOKEN: 'slp_' + 'bot-test_' + 'x'.repeat(43), SLEUTH_WORKSPACE_NAME: 'test-ws',
        CLI_TEST_LOG: logfile, CLI_TEST_RECORDS: JSON.stringify([record]), ...ArgEnv },
    });
  }

  /** Captured HTTP metadata excludes the token itself. */
  function Calls() { return fs.existsSync(logfile) ? fs.readFileSync(logfile, 'utf8').trim().split('\n').filter(Boolean).map(ArgLine => JSON.parse(ArgLine)) : []; }
  function Receipt() { return path.join(directory, fs.readdirSync(directory).find(ArgName => ArgName.endsWith('.request.json'))); }

  test('bot writes carry backed-up versions, explicit headers and an exact durable replay', () => {
    const first = Run(['--complete', ReminderId]);
    if(first.status !== 0) throw new Error(first.stderr);
    expect(first.status).toBe(0);
    const original = Calls().find(ArgCall => ArgCall.method === 'POST');
    expect(original).toMatchObject({ agent: 'AEGIS-Bulk-Reminders/1.0', hasAuth: true, redirect: 'error', body: { actions: [{ action: 'complete', reminderId: ReminderId, ifMatch: record.version }] } });
    expect(original.key).toMatch(/^[a-z0-9-]{36}$/);
    const receipt = Receipt();
    expect(fs.statSync(receipt).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(receipt, 'utf8')).not.toContain('slp_');
    expect(JSON.parse(fs.readFileSync(receipt, 'utf8')).Result).toBeUndefined();
    const resultFile = fs.readdirSync(directory).find(ArgName => ArgName.includes('.result-'));
    expect(fs.statSync(path.join(directory, resultFile)).mode & 0o777).toBe(0o600);
    // a replay keeps the original version/key even when the fresh backup differs or the id disappeared.
    const replay = Run(['--replay', receipt], { CLI_TEST_RECORDS: '[]' });
    expect(replay.status).toBe(0);
    expect(Calls().filter(ArgCall => ArgCall.method === 'POST')[1]).toEqual(original);
  });

  test.each([
    [['--retitle', `${ReminderId}=Review the report`, '--complete', ReminderId], {}],
    [['--reassign', `${ReminderId}=U1`], {}],
    [['--retitle', `${ReminderId}=Review the report`, '--force-title'], {}],
    [['--complete', ReminderId], { SLEUTH_WEB_API_BASE_URL: 'http://127.0.0.1:2020' }],
  ])('unsafe bot invocation refuses before POST: %j', (ArgArgs, ArgEnv) => {
    expect(Run(ArgArgs, ArgEnv).status).toBe(1);
    expect(Calls().filter(ArgCall => ArgCall.method === 'POST')).toHaveLength(0);
  });

  test('ambiguous creates cannot be blindly replayed', () => {
    const action = { title: 'Validate the CLI pilot', dueDate: '2030-03-01T16:00:00Z', channelId: 'C_TEST', assigneeIds: ['U_TEST'] };
    expect(Run(['--create', JSON.stringify(action)], { CLI_TEST_FAIL_POST: '1' }).status).toBe(1);
    const receipt = Receipt();
    expect(Run(['--replay', receipt]).status).toBe(1);
    expect(Calls().filter(ArgCall => ArgCall.method === 'POST')).toHaveLength(1);
  });

  test('confirmed creates are never posted again, even when a GET still reports the original pending', () => {
    const action = { title: 'Validate the CLI pilot', dueDate: '2030-03-01T16:00:00Z', channelId: 'C_TEST', assigneeIds: ['U_TEST'] };
    expect(Run(['--create', JSON.stringify(action)]).status).toBe(0);
    const receipt = Receipt();
    expect(Run(['--replay', receipt], { CLI_TEST_RECORDS: JSON.stringify([{ ...record, ReminderID: CreatedId }]) }).status).toBe(1);
    expect(Run(['--replay', receipt], { CLI_TEST_RECORDS: '[]' }).status).toBe(1);
    expect(Calls().filter(ArgCall => ArgCall.method === 'POST')).toHaveLength(1);
  });

  test('a failed result save preserves the immutable prepared request for exact edit retry', () => {
    const first = Run(['--complete', ReminderId], { CLI_TEST_FAIL_RESULT: '1' });
    expect(first.status).toBe(1);
    const receipt = Receipt();
    const bytes = fs.readFileSync(receipt, 'utf8');
    const prepared = JSON.parse(bytes);
    expect(prepared.Result).toBeUndefined();
    expect(prepared.Body.actions[0].ifMatch).toBe(record.version);
    expect(Run(['--replay', receipt], { CLI_TEST_RECORDS: '[]' }).status).toBe(0);
    expect(fs.readFileSync(receipt, 'utf8')).toBe(bytes);
    expect(Calls().filter(ArgCall => ArgCall.method === 'POST')[1]).toEqual(Calls().filter(ArgCall => ArgCall.method === 'POST')[0]);
  });

  test('a replay cannot change destination or principal', () => {
    expect(Run(['--complete', ReminderId]).status).toBe(0);
    expect(Run(['--replay', Receipt()], { SLEUTH_WEB_API_BASE_URL: 'https://other.example.test' }).status).toBe(1);
    expect(Calls().filter(ArgCall => ArgCall.method === 'POST')).toHaveLength(1);
  });

  test('legacy operator requests preserve multiple edits without bot version requirements', () => {
    expect(Run(['--retitle', `${ReminderId}=Review the report`, '--reschedule', `${ReminderId}=2030-03-01T16:00:00Z`], {
      SLEUTH_WEB_API_TOKEN: 'operator-test', SLEUTH_WEB_API_BASE_URL: 'http://127.0.0.1:2020',
    }).status).toBe(0);
    const posted = Calls().find(ArgCall => ArgCall.method === 'POST');
    expect(posted.key).toBeUndefined();
    expect(posted.body.actions).toHaveLength(2);
    expect(posted.body.actions[0].ifMatch).toBeUndefined();
  });
});
