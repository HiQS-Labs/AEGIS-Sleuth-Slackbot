
'use strict';

const DisplaySelection = require('./reminder-display-selection');
const Ownership = require('./reminder-ownership');
const ContextResolution = require('./reminder-context-resolution');
const SlackFormatUtils = require('./slack-format-utils');

/**
 * Candidate preparation shared by scheduling and triage. No AI, clock, IDs, workspace state or I/O.
 * Candidate references are retained for the legacy callback/maps; input arrays/objects are not changed.
 * @param {object} ArgInput
 * @param {any[]} ArgInput.Candidates
 * @param {string} ArgInput.OriginalText Normalized display source.
 * @param {string} ArgInput.AnalyzedText Full source used for grounding.
 * @param {boolean} ArgInput.SynthesisOn Already decided by the existing routing owner.
 * @param {boolean} [ArgInput.Enriched]
 * @param {string} [ArgInput.LiveReplyText]
 */
function PrepareReminderCandidates(ArgInput) {
  /** @type {Map<any, {Text: string, Selection: ReturnType<typeof DisplaySelection.SelectTaskText>}>} */
  const Views = new Map();
  const Seen = new Set();
  const Distinct = [];
  for(const Candidate of (ArgInput.Candidates || [])) {
    const Selection = DisplaySelection.SelectTaskText(
      Candidate, ArgInput.OriginalText.trim(), ArgInput.SynthesisOn, ArgInput.AnalyzedText,
    );
    const Text = SlackFormatUtils.NormalizeUserMentionsToMrkdwn(Selection.text);
    Views.set(Candidate, { Text, Selection });
    const Key = `${Candidate.scheduling_trigger} ${Text}`;
    if(Seen.has(Key)) continue;
    Seen.add(Key);
    // GH-250 phase 3: a title the repair step rewrote is still the live reply restated beside its
    // siblings, so the pointer filter reads what the repair replaced (`title_repair.from`).
    Distinct.push({
      candidate: Candidate, text: Text,
      rawText: Candidate.title_repair?.from || Candidate.reminder_message || Candidate.actionable_language || '',
    });
  }
  const Filter = DisplaySelection.DropUnresolvedReferenceCandidates(
    Distinct, Boolean(ArgInput.Enriched), ContextResolution.NeedsEarlierContext, ArgInput.LiveReplyText || '',
  );
  return {
    Candidates: Filter.kept,
    Groups: Ownership.GroupCandidatesByTrigger(Filter.kept),
    Views,
    BeforeReferenceCount: Distinct.length,
    DroppedReferenceCount: Filter.droppedCount,
  };
}

/**
 * Resolve one trigger group's ownership from explicit inputs, without creating a reminder.
 * Call at the existing per-group point: planning must not reorder factory/dedup/save/List effects.
 * @param {any[]} ArgCandidates
 * @param {object} ArgInput
 * @param {string} ArgInput.MessageText
 * @param {string} ArgInput.LiveReplyText
 * @param {string[]} ArgInput.MentionedIDs
 * @param {string} ArgInput.SenderID
 */
function PlanTriggerOwnership(ArgCandidates, ArgInput) {
  const Owner = Ownership.ReduceGroupOwner(ArgCandidates);
  const Resolution = Ownership.ResolveAssignees({
    MessageText: ArgInput.MessageText,
    LiveReplyText: ArgInput.LiveReplyText,
    ActionableLanguage: ArgCandidates.map(ArgCandidate => ArgCandidate.actionable_language || '').join(' ').trim(),
    MentionedIDs: ArgInput.MentionedIDs,
    SenderID: ArgInput.SenderID,
    AnalyzerOwner: Owner.owner,
    AnalyzerOwnerMentions: Owner.ownerMentions,
  });
  return { Owner, Resolution, Disagreement: Ownership.FindOwnerDisagreement(ArgCandidates) };
}

module.exports = { PrepareReminderCandidates, PlanTriggerOwnership };

