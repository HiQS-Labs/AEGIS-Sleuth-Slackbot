const path = require('path');
const workspaces = require('../workspaces');
const { TestDirectoryAccessAsync } = require('../diagnostics');

/**
 * Handle the `run-diagnostics` admin command — checks workspace config, Slack connectivity,
 * filesystem access for runtime data dirs, in-memory data load state, and AI provider
 * connectivity (OpenAI, Notion when configured), and the end-to-end thread-memory Gemini pipeline,
 * then posts a one-line-per-check report.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {{
 *   WorkspaceAI: import('../workspace-ai'),
 *   StatsModule: import('../stats-module')|null,
 *   RemindersModule: import('../reminders-module')|null,
 *   NotionModule: import('../notion-module')|null,
 * }} ArgDeps Module references — null entries indicate the integration is not loaded for this
 *   workspace and the corresponding probe is skipped (Notion) or reports "FAILED - unknown error"
 *   (Stats, Reminders).
 * @returns {Promise<void>}
 */
async function HandleRunDiagnosticsCommandAsync(ArgSlackApp, ArgEventInfo, ArgDeps) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can run diagnostics.'
    );
    return;
  }

  const Results = [];

  try {
    workspaces.ValidateWorkspaceInfo(ArgSlackApp.WorkspaceInfo);
    Results.push('Workspace configuration: OK');
  } catch(error) {
    Results.push(`Workspace configuration: FAILED - ${error.message}`);
  }

  const SlackDiag = await ArgSlackApp.CheckSlackConnectivityAsync();
  if(SlackDiag.ok) Results.push('Slack API connectivity: OK');
  else Results.push(`Slack API connectivity: FAILED - ${SlackDiag.error}`);

  const WorkspaceDir = workspaces.GetDirPath();
  const StatsDir = workspaces.GetSubdirPath('stats');
  const RemindersDir = workspaces.GetSubdirPath('reminders');
  for(const info of [
    { name: 'Workspaces directory', path: WorkspaceDir },
    { name: 'Stats directory', path: StatsDir },
    { name: 'Reminders directory', path: RemindersDir },
  ]) {
    const DirDiag = await TestDirectoryAccessAsync(info.path);
    if(DirDiag.ok) Results.push(`${info.name} access: OK`);
    else Results.push(`${info.name} access: FAILED - ${DirDiag.error}`);
  }

  if(ArgDeps.StatsModule?.DataLoaded) Results.push('Stats data loaded: OK');
  else Results.push(`Stats data loaded: FAILED - ${ArgDeps.StatsModule?.DataLoadError ?? 'unknown error'}`);
  if(ArgDeps.RemindersModule?.DataLoaded) Results.push('Reminders data loaded: OK');
  else Results.push(`Reminders data loaded: FAILED - ${ArgDeps.RemindersModule?.DataLoadError ?? 'unknown error'}`);

  // probe every configured AI provider (OpenAI + Anthropic + Gemini when an API key is set) so
  // the diagnostics output reflects the multi-provider switch surface, not just the
  // default model's provider.
  const ProviderDiags = await ArgDeps.WorkspaceAI.TestProviderConnectivityAsync();
  for(const [, Info] of Object.entries(ProviderDiags)) {
    if(!Info.configured) {
      Results.push(`${Info.label} API connectivity: not configured`);
      continue;
    }
    if(Info.ok) Results.push(`${Info.label} API connectivity: OK`);
    else Results.push(`${Info.label} API connectivity: FAILED - ${Info.error}`);
  }

  if(!process.env.GOOGLE_API_KEY) {
    Results.push('Thread-memory Gemini pipeline: not configured');
  } else {
    const { TestThreadMemoryPipelineAsync } = require('../thread-memory');
    const ThreadMemoryDiag = await TestThreadMemoryPipelineAsync(ArgSlackApp.TeamId || 'unknown');
    if(ThreadMemoryDiag.ok)
      Results.push(`Thread-memory Gemini pipeline: OK${Number.isFinite(ThreadMemoryDiag.similarity) ? ` (similarity ${ThreadMemoryDiag.similarity.toFixed(3)})` : ''}`);
    else
      Results.push(`Thread-memory Gemini pipeline: FAILED - ${ThreadMemoryDiag.error || 'unknown error'}`);
  }

  if(ArgDeps.NotionModule) {
    const NotionDiag = await ArgDeps.NotionModule.TestConnectivityAsync();
    if(NotionDiag.ok) Results.push('Notion API connectivity: OK');
    else Results.push(`Notion API connectivity: FAILED - ${NotionDiag.error}`);
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    Results.join('\n')
  );
}

module.exports = HandleRunDiagnosticsCommandAsync;
