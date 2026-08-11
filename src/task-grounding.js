'use strict';

/**
 * Grounding constraint for synthesized reminder titles (GH-43 Phase 3).
 *
 * ## Why this exists
 *
 * The reminder pipeline made a blanket promise — *"Extract ONLY text that appears verbatim… Never
 * invent or paraphrase"* — and enforced it by simply never rewriting anything. That promise is right
 * for the **evidence span** (`actionable_language`, the quotation a human audits against) and wrong
 * for the **display title**, because it is exactly what forced a 480-character status report to be
 * shown as the task bullet: the only text guaranteed to be verbatim was the whole message.
 *
 * Phase 3 narrows the guarantee instead of dropping it. `actionable_language` stays byte-exact. The
 * displayed title may be rewritten, but every **entity-shaped** token it names must already appear in
 * the message. So the model may re-word ("i'll roll it out" → "Roll out the export bucket config
 * fix") but cannot introduce a system, product, person, date, or figure the author never mentioned.
 *
 * ## What this does NOT guarantee — stated plainly, because the earlier wording overclaimed
 *
 * "Entity-shaped" means the four categories below: quoted strings, numbers, identifier-shaped
 * tokens, and capitalized words. **A lowercase invented word is not caught.** `"Deploy acme"` against
 * a source that never says `acme` passes, because ordinary lowercase prose is never checked.
 *
 * That is a deliberate limit, not an oversight (raised by Codex, branch relay round 5). Requiring
 * every lowercase content word to appear in the source would mean the title may only use the source's
 * exact vocabulary — which forbids rewording, and rewording is the entire point of synthesis. Nearly
 * every title would fail and fall back to the verbatim message dump this module exists to eliminate,
 * reintroducing the original defect wholesale to close a much narrower hole. Closing it properly
 * needs a real lexicon (is this an English word or a product name?), which is tracked as an open item
 * on GH-43 rather than approximated here.
 *
 * The categories are chosen because they are where invention is both *likely* and *damaging*: models
 * capitalize the service and product names they invent, and a wrong figure or date is a factual claim.
 *
 * **This is enforced here, in code, not only in the prompt.** A prompt rule is a request; a model
 * under pressure to produce a tidy title will invent a plausible-sounding service name, and nothing
 * downstream would notice. When a title fails this check the caller falls back to the quoted span,
 * so the failure mode is a clumsier reminder rather than a confidently wrong one.
 *
 * ## What counts as an entity
 *
 * Deliberately NOT every word. Rewriting the verb is the entire point of synthesis, so ordinary
 * prose is free. Four things must be grounded:
 *
 *  1. **Quoted strings** — the existing quoted-task-name rule already treats these as sacred.
 *  2. **Numbers** — a count, version, or figure the author never wrote is a factual claim.
 *  3. **Identifier-shaped tokens** — `billing-sync`, `connection_pool`, `deploy.sh`, `PayloadV2`.
 *     These are system and product names, the most damaging thing to hallucinate.
 *  4. **Capitalized words** other than the first — proper nouns. The first word is skipped because an
 *     imperative title legitimately begins with a capitalized verb the source wrote in lowercase.
 */

/**
 * Common words that carry a capital for reasons other than being a proper noun. Without this, a
 * title beginning a clause with `I` or naming a weekday the source wrote differently would be
 * rejected for no good reason.
 */
/**
 * Imperative verbs a synthesized task title is allowed to OPEN with without grounding.
 *
 * The first word used to be exempt unconditionally, on the reasoning that an imperative title
 * legitimately begins with a capitalized verb the source wrote in lowercase. That reasoning is right;
 * the implementation was not. Skipping *every* first token meant an invented product name rendered
 * simply by being moved to the front — `"Acme deployment"` extracted no term at all and passed.
 * (Codex, branch relay round 3.)
 *
 * So the exemption is now **bounded and fails closed**: a first word on this list is treated as the
 * imperative verb it is, and anything else must be grounded like any other capitalized word.
 *
 * **The asymmetry is deliberate.** A verb missing from this list is not a correctness bug — the title
 * is simply required to be grounded, which it usually is, since the model is summarizing the source.
 * When it is not, the reminder falls back to quoting the user: worse, but visible and harmless. The
 * opposite mistake — an invented product name rendering as fact — is silent and is the thing this
 * module exists to stop. Gaps here cost readability; a bypass costs correctness.
 *
 * (A gap did bite once: `Change` was missing, and a real test title
 * `"Change Ground Advantage $5 shipping to $6"` fell back to the raw question. Hence the breadth.)
 */
