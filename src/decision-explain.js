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
 * Extract Slack user-mention IDs from text, in first-appearance order, de-duplicated.
 *
 * Shared so the triage view, the replay harness, and the reminder write path all read ownership from
 * ONE rule rather than three copies of a regex that can drift apart — which is the whole premise of
 * this consolidation. `<@U123>` and `<@U123|display>` both yield `U123`.
 * @param {string} ArgText
 * @param {string} [ArgExcludeID] Optional ID to drop (the bot must never be an assignee).
 * @returns {string[]}
 */
function ExtractMentionIDs(ArgText, ArgExcludeID) {
  if(!ArgText || typeof ArgText !== 'string') return [];

  const Pattern = /<@([^>|]+)(?:\|[^>]*)?>/g;
  /** @type {string[]} */
  const Ids = [];
  let Match;
  while((Match = Pattern.exec(ArgText)) !== null) {
    const Id = Match[1];
    if(!Ids.includes(Id)) Ids.push(Id);
  }
  return ArgExcludeID ? Ids.filter(ArgId => ArgId !== ArgExcludeID) : Ids;
}

/**
 * Describe how a reminder's assignees were resolved from a message, for the triage view.
 *
 * Originally (GH-44 Phase 5) a pure diagnostic of mention-scraping. GH-43 Phase 1A replaced that rule
 * with a grammatical-subject resolver, so callers now pass the resolver's own verdict through
 * `ArgOptions` and this renders it. `senderExcludedByMentions` stays as the regression tell: it means
 * the author committed to something and is still not on the reminder.
 * @param {string[]} ArgMentionedIDs Mention IDs extracted from the source text, in order.
 * @param {string[]} ArgAssigneeIDs Assignees actually persisted.
 * @param {string} ArgSenderID Original sender.
 * @param {{ResolvedBy?: string, NotifyIDs?: string[]}} [ArgOptions] Facts from
 * `ReminderOwnership.ResolveAssignees`. Omitted by callers that have no resolver verdict, which then
 * fall back to describing the mention set.
 * @returns {object} A fact bag suitable for RenderDecisionFactsSection.
 */
function DescribeAssigneeResolution(ArgMentionedIDs, ArgAssigneeIDs, ArgSenderID, ArgOptions = {}) {
  const Mentioned = Array.isArray(ArgMentionedIDs) ? ArgMentionedIDs : [];
  const Assignees = Array.isArray(ArgAssigneeIDs) ? ArgAssigneeIDs : [];
  const NotifyIDs = Array.isArray(ArgOptions?.NotifyIDs) ? ArgOptions.NotifyIDs : [];
  const SenderIsAssignee = Assignees.includes(ArgSenderID);

  /** @type {Record<string, any>} */
  const Facts = {
    resolvedFrom: ArgOptions?.ResolvedBy
      || (Mentioned.length > 0 ? 'message mentions' : 'sender fallback'),
    mentionsFound: Mentioned.length,
    assignees: Assignees.length > 0 ? Assignees.map(ArgID => `<@${ArgID}>`).join(', ') : '_none_',
    senderIsAssignee: SenderIsAssignee,
    // The GH-43 tell: the author committed to something but is not on the reminder.
    senderExcludedByMentions: Mentioned.length > 0 && !SenderIsAssignee,
  };
  // only rendered when there is somebody to notify — an empty "notify: none" line on every single
  // triage is noise, and this section is read while someone is debugging something else.
  if(NotifyIDs.length > 0) Facts.notify = NotifyIDs.map(ArgID => `<@${ArgID}>`).join(', ');
  return Facts;
}

module.exports = {
  RenderDecisionFacts,
  RenderDecisionFactsSection,
  DescribeAssigneeResolution,
  ExtractMentionIDs,
  MaxValueLength,
};
