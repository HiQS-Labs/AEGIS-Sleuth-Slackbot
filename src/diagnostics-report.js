'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const workspaces = require('./workspaces');
const diagnostics = require('./diagnostics');
const { GetProviderDescriptorForModel, GetDefaultProviderDescriptor } = require('./ai-providers');

/**
 * WeakMap cache for Slack connectivity results keyed by SlackApp instance.
 * @type {WeakMap<object, { timestamp: number, result: { ok: boolean, error?: string, user_id?: string } }>}
 */
const SlackConnectivityCache = new WeakMap();
const SLACK_CONNECTIVITY_CACHE_TTL_MS = 60000;

/**
 * Cached package version.
 * @type {string|null}
 */
let CachedVersion = null;

/**
 * Cached git branch.
 * @type {string|null}
 */
let CachedBranch = null;

/**
 * Get package version from package.json.
 * @returns {string}
 */
function GetPackageVersion() {
  if(CachedVersion !== null) return CachedVersion;
  try {
    const PackageJsonPath = path.join(__dirname, '..', 'package.json');
    const PackageJson = JSON.parse(fs.readFileSync(PackageJsonPath, 'utf8'));
    CachedVersion = typeof PackageJson.version === 'string' ? PackageJson.version : 'unknown';
  } catch(error) {
    CachedVersion = 'unknown';
  }
  return CachedVersion;
}

/**
 * Get current git branch name.
 * @returns {string}
 */
function GetGitBranch() {
  if(CachedBranch !== null) return CachedBranch;
  try {
    const Branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    CachedBranch = Branch || 'unknown';
  } catch(error) {
    CachedBranch = 'unknown';
  }
  return CachedBranch;
}

/**
 * @typedef {{
 *   Version: string,
 *   Branch: string,
 *   WorkspaceName: string,
 *   ChannelId: string,
 *   AutoSchedulingEnabled: boolean,
 *   TargetChannelName: string,
 *   IsTargetChannel: boolean,
 *   SlackConnectivity: { ok: boolean, error?: string },
 *   RuntimeDirPath: string,
 *   RuntimeDirectoryAccess: { ok: boolean, error?: string },
 *   ConfiguredProviders: string[],
 *   ActiveProviderLabel: string,
 *   ActiveModelName: string,
 * }} DiagnosticsBaselineFacts
 */

/**
 * Collect the shared 5-fact diagnostics baseline for a workspace and channel context.
 * Resilient against probe failures — individual probe errors degrade to failed facts rather than throwing.
 *
 * @param {any} ArgSlackApp Slack app instance.
 * @param {string} ArgChannelId Slack channel ID.
 * @param {{
 *   ForceFreshSlackCheck?: boolean,
 *   RemindersModule?: any,
 *   WorkspaceAI?: any,
 * }} [ArgOptions]
 * @returns {Promise<DiagnosticsBaselineFacts>}
 */
