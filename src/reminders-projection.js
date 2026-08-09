'use strict';

// Read-side projection helpers for the Ledger migration.  This module is deliberately
// non-authoritative: callers keep the JSON store as their fallback until a parity run
// proves that a particular surface is safe to switch.

/**
 * The legacy-shaped reminder this projection folds to. Declared as a real shape rather than the
 * bare `object[]` the JSDoc used to say — `object` has NO properties, so every `.ShouldPostOn` /
 * `.State` access below raised TS2339 and `npm run build` was red (39 errors in this file alone).
 * Field names deliberately mirror the pre-P3 on-disk shape: parity with the legacy reader is the
 * exit criterion, so the projection must not quietly rename anything.
 * @typedef {Object} ProjectedReminder
 * @property {string} ReminderID
 * @property {string} State
 * @property {string|Date|null} CreatedOn
 * @property {string|Date|null} ShouldPostOn
 * @property {string} ReminderMessageText
 * @property {boolean} [IgnoreSnooze]
 * @property {string|null} [AssigneeID]
 * @property {string[]} [AssigneeIDs]
 * @property {string|null} [OriginalSenderID]
 * @property {string|null} [TargetChannelID]
 * @property {string|null} [OriginalChannelID]
 * @property {string|null} [OriginalChannelName]
 * @property {string|null} [OriginalMessageID]
 * @property {string|null} [OriginalThreadTs]
 * @property {string[]} [GitHubUrls]
 * @property {string|null} [clientId]
 * @property {string|null} [projectId]
 * @property {boolean} [GitHubRelayStarted]
 * @property {boolean} [GitHubRelayStopped]
 * @property {boolean} [Removed]
 * @property {string|null} [completedAt]
 * @property {number|null} [completedMs]
 * @property {string|null} [completedBy]
 * @property {string|null} [completionMethod]
 * @property {string|null} [completionSummary]
 * @property {string|null} [completionSourceChannelID]
 * @property {string|null} [completionDueDate]
 * @property {string|null} [completionClientId]
 */

/**
 * @typedef {Object} ProjectedCompletion
 * @property {string} reminderId
 * @property {number} completedMs
 * @property {any} [summary]
 * @property {string|null} [assigneeID]
 * @property {string|null} [sourceChannelID]
 * @property {string|Date|null} [dueDate]
 * @property {string|null} [clientId]
 */

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'canceled']);

/**
 * The states a `ReminderStateChanged.toState` may fold to — RemindersModule.ReminderState's values
 * (src/reminders-module.js:131-143), duplicated rather than imported so the projection stays free of
 * a dependency on the module it is meant to replace. Anything outside this set is ignored: a fold
 * that writes an unrecognised state would produce a record the JSON store could never hold, which is
 * worse than keeping the last known-good one.
 */
const PROJECTABLE_STATES = new Set([
  'scheduled', 'due', 'overdue', 'snoozed', 'posting', 'posted',
  'rescheduled', 'failed', 'completed', 'canceled', 'dead-letter',
]);
const PROJECTION_FLAGS = new Set([
  'REMINDERS_READ_SOURCE',
  'COMPLETED_READ_SOURCE',
  'REBALANCE_EXPORT_SOURCE',
  // Registered but never used by production code. Every real flag is currently BLOCKED (see below),
  // which short-circuits before ReadProjectionAsync runs — so without an unblocked flag the
  // error-fallback path could not be exercised at all, and contract item (c) would go untested.
  // Not in BLOCKED_PROJECTION_FLAGS on purpose.
  'PROJECTION_ERROR_PATH_TEST_ONLY',
]);

