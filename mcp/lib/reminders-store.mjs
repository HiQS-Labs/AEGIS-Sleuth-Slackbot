// Read-only reader over the on-disk reminder state Sleuth owns.
//
// We deliberately do NOT instantiate src/reminders-module.js: its constructor wants a live SlackApp
// and its StartAsync spins timers and opens a socket. For a query connector that is both unsafe and
// unnecessary — the durable truth already lives in two JSON files per workspace:
//   <runtime>/reminders/<name>_reminders.json   pending/active reminders (ReminderInfo[])
//   <runtime>/reminders/<name>_completed.json   completion history (CompletionRecord[])
// We read those directly, matching the app's own (de)serialization (ISO dates for CreatedOn/ShouldPostOn).

import { readFile } from 'node:fs/promises';
import { GetRemindersFilePath, GetCompletedFilePath } from './config.mjs';

/** Parse a JSON file into an array; a missing file is the normal empty case. */
async function ReadJsonArray(ArgFilePath) {
  let Raw;
  try {
    Raw = await readFile(ArgFilePath, 'utf8');
  } catch(error) {
    if(error && error.code === 'ENOENT') return [];
    throw error;
  }
  const Parsed = JSON.parse(Raw);
  return Array.isArray(Parsed) ? Parsed : [];
}

/**
 * Project a raw on-disk ReminderInfo into a stable, query-friendly shape. The on-disk field names
 * are verbose and Slack-internal; we surface a flatter view while keeping the raw ids callers need
 * to act on the reminder elsewhere.
 * @param {any} ArgReminder
 */
function ProjectReminder(ArgReminder) {
  return {
    id: ArgReminder.ReminderID || ArgReminder.id || null,
    state: ArgReminder.State || 'scheduled',
    text: ArgReminder.ReminderMessageText || '',
    dueAt: ArgReminder.ShouldPostOn || null,
    createdAt: ArgReminder.CreatedOn || null,
    assigneeId: ArgReminder.AssigneeID || null,
    senderId: ArgReminder.OriginalSenderID || null,
    originChannelId: ArgReminder.OriginalChannelID || null,
    originChannelName: ArgReminder.OriginalChannelName || null,
    targetChannelId: ArgReminder.TargetChannelID || null,
    threadTs: ArgReminder.OriginalThreadTs || null,
    messageTs: ArgReminder.OriginalMessageID || null,
    githubUrls: Array.isArray(ArgReminder.GitHubUrls) ? ArgReminder.GitHubUrls : [],
  };
}

/**
 * Query a workspace's pending/active reminders, applying optional filters in memory.
 * @param {string} ArgWorkspaceName
 * @param {{ state?: string, assigneeId?: string, channelId?: string, search?: string,
 *           dueBefore?: string, dueAfter?: string, limit?: number }} [ArgFilters]
 * @returns {Promise<{ total: number, returned: number, reminders: any[] }>}
 */
export async function QueryReminders(ArgWorkspaceName, ArgFilters = {}) {
  const Raw = await ReadJsonArray(GetRemindersFilePath(ArgWorkspaceName));
  let Items = Raw.map(ProjectReminder);
  const Total = Items.length;

  if(ArgFilters.state) {
    const Want = String(ArgFilters.state).toLowerCase();
    Items = Items.filter(ArgItem => String(ArgItem.state).toLowerCase() === Want);
  }
  if(ArgFilters.assigneeId) {
    Items = Items.filter(ArgItem => ArgItem.assigneeId === ArgFilters.assigneeId);
  }
  if(ArgFilters.channelId) {
    Items = Items.filter(ArgItem =>
      ArgItem.originChannelId === ArgFilters.channelId || ArgItem.targetChannelId === ArgFilters.channelId);
  }
  if(ArgFilters.search) {
    const Needle = String(ArgFilters.search).toLowerCase();
    Items = Items.filter(ArgItem => ArgItem.text.toLowerCase().includes(Needle));
  }
  if(ArgFilters.dueAfter) {
    const After = Date.parse(ArgFilters.dueAfter);
    if(!Number.isNaN(After)) {
      Items = Items.filter(ArgItem => ArgItem.dueAt && Date.parse(ArgItem.dueAt) >= After);
    }
  }
  if(ArgFilters.dueBefore) {
    const Before = Date.parse(ArgFilters.dueBefore);
    if(!Number.isNaN(Before)) {
      Items = Items.filter(ArgItem => ArgItem.dueAt && Date.parse(ArgItem.dueAt) <= Before);
    }
  }

  // Soonest-due first; reminders without a due date sort last.
  Items.sort((ArgLeft, ArgRight) => {
    const Left = ArgLeft.dueAt ? Date.parse(ArgLeft.dueAt) : Number.POSITIVE_INFINITY;
    const Right = ArgRight.dueAt ? Date.parse(ArgRight.dueAt) : Number.POSITIVE_INFINITY;
    return Left - Right;
  });

  const Limit = Number.isFinite(ArgFilters.limit) && ArgFilters.limit > 0 ? Math.floor(ArgFilters.limit) : 50;
  const Returned = Items.slice(0, Limit);
  return { total: Total, returned: Returned.length, reminders: Returned };
}

