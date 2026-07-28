'use strict';

const SlackFormatUtils = require('../slack-format-utils');
const { LoadClientMappingsSync, ResolveClientsFromQuery } = require('../client-mapping');
const { FilterCandidates, ResolveTimeWindow } = require('../reminder-query-engine');
const { AssembleCandidates } = require('../reminder-candidates');
const { ChannelPrivacyCache, UNRESOLVED } = require('../channel-privacy-cache');
const { ChannelMembershipCache } = require('../channel-membership-cache');
const { PostBucketedReminderSectionsAsync } = require('../reminders-display-utils');

// caches by workspace.
const CachesByWorkspace = new Map();
const MembershipCachesByWorkspace = new Map();

// GH-367 P1.4 — route ask-reminders through the deterministic query core. The query is parsed into
// a ReminderQuery, candidates are assembled from the active queue + completion history and narrowed
// deterministically (channel-privacy → time → user → client), and only the narrowed, cited set is
// handed to the model to phrase. An empty result short-circuits with a canned reply and NO model call.
//
// v1 scope (see PROJECT/2-WORKING/GH-367-*.md, /consult-adjudicated; #380 added the assignor role):
//   - user filter covers BOTH assignee ("tasks @X has") and sender/creator ("tasks I created"), the
//     parser picking which by phrasing; "topic" is left to the model over the narrowed set (not a
//     deterministic keyword gate); time windows resolve in the workspace timezone.
//   - channel-privacy scoping is a MUST: private/DM candidates are excluded from workspace-wide Q&A
//     (the channel the command runs in is always allowed); an unknown channel is treated as private.

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

// GH-391 (consult review): each matched open reminder is posted as its OWN Slack message, so an
// unbounded match set would flood the thread and trip Slack rate limits (HTTP 429). Cap the number
// rendered (soonest-due first) and tell the user to narrow when truncated — mirrors show-me's TOP_N.
const MAX_OPEN_REMINDERS_RENDERED = 15;

/**
 * Parse a free-form question into a deterministic ReminderQuery. Extracts the user dimension (by
 * ASSIGNEE for "tasks @X has" phrasings, or by SENDER/creator for "tasks I/@X created" phrasings), a
 * client name, and a time phrase; topic is left to the model (no keyword gate in v1).
 * @param {string} ArgQuery
 * @param {{ clients: any[], nowMs: number, timezone: string, selfUserId?: string|null }} ArgOptions
 *        selfUserId resolves first-person creator queries ("what did I create?") to the asking user.
 * @returns {{ userIds: string[]|null, senderIds: string[]|null, clientId: string|null,
 *            timeWindow: { startMs: number, endMs: number }|null, timeLabel: string|null }}
 */
function ParseReminderQuery(ArgQuery, ArgOptions) {
  const Query = ArgQuery || '';

  /** @type {string[]} */
  const Mentions = [];
  const MentionRe = /<@([A-Z0-9]+)>/g;
  let Match;
  while((Match = MentionRe.exec(Query)) !== null) Mentions.push(Match[1]);

  // Creator/assignor intent keys on a creation VERB (not "open"/"add"/"assign" — those collide with
  // "what's open for X" and the assignee sense). Then: a mention names the creator ("@X created…"), a
  // first-person query ("I"/"we"/"my"/"me created…") means the asking user, and a subject-less
  // "what was created yesterday" applies no user filter (just the time window). Assignee is the default
  // for everything else ("tasks @X has").
  const CreationVerb = /\b(?:creat(?:e|ed|ing)|made|making|authored|rais(?:e|ed|ing)|filed?|logged?|set\s+up)\b/i.test(Query);
  const FirstPerson = /\b(?:i|we|my|me)\b/i.test(Query);

  let UserIds = null;
  let SenderIds = null;
  if(CreationVerb && Mentions.length > 0) {
    SenderIds = Mentions;
  } else if(CreationVerb && FirstPerson && ArgOptions.selfUserId) {
    SenderIds = [ArgOptions.selfUserId];
  } else {
    UserIds = Mentions.length > 0 ? Mentions : null;
  }

  const MatchedClients = ResolveClientsFromQuery(Query, ArgOptions.clients || []);
  const ClientId = MatchedClients.length > 0 ? (MatchedClients[0].ClientID || null) : null;

  const Window = ResolveTimeWindow(Query, ArgOptions.nowMs, ArgOptions.timezone);

  return {
    userIds: UserIds,
    senderIds: SenderIds,
    clientId: ClientId,
    timeWindow: Window ? { startMs: Window.startMs, endMs: Window.endMs } : null,
    timeLabel: Window ? Window.label : null,
  };
}

