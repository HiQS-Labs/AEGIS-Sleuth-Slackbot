'use strict';

/**
 * ONE answer to "does this message need earlier context, and if so, what is it?" (GH-143 Phase 2).
 *
 * THE DEFECT THIS EXISTS TO KILL. Four entry paths reach the scheduler — the `see above`
 * app-mention path, the semantic-`this` app-mention path, plain message auto-schedule, and the
 * :alarm_clock: reaction (force-schedule) — and each decided independently whether context
 * existed. Two did the lookback, two did not, so the same sentence produced a synthesized,
 * correctly-owned task through one door and a verbatim, wrongly-owned one through another.
 * The reported production case arrived through a door that had no enrichment at all.
 *
 * Two enrichment behaviors now hang off this one decision — {@link
 * ../reminders-ai-pipeline.DescribeSynthesisRouting} forces synthesis on, and {@link
 * ../reminder-ownership.ResolveAssignees} lets the live reply's own grammar outrank a
 * second-person ask quoted from prepended context. A path that skips the resolver silently opts
 * out of both, which is exactly how the defect looked from the outside: "the fix is deployed but
 * nothing changed."
 *
 * Callers keep their own ADMISSION rules (a scheduling trigger, an @mention, a reaction) — this
 * module answers only the context question, and answers it identically for everyone.
 */

// ── Reference detection: "the real task is in an earlier message" ────────────────────────────

// Vague self-assignment completions: "will do it at 10pm", "I'll handle it tomorrow", "gonna take
// care of it today". The object must be a vague pronoun, so the speaker is pointing at something
// already said rather than naming a task.
const VAGUE_COMPLETION_PATTERN = /\b(?:(?:i(?:'ll|'m\s+going\s+to|\s+will|\s+can|\s+am\s+going\s+to)|\bwill\b|gonna|going\s+to|can)\s+)?(?:do|handle|take\s+care\s+of|finish|complete|get\s+to|tackle|work\s+on)\s+(?:it|this|that)\b/i;

// A vague pronoun as the object of a preposition or a review/comms verb the completion pattern
// omits — "follow up on it", "circle back on this", "review it", "send it". "this"/"that" are
// excluded when they form a temporal phrase ("on this week"); "it" is never temporal.
const VAGUE_REFERENCE_PATTERN = new RegExp(
  '\\b' +
  '(?:' +
    '(?:about|on|onto|into|with|around|regarding|re|over)' +
    '|' +
    '(?:discuss|revisit|review|send|check|address|present|share|update)' +
  ')\\s+' +
  '(?:it\\b|(?:this|that)\\b(?!\\s+(?:week|month|year|day|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b))',
  'i',
);

// GH-424: the standalone word "above", verb-agnostic on purpose. An enumerated verb list is a
// losing game ("follow up on" → "follow on" → "see above" each needed a round); "above" is
// essentially never used except to point at earlier content.
const ABOVE_REFERENCE_PATTERN = /\babove\b/i;

// GH-55: the general rule the three patterns above are special cases of — an unresolved pronoun
// means "the task is elsewhere", but ONLY in OBJECT position. "get **it** done by Monday" points
// backward; "**it** will rain on friday" is small talk. Object position is decided by two CLOSED
// word classes, so this rule does not grow when someone invents a new way to say "finish this":
//   1. Clause boundaries — a pronoun opening a clause is that clause's subject.
//   2. Auxiliaries/modals — a pronoun immediately followed by one is that verb's subject.
// Both are needed; each alone admits a false positive the other rejects.
const CLAUSE_BOUNDARY_BEFORE_PRONOUN =
  /(?:^|[.,;:!?—-]|\b(?:and|but|or|so|because|that|which|when|while|if|then|though|although|since|unless)\b)\s*$/i;

