
// load repo-root .env before New Relic reads process.env.
require('./load-env-file').LoadEnvFile();

// setup New Relic monitoring first (see newrelic.js in project root for configuration).
require('newrelic');

// import required modules.
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const workspaces = require('./workspaces');
const WebAPI = require('./web-api');
const StatsModule = require('./stats-module');
const SlackApp = require('./slack-app');
const ChatModule = require('./chat-module');
const RemindersModule = require('./reminders-module');
const ListsModule = require('./lists-module');
const NotionModule = require('./notion-module');
const GitHubSyncModule = require('./github-sync-module');
const SettingsModule = require('./settings-module');
const SnapshotRelayModule = require('./snapshot-relay-module');
const CodeTaskRelayModule = require('./code-task-relay-module');
const CombinedLogger = require('./combined-logger');
const AdminAuth = require('./admin-auth');
const AdminMailer = require('./admin-mailer');
const PluginLoader = require('./plugin-loader');
const {
  ShouldPostStartupMessage,
  ShouldIncludeStartupChangelog,
  BuildStartupChangelogExcerpt,
} = require('./startup-message');
const {
  DEFAULT_TIMEOUT_MS: STARTUP_GITHUB_ACTIONS_TIMEOUT_MS,
  FOLLOW_UP_DELAY_MS: STARTUP_GITHUB_ACTIONS_DELAY_MS,
  ScheduleStartupGitHubActionsSummaryFollowUp,
} = require('./github-actions-startup-summary');

/**
 * Gets the current git branch name.
 * @returns {string} Current branch name or 'unknown' if detection fails.
 */
function GetCurrentGitBranch() {
  try {
    // try git rev-parse method first (most reliable).
    const Branch = execSync('git rev-parse --abbrev-ref HEAD', { 
      encoding: 'utf-8', 
      cwd: __dirname,
      timeout: 5000 
    }).trim();
    
    return Branch;
  } catch(error) {
    try {
      // fallback to reading .git/HEAD file.
      const GitHeadPath = path.join(__dirname, '..', '.git', 'HEAD');
      const HeadContent = require('fs').readFileSync(GitHeadPath, 'utf-8').trim();
      
      if(HeadContent.startsWith('ref: refs/heads/')) {
        return HeadContent.replace('ref: refs/heads/', '');
      }
      
      return 'detached';
    } catch(fallbackError) {
      return 'unknown';
    }
  }
}

/**
 * Get the web api port number from environment variables.
 * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
 * @returns {number}
 */
function GetWebApiPortNumber(ArgLogger) {
  const RawPort = process.env.WEB_API_PORT;
  if(typeof RawPort !== 'string' || RawPort.trim().length === 0)
    return 2020;

  const ParsedPort = Number.parseInt(RawPort, 10);
  if(Number.isInteger(ParsedPort) && ParsedPort > 0)
    return ParsedPort;

  ArgLogger.warn(`invalid WEB_API_PORT "${RawPort}". falling back to 2020.`);
  return 2020;
}

/**
 * Get the web api bearer token from environment variables.
 * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
 * @returns {string}
 */
function GetWebApiBearerToken(ArgLogger) {
  const RawToken = process.env.WEB_API_BEARER_TOKEN;
  if(typeof RawToken === 'string' && RawToken.trim().length > 0)
    return RawToken.trim();

  // Behaviour deliberately unchanged (see below) — only the warning is louder.
  //
  // This fallback means an unconfigured deployment exposes the Web API behind the literal
  // bearer token "test". That API creates workspaces and accepts Slack and AI provider
  // credentials, so on any reachable host this is a full credential-injection path.
  // Removing the fallback is a breaking change for existing deployments that rely on it,
  // so it is tracked separately rather than altered during the public-release sanitization.
  ArgLogger.warn('*** SECURITY: WEB_API_BEARER_TOKEN is not set. ***');
  ArgLogger.warn('*** Falling back to the legacy development token "test". ***');
  ArgLogger.warn('*** The Web API creates workspaces and accepts credentials. Do NOT expose ***');
  ArgLogger.warn('*** this port until you set WEB_API_BEARER_TOKEN to a long random value.  ***');
  return 'test';
}

/**
 * Posts startup notification to Slack channels.
 * @param {SlackApp[]} ArgSlackApps Array of SlackApp instances.
 * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
 * @returns {Promise<void>}
 */