/**
 * Fetch a single reminder by id.
 * @param {string} ArgWorkspaceName
 * @param {string} ArgReminderId
 * @returns {Promise<any|null>}
 */
export async function GetReminderById(ArgWorkspaceName, ArgReminderId) {
  const Raw = await ReadJsonArray(GetRemindersFilePath(ArgWorkspaceName));
  const Found = Raw.map(ProjectReminder).find(ArgItem => ArgItem.id === ArgReminderId);
  return Found || null;
}

/**
 * Query completion history within a time window. The completion store retains ~365 days.
 * @param {string} ArgWorkspaceName
 * @param {{ since?: string, until?: string, assigneeId?: string, limit?: number }} [ArgFilters]
 * @returns {Promise<{ total: number, returned: number, completed: any[] }>}
 */
export async function QueryCompleted(ArgWorkspaceName, ArgFilters = {}) {
  const Raw = await ReadJsonArray(GetCompletedFilePath(ArgWorkspaceName));
  const SinceMs = ArgFilters.since ? Date.parse(ArgFilters.since) : Number.NEGATIVE_INFINITY;
  const UntilMs = ArgFilters.until ? Date.parse(ArgFilters.until) : Number.POSITIVE_INFINITY;

  let Items = Raw
    .filter(ArgRecord => ArgRecord && typeof ArgRecord.completedMs === 'number')
    .filter(ArgRecord => ArgRecord.completedMs >= SinceMs && ArgRecord.completedMs <= UntilMs);

  if(ArgFilters.assigneeId) {
    Items = Items.filter(ArgRecord => ArgRecord.assigneeID === ArgFilters.assigneeId);
  }

  Items.sort((ArgLeft, ArgRight) => ArgRight.completedMs - ArgLeft.completedMs); // most recent first
  const Total = Items.length;

  const Limit = Number.isFinite(ArgFilters.limit) && ArgFilters.limit > 0 ? Math.floor(ArgFilters.limit) : 50;
  const Returned = Items.slice(0, Limit).map(ArgRecord => ({
    id: ArgRecord.reminderId,
    text: ArgRecord.summary || '',
    assigneeId: ArgRecord.assigneeID || null,
    channelId: ArgRecord.sourceChannelID || null,
    dueAt: ArgRecord.dueDate || null,
    completedAt: new Date(ArgRecord.completedMs).toISOString(),
  }));

  return { total: Total, returned: Returned.length, completed: Returned };
}

/**
 * Aggregate counts by state plus an overdue tally, for a quick workspace health view.
 * @param {string} ArgWorkspaceName
 * @returns {Promise<{ total: number, byState: Record<string, number>, overdue: number }>}
 */
export async function ReminderStats(ArgWorkspaceName) {
  const Raw = await ReadJsonArray(GetRemindersFilePath(ArgWorkspaceName));
  const Items = Raw.map(ProjectReminder);
  const Now = Date.now();
  /** @type {Record<string, number>} */
  const ByState = {};
  let Overdue = 0;
  for(const Item of Items) {
    ByState[Item.state] = (ByState[Item.state] || 0) + 1;
    if(Item.dueAt && Date.parse(Item.dueAt) < Now) Overdue += 1;
  }
  return { total: Items.length, byState: ByState, overdue: Overdue };
}
