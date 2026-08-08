'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  BuildProjectedRebalanceExport,
  FoldReminderReadModels,
  ProjectionParityError,
  ReadWithProjectionFallbackAsync,
} = require('../src/reminders-projection');
const {
  BuildParityReport,
  CompareBytes,
  CompareSemantics,
  FindSemanticDiffPaths,
  ParseEvents,
  SerializeCanonical,
} = require('../scripts/projection-parity-harness');

const HarnessPath = path.join(__dirname, '..', 'scripts', 'projection-parity-harness.js');

function BaselineEvent(ArgOverrides = {}) {
  return {
    id: 'evt-baseline',
    ts: '2026-08-01T12:00:00.000Z',
    type: 'BaselineReminderImported',
    reminderId: 'rem-1',
    payload: {
      text: 'Ship parity harness', assigneeId: 'U_OWNER', assigneeIds: ['U_OWNER'],
      sourceChannelId: 'C_SOURCE', targetChannelId: 'C_REMINDERS', dueAt: '2026-08-02T12:00:00.000Z',
      state: 'scheduled', githubUrls: ['https://github.com/acme/repo/pull/1'],
      originalSenderId: 'U_SENDER', originalMessageId: '123.456', originalThreadTs: '123.000',
      originalChannelName: 'engineering', ignoreSnooze: false, clientId: 'acme', projectId: 'ledger',
    },
    ...ArgOverrides,
  };
}

test('baseline events fold to the JSON reminder shape and completed history', () => {
  const Events = [
    BaselineEvent(),
    {
      id: 'evt-completed', ts: '2026-08-03T12:00:00.000Z', type: 'ReminderCompleted', reminderId: 'rem-1',
      payload: { by: 'U_OWNER', method: 'reaction', summary: 'Ship parity harness', completedAt: '2026-08-03T12:00:00.000Z' },
    },
  ];
  const Folded = FoldReminderReadModels(Events, { strict: true });
  assert.deepEqual(Folded.reminders, []);
  assert.deepEqual(Folded.completed, [{
    reminderId: 'rem-1', summary: 'Ship parity harness', assigneeID: 'U_OWNER', sourceChannelID: 'C_SOURCE',
    dueDate: '2026-08-02T12:00:00.000Z', completedMs: Date.parse('2026-08-03T12:00:00.000Z'), clientId: 'acme',
  }]);
});

test('strict projection refuses a native event with fields the ledger never captured', () => {
  const Native = BaselineEvent({ type: 'ReminderCreated' });
  delete Native.payload.createdOn;
  delete Native.payload.originalSenderId;
  delete Native.payload.originalMessageId;
  delete Native.payload.originalThreadTs;
  delete Native.payload.originalChannelName;
  delete Native.payload.ignoreSnooze;
  assert.throws(() => FoldReminderReadModels([Native], { strict: true }), ProjectionParityError);
});

async function AssertIndependentlyReversibleAsync(ArgFlagName) {
  const ReadAuthoritativeAsync = async () => 'json';
  const ReadProjectionAsync = async () => 'projection';
  const Off = await ReadWithProjectionFallbackAsync({
    flagName: ArgFlagName, environment: {}, ReadAuthoritativeAsync, ReadProjectionAsync,
  });
  assert.deepEqual(Off, { value: 'json', source: 'authoritative' });

  const On = await ReadWithProjectionFallbackAsync({
    flagName: ArgFlagName, environment: { [ArgFlagName]: 'projection' }, ReadAuthoritativeAsync, ReadProjectionAsync,
  });
  assert.deepEqual(On, { value: 'projection', source: 'projection' });

  const RolledBack = await ReadWithProjectionFallbackAsync({
    flagName: ArgFlagName, environment: {}, ReadAuthoritativeAsync, ReadProjectionAsync,
  });
  assert.deepEqual(RolledBack, { value: 'json', source: 'authoritative' });
}

test('REMINDERS_READ_SOURCE is independently reversible', async () => {
  await AssertIndependentlyReversibleAsync('REMINDERS_READ_SOURCE');
});

test('COMPLETED_READ_SOURCE is independently reversible', async () => {
  await AssertIndependentlyReversibleAsync('COMPLETED_READ_SOURCE');
});

