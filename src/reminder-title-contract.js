'use strict';

/**
 * The output contract for a reminder's task title (GH-250).
 *
 * ## Why this exists
 *
 * A reminder's displayed task could come from four places — the user's verbatim wording, the
 * analyzer's title, the verbatim evidence span, or a fallback — and each produced its own shape.
 * Two reminders in the same digest could look like two different products wrote them: one a tidy
 * imperative (`Review #12 WooCommerce connectors`), the next the user's raw sentence with the
 * `@mention` and "please" still attached, the next a two-word pointer (`Ask him`), the next a
 * 147-character clause cut mid-word with `…`.
 *
 * This module is the ONE shape every path must come out in, whichever path produced the text:
 *
 *   - an imperative verb plus a concrete object, on one line,
 *   - no addressee `@mention`, no courtesy words, no raw URL,
 *   - not a question and not a status remark,
 *   - not a bare pointer (`Ask him`, `Do all of the above`, `Follow up on that`),
 *   - at most {@link TITLE_MAX_WORDS} words / {@link TITLE_MAX_CHARS} characters, shortened only at
 *     a clause or word boundary — never mid-word.
 *
 * ## What it deliberately does NOT do
 *
 * It is deterministic text surgery, not understanding. It strips framing it can recognize
 * (`can you please`, `<@U1>`, `I'll`, `let's`) and rejects shapes it can recognize (a trailing `?`,
 * a leading `I don't think`, a title with no content word). It cannot tell that `Complete the
 * alignment` is vague because its antecedent was never resolved — that is the prompt's job, and the
 * prompt assets carry the same contract. A rejected candidate is never rewritten into something new;
 * the selector moves on to the next candidate and finally to the template fallback, so nothing here
 * can introduce a term the source does not contain. The grounding guarantee (GH-43/68) is therefore
 * untouched: every transform below only REMOVES text.
 *
 * Pure by design: no Slack client, no logger, no I/O. `reminder-display-selection.js` is the only
 * production caller; the replay harness and the golden-set test call it through the same selector.
 */

/** Hard cap on a displayed title, in characters. */
const TITLE_MAX_CHARS = 90;
/** Hard cap on a displayed title, in words. */
const TITLE_MAX_WORDS = 14;
/** A one-word title (`Deploy`) names no object; below this the candidate is rejected. */
const TITLE_MIN_WORDS = 2;
/** Target range the prompt asks for. Reported in telemetry, not enforced here. */
const TITLE_TARGET_WORDS = Object.freeze({ min: 4, max: 14 });
/** How many of a record's tasks 2..N a delivered reminder shows before collapsing to `+N more`. */
const MAX_DISPLAYED_SUBTASKS = 3;
/** Prefix of the templated fallback title. */
const FALLBACK_TITLE_PREFIX = 'Follow up: ';
/** Last-resort title when no subject can be derived from the source at all. */
const GENERIC_FALLBACK_TITLE = 'Follow up on the original message';
const ELLIPSIS = '…';

/**
 * Greeting that may precede or follow an addressee mention. Stripped only at the very start.
 */
const LEADING_GREETING_PATTERN = /^(?:hey|hi|hello|yo|hiya|good (?:morning|afternoon|evening))\b[\s,!:.-]*/i;

/**
 * An addressee: a Slack user mention, a broadcast token, or a bare `@name`, followed by optional
 * punctuation. Only stripped at the START of a title (`<@U1> can you deploy`) or as a trailing
 * `cc <@U2>`. A mention in object position (`Ask <@U1> about the invoice`) is the task's object and
 * is kept — see {@link ValidateReminderTitle}.
 */
const LEADING_MENTION_PATTERN = /^(?:<@[^>]+>|<!(?:here|channel|everyone)(?:\|[^>]*)?>|@[\w][\w.-]*)[\s,:;!.\-–—]*/;
const TRAILING_CC_PATTERN = /[\s,;(-]*\b(?:cc|c\/c|fyi)\b[:\s]*(?:<@[^>]+>[\s,)]*)+$/i;