/**
 * Flags that are RECOGNISED but must never select the projection, because their fold is known-lossy
 * in a way strict field-presence cannot detect. Kept in PROJECTION_FLAGS so call sites stay valid
 * and the authoritative read still works — this forces the fallback rather than throwing.
 *
 * STATUS 2026-08-08 — this set is now EMPTY, and the three entries described below are retired.
 * Schema v2 closed the design mismatches for the first two, and the coverage gate — default-deny and
 * wired at every read site — now enforces the "parity run on real data" condition per workspace at
 * runtime, which is what the third always needed. The history is kept because it records WHY each
 * fold is trustworthy; deleting it would leave the empty set looking like a default rather than a
 * conclusion.
 *
 * COMPLETED_READ_SOURCE — was: the authoritative record stamps `completedMs` with `Date.now()` while
 *   the event carried a separately sampled ISO instant, so the projected value could never be
 *   byte-identical to the stored one. RESOLVED in code: #TransitionReminderState now samples the
 *   instant once and threads it to both the CompletionRecord and the event, and the fold reproduces
 *   it verbatim. FindMissingTransitionFields rejects a stream that lacks it, so a pre-v2 stream
 *   falls back instead of serving a re-derived number. Still blocked pending real-data parity.
 *
 * REBALANCE_EXPORT_SOURCE — was: rescheduling resets IgnoreSnooze in the live queue but
 *   ReminderScheduled persisted only dueAt/via, so the fold kept a stale value the export then
 *   published (src/web-api.js:459-466). RESOLVED in code: v2 ReminderScheduled carries ignoreSnooze,
 *   the fold replays it, and the strict gate rejects a ReminderScheduled without it. Still blocked
 *   pending real-data parity.
 *
 * REMINDERS_READ_SOURCE — UNCHANGED by the schema work, and it is important not to imply otherwise.
 *   A torn append leaves a valid-but-SHORT ledger: #EmitLifecycleEvent is fire-and-forget and
 *   tolerates `{ ok:false }`, so a lone creation event passes every field check while its missing
 *   paired ReminderScheduled leaves ShouldPostOn null, and the queue would be replaced by a partial
 *   projection. No field can detect an event that was never written — this needs a durable
 *   per-workspace JSON-vs-fold coverage checkpoint.
 *
 * Remove an entry ONLY together with the schema work that makes its fold lossless, and with a test
 * proving parity on real data.
 */
const BLOCKED_PROJECTION_FLAGS = new Set([
  // EMPTY as of 2026-08-08. Each entry above has been retired together with the work that made its
  // fold lossless, which is the condition this list documented for removal.
  //
  // The blocklist was a BLUNT instrument: a global, compile-time "no", because there was no runtime
  // way to tell a workspace whose ledger can reproduce its JSON store from one whose cannot. There
  // is now. `IsCoverageCleanAsync` is default-deny and wired at all three read sites, so a
  // workspace serves a projection only while a parity run has recorded a `verified` marker for it —
  // written by `projection-parity-harness --record-coverage`, cleared by any failed append, and
  // never restored by a restart or by time passing.
  //
  // That is strictly stronger than this list was. The list said "no flag may ever serve"; the gate
  // says "this workspace may serve, right now, because its fold was proven against its own data and
  // nothing has happened since." Re-adding a flag here is still the correct emergency stop if a
  // fold is found lossy in a way per-workspace evidence cannot detect.
]);

class ProjectionParityError extends Error {
  /**
   * @param {string[]} ArgMissingFields
   */
  constructor(ArgMissingFields) {
    super(`event stream cannot reproduce authoritative reminder fields: ${ArgMissingFields.join(', ')}`);
    this.name = 'ProjectionParityError';
    this.missingFields = ArgMissingFields;
  }
}

/**
 * @param {any} ArgValue
 * @returns {string|null}
 */
function GetStringOrNull(ArgValue) {
  return typeof ArgValue === 'string' && ArgValue.length > 0 ? ArgValue : null;
}

/**
 * @param {any} ArgValue
 * @returns {string[]}
 */
function GetStrings(ArgValue) {
  if(!Array.isArray(ArgValue)) return [];
  return ArgValue.filter(ArgItem => typeof ArgItem === 'string');
}

/**
 * Return the pre-existing default when a legacy record has no explicit state.
 * @param {any} ArgState
 * @returns {string}
 */
function NormalizeState(ArgState) {
  return GetStringOrNull(ArgState) || 'scheduled';
}

/**
 * The exact reminder fields that a native ReminderCreated event does not carry.
 * BaselineReminderImported was designed to carry these fields, so a baseline-only
 * stream can be projected losslessly while a native stream currently cannot.
 * @param {object} ArgPayload
 * @returns {string[]}
 */
function FindMissingNativeReminderFields(ArgPayload) {
  const Payload = ArgPayload && typeof ArgPayload === 'object' ? ArgPayload : {};
  const Fields = [
    // Event.ts is assigned when the best-effort append runs, not when the
    // ReminderInfo was created. Substituting it changes raw JSON bytes.
    ['CreatedOn', 'createdOn'],
    ['OriginalSenderID', 'originalSenderId'],
    ['OriginalMessageID', 'originalMessageId'],
    ['OriginalThreadTs', 'originalThreadTs'],
    ['OriginalChannelName', 'originalChannelName'],
    ['IgnoreSnooze', 'ignoreSnooze'],
  ];
  return Fields
    .filter(([, PayloadKey]) => !Object.prototype.hasOwnProperty.call(Payload, PayloadKey))
    .map(([ReminderField]) => ReminderField);
}

