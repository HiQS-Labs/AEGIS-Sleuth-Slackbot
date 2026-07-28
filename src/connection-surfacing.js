'use strict';

// Connection surfacing — at reminder-creation time, surface a small footnote of related open work so
// a new reminder doesn't land in isolation. Pure, in-memory, rule-based: shared GitHub URL or shared
// client. No AI, no IO. The reminder FSM is untouched; callers only append the returned footnote to
// the confirmation message.

const { DoesReminderMatchClient } = require('./client-mapping');
const { GitHubRefFromUrl } = require('./reminder-clustering');

const MAX_FOOTNOTE_ITEMS = 3;

/**
 * @typedef {import('./reminders-module').ReminderInfo} ReminderInfo
 */
/**
 * @typedef {{ Label: string, Count: number }} RelatedItem
 */

/**
 * Find open reminders related to a set of newly-created reminders, grouped into labelled buckets.
 * A candidate is attributed to the first relationship it matches: a shared GitHub URL (labelled by
 * PR/issue) takes precedence over a shared client. Returns up to MAX_FOOTNOTE_ITEMS buckets ordered
 * by count descending. The new reminders themselves are excluded.
 *
 * Single-workspace by construction: callers pass their own workspace's open queue, so results never
 * cross workspaces.
 * @param {ReminderInfo[]} ArgNewReminders Reminders just created.
 * @param {ReminderInfo[]} ArgOpenReminders The workspace's current open reminders.
 * @param {Array<any>} [ArgClients] Client mappings (from LoadClientMappingsSync).
 * @returns {RelatedItem[]}
 */
function FindRelatedOpenReminders(ArgNewReminders, ArgOpenReminders, ArgClients = []) {
  const NewReminders = Array.isArray(ArgNewReminders) ? ArgNewReminders : [];
  const OpenReminders = Array.isArray(ArgOpenReminders) ? ArgOpenReminders : [];
  const Clients = Array.isArray(ArgClients) ? ArgClients : [];

  const NewIds = new Set(NewReminders.map(ArgReminder => ArgReminder.ReminderID));

  // URLs referenced by the new reminders, in first-seen order (drives PR/issue grouping + labels).
  /** @type {string[]} */
  const NewUrls = [];
  for(const Reminder of NewReminders)
    for(const Url of Array.isArray(Reminder.GitHubUrls) ? Reminder.GitHubUrls : [])
      if(!NewUrls.includes(Url)) NewUrls.push(Url);

  // Clients matched by the new reminders.
  const NewClients = Clients.filter(ArgClient =>
    NewReminders.some(ArgReminder => DoesReminderMatchClient(ArgReminder, ArgClient))
  );

  /** @type {Map<string, Set<string>>} */
  const ByLabel = new Map();
  /** @param {string} ArgLabel @param {string} ArgReminderId */
  const Attribute = (ArgLabel, ArgReminderId) => {
    if(!ByLabel.has(ArgLabel)) ByLabel.set(ArgLabel, new Set());
    /** @type {Set<string>} */ (ByLabel.get(ArgLabel)).add(ArgReminderId);
  };

  for(const Candidate of OpenReminders) {
    if(NewIds.has(Candidate.ReminderID)) continue;

    const CandidateUrls = Array.isArray(Candidate.GitHubUrls) ? Candidate.GitHubUrls : [];
    const SharedUrl = NewUrls.find(ArgUrl => CandidateUrls.includes(ArgUrl));
    if(SharedUrl) {
      Attribute(GitHubRefFromUrl(SharedUrl), Candidate.ReminderID);
      continue;
    }

    const SharedClient = NewClients.find(ArgClient => DoesReminderMatchClient(Candidate, ArgClient));
    if(SharedClient) Attribute(SharedClient.ClientName || 'Client', Candidate.ReminderID);
  }

  return [...ByLabel.entries()]
    .map(([Label, Ids]) => ({ Label, Count: Ids.size }))
    .sort((ArgA, ArgB) => ArgB.Count - ArgA.Count || ArgA.Label.localeCompare(ArgB.Label))
    .slice(0, MAX_FOOTNOTE_ITEMS);
}

/**
 * Build the related-work footnote line from related items and an optional remembered-thread count.
 * When ArgClientLabel is provided (non-empty), it is prepended to the footnote as "Client: <label>".
 * Returns '' when there is nothing to surface.
 * @param {RelatedItem[]} ArgItems
 * @param {number} [ArgMemoryCount] Count of related remembered threads (semantic pass).
 * @param {string} [ArgClientLabel] Resolved client name to surface in the footnote.
 * @returns {string}
 */
function BuildRelatedFootnote(ArgItems, ArgMemoryCount = 0, ArgClientLabel = '') {
  const Clauses = (Array.isArray(ArgItems) ? ArgItems : []).map(
    ArgItem => `${ArgItem.Label} (${ArgItem.Count} open reminder${ArgItem.Count === 1 ? '' : 's'})`
  );
  if(ArgMemoryCount > 0)
    Clauses.push(`${ArgMemoryCount} remembered thread${ArgMemoryCount === 1 ? '' : 's'}`);
  const ClientPrefix = ArgClientLabel ? `Client: ${ArgClientLabel}` : '';
  if(Clauses.length === 0 && !ClientPrefix) return '';
  if(Clauses.length === 0) return `↳ ${ClientPrefix}`;
  return ClientPrefix
    ? `↳ ${ClientPrefix} · Related: ${Clauses.join(', ')}`
    : `↳ Related: ${Clauses.join(', ')}`;
}

module.exports = {
  FindRelatedOpenReminders,
  BuildRelatedFootnote,
  MAX_FOOTNOTE_ITEMS,
};
