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
function SelectTaskTextRaw(ArgReminderInfo, ArgNormalizedOriginalText = '', ArgSynthesisOn = undefined, ArgAnalyzedSourceText = '') {
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
 * Never show a context marker to a person.
 *
 * The verbatim display path returns the analyzed source unchanged, and since GH-143 that source
 * begins with `[earlier messages in this thread, for reference]`. A reminder whose entire title was
 * that header shipped to the replay harness — caught there, but it is exactly the class of leak
 * that reaches a user as gibberish. Stripping here rather than at each call site means a future
 * display path cannot forget: the markers are internal wire format, and this is the boundary
 * between wire format and a human.
 *
 * Grounding still measures against the FULL source, markers included — this only affects what is
 * shown, never what a title is checked against.
 * @param {string} ArgText
 * @returns {string}
 */
function StripContextMarkers(ArgText) {
  const MarkerLine = /^\s*\[(?:earlier messages in this thread, for reference|the message to act on)\]\s*$/i;
  const Text = ArgText || '';

  // Numbering is stripped ONLY when a marker proves this text is the resolver's wire format.
  // Stripping unconditionally deleted a user's own numbering: "1. ship the release" became "ship
  // the release", silently editing what a person wrote. A marker line is the only reliable signal
  // that the digits came from us rather than from them. (agy review, 2026-08-27.)
  const IsWireFormat = Text.split(/\r?\n/).some((/** @type {string} */ ArgLine) => MarkerLine.test(ArgLine));

  return Text
    .split(/\r?\n/)
    .filter((/** @type {string} */ ArgLine) => !MarkerLine.test(ArgLine))
    .map((/** @type {string} */ ArgLine) => (IsWireFormat ? ArgLine.replace(/^\s*\d+\.\s+/, '') : ArgLine))
    .join('\n')
    .trim();
}

/**
 * {@link SelectTaskTextRaw}, with the wire-format markers removed from whatever it chose to show.
 * @param {any} ArgReminderInfo
 * @param {string} [ArgNormalizedOriginalText]
 * @param {boolean} [ArgSynthesisOn]
 * @param {string} [ArgAnalyzedSourceText]
 */
function SelectTaskText(ArgReminderInfo, ArgNormalizedOriginalText = '', ArgSynthesisOn = undefined, ArgAnalyzedSourceText = '') {
  const Selection = SelectTaskTextRaw(ArgReminderInfo, ArgNormalizedOriginalText, ArgSynthesisOn, ArgAnalyzedSourceText);
  return { ...Selection, text: StripContextMarkers(Selection.text) };
}


/**
 * Drop a candidate that is only the LIVE REPLY echoed back — the pointer sitting beside its own
 * expansion — without touching a candidate that merely happens to contain a pronoun.
 *
 * The narrow rule matters. The first version dropped every title the reference detector matched
 * whenever any sibling did not, and that deletes real work: a thread "the cache bug is blocking
 * users" then "I'll file a GH issue about it tomorrow and discuss it with the team Friday" yields
 * "File a GH issue about the cache bug" AND "Discuss it with the team" — the second is a separate
 * Friday commitment, it carries a pronoun, and it was being deleted purely because the first
 * survived. Found by Codex review; the two original guards (only-when-enriched, never-empty)
 * prevent an empty result, not that data loss.
 *
 * So the test is redundancy, not vagueness: the candidate must both read as a bare pointer AND be
 * the live reply restated. "can you do all of the above" is the message itself, carrying nothing
 * its siblings do not already carry. "Discuss it with the team" is not.
 * @param {Array<{candidate: any, text: string}>} ArgRendered Candidates with their displayed text.
 * @param {boolean} ArgEnriched Whether earlier context was prepended for this message.
 * @param {(ArgText: string) => boolean} ArgIsUnresolved Reference detector (NeedsEarlierContext).
 * @param {string} [ArgLiveReplyText] The author's own message, unenriched.
 * @returns {{kept: Array<any>, droppedCount: number}}
 */
function DropUnresolvedReferenceCandidates(ArgRendered, ArgEnriched, ArgIsUnresolved, ArgLiveReplyText = '') {
  const All = ArgRendered.map(ArgEntry => ArgEntry.candidate);
  // Without prepended context there is nothing the reference COULD have resolved into, so the
  // vague title may be the only record of the task. Keep it.
  if(!ArgEnriched) return { kept: All, droppedCount: 0 };

  const Normalize = (/** @type {string} */ ArgText) =>
    (ArgText || '').toLowerCase().replace(/<@[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const LiveReply = Normalize(ArgLiveReplyText);
  if(!LiveReply) return { kept: All, droppedCount: 0 };

  // Substring containment alone is not enough: "discuss it with the team" IS a substring of
  // "I'll file a GH issue about it tomorrow and discuss it with the team Friday", yet it is a
  // distinct commitment, not the reply restated. An echo has to account for MOST of the reply.
  const ECHO_COVERAGE = 0.6;
  const IsEchoOfLiveReply = (/** @type {string} */ ArgText) => {
    const Title = Normalize(ArgText);
    if(!Title) return false;
    if(!LiveReply.includes(Title) && !Title.includes(LiveReply)) return false;
    return Title.length >= LiveReply.length * ECHO_COVERAGE;
  };

  const Kept = ArgRendered
    .filter(ArgEntry => !(ArgIsUnresolved(ArgEntry.text) && IsEchoOfLiveReply(ArgEntry.text)))
    .map(ArgEntry => ArgEntry.candidate);
  // Never return nothing. A message whose every candidate is a bare pointer still schedules
  // something a human can act on by opening the thread.
  if(Kept.length === 0) return { kept: All, droppedCount: 0 };

  return { kept: Kept, droppedCount: All.length - Kept.length };
}

module.exports = { SelectTaskText, SelectContextLine, DropUnresolvedReferenceCandidates, StripContextMarkers };
