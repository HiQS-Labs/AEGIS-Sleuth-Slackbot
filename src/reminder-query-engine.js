'use strict';

// GH-367 Phase 1 — deterministic, transport-neutral reminder query core (NO LLM, NO I/O).
//
// Narrows a candidate set by time / user / client / keyword and enforces channel-privacy scoping,
// BEFORE any model call. The caller (Slack `ask-reminders` or the local skill) assembles candidates
// from the active queue + CompletionStore into the normalized shape below, runs FilterCandidates,
// short-circuits on an empty result, and only then hands the narrowed+cited set to WorkspaceAI to
// rank/phrase. The LLM never decides membership; this module does, deterministically.
//
// Refined by a Codex + agy /consult plan-QA (2026-07-15), adjudicated to AGENTS.md:
// channel-privacy scoping is a v1 MUST (multi-tenant isolation), "topic" is a deterministic keyword
// filter (not a correctness gate), and time windows resolve in the workspace timezone.

/**
 * @typedef {Object} ReminderCandidate
 * @property {string}        id               Reminder id (citation key).
 * @property {string}        text             Reminder/task text to keyword-match against.
 * @property {string|null}   assigneeId       Slack user the task is assigned to.
 * @property {string|null}   senderId         Slack user who asked/created it.
 * @property {string|null}   clientId         Stamped client slug, if resolved.
 * @property {string|null}   channelId        Originating channel id.
 * @property {boolean}       channelIsPrivate True for private-channel / DM origin.
 * @property {number}        timestampMs      The instant this candidate is dated by (completedMs for
 *                                            completed, createdOn for active — the assembler decides).
 * @property {string}        [state]          Reminder state (advisory).
 * @property {boolean}       [isCompleted]    Whether this came from completion history.
 */

/**
 * @typedef {Object} ReminderQuery
 * @property {{ startMs: number, endMs: number }|null} [timeWindow]  Half-open [start, end); null = all time.
 * @property {string[]|null}  [userIds]      Filter to these ASSIGNEE ids; null/empty = any assignee.
 * @property {string[]|null}  [senderIds]    Filter to these SENDER/creator (assignor) ids; null/empty = any sender.
 * @property {string|null}    [clientId]     Filter to this client; null = any client.
 * @property {string[]|null}  [keywords]     Deterministic topic filter; ALL must appear (case-insensitive). null/empty = no topic filter.
 * @property {{ allowedChannelIds?: string[] }} [channelScope]  Private-channel/DM candidates are excluded unless their channel is listed here.
 */
// The user dimension has two roles: assignee (userIds) and assignor/creator (senderIds, from
// OriginalSenderID). Both are AND-combined and independently optional — the parser picks which one a
// question means ("tasks @X has" → assignee; "tasks I created" → sender). Completion history has no
// stored sender, so sender filtering is active-queue-accurate.

/* ------------------------------------------------------------------ timezone helpers */

/**
 * Wall-clock parts for an instant in a timezone.
 * @param {number} ArgMs
 * @param {string} ArgTimeZone
 * @returns {{ year:number, month:number, day:number, hour:number, minute:number, second:number, weekday:number }}
 *          weekday: 0=Sunday..6=Saturday.
 */
function ZonedParts(ArgMs, ArgTimeZone) {
  const Formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ArgTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  /** @type {Record<string,string>} */
  const Map = {};
  for(const Part of Formatter.formatToParts(new Date(ArgMs))) Map[Part.type] = Part.value;
  const WeekdayIndex = /** @type {Record<string, number>} */ ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
  return {
    year: Number(Map.year),
    month: Number(Map.month),
    day: Number(Map.day),
    hour: Number(Map.hour) % 24,
    minute: Number(Map.minute),
    second: Number(Map.second),
    weekday: WeekdayIndex[Map.weekday] ?? 0,
  };
}

/**
 * Timezone offset (ms east of UTC) in effect at an instant.
 * @param {number} ArgMs @param {string} ArgTimeZone @returns {number}
 */
function ZoneOffsetMs(ArgMs, ArgTimeZone) {
  const P = ZonedParts(ArgMs, ArgTimeZone);
  const AsUtc = Date.UTC(P.year, P.month - 1, P.day, P.hour, P.minute, P.second);
  return AsUtc - ArgMs;
}

/**
 * Epoch ms of the start (00:00:00) of the timezone-local day containing ArgMs.
 * @param {number} ArgMs @param {string} ArgTimeZone @returns {number}
 */
