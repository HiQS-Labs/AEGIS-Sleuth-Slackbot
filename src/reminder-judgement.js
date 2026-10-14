'use strict';

/*
 * Reminder intent judgement — the one owner (GH-149).
 *
 * "Is this text a commitment the speaker owns, with a time the speaker named — or a reply saying that
 * work is done?" used to be decided in five places: a regex pre-gate, a quote-strip wired into three
 * call sites, the prompt's exclusion list, a post-model regex override and a date-stage regex. Each
 * false-positive fix shipped as one more regex in whichever layer was nearest. This module owns the
 * deterministic gates, in an explicit order, plus the model call; callers route through it.
 *
 * Adding an exclusion: add an entry to EXCLUSIONS AND a row to
 * data/static/ai/reminder-judgement-corpus.json (with its definition under `Definitions`). The FSM
 * invariant in tests/reminders-fsm-invariants.test.js fails until both exist and agree.
 *
 * What this module deliberately does NOT own: SCHEDULING_TRIGGER_PATTERN (the cheap temporal gate in
 * reminders-app-mention-handler.js), date extraction, and the prompt's semantics. A prompt-only
 * exclusion is outside what the stubbed corpus can verify.
 */

const { DecideAsync } = require('./ai-decision');
const { IgnoreQuotedText } = require('./quoted-text');
const { DetectCompletionReply } = require('./reminder-text-completion');

/** Trigger used when a force-schedule (:alarm_clock:) finds no time of its own (GH-114). */
const FORCE_FALLBACK_TRIGGER = 'tomorrow morning';

// long Slack messages require explicit scheduling; count raw characters before quote/space removal.
const LONG_MESSAGE_PATTERN = /^[\s\S]{501}/;

/**
 * @param {string} ArgText Raw Slack message text.
 * @returns {boolean}
 */
function IsLongReminderMessage(ArgText) {
  return LONG_MESSAGE_PATTERN.test(ArgText || '');
}

/**
 * Explicit opt-out of reminder creation ("don't set a reminder", "don't need to set a reminder").
 * `don't forget to set a reminder` does not match: `don't` is followed by `forget`. From d07d643.
 */
