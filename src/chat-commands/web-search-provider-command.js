/**
 * Handle a web-search pass-through command for any registered provider. The previous per-provider
 * handlers (#OnWebSearchCommandAsync, #OnGeminiSearchCommandAsync) collapsed into this single
 * function so the structure (usage check → loading message → invoke → format → error path) lives
 * in one place. Adding a new provider only requires registering it in src/web-search-providers.js.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {import('../web-search-providers').WebSearchProvider} ArgProvider Provider to invoke.
 * @param {string} ArgQuery Query text after the command name (already trimmed).
 * @param {import('../workspace-ai')} ArgWorkspaceAI Workspace-scoped AI instance, passed to the
 *   provider's InvokeAsync.
 * @param {(ArgResult: object) => string} ArgBuildResponseText Formats the provider result into
 *   the final Slack message (`ChatModule.BuildWebSearchResponseText` from chat-module).
 * @returns {Promise<void>}
 */
async function HandleWebSearchProviderCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgProvider,
  ArgQuery,
  ArgWorkspaceAI,
  ArgBuildResponseText
) {
  if(!ArgQuery) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Usage: \`@Sleuth AI ${ArgProvider.Aliases[0]} <query>\``
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ArgProvider.LoadingMessage);

  try {
    const Result = await ArgProvider.InvokeAsync(ArgWorkspaceAI, ArgQuery);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      ArgBuildResponseText(Result)
    );
  } catch(error) {
    ArgSlackApp.Logger.error(`${ArgProvider.Id} failed:`, error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      BuildWebSearchErrorMessage(error)
    );
  }
}

/**
 * Format a provider error for Slack: short preamble + the actual error message in a code block,
 * with any `key=<value>` query parameter redacted so a fetch error containing the URL never leaks
 * the workspace API key.
 * @param {unknown} ArgError Caught error (typically Error, but defensively handles other shapes).
 * @returns {string}
 */
function BuildWebSearchErrorMessage(ArgError) {
  const RawMessage = (ArgError && typeof ArgError === 'object' && 'message' in ArgError)
    ? String(/** @type {any} */ (ArgError).message)
    : String(ArgError);
  const Sanitized = RawMessage.replace(/key=[^\s&"'\\]+/gi, 'key=<redacted>');
  const MaxLen = 600;
  const Trimmed = Sanitized.length > MaxLen ? Sanitized.slice(0, MaxLen) + '…' : Sanitized;
  return `Sorry, I couldn't complete that web search.\n\`\`\`\n${Trimmed}\n\`\`\``;
}

module.exports = HandleWebSearchProviderCommandAsync;
