'use strict';

const { ExtractMentionIDs } = require('./decision-explain');

/**
 * Who owns a reminder (GH-43 Phase 1A).
 *
 * The defect this fixes: ownership was decided by scraping every `<@U…>` in the source and using the
 * sender only when that set came back empty. A status report addressed to two colleagues and ending
 * in "i am going to deploy the changes tomorrow morning" therefore assigned the deploy to the two
 * people it was merely *addressed to*, and left its author — the only person who committed to
 * anything — off the reminder entirely.
 *
 * The missing signal was never the mention list. It was **who the grammatical subject of the
 * commitment is**. This module reads that, deterministically, with no model call:
 *
 *   1. First-person commitment ("I'll…", "i am going to…") ⇒ the SENDER owns it, whoever was
 *      mentioned. Mentions become notify-only.
 *   2. Second-person ask ("@alpha can you…", "please…") ⇒ the MENTIONED people own it. This is what
 *      keeps GH-22 shared assignment working — "can you both test this" still assigns to both.
 *   3. Neither ⇒ today's behavior, unchanged: mentions if present, else the sender.
 *
 * Deliberately NOT a model call. This is the cheap deterministic layer; a per-candidate `owner` field
 * from the analyzer (Phase 1B) can refine it later, but the common case should not need one.
 */

/**
 * First-person **subject** markers — the speaker as the one doing the thing.
 *
 * Deliberately SUBJECT forms only. `my`, `me`, and `myself` used to be in this list and were a
 * genuine mis-assignment bug (found by Codex in the branch relay, round 2): they are possessive and
 * object forms, so they say the speaker is *involved*, never that the speaker is *acting*.
 * `<@U_ALPHA> will deploy my report tomorrow` was assigned to the sender purely because `my`
 * appeared — the exact "mentioned ≠ assigned" error inverted, with the module claiming to read the
 * grammatical subject while actually matching any first-person token anywhere.
 *
 * Kept to the singular: "we" is ambiguous between the speaker and the team, and guessing wrong
 * reassigns someone else's work.
 */
const FirstPersonPattern = /\b(i|i'm|im|i'll|ill|i've|ive|i'd)\b/i;

/**
 * Positive first-person **commitment constructions** — the speaker, immediately followed by their
 * own action.
 *
 * This replaces a growing denylist and that change is the point. Successive reviews kept producing a
 * new phrase that had to be excluded — `my report`, quoted speech, `I asked … to`, then
 * `I need <@alpha> to`, then `I won't` — because the underlying test was "does a first-person token
 * appear anywhere", which is not a subject test at all. Each fix narrowed one hole and left the shape
 * intact. A denylist of ways to be wrong can never be finished; an allowlist of ways to be right can.
 *
 * Matching is done on apostrophe-stripped text so `I'll` / `ill` / `Ill` are one case.
 *
 * What this deliberately does NOT match, each a witness from review:
 *  - `I need <@U_ALPHA> to deploy`  — an object intervenes, so the subject of the obligation is Alpha
 *  - `I asked <@U_ALPHA> to deploy` — reporting a delegation
 *  - `I won't deploy`               — negated; `wont`/`cant` are simply not modals here
 *  - `<@U_ALPHA> will deploy my report` — a possessive, no first-person subject at all
 *
 * Every alternative is `\b`-anchored, and that is not decoration: without it `ill\s+\w+` matches
 * inside **w-ill**, so `"<@U_ALPHA> will deploy my report"` read as a first-person commitment. Caught
 * by this module's own test table before it could ship.
 */
