'use strict';

// Deterministic relationship clustering for reminder lists (powers show-me's grouped rendering).
// Pure functions — no AI, no IO. Groups a set of reminders by inferred relationship so a flat ranked
// list reads as the shape of the work. Grouping rules, applied in priority order (a reminder joins the
// first group it matches):
//   1. Shared GitHub URL — reminders that share any GitHub URL cluster together (transitively). A
//      reminder with GitHub URLs that nobody else references forms its own single-member PR/issue cluster.
//   2. Same client    — reminders (without GitHub links) that resolve to the same client mapping.
//   3. Same channel   — remaining reminders that share an OriginalChannelName (2+); lone channels dissolve.
//   4. Other          — everything left. Always rendered last; when it is the only cluster the list is flat.

const { DoesReminderMatchClient } = require('./client-mapping');
const { ExtractReminderTitle, DetermineProjectForReminder } = require('./chat-commands/show-me-projects-command');

/**
 * @typedef {import('./reminders-module').ReminderInfo} ReminderInfo
 */
/**
 * A rendered cluster of related reminders.
 * @typedef {Object} ReminderCluster
 * @property {'github'|'client'|'channel'|'other'} Kind
 * @property {string} Label Human label, e.g. "PR #47", "Client A", "#payments-team", "Other".
 * @property {ReminderInfo[]} Reminders In original (rank) order.
 */

/**
 * Derive a short GitHub label from an issue/PR URL: pull requests render as `PR #47`, issues as `#52`.
 * Falls back to the raw URL when no number can be parsed.
 * @param {string} ArgUrl
 * @returns {string}
 */
function GitHubRefFromUrl(ArgUrl) {
  const Match = (ArgUrl || '').match(/\/(issues|pull)\/(\d+)/i);
  if(!Match) return ArgUrl;
  return Match[1].toLowerCase() === 'pull' ? `PR #${Match[2]}` : `#${Match[2]}`;
}

/**
 * Union-find root with path compression.
 * @param {number[]} ArgParent
 * @param {number} ArgIndex
 * @returns {number}
 */
function FindRoot(ArgParent, ArgIndex) {
  let Root = ArgIndex;
  while(ArgParent[Root] !== Root) Root = ArgParent[Root];
  while(ArgParent[ArgIndex] !== Root) {
    const Next = ArgParent[ArgIndex];
    ArgParent[ArgIndex] = Root;
    ArgIndex = Next;
  }
  return Root;
}

/**
 * Cluster reminders by inferred relationship. Clusters are ordered by size descending with the
 * "Other" bucket always last; reminder order within a cluster preserves the input (rank) order.
 * @param {ReminderInfo[]} ArgReminders Reminders in rank order.
 * @param {Array<any>} [ArgClients] Client mappings (from LoadClientMappingsSync). Defaults to none.
 * @returns {ReminderCluster[]}
 */
