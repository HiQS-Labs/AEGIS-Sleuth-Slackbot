/**
 * Handle the `web-search-advanced` placeholder command. Reserved for the future buffered
 * multi-step web-search synthesis mode; for now it just informs the caller that it is not
 * enabled and points them at `web-search`.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @returns {Promise<void>}
 */
async function HandleWebSearchAdvancedCommandAsync(ArgSlackApp, ArgEventInfo) {
  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    '`web-search-advanced` is reserved for the buffered multi-step mode, but it is not enabled yet. Use `@Sleuth AI web-search <query>` for now.'
  );
}

module.exports = HandleWebSearchAdvancedCommandAsync;
