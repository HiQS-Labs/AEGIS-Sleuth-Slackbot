'use strict';

const fs = require('fs').promises;
const path = require('path');
const CombinedLogger = require('../src/combined-logger');
const SlackApp = require('../src/slack-app');
const Workspaces = require('../src/workspaces');
const StatsModule = require('../src/stats-module');
const RemindersModule = require('../src/reminders-module');
const NotionModule = require('../src/notion-module');
const ChatModule = require('../src/chat-module');
const { ResolveTargetChannelAsync } = require('./slack-harness-post');

const DEFAULT_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const MAX_QUESTION_LENGTH = 1200;
const MAX_CONTEXT_MEMORY_FILE_SIZE_BYTES = 200 * 1024;
const VALID_CHANNEL_NAME_REGEX = /^[a-z0-9._-]+$/;
const VALID_CHANNEL_ID_REGEX = /^[CGD][A-Z0-9]+$/;
const VALID_THREAD_TS_REGEX = /^\d+\.\d+$/;
const LOCK_STALE_MS = 300000;
const LOOKUP_ATTEMPTS = 5;
const LOOKUP_WAIT_MS = 1000;
const LOCK_FILE_PATH = path.resolve(
  path.join(__dirname, '..', 'data', 'runtime', 'locks', 'slack-harness-file-upload.lock')
);

/**
 * @typedef {{
 *   WorkspaceName: string|null,
 *   ChannelName: string|null,
 *   ChannelID: string|null,
 *   ThreadTS: string|null,
 *   UploadFilePath: string|null,
 *   QuestionText: string|null,
 *   QuestionFilePath: string|null,
 *   Execute: boolean,
 *   HelpRequested: boolean,
 *   TimeoutMs: number
 * }} FileUploadHarnessOptions
 */

/**
 * @typedef {{
 *   SlackAppInstance: SlackApp,
 *   StatsModuleInstance: import('../src/stats-module'),
 *   RemindersModuleInstance: import('../src/reminders-module'),
 *   NotionModuleInstance: import('../src/notion-module'),
 *   ChatModuleInstance: import('../src/chat-module'),
 *   CleanupAsync: () => Promise<void>
 * }} FileUploadHarnessRuntime
 */

/**
 * Parse CLI arguments.
 * @param {string[]} ArgArgv Raw argv slice.
 * @returns {FileUploadHarnessOptions}
 */
