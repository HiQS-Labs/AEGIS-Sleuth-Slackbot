'use strict';

const TaskGrounding = require('./task-grounding');
const TitleContract = require('./reminder-title-contract');
const { IsLongReminderMessage } = require('./reminder-judgement');

/**
 * Upper bound on a candidate taken from a LONG source (GH-243). A candidate longer than this is a
 * list dump, not a title, and is rejected outright rather than salvaged by the budget fit — the
 * long copy must never come back through any path. Context lines share the bound.
 */
const MAX_LONG_TASK_LENGTH = 280;

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
 * @property {string} [object_ref] GH-250 phase 3: the concrete thing the task is about.
 * @property {string[]} [subtasks] GH-250 phase 3: at most 3 named sub-items.
 * @property {{from: string, by: 'model', reasons: string[]}} [title_repair] Set by the scheduler
 * when the repair decision replaced `reminder_message`.
 */

/**
 * @typedef {Object} TitleContractFacts
 * @property {Array<{source: string, reasons: string[]}>} rejected Every candidate the contract
 * refused before the displayed one, with the rule slugs that refused it. Empty when the first
 * candidate in order was accepted.
 * @property {string[]} normalized Which transforms the normalizer applied to the displayed text.
 * @property {boolean} shortened Whether the displayed text was cut to the budget (at a boundary).
 * @property {string} unshortened The normalized text BEFORE the cut when `shortened`, else `''`.
 * This is what lets a harness prove the cut landed on a boundary of the real text.
 * @property {number} words Word count of the displayed text.
 * @property {number} chars Character count of the displayed text.
 * @property {null|{by: 'object-ref'|'model', from: string}} repair GH-250 phase 3: how a refused
 * title was repaired before it was shown — deterministically from the analyzer's `object_ref`, or
 * by the repair decision (recorded on the candidate as `title_repair`). Null when the displayed
 * text needed no repair.
 */

/**
 * GH-250 phase 3: the analyzer's structured fields, checked before anything reads them.
 *
 * `object_ref` is kept only when every term it names is in the source — an invented object would
 * otherwise be written INTO a title by the deterministic repair below. `subtasks` are each put
 * through the title contract and the grounding check, de-duplicated, and capped at the number a
 * delivered reminder shows; a long pasted list is thereby reduced to its first three valid lines.
 * @param {DisplaySelectionInput & {object_ref?: string, subtasks?: string[]}} ArgCandidate
 * @param {string} ArgGroundingSource Everything the analyzer saw, plus the candidate's own span.
 * @returns {{objectRef: string, subtasks: string[], reasons: string[]}} `reasons` names what was
 * dropped (`object-ref-ungrounded`, `subtask-refused`, `subtasks-capped`); empty when nothing was.
 */
function ValidateReminderCandidate(ArgCandidate, ArgGroundingSource) {
  const Candidate = ArgCandidate || {};
  /** @type {string[]} */
  const Reasons = [];

  let ObjectRef = typeof Candidate.object_ref === 'string' ? Candidate.object_ref.replace(/\s+/g, ' ').trim() : '';
  if(ObjectRef && TaskGrounding.UngroundedTerms(ObjectRef, ArgGroundingSource).length > 0) {
    Reasons.push('object-ref-ungrounded');
    ObjectRef = '';
  }

  /** @type {string[]} */
  const Subtasks = [];
  const RawSubtasks = Array.isArray(Candidate.subtasks) ? Candidate.subtasks : [];
  for(const Raw of RawSubtasks) {
    if(typeof Raw !== 'string') continue;
    const Normalized = TitleContract.NormalizeReminderTitle(Raw);
    const Validation = TitleContract.ValidateReminderTitle(Normalized.text, { RequireSingleSentence: true });
    if(!Validation.ok || TaskGrounding.UngroundedTerms(Normalized.text, ArgGroundingSource).length > 0) {
      Reasons.push('subtask-refused');
      continue;
    }
    const Fitted = TitleContract.FitTitleToBudget(Normalized.text).text;
    if(Subtasks.some(ArgKept => TaskGrounding.NormalizeForGrounding(ArgKept) === TaskGrounding.NormalizeForGrounding(Fitted))) continue;
    Subtasks.push(Fitted);
  }
  if(Subtasks.length > TitleContract.MAX_DISPLAYED_SUBTASKS) {
    Reasons.push('subtasks-capped');
    Subtasks.length = TitleContract.MAX_DISPLAYED_SUBTASKS;
  }

  return { objectRef: ObjectRef, subtasks: Subtasks, reasons: Reasons };
}

