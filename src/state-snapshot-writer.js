'use strict';

const { WriteFileDurableAsync } = require('./durable-write');
const { CURRENT_SCHEMA_VERSION } = require('./event-store');

/**
 * Event-count bound used when compacting a workspace ledger. The writer still writes a fresh
 * legacy snapshot after every successful fold: the count controls log compaction, never the
 * rollback file's freshness.
 */
const DEFAULT_COMPACTION_EVENT_COUNT = 100;

/**
 * The folded state this writer dumps. Declared as real shapes rather than `object[]` so `checkJs`
 * can see the fields — a bare `object[]` gives elements with NO properties, which is why every
 * `Reminder.OriginalMessageID` / `Completion.completedMs` access raised TS2339 and `npm run build`
 * was red. Fields mirror the legacy on-disk shape the pre-P3 loader reads, which is the whole point
 * of the phase: a snapshot must be legacy-loadable for rollback to stay a flag flip.
 * @typedef {Object} FoldedReminder
 * @property {string} ReminderID
 * @property {string|Date} CreatedOn
 * @property {string|Date} ShouldPostOn
 * @property {string} ReminderMessageText
 * @property {string|null} AssigneeID
 * @property {string[]} [AssigneeIDs]
 * @property {string|null} OriginalChannelID
 * @property {string|null} TargetChannelID
 * @property {string} State
 * @property {string[]} [GitHubUrls]
 * @property {string|null} [OriginalSenderID]
 * @property {string|null} [OriginalMessageID]
 * @property {string|null} [OriginalThreadTs]
 * @property {string|null} [OriginalChannelName]
 * @property {boolean} [IgnoreSnooze]
 * @property {string|null} [clientId]
 * @property {string|null} [projectId]
 * @property {boolean} [GitHubRelayStarted]
 * @property {boolean} [GitHubRelayStopped]
 */

/**
 * @typedef {Object} FoldedCompletion
 * @property {string} reminderId
 * @property {number} completedMs
 * @property {string|null} [summary]
 * @property {string|null} [assigneeID]
 * @property {string|null} [sourceChannelID]
 * @property {string|null} [dueDate]
 * @property {string|null} [clientId]
 */

/**
 * @typedef {Object} FoldedState
 * @property {FoldedReminder[]} reminders
 * @property {FoldedCompletion[]} completed
 */

/**
 * Write legacy JSON read models from an already-folded event state. This deliberately accepts
 * plain data rather than a live module/store: it is a projection dump, never a read-modify-write
 * of either legacy file.
 *
 * @param {{ reminderFilePath: string, completionFilePath: string, folded: FoldedState, Logger?: any }} ArgOptions
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
 * @param {{ workspace: string, folded: FoldedState, authoritative?: { reminders?: any[], completed?: any[] } }} ArgOptions
 *   `authoritative` is the JSON store's own records. Supply it whenever they are on hand: it makes
 *   the compacted baseline describe current state rather than the fold's belief about it.
 * @returns {object[]}
 */
function BuildCompactedEvents(ArgOptions) {
  const Folded = ArgOptions.folded || { reminders: [], completed: [] };
  const Workspace = ArgOptions.workspace;
  const Events = [];

  /**
   * Compaction REPLACES the log, so whatever it writes becomes the entire past. Seeding it from the
   * FOLD bakes in whatever the fold currently believes — including anything the ledger is missing,
   * with no earlier event left to correct it.
   *
   * That is not hypothetical. Production reminder `9ba4c949` had its reschedules dropped by an
   * emitter that omitted a v2-required key, so the fold held a due date two days stale while the
   * JSON store held the real one. Compacting the fold would have written the stale date in as the
   * new baseline and made a recoverable gap permanent.
   *
   * So when the caller supplies the authoritative records, they win: the snapshot describes current
   * state as the system actually holds it, and parity after compaction is true by construction
   * rather than by luck. Falling back to the fold keeps every existing caller working, and remains
   * correct wherever the log is known-complete.
   *
   * Deliberately NOT a per-record merge. The authoritative store is the whole truth about which
   * reminders are live — a fold may still hold entries it has dropped, and merging would resurrect
   * exactly those. Retiring them is `--retire-orphans`'s job, not compaction's.
   */
  const Authoritative = ArgOptions.authoritative;
  const SourceReminders = Authoritative && Array.isArray(Authoritative.reminders)
    ? Authoritative.reminders
    : (Array.isArray(Folded.reminders) ? Folded.reminders : []);
  const SourceCompleted = Authoritative && Array.isArray(Authoritative.completed)
    ? Authoritative.completed
    : (Array.isArray(Folded.completed) ? Folded.completed : []);
  const AddBaseline = (/** @type {FoldedReminder} */ ArgReminder, /** @type {string} */ ArgSuffix) => {
    // Cast, not a bare `|| {}`: the runtime null-guard is still wanted, but the untyped `{}` branch
    // widens the union to a property-less object and every field access below becomes TS2339.
    const Reminder = /** @type {FoldedReminder} */ (ArgReminder || {});
    const ReminderID = typeof Reminder.ReminderID === 'string' ? Reminder.ReminderID : null;
    if(!ReminderID) return;
    const CreatedOn = Reminder.CreatedOn instanceof Date
      ? Reminder.CreatedOn.toISOString()
      : (typeof Reminder.CreatedOn === 'string' ? Reminder.CreatedOn : new Date(0).toISOString());
    const ShouldPostOn = Reminder.ShouldPostOn instanceof Date
      ? Reminder.ShouldPostOn.toISOString()
      : (typeof Reminder.ShouldPostOn === 'string' ? Reminder.ShouldPostOn : null);
    Events.push({
      // Compaction REPLACES the log, so a compacted event that omits a v2 field permanently
      // destroys the parity the fold has already achieved — there is no earlier event left to
      // recover it from. The strict gate caught exactly that, on this writer, when it started
      // requiring completedMs.
      v: CURRENT_SCHEMA_VERSION,
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
        // github-comment-relay.js:102 refuses to relay when GitHubRelayStopped is set. A compacted
        // baseline that dropped these would resume a relay the user stopped, with no earlier event
        // left to contradict it.
        gitHubRelayStarted: Boolean(Reminder.GitHubRelayStarted),
        gitHubRelayStopped: Boolean(Reminder.GitHubRelayStopped),
      },
    });
  };

  for(const Reminder of SourceReminders) AddBaseline(Reminder, 'open');
  for(const Completion of SourceCompleted) {
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
      v: CURRENT_SCHEMA_VERSION,
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
        // Carried verbatim, not re-derived from CompletedAt: round-tripping through an ISO string
        // is exactly the lossy step this schema version exists to remove.
        completedMs: CompletedMs,
        sourceChannelId: Completion.sourceChannelID || null,
        dueDate: Completion.dueDate || null,
        clientId: Completion.clientId || null,
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
 * @param {{ reminderFilePath: string, completionFilePath: string, eventFilePath: string, workspace: string, events: object[], folded: FoldedState, authoritative?: { reminders?: any[], completed?: any[] }, compactionEventCount?: number, Logger?: any }} ArgOptions
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
