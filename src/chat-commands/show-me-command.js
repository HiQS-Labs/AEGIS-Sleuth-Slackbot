'use strict';

const SlackFormatUtils = require('../slack-format-utils');
const { BucketRemindersByDueDate, PostBucketedReminderSectionsAsync } = require('../reminders-display-utils');
const {
  GITHUB_ACTIVITY_DAYS,
  FetchUserGitHubActivityAsync,
  ResolveMentionToUserId,
  GetActiveRemindersForUser,
  BuildGitHubContextAsync,
  ReminderHasActivePR,
} = require('./show-me-context');

const SHOW_ME_TOP_N = 5;
const FALLBACK_BUCKET_ORDER = ['dueToday', 'dueUpcoming', 'dueLastWeek', 'dueOlder'];

// legacy note for relay freshness probes: the original prose prompt returned "up to 3 items".
const SYSTEM_INSTRUCTIONS = `You are Sleuth's task prioritization assistant. \
A Slack user wants to know what a colleague should focus on today.

Given this user's current open reminders (and their GitHub activity for the past week when provided), \
rank every reminder from highest to lowest priority and give a short rationale for each one.

Reminder entries include state, description, any linked GitHub issues or PRs, and due date. \
Entries marked [Active PR] have a GitHub pull request that is currently open — these represent in-flight work.

When GitHub activity is provided, cite it in your explanation when it supports the ranking \
(e.g., "you have an open PR for this", "you recently pushed to this repo"). \
When GitHub activity is not provided, reason from reminder signals only — do not reference GitHub.

Return every reminder exactly once in the required JSON schema. Use each ReminderID exactly as provided. \
Never omit an item, never duplicate an item, and never invent a ReminderID.

Each rationale must be one short sentence and should explain why that reminder ranks where it does.

Priority rules (apply in order):
1. Overdue or due today AND marked [Active PR] — in-flight work with a deadline is the highest urgency
2. Overdue with no active PR, or due today without an active PR
3. Due soonest among the remaining scheduled items
4. Snoozed items rank last — the user has intentionally deferred these

If every item is snoozed, keep them ranked last and state that they were intentionally deferred. \
Write in plain, direct language — no corporate jargon.`;

const RANKING_SCHEMA = {
  name: 'show_me_ranked_reminders',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rankedReminders: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ReminderID: { type: 'string', description: 'Exact reminder id from the input set.' },
            rationale: { type: 'string', description: 'One short sentence explaining why this reminder ranks here.' },
          },
          required: ['ReminderID', 'rationale'],
        },
      },
    },
    required: ['rankedReminders'],
  },
};

/**
 * Build the structured cards sent to the ranking model.
 * @param {Array<any>} ArgUserReminders
 * @param {Set<string>} ArgActivePRUrls
 * @returns {Array<{ ReminderID: string, State: string, DueDate: string, Task: string, GitHubUrls: string[], HasActivePR: boolean }>}
 */
function BuildReminderCards(ArgUserReminders, ArgActivePRUrls) {
  return ArgUserReminders.map(ArgReminder => ({
    ReminderID: ArgReminder.ReminderID,
    State: ArgReminder.State ?? 'scheduled',
    DueDate: ArgReminder.ShouldPostOn instanceof Date
      ? ArgReminder.ShouldPostOn.toISOString()
      : 'unknown date',
    Task: ArgReminder.ReminderMessageText,
    GitHubUrls: Array.isArray(ArgReminder.GitHubUrls) ? ArgReminder.GitHubUrls : [],
    HasActivePR: ReminderHasActivePR(ArgReminder, ArgActivePRUrls),
  }));
}

/**
 * Deterministic fallback ordering used when the AI ranking is malformed or unavailable.
 * This keeps today/upcoming/older bucket priority stable, then orders inside each bucket by date.
 * @param {Array<any>} ArgUserReminders
 * @param {string} ArgTimezone
 * @returns {Array<any>}
 */
