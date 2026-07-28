#!/usr/bin/env node
'use strict';

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const CombinedLogger = require('../src/combined-logger');
const SlackApp = require('../src/slack-app');
const Workspaces = require('../src/workspaces');
const ListsModule = require('../src/lists-module');
const RemindersModule = require('../src/reminders-module');

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const LOCK_STALE_MS = 300000;
const LOCK_FILE_PATH = path.resolve(path.join(__dirname, '..', 'data', 'runtime', 'locks', 'lists-harness.lock'));

/**
 * @typedef {{
 *   Command: string|null,
 *   WorkspaceName: string|null,
 *   UserID: string|null,
 *   ReminderID: string|null,
 *   RowID: string|null,
 *   Summary: string|null,
 *   DueDate: string|null,
 *   AssigneeID: string|null,
 *   AccessChannelName: string|null,
 *   AccessChannelID: string|null,
 *   TargetChannelID: string|null,
 *   Execute: boolean,
 *   PollAfter: boolean,
 *   HelpRequested: boolean,
 *   TimeoutMs: number
 * }} HarnessOptions
 */

/**
 * @typedef {{
 *   SlackAppInstance: SlackApp,
 *   ListsModuleInstance: ListsModule,
 *   RemindersModuleInstance: RemindersModule,
 *   WorkspaceInfo: import('../src/workspaces').WorkspaceInfo,
 *   CleanupAsync: () => Promise<void>
 * }} HarnessRuntime
 */

/**
 * @param {string[]} ArgArgv
 * @returns {HarnessOptions}
 */
function ParseArgs(ArgArgv) {
  /** @type {HarnessOptions} */
  const Options = {
    Command: null,
    WorkspaceName: null,
    UserID: null,
    ReminderID: null,
    RowID: null,
    Summary: null,
    DueDate: null,
    AssigneeID: null,
    AccessChannelName: null,
    AccessChannelID: null,
    TargetChannelID: null,
    Execute: false,
    PollAfter: false,
    HelpRequested: false,
    TimeoutMs: DEFAULT_TIMEOUT_MS
  };

  const [MaybeCommand, ...RestArgs] = ArgArgv;
  if(MaybeCommand && !MaybeCommand.startsWith('--')) {
    Options.Command = MaybeCommand;
  } else if(MaybeCommand) {
    RestArgs.unshift(MaybeCommand);
  }

  for(let Index = 0; Index < RestArgs.length; Index++) {
    const CurrentArg = RestArgs[Index];

    if(CurrentArg === '--workspace') {
      Options.WorkspaceName = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--user') {
      Options.UserID = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--reminder-id') {
      Options.ReminderID = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--row-id') {
      Options.RowID = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--summary') {
      Options.Summary = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--due-date') {
      Options.DueDate = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--assignee-user') {
      Options.AssigneeID = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--access-channel') {
      Options.AccessChannelName = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--access-channel-id') {
      Options.AccessChannelID = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--target-channel-id') {
      Options.TargetChannelID = RestArgs[++Index] || null;
      continue;
    }
    if(CurrentArg === '--execute') {
      Options.Execute = true;
      continue;
    }
    if(CurrentArg === '--poll-after') {
      Options.PollAfter = true;
      continue;
    }
    if(CurrentArg === '--timeout-ms') {
      const TimeoutText = RestArgs[++Index] || null;
      Options.TimeoutMs = TimeoutText ? Number.parseInt(TimeoutText, 10) : Number.NaN;
      continue;
    }
    if(CurrentArg === '--help' || CurrentArg === '-h') {
      Options.HelpRequested = true;
      continue;
    }

    throw new Error(`Unknown argument: ${CurrentArg}`);
  }

  return Options;
}

/**
 * @param {HarnessOptions} ArgOptions
 */
