'use strict';
const ContextResolution = require('./reminder-context-resolution');

const {
  BuildCompactTextForReminder,
  PostRemindersListAsync,
  PostBucketedReminderSectionsAsync,
  TruncateCompactSummary,
} = require('./reminders-display-utils');
const DateUtils = require('./date-utils');
const { ExtractGitHubUrls } = require('./github-url-utils');
const {
  LoadClientMappingsSync,
  ResolveClientsFromQuery,
  DoesReminderMatchClient,
} = require('./client-mapping');
const { CommandRouter } = require('./chat-command-router');
const { summarizeWeekFromEvents } = require('./summarize-week-projection');
const { IsProjectionRequested } = require('./reminders-projection');
const HandleRememberAboveCommandAsync = require('./chat-commands/remember-above-command');
const HandleSendToGithubCommandAsync = require('./chat-commands/send-to-github-command');

// Shared regex for "do/handle/complete the above" shorthand. Referenced by both the
// app_mention CommandRouter route and TryHandleTaskAboveShorthandAsync (called from the
// message-event path when @Sleuth is not explicitly mentioned).
// `follow\s+(?:up\s+)?on` covers both "follow up on above" and the shorter "follow on above" —
// GH-424 found the latter fell through to the plain LLM path with no thread context, so the
// reminder title kept the literal word "above" instead of resolving it.
const TASK_ABOVE_SHORTHAND_PATTERN = /\b(?:can\s+you\s+|please\s+)?(?:do|handle|complete|take\s+care\s+of|tackle|finish|follow\s+(?:up\s+)?on|knock\s+out)\s+(?:the\s+|this\s+)?above(?:\s+(?:for\s+)?(<@[^>]+>))?(?:\s+(.+))?\s*$/i;

// `remember above` is a standalone, no-argument command — it must BE the message (after the bot
// mention + optional "please"), not merely appear inside it. The previous unanchored matcher
// (`/\bremember\s+above\b/i`) fired on any sentence containing the phrase, so asking ABOUT the
// command — e.g. `@Sleuth ask-code <slug> how does the remember above command work?` or `what is remember
// above?` — silently captured the thread. Because a false positive here is a real write (not a
// suggestion), this anchors both ends rather than only the tail: the command must stand alone.
const REMEMBER_ABOVE_PATTERN = /^\s*(?:<@[^>]+>\s*)?(?:please\s+)?remember\s+above\b[\s.!?]*$/i;

const SEND_TO_GITHUB_PATTERN = /^\s*(?:<@[^>]+>\s*)?(?:please\s+)?send\s+to\s+github(?:[:\s]+(.+))?$/i;

// Matches vague self-assignment completions like "will do it at 10pm", "I'll handle it tomorrow",
// "gonna take care of it today". The task object must be a vague pronoun (it/this/that) so we
// know the speaker is referring to something already in the thread rather than naming a specific task.
const VAGUE_COMPLETION_IN_THREAD_PATTERN = /\b(?:(?:i(?:'ll|'m\s+going\s+to|\s+will|\s+can|\s+am\s+going\s+to)|\bwill\b|gonna|going\s+to|can)\s+)?(?:do|handle|take\s+care\s+of|finish|complete|get\s+to|tackle|work\s+on)\s+(?:it|this|that)\b/i;

// Matches a vague pronoun reference where the pronoun is NOT the direct object of a completion
// verb (that case is VAGUE_COMPLETION_IN_THREAD_PATTERN above) but is instead the object of a
// preposition or a communication/review verb the completion pattern omits — e.g.
// "talk to @X more about it", "follow up on it", "look into it", "deal with it", "go over it",
// "circle back on this", "discuss it", "review it", "send it". In all of these the real task
// lives 1-3 messages earlier in the thread, so the pronoun must be resolved from prior context
// rather than taken literally. "this"/"that" are excluded when they form a temporal phrase
// ("on this week", "into that morning"); "it" is never temporal so it carries no such guard
// (otherwise "send it monday" would be wrongly dropped, with "monday" being the schedule).
// GH-424: matches the literal standalone word "above" anywhere in a thread reply, regardless of
// the verb phrasing that precedes it ("follow on above", "see above", "check above", "per above",
// "as noted above" — anything). Deliberately verb-agnostic: TASK_ABOVE_SHORTHAND_PATTERN's
// enumerated verb list is a losing whack-a-mole (each new phrasing needs its own regex entry;
// GH-424 alone needed two rounds — "follow up on" then "follow on" — and "see above" still slipped
// through). "above" is a much less ambiguous signal than the it/this/that pronouns above: it is
// essentially never used except to point at earlier thread content, so no verb/preposition guard
// is needed. Still gated by the caller's HasSchedulingTrigger check, same as the pronoun patterns,
// so a purely informational "see above" with no time reference does not fire the AI unnecessarily.
const ABOVE_REFERENCE_PATTERN = /\babove\b/i;

const VAGUE_REFERENCE_IN_THREAD_PATTERN = new RegExp(
  '\\b' +
  '(?:' +
    '(?:about|on|onto|into|with|around|regarding|re|over)' +              // pronoun as object of a preposition
    '|' +
    '(?:discuss|revisit|review|send|check|address|present|share|update)' + // pronoun as direct object of a review/comms verb
  ')\\s+' +
  '(?:it\\b|(?:this|that)\\b(?!\\s+(?:week|month|year|day|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b))',
  'i',
);

// GH-55. The general rule the three patterns above are each a special case of: an unresolved pronoun
// means "the task is elsewhere" — but ONLY when the pronoun is the grammatical OBJECT, not the
// SUBJECT. "get **it** done by Monday" points at earlier work; "**it** will rain on friday" is small
// talk that happens to contain a pronoun and a weekday.
//
// This is deliberately NOT a fourth verb list. VAGUE_COMPLETION_IN_THREAD_PATTERN enumerates
// do/handle/finish/get-to/…, and the comment on ABOVE_REFERENCE_PATTERN above already documents why
// that approach loses: every new phrasing needs its own entry. `get <pronoun> done` is exactly such a
// miss — the pronoun sits BETWEEN verb and participle, a shape no entry in that list has, and adding
// one would buy this case and lose the next.
//
// Object position is decided instead by two CLOSED word classes. Neither grows when someone invents
// a new way to say "finish this", which is the property that makes this rule terminal rather than
// another round of whack-a-mole:
//   1. Clause boundaries — a pronoun that opens a clause is that clause's subject.
//   2. Auxiliaries and modals — a pronoun immediately followed by one is the subject of that verb.
// A pronoun that is neither clause-initial nor followed by an auxiliary is an object.
//
// Both tests are needed; each alone admits a false positive the other rejects:
//   "I think it will rain on friday" is not clause-initial  -> only the auxiliary test rejects it.
//   "this is due tomorrow and it is fine" has `it` after a
//   coordinator                                             -> only the boundary test rejects it.
const CLAUSE_BOUNDARY_BEFORE_PRONOUN =
  /(?:^|[.,;:!?—-]|\b(?:and|but|or|so|because|that|which|when|while|if|then|though|although|since|unless)\b)\s*$/i;

