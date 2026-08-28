'use strict';

const TaskGrounding = require('./task-grounding');

/**
 * What a reminder candidate should DISPLAY — the pure decision, with no Slack formatting and no
 * logger (GH-43, extracted after the agy branch relay).
 *
 * ## Why this module exists
 *
 * It was inlined in `RemindersModule#SelectReminderTaskText`, and `scripts/decision-replay.js`
 * **reimplemented it** so the battery could observe what a user would see. agy's review caught what
 * that duplication cost: the harness's grounding perturbation test proved only that the *harness's
 * copy* of the check was wired up. Delete the production check entirely and the test still passes —
 * a perturbation that cannot detect the thing it exists to detect.
 *
 * That is the same class of defect as the fixture-mutation bug found earlier in the same harness: a
 * measurement apparatus quietly measuring itself. The fix for a duplicated rule is not a better test,
 * it is one rule. Both the production selector and the replay harness now call these functions, so a
 * perturbation of the grounding check reaches the code that actually renders reminders.
 *
 * Pure by design: no `SlackApp`, no mrkdwn, no I/O. Callers own presentation and logging, which is
 * exactly what let the harness reuse this without dragging in a Slack client.
 */

/**
 * @typedef {Object} DisplaySelectionInput
 * @property {string} [reminder_message] The analyzer's proposed short title.
 * @property {string} [actionable_language] The verbatim evidence span. Never rewritten.
 * @property {string} [context] One line of why (GH-43 Phase 3).
 */

/**
 * Choose the displayed task text for one reminder candidate.
 *
 * @param {DisplaySelectionInput} ArgReminderInfo Candidate from the analyzer.
 * @param {string} [ArgNormalizedOriginalText] Normalized original message (the verbatim source).
 * @param {boolean} [ArgSynthesisOn] The already-decided routing for this message. When omitted the
 * caller has no routing decision and the verbatim path is NOT taken — matching the historical
 * behavior where an absent decision meant "fall through to the candidate".
 * @param {string} [ArgAnalyzedSourceText] The FULL text the analyzer was given, including any
 * thread context GH-55 prepended. Grounding must be checked against everything the model actually
 * saw; see the grounding constant below for why a subset silently disables synthesis (GH-68).
 * @returns {{text: string, source: 'verbatim'|'title'|'span'|'fallback', ungroundedTerms: string[]}}
 * `ungroundedTerms` is non-empty only when a proposed title was REJECTED — that is the event worth
 * logging, and it is returned rather than logged so this stays pure.
 */
function SelectTaskText(ArgReminderInfo, ArgNormalizedOriginalText = '', ArgSynthesisOn = undefined, ArgAnalyzedSourceText = '') {
  const NormalizedOriginal = (ArgNormalizedOriginalText || '').trim();
  const Candidate = ArgReminderInfo || {};

  // verbatim path: synthesis disabled for this message's length segment → show the user's wording
  // unchanged. This reproduces the pre-GH-337 synthesis-OFF behavior byte-for-byte.
  if(NormalizedOriginal && ArgSynthesisOn === false)
    return { text: NormalizedOriginal, source: 'verbatim', ungroundedTerms: [] };

  const RawReminderMessage = (Candidate.reminder_message || '').trim();
  const ActionableLanguage = (Candidate.actionable_language || '').trim();

  // THE GROUNDING CONSTRAINT (GH-43 Phase 3). Synthesis is only safe because the title is checked
  // against the source before it is shown: the model may re-word freely, but every entity,
  // identifier, and number it names must already appear in the message. A title that invents one is
  // discarded and the quoted span is shown instead — a clumsier reminder beats a confidently wrong
  // one. The evidence span itself is never rewritten; that guarantee is untouched.
  //
  // GH-68: ground against everything the ANALYZER saw, not just the live reply. GH-55 prepends
  // thread context so the model can resolve "can you do this by tomorrow morning?" — but this check
  // measured against the un-enriched reply alone, so every antecedent-derived term counted as
  // invented and the title was discarded. The two features cancelled out exactly: enrichment on,
  // synthesis on, verbatim output. Widening keeps the guarantee (nothing outside the source may be
  // named) while measuring it against the real source.
  const GroundingSource = `${NormalizedOriginal} ${ActionableLanguage} ${(ArgAnalyzedSourceText || '').trim()}`;
  const UngroundedTerms = RawReminderMessage
    ? TaskGrounding.UngroundedTerms(RawReminderMessage, GroundingSource)
    : [];
  const ReminderMessage = UngroundedTerms.length > 0 ? '' : RawReminderMessage;

  // Deterministic quality fallback: a brief that looks suspiciously over-compressed relative to the
  // span it came from loses to the span.
  //
  // GH-43 TIGHTENED THIS FROM `<= 3` TO `<= 2` WORDS — a real behavior change to a GH-337 rule,
  // called out rather than slipped in. The old threshold fired on the reported message itself:
  // title `"deploy the changes"` (3 words, 18 chars) lost to span `"i am going to deploy the
  // changes"` (32 chars), because the span is longer only by a first-person preamble. That is not
  // over-compression, it is the preamble being correctly dropped, and it silently reintroduced the
  // "show me your raw words" behavior this issue exists to fix. The rule's genuine target is the
  // one-word title (`"Deploy"` against a rich span), which `<= 2` still catches.
  //
  // Safer now than when it was written: the grounding check above guarantees a surviving title uses
  // only source vocabulary, so a short title can no longer be short *and* invented.
  const ReminderWordCount = ReminderMessage.split(/\s+/).filter(Boolean).length;
  const IsLikelyOverCompressed = ReminderWordCount <= 2
    && ActionableLanguage.length > (ReminderMessage.length + 12);

  if(IsLikelyOverCompressed) return { text: ActionableLanguage, source: 'span', ungroundedTerms: UngroundedTerms };
  if(ReminderMessage) return { text: ReminderMessage, source: 'title', ungroundedTerms: UngroundedTerms };
  if(ActionableLanguage) return { text: ActionableLanguage, source: 'span', ungroundedTerms: UngroundedTerms };
  return {
    text: NormalizedOriginal || 'Task not specified',
    source: 'fallback',
    ungroundedTerms: UngroundedTerms,
  };
}

