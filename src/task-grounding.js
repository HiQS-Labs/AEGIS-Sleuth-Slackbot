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
 * displayed title may be rewritten, but only *within* the vocabulary of the source: every entity,
 * identifier, and number it names must already appear in the message. So the model may re-word
 * ("i'll roll it out" → "Roll out the export bucket config fix") but cannot introduce a system,
 * product, person, or figure the author never mentioned.
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
const CapitalizedNonEntities = new Set([
  'a', 'an', 'and', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'if', 'or',
  'but', 'as', 'is', 'are', 'be', 'do', 'not', 'no', 'this', 'that', 'it', 'i', 'we', 'you', 'they',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'tonight', 'tomorrow', 'yesterday', 'eod', 'am', 'pm',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december',
]);

/**
 * Reduce text to bare lowercase alphanumerics. Used for whole-string equality (e.g. "is this context
 * line just a restatement of the task?"), NOT for grounding lookups — see {@link IsTermGrounded} for
 * why a raw substring test on this form is unsafe.
 * @param {string} ArgText
 * @returns {string}
 */
function NormalizeForGrounding(ArgText) {
  return (ArgText || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Split text into lowercase alphanumeric word tokens.
 * @param {string} ArgText
 * @returns {string[]}
 */
function GroundingTokens(ArgText) {
  return (ArgText || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
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
function IsTermGrounded(ArgTerm, ArgSourceTokens) {
  const TermTokens = GroundingTokens(ArgTerm);
  // a term that tokenizes to nothing (pure punctuation) makes no claim about the world.
  if(TermTokens.length === 0) return true;

  const Target = TermTokens.join('');
  const TargetSingular = StripPluralSuffix(Target);

  for(let StartIndex = 0; StartIndex < ArgSourceTokens.length; StartIndex++) {
    let Run = '';
    for(let EndIndex = StartIndex; EndIndex < ArgSourceTokens.length; EndIndex++) {
      Run += ArgSourceTokens[EndIndex];
      // a run only ever grows, so once it is longer than the term no extension of it can match.
      if(Run.length > Target.length) break;
      if(Run === Target || StripPluralSuffix(Run) === TargetSingular) return true;
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
  for(const Match of Title.matchAll(/["“]([^"”]+)["”]|['‘]([^'’]+)['’]/g)) Add(Match[1] || Match[2]);

  // strip quoted spans before everything else so their interior words and figures are not re-tested
  // individually — the quotation as a whole is the claim.
  const Unquoted = Title.replace(/["“][^"”]+["”]|['‘][^'’]+['’]/g, ' ');

  // 2. standalone numbers. The lookarounds matter: without them `PayloadV2` also reports a bare `2`
  // and `4x` also reports `4`, which is redundant (the enclosing token is already required) and
  // turns one invented identifier into two confusing entries in the warning log.
  for(const Match of Unquoted.matchAll(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g)) Add(Match[0]);

  const Words = Unquoted.split(/\s+/).filter(Boolean);

  Words.forEach((ArgWord, ArgIndex) => {
    // trailing/leading punctuation is not part of the token
    const Word = ArgWord.replace(/^[^\w"'’-]+|[^\w"'’-]+$/g, '');
    if(!Word) return;

    // 3. identifier-shaped: internal separator, internal capital, or a letter/digit mix.
    const HasInternalSeparator = /[\w][-_./][\w]/.test(Word);
    const HasInternalCapital = /^[A-Za-z]+[A-Z]/.test(Word);
    const HasLetterDigitMix = /[A-Za-z]/.test(Word) && /\d/.test(Word);
    if(HasInternalSeparator || HasInternalCapital || HasLetterDigitMix) { Add(Word); return; }

    // 4. proper nouns — capitalized, not the leading imperative verb, not a routine capital.
    if(ArgIndex === 0) return;
    if(!/^[A-Z]/.test(Word)) return;
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

  return ExtractGroundedTerms(ArgTitle).filter(ArgTerm => !IsTermGrounded(ArgTerm, SourceTokens));
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
