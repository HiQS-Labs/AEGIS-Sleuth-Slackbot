'use strict';

const { ExtractRecentVersionBlocks } = require('./changelog-parser');
const SlackFormatUtils = require('./slack-format-utils');

/**
 * Pure decision helpers for the startup Slack notification.
 *
 * Kept separate from `src/app.js` so they can be unit-tested without booting the full process
 * (app.js has top-level `require('newrelic')` and an IIFE that calls RunAppAsync). Layered:
 *
 *   - IsTruthyFlag            — string → bool; accepts 'true' / 'yes' (case- and whitespace-tolerant)
 *   - ShouldPostStartupMessage — gates the entire startup post on STARTUP_MESSAGE
 *   - ShouldIncludeStartupChangelog — gates the changelog excerpt body on the new opt-in field,
 *                                     subordinate to ShouldPostStartupMessage
 *   - BuildStartupChangelogExcerpt — turns raw CHANGELOG.md content into the excerpt text, via the
 *                                    shared ExtractRecentVersionBlocks so the authoring note above
 *                                    the first `## ` heading can never leak into the posted message
 *
 * Subordination matters: if a workspace opts into the changelog but not into startup posts at all,
 * we still post nothing. That keeps the two-flag model intuitive — the inner flag never overrides
 * the outer one.
 */

/**
 * Returns true if ArgValue is the string "true" or "yes" (case- and whitespace-insensitive).
 * Matches the existing STARTUP_MESSAGE convention used elsewhere in the codebase.
 *
 * @param {unknown} ArgValue
 * @returns {boolean}
 */
function IsTruthyFlag(ArgValue) {
  if(ArgValue === null || ArgValue === undefined) return false;
  const Normalized = String(ArgValue).toLowerCase().trim();
  return Normalized === 'true' || Normalized === 'yes';
}

/**
 * Whether the workspace has opted into ANY startup Slack post. Compact "Sleuth has been updated
 * to X from the Y branch" is the default body when this is on.
 *
 * @param {any} ArgWorkspaceInfo
 * @returns {boolean}
 */
function ShouldPostStartupMessage(ArgWorkspaceInfo) {
  return IsTruthyFlag(ArgWorkspaceInfo?.STARTUP_MESSAGE);
}

/**
 * Whether the workspace has opted into the VERBOSE startup body. Despite the function name
 * (kept for compatibility with the STARTUP_MESSAGE_INCLUDE_CHANGELOG workspace field), this
 * gates BOTH verbose extras:
 *   - the changelog excerpt appended to the deploy notice
 *   - the delayed GitHub Actions CI run summary follow-up (when GITHUB_ACTIONS_REPO is also set)
 *
 * Subordinate to ShouldPostStartupMessage — if the outer STARTUP_MESSAGE flag is off, this
 * returns false even when the inner flag is on. Sleuth never posts a verbose extra without
 * the deploy header above it.
 *
 * @param {any} ArgWorkspaceInfo
 * @returns {boolean}
 */
function ShouldIncludeStartupChangelog(ArgWorkspaceInfo) {
  if(!ShouldPostStartupMessage(ArgWorkspaceInfo)) return false;
  return IsTruthyFlag(ArgWorkspaceInfo?.STARTUP_MESSAGE_INCLUDE_CHANGELOG);
}

/**
 * Build the changelog excerpt for the startup message: extracts only the newest version block
 * (never the top-of-file authoring note, which lives above the first `## ` heading) and truncates
 * it to a word budget so a long entry can't blow out the compact startup post.
 *
 * @param {string} ArgChangelogContent Raw CHANGELOG.md text.
 * @param {number} ArgWordBudget Maximum words to keep from the newest block.
 * @returns {string} The excerpt, normalized for Slack markdown. Empty string if no version block exists.
 */
function BuildStartupChangelogExcerpt(ArgChangelogContent, ArgWordBudget) {
  const { Text, Count } = ExtractRecentVersionBlocks(ArgChangelogContent, 1);
  if(Count === 0) return '';
  const Truncated = SlackFormatUtils.TruncateToWords(Text, ArgWordBudget);
  return SlackFormatUtils.NormalizeModelMarkdownForSlack(Truncated, { HeadingStyle: 'plain-bold' });
}

module.exports = {
  IsTruthyFlag,
  ShouldPostStartupMessage,
  ShouldIncludeStartupChangelog,
  BuildStartupChangelogExcerpt,
};