const SUBJECT_AUXILIARY_AFTER_PRONOUN =
  /^\s*(?:'ll|'d|'s|’ll|’d|’s|is|isn't|are|aren't|was|wasn't|were|weren't|will|won't|would|wouldn't|can|can't|cannot|could|couldn't|shall|should|shouldn't|may|might|must|mustn't|has|hasn't|have|haven't|had|hadn't|does|doesn't|do|don't|did|didn't|seems|looks|sounds)\b/i;

// Same temporal exclusion VAGUE_REFERENCE_IN_THREAD_PATTERN applies: "discuss this week" schedules,
// it does not refer. Only demonstratives can be temporal — "it" never is, which is why "send it
// monday" must stay a reference.
const TEMPORAL_PHRASE_AFTER_DEMONSTRATIVE =
  /^\s*(?:week|month|year|day|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/**
 * True when ArgText contains a vague pronoun (it/this/that) in OBJECT position — the general
 * grammatical signal that the real task lives in an earlier message. Exported for tests so the
 * corpus in PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md is a fixture rather than a comment.
 * @param {string} ArgText
 * @returns {boolean}
 */
function IsObjectPositionPronounReference(ArgText) {
  // GH-143 Phase 2: the rule itself now lives in reminder-context-resolution.js so every entry
  // path asks the same question. Kept here as a named re-export because the GH-55 noise corpus
  // (tests/gh55-antecedent-resolution.test.js) is a fixture against the PRODUCTION rule.
  return ContextResolution.IsObjectPositionPronounReference(ArgText);
}

// GH-55 channel-lookback recency window. Named constants with a rationale rather than magic numbers,
// because both are the difference between "resolved the antecedent" and "stitched the wrong one".
//
// MAX_AGE: the reported production failure had 47 minutes between the task and the follow-up, so a
// window under an hour would not have fixed the case this issue was filed for. Two hours covers a
// working session's back-and-forth without reaching into yesterday's unrelated conversation.
// SCAN_LIMIT: one conversations.history page. The participant-continuity filter — not the page size —
// is what decides correctness, so a larger page buys nothing but latency.
const CHANNEL_ANTECEDENT_MAX_AGE_SECONDS = 2 * 60 * 60;
const CHANNEL_ANTECEDENT_SCAN_LIMIT = 30;

// Temporal-cue prefilter used by:
//   - RemindersModule#OnMessageAsync (gates LLM auto-scheduling — see 1.4.142)
//   - OnAppMentionAsync (combined with @-mention to detect task-assignment shape)
//   - TryEnrichVagueCompletionFromAboveAsync (precondition for context-enrichment path)
// Errs toward letting messages THROUGH to the LLM — false positives are harmless (the model
// still decides); false negatives silently drop legitimate reminder requests. Alternatives:
//   - keyword triggers: by/before/after/until/due/deadline/eod/cob/end of
//   - relative days/parts: today/tomorrow/yesterday/tonight/noon/midnight/morning/afternoon/evening
//   - weekdays: monday..sunday
//   - next/this/last <unit>: next week/month/year/<weekday>/morning/afternoon/evening
//   - relative offsets: in {a|an|N} {min|hr|hour|day|week|month}s — N tightens the digit arm
//   - calendar dates: {jan..dec} {1..31}[st|nd|rd|th] (e.g. "May 30", "June 1st")
//   - ordinal day-of-month: "the 15th"
//   - times: hh:mm[am|pm] or h{am|pm} — bare digits like "issue #15" or "page 12" do NOT match
// Bare `asap` is intentionally handled outside this shared regex so it can require stronger
// surrounding reminder-intent language before it trips the temporal gate.
const SCHEDULING_TRIGGER_PATTERN = new RegExp(
  '\\b(?:' + [
    'by|before|after|until|due|deadline|eod|cob|end\\s+of',
    'tomorrow|today|yesterday|tonight',
    'noon|midnight|morning|afternoon|evening',
    'monday|tuesday|wednesday|thursday|friday|saturday|sunday',
    '(?:next|this|last)\\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)',
    'in\\s+(?:a|an|\\d+)\\s+(?:min(?:ute)?s?|hr|hrs|hour|hours|day|days|week|weeks|month|months)',
    '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{1,2}(?:st|nd|rd|th)?',
    'the\\s+\\d{1,2}(?:st|nd|rd|th)',
    '\\d{1,2}:\\d{2}(?:\\s*(?:am|pm))?',
    '\\d{1,2}\\s*(?:am|pm)',
  ].join('|') + ')\\b',
  'i',
);

const ASAP_TRIGGER_PATTERN = /\basap\b/i;

/**
 * @typedef {Object} ReminderInfo
 */

/**
 * Handle all Slack app_mention events including commands like "show reminders", "search reminders", etc.
 * Extracted from RemindersModule to reduce that class to pure scheduling/orchestration logic.
 */
class RemindersAppMentionHandler {
  /** @type {any} */
  #GetPendingReminders;
  /** @type {any} */
  #GetRemindersTargetingUserID;
  /** @type {any} */
  #GetRemindersInvolvingUserID;
  /** @type {any} */
  #GetGitHubSyncModule;
  /** @type {any} */
  #GetListsModule;
  /** @type {(ArgStartMs: number, ArgEndMs: number) => Array<{reminderId: string, summary: string|null, assigneeID: string|null, completedMs: number}>} */
  #GetCompletedRemindersBetween;
  /** @type {() => Promise<Array<object>>} Read the non-authoritative event ledger (staged summarize-week cutover). */
  #ReadAllEventsAsync;
  /** @type {any} */
  #GetChannelSettings;
  // FSM gateway injected by RemindersModule — routes through #TryScheduleRemindersAsync which
  // enforces AI analysis, dedup, date extraction, channel resolution, and #MakeScheduledReminder.
  // Never bypass this with a direct write to the reminder queue.
  /** @type {any} */
  #TryScheduleRemindersAsync;
  /** @type {any} */
  #CheckRemindersAsync;
  /** @type {any} */
  #GetClientMappings;
  /** @type {CommandRouter} */
  #CommandRouter;

  // Optional pipeline for multi-task extraction (whole-thread, propose-and-confirm).
  // Either injected directly (AIPipeline) or resolved lazily at call-time (GetAIPipeline).
  // When both are absent the legacy single-task path is used.
  /** @type {any} */
  #AIPipeline;
  /** @type {(() => any)|null} */
  #GetAIPipeline;

  // Proposal store: keyed by `${channel}:${thread_ts}`, holds extracted candidates pending confirm.
  // Cleared after confirm or explicit cancel. Nothing is scheduled while this map has an entry.
  /** @type {Map<string, {candidates: Array<any>, clientId: string|null}>} */
  #PendingProposals = new Map();

  /**
   * @param {any} ArgDependencies
   */
  constructor(ArgDependencies) {
    this.#GetPendingReminders = ArgDependencies.GetPendingReminders;
    this.#GetRemindersTargetingUserID = ArgDependencies.GetRemindersTargetingUserID;
    this.#GetRemindersInvolvingUserID = ArgDependencies.GetRemindersInvolvingUserID;
    this.#GetGitHubSyncModule = ArgDependencies.GetGitHubSyncModule;
    this.#GetListsModule = ArgDependencies.GetListsModule || (/** @returns {any} */ () => null);
    this.#GetCompletedRemindersBetween = ArgDependencies.GetCompletedRemindersBetween || (() => []);
    this.#ReadAllEventsAsync = ArgDependencies.ReadAllEventsAsync || (async () => []);
    this.#GetChannelSettings = ArgDependencies.GetChannelSettings;
    this.#TryScheduleRemindersAsync = ArgDependencies.TryScheduleRemindersAsync;
    this.#CheckRemindersAsync = ArgDependencies.CheckRemindersAsync;
    this.#GetClientMappings = ArgDependencies.GetClientMappings || (() => LoadClientMappingsSync());
    this.#AIPipeline = ArgDependencies.AIPipeline || null;
    this.#GetAIPipeline = ArgDependencies.GetAIPipeline || null;
    this.#CommandRouter = new CommandRouter();
    this.#RegisterCommandRoutes();
  }

  /**
   * Show reminders for a user using deterministic command routing.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {string} ArgUserMention
   * @param {{ limitToCurrentChannel?: boolean }} [ArgOptions]
   * @returns {Promise<boolean>}
   */
  async ShowRemindersForUserDeterministicAsync(ArgSlackApp, ArgEventInfo, ArgUserMention, ArgOptions) {
    const DeterministicEventInfo = { ...ArgEventInfo };
    const LimitToCurrentChannel = ArgOptions?.limitToCurrentChannel === true;
    DeterministicEventInfo.text = LimitToCurrentChannel
      ? `${ArgUserMention} here`
      : ArgUserMention;

    return await this.#HandleShowRemindersForUserAsync(
      ArgSlackApp,
      DeterministicEventInfo,
      ArgUserMention
    );
  }

  /**
   * Match the "do/handle/complete the above" shorthand against a raw message-event text and,
   * if matched, create a reminder from the nearest preceding human message in the thread.
   * Called by RemindersModule#OnMessageAsync so the shorthand works even when @Sleuth is
   * not mentioned (i.e. the event is a message event, not an app_mention event).
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>} true if the shorthand matched and was handled
   */
  async TryHandleTaskAboveShorthandAsync(ArgSlackApp, ArgEventInfo) {
    const Match = (ArgEventInfo.text || '').match(TASK_ABOVE_SHORTHAND_PATTERN);
    if (!Match) return false;
    const [, TrailingMention, ScheduleText] = Match;
    const UserMention = TrailingMention || this.#ExtractTargetMentionFromText(ArgEventInfo) || `<@${ArgEventInfo.user}>`;
    return await this.#HandleCreateReminderFromTaskAboveAsync(ArgSlackApp, ArgEventInfo, UserMention, ScheduleText || '');
  }


  /**
   * When a thread reply refers to its task only through a vague pronoun ("it"/"this"/"that") or
   * the literal word "above" — and carries a scheduling trigger — prepend the preceding human
   * thread messages so the AI extracts the actual task title instead of the placeholder
   * reference. Three reference shapes are caught:
   *   1. Direct-object completion — "will do it at 10pm", "I'll handle it tomorrow"
   *      (VAGUE_COMPLETION_IN_THREAD_PATTERN).
   *   2. Prepositional / communication-verb reference — "talk to @X more about it tomorrow",
   *      "follow up on it", "discuss it next week" (VAGUE_REFERENCE_IN_THREAD_PATTERN). This is
   *      the case the original completion-only pattern missed: the pronoun is the object of a
   *      preposition rather than a direct object, so the literal "it" would otherwise become the
   *      reminder title.
   *   3. Any phrasing containing the standalone word "above" (ABOVE_REFERENCE_PATTERN) —
   *      "follow on above", "see above", "check above", "per above" — GH-424. Deliberately
   *      verb-agnostic, unlike TASK_ABOVE_SHORTHAND_PATTERN's enumerated verb list: "above" is
   *      never ambiguous, so there is no whack-a-mole list of verbs to maintain here.
   * Up to the last 3 preceding human messages are prepended (the referent is often a few turns
   * back, not just the immediately prior message). Falls through (returns false) when no schedule
   * indicator is present, there is no preceding human message, or the AI ultimately decides not
   * to schedule.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>} true if a reminder was successfully scheduled with enriched context
   */
  async TryEnrichVagueCompletionFromAboveAsync(ArgSlackApp, ArgEventInfo) {
    const Text = ArgEventInfo.text || '';
    // ADMISSION rules stay here — they are this path's own (a scheduling trigger must be present
    // so a purely informational "see above" never spends a model call). The CONTEXT question is
    // delegated, so this path and the reaction path cannot disagree about it (GH-143 Phase 2).
    if(!ContextResolution.NeedsEarlierContext(Text)) return false;
    const TriggerMatch = this.#GetSchedulingTriggerMatch(Text);
    if(!TriggerMatch) return false;
    if(this.#ShouldSuppressHypotheticalSubordinateReply(Text)) {
      ArgSlackApp.Logger.info(
        `reminder enrichment guard: path=hypothetical_subordinate_reply temporal_trigger="${TriggerMatch}" action=skip_without_ai`
      );
      return true;
    }

    const Context = await ContextResolution.ResolveContextAsync(ArgSlackApp, ArgEventInfo);
    if(!Context.enriched) return false;

    ArgSlackApp.Logger.info(
      `reminder path fired: path=${Context.enrichment?.Path} enrichment=${Context.decidedBy}` +
      ` temporal_trigger="${TriggerMatch}" prepended_messages=${Context.prependedCount}` +
      ` antecedent_ts=${Context.enrichment?.SourceTs || 'none'}`
    );
    return await this.#TryScheduleRemindersAsync(
      ArgSlackApp,
      Context.text,
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      ArgEventInfo.user,
      false,
      ArgEventInfo.thread_ts ?? null,
      Context.liveReplyText,
      true,
      Context.enrichment
    );
  }

  /**
   * Whether channel-level antecedent lookback is armed. Default OFF — this is a kill switch for a
   * change that increases `conversations.history` + OpenAI call volume on a live workspace, not a
   * phase gate. Unset (or any unrecognized value) leaves the enrichment path thread-only, exactly
   * as it behaved before GH-55.
   * @returns {boolean}
   */
  static IsChannelAntecedentLookbackEnabled() {
    return ContextResolution.IsChannelAntecedentLookbackEnabled();
  }

  /**
   * Collect a channel antecedent for a TOP-LEVEL message (GH-55). Distinct from
   * `#CollectPrecedingHumanThreadMessagesAsync`, which returns `[]` when there is no thread and
   * walks `conversations.replies`; this walks `conversations.history` on the channel timeline.
   *
   * **Participant continuity is the load-bearing filter, not recency.** A busy channel interleaves
   * conversations, so time + message count alone will happily stitch "get it done by Friday" onto an
   * unrelated mention three messages earlier. A thread is an explicit human assertion that messages
   * belong together; a channel offers no such signal, so we require the next best one: the candidate
   * must be from the follow-up's own author, or must mention them.
   *
   * Returns at most ONE message. The thread path prepends up to 3 because a thread bounds the
   * conversation for us; here every extra message is another chance to stitch the wrong one, and
   * every extra `<@U…>` in the block is another assignee the mentions fallback may pick up.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<Array<any>>}
   */
  async #CollectChannelAntecedentCandidatesAsync(ArgSlackApp, ArgEventInfo) {
    const Recent = await ArgSlackApp.GetRecentChannelMessagesAsync(
      ArgEventInfo.channel,
      CHANNEL_ANTECEDENT_SCAN_LIMIT
    );
    const CurrentTs = Number(ArgEventInfo.ts);
    const AuthorMentionToken = ArgEventInfo.user ? `<@${ArgEventInfo.user}>` : null;

    // conversations.history returns newest-first; walk it in that order so the FIRST match is the
    // most recent qualifying antecedent.
    for(const Candidate of Recent) {
      if(!Candidate?.text || Candidate.bot_id) continue;
      const CandidateTs = Number(Candidate.ts);
      if(!Number.isFinite(CandidateTs) || CandidateTs >= CurrentTs) continue;
      if(CurrentTs - CandidateTs > CHANNEL_ANTECEDENT_MAX_AGE_SECONDS) break;
      const SameAuthor = Boolean(ArgEventInfo.user) && Candidate.user === ArgEventInfo.user;
      const MentionsAuthor = Boolean(AuthorMentionToken) && Candidate.text.includes(AuthorMentionToken);
      if(SameAuthor || MentionsAuthor) return [Candidate];
    }
    return [];
  }

  /**
   * Returns true if ArgText contains at least one temporal keyword that could anchor a reminder.
   * Public wrapper used by `RemindersModule#OnMessageAsync` to gate LLM auto-scheduling — without
   * a time anchor the model must hallucinate both trigger and task title (1.4.142).
   *
   * **Shared-regex coupling:** this delegates to the same `SCHEDULING_TRIGGER_PATTERN` consumed
   * by `OnAppMentionAsync` (task-assignment detection) and `TryEnrichVagueCompletionFromAboveAsync`
   * (vague-completion enrichment precondition). Tightening the regex to fix a recall gap in the
   * gate will also tighten those two paths. If you need a gate-specific behavior, factor a new
   * pattern rather than mutating the shared one. See the module-level comment block on
   * `SCHEDULING_TRIGGER_PATTERN` for the full list of consumers.
   *
   * @param {string} ArgText
   * @returns {boolean}
   */
  HasSchedulingTrigger(ArgText) {
    return this.#HasSchedulingTrigger(ArgText);
  }

  /**
   * Return the first matched scheduling trigger text from the shared temporal regex.
   * @param {string} ArgText
   * @returns {string|null}
   */
  GetSchedulingTriggerMatch(ArgText) {
    return this.#GetSchedulingTriggerMatch(ArgText);
  }

  /**
   * Expose the registered reminder routes for validation tooling.
   * @returns {any[]}
   */
  GetRegisteredCommandRoutes() {
    return this.#CommandRouter.GetRoutes();
  }

  /**
   * Extract the SlackApp instance injected into the routed event wrapper.
   * @param {any} ArgEventInfo
   * @returns {any}
   */
  #GetSlackAppFromRoutedEvent(ArgEventInfo) {
    return /** @type {any} */ (ArgEventInfo).SlackApp;
  }

  /**
   * Register deterministic reminder app-mention routes. Ordering matters: more specific
   * commands must register before broader list/show/search routes.
   * @returns {void}
   */
  #RegisterCommandRoutes() {
    this.#CommandRouter.Register({
      Pattern: /\btest\s+random\s+reminder\b/i,
      Route: 'test-random-reminder',
      Handle: async (ArgEventInfo) => {
        await this.#HandleTestRandomReminderAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\btest\s+reminder\s+([a-f0-9-]+)\b/i,
      Route: 'test-reminder-by-id',
      Handle: async (ArgEventInfo, ArgReminderId) => {
        await this.#HandleTestReminderByIdAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, ArgReminderId);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:make|create|set)\s+(?:a\s+)?(?:sleuth\s+)?reminder\s+for\s+(<@[^>]+>)(?:\s+(?:based\s+on|from)\s+(?:the\s+)?(?:task|message)\s+above)(?:\s+(.+))?\s*$/i,
      Route: 'create-reminder-from-task-above',
      Handle: async (ArgEventInfo, ArgUserMention, ArgScheduleText) => {
        await this.#HandleCreateReminderFromTaskAboveAsync(
          this.#GetSlackAppFromRoutedEvent(ArgEventInfo),
          ArgEventInfo,
          ArgUserMention,
          ArgScheduleText || ''
        );
      },
    });

    this.#CommandRouter.Register({
      Pattern: TASK_ABOVE_SHORTHAND_PATTERN,
      Route: 'create-reminder-from-task-above-shorthand',
      Handle: async (ArgEventInfo, ArgTrailingMention, ArgScheduleText) => {
        const SlackApp = this.#GetSlackAppFromRoutedEvent(ArgEventInfo);
        const UserMention = ArgTrailingMention || this.#ExtractTargetMentionFromText(ArgEventInfo) || `<@${ArgEventInfo.user}>`;
        await this.#HandleCreateReminderFromTaskAboveAsync(SlackApp, ArgEventInfo, UserMention, ArgScheduleText || '');
      },
    });

    // `remember above` — capture the current thread into the searchable thread-memory store. Sits
    // alongside the task-above routes (same "above" thread-capture shape); purely additive — does not
    // touch the reminder FSM.
    this.#CommandRouter.Register({
      Pattern: REMEMBER_ABOVE_PATTERN,
      Route: 'remember-above',
      Handle: async (ArgEventInfo) => {
        await HandleRememberAboveCommandAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: SEND_TO_GITHUB_PATTERN,
      Route: 'send-to-github',
      Handle: async (ArgEventInfo, _Match, ArgTitleText) => {
        await HandleSendToGithubCommandAsync(
          this.#GetSlackAppFromRoutedEvent(ArgEventInfo),
          ArgEventInfo,
          ArgTitleText || ''
        );
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:sync(?:-|\s+)github(?:\s+now)?|github\s+sync\s+now)\b/i,
      Route: 'sync-github',
      Handle: async (ArgEventInfo) => {
        await this.#HandleRunGitHubSyncNowAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\btest\s+github(?:\s+sync)?\b/i,
      Route: 'test-github-sync',
      Handle: async (ArgEventInfo) => {
        await this.#HandleTestGitHubSyncAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\bsearch\s+(?:all\s+)?(?:my|me)\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)(?:\s+(.+))?\s*$/i,
      Route: 'search-my-reminders',
      Handle: async (ArgEventInfo, ArgQueryText) => {
        await this.#HandleSearchMyRemindersAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, ArgQueryText || '');
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\bsearch\s+(?:all\s+)?(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\s+for\s+(<@[^>]+>|@\w+)(?:\s+(.+))?\s*$/i,
      Route: 'search-reminders-for-user',
      Handle: async (ArgEventInfo, ArgUserMention, ArgQueryText) => {
        await this.#HandleSearchRemindersForUserAsync(
          this.#GetSlackAppFromRoutedEvent(ArgEventInfo),
          ArgEventInfo,
          ArgUserMention,
          ArgQueryText || ''
        );
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:generate-?list|create\s+list|export\s+list)\s+for\s+(<@[^>]+>)\s*$/i,
      Route: 'generate-user-list',
      Handle: async (ArgEventInfo, ArgUserMention) => {
        await this.#HandleGenerateUserListAsync(
          this.#GetSlackAppFromRoutedEvent(ArgEventInfo),
          ArgEventInfo,
          ArgUserMention
        );
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\bsearch\s+(?:all\s+)?(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\s+here(?:\s+(.+))?\s*$/i,
      Route: 'search-reminders-here',
      Handle: async (ArgEventInfo, ArgQueryText) => {
        await this.#HandleSearchRemindersHereAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, ArgQueryText || '');
      },
    });

    this.#CommandRouter.Register({
      // `search-projects` (plural command) is sugar for `search reminders PROJECT` (singular
      // keyword): it surfaces the high-level PROJECT-tagged reminders. Trailing keywords are
      // appended, so `search-projects client-a` runs `search reminders PROJECT client-a`. Registered
      // before the base search route; `projects` is not a reminder/task noun so they never collide.
      Pattern: /\bsearch(?:-|\s+)projects(?:\s+(.+))?\s*$/i,
      Route: 'search-projects',
      Handle: async (ArgEventInfo, ArgExtraKeywords) => {
        const QueryText = ArgExtraKeywords ? `PROJECT ${ArgExtraKeywords}` : 'PROJECT';
        await this.#HandleSearchRemindersAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, QueryText);
      },
    });

    this.#CommandRouter.Register({
      // `search-reminders` (hyphenated) is accepted as an alias for `search reminders`,
      // matching the hyphen convention used by other commands (sync-github, generate-list).
      Pattern: /\bsearch(?:-|\s+)(?:all\s+)?(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)(?:\s+(.+))?\s*$/i,
      Route: 'search-reminders',
      Handle: async (ArgEventInfo, ArgQueryText) => {
        await this.#HandleSearchRemindersAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, ArgQueryText || '');
      },
    });

    // "summarize week" / "weekly summary" — a Sun–Sat recap of what got completed this week and
    // what is still open. Registered ahead of the broad show/search routes; its keywords ("week",
    // "summary") don't overlap the reminder/task vocabulary those patterns key on.
    this.#CommandRouter.Register({
      Pattern: /\b(?:summari[sz]e[-\s]+(?:the[-\s]+)?(?:this[-\s]+)?week|week(?:ly)?[-\s]+summary|this[-\s]+weeks?[-\s]+summary|summary[-\s]+(?:of[-\s]+)?(?:this[-\s]+)?week)\b/i,
      Route: 'summarize-week',
      Handle: async (ArgEventInfo) => {
        await this.#HandleSummarizeWeekAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:show|list|display|give|view|see|get|fetch|provide|present|bring)(?:\s+all)?\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)(?:\s+(<@[^>]+>|@\w+)\s+only|\s+only\s+(?:for\s+)?(<@[^>]+>|@\w+))/i,
      Route: 'show-reminders-for-user',
      Handle: async (ArgEventInfo, ArgUserMentionLeft, ArgUserMentionRight) => {
        const UserMention = ArgUserMentionLeft || ArgUserMentionRight;
        await this.#HandleShowRemindersForUserRouteAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, UserMention);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:show|list|display|give|view|see|get|fetch|provide|present|bring)(?:\s+all)?\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\s+for\s+(<@[^>]+>)/i,
      Route: 'show-reminders-for-user',
      Handle: async (ArgEventInfo, ArgUserMention) => {
        await this.#HandleShowRemindersForUserRouteAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, ArgUserMention);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:show|list|display|give|view|see|get|fetch|provide|present|bring)(?:\s+all)?\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\s+of\s+(<@[^>]+>)/i,
      Route: 'show-reminders-for-user',
      Handle: async (ArgEventInfo, ArgUserMention) => {
        await this.#HandleShowRemindersForUserRouteAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, ArgUserMention);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:show|list|display|give|view|see|get|fetch|provide|present|bring)(?:\s+all)?\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\s+github\b/i,
      Route: 'show-github-reminders',
      Handle: async (ArgEventInfo) => {
        await this.#HandleShowGitHubRemindersAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:show|list|display|give|view|see|get|fetch|provide|present|bring)(?:\s+all)?(?:\s+\w+)*?\s+(?:my|me)(?:\s+\w+)*?\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\b/i,
      Route: 'show-my-reminders',
      Handle: async (ArgEventInfo) => {
        await this.#HandleShowMyRemindersAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:show|list|display|give|view|see|get|fetch|provide|present|bring)(?:\s+all)?\s+(?:reminder(?:s)?|task(?:s)?|todo(?:s)?|to-?do(?:s)?|follow-?up(?:s)?|action(?:\s+item(?:s)?)?)\b/i,
      Route: 'show-reminders',
      Handle: async (ArgEventInfo) => {
        await this.#HandleShowRemindersAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:process|post|send|run)\s+(?:pending\s+)?reminders(?:\s+now)?\b/i,
      Route: 'process-reminders-now',
      Handle: async (ArgEventInfo) => {
        await this.#HandleProcessRemindersNowAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:enable|turn\s+on|activate|start|initiate)\s+(?:reminders|tasks|todos)\b/i,
      Route: 'enable-reminders',
      Handle: async (ArgEventInfo) => {
        await this.#HandleChannelReminderSettingAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, true);
      },
    });

    this.#CommandRouter.Register({
      Pattern: /\b(?:disable|turn\s+off|deactivate|stop|halt)\s+(?:reminders|tasks|todos)\b/i,
      Route: 'disable-reminders',
      Handle: async (ArgEventInfo) => {
        await this.#HandleChannelReminderSettingAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo, false);
      },
    });

    // Confirm pending multi-task proposal in this thread. Registered last so more specific
    // routes match first. Matches `:white_check_mark:` (emoji shortcode), "confirm", "confirm tasks",
    // "confirm all", "yes create", "create all", or "approve tasks".
    this.#CommandRouter.Register({
      Pattern: /^\s*(?:<@[^>]+>\s*)?(?::white_check_mark:|confirm(?:\s+(?:all|tasks?))?|yes\s+create|create\s+all|approve\s+tasks?)\s*$/i,
      Route: 'confirm-multi-task-proposal',
      Handle: async (ArgEventInfo) => {
        await this.#HandleConfirmMultiTaskProposalAsync(this.#GetSlackAppFromRoutedEvent(ArgEventInfo), ArgEventInfo);
      },
    });
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async OnAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    // Multi-task extraction path — checked BEFORE the CommandRouter so that "list tasks",
    // "show tasks", "get tasks", etc. are not intercepted by the show-reminders route.
    // Only active when AIPipeline is injected (directly or via lazy getter).
    const ResolvedAIPipeline = this.#AIPipeline || (this.#GetAIPipeline ? this.#GetAIPipeline() : null);
    if(ResolvedAIPipeline && /\b(?:extract|propose|find|list|show|get)\s+(?:all\s+)?tasks?\b|\btasks?\s+(?:from|in)\s+(?:this\s+)?thread\b/i.test(ArgEventInfo.text)) {
      return await this.#HandleMultiTaskExtractionAsync(ArgSlackApp, ArgEventInfo);
    }

    const RoutedEventInfo = { ...ArgEventInfo, SlackApp: ArgSlackApp };
    if(await this.#CommandRouter.RouteAsync(ArgEventInfo.text, RoutedEventInfo)) return true;

    const HasOtherUserMention = /<@[A-Z0-9]+>/g.test(
      ArgEventInfo.text.replace(ArgSlackApp.AppMentionString, '')
    );
    // Shares SCHEDULING_TRIGGER_PATTERN with #OnMessageAsync's gate and the vague-completion
    // enrichment path — a tightening here also tightens those. See SCHEDULING_TRIGGER_PATTERN
    // for the canonical list of consumers.
    const HasSchedulingTrigger = this.#HasSchedulingTrigger(ArgEventInfo.text);

    if(HasOtherUserMention && HasSchedulingTrigger) {
      const StrippedText = ArgEventInfo.text.replace(/<@[A-Z0-9]+>/gi, '').trim();
      const WordCount = StrippedText.split(/\s+/).filter((/** @type {any} */ w) => w.length > 0).length;
      const HasDemonstrativeThis = /\bthis\b/i.test(StrippedText) &&
        !/\bthis\s+(?:week|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(StrippedText);
      const HasStrongSchedulingTrigger = this.#HasStrongSchedulingTrigger(ArgEventInfo.text);

      if(HasDemonstrativeThis && WordCount <= 8 && !HasStrongSchedulingTrigger) {
        if(ArgEventInfo.thread_ts) {
          try {
            // GH-143 Phase 2: same resolver as every other path. `this` IS the reference, so the
            // resolver's own detector is authoritative here rather than a second opinion.
            const Context = await ContextResolution.ResolveContextAsync(
              ArgSlackApp, ArgEventInfo, { PathPrefix: 'semantic_this' }
            );

            if(Context.enriched) {
              ArgSlackApp.Logger.info('semantic gate: resolved "this" from preceding thread message - processing as reminder');
              const WasScheduled = await this.#TryScheduleRemindersAsync(
                ArgSlackApp, Context.text, ArgEventInfo.channel, ArgEventInfo.ts, ArgEventInfo.user,
                false, ArgEventInfo.thread_ts, Context.liveReplyText, true, Context.enrichment
              );
              if(WasScheduled) return true;
            } else {
              ArgSlackApp.Logger.info(`semantic gate: thread context not usable (${Context.decidedBy}) - skipping`);
            }
          } catch(error) {
            ArgSlackApp.Logger.error('semantic gate: failed to fetch thread context:', error);
          }
        } else {
          ArgSlackApp.Logger.info('semantic gate: short message with demonstrative "this" and no strong scheduling trigger - skipping');
        }
      } else {
        ArgSlackApp.Logger.info('app_mention detected as task assignment - processing as reminder');
        const WasScheduled = await this.#TryScheduleRemindersAsync(
          ArgSlackApp, ArgEventInfo.text, ArgEventInfo.channel, ArgEventInfo.ts, ArgEventInfo.user,
          false
        );
        if(WasScheduled) return true;
      }
    }

    return false;
  }

  /**
   * @param {string} ArgText
   * @returns {boolean}
   */
  #HasSchedulingTrigger(ArgText) {
    return this.#GetSchedulingTriggerMatch(ArgText) !== null;
  }

  /**
   * Return the first matched scheduling trigger text from the shared temporal regex.
   * @param {string} ArgText
   * @returns {string|null}
   */
  #GetSchedulingTriggerMatch(ArgText) {
    const Text = ArgText || '';
    const Match = Text.match(SCHEDULING_TRIGGER_PATTERN);
    if(Match) return Match[0];
    if(ASAP_TRIGGER_PATTERN.test(Text) && this.#HasStrongAsapIntentContext(Text))
      return 'asap';
    return null;
  }

  /**
   * Return true for narrow subordinate/hypothetical thread-reply forms that should not proceed
   * into the enriched scheduling path.
   * @param {string} ArgText
   * @returns {boolean}
   */
  #ShouldSuppressHypotheticalSubordinateReply(ArgText) {
    return /\b(?:when|if)\s+i\s+(?:get\s+to|work\s+on|come\s+back\s+to|circle\s+back\s+to)\s+(?:the\s+)?(?:it|this|that|[a-z0-9_-]+(?:\s+[a-z0-9_-]+){0,2})\b/i.test(ArgText || '');
  }

  /**
   * Return true only when `asap` appears alongside strong reminder-intent language.
   * This keeps direct asks / commitments schedulable while preventing bare aspirational `asap`
   * mentions from tripping the shared temporal gate on their own.
   * @param {string} ArgText
   * @returns {boolean}
   */
  #HasStrongAsapIntentContext(ArgText) {
    const Text = ArgText || '';
    if(!ASAP_TRIGGER_PATTERN.test(Text)) return false;

    const HasDirectAskOrCommitment =
      /\b(?:can\s+you|could\s+you|would\s+you)\b[\s\S]{0,120}\basap\b/i.test(Text) ||
      /\bplease\s+(?:do|handle|take\s+care\s+of|finish|complete|get\s+to|tackle|work\s+on|follow\s+up\s+on|review|send|deploy|fix|ship|address|check|update|reactivate|look\s+into|discuss)\b[\s\S]{0,120}\basap\b/i.test(Text) ||
      /\bi(?:'ll|\s+will|\s+am\s+going\s+to|'m\s+going\s+to)\b[\s\S]{0,120}\basap\b/i.test(Text) ||
      /\b(?:gonna|going\s+to)\b[\s\S]{0,120}\basap\b/i.test(Text);

    if(HasDirectAskOrCommitment) return true;

    return /^\s*(?:<@[A-Z0-9]+>\s+)?(?:please\s+)?(?:do|handle|take\s+care\s+of|finish|complete|get\s+to|tackle|work\s+on|follow\s+up\s+on|review|send|deploy|fix|ship|address|check|update|reactivate|look\s+into|discuss)\b/i.test(Text);
  }

  /**
   * @param {string} ArgText
   * @returns {boolean}
   */
  #HasStrongSchedulingTrigger(ArgText) {
    return /\b(?:tomorrow|today|eod|cob|deadline|due|end\s+of|next\s+week|this\s+week|tonight|noon|midnight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(ArgText || '');
  }

  /**
   * More conservative schedule detector used only for the "task above" defaulting logic.
   * Bare numbers like issue IDs must not count as dates or times here.
   * @param {string} ArgText
   * @returns {boolean}
   */
  #HasExplicitScheduleForDefaulting(ArgText) {
    return /\b(?:by|before|until|due|deadline|eod|cob|end\s+of|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|this\s+week|tonight|morning|afternoon|evening|noon|midnight|\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i.test(ArgText || '');
  }

  /**
   * Return the single nearest preceding human (non-bot) message in the thread, or null.
   * Thin wrapper over #CollectPrecedingHumanThreadMessagesAsync so the "nearest message" lookup
   * and the "last N messages" lookup share one traversal/filter implementation.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<any|null>}
   */
  async #FindPrecedingHumanThreadMessageAsync(ArgSlackApp, ArgEventInfo) {
    const Messages = await this.#CollectPrecedingHumanThreadMessagesAsync(ArgSlackApp, ArgEventInfo, 1);
    return Messages[0] ?? null;
  }

  /**
   * Collect up to ArgMaxCount preceding human (non-bot) messages in the thread, returned in
   * chronological order (oldest first) so the AI reads the conversation naturally. Walks backward
   * from the current message, skipping bot and empty messages, and stops once ArgMaxCount human
   * messages have been gathered. Returns an empty array when not in a thread, the current message
   * is the thread root, or no preceding human message exists.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {number} ArgMaxCount
   * @returns {Promise<Array<any>>}
   */
  async #CollectPrecedingHumanThreadMessagesAsync(ArgSlackApp, ArgEventInfo, ArgMaxCount) {
    return ContextResolution.CollectPrecedingHumanThreadMessagesAsync(ArgSlackApp, ArgEventInfo, ArgMaxCount);
  }

  /**
   * Collect ALL preceding human (non-bot) messages in the thread, in chronological order.
   * Distinct from #CollectPrecedingHumanThreadMessagesAsync — this has NO cap and is used
   * exclusively by the multi-task extraction path. The 3-message capped helper is unchanged.
   * Returns an empty array when not in a thread or no preceding human messages exist.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<Array<any>>}
   */
  async #CollectWholeThreadHumanMessagesAsync(ArgSlackApp, ArgEventInfo) {
    if(!ArgEventInfo.thread_ts) return [];

    const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(ArgEventInfo.channel, ArgEventInfo.thread_ts);
    const CurrentIndex = ThreadMessages.findIndex((/** @type {any} */ ArgMessage) => ArgMessage.ts === ArgEventInfo.ts);
    const UpperBound = CurrentIndex >= 0 ? CurrentIndex : ThreadMessages.length;

    return ThreadMessages
      .slice(0, UpperBound)
      .filter((/** @type {any} */ ArgMessage) => ArgMessage?.text && !ArgMessage.bot_id);
  }

  /**
   * Render N proposed tasks in-thread with a confirm/edit message before any reminder is created.
   * Returns the rendered proposal text (does NOT create reminders — caller must await confirm).
   * @param {Array<any>} ArgCandidates Extraction candidates from ExtractMultiTaskCandidatesAsync.
   * @param {string} ArgCommanderMention Slack mention of the user who invoked the command.
   * @returns {string}
   */
  static #BuildMultiTaskProposalText(ArgCandidates, ArgCommanderMention) {
    const Lines = [
      `*Proposed tasks from thread* (${ArgCandidates.length} found) — review and confirm each:`,
    ];

    for(const Candidate of ArgCandidates) {
      const ConfidenceTag = Candidate.confidence === 'low'
        ? ' _(low confidence)_'
        : '';
      const DupeTag = Candidate.duplicateOpenReminderID
        ? ` _(existing: \`${Candidate.duplicateOpenReminderID}\`)_`
        : '';
      const AssigneeText = Candidate.assigneeID ? `<@${Candidate.assigneeID}>` : '_unassigned_';
      const DeadlineText = Candidate.deadline || '_no deadline_';
      const FlagNote = Candidate.flag ? `\n   > ⚠️ ${Candidate.flag}` : '';

      Lines.push(
        `\n*${Candidate.taskIndex}.* ${Candidate.title}${ConfidenceTag}${DupeTag}` +
        `\n   • Assignee: ${AssigneeText}   • Deadline: ${DeadlineText}${FlagNote}`
      );
    }

    Lines.push('\nReply with `:white_check_mark:` to create these reminders as shown. To change a task, edit the thread and re-run the extraction.');
    return Lines.join('\n');
  }

  /**
   * Handle a whole-thread multi-task extraction request triggered by an @mention.
   * Collects all human messages in the thread, calls the AIPipeline to extract candidates,
   * resolves assignee/deadline from operator defaults, checks against live open reminders,
   * and posts a propose-and-confirm surface in-thread. Nothing is scheduled without confirm.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleMultiTaskExtractionAsync(ArgSlackApp, ArgEventInfo) {
    const CommanderMention = `<@${ArgEventInfo.user}>`;

    // Collect the whole thread (no cap).
    let ThreadMessages = [];
    try {
      ThreadMessages = await this.#CollectWholeThreadHumanMessagesAsync(ArgSlackApp, ArgEventInfo);
      // Include the triggering message itself so the model sees the full picture.
      ThreadMessages = ThreadMessages.concat([{ ts: ArgEventInfo.ts, user: ArgEventInfo.user, text: ArgEventInfo.text }]);
    } catch(Error) {
      ArgSlackApp.Logger.error('multi-task extraction: failed to collect thread messages:', Error);
    }

    if(ThreadMessages.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'I could not find any messages in this thread to extract tasks from.'
      );
      return true;
    }

    // Resolve client identity from the channel using the injected client mappings so tests
    // can supply their own mapping set without touching the disk-based loader.
    const { DoesReminderMatchClient } = require('./client-mapping');
    const ChannelContext = { OriginalChannelID: ArgEventInfo.channel };
    const AllClientMappings = this.#GetClientMappings() || [];
    const ResolvedClientMapping = AllClientMappings.find(
      (/** @type {any} */ ArgClient) => DoesReminderMatchClient(ChannelContext, ArgClient)
    ) || null;
    const ClientId = ResolvedClientMapping?.ClientID || null;

    // Fetch live open reminders for dedup flagging — filtered to the resolved client when known.
    const AllPending = this.#GetPendingReminders() ?? [];
    const ClientScopedReminders = ResolvedClientMapping
      ? AllPending.filter((/** @type {any} */ ArgR) => DoesReminderMatchClient(ArgR, ResolvedClientMapping))
      : AllPending;
    const OpenReminders = ClientScopedReminders.map(
      (/** @type {any} */ ArgR) => ({ ReminderID: ArgR.ReminderID, ReminderMessageText: ArgR.ReminderMessageText || '' })
    );

    // Fetch recent completions (last 30 days) for dedup context — same accessor used by
    // the weekly summary. Provides the model with "already done" signal alongside open reminders.
    const ThirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const NowMs = Date.now();
    const RecentCompletions = this.#GetCompletedRemindersBetween(NowMs - ThirtyDaysMs, NowMs);

    // Resolve pipeline (direct injection or lazy getter from production wiring).
    const ActiveAIPipeline = this.#AIPipeline || (this.#GetAIPipeline ? this.#GetAIPipeline() : null);

    // Call the pipeline on the Complex model.
    let ExtractionResult;
    try {
      ExtractionResult = await ActiveAIPipeline.ExtractMultiTaskCandidatesAsync(
        ThreadMessages.map((/** @type {any} */ ArgMsg) => ({ ts: ArgMsg.ts, user: ArgMsg.user, text: ArgMsg.text })),
        ClientId,
        OpenReminders,
        RecentCompletions
      );
    } catch(Error) {
      ArgSlackApp.Logger.error('multi-task extraction: pipeline error:', Error);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'I encountered an error while extracting tasks from the thread. Please try again.'
      );
      return true;
    }

    const Candidates = ExtractionResult?.candidates || [];
    if(Candidates.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'I did not find any distinct tasks in this thread.'
      );
      return true;
    }

    // Persist the proposal keyed by channel:thread_ts so the confirm route can retrieve it.
    const ProposalKey = `${ArgEventInfo.channel}:${ArgEventInfo.thread_ts || ArgEventInfo.ts}`;
    this.#PendingProposals.set(ProposalKey, { candidates: Candidates, clientId: ClientId });

    // Render the proposal — nothing is scheduled until the user confirms.
    const ProposalText = RemindersAppMentionHandler.#BuildMultiTaskProposalText(Candidates, CommanderMention);
    ArgSlackApp.Logger.info(
      `multi-task extraction: path=whole_thread_multi_task client=${ClientId || '(none)'} candidates=${Candidates.length}`
    );
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ProposalText);
    return true;
  }

  /**
   * Confirm a pending multi-task proposal for this thread, creating one reminder per non-duplicate
   * candidate via #TryScheduleRemindersAsync. The created reminders are stamped with clientId and
   * projectId by #MakeScheduledReminder (in RemindersModule) — no extra stamping needed here.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleConfirmMultiTaskProposalAsync(ArgSlackApp, ArgEventInfo) {
    const ProposalKey = `${ArgEventInfo.channel}:${ArgEventInfo.thread_ts || ArgEventInfo.ts}`;
    const Proposal = this.#PendingProposals.get(ProposalKey);

    if(!Proposal) {
      // No pending proposal for this thread — silently fall through.
      return false;
    }

    this.#PendingProposals.delete(ProposalKey);
    const { candidates: Candidates } = Proposal;

    // Filter: skip candidates that are already-open duplicates.
    const NonDuplicate = Candidates.filter((/** @type {any} */ ArgC) => !ArgC.duplicateOpenReminderID);

    // Filter: skip candidates with a missing/blank title. A bad AI-pipeline result should never leak
    // an undefined/empty task name into a persisted reminder (GH-399) — mirrors the duplicate-skip
    // idiom above rather than falling back to raw source text.
    const Confirmable = NonDuplicate.filter((/** @type {any} */ ArgC) => {
      const HasTitle = typeof ArgC.title === 'string' && ArgC.title.trim().length > 0;
      if(!HasTitle) {
        ArgSlackApp.Logger.warn(
          `multi-task confirm: skipping candidate (taskIndex=${ArgC.taskIndex}) with missing/blank title`
        );
      }
      return HasTitle;
    });

    if(Confirmable.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'All proposed tasks already have open reminders — nothing to create.'
      );
      return true;
    }

    let CreatedCount = 0;
    for(const Candidate of Confirmable) {
      // Resolve the primary source ts for this candidate (first source message).
      const PrimarySourceTs = (Candidate.sourceTs && Candidate.sourceTs[0]) || null;

      // The reminder text is the synthesized task the user reviewed and confirmed — WYSIWYG with the
      // proposal, which renders Candidate.title. Do NOT substitute the raw source message here: it is
      // a whole chat message, not a task, and using it verbatim discarded the synthesis and let the
      // digest renderer mangle a multi-paragraph note into an unreadable excerpt (prod bug 2026-07-14:
      // "Get the Woocommerce plugins done" was stored as "com. I'll follow the same method…"). If
      // edit-before-confirm is ever wanted, edit the *proposal* bullet and re-parse it — not this.
      const TaskText = Candidate.title;

      // Build schedule text anchored to the candidate's source message — not the confirm ts.
      const AssigneeMention = Candidate.assigneeID ? `<@${Candidate.assigneeID}>` : `<@${ArgEventInfo.user}>`;
      const ScheduleText = Candidate.deadline
        ? `${AssigneeMention} ${TaskText} — due ${Candidate.deadline}`
        : `${AssigneeMention} ${TaskText}`;

      // Use the candidate's primary source ts as the message ID for provenance/source-mapping.
      const SourceMsgTs = PrimarySourceTs || ArgEventInfo.ts;

      try {
        const WasScheduled = await this.#TryScheduleRemindersAsync(
          ArgSlackApp,
          ScheduleText,
          ArgEventInfo.channel,
          SourceMsgTs,
          Candidate.assigneeID || ArgEventInfo.user,
          false,
          ArgEventInfo.thread_ts || ArgEventInfo.ts
        );
        if(WasScheduled) CreatedCount++;
      } catch(Error) {
        ArgSlackApp.Logger.error(`multi-task confirm: failed to create reminder for task "${Candidate.title}":`, Error);
      }
    }

    const Summary = CreatedCount === Confirmable.length
      ? `Created ${CreatedCount} reminder${CreatedCount === 1 ? '' : 's'} from the proposed tasks.`
      : `Created ${CreatedCount} of ${Confirmable.length} reminder${Confirmable.length === 1 ? '' : 's'} (some failed — check logs).`;

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Summary);
    return true;
  }

  /**
   * @param {any} ArgEventInfo
   * @returns {string|null}
   */
  #ExtractTargetMentionFromText(ArgEventInfo) {
    const Text = ArgEventInfo.text || '';
    const AboveIdx = Text.toLowerCase().search(/\babove\b/);
    const SearchText = AboveIdx > 0 ? Text.slice(0, AboveIdx) : Text;
    const Mentions = [...SearchText.matchAll(/<@([A-Z0-9]+)>/g)];
    // Skip the first mention (Sleuth bot) and exclude the message sender
    return Mentions.slice(1).find(m => m[1] !== ArgEventInfo.user)?.[0] ?? null;
  }

  /**
   * @returns {Array<any>}
   */
  #GetPendingRemindersQueue() {
    return this.#GetPendingReminders() ?? [];
  }

  /**
   * @returns {any}
   */
  #GetGitHubSyncModuleInstance() {
    return this.#GetGitHubSyncModule() ?? null;
  }

  /**
   * Route wrapper for user-targeted reminder list commands. Preserves the existing warning
   * behavior when `@username` text is used instead of a real Slack mention.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {string} ArgUserMention
   * @returns {Promise<boolean>}
   */
  async #HandleShowRemindersForUserRouteAsync(ArgSlackApp, ArgEventInfo, ArgUserMention) {
    if(ArgUserMention && !ArgUserMention.startsWith('<@')) {
      ArgSlackApp.Logger.warn(`Received @username format in reminders command: ${ArgUserMention}. Consider using proper @mention format.`);
    }

    return await this.#HandleShowRemindersForUserAsync(ArgSlackApp, ArgEventInfo, ArgUserMention);
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {string} ArgUserMention
   * @param {string} ArgScheduleText
   * @returns {Promise<boolean>}
   */
  async #HandleCreateReminderFromTaskAboveAsync(ArgSlackApp, ArgEventInfo, ArgUserMention, ArgScheduleText) {
    if(!ArgEventInfo.thread_ts) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `This command only works in a thread under the source task. Try \`${ArgSlackApp.AppMentionString} make a Sleuth reminder for ${ArgUserMention} based on task above\` as a thread reply, or use :alarm_clock: on the source message.`
      );
      return true;
    }

    let SourceMessage = null;
    try {
      SourceMessage = await this.#FindPrecedingHumanThreadMessageAsync(ArgSlackApp, ArgEventInfo);
    } catch(error) {
      ArgSlackApp.Logger.error('failed to resolve source message for "task above" reminder command:', error);
    }

    if(!SourceMessage?.text) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'I could not find a human-written task above this command to turn into a reminder. Reply directly under the task message, or use :alarm_clock: on that message.'
      );
      return true;
    }

    const ScheduleText = (ArgScheduleText || '').trim();
    const HasRequestedSchedule = this.#HasExplicitScheduleForDefaulting(ScheduleText);
    const HasSourceSchedule = this.#HasExplicitScheduleForDefaulting(SourceMessage.text);
    const DefaultMorningTotalMin = 8 * 60 + Math.floor(Math.random() * 91) - 45; // 7:15–8:45 AM range
    const DefaultMorningTime = `tomorrow at ${Math.floor(DefaultMorningTotalMin / 60)}:${String(DefaultMorningTotalMin % 60).padStart(2, '0')} AM`;
    const EffectiveScheduleText = HasRequestedSchedule ? ScheduleText :
      (HasSourceSchedule ? '' : DefaultMorningTime);
    // GH-143: this door used to hand the analyzer
    //   `Create a reminder for <@U> to handle this task: "<the whole source message>" — tomorrow`
    // and that wrapper defeated the pipeline twice. The quotes collide head-on with the analyzer's
    // CRITICAL QUOTED TEXT RULE ("use quoted text VERBATIM, never summarize"), so a 250-character
    // source message came back as the reminder title, unsummarized, quote marks and all. And
    // because the stitching happened here instead of in the resolver, the reminder was recorded
    // with enrichment=off — the routing facts described a decision the pipeline had not made.
    //
    // It now feeds the SAME shape every other enriched door feeds: antecedent line, then the live
    // reply, and the resolved-context arguments alongside it. No wrapper, no quotes, no fifth
    // private opinion about what context is.
    const LiveReplyText = ArgEventInfo.text || '';
    // Two things the old wrapper carried that the live reply does not always carry on its own:
    //   - the TARGET. "@Sleuth make a reminder for @X based on task above" names @X in the text,
    //     but the shorthand form resolves it from the thread, so it must be stated or the
    //     reminder is assigned to whoever typed the command.
    //   - a DEFAULTED schedule. When neither the command nor the source names a time we invent a
    //     morning slot; appending an EXPLICIT one the live text already contains is what produced
    //     "...by 11 AM PT — with WP Engine support chat by 11 AM PT".
    const MentionPrefix = LiveReplyText.includes(ArgUserMention) ? '' : `${ArgUserMention} `;
    const ScheduleSuffix = (EffectiveScheduleText && !HasRequestedSchedule)
      ? ` — ${EffectiveScheduleText}` : '';
    const AnalysisText = `${SourceMessage.text}\n${MentionPrefix}${LiveReplyText}${ScheduleSuffix}`;
    const SourceUserID = SourceMessage.user || ArgEventInfo.user;
    ArgSlackApp.Logger.info(
      `reminder path fired: path=task_above_shorthand_in_thread enrichment=thread_context` +
      ` temporal_trigger="${EffectiveScheduleText || 'from_source'}" prepended_messages=1` +
      ` antecedent_ts=${SourceMessage.ts || 'none'}`
    );
    const WasScheduled = await this.#TryScheduleRemindersAsync(
      ArgSlackApp,
      AnalysisText,
      ArgEventInfo.channel,
      SourceMessage.ts,
      SourceUserID,
      false,
      ArgEventInfo.thread_ts,
      LiveReplyText,
      true,
      { SourceTs: SourceMessage.ts || null, Path: 'task_above_shorthand_in_thread' }
    );

    if(WasScheduled) return true;

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'I found the task above, but I could not schedule a reminder from it. Try adding an explicit date or time, or use :alarm_clock: on the source message.'
    );
    return true;
  }

  /**
   * Shared enable/disable reminders command flow.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {boolean} ArgShouldEnable
   * @returns {Promise<boolean>}
   */
  async #HandleChannelReminderSettingAsync(ArgSlackApp, ArgEventInfo, ArgShouldEnable) {
    const IsCreator = await ArgSlackApp.IsChannelCreatorAsync(ArgEventInfo.channel, ArgEventInfo.user);
    const IsAdminOrOwner = IsCreator ? false : await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
    if(!IsCreator && !IsAdminOrOwner) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Only the channel creator or a workspace admin/owner can enable or disable reminders.'
      );
      return true;
    }

    const ChannelSettings = this.#GetChannelSettings();
    if(!ChannelSettings) {
      ArgSlackApp.Logger.warn('channel settings unavailable during reminder app_mention startup window.');
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Reminder system is still starting up. Try again in a moment.'
      );
      return true;
    }

    if(ArgShouldEnable) {
      await ChannelSettings.EnableRemindersForChannelAsync(ArgEventInfo.channel);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Automatic reminders have been enabled for this channel. Disable them by typing `@Sleuth AI disable reminders`.'
      );
      return true;
    }

    await ChannelSettings.DisableRemindersForChannelAsync(ArgEventInfo.channel);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Automatic reminders have been disabled for this channel. You can still use the :alarm_clock: reaction to manually schedule reminders. Enable reminders again by typing `@Sleuth AI enable reminders`.'
    );
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgUserMention
   * @returns {Promise<boolean>}
   */
  async #HandleShowRemindersForUserAsync(ArgSlackApp, ArgEventInfo, ArgUserMention) {
    let TargetUserID = null;
    let UserMentionForSearch = ArgUserMention;

    const UserIdMatch = ArgUserMention.match(/^<@([^>]+)>$/);
    if(UserIdMatch) {
      TargetUserID = UserIdMatch[1];
    } else if(ArgUserMention.startsWith('@')) {
      ArgSlackApp.Logger.info(`Handling @username format: ${ArgUserMention}. Note: Only mentions will be found, not reminders created by user.`);
      TargetUserID = null;
      UserMentionForSearch = ArgUserMention;
    } else {
      ArgSlackApp.Logger.error("invalid user mention string:", ArgUserMention);
      return true;
    }

    const UserReminders = TargetUserID
      ? this.#GetRemindersTargetingUserID(TargetUserID)
      : this.#GetPendingRemindersQueue().filter(
          (/** @type {any} */ reminder) => reminder.ReminderMessageText.includes(UserMentionForSearch)
        );

    let FilteredReminders = UserReminders;
    if(ArgEventInfo.text.toLowerCase().endsWith('here'))
      FilteredReminders = UserReminders.filter((/** @type {any} */ reminder) => reminder.OriginalChannelID === ArgEventInfo.channel);

    const EmptyMessage = `No pending reminders found for ${ArgUserMention}.`;
    const SummaryMessage = `Pending reminders for ${ArgUserMention} (${FilteredReminders.length} total):`;
    const Timezone = ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE;
    return await PostBucketedReminderSectionsAsync(
      ArgSlackApp, ArgEventInfo, FilteredReminders, EmptyMessage, SummaryMessage, Timezone, { auditTag: 'show-reminders-user' }
    );
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleShowRemindersAsync(ArgSlackApp, ArgEventInfo) {
    let reminders = this.#GetPendingRemindersQueue();
    if(ArgEventInfo.text.toLowerCase().endsWith('here'))
      reminders = reminders.filter((/** @type {any} */ reminder) => reminder.OriginalChannelID === ArgEventInfo.channel);

    const EmptyMessage = "There are no pending reminders.";
    const SummaryMessage = `Pending reminders (${reminders.length} total):`;
    const Timezone = ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE;
    return await PostBucketedReminderSectionsAsync(
      ArgSlackApp, ArgEventInfo, reminders, EmptyMessage, SummaryMessage, Timezone, { auditTag: 'show-reminders-all' }
    );
  }

  /**
   * Post a Sun–Sat recap of the current calendar week: tasks completed this week (pulled from
   * Sleuth's own completion history, independent of Slack Lists) followed by the tasks still open
   * (the live pending-reminders queue). A quick "what got done vs. what didn't".
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleSummarizeWeekAsync(ArgSlackApp, ArgEventInfo) {
    const Timezone = ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE;
    const Week = DateUtils.GetCalendarWeekRange(Timezone);
    const RangeLabel = RemindersAppMentionHandler.#FormatWeekRangeLabel(Week.StartLocal, Week.EndLocal);

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `:calendar: *Week summary* (${RangeLabel})`
    );

    // Completed this week — read from Sleuth's own completion history (independent of Slack Lists).
    // P3 Phase 2 staged cutover: when SUMMARIZE_WEEK_COMPLETED_SOURCE=projection, derive completions
    // from the non-authoritative event ledger instead of the CompletionStore. DEFAULT OFF — the gate
    // stays closed until a clean shadow-diff (window starting after the ledger's birth) validates
    // parity. The projection path is also wrapped so it can never break the weekly summary: any error
    // falls back to the authoritative CompletionStore. Projection completed-rows are field-compatible
    // (summary / assigneeID / completedMs) so the rendering below is unchanged either way.
    // Goes through the shared blocklist rather than reading process.env directly. This call site has
    // no coverage gate at all, so before this it was the LEAST protected of the four projection
    // flags — the catch below only fires on a thrown error, and a silently-wrong fold is not an
    // error. Parked by decision along with the other three (see the blocklist's comment).
    const UseProjectionForCompleted = IsProjectionRequested('SUMMARIZE_WEEK_COMPLETED_SOURCE', {
      Logger: ArgSlackApp.Logger,
    });
    let CompletedRows;
    if(UseProjectionForCompleted) {
      try {
        const Events = await this.#ReadAllEventsAsync();
        CompletedRows = summarizeWeekFromEvents(/** @type {any} */ (Events), {
          weekStartMs: Week.StartMs,
          weekEndMs: Week.EndMs,
        }).completed;
      } catch(ArgError) {
        ArgSlackApp.Logger?.warn?.(
          `[summarize-week] projection source failed; falling back to CompletionStore: ${ArgError.message}`
        );
        CompletedRows = this.#GetCompletedRemindersBetween(Week.StartMs, Week.EndMs);
      }
    } else {
      CompletedRows = this.#GetCompletedRemindersBetween(Week.StartMs, Week.EndMs);
    }

    if(CompletedRows.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        ':white_check_mark: *Completed this week:* nothing completed yet.'
      );
    } else {
      const CompletedLines = CompletedRows.map((ArgRow, /** @type {number} */ ArgIndex) => {
        const Summary = TruncateCompactSummary(ArgRow.summary || '(untitled task)');
        const Assignee = ArgRow.assigneeID ? ` — <@${ArgRow.assigneeID}>` : '';
        const DayLabel = RemindersAppMentionHandler.#FormatCompletedDay(ArgRow.completedMs, Timezone);
        return `${ArgIndex + 1}. ${Summary}${Assignee} · _completed ${DayLabel}_`;
      });
      // A busy week can produce more completed lines than fit in one Slack message (~4000 chars),
      // so post them in length-bounded batches rather than a single over-limit message.
      await this.#PostLinesInChunksAsync(
        ArgSlackApp,
        ArgEventInfo,
        `:white_check_mark: *Completed this week (${CompletedRows.length}):*`,
        CompletedLines
      );
    }

    // Still open — the live pending-reminders queue.
    const OpenReminders = this.#GetPendingRemindersQueue();
    await PostRemindersListAsync(
      ArgSlackApp,
      ArgEventInfo,
      OpenReminders,
      ':hourglass_flowing_sand: *Still open:* none — all clear!',
      `:hourglass_flowing_sand: *Still open (${OpenReminders.length}):*`
    );

    return true;
  }

  /**
   * Post a header followed by a list of pre-formatted lines, splitting into multiple messages so
   * none exceeds Slack's per-message character limit. The header leads the first chunk.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {string} ArgHeader Header line for the first chunk.
   * @param {string[]} ArgLines Pre-formatted body lines.
   * @returns {Promise<void>}
   */
  async #PostLinesInChunksAsync(ArgSlackApp, ArgEventInfo, ArgHeader, ArgLines) {
    // Stay well under Slack's ~4000-char message cap to leave room for mrkdwn expansion.
    const MaxChars = 3500;
    let Buffer = ArgHeader;

    for(const Line of ArgLines) {
      if(Buffer && Buffer.length + 1 + Line.length > MaxChars) {
        await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Buffer);
        Buffer = Line;
      } else {
        Buffer = Buffer ? `${Buffer}\n${Line}` : Line;
      }
    }

    if(Buffer)
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Buffer);
  }

  /**
   * Build a "Mon D – Mon D" label spanning Sunday through Saturday from the localized-UTC week
   * boundaries returned by DateUtils.GetCalendarWeekRange.
   * @param {Date} ArgStartLocal Sunday 00:00 (localized-UTC).
   * @param {Date} ArgEndLocal Following Sunday 00:00 (localized-UTC, exclusive).
   * @returns {string}
   */
  static #FormatWeekRangeLabel(ArgStartLocal, ArgEndLocal) {
    const Months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const SaturdayLocal = new Date(ArgEndLocal);
    SaturdayLocal.setUTCDate(SaturdayLocal.getUTCDate() - 1);
    const Start = `${Months[ArgStartLocal.getUTCMonth()]} ${ArgStartLocal.getUTCDate()}`;
    const End = `${Months[SaturdayLocal.getUTCMonth()]} ${SaturdayLocal.getUTCDate()}`;
    return `${Start} – ${End}`;
  }

  /**
   * Format a completion timestamp as a short "Wkd Mon D" label in the workspace time zone.
   * @param {number} ArgCompletedMs Completion instant (real-UTC epoch milliseconds).
   * @param {string} ArgTimeZone Workspace time zone.
   * @returns {string}
   */
  static #FormatCompletedDay(ArgCompletedMs, ArgTimeZone) {
    const Localized = DateUtils.GetLocalizedUtcDate(ArgTimeZone, new Date(ArgCompletedMs));
    const Days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const Months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Days[Localized.getUTCDay()]} ${Months[Localized.getUTCMonth()]} ${Localized.getUTCDate()}`;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgQueryText
   * @returns {Promise<boolean>}
   */
  async #HandleSearchRemindersAsync(ArgSlackApp, ArgEventInfo, ArgQueryText) {
    return await this.#HandleScopedSearchRemindersAsync(
      ArgSlackApp,
      ArgEventInfo,
      ArgQueryText,
      this.#GetPendingRemindersQueue(),
      'Please provide keywords after `@Sleuth AI search reminders`.',
      (/** @type {any} */ ArgSearchQuery) => `No pending reminders found matching "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Pending reminders matching "${ArgSearchQuery}" (${ArgCount} total):`,
      (/** @type {any} */ ArgSearchQuery) => `No exact matches found for "${ArgSearchQuery}". Showing close matches for longer keywords.`,
      (/** @type {any} */ ArgSearchQuery) => `No close matches found for "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Close matches for "${ArgSearchQuery}" (${ArgCount} total):`
    );
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgQueryText
   * @returns {Promise<boolean>}
   */
  async #HandleSearchMyRemindersAsync(ArgSlackApp, ArgEventInfo, ArgQueryText) {
    return await this.#HandleScopedSearchRemindersAsync(
      ArgSlackApp,
      ArgEventInfo,
      ArgQueryText,
      this.#GetRemindersInvolvingUserID(ArgEventInfo.user),
      'Please provide keywords after `@Sleuth AI search my reminders`.',
      (/** @type {any} */ ArgSearchQuery) => `No pending reminders found for you matching "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Your pending reminders matching "${ArgSearchQuery}" (${ArgCount} total):`,
      (/** @type {any} */ ArgSearchQuery) => `No exact matches found in your reminders for "${ArgSearchQuery}". Showing close matches for longer keywords.`,
      (/** @type {any} */ ArgSearchQuery) => `No close matches found in your reminders for "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Close matches in your reminders for "${ArgSearchQuery}" (${ArgCount} total):`
    );
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgQueryText
   * @returns {Promise<boolean>}
   */
  async #HandleSearchRemindersHereAsync(ArgSlackApp, ArgEventInfo, ArgQueryText) {
    const ChannelReminders = this.#GetPendingRemindersQueue().filter(
      (/** @type {any} */ ArgReminder) => ArgReminder.OriginalChannelID === ArgEventInfo.channel
    );

    return await this.#HandleScopedSearchRemindersAsync(
      ArgSlackApp,
      ArgEventInfo,
      ArgQueryText,
      ChannelReminders,
      'Please provide keywords after `@Sleuth AI search reminders here`.',
      (/** @type {any} */ ArgSearchQuery) => `No pending reminders found in this channel matching "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Pending reminders in this channel matching "${ArgSearchQuery}" (${ArgCount} total):`,
      (/** @type {any} */ ArgSearchQuery) => `No exact matches found in this channel for "${ArgSearchQuery}". Showing close matches for longer keywords.`,
      (/** @type {any} */ ArgSearchQuery) => `No close matches found in this channel for "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Close matches in this channel for "${ArgSearchQuery}" (${ArgCount} total):`
    );
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgUserMention
   * @param {any} ArgQueryText
   * @returns {Promise<boolean>}
   */
  async #HandleSearchRemindersForUserAsync(ArgSlackApp, ArgEventInfo, ArgUserMention, ArgQueryText) {
    const UserReminders = this.#GetRemindersForMention(ArgSlackApp, ArgUserMention);

    return await this.#HandleScopedSearchRemindersAsync(
      ArgSlackApp,
      ArgEventInfo,
      ArgQueryText,
      UserReminders,
      `Please provide keywords after \`@Sleuth AI search reminders for ${ArgUserMention}\`.`,
      (/** @type {any} */ ArgSearchQuery) => `No pending reminders found for ${ArgUserMention} matching "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Pending reminders for ${ArgUserMention} matching "${ArgSearchQuery}" (${ArgCount} total):`,
      (/** @type {any} */ ArgSearchQuery) => `No exact matches found for ${ArgUserMention} matching "${ArgSearchQuery}". Showing close matches for longer keywords.`,
      (/** @type {any} */ ArgSearchQuery) => `No close matches found for ${ArgUserMention} matching "${ArgSearchQuery}".`,
      (/** @type {any} */ ArgSearchQuery, /** @type {any} */ ArgCount) => `Close matches for ${ArgUserMention} matching "${ArgSearchQuery}" (${ArgCount} total):`
    );
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgQueryText
   * @param {any} ArgScopedReminders
   * @param {any} ArgMissingQueryMessage
   * @param {any} ArgBuildEmptyMessage
   * @param {any} ArgBuildSummaryMessage
   * @param {any} ArgBuildNoExactMatchesMessage
   * @param {any} ArgBuildNoCloseMatchesMessage
   * @param {any} ArgBuildCloseMatchesSummary
   * @returns {Promise<boolean>}
   */
  async #HandleScopedSearchRemindersAsync(
    ArgSlackApp,
    ArgEventInfo,
    ArgQueryText,
    ArgScopedReminders,
    ArgMissingQueryMessage,
    ArgBuildEmptyMessage,
    ArgBuildSummaryMessage,
    ArgBuildNoExactMatchesMessage,
    ArgBuildNoCloseMatchesMessage,
    ArgBuildCloseMatchesSummary
  ) {
    const SearchQuery = ArgQueryText.trim();
    if(!SearchQuery) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        ArgMissingQueryMessage
      );
      return true;
    }

    const ExactMatches = this.#GetExactReminderSearchMatches(SearchQuery, ArgScopedReminders);
    const FuzzyMatches = this.#GetFuzzyReminderSearchMatches(SearchQuery, ExactMatches, ArgScopedReminders);

    if(ExactMatches.length === 0 && FuzzyMatches.length === 0) {
      await PostRemindersListAsync(
        ArgSlackApp,
        ArgEventInfo,
        [],
        ArgBuildEmptyMessage(SearchQuery),
        ArgBuildSummaryMessage(SearchQuery, 0)
      );
      return true;
    }

    if(ExactMatches.length > 0) {
      await PostRemindersListAsync(
        ArgSlackApp,
        ArgEventInfo,
        ExactMatches,
        ArgBuildEmptyMessage(SearchQuery),
        ArgBuildSummaryMessage(SearchQuery, ExactMatches.length)
      );
    }

    if(FuzzyMatches.length > 0) {
      if(ExactMatches.length === 0) {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ArgEventInfo.ts,
          ArgBuildNoExactMatchesMessage(SearchQuery)
        );
      }

      await PostRemindersListAsync(
        ArgSlackApp,
        ArgEventInfo,
        FuzzyMatches,
        ArgBuildNoCloseMatchesMessage(SearchQuery),
        ArgBuildCloseMatchesSummary(SearchQuery, FuzzyMatches.length)
      );
    }

    return true;
  }

  /**
   * @param {any} ArgSearchQuery
   * @param {any} ArgRemindersToSearch
   * @returns {Array<any>}
   */
  #GetExactReminderSearchMatches(ArgSearchQuery, ArgRemindersToSearch = this.#GetPendingRemindersQueue()) {
    const NormalizedQuery = ArgSearchQuery.trim().toLowerCase();
    if(!NormalizedQuery) return [];

    const ResolvedClients = ResolveClientsFromQuery(NormalizedQuery, this.#GetClientMappings() || []);

    return ArgRemindersToSearch.filter((/** @type {any} */ ArgReminder) => {
      if(this.#BuildReminderSearchHaystack(ArgReminder).includes(NormalizedQuery)) return true;
      return ResolvedClients.some((/** @type {any} */ ArgClient) => DoesReminderMatchClient(ArgReminder, ArgClient));
    });
  }

  /**
   * @param {any} ArgReminder
   * @returns {string}
   */
  #BuildReminderSearchHaystack(ArgReminder) {
    const Parts = [
      ArgReminder.ReminderMessageText || '',
      ArgReminder.OriginalChannelName || '',
    ];
    if(Array.isArray(ArgReminder.GitHubUrls)) Parts.push(ArgReminder.GitHubUrls.join(' '));
    return Parts.join(' ').toLowerCase();
  }

  /**
   * @param {any} ArgSearchQuery
   * @param {any} ArgExactMatches
   * @param {any} ArgRemindersToSearch
   * @returns {Array<any>}
   */
  #GetFuzzyReminderSearchMatches(
    ArgSearchQuery,
    ArgExactMatches,
    ArgRemindersToSearch = this.#GetPendingRemindersQueue()
  ) {
    const ExactMatchIDs = new Set(ArgExactMatches.map((/** @type {any} */ ArgReminder) => ArgReminder.ReminderID));
    const QueryTokens = this.#TokenizeReminderSearchText(ArgSearchQuery);
    if(QueryTokens.length === 0) return [];

    return ArgRemindersToSearch.filter((/** @type {any} */ ArgReminder) => {
      if(ExactMatchIDs.has(ArgReminder.ReminderID)) return false;
      return this.#IsFuzzyReminderSearchMatch(this.#BuildReminderSearchHaystack(ArgReminder), QueryTokens);
    });
  }

  /**
   * @param {any} ArgReminderText
   * @param {any} ArgQueryTokens
   * @returns {boolean}
   */
  #IsFuzzyReminderSearchMatch(ArgReminderText, ArgQueryTokens) {
    const ReminderTokens = this.#TokenizeReminderSearchText(ArgReminderText);
    if(ReminderTokens.length === 0) return false;

    return ArgQueryTokens.every((/** @type {any} */ ArgQueryToken) => {
      const MaxDistance = this.#GetReminderSearchMaxDistance(ArgQueryToken);
      return ReminderTokens.some((/** @type {any} */ ArgReminderToken) => {
        if(ArgReminderToken === ArgQueryToken) return true;
        if(MaxDistance === 0) return false;
        if(Math.abs(ArgReminderToken.length - ArgQueryToken.length) > MaxDistance) return false;
        return this.#GetLevenshteinDistance(ArgQueryToken, ArgReminderToken) <= MaxDistance;
      });
    });
  }

  /**
   * @param {any} ArgText
   * @returns {Array<string>}
   */
  #TokenizeReminderSearchText(ArgText) {
    return (ArgText.toLowerCase().match(/[a-z0-9]+/g) || []);
  }

  /**
   * @param {any} ArgToken
   * @returns {number}
   */
  #GetReminderSearchMaxDistance(ArgToken) {
    if(ArgToken.length >= 11) return 3;
    if(ArgToken.length >= 8) return 2;
    if(ArgToken.length >= 5) return 1;
    return 0;
  }

  /**
   * @param {any} ArgLeft
   * @param {any} ArgRight
   * @returns {number}
   */
  #GetLevenshteinDistance(ArgLeft, ArgRight) {
    const Matrix = Array.from({ length: ArgLeft.length + 1 }, () => new Array(ArgRight.length + 1).fill(0));

    for(let LeftIndex = 0; LeftIndex <= ArgLeft.length; LeftIndex++)
      Matrix[LeftIndex][0] = LeftIndex;

    for(let RightIndex = 0; RightIndex <= ArgRight.length; RightIndex++)
      Matrix[0][RightIndex] = RightIndex;

    for(let LeftIndex = 1; LeftIndex <= ArgLeft.length; LeftIndex++) {
      for(let RightIndex = 1; RightIndex <= ArgRight.length; RightIndex++) {
        const SubstitutionCost = ArgLeft[LeftIndex - 1] === ArgRight[RightIndex - 1] ? 0 : 1;
        Matrix[LeftIndex][RightIndex] = Math.min(
          Matrix[LeftIndex - 1][RightIndex] + 1,
          Matrix[LeftIndex][RightIndex - 1] + 1,
          Matrix[LeftIndex - 1][RightIndex - 1] + SubstitutionCost
        );
      }
    }

    return Matrix[ArgLeft.length][ArgRight.length];
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleShowGitHubRemindersAsync(ArgSlackApp, ArgEventInfo) {
    let RemindersWithGitHubLinks = this.#GetPendingRemindersQueue().filter(
      (/** @type {any} */ ArgReminder) => this.#ReminderHasGitHubLinks(ArgReminder)
    );

    if(ArgEventInfo.text.toLowerCase().endsWith('here')) {
      RemindersWithGitHubLinks = RemindersWithGitHubLinks.filter(
        (/** @type {any} */ ArgReminder) => ArgReminder.OriginalChannelID === ArgEventInfo.channel
      );
    }

    const EmptyMessage = "There are no pending reminders with GitHub links.";
    const SummaryMessage = `Pending reminders with GitHub links (${RemindersWithGitHubLinks.length} total):`;
    await PostRemindersListAsync(
      ArgSlackApp, ArgEventInfo, RemindersWithGitHubLinks, EmptyMessage, SummaryMessage
    );
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleShowMyRemindersAsync(ArgSlackApp, ArgEventInfo) {
    // collect reminders where the requester is the assignee (index lookup — does not include reminders created for others).
    const UserReminders = /** @type {Array<any>} */ (this.#GetRemindersTargetingUserID(ArgEventInfo.user));

    let FilteredReminders = UserReminders;
    if(ArgEventInfo.text.toLowerCase().endsWith('here'))
      FilteredReminders = UserReminders.filter((/** @type {any} */ reminder) => reminder.OriginalChannelID === ArgEventInfo.channel);

    const EmptyMessage = "You have no pending reminders.";
    const SummaryMessage = `Pending reminders (${FilteredReminders.length} total):`;
    const Timezone = ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE;
    return await PostBucketedReminderSectionsAsync(
      ArgSlackApp, ArgEventInfo, FilteredReminders, EmptyMessage, SummaryMessage, Timezone, { auditTag: 'show-reminders-self' }
    );
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgUserMention
   * @returns {Array<any>}
   */
  #GetRemindersForMention(ArgSlackApp, ArgUserMention) {
    const UserIdMatch = ArgUserMention.match(/^<@([^>]+)>$/);
    if(UserIdMatch)
      return this.#GetRemindersTargetingUserID(UserIdMatch[1]);

    if(ArgUserMention.startsWith('@')) {
      ArgSlackApp.Logger.info(
        `Handling @username format for reminder search: ${ArgUserMention}. ` +
        'Only text mentions will be matched when a user ID is unavailable.'
      );
      return this.#GetPendingRemindersQueue().filter(
        (/** @type {any} */ ArgReminder) => ArgReminder.ReminderMessageText.includes(ArgUserMention)
      );
    }

    ArgSlackApp.Logger.error('invalid user mention string:', ArgUserMention);
    return [];
  }

  /**
   * Generate a one-off Slack List snapshot for one user's assigned reminders.
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {string} ArgUserMention
   * @returns {Promise<boolean>}
   */
  async #HandleGenerateUserListAsync(ArgSlackApp, ArgEventInfo, ArgUserMention) {
    const ListsModule = this.#GetListsModule();
    if(!ListsModule || !ListsModule.IsListsAvailable) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Slack Lists is not available in this workspace right now.'
      );
      return true;
    }

    const UserIdMatch = ArgUserMention.match(/^<@([^>]+)>$/);
    if(!UserIdMatch) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Please use a real Slack user mention, for example `generate-list for @jane`.'
      );
      return true;
    }

    const TargetUserID = UserIdMatch[1];
    const UserReminders = /** @type {Array<any>} */ (this.#GetRemindersTargetingUserID(TargetUserID));
    if(UserReminders.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `No pending reminders found for ${ArgUserMention}.`
      );
      return true;
    }

    const GenerationResult = await ListsModule.EnsureUserListAsync(
      TargetUserID,
      UserReminders,
      ArgEventInfo.channel
    );

    if(!GenerationResult.ok && !GenerationResult.listId) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `Could not set up a Slack List for ${ArgUserMention}: ${GenerationResult.error || 'unknown error'}.`
      );
      return true;
    }

    const LinkLabel = GenerationResult.listName || 'Slack List';
    const ListLink = GenerationResult.permalink
      ? `<${GenerationResult.permalink}|${LinkLabel}>`
      : `\`${LinkLabel}\``;
    const RequestedCount = GenerationResult.requestedItemCount || 0;

    let CompletionSummary;
    if(GenerationResult.created) {
      const SyncedCount = GenerationResult.syncedItemCount || 0;
      CompletionSummary = SyncedCount === RequestedCount
        ? `Created ${ListLink} for ${ArgUserMention} with ${SyncedCount} assigned task${SyncedCount === 1 ? '' : 's'}.`
        : `Created ${ListLink} for ${ArgUserMention}, but only added ${SyncedCount} of ${RequestedCount} assigned tasks.`;
    } else {
      CompletionSummary = `Resynced ${ListLink} for ${ArgUserMention} — now tracking ${RequestedCount} reminder${RequestedCount === 1 ? '' : 's'}.`;
    }

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `${CompletionSummary} This list stays in sync with their reminders — completing or deleting a row updates Sleuth.`
    );
    return true;
  }

  /**
   * @param {any} ArgReminder
   * @returns {boolean}
   */
  #ReminderHasGitHubLinks(ArgReminder) {
    return Array.isArray(ArgReminder.GitHubUrls) && ArgReminder.GitHubUrls.length > 0;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleProcessRemindersNowAsync(ArgSlackApp, ArgEventInfo) {
    await this.#CheckRemindersAsync(true);

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Processed any pending reminders."
    );
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleTestRandomReminderAsync(ArgSlackApp, ArgEventInfo) {
    const PendingReminders = this.#GetPendingRemindersQueue();
    if(PendingReminders.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "No pending reminders available to test."
      );
      return true;
    }

    const RandomIndex = Math.floor(Math.random() * PendingReminders.length);
    const ReminderToTest = PendingReminders[RandomIndex];

    await this.#DisplayTestReminderAsync(ArgSlackApp, ArgEventInfo, ReminderToTest);
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgReminderId
   * @returns {Promise<boolean>}
   */
  async #HandleTestReminderByIdAsync(ArgSlackApp, ArgEventInfo, ArgReminderId) {
    const ReminderToTest = this.#GetPendingRemindersQueue().find((/** @type {any} */ r) => r.ReminderID === ArgReminderId);

    if(!ReminderToTest) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `Reminder with ID \`${ArgReminderId}\` not found in pending reminders.`
      );
      return true;
    }

    await this.#DisplayTestReminderAsync(ArgSlackApp, ArgEventInfo, ReminderToTest);
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleTestGitHubSyncAsync(ArgSlackApp, ArgEventInfo) {
    const GitHubSyncModule = this.#GetGitHubSyncModuleInstance();
    const IsAdminOrOwner = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
    if(!IsAdminOrOwner) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "Only workspace admins or owners can run GitHub sync debug commands."
      );
      return true;
    }

    if(!GitHubSyncModule) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "GitHub sync module is not available."
      );
      return true;
    }

    const GitHubUrls = this.#ExtractGitHubUrls(ArgEventInfo.text);
    const RemindersModuleContext = { SlackApp: ArgSlackApp };
    const TestResult = GitHubUrls.length > 0
      ? await GitHubSyncModule.TestGitHubUrlAsync(RemindersModuleContext, GitHubUrls[0])
      : await GitHubSyncModule.TestWorkspacePatAsync(RemindersModuleContext);

    const StatusPrefix = TestResult.ok ? 'SUCCESS:' : 'ERROR:';
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `${StatusPrefix} ${TestResult.message}`
    );
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @returns {Promise<boolean>}
   */
  async #HandleRunGitHubSyncNowAsync(ArgSlackApp, ArgEventInfo) {
    const GitHubSyncModule = this.#GetGitHubSyncModuleInstance();
    const IsAdminOrOwner = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
    if(!IsAdminOrOwner) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Only workspace admins or owners can trigger a manual GitHub sync.'
      );
      return true;
    }

    if(!GitHubSyncModule) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'GitHub sync module is not available.'
      );
      return true;
    }

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Running GitHub sync now\u2026'
    );

    const SyncResult = await GitHubSyncModule.RunNowAsync();
    const StatusPrefix = SyncResult.ok ? 'SUCCESS:' : 'ERROR:';
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `${StatusPrefix} ${SyncResult.message}`
    );
    return true;
  }

  /**
   * @param {any} ArgSlackApp
   * @param {any} ArgEventInfo
   * @param {any} ArgReminder
   * @returns {Promise<void>}
   */
  async #DisplayTestReminderAsync(ArgSlackApp, ArgEventInfo, ArgReminder) {
    const CompactText = await BuildCompactTextForReminder(ArgSlackApp, ArgReminder, 'A');

    const HeaderMessage = `*Testing Reminder:* \`${ArgReminder.ReminderID}\`\n` +
      `• *OriginalSenderID (creator):* <@${ArgReminder.OriginalSenderID}>\n` +
      `• *AssigneeID (for):* ${ArgReminder.AssigneeID ? `<@${ArgReminder.AssigneeID}>` : '_not set_'}\n` +
      `• *Created:* ${ArgReminder.CreatedOn.toISOString()}\n` +
      `• *Due:* ${ArgReminder.ShouldPostOn.toISOString()}`;

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, HeaderMessage);

    const OutputMessage = `*Reminder Output:*\n${CompactText}\n\n` +
      `_This format is consistent across all triggers: show reminders, show my reminders, ` +
      `daily digest, and when the reminder fires._`;

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, OutputMessage);

    const TaggedUser = ArgReminder.AssigneeID || ArgReminder.OriginalSenderID;
    const IsAssigneeDifferent = ArgReminder.AssigneeID && ArgReminder.AssigneeID !== ArgReminder.OriginalSenderID;

    let SummaryStatus;
    if(IsAssigneeDifferent) {
      SummaryStatus = `✅ *Correctly tags assignee:* <@${ArgReminder.AssigneeID}> (created by <@${ArgReminder.OriginalSenderID}>)`;
    } else if(ArgReminder.AssigneeID) {
      SummaryStatus = `✅ *Creator and assignee are the same:* <@${ArgReminder.AssigneeID}>`;
    } else {
      SummaryStatus = `ℹ️ *No AssigneeID set:* Falls back to creator <@${ArgReminder.OriginalSenderID}>`;
    }

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, SummaryStatus);
  }

  /**
   * @param {any} ArgMessageText
   * @returns {Array<string>}
   */
  #ExtractGitHubUrls(ArgMessageText) {
    return ExtractGitHubUrls(ArgMessageText);
  }
}

module.exports = RemindersAppMentionHandler;
// Exposed for regression tests that lock the standalone-command anchoring (see REMEMBER_ABOVE_PATTERN).
module.exports.REMEMBER_ABOVE_PATTERN = REMEMBER_ABOVE_PATTERN;
module.exports.SEND_TO_GITHUB_PATTERN = SEND_TO_GITHUB_PATTERN;
// GH-55: exported so the noise corpus is a runnable fixture rather than a comment. The gate item
// "conversational noise does NOT fire an AI call" is only checkable against the production rule.
module.exports.IsObjectPositionPronounReference = IsObjectPositionPronounReference;
module.exports.CHANNEL_ANTECEDENT_MAX_AGE_SECONDS = CHANNEL_ANTECEDENT_MAX_AGE_SECONDS;
