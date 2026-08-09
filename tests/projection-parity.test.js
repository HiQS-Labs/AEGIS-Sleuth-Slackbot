'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  BLOCKED_PROJECTION_FLAGS,
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

// Registered in PROJECTION_FLAGS but deliberately not blocked, so the error-fallback path stays
// testable while every production flag is blocked.
const TEST_ONLY_UNBLOCKED_FLAG = 'PROJECTION_ERROR_PATH_TEST_ONLY';

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
      // v2: completedMs is now required under strict mode, because a re-parsed ISO instant is a
      // different number from the one the authoritative CompletionRecord stored.
      v: 2, id: 'evt-completed', ts: '2026-08-03T12:00:00.000Z', type: 'ReminderCompleted', reminderId: 'rem-1',
      payload: {
        by: 'U_OWNER', method: 'reaction', summary: 'Ship parity harness',
        completedAt: '2026-08-03T12:00:00.000Z', completedMs: Date.parse('2026-08-03T12:00:00.000Z'),
      },
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

// REWRITTEN 2026-08-08. These previously asserted "flag-ON still serves the authoritative store,
// because every flag is BLOCKED". That blocklist is now empty — the guarantee moved from a global
// compile-time refusal to a per-workspace runtime one — so asserting the old shape would keep
// passing via the default-deny branch while proving nothing about the gate that replaced it.
//
// The contract now has four cases, and a flag is only safe if it satisfies all of them.
async function AssertFlagIsCoverageGatedAsync(ArgFlagName) {
  /** @param {object} ArgOverrides */
  const ReadAsync = async (ArgOverrides) => {
    let ProjectionRead = false;
    const Result = await ReadWithProjectionFallbackAsync({
      flagName: ArgFlagName,
      Logger: { warn: () => {} },
      ReadAuthoritativeAsync: async () => 'json',
      ReadProjectionAsync: async () => { ProjectionRead = true; return 'projection'; },
      ...ArgOverrides,
    });
    return { Result, ProjectionRead };
  };

  // 1. Flag off — authoritative, and the projection is never even read.
  const Off = await ReadAsync({ environment: {}, IsCoverageCleanAsync: async () => true });
  assert.equal(Off.Result.source, 'authoritative', `${ArgFlagName}: flag off`);
  assert.equal(Off.ProjectionRead, false);

  // 2. Flag on but NO gate supplied — default-deny. This is the case every production call site
  //    used to be in, and the one that made the whole mechanism inert.
  const Ungated = await ReadAsync({ environment: { [ArgFlagName]: 'projection' } });
  assert.equal(Ungated.Result.source, 'authoritative', `${ArgFlagName}: no gate supplied`);
  assert.equal(Ungated.ProjectionRead, false, 'an ungated read must not touch the projection');

  // 3. Flag on, gate says unclean — authoritative.
  const Unclean = await ReadAsync({
    environment: { [ArgFlagName]: 'projection' }, IsCoverageCleanAsync: async () => false,
  });
  assert.equal(Unclean.Result.source, 'authoritative', `${ArgFlagName}: unclean coverage`);
  assert.equal(Unclean.ProjectionRead, false);

  // 4. Flag on, coverage proven — NOW it serves. Without this the other three would be satisfied by
  //    a flag that can never work at all, which is not the same as a flag that is safe.
  const Clean = await ReadAsync({
    environment: { [ArgFlagName]: 'projection' }, IsCoverageCleanAsync: async () => true,
  });
  assert.equal(Clean.Result.source, 'projection', `${ArgFlagName}: verified coverage must serve`);
  assert.equal(Clean.Result.value, 'projection');
}