const FirstPersonCommitmentPattern = new RegExp([
  // I'll deploy · Ill deploy
  '\\bill\\s+(?!not\\b|never\\b)\\w+',
  // I will/shall/can/should/must/would deploy
  '\\bi\\s+(?:will|shall|can|could|should|must|would|gotta)\\s+(?!not\\b|never\\b)\\w+',
  // Im deploying · I am deploying
  '\\bi(?:m\\b|\\s+am)\\s+\\w+ing\\b',
  // Im going to deploy · I am going to deploy
  '\\bi(?:m\\b|\\s+am)\\s+going\\s+to\\s+(?!not\\b)\\w+',
  // I need/have/had/plan/intend/expect/hope/want/aim TO deploy — the `to` must be immediate, which is
  // exactly what separates a commitment from `I need <@alpha> to deploy`.
  '\\bi(?:ve\\b)?\\s+(?:need|needs|needed|have|has|had|plan|planned|intend|expect|hope|want|aim|got)\\s+to\\s+(?!not\\b)\\w+',
  // Id like to deploy
  '\\bid\\s+like\\s+to\\s+\\w+',
].join('|'), 'i');

/**
 * Negation markers. Checked on apostrophe-stripped text, so `won't` arrives as `wont`.
 * A commitment that is negated is not a commitment.
 */
const NegationPattern = /\b(not|never|no longer|cannot|cant|wont|shant|unable|dont|doesnt|didnt|isnt|arent|wasnt|werent)\b/i;

/** Second-person ask markers — the signal that someone else is being asked to act. */
const SecondPersonPattern = /\b(can you|could you|would you|will you|can u|please|pls|kindly|you should|you need to|you both|you all|your turn)\b/i;

/**
 * Attribution to somebody else — `<@U_ALPHA> said`, `Alpha mentioned`, `they told me`. Any
 * first-person text after one of these is being REPORTED, not committed to.
 *
 * `I said I'll do it` is deliberately unaffected: `I` is a single capital with no lowercase tail,
 * so neither alternative matches it, and the sentence stays the speaker's own commitment.
 */