const ImperativeVerbs = new Set([
  'add', 'address', 'adjust', 'align', 'allow', 'answer', 'apply', 'archive', 'ask', 'assign',
  'audit', 'automate', 'back', 'backfill', 'block', 'book', 'bring', 'build', 'bump', 'call',
  'cancel', 'change', 'chase', 'check', 'clarify', 'clean', 'clear', 'close', 'collect', 'compare',
  'complete', 'configure', 'confirm', 'connect', 'consolidate', 'convert', 'copy', 'correct',
  'create', 'cut', 'decide', 'decrease', 'delete', 'deliver', 'deploy', 'disable', 'discuss', 'do',
  'document', 'double', 'draft', 'drop', 'email', 'enable', 'ensure', 'escalate', 'expand',
  'export', 'extend', 'extract', 'file', 'fill', 'finalize', 'find', 'finish', 'fix', 'flag',
  'follow', 'forward', 'gather', 'generate', 'get', 'give', 'group', 'handle', 'hold', 'hook',
  'implement', 'import', 'improve', 'increase', 'install', 'investigate', 'keep', 'kick', 'land',
  'launch', 'let', 'limit', 'link', 'list', 'load', 'lock', 'look', 'lower', 'make', 'map', 'merge',
  'message', 'migrate', 'monitor', 'move', 'notify', 'open', 'order', 'organize', 'patch', 'pause',
  'pick', 'ping', 'plan', 'post', 'prepare', 'prioritize', 'process', 'promote', 'prototype',
  'publish', 'pull', 'purge', 'push', 'raise', 'reach', 'read', 'rebase', 'rebuild', 'recheck',
  'reconcile', 'record', 'reduce', 'refactor', 'refresh', 'regenerate', 'reindex', 'release',
  'remind', 'remove', 'rename', 'reorder', 'repair', 'replace', 'reply', 'report', 'request',
  'require', 'reschedule', 'research', 'reset', 'resolve', 'respond', 'restart', 'restore',
  'retry', 'review', 'revert', 'revisit', 'rewrite', 'roll', 'rotate', 'run', 'scale', 'schedule',
  'scope', 'send', 'set', 'settle', 'share', 'ship', 'sign', 'simplify', 'sort', 'split', 'stage',
  'start', 'stop', 'streamline', 'submit', 'summarize', 'swap', 'switch', 'sync', 'take', 'talk',
  'test', 'tidy', 'track', 'trim', 'triage', 'trigger', 'try', 'tune', 'turn', 'unblock', 'update',
  'upgrade', 'upload', 'use', 'validate', 'verify', 'wire', 'work', 'wrap', 'write',
]);

const CapitalizedNonEntities = new Set([
  'a', 'an', 'and', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'if', 'or',
  'but', 'as', 'is', 'are', 'be', 'do', 'not', 'no', 'this', 'that', 'it', 'i', 'we', 'you', 'they',
]);

/**
 * Temporal words that are **always** grounded-checked, whatever their casing.
 *
 * A fabricated date is one of the most damaging things this pipeline can emit, and casing is not a
 * safety boundary: `"Deploy on monday"` against a source saying `tomorrow` is exactly as wrong as
 * `"Deploy Monday"`. Round 5 fixed only the capitalized half by removing these from the exemption
 * list; round 6 caught that lowercase still slipped through the capitalization rule entirely.
 *
 * This is explicitly NOT the declined open-ended lexicon problem. Weekdays, months and relative
 * times are a **small closed set of known factual claims**, so they can be enumerated honestly —
 * unlike "is this an ordinary English word", which cannot.
 */
