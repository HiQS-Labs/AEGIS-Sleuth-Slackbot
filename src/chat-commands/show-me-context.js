'use strict';

// shared reminder-acquisition path for the show-me family (show-me and show-me-projects).
// centralizing here keeps a single read path and GitHub-enrichment implementation — no
// parallel command-specific copies of the user-reminder filter or activity fetch.

const ACTIVE_REMINDER_STATES = new Set(['scheduled', 'due', 'overdue', 'snoozed']);
const GITHUB_ACTIVITY_TIMEOUT_MS = 5000;
const GITHUB_ACTIVITY_DAYS = 7;

/**
 * Fetch JSON from the GitHub API with a hard timeout.
 * Returns null on network error, non-OK response, or timeout.
 * @param {string} ArgUrl
 * @param {string} ArgGitHubPat
 * @param {number} ArgTimeoutMs
 * @returns {Promise<any|null>}
 */
async function FetchGitHubJsonAsync(ArgUrl, ArgGitHubPat, ArgTimeoutMs) {
  const Controller = new AbortController();
  const TimeoutId = setTimeout(() => Controller.abort(), ArgTimeoutMs);
  try {
    const Response = await fetch(ArgUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ArgGitHubPat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: Controller.signal,
    });
    if(!Response.ok) return null;
    return await Response.json();
  } catch(error) {
    return null;
  } finally {
    clearTimeout(TimeoutId);
  }
}

/**
 * Fetch recent GitHub activity for a mapped GitHub username.
 * Returns null when all requests fail or return no useful data.
 * @param {string} ArgGitHubPat GitHub personal access token.
 * @param {string} ArgGitHubUsername GitHub username to query.
 * @param {number} [ArgDays] How many days back to look for commit activity.
 * @returns {Promise<{ OpenPRs: string[], ReviewRequested: string[], RecentRepos: string[] }|null>}
 */
async function FetchUserGitHubActivityAsync(ArgGitHubPat, ArgGitHubUsername, ArgDays = GITHUB_ACTIVITY_DAYS) {
  const CutoffDate = new Date(Date.now() - ArgDays * 24 * 60 * 60 * 1000);

  const [OpenPRsData, ReviewRequestedData, EventsData] = await Promise.all([
    FetchGitHubJsonAsync(
      `https://api.github.com/search/issues?q=is:pr+author:${encodeURIComponent(ArgGitHubUsername)}+is:open&sort=updated&per_page=5`,
      ArgGitHubPat,
      GITHUB_ACTIVITY_TIMEOUT_MS
    ),
    FetchGitHubJsonAsync(
      `https://api.github.com/search/issues?q=is:pr+review-requested:${encodeURIComponent(ArgGitHubUsername)}+is:open&per_page=5`,
      ArgGitHubPat,
      GITHUB_ACTIVITY_TIMEOUT_MS
    ),
    FetchGitHubJsonAsync(
      `https://api.github.com/users/${encodeURIComponent(ArgGitHubUsername)}/events?per_page=30`,
      ArgGitHubPat,
      GITHUB_ACTIVITY_TIMEOUT_MS
    ),
  ]);

  if(!OpenPRsData && !ReviewRequestedData && !EventsData) return null;

  const OpenPRs = (OpenPRsData?.items ?? []).map(/** @param {any} ArgPr */ ArgPr => `${ArgPr.title} (${ArgPr.html_url})`);
  const ReviewRequested = (ReviewRequestedData?.items ?? []).map(/** @param {any} ArgPr */ ArgPr => `${ArgPr.title} (${ArgPr.html_url})`);

  const RecentRepos = [];
  const SeenRepos = new Set();
  if(Array.isArray(EventsData)) {
    for(const Event of EventsData) {
      if(Event.type !== 'PushEvent') continue;
      if(new Date(Event.created_at) < CutoffDate) continue;
      const RepoName = Event.repo?.name;
      if(!RepoName || SeenRepos.has(RepoName)) continue;
      SeenRepos.add(RepoName);
      RecentRepos.push(RepoName);
      if(RecentRepos.length >= 5) break;
    }
  }

  return { OpenPRs, ReviewRequested, RecentRepos };
}

/**
 * Parse GITHUB_USER_MAP from workspace config and return the GitHub username for a Slack user ID.
 * Returns null when the field is absent, invalid JSON, or the user is not in the map.
 * @param {import('../workspaces').WorkspaceInfo} ArgWorkspaceInfo
 * @param {string} ArgSlackUserId
 * @returns {string|null}
 */
function LookUpGitHubUsername(ArgWorkspaceInfo, ArgSlackUserId) {
  const RawMap = ArgWorkspaceInfo.GITHUB_USER_MAP;
  if(!RawMap || typeof RawMap !== 'string') return null;
  try {
    const Map = JSON.parse(RawMap);
    const Username = typeof Map === 'object' && Map !== null ? Map[ArgSlackUserId] : null;
    return typeof Username === 'string' && Username.trim().length > 0 ? Username.trim() : null;
  } catch(error) {
    return null;
  }
}