/**
 * Relay-state fields required from ANY reminder-producing event, native or baseline.
 *
 * Kept separate from FindMissingNativeReminderFields on purpose. That check runs only for
 * `ReminderCreated`, which is correct for fields a baseline import genuinely supplies — but these
 * two are supplied by NEITHER. `scripts/baseline-import.js` does not emit them, and after GH-355
 * production's stream is largely `BaselineReminderImported`, so checking only the native path would
 * let the exact real-world stream pass strict parity and serve a lossy fold.
 *
 * Why it matters behaviourally rather than cosmetically: `github-comment-relay.js:102` refuses to
 * relay when `GitHubRelayStopped` is set. A flag-on read from a stream lacking it would RESUME a
 * relay a user deliberately stopped, and treat an already-started relay as first-use. The fold
 * cannot restore what was never evented, so strict parity must reject and fall back.
 *
 * Self-healing: the moment the schema expansion emits these, the check passes and the projection
 * becomes eligible without further code change.
 * @param {any} ArgPayload
 * @returns {string[]}
 */
function FindMissingRelayStateFields(ArgPayload) {
  const Payload = ArgPayload && typeof ArgPayload === 'object' ? ArgPayload : {};
  // SCOPED to reminders that can actually relay. github-comment-relay only ever consults these
  // flags for a reminder carrying GitHub URLs, so demanding them everywhere would reject streams
  // that are provably lossless — an over-broad check is its own kind of wrong, and this one
  // initially failed three unrelated suites before being narrowed.
  const CanRelay = Array.isArray(Payload.githubUrls) && Payload.githubUrls.length > 0;
  if(!CanRelay) return [];
  const Fields = [
    ['GitHubRelayStarted', 'gitHubRelayStarted'],
    ['GitHubRelayStopped', 'gitHubRelayStopped'],
  ];
  return Fields
    .filter(([, PayloadKey]) => !Object.prototype.hasOwnProperty.call(Payload, PayloadKey))
    .map(([ReminderField]) => ReminderField);
}

/**
 * Fields a NON-creation event must carry for its own fold to be lossless.
 *
 * These are separate from the creation checks because they are properties of the transition, not of
 * the reminder — and a stream can be perfectly complete at creation and still be unprojectable
 * because of what a later event dropped.
 *
 * ReminderScheduled.ignoreSnooze — the live queue RESETS IgnoreSnooze when it reschedules
 *   (src/reminders-module.js:3455-3458). A ReminderScheduled without it leaves the fold holding the
 *   creation-time value, which the rebalance export then publishes to an external consumer.
 *
 * ReminderCompleted.completedMs — the authoritative CompletionRecord stamps its own `Date.now()`.
 *   Re-parsing the event's ISO instant yields a different number, so a completed-history read served
 *   from a stream lacking this can never be byte-identical to the store it replaces.
 *
 * Both are self-healing: a v2 stream carries them, so this returns nothing and the gate opens on its
 * own. A v1 stream is rejected and falls back, which is the correct outcome, not a failure.
 * @param {string} ArgType
 * @param {any} ArgPayload
 * @returns {string[]}
 */
function FindMissingTransitionFields(ArgType, ArgPayload) {
  const Payload = ArgPayload && typeof ArgPayload === 'object' ? ArgPayload : {};
  const Has = (/** @type {string} */ ArgKey) => Object.prototype.hasOwnProperty.call(Payload, ArgKey);
  if(ArgType === 'ReminderScheduled') return Has('ignoreSnooze') ? [] : ['IgnoreSnooze'];
  if(ArgType === 'ReminderCompleted') return Has('completedMs') ? [] : ['completedMs'];
  return [];
}

/**
 * Fill gaps in an already-folded reminder from a LATER creation-shaped event.
 *
 * This is what makes backfill possible at all. `scripts/baseline-import.js --enrich` re-emits a
 * BaselineReminderImported for a reminder whose original event predates the v2 schema; without a
 * merge rule the fold's first-creation-wins branch would ignore it, and the record could never be
 * upgraded — the structural reason Codex gave for the importer being unable to fix the streams that
 * need fixing.
 *
 * FILL-ONLY, and never `State`: the earlier event established identity, later lifecycle events own
 * the state machine, and this only supplies what neither of them could. `IgnoreSnooze` and the relay
 * flags are the exceptions that assign outright, because they are booleans whose absence is
 * indistinguishable from `false` — and the enrich event is by construction a newer snapshot of the
 * authoritative record, appended after every historical event.
 * @param {ProjectedReminder} ArgReminder
 * @param {any} ArgPayload
 */