function ClusterRemindersByRelationship(ArgReminders, ArgClients = []) {
  const Reminders = Array.isArray(ArgReminders) ? ArgReminders : [];
  const Clients = Array.isArray(ArgClients) ? ArgClients : [];

  /** @type {Set<number>} */
  const Placed = new Set();
  /** @type {ReminderCluster[]} */
  const Clusters = [];

  // --- Rule 1: shared GitHub URL (union-find over reminders that share any URL) ---
  const GitHubIndexes = Reminders
    .map((ArgReminder, ArgIndex) => ({ ArgReminder, ArgIndex }))
    .filter(ArgEntry => Array.isArray(ArgEntry.ArgReminder.GitHubUrls) && ArgEntry.ArgReminder.GitHubUrls.length > 0)
    .map(ArgEntry => ArgEntry.ArgIndex);

  if(GitHubIndexes.length > 0) {
    const Parent = Reminders.map((_ArgReminder, ArgIndex) => ArgIndex);
    /** @type {Map<string, number>} */
    const FirstSeenByUrl = new Map();
    for(const Index of GitHubIndexes) {
      for(const Url of /** @type {string[]} */ (Reminders[Index].GitHubUrls)) {
        if(FirstSeenByUrl.has(Url)) {
          Parent[FindRoot(Parent, Index)] = FindRoot(Parent, /** @type {number} */ (FirstSeenByUrl.get(Url)));
        } else {
          FirstSeenByUrl.set(Url, Index);
        }
      }
    }

    /** @type {Map<number, number[]>} */
    const ComponentsByRoot = new Map();
    for(const Index of GitHubIndexes) {
      const Root = FindRoot(Parent, Index);
      if(!ComponentsByRoot.has(Root)) ComponentsByRoot.set(Root, []);
      /** @type {number[]} */ (ComponentsByRoot.get(Root)).push(Index);
    }

    for(const Component of ComponentsByRoot.values()) {
      // label from the most frequently referenced URL across the component (ties: first encountered).
      /** @type {Map<string, number>} */
      const UrlCounts = new Map();
      for(const Index of Component)
        for(const Url of /** @type {string[]} */ (Reminders[Index].GitHubUrls))
          UrlCounts.set(Url, (UrlCounts.get(Url) ?? 0) + 1);
      let LabelUrl = Component.length > 0 ? /** @type {string[]} */ (Reminders[Component[0]].GitHubUrls)[0] : '';
      let BestCount = -1;
      for(const [Url, Count] of UrlCounts.entries())
        if(Count > BestCount) { BestCount = Count; LabelUrl = Url; }

      Component.forEach(ArgIndex => Placed.add(ArgIndex));
      Clusters.push({
        Kind: 'github',
        Label: GitHubRefFromUrl(LabelUrl),
        Reminders: Component.sort((ArgA, ArgB) => ArgA - ArgB).map(ArgIndex => Reminders[ArgIndex]),
      });
    }
  }

  // --- Rule 2: same client (reminders not already placed) ---
  for(const Client of Clients) {
    /** @type {number[]} */
    const Members = [];
    Reminders.forEach((ArgReminder, ArgIndex) => {
      if(Placed.has(ArgIndex)) return;
      if(DoesReminderMatchClient(ArgReminder, Client)) Members.push(ArgIndex);
    });
    if(Members.length === 0) continue;
    Members.forEach(ArgIndex => Placed.add(ArgIndex));
    Clusters.push({
      Kind: 'client',
      Label: Client.ClientName || 'Client',
      Reminders: Members.map(ArgIndex => Reminders[ArgIndex]),
    });
  }

  // --- Rule 3: same channel (2+ remaining reminders sharing OriginalChannelName) ---
  /** @type {Map<string, number[]>} */
  const ByChannel = new Map();
  Reminders.forEach((ArgReminder, ArgIndex) => {
    if(Placed.has(ArgIndex)) return;
    const ChannelName = ArgReminder.OriginalChannelName;
    if(!ChannelName) return;
    if(!ByChannel.has(ChannelName)) ByChannel.set(ChannelName, []);
    /** @type {number[]} */ (ByChannel.get(ChannelName)).push(ArgIndex);
  });
  for(const [ChannelName, Members] of ByChannel.entries()) {
    if(Members.length < 2) continue; // lone channels dissolve into Other.
    Members.forEach(ArgIndex => Placed.add(ArgIndex));
    Clusters.push({
      Kind: 'channel',
      Label: `#${ChannelName}`,
      Reminders: Members.map(ArgIndex => Reminders[ArgIndex]),
    });
  }

  // order github/client/channel clusters by size descending (stable for ties).
  Clusters.sort((ArgA, ArgB) => ArgB.Reminders.length - ArgA.Reminders.length);

  // --- Rule 4: Other (everything left), always last ---
  /** @type {ReminderInfo[]} */
  const Leftover = [];
  Reminders.forEach((ArgReminder, ArgIndex) => {
    if(!Placed.has(ArgIndex)) Leftover.push(ArgReminder);
  });
  if(Leftover.length > 0)
    Clusters.push({ Kind: 'other', Label: 'Other', Reminders: Leftover });

  return Clusters;
}

/**
 * Render clusters into Slack mrkdwn with continuous numbering across the whole list. When the only
 * cluster is "Other" (no relationships found) the output is a plain flat numbered list with no header.
 * @param {ReminderCluster[]} ArgClusters
 * @param {(ArgReminder: ReminderInfo) => string} [ArgTitleFn] Title renderer; defaults to ExtractReminderTitle.
 * @returns {string}
 */
function RenderClusteredReminders(ArgClusters, ArgTitleFn) {
  const TitleFn = ArgTitleFn || (ArgReminder => ExtractReminderTitle(ArgReminder.ReminderMessageText));
  const Clusters = Array.isArray(ArgClusters) ? ArgClusters : [];

  const IsFlat = Clusters.length === 1 && Clusters[0].Kind === 'other';
  let Counter = 0;
  const Blocks = Clusters.map(ArgCluster => {
    const Lines = ArgCluster.Reminders.map(ArgReminder => {
      Counter += 1;
      return `  ${Counter}. ${TitleFn(ArgReminder)}`;
    });
    if(IsFlat) return Lines.join('\n');
    return `*${ArgCluster.Label}* (${ArgCluster.Reminders.length})\n${Lines.join('\n')}`;
  });

  return Blocks.join('\n\n');
}

module.exports = {
  ClusterRemindersByRelationship,
  RenderClusteredReminders,
  GitHubRefFromUrl,
  DetermineProjectForReminder,
};
