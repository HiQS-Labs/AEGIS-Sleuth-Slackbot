'use strict';

// GH-366 Phase 2 — deterministic learned-convention proposal engine (NO LLM).
//
// Pure functions over completion history. They decide *whether* a config-convention proposal is
// warranted for a client and build its citing evidence — they never write config, never call a
// model, and never persist anything. The caller (the digest pass in reminders-module.js) owns
// rate-limiting, decline-suppression, the ≤3/day cap, and applying the edit on confirm.
//
// Design note: the durable completion field is `assigneeID` (who the completed task was assigned
// to), not a separate "completedBy". "Assignee concentration" is the faithful, shippable reading
// of #362's "completer concentration" idea and feeds `DefaultAssigneeID` directly.

/**
 * @typedef {import('./completion-store').CompletionRecord} CompletionRecord
 */

/** Minimum completions for a client before any convention is inferred. */
const DEFAULT_MIN_SAMPLES = 10;
/** How many most-recent completions per client the assignee pattern looks at. */
const DEFAULT_ASSIGNEE_WINDOW = 10;
/** Assignee-concentration fraction required to propose (e.g. 0.8 = 8 of the last 10). */
const DEFAULT_ASSIGNEE_THRESHOLD = 0.8;
/** Day-of-week concentration fraction required to propose a cadence window. */
const DEFAULT_CADENCE_THRESHOLD = 0.6;
/** Timezone used to bucket completion timestamps when none is supplied. */
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Most-recent-first copy of a client's completion records, dropping other clients.
 * @param {CompletionRecord[]} ArgCompletions
 * @param {string} ArgClientId
 * @returns {CompletionRecord[]}
 */
function CompletionsForClient(ArgCompletions, ArgClientId) {
  if(!Array.isArray(ArgCompletions)) return [];
  return ArgCompletions
    .filter(ArgRecord => ArgRecord && ArgRecord.clientId === ArgClientId)
    .slice()
    .sort((ArgA, ArgB) => ArgB.completedMs - ArgA.completedMs);
}

/**
 * Propose a DefaultAssigneeID when one user dominates a client's recent completions and differs
 * from the current default. Returns { propose: false } when the signal is weak or matches today.
 *
 * @param {CompletionRecord[]} ArgCompletions  Completion records (any client; filtered internally).
 * @param {{ clientId: string, currentDefaultAssigneeID?: string|null,
 *           minSamples?: number, window?: number, threshold?: number }} ArgOptions
 * @returns {{ propose: boolean, kind: 'assignee', clientId: string,
 *            assigneeID?: string, count?: number, total?: number, reminderIds?: string[] }}
 */
function ComputeAssigneeConventionProposal(ArgCompletions, ArgOptions) {
  const ClientId = ArgOptions.clientId;
  const MinSamples = ArgOptions.minSamples ?? DEFAULT_MIN_SAMPLES;
  const Window = ArgOptions.window ?? DEFAULT_ASSIGNEE_WINDOW;
  const Threshold = ArgOptions.threshold ?? DEFAULT_ASSIGNEE_THRESHOLD;
  const CurrentDefault = ArgOptions.currentDefaultAssigneeID || '';

  const Recent = CompletionsForClient(ArgCompletions, ClientId).slice(0, Window);
  if(Recent.length < MinSamples) return { propose: false, kind: 'assignee', clientId: ClientId };

  // Tally assignee frequency over the window, ignoring unassigned completions.
  /** @type {Map<string, CompletionRecord[]>} */
  const ByAssignee = new Map();
  for(const Record of Recent) {
    const AssigneeID = Record.assigneeID || '';
    if(!AssigneeID) continue;
    if(!ByAssignee.has(AssigneeID)) ByAssignee.set(AssigneeID, []);
    ByAssignee.get(AssigneeID).push(Record);
  }
  if(ByAssignee.size === 0) return { propose: false, kind: 'assignee', clientId: ClientId };

  // Dominant assignee = most records in the window. Concentration is measured against the full
  // window length (unassigned completions count against concentration — they are real dilution).
  let TopAssigneeID = '';
  let TopRecords = /** @type {CompletionRecord[]} */ ([]);
  for(const [AssigneeID, Records] of ByAssignee) {
    if(Records.length > TopRecords.length) {
      TopAssigneeID = AssigneeID;
      TopRecords = Records;
    }
  }

  const Concentration = TopRecords.length / Recent.length;
  if(Concentration < Threshold) return { propose: false, kind: 'assignee', clientId: ClientId };
  if(TopAssigneeID === CurrentDefault) return { propose: false, kind: 'assignee', clientId: ClientId };

  return {
    propose: true,
    kind: 'assignee',
    clientId: ClientId,
    assigneeID: TopAssigneeID,
    count: TopRecords.length,
    total: Recent.length,
    reminderIds: TopRecords.map(ArgRecord => ArgRecord.reminderId),
  };
}