function ApplyCreationEnrichment(ArgReminder, ArgPayload) {
  const Payload = ArgPayload && typeof ArgPayload === 'object' ? ArgPayload : {};
  const Has = (/** @type {string} */ ArgKey) => Object.prototype.hasOwnProperty.call(Payload, ArgKey);

  /** @type {[keyof ProjectedReminder, string][]} */
  const StringFields = [
    ['CreatedOn', 'createdOn'],
    ['ShouldPostOn', 'dueAt'],
    ['OriginalSenderID', 'originalSenderId'],
    ['OriginalMessageID', 'originalMessageId'],
    ['OriginalThreadTs', 'originalThreadTs'],
    ['OriginalChannelName', 'originalChannelName'],
    ['OriginalChannelID', 'sourceChannelId'],
    ['TargetChannelID', 'targetChannelId'],
    ['AssigneeID', 'assigneeId'],
    ['clientId', 'clientId'],
    ['projectId', 'projectId'],
  ];
  for(const [Field, Key] of StringFields) {
    if(ArgReminder[Field] == null && Has(Key)) {
      // @ts-expect-error — indexed write into a typedef'd shape; every pair above is string-valued.
      ArgReminder[Field] = GetStringOrNull(Payload[Key]);
    }
  }

  if(!ArgReminder.ReminderMessageText && typeof Payload.text === 'string') {
    ArgReminder.ReminderMessageText = Payload.text;
  }
  if((!ArgReminder.AssigneeIDs || ArgReminder.AssigneeIDs.length === 0) && Has('assigneeIds')) {
    ArgReminder.AssigneeIDs = GetStrings(Payload.assigneeIds);
  }
  if((!ArgReminder.GitHubUrls || ArgReminder.GitHubUrls.length === 0) && Has('githubUrls')) {
    ArgReminder.GitHubUrls = GetStrings(Payload.githubUrls);
  }
  if(Has('ignoreSnooze')) ArgReminder.IgnoreSnooze = Boolean(Payload.ignoreSnooze);
  if(Has('gitHubRelayStarted')) ArgReminder.GitHubRelayStarted = Boolean(Payload.gitHubRelayStarted);
  if(Has('gitHubRelayStopped')) ArgReminder.GitHubRelayStopped = Boolean(Payload.gitHubRelayStopped);
}

/**
 * Project a field ONLY when the event actually recorded it.
 *
 * Applied to the relay flags alone, and deliberately NOT generalised. Extending this rule to
 * `clientId`/`projectId`/`AssigneeIDs`/`GitHubUrls` was tried and MEASURED against the real
 * production stream (23 reminders, 152 completions): it moved zero of the 128 key differences, and
 * against a pre-backfill store it introduced five new OMISSIONS — the strictly worse failure, since
 * an omission loses a field the store has while an extra key carries a fact the event recorded.
 *
 * The reason it cannot generalise is that the direction of staleness varies by field. For some the
 * event stream is ahead of the JSON store; for others the store is ahead of the stream. One
 * presence rule cannot be right for both, so key-presence is not the thing to normalise here — see
 * the exit-criterion note in PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md.
 * @param {Record<string, any>} ArgPayload
 * @param {string} ArgPayloadKey
 * @param {string} ArgField
 * @param {(ArgValue: any) => any} ArgMap
 * @returns {Record<string, any>}
 */
function WhenRecorded(ArgPayload, ArgPayloadKey, ArgField, ArgMap) {
  return Object.prototype.hasOwnProperty.call(ArgPayload, ArgPayloadKey)
    ? { [ArgField]: ArgMap(ArgPayload[ArgPayloadKey]) }
    : {};
}

/**
 * @param {string} ArgReminderId
 * @param {any} ArgEvent
 * @returns {ProjectedReminder}
 */
function MakeReminder(ArgReminderId, ArgEvent) {
  const Payload = ArgEvent.payload && typeof ArgEvent.payload === 'object' ? ArgEvent.payload : {};
  return {
    ReminderID: ArgReminderId,
    CreatedOn: GetStringOrNull(Payload.createdOn) || GetStringOrNull(ArgEvent.ts),
    ShouldPostOn: GetStringOrNull(Payload.dueAt),
    TargetChannelID: GetStringOrNull(Payload.targetChannelId),
    OriginalChannelID: GetStringOrNull(Payload.sourceChannelId),
    OriginalMessageID: GetStringOrNull(Payload.originalMessageId),
    OriginalThreadTs: GetStringOrNull(Payload.originalThreadTs),
    OriginalSenderID: GetStringOrNull(Payload.originalSenderId),
    OriginalChannelName: GetStringOrNull(Payload.originalChannelName),
    ReminderMessageText: typeof Payload.text === 'string' ? Payload.text : '',
    IgnoreSnooze: Boolean(Payload.ignoreSnooze),
    AssigneeID: GetStringOrNull(Payload.assigneeId),
    AssigneeIDs: GetStrings(Payload.assigneeIds),
    GitHubUrls: GetStrings(Payload.githubUrls),
    // Rehydrated, not merely validated. The strict check above requires these on a relay-capable
    // stream; projecting them is the other half — a gate that admits a field the fold then drops
    // would produce a reminder that passes parity and STILL resumes a stopped relay
    // (github-comment-relay.js:102 reads GitHubRelayStopped, :143 reads GitHubRelayStarted).
    ...WhenRecorded(Payload, 'gitHubRelayStarted', 'GitHubRelayStarted', Boolean),
    ...WhenRecorded(Payload, 'gitHubRelayStopped', 'GitHubRelayStopped', Boolean),
    clientId: GetStringOrNull(Payload.clientId),
    projectId: GetStringOrNull(Payload.projectId),
    State: NormalizeState(Payload.state),
  };
}