/**
 * Resolve which of the candidate channels are private (or unknown/unresolved -> treated private, fail-closed).
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {Iterable<string|null>} ArgChannelIds Channel IDs.
 * @param {number} [ArgNowMs] Current time in milliseconds.
 * @returns {Promise<{ private: Set<string>, unresolved: Set<string> }>}
 */
async function BuildPrivateChannelSetAsync(ArgSlackApp, ArgChannelIds, ArgNowMs = Date.now()) {
  /** @type {Set<string>} */
  const Private = new Set();
  /** @type {Set<string>} */
  const Unresolved = new Set();
  const Seen = new Set();

  const WorkspaceName = (ArgSlackApp.WorkspaceInfo && ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME) || 'default';
  let Cache = CachesByWorkspace.get(WorkspaceName);
  if (!Cache) {
    Cache = new ChannelPrivacyCache();
    CachesByWorkspace.set(WorkspaceName, Cache);
  }

  /**
   * @param {string} ArgId
   * @returns {Promise<boolean|null>}
   */
  const LiveResolver = async (ArgId) => {
    if (typeof ArgSlackApp.IsChannelPrivateAsync === 'function') return ArgSlackApp.IsChannelPrivateAsync(ArgId);
    return null;
  };

  for (const ChannelId of ArgChannelIds) {
    if (!ChannelId || Seen.has(ChannelId)) continue;
    Seen.add(ChannelId);

    const IsPrivate = await Cache.ResolvePrivacyAsync(ChannelId, LiveResolver, ArgNowMs);

    if (IsPrivate === UNRESOLVED) {
      Unresolved.add(ChannelId);
      // fail-closed: treat unresolved channels as private.
      Private.add(ChannelId);
    } else if (IsPrivate === true) {
      Private.add(ChannelId);
    }
  }

  return { private: Private, unresolved: Unresolved };
}

/**
 * From the set of private candidate channels, return those the asking user is a confirmed member of.
 * This is the need-to-know half of channel-privacy scoping: a private channel's tasks are surfaced to
 * a workspace-wide query only when the asker actually belongs to that channel, so a legitimate client
 * query (e.g. "what's open for Client D?") reaches the client's private channel for members
 * without leaking it to everyone else. Membership is resolved live (cached per workspace) and
 * fail-closed: an unresolved check (`null` / API error / no resolver) is treated as "not a member".
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {string|null|undefined} ArgUserId The asking user.
 * @param {Iterable<string|null>} ArgPrivateChannelIds Channels already classified private (or unresolved->private).
 * @param {number} [ArgNowMs] Current time in milliseconds.
 * @returns {Promise<string[]>}
 */
async function BuildMemberPrivateChannelSetAsync(ArgSlackApp, ArgUserId, ArgPrivateChannelIds, ArgNowMs = Date.now()) {
  if(!ArgUserId) return [];

  const WorkspaceName = (ArgSlackApp.WorkspaceInfo && ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME) || 'default';
  let Cache = MembershipCachesByWorkspace.get(WorkspaceName);
  if(!Cache) {
    Cache = new ChannelMembershipCache();
    MembershipCachesByWorkspace.set(WorkspaceName, Cache);
  }

  /**
   * @param {string} ArgChannelId
   * @param {string} ArgResolveUserId
   * @returns {Promise<boolean|null>}
   */
  const LiveResolver = async (ArgChannelId, ArgResolveUserId) => {
    if(typeof ArgSlackApp.IsUserChannelMemberAsync === 'function') return ArgSlackApp.IsUserChannelMemberAsync(ArgChannelId, ArgResolveUserId);
    return null;
  };

  /** @type {string[]} */
  const Allowed = [];
  const Seen = new Set();
  for(const ChannelId of ArgPrivateChannelIds) {
    if(!ChannelId || Seen.has(ChannelId)) continue;
    Seen.add(ChannelId);

    const IsMember = await Cache.ResolveMembershipAsync(ChannelId, ArgUserId, LiveResolver, ArgNowMs);
    if(IsMember === true) Allowed.push(ChannelId);
  }

  return Allowed;
}

