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
 * First-person singular commitment markers. Kept to the singular deliberately: "we" is ambiguous
 * between the speaker and the team, and guessing wrong reassigns someone else's work.
 */
const FirstPersonPattern = /\b(i|i'm|im|i'll|ill|i've|ive|i'd|my|me|myself)\b/i;

/** Second-person ask markers — the signal that someone else is being asked to act. */
const SecondPersonPattern = /\b(can you|could you|would you|will you|can u|please|pls|kindly|you should|you need to|you both|you all|your turn)\b/i;

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
 * Whether a span reads as the speaker committing to do something themselves.
 * @param {string} ArgActionableLanguage The quoted actionable span (NOT the whole message — an
 * unrelated first-person sentence elsewhere in a long note must not hijack ownership).
 * @returns {boolean}
 */
function HasFirstPersonCommitment(ArgActionableLanguage) {
  const Text = (ArgActionableLanguage || '').trim();
  if(!Text) return false;
  // a second-person ask wins even when it contains a stray "my"/"me" ("can you send me the logs")
  if(SecondPersonPattern.test(Text)) return false;
  return FirstPersonPattern.test(Text);
}

/**
 * Whether a span reads as asking someone else to act.
 * @param {string} ArgActionableLanguage
 * @returns {boolean}
 */
function HasSecondPersonAsk(ArgActionableLanguage) {
  return SecondPersonPattern.test((ArgActionableLanguage || '').trim());
}

/**
 * Resolve a reminder's assignees.
 *
 * @param {Object} ArgInput
 * @param {string} ArgInput.MessageText Full original message text (for the address-block check).
 * @param {string} [ArgInput.ActionableLanguage] The quoted actionable span driving this reminder.
 * @param {string[]} [ArgInput.MentionedIDs] Human mention IDs already extracted from the source.
 * @param {string} ArgInput.SenderID Original sender.
 * @returns {{assigneeIDs: string[], notifyIDs: string[], resolvedBy: string}}
 * `resolvedBy` is one of `first-person-commitment` | `second-person-ask` | `mentions` |
 * `sender-fallback`, and is surfaced in the :wrench: triage so the decision is inspectable.
 */
function ResolveAssignees(ArgInput) {
  const MessageText = ArgInput.MessageText || '';
  const ActionableLanguage = ArgInput.ActionableLanguage || '';
  const SenderID = ArgInput.SenderID || '';
  const MentionedIDs = Array.isArray(ArgInput.MentionedIDs)
    ? ArgInput.MentionedIDs
    : ExtractMentionIDs(MessageText);

  // 1. the speaker committed to it themselves.
  if(HasFirstPersonCommitment(ActionableLanguage)) {
    return {
      assigneeIDs: SenderID ? [SenderID] : MentionedIDs,
      // people who were addressed but did not take the work — real interested parties, not owners.
      notifyIDs: MentionedIDs.filter(ArgID => ArgID !== SenderID),
      resolvedBy: 'first-person-commitment',
    };
  }

  // 2. someone else was asked. Mentions own it — this is the GH-22 shared-assignment path.
  if(MentionedIDs.length > 0 && HasSecondPersonAsk(ActionableLanguage)) {
    return { assigneeIDs: MentionedIDs, notifyIDs: [], resolvedBy: 'second-person-ask' };
  }

  // 3. no grammatical signal: today's behavior, unchanged. A leading address block is still a hint
  // that those people are an audience, but without a first-person commitment there is nobody else to
  // attribute the work to, so narrowing here would drop the reminder on the floor.
  if(MentionedIDs.length > 0) {
    return { assigneeIDs: MentionedIDs, notifyIDs: [], resolvedBy: 'mentions' };
  }

  return { assigneeIDs: SenderID ? [SenderID] : [], notifyIDs: [], resolvedBy: 'sender-fallback' };
}

module.exports = {
  ResolveAssignees,
  DetectLeadingAddressBlock,
  HasFirstPersonCommitment,
  HasSecondPersonAsk,
  FirstPersonPattern,
  SecondPersonPattern,
};