function ParseArgs(ArgArgv) {
  /** @type {FileUploadHarnessOptions} */
  const Options = {
    WorkspaceName: null,
    ChannelName: null,
    ChannelID: null,
    ThreadTS: null,
    UploadFilePath: null,
    QuestionText: null,
    QuestionFilePath: null,
    Execute: false,
    HelpRequested: false,
    TimeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for(let Index = 0; Index < ArgArgv.length; Index++) {
    const CurrentArg = ArgArgv[Index];

    if(CurrentArg === '--workspace') {
      Options.WorkspaceName = ArgArgv[++Index] || null;
      if(!Options.WorkspaceName) throw new Error('Missing workspace name after --workspace.');
      continue;
    }

    if(CurrentArg === '--channel') {
      Options.ChannelName = ArgArgv[++Index] || null;
      if(!Options.ChannelName) throw new Error('Missing channel name after --channel.');
      continue;
    }

    if(CurrentArg === '--channel-id') {
      Options.ChannelID = ArgArgv[++Index] || null;
      if(!Options.ChannelID) throw new Error('Missing channel ID after --channel-id.');
      continue;
    }

    if(CurrentArg === '--thread-ts') {
      Options.ThreadTS = ArgArgv[++Index] || null;
      if(!Options.ThreadTS) throw new Error('Missing thread timestamp after --thread-ts.');
      continue;
    }

    if(CurrentArg === '--upload-file') {
      Options.UploadFilePath = ArgArgv[++Index] || null;
      if(!Options.UploadFilePath) throw new Error('Missing file path after --upload-file.');
      continue;
    }

    if(CurrentArg === '--question') {
      Options.QuestionText = ArgArgv[++Index] || null;
      if(Options.QuestionText === null) throw new Error('Missing text after --question.');
      continue;
    }

    if(CurrentArg === '--question-file') {
      Options.QuestionFilePath = ArgArgv[++Index] || null;
      if(!Options.QuestionFilePath) throw new Error('Missing file path after --question-file.');
      continue;
    }

    if(CurrentArg === '--execute') {
      Options.Execute = true;
      continue;
    }

    if(CurrentArg === '--timeout-ms') {
      const TimeoutText = ArgArgv[++Index] || null;
      if(!TimeoutText) throw new Error('Missing timeout value after --timeout-ms.');
      Options.TimeoutMs = Number.parseInt(TimeoutText, 10);
      if(!Number.isFinite(Options.TimeoutMs))
        throw new Error('Timeout must be an integer number of milliseconds.');
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
 * Validate normalized options.
 * @param {FileUploadHarnessOptions} ArgOptions Parsed options.
 */
function ValidateOptions(ArgOptions) {
  if(ArgOptions.HelpRequested) return;

  if(typeof ArgOptions.WorkspaceName !== 'string' || ArgOptions.WorkspaceName.trim().length === 0)
    throw new Error('Argument --workspace is required.');

  if(typeof ArgOptions.UploadFilePath !== 'string' || ArgOptions.UploadFilePath.trim().length === 0)
    throw new Error('Argument --upload-file is required.');

  if(ArgOptions.ChannelName && ArgOptions.ChannelID)
    throw new Error('Use either --channel or --channel-id, not both.');

  if(!ArgOptions.QuestionText && !ArgOptions.QuestionFilePath)
    throw new Error('Provide exactly one of --question or --question-file.');

  if(ArgOptions.QuestionText && ArgOptions.QuestionFilePath)
    throw new Error('Provide exactly one of --question or --question-file.');

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
  console.log(
    'Usage: npm run slack:harness:file-upload -- --workspace NAME --upload-file PATH (--question TEXT | --question-file PATH) [options]'
  );
  console.log('');
  console.log('Options:');
  console.log('  --workspace NAME      target workspace name (required).');
  console.log('  --upload-file PATH    local file to upload to Slack and feed into thread context memory.');
  console.log('  --question TEXT       question to ask Sleuth alongside the uploaded file.');
  console.log('  --question-file PATH  read the question text from a local file.');
  console.log('  --channel NAME        exact target channel name. defaults to REMINDER_CHANNEL_NAME.');
  console.log('  --channel-id ID       target channel ID instead of channel name.');
  console.log('  --thread-ts TS        upload into an existing thread instead of starting a new one.');
  console.log('  --execute             actually upload the file and run the one-shot handler. default is dry-run only.');
  console.log(`  --timeout-ms N        hard timeout in ms (${DEFAULT_TIMEOUT_MS} default, ${MAX_TIMEOUT_MS} max).`);
  console.log('  --help, -h            show this help text.');
}

/**
 * Load and validate the question text.
 * @param {FileUploadHarnessOptions} ArgOptions Validated options.
 * @returns {Promise<string>}
 */
async function LoadQuestionTextAsync(ArgOptions) {
  const RawText = ArgOptions.QuestionFilePath
    ? await fs.readFile(path.resolve(ArgOptions.QuestionFilePath), 'utf8')
    : ArgOptions.QuestionText || '';

  const TrimmedText = RawText.trim();
  if(TrimmedText.length === 0)
    throw new Error('Question text must not be empty.');
  if(TrimmedText.length > MAX_QUESTION_LENGTH)
    throw new Error(`Question text exceeds the ${MAX_QUESTION_LENGTH} character limit.`);

  return TrimmedText;
}

/**
 * Normalize the local upload file path and confirm the file is readable.
 * @param {FileUploadHarnessOptions} ArgOptions Validated options.
 * @returns {Promise<{ LocalPath: string, DisplayFileName: string, SizeBytes: number }>}
 */
async function LoadUploadFileDescriptorAsync(ArgOptions) {
  const LocalPath = path.resolve(/** @type {string} */ (ArgOptions.UploadFilePath));
  const FileStat = await fs.stat(LocalPath);
  if(!FileStat.isFile())
    throw new Error(`Upload path is not a file: ${LocalPath}`);
  if(FileStat.size > MAX_CONTEXT_MEMORY_FILE_SIZE_BYTES) {
    throw new Error(
      `File ${path.basename(LocalPath)} is too large to use as context memory (max 200 KB). Please upload a smaller file.`
    );
  }

  return {
    LocalPath,
    DisplayFileName: path.basename(LocalPath),
    SizeBytes: FileStat.size,
  };
}

/**
 * Build the comment that will be attached to the Slack file upload.
 * @param {string} ArgAppMentionString Slack bot mention string.
 * @param {string} ArgQuestionText Normalized question text.
 * @returns {string}
 */
function BuildInitialComment(ArgAppMentionString, ArgQuestionText) {
  return `${ArgAppMentionString} ${ArgQuestionText}`.trim();
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
 * Acquire the global slack file-upload harness lock file.
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
      throw new Error(`Slack file-upload harness lock is already held by pid ${ExistingPid}.`);
    }

    try {
      await fs.unlink(LOCK_FILE_PATH);
    } catch(error) {
      if(error.code !== 'ENOENT') throw error;
    }
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
 * Pause for a fixed number of milliseconds.
 * @param {number} ArgDurationMS Duration in milliseconds.
 * @returns {Promise<void>}
 */
async function SleepAsync(ArgDurationMS) {
  await new Promise((ArgResolve) => setTimeout(ArgResolve, ArgDurationMS));
}

/**
 * Re-throw Slack API scope failures with actionable operator context.
 * @param {unknown} ArgError Original error value.
 * @param {string} ArgContext Short description of the failing operation.
 * @returns {never}
 */
function ThrowFormattedSlackError(ArgError, ArgContext) {
  if(
    ArgError
    && typeof ArgError === 'object'
    && 'data' in ArgError
    && typeof ArgError.data === 'object'
    && ArgError.data
    && 'error' in ArgError.data
    && ArgError.data.error === 'missing_scope'
  ) {
    const NeededScope = typeof ArgError.data.needed === 'string' ? ArgError.data.needed : 'unknown';
    const ProvidedScopes = typeof ArgError.data.provided === 'string' ? ArgError.data.provided : 'unknown';
    throw new Error(`${ArgContext}: Slack API scope "${NeededScope}" is required (token currently has: ${ProvidedScopes}).`);
  }

  throw ArgError;
}

/**
 * Start the one-shot local Sleuth runtime used by the file-upload harness.
 * @param {import('../src/workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace info.
 * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
 * @param {{
 *   SlackAppClass?: typeof SlackApp,
 *   StatsModuleClass?: typeof StatsModule,
 *   RemindersModuleClass?: typeof RemindersModule,
 *   NotionModuleClass?: typeof NotionModule,
 *   ChatModuleClass?: typeof ChatModule
 * }} [ArgDependencies] Test overrides.
 * @returns {Promise<FileUploadHarnessRuntime>}
 */
async function CreateHarnessRuntimeAsync(ArgWorkspaceInfo, ArgLogger, ArgDependencies = {}) {
  const SlackAppClass = ArgDependencies.SlackAppClass || SlackApp;
  const StatsModuleClass = ArgDependencies.StatsModuleClass || StatsModule;
  const RemindersModuleClass = ArgDependencies.RemindersModuleClass || RemindersModule;
  const NotionModuleClass = ArgDependencies.NotionModuleClass || NotionModule;
  const ChatModuleClass = ArgDependencies.ChatModuleClass || ChatModule;

  const SlackAppInstance = new SlackAppClass(ArgWorkspaceInfo, ArgLogger);
  await SlackAppInstance.ConnectOneShotAsync();

  const StatsModuleInstance = new StatsModuleClass(SlackAppInstance);
  await StatsModuleInstance.StartAsync();

  const RemindersModuleInstance = new RemindersModuleClass(SlackAppInstance);
  await RemindersModuleInstance.StartAsync(StatsModuleInstance.Stats);

  const NotionModuleInstance = new NotionModuleClass(SlackAppInstance);
  await NotionModuleInstance.StartAsync();

  const ChatModuleInstance = new ChatModuleClass(
    SlackAppInstance,
    StatsModuleInstance.Stats,
    RemindersModuleInstance,
    StatsModuleInstance,
    NotionModuleInstance
  );
  await ChatModuleInstance.StartAsync();

  return {
    SlackAppInstance,
    StatsModuleInstance,
    RemindersModuleInstance,
    NotionModuleInstance,
    ChatModuleInstance,
    CleanupAsync: async () => {
      await ChatModuleInstance.StopAsync();
      await RemindersModuleInstance.StopAsync();
      await StatsModuleInstance.StopAsync();
      await SlackAppInstance.StopAsync();
    },
  };
}

/**
 * Resolve the share message timestamps for a just-uploaded file.
 * @param {SlackApp} ArgSlackApp Authenticated Slack wrapper.
 * @param {string} ArgChannelID Channel ID where the file was shared.
 * @param {string|null} ArgRequestedThreadTS Thread root passed on the CLI, when any.
 * @param {string} ArgInitialComment Exact initial comment used during upload.
 * @param {import('../src/slack-app').UploadedSlackFileResult} ArgUploadResult Upload result.
 * @returns {Promise<{ MessageTS: string, ThreadTS: string }>}
 */
async function ResolveUploadedMessageInfoAsync(
  ArgSlackApp,
  ArgChannelID,
  ArgRequestedThreadTS,
  ArgInitialComment,
  ArgUploadResult
) {
  if(ArgUploadResult.MessageTS && ArgUploadResult.ThreadTS) {
    return {
      MessageTS: ArgUploadResult.MessageTS,
      ThreadTS: ArgUploadResult.ThreadTS,
    };
  }

  for(let Attempt = 0; Attempt < LOOKUP_ATTEMPTS; Attempt++) {
    if(ArgRequestedThreadTS || ArgUploadResult.ThreadTS) {
      const ThreadTS = ArgRequestedThreadTS || ArgUploadResult.ThreadTS;
      const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(ArgChannelID, /** @type {string} */ (ThreadTS));
      const MatchingMessage = FindUploadedShareMessage(ThreadMessages, ArgInitialComment, ArgUploadResult.File.id);
      if(MatchingMessage) {
        return {
          MessageTS: MatchingMessage.ts,
          ThreadTS: MatchingMessage.thread_ts || /** @type {string} */ (ThreadTS),
        };
      }
    } else {
      const RecentMessages = await ArgSlackApp.GetRecentChannelMessagesAsync(ArgChannelID, 10);
      const MatchingMessage = FindUploadedShareMessage(RecentMessages, ArgInitialComment, ArgUploadResult.File.id);
      if(MatchingMessage) {
        return {
          MessageTS: MatchingMessage.ts,
          ThreadTS: MatchingMessage.thread_ts || MatchingMessage.ts,
        };
      }
    }

    await SleepAsync(LOOKUP_WAIT_MS);
  }

  throw new Error('Could not determine the uploaded file-share message timestamp from Slack.');
}

/**
 * Find the exact Slack message corresponding to the uploaded file share.
 * Prefer matching on Slack file ID so repeated harness question text does not attach to an older run.
 * @param {Array<import('../src/slack-app').MessageInfo>} ArgMessages Candidate Slack messages.
 * @param {string} ArgInitialComment Exact comment text sent with the upload.
 * @param {string} ArgUploadedFileID Uploaded Slack file ID.
 * @returns {import('../src/slack-app').MessageInfo|null}
 */
function FindUploadedShareMessage(ArgMessages, ArgInitialComment, ArgUploadedFileID) {
  if(ArgUploadedFileID) {
    const FileMatch = ArgMessages.find((ArgMessage) =>
      Array.isArray(ArgMessage.files) && ArgMessage.files.some((ArgFile) => ArgFile.id === ArgUploadedFileID)
    );
    if(FileMatch) return FileMatch;
  }

  return ArgMessages.find((ArgMessage) => ArgMessage.text === ArgInitialComment) || null;
}

/**
 * Pick the most likely AI reply message from the resulting thread.
 * @param {Array<import('../src/slack-app').MessageInfo>} ArgThreadMessages Full thread messages.
 * @param {string|null} ArgBotUserID Bot user ID when known.
 * @param {string} ArgRootThreadTS Root thread timestamp.
 * @param {string} ArgUploadMessageTS Uploaded file-share message timestamp.
 * @returns {import('../src/slack-app').MessageInfo|null}
 */
function FindHarnessReplyMessage(ArgThreadMessages, ArgBotUserID, ArgRootThreadTS, ArgUploadMessageTS) {
  const SkipTimestamps = new Set([ArgRootThreadTS, ArgUploadMessageTS].filter(Boolean));
  const CandidateMessages = ArgThreadMessages.filter((ArgMessage) => !SkipTimestamps.has(ArgMessage.ts));
  if(CandidateMessages.length === 0) return null;

  if(ArgBotUserID) {
    const BotReply = [...CandidateMessages].reverse().find((ArgMessage) =>
      ArgMessage.user === ArgBotUserID || !!ArgMessage.bot_id
    );
    if(BotReply) return BotReply;
  }

  return CandidateMessages[CandidateMessages.length - 1] || null;
}

/**
 * Execute a single dry-run or live file-upload test.
 * @param {FileUploadHarnessOptions} ArgOptions Validated options.
 * @param {{
 *   Workspaces?: typeof Workspaces,
 *   LoggerFactory?: (ArgName: string) => import('@slack/logger').Logger,
 *   AcquireLockAsync?: typeof AcquireLockAsync,
 *   CreateHarnessRuntimeAsync?: typeof CreateHarnessRuntimeAsync,
 *   SlackAppClass?: typeof SlackApp,
 *   StatsModuleClass?: typeof StatsModule,
 *   RemindersModuleClass?: typeof RemindersModule,
 *   NotionModuleClass?: typeof NotionModule,
 *   ChatModuleClass?: typeof ChatModule
 * }} [ArgDependencies] Test overrides.
 * @returns {Promise<{
 *   success: true,
 *   dryRun: boolean,
 *   workspace: string,
 *   channel: string,
 *   channelId: string,
 *   threadTs: string|null,
 *   uploadMessageTs: string|null,
 *   replyTs: string|null,
 *   handled: boolean|null,
 *   uploadFileName: string,
 *   uploadFileSizeBytes: number,
 *   uploadedFile?: import('../src/slack-app').SlackFileInfo,
 *   initialComment?: string,
 *   threadPermalink?: string|null,
 *   replyPermalink?: string|null,
 *   replyText?: string|null,
 *   threadMessages?: Array<import('../src/slack-app').MessageInfo>
 * }>}
 */
async function RunFileUploadHarnessAsync(ArgOptions, ArgDependencies = {}) {
  const WorkspacesModule = ArgDependencies.Workspaces || Workspaces;
  const LoggerFactory = ArgDependencies.LoggerFactory || ((ArgName) => new CombinedLogger(ArgName));
  const AcquireLockAsyncImpl = ArgDependencies.AcquireLockAsync || AcquireLockAsync;
  const CreateHarnessRuntimeAsyncImpl = ArgDependencies.CreateHarnessRuntimeAsync || CreateHarnessRuntimeAsync;

  const ReleaseLockAsync = await AcquireLockAsyncImpl();
  /** @type {FileUploadHarnessRuntime|null} */
  let Runtime = null;
  /** @type {any} */
  let PrimaryError = null;
  /** @type {any} */
  let DeferredCleanupError = null;
  /** @type {any} */
  let Result = null;

  try {
    const WorkspaceInfo = await WorkspacesModule.LoadWorkspaceInfoByNameAsync(ArgOptions.WorkspaceName);
    WorkspacesModule.ValidateWorkspaceInfo(WorkspaceInfo);

    const UploadFileDescriptor = await LoadUploadFileDescriptorAsync(ArgOptions);
    const QuestionText = await LoadQuestionTextAsync(ArgOptions);

    const Logger = LoggerFactory(`slack-file-upload-harness:${WorkspaceInfo.WORKSPACE_NAME}`);
    Runtime = await CreateHarnessRuntimeAsyncImpl(WorkspaceInfo, Logger, ArgDependencies);

    const TargetChannel = await ResolveTargetChannelAsync(Runtime.SlackAppInstance, WorkspaceInfo, ArgOptions);

    if(!ArgOptions.Execute) {
      Result = {
        success: true,
        dryRun: true,
        workspace: WorkspaceInfo.WORKSPACE_NAME,
        channel: TargetChannel.ChannelName,
        channelId: TargetChannel.ChannelID,
        threadTs: ArgOptions.ThreadTS || null,
        uploadMessageTs: null,
        replyTs: null,
        handled: null,
        uploadFileName: UploadFileDescriptor.DisplayFileName,
        uploadFileSizeBytes: UploadFileDescriptor.SizeBytes,
      };
      return Result;
    }

    const InitialComment = BuildInitialComment(Runtime.SlackAppInstance.AppMentionString, QuestionText);
    let UploadResult;
    try {
      UploadResult = await Runtime.SlackAppInstance.UploadFileAsync(
        TargetChannel.ChannelID,
        ArgOptions.ThreadTS || null,
        UploadFileDescriptor.LocalPath,
        InitialComment,
        UploadFileDescriptor.DisplayFileName
      );
    } catch(error) {
      ThrowFormattedSlackError(error, 'Slack file upload failed');
    }

    const UploadMessageInfo = await ResolveUploadedMessageInfoAsync(
      Runtime.SlackAppInstance,
      TargetChannel.ChannelID,
      ArgOptions.ThreadTS || null,
      InitialComment,
      UploadResult
    );

    const Handled = await Runtime.SlackAppInstance.SimulateAppMentionAsync({
      channel: TargetChannel.ChannelID,
      text: InitialComment,
      ts: UploadMessageInfo.MessageTS,
      thread_ts: ArgOptions.ThreadTS || undefined,
      user: 'U_SLEUTH_FILE_HARNESS',
      files: [UploadResult.File],
    });

    const ThreadMessages = await Runtime.SlackAppInstance.GetConversationMessagesAsync(
      TargetChannel.ChannelID,
      UploadMessageInfo.ThreadTS
    );
    const ReplyMessage = FindHarnessReplyMessage(
      ThreadMessages,
      Runtime.SlackAppInstance.BotUserID,
      UploadMessageInfo.ThreadTS,
      UploadMessageInfo.MessageTS
    );

    Result = {
      success: true,
      dryRun: false,
      workspace: WorkspaceInfo.WORKSPACE_NAME,
      channel: TargetChannel.ChannelName,
      channelId: TargetChannel.ChannelID,
      threadTs: UploadMessageInfo.ThreadTS,
      uploadMessageTs: UploadMessageInfo.MessageTS,
      replyTs: ReplyMessage?.ts || null,
      handled: Handled,
      uploadFileName: UploadFileDescriptor.DisplayFileName,
      uploadFileSizeBytes: UploadFileDescriptor.SizeBytes,
      uploadedFile: UploadResult.File,
      initialComment: InitialComment,
      threadPermalink: await Runtime.SlackAppInstance.GetPermaLinkAsync(
        TargetChannel.ChannelID,
        UploadMessageInfo.ThreadTS
      ),
      replyPermalink: ReplyMessage
        ? await Runtime.SlackAppInstance.GetPermaLinkAsync(TargetChannel.ChannelID, ReplyMessage.ts)
        : null,
      replyText: ReplyMessage?.text || null,
      threadMessages: ThreadMessages,
    };
    return Result;
  } catch(error) {
    PrimaryError = error;
  } finally {
    if(Runtime) {
      try {
        await Runtime.CleanupAsync();
      } catch(error) {
        if(!PrimaryError && !DeferredCleanupError) DeferredCleanupError = error;
      }
    }

    try {
      await ReleaseLockAsync();
    } catch(error) {
      if(!PrimaryError && !DeferredCleanupError) DeferredCleanupError = error;
    }
  }

  if(PrimaryError) throw PrimaryError;
  if(DeferredCleanupError) throw DeferredCleanupError;
  return Result;
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
    console.error(`Slack file-upload harness timed out after ${Options.TimeoutMs} ms.`);
    process.exit(1);
  }, Options.TimeoutMs);
  TimeoutID.unref();

  try {
    const Result = await RunFileUploadHarnessAsync(Options);
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
  LoadQuestionTextAsync,
  LoadUploadFileDescriptorAsync,
  BuildInitialComment,
  ResolveUploadedMessageInfoAsync,
  FindUploadedShareMessage,
  FindHarnessReplyMessage,
  CreateHarnessRuntimeAsync,
  RunFileUploadHarnessAsync,
};