/**
 * Compact, id-citing rendering of the narrowed candidate set for the model.
 * @param {import('../reminder-query-engine').ReminderCandidate[]} ArgCandidates
 * @returns {string}
 */
function RenderCitedCandidates(ArgCandidates) {
  return ArgCandidates.map(ArgCandidate => {
    const Kind = ArgCandidate.isCompleted ? 'COMPLETED' : 'OPEN';
    // Number.isFinite, not typeof === 'number': AssembleCandidates emits timestampMs: NaN for a
    // completion with a non-numeric completedMs (and NaN is a number), and new Date(NaN).toISOString()
    // throws — so a single malformed record would otherwise crash the whole command.
    const When = ArgCandidate.isCompleted && Number.isFinite(ArgCandidate.timestampMs)
      ? ` completedAt:${new Date(ArgCandidate.timestampMs).toISOString()}`
      : '';
    const Assignee = ArgCandidate.assigneeId ? ` assignee:${ArgCandidate.assigneeId}` : '';
    const Client = ArgCandidate.clientId ? ` client:${ArgCandidate.clientId}` : '';
    return `${Kind} id:${ArgCandidate.id}${Assignee}${Client}${When} — ${ArgCandidate.text || '(no text)'}`; // RENDER-OK: model-input only — the cited set is fed to the LLM, never posted to a user (GH-391)
  }).join('\n');
}

/**
 * Remove internal `id:<token>` citations from model output. Reminder ids are debug context for the
 * model's input only — they must never surface to a user (GH-391). Backstops the system-prompt rule.
 * @param {string} ArgText
 * @returns {string}
 */
