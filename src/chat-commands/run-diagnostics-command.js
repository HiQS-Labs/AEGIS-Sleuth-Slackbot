'use strict';

const { BuildDiagnosticsCommandReportAsync } = require('../diagnostics-report');

/**
 * Handle the `run-diagnostics` admin command — checks workspace config, Slack connectivity,
 * filesystem access for runtime data dirs, in-memory data load state, AI provider
 * connectivity (OpenAI, Anthropic, Gemini, Notion when configured), and the end-to-end thread-memory pipeline,
 * and posts the unified baseline and extended report.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {{
 *   WorkspaceAI: import('../workspace-ai'),
 *   StatsModule: import('../stats-module')|null,
 *   RemindersModule: import('../reminders-module')|null,
 *   NotionModule: import('../notion-module')|null,
 * }} ArgDeps Module references.
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

  const ReportText = await BuildDiagnosticsCommandReportAsync(
    ArgSlackApp,
    ArgEventInfo.channel,
    ArgDeps
  );

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    ReportText
  );
}

module.exports = HandleRunDiagnosticsCommandAsync;