/** Courtesy words that carry no task content, anywhere in the title. */
const COURTESY_WORD_PATTERN = /(?:^|\s|,)\s*\b(?:please|pls|plz|kindly)\b[,]?/gi;
/** Trailing thanks and sign-offs. */
const TRAILING_THANKS_PATTERN = /[\s,;!.-]*\b(?:thanks|thank you|thx|ty|cheers|much appreciated|appreciated)\b[\s!.,]*$/i;
/** Trailing softeners that defer the work without naming it. */
const TRAILING_SOFTENER_PATTERN = /[,\s]*\b(?:if (?:you|u) can|if possible|if you (?:get|have) (?:a|the) (?:chance|moment|sec|minute|time)|when you (?:get|have) (?:a|the) (?:chance|moment|sec|minute|time)|when you can|whenever you can|at your earliest convenience|when (?:you|u) get to it)\b[.!?]*$/i;

/**
 * Request and commitment framing that wraps the actual task. Each pattern is anchored at the start
 * and stripped in order, repeatedly, so `can you please just let's` style stacks unwind. Courtesy
 * words are removed BEFORE these run, so `can you please review` reaches the second pattern as
 * `can you review`.
 */
const REQUEST_FRAMING_PATTERNS = [
  /^(?:do you think (?:you|we|u) (?:can|could|would)|is it possible (?:for (?:you|us) )?to|is there any way (?:you|we) (?:can|could)|any chance (?:you|we) (?:can|could)|how hard (?:is|would) it (?:be )?to|would it be possible (?:for (?:you|us) )?to|it(?:'d| would) be (?:great|good|nice|helpful|awesome) (?:if (?:you|we) (?:could|can)|to)|would you (?:mind|be able to|be willing to)|could you (?:possibly|maybe|perhaps)|are you able to|(?:i|we) (?:was|were) (?:wondering|hoping) if (?:you|we) (?:could|can))\s+/i,
  /^(?:can|could|would|will|shall|should|may|might)\s+(?:you|we|u|ya|y'all|someone|somebody|anyone)(?:\s+(?:all|both|guys|two|folks))?\s+(?:(?:also|just|maybe|possibly|perhaps|then)\s+)?/i,
  /^(?:let'?s|lets)\s+(?:(?:also|just|then|all)\s+)?/i,
  /^(?:i|we)(?:\s+(?:also|just|still|definitely|probably|really|likely|then|now|also|personally))?(?:'ll| will| shall|'m going to| am going to|'re going to| are going to| was going to| were going to|'d like to| would like to|'d like (?:you|us|someone|everyone) to| would like (?:you|us|someone|everyone) to| need (?:you|us|someone|everyone) to| want (?:you|us|someone|everyone) to| need to| needs to| have to| had to| must| should| plan to| plan on| intend to| want to| wanted to|'m planning to| am planning to| are planning to|'m hoping to| am hoping to|'ve got to| have got to| gotta| gonna| can| could)\s+(?:(?:also|just|still|definitely|probably|likely|then|now|try to|try and|go ahead and)\s+)?/i,
  /^(?:you|we|u)\s+(?:(?:all|both|guys)\s+)?(?:need|needs|have|has|should|must|ought|gotta|got)\s+to\s+/i,
  /^(?:you|we)\s+(?:should|must|can|could|will|would)\s+(?:(?:also|just|then)\s+)?/i,
  /^(?:just\s+)?(?:remember|remind me|reminder|reminding you|don'?t forget|do not forget|make sure|be sure|ensure|see to it)\s+(?:to\s+|that\s+(?:you|we|i)\s+)?/i,
  /^(?:need|needs|needed|going|gonna|have|has|had|got|ought)\s+to\s+/i,
  /^(?:todo|to-do|task|action item|action|reminder|note to self)\s*[:\-–—]\s*/i,
  /^to\s+(?=[a-z])/i,
];

/** A question the normalizer could not turn into a request: interrogative or still ends with `?`. */
const INTERROGATIVE_START_PATTERN = /^(?:what|when|where|who|whom|whose|why|how|which)\b/i;
/**
 * First-person and existential openers: the author is describing state, not naming work. A
 * first-person COMMITMENT (`I'll deploy`) never reaches here because the framing patterns strip it;
 * what is left (`I don't think those issues are related`, `This is ready`) is commentary.
 */
const STATUS_REMARK_PATTERN = /^(?:(?:i|i'm|i’m|i've|i’ve|i'd|i’d|we|we're|we’re|we've|we’ve|we'd|we’d|it's|it’s|it is|this is|that is|these are|those are|there is|there are|there's|there’s|fyi|psa|just|confirming|checking|wondering|thinking|hoping|assuming|guessing|looks like|seems like|turns out|good news|bad news|unfortunately)\b|(?:quick |small |short |brief )?(?:update|heads[- ]up|status|news)(?:\s*[:\-–—]|\s+(?:on|about|regarding|re)\s+(?:the|our|my|this|that|your|these|those)\b))/i;

/**
 * A title that opens with a determiner is a noun phrase or a statement (`The staging cert rotation
 * is tomorrow morning`), never an imperative. The fallback template may still carry such a line as
 * its subject; see {@link BuildFallbackTitle}.
 */
const DETERMINER_START_PATTERN = /^(?:the|a|an|our|my|your|their|his|her|its|this|that|these|those|some|any|no|each|every|all|most|many|few|several|both|another|other)\s/i;

/** Verb phrases that point at work without naming it. Removed before the content-word check. */
const POINTER_IDIOM_PATTERN = /\b(?:close the loop|connect the loop|loop back|loop in|circle back|touch base|follow up|follow-up|check in|check-in|get back|reach out|take care of|take a look|have a look|look into|look at|deal with|work on|get to|get on|move forward|move ahead|go ahead|sort out|figure out|wrap up|wrap it up|finish up|finish off|pick up|keep going|continue)\b/gi;

/**
 * Words that never count as the task's object. Articles, prepositions, conjunctions, pronouns and
 * pointers, quantifiers, placeholders, and the small set of temporal words a title legitimately
 * carries from its trigger.
 */
const NON_CONTENT_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'up',
  'out', 'off', 'over', 'under', 'about', 'around', 'through', 'via', 'per', 'as', 'and', 'or',
  'but', 'so', 'then', 'than', 'if', 'not', 'no', 'yes', 'also', 'too', 'again', 'still', 'just',
  'only', 'back', 'there', 'here', 'where', 'when', 'now', 'later', 'soon', 'asap', 'today',
  'tonight', 'tomorrow', 'yesterday', 'morning', 'afternoon', 'evening', 'night', 'week', 'weekend',
  'month', 'eod', 'eow', 'next', 'last', 'this', 'that', 'these', 'those', 'it', 'its', 'them',
  'they', 'their', 'him', 'his', 'her', 'hers', 'he', 'she', 'me', 'my', 'mine', 'us', 'our',
  'ours', 'you', 'your', 'yours', 'i', 'we', 'one', 'ones', 'same', 'above', 'below', 'all',
  'everything', 'something', 'anything', 'nothing', 'thing', 'things', 'stuff', 'rest', 'both',
  'each', 'every', 'some', 'any', 'more', 'other', 'others', 'whole', 'entire', 'everyone',
  'everybody', 'anyone', 'someone', 'team', 'folks', 'guys', 'be', 'is', 'are',
  'was', 'were', 'been', 'being', 'do', 'does', 'did', 'done', 'doing', 'have', 'has', 'had', 'get',
  'got', 'go', 'let', 'make', 'sure', 'can', 'could', 'will', 'would', 'should', 'must', 'may',
  'might', 'please', 'okay', 'ok', 'fine', 'well', 'etc', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs',
  'fri', 'sat', 'sun', 'am', 'pm',
]);

/**
 * Boundaries a long title may be shortened at, strongest first. The regex alternation reports the
 * cut position as the start of the match, so the boundary token itself is dropped.
 */
const CLAUSE_BOUNDARY_PATTERNS = [
  /[,;:](?=\s)|\s[-–—]\s|\s\((?=[^)]*$)/g,
  /\s(?:to|so|because|and|or|then|which|that|after|before|once|while|until|unless|since|but|where|when|if)\s/g,
  /\s(?:for|with|on|in|at|from|via|using|about|of|by|into|per)\s/g,
];

/**
 * @typedef {Object} TitleNormalization
 * @property {string} text The normalized title. Empty when nothing survived.
 * @property {string[]} changes Which transforms fired, in order. Empty when the input already
 * satisfied the contract's shape rules.
 */

/**
 * @typedef {Object} TitleValidation
 * @property {boolean} ok Whether the title satisfies every hard rule.
 * @property {string[]} reasons Why not, one slug per failed rule. Empty when ok.
 */

/**
 * @typedef {Object} TitleBudgetFit
 * @property {string} text The title, shortened at a boundary when it exceeded the budget.
 * @property {boolean} shortened Whether it was shortened.
 */

/**
 * Count whitespace-separated words.
 * @param {string} ArgText
 * @returns {number}
 */
function CountTitleWords(ArgText) {
  return String(ArgText ?? '').split(/\s+/).filter(Boolean).length;
}

/**
 * Collapse whitespace and trim.
 * @param {string} ArgText
 * @returns {string}
 */
function Collapse(ArgText) {
  return String(ArgText ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Capitalize a title whose first word the source wrote in lowercase. Only an all-lowercase first
 * word is touched, so `iOS` and `gh-250` keep their casing.
 * @param {string} ArgText
 * @returns {string}
 */
function CapitalizeFirstWord(ArgText) {
  const [FirstWord = ''] = ArgText.split(' ');
  if(!/^\p{Ll}/u.test(FirstWord) || FirstWord !== FirstWord.toLowerCase()) return ArgText;
  return `${ArgText.charAt(0).toUpperCase()}${ArgText.slice(1)}`;
}

/**
 * Reduce a title to the contract's shape by REMOVING framing: addressee mentions, courtesy words,
 * URLs, and request or commitment wrappers (`can you please`, `I'll`, `let's`). Nothing is added.
 *
 * The `changes` list is the telemetry: `request-framing` on a title means the model (or the
 * verbatim path) handed over a sentence rather than a task, and `url` means a link was embedded in
 * the title instead of left to the source permalink.
 * @param {string} ArgText Candidate title from any source.
 * @returns {TitleNormalization}
 */
function NormalizeReminderTitle(ArgText) {
  /** @type {string[]} */
  const Changes = [];
  let Text = Collapse(ArgText);
  if(!Text) return { text: '', changes: Changes };

  // 1. URLs never belong in a title: the source permalink is attached by the renderer. A labelled
  // Slack link keeps its label; a bare link goes, along with the lead-in that pointed at it.
  const WithoutUrls = Text
    .replace(/<(https?:\/\/[^>|]+)\|([^>]*)>/gi, '$2')
    .replace(/<https?:\/\/[^>]+>/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.[^\s]+\.[^\s]+/gi, '');
  if(WithoutUrls !== Text) {
    Changes.push('url');
    Text = Collapse(WithoutUrls)
      .replace(/[\s,;:\-–—(]*\b(?:here|at|in|on|via|see|link|url|under)\b[\s,;:\-–—(]*$/i, '')
      .replace(/[\s,;:\-–—(]+$/, '');
  }

  // 2. a greeting and the addressee. `<@U1> hey, can you…` and `hey <@U1>, can you…` both unwind.
  let Addressed = false;
  for(let Pass = 0; Pass < 4; Pass++) {
    const Before = Text;
    Text = Text.replace(LEADING_GREETING_PATTERN, '').replace(LEADING_MENTION_PATTERN, '');
    if(Text === Before) break;
    Addressed = true;
  }
  const WithoutCc = Text.replace(TRAILING_CC_PATTERN, '');
  if(WithoutCc !== Text) { Addressed = true; Text = WithoutCc; }
  if(Addressed) Changes.push('mention');
  Text = Collapse(Text);

  // 3. courtesy words and sign-offs carry no task content.
  const WithoutCourtesy = Collapse(
    Text.replace(COURTESY_WORD_PATTERN, ' ').replace(TRAILING_THANKS_PATTERN, '').replace(TRAILING_SOFTENER_PATTERN, ''),
  ).replace(/^[,;:\s]+/, '');
  if(WithoutCourtesy !== Text) { Changes.push('courtesy'); Text = WithoutCourtesy; }

  // 4. request and commitment framing → imperative. A converted request drops its `?`; a question
  // that no pattern recognized keeps it, and the validator rejects it as a question.
  let Framed = false;
  for(let Pass = 0; Pass < 4; Pass++) {
    const Before = Text;
    for(const Pattern of REQUEST_FRAMING_PATTERNS) Text = Text.replace(Pattern, '');
    if(Text === Before) break;
    Framed = true;
  }
  if(Framed) {
    Changes.push('request-framing');
    Text = Text.replace(/[\s?]+$/, '');
  }

  // 5. trailing terminal punctuation, except a `?` that still marks a question.
  const WithoutTrailing = Text.replace(/[\s.!,;:\-–—]+$/, '').trim();
  if(WithoutTrailing !== Text) { Changes.push('trailing-punctuation'); Text = WithoutTrailing; }

  // 6. an imperative starts with a capital. Case is invisible to grounding, so this is safe.
  const Capitalized = CapitalizeFirstWord(Text);
  if(Capitalized !== Text) { Changes.push('capitalized'); Text = Capitalized; }

  return { text: Collapse(Text), changes: Changes };
}

/**
 * Whether a title names any concrete thing at all. `Ask him`, `Do it`, `Follow up on that` and
 * `Do all of the above` name nothing: once the leading verb, pointer idioms, pronouns, function
 * words and trigger words are removed, no token is left. Only the FIRST word is treated as the
 * verb — stripping every verb-shaped token would delete the object of `Review the release`.
 * @param {string} ArgText Normalized title.
 * @returns {boolean}
 */
function HasConcreteObject(ArgText) {
  const Stripped = String(ArgText ?? '').toLowerCase().replace(POINTER_IDIOM_PATTERN, ' ');
  const Tokens = Stripped.split(/[^\p{L}\p{N}#$@'’._-]+/u).map(ArgToken => ArgToken.replace(/^['’.]+|['’.]+$/g, '')).filter(Boolean);
  const Content = Tokens.filter((ArgToken, ArgIndex) => {
    if(ArgIndex === 0 && !/[\p{N}#$@]/u.test(ArgToken)) return false;
    return !NON_CONTENT_WORDS.has(ArgToken.replace(/['’]s$/, ''));
  });
  return Content.length > 0;
}

/**
 * Whether the text runs past a sentence boundary: terminal punctuation followed by more text.
 * `v1.2 release` is one sentence (no whitespace after the dot); `Found it. I'll fix it` is two.
 * @param {string} ArgText
 * @returns {boolean}
 */
function HasSentenceBoundary(ArgText) {
  // the punctuation must close a WORD: `1.) Client C HPOS 2.) QueryGuard` is one line of list
  // markers, not three sentences, and `v1.2 release` is a version.
  return /(?<=\p{L})[.!?]["'”’)\]]?\s+\S/u.test(String(ArgText ?? ''));
}

/**
 * Whether the text is a pasted list: two or more enumerators (`1.)`, `2.`, `•`) on one line. A list
 * is source material, never a title — the analyzer's per-item candidates are.
 * @param {string} ArgText
 * @returns {boolean}
 */
function IsListShaped(ArgText) {
  const Markers = String(ArgText ?? '').match(/(?:^|\s)(?:\d{1,2}[.)]{1,2}|[•▪◦●]|[a-z][.)])(?=\s)/gi) || [];
  return Markers.length >= 2;
}

/**
 * Apply the contract's hard rules to an already-normalized title. Each failed rule contributes one
 * slug so telemetry can count WHICH rule rejects titles in production.
 *
 * Length is NOT a hard rule here: an over-budget title is shortened at a boundary by
 * {@link FitTitleToBudget}, which the selector runs after validation. A title that arrives ALREADY
 * cut (`…`) is rejected, because that ellipsis was put there by something that did cut mid-thought.
 * @param {string} ArgText Normalized title.
 * @param {{ RequireSingleSentence?: boolean, MaxSourceChars?: number }} [ArgOptions]
 * `RequireSingleSentence` rejects multi-sentence text — the verbatim path uses it, because a
 * message that is itself several sentences is not a task line. `MaxSourceChars` rejects anything
 * longer outright (GH-243 long-source safety) instead of letting the budget fit salvage its first
 * clause.
 * @returns {TitleValidation}
 */
function ValidateReminderTitle(ArgText, ArgOptions = {}) {
  const Text = Collapse(ArgText);
  /** @type {string[]} */
  const Reasons = [];
  if(!Text) return { ok: false, reasons: ['empty'] };

  if(typeof ArgOptions.MaxSourceChars === 'number' && Text.length > ArgOptions.MaxSourceChars) Reasons.push('oversized');
  if(/^(?:<@|<!|@[\w])/.test(Text)) Reasons.push('leading-mention');
  if(/\b(?:please|pls|plz|kindly)\b/i.test(Text)) Reasons.push('courtesy');
  if(/https?:\/\/|<https?:|\bwww\.[^\s]+\.[^\s]+/i.test(Text)) Reasons.push('raw-url');
  if(/\?$/.test(Text) || INTERROGATIVE_START_PATTERN.test(Text)) Reasons.push('question');
  if(STATUS_REMARK_PATTERN.test(Text)) Reasons.push('status-remark');
  if(DETERMINER_START_PATTERN.test(Text)) Reasons.push('not-imperative');
  if(/(?:…|\.\.\.)$/.test(Text)) Reasons.push('truncated');
  if(ArgOptions.RequireSingleSentence && HasSentenceBoundary(Text)) Reasons.push('multi-sentence');
  if(ArgOptions.RequireSingleSentence && IsListShaped(Text)) Reasons.push('list');
  if(CountTitleWords(Text) < TITLE_MIN_WORDS) Reasons.push('too-short');
  if(!HasConcreteObject(Text)) Reasons.push('bare-pointer');

  return { ok: Reasons.length === 0, reasons: Reasons };
}

/**
 * Shorten a title that exceeds the word or character budget — at a clause boundary when one sits
 * in the back half of the budget, else at the last word boundary. Never mid-word, never inside an
 * unclosed Slack token or quotation. The dropped boundary token is replaced by a single `…`.
 *
 * This replaces the renderer's old hard cut (`slice(0, 140) + '…'`), which is where
 * `…the pixel tester on my en…` came from.
 * @param {string} ArgText Normalized title.
 * @param {number} [ArgMaxChars]
 * @param {number} [ArgMaxWords]
 * @returns {TitleBudgetFit}
 */
function FitTitleToBudget(ArgText, ArgMaxChars = TITLE_MAX_CHARS, ArgMaxWords = TITLE_MAX_WORDS) {
  const Text = Collapse(ArgText);
  const Words = Text.split(' ');
  let Budget = ArgMaxChars;
  if(Words.length > ArgMaxWords) Budget = Math.min(Budget, Words.slice(0, ArgMaxWords).join(' ').length);
  if(Text.length <= Budget) return { text: Text, shortened: false };

  // one character of the budget is spent on the ellipsis itself.
  const Limit = Budget - ELLIPSIS.length;
  const MinKeep = Math.max(24, Math.floor(Limit * 0.45));

  let CutAt = -1;
  for(const Pattern of CLAUSE_BOUNDARY_PATTERNS) {
    for(const Match of Text.matchAll(Pattern)) {
      if(Match.index === undefined) continue;
      if(Match.index >= MinKeep && Match.index <= Limit && Match.index > CutAt) CutAt = Match.index;
    }
    if(CutAt !== -1) break;
  }
  if(CutAt === -1) CutAt = Text.lastIndexOf(' ', Limit);
  // a single token longer than the whole budget (a pasted identifier) is the one case with no
  // boundary to honor; cut it rather than exceed the budget.
  if(CutAt <= 0) CutAt = Limit;

  let Cut = Text.slice(0, CutAt);
  const LastOpen = Cut.lastIndexOf('<');
  if(LastOpen !== -1 && Cut.indexOf('>', LastOpen) === -1) Cut = Cut.slice(0, LastOpen);
  for(const Quote of ['"', '“']) {
    const Opened = Cut.split(Quote).length - 1;
    const Closer = Quote === '“' ? '”' : '"';
    const Closed = Quote === '"' ? 0 : Cut.split(Closer).length - 1;
    if(Quote === '"' ? Opened % 2 === 1 : Opened > Closed) Cut = Cut.slice(0, Cut.lastIndexOf(Quote));
  }
  Cut = Cut.replace(/[\s,;:\-–—(]+$/, '');
  if(!Cut) Cut = Text.slice(0, Limit).replace(/\s+\S*$/, '');

  return { text: `${Cut}${ELLIPSIS}`, shortened: true };
}

/**
 * The templated last resort: `Follow up: <subject>`, where the subject is the first line of the
 * source that survives normalization and names something. Never the raw text — the subject goes
 * through the same normalizer as a title, so an addressee or a URL cannot ride in on it — and never
 * a bare pointer, because `Follow up: do this` says nothing `Follow up on the original message`
 * does not.
 *
 * The caller passes the source WITHOUT context markers; marker stripping lives with the selector
 * that knows the wire format.
 * @param {string[]} ArgSourceLines Candidate subject lines, most relevant first (the live reply,
 * then any earlier context lines).
 * @returns {{ text: string, subjectFrom: number|null }} `subjectFrom` is the index of the line the
 * subject came from, or null when the generic title was used.
 */
function BuildFallbackTitle(ArgSourceLines) {
  const Lines = Array.isArray(ArgSourceLines) ? ArgSourceLines : [];
  /** @type {Array<{index: number, text: string, reasons: string[]}>} */
  const Subjects = [];
  for(let Index = 0; Index < Lines.length; Index++) {
    const Line = Collapse(Lines[Index]).replace(/^\s*\d+[.)]\s+/, '');
    if(!Line) continue;
    for(const Sentence of Line.split(/(?<=[.!?])\s+(?=\S)/)) {
      // the first clause only: a subject is a label, and `the invoice is overdue, please chase it`
      // would otherwise lose its comma to the courtesy strip and run the two clauses together.
      const [FirstClause = ''] = Sentence.split(/[,;]\s|\s[—–-]\s/);
      const Normalized = NormalizeReminderTitle(FirstClause);
      const Validation = ValidateReminderTitle(Normalized.text);
      // a subject may be commentary (`the invoice is overdue`) — the prefix frames it — but it must
      // name something and must not be a question.
      const Blocking = Validation.reasons.filter(ArgReason =>
        ArgReason !== 'status-remark' && ArgReason !== 'not-imperative');
      if(Blocking.length > 0) continue;
      Subjects.push({ index: Index, text: Normalized.text, reasons: Validation.reasons });
    }
  }
  // a sentence that reads as a task (`raise the shipping fee`) beats commentary that precedes it
  // (`heads up everyone`); among equals, the earliest wins.
  const Best = Subjects.find(ArgSubject => ArgSubject.reasons.length === 0) || Subjects[0];
  if(!Best) return { text: GENERIC_FALLBACK_TITLE, subjectFrom: null };
  const Subject = FitTitleToBudget(Best.text, TITLE_MAX_CHARS - FALLBACK_TITLE_PREFIX.length).text;
  return { text: `${FALLBACK_TITLE_PREFIX}${Subject}`, subjectFrom: Best.index };
}

module.exports = {
  TITLE_MAX_CHARS,
  TITLE_MAX_WORDS,
  TITLE_MIN_WORDS,
  TITLE_TARGET_WORDS,
  MAX_DISPLAYED_SUBTASKS,
  FALLBACK_TITLE_PREFIX,
  GENERIC_FALLBACK_TITLE,
  NormalizeReminderTitle,
  ValidateReminderTitle,
  FitTitleToBudget,
  BuildFallbackTitle,
  HasConcreteObject,
  CountTitleWords,
};
