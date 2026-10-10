'use strict';

/*
 * Text-based reminder completion.
 *
 * Until this module existed the ONLY way to complete a reminder was a :white_check_mark: reaction on
 * the reminder message. A person replying in the reminder's thread — "@Sleuth I did this", "done",
 * "sent it over" — was not understood as completion: the reply fell through the reminders mention
 * handler to the general chat assistant, which answered "Thanks for the update!" and left the
 * reminder open. This module is the shared, deterministic (no LLM call) half of the fix:
 *
 *   1. DetectCompletionReply(text, mode) — does this reply say the work is DONE?
 *   2. ResolveThreadReminderIDsAsync(...)  — which pending reminders does the thread refer to?
 *
 * Two detection modes, because the two entry paths carry different evidence of intent:
 *
 *   - 'mention' — the person mentioned the bot in the thread. Addressing the bot is itself a
 *     strong signal, so a completion phrase anywhere in a short reply is enough ("@Sleuth I sent
 *     the doc over this morning, thanks!").
 *   - 'strict'  — a plain thread reply with NO bot mention. People chat in reminder threads, so
 *     here the WHOLE reply must be a short completion phrase ("done", "all done ✅", "I did this").
 *     "done with the first half, rest tomorrow" does not qualify.
 *
 * Both modes refuse negated ("not done yet"), future ("will do it tomorrow", "done by Friday"),
 * partial ("almost done") and question ("is this done?") forms — completing a reminder is terminal
 * and the reminder is deleted, so a false positive is costlier than a miss. A miss still has the
 * :white_check_mark: reaction as a fallback.
 */

/** Maximum word count for a mention-mode completion reply. Longer replies are conversation. */
const MENTION_MAX_WORDS = 25;

/** Maximum word count for a strict-mode (no mention) completion reply. */
const STRICT_MAX_WORDS = 8;

// Core completion vocabulary. Kept as one source so both modes agree on what "done" means.
const COMPLETION_CORE =
  '(?:' +
    'done|all\\s+done|completed?|finished|fixed|shipped|resolved|closed|delivered|submitted|' +
    'deployed|merged|handled|wrapped\\s+up|sorted|' +
    'did\\s+(?:it|this|that)|' +
    'sent(?:\\s+(?:it|this|that|them))?(?:\\s+over)?|' +
    '(?:taken|took)\\s+care\\s+of(?:\\s+(?:it|this|that))?|' +
    'finished\\s+(?:it|this|that)|completed\\s+(?:it|this|that)|' +
    'mark(?:ed)?\\s+(?:(?:it|this|that)\\s+)?(?:as\\s+)?(?:done|complete|completed)|' +
    'close\\s+(?:it|this|that)(?:\\s+out)?' +
  ')';

// Mention mode: the completion phrase may appear anywhere, on word boundaries.
const COMPLETION_ANYWHERE_PATTERN = new RegExp(`\\b${COMPLETION_CORE}\\b`, 'i');

// Strict mode: the whole reply is [optional lead-in] + completion phrase + [optional object/trailer].
const STRICT_COMPLETION_PATTERN = new RegExp(
  '^' +
  '(?:(?:ok(?:ay)?|yep|yup|yes|yeah|sure|all|just|now|finally|both|' +
    'i|i\'?ve|i\\s+have|we|we\'?ve|we\\s+have|' +
    'this|that|it|this\\s+is|that\\s+is|it\\s+is|it\'?s|its|that\'?s|thats|' +
    'this\\s+(?:has|have)\\s+been|it\\s+(?:has|was)\\s+been|this\\s+was|it\\s+was|' +
    'task|the\\s+task|has\\s+been|been)\\s+)*' +
  COMPLETION_CORE +
  '(?:\\s+(?:it|this|that|the\\s+task|this\\s+one|that\\s+one|now|already|today|yesterday|' +
    'this\\s+morning|earlier|thanks|thank\\s+you|thx|ty|too|as\\s+well))*' +
  '$',
  'i'
);

