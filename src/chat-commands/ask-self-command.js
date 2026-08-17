const SlackFormatUtils = require('../slack-format-utils');

/**
 * Handle the `ask-self <query>` command — runs Sleuth's local RAG pipeline against its own
 * corpus and posts the answer.
 *
 * Tenancy-gated: only available in the Neochrome workspace identified by the
 * NEOCHROME_TEAM_ID environment variable. For every other tenant this is a silent no-op so
 * the command is effectively invisible. The RAG module is lazy-loaded so a broken install
 * can never poison Sleuth startup for other workspaces.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgQuery The user's question, with the `ask-self ` prefix stripped.
 * @returns {Promise<void>}
 */
async function HandleAskSelfCommandAsync(ArgSlackApp, ArgEventInfo, ArgQuery) {
  // tenancy gate — silent no-op for any workspace that is not Neochrome.
  // if NEOCHROME_TEAM_ID is unset, ask-self is inert everywhere (fail-closed).
  // we log (server-side only) so operators can diagnose "ask-self isn't replying"
  // without exposing the gate's existence to users in non-allowed workspaces.
  const AllowedTeamId = process.env.NEOCHROME_TEAM_ID;
  if(!AllowedTeamId || ArgSlackApp.TeamId !== AllowedTeamId) {
    ArgSlackApp.Logger.warn(
      `ask-self: tenancy gate blocked invocation (NEOCHROME_TEAM_ID set: ${!!AllowedTeamId}, ` +
      `workspace TeamId: ${ArgSlackApp.TeamId || 'null'}). React with :wrench: on the message for full diagnostics.`
    );
    return;
  }

  // lazy-require so a bad rag module load never affects startup for other tenants.
  let RagModule;
  try {
    RagModule = require('../rag');
  } catch (err) {
    ArgSlackApp.Logger.error('ask-self: failed to load RAG module:', err);
    return;
  }

  try {
    const AnswerText = await RagModule.askSelf(ArgQuery, ArgSlackApp.TeamId);
    // Normalize standard markdown (##, **, etc.) to Slack mrkdwn so the
    // response renders as formatted text instead of literal asterisks.
    const FormattedAnswer = SlackFormatUtils.NormalizeModelMarkdownForSlack(AnswerText);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FormattedAnswer);
  } catch (err) {
    // TenancyError → silent (defensive second layer, should never fire if the
    // handler-level gate above is correct). Anything else → log and post a
    // generic failure message so the user knows something broke.
    if(err && err.name === 'TenancyError') return;
    ArgSlackApp.Logger.error('ask-self failed:', err);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't complete that lookup. Check the logs."
    );
  }
}

module.exports = HandleAskSelfCommandAsync;