async function CollectDiagnosticsBaselineAsync(ArgSlackApp, ArgChannelId, ArgOptions = {}) {
  const Version = GetPackageVersion();
  const Branch = GetGitBranch();
  const WorkspaceName = ArgSlackApp?.WorkspaceInfo?.WORKSPACE_NAME || 'unknown';

  // Probe 2: per-channel auto-scheduling toggle and target channel
  let AutoSchedulingEnabled = false;
  try {
    const RemindersMod = ArgOptions.RemindersModule || ArgSlackApp?.RemindersModule;
    if(RemindersMod && typeof RemindersMod.AreRemindersEnabledForChannel === 'function')
      AutoSchedulingEnabled = Boolean(RemindersMod.AreRemindersEnabledForChannel(ArgChannelId));
  } catch(error) {
    AutoSchedulingEnabled = false;
  }

  const TargetChannelName = ArgSlackApp?.WorkspaceInfo?.REMINDER_CHANNEL_NAME || '(not configured)';
  let IsTargetChannel = false;
  if(typeof ArgSlackApp?.GetChannelIdAsync === 'function' && TargetChannelName && TargetChannelName !== '(not configured)') {
    try {
      const TargetChannelId = await ArgSlackApp.GetChannelIdAsync(TargetChannelName);
      IsTargetChannel = Boolean(TargetChannelId && TargetChannelId === ArgChannelId);
    } catch(error) {
      IsTargetChannel = false;
    }
  }

  // Probe 3: Slack API connectivity (cached with TTL)
  /** @type {{ ok: boolean, error?: string, user_id?: string }} */
  let SlackConnectivity = { ok: false, error: 'not checked' };
  try {
    const Cached = SlackConnectivityCache.get(ArgSlackApp);
    const Now = Date.now();
    if(!ArgOptions.ForceFreshSlackCheck && Cached && (Now - Cached.timestamp) < SLACK_CONNECTIVITY_CACHE_TTL_MS) {
      SlackConnectivity = Cached.result;
    } else if(typeof ArgSlackApp?.CheckSlackConnectivityAsync === 'function') {
      const FreshResult = await ArgSlackApp.CheckSlackConnectivityAsync();
      SlackConnectivity = FreshResult;
      SlackConnectivityCache.set(ArgSlackApp, { timestamp: Now, result: FreshResult });
    } else {
      SlackConnectivity = { ok: true };
    }
  } catch(error) {
    SlackConnectivity = { ok: false, error: /** @type {Error} */ (error).message };
  }

  // Probe 4: runtime data directory path and writability
  let RuntimeDirPath = 'unknown';
  /** @type {{ ok: boolean, error?: string }} */
  let RuntimeDirectoryAccess = { ok: false, error: 'unknown' };
  try {
    RuntimeDirPath = workspaces.GetRuntimeDirPath();
    RuntimeDirectoryAccess = await diagnostics.TestDirectoryAccessAsync(RuntimeDirPath);
  } catch(error) {
    RuntimeDirectoryAccess = { ok: false, error: /** @type {Error} */ (error).message };
  }

  // Probe 5: configured AI providers and active model
  const ConfiguredProviders = [];
  if(ArgSlackApp?.WorkspaceInfo?.OPENAI_API_KEY) ConfiguredProviders.push('OpenAI');
  if(ArgSlackApp?.WorkspaceInfo?.ANTHROPIC_API_KEY) ConfiguredProviders.push('Anthropic Claude');
  if(ArgSlackApp?.WorkspaceInfo?.GEMINI_API_KEY) ConfiguredProviders.push('Google Gemini');

  const ActiveModelName = ArgOptions.WorkspaceAI?.DefaultModelName
    || ArgSlackApp?.WorkspaceAI?.DefaultModelName
    || 'gpt-4o-mini';

  let ActiveProviderLabel = 'OpenAI';
  try {
    const Descriptor = GetProviderDescriptorForModel(ActiveModelName) || GetDefaultProviderDescriptor();
    if(Descriptor?.Label) ActiveProviderLabel = Descriptor.Label;
  } catch(error) {
    ActiveProviderLabel = 'OpenAI';
  }

  return {
    Version,
    Branch,
    WorkspaceName,
    ChannelId: ArgChannelId,
    AutoSchedulingEnabled,
    TargetChannelName,
    IsTargetChannel,
    SlackConnectivity,
    RuntimeDirPath,
    RuntimeDirectoryAccess,
    ConfiguredProviders,
    ActiveProviderLabel,
    ActiveModelName,
  };
}

/**
 * Format the 5 baseline lines for display.
 * @param {DiagnosticsBaselineFacts} ArgFacts
 * @returns {string[]}
 */