/**
 * Resolve a raw Slack mention (`<@UID>` or `<@UID|name>`) to a bare user ID.
 * @param {string} ArgRawMention
 * @returns {string|null}
 */
function ResolveMentionToUserId(ArgRawMention) {
  const Match = typeof ArgRawMention === 'string' ? ArgRawMention.match(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/) : null;
  return Match ? Match[1] : null;
}

/**
 * Read a user's active (open) reminders through the single shared filter.
 * Membership resolves through `RemindersModule.IsAssignedTo`, the canonical assignee-set helper, so a
 * reminder shared by several people surfaces for every one of them (GH-22). The direct
 * `AssigneeID === user` compare this replaced only ever matched the FIRST assignee, which is the
 * original symptom: the second person's `show-me` silently omitted work assigned to them. Legacy
 * single-assignee records keep working — the same helper falls back to `AssigneeID`, then
 * `OriginalSenderID`, so self-assigned and delegated reminders still resolve.
 * @param {import('../reminders-module')} ArgRemindersModule
 * @param {string} ArgUserId
 * @param {string|null} [ArgBotUserID] Workspace bot ID to exclude from the assignee set.
 * @returns {import('../reminders-module').ReminderInfo[]}
 */
function GetActiveRemindersForUser(ArgRemindersModule, ArgUserId, ArgBotUserID = null) {
  // Deferred require, not a top-level import: src/reminders-module.js reaches this file via
  // connection-surfacing -> reminder-clustering -> show-me-projects-command, so importing at module
  // scope would close a require cycle and capture a half-initialized export. Resolving at call time
  // is cycle-safe and hits Node's module cache.
  const RemindersModule = require('../reminders-module');
  return ArgRemindersModule.GetAllReminders().filter(
    ArgReminder => RemindersModule.IsAssignedTo(ArgReminder, ArgUserId, ArgBotUserID)
      && ACTIVE_REMINDER_STATES.has(ArgReminder.State)
  );
}

/**
 * Build GitHub enrichment context for a target user — the recent-activity summary plus the set of
 * currently-open authored-PR URLs (used to annotate reminders as in-flight work). Returns empty
 * context when GITHUB_PAT / GITHUB_USER_MAP are absent or every fetch fails; never throws.
 * @param {import('../slack-app')} ArgSlackApp
 * @param {string} ArgUserId
 * @returns {Promise<{ GitHubActivity: { OpenPRs: string[], ReviewRequested: string[], RecentRepos: string[] }|null, ActivePRUrls: Set<string> }>}
 */
async function BuildGitHubContextAsync(ArgSlackApp, ArgUserId) {
  const GitHubPat = typeof ArgSlackApp.WorkspaceInfo?.GITHUB_PAT === 'string'
    ? ArgSlackApp.WorkspaceInfo.GITHUB_PAT.trim() || null
    : null;
  const GitHubUsername = GitHubPat
    ? LookUpGitHubUsername(ArgSlackApp.WorkspaceInfo, ArgUserId)
    : null;

  let GitHubActivity = null;
  if(GitHubPat && GitHubUsername) {
    try {
      GitHubActivity = await FetchUserGitHubActivityAsync(GitHubPat, GitHubUsername);
    } catch(error) {
      ArgSlackApp.Logger.warn(`show-me-context: GitHub activity fetch failed for ${ArgUserId}:`, error);
    }
  }

  // build a set of active (open, authored) PR URLs for cross-referencing with reminder GitHub links.
  const ActivePRUrls = new Set();
  if(GitHubActivity) {
    for(const PREntry of GitHubActivity.OpenPRs) {
      const UrlMatch = PREntry.match(/\(([^)]+)\)\s*$/);
      if(UrlMatch) ActivePRUrls.add(UrlMatch[1]);
    }
  }

  return { GitHubActivity, ActivePRUrls };
}

/**
 * Whether a reminder's GitHub links overlap an open authored PR (in-flight work).
 * @param {import('../reminders-module').ReminderInfo} ArgReminder
 * @param {Set<string>} ArgActivePRUrls
 * @returns {boolean}
 */
function ReminderHasActivePR(ArgReminder, ArgActivePRUrls) {
  return Array.isArray(ArgReminder.GitHubUrls) &&
    ArgReminder.GitHubUrls.some(ArgUrl => ArgActivePRUrls.has(ArgUrl));
}

module.exports = {
  ACTIVE_REMINDER_STATES,
  GITHUB_ACTIVITY_TIMEOUT_MS,
  GITHUB_ACTIVITY_DAYS,
  FetchGitHubJsonAsync,
  FetchUserGitHubActivityAsync,
  LookUpGitHubUsername,
  ResolveMentionToUserId,
  GetActiveRemindersForUser,
  BuildGitHubContextAsync,
  ReminderHasActivePR,
};