function StripInternalReminderIds(ArgText) {
  if(typeof ArgText !== 'string') return ArgText;
  // Match an `id:` citation the model may emit — optional wrapping bracket/paren, optional space
  // after the colon (`id: abc`), the id token, and a trailing bracket/paren + spaces — so nothing
  // (not even empty `[]`) is left behind. Case-insensitive. (consult review: GH-391.)
  return ArgText
    .replace(/[[(]?\bid:\s*[A-Za-z0-9_-]+[\])]?[ \t]*/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trimEnd();
}

/**
 * Normalize an error-like value into a log-safe message string.
 * @param {unknown} ArgError Error-like value.
 * @returns {string}
 */
function GetErrorMessage(ArgError) {
  if(ArgError instanceof Error && typeof ArgError.message === 'string') return ArgError.message;
  return String(ArgError);
}

/**
 * Build a compact log context string for ask-reminders failures.
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @returns {string}
 */
function BuildAskRemindersLogContext(ArgSlackApp, ArgEventInfo) {
  const WorkspaceName = ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME || 'unknown';
  const ChannelID = ArgEventInfo.channel || 'unknown';
  return `workspace=${WorkspaceName} channel=${ChannelID} command=ask-reminders`;
}

/**
 * Handle the `ask-reminders <query>` command — answers free-form questions over live task state and
 * completion history, filtered deterministically before the model sees anything.
 *
 * Available to all workspaces (reads the workspace's own data). Workspace-agnostic.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgQuery User's question, with the `ask-reminders ` prefix stripped.
 * @returns {Promise<any>}
 */
async function HandleAskRemindersCommandAsync(ArgSlackApp, ArgEventInfo, ArgQuery) {
  try {
    if(!ArgQuery || !ArgQuery.trim()) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Please include a question. Example: `ask-reminders what\'s open for Client A?`'
      );
      return { matchedCount: 0, unresolvedCount: 0 };
    }

    const RemindersModule = ArgSlackApp.RemindersModule;
    if(!RemindersModule) {
      ArgSlackApp.Logger.error('ask-reminders: RemindersModule not available on SlackApp');
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "Sorry — couldn't access reminder data. Check the logs."
      );
      return { matchedCount: 0, unresolvedCount: 0 };
    }

    const Timezone = (ArgSlackApp.WorkspaceInfo && ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE) || 'America/Los_Angeles';
    const NowMs = Date.now();
    const Query = ParseReminderQuery(ArgQuery, {
      clients: LoadClientMappingsSync(),
      nowMs: NowMs,
      timezone: Timezone,
      selfUserId: ArgEventInfo.user || null,
    });

    // Source data: the whole active queue, plus completion history scoped to the time window when the
    // query is time-scoped (else the full retention window).
    const ActiveReminders = RemindersModule.GetAllReminders();
    const WindowStart = Query.timeWindow ? Query.timeWindow.startMs : 0;
    const WindowEnd = Query.timeWindow ? Query.timeWindow.endMs : NowMs + RETENTION_MS;
    const CompletedReminders = RemindersModule.GetCompletedRemindersBetween(WindowStart, WindowEnd);

    // Fail-closed channel-privacy resolution over the candidate channels.
    /** @type {Set<string|null>} */
    const CandidateChannels = new Set();
    for(const Reminder of ActiveReminders) CandidateChannels.add(Reminder.OriginalChannelID || Reminder.TargetChannelID || null);
    for(const Completion of CompletedReminders) CandidateChannels.add(Completion.sourceChannelID || null);
    const { private: PrivateChannels, unresolved: UnresolvedChannels } = await BuildPrivateChannelSetAsync(ArgSlackApp, CandidateChannels, NowMs);

    // Need-to-know scoping: the command channel is always allowed, plus any private candidate channel
    // the asking user is a confirmed member of. This keeps multi-tenant isolation (non-members never
    // see a private channel's tasks) while letting members reach their own client/private channels
    // from a workspace-wide query.
    const MemberPrivateChannels = await BuildMemberPrivateChannelSetAsync(ArgSlackApp, ArgEventInfo.user, PrivateChannels, NowMs);
    const AllowedChannelIds = [ArgEventInfo.channel, ...MemberPrivateChannels];

    const Candidates = AssembleCandidates({
      activeReminders: ActiveReminders,
      completedReminders: CompletedReminders,
      isChannelPrivate: (ArgChannelId) => PrivateChannels.has(ArgChannelId),
    });

    const Result = FilterCandidates(Candidates, {
      timeWindow: Query.timeWindow,
      userIds: Query.userIds,
      senderIds: Query.senderIds,
      clientId: Query.clientId,
      channelScope: { allowedChannelIds: AllowedChannelIds },
    });

    if(Result.matchedCount === 0) {
      if (UnresolvedChannels.size >= 1) {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ArgEventInfo.ts,
          `Couldn't verify ${UnresolvedChannels.size} channel(s) right now — results may be incomplete, try again.`
        );
      } else {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ArgEventInfo.ts,
          'No matching tasks found for that query.'
        );
      }
      return { matchedCount: 0, unresolvedCount: UnresolvedChannels.size };
    }

    // GH-391 — reminders always render through the canonical per-reminder poster so each open task is
    // its own reaction-actionable message (✅ complete / 🗑 delete), carrying the ReminderID message
    // metadata the reaction-handler needs. Never a model-phrased text blob, and never a raw internal
    // `id:` user-facing. Open matches resolve back to their live Reminder objects (which carry the Date
    // fields + permalink source the poster needs, exactly as show-me does); completed-history matches —
    // which can't be reaction-completed — keep a concise prose answer with ids stripped.
    const LiveReminderById = new Map();
    for(const Reminder of ActiveReminders) LiveReminderById.set(Reminder.ReminderID, Reminder);

    /** @type {any[]} */
    const OpenMatched = [];
    let CompletedMatchedCount = 0;
    for(const Candidate of Result.matched) {
      if(Candidate.isCompleted) { CompletedMatchedCount++; continue; }
      const LiveReminder = LiveReminderById.get(Candidate.id);
      if(LiveReminder) OpenMatched.push(LiveReminder);
    }

    if(OpenMatched.length > 0) {
      const TotalOpen = OpenMatched.length;
      // Cap the individually-posted messages; when truncated, keep the soonest-due (most urgent/overdue).
      const Rendered = TotalOpen > MAX_OPEN_REMINDERS_RENDERED
        ? [...OpenMatched].sort((ArgLeft, ArgRight) => ArgLeft.ShouldPostOn.getTime() - ArgRight.ShouldPostOn.getTime()).slice(0, MAX_OPEN_REMINDERS_RENDERED)
        : OpenMatched;
      const OpenCount = Rendered.length;
      const Truncated = TotalOpen > MAX_OPEN_REMINDERS_RENDERED;
      const CompletedNote = CompletedMatchedCount > 0
        ? ` (plus ${CompletedMatchedCount} already completed — ask about completed tasks to see those)`
        : '';
      const SummaryMessage = Truncated
        ? `*Showing the ${OpenCount} soonest-due of ${TotalOpen} open tasks* matching your query — narrow it (by client, assignee, or time) to see the rest${CompletedNote}:`
        : `*${OpenCount} open task${OpenCount === 1 ? '' : 's'}* matching your query${CompletedNote}:`;
      await PostBucketedReminderSectionsAsync(
        ArgSlackApp,
        ArgEventInfo,
        Rendered,
        'No matching tasks found for that query.',
        SummaryMessage,
        Timezone,
        { auditTag: 'ask-reminders' }
      );
      return { matchedCount: Result.matchedCount, unresolvedCount: UnresolvedChannels.size };
    }

    // Completed-only history query: nothing open to make reactable, so phrase a concise answer over the
    // matched set. Internal reminder ids are model-input only and are stripped from anything user-facing.
    const SystemPrompt = [
      'You are Sleuth, a task-tracking assistant. You answer questions about reminders.',
      'You ONLY draw on the MATCHING REMINDERS block provided — never invent tasks, clients, or reminder IDs.',
      'The set has already been filtered to the question; answer only from it, and if it does not contain the answer, say so.',
      'Never surface internal reminder ids (e.g. id:abc-123) in your answer — refer to tasks by their description.',
      'Be concise. Use bullet lists when listing multiple items.',
    ].join('\n');

    const UserMessage = `MATCHING REMINDERS (${Result.matchedCount}):\n${RenderCitedCandidates(Result.matched)}\n\n---\n\nQUESTION: ${ArgQuery.trim()}`;

    const AnswerText = await ArgSlackApp.WorkspaceAI.ProcessMessageWithTextResponseAsync(
      UserMessage,
      SystemPrompt,
      ArgSlackApp.WorkspaceAI.ComplexModelName
    );

    const FormattedAnswer = SlackFormatUtils.NormalizeModelMarkdownForSlack(StripInternalReminderIds(AnswerText));
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FormattedAnswer);

    return { matchedCount: Result.matchedCount, unresolvedCount: UnresolvedChannels.size };
  } catch(error) {
    const LogContext = BuildAskRemindersLogContext(ArgSlackApp, ArgEventInfo);
    const OriginalErrorMessage = GetErrorMessage(error);
    ArgSlackApp.Logger.error(`ask-reminders failed (${LogContext}):`, error);

    try {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "Sorry — couldn't complete that query. Check the logs."
      );
    } catch(FallbackError) {
      ArgSlackApp.Logger.error(
        `ask-reminders fallback reply failed (${LogContext} originalError="${OriginalErrorMessage}"):`,
        FallbackError
      );
      ArgSlackApp.Logger.error(
        `ask-reminders fallback delivery unavailable (${LogContext} originalError="${OriginalErrorMessage}"): no DM or ephemeral SlackApp helper is available.`
      );
    }

    return { matchedCount: 0, unresolvedCount: 0 };
  }
}

module.exports = {
  HandleAskRemindersCommandAsync,
  ParseReminderQuery,
  RenderCitedCandidates,
  StripInternalReminderIds,
  // GH-405 (lane p2 review): the deterministic open-count path in chat-module reuses these canonical
  // privacy/membership helpers instead of maintaining a divergent copy. BuildPrivateChannelSetAsync
  // returns { private, unresolved } (both Sets); BuildMemberPrivateChannelSetAsync returns string[].
  BuildPrivateChannelSetAsync,
  BuildMemberPrivateChannelSetAsync,
};