/**
 * Extract { weekday, hour } for an epoch-ms instant in a given IANA timezone, deterministically
 * and dependency-free via Intl.
 * @param {number} ArgMs
 * @param {string} ArgTimeZone
 * @returns {{ weekday: string, hour: number }}
 */
function ZonedWeekdayHour(ArgMs, ArgTimeZone) {
  const Formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ArgTimeZone,
    weekday: 'long',
    hour: '2-digit',
    hour12: false,
  });
  const Parts = Formatter.formatToParts(new Date(ArgMs));
  const Weekday = Parts.find(ArgPart => ArgPart.type === 'weekday')?.value || '';
  const HourRaw = Parts.find(ArgPart => ArgPart.type === 'hour')?.value || '0';
  // Intl can emit "24" for midnight in hour12:false; normalize to 0-23.
  const Hour = Number.parseInt(HourRaw, 10) % 24;
  return { weekday: Weekday, hour: Hour };
}

/**
 * Propose a DeadlineConvention window when a client's completions cluster on one weekday and the
 * client has no DeadlineConvention set. Only proposes into an empty convention (never overwrites a
 * human-set one — that would nag).
 *
 * @param {CompletionRecord[]} ArgCompletions
 * @param {{ clientId: string, currentDeadlineConvention?: string|null,
 *           minSamples?: number, threshold?: number, timezone?: string }} ArgOptions
 * @returns {{ propose: boolean, kind: 'cadence', clientId: string,
 *            weekday?: string, hourApprox?: number, count?: number, total?: number,
 *            timezone?: string, reminderIds?: string[] }}
 */
function ComputeCadenceConventionProposal(ArgCompletions, ArgOptions) {
  const ClientId = ArgOptions.clientId;
  const MinSamples = ArgOptions.minSamples ?? DEFAULT_MIN_SAMPLES;
  const Threshold = ArgOptions.threshold ?? DEFAULT_CADENCE_THRESHOLD;
  const TimeZone = ArgOptions.timezone || DEFAULT_TIMEZONE;

  // Never overwrite an operator-set convention; only fill an empty one.
  if((ArgOptions.currentDeadlineConvention || '').trim() !== '') {
    return { propose: false, kind: 'cadence', clientId: ClientId };
  }

  const Records = CompletionsForClient(ArgCompletions, ClientId);
  if(Records.length < MinSamples) return { propose: false, kind: 'cadence', clientId: ClientId };

  /** @type {Map<string, { records: CompletionRecord[], hours: number[] }>} */
  const ByWeekday = new Map();
  for(const Record of Records) {
    const { weekday: Weekday, hour: Hour } = ZonedWeekdayHour(Record.completedMs, TimeZone);
    if(!Weekday) continue;
    if(!ByWeekday.has(Weekday)) ByWeekday.set(Weekday, { records: [], hours: [] });
    const Bucket = ByWeekday.get(Weekday);
    Bucket.records.push(Record);
    Bucket.hours.push(Hour);
  }

  let TopWeekday = '';
  let TopBucket = /** @type {{ records: CompletionRecord[], hours: number[] }|null} */ (null);
  for(const [Weekday, Bucket] of ByWeekday) {
    if(!TopBucket || Bucket.records.length > TopBucket.records.length) {
      TopWeekday = Weekday;
      TopBucket = Bucket;
    }
  }
  if(!TopBucket) return { propose: false, kind: 'cadence', clientId: ClientId };

  const Concentration = TopBucket.records.length / Records.length;
  if(Concentration < Threshold) return { propose: false, kind: 'cadence', clientId: ClientId };

  // Representative hour = median of the cluster's hours (robust to a stray outlier).
  const SortedHours = TopBucket.hours.slice().sort((ArgA, ArgB) => ArgA - ArgB);
  const HourApprox = SortedHours[Math.floor(SortedHours.length / 2)];

  return {
    propose: true,
    kind: 'cadence',
    clientId: ClientId,
    weekday: TopWeekday,
    hourApprox: HourApprox,
    count: TopBucket.records.length,
    total: Records.length,
    timezone: TimeZone,
    reminderIds: TopBucket.records.map(ArgRecord => ArgRecord.reminderId),
  };
}

module.exports = {
  ComputeAssigneeConventionProposal,
  ComputeCadenceConventionProposal,
  CompletionsForClient,
  ZonedWeekdayHour,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_ASSIGNEE_WINDOW,
  DEFAULT_ASSIGNEE_THRESHOLD,
  DEFAULT_CADENCE_THRESHOLD,
  DEFAULT_TIMEZONE,
};
