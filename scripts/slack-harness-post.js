const fs = require('fs').promises;
const path = require('path');
const CombinedLogger = require('../src/combined-logger');
const SlackApp = require('../src/slack-app');
const Workspaces = require('../src/workspaces');

const MAX_MESSAGE_LENGTH = 1200;
const MIN_TIMEOUT_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const VALID_CHANNEL_NAME_REGEX = /^[a-z0-9._-]+$/;
const VALID_CHANNEL_ID_REGEX = /^[CGD][A-Z0-9]+$/;
const VALID_THREAD_TS_REGEX = /^\d+\.\d+$/;
const LOCK_STALE_MS = 300000;
const LOCK_FILE_PATH = path.resolve(path.join(__dirname, '..', 'data', 'runtime', 'locks', 'slack-harness-post.lock'));

/**
 * Parse CLI arguments.
 * @param {string[]} ArgArgv Raw argv slice.
 * @returns {{
 *   WorkspaceName: string|null,
 *   ChannelName: string|null,
 *   ChannelID: string|null,
 *   ThreadTS: string|null,
 *   MessageText: string|null,
 *   MessageFilePath: string|null,
 *   Execute: boolean,
 *   HelpRequested: boolean,
 *   TimeoutMs: number
 * }}
 */
function ParseArgs(ArgArgv) {
  let WorkspaceName = null;
  let ChannelName = null;
  let ChannelID = null;
  let ThreadTS = null;
  let MessageText = null;
  let MessageFilePath = null;
  let Execute = false;
  let HelpRequested = false;
  let TimeoutMs = DEFAULT_TIMEOUT_MS;

  for(let i = 0; i < ArgArgv.length; i++) {
    const CurrentArg = ArgArgv[i];

    if(CurrentArg === '--workspace') {
      WorkspaceName = ArgArgv[++i] || null;
      if(!WorkspaceName) throw new Error('Missing workspace name after --workspace.');
      continue;
    }

    if(CurrentArg === '--channel') {
      ChannelName = ArgArgv[++i] || null;
      if(!ChannelName) throw new Error('Missing channel name after --channel.');
      continue;
    }

    if(CurrentArg === '--channel-id') {
      ChannelID = ArgArgv[++i] || null;
      if(!ChannelID) throw new Error('Missing channel ID after --channel-id.');
      continue;
    }

    if(CurrentArg === '--thread-ts') {
      ThreadTS = ArgArgv[++i] || null;
      if(!ThreadTS) throw new Error('Missing thread timestamp after --thread-ts.');
      continue;
    }

    if(CurrentArg === '--text') {
      MessageText = ArgArgv[++i] || null;
      if(MessageText === null) throw new Error('Missing text after --text.');
      continue;
    }

    if(CurrentArg === '--text-file') {
      MessageFilePath = ArgArgv[++i] || null;
      if(!MessageFilePath) throw new Error('Missing file path after --text-file.');
      continue;
    }

    if(CurrentArg === '--execute') {
      Execute = true;
      continue;
    }

    if(CurrentArg === '--timeout-ms') {
      const TimeoutText = ArgArgv[++i] || null;
      if(!TimeoutText) throw new Error('Missing timeout value after --timeout-ms.');
      TimeoutMs = Number.parseInt(TimeoutText, 10);
      if(!Number.isFinite(TimeoutMs))
        throw new Error('Timeout must be an integer number of milliseconds.');
      continue;
    }

    if(CurrentArg === '--help' || CurrentArg === '-h') {
      HelpRequested = true;
      continue;
    }

    throw new Error(`Unknown argument: ${CurrentArg}`);
  }

  return {
    WorkspaceName,
    ChannelName,
    ChannelID,
    ThreadTS,
    MessageText,
    MessageFilePath,
    Execute,
    HelpRequested,
    TimeoutMs,
  };
}

/**
 * Validate normalized options.
 * @param {{
 *   WorkspaceName: string|null,
 *   ChannelName: string|null,
 *   ChannelID: string|null,
 *   ThreadTS: string|null,
 *   MessageText: string|null,
 *   MessageFilePath: string|null,
 *   Execute: boolean,
 *   HelpRequested: boolean,
 *   TimeoutMs: number
 * }} ArgOptions Parsed options.
 */