const ReportedSpeechAttributionPattern =
  /(^|[\s>(])(<@[^>]+>|\b[A-Z][a-z]+\b|\bthey\b|\bhe\b|\bshe\b)\s+(said|says|saids|mentioned|told|tells|wrote|writes|noted|confirmed|replied|asked)\b/i;

/**
 * The part of a Slack message the AUTHOR actually wrote — blockquote lines removed.
 *
 * Slack renders `> text` as a quotation, and quoting a colleague's commitment is the most natural
 * way to reply to it ("> @alpha: I'll deploy tomorrow — sounds good"). {@link StripQuotedRegions}
 * only knows double quotes, so without this the quoted `I'll deploy` reads as the replier's own
 * commitment and the work is assigned to the wrong person (GH-143, found in cross-model review).
 * @param {string} ArgText
 * @returns {string}
 */
function StripSlackBlockquotes(ArgText) {
  return (ArgText || '')
    .split(/\r?\n/)
    .filter(ArgLine => !/^\s*&gt;|^\s*>/.test(ArgLine))
    .join('\n');
}

/**
 * Detect a leading address block: one or more consecutive mentions at the very start of a message,
 * followed by prose. This is the Slack convention for "FYI, addressed to you" and is a strong signal
 * those people are the AUDIENCE, not the owners.
 * @param {string} ArgText Message text.
 * @returns {string[]} mention IDs in the leading block (empty when the message does not open with one).
 */
function DetectLeadingAddressBlock(ArgText) {
  if(!ArgText || typeof ArgText !== 'string') return [];

  const Leading = ArgText.trimStart();
  const BlockMatch = Leading.match(/^((?:\s*<@[^>|]+(?:\|[^>]*)?>\s*[,:]?\s*)+)/);
  if(!BlockMatch) return [];

  // a message that is ONLY mentions has no prose to address — treat it as no address block, since
  // there is no statement to attribute to anyone.
  const Remainder = Leading.slice(BlockMatch[0].length).trim();
  if(Remainder.length === 0) return [];

  return ExtractMentionIDs(BlockMatch[1]);
}

/**
 * Remove double-quoted regions from a span. **Both** person tests run on the result, and that
 * symmetry is the whole point.
 *
 * Quoted text is somebody else's words or a literal name, so it must not decide who owns the work in
 * either direction:
 *  - **First person inside quotes** is reported speech.
 *    `<@U_ALPHA> said "I will deploy the patch"` commits the author to nothing.
 *  - **Second person inside quotes** is usually a task NAME, not a request.
 *    `I will deploy the feature called "Please Retry"` was assigned to Alpha purely because the word
 *    `Please` appeared inside a product name — an ordinary-traffic case, and a clean demonstration
 *    that stripping for one test and not the other is worse than not stripping at all.
 *
 * (The second half was caught by Codex in branch relay round 7, after round 6 stripped only for the
 * first-person test.)
 *
 * Single quotes are deliberately left alone — indistinguishable from the apostrophes in `I'll` and
 * `don't`, so treating them as quotation would misread ordinary contractions.
 * @param {string} ArgText
 * @returns {string}
 */
function StripQuotedRegions(ArgText) {
  return (ArgText || '').replace(/["“][^"”]*["”]/g, ' ');
}

/**
 * Whether a span reads as the speaker committing to do something themselves.
 * @param {string} ArgActionableLanguage The quoted actionable span (NOT the whole message — an
 * unrelated first-person sentence elsewhere in a long note must not hijack ownership).
 * @returns {boolean}
 */
function HasFirstPersonCommitment(ArgActionableLanguage) {
  const Text = (ArgActionableLanguage || '').trim();
  if(!Text) return false;

  // Quoted regions are removed BEFORE either person test — see StripQuotedRegions for why the order
  // matters and what went wrong when only one of the two stripped.
  const Unquoted = StripQuotedRegions(Text);

  // a second-person ask wins even when it contains a stray first-person token
  // ("can you send me the logs")
  if(SecondPersonPattern.test(Unquoted)) return false;

  // apostrophes stripped so I'll / Ill / I'm / Im are one case
  const Normalized = Unquoted.replace(/['’]/g, '');

  // Negation ANYWHERE in the span disqualifies it. The per-modal lookaheads only rejected an
  // immediately following negative, so an intervening adverb walked straight past them:
  // `I will definitely not deploy` and `I can no longer deploy` both read as commitments and
  // assigned the work to somebody who had just said they would not do it. (Codex, branch relay
  // round 5.) An actionable span is short, so a negation in it is about the action; the rare
  // false negative falls through to the analyzer verdict, which is the safe direction.
  if(NegationPattern.test(Normalized)) return false;

  return FirstPersonCommitmentPattern.test(Normalized);
}

/**
 * Whether an actionable span sits inside a quotation in the original message — i.e. it is somebody
 * else's **reported speech**, not the author committing to anything.
 *
 * `<@U_ALPHA> said "I will deploy the patch tomorrow"` yields the span `I will deploy the patch`,
 * which is first-person and would otherwise assign the deploy to the message's author. The commitment
 * is Alpha's; the author is only reporting it. (Codex, branch relay round 2.)
 *
 * Only DOUBLE quotes count. Single quotes are indistinguishable from the apostrophes in `I'll` and
 * `don't`, so treating them as quotation would misread ordinary contractions as reported speech.
 * @param {string} ArgMessageText Full original message text.
 * @param {string} ArgActionableLanguage The quoted actionable span.
 * @returns {boolean}
 */
function IsSpanInsideQuotedSpeech(ArgMessageText, ArgActionableLanguage) {
  const Span = (ArgActionableLanguage || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const Message = ArgMessageText || '';
  if(!Span || !Message) return false;

  for(const Match of Message.matchAll(/["“]([^"”]+)["”]/g)) {
    const Quoted = (Match[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
    // the quotation must CONTAIN the span. A span that merely contains a short quoted fragment — the
    // quoted-task-name case, `I need to work on "On-going Project: X"` — is the author's own
    // commitment and must keep resolving to them.
    if(Quoted.length >= Span.length && Quoted.includes(Span)) return true;
  }
  return false;
}

/**
 * Whether a span reads as asking someone else to act.
 *
 * Quoted regions are stripped first, for the same reason the first-person test strips them: a
 * `please` inside a quoted task name is not a request. See {@link StripQuotedRegions}.
 * @param {string} ArgActionableLanguage
 * @returns {boolean}
 */
function HasSecondPersonAsk(ArgActionableLanguage) {
  return SecondPersonPattern.test(StripQuotedRegions((ArgActionableLanguage || '').trim()));
}

/**
 * Constrain a model-proposed assignee to people who actually appear in the source (GH-43 Phase 1B).
 *
 * **This is the "never invent users" rule enforced in code rather than only in a prompt.** Both
 * ownership paths ask a model who owns a task, and a prompt instruction is not an guarantee — a model
 * can hallucinate a plausible-looking `U…` id, and nothing downstream would notice. The model may
 * only ever *narrow* the candidate set, never add to it.
 * @param {string|null|undefined} ArgProposedID The id the model returned.
 * @param {string[]} ArgAllowedIDs Everyone who genuinely appears in the source (authors + mentions).
 * @param {string|null} [ArgFallbackID] Used when the proposal is rejected or absent.
 * @returns {{assigneeID: string|null, wasRejected: boolean}} `wasRejected` is true only when the
 * model proposed somebody and that somebody was not in the source — the signal worth logging.
 */
function ConstrainAssigneeToParticipants(ArgProposedID, ArgAllowedIDs, ArgFallbackID = null) {
  const Proposed = typeof ArgProposedID === 'string' ? ArgProposedID.trim() : '';
  const Allowed = Array.isArray(ArgAllowedIDs) ? ArgAllowedIDs.filter(Boolean) : [];

  if(!Proposed) return { assigneeID: ArgFallbackID || null, wasRejected: false };
  if(Allowed.includes(Proposed)) return { assigneeID: Proposed, wasRejected: false };
  return { assigneeID: ArgFallbackID || null, wasRejected: true };
}

/**
 * Resolve a reminder's assignees.
 *
 * **Precedence, and why it differs from the Phase 1B plan sketch.** That sketch had the analyzer's
 * `owner` field as the source of truth with the mention regex demoted to a guardrail. It was written
 * before Phase 1A existed. Phase 1A turned out to resolve both battery ownership scenarios correctly
 * at zero model cost, so making a model call authoritative *over* a proven deterministic signal would
 * trade a free correct answer for a paid uncertain one — and would put GH-22 shared assignment back
 * at the mercy of a prompt. So the order is inverted from the sketch:
 *
 *   1-2. A **strong grammatical signal wins outright** — an explicit first-person commitment or an
 *        explicit second-person ask. The analyzer is not consulted; Phase 1A behavior is byte-identical.
 *   3.   Only when grammar is **ambiguous** (no first- or second-person marker) does the analyzer's
 *        verdict get a say. This is the case Phase 1A could not reach, e.g. a bare "the deploy is
 *        tomorrow" after an address block.
 *   4.   Failing all of that, the Phase 1A fallbacks: mentions if present, else the sender.
 *
 * The intersection guard from the plan is preserved and load bearing: `owner_mentions` is intersected
 * with the mentions actually present in the source, so the model can only narrow.
 *
 * @param {Object} ArgInput
 * @param {string} ArgInput.MessageText Full original message text (for the address-block check).
 * @param {string} [ArgInput.ActionableLanguage] The quoted actionable span driving this reminder.
 * @param {string[]} [ArgInput.MentionedIDs] Human mention IDs already extracted from the source.
 * @param {string} ArgInput.SenderID Original sender.
 * @param {string} [ArgInput.LiveReplyText] GH-143, enriched thread replies only: the sender's OWN
 * raw reply, before thread context was prepended. When the analyzer's span quotes an ask out of the
 * prepended context — written by somebody else, whose "you" refers to the replier — the
 * second-person rule below would hand the work to the asker. A first-person commitment in the live
 * reply is the replier taking the work, and it outranks that misread.
 * @param {'speaker'|'mentioned'|'unclear'|null} [ArgInput.AnalyzerOwner] The analyzer's `owner`
 * verdict for this trigger group, when the candidates agree on one. Absent for older responses.
 * @param {string[]} [ArgInput.AnalyzerOwnerMentions] The analyzer's `owner_mentions`, intersected
 * with `MentionedIDs` before use.
 * @returns {{assigneeIDs: string[], notifyIDs: string[], resolvedBy: string}}
 * `resolvedBy` is one of `first-person-commitment` | `live-reply-commitment` | `second-person-ask` |
 * `analyzer-speaker` | `analyzer-mentioned` | `mentions` | `sender-fallback`, and is surfaced in the
 * `:wrench:` triage so the decision is inspectable.
 */
function ResolveAssignees(ArgInput) {
  const MessageText = ArgInput.MessageText || '';
  const ActionableLanguage = ArgInput.ActionableLanguage || '';
  const SenderID = ArgInput.SenderID || '';
  const MentionedIDs = Array.isArray(ArgInput.MentionedIDs)
    ? ArgInput.MentionedIDs
    : ExtractMentionIDs(MessageText);

  // 1. the speaker committed to it themselves — unless the commitment is somebody else's reported
  // speech, in which case the strong override must NOT fire and the case falls through to the
  // analyzer verdict and the mention fallbacks below.
  if(HasFirstPersonCommitment(ActionableLanguage)
    && !IsSpanInsideQuotedSpeech(MessageText, ActionableLanguage)) {
    return {
      assigneeIDs: SenderID ? [SenderID] : MentionedIDs,
      // people who were addressed but did not take the work — real interested parties, not owners.
      notifyIDs: MentionedIDs.filter(ArgID => ArgID !== SenderID),
      resolvedBy: 'first-person-commitment',
    };
  }

  // 1b. GH-143 — the sender's live reply is itself a first-person commitment. On the enriched
  // thread path the analyzer reads context + reply as one blob, so its span can quote the ask from
  // the PREPENDED message ("Could you please file a new GH issue?") — written by someone else, whose
  // "you" is this sender. Rule 2 below would then assign the work to the asker via the reply's
  // mention of them ("<@asker> can do, I'll work on it today" → the asker). The reply's own grammar
  // outranks a span the sender did not write. HasFirstPersonCommitment already strips quoted
  // regions and rejects spans with second-person asks or negation, so a reply that merely reports
  // or declines does not take the work.
  // Only the author's OWN words count. Slack blockquotes and reported speech ("<@alpha> said I'll
  // deploy") are somebody else's commitment being relayed; treating them as the replier's is the
  // same mis-assignment this rule exists to prevent, inverted. Conservative by design: when the
  // reply looks like relaying, fall through to the rules below rather than guessing.
  const LiveReplyText = StripSlackBlockquotes(ArgInput.LiveReplyText || '').trim();
  if(LiveReplyText
    && !ReportedSpeechAttributionPattern.test(LiveReplyText)
    && HasFirstPersonCommitment(LiveReplyText)) {
    return {
      assigneeIDs: SenderID ? [SenderID] : MentionedIDs,
      notifyIDs: MentionedIDs.filter(ArgID => ArgID !== SenderID),
      resolvedBy: 'live-reply-commitment',
    };
  }

  // 2. someone else was asked. Mentions own it — this is the GH-22 shared-assignment path.
  if(MentionedIDs.length > 0 && HasSecondPersonAsk(ActionableLanguage)) {
    return { assigneeIDs: MentionedIDs, notifyIDs: [], resolvedBy: 'second-person-ask' };
  }

  // 3. grammar is ambiguous — now the analyzer's verdict is worth something (GH-43 Phase 1B).
  const AnalyzerOwner = ArgInput.AnalyzerOwner || null;
  if(AnalyzerOwner === 'speaker' && SenderID) {
    return {
      assigneeIDs: [SenderID],
      notifyIDs: MentionedIDs.filter(ArgID => ArgID !== SenderID),
      resolvedBy: 'analyzer-speaker',
    };
  }
  if(AnalyzerOwner === 'mentioned') {
    // THE INTERSECTION IS LOAD BEARING: the model may narrow the mention set, never extend it.
    const Proposed = Array.isArray(ArgInput.AnalyzerOwnerMentions) ? ArgInput.AnalyzerOwnerMentions : [];
    const Narrowed = MentionedIDs.filter(ArgID => Proposed.includes(ArgID));
    if(Narrowed.length > 0) {
      return {
        assigneeIDs: Narrowed,
        notifyIDs: MentionedIDs.filter(ArgID => !Narrowed.includes(ArgID) && ArgID !== SenderID),
        resolvedBy: 'analyzer-mentioned',
      };
    }
    // an empty intersection means the model named nobody real. Fall through rather than assign to
    // nobody — a dropped reminder is worse than a slightly wrong assignee.
  }

  // 4. no signal at all: Phase 1A behavior, unchanged. A leading address block is still a hint that
  // those people are an audience, but without a commitment there is nobody else to attribute the work
  // to, so narrowing here would drop the reminder on the floor.
  if(MentionedIDs.length > 0) {
    return { assigneeIDs: MentionedIDs, notifyIDs: [], resolvedBy: 'mentions' };
  }

  return { assigneeIDs: SenderID ? [SenderID] : [], notifyIDs: [], resolvedBy: 'sender-fallback' };
}

/**
 * Collapse a trigger group's per-candidate `owner` verdicts into one, for the single-message analyzer
 * path where every candidate under a trigger produces a single reminder with a single assignee set.
 * Unanimity is required: candidates that disagree about who owns the work are `unclear` by definition,
 * and picking a winner would be guessing.
 * @param {Array<{owner?: string, owner_mentions?: string[]}>} ArgCandidates
 * @returns {{owner: 'speaker'|'mentioned'|'unclear'|null, ownerMentions: string[]}}
 */
function ReduceGroupOwner(ArgCandidates) {
  const Candidates = Array.isArray(ArgCandidates) ? ArgCandidates : [];
  const Verdicts = Candidates.map(ArgC => ArgC?.owner).filter(ArgO => typeof ArgO === 'string' && ArgO);
  if(Verdicts.length === 0) return { owner: null, ownerMentions: [] };

  const Unanimous = Verdicts.every(ArgO => ArgO === Verdicts[0]) ? Verdicts[0] : 'unclear';
  const OwnerMentions = /** @type {string[]} */ ([]);
  for(const Candidate of Candidates) {
    for(const Id of (Array.isArray(Candidate?.owner_mentions) ? Candidate.owner_mentions : [])) {
      if(typeof Id === 'string' && Id && !OwnerMentions.includes(Id)) OwnerMentions.push(Id);
    }
  }
  return {
    owner: /** @type {'speaker'|'mentioned'|'unclear'} */ (Unanimous),
    ownerMentions: OwnerMentions,
  };
}

/**
 * Group analyzer candidates by their scheduling trigger — **the boundary at which ownership is
 * decided**, because one trigger group becomes one reminder with one assignee set.
 *
 * Shared so scheduling and the `:wrench:` triage cannot disagree about what a "group" is. They did:
 * scheduling resolved each trigger independently while triage concatenated every trigger's actionable
 * span into one resolver call, so a message with `tomorrow`/"I will deploy" and `friday`/"please
 * review" scheduled correctly as two reminders (`U_SENDER`, then `U_ALPHA`) while triage confidently
 * explained the whole thing as `U_ALPHA` / `second-person-ask`. Patching the warning that was supposed
 * to catch that only treated the symptom; this is the cause. (Codex, branch relay round 9.)
 * @param {Array<{scheduling_trigger?: string}>} ArgCandidates
 * @returns {Array<{trigger: string, candidates: any[]}>} groups in first-seen order.
 */
function GroupCandidatesByTrigger(ArgCandidates) {
  /** @type {Map<string, any[]>} */
  const ByTrigger = new Map();
  for(const Candidate of (Array.isArray(ArgCandidates) ? ArgCandidates : [])) {
    const Trigger = (Candidate && Candidate.scheduling_trigger) || '';
    if(!ByTrigger.has(Trigger)) ByTrigger.set(Trigger, []);
    /** @type {any[]} */ (ByTrigger.get(Trigger)).push(Candidate);
  }
  return [...ByTrigger.entries()].map(([ArgTrigger, ArgGroup]) => ({
    trigger: ArgTrigger, candidates: ArgGroup,
  }));
}

/**
 * Distinct, decided owner verdicts among a trigger group's candidates.
 *
 * One trigger group becomes ONE reminder with ONE assignee set, so a message that commits the author
 * to X while asking somebody else to do Y *under the same trigger* cannot be represented — the spans
 * are concatenated and a single resolver call picks one owner. GH-43's plan named this the hardest
 * ownership case and pre-authorized documenting it: *"a documented limitation is acceptable, a silent
 * wrong answer is not."*
 *
 * This exists so scheduling and the `:wrench:` triage derive the disagreement THE SAME WAY. Round 7
 * of the Codex relay caught that scheduling logged it server-side while triage rebuilt its own
 * explanation and never mentioned it — so a user debugging a wrong assignee saw a confident single
 * `resolvedBy` and no hint of the limitation. That is the diagnostic-vs-production divergence class
 * this branch has been closing throughout; one helper, both callers.
 *
 * **GROUPING IS DONE HERE, not by the caller**, which is round 8's correction. Scheduling passes one
 * already-grouped trigger; triage has the whole ungrouped candidate list. When triage did its own
 * thing, two candidates with DIFFERENT triggers (`tomorrow`/speaker and `friday`/mentioned) reported
 * a limitation that does not exist — production represents those as two separate reminders, each with
 * its own owner. A diagnostic that invents a limitation is as bad as one that hides a real one, so
 * the grouping rule lives in the helper and neither caller can get it wrong.
 * @param {Array<{owner?: string, scheduling_trigger?: string}>} ArgCandidates
 * @returns {string[]} the distinct decided owners within a single trigger group, or `[]` when no
 * group disagrees. Deduplicated across groups so the caller gets one flat answer.
 */
function FindOwnerDisagreement(ArgCandidates) {
  const Candidates = Array.isArray(ArgCandidates) ? ArgCandidates : [];
  if(Candidates.length < 2) return [];

  /** @type {Map<string, Set<string>>} */
  const OwnersByTrigger = new Map();
  for(const Candidate of Candidates) {
    const Owner = Candidate && Candidate.owner;
    if(typeof Owner !== 'string' || !Owner || Owner === 'unclear') continue;
    const Trigger = (Candidate && Candidate.scheduling_trigger) || '';
    if(!OwnersByTrigger.has(Trigger)) OwnersByTrigger.set(Trigger, new Set());
    /** @type {Set<string>} */ (OwnersByTrigger.get(Trigger)).add(Owner);
  }

  const Disagreeing = /** @type {string[]} */ ([]);
  for(const Owners of OwnersByTrigger.values()) {
    if(Owners.size < 2) continue;
    for(const Owner of Owners) if(!Disagreeing.includes(Owner)) Disagreeing.push(Owner);
  }
  return Disagreeing;
}

module.exports = {
  ResolveAssignees,
  ConstrainAssigneeToParticipants,
  ReduceGroupOwner,
  GroupCandidatesByTrigger,
  FindOwnerDisagreement,
  StripQuotedRegions,
  StripSlackBlockquotes,
  IsSpanInsideQuotedSpeech,
  DetectLeadingAddressBlock,
  HasFirstPersonCommitment,
  HasSecondPersonAsk,
  FirstPersonPattern,
  SecondPersonPattern,
};
