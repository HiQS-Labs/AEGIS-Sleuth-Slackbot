'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  BuildProjectedRebalanceExport,
  FindMissingNativeReminderFields,
  FindMissingRelayStateFields,
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
      // Required for strict parity (QA 2026-08-08): github-comment-relay.js:102 refuses to relay
      // when GitHubRelayStopped is set, so a fold that cannot restore these would resume a relay a
      // user stopped. This fixture therefore models a POST-schema-expansion event — the shape a
      // stream must have to be projectable. Tests asserting REJECTION build payloads without them.
      gitHubRelayStarted: false, gitHubRelayStopped: false,
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
  delete Native.payload.gitHubRelayStarted;
  delete Native.payload.gitHubRelayStopped;
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

// REPLACED 2026-08-08 (QA finding). This asserted COMPLETED_READ_SOURCE was independently
// reversible — i.e. that flag-ON serves the projection. That is exactly the behaviour that must NOT
// exist: the fold's completedMs can never match the authoritative Date.now() stamp, so serving it
// would hand out subtly wrong completion timestamps. The flag is now BLOCKED, and the assertion
// below is the inverse of the original. See the blocked-flag test at the bottom of this file.
test('COMPLETED_READ_SOURCE stays on the authoritative store in BOTH flag states', async () => {
  for(const FlagValue of [undefined, 'projection']) {
    const Result = await ReadWithProjectionFallbackAsync({
      flagName: 'COMPLETED_READ_SOURCE',
      environment: FlagValue === undefined ? {} : { COMPLETED_READ_SOURCE: FlagValue },
      Logger: { warn: () => {} },
      ReadAuthoritativeAsync: async () => 'json',
      ReadProjectionAsync: async () => 'projection',
    });
    assert.equal(Result.source, 'authoritative', `flag=${String(FlagValue)} must stay authoritative`);
    assert.equal(Result.value, 'json');
  }
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

test('the harness proves byte-compatible rebalance captures separately from folded JSON surfaces', () => {
  const Folded = FoldReminderReadModels([BaselineEvent()], { strict: true });
  const Rebalance = { workspaceName: 'acme', fetchedAt: '2026-08-01T13:00:00.000Z', reminders: [] };
  const RebalanceRaw = `${JSON.stringify(Rebalance)}\n`;
  const Report = BuildParityReport({
    workspace: 'acme', events: [BaselineEvent()], reminders: Folded.reminders, completed: Folded.completed,
    rebalance: Rebalance, rebalanceProjection: Rebalance,
    remindersRaw: SerializeCanonical(Folded.reminders), completedRaw: SerializeCanonical(Folded.completed),
    rebalanceRaw: RebalanceRaw, rebalanceProjectionRaw: RebalanceRaw,
  });
  assert.equal(Report.byteDiffs.rebalance.equal, true);
  assert.equal(Report.semanticDiffs.rebalance.equal, true);
  assert.equal(Report.clean, true);
});

// ── QA findings, 2026-08-08 ─────────────────────────────────────────────────────────────────
// These assert the cutover CANNOT serve known-lossy data, which is the opposite of the usual
// "flag works" test. A reversibility test that only proves OFF behaves like today would pass
// happily while the ON path served wrong records.

test('COMPLETED_READ_SOURCE cannot select the projection even when explicitly enabled', async () => {
  const Warnings = [];
  let ProjectionRead = false;
  const Result = await ReadWithProjectionFallbackAsync({
    flagName: 'COMPLETED_READ_SOURCE',
    environment: { COMPLETED_READ_SOURCE: 'projection' },
    Logger: { warn: (/** @type {string} */ ArgMessage) => Warnings.push(ArgMessage) },
    ReadAuthoritativeAsync: async () => ['authoritative'],
    ReadProjectionAsync: async () => { ProjectionRead = true; return ['projection']; },
  });

  // The authoritative completedMs is stamped with Date.now() while the event carries a separately
  // sampled ISO instant, so the two can never be byte-identical. Blocked until a schema change
  // carries the authoritative value verbatim.
  assert.equal(Result.source, 'authoritative');
  assert.deepEqual(Result.value, ['authoritative']);
  assert.equal(ProjectionRead, false, 'the lossy projection must not even be read');
  assert.equal(Warnings.length, 1, 'a blocked flag must warn loudly, not fail silently');
  assert.match(Warnings[0], /BLOCKED/);
});

test('relay-state parity applies to BASELINE events too, not just native creations', () => {
  // baseline-import.js emits neither relay flag, and production's stream is largely
  // BaselineReminderImported after GH-355 — so a check gated on ReminderCreated alone would exempt
  // the one stream that actually matters. This asserts the baseline path is covered.
  const BaselineEvents = [{
    id: 'evt-1', ts: '2026-08-01T12:00:00.000Z', type: 'BaselineReminderImported',
    workspace: 'ws', reminderId: 'rem-1',
    payload: {
      text: 'x', dueAt: '2026-08-02T12:00:00.000Z', state: 'scheduled',
      createdOn: '2026-08-01T12:00:00.000Z', originalSenderId: 'U1', originalMessageId: '1.0',
      originalThreadTs: null, originalChannelName: 'general', ignoreSnooze: false,
      githubUrls: ['https://github.com/acme/repo/pull/1'],
    },
  }];
  assert.throws(() => FoldReminderReadModels(BaselineEvents, { strict: true }), ProjectionParityError);
});

test('strict parity rejects a native stream missing the GitHub relay state fields', () => {
  // github-comment-relay.js:102 refuses to relay when GitHubRelayStopped is set. A fold that cannot
  // restore it would RESUME a relay the user deliberately stopped — a behavioural regression, not a
  // cosmetic diff. Strict parity must therefore treat the absence as disqualifying.
  const Missing = FindMissingRelayStateFields({
    githubUrls: ['https://github.com/acme/repo/pull/1'],
    createdOn: '2026-08-01T00:00:00.000Z',
    originalSenderId: 'U_SENDER',
    originalMessageId: '1.0001',
    originalThreadTs: null,
    originalChannelName: 'general',
    ignoreSnooze: false,
  });

  assert.ok(Missing.includes('GitHubRelayStarted'), 'GitHubRelayStarted must be required for parity');
  assert.ok(Missing.includes('GitHubRelayStopped'), 'GitHubRelayStopped must be required for parity');
});