async function PostStartupNotificationAsync(ArgSlackApps, ArgLogger) {
  try {
    // get version from package.json.
    const PackageJsonPath = path.join(__dirname, '..', 'package.json');
    const PackageJson = JSON.parse(await fs.readFile(PackageJsonPath, 'utf-8'));
    const Version = PackageJson.version;

    // get current git branch.
    const CurrentBranch = GetCurrentGitBranch();


    // Compact startup is the default: the changelog excerpt is now opt-in per workspace via
    // STARTUP_MESSAGE_INCLUDE_CHANGELOG. Skip the CHANGELOG.md file read entirely when no
    // workspace has opted in — saves an I/O call on every startup for the common case.
    const STARTUP_CHANGELOG_WORD_BUDGET = 50;
    const AnyWorkspaceWantsChangelog = ArgSlackApps.some(
      (ArgInstance) => ShouldIncludeStartupChangelog(ArgInstance.WorkspaceInfo)
    );
    let ChangelogSnippet = '';
    if(AnyWorkspaceWantsChangelog) {
      try {
        const ChangelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
        const ChangelogContent = await fs.readFile(ChangelogPath, 'utf-8');
        // Word-budget cut + horizontal ellipsis so a sliced excerpt does not read like a bug
        // (the 1.4.144 entry under the old 300-char cut ended "...spread last so a calle").
        // Goes through the shared changelog-parser extraction (same one the `changelog` command
        // and the tone validator use) so the top-of-file authoring note can never leak in here.
        ChangelogSnippet = BuildStartupChangelogExcerpt(ChangelogContent, STARTUP_CHANGELOG_WORD_BUDGET);
      } catch(error) {
        ArgLogger.warn('failed to read changelog:', error.message);
      }
    }

    // post to each workspace's reminder channel.
    for(const SlackAppInstance of ArgSlackApps) {
      if(!ShouldPostStartupMessage(SlackAppInstance.WorkspaceInfo)) continue;

      const IncludeChangelog = ShouldIncludeStartupChangelog(SlackAppInstance.WorkspaceInfo);
      const StartupMessageParts = [
        `Sleuth has been updated to ${Version} from the ${CurrentBranch} branch`,
        IncludeChangelog ? ChangelogSnippet : '',
      ].filter(Boolean);
      const StartupMessage = StartupMessageParts.join('\n');

      try {
        const ReminderChannelName = SlackAppInstance.WorkspaceInfo.REMINDER_CHANNEL_NAME;
        const ReminderChannelID = await SlackAppInstance.GetChannelIdAsync(ReminderChannelName);

        if(ReminderChannelID) {
          await SlackAppInstance.PostMessageTextAsync(ReminderChannelID, null, StartupMessage, undefined, { Tag: 'startup' });
          // The GitHub Actions follow-up is gated by the same opt-in as the changelog excerpt
          // (STARTUP_MESSAGE_INCLUDE_CHANGELOG). Workspaces that want the compact startup post
          // also get the compact follow-up: nothing. GITHUB_ACTIONS_REPO alone is no longer
          // sufficient to trigger the CI status post.
          if(IncludeChangelog) {
            ScheduleStartupGitHubActionsSummaryFollowUp(
              SlackAppInstance,
              CurrentBranch,
              ArgLogger,
              {
                DelayMs: STARTUP_GITHUB_ACTIONS_DELAY_MS,
                TimeoutMs: STARTUP_GITHUB_ACTIONS_TIMEOUT_MS,
              }
            );
          }
          ArgLogger.info(`Posted startup notification to ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}#${ReminderChannelName} (${CurrentBranch})`);
        } else {
          ArgLogger.warn(`Could not find reminder channel ${ReminderChannelName} in workspace ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}`);
        }
      } catch(error) {
        // `not_in_channel` / `channel_not_found` are configuration conditions, not faults: the bot
        // simply hasn't been invited to the reminder channel. Log those as an actionable WARN so they
        // stop raising error alerts on every startup; keep ERROR for genuinely unexpected failures.
        const SlackErrorCode = (error && (error.data?.error || error.message)) || '';
        if(SlackErrorCode.includes('not_in_channel') || SlackErrorCode.includes('channel_not_found')) {
          ArgLogger.warn(
            `Skipped startup notification for workspace ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}: ` +
            `the bot is not in #${SlackAppInstance.WorkspaceInfo.REMINDER_CHANNEL_NAME} (${SlackErrorCode}). ` +
            'Invite the bot to that channel to enable startup notifications.'
          );
        } else {
          ArgLogger.error(`Failed to post startup notification to workspace ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}:`, error.message);
        }
      }
    }
  } catch(error) {
    ArgLogger.error('Failed to post startup notifications:', error.message);
  }
}