/**
 * A pointer in object position that a grounded `object_ref` can stand in for. Person pointers
 * (`him`, `her`) are deliberately absent: `Ask him` + `the invoice` is not `Ask the invoice`; that
 * case needs the model's repair, which can also name the person.
 */
const THING_POINTER_PATTERN = /\b(?:all of the above|the above|the rest|it|this|that|these|those|them)\b/gi;

/**
 * Replace the one thing-pointer in a title with the analyzer's grounded object (`Review it` +
 * `PR 697` → `Review PR 697`). Returns '' when the title has no pointer or more than one, so the
 * caller moves on rather than guessing which pointer the object belongs to.
 * @param {string} ArgTitle Normalized title that failed as a bare pointer.
 * @param {string} ArgObjectRef Grounded object from {@link ValidateReminderCandidate}.
 * @returns {string}
 */
function ReplaceThingPointer(ArgTitle, ArgObjectRef) {
  const Matches = [...String(ArgTitle || '').matchAll(THING_POINTER_PATTERN)];
  if(Matches.length !== 1 || !ArgObjectRef) return '';
  return String(ArgTitle).replace(THING_POINTER_PATTERN, ArgObjectRef);
}

/**
 * Choose the displayed task text for one reminder candidate.
 *
 * GH-250: whichever candidate wins, it is shown in ONE shape. Each candidate is normalized (framing,
 * addressee, courtesy and URLs removed), validated against the contract's hard rules, and only then
 * shortened to the budget at a clause or word boundary. A candidate the contract refuses is skipped
 * in favor of the next one; when every candidate is refused the templated fallback is used — never
 * the raw text, never a mid-word cut.
 *
 * Candidate ORDER keeps the routing decision meaningful: with synthesis off and a normal-length
 * source the user's own (normalized) sentence is tried first, as the flag promises; with synthesis
 * on, the analyzer's grounded title is tried first. The verbatim text is only ever a candidate when
 * it is itself a single task line — a multi-sentence message is not a title, whatever the flag says.
 *
 * @param {DisplaySelectionInput} ArgReminderInfo Candidate from the analyzer.
 * @param {string} [ArgNormalizedOriginalText] Normalized original message (the verbatim source).
 * @param {boolean} [ArgSynthesisOn] The already-decided routing for this message. When omitted the
 * caller has no routing decision and the verbatim path is NOT taken first — matching the historical
 * behavior where an absent decision meant "fall through to the candidate".
 * @param {string} [ArgAnalyzedSourceText] The FULL text the analyzer was given, including any
 * thread context GH-55 prepended. Grounding must be checked against everything the model actually
 * saw; see the grounding constant below for why a subset silently disables synthesis (GH-68).
 * @returns {{text: string, source: 'verbatim'|'title'|'span'|'fallback', ungroundedTerms: string[], contract: TitleContractFacts}}
 * `ungroundedTerms` is non-empty only when a proposed title was REJECTED — that is the event worth
 * logging, and it is returned rather than logged so this stays pure.
 */