function StartOfZonedDayMs(ArgMs, ArgTimeZone) {
  const P = ZonedParts(ArgMs, ArgTimeZone);
  const MidnightWallAsUtc = Date.UTC(P.year, P.month - 1, P.day, 0, 0, 0);
  // Offset near the target midnight (use the day's own offset to survive DST edges).
  const Offset = ZoneOffsetMs(ArgMs, ArgTimeZone);
  return MidnightWallAsUtc - Offset;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a natural-language time phrase into a half-open [startMs, endMs) window in the workspace
 * timezone. Weeks start Monday (matching summarize-week's convention). Returns null for phrases this
 * deterministic resolver does not recognize (the caller then queries all-time or asks to clarify).
 *
 * @param {string} ArgPhrase
 * @param {number} ArgNowMs
 * @param {string} ArgTimeZone
 * @returns {{ startMs: number, endMs: number, label: string }|null}
 */
function ResolveTimeWindow(ArgPhrase, ArgNowMs, ArgTimeZone) {
  const Phrase = (ArgPhrase || '').toLowerCase().trim();
  const StartOfToday = StartOfZonedDayMs(ArgNowMs, ArgTimeZone);

  // Monday-start week containing "now".
  const WeekdayMon0 = (ZonedParts(ArgNowMs, ArgTimeZone).weekday + 6) % 7; // Mon=0..Sun=6
  const StartOfThisWeek = StartOfZonedDayMs(StartOfToday - WeekdayMon0 * DAY_MS, ArgTimeZone);

  if(/\btoday\b/.test(Phrase)) {
    return { startMs: StartOfToday, endMs: StartOfZonedDayMs(StartOfToday + DAY_MS + 3 * 60 * 60 * 1000, ArgTimeZone), label: 'today' };
  }
  if(/\byesterday\b/.test(Phrase)) {
    const StartOfYesterday = StartOfZonedDayMs(StartOfToday - DAY_MS, ArgTimeZone);
    return { startMs: StartOfYesterday, endMs: StartOfToday, label: 'yesterday' };
  }
  if(/\blast week\b/.test(Phrase)) {
    return { startMs: StartOfZonedDayMs(StartOfThisWeek - 7 * DAY_MS, ArgTimeZone), endMs: StartOfThisWeek, label: 'last week' };
  }
  if(/\bthis week\b/.test(Phrase)) {
    return { startMs: StartOfThisWeek, endMs: StartOfZonedDayMs(StartOfThisWeek + 7 * DAY_MS + 3 * 60 * 60 * 1000, ArgTimeZone), label: 'this week' };
  }
  const LastNDays = Phrase.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/);
  if(LastNDays) {
    const N = Number(LastNDays[1]);
    return { startMs: ArgNowMs - N * DAY_MS, endMs: ArgNowMs, label: `last ${N} days` };
  }
  return null;
}

/* ------------------------------------------------------------------ the filter core */

/**
 * True when a candidate is visible under the query's channel-privacy scope. Private-channel / DM
 * candidates are excluded unless their channel is explicitly allowed (e.g. the channel the query was
 * asked in). Multi-tenant isolation is an AGENTS.md contract — this is a v1 MUST, not optional.
 * @param {ReminderCandidate} ArgCandidate
 * @param {{ allowedChannelIds?: string[] }} ArgScope
 * @returns {boolean}
 */
function IsVisibleUnderScope(ArgCandidate, ArgScope) {
  const Allowed = ArgScope && Array.isArray(ArgScope.allowedChannelIds) ? ArgScope.allowedChannelIds : [];
  if(ArgCandidate.channelId && Allowed.includes(ArgCandidate.channelId)) return true;
  return !ArgCandidate.channelIsPrivate;
}

/**
 * Deterministically narrow candidates. Order: privacy scope → time → user → client → keywords.
 * @param {ReminderCandidate[]} ArgCandidates
 * @param {ReminderQuery} ArgQuery
 * @returns {{ matched: ReminderCandidate[], matchedCount: number, total: number }}
 */
function FilterCandidates(ArgCandidates, ArgQuery) {
  const Candidates = Array.isArray(ArgCandidates) ? ArgCandidates : [];
  const Query = ArgQuery || {};
  const Scope = Query.channelScope || { allowedChannelIds: [] };
  const UserIds = Array.isArray(Query.userIds) && Query.userIds.length > 0 ? Query.userIds : null;
  const SenderIds = Array.isArray(Query.senderIds) && Query.senderIds.length > 0 ? Query.senderIds : null;
  const Keywords = Array.isArray(Query.keywords)
    ? Query.keywords.map(ArgK => String(ArgK).toLowerCase()).filter(ArgK => ArgK.length > 0)
    : [];

  const Matched = Candidates.filter(ArgCandidate => {
    if(!ArgCandidate || typeof ArgCandidate.id !== 'string') return false;

    // 1. Privacy scope — always applied.
    if(!IsVisibleUnderScope(ArgCandidate, Scope)) return false;

    // 2. Time window (half-open).
    if(Query.timeWindow) {
      const Ts = ArgCandidate.timestampMs;
      if(typeof Ts !== 'number' || !Number.isFinite(Ts) || Ts < Query.timeWindow.startMs || Ts >= Query.timeWindow.endMs) return false;
    }

    // 3. User — by assignee.
    if(UserIds && !(ArgCandidate.assigneeId && UserIds.includes(ArgCandidate.assigneeId))) return false;

    // 3b. User — by sender/creator (assignor).
    if(SenderIds && !(ArgCandidate.senderId && SenderIds.includes(ArgCandidate.senderId))) return false;

    // 4. Client.
    if(Query.clientId && ArgCandidate.clientId !== Query.clientId) return false;

    // 5. Keywords — ALL must appear (case-insensitive substring) in the text.
    if(Keywords.length > 0) {
      const Text = String(ArgCandidate.text || '').toLowerCase();
      if(!Keywords.every(ArgK => Text.includes(ArgK))) return false;
    }

    return true;
  });

  return { matched: Matched, matchedCount: Matched.length, total: Candidates.length };
}

module.exports = {
  FilterCandidates,
  ResolveTimeWindow,
  IsVisibleUnderScope,
  ZonedParts,
  StartOfZonedDayMs,
  DAY_MS,
};
