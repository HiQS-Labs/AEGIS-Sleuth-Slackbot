'use strict';

const SlackFormatUtils = require('./slack-format-utils');

/**
 * Render a decision's debug facts for a human (GH-44 Phase 4/5).
 *
 * The `:wrench:` reminder triage could already tell you WHAT was decided — recommendation, rationale,
 * candidates, date parse. It could not tell you WHY the output looked the way it did: the synthesis
 * routing facts that decide verbatim-vs-synthesized, and the mention set that decides ownership, both
 * lived only in a server log line, which is not somewhere a person debugging a bad reminder in Slack
 * will ever look.
 *
 * This module is deliberately decision-AGNOSTIC: it renders whatever fact bag a spec's `DebugFacts`
 * extractor produced, so a new decision gets an explain surface by declaring facts rather than by
 * touching any rendering code. Formatting goes through the existing SlackFormatUtils primitives —
 * GH-391 keeps one render primitive, and this is not a second one.
 */

/** Values longer than this are truncated in the rendered line. */
const MaxValueLength = 160;

/** Facts rendered first, in this order, when present. The rest follow alphabetically. */
const PreferredOrder = Object.freeze([
  'recommendation',
  'candidateCount',
  'segment',
  'synthesisOn',
  'sentenceCount',
  'actionableSpanRatio',
  'messageLength',
]);

/**
 * Format one fact value for inline display. Objects/arrays are JSON-ified so a nested bag still
 * renders something useful rather than `[object Object]`.
 * @param {any} ArgValue
 * @returns {string}
 */
function FormatValue(ArgValue) {
  if(ArgValue === null || ArgValue === undefined) return '_none_';
  if(typeof ArgValue === 'boolean') return ArgValue ? 'yes' : 'no';
  if(typeof ArgValue === 'number' || typeof ArgValue === 'string') {
    return SlackFormatUtils.SanitizeForInlineSlack(String(ArgValue), MaxValueLength);
  }
  try {
    return SlackFormatUtils.SanitizeForInlineSlack(JSON.stringify(ArgValue), MaxValueLength);
  } catch(error) {
    return '_unrenderable_';
  }
}

/**
 * Order fact keys: the well-known ones first (so the routing story reads top-to-bottom the way a
 * human reasons about it), then anything else alphabetically for stability.
 * @param {string[]} ArgKeys
 * @returns {string[]}
 */
function OrderKeys(ArgKeys) {
  const Preferred = PreferredOrder.filter(ArgKey => ArgKeys.includes(ArgKey));
  const Rest = ArgKeys.filter(ArgKey => !PreferredOrder.includes(ArgKey)).sort();
  return [...Preferred, ...Rest];
}

/**
 * Render a fact bag as Slack bullet lines. Returns `[]` for an absent or empty bag, so a caller can
 * spread it unconditionally without producing an empty section header.
 * @param {Record<string, any>|null|undefined} ArgFacts Fact bag from a spec's DebugFacts extractor.
 * @param {{ Indent?: string }} [ArgOptions]
 * @returns {string[]}
 */
function RenderDecisionFacts(ArgFacts, ArgOptions = {}) {
  if(!ArgFacts || typeof ArgFacts !== 'object' || Array.isArray(ArgFacts)) return [];

  const Facts = /** @type {Record<string, any>} */ (ArgFacts);
  const Keys = Object.keys(Facts);
  if(Keys.length === 0) return [];

  const Indent = ArgOptions.Indent || '';
  return OrderKeys(Keys).map(ArgKey =>
    `${Indent}• ${SlackFormatUtils.SanitizeForInlineSlack(ArgKey, 60)}: ${FormatValue(Facts[ArgKey])}`
  );
}

/**
 * Render a labelled section for a fact bag, or `[]` when there is nothing to say. Keeping the header
 * inside this helper is what stops a decision with no `DebugFacts` from rendering a bare heading with
 * nothing under it.
 * @param {string} ArgTitle Section heading (rendered bold).
 * @param {Record<string, any>|null|undefined} ArgFacts
 * @param {{ Indent?: string }} [ArgOptions]
 * @returns {string[]}
 */
function RenderDecisionFactsSection(ArgTitle, ArgFacts, ArgOptions = {}) {
  const Lines = RenderDecisionFacts(ArgFacts, ArgOptions);
  if(Lines.length === 0) return [];
  return [`*${SlackFormatUtils.SanitizeForInlineSlack(ArgTitle, 80)}:*`, ...Lines];
}

/**
 * Describe how a reminder's assignees were resolved from a message, for the triage view.
 *
 * This is a *diagnostic* of today's behavior, not a fix: ownership currently comes from scraping
 * every `<@U…>` in the quoted original, with the sender used only when that set is empty. Surfacing
 * it is what makes the GH-43 "mentioned ≠ assigned" defect visible to a human at the moment they are
 * looking at a wrong reminder, instead of only in hindsight.
 * @param {string[]} ArgMentionedIDs Mention IDs extracted from the source text, in order.
 * @param {string[]} ArgAssigneeIDs Assignees actually persisted.
 * @param {string} ArgSenderID Original sender.
 * @returns {object} A fact bag suitable for RenderDecisionFactsSection.
 */
function DescribeAssigneeResolution(ArgMentionedIDs, ArgAssigneeIDs, ArgSenderID) {
  const Mentioned = Array.isArray(ArgMentionedIDs) ? ArgMentionedIDs : [];
  const Assignees = Array.isArray(ArgAssigneeIDs) ? ArgAssigneeIDs : [];
  const SenderIsAssignee = Assignees.includes(ArgSenderID);

  return {
    resolvedFrom: Mentioned.length > 0 ? 'message mentions' : 'sender fallback',
    mentionsFound: Mentioned.length,
    assignees: Assignees.length > 0 ? Assignees.map(ArgID => `<@${ArgID}>`).join(', ') : '_none_',
    senderIsAssignee: SenderIsAssignee,
    // The GH-43 tell: the author committed to something but is not on the reminder.
    senderExcludedByMentions: Mentioned.length > 0 && !SenderIsAssignee,
  };
}

module.exports = {
  RenderDecisionFacts,
  RenderDecisionFactsSection,
  DescribeAssigneeResolution,
  MaxValueLength,
};