const SUBJECT_AUXILIARY_AFTER_PRONOUN =
  /^\s*(?:'ll|'d|'s|’ll|’d|’s|is|isn't|are|aren't|was|wasn't|were|weren't|will|won't|would|wouldn't|can|can't|cannot|could|couldn't|shall|should|shouldn't|may|might|must|mustn't|has|hasn't|have|haven't|had|hadn't|does|doesn't|do|don't|did|didn't|seems|looks|sounds)\b/i;

const TEMPORAL_PHRASE_AFTER_DEMONSTRATIVE =
  /^\s*(?:week|month|year|day|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/**
 * True when the text carries a vague pronoun (it/this/that) in OBJECT position.
 * @param {string} ArgText
 * @returns {boolean}
 */
function IsObjectPositionPronounReference(ArgText) {
  const Text = ArgText || '';
  const PronounMatcher = /\b(it|this|that)\b/gi;
  let Match;
  while((Match = PronounMatcher.exec(Text)) !== null) {
    const Pronoun = Match[1].toLowerCase();
    const Before = Text.slice(0, Match.index);
    const After = Text.slice(Match.index + Match[0].length);
    if(CLAUSE_BOUNDARY_BEFORE_PRONOUN.test(Before)) continue;
    if(SUBJECT_AUXILIARY_AFTER_PRONOUN.test(After)) continue;
    if(Pronoun !== 'it' && TEMPORAL_PHRASE_AFTER_DEMONSTRATIVE.test(After)) continue;
    return true;
  }
  return false;
}

/**
 * Which reference shape fired, or null when the text stands on its own. The shape rides through to
 * the structural path in telemetry, so a wrong stitch names the rule that caused it.
 * @param {string} ArgText
 * @returns {'vague_completion'|'vague_reference'|'above_reference'|'object_position_pronoun'|null}
 */
function DescribeReferenceShape(ArgText) {
  const Text = ArgText || '';
  if(VAGUE_COMPLETION_PATTERN.test(Text)) return 'vague_completion';
  if(VAGUE_REFERENCE_PATTERN.test(Text)) return 'vague_reference';
  if(ABOVE_REFERENCE_PATTERN.test(Text)) return 'above_reference';
  if(IsObjectPositionPronounReference(Text)) return 'object_position_pronoun';
  return null;
}

/** True when the message points at something said earlier. @param {string} ArgText @returns {boolean} */
function NeedsEarlierContext(ArgText) {
  return DescribeReferenceShape(ArgText) !== null;
}

// ── Lookback windows ────────────────────────────────────────────────────────────────────────

/**
 * Preceding human messages prepended from a thread when the message POINTS backward ("above",
 * "follow up on it") — the referent of an explicit reference is often a few turns back.
 */
const THREAD_LOOKBACK_MAX_MESSAGES = 3;

/**
 * Preceding human messages prepended when the message contains NO backward reference — the
 * :alarm_clock: reaction on a self-contained sentence.
 *
 * ONE, deliberately, and this is not a caller preference: it follows from the message itself. A
 * thread asserts that messages belong together; it does not assert that they share a task. With no
 * reference to resolve there is nothing saying how far back to look, so prepending a backlog hands
 * the analyzer a neighbour's task text and a neighbour's @mention — that is how a reaction on a
 * self-contained reply scheduled the wrong text to the wrong person.
 * ponytail: the depth IS the relevance filter here; widen it only behind a real relevance test.
 */
const THREAD_LOOKBACK_MAX_UNREFERENCED = 1;

// GH-55 channel-lookback recency window. Named constants with a rationale, because both are the
// difference between "resolved the antecedent" and "stitched the wrong one".
// MAX_AGE: the reported production failure had 47 minutes between task and follow-up, so a window
// under an hour would not have fixed it. Two hours covers a working session without reaching into
// yesterday. SCAN_LIMIT: one conversations.history page — the participant-continuity filter, not
// the page size, is what decides correctness.
const CHANNEL_ANTECEDENT_MAX_AGE_SECONDS = 2 * 60 * 60;
const CHANNEL_ANTECEDENT_SCAN_LIMIT = 30;

/**
 * Whether channel-level antecedent lookback is armed. Default OFF — a kill switch for a change
 * that increases `conversations.history` + model call volume on a live workspace. Unset leaves
 * the resolver thread-only, exactly as it behaved before GH-55.
 * @returns {boolean}
 */
function IsChannelAntecedentLookbackEnabled() {
  const Raw = (process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED || '').trim().toLowerCase();
  return Raw === '1' || Raw === 'true' || Raw === 'yes' || Raw === 'on';
}

/**
 * Whether the :alarm_clock: reaction path may resolve context. Default ON — a reaction on a reply
 * that says "can do, I'll work on it today" is the case GH-143 was filed for, and that path
 * previously had no enrichment at all. Kept switchable because it is the one path where
 * enrichment is NEW behavior rather than a rule being shared.
 * @returns {boolean}
 */
function IsReactionContextResolutionEnabled() {
  const Raw = (process.env.REACTION_CONTEXT_RESOLUTION_ENABLED || '').trim().toLowerCase();
  if(!Raw) return true;
  return Raw === '1' || Raw === 'true' || Raw === 'yes' || Raw === 'on';
}

// ── Collection ──────────────────────────────────────────────────────────────────────────────

/**
 * Up to ArgMaxCount preceding human (non-bot) messages in the thread, oldest first so the model
 * reads the conversation naturally. Empty when not in a thread or the message is the root.
 * @param {any} ArgSlackApp
 * @param {{channel: string, ts: string, thread_ts?: string|null}} ArgEventInfo
 * @param {number} ArgMaxCount
 * @returns {Promise<Array<any>>}
 */
async function CollectPrecedingHumanThreadMessagesAsync(ArgSlackApp, ArgEventInfo, ArgMaxCount) {
  if(!ArgEventInfo.thread_ts) return [];

  const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(ArgEventInfo.channel, ArgEventInfo.thread_ts);
  const CurrentIndex = ThreadMessages.findIndex((/** @type {any} */ ArgMessage) => ArgMessage.ts === ArgEventInfo.ts);
  if(CurrentIndex <= 0) return [];

  const Collected = [];
  for(let MessageIndex = CurrentIndex - 1; MessageIndex >= 0 && Collected.length < ArgMaxCount; MessageIndex--) {
    const CandidateMessage = ThreadMessages[MessageIndex];
    if(CandidateMessage?.text && !CandidateMessage.bot_id)
      Collected.push(CandidateMessage);
  }

  return Collected.reverse();
}

/**
 * A single channel antecedent for a TOP-LEVEL message (GH-55).
 *
 * **Participant continuity is the load-bearing filter, not recency.** A busy channel interleaves
 * conversations, so time + message count alone will happily stitch "get it done by Friday" onto an
 * unrelated mention three messages earlier. A thread is an explicit human assertion that messages
 * belong together; a channel offers none, so the candidate must be from the follow-up's own author
 * or must mention them.
 * @param {any} ArgSlackApp
 * @param {{channel: string, ts: string, user?: string}} ArgEventInfo
 * @returns {Promise<Array<any>>}
 */
async function CollectChannelAntecedentCandidatesAsync(ArgSlackApp, ArgEventInfo) {
  const Recent = await ArgSlackApp.GetRecentChannelMessagesAsync(ArgEventInfo.channel, CHANNEL_ANTECEDENT_SCAN_LIMIT);
  const CurrentTs = Number(ArgEventInfo.ts);
  const AuthorMentionToken = ArgEventInfo.user ? `<@${ArgEventInfo.user}>` : null;

  // conversations.history returns newest-first; walking in that order makes the FIRST match the
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
 * @typedef {Object} ResolvedContext
 * @property {boolean} enriched True when earlier context was found and prepended.
 * @property {string} text What the analyzer should read — enriched, or the original when not.
 * @property {string} liveReplyText The author's own message, always, enrichment or not.
 * @property {{SourceTs: string|null, Path: string}|null} enrichment Provenance, null when not enriched.
 * @property {number} prependedCount How many earlier messages were prepended.
 * @property {string} decidedBy Why this outcome — for the telemetry line and for debugging a miss.
 */

/**
 * THE single context decision. Every entry path calls this; none re-implements it.
 *
 * It answers ONE question — "what earlier context exists for this message?" — and it answers it
 * the same way for every caller. It takes no admission flag: whether a given door is allowed to
 * spend a lookback is that door's own rule, enforced before the call (the `see above` path checks
 * {@link NeedsEarlierContext}, the semantic-`this` path checks its demonstrative gate, triage
 * mirrors the message path's gate, the :alarm_clock: reaction is itself a human assertion that
 * the message is a task). An admission option here re-created the four disagreeing policies this
 * module exists to delete, one layer down.
 * @param {any} ArgSlackApp
 * @param {{channel: string, ts: string, thread_ts?: string|null, user?: string, text?: string}} ArgEventInfo
 * @param {{PathPrefix?: string}} [ArgOptions]
 * @returns {Promise<ResolvedContext>}
 */
async function ResolveContextAsync(ArgSlackApp, ArgEventInfo, ArgOptions = {}) {
  const Text = ArgEventInfo.text || '';
  const InThread = Boolean(ArgEventInfo.thread_ts);

  /** @type {ResolvedContext} */
  const NotEnriched = {
    enriched: false, text: Text, liveReplyText: Text,
    enrichment: null, prependedCount: 0, decidedBy: 'no_context',
  };

  // Names the reference for the provenance Path only — it is NOT a gate. Callers gate themselves.
  const ReferenceShape = DescribeReferenceShape(Text);

  // Outside a thread the channel walk is behind a kill switch, so an unset flag leaves call
  // volume byte-identical to before GH-55.
  if(!InThread && !IsChannelAntecedentLookbackEnabled())
    return { ...NotEnriched, decidedBy: 'channel_lookback_disabled' };

  let PrecedingMessages = [];
  try {
    PrecedingMessages = InThread
      // How far back to look follows from the MESSAGE, not from the caller: an explicit backward
      // reference ("above", "follow up on it") licenses a few turns; without one there is nothing
      // saying how far back the referent is, so take only the message being replied to.
      ? await CollectPrecedingHumanThreadMessagesAsync(
        ArgSlackApp, ArgEventInfo,
        ReferenceShape ? THREAD_LOOKBACK_MAX_MESSAGES : THREAD_LOOKBACK_MAX_UNREFERENCED,
      )
      : await CollectChannelAntecedentCandidatesAsync(ArgSlackApp, ArgEventInfo);
  } catch(error) {
    // A lookback failure must never lose the reminder — fall back to the unenriched message.
    ArgSlackApp?.Logger?.error?.('context resolution: failed to fetch preceding messages:', error);
    return { ...NotEnriched, decidedBy: 'fetch_failed' };
  }

  if(PrecedingMessages.length === 0) return { ...NotEnriched, decidedBy: 'no_antecedent' };

  const ContextBlock = PrecedingMessages.map((/** @type {any} */ ArgMessage) => ArgMessage.text).join('\n');
  // A caller that names its path wins: the path is which DOOR the message came through, and that
  // must not change because the wording happened to also match a reference regex.
  const Shape = ArgOptions.PathPrefix || ReferenceShape || 'explicit_request';
  // The antecedent's ts is what makes a wrong stitch auditable rather than silent — it rides
  // through to the ReminderCreated ledger payload as `enrichedFrom` (GH-55).
  const AntecedentTs = PrecedingMessages[PrecedingMessages.length - 1]?.ts || null;

  return {
    enriched: true,
    text: `${ContextBlock}\n${Text}`,
    liveReplyText: Text,
    enrichment: { SourceTs: AntecedentTs, Path: `${Shape}_${InThread ? 'in_thread' : 'in_channel'}` },
    prependedCount: PrecedingMessages.length,
    decidedBy: InThread ? 'thread_context' : 'channel_context',
  };
}

module.exports = {
  ResolveContextAsync,
  NeedsEarlierContext,
  DescribeReferenceShape,
  IsObjectPositionPronounReference,
  IsChannelAntecedentLookbackEnabled,
  IsReactionContextResolutionEnabled,
  CollectPrecedingHumanThreadMessagesAsync,
  CollectChannelAntecedentCandidatesAsync,
  THREAD_LOOKBACK_MAX_MESSAGES,
  THREAD_LOOKBACK_MAX_UNREFERENCED,
  CHANNEL_ANTECEDENT_MAX_AGE_SECONDS,
  CHANNEL_ANTECEDENT_SCAN_LIMIT,
  VAGUE_COMPLETION_PATTERN,
  VAGUE_REFERENCE_PATTERN,
  ABOVE_REFERENCE_PATTERN,
};