// Negated or partial completion — never completes.
const NEGATION_PATTERN =
  /\b(?:not|no|never|n't|havent|hasnt|didnt|isnt|wasnt|wont|cant|cannot|yet\s+to|almost|nearly|partially|partly|half|mostly|still|except|undo|reopen)\b|n't\b/i;

// Future / conditional — a commitment or a condition, not a completion.
const FUTURE_OR_CONDITIONAL_PATTERN =
  /\b(?:will|shall|gonna|going\s+to|later|tomorrow|tonight|soon|next|once|when|if|until|before|after|asap|eod|eow)\b|'ll\b|\bby\s+(?:mon|tue|wed|thu|fri|sat|sun|end|the\s+end|noon|\d)/i;

// Question forms (with or without a trailing "?") and bot-command leads. A mention like
// "@Sleuth show done tasks" or "@Sleuth what's done so far" is a request, not a completion, even
// though it contains "done" — it must still reach the command router / chat assistant.
const QUESTION_LEAD_PATTERN =
  /^(?:is|are|was|were|do|does|have\s+you|has|can|could|should|would|did\s+(?:you|he|she|they|we|anyone|someone|somebody)|what|what's|whats|which|who|how|why|where|show|list|summari[sz]e|search|find|look\s+up|google|explain|help|tell|remind|ai)\b/i;

// A request anywhere in the reply ("merged, now create a reminder to deploy it Monday") is checked
// by the RequestGuard that reminder-judgement.js injects (GH-149); that module owns the pattern.

/**
 * Normalise reply text for detection: drop Slack user/channel mentions, links, and emoji
 * shortcodes (keeping the ✅ signal), strip punctuation, collapse whitespace.
 * @param {string} ArgText Raw reply text.
 * @returns {{ Text: string, HasCheckmark: boolean, HasQuestionMark: boolean }}
 */
function NormalizeReplyText(ArgText) {
  const Raw = typeof ArgText === 'string' ? ArgText : '';
  const HasCheckmark = /:(?:white_check_mark|heavy_check_mark|ballot_box_with_check):|[✅✔☑]/.test(Raw);
  const HasQuestionMark = Raw.includes('?');
  const Text = Raw
    .replace(/<[@#!][^>]*>/g, ' ')        // user / channel / special mentions
    .replace(/<https?:[^>]*>/g, ' ')      // Slack-formatted links
    .replace(/:[a-z0-9_+-]+:/gi, ' ')     // emoji shortcodes
    .replace(/[✅✔☑️]/g, ' ')
    .replace(/[‘’]/g, "'")      // smart apostrophes
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')   // punctuation & remaining emoji
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return { Text, HasCheckmark, HasQuestionMark };
}

/**
 * Decide whether a thread reply says the reminder's work is done.
 * @param {string} ArgText Raw reply text (may include the bot mention).
 * @param {'mention'|'strict'} [ArgMode] Detection mode — see the module header.
 * @param {{RequestGuard?: (ArgNormalizedText: string) => boolean}} [ArgOptions] RequestGuard: true when
 *   the normalized reply also asks for something; checked after the question forms and before the
 *   negation / future checks. Owned by reminder-judgement.js (GH-149).
 * @returns {{ IsCompletion: boolean, Reason: string }}
 */
function DetectCompletionReply(ArgText, ArgMode = 'strict', ArgOptions = {}) {
  const RequestGuard = ArgOptions.RequestGuard || (() => false);
  const { Text, HasCheckmark, HasQuestionMark } = NormalizeReplyText(ArgText);

  if(HasQuestionMark) return { IsCompletion: false, Reason: 'question' };

  // A bare ✅ typed as text (no words) is the reaction's meaning, written down.
  if(Text === '') return HasCheckmark
    ? { IsCompletion: true, Reason: 'checkmark_text' }
    : { IsCompletion: false, Reason: 'empty' };

  if(QUESTION_LEAD_PATTERN.test(Text)) return { IsCompletion: false, Reason: 'question' };
  if(RequestGuard(Text)) return { IsCompletion: false, Reason: 'contains_request' };
  if(NEGATION_PATTERN.test(Text)) return { IsCompletion: false, Reason: 'negated_or_partial' };
  if(FUTURE_OR_CONDITIONAL_PATTERN.test(Text)) return { IsCompletion: false, Reason: 'future_or_conditional' };

  const WordCount = Text.split(' ').filter(Boolean).length;

  if(ArgMode === 'mention') {
    if(WordCount > MENTION_MAX_WORDS) return { IsCompletion: false, Reason: 'too_long' };
    if(COMPLETION_ANYWHERE_PATTERN.test(Text)) return { IsCompletion: true, Reason: 'mention_phrase' };
    if(HasCheckmark && WordCount <= STRICT_MAX_WORDS) return { IsCompletion: true, Reason: 'checkmark_text' };
    return { IsCompletion: false, Reason: 'no_completion_phrase' };
  }

  if(WordCount > STRICT_MAX_WORDS) return { IsCompletion: false, Reason: 'too_long' };
  if(STRICT_COMPLETION_PATTERN.test(Text)) return { IsCompletion: true, Reason: 'strict_phrase' };
  return { IsCompletion: false, Reason: 'no_completion_phrase' };
}

/**
 * Resolve the pending reminder IDs a thread reply refers to.
 *
 * Two thread shapes carry reminders:
 *   - A DELIVERED reminder is its own top-level message carrying `sleuth-ai-reminder-ids`
 *     metadata; replies to it have `thread_ts` = that message. (The reported case.)
 *   - A SCHEDULING confirmation is posted as a reply inside the ORIGINAL message's thread, so a
 *     reply there has `thread_ts` = the original message. Those reminders are found by their
 *     stored thread key (`OriginalThreadTs ?? OriginalMessageID`) — no extra Slack call needed.
 *
 * Only reminders the replier owns (ArgIsOwner: an assignee, or the person who asked for it) are
 * returned — typing "done" is far easier to do by accident than a ✅ reaction, and the original
 * conversation thread is usually a busy work thread, so "fixed" from a teammate must never close
 * someone else's reminder. NotOwnedCount reports the pending reminders skipped for that reason.
 *
 * @param {{ GetMessageMetadataAsync: (ArgChannelID: string, ArgTs: string) => Promise<any> }} ArgSlackApp
 * @param {{ channel: string, thread_ts?: string|null, user?: string }} ArgEventInfo Reply event.
 * @param {Array<any>} ArgPendingReminders Current pending reminders queue.
 * @param {(ArgReminder: any, ArgUserID: string) => boolean} ArgIsOwner Whether the user owns the reminder.
 * @returns {Promise<{ ReminderIDs: string[], Source: 'reminder_message'|'original_thread'|'none', NotOwnedCount: number }>}
 *   Source is 'reminder_message' whenever the thread root IS a reminder message, even if none of
 *   its reminders are still pending (already completed) — callers use that to say so instead of
 *   handing the reply to the chat assistant.
 */
async function ResolveThreadReminderIDsAsync(ArgSlackApp, ArgEventInfo, ArgPendingReminders, ArgIsOwner) {
  const ThreadTs = ArgEventInfo.thread_ts;
  if(!ThreadTs) return { ReminderIDs: [], Source: 'none', NotOwnedCount: 0 };

  const Pending = Array.isArray(ArgPendingReminders) ? ArgPendingReminders : [];
  const PendingByID = new Map(Pending.map(ArgReminder => [ArgReminder.ReminderID, ArgReminder]));

  /** @type {any[]} */
  let Candidates = [];
  /** @type {'reminder_message'|'original_thread'|'none'} */
  let Source = 'none';

  const Metadata = await ArgSlackApp.GetMessageMetadataAsync(ArgEventInfo.channel, ThreadTs);
  if(Metadata && Metadata.event_type === 'sleuth-ai-reminder-ids') {
    /** @type {string[]} */
    let IDs = [];
    try {
      const Parsed = JSON.parse(String(Metadata.event_payload?.ReminderIDs ?? '[]'));
      if(Array.isArray(Parsed)) IDs = Parsed.map(String);
    } catch(_error) {
      IDs = [];
    }
    Candidates = IDs.map(ArgID => PendingByID.get(ArgID)).filter(Boolean);
    Source = 'reminder_message';
  }

  if(Candidates.length === 0) {
    const ThreadCandidates = Pending.filter(ArgReminder =>
      ArgReminder.OriginalChannelID === ArgEventInfo.channel &&
      (ArgReminder.OriginalThreadTs || ArgReminder.OriginalMessageID) === ThreadTs
    );
    if(ThreadCandidates.length > 0) {
      Candidates = ThreadCandidates;
      Source = 'original_thread';
    }
  }

  const UserID = ArgEventInfo.user;
  const Mine = UserID ? Candidates.filter(ArgReminder => ArgIsOwner(ArgReminder, UserID)) : [];

  return {
    ReminderIDs: Mine.map(ArgReminder => ArgReminder.ReminderID),
    Source,
    NotOwnedCount: Candidates.length - Mine.length,
  };
}

module.exports = {
  DetectCompletionReply,
  ResolveThreadReminderIDsAsync,
  NormalizeReplyText,
  MENTION_MAX_WORDS,
  STRICT_MAX_WORDS,
};
