'use strict';

const SlackFormatUtils = require('./slack-format-utils');

/**
 * Aspirational unified pipeline for making raw Slack message text safe to read OUTSIDE Slack's own
 * client — GitHub issue bodies, captured thread transcripts, dashboard exports, etc.
 *
 * Slack's client resolves `<@U12345>` mention tokens to a live "@DisplayName" mention on its own;
 * nothing posted INTO Slack needs to touch this module. The moment that same raw text is copied
 * out of Slack, that client-side resolution no longer happens, and a reader sees the bare user ID
 * instead of a name (GH-428: a `:bug:`-filed GitHub issue showed `<@U08BHQEAX>` verbatim in both its
 * title and body).
 *
 * Current status (GH-429 QA pass): this is deliberately narrow — one function, resolving mentions
 * only, servicing exactly the two call sites named above. The "unified pipeline" framing is a
 * stated direction, not a claim about what's built today; do not assume other Slack-text-leaves-
 * Slack surfaces (dashboard exports, PR/issue comments, etc.) already route through this.
 * @param {import('./slack-app')|null} ArgSlackApp Live SlackApp used to resolve user IDs to names.
 * @param {string} ArgText Raw Slack mrkdwn text (may contain `<@U...>` / `<@U...|label>` mentions).
 * @param {Map<string, string>} [ArgNameCache] Optional caller-owned userId→displayName cache,
 *   shared across multiple calls (e.g. once per message in a captured thread) so each distinct user
 *   id is resolved at most once per caller-defined scope instead of once per call. Defaults to a
 *   fresh, call-scoped `Map` when omitted — safe for a single-message call site.
 * @returns {Promise<string>} Text with every mention replaced by `@DisplayName`, falling back to
 *   `@<raw id>` for any mention that fails to resolve (or when no SlackApp is available) so the
 *   external reader still sees a stable, identifiable token instead of a silently dropped mention.
 */
async function ResolveMentionsForExternalDisplayAsync(ArgSlackApp, ArgText, ArgNameCache = new Map()) {
  if(!ArgText || typeof ArgText !== 'string') return ArgText;

  const UserIds = SlackFormatUtils.ExtractUserMentions(ArgText);
  if(UserIds.length === 0) return ArgText;

  // resolve each distinct id at most once per cache, falling back to the raw id on lookup failure
  // or when no live SlackApp is available (e.g. offline/test contexts).
  for(const UserId of UserIds) {
    if(ArgNameCache.has(UserId)) continue;
    let Name = null;
    try {
      Name = ArgSlackApp ? await ArgSlackApp.GetUserDisplayNameAsync(UserId) : null;
    } catch {
      // fall back to the raw id below.
    }
    ArgNameCache.set(UserId, Name || UserId);
  }

  return SlackFormatUtils.ReplaceUserMentions(ArgText, (ArgUserId) => `@${ArgNameCache.get(ArgUserId) || ArgUserId}`);
}

module.exports = { ResolveMentionsForExternalDisplayAsync };