/**
 * Choose the subordinate context line for one reminder candidate, or `''` when there is none.
 *
 * Three things suppress it, each for its own reason:
 *  - **synthesis off** — the bullet is already the whole verbatim message, so a context line would
 *    restate text the reader is looking at.
 *  - **ungrounded** — the same constraint that governs the title. Context is prose *about* the
 *    message and is exactly where an invented detail would be most plausible and least checkable.
 *  - **redundant with the task** — a model that echoes the title as context adds noise.
 *
 * @param {DisplaySelectionInput} ArgReminderInfo Candidate from the analyzer.
 * @param {string} [ArgNormalizedOriginalText] Normalized original message text.
 * @param {boolean} [ArgSynthesisOn] The already-decided routing for this message.
 * @param {string} [ArgAnalyzedSourceText] Full text the analyzer saw, including prepended thread
 * context — same reason as SelectTaskText (GH-68).
 * @returns {{text: string, suppressedBy: null|'empty'|'verbatim-path'|'ungrounded'|'restates-task'}}
 */
function SelectContextLine(ArgReminderInfo, ArgNormalizedOriginalText = '', ArgSynthesisOn = undefined, ArgAnalyzedSourceText = '') {
  const Candidate = ArgReminderInfo || {};
  const Context = (Candidate.context || '').trim();
  if(!Context) return { text: '', suppressedBy: 'empty' };

  const NormalizedOriginal = (ArgNormalizedOriginalText || '').trim();
  if(ArgSynthesisOn === false) return { text: '', suppressedBy: 'verbatim-path' };

  const ActionableLanguage = (Candidate.actionable_language || '').trim();
  // GH-68: same widening as SelectTaskText — both grounded against a subset of what the model saw.
  const GroundingSource = `${NormalizedOriginal} ${ActionableLanguage} ${(ArgAnalyzedSourceText || '').trim()}`;
  if(TaskGrounding.UngroundedTerms(Context, GroundingSource).length > 0)
    return { text: '', suppressedBy: 'ungrounded' };

  // GH-143 Phase 2: pass the analyzed source through. Omitting it made this inner call grade the
  // title against LESS evidence than the real bullet did, so a title grounded only in prepended
  // context was rejected here and accepted there — and the context line then duplicated the
  // bullet it was supposed to explain ("• Fix GH-143" / "_Fix GH-143_"). Found in cross-model
  // review; reachable for short enriched replies now that they force synthesis.
  const Task = SelectTaskText(Candidate, NormalizedOriginal, ArgSynthesisOn, ArgAnalyzedSourceText).text;
  if(TaskGrounding.NormalizeForGrounding(Context) === TaskGrounding.NormalizeForGrounding(Task))
    return { text: '', suppressedBy: 'restates-task' };

  return { text: Context, suppressedBy: null };
}

/**
 * Drop candidates whose displayed title is still just a pointer at earlier content — "do all of
 * the above", "do it" — when the resolver DID supply that content and at least one sibling
 * candidate resolved it.
 *
 * Why this is a filter and not another prompt round. The reported thread produced three
 * candidates: `Take the car`, `Bring the cooler`, and the live reply echoed back as
 * `can you do all of the above`. Two of the three are the model doing exactly what it was asked;
 * the third is the un-expanded reference riding along beside its own expansion, so it carries no
 * information the other bullets do not already carry. Deleting it cannot lose a task.
 *
 * The two guards are what make that claim true, and neither is optional:
 *   - `ArgEnriched` — without prepended context there is nothing the reference COULD have been
 *     resolved into, so the vague title may be the only record of the task. Keep it.
 *   - at least one survivor — never return an empty set. A message whose every candidate is vague
 *     still schedules something a human can act on by opening the thread.
 * ponytail: a filter, not a rewrite. Inventing replacement text here would be the model's job done
 * badly, and would hide which prompt change actually worked.
 * @param {Array<{candidate: any, text: string}>} ArgRendered Candidates with their displayed text.
 * @param {boolean} ArgEnriched Whether earlier context was prepended for this message.
 * @param {(ArgText: string) => boolean} ArgIsUnresolved Reference detector (NeedsEarlierContext).
 * @returns {{kept: Array<any>, droppedCount: number}}
 */
function DropUnresolvedReferenceCandidates(ArgRendered, ArgEnriched, ArgIsUnresolved) {
  const All = ArgRendered.map(ArgEntry => ArgEntry.candidate);
  if(!ArgEnriched) return { kept: All, droppedCount: 0 };

  const Kept = ArgRendered.filter(ArgEntry => !ArgIsUnresolved(ArgEntry.text)).map(ArgEntry => ArgEntry.candidate);
  if(Kept.length === 0) return { kept: All, droppedCount: 0 };

  return { kept: Kept, droppedCount: All.length - Kept.length };
}

module.exports = { SelectTaskText, SelectContextLine, DropUnresolvedReferenceCandidates };
