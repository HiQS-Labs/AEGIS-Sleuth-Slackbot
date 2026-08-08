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
 * @property {string|null} [completedAt]
 * @property {string|null} [completedBy]
 * @property {string|null} [completionMethod]
 * @property {string|null} [completionSummary]
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
const PROJECTION_FLAGS = new Set([
  'REMINDERS_READ_SOURCE',
  'COMPLETED_READ_SOURCE',
  'REBALANCE_EXPORT_SOURCE',
]);

/**
 * Flags that are RECOGNISED but must never select the projection, because their fold is known-lossy
 * in a way strict field-presence cannot detect. Kept in PROJECTION_FLAGS so call sites stay valid
 * and the authoritative read still works — this forces the fallback rather than throwing.
 *
 * COMPLETED_READ_SOURCE: the authoritative record stamps `completedMs` with `Date.now()`
 * (src/reminders-module.js:569-576), while the event carries a separately sampled ISO instant
 * (src/reminders-module.js:496-502) that the fold re-parses (this file, ~line 197+). The two
 * timestamps are taken at different moments, so the projected value can never be byte-identical to
 * the stored one. That is a design mismatch, not a missing field, so no strict check can rescue it —
 * it needs a schema change that carries the authoritative completedMs verbatim.
 *
 * Remove an entry ONLY together with the schema work that makes its fold lossless, and with a test
 * proving parity on real data.
 */
const BLOCKED_PROJECTION_FLAGS = new Set([
  'COMPLETED_READ_SOURCE',
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

  for(const Event of Events) {
    if(!Event || typeof Event !== 'object' || Array.isArray(Event)) continue;
    const ReminderId = GetStringOrNull(Event.reminderId);
    if(ReminderId === null) continue;
    const Payload = Event.payload && typeof Event.payload === 'object' && !Array.isArray(Event.payload)
      ? Event.payload
      : {};

    if(Event.type === 'ReminderCreated' || Event.type === 'BaselineReminderImported') {
      if(!ById.has(ReminderId)) {
        ById.set(ReminderId, MakeReminder(ReminderId, Event));
        Order.push(ReminderId);
      }
      if(Event.type === 'ReminderCreated') {
        for(const Field of FindMissingNativeReminderFields(Payload)) {
          const Missing = `${ReminderId}.${Field}`;
          if(!MissingFields.includes(Missing)) MissingFields.push(Missing);
        }
      }
      // Applied to BOTH event types, unlike the check above: baseline-import.js does not emit the
      // relay flags either, and production's stream is largely BaselineReminderImported after
      // GH-355 — so gating this on ReminderCreated alone would exempt the one stream that matters.
      for(const Field of FindMissingRelayStateFields(Payload)) {
        const Missing = `${ReminderId}.${Field}`;
        if(!MissingFields.includes(Missing)) MissingFields.push(Missing);
      }
      continue;
    }

    const Reminder = ById.get(ReminderId);
    if(!Reminder) continue; // no creation event means no safe reconstruction.

    if(Event.type === 'ReminderScheduled') {
      Reminder.ShouldPostOn = GetStringOrNull(Payload.dueAt) || Reminder.ShouldPostOn;
      Reminder.State = 'scheduled';
    } else if(Event.type === 'ReminderSnoozed') {
      Reminder.ShouldPostOn = GetStringOrNull(Payload.until) || Reminder.ShouldPostOn;
      Reminder.State = 'snoozed';
    } else if(Event.type === 'ReminderCompleted') {
      Reminder.State = 'completed';
      Reminder.completedAt = GetStringOrNull(Payload.completedAt) || GetStringOrNull(Event.ts);
      Reminder.completedBy = GetStringOrNull(Payload.by);
      Reminder.completionMethod = GetStringOrNull(Payload.method);
      Reminder.completionSummary = GetStringOrNull(Payload.summary);
    } else if(Event.type === 'ReminderCancelled') {
      Reminder.State = 'canceled';
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
      const CompletedMs = Date.parse(Reminder.completedAt || '');
      if(Number.isFinite(CompletedMs)) {
        Completed.push({
          reminderId: Reminder.ReminderID,
          summary: Reminder.completionSummary || Reminder.ReminderMessageText || null,
          assigneeID: Reminder.AssigneeID || null,
          sourceChannelID: Reminder.OriginalChannelID || Reminder.TargetChannelID || null,
          dueDate: Reminder.ShouldPostOn || null,
          completedMs: CompletedMs,
          clientId: Reminder.clientId || null,
        });
      }
      continue;
    }
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
 * @param {{ flagName: string, environment?: Record<string, string|undefined>, ReadAuthoritativeAsync: () => Promise<any>, ReadProjectionAsync: () => Promise<any>, Logger?: { warn?: (...args: any[]) => void } }} ArgOptions
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
  FoldReminderReadModels,
  ProjectionParityError,
  ReadWithProjectionFallbackAsync,
};