test('REBALANCE_EXPORT_SOURCE is independently reversible', async () => {
  await AssertIndependentlyReversibleAsync('REBALANCE_EXPORT_SOURCE');
});

test('a projection error logs and returns the authoritative value', async () => {
  /** @type {Array<any[]>} */
  const Warnings = [];
  const Logger = { warn: (...ArgArgs) => Warnings.push(ArgArgs) };
  const Result = await ReadWithProjectionFallbackAsync({
    flagName: 'REMINDERS_READ_SOURCE', environment: { REMINDERS_READ_SOURCE: 'projection' }, Logger,
    ReadAuthoritativeAsync: async () => 'json',
    ReadProjectionAsync: async () => { throw new Error('induced projection error'); },
  });
  assert.equal(Result.value, 'json');
  assert.equal(Result.source, 'authoritative');
  assert.equal(Result.fallbackError?.message, 'induced projection error');
  assert.equal(Warnings.length, 1);
});

test('the harness reports byte and semantic diffs separately with exact paths', () => {
  const Authoritative = '{\n  "a": 1,\n  "b": 2\n}\n';
  const Projection = '{\n  "b": 2,\n  "a": 1\n}\n';
  assert.equal(CompareBytes(Authoritative, Projection).equal, false);
  assert.equal(CompareSemantics(JSON.parse(Authoritative), JSON.parse(Projection)).equal, true);
  assert.deepEqual(FindSemanticDiffPaths({ a: [1] }, { a: [2] }), ['$.a[0]']);
});

test('the harness reads the real JSONL event format and refuses missing rebalance parity', () => {
  const Root = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-parity-'));
  const Events = [BaselineEvent()];
  const Folded = FoldReminderReadModels(Events, { strict: true });
  fs.writeFileSync(path.join(Root, 'events.jsonl'), Events.map(ArgEvent => JSON.stringify(ArgEvent)).join('\n') + '\n');
  fs.writeFileSync(path.join(Root, 'reminders.json'), SerializeCanonical(Folded.reminders));
  fs.writeFileSync(path.join(Root, 'completed.json'), SerializeCanonical(Folded.completed));
  try {
    const Result = spawnSync(process.execPath, [HarnessPath,
      '--workspace', 'acme', '--events', path.join(Root, 'events.jsonl'), '--reminders', path.join(Root, 'reminders.json'),
      '--completed', path.join(Root, 'completed.json')], { encoding: 'utf8' });
    assert.equal(Result.error, undefined);
    assert.equal(Result.status, 1);
    const Report = JSON.parse(Result.stdout);
    assert.equal(Report.byteDiffs.reminders.equal, true);
    assert.equal(Report.semanticDiffs.completed.equal, true);
    assert.deepEqual(Report.missingSurfaces, ['rebalance']);
    assert.equal(Report.clean, false);
  } finally {
    fs.rmSync(Root, { recursive: true, force: true });
  }
});

test('the harness rejects a corrupt JSONL line instead of silently dropping it', () => {
  assert.throws(() => ParseEvents('{"type":"ReminderCreated"}\nnot-json\n', 'events.jsonl'), /events\.jsonl:2/);
});

test('a captured API rebalance fixture reports the display/source mismatch instead of claiming parity', () => {
  const Folded = FoldReminderReadModels([BaselineEvent()], { strict: true });
  const CapturedApiRebalance = {
    ...BuildProjectedRebalanceExport(Folded.reminders, 'acme'),
    fetchedAt: '2026-08-01T13:00:00.000Z',
    source: { type: 'sleuth-reminders-file', relativePath: 'data/runtime/reminders/acme_reminders.json' },
    display: { timeZone: 'UTC', sectionOrder: [] },
    reminders: [{ ...BuildProjectedRebalanceExport(Folded.reminders, 'acme').reminders[0], display: { label: 'A.' } }],
  };
  const Report = BuildParityReport({ workspace: 'acme', events: [BaselineEvent()], reminders: Folded.reminders, completed: [], rebalance: CapturedApiRebalance });
  assert.equal(Report.byteDiffs.rebalance.equal, false);
  assert.equal(Report.semanticDiffs.rebalance.equal, false);
  assert.deepEqual(Report.semanticDiffs.rebalance.differentPaths.slice(0, 3), ['$.display', '$.fetchedAt', '$.reminders[0].display']);
  assert.equal(Report.clean, false);
});