/**
 * Posts shutdown notification to Slack channels.
 * @param {SlackApp[]} ArgSlackApps Array of SlackApp instances.
 * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
 * @returns {Promise<void>}
 */
async function PostShutdownNotificationAsync(ArgSlackApps, ArgLogger) {
  try {
    // shutdown message string.
    const ShutdownMessage = 'Sleuth is shutting down.';

    // post to each workspace's reminder channel.
    for(const SlackAppInstance of ArgSlackApps) {
      try {
        const ReminderChannelName = SlackAppInstance.WorkspaceInfo.REMINDER_CHANNEL_NAME;
        const ReminderChannelID = await SlackAppInstance.GetChannelIdAsync(ReminderChannelName);

        if(ReminderChannelID) {
          await SlackAppInstance.PostMessageTextAsync(ReminderChannelID, null, ShutdownMessage, undefined, { Tag: 'shutdown' });
          ArgLogger.info(`Posted shutdown notification to ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}#${ReminderChannelName}`);
        } else {
          ArgLogger.warn(`Could not find reminder channel ${ReminderChannelName} in workspace ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}`);
        }
      } catch(error) {
        ArgLogger.error(`Failed to post shutdown notification to workspace ${SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME}:`, error.message);
      }
    }
  } catch(error) {
    ArgLogger.error('Failed to post shutdown notifications:', error.message);
  }
}

/**
 * Runs the application with all modules and web api server.
 * @returns {Promise<void>}
 */
