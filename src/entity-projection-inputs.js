'use strict';

const SlackFormatUtils = require('./slack-format-utils');

/**
 * @typedef {Object} EntityProjectionInput
 * @property {string|null} workspace
 * @property {string} reminderId
 * @property {string} normalizedText
 * @property {string[]} assigneeIds
 * @property {string|null} originalSenderId
 * @property {string|null} sourceChannelId
 * @property {string|null} targetChannelId
 * @property {string|null} createdAt
 * @property {string|null} completedAt
 * @property {string[]} githubUrls
 * @property {string[]} githubRepositoryIds
 * @property {string|null} sourceEventId
 * @property {'ReminderCreated'|'BaselineReminderImported'} sourceEventType
 */

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
function GetUniqueStrings(ArgValue) {
  if(!Array.isArray(ArgValue)) return [];

  /** @type {string[]} */
  const Values = [];
  for(const Value of ArgValue) {
    const StringValue = GetStringOrNull(Value);
    if(StringValue !== null && !Values.includes(StringValue)) {
      Values.push(StringValue);
    }
  }
  return Values;
}

/**
 * Normalize task text for deterministic candidate comparison. Mention matching
 * is deliberately delegated to SlackFormatUtils so this projection shares the
 * application's canonical Slack mrkdwn grammar.
 *
 * @param {any} ArgText
 * @returns {string}
 */
function NormalizeReminderText(ArgText) {
  if(typeof ArgText !== 'string') return '';

  const WithoutMentions = SlackFormatUtils.ReplaceUserMentions(ArgText, () => '');
  return WithoutMentions
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * @param {any} ArgPayload
 * @returns {string[]}
 */
function GetAssigneeIds(ArgPayload) {
  const AssigneeIds = GetUniqueStrings(ArgPayload?.assigneeIds);
  const AssigneeId = GetStringOrNull(ArgPayload?.assigneeId);
  if(AssigneeId !== null && !AssigneeIds.includes(AssigneeId)) {
    AssigneeIds.push(AssigneeId);
  }
  return AssigneeIds;
}

/**
 * Preserve repository identifiers when a future event schema supplies them.
 * Current reminder events carry GitHub URLs, which remain separately available
 * on the normalized record without guessing an identifier from their text.
 *
 * @param {any} ArgPayload
 * @returns {string[]}
 */
function GetGitHubRepositoryIds(ArgPayload) {
  const RepositoryIds = GetUniqueStrings(ArgPayload?.githubRepositoryIds);
  for(const Value of [ArgPayload?.githubRepositoryId, ArgPayload?.githubRepoId, ArgPayload?.repositoryId]) {
    const RepositoryId = GetStringOrNull(Value);
    if(RepositoryId !== null && !RepositoryIds.includes(RepositoryId)) {
      RepositoryIds.push(RepositoryId);
    }
  }
  return RepositoryIds;
}

/**
 * Fold one workspace's `eventStore.readAll(workspace)` result into entity-link
 * inputs. It also tolerates a combined stream: workspace is part of the fold
 * key, so matching reminder IDs from separate workspaces cannot affect each
 * other. This function performs no I/O and does not mutate the event objects.
 *
 * Only creation-bearing events produce records. A later ReminderCompleted
 * event enriches its matching record with the completion timestamp while the
 * original creation event remains its stable provenance source.
 *
 * @param {any[]} ArgEvents
 * @returns {EntityProjectionInput[]}
 */
function FoldEntityProjectionInputs(ArgEvents) {
  if(!Array.isArray(ArgEvents)) return [];

  /** @type {Map<string, EntityProjectionInput>} */
  const RecordsByReminder = new Map();
  /** @type {EntityProjectionInput[]} */
  const Records = [];

  for(const Event of ArgEvents) {
    if(!Event || typeof Event !== 'object' || Array.isArray(Event)) continue;

    const ReminderId = GetStringOrNull(Event.reminderId);
    const Workspace = GetStringOrNull(Event.workspace);
    const Payload = Event.payload && typeof Event.payload === 'object' && !Array.isArray(Event.payload)
      ? Event.payload
      : {};
    const RecordKey = `${Workspace ?? ''}\u0000${ReminderId ?? ''}`;

    if(Event.type === 'ReminderCompleted') {
      const Record = RecordsByReminder.get(RecordKey);
      if(Record) {
        Record.completedAt = GetStringOrNull(Payload.completedAt) || GetStringOrNull(Event.ts);
      }
      continue;
    }

    if((Event.type !== 'ReminderCreated' && Event.type !== 'BaselineReminderImported') || ReminderId === null) {
      continue;
    }

    // One task record per reminder is the useful candidate-generation shape.
    // Repeated creation-bearing events leave the earliest provenance intact.
    if(RecordsByReminder.has(RecordKey)) continue;

    const Record = /** @type {EntityProjectionInput} */({
      workspace: Workspace,
      reminderId: ReminderId,
      normalizedText: NormalizeReminderText(Payload.text),
      assigneeIds: GetAssigneeIds(Payload),
      originalSenderId: GetStringOrNull(Payload.originalSenderId),
      sourceChannelId: GetStringOrNull(Payload.sourceChannelId),
      targetChannelId: GetStringOrNull(Payload.targetChannelId),
      createdAt: GetStringOrNull(Payload.createdAt) || GetStringOrNull(Event.ts),
      completedAt: GetStringOrNull(Payload.completedAt),
      githubUrls: GetUniqueStrings(Payload.githubUrls),
      githubRepositoryIds: GetGitHubRepositoryIds(Payload),
      sourceEventId: GetStringOrNull(Event.id),
      sourceEventType: Event.type,
    });
    RecordsByReminder.set(RecordKey, Record);
    Records.push(Record);
  }

  return Records;
}

module.exports = {
  FoldEntityProjectionInputs,
  NormalizeReminderText,
};
