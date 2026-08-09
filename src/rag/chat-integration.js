'use strict';

// PRIVATE OVERLAY — not present in the public AEGIS repo.
//
// P1-SPLIT.md:130 plans `sleuth-plugin-rag` (`src/rag/`, ask-self, ask-woo glue) as a separate
// plugin. Until that extraction happens, this file is the single seam the public `chat-module.js`
// optionally requires: if it is absent, the public tree runs clean and ask-self simply does not
// exist; if it is present, the command and its triage path light up.
//
// Everything RAG-specific lives BEHIND this boundary on purpose. `chat-module.js` should never need
// to know that a sqlite index or an embedding provider exists — its only knowledge is "this module
// may or may not be here." That is what keeps the public repo honest and the plugin extraction a
// file move rather than a re-architecture.

const SlackFormatUtils = require('../slack-format-utils');
const HandleAskSelfCommandAsync = require('../chat-commands/ask-self-command');

/**
 * Operator triage for the ask-self path, surfaced by a 🔧 reaction.
 *
 * Lives here rather than in chat-module.js because it reports on RAG internals — module load, index
 * availability, the real error from `askSelf` — and every one of those is a detail the public core
 * must not carry.
 *
 * The tenancy gate is FAIL-CLOSED: with `NEOCHROME_TEAM_ID` unset, ask-self is inert in every
 * workspace rather than open in all of them. This function deliberately reports the gate's state
 * even when it fails, because "silent no-op" and "misconfigured" look identical from Slack and an
 * operator needs to tell them apart.
 *
 * @param {any} ArgSlackApp
 * @param {string} ArgChannelID
 * @param {string} ArgMessageTS
 * @param {string} ArgReactingUserID
 * @param {string} ArgQuery
 * @returns {Promise<void>}
 */
async function PostAskSelfTriageAsync(ArgSlackApp, ArgChannelID, ArgMessageTS, ArgReactingUserID, ArgQuery) {
  const AllowedTeamId = process.env.NEOCHROME_TEAM_ID;
  const WorkspaceTeamId = ArgSlackApp.TeamId;
  const TenancyPasses = !!AllowedTeamId && WorkspaceTeamId === AllowedTeamId;

  const FeedbackLines = [
    `:wrench: Ask-self triage requested by <@${ArgReactingUserID}>.`,
    '*Tenancy gate:*',
    `• \`NEOCHROME_TEAM_ID\` configured: *${AllowedTeamId ? 'yes' : 'no'}*`,
    `• Workspace TeamId: \`${WorkspaceTeamId || '(null)'}\``,
    `• Match: *${TenancyPasses ? 'pass' : 'fail (silent no-op in normal flow)'}*`,
  ];

  if(!TenancyPasses) {
    if(!AllowedTeamId) {
      FeedbackLines.push(
        ':information_source: `NEOCHROME_TEAM_ID` is not set on this server, so ask-self is inert everywhere (fail-closed). Set the env var to the Neochrome team ID to enable.'
      );
    } else {
      FeedbackLines.push(
        ':information_source: This workspace\'s TeamId does not match the allowlist, so ask-self is silent here by design.'
      );
    }
    await ArgSlackApp.PostMessageTextAsync(ArgChannelID, ArgMessageTS, FeedbackLines.join('\n'));
    return;
  }

  // Tenancy passed — load the RAG module and run the real query, so the operator sees the actual
  // failure (missing sqlite, missing API key, network) rather than a generic apology.
  let RagModule;
  try {
    RagModule = require('./index');
    FeedbackLines.push('*RAG module load:* ok');
  } catch(error) {
    FeedbackLines.push(
      '*RAG module load:* failed',
      `• Error: ${SlackFormatUtils.SanitizeForInlineSlack(error?.message || String(error), 400)}`
    );
    ArgSlackApp.Logger.error('ask-self triage: RAG module load failed:', error);
    await ArgSlackApp.PostMessageTextAsync(ArgChannelID, ArgMessageTS, FeedbackLines.join('\n'));
    return;
  }

  FeedbackLines.push(`*Query:* "${SlackFormatUtils.SanitizeForInlineSlack(ArgQuery, 200)}"`);

  const StartTime = Date.now();
  try {
    const AnswerText = await RagModule.askSelf(ArgQuery, WorkspaceTeamId);
    const ElapsedMs = Date.now() - StartTime;
    FeedbackLines.push(
      `*RAG call:* succeeded in ${ElapsedMs}ms`,
      `• Answer length: ${AnswerText.length} chars`,
      `• Preview: ${SlackFormatUtils.SanitizeForInlineSlack(AnswerText, 400)}`
    );
  } catch(error) {
    const ElapsedMs = Date.now() - StartTime;
    FeedbackLines.push(
      `*RAG call:* failed after ${ElapsedMs}ms`,
      `• Error type: ${error?.name || 'Error'}`,
      `• Error: ${SlackFormatUtils.SanitizeForInlineSlack(error?.message || String(error), 400)}`
    );
    ArgSlackApp.Logger.error('ask-self triage: askSelf threw:', error);
  }

  await ArgSlackApp.PostMessageTextAsync(ArgChannelID, ArgMessageTS, FeedbackLines.join('\n'));
}

module.exports = { HandleAskSelfCommandAsync, PostAskSelfTriageAsync };