async function RunAppAsync() {
  // define separator for logging.
  const LogSeparator = '='.repeat(80);

  // create logger instance with file logging on Mac.
  const logger = new CombinedLogger('sleuth-app');

  // get current git branch to use as environment name.
  const CurrentBranch = GetCurrentGitBranch();

  // create arrays to hold instances.
  const SlackApps = /** @type {SlackApp[]} */ ([]);
  const StatsModules = /** @type {StatsModule[]} */ ([]);
  const ChatModules = /** @type {ChatModule[]} */ ([]);
  const RemindersModules = /** @type {RemindersModule[]} */ ([]);
  const ListsModules = /** @type {ListsModule[]} */ ([]);
  const NotionModules = /** @type {NotionModule[]} */ ([]);
  const SnapshotRelayModules = /** @type {SnapshotRelayModule[]} */ ([]);
  const CodeTaskRelayModules = /** @type {CodeTaskRelayModule[]} */ ([]);
  const PluginLoaders = /** @type {PluginLoader[]} */ ([]);
  /** @type {GitHubSyncModule|null} */
  let GitHubSyncModuleInstance = null;
  const SettingsModuleInstance = new SettingsModule();
  const AdminAuthInstance = new AdminAuth();
  const AdminMailerInstance = new AdminMailer(AdminAuthInstance);
  await SettingsModuleInstance.StartAsync();

  const IsAdminAuthConfigured = await AdminAuthInstance.IsConfiguredAsync();
  if(!IsAdminAuthConfigured)
    logger.warn('admin auth not configured. run "npm run admin:setup" to initialize admin login.');

  // create map to hold workspace stats.
  const WorkspaceStatsMap = /** @type {Map<string, import('./stats-module').WorkspaceStats>} */ (new Map());

  // map of workspace name → live SlackApp, handed to the web API so the rebalance export can
  // resolve user display names and real permalinks for its pre-rendered display fields.
  const SlackAppsByWorkspace = /** @type {Map<string, import('./slack-app')>} */ (new Map());

  // make sure workspace directory exists before enumerating workspaces later below.
  const WorkspaceDirPath = workspaces.GetDirPath();
  await fs.mkdir(WorkspaceDirPath, { recursive: true });
  try {
    const TestPath = path.join(WorkspaceDirPath, `.tmp_${Date.now()}`);
    await fs.writeFile(TestPath, 'test');
    await fs.unlink(TestPath);
    logger.info('workspace directory writable.');
  } catch(error) {
    logger.warn('workspace directory not writable:', error.message);
  }

  // enumerate workspace names and load each workspace.
  for(const WorkspaceName of await workspaces.EnumerateWorkspaceNamesAsync()) {
    logger.info('loading workspace:', WorkspaceName);

    // load workspace info and validate configuration.
    let WorkspaceInfo;
    try {
      WorkspaceInfo = await workspaces.LoadWorkspaceInfoByNameAsync(WorkspaceName);
      logger.info(`workspace configuration validated: ${WorkspaceName}`);
    } catch(error) {
      logger.error(`workspace configuration invalid for ${WorkspaceName}, skipping:`, error.message);
      continue;
    }

    const SlackAppInstance = new SlackApp(WorkspaceInfo, logger);

    // create and initialize stats module first since other modules depend on its stats object.
    const StatsModuleInstance = new StatsModule(SlackAppInstance);
    await StatsModuleInstance.StartAsync();

    // add stats to map once module instances are created; removed again if startup fails below.
    WorkspaceStatsMap.set(WorkspaceName, StatsModuleInstance.Stats);
    SlackAppsByWorkspace.set(WorkspaceName, SlackAppInstance);

    // create remaining module instances with initialized stats. NOTE: reminders module should be created before the
    // chat module so reminder-related commands like "show all reminders" are not processed by the chat module which
    // does not know about reminders (see PR #36).
    const ListsModuleInstance = new ListsModule(SlackAppInstance, CurrentBranch);
    const RemindersModuleInstance = new RemindersModule(SlackAppInstance);
    const NotionModuleInstance = new NotionModule(SlackAppInstance);

    // plugins register their mention handlers here, before ChatModule's constructor, so plugin
    // commands are checked before ChatModule's catch-all handler which always returns true.
    const PluginLoaderInstance = new PluginLoader(SlackAppInstance, WorkspaceInfo);
    await PluginLoaderInstance.StartAsync();

    const ChatModuleInstance = new ChatModule(
      SlackAppInstance,
      StatsModuleInstance.Stats,
      RemindersModuleInstance,
      StatsModuleInstance,
      NotionModuleInstance
    );

    // connect ListsModule to RemindersModule (bidirectional).
    RemindersModuleInstance.SetListsModule(ListsModuleInstance);
    ListsModuleInstance.SetRemindersModule(RemindersModuleInstance);

    // run connectivity test against the provider that owns the workspace's default
    // model — claude-* defaults probe Anthropic, gemini-* defaults probe Gemini, gpt-* defaults probe OpenAI.
    const AiTest = await ChatModuleInstance.WorkspaceAI.TestConnectivityAsync();
    if(AiTest.ok)
      logger.info(`AI provider connectivity test succeeded for workspace ${WorkspaceName} (default model ${ChatModuleInstance.WorkspaceAI.DefaultModelName})`);
    else
      logger.error(`AI provider connectivity test failed for workspace ${WorkspaceName} (default model ${ChatModuleInstance.WorkspaceAI.DefaultModelName}): ${AiTest.error}`);

    try {
      // start remaining modules now that stats are available.
      // IMPORTANT: ChatModule must start BEFORE SlackAppInstance so per-channel model overrides are
      // loaded from disk before Slack begins delivering events.
      // IMPORTANT: RemindersModule must start BEFORE ListsModule so reminders are loaded from disk
      // before ListsModule.PopulateListFromRemindersAsync() calls GetAllReminders().
      await ChatModuleInstance.StartAsync();
      await SlackAppInstance.StartAsync(StatsModuleInstance.Stats);
      await RemindersModuleInstance.StartAsync(StatsModuleInstance.Stats);
      await ListsModuleInstance.StartAsync(StatsModuleInstance.Stats);
      await NotionModuleInstance.StartAsync();

      // snapshot relay: forwards new snapshots/*.md from a git repo to #repo-snapshots.
      // enabled gate is inside StartAsync (neochrome workspace + SNAPSHOT_RELAY_ENABLED flag).
      const SnapshotRelayInstance = new SnapshotRelayModule(SlackAppInstance, logger);
      await SnapshotRelayInstance.StartAsync();
      SnapshotRelayModules.push(SnapshotRelayInstance);

      // store instances for later cleanup only after the workspace fully started.
      SlackApps.push(SlackAppInstance);
      StatsModules.push(StatsModuleInstance);
      ChatModules.push(ChatModuleInstance);
      RemindersModules.push(RemindersModuleInstance);
      ListsModules.push(ListsModuleInstance);
      NotionModules.push(NotionModuleInstance);
      PluginLoaders.push(PluginLoaderInstance);

      // code-task relay (reverse direction): polls code-tasks/acks/ and posts Claude Code Cloud
      // session/PR links back into the originating Slack thread. Same gate as snapshot relay
      // (neochrome workspace + CODE_TASK_RELAY_ENABLED flag + PAT), checked inside StartAsync.
      const CodeTaskRelayInstance = new CodeTaskRelayModule(SlackAppInstance, logger);
      await CodeTaskRelayInstance.StartAsync();
      CodeTaskRelayModules.push(CodeTaskRelayInstance);

      logger.info('workspace modules started:', SlackAppInstance.WorkspaceInfo.WORKSPACE_NAME);
      logger.info(LogSeparator);
    } catch(error) {
      logger.error(`failed to start workspace ${WorkspaceName}, skipping:`, error.message);
      WorkspaceStatsMap.delete(WorkspaceName);
      SlackAppsByWorkspace.delete(WorkspaceName);
      try { await ChatModuleInstance.StopAsync(); } catch { /* best-effort cleanup */ }
      try { await SlackAppInstance.StopAsync(); } catch { /* best-effort cleanup */ }
      continue;
    }
  }

  // post startup notification to all workspaces.
  await PostStartupNotificationAsync(SlackApps, logger);

  // start GitHub sync after all workspace reminder modules are initialized.
  GitHubSyncModuleInstance = new GitHubSyncModule(RemindersModules, logger);
  for(const CurrentRemindersModule of RemindersModules)
    CurrentRemindersModule.SetGitHubSyncModule(GitHubSyncModuleInstance);
  await GitHubSyncModuleInstance.StartAsync();
  logger.info('github sync module started');

  // create and start web api server with workspace stats map.
  const WebApiPortNumber = GetWebApiPortNumber(logger);
  const WebApiBearerToken = GetWebApiBearerToken(logger);
  const ApiServer = new WebAPI(
    WebApiPortNumber,
    WebApiBearerToken,
    WorkspaceStatsMap,
    SettingsModuleInstance,
    AdminAuthInstance,
    AdminMailerInstance,
    SlackAppsByWorkspace
  );
  await ApiServer.StartAsync();
  logger.info('web api server started on port:', ApiServer.PortNumber);

  // stop everything on interrupt signal.
  let isShuttingDown = false;
  process.on('SIGINT', async () => {
    // prevent multiple shutdown attempts.
    if(isShuttingDown) {
      logger.info('shutdown already in progress...');
      return;
    }
    isShuttingDown = true;

    // create a timeout to force exit if shutdown takes too long.
    const forceExitTimeout = setTimeout(() => {
      logger.error('shutdown timeout - forcing exit');
      process.exit(1);
    }, 10000); // 10 second timeout

    try {
      await PostShutdownNotificationAsync(SlackApps, logger);
      logger.info(LogSeparator);
      logger.info('shutting down...');

      // stop web api server.
      try {
        await ApiServer.StopAsync();
        logger.info('web api server stopped');
      } catch(error) {
        logger.error('error stopping web api server:', error.message);
      }

      // stop global GitHub sync before workspace modules.
      try {
        if(GitHubSyncModuleInstance) {
          await GitHubSyncModuleInstance.StopAsync();
          logger.info('github sync module stopped');
        }
      } catch(error) {
        logger.error('error stopping github sync module:', error.message);
      }

      // stop all workspace instances in reverse order of dependencies.
      for(let n = 0; n < SlackApps.length; n++) {
        logger.info('stopping modules for workspace:', SlackApps[n].WorkspaceInfo.WORKSPACE_NAME);

        try {
          await PluginLoaders[n]?.StopAsync();
          await ChatModules[n].StopAsync();
          await RemindersModules[n].StopAsync();
          await ListsModules[n].StopAsync();
          await SnapshotRelayModules[n]?.StopAsync();
          await CodeTaskRelayModules[n]?.StopAsync();
          await StatsModules[n].StopAsync();
          await SlackApps[n].StopAsync();
        } catch(error) {
          logger.error('error stopping workspace modules:', error.message);
        }

        logger.info(LogSeparator);
      }

      // clear the timeout and exit gracefully.
      clearTimeout(forceExitTimeout);
      logger.info('shutdown complete');

      // if a Slack restart command triggered this shutdown, touch a watched file so nodemon
      // detects a change and restarts the process. nodemon restarts on file changes, not exit codes.
      if(process.env.SLEUTH_RESTART_REQUESTED === '1') {
        try {
          const TriggerPath = path.join(__dirname, '.restart-trigger.json');
          await fs.writeFile(TriggerPath, JSON.stringify({ restartedAt: new Date().toISOString() }));
        } catch(error) {
          logger.warn('could not write nodemon restart trigger file:', error.message);
        }
      }

      process.exit(0);
    } catch(error) {
      logger.error('error during shutdown:', error);
      clearTimeout(forceExitTimeout);
      process.exit(1);
    }
  });
}

// run app.
(async () => await RunAppAsync())();