function ValidateOptions(ArgOptions) {
  if(ArgOptions.HelpRequested) return;

  if(typeof ArgOptions.WorkspaceName !== 'string' || ArgOptions.WorkspaceName.trim().length === 0)
    throw new Error('Argument --workspace is required.');

  if(ArgOptions.ChannelName && ArgOptions.ChannelID)
    throw new Error('Use either --channel or --channel-id, not both.');

  if(!ArgOptions.MessageText && !ArgOptions.MessageFilePath)
    throw new Error('Provide exactly one of --text or --text-file.');

  if(ArgOptions.MessageText && ArgOptions.MessageFilePath)
    throw new Error('Provide exactly one of --text or --text-file.');

  if(ArgOptions.ChannelName && !VALID_CHANNEL_NAME_REGEX.test(ArgOptions.ChannelName))
    throw new Error('Channel names may only contain lowercase letters, numbers, dots, underscores, and hyphens.');

  if(ArgOptions.ChannelID && !VALID_CHANNEL_ID_REGEX.test(ArgOptions.ChannelID))
    throw new Error('Channel ID must look like a Slack channel ID (for example C123ABC456).');

  if(ArgOptions.ThreadTS && !VALID_THREAD_TS_REGEX.test(ArgOptions.ThreadTS))
    throw new Error('Thread timestamp must look like a Slack message timestamp.');

  if(
    !Number.isInteger(ArgOptions.TimeoutMs)
    || ArgOptions.TimeoutMs < MIN_TIMEOUT_MS
    || ArgOptions.TimeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`Timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`);
  }
}

/**
 * Print CLI usage.
 */
function PrintUsage() {
  console.log('Usage: npm run slack:harness:post -- --workspace NAME (--text TEXT | --text-file PATH) [options]');
  console.log('');
  console.log('Options:');
  console.log('  --workspace NAME      target workspace name (required).');
  console.log('  --text TEXT           message body to post.');
  console.log('  --text-file PATH      read message body from a local file.');
  console.log('  --channel NAME        exact target channel name. defaults to REMINDER_CHANNEL_NAME.');
  console.log('  --channel-id ID       target channel ID instead of channel name.');
  console.log('  --thread-ts TS        reply in an existing thread.');
  console.log('  --execute             actually post to Slack. default is dry-run only.');
  console.log(`  --timeout-ms N        hard timeout in ms (${DEFAULT_TIMEOUT_MS} default, ${MAX_TIMEOUT_MS} max).`);
  console.log('  --help, -h            show this help text.');
}

/**
 * Load message text from args or file and enforce a fixed harness prefix.
 * @param {{
 *   WorkspaceName: string,
 *   MessageText: string|null,
 *   MessageFilePath: string|null
 * }} ArgOptions Validated options.
 * @returns {Promise<string>}
 */
async function LoadMessageTextAsync(ArgOptions) {
  const RawText = ArgOptions.MessageFilePath
    ? await fs.readFile(path.resolve(ArgOptions.MessageFilePath), 'utf8')
    : ArgOptions.MessageText || '';

  const TrimmedText = RawText.trim();
  if(TrimmedText.length === 0)
    throw new Error('Message text must not be empty.');

  const Prefix = `[sleuth-harness:${ArgOptions.WorkspaceName}] `;
  const FinalText = `${Prefix}${TrimmedText}`;
  if(FinalText.length > MAX_MESSAGE_LENGTH)
    throw new Error(`Message is too long after the harness prefix is added. Limit is ${MAX_MESSAGE_LENGTH} characters.`);

  return FinalText;
}

/**
 * Resolve the target channel with exact-match validation.
 * @param {SlackApp} ArgSlackApp Authenticated Slack app wrapper.
 * @param {import('../src/workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace info.
 * @param {{ ChannelName: string|null, ChannelID: string|null }} ArgOptions Validated options.
 * @returns {Promise<{ ChannelID: string, ChannelName: string }>}
 */
async function ResolveTargetChannelAsync(ArgSlackApp, ArgWorkspaceInfo, ArgOptions) {
  if(ArgOptions.ChannelID) {
    const ResolvedChannelName = await ArgSlackApp.GetChannelNameAsync(ArgOptions.ChannelID);
    if(!ResolvedChannelName)
      throw new Error(`Could not resolve channel ID ${ArgOptions.ChannelID}.`);

    return {
      ChannelID: ArgOptions.ChannelID,
      ChannelName: ResolvedChannelName,
    };
  }

  const RequestedChannelName = ArgOptions.ChannelName || ArgWorkspaceInfo.REMINDER_CHANNEL_NAME;
  const ResolvedChannelID = await ArgSlackApp.GetChannelIdAsync(RequestedChannelName);
  if(!ResolvedChannelID)
    throw new Error(`Could not find channel named ${RequestedChannelName}.`);

  const ExactResolvedName = await ArgSlackApp.GetChannelNameAsync(ResolvedChannelID);
  if(ExactResolvedName !== RequestedChannelName) {
    throw new Error(
      `Channel lookup for ${RequestedChannelName} resolved to ${ExactResolvedName || 'unknown'}, refusing inexact match.`
    );
  }

  return {
    ChannelID: ResolvedChannelID,
    ChannelName: ExactResolvedName,
  };
}