function SelectTaskTextRaw(ArgReminderInfo, ArgNormalizedOriginalText = '', ArgSynthesisOn = undefined, ArgAnalyzedSourceText = '') {
  const NormalizedOriginal = (ArgNormalizedOriginalText || '').trim();
  const Candidate = ArgReminderInfo || {};

  // long-source safety is stronger than display flags and never falls back to the whole list
  // (GH-243). The verbatim text is not a candidate at all for a long source.
  const LongSource = IsLongReminderMessage(ArgNormalizedOriginalText) || IsLongReminderMessage(ArgAnalyzedSourceText);

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
  //
  // GH-250: the contract runs AFTER grounding and only removes text, so a title that passes here
  // still names nothing the source does not.
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

  /** @type {Array<{source: string, reasons: string[]}>} */
  const Rejected = [];
  if(UngroundedTerms.length > 0) Rejected.push({ source: 'title', reasons: ['ungrounded'] });
  else if(ReminderMessage && IsLikelyOverCompressed) Rejected.push({ source: 'title', reasons: ['over-compressed'] });

  /** @type {Array<{source: 'verbatim'|'title'|'span', text: string, options: {RequireSingleSentence?: boolean, MaxSourceChars?: number}}|null>} */
  const Order = [];
  // every candidate must be ONE task line: a multi-sentence or list-shaped text is a dump whichever
  // field it arrived in (the force-schedule path pins the span to the whole message; a model title
  // can be a pasted list). A long source additionally rejects anything over the GH-243 bound.
  const Options = LongSource
    ? { RequireSingleSentence: true, MaxSourceChars: MAX_LONG_TASK_LENGTH }
    : { RequireSingleSentence: true };
  const TitleCandidate = ReminderMessage && !IsLikelyOverCompressed
    ? { source: /** @type {'title'} */ ('title'), text: ReminderMessage, options: Options }
    : null;
  const SpanCandidate = ActionableLanguage
    ? { source: /** @type {'span'} */ ('span'), text: ActionableLanguage, options: Options }
    : null;
  const VerbatimCandidate = NormalizedOriginal && !LongSource
    ? { source: /** @type {'verbatim'} */ ('verbatim'), text: NormalizedOriginal, options: Options }
    : null;
  if(ArgSynthesisOn === false) Order.push(VerbatimCandidate, TitleCandidate, SpanCandidate);
  else Order.push(TitleCandidate, SpanCandidate, VerbatimCandidate);

  for(const Entry of Order) {
    if(!Entry) continue;
    const Normalized = TitleContract.NormalizeReminderTitle(Entry.text);
    const Validation = TitleContract.ValidateReminderTitle(Normalized.text, Entry.options);
    if(!Validation.ok) {
      Rejected.push({ source: Entry.source, reasons: Validation.reasons });
      continue;
    }
    // the grounding guarantee is re-checked on the text that will actually be shown. The normalizer
    // only removes text, but removing text INSIDE a quoted name would change which document or task
    // is named (`"The Kindly Migration"` → `"The Migration"`); quoted spans are protected from the
    // transforms, and this check is what makes that protection a guarantee rather than a hope.
    const RegroundedTerms = TaskGrounding.UngroundedTerms(Normalized.text, GroundingSource);
    if(RegroundedTerms.length > 0) {
      Rejected.push({ source: Entry.source, reasons: ['ungrounded-after-normalize'] });
      continue;
    }
    const Fitted = TitleContract.FitTitleToBudget(Normalized.text);
    // shortening may cut a title down to its verb (`Review "a very long quoted name…"` →
    // `Review…`); a shortened title must still satisfy the contract or it is no title.
    if(Fitted.shortened) {
      const AfterCut = TitleContract.ValidateReminderTitle(Fitted.text.replace(/…$/, ''));
      if(!AfterCut.ok) {
        Rejected.push({ source: Entry.source, reasons: AfterCut.reasons.map(ArgReason => `shortened:${ArgReason}`) });
        continue;
      }
    }
    return {
      text: Fitted.text,
      source: Entry.source,
      ungroundedTerms: UngroundedTerms,
      contract: {
        rejected: Rejected,
        normalized: Normalized.changes,
        shortened: Fitted.shortened,
        unshortened: Fitted.shortened ? Normalized.text : '',
        words: TitleContract.CountTitleWords(Fitted.text),
        chars: Fitted.text.length,
        // a title the repair decision rewrote arrives here as an ordinary candidate; it is
        // reported as repaired only when it is the one shown.
        repair: Entry.source === 'title' && Candidate.title_repair
          ? { by: /** @type {'model'} */ ('model'), from: String(Candidate.title_repair.from || '') }
          : null,
      },
    };
  }

  // GH-250 phase 3: deterministic repair from the analyzer's own structure. A candidate refused
  // ONLY for naming nothing (`Review it`) is rebuilt around the grounded `object_ref` (`PR 697`);
  // the result goes through the same validate → re-ground → fit gate as any candidate. Nothing is
  // guessed: without a grounded object, or with more than one pointer to replace, this does nothing.
  const Structure = ValidateReminderCandidate(Candidate, GroundingSource);
  if(Structure.objectRef) {
    const PointerOnly = new Set(['bare-pointer', 'too-short']);
    for(const Entry of Order) {
      if(!Entry) continue;
      const Refusal = Rejected.find(ArgRejected => ArgRejected.source === Entry.source && ArgRejected.reasons.every(ArgReason => PointerOnly.has(ArgReason)));
      if(!Refusal) continue;
      const Rebuilt = ReplaceThingPointer(TitleContract.NormalizeReminderTitle(Entry.text).text, Structure.objectRef);
      if(!Rebuilt) continue;
      const Normalized = TitleContract.NormalizeReminderTitle(Rebuilt);
      if(!TitleContract.ValidateReminderTitle(Normalized.text, Entry.options).ok) continue;
      if(TaskGrounding.UngroundedTerms(Normalized.text, GroundingSource).length > 0) continue;
      const Fitted = TitleContract.FitTitleToBudget(Normalized.text);
      if(Fitted.shortened && !TitleContract.ValidateReminderTitle(Fitted.text.replace(/…$/, '')).ok) continue;
      return {
        text: Fitted.text,
        source: Entry.source,
        ungroundedTerms: UngroundedTerms,
        contract: {
          rejected: Rejected,
          normalized: Normalized.changes,
          shortened: Fitted.shortened,
          unshortened: Fitted.shortened ? Normalized.text : '',
          words: TitleContract.CountTitleWords(Fitted.text),
          chars: Fitted.text.length,
          repair: { by: /** @type {'object-ref'} */ ('object-ref'), from: Entry.text },
        },
      };
    }
  }

  // Every candidate refused — including a candidate that is only a pointer (`Ask him`, `Do it`).
  // The template never reads a long source (its copy must not come back, GH-243) and never reads
  // the raw text: the subject goes through the same normalizer as a title, and it comes from the
  // live reply first, then from the earlier context the analyzer was given — which is where the
  // thing `him` or `the above` points at usually is. With no subject anywhere, the generic title.
  const SubjectLines = LongSource
    ? []
    : [NormalizedOriginal, ...ContextLinesOf(ArgAnalyzedSourceText)];
  const Fallback = TitleContract.BuildFallbackTitle(SubjectLines);

  return {
    text: Fallback.text,
    source: 'fallback',
    ungroundedTerms: UngroundedTerms,
    contract: {
      rejected: Rejected,
      normalized: [],
      shortened: Fallback.shortened,
      unshortened: Fallback.unshortened,
      words: TitleContract.CountTitleWords(Fallback.text),
      chars: Fallback.text.length,
      repair: null,
    },
  };
}