/**
 * Rebuild the two JSON read models from a workspace event stream.  The returned
 * records use the JSON stores' casing on purpose, so the parity harness can
 * compare them without a lossy translation layer.
 *
 * `strict` rejects a stream that cannot reproduce fields present in normal live
 * reminders.  This is the safety gate used by a flag-on read: it makes the
 * existing JSON fallback win rather than serving a subtly incomplete record.
 *
 * @param {any[]} ArgEvents
 * @param {{ strict?: boolean }} [ArgOptions]
 * @returns {{ reminders: ProjectedReminder[], completed: ProjectedCompletion[] }}
 */
function FoldReminderReadModels(ArgEvents, ArgOptions = {}) {
  const Events = Array.isArray(ArgEvents) ? ArgEvents : [];
  /** @type {Map<string, ProjectedReminder>} */
  const ById = new Map();
  /** @type {string[]} */
  const Order = [];
  /** @type {string[]} */
  const MissingFields = [];
  /**
   * Last relay state seen per thread. Applied AFTER the main loop, not during it, so a reminder
   * created later than the relay event still picks the state up — a reminder joining an
   * already-relaying thread is the exact case that motivated the thread-scoped design.
   * @type {Map<string, { relayStarted: boolean, relayStopped: boolean }>}
   */
  const ThreadRelayState = new Map();
  /**
   * Every creation-shaped payload seen per reminder, merged fill-first. Parity is judged against
   * this rather than against a single event, so an enrich event can genuinely repair a stream.
   * @type {Map<string, Record<string, any>>}
   */
  const CreationPayloads = new Map();
  /** Reminders whose FIRST creation event was native — only those face the native-field check. */
  const NativeCreations = new Set();

  for(const Event of Events) {
    if(!Event || typeof Event !== 'object' || Array.isArray(Event)) continue;
    const ReminderId = GetStringOrNull(Event.reminderId);
    if(ReminderId === null) continue;
    const Payload = Event.payload && typeof Event.payload === 'object' && !Array.isArray(Event.payload)
      ? Event.payload
      : {};

    // Dispatched BEFORE any id lookup: this event's `reminderId` is the synthetic `thread:<key>`,
    // so letting it fall through would either be ignored or, worse, manufacture a reminder.
    if(Event.type === 'ThreadRelayStateChanged') {
      const ThreadKey = GetStringOrNull(Payload.threadKey);
      if(ThreadKey !== null) {
        ThreadRelayState.set(ThreadKey, {
          relayStarted: Boolean(Payload.relayStarted),
          relayStopped: Boolean(Payload.relayStopped),
        });
      }
      continue;
    }

    if(Event.type === 'ReminderCreated' || Event.type === 'BaselineReminderImported') {
      // Accumulate what EVERY creation-shaped event for this reminder supplied, then judge parity
      // once at the end. Judging per-event would fail a stream that a later enrich event has already
      // repaired — the field really is present in the stream, just not in the first line of it.
      const Merged = CreationPayloads.get(ReminderId);
      if(Merged === undefined) {
        CreationPayloads.set(ReminderId, { ...Payload });
      } else {
        for(const Key of Object.keys(Payload)) {
          if(!Object.prototype.hasOwnProperty.call(Merged, Key)) Merged[Key] = Payload[Key];
        }
      }

      if(!ById.has(ReminderId)) {
        ById.set(ReminderId, MakeReminder(ReminderId, Event));
        Order.push(ReminderId);
        if(Event.type === 'ReminderCreated') NativeCreations.add(ReminderId);
      } else {
        // A repeat creation event is an ENRICHMENT, not a second reminder.
        ApplyCreationEnrichment(/** @type {ProjectedReminder} */ (ById.get(ReminderId)), Payload);
      }
      continue;
    }

    const Reminder = ById.get(ReminderId);
    if(!Reminder) continue; // no creation event means no safe reconstruction.

    for(const Field of FindMissingTransitionFields(Event.type, Payload)) {
      const Entry = `${ReminderId}.${Field}`;
      if(!MissingFields.includes(Entry)) MissingFields.push(Entry);
    }

    if(Event.type === 'ReminderScheduled') {
      Reminder.ShouldPostOn = GetStringOrNull(Payload.dueAt) || Reminder.ShouldPostOn;
      Reminder.State = 'scheduled';
      // v2: scheduling RESETS IgnoreSnooze in the live queue (src/reminders-module.js:3455-3458).
      // Without replaying it the fold keeps the stale creation-time value, and the rebalance export
      // then publishes that stale flag to an external consumer — the reason
      // REBALANCE_EXPORT_SOURCE was blocked. v1 events omit the key and keep today's behaviour.
      if(Object.prototype.hasOwnProperty.call(Payload, 'ignoreSnooze')) {
        Reminder.IgnoreSnooze = Boolean(Payload.ignoreSnooze);
      }
    } else if(Event.type === 'ReminderSnoozed') {
      Reminder.ShouldPostOn = GetStringOrNull(Payload.until) || Reminder.ShouldPostOn;
      Reminder.State = 'snoozed';
    } else if(Event.type === 'ReminderCompleted') {
      Reminder.State = 'completed';
      Reminder.completedAt = GetStringOrNull(Payload.completedAt) || GetStringOrNull(Event.ts);
      Reminder.completedBy = GetStringOrNull(Payload.by);
      Reminder.completionMethod = GetStringOrNull(Payload.method);
      Reminder.completionSummary = GetStringOrNull(Payload.summary);
      // v2 carries the AUTHORITATIVE completedMs — the same number the CompletionRecord stored,
      // not a second clock read. Where it is present the projection reproduces that value exactly;
      // v1 events fall back to re-parsing the ISO instant below, which is why COMPLETED_READ_SOURCE
      // needed the schema change and not merely a stricter check.
      Reminder.completedMs = typeof Payload.completedMs === 'number' && Number.isFinite(Payload.completedMs)
        ? Payload.completedMs
        : null;
      // v2 also carries these verbatim rather than leaving the fold to re-derive them from whichever
      // channel field happened to survive.
      if(Object.prototype.hasOwnProperty.call(Payload, 'sourceChannelId'))
        Reminder.completionSourceChannelID = GetStringOrNull(Payload.sourceChannelId);
      if(Object.prototype.hasOwnProperty.call(Payload, 'dueDate'))
        Reminder.completionDueDate = GetStringOrNull(Payload.dueDate);
      if(Object.prototype.hasOwnProperty.call(Payload, 'clientId'))
        Reminder.completionClientId = GetStringOrNull(Payload.clientId);
    } else if(Event.type === 'ReminderCancelled') {
      Reminder.State = 'canceled';
    } else if(Event.type === 'ReminderRemoved') {
      // Removal is not a state — it is "this reminder is no longer in the queue". Recorded on the
      // record rather than as a State, so a reminder removed AFTER completion still yields its
      // completion record below; only the active list drops it.
      Reminder.Removed = true;
    } else if(Event.type === 'ReminderStateChanged') {
      // v2 generic transition. Emitted for EVERY state change, including the seven the specific
      // events skip, so a reminder that went overdue no longer folds back as `scheduled`. It is
      // emitted in ADDITION to a specific event, and always after it, so for the four mapped states
      // this simply re-asserts the same value.
      const ToState = GetStringOrNull(Payload.toState);
      if(ToState !== null && PROJECTABLE_STATES.has(ToState)) Reminder.State = ToState;
    }
  }

  // Relay state is thread-scoped: apply each thread's last known state to every reminder that
  // belongs to it, whenever that reminder was created. Thread identity is GH-27's
  // `OriginalThreadTs ?? OriginalMessageID` — the same key github-comment-relay.js matches on.
  if(ThreadRelayState.size > 0) {
    for(const Reminder of ById.values()) {
      const ThreadKey = Reminder.OriginalThreadTs || Reminder.OriginalMessageID;
      if(!ThreadKey) continue;
      const State = ThreadRelayState.get(ThreadKey);
      if(!State) continue;
      // MONOTONIC LATCH, mirroring the only authoritative writers: github-comment-relay.js:137 and
      // :213 assign `true` and nothing anywhere assigns `false`, so an explicit `false` is a shape
      // the JSON store cannot produce. This assignment may therefore RAISE a flag, and may overwrite
      // one the reminder already carries, but must not introduce a lowered flag onto a record that
      // never had the key.
      //
      // Unlike the fields above, absence here is inert — no load-time backfill keys on it, and every
      // consumer reads these by truthiness (github-comment-relay.js:129/178/210). So the reason to
      // omit is parity, not data loss, and this line was the source of ALL 22 GitHubRelayStarted and
      // 23 GitHubRelayStopped invented keys in the production diff: MakeReminder was already
      // conditional, and only this ran unconditionally.
      if(State.relayStarted || Reminder.GitHubRelayStarted !== undefined)
        Reminder.GitHubRelayStarted = State.relayStarted;
      if(State.relayStopped || Reminder.GitHubRelayStopped !== undefined)
        Reminder.GitHubRelayStopped = State.relayStopped;
    }
  }

  // Parity is judged on the MERGED creation payload, once per reminder, after the whole stream has
  // been read.
  for(const ReminderId of Order) {
    const Merged = CreationPayloads.get(ReminderId) || {};
    const Missing = NativeCreations.has(ReminderId)
      ? FindMissingNativeReminderFields(Merged).concat(FindMissingRelayStateFields(Merged))
      // The relay check applies to BOTH event kinds: baseline-import predating the schema expansion
      // did not emit the flags either, and production's stream is largely BaselineReminderImported
      // after GH-355 — so checking only the native path would exempt the stream that matters.
      : FindMissingRelayStateFields(Merged);
    for(const Field of Missing) {
      const Entry = `${ReminderId}.${Field}`;
      if(!MissingFields.includes(Entry)) MissingFields.push(Entry);
    }
  }

  if(ArgOptions.strict === true && MissingFields.length > 0) {
    throw new ProjectionParityError(MissingFields);
  }

  const Reminders = [];
  const Completed = [];
  for(const ReminderId of Order) {
    const Reminder = ById.get(ReminderId);
    if(!Reminder) continue;
    if(Reminder.State === 'completed') {
      // Prefer the authoritative number the v2 event carried; re-parsing the ISO instant is the v1
      // fallback and loses sub-second identity with the stored CompletionRecord.
      const CompletedMs = typeof Reminder.completedMs === 'number'
        ? Reminder.completedMs
        : Date.parse(Reminder.completedAt || '');
      if(Number.isFinite(CompletedMs)) {
        Completed.push({
          reminderId: Reminder.ReminderID,
          summary: Reminder.completionSummary || Reminder.ReminderMessageText || null,
          assigneeID: Reminder.AssigneeID || null,
          // v2 carries what the completion actually recorded; the `||` chains are the v1 re-derivation.
          sourceChannelID: Reminder.completionSourceChannelID !== undefined
            ? Reminder.completionSourceChannelID
            : (Reminder.OriginalChannelID || Reminder.TargetChannelID || null),
          dueDate: Reminder.completionDueDate !== undefined
            ? Reminder.completionDueDate
            : (Reminder.ShouldPostOn || null),
          completedMs: CompletedMs,
          clientId: Reminder.completionClientId !== undefined
            ? Reminder.completionClientId
            : (Reminder.clientId || null),
        });
      }
      continue;
    }
    if(Reminder.Removed === true) continue; // dropped from the queue; never resurrect it.
    if(!TERMINAL_STATES.has(Reminder.State)) Reminders.push(Reminder);
  }

  return { reminders: Reminders, completed: Completed };
}

