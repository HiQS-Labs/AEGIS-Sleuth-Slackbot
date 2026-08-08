'use strict';

const DateUtils = require('./date-utils');
const SlackFormatUtils = require('./slack-format-utils');
const { ResolveClientNameForReminder, ApplyClientPrefix } = require('./client-mapping');

/**
 * Maximum length of the one-line summary shown per reminder in compact digests. Synthesized task
 * titles were short by construction; with AI title synthesis disabled the summary can be the full
 * original Slack message, so long lines are truncated here to keep the digest readable.
 * @type {number}
 */
const MAX_COMPACT_SUMMARY_LENGTH = 140;
const COMPACT_EXCERPT_SENTENCE_LIMIT = 3;
const MIN_COMPACT_EXCERPT_LENGTH = 48;

/**
 * Short courtesy-only edge lines add noise to the daily digest excerpt without helping someone
 * understand the task. Trim them only at the start/end of a multi-line quoted message.
 * @type {RegExp}
 */
const REDUNDANT_EDGE_LINE_PATTERN = /^(?:<@[^>]+>(?:\s*[,:-]\s*)?)?(?:hi|hey|hello|yo|fyi|note|thanks|thank you|thx|best|regards|cheers)(?:\s+(?:team|all|everyone|folks|y['’]?all))?[!.,:;\s-]*$/i;

/**
 * Truncate a one-line summary to MAX_COMPACT_SUMMARY_LENGTH, appending an ellipsis when shortened.
 * Trims trailing whitespace before the ellipsis so we never emit "word …".
 * @param {string} ArgSummary Summary text (already single-line).
 * @returns {string}
 */
function TruncateCompactSummary(ArgSummary) {
  if(ArgSummary.length <= MAX_COMPACT_SUMMARY_LENGTH) return ArgSummary;
  let Cut = ArgSummary.slice(0, MAX_COMPACT_SUMMARY_LENGTH);
  // avoid severing a Slack token like <@U123> or <url|label>: if the cut left an unclosed '<'
  // (a '<' with no following '>'), drop back to just before that opening bracket.
  const LastOpen = Cut.lastIndexOf('<');
  if(LastOpen !== -1 && Cut.indexOf('>', LastOpen) === -1)
    Cut = Cut.slice(0, LastOpen);
  return `${Cut.trimEnd()}…`;
}

/**
 * Collapse internal whitespace to single spaces for one-line digest display.
 * @param {string} ArgText
 * @returns {string}
 */
function NormalizeCompactWhitespace(ArgText) {
  return String(ArgText ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove Slack quote markers from a reminder's stored blockquoted original message.
 * @param {string} ArgText
 * @returns {string[]}
 */
function GetQuotedMessageLines(ArgText) {
  return String(ArgText ?? '')
    .split('\n')
    .map((/** @type {string} */ ArgLine) => ArgLine.replace(/^\s*>+\s?/, '').trim());
}

/**
 * @param {string} ArgLine
 * @returns {boolean}
 */
function IsRedundantEdgeLine(ArgLine) {
  const Trimmed = String(ArgLine ?? '').trim();
  if(!Trimmed) return true;
  if(/^<@[^>]+>(?:\s*,\s*<@[^>]+>)*[!.,:;\s-]*$/i.test(Trimmed)) return true;
  if(REDUNDANT_EDGE_LINE_PATTERN.test(Trimmed)) return true;
  return false;
}

/**
 * Trim obvious greeting / signoff noise only at the outer edges of a quoted multi-line message.
 * @param {string[]} ArgLines
 * @returns {string[]}
 */
function TrimRedundantEdgeLines(ArgLines) {
  const Lines = ArgLines.filter((/** @type {string} */ ArgLine) => ArgLine.trim().length > 0);
  while(Lines.length > 1 && IsRedundantEdgeLine(Lines[0]))
    Lines.shift();
  while(Lines.length > 1 && IsRedundantEdgeLine(Lines[Lines.length - 1]))
    Lines.pop();
  return Lines;
}

/**
 * Split text into sentence-like chunks while preserving terminal punctuation on full sentences.
 * Any remaining trailing fragment is returned as its own chunk.
 * @param {string} ArgText
 * @returns {string[]}
 */
function SplitIntoSentenceLikeChunks(ArgText) {
  return NormalizeCompactWhitespace(ArgText)
    .match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g)?.map(ArgSentence => ArgSentence.trim()).filter(Boolean) ?? [];
}

/**
 * Build the Phase-3 compact excerpt from the quoted original message body when available.
 * Prefers the first three sentences, but keeps extending until the excerpt reaches a minimum
 * useful length so terse greetings do not collapse the digest to junk like "Hi. Thanks. FYI…".
 * @param {string} ArgReminderMessageText
 * @returns {string}
 */
function ExtractQuotedOriginalExcerpt(ArgReminderMessageText) {
  const QuotedOriginal = SlackFormatUtils.ExtractQuotedOriginalMessage(ArgReminderMessageText);
  if(!QuotedOriginal) return '';

  const TrimmedLines = TrimRedundantEdgeLines(GetQuotedMessageLines(QuotedOriginal));
  const NormalizedOriginal = NormalizeCompactWhitespace(TrimmedLines.join(' '));
  if(!NormalizedOriginal) return '';

  const Sentences = SplitIntoSentenceLikeChunks(NormalizedOriginal);
  if(Sentences.length === 0) return '';

  const ExcerptParts = [];
  for(const Sentence of Sentences) {
    ExcerptParts.push(Sentence);
    const CurrentExcerpt = NormalizeCompactWhitespace(ExcerptParts.join(' '));
    if(ExcerptParts.length >= COMPACT_EXCERPT_SENTENCE_LIMIT && CurrentExcerpt.length >= MIN_COMPACT_EXCERPT_LENGTH)
      break;
  }

  const Excerpt = NormalizeCompactWhitespace(ExcerptParts.join(' '));
  const WasTruncated = Excerpt.length < NormalizedOriginal.length;
  if(!WasTruncated) return Excerpt;

  return `${Excerpt.replace(/[.!?…]+$/, '').trimEnd()}…`;
}

/**
 * Converts a numeric counter to alphabetical format.
 * 1-26: A-Z, 27-52: A1-Z1, 53-78: A2-Z2, etc.
 * @param {number} ArgCounter Numeric counter (1-based).
 * @returns {string}
 */
function GetAlphabeticalLabel(ArgCounter) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const cycleNumber = Math.floor((ArgCounter - 1) / 26);
  const letterIndex = (ArgCounter - 1) % 26;
  const letter = letters[letterIndex];

  return cycleNumber === 0 ? letter : `${letter}${cycleNumber}`;
}

/**
 * Ordered due-date sections used by every bucketed reminder display (Slack digests, the
 * rebalance export, and any consumer re-rendering it). Keys match the bucket names returned
 * by BucketRemindersByDueDate; labels are the Slack mrkdwn section headers.
 * @type {Array<{ key: 'dueToday'|'dueUpcoming'|'dueLastWeek'|'dueOlder', label: string }>}
 */
const REMINDER_DUE_SECTIONS = [
  { key: 'dueToday', label: '*📅 Due Today*' },
  { key: 'dueUpcoming', label: '*📆 Due after today*' },
  { key: 'dueLastWeek', label: '*⚠️ Due within last 7 days*' },
  { key: 'dueOlder', label: '*🔴 Due older than 7 days*' },
];

/**
 * Extract the compact one-line summary from a reminder's message text. Phase-3 reminders prefer
 * a trimmed excerpt from the quoted original message (first three sentences with a minimum useful
 * length); legacy reminders with no quote block fall back to the old bullet / first-line rule.
 * @param {string} ArgReminderMessageText Full reminder message text.
 * @returns {string}
 */
function ExtractCompactSummary(ArgReminderMessageText) {
  const lines = String(ArgReminderMessageText ?? '')
    .split('\n')
    .map((/** @type {string} */ ArgLine) => ArgLine.trim())
    .filter(Boolean);

  // Prefer the synthesized "Key task(s):" bullet when present. It is the human-reviewed one-line task
  // (GH-337) and must win over the raw quoted-original excerpt — otherwise a long message that has BOTH
  // a quote block AND a synthesized task shows the quote lead in the digest while the confirmation
  // showed the clean task (prod: "Get the Woocommerce plugins done" rendered as "com. I'll follow the
  // same method…"). A quoted line always starts with ">", so a bare "•" line is only ever the appended
  // Key task, never quote content.
  const BulletLine = lines.find((/** @type {string} */ ArgLine) => ArgLine.startsWith('•'));
  if(BulletLine)
    return TruncateCompactSummary(BulletLine.replace(/^•\s*/, ''));

  // Otherwise fall back to a trimmed excerpt of the quoted original (GH-337 Phase 3)...
  const QuotedExcerpt = ExtractQuotedOriginalExcerpt(ArgReminderMessageText);
  if(QuotedExcerpt)
    return TruncateCompactSummary(QuotedExcerpt);

  // ...then the legacy first-meaningful-line rule (skip mention-led / "follow up" lines).
  const summary = lines.find((/** @type {string} */ ArgLine) =>
    !ArgLine.startsWith('<@') && !/follow\s+up/i.test(ArgLine)
  ) ?? lines[0];
  return TruncateCompactSummary((summary || '').replace(/^•\s*/, ''));
}

/**
 * Assemble the canonical compact reminder line from precomputed parts:
 * `A.) <permalink|summary> (N days old) - <@user> - <!date…>`.
 * Pure — shared by the live show-reminders path and consumers re-rendering reminders from
 * the published rebalance export, so the wording stays identical everywhere.
 * @param {{ Label: string, Summary: string, PermaLink: string|null, AgeDays: number,
 *   TaggedUserMention: string, ShouldPostOnMs: number }} ArgParts Precomputed line parts.
 * @returns {string}
 */
function BuildCompactReminderLine(ArgParts) {
  const ShouldPostOnUnixTime = Math.floor(ArgParts.ShouldPostOnMs / 1000);
  const ShouldPostOnUtcString = new Date(ArgParts.ShouldPostOnMs).toUTCString();
  const SlackDateFormat = `<!date^${ShouldPostOnUnixTime}^{date_short} {time}|${ShouldPostOnUtcString}>`;

  let SummaryLink;
  if(ArgParts.PermaLink) {
    if(/[<>]/.test(ArgParts.Summary))
      SummaryLink = `${ArgParts.Summary} <${ArgParts.PermaLink}|↗︎>`;
    else
      SummaryLink = `<${ArgParts.PermaLink}|${ArgParts.Summary}>`;
  } else {
    SummaryLink = ArgParts.Summary;
  }

  const AgeInfo = ArgParts.AgeDays > 0 ? ` (${ArgParts.AgeDays} days old)` : '';

  return `${ArgParts.Label}.) ${SummaryLink}${AgeInfo} - ${ArgParts.TaggedUserMention} - ${SlackDateFormat}`;
}

/**
 * Convert a Slack-mrkdwn summary into web-safe plain text for non-Slack consumers (the
 * rebalance dashboard): user mentions become `@DisplayName` (or `@U…` when unresolvable),
 * channel tokens become `#name`, labelled links collapse to their label, bare links to the
 * URL, and special `<!…>` tokens to their fallback text.
 * @param {string} ArgSummary Slack-formatted summary text.
 * @param {Record<string, string>} [ArgUserNamesById] Resolved display names keyed by user ID.
 * @returns {string}
 */
function ToWebSafeSummary(ArgSummary, ArgUserNamesById = {}) {
  return String(ArgSummary ?? '')
    .replace(/<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>/g, (_, ArgUserId) => `@${ArgUserNamesById[ArgUserId] || ArgUserId}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<!([^>|]+)(?:\|([^>]*))?>/g, (_, ArgCommand, ArgFallback) => ArgFallback || ArgCommand)
    .trim();
}

/**
 * Build the compact one-line text for displaying a reminder.
 * @param {import('./slack-app')} ArgSlackApp Slack app instance.
 * @param {any} ArgReminder Reminder to format.
 * @param {string} ArgLabel Alphabetical label.
 * @param {Record<string, string>} [ArgAnnotationsByReminderId] Optional per-reminder rationale lines.
 * @returns {Promise<string>}
 */
async function BuildCompactTextForReminder(ArgSlackApp, ArgReminder, ArgLabel, ArgAnnotationsByReminderId) {
  // Prefix the display-only summary with the reminder's inferred client name (GH-395). This is a
  // non-destructive render-time decoration on top of the GH-391 per-reminder poster, so every list
  // surface (ask-reminders, buckets, digests) gets it consistently. No confident match → no prefix.
  const summary = ApplyClientPrefix(
    ExtractCompactSummary(ArgReminder.ReminderMessageText),
    ResolveClientNameForReminder(ArgReminder, ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME)
  );

  const PermaLink = await ArgSlackApp.GetPermaLinkAsync(
    ArgReminder.OriginalChannelID,
    ArgReminder.OriginalMessageID
  );

  const CurrentDate = DateUtils.GetCurrentDateInTimeZone(
    ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE
  );
  const DaysOld = Math.floor(
    (CurrentDate.getTime() - ArgReminder.CreatedOn.getTime()) /
      (24 * 60 * 60 * 1000)
  );

  // AssigneeIDs is normalized by RemindersModule before display. Keep the singular legacy fallback
  // so a caller rendering an old in-memory record still tags its established owner.
  /** @type {(string|null|undefined)[]} */
  const AssigneeIDs = Array.isArray(ArgReminder.AssigneeIDs) && ArgReminder.AssigneeIDs.length > 0
    ? ArgReminder.AssigneeIDs
    : [ArgReminder.AssigneeID || ArgReminder.OriginalSenderID];
  const TaggedUser = AssigneeIDs
    .filter(ArgAssigneeID => typeof ArgAssigneeID === 'string' && ArgAssigneeID.length > 0
      && ArgAssigneeID !== ArgSlackApp.BotUserID)
    .map(ArgAssigneeID => `<@${ArgAssigneeID}>`)
    .join(', ');

  const CompactLine = BuildCompactReminderLine({
    Label: ArgLabel,
    Summary: summary,
    PermaLink,
    AgeDays: DaysOld,
    TaggedUserMention: TaggedUser,
    ShouldPostOnMs: ArgReminder.ShouldPostOn.getTime(),
  });

  const Annotation = ArgAnnotationsByReminderId?.[ArgReminder.ReminderID];
  if(!Annotation) return CompactLine;

  return `${CompactLine}\n   ↳ ${Annotation}`;
}

/**
 * Post a reminder list into a Slack thread.
 * @param {import('./slack-app')} ArgSlackApp Slack app instance.
 * @param {{ channel: string, ts: string }} ArgEventInfo Event payload with channel and thread TS.
 * @param {any[]} ArgReminders Reminders to display.
 * @param {string} ArgEmptyMessage Message shown when no reminders exist.
 * @param {string} ArgSummaryMessage Message shown before the list.
 * @param {{ skipSummaryMessage?: boolean, startCounter?: number, auditTag?: string, preserveInputOrder?: boolean, reminderAnnotationsById?: Record<string, string> }} [ArgOptions] Additional output options.
 * @returns {Promise<number>} Next counter value after the last posted item (useful for threading across sections).
 */
async function PostRemindersListAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgReminders,
  ArgEmptyMessage,
  ArgSummaryMessage,
  ArgOptions
) {
  const ReminderCount = ArgReminders.length;
  const SummaryMessage = ReminderCount === 0 ? ArgEmptyMessage : ArgSummaryMessage;
  const SkipSummaryMessage = ArgOptions?.skipSummaryMessage === true;
  const AuditTag = ArgOptions?.auditTag;
  const PreserveInputOrder = ArgOptions?.preserveInputOrder === true;
  const ReminderAnnotationsById = ArgOptions?.reminderAnnotationsById;

  if(!SkipSummaryMessage)
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, SummaryMessage, undefined, { Tag: AuditTag });

  if(ReminderCount === 0) return ArgOptions?.startCounter ?? 1;

  const SortedReminders = PreserveInputOrder
    ? [...ArgReminders]
    : [...ArgReminders].sort(
      (ArgLeftReminder, ArgRightReminder) => ArgLeftReminder.ShouldPostOn.getTime() - ArgRightReminder.ShouldPostOn.getTime()
    );

  let ReminderCounter = ArgOptions?.startCounter ?? 1;

  for(const ReminderToPost of SortedReminders) {
    const CompactText = await BuildCompactTextForReminder(
      ArgSlackApp,
      ReminderToPost,
      GetAlphabeticalLabel(ReminderCounter),
      ReminderAnnotationsById
    );

    const MessageMetadata = /** @type {import('./slack-app').MessageMetadata} */({
      event_type: 'sleuth-ai-reminder-ids',
      event_payload: { ReminderIDs: JSON.stringify([ReminderToPost.ReminderID]) }
    });

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      CompactText,
      MessageMetadata,
      { Tag: AuditTag }
    );

    ReminderCounter++;
  }

  return ReminderCounter;
}

/**
 * Bucket reminders into due-date categories relative to today in the workspace timezone.
 * @param {any[]} ArgReminders Reminders to bucket.
 * @param {string} ArgTimezone Workspace timezone string.
 * @returns {{ dueToday: any[], dueUpcoming: any[], dueLastWeek: any[], dueOlder: any[] }}
 */
function BucketRemindersByDueDate(ArgReminders, ArgTimezone) {
  const Today = DateUtils.GetCurrentDateInTimeZone(ArgTimezone);
  const StartOfToday = new Date(Today);
  StartOfToday.setUTCHours(0, 0, 0, 0);
  const StartOfTomorrow = new Date(StartOfToday);
  StartOfTomorrow.setUTCDate(StartOfTomorrow.getUTCDate() + 1);
  const StartOf7DaysAgo = new Date(StartOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

  const dueToday = [];
  const dueUpcoming = [];
  const dueLastWeek = [];
  const dueOlder = [];

  const StartOfTodayMs = StartOfToday.getTime();
  const StartOfTomorrowMs = StartOfTomorrow.getTime();
  const StartOf7DaysAgoMs = StartOf7DaysAgo.getTime();

  for(const Reminder of ArgReminders) {
    const DueTime = Reminder.ShouldPostOn.getTime();
    if(DueTime >= StartOfTomorrowMs)
      dueUpcoming.push(Reminder);
    else if(DueTime >= StartOfTodayMs)
      dueToday.push(Reminder);
    else if(DueTime >= StartOf7DaysAgoMs)
      dueLastWeek.push(Reminder);
    else
      dueOlder.push(Reminder);
  }

  return { dueToday, dueUpcoming, dueLastWeek, dueOlder };
}

/**
 * Post reminders bucketed by due date into a Slack thread.
 * Sections with no reminders are skipped. When all buckets are empty, posts the empty message.
 * When non-empty, optionally posts ArgSummaryMessage first, then each section label + items.
 * @param {import('./slack-app')} ArgSlackApp Slack app instance.
 * @param {{ channel: string, ts: string }} ArgEventInfo Event payload with channel and thread TS.
 * @param {any[]} ArgReminders Reminders to display.
 * @param {string} ArgEmptyMessage Message shown when no reminders exist.
 * @param {string} ArgSummaryMessage Message shown before sections when reminders exist (pass '' to skip).
 * @param {string} ArgTimezone Workspace timezone string.
 * @param {{ auditTag?: string, preserveInputOrder?: boolean, reminderAnnotationsById?: Record<string, string> }} [ArgOptions] Optional caller tag for shared write auditing.
 * @returns {Promise<boolean>}
 */
async function PostBucketedReminderSectionsAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgReminders,
  ArgEmptyMessage,
  ArgSummaryMessage,
  ArgTimezone,
  ArgOptions
) {
  const AuditTag = ArgOptions?.auditTag;
  const PreserveInputOrder = ArgOptions?.preserveInputOrder === true;
  const ReminderAnnotationsById = ArgOptions?.reminderAnnotationsById;
  const Buckets = BucketRemindersByDueDate(ArgReminders, ArgTimezone);

  const Sections = REMINDER_DUE_SECTIONS.map(Section => ({
    label: Section.label,
    reminders: Buckets[Section.key],
  }));

  const HasAnySection = Sections.some(Section => Section.reminders.length > 0);
  if(!HasAnySection) {
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ArgEmptyMessage, undefined, { Tag: AuditTag });
    return true;
  }

  if(ArgSummaryMessage)
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ArgSummaryMessage, undefined, { Tag: AuditTag });

  let GlobalCounter = 1;

  for(const Section of Sections) {
    if(Section.reminders.length === 0) continue;
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Section.label, undefined, { Tag: AuditTag });
    GlobalCounter = await PostRemindersListAsync(
      ArgSlackApp,
      ArgEventInfo,
      Section.reminders,
      '',
      '',
      {
        skipSummaryMessage: true,
        startCounter: GlobalCounter,
        auditTag: AuditTag,
        preserveInputOrder: PreserveInputOrder,
        reminderAnnotationsById: ReminderAnnotationsById,
      }
    );
  }

  return true;
}

module.exports = {
  GetAlphabeticalLabel,
  TruncateCompactSummary,
  MAX_COMPACT_SUMMARY_LENGTH,
  REMINDER_DUE_SECTIONS,
  ExtractCompactSummary,
  BuildCompactReminderLine,
  ToWebSafeSummary,
  BuildCompactTextForReminder,
  PostRemindersListAsync,
  BucketRemindersByDueDate,
  PostBucketedReminderSectionsAsync,
};
