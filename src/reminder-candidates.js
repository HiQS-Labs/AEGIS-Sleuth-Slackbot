'use strict';

/**
 * @typedef {Object} ReminderCandidate
 * @property {string} id
 * @property {string} text
 * @property {string|null} assigneeId
 * @property {string|null} senderId
 * @property {string|null} clientId
 * @property {string|null} channelId
 * @property {boolean} channelIsPrivate
 * @property {number} timestampMs
 * @property {string} state
 * @property {boolean} isCompleted
 */

/**
 * @typedef {Object} ReminderInfoShape
 * @property {string} [ReminderID]
 * @property {string|null} [ReminderMessageText]
 * @property {string|null} [AssigneeID]
 * @property {string|null} [OriginalSenderID]
 * @property {string|null} [clientId]
 * @property {string|null} [OriginalChannelID]
 * @property {string|null} [TargetChannelID]
 * @property {Date|string|null} [CreatedOn]
 * @property {string|null} [State]
 */

/**
 * @typedef {Object} CompletionRecordShape
 * @property {string} [reminderId]
 * @property {string|null} [summary]
 * @property {string|null} [assigneeID]
 * @property {string|null} [sourceChannelID]
 * @property {number} [completedMs]
 * @property {string|null} [clientId]
 */

/**
 * Normalize live reminders + completion history into the deterministic ReminderCandidate shape
 * consumed by reminder-query-engine. Completed records overwrite active reminders with the same id
 * because completion is the terminal fact.
 *
 * @param {{
 *   activeReminders?: ReminderInfoShape[]|null,
 *   completedReminders?: CompletionRecordShape[]|null,
 *   isChannelPrivate?: ((ArgChannelId: string|null) => boolean)|null,
 * }} ArgParams
 * @returns {ReminderCandidate[]}
 */
function AssembleCandidates(ArgParams) {
  const ActiveReminders = Array.isArray(ArgParams?.activeReminders) ? ArgParams.activeReminders : [];
  const CompletedReminders = Array.isArray(ArgParams?.completedReminders) ? ArgParams.completedReminders : [];
  const IsChannelPrivate = typeof ArgParams?.isChannelPrivate === 'function'
    ? ArgParams.isChannelPrivate
    : null;

  /** @type {Map<string, ReminderCandidate>} */
  const CandidatesById = new Map();

  for(const Reminder of ActiveReminders) {
    const Candidate = NormalizeActiveReminder(Reminder, IsChannelPrivate);
    if(Candidate) CandidatesById.set(Candidate.id, Candidate);
  }

  for(const CompletionRecord of CompletedReminders) {
    const Candidate = NormalizeCompletedReminder(CompletionRecord, IsChannelPrivate);
    if(Candidate) CandidatesById.set(Candidate.id, Candidate);
  }

  return Array.from(CandidatesById.values());
}

/**
 * @param {ReminderInfoShape} ArgReminder
 * @param {((ArgChannelId: string|null) => boolean)|null} ArgIsChannelPrivate
 * @returns {ReminderCandidate|null}
 */
function NormalizeActiveReminder(ArgReminder, ArgIsChannelPrivate) {
  const Id = typeof ArgReminder?.ReminderID === 'string' ? ArgReminder.ReminderID : '';
  if(!IsUsableId(Id)) return null;

  const ChannelId = FirstNonEmptyString(ArgReminder?.OriginalChannelID, ArgReminder?.TargetChannelID);
  return {
    id: Id,
    text: typeof ArgReminder?.ReminderMessageText === 'string' ? ArgReminder.ReminderMessageText : '',
    assigneeId: NormalizeNullableString(ArgReminder?.AssigneeID),
    senderId: NormalizeNullableString(ArgReminder?.OriginalSenderID),
    clientId: NormalizeNullableString(ArgReminder?.clientId),
    channelId: ChannelId,
    channelIsPrivate: ResolveChannelPrivacy(ChannelId, ArgIsChannelPrivate),
    timestampMs: ParseTimestampMs(ArgReminder?.CreatedOn),
    state: typeof ArgReminder?.State === 'string' ? ArgReminder.State : '',
    isCompleted: false,
  };
}

/**
 * @param {CompletionRecordShape} ArgCompletionRecord
 * @param {((ArgChannelId: string|null) => boolean)|null} ArgIsChannelPrivate
 * @returns {ReminderCandidate|null}
 */
function NormalizeCompletedReminder(ArgCompletionRecord, ArgIsChannelPrivate) {
  const Id = typeof ArgCompletionRecord?.reminderId === 'string' ? ArgCompletionRecord.reminderId : '';
  if(!IsUsableId(Id)) return null;

  const ChannelId = NormalizeNullableString(ArgCompletionRecord?.sourceChannelID);
  return {
    id: Id,
    text: typeof ArgCompletionRecord?.summary === 'string' ? ArgCompletionRecord.summary : '',
    assigneeId: NormalizeNullableString(ArgCompletionRecord?.assigneeID),
    senderId: null,
    clientId: NormalizeNullableString(ArgCompletionRecord?.clientId),
    channelId: ChannelId,
    channelIsPrivate: ResolveChannelPrivacy(ChannelId, ArgIsChannelPrivate),
    timestampMs: typeof ArgCompletionRecord?.completedMs === 'number'
      ? ArgCompletionRecord.completedMs
      : Number.NaN,
    state: 'completed',
    isCompleted: true,
  };
}

/**
 * @param {string|null} ArgChannelId
 * @param {((ArgChannelId: string|null) => boolean)|null} ArgIsChannelPrivate
 * @returns {boolean}
 */
function ResolveChannelPrivacy(ArgChannelId, ArgIsChannelPrivate) {
  if(typeof ArgIsChannelPrivate !== 'function') return false;
  if(!ArgChannelId) return false;
  return !!ArgIsChannelPrivate(ArgChannelId);
}

/**
 * @param {Date|string|null|undefined} ArgCreatedOn
 * @returns {number}
 */
function ParseTimestampMs(ArgCreatedOn) {
  if(ArgCreatedOn instanceof Date) return Date.parse(ArgCreatedOn.toISOString());
  if(typeof ArgCreatedOn === 'string') return Date.parse(ArgCreatedOn);
  return Number.NaN;
}

/**
 * @param {string} ArgId
 * @returns {boolean}
 */
function IsUsableId(ArgId) {
  return typeof ArgId === 'string' && ArgId.trim().length > 0;
}

/**
 * @param {...(string|null|undefined)} ArgValues
 * @returns {string|null}
 */
function FirstNonEmptyString(...ArgValues) {
  for(const Value of ArgValues) {
    if(typeof Value === 'string' && Value.length > 0) return Value;
  }
  return null;
}

/**
 * @param {string|null|undefined} ArgValue
 * @returns {string|null}
 */
function NormalizeNullableString(ArgValue) {
  return typeof ArgValue === 'string' && ArgValue.length > 0 ? ArgValue : null;
}

module.exports = {
  AssembleCandidates,
};