/**
 * Check whether a PID appears to still be alive.
 * @param {number} ArgPid PID to check.
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
 * Acquire the global slack harness lock file.
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
      throw new Error(`Slack harness post lock is already held by pid ${ExistingPid}.`);
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
 * Execute a single dry-run or live post.
 * @param {{
 *   WorkspaceName: string,
 *   ChannelName: string|null,
 *   ChannelID: string|null,
 *   ThreadTS: string|null,
 *   MessageText: string|null,
 *   MessageFilePath: string|null,
 *   Execute: boolean,
 *   TimeoutMs: number
 * }} ArgOptions Validated options.
 * @param {{
 *   Workspaces?: typeof Workspaces,
 *   SlackAppClass?: typeof SlackApp,
 *   LoggerFactory?: (ArgName: string) => import('@slack/logger').Logger,
 *   AcquireLockAsync?: typeof AcquireLockAsync
 * }} [ArgDependencies] Test overrides.
 * @returns {Promise<{
 *   success: true,
 *   dryRun: boolean,
 *   workspace: string,
 *   channel: string,
 *   channelId: string,
 *   threadTs: string|null,
 *   messageTs: string|null,
 *   permalink: string|null
 * }>}
 */
async function RunPostHarnessAsync(ArgOptions, ArgDependencies = {}) {
  const WorkspacesModule = ArgDependencies.Workspaces || Workspaces;
  const SlackAppClass = ArgDependencies.SlackAppClass || SlackApp;
  const LoggerFactory = ArgDependencies.LoggerFactory || ((ArgName) => new CombinedLogger(ArgName));
  const AcquireLockAsyncImpl = ArgDependencies.AcquireLockAsync || AcquireLockAsync;

  const ReleaseLockAsync = await AcquireLockAsyncImpl();
  const Logger = LoggerFactory(`slack-harness:${ArgOptions.WorkspaceName}`);
  /** @type {SlackApp|null} */
  let SlackAppInstance = null;

  try {
    const WorkspaceInfo = await WorkspacesModule.LoadWorkspaceInfoByNameAsync(ArgOptions.WorkspaceName);
    WorkspacesModule.ValidateWorkspaceInfo(WorkspaceInfo);

    const MessageText = await LoadMessageTextAsync(ArgOptions);
    SlackAppInstance = new SlackAppClass(WorkspaceInfo, Logger);
    await SlackAppInstance.ConnectOneShotAsync();

    const TargetChannel = await ResolveTargetChannelAsync(SlackAppInstance, WorkspaceInfo, ArgOptions);
    if(!ArgOptions.Execute) {
      return {
        success: true,
        dryRun: true,
        workspace: WorkspaceInfo.WORKSPACE_NAME,
        channel: TargetChannel.ChannelName,
        channelId: TargetChannel.ChannelID,
        threadTs: ArgOptions.ThreadTS || null,
        messageTs: null,
        permalink: null,
      };
    }

    const MessageTS = await SlackAppInstance.PostMessageTextAsync(
      TargetChannel.ChannelID,
      ArgOptions.ThreadTS || null,
      MessageText
    );
    const Permalink = MessageTS ? await SlackAppInstance.GetPermaLinkAsync(TargetChannel.ChannelID, MessageTS) : null;

    return {
      success: true,
      dryRun: false,
      workspace: WorkspaceInfo.WORKSPACE_NAME,
      channel: TargetChannel.ChannelName,
      channelId: TargetChannel.ChannelID,
      threadTs: ArgOptions.ThreadTS || null,
      messageTs: MessageTS,
      permalink: Permalink,
    };
  } finally {
    if(SlackAppInstance) await SlackAppInstance.StopAsync();
    await ReleaseLockAsync();
  }
}

/**
 * Entry point for the CLI.
 * @returns {Promise<void>}
 */
async function MainAsync() {
  const Options = ParseArgs(process.argv.slice(2));
  ValidateOptions(Options);

  if(Options.HelpRequested) {
    PrintUsage();
    return;
  }

  const TimeoutID = setTimeout(() => {
    console.error(`Slack harness post timed out after ${Options.TimeoutMs} ms.`);
    process.exit(1);
  }, Options.TimeoutMs);
  TimeoutID.unref();

  try {
    const Result = await RunPostHarnessAsync(Options);
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
  LoadMessageTextAsync,
  ResolveTargetChannelAsync,
  RunPostHarnessAsync,
};
