const SlackFormatUtils = require('../slack-format-utils');

/**
 * Convert a WP DB Toolkit client error into concise Slack copy. Lives with the ask-woo handler
 * because it is the only caller; no need to expose this from chat-module.
 * @param {any} ArgError Error raised by the integration client.
 * @returns {string}
 */
function BuildAskWooFailureMessage(ArgError) {
  switch(ArgError?.code) {
    case 'not-configured':
    case 'not-enabled':
      return 'sorry, this workspace is not configured for `ask-woo` yet.';
    case 'invalid-request':
      return `sorry, ${ArgError.message}.`;
    case 'auth':
      return 'sorry, the WP DB Toolkit integration is not authorized right now.';
    case 'timeout':
      return 'sorry, the WP DB Toolkit query took too long. Please try again.';
    case 'network':
      return 'sorry, I could not reach the WP DB Toolkit service right now.';
    case 'upstream':
    case 'http':
    case 'invalid-response':
    default:
      return 'sorry, the WP DB Toolkit query failed. Check the logs.';
  }
}

/**
 * Handle the `ask-woo <question>` admin command — proxies a question to the configured
 * WP DB Toolkit RAG service for the workspace.
 *
 * Admin-only, fail-closed when workspace config is missing, and lazy-loads the client so a
 * broken optional integration never affects startup.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgQuery User question with the `ask-woo` prefix stripped.
 * @returns {Promise<void>}
 */
async function HandleAskWooCommandAsync(ArgSlackApp, ArgEventInfo, ArgQuery) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can use `ask-woo`.'
    );
    return;
  }

  if(!ArgQuery) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'please provide a question after `@Sleuth AI ask-woo`.'
    );
    return;
  }

  let WpdbtkRag;
  try {
    WpdbtkRag = require('../wpdbtk-rag');
  } catch(error) {
    ArgSlackApp.Logger.error('ask-woo: failed to load WPDBTK RAG client:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, the WP DB Toolkit integration is unavailable right now.'
    );
    return;
  }

  if(!WpdbtkRag.IsWpdbtkRagEnabled(ArgSlackApp.WorkspaceInfo)) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, this workspace is not configured for `ask-woo` yet.'
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'Working on it...');

  try {
    const Result = await WpdbtkRag.AskQuestionAsync(ArgSlackApp.WorkspaceInfo, {
      question: ArgQuery,
      caller: {
        app: 'sleuth-app',
        workspace_name: ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME,
        team_id: ArgSlackApp.TeamId,
        slack_user_id: ArgEventInfo.user,
        channel_id: ArgEventInfo.channel,
        thread_ts: ArgEventInfo.thread_ts || ArgEventInfo.ts,
      },
    });

    const FormattedAnswer = SlackFormatUtils.NormalizeModelMarkdownForSlack(Result.answer);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FormattedAnswer);
  } catch(error) {
    const RequestId = error && typeof error.requestId === 'string' ? error.requestId : null;
    ArgSlackApp.Logger.error(
      `ask-woo failed for workspace ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME}` +
      `${RequestId ? ` (request ${RequestId})` : ''}:`,
      error
    );

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      BuildAskWooFailureMessage(error)
    );
  }
}

module.exports = HandleAskWooCommandAsync;