function FormatDiagnosticsBaselineLines(ArgFacts) {
  const ChannelStatus = ArgFacts.AutoSchedulingEnabled ? '*enabled*' : '*disabled*';
  const TargetSuffix = ArgFacts.IsTargetChannel ? ' _(this channel)_' : '';
  const SlackStatus = ArgFacts.SlackConnectivity.ok
    ? 'OK'
    : `FAILED - ${ArgFacts.SlackConnectivity.error || 'unknown error'}`;
  const RuntimeAccessStatus = ArgFacts.RuntimeDirectoryAccess.ok
    ? 'writable'
    : `FAILED - ${ArgFacts.RuntimeDirectoryAccess.error || 'unknown error'}`;
  const ConfiguredList = ArgFacts.ConfiguredProviders.length > 0
    ? ArgFacts.ConfiguredProviders.join(', ')
    : 'none configured';

  return [
    `• Version: ${ArgFacts.Version} (${ArgFacts.Branch}) • Workspace: ${ArgFacts.WorkspaceName}`,
    `• Auto-scheduling in this channel: ${ChannelStatus} • Target channel: #${ArgFacts.TargetChannelName}${TargetSuffix}`,
    `• Slack API connectivity: ${SlackStatus}`,
    `• Runtime data directory: \`${ArgFacts.RuntimeDirPath}\` (${RuntimeAccessStatus})`,
    `• Configured AI providers: ${ConfiguredList} (active: ${ArgFacts.ActiveProviderLabel} / \`${ArgFacts.ActiveModelName}\`)`,
  ];
}

/**
 * Build the complete report for the user-triggered `run-diagnostics` command.
 * @param {any} ArgSlackApp Slack app instance.
 * @param {string} ArgChannelId Channel where command was run.
 * @param {{
 *   WorkspaceAI: any,
 *   StatsModule: any,
 *   RemindersModule: any,
 *   NotionModule: any,
 * }} ArgDeps Module dependencies.
 * @returns {Promise<string>}
 */
async function BuildDiagnosticsCommandReportAsync(ArgSlackApp, ArgChannelId, ArgDeps) {
  const BaselineFacts = await CollectDiagnosticsBaselineAsync(ArgSlackApp, ArgChannelId, {
    ForceFreshSlackCheck: true,
    RemindersModule: ArgDeps?.RemindersModule,
    WorkspaceAI: ArgDeps?.WorkspaceAI,
  });

  const OutputLines = [
    '*Diagnostics Baseline:*',
    ...FormatDiagnosticsBaselineLines(BaselineFacts),
    '',
    '*Extended Probes:*',
  ];

  try {
    workspaces.ValidateWorkspaceInfo(ArgSlackApp.WorkspaceInfo);
    OutputLines.push('• Workspace configuration: OK');
  } catch(error) {
    OutputLines.push(`• Workspace configuration: FAILED - ${/** @type {Error} */ (error).message}`);
  }

  const StatsDir = workspaces.GetSubdirPath('stats');
  const RemindersDir = workspaces.GetSubdirPath('reminders');
  for(const Info of [
    { name: 'Stats directory', path: StatsDir },
    { name: 'Reminders directory', path: RemindersDir },
  ]) {
    const DirDiag = await diagnostics.TestDirectoryAccessAsync(Info.path);
    if(DirDiag.ok) OutputLines.push(`• ${Info.name} access: OK`);
    else OutputLines.push(`• ${Info.name} access: FAILED - ${DirDiag.error || 'unknown error'}`);
  }

  if(ArgDeps?.StatsModule?.DataLoaded) OutputLines.push('• Stats data loaded: OK');
  else OutputLines.push(`• Stats data loaded: FAILED - ${ArgDeps?.StatsModule?.DataLoadError ?? 'unknown error'}`);

  if(ArgDeps?.RemindersModule?.DataLoaded) OutputLines.push('• Reminders data loaded: OK');
  else OutputLines.push(`• Reminders data loaded: FAILED - ${ArgDeps?.RemindersModule?.DataLoadError ?? 'unknown error'}`);

  if(ArgDeps?.WorkspaceAI && typeof ArgDeps.WorkspaceAI.TestProviderConnectivityAsync === 'function') {
    const ProviderDiags = await ArgDeps.WorkspaceAI.TestProviderConnectivityAsync();
    for(const [, Info] of Object.entries(ProviderDiags)) {
      if(!Info.configured) {
        OutputLines.push(`• ${Info.label} API connectivity: not configured`);
        continue;
      }
      if(Info.ok) OutputLines.push(`• ${Info.label} API connectivity: OK`);
      else OutputLines.push(`• ${Info.label} API connectivity: FAILED - ${Info.error || 'unknown error'}`);
    }
  }

  if(!process.env.GOOGLE_API_KEY) {
    OutputLines.push('• Thread-memory Gemini pipeline: not configured');
  } else {
    try {
      const { TestThreadMemoryPipelineAsync } = require('./thread-memory');
      const ThreadMemoryDiag = await TestThreadMemoryPipelineAsync(ArgSlackApp.TeamId || 'unknown');
      if(ThreadMemoryDiag.ok)
        OutputLines.push(`• Thread-memory Gemini pipeline: OK${Number.isFinite(ThreadMemoryDiag.similarity) ? ` (similarity ${ThreadMemoryDiag.similarity.toFixed(3)})` : ''}`);
      else
        OutputLines.push(`• Thread-memory Gemini pipeline: FAILED - ${ThreadMemoryDiag.error || 'unknown error'}`);
    } catch(error) {
      OutputLines.push(`• Thread-memory Gemini pipeline: FAILED - ${/** @type {Error} */ (error).message}`);
    }
  }

  if(ArgDeps?.NotionModule) {
    try {
      const NotionDiag = await ArgDeps.NotionModule.TestConnectivityAsync();
      if(NotionDiag.ok) OutputLines.push('• Notion API connectivity: OK');
      else OutputLines.push(`• Notion API connectivity: FAILED - ${NotionDiag.error || 'unknown error'}`);
    } catch(error) {
      OutputLines.push(`• Notion API connectivity: FAILED - ${/** @type {Error} */ (error).message}`);
    }
  }

  return OutputLines.join('\n');
}