/**
 * The analyzed source as individual lines with the wire-format markers and their numbering removed,
 * for the fallback subject. Empty when there is no analyzed source.
 * @param {string} ArgAnalyzedSourceText
 * @returns {string[]}
 */
function ContextLinesOf(ArgAnalyzedSourceText) {
  return StripContextMarkers(ArgAnalyzedSourceText || '')
    .split(/\r?\n/)
    .map((/** @type {string} */ ArgLine) => ArgLine.trim())
    .filter(Boolean);
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
  if((IsLongReminderMessage(ArgNormalizedOriginalText) || IsLongReminderMessage(ArgAnalyzedSourceText))
    && (Context.length > MAX_LONG_TASK_LENGTH || /[\r\n]/.test(Context)))
    return { text: '', suppressedBy: 'empty' };

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
  // GH-250: a templated fallback carries its subject from the source, which is often the very line
  // the model offered as context. Compare without the template's prefix so that case is caught too.
  const TaskSubject = Task.startsWith(TitleContract.FALLBACK_TITLE_PREFIX)
    ? Task.slice(TitleContract.FALLBACK_TITLE_PREFIX.length)
    : Task;
  if(TaskGrounding.NormalizeForGrounding(Context) === TaskGrounding.NormalizeForGrounding(TaskSubject))
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
 * GH-250: the test reads the candidate's OWN words (`rawText`, the analyzer's title or span) when
 * the caller supplies them, not only the displayed text. The output contract replaces a pointer
 * title with a templated fallback (`Do all of the above` → `Follow up: Take the car`), and judged on
 * that display the echo would look resolved and survive beside the tasks it points at. Both sides
 * of the comparison go through the title normalizer, so request framing (`can you … tomorrow?`)
 * does not dilute the coverage ratio.
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
 * @param {Array<{candidate: any, text: string, rawText?: string}>} ArgRendered Candidates with
 * their displayed text and, optionally, the pre-contract text the pointer check should read.
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
    TitleContract.NormalizeReminderTitle(ArgText || '').text
      .toLowerCase().replace(/<@[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
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

  // both predicates must hold on the SAME text: a pointer title whose displayed text is a concrete
  // span that happens to echo the reply (`Do it` shown as `Deploy the hotfix tomorrow`) is a real
  // task, not a pointer echo.
  const IsPointerEcho = (/** @type {string} */ ArgText) => ArgIsUnresolved(ArgText) && IsEchoOfLiveReply(ArgText);
  const Kept = ArgRendered
    .filter(ArgEntry => !(IsPointerEcho(ArgEntry.rawText || ArgEntry.text) || IsPointerEcho(ArgEntry.text)))
    .map(ArgEntry => ArgEntry.candidate);
  // Never return nothing. A message whose every candidate is a bare pointer still schedules
  // something a human can act on by opening the thread.
  if(Kept.length === 0) return { kept: All, droppedCount: 0 };

  return { kept: Kept, droppedCount: All.length - Kept.length };
}

module.exports = {
  SelectTaskText, SelectContextLine, DropUnresolvedReferenceCandidates, StripContextMarkers,
  ValidateReminderCandidate,
};
