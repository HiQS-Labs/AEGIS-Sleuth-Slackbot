'use strict';

// Pure fold from an Event[] into the week-summary shape. No I/O, no Slack/GitHub calls.
// Window: [weekStartMs, weekEndMs) — inclusive start, exclusive end —
// matching CompletionStore.GetCompletedBetween semantics (completion-store.js:104-108).
//
// CommonJS to match src/completion-store.js.

const { FoldReminders } = require('../deploy/reminders-export/events-projection');

/**
 * @typedef {Object} WeekCompletedRow  Field-compatible with CompletionRecord (completion-store.js).
 * @property {string}      reminderId
 * @property {string|null} summary
 * @property {string|null} assigneeID
 * @property {string|null} sourceChannelID
 * @property {string|null} dueDate
 * @property {number}      completedMs
 */

/**
 * Pure fold from an Event[] into the two lists the live `summarize-week` handler renders.
 * Mirrors #HandleSummarizeWeekAsync (reminders-app-mention-handler.js:900-947):
 *   - completed: what GetCompletedRemindersBetween(weekStartMs, weekEndMs) would return
 *   - open:      what GetPendingRemindersQueue() would return
 *
 * @param {import('../deploy/reminders-export/events-projection').Event[]} ArgEvents
 * @param {{ weekStartMs?: number, weekEndMs?: number, warn?: (msg: string) => void }} ArgOpts
 * @returns {{ completed: WeekCompletedRow[], open: Object[] }}
 */
function summarizeWeekFromEvents(ArgEvents, ArgOpts = {}) {
  const WeekStartMs = typeof ArgOpts.weekStartMs === 'number' ? ArgOpts.weekStartMs : -Infinity;
  const WeekEndMs   = typeof ArgOpts.weekEndMs   === 'number' ? ArgOpts.weekEndMs   :  Infinity;

  const Records = FoldReminders(Array.isArray(ArgEvents) ? ArgEvents : [], ArgOpts);

  const Completed = [];
  const Open      = [];

  for (const Record of Records) {
    if (Record.state === 'completed') {
      const CompletedMs = Date.parse(Record.completedAt ?? '');
      if (Number.isFinite(CompletedMs) && CompletedMs >= WeekStartMs && CompletedMs < WeekEndMs) {
        Completed.push({
          reminderId:      Record.reminderId,
          summary:         Record.completionSummary,
          assigneeID:      Record.assigneeId,
          sourceChannelID: Record.sourceChannelId,
          dueDate:         Record.shouldPostOn,
          completedMs:     CompletedMs,
        });
      }
    } else if (Record.state !== 'cancelled') {
      // Not terminated — counts as open (created, scheduled, or snoozed)
      Open.push(Record);
    }
  }

  // Oldest-first, matching CompletionStore.GetCompletedBetween sort (completion-store.js:107)
  Completed.sort((ArgLeft, ArgRight) => ArgLeft.completedMs - ArgRight.completedMs);

  return { completed: Completed, open: Open };
}

module.exports = { summarizeWeekFromEvents };
