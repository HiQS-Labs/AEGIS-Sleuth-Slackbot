#!/usr/bin/env node
'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { createEventStore, CURRENT_SCHEMA_VERSION, REQUIRED_PAYLOAD_KEYS_V2 } = require('../src/event-store');

const ACTIVE_SUFFIX = '_reminders.json';
const COMPLETED_SUFFIX = '_completed.json';

/**
 * @param {any} ArgValue
 * @returns {string|null}
 */
function GetNonEmptyString(ArgValue) {
  return typeof ArgValue === 'string' && ArgValue.length > 0 ? ArgValue : null;
}

/**
 * @param {any} ArgValue
 * @returns {string[]}
 */
function GetStringArray(ArgValue) {
  return Array.isArray(ArgValue) ? ArgValue.filter(ArgItem => typeof ArgItem === 'string') : [];
}

/**
 * @param {any} ArgValue
 * @returns {string|null}
 */
function NormalizeIsoString(ArgValue) {
  if(ArgValue instanceof Date) {
    if(Number.isNaN(ArgValue.getTime())) return null;
    return ArgValue.toISOString();
  }

  if(typeof ArgValue === 'number' && Number.isFinite(ArgValue)) {
    const DateValue = new Date(ArgValue);
    if(Number.isNaN(DateValue.getTime())) return null;
    return DateValue.toISOString();
  }

  if(typeof ArgValue === 'string' && ArgValue.length > 0) {
    const DateValue = new Date(ArgValue);
    if(Number.isNaN(DateValue.getTime())) return null;
    return DateValue.toISOString();
  }

  return null;
}

/**
 * @param {string} ArgFilePath
 * @returns {Promise<any[]>}
 */