function BuildDeterministicFallbackOrder(ArgUserReminders, ArgTimezone) {
  const Buckets = BucketRemindersByDueDate(ArgUserReminders, ArgTimezone);
  const Ordered = [];

  for(const BucketKey of FALLBACK_BUCKET_ORDER) {
    const RemindersInBucket = [...Buckets[/** @type {keyof typeof Buckets} */ (BucketKey)]].sort((ArgLeft, ArgRight) => {
      const DueDiff = ArgLeft.ShouldPostOn.getTime() - ArgRight.ShouldPostOn.getTime();
      if(BucketKey === 'dueLastWeek' || BucketKey === 'dueOlder')
        return DueDiff !== 0 ? -DueDiff : ArgLeft.ReminderID.localeCompare(ArgRight.ReminderID);
      return DueDiff !== 0 ? DueDiff : ArgLeft.ReminderID.localeCompare(ArgRight.ReminderID);
    });

    Ordered.push(...RemindersInBucket);
  }

  return Ordered;
}

/**
 * Normalize model-provided rationale into Slack-safe plain text.
 * @param {string} ArgRationale
 * @returns {string}
 */
function NormalizeRationale(ArgRationale) {
  const Normalized = SlackFormatUtils.NormalizeUserMentionsToMrkdwn(
    SlackFormatUtils.NormalizeModelMarkdownForSlack(String(ArgRationale ?? '').trim())
  );
  return Normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Validate the ranking response and fall back deterministically on any mismatch.
 * @param {import('../slack-app')} ArgSlackApp
 * @param {Array<any>} ArgUserReminders
 * @param {{ rankedReminders?: Array<{ ReminderID?: string, rationale?: string }> }|null|undefined} ArgResponse
 * @returns {{ RankedReminders: Array<any>, RationaleByReminderId: Record<string, string>, UsedFallback: boolean }}
 */
function ResolveRankingWithFallback(ArgSlackApp, ArgUserReminders, ArgResponse) {
  const Timezone = ArgSlackApp.WorkspaceInfo?.MAIN_TIMEZONE || 'UTC';
  const Fallback = () => ({
    RankedReminders: BuildDeterministicFallbackOrder(ArgUserReminders, Timezone),
    RationaleByReminderId: {},
    UsedFallback: true,
  });

  const RankedReminders = ArgResponse?.rankedReminders;
  if(!Array.isArray(RankedReminders) || RankedReminders.length !== ArgUserReminders.length) {
    ArgSlackApp.Logger.warn('show-me: ranking response length mismatch; falling back to deterministic order.');
    return Fallback();
  }

  const ReminderById = new Map(ArgUserReminders.map(ArgReminder => [ArgReminder.ReminderID, ArgReminder]));
  const SeenReminderIDs = new Set();
  const OrderedReminders = [];
  /** @type {Record<string, string>} */
  const RationaleByReminderId = {};

  for(const RankedEntry of RankedReminders) {
    if(typeof RankedEntry?.ReminderID !== 'string' || typeof RankedEntry?.rationale !== 'string') {
      ArgSlackApp.Logger.warn('show-me: ranking response had an invalid entry shape; falling back to deterministic order.');
      return Fallback();
    }

    const Reminder = ReminderById.get(RankedEntry.ReminderID);
    const Rationale = NormalizeRationale(RankedEntry.rationale);
    if(!Reminder || SeenReminderIDs.has(RankedEntry.ReminderID) || Rationale.length === 0) {
      ArgSlackApp.Logger.warn('show-me: ranking response had a missing, duplicate, or blank reminder entry; falling back to deterministic order.');
      return Fallback();
    }

    SeenReminderIDs.add(RankedEntry.ReminderID);
    OrderedReminders.push(Reminder);
    RationaleByReminderId[RankedEntry.ReminderID] = Rationale;
  }

  return {
    RankedReminders: OrderedReminders,
    RationaleByReminderId,
    UsedFallback: false,
  };
}

/**
 * Handle `@Sleuth show-me @user` — AI-ranked priority list for the tagged user's open reminders.
 * No admin gate: any workspace member can query any user.
 *
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @param {string} ArgRawMention Raw Slack mention captured by the router, e.g. `<@U000EXAMPLE1>`.
 * @param {{ WorkspaceAI: import('../workspace-ai'), RemindersModule: import('../reminders-module')|null }} ArgDeps
 * @returns {Promise<void>}
 */
async function HandleShowMeCommandAsync(ArgSlackApp, ArgEventInfo, ArgRawMention, ArgDeps) {
  if(!ArgDeps.RemindersModule) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'show-me is unavailable — reminders module is not loaded.'
    );
    return;
  }

  const TargetUserId = ResolveMentionToUserId(ArgRawMention);
  if(!TargetUserId) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "I couldn't find a valid @mention. Try: `@Sleuth show-me @username`"
    );
    return;
  }

  const UserReminders = GetActiveRemindersForUser(ArgDeps.RemindersModule, TargetUserId);

  if(UserReminders.length === 0) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `No open reminders found for <@${TargetUserId}>. Nothing to prioritize right now.`
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    `:hourglass_flowing_sand: Reviewing ${UserReminders.length} open reminder${UserReminders.length === 1 ? '' : 's'} for <@${TargetUserId}>…`
  );

  // attempt GitHub activity enrichment when GITHUB_USER_MAP and GITHUB_PAT are configured.
  const { GitHubActivity, ActivePRUrls } = await BuildGitHubContextAsync(ArgSlackApp, TargetUserId);

  const TodayDateStr = new Date().toDateString();
  const ReminderCards = BuildReminderCards(UserReminders, ActivePRUrls);
  let PromptText =
    `Today is ${TodayDateStr}.\n\n` +
    `Open reminders assigned to this user (${UserReminders.length} total):\n` +
    `${JSON.stringify(ReminderCards, null, 1)}`;

  if(GitHubActivity) {
    const ActivityLines = [];
    if(GitHubActivity.OpenPRs.length > 0)
      ActivityLines.push(`Open PRs authored: ${GitHubActivity.OpenPRs.join('; ')}`);
    if(GitHubActivity.ReviewRequested.length > 0)
      ActivityLines.push(`PRs awaiting review: ${GitHubActivity.ReviewRequested.join('; ')}`);
    if(GitHubActivity.RecentRepos.length > 0)
      ActivityLines.push(`Repos pushed to in the last ${GITHUB_ACTIVITY_DAYS} days: ${GitHubActivity.RecentRepos.join(', ')}`);
    if(ActivityLines.length > 0)
      PromptText += `\n\nGitHub activity (last ${GITHUB_ACTIVITY_DAYS} days):\n${ActivityLines.join('\n')}`;
  }

  try {
    const Response = /** @type {{ rankedReminders?: Array<{ ReminderID?: string, rationale?: string }> }} */ (
      await ArgDeps.WorkspaceAI.ProcessMessageWithJsonResponseAsync(
        PromptText,
        SYSTEM_INSTRUCTIONS,
        RANKING_SCHEMA
      )
    );
    const RankingResult = ResolveRankingWithFallback(ArgSlackApp, UserReminders, Response);
    const RankedReminders = RankingResult.RankedReminders.slice(0, SHOW_ME_TOP_N);
    const SummaryMessage = RankingResult.UsedFallback
      ? `*Top ${RankedReminders.length} priorities for <@${TargetUserId}>*`
      : `*Top ${RankedReminders.length} priorities for <@${TargetUserId}>*`;

    await PostBucketedReminderSectionsAsync(
      ArgSlackApp,
      ArgEventInfo,
      RankedReminders,
      `No ranked reminders available for <@${TargetUserId}>.`,
      SummaryMessage,
      ArgSlackApp.WorkspaceInfo?.MAIN_TIMEZONE || 'UTC',
      {
        preserveInputOrder: true,
        reminderAnnotationsById: RankingResult.RationaleByReminderId,
      }
    );
  } catch(ArgError) {
    ArgSlackApp.Logger.warn('show-me: AI ranking failed; falling back to deterministic order:', ArgError);
    const RankedReminders = BuildDeterministicFallbackOrder(
      UserReminders,
      ArgSlackApp.WorkspaceInfo?.MAIN_TIMEZONE || 'UTC'
    ).slice(0, SHOW_ME_TOP_N);

    await PostBucketedReminderSectionsAsync(
      ArgSlackApp,
      ArgEventInfo,
      RankedReminders,
      `No ranked reminders available for <@${TargetUserId}>.`,
      `*Top ${RankedReminders.length} priorities for <@${TargetUserId}>*`,
      ArgSlackApp.WorkspaceInfo?.MAIN_TIMEZONE || 'UTC',
      { preserveInputOrder: true }
    );
  }
}

module.exports = HandleShowMeCommandAsync;
// re-exported from show-me-context — preserves the historical show-me public surface for callers/tests.
module.exports.FetchUserGitHubActivityAsync = FetchUserGitHubActivityAsync;