const CREATION_OPT_OUT_PATTERN =
  /\b(?:don'?t|do not)(?:\s+(?:need|want)\s+to)?\s+(?:make|create|set|add|schedule)\s+(?:a\s+)?reminder(?:s)?\b/;

/**
 * Past participles the completion detector accepts as "the work is done" (the single-word half of
 * COMPLETION_CORE in reminder-text-completion.js). "get it shipped" asks for the work; "shipped"
 * alone reports it. Keep in step with COMPLETION_CORE. GH-239.
 */
const WORK_RESULT =
  '(?:done|completed?|finished|fixed|shipped|resolved|closed|delivered|submitted|deployed|merged|handled|wrapped\\s+up|sorted|sent)';

/**
 * A request anywhere in a completion reply. "@Sleuth merged, now create a reminder to deploy it
 * Monday" carries a done-word but asks for something else; completing would close the reminder AND
 * drop the request. Not "please": "please mark it done" is a completion. From 6584d6f.
 * GH-239: asking for the work itself ("please get this done", "need it merged", "make sure") is a
 * request too; completing it deleted the reminder the sender was asking about. A past-tense report
 * ("I did get it shipped", "managed to get it merged") is still a completion. "have ... done" is a
 * request only as an imperative (IMPERATIVE_HAVE_PATTERN): "I have it done" is a completion.
 */
const REQUEST_PATTERN = new RegExp(
  '\\b(?:remind|reminders?|create|schedule|reschedule|snooze|cancel|delete|remove|give\\s+me|show|list|' +
  'sort(?:ed)?\\s+by|set\\s+up|can\\s+you|could\\s+you|make\\s+sure|' +
  '(?<!\\b(?:did|managed\\s+to|finally)\\s+)(?:get|need|want)\\s+(?:this|it|that|them)\\s+' + WORK_RESULT + ')\\b', 'i');

/**
 * An imperative "have it done" at the start of the reply, optionally after please/pls/kindly
 * ("please have it done", "have this done please"). A subject in front ("I have it done") is a
 * completion, so this is anchored rather than folded into REQUEST_PATTERN. GH-239.
 */
const IMPERATIVE_HAVE_PATTERN =
  new RegExp('^(?:(?:please|pls|kindly)\\s+)?have\\s+(?:this|it|that|them)\\s+' + WORK_RESULT + '\\b', 'i');

/**
 * A bare period ("this week", "by end of the week", "EOW", "this sprint") with no day, date or time.
 * Whole-phrase on purpose: "this week at 9 AM" named a time and keeps the past-time warning. GH-205.
 */
const PERIOD_ONLY_PATTERN =
  /^\s*(?:(?:by|for|during|sometime|before|until)\s+)?(?:(?:the\s+)?end\s+of\s+(?:(?:this|the)\s+)?|(?:this|the)\s+)(?:week|month|sprint|quarter)(?:['’]s)?[.!]?\s*$|^\s*(?:by\s+)?eo[wm][.!]?\s*$/i;

const DIRECT_ASK_PATTERN = /\b(can you|could you|please|pls|kindly)\b/i;
const DIRECT_ASK_TRIGGER_PATTERN = /\b(this morning|today|tonight|tomorrow|by eod|eod)\b/i;
const DIRECT_ASK_NEGATION_PATTERN =
  /\b(don'?t|do not|not|never|cannot|can't|won'?t|will not|shouldn'?t|stop|cancel|hold off|skip|ignore|no need|nevermind|never mind)\b/i;

/**
 * Deterministic pre-model exclusions, in order. The judgement iterates this table — an exclusion
 * that is not here cannot run. Each entry's `Pattern` is its whole definition; the corpus records
 * `Pattern.toString()` per `Id` and the FSM invariant compares them, so widening a pattern (even by a
 * flag) without touching the corpus fails the build.
 * `Input`: 'quote_removed' tests the own words only when quote-stripping removed something (an empty
 * message with no quotes still reaches the model, as it always has); 'normalized' tests
 * NormalizeIntentText(own words).
 * `LiveOnly`: when the caller passes `LiveText` (an enriched thread reply), test the live reply's own
 * words instead of the joined thread context, so an earlier opt-out cannot veto a later commitment
 * (GH-239). The model still reads the whole context.
 */
const EXCLUSIONS = Object.freeze([
  Object.freeze({ Id: 'long_message', Reason: 'long_message', Modes: Object.freeze(['auto']), Input: 'raw', LiveOnly: true, Pattern: LONG_MESSAGE_PATTERN }),
  Object.freeze({ Id: 'quoted_only', Reason: 'quoted_only', Modes: Object.freeze(['auto']), Input: 'quote_removed', LiveOnly: false, Pattern: /^\s*$/ }),
  Object.freeze({ Id: 'opt_out', Reason: 'opt_out', Modes: Object.freeze(['auto']), Input: 'normalized', LiveOnly: true, Pattern: CREATION_OPT_OUT_PATTERN }),
]);

/** Reason tokens emitted after the exclusions. */
const POST_MODEL_REASONS = Object.freeze(['model_schedule', 'model_ignore', 'direct_ask_fallback', 'completion', 'not_completion']);

/** Every reason token this module can emit. */
const REASONS = Object.freeze([...EXCLUSIONS.map(ArgEntry => ArgEntry.Reason), ...POST_MODEL_REASONS]);

/**
 * Lower-case, normalize curly quotes/apostrophes and whitespace — the shape chat-module's intent
 * checks have always used.
 * @param {string} ArgText
 * @returns {string}
 */
function NormalizeIntentText(ArgText) {
  return (typeof ArgText === 'string' ? ArgText : '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The sender's own words: quoted spans removed unless REMINDER_IGNORE_QUOTED_TEXT is off.
 * @param {string} ArgText
 * @returns {string}
 */
function OwnWords(ArgText) {
  return IgnoreQuotedText(ArgText || '');
}

/**
 * @param {string} ArgText Any text; normalized here.
 * @returns {boolean}
 */
function IsCreationOptOut(ArgText) {
  return CREATION_OPT_OUT_PATTERN.test(NormalizeIntentText(ArgText));
}

/**
 * @param {string} ArgText Normalized reply text (see reminder-text-completion NormalizeReplyText).
 * @returns {boolean}
 */
function HasRequestLanguage(ArgText) {
  return REQUEST_PATTERN.test(ArgText || '') || IMPERATIVE_HAVE_PATTERN.test(ArgText || '');
}

/**
 * @param {string} ArgSchedulingTrigger
 * @returns {boolean}
 */
function IsPeriodOnlyTrigger(ArgSchedulingTrigger) {
  return PERIOD_ONLY_PATTERN.test(ArgSchedulingTrigger || '');
}

/**
 * Detect a direct ask paired with an explicit time trigger (no model call). Rejects negation, so
 * "please don't deploy today" returns null. Used by the post-model fallback and by the
 * disabled-channel :mag: discovery hint, so both agree.
 * @param {string} ArgMessageText
 * @returns {{ trigger: string, actionableLanguage: string }|null}
 */
function DetectDirectAskWithTimeTrigger(ArgMessageText) {
  const MessageText = OwnWords(ArgMessageText).trim();
  if(!MessageText) return null;

  const TriggerMatch = MessageText.match(DIRECT_ASK_TRIGGER_PATTERN);
  if(!DIRECT_ASK_PATTERN.test(MessageText) || !TriggerMatch) return null;
  if(DIRECT_ASK_NEGATION_PATTERN.test(MessageText)) return null;

  return {
    trigger: TriggerMatch[1].toLowerCase(),
    actionableLanguage: MessageText.replace(/\?+$/, '').trim(),
  };
}

/**
 * @param {string} ArgRationale
 * @returns {any}
 */
function IgnoreAnalysis(ArgRationale) {
  return { recommendation: 'ignore', rationale: ArgRationale, reminders: [] };
}

const EXCLUSION_RATIONALES = Object.freeze({
  long_message: 'Long messages are ignored automatically; use an explicit reminder command or alarm-clock reaction.',
  quoted_only: 'Message is only quoted text.',
  opt_out: 'Message explicitly opts out of reminder creation.',
});

/**
 * @typedef {Object} ReminderJudgement
 * @property {'schedule'|'ignore'|'complete'} Verdict
 * @property {string[]} Reasons Reason tokens (see REASONS), most specific last.
 * @property {string} OwnWords Text the judgement actually read.
 * @property {{Phrase: string, PeriodOnly: boolean}[]} Triggers Candidate triggers, classified.
 * @property {any} Analysis Model-shaped result in scheduling modes (never null there); null in completion modes.
 * @property {{IsCompletion: boolean, Reason: string}|null} Completion Detector result in completion modes.
 * @property {string|null} Exclusion Id of the EXCLUSIONS entry that decided, if any.
 */

/**
 * Judge one message.
 * @param {string} ArgText Message text.
 * @param {{Mode?: 'auto'|'force'|'mention'|'strict', WorkspaceAI?: any, DecisionSpec?: any, Capture?: any, Logger?: any, LiveText?: string, ExplicitSchedule?: boolean}} [ArgOptions]
 *   auto: scheduling, quoted text and opt-outs excluded before the model. force: scheduling for an
 *   explicit :alarm_clock: — the whole message goes to the model, no pre-model exclusions.
 *   mention / strict: completion detection on the raw reply, no model call.
 *   LiveText: the live reply when ArgText is enriched thread context; `LiveOnly` exclusions read it.
 * @returns {Promise<ReminderJudgement>}
 */
async function JudgeReminderTextAsync(ArgText, ArgOptions = {}) {
  const Mode = ArgOptions.Mode || 'auto';
  const Text = typeof ArgText === 'string' ? ArgText : '';

  // completion modes read the RAW reply: quote-stripping would turn `done "not done"` into a
  // completion, and completing deletes the reminder.
  if(Mode === 'mention' || Mode === 'strict') {
    const Completion = DetectCompletionReply(Text, Mode, { RequestGuard: HasRequestLanguage });
    return {
      Verdict: Completion.IsCompletion ? 'complete' : 'ignore',
      Reasons: [Completion.IsCompletion ? 'completion' : 'not_completion', Completion.Reason],
      OwnWords: Text,
      Triggers: [],
      Analysis: null,
      Completion,
      Exclusion: null,
    };
  }

  const Own = Mode === 'force' ? Text : OwnWords(Text);
  for(const Entry of EXCLUSIONS) {
    if(!Entry.Modes.includes(Mode)) continue;
    if(Entry.Id === 'long_message' && ArgOptions.ExplicitSchedule === true) continue;
    if(Entry.Input === 'quote_removed' && Own === Text) continue;
    const EntryOwn = Entry.LiveOnly && typeof ArgOptions.LiveText === 'string' ? OwnWords(ArgOptions.LiveText) : Own;
    const Input = Entry.Input === 'raw'
      ? (Entry.LiveOnly && typeof ArgOptions.LiveText === 'string' ? ArgOptions.LiveText : Text)
      : Entry.Input === 'normalized' ? NormalizeIntentText(EntryOwn) : EntryOwn;
    if(Entry.Pattern.test(Input)) {
      return {
        Verdict: 'ignore',
        Reasons: [Entry.Reason],
        OwnWords: Own,
        Triggers: [],
        Analysis: IgnoreAnalysis(EXCLUSION_RATIONALES[Entry.Id] || Entry.Id),
        Completion: null,
        Exclusion: Entry.Id,
      };
    }
  }

  let Analysis = await DecideAsync(ArgOptions.WorkspaceAI, ArgOptions.DecisionSpec, Own, {
    Capture: ArgOptions.Capture,
    Logger: ArgOptions.Logger,
  });
  let Reason = Analysis.recommendation === 'schedule' ? 'model_schedule' : 'model_ignore';

  // a long explicit request uses the existing manual synthesis/default-time path, not a raw-text override.
  const LongLiveMessage = IsLongReminderMessage(typeof ArgOptions.LiveText === 'string' ? ArgOptions.LiveText : Text);
  if(Analysis.recommendation === 'ignore' && !LongLiveMessage) {
    const Detection = DetectDirectAskWithTimeTrigger(Own);
    if(Detection) {
      if(ArgOptions.Logger && typeof ArgOptions.Logger.info === 'function')
        ArgOptions.Logger.info('deterministic reminder fallback activated for direct request with time trigger.');
      Analysis = {
        recommendation: 'schedule',
        rationale: 'Deterministic fallback: direct request with explicit time trigger should be scheduled.',
        reminders: [{
          actionable_language: Detection.actionableLanguage,
          scheduling_trigger: Detection.trigger,
          reminder_message: Detection.actionableLanguage,
        }],
      };
      Reason = 'direct_ask_fallback';
    }
  }

  const Triggers = (Analysis.reminders || []).map((/** @type {any} */ ArgReminder) => ({
    Phrase: ArgReminder.scheduling_trigger,
    PeriodOnly: IsPeriodOnlyTrigger(ArgReminder.scheduling_trigger),
  }));

  return {
    Verdict: Analysis.recommendation === 'schedule' ? 'schedule' : 'ignore',
    Reasons: [Reason],
    OwnWords: Own,
    Triggers,
    Analysis,
    Completion: null,
    Exclusion: null,
  };
}

module.exports = {
  JudgeReminderTextAsync,
  IsLongReminderMessage,
  OwnWords,
  NormalizeIntentText,
  IsCreationOptOut,
  HasRequestLanguage,
  IsPeriodOnlyTrigger,
  DetectDirectAskWithTimeTrigger,
  EXCLUSIONS,
  REASONS,
  FORCE_FALLBACK_TRIGGER,
};