const TemporalEntities = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'today', 'tonight', 'tomorrow', 'yesterday', 'eod', 'eow', 'asap', 'midnight', 'noon',
  'weekend', 'weekday', 'morning', 'afternoon', 'evening',
]);

// WEEKDAYS, MONTHS, AND RELATIVE TIMES WERE HERE AND HAD TO COME OUT (Codex, branch relay round 5).
// Exempting them globally meant a FABRICATED DEADLINE rendered as fact: `"Deploy Monday"` against a
// source saying `deploy the patch tomorrow` extracted no term at all and passed. A wrong date on a
// reminder is among the most damaging things this pipeline can produce, and the exemption bought
// nothing — grounding is case-insensitive, so a title saying `Monday` when the author wrote `monday`
// matches anyway. They are entities like any other now.

/**
 * Reduce text to bare lowercase alphanumerics. Used for whole-string equality (e.g. "is this context
 * line just a restatement of the task?"), NOT for grounding lookups — see {@link IsTermGrounded} for
 * why a raw substring test on this form is unsafe.
 * @param {string} ArgText
 * @returns {string}
 */
function NormalizeForGrounding(ArgText) {
  return (ArgText || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Split text into lowercase letter/number word tokens.
 *
 * **Unicode-aware on purpose.** An earlier ASCII-only version (`[^a-z0-9]`) silently *deleted* every
 * non-ASCII letter, which is a homoglyph bypass rather than a cosmetic limitation: a title of
 * `Deploy Аcme` written with a Cyrillic `А` lost that character entirely, so nothing was left to
 * check and an invented product name rendered to the user. Keeping the codepoints means `аcme`
 * (Cyrillic) simply is not the token `acme` (ASCII) and fails grounding, which is the correct answer.
 * Caught by Codex in the branch relay, round 2.
 * @param {string} ArgText
 * @returns {string[]}
 */
function GroundingTokens(ArgText) {
  return (ArgText || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Drop a single trailing `s` from a token long enough for that to be a plural rather than the word.
 * Paired with the apostrophe already being stripped by tokenization, this is what lets a title say
 * `Reports` or `Jamie's` when the source said `report` and `jamie` — a model inflecting a word the
 * author used is not inventing an entity, and rejecting it would send a perfectly good title back to
 * the verbatim path, which is the exact failure this whole module exists to avoid.
 * @param {string} ArgToken
 * @returns {string}
 */
function StripPluralSuffix(ArgToken) {
  return ArgToken.length > 3 && ArgToken.endsWith('s') ? ArgToken.slice(0, -1) : ArgToken;
}

/**
 * Whether one term is grounded in a tokenized source.
 *
 * **This is deliberately NOT a substring test.** The first implementation collapsed both sides to
 * bare alphanumerics and asked whether the source contained the term. That is far too permissive,
 * because collapsing erases word boundaries and lets a fragment of a longer word ground an entity
 * the author never wrote. Found independently by self-audit and by Codex in the branch relay:
 *
 *   `"Deploy to PROD"`  accepted against a source whose only relevant word was **"re-PROD-uce"**
 *   `"Update Ortho"`    accepted against **"orthogonal"**
 *   `"Deploy Acme"`     accepted against **"xacmey"**       (Codex's case)
 *
 * An invented environment or product name reaching a user's reminder is precisely the failure this
 * module exists to prevent, so a check that accepts one is **worse than no check** — it grants false
 * confidence to the entire synthesis path.
 *
 * The rule instead is: a term is grounded when its concatenated form equals the concatenated form of
 * some **run of consecutive whole source tokens**. That still tolerates the formatting differences
 * that motivated collapsing in the first place — `billing-sync` matches `billing sync`, and
 * `warehousesync` matches `warehouse sync` — while refusing to match a fragment of a longer word.
 * @param {string} ArgTerm The term requiring grounding.
 * @param {string[]} ArgSourceTokens Tokenized source, from {@link GroundingTokens}.
 * @returns {boolean}
 */
function IsTermGrounded(ArgTerm, ArgSourceTokens, ArgAllowPlural = true) {
  // Possessives are stripped for EVERY kind of term, independently of plural tolerance. `Jamie's`
  // makes exactly the same claim as `Jamie`, so this is a safe transform — unlike pluralization,
  // which can turn a generic word into a product name (see below).
  const Depossessed = (ArgTerm || '').replace(/['’]s\b/gi, '').replace(/s['’](?=\s|$)/gi, 's');
  const TermTokens = GroundingTokens(Depossessed);
  // a term that tokenizes to nothing (pure punctuation) makes no claim about the world.
  if(TermTokens.length === 0) return true;

  const Target = TermTokens.join('');
  // Plural tolerance is WITHHELD from bare proper nouns, because for a name it is not an inflection
  // at all — it is a different word. `"Update Teams tomorrow"` against a source saying
  // `update the team tomorrow` was accepted purely because `Teams` singularizes to the generic
  // `team`, so the rendered title named a Microsoft product the author never mentioned. (Codex,
  // branch relay round 4.) Descriptive identifiers like `billing-syncs` keep the tolerance: those
  // are compounds, not names, and they genuinely inflect.
  const TargetSingular = ArgAllowPlural ? StripPluralSuffix(Target) : Target;

  for(let StartIndex = 0; StartIndex < ArgSourceTokens.length; StartIndex++) {
    let Run = '';
    for(let EndIndex = StartIndex; EndIndex < ArgSourceTokens.length; EndIndex++) {
      Run += ArgSourceTokens[EndIndex];
      // A run only ever grows, so once it cannot possibly match, stop extending it. The `+ 1` slack
      // is load bearing: the source may carry the PLURAL of a term the title wrote singular
      // ("Deploy Api" against a source saying "the apis are down"), and that run is one character
      // longer than the target. Breaking at exact length made the tolerance one-directional, which
      // is a false-positive generator — and every false positive here sends a good title back to the
      // verbatim dump this issue exists to remove.
      if(Run.length > Target.length + 1) break;
      if(Run === Target) return true;
      if(ArgAllowPlural && StripPluralSuffix(Run) === TargetSingular) return true;
    }
  }
  return false;
}

/**
 * Extract the substrings of a title that must be found in the source.
 * @param {string} ArgTitle Candidate display title.
 * @returns {string[]} de-duplicated terms requiring grounding; empty when the title claims nothing.
 */
function ExtractGroundedTerms(ArgTitle) {
  const Title = (ArgTitle || '').trim();
  if(!Title) return [];

  const Terms = /** @type {string[]} */ ([]);
  /** @param {string} ArgTerm */
  const Add = (ArgTerm) => {
    const Trimmed = (ArgTerm || '').trim();
    if(Trimmed && !Terms.includes(Trimmed)) Terms.push(Trimmed);
  };

  // 1. quoted strings, straight and curly.
  //
  // A single quote only opens a quotation at a WORD BOUNDARY. Without that guard, two ordinary
  // apostrophes manufacture a bogus quotation out of the text between them: `Fix Jamie's script;
  // it's broken` reported the invented term `s script; it` and needlessly fell back to quoting the
  // whole message. (Codex, branch relay round 4.) Double quotes need no such guard.
  const QuotedSpanPattern = /["“]([^"”]+)["”]|(?<![\p{L}\p{N}])['‘]([^'’]+)['’](?![\p{L}\p{N}])/gu;
  for(const Match of Title.matchAll(QuotedSpanPattern)) Add(Match[1] || Match[2]);

  // strip quoted spans before everything else so their interior words and figures are not re-tested
  // individually — the quotation as a whole is the claim.
  const Unquoted = Title.replace(QuotedSpanPattern, ' ');

  // 2. standalone numbers. The lookarounds matter: without them `PayloadV2` also reports a bare `2`
  // and `4x` also reports `4`, which is redundant (the enclosing token is already required) and
  // turns one invented identifier into two confusing entries in the warning log.
  for(const Match of Unquoted.matchAll(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g)) Add(Match[0]);

  const Words = Unquoted.split(/\s+/).filter(Boolean);

  Words.forEach((ArgWord, ArgIndex) => {
    // trailing/leading punctuation is not part of the token. Unicode letters and marks are kept, so
    // a homoglyph cannot be stripped away into invisibility (see GroundingTokens).
    const Word = ArgWord.replace(/^[^\p{L}\p{N}_"'’-]+|[^\p{L}\p{N}_"'’-]+$/gu, '');
    if(!Word) return;

    // 3. identifier-shaped: internal separator, internal capital, or a letter/digit mix.
    const HasInternalSeparator = /[\p{L}\p{N}_][-_./][\p{L}\p{N}_]/u.test(Word);
    const HasInternalCapital = /^\p{L}+\p{Lu}/u.test(Word);
    const HasLetterDigitMix = /\p{L}/u.test(Word) && /\p{N}/u.test(Word);
    if(HasInternalSeparator || HasInternalCapital || HasLetterDigitMix) { Add(Word); return; }

    // 3b. temporal words, at ANY casing and in ANY position — including the first, since a title may
    // legitimately open with one. A fabricated deadline is a factual claim regardless of how the
    // model capitalized it.
    if(TemporalEntities.has(Word.toLowerCase().replace(/['’]s$/i, ''))) { Add(Word); return; }

    // 4. proper nouns — capitalized, not the leading imperative verb, not a routine capital.
    // `\p{Lu}` rather than `[A-Z]`: an ASCII-only test does not recognize a Cyrillic or Greek capital
    // as a capital at all, so a lookalike proper noun was never extracted and never checked.
    //
    // The first word is exempt ONLY when it is a recognized imperative verb. Exempting it
    // unconditionally let an invented name through by position alone (`"Acme deployment"`).
    if(ArgIndex === 0 && ImperativeVerbs.has(Word.toLowerCase())) return;
    if(!/^\p{Lu}/u.test(Word)) return;
    if(CapitalizedNonEntities.has(Word.toLowerCase())) return;
    Add(Word);
  });

  return Terms;
}

/**
 * The terms a title names that its source never does.
 * @param {string} ArgTitle Candidate display title.
 * @param {string} ArgSourceText Original message text (and any other legitimate grounding source).
 * @returns {string[]} ungrounded terms; empty means the title is fully grounded.
 */
function UngroundedTerms(ArgTitle, ArgSourceText) {
  const SourceTokens = GroundingTokens(ArgSourceText);
  if(SourceTokens.length === 0) return ExtractGroundedTerms(ArgTitle);

  return ExtractGroundedTerms(ArgTitle)
    .filter(ArgTerm => !IsTermGrounded(ArgTerm, SourceTokens, !IsBareProperNoun(ArgTerm)));
}

/**
 * A single capitalized word with no internal separator or digit — i.e. a NAME rather than a
 * descriptive compound. These do not get plural tolerance; see {@link IsTermGrounded}.
 * @param {string} ArgTerm
 * @returns {boolean}
 */
function IsBareProperNoun(ArgTerm) {
  const Term = (ArgTerm || '').trim().replace(/['’]s$/i, '');
  if(!Term || /\s/.test(Term)) return false;
  if(/[-_./]/.test(Term) || /\p{N}/u.test(Term)) return false;
  return /^\p{Lu}/u.test(Term);
}

/**
 * Whether a synthesized title only names things its source names.
 * @param {string} ArgTitle Candidate display title.
 * @param {string} ArgSourceText Original message text.
 * @returns {boolean}
 */
function IsTitleGrounded(ArgTitle, ArgSourceText) {
  return UngroundedTerms(ArgTitle, ArgSourceText).length === 0;
}

module.exports = {
  IsTitleGrounded,
  UngroundedTerms,
  ExtractGroundedTerms,
  NormalizeForGrounding,
  GroundingTokens,
  IsTermGrounded,
  CapitalizedNonEntities,
};