async function ReadJsonArrayAsync(ArgFilePath) {
  try {
    const Raw = await fs.readFile(ArgFilePath, 'utf8');
    const Parsed = JSON.parse(Raw);
    return Array.isArray(Parsed) ? Parsed : [];
  } catch(error) {
    if(error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * @param {string} ArgRemindersDir
 * @returns {Promise<string[]>}
 */
async function EnumerateWorkspaceNamesAsync(ArgRemindersDir) {
  let Entries = [];
  try {
    Entries = await fs.readdir(ArgRemindersDir, { withFileTypes: true });
  } catch(error) {
    if(error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  /** @type {Set<string>} */
  const WorkspaceNames = new Set();
  for(const Entry of Entries) {
    if(!Entry.isFile()) continue;
    if(Entry.name.endsWith(ACTIVE_SUFFIX)) {
      WorkspaceNames.add(Entry.name.slice(0, -ACTIVE_SUFFIX.length));
      continue;
    }
    if(Entry.name.endsWith(COMPLETED_SUFFIX)) {
      WorkspaceNames.add(Entry.name.slice(0, -COMPLETED_SUFFIX.length));
    }
  }

  return Array.from(WorkspaceNames).sort();
}

/**
 * @param {any} ArgReminder
 * @returns {string|null}
 */
function GetReminderId(ArgReminder) {
  return GetNonEmptyString(ArgReminder?.ReminderID) || GetNonEmptyString(ArgReminder?.reminderId);
}

/**
 * @param {any} ArgReminder
 * @returns {string|null}
 */
function ResolveCreatedOnIsoString(ArgReminder) {
  return NormalizeIsoString(ArgReminder?.CreatedOn)
    || NormalizeIsoString(ArgReminder?.createdOn)
    || NormalizeIsoString(ArgReminder?.dueDate)
    || NormalizeIsoString(ArgReminder?.ShouldPostOn)
    || NormalizeIsoString(ArgReminder?.completedAt)
    || NormalizeIsoString(ArgReminder?.completedMs);
}

/**
 * @param {any} ArgReminder
 * @param {'active'|'completed'} ArgStoreKind
 * @returns {object|null}
 */
function BuildBaselineEvent(ArgReminder, ArgStoreKind) {
  const ReminderId = GetReminderId(ArgReminder);
  if(ReminderId === null) {
    return null;
  }

  const SourceChannelId = GetNonEmptyString(ArgReminder?.OriginalChannelID)
    || GetNonEmptyString(ArgReminder?.sourceChannelID)
    || GetNonEmptyString(ArgReminder?.sourceChannelId)
    || GetNonEmptyString(ArgReminder?.TargetChannelID)
    || GetNonEmptyString(ArgReminder?.targetChannelId);

  const TargetChannelId = GetNonEmptyString(ArgReminder?.TargetChannelID)
    || GetNonEmptyString(ArgReminder?.targetChannelId)
    || GetNonEmptyString(ArgReminder?.OriginalChannelID)
    || GetNonEmptyString(ArgReminder?.sourceChannelID)
    || GetNonEmptyString(ArgReminder?.sourceChannelId);

  const DueAt = NormalizeIsoString(ArgReminder?.ShouldPostOn)
    || NormalizeIsoString(ArgReminder?.dueDate)
    || NormalizeIsoString(ArgReminder?.dueAt);

  const State = GetNonEmptyString(ArgReminder?.State)
    || GetNonEmptyString(ArgReminder?.state)
    || (ArgStoreKind === 'completed' ? 'completed' : 'scheduled');

  const AssigneeIds = GetStringArray(ArgReminder?.AssigneeIDs ?? ArgReminder?.assigneeIds);
  const AssigneeId = GetNonEmptyString(ArgReminder?.AssigneeID)
    || GetNonEmptyString(ArgReminder?.assigneeID)
    || GetNonEmptyString(ArgReminder?.assigneeId);

  const Event = {
    v: CURRENT_SCHEMA_VERSION,
    type: 'BaselineReminderImported',
    reminderId: ReminderId,
    payload: {
      text: GetNonEmptyString(ArgReminder?.ReminderMessageText)
        || GetNonEmptyString(ArgReminder?.summary)
        || GetNonEmptyString(ArgReminder?.text)
        || '',
      assigneeId: AssigneeId,
      // AssigneeIDs is the authoritative record and assigneeId only its deprecated first-entry
      // mirror, so a record written before shared assignments existed still has to produce a
      // non-lying array — otherwise the import silently undoes GH-22 for every legacy reminder.
      assigneeIds: AssigneeIds.length > 0 ? AssigneeIds : (AssigneeId ? [AssigneeId] : []),
      sourceChannelId: SourceChannelId,
      targetChannelId: TargetChannelId,
      dueAt: DueAt,
      state: State,
      githubUrls: GetStringArray(ArgReminder?.GitHubUrls ?? ArgReminder?.githubUrls),
      originalSenderId: GetNonEmptyString(ArgReminder?.OriginalSenderID)
        || GetNonEmptyString(ArgReminder?.originalSenderId),
      originalMessageId: GetNonEmptyString(ArgReminder?.OriginalMessageID)
        || GetNonEmptyString(ArgReminder?.originalMessageId),
      originalThreadTs: GetNonEmptyString(ArgReminder?.OriginalThreadTs)
        || GetNonEmptyString(ArgReminder?.originalThreadTs),
      originalChannelName: GetNonEmptyString(ArgReminder?.OriginalChannelName)
        || GetNonEmptyString(ArgReminder?.originalChannelName),
      ignoreSnooze: Boolean(ArgReminder?.IgnoreSnooze ?? ArgReminder?.ignoreSnooze),
      clientId: GetNonEmptyString(ArgReminder?.clientId) || GetNonEmptyString(ArgReminder?.ClientID),
      // Unlike a native creation, an import CAN legitimately carry `true` here: the JSON record it
      // reads may describe a thread whose relay started, or was stopped, long before the ledger
      // existed. Omitting them would let a flag-on read resume a relay a user deliberately stopped.
      gitHubRelayStarted: Boolean(ArgReminder?.GitHubRelayStarted ?? ArgReminder?.gitHubRelayStarted),
      gitHubRelayStopped: Boolean(ArgReminder?.GitHubRelayStopped ?? ArgReminder?.gitHubRelayStopped),
      // `createdOn` cannot be substituted from `ts`: ts is when the append ran, not when the
      // reminder was created, and the projection compares raw bytes against the JSON store.
      createdOn: ResolveCreatedOnIsoString(ArgReminder),
    },
  };

  const Timestamp = ResolveCreatedOnIsoString(ArgReminder);
  if(Timestamp !== null) {
    Event.ts = Timestamp;
  }

  return Event;
}

/**
 * Emit `ReminderRemoved` for every reminder the LEDGER still believes is live but that neither JSON
 * store holds. The mirror image of enrichment: enrich adds what JSON has and the ledger lacks; this
 * retires what the ledger has and JSON has already dropped.
 *
 * Needed because removal was never evented before schema v2 (`#DeleteRemindersAsync` mutated the
 * queue and saved, emitting nothing), so every reminder deleted before that fix is an orphan in the
 * log. On real neochrome data that is 11 reminders which fold to a live `scheduled` state — under a
 * read flag they would be resurrected and resume posting to Slack.
 *
 * Deliberately its OWN flag rather than part of `--enrich`: filling in missing fields is a safe
 * restatement of what the JSON store already says, while this asserts that a reminder is dead.
 * Those deserve separate consent.
 * @param {any[]} ArgEvents Existing workspace stream.
 * @param {Set<string>} ArgLiveIds Every reminder id present in either JSON store.
 * @returns {object[]} ReminderRemoved events, one per orphan.
 */
function BuildOrphanRetirementEvents(ArgEvents, ArgLiveIds) {
  // Required lazily: this script is also loaded by tooling that has no need of the projection.
  const { FoldReminderReadModels } = require('../src/reminders-projection');
  const Folded = FoldReminderReadModels(ArgEvents);
  const Events = [];
  for(const Reminder of Folded.reminders) {
    if(ArgLiveIds.has(Reminder.ReminderID)) continue;
    Events.push({
      v: CURRENT_SCHEMA_VERSION,
      type: 'ReminderRemoved',
      reminderId: Reminder.ReminderID,
      payload: { reason: 'orphan-reconciliation' },
    });
  }
  return Events;
}

/**
 * Pair a completed-store row's baseline event with the `ReminderCompleted` that makes it foldable.
 *
 * Found by the first real-data parity run (neochrome, 2026-08-08): a `BaselineReminderImported`
 * carrying `state: 'completed'` and nothing else is dropped from BOTH read models — the fold sees a
 * completed reminder, tries `Date.parse(completedAt)` on a field that was never written, gets NaN,
 * and skips the record entirely. **32 of 152 real completions vanished this way.** That is silent
 * data loss, not a parity nit.
 *
 * Mirrors the pairing `src/state-snapshot-writer.js` already does when it compacts, so the two
 * producers of baseline events agree on shape.
 * @param {any} ArgReminder A row from the completed store.
 * @returns {object|null} A v2 ReminderCompleted, or null when the row has no usable instant.
 */
function BuildCompletionEvent(ArgReminder) {
  const ReminderId = GetReminderId(ArgReminder);
  if(ReminderId === null) return null;

  const CompletedMs = typeof ArgReminder?.completedMs === 'number' && Number.isFinite(ArgReminder.completedMs)
    ? ArgReminder.completedMs
    : Date.parse(NormalizeIsoString(ArgReminder?.completedAt) || '');
  if(!Number.isFinite(CompletedMs)) return null;
  const CompletedAt = new Date(CompletedMs).toISOString();

  return {
    v: CURRENT_SCHEMA_VERSION,
    ts: CompletedAt,
    type: 'ReminderCompleted',
    reminderId: ReminderId,
    payload: {
      by: GetNonEmptyString(ArgReminder?.assigneeID)
        || GetNonEmptyString(ArgReminder?.AssigneeID)
        || GetNonEmptyString(ArgReminder?.assigneeId),
      method: 'baseline-import',
      summary: GetNonEmptyString(ArgReminder?.summary)
        || GetNonEmptyString(ArgReminder?.ReminderMessageText),
      completedAt: CompletedAt,
      // Verbatim, never re-derived — the whole point of v2 carrying it.
      completedMs: CompletedMs,
      sourceChannelId: GetNonEmptyString(ArgReminder?.sourceChannelID)
        || GetNonEmptyString(ArgReminder?.OriginalChannelID)
        || GetNonEmptyString(ArgReminder?.sourceChannelId),
      dueDate: NormalizeIsoString(ArgReminder?.dueDate) || NormalizeIsoString(ArgReminder?.ShouldPostOn),
      clientId: GetNonEmptyString(ArgReminder?.clientId) || GetNonEmptyString(ArgReminder?.ClientID),
    },
  };
}

/**
 * Does the stream already carry everything a v2 fold needs for this reminder?
 *
 * Judged against the MERGED creation payloads, matching how the projection judges parity: a v1
 * event followed by an enrich event is a repaired stream, not a broken one, so re-enriching it
 * would append a line that changes nothing.
 * @param {object[]} ArgEvents Every event already in the workspace stream.
 * @returns {Map<string, boolean>} reminderId → true when no enrichment is needed.
 */
function BuildReminderCompletenessMap(ArgEvents) {
  /** @type {Map<string, Set<string>>} */
  const KeysById = new Map();
  for(const Event of ArgEvents) {
    if(!Event || typeof Event !== 'object') continue;
    if(Event.type !== 'ReminderCreated' && Event.type !== 'BaselineReminderImported') continue;
    const ReminderId = GetNonEmptyString(Event.reminderId);
    if(ReminderId === null) continue;
    const Payload = Event.payload && typeof Event.payload === 'object' ? Event.payload : {};
    let Keys = KeysById.get(ReminderId);
    if(!Keys) {
      Keys = new Set();
      KeysById.set(ReminderId, Keys);
    }
    for(const Key of Object.keys(Payload)) {
      if(Payload[Key] !== undefined) Keys.add(Key);
    }
  }

  // A baseline import can only ever be judged against the baseline requirement set — it is what this
  // script writes, and it is a superset of what a native creation needs for reconstruction.
  const Required = REQUIRED_PAYLOAD_KEYS_V2.BaselineReminderImported;
  /** @type {Map<string, boolean>} */
  const Complete = new Map();
  for(const [ReminderId, Keys] of KeysById) {
    Complete.set(ReminderId, Required.every(ArgKey => Keys.has(ArgKey)));
  }
  return Complete;
}

/**
 * @param {object[]} ArgEvents
 * @returns {Set<string>}
 */
function BuildSeededReminderIdSet(ArgEvents) {
  const SeededReminderIds = new Set();
  for(const Event of ArgEvents) {
    if(!Event || typeof Event !== 'object') continue;
    if(Event.type !== 'ReminderCreated' && Event.type !== 'BaselineReminderImported') continue;
    const ReminderId = GetNonEmptyString(Event.reminderId);
    if(ReminderId !== null) {
      SeededReminderIds.add(ReminderId);
    }
  }
  return SeededReminderIds;
}

/**
 * @param {{ workspace: string, remindersDir: string, eventsDir: string, enrich?: boolean, retireOrphans?: boolean }} ArgOptions
 *   `enrich` re-emits a v2 event for a reminder that IS already seeded but whose existing events
 *   predate the schema expansion. Without it this script can only ever seed reminders the ledger has
 *   never heard of — which means it could not repair the streams that actually need repairing.
 * @returns {Promise<{ workspace: string, baselineEvents: object[], skippedReminderIds: string[], enrichedReminderIds: string[], retiredReminderIds: string[] }>}
 */
async function CollectMissingBaselineEventsAsync(ArgOptions) {
  const Workspace = ArgOptions.workspace;
  const ActiveFilePath = path.join(ArgOptions.remindersDir, `${Workspace}${ACTIVE_SUFFIX}`);
  const CompletedFilePath = path.join(ArgOptions.remindersDir, `${Workspace}${COMPLETED_SUFFIX}`);
  const [ActiveReminders, CompletedReminders] = await Promise.all([
    ReadJsonArrayAsync(ActiveFilePath),
    ReadJsonArrayAsync(CompletedFilePath),
  ]);

  const EventStore = createEventStore({ rootDir: ArgOptions.eventsDir });
  const ExistingEvents = await EventStore.readAll(Workspace);
  const SeededReminderIds = BuildSeededReminderIdSet(ExistingEvents);
  const CompleteById = BuildReminderCompletenessMap(ExistingEvents);
  const Enrich = ArgOptions.enrich === true;

  /** @type {object[]} */
  const BaselineEvents = [];
  /** @type {string[]} */
  const SkippedReminderIds = [];
  /** @type {string[]} */
  const EnrichedReminderIds = [];

  for(const [StoreKind, Reminders] of [['active', ActiveReminders], ['completed', CompletedReminders]]) {
    for(const Reminder of Reminders) {
      const ReminderId = GetReminderId(Reminder);
      if(ReminderId === null) {
        continue;
      }
      const AlreadySeeded = SeededReminderIds.has(ReminderId);
      // Already complete, or enrichment not asked for: nothing to write. Re-emitting a complete
      // record would append a line that changes no fold, which is pure ledger noise.
      if(AlreadySeeded && (!Enrich || CompleteById.get(ReminderId) === true)) {
        SkippedReminderIds.push(ReminderId);
        continue;
      }
      const Event = BuildBaselineEvent(Reminder, /** @type {'active'|'completed'} */ (StoreKind));
      if(Event === null) {
        continue;
      }
      BaselineEvents.push(Event);
      // A completed row needs its completion event too, or the fold drops it from both read models.
      if(StoreKind === 'completed') {
        const CompletionEvent = BuildCompletionEvent(Reminder);
        if(CompletionEvent !== null) BaselineEvents.push(CompletionEvent);
      }
      if(AlreadySeeded) EnrichedReminderIds.push(ReminderId);
      SeededReminderIds.add(ReminderId);
      CompleteById.set(ReminderId, true);
    }
  }

  // Orphan retirement runs against the stream PLUS everything this run is about to append, so an
  // enrich event landing in the same run cannot make a reminder look orphaned.
  /** @type {object[]} */
  let RetirementEvents = [];
  if(ArgOptions.retireOrphans === true) {
    const LiveIds = new Set();
    for(const Reminder of ActiveReminders.concat(CompletedReminders)) {
      const Id = GetReminderId(Reminder);
      if(Id !== null) LiveIds.add(Id);
    }
    RetirementEvents = BuildOrphanRetirementEvents(ExistingEvents.concat(BaselineEvents), LiveIds);
  }

  return {
    workspace: Workspace,
    baselineEvents: BaselineEvents.concat(RetirementEvents),
    skippedReminderIds: SkippedReminderIds,
    enrichedReminderIds: EnrichedReminderIds,
    retiredReminderIds: RetirementEvents.map(ArgEvent => ArgEvent.reminderId),
  };
}

/**
 * @param {{ workspace: string, remindersDir: string, eventsDir: string, write?: boolean, enrich?: boolean, retireOrphans?: boolean }} ArgOptions
 * @returns {Promise<{ workspace: string, baselineEvents: object[], skippedReminderIds: string[], enrichedReminderIds: string[], retiredReminderIds: string[], appendedCount: number }>}
 */
async function ImportWorkspaceAsync(ArgOptions) {
  const Result = await CollectMissingBaselineEventsAsync(ArgOptions);
  let AppendedCount = 0;

  if(ArgOptions.write === true && Result.baselineEvents.length > 0) {
    const EventStore = createEventStore({ rootDir: ArgOptions.eventsDir });
    for(const Event of Result.baselineEvents) {
      const AppendResult = await EventStore.append(Result.workspace, Event);
      if(!AppendResult.ok) {
        throw AppendResult.error || new Error(`failed to append baseline event for workspace ${Result.workspace}`);
      }
      AppendedCount += 1;
    }
  }

  return {
    ...Result,
    appendedCount: AppendedCount,
  };
}

/**
 * @param {string[]} ArgArgv
 * @returns {{ repoRoot: string, workspaces: string[]|null, write: boolean, json: boolean, enrich: boolean, retireOrphans: boolean }}
 */
function ParseArgs(ArgArgv) {
  /** @type {{ repoRoot: string, workspaces: string[]|null, write: boolean, json: boolean, enrich: boolean, retireOrphans: boolean }} */
  const Options = {
    repoRoot: path.resolve(__dirname, '..'),
    workspaces: null,
    write: false,
    json: false,
    enrich: false,
    retireOrphans: false,
  };

  for(let Index = 0; Index < ArgArgv.length; Index += 1) {
    const Arg = ArgArgv[Index];
    if(Arg === '--write') {
      Options.write = true;
      continue;
    }
    if(Arg === '--enrich') {
      Options.enrich = true;
      continue;
    }
    if(Arg === '--retire-orphans') {
      Options.retireOrphans = true;
      continue;
    }
    if(Arg === '--json') {
      Options.json = true;
      continue;
    }
    if(Arg === '--repo-root') {
      const Value = ArgArgv[Index + 1];
      if(!Value) {
        throw new Error('--repo-root requires a value');
      }
      Options.repoRoot = path.resolve(Value);
      Index += 1;
      continue;
    }
    if(Arg === '--workspace') {
      const Value = ArgArgv[Index + 1];
      if(!Value) {
        throw new Error('--workspace requires a value');
      }
      if(!Array.isArray(Options.workspaces)) {
        Options.workspaces = [];
      }
      Options.workspaces.push(Value);
      Index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${Arg}`);
  }

  return Options;
}

/**
 * @param {string[]} [ArgArgv]
 * @returns {Promise<object[]>}
 */
async function MainAsync(ArgArgv = process.argv.slice(2)) {
  const Options = ParseArgs(ArgArgv);
  const RemindersDir = path.join(Options.repoRoot, 'data', 'runtime', 'reminders');
  const EventsDir = path.join(Options.repoRoot, 'data', 'runtime', 'events');
  const Workspaces = Array.isArray(Options.workspaces) && Options.workspaces.length > 0
    ? Options.workspaces
    : await EnumerateWorkspaceNamesAsync(RemindersDir);

  /** @type {object[]} */
  const Results = [];
  for(const Workspace of Workspaces) {
    Results.push(await ImportWorkspaceAsync({
      workspace: Workspace,
      remindersDir: RemindersDir,
      eventsDir: EventsDir,
      write: Options.write,
      enrich: Options.enrich,
      retireOrphans: Options.retireOrphans,
    }));
  }

  if(Options.json) {
    console.log(JSON.stringify(Results, null, 2));
  } else {
    for(const Result of Results) {
      const Mode = Options.write ? 'write' : 'dry-run';
      // Report the enrichment split explicitly. A run that says "12 events" while 12 of them are
      // re-emissions of reminders the ledger already knew reads as new coverage when it is repair.
      const Enriched = Result.enrichedReminderIds.length > 0
        ? ` — ${Result.enrichedReminderIds.length} enriching an existing reminder`
        : '';
      const Retired = Result.retiredReminderIds.length > 0
        ? `, ${Result.retiredReminderIds.length} retiring a ledger orphan`
        : '';
      console.log(
        `${Result.workspace}: ${Result.baselineEvents.length} baseline event(s) ${Options.write ? 'appended' : 'planned'} (${Mode})${Enriched}${Retired}`
      );
    }
  }

  return Results;
}

if (require.main === module) {
  MainAsync().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  BuildBaselineEvent,
  BuildCompletionEvent,
  BuildOrphanRetirementEvents,
  BuildReminderCompletenessMap,
  CollectMissingBaselineEventsAsync,
  EnumerateWorkspaceNamesAsync,
  ImportWorkspaceAsync,
  MainAsync,
  NormalizeIsoString,
};