/**
 * Shape folded reminder records into the non-display portion of the rebalance
 * export.  A caller that needs byte parity must add the Web API's Slack-derived
 * display fields; this pure shape intentionally exposes that gap to the harness.
 * @param {ProjectedReminder[]} ArgReminders
 * @param {string} ArgWorkspaceName
 * @returns {object}
 */
function BuildProjectedRebalanceExport(ArgReminders, ArgWorkspaceName) {
  const Reminders = Array.isArray(ArgReminders) ? ArgReminders : [];
  return {
    workspaceName: ArgWorkspaceName,
    totalReminderCount: Reminders.length,
    returnedReminderCount: Reminders.length,
    filters: { activeOnly: false, states: [] },
    source: {
      type: 'sleuth-events-projection',
      relativePath: null,
    },
    reminders: Reminders.map(ArgReminder => ({
      reminderId: ArgReminder.ReminderID || null,
      state: NormalizeState(ArgReminder.State),
      isActive: !TERMINAL_STATES.has(NormalizeState(ArgReminder.State)),
      createdOn: ArgReminder.CreatedOn || null,
      shouldPostOn: ArgReminder.ShouldPostOn || null,
      reminderMessageText: ArgReminder.ReminderMessageText || '',
      ignoreSnooze: Boolean(ArgReminder.IgnoreSnooze),
      assigneeId: ArgReminder.AssigneeID || null,
      // Must mirror web-api.js's rebalance shape exactly — a field present in one and absent in the
      // other is a guaranteed parity diff the moment REBALANCE_EXPORT_SOURCE is considered.
      assigneeIds: GetStrings(ArgReminder.AssigneeIDs).length > 0
        ? GetStrings(ArgReminder.AssigneeIDs)
        : (ArgReminder.AssigneeID ? [ArgReminder.AssigneeID] : []),
      originalSenderId: ArgReminder.OriginalSenderID || null,
      targetChannelId: ArgReminder.TargetChannelID || null,
      originalChannelId: ArgReminder.OriginalChannelID || null,
      originalChannelName: ArgReminder.OriginalChannelName || null,
      originalMessageId: ArgReminder.OriginalMessageID || null,
      originalThreadTs: ArgReminder.OriginalThreadTs || null,
      githubUrls: GetStrings(ArgReminder.GitHubUrls),
      clientId: ArgReminder.clientId || null,
    })),
  };
}