test('REMINDERS_READ_SOURCE serves only with proven coverage', async () => {
  await AssertFlagIsCoverageGatedAsync('REMINDERS_READ_SOURCE');
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

// Was blocked because rescheduling resets IgnoreSnooze in the live queue while ReminderScheduled did
// not carry it, so the fold kept a stale value this export would publish externally. Schema v2
// carries `ignoreSnooze`; the gate below is what proves it for a given workspace's actual data.
test('REBALANCE_EXPORT_SOURCE serves only with proven coverage', async () => {
  await AssertFlagIsCoverageGatedAsync('REBALANCE_EXPORT_SOURCE');
});

test('a projection error logs and returns the authoritative value', async () => {
  /** @type {Array<any[]>} */
  const Warnings = [];
  const Logger = { warn: (...ArgArgs) => Warnings.push(ArgArgs) };
  const Result = await ReadWithProjectionFallbackAsync({
    // Uses a flag that is registered but NOT blocked, so the error path is genuinely exercised.
    // With every real flag blocked, asserting this through one of them would prove nothing — the
    // block short-circuits before ReadProjectionAsync ever runs.
    flagName: TEST_ONLY_UNBLOCKED_FLAG, environment: { [TEST_ONLY_UNBLOCKED_FLAG]: 'projection' }, Logger,
    // The coverage gate is default-deny, so this has to pass it before the error path is reachable
    // at all. Without a clean gate the read is refused earlier and ReadProjectionAsync never runs —
    // which would make this assert the wrong fallback for the wrong reason.
    IsCoverageCleanAsync: async () => true,
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

test('COMPLETED_READ_SOURCE cannot select the projection without proven coverage', async () => {
  const Warnings = [];
  let ProjectionRead = false;
  const Result = await ReadWithProjectionFallbackAsync({
    flagName: 'COMPLETED_READ_SOURCE',
    environment: { COMPLETED_READ_SOURCE: 'projection' },
    Logger: { warn: (/** @type {string} */ ArgMessage) => Warnings.push(ArgMessage) },
    // No gate supplied — the shape every production call site had before this was wired.
    ReadAuthoritativeAsync: async () => ['authoritative'],
    ReadProjectionAsync: async () => { ProjectionRead = true; return ['projection']; },
  });

  // The authoritative completedMs used to be stamped with Date.now() while the event carried a
  // separately sampled ISO instant, so the two could never be byte-identical. Schema v2 threads the
  // one sampled value to both, which is why this flag is no longer blocked outright — but an
  // operator who enables it without a recorded parity run still must not be served.
  assert.equal(Result.source, 'authoritative');
  assert.deepEqual(Result.value, ['authoritative']);
  assert.equal(ProjectionRead, false, 'an unverified projection must not even be read');
  assert.equal(Warnings.length, 1, 'a refused read must warn loudly, not fail silently');
  assert.match(Warnings[0], /no coverage gate/, 'the warning must name the actual reason for refusal');
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

test('a relay-capable stream rehydrates BOTH relay flags, not just validates them', () => {
  // QA round 2: the strict check accepted these fields while MakeReminder dropped them, so a stream
  // could pass parity and still resume a stopped relay. Validation and rehydration must agree.
  const Events = [BaselineEvent({ payload: { ...BaselineEvent().payload, gitHubRelayStopped: true, gitHubRelayStarted: true } })];
  const Folded = FoldReminderReadModels(Events, { strict: true });
  assert.equal(Folded.reminders.length, 1);
  assert.equal(Folded.reminders[0].GitHubRelayStopped, true, 'a stopped relay must stay stopped across a fold');
  assert.equal(Folded.reminders[0].GitHubRelayStarted, true, 'an already-started relay must not read as first-use');
});

// --- schema v2: ThreadRelayStateChanged, ReminderStateChanged, authoritative completedMs ---

/** The synthetic envelope the relay writes: thread-scoped state, no reminder of its own. */
function ThreadRelayEvent(ArgThreadKey, ArgStarted, ArgStopped, ArgOverrides = {}) {
  return {
    v: 2,
    id: `evt-relay-${ArgThreadKey}-${ArgStopped ? 'stop' : 'start'}`,
    ts: '2026-08-04T12:00:00.000Z',
    type: 'ThreadRelayStateChanged',
    reminderId: `thread:${ArgThreadKey}`,
    payload: { threadKey: ArgThreadKey, relayStarted: ArgStarted, relayStopped: ArgStopped },
    ...ArgOverrides,
  };
}

test('a thread-scoped relay event applies to every reminder in the thread and mints no reminder of its own', () => {
  // Two reminders share thread 123.000 (BaselineEvent's originalThreadTs).
  const Second = BaselineEvent({
    id: 'evt-baseline-2',
    reminderId: 'rem-2',
    payload: { ...BaselineEvent().payload, text: 'Second reminder in the same thread' },
  });
  const Folded = FoldReminderReadModels([BaselineEvent(), Second, ThreadRelayEvent('123.000', true, true)], { strict: true });

  // The `thread:123.000` envelope must NOT become a third record.
  assert.equal(Folded.reminders.length, 2, 'the synthetic thread id must not fold into a reminder');
  assert.deepEqual(Folded.reminders.map(ArgR => ArgR.ReminderID).sort(), ['rem-1', 'rem-2']);
  for(const Reminder of Folded.reminders) {
    assert.equal(Reminder.GitHubRelayStopped, true, `${Reminder.ReminderID} shares the thread's stopped state`);
    assert.equal(Reminder.GitHubRelayStarted, true, `${Reminder.ReminderID} shares the thread's started state`);
  }
});

test('a reminder created AFTER the relay event still inherits its thread state', () => {
  // The case that decided the design: fanning out per-reminder at emission time cannot cover a
  // reminder that does not exist yet. Applying by thread key after the fold does.
  const Later = BaselineEvent({
    id: 'evt-baseline-late',
    ts: '2026-08-05T12:00:00.000Z',
    reminderId: 'rem-late',
    payload: { ...BaselineEvent().payload, text: 'Joined an already-stopped thread' },
  });
  const Folded = FoldReminderReadModels([ThreadRelayEvent('123.000', true, true), BaselineEvent(), Later], { strict: true });
  const Late = Folded.reminders.find(ArgR => ArgR.ReminderID === 'rem-late');
  assert.ok(Late, 'the later reminder must still be projected');
  assert.equal(Late.GitHubRelayStopped, true, 'a reminder joining a stopped thread must not resume the relay');
});

test('a relay event for a different thread leaves this reminder alone', () => {
  const Folded = FoldReminderReadModels([BaselineEvent(), ThreadRelayEvent('999.999', true, true)], { strict: true });
  assert.equal(Folded.reminders.length, 1);
  assert.equal(Folded.reminders[0].GitHubRelayStopped, false, 'another thread must not stop this one');
});

test('the last relay event for a thread wins', () => {
  const Folded = FoldReminderReadModels([
    BaselineEvent(),
    ThreadRelayEvent('123.000', true, false, { id: 'evt-relay-a', ts: '2026-08-04T12:00:00.000Z' }),
    ThreadRelayEvent('123.000', true, true, { id: 'evt-relay-b', ts: '2026-08-04T13:00:00.000Z' }),
  ], { strict: true });
  assert.equal(Folded.reminders[0].GitHubRelayStopped, true);
});

test('ReminderStateChanged folds the states the specific events never emitted', () => {
  // Before v2 the fold had no event for `overdue`, so an overdue reminder replayed as `scheduled` —
  // and production persists at least `overdue`, so this was never hypothetical.
  const Folded = FoldReminderReadModels([
    BaselineEvent(),
    {
      v: 2, id: 'evt-overdue', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderStateChanged', reminderId: 'rem-1',
      payload: { fromState: 'scheduled', toState: 'overdue', reason: 'due-passed' },
    },
  ], { strict: true });
  assert.equal(Folded.reminders.length, 1);
  assert.equal(Folded.reminders[0].State, 'overdue');
});

test('an unrecognised toState is ignored rather than written through', () => {
  const Folded = FoldReminderReadModels([
    BaselineEvent(),
    {
      v: 2, id: 'evt-garbage', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderStateChanged', reminderId: 'rem-1',
      payload: { fromState: 'scheduled', toState: 'teleported', reason: null },
    },
  ], { strict: true });
  assert.equal(Folded.reminders[0].State, 'scheduled', 'a state the JSON store could never hold must not be projected');
});

test('a v2 completion projects the AUTHORITATIVE completedMs, not a re-parse of the ISO instant', () => {
  // This is the defect that blocked COMPLETED_READ_SOURCE: the stored CompletionRecord took its own
  // Date.now(), so a re-parsed ISO string could never be the same number. v2 carries it verbatim.
  const CompletedMs = 1785756789123;
  const Folded = FoldReminderReadModels([
    BaselineEvent(),
    {
      v: 2, id: 'evt-completed-v2', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderCompleted', reminderId: 'rem-1',
      payload: {
        by: 'U_OWNER', method: 'reaction', summary: 'Ship it',
        completedAt: new Date(CompletedMs).toISOString(), completedMs: CompletedMs,
        sourceChannelId: 'C_SOURCE', dueDate: '2026-08-02T12:00:00.000Z', clientId: 'acme',
      },
    },
  ], { strict: true });
  assert.equal(Folded.completed.length, 1);
  assert.equal(Folded.completed[0].completedMs, CompletedMs, 'the projected instant must be the stored one, not a re-derivation');
  assert.equal(Folded.completed[0].sourceChannelID, 'C_SOURCE');
  assert.equal(Folded.completed[0].clientId, 'acme');
});

test('a v1 completion still folds via the ISO fallback when NOT strict', () => {
  // v1 events carry no completedMs, so strict rejects them (see the gate test below) — but the
  // non-strict fold that replay and diagnostics use must keep working unchanged.
  const Folded = FoldReminderReadModels([
    BaselineEvent(),
    {
      id: 'evt-completed-v1', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderCompleted', reminderId: 'rem-1',
      payload: { by: 'U_OWNER', method: 'reaction', summary: 'Ship it', completedAt: '2026-08-03T12:00:00.000Z' },
    },
  ]);
  assert.equal(Folded.completed.length, 1);
  assert.equal(Folded.completed[0].completedMs, Date.parse('2026-08-03T12:00:00.000Z'));
});

// --- the strict gate must actually test for what the schema expansion added ---

test('a v1 completion is REJECTED in strict mode — a re-derived completedMs is not parity', () => {
  // Adding the field to the schema is only half of it. Without a check, a flag-on read would still
  // serve a re-parsed number for any pre-v2 stream, which is exactly what blocked the flag.
  const Events = [
    BaselineEvent(),
    {
      id: 'evt-completed-v1', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderCompleted', reminderId: 'rem-1',
      payload: { by: 'U_OWNER', method: 'reaction', summary: 'Ship it', completedAt: '2026-08-03T12:00:00.000Z' },
    },
  ];
  assert.throws(() => FoldReminderReadModels(Events, { strict: true }), ProjectionParityError);
  // Non-strict still folds — the fallback path must stay usable.
  assert.equal(FoldReminderReadModels(Events).completed.length, 1);
});

test('a v1 ReminderScheduled is REJECTED in strict mode — a stale IgnoreSnooze reaches an external consumer', () => {
  const Events = [
    BaselineEvent(),
    {
      id: 'evt-sched-v1', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderScheduled', reminderId: 'rem-1',
      payload: { dueAt: '2026-08-09T12:00:00.000Z', via: 'reschedule' },
    },
  ];
  assert.throws(() => FoldReminderReadModels(Events, { strict: true }), ProjectionParityError);
});

test('a v2 stream passes the strengthened gate and replays the reset IgnoreSnooze', () => {
  const Events = [
    BaselineEvent({ payload: { ...BaselineEvent().payload, ignoreSnooze: true } }),
    {
      v: 2, id: 'evt-sched-v2', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderScheduled', reminderId: 'rem-1',
      payload: { dueAt: '2026-08-09T12:00:00.000Z', via: 'reschedule', ignoreSnooze: false },
    },
  ];
  const Folded = FoldReminderReadModels(Events, { strict: true });
  assert.equal(Folded.reminders[0].IgnoreSnooze, false, 'rescheduling resets the flag; the fold must not keep the creation-time value');
  assert.equal(Folded.reminders[0].ShouldPostOn, '2026-08-09T12:00:00.000Z');
});

test('the gate names every missing field, not just the first', () => {
  const Events = [
    BaselineEvent(),
    { id: 'e1', ts: '2026-08-03T12:00:00.000Z', type: 'ReminderScheduled', reminderId: 'rem-1', payload: { dueAt: null, via: 'x' } },
    { id: 'e2', ts: '2026-08-04T12:00:00.000Z', type: 'ReminderCompleted', reminderId: 'rem-1', payload: { by: null, method: 'x', summary: null, completedAt: '2026-08-04T12:00:00.000Z' } },
  ];
  try {
    FoldReminderReadModels(Events, { strict: true });
    assert.fail('expected a parity error');
  } catch(Error_) {
    assert.ok(Error_ instanceof ProjectionParityError);
    assert.deepEqual(Error_.missingFields.sort(), ['rem-1.IgnoreSnooze', 'rem-1.completedMs']);
  }
});

// --- removal: found only by the first real-data parity run ---

test('a removed reminder is never resurrected by the fold', () => {
  // Real neochrome data folded 11 reminders to a live `scheduled` state that the JSON store had
  // already dropped. Under a read flag those would have come back and resumed posting to Slack.
  // Removal was simply never evented: #DeleteRemindersAsync mutated the queue and saved, silently.
  const Events = [
    BaselineEvent(),
    {
      v: 2, id: 'evt-removed', ts: '2026-08-05T12:00:00.000Z',
      type: 'ReminderRemoved', reminderId: 'rem-1',
      payload: { reason: 'wastebasket' },
    },
  ];
  const Folded = FoldReminderReadModels(Events, { strict: true });
  assert.equal(Folded.reminders.length, 0, 'a reminder dropped from the queue must not fold back into it');
  assert.equal(Folded.completed.length, 0, 'nor should it invent a completion');
});

test('removal AFTER completion keeps the completion record', () => {
  // The real sequence: CompleteReminderByIdAsync transitions to completed and THEN deletes from the
  // queue. If removal were modelled as a state it would erase the completion history.
  const Events = [
    BaselineEvent(),
    {
      v: 2, id: 'evt-done', ts: '2026-08-03T12:00:00.000Z',
      type: 'ReminderCompleted', reminderId: 'rem-1',
      payload: {
        by: 'U_OWNER', method: 'reaction', summary: 'Ship it',
        completedAt: '2026-08-03T12:00:00.000Z', completedMs: Date.parse('2026-08-03T12:00:00.000Z'),
        sourceChannelId: 'C_SOURCE', dueDate: null, clientId: null,
      },
    },
    {
      v: 2, id: 'evt-removed', ts: '2026-08-03T12:00:01.000Z',
      type: 'ReminderRemoved', reminderId: 'rem-1', payload: { reason: 'completed' },
    },
  ];
  const Folded = FoldReminderReadModels(Events, { strict: true });
  assert.equal(Folded.reminders.length, 0);
  assert.equal(Folded.completed.length, 1, 'completion history must survive the queue removal');
  assert.equal(Folded.completed[0].reminderId, 'rem-1');
});

// --- the coverage gate must actually gate the read path ---

test('an unclean ledger forces the authoritative store even when the flag is on', async () => {
  // Field checks prove the events PRESENT are complete; coverage proves none is MISSING. They are
  // independent failures, so a stream that passes every payload check must still be refused when
  // its coverage is unproven.
  let ProjectionRead = false;
  const Warnings = [];
  const Result = await ReadWithProjectionFallbackAsync({
    flagName: TEST_ONLY_UNBLOCKED_FLAG,
    environment: { [TEST_ONLY_UNBLOCKED_FLAG]: 'projection' },
    Logger: { warn: (...ArgArgs) => Warnings.push(ArgArgs) },
    IsCoverageCleanAsync: async () => false,
    ReadAuthoritativeAsync: async () => 'json',
    ReadProjectionAsync: async () => { ProjectionRead = true; return 'projection'; },
  });
  assert.equal(Result.source, 'authoritative');
  assert.equal(Result.value, 'json');
  assert.equal(ProjectionRead, false, 'an unclean ledger must not even be folded');
  assert.equal(Warnings.length, 1, 'and the operator must be told why');
});

test('a clean ledger lets the projection serve', async () => {
  const Result = await ReadWithProjectionFallbackAsync({
    flagName: TEST_ONLY_UNBLOCKED_FLAG,
    environment: { [TEST_ONLY_UNBLOCKED_FLAG]: 'projection' },
    IsCoverageCleanAsync: async () => true,
    ReadAuthoritativeAsync: async () => 'json',
    ReadProjectionAsync: async () => 'projection',
  });
  assert.equal(Result.source, 'projection');
});

test('the coverage gate is consulted only AFTER the flag and block checks', async () => {
  // Ordering matters for cost: a blocked or flag-off read must never pay for a coverage lookup.
  /** @param {Record<string,string>} ArgEnvironment @param {string} ArgFlag */
  const ConsultedForAsync = async (ArgEnvironment, ArgFlag) => {
    let Consulted = false;
    await ReadWithProjectionFallbackAsync({
      flagName: ArgFlag,
      environment: ArgEnvironment,
      Logger: { warn: () => {} },
      IsCoverageCleanAsync: async () => { Consulted = true; return true; },
      ReadAuthoritativeAsync: async () => 'json',
      ReadProjectionAsync: async () => 'projection',
    });
    return Consulted;
  };

  assert.equal(
    await ConsultedForAsync({}, 'REMINDERS_READ_SOURCE'), false,
    'a flag that is OFF short-circuits before the coverage check'
  );

  // BLOCKED_PROJECTION_FLAGS is empty now, so the emergency-stop path has to be exercised by
  // putting something in it — otherwise this branch is dead code that no test covers, and the one
  // rollback lever we have would rot unnoticed.
  BLOCKED_PROJECTION_FLAGS.add('REMINDERS_READ_SOURCE');
  try {
    assert.equal(
      await ConsultedForAsync({ REMINDERS_READ_SOURCE: 'projection' }, 'REMINDERS_READ_SOURCE'), false,
      'a BLOCKED flag short-circuits before the coverage check'
    );
  } finally {
    BLOCKED_PROJECTION_FLAGS.delete('REMINDERS_READ_SOURCE');
  }

  assert.equal(
    await ConsultedForAsync({ REMINDERS_READ_SOURCE: 'projection' }, 'REMINDERS_READ_SOURCE'), true,
    'an enabled, unblocked flag DOES pay for the lookup — otherwise nothing gates it'
  );
});

test('the projected rebalance export carries assigneeIds, not just the deprecated scalar', () => {
  // GH-22 follow-through. The ledger learned about shared assignments in schema v2, but the export
  // an external consumer actually reads published only `assigneeId` — telling every downstream
  // system that a shared reminder had exactly one owner. This shape must match web-api.js's.
  const Folded = FoldReminderReadModels([
    BaselineEvent({ payload: { ...BaselineEvent().payload, assigneeIds: ['U_ONE', 'U_TWO'] } }),
  ], { strict: true });
  const Export = BuildProjectedRebalanceExport(Folded.reminders, 'neochrome');
  assert.deepEqual(Export.reminders[0].assigneeIds, ['U_ONE', 'U_TWO']);
  assert.equal(Export.reminders[0].assigneeId, 'U_OWNER', 'the deprecated mirror stays for compatibility');
});

test('a legacy record with only the scalar still exports a truthful single-element array', () => {
  // Falling back to [] would claim a reminder has NO assignee, which is worse than the scalar.
  const Payload = { ...BaselineEvent().payload };
  delete Payload.assigneeIds;
  const Folded = FoldReminderReadModels([BaselineEvent({ payload: Payload })], { strict: true });
  const Export = BuildProjectedRebalanceExport(Folded.reminders, 'neochrome');
  assert.deepEqual(Export.reminders[0].assigneeIds, ['U_OWNER']);
});