function ValidateOptions(ArgOptions) {
  if(ArgOptions.HelpRequested) return;

  const ValidCommands = new Set([
    'status',
    'ensure-user-list',
    'poll-now',
    'list-rows',
    'create-manual-row',
    'complete-row',
    'delete-row'
  ]);

  if(!ArgOptions.Command || !ValidCommands.has(ArgOptions.Command)) {
    throw new Error(`Command is required. Valid commands: ${[...ValidCommands].join(', ')}`);
  }

  if(typeof ArgOptions.WorkspaceName !== 'string' || ArgOptions.WorkspaceName.trim().length === 0)
    throw new Error('Argument --workspace is required.');

  if(
    !Number.isInteger(ArgOptions.TimeoutMs)
    || ArgOptions.TimeoutMs < MIN_TIMEOUT_MS
    || ArgOptions.TimeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`Timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`);
  }

  const CommandsRequiringUser = new Set([
    'ensure-user-list',
    'list-rows',
    'create-manual-row',
    'complete-row',
    'delete-row'
  ]);
  if(CommandsRequiringUser.has(ArgOptions.Command) && (!ArgOptions.UserID || ArgOptions.UserID.trim().length === 0))
    throw new Error(`Command ${ArgOptions.Command} requires --user.`);

  const MutatingCommands = new Set([
    'ensure-user-list',
    'create-manual-row',
    'complete-row',
    'delete-row'
  ]);
  if(MutatingCommands.has(ArgOptions.Command) && !ArgOptions.Execute)
    throw new Error(`Command ${ArgOptions.Command} requires --execute.`);

  if(ArgOptions.AccessChannelName && ArgOptions.AccessChannelID)
    throw new Error('Use either --access-channel or --access-channel-id, not both.');

  if(ArgOptions.Command === 'create-manual-row') {
    if(!ArgOptions.Summary || !ArgOptions.DueDate)
      throw new Error('Command create-manual-row requires --summary and --due-date.');
  }

  if((ArgOptions.Command === 'complete-row' || ArgOptions.Command === 'delete-row') && !ArgOptions.RowID && !ArgOptions.ReminderID)
    throw new Error(`Command ${ArgOptions.Command} requires either --row-id or --reminder-id.`);
}

function PrintUsage() {
  console.log('Usage: npm run lists:harness -- <command> --workspace NAME [options]');
  console.log('');
  console.log('Commands:');
  console.log('  status                show shared/per-user list registration status and reminder counts.');
  console.log('  ensure-user-list      create/resync a durable per-user list for one user.');
  console.log('  poll-now              force one immediate inbound poll cycle.');
  console.log('  list-rows             show parsed rows for one registered per-user list.');
  console.log('  create-manual-row     create a hand-authored row in a user list (requires --execute).');
  console.log('  complete-row          mark one user-list row completed (requires --execute).');
  console.log('  delete-row            delete one user-list row (requires --execute).');
  console.log('');
  console.log('Common options:');
  console.log('  --workspace NAME      target workspace name (required).');
  console.log('  --user U123           owner Slack user ID for per-user list commands.');
  console.log('  --execute             required for mutating commands.');
  console.log('  --poll-after          force one poll cycle after the command completes.');
  console.log(`  --timeout-ms N        hard timeout in ms (${DEFAULT_TIMEOUT_MS} default, ${MAX_TIMEOUT_MS} max).`);
  console.log('  --help, -h            show this help text.');
  console.log('');
  console.log('Command-specific options:');
  console.log('  ensure-user-list:');
  console.log('    --access-channel NAME       channel name granted read access (defaults to REMINDER_CHANNEL_NAME).');
  console.log('    --access-channel-id C123    channel ID granted read access.');
  console.log('  create-manual-row:');
  console.log('    --summary TEXT              task text.');
  console.log('    --due-date ISO              parseable due date string.');
  console.log('    --assignee-user U123        optional assignee user ID.');
  console.log('    --target-channel-id C123    optional source/target channel field to write.');
  console.log('  complete-row / delete-row:');
  console.log('    --row-id Rec123             direct Slack row ID.');
  console.log('    --reminder-id UUID          resolve the row from reminder_id first.');
}

