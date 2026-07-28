const fs = require('fs').promises;
const path = require('path');
const SlackFormatUtils = require('../slack-format-utils');
const { ExtractRecentVersionBlocks, CHANGELOG_VERSION_LIMIT } = require('../changelog-parser');

const SYSTEM_INSTRUCTIONS = [
  "You are summarizing entries from a software project's CHANGELOG.md for posting in Slack.",
  `The user input is the most recent ${CHANGELOG_VERSION_LIMIT} version blocks (or fewer if the file is shorter), each starting with a "## <version> - <date>" heading.`,
  'Produce a short, scannable Slack summary:',
  `- Start with one bold heading line: *Recent changes (last N versions)* — substitute the actual count for N.`,
  '- Then one bullet per version, leading with the version and date in bold (e.g. *1.4.101 — 2026-05-05*), then ONE concise sentence describing the change. Combine related sub-bullets into that single sentence.',
  '- Skip routine test/build noise such as "all tests pass" or "npm run build clean" unless that IS the change.',
  '- Use plain text. No markdown headings, no code fences. Backticks around command names and identifiers are fine.',
  'Keep the whole reply under 1500 characters.',
].join('\n');

/**
 * Handle the `changelog` command — reads CHANGELOG.md from the repo root, extracts the most
 * recent N version blocks (default 10), and asks WorkspaceAI for a concise Slack-friendly
 * summary. Public command: anyone in the workspace can ask for the changelog summary.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {{ WorkspaceAI: import('../workspace-ai') }} ArgDeps Dependencies injected by ChatModule.
 * @returns {Promise<void>}
 */
async function HandleChangelogCommandAsync(ArgSlackApp, ArgEventInfo, ArgDeps) {
  let RawContent;
  try {
    const TargetFilePath = path.join(__dirname, '..', '..', 'CHANGELOG.md');
    RawContent = await fs.readFile(TargetFilePath, 'utf8');
  } catch (err) {
    ArgSlackApp.Logger.error('changelog: failed to read CHANGELOG.md:', err);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Sorry, unable to load changelog content right now.'
    );
    return;
  }

  const { Text: RecentBlocks, Count } = ExtractRecentVersionBlocks(RawContent, CHANGELOG_VERSION_LIMIT);
  if(Count === 0) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'CHANGELOG.md does not contain any recognizable version entries.'
    );
    return;
  }

  try {
    const RawSummary = await ArgDeps.WorkspaceAI.ProcessMessageWithTextResponseAsync(
      RecentBlocks,
      SYSTEM_INSTRUCTIONS
    );
    const Formatted = SlackFormatUtils.NormalizeModelMarkdownForSlack(RawSummary);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Formatted);
  } catch (err) {
    ArgSlackApp.Logger.error('changelog: AI summarization failed:', err);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't summarize the changelog. Check the logs."
    );
  }
}

module.exports = HandleChangelogCommandAsync;
module.exports.ExtractRecentVersionBlocks = ExtractRecentVersionBlocks;
module.exports.CHANGELOG_VERSION_LIMIT = CHANGELOG_VERSION_LIMIT;

