'use strict';

const { WriteFileDurableAsync } = require('./durable-write');

/**
 * Event-count bound used when compacting a workspace ledger. The writer still writes a fresh
 * legacy snapshot after every successful fold: the count controls log compaction, never the
 * rollback file's freshness.
 */
const DEFAULT_COMPACTION_EVENT_COUNT = 100;

/**
 * Write legacy JSON read models from an already-folded event state. This deliberately accepts
 * plain data rather than a live module/store: it is a projection dump, never a read-modify-write
 * of either legacy file.
 *
 * @param {{ reminderFilePath: string, completionFilePath: string, folded: { reminders: object[], completed: object[] }, Logger?: any }} ArgOptions
 * @returns {Promise<void>}
 */
async function WriteDerivedSnapshotAsync(ArgOptions) {
  const Folded = ArgOptions.folded || { reminders: [], completed: [] };
  const Reminders = Array.isArray(Folded.reminders) ? Folded.reminders : [];
  const Completed = Array.isArray(Folded.completed) ? Folded.completed : [];
  const Logger = ArgOptions.Logger;

  // Each file is written with the same array shape and date serialization that its pre-P3 loader
  // already consumes. Write the active queue first: a crash between files leaves only complete,
  // independently loadable JSON files, never a partial/truncated one.
  await WriteFileDurableAsync(ArgOptions.reminderFilePath, JSON.stringify(Reminders, null, 2), { Logger });
  await WriteFileDurableAsync(ArgOptions.completionFilePath, JSON.stringify(Completed, null, 2), { Logger });
}

/**
 * Replace the replay log with a deterministic baseline for the folded state. A subsequent fold
 * therefore replays current state, not the unbounded historical transition stream. Completed
 * records retain their completion event so their timestamp and summary survive the fold.
 *
 * @param {{ workspace: string, folded: { reminders: object[], completed: object[] } }} ArgOptions
 * @returns {object[]}
 */
function BuildCompactedEvents(ArgOptions) {
  const Folded = ArgOptions.folded || { reminders: [], completed: [] };
  const Workspace = ArgOptions.workspace;
  const Events = [];
  const AddBaseline = (ArgReminder, ArgSuffix) => {
    const Reminder = ArgReminder || {};
    const ReminderID = typeof Reminder.ReminderID === 'string' ? Reminder.ReminderID : null;
    if(!ReminderID) return;
    const CreatedOn = Reminder.CreatedOn instanceof Date
      ? Reminder.CreatedOn.toISOString()
      : (typeof Reminder.CreatedOn === 'string' ? Reminder.CreatedOn : new Date(0).toISOString());
    const ShouldPostOn = Reminder.ShouldPostOn instanceof Date
      ? Reminder.ShouldPostOn.toISOString()
      : (typeof Reminder.ShouldPostOn === 'string' ? Reminder.ShouldPostOn : null);
    Events.push({
      v: 1,
      id: `snapshot-${ArgSuffix}-${ReminderID}`,
      ts: CreatedOn,
      workspace: Workspace,
      type: 'BaselineReminderImported',
      reminderId: ReminderID,
      payload: {
        text: typeof Reminder.ReminderMessageText === 'string' ? Reminder.ReminderMessageText : '',
        assigneeId: Reminder.AssigneeID || null,
        assigneeIds: Array.isArray(Reminder.AssigneeIDs) ? Reminder.AssigneeIDs : [],
        sourceChannelId: Reminder.OriginalChannelID || Reminder.TargetChannelID || null,
        targetChannelId: Reminder.TargetChannelID || null,
        dueAt: ShouldPostOn,
        state: Reminder.State || 'scheduled',
        githubUrls: Array.isArray(Reminder.GitHubUrls) ? Reminder.GitHubUrls : [],
        createdOn: CreatedOn,
        originalSenderId: Reminder.OriginalSenderID || null,
        originalMessageId: Reminder.OriginalMessageID || null,
        originalThreadTs: Reminder.OriginalThreadTs || null,
        originalChannelName: Reminder.OriginalChannelName || null,
        ignoreSnooze: Boolean(Reminder.IgnoreSnooze),
        clientId: Reminder.clientId || null,
        projectId: Reminder.projectId || null,
      },
    });
  };

  for(const Reminder of Array.isArray(Folded.reminders) ? Folded.reminders : []) AddBaseline(Reminder, 'open');
  for(const Completion of Array.isArray(Folded.completed) ? Folded.completed : []) {
    const CompletedMs = typeof Completion.completedMs === 'number' ? Completion.completedMs : 0;
    const CompletedAt = new Date(CompletedMs).toISOString();
    AddBaseline({
      ReminderID: Completion.reminderId,
      ReminderMessageText: Completion.summary || '',
      AssigneeID: Completion.assigneeID || null,
      OriginalChannelID: Completion.sourceChannelID || null,
      TargetChannelID: Completion.sourceChannelID || null,
      ShouldPostOn: Completion.dueDate || null,
      CreatedOn: CompletedAt,
      clientId: Completion.clientId || null,
      State: 'scheduled',
    }, 'completed');
    Events.push({
      v: 1,
      id: `snapshot-completed-${Completion.reminderId}`,
      ts: CompletedAt,
      workspace: Workspace,
      type: 'ReminderCompleted',
      reminderId: Completion.reminderId,
      payload: {
        by: Completion.assigneeID || null,
        method: 'snapshot',
        summary: Completion.summary || null,
        completedAt: CompletedAt,
      },
    });
  }
  return Events;
}

/**
 * Persist a fresh fallback snapshot and compact an event log after its configured event count.
 * The log rewrite happens only after both snapshots land, so an interrupted compaction leaves a
 * usable old log or a complete new compacted log.
 *
 * @param {{ reminderFilePath: string, completionFilePath: string, eventFilePath: string, workspace: string, events: object[], folded: { reminders: object[], completed: object[] }, compactionEventCount?: number, Logger?: any }} ArgOptions
 * @returns {Promise<{ compacted: boolean, replayEventCount: number }>}
 */
async function WriteSnapshotAndCompactAsync(ArgOptions) {
  await WriteDerivedSnapshotAsync(ArgOptions);
  const EventCount = Array.isArray(ArgOptions.events) ? ArgOptions.events.length : 0;
  const Limit = Number.isInteger(ArgOptions.compactionEventCount) && ArgOptions.compactionEventCount > 0
    ? ArgOptions.compactionEventCount
    : DEFAULT_COMPACTION_EVENT_COUNT;
  if(EventCount < Limit) return { compacted: false, replayEventCount: EventCount };

  const Compacted = BuildCompactedEvents(ArgOptions);
  const Log = Compacted.map(ArgEvent => JSON.stringify(ArgEvent)).join('\n');
  await WriteFileDurableAsync(ArgOptions.eventFilePath, Log.length > 0 ? `${Log}\n` : '', { Logger: ArgOptions.Logger });
  return { compacted: true, replayEventCount: Compacted.length };
}

module.exports = {
  BuildCompactedEvents,
  DEFAULT_COMPACTION_EVENT_COUNT,
  WriteDerivedSnapshotAsync,
  WriteSnapshotAndCompactAsync,
};