function GetCurrentGitBranch() {
  try {
    return execSync('git branch --show-current', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 5000
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {number} ArgPid
 * @returns {boolean}
 */
function IsProcessRunning(ArgPid) {
  try {
    process.kill(ArgPid, 0);
    return true;
  } catch(error) {
    if(error.code === 'EPERM') return true;
    return false;
  }
}

/**
 * @returns {Promise<() => Promise<void>>}
 */
async function AcquireLockAsync() {
  await fs.mkdir(path.dirname(LOCK_FILE_PATH), { recursive: true });

  try {
    const LockFileHandle = await fs.open(LOCK_FILE_PATH, 'wx');
    await LockFileHandle.writeFile(JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    }, null, 2));
    await LockFileHandle.close();
  } catch(error) {
    if(error.code !== 'EEXIST') throw error;

    let ExistingLock = null;
    try {
      ExistingLock = JSON.parse(await fs.readFile(LOCK_FILE_PATH, 'utf8'));
    } catch {
      ExistingLock = null;
    }

    const ExistingPid = typeof ExistingLock?.pid === 'number' ? ExistingLock.pid : null;
    const ExistingCreatedAt = typeof ExistingLock?.createdAt === 'number' ? ExistingLock.createdAt : 0;
    const LockIsStale = Date.now() - ExistingCreatedAt > LOCK_STALE_MS;

    if(ExistingPid && IsProcessRunning(ExistingPid) && !LockIsStale) {
      throw new Error(`Lists harness lock is already held by pid ${ExistingPid}.`);
    }

    await fs.unlink(LOCK_FILE_PATH);
    return await AcquireLockAsync();
  }

  return async function ReleaseLockAsync() {
    try {
      await fs.unlink(LOCK_FILE_PATH);
    } catch(error) {
      if(error.code !== 'ENOENT') throw error;
    }
  };
}

/**
 * @param {HarnessOptions} ArgOptions
 * @returns {Promise<HarnessRuntime>}
 */
async function CreateHarnessRuntimeAsync(ArgOptions) {
  const WorkspaceInfo = await Workspaces.LoadWorkspaceInfoByNameAsync(ArgOptions.WorkspaceName);
  Workspaces.ValidateWorkspaceInfo(WorkspaceInfo);

  const Logger = new CombinedLogger(`lists-harness:${WorkspaceInfo.WORKSPACE_NAME}`);
  const SlackAppInstance = new SlackApp(WorkspaceInfo, Logger);
  const ListsModuleInstance = new ListsModule(SlackAppInstance, GetCurrentGitBranch());
  const RemindersModuleInstance = new RemindersModule(SlackAppInstance);
  RemindersModuleInstance.SetListsModule(ListsModuleInstance);
  ListsModuleInstance.SetRemindersModule(RemindersModuleInstance);

  await SlackAppInstance.ConnectOneShotAsync();

  const EmptyStats = SlackApp.CreateEmptyWorkspaceStats();
  await RemindersModuleInstance.StartAsync(EmptyStats);
  await ListsModuleInstance.StartAsync(EmptyStats);

  return {
    SlackAppInstance,
    ListsModuleInstance,
    RemindersModuleInstance,
    WorkspaceInfo,
    CleanupAsync: async () => {
      await ListsModuleInstance.StopAsync();
      await RemindersModuleInstance.StopAsync();
      await SlackAppInstance.StopAsync();
    }
  };
}

/**
 * @param {HarnessRuntime} ArgRuntime
 * @param {HarnessOptions} ArgOptions
 * @returns {Promise<string>}
 */
async function ResolveAccessChannelIDAsync(ArgRuntime, ArgOptions) {
  if(ArgOptions.AccessChannelID)
    return ArgOptions.AccessChannelID;

  const ChannelName = ArgOptions.AccessChannelName || ArgRuntime.WorkspaceInfo.REMINDER_CHANNEL_NAME;
  const ChannelID = await ArgRuntime.SlackAppInstance.GetChannelIdAsync(ChannelName);
  if(!ChannelID)
    throw new Error(`Could not resolve access channel ${ChannelName}.`);
  return ChannelID;
}

/**
 * @param {HarnessRuntime} ArgRuntime
 * @param {string} ArgUserID
 * @returns {Array<import('../src/reminders-module').ReminderInfo>}
 */
function GetRemindersForUser(ArgRuntime, ArgUserID) {
  return ArgRuntime.RemindersModuleInstance.GetAllReminders().filter(ArgReminder =>
    (ArgReminder.AssigneeID || ArgReminder.OriginalSenderID) === ArgUserID
  );
}

/**
 * @param {HarnessRuntime} ArgRuntime
 * @param {HarnessOptions} ArgOptions
 * @returns {Promise<string>}
 */
async function ResolveRowIDAsync(ArgRuntime, ArgOptions) {
  if(ArgOptions.RowID)
    return ArgOptions.RowID;

  const RowsResult = await ArgRuntime.ListsModuleInstance.GetUserListRowsAsync(/** @type {string} */(ArgOptions.UserID));
  const MatchingRow = RowsResult.rows.find(ArgRow => ArgRow.reminderId === ArgOptions.ReminderID);
  if(!MatchingRow || !MatchingRow.rowId) {
    throw new Error(`Could not find a row for reminder ${ArgOptions.ReminderID}.`);
  }
  return MatchingRow.rowId;
}

/**
 * @param {HarnessRuntime} ArgRuntime
 * @param {HarnessOptions} ArgOptions
 * @returns {Promise<any>}
 */
async function RunCommandAsync(ArgRuntime, ArgOptions) {
  if(ArgOptions.Command === 'status') {
    const Result = await ArgRuntime.ListsModuleInstance.GetSyncStatusAsync();
    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      teamId: ArgRuntime.SlackAppInstance.TeamId,
      reminderCount: ArgRuntime.RemindersModuleInstance.GetAllReminders().length,
      ...Result
    };
  }

  if(ArgOptions.Command === 'ensure-user-list') {
    const UserReminders = GetRemindersForUser(ArgRuntime, /** @type {string} */(ArgOptions.UserID));
    const AccessChannelID = await ResolveAccessChannelIDAsync(ArgRuntime, ArgOptions);
    const EnsureResult = await ArgRuntime.ListsModuleInstance.EnsureUserListAsync(
      /** @type {string} */(ArgOptions.UserID),
      UserReminders,
      AccessChannelID
    );
    if(ArgOptions.PollAfter)
      await ArgRuntime.ListsModuleInstance.ForcePollNowAsync();

    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      userId: ArgOptions.UserID,
      reminderCount: UserReminders.length,
      accessChannelId: AccessChannelID,
      ensure: EnsureResult,
      rows: await ArgRuntime.ListsModuleInstance.GetUserListRowsAsync(/** @type {string} */(ArgOptions.UserID))
    };
  }

  if(ArgOptions.Command === 'poll-now') {
    const PollResult = await ArgRuntime.ListsModuleInstance.ForcePollNowAsync();
    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      poll: PollResult,
      status: await ArgRuntime.ListsModuleInstance.GetSyncStatusAsync()
    };
  }

  if(ArgOptions.Command === 'list-rows') {
    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      userId: ArgOptions.UserID,
      rows: await ArgRuntime.ListsModuleInstance.GetUserListRowsAsync(/** @type {string} */(ArgOptions.UserID))
    };
  }

  if(ArgOptions.Command === 'create-manual-row') {
    const CreateResult = await ArgRuntime.ListsModuleInstance.CreateManualUserListRowAsync(
      /** @type {string} */(ArgOptions.UserID),
      {
        summary: /** @type {string} */(ArgOptions.Summary),
        dueDate: /** @type {string} */(ArgOptions.DueDate),
        assigneeID: ArgOptions.AssigneeID,
        targetChannelID: ArgOptions.TargetChannelID
      }
    );
    if(ArgOptions.PollAfter)
      await ArgRuntime.ListsModuleInstance.ForcePollNowAsync();

    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      userId: ArgOptions.UserID,
      created: CreateResult,
      rows: await ArgRuntime.ListsModuleInstance.GetUserListRowsAsync(/** @type {string} */(ArgOptions.UserID)),
      reminders: GetRemindersForUser(ArgRuntime, /** @type {string} */(ArgOptions.UserID)).map(ArgReminder => ({
        reminderId: ArgReminder.ReminderID,
        summary: ArgReminder.ReminderMessageText,
        shouldPostOn: ArgReminder.ShouldPostOn.toISOString(),
        targetChannelId: ArgReminder.TargetChannelID,
        assigneeId: ArgReminder.AssigneeID || null
      }))
    };
  }

  if(ArgOptions.Command === 'complete-row') {
    const RowID = await ResolveRowIDAsync(ArgRuntime, ArgOptions);
    const CompleteResult = await ArgRuntime.ListsModuleInstance.SetUserListRowCompletedAsync(
      /** @type {string} */(ArgOptions.UserID),
      RowID,
      true
    );
    if(ArgOptions.PollAfter)
      await ArgRuntime.ListsModuleInstance.ForcePollNowAsync();

    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      userId: ArgOptions.UserID,
      rowId: RowID,
      completed: CompleteResult,
      rows: await ArgRuntime.ListsModuleInstance.GetUserListRowsAsync(/** @type {string} */(ArgOptions.UserID)),
      reminders: GetRemindersForUser(ArgRuntime, /** @type {string} */(ArgOptions.UserID)).map(ArgReminder => ({
        reminderId: ArgReminder.ReminderID,
        summary: ArgReminder.ReminderMessageText,
        state: ArgReminder.State || null
      }))
    };
  }

  if(ArgOptions.Command === 'delete-row') {
    const RowID = await ResolveRowIDAsync(ArgRuntime, ArgOptions);
    const DeleteResult = await ArgRuntime.ListsModuleInstance.DeleteUserListRowAsync(
      /** @type {string} */(ArgOptions.UserID),
      RowID
    );
    if(ArgOptions.PollAfter)
      await ArgRuntime.ListsModuleInstance.ForcePollNowAsync();

    return {
      workspace: ArgRuntime.WorkspaceInfo.WORKSPACE_NAME,
      userId: ArgOptions.UserID,
      rowId: RowID,
      deleted: DeleteResult,
      rows: await ArgRuntime.ListsModuleInstance.GetUserListRowsAsync(/** @type {string} */(ArgOptions.UserID)),
      reminders: GetRemindersForUser(ArgRuntime, /** @type {string} */(ArgOptions.UserID)).map(ArgReminder => ({
        reminderId: ArgReminder.ReminderID,
        summary: ArgReminder.ReminderMessageText,
        state: ArgReminder.State || null
      }))
    };
  }

  throw new Error(`Unsupported command: ${ArgOptions.Command}`);
}