/**
 * Format a user-facing error report with summary, optional contextual lines, and the shared baseline.
 * @param {string} ArgSummaryMessage Primary one-line error description.
 * @param {DiagnosticsBaselineFacts} ArgBaselineFacts Collected baseline facts.
 * @param {string[]} [ArgContextualLines=[]] Optional context (e.g. attempted repo or model).
 * @returns {string}
 */
function FormatErrorReport(ArgSummaryMessage, ArgBaselineFacts, ArgContextualLines = []) {
  const Lines = [ArgSummaryMessage];
  if(Array.isArray(ArgContextualLines) && ArgContextualLines.length > 0)
    Lines.push(...ArgContextualLines);

  Lines.push('', '*Diagnostics:*', ...FormatDiagnosticsBaselineLines(ArgBaselineFacts));
  return Lines.join('\n');
}

/**
 * Build a user-facing error report collecting the baseline asynchronously.
 * @param {any} ArgSlackApp Slack app instance.
 * @param {string} ArgChannelId Channel where error occurred.
 * @param {string} ArgSummaryMessage Primary one-line error description.
 * @param {string[]} [ArgContextualLines=[]] Optional context lines.
 * @param {object} [ArgOptions={}] Collection options.
 * @returns {Promise<string>}
 */
async function BuildErrorReportAsync(ArgSlackApp, ArgChannelId, ArgSummaryMessage, ArgContextualLines = [], ArgOptions = {}) {
  const BaselineFacts = await CollectDiagnosticsBaselineAsync(ArgSlackApp, ArgChannelId, ArgOptions);
  return FormatErrorReport(ArgSummaryMessage, BaselineFacts, ArgContextualLines);
}

module.exports = {
  CollectDiagnosticsBaselineAsync,
  FormatDiagnosticsBaselineLines,
  BuildDiagnosticsCommandReportAsync,
  FormatErrorReport,
  BuildErrorReportAsync,
  GetPackageVersion,
  GetGitBranch,
};
