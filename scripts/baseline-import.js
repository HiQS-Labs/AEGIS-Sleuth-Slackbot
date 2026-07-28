#!/usr/bin/env node
'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { createEventStore } = require('../src/event-store');

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

  const Event = {
    type: 'BaselineReminderImported',
    reminderId: ReminderId,
    payload: {
      text: GetNonEmptyString(ArgReminder?.ReminderMessageText)
        || GetNonEmptyString(ArgReminder?.summary)
        || GetNonEmptyString(ArgReminder?.text)
        || '',
      assigneeId: GetNonEmptyString(ArgReminder?.AssigneeID)
        || GetNonEmptyString(ArgReminder?.assigneeID)
        || GetNonEmptyString(ArgReminder?.assigneeId),
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
    },
  };

  const Timestamp = ResolveCreatedOnIsoString(ArgReminder);
  if(Timestamp !== null) {
    Event.ts = Timestamp;
  }

  return Event;
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
 * @param {{ workspace: string, remindersDir: string, eventsDir: string }} ArgOptions
 * @returns {Promise<{ workspace: string, baselineEvents: object[], skippedReminderIds: string[] }>}
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

  /** @type {object[]} */
  const BaselineEvents = [];
  /** @type {string[]} */
  const SkippedReminderIds = [];

  for(const [StoreKind, Reminders] of [['active', ActiveReminders], ['completed', CompletedReminders]]) {
    for(const Reminder of Reminders) {
      const ReminderId = GetReminderId(Reminder);
      if(ReminderId === null) {
        continue;
      }
      if(SeededReminderIds.has(ReminderId)) {
        SkippedReminderIds.push(ReminderId);
        continue;
      }
      const Event = BuildBaselineEvent(Reminder, /** @type {'active'|'completed'} */ (StoreKind));
      if(Event === null) {
        continue;
      }
      BaselineEvents.push(Event);
      SeededReminderIds.add(ReminderId);
    }
  }

  return {
    workspace: Workspace,
    baselineEvents: BaselineEvents,
    skippedReminderIds: SkippedReminderIds,
  };
}

/**
 * @param {{ workspace: string, remindersDir: string, eventsDir: string, write?: boolean }} ArgOptions
 * @returns {Promise<{ workspace: string, baselineEvents: object[], skippedReminderIds: string[], appendedCount: number }>}
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
 * @returns {{ repoRoot: string, workspaces: string[]|null, write: boolean, json: boolean }}
 */
function ParseArgs(ArgArgv) {
  const Options = {
    repoRoot: path.resolve(__dirname, '..'),
    workspaces: null,
    write: false,
    json: false,
  };

  for(let Index = 0; Index < ArgArgv.length; Index += 1) {
    const Arg = ArgArgv[Index];
    if(Arg === '--write') {
      Options.write = true;
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
    }));
  }

  if(Options.json) {
    console.log(JSON.stringify(Results, null, 2));
  } else {
    for(const Result of Results) {
      const Mode = Options.write ? 'write' : 'dry-run';
      console.log(
        `${Result.workspace}: ${Result.baselineEvents.length} baseline event(s) ${Options.write ? 'appended' : 'planned'} (${Mode})`
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
  CollectMissingBaselineEventsAsync,
  EnumerateWorkspaceNamesAsync,
  ImportWorkspaceAsync,
  MainAsync,
  NormalizeIsoString,
};