/**
 * @param {HarnessOptions} ArgOptions
 * @returns {Promise<any>}
 */
async function RunListsHarnessAsync(ArgOptions) {
  const ReleaseLockAsync = await AcquireLockAsync();
  /** @type {HarnessRuntime|null} */
  let Runtime = null;

  try {
    Runtime = await CreateHarnessRuntimeAsync(ArgOptions);
    return await RunCommandAsync(Runtime, ArgOptions);
  } finally {
    if(Runtime)
      await Runtime.CleanupAsync();
    await ReleaseLockAsync();
  }
}

async function MainAsync() {
  const Options = ParseArgs(process.argv.slice(2));
  ValidateOptions(Options);

  if(Options.HelpRequested) {
    PrintUsage();
    return;
  }

  const TimeoutID = setTimeout(() => {
    console.error(`Lists harness timed out after ${Options.TimeoutMs} ms.`);
    process.exit(1);
  }, Options.TimeoutMs);
  TimeoutID.unref();

  try {
    const Result = await RunListsHarnessAsync(Options);
    console.log(JSON.stringify(Result, null, 2));
  } finally {
    clearTimeout(TimeoutID);
  }
}

if(require.main === module) {
  MainAsync().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  ParseArgs,
  ValidateOptions,
  RunListsHarnessAsync
};