/**
 * Choose one read surface independently.  Projection failures are intentionally
 * caught here so each flag remains reversible and falls back to its authoritative
 * JSON store without coupling the three surfaces.
 * @param {{ flagName: string, environment?: Record<string, string|undefined>, ReadAuthoritativeAsync: () => Promise<any>, ReadProjectionAsync: () => Promise<any>, Logger?: { warn?: (...args: any[]) => void }, IsCoverageCleanAsync?: () => Promise<boolean> }} ArgOptions
 * @returns {Promise<{ value: any, source: 'authoritative'|'projection', fallbackError?: Error }>}
 */
async function ReadWithProjectionFallbackAsync(ArgOptions) {
  if(!PROJECTION_FLAGS.has(ArgOptions.flagName)) {
    throw new Error(`unknown projection flag: ${ArgOptions.flagName}`);
  }
  const Environment = ArgOptions.environment || process.env;
  const WantsProjection = String(Environment[ArgOptions.flagName] || '').trim().toLowerCase() === 'projection';
  if(WantsProjection && BLOCKED_PROJECTION_FLAGS.has(ArgOptions.flagName)) {
    // Loud, not silent: an operator who sets a blocked flag has asked for the projection and is
    // getting the authoritative store instead. Failing quietly here would look like the cutover
    // working when it is deliberately inert.
    ArgOptions.Logger?.warn?.(
      `[reminders-projection] ${ArgOptions.flagName} is set to 'projection' but is BLOCKED — its fold is known-lossy. Serving the authoritative store.`
    );
    return { value: await ArgOptions.ReadAuthoritativeAsync(), source: 'authoritative' };
  }
  if(!WantsProjection) {
    return { value: await ArgOptions.ReadAuthoritativeAsync(), source: 'authoritative' };
  }
  // Coverage gate (P3 Phase C). Field checks prove the events PRESENT are complete; this proves no
  // event is MISSING. They are independent failures and both must pass — a torn append leaves a
  // stream every payload check accepts.
  //
  // DEFAULT-DENY. This used to run only `if(typeof ArgOptions.IsCoverageCleanAsync === 'function')`,
  // so a caller that supplied no gate skipped the check and was served the projection. Every
  // production call site supplied none, which meant the gate recorded coverage that nothing read
  // and the whole mechanism was inert — `ledger-coverage.js` defaults to unclean, and this call
  // site defaulted to permissive, cancelling it out. An unverified caller is exactly the caller
  // that must not be served, so the absent callback is now a denial rather than a bypass.
  if(typeof ArgOptions.IsCoverageCleanAsync !== 'function') {
    ArgOptions.Logger?.warn?.(
      `[reminders-projection] ${ArgOptions.flagName} requested, but this call site supplies no coverage gate. Serving the authoritative store.`
    );
    return { value: await ArgOptions.ReadAuthoritativeAsync(), source: 'authoritative' };
  }
  let Clean;
  try {
    Clean = await ArgOptions.IsCoverageCleanAsync();
  } catch(error) {
    // A gate that cannot answer has not said "clean". Treating a thrown gate as a pass would make
    // the strictest path the easiest one to disable.
    ArgOptions.Logger?.warn?.(
      `[reminders-projection] ${ArgOptions.flagName} coverage gate failed to evaluate; serving the authoritative store.`, error
    );
    return { value: await ArgOptions.ReadAuthoritativeAsync(), source: 'authoritative' };
  }
  if(Clean !== true) {
    ArgOptions.Logger?.warn?.(
      `[reminders-projection] ${ArgOptions.flagName} requested, but the ledger has no clean coverage record. Serving the authoritative store.`
    );
    return { value: await ArgOptions.ReadAuthoritativeAsync(), source: 'authoritative' };
  }
  try {
    return { value: await ArgOptions.ReadProjectionAsync(), source: 'projection' };
  } catch(error) {
    const ErrorValue = error instanceof Error ? error : new Error(String(error));
    ArgOptions.Logger?.warn?.(`[reminders-projection] ${ArgOptions.flagName} failed; using authoritative JSON fallback.`, ErrorValue);
    return {
      value: await ArgOptions.ReadAuthoritativeAsync(),
      source: 'authoritative',
      fallbackError: ErrorValue,
    };
  }
}

module.exports = {
  BLOCKED_PROJECTION_FLAGS,
  BuildProjectedRebalanceExport,
  FindMissingRelayStateFields,
  FindMissingNativeReminderFields,
  FindMissingTransitionFields,
  FoldReminderReadModels,
  ProjectionParityError,
  ReadWithProjectionFallbackAsync,
};
