'use strict';

// Read-side projection helpers for the Ledger migration.  This module is deliberately
// non-authoritative: callers keep the JSON store as their fallback until a parity run
// proves that a particular surface is safe to switch.

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'canceled']);
const PROJECTION_FLAGS = new Set([
  'REMINDERS_READ_SOURCE',
  'COMPLETED_READ_SOURCE',
  'REBALANCE_EXPORT_SOURCE',
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
 * @param {string} ArgReminderId
 * @param {any} ArgEvent
 * @returns {object}
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
 * @returns {{ reminders: object[], completed: object[] }}
 */
function FoldReminderReadModels(ArgEvents, ArgOptions = {}) {
  const Events = Array.isArray(ArgEvents) ? ArgEvents : [];
  /** @type {Map<string, object>} */
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
 * @param {object[]} ArgReminders
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
  BuildProjectedRebalanceExport,
  FindMissingNativeReminderFields,
  FoldReminderReadModels,
  ProjectionParityError,
  ReadWithProjectionFallbackAsync,
};
