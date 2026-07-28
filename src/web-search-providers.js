/**
 * Registry of web-search providers consumed by the ChatModule dispatcher, route describer,
 * shared command handler, and `commands` reference output. Adding a new provider only requires
 * adding an entry here — every consumer derives its behavior from this list.
 *
 * @typedef {Object} WebSearchProvider
 * @property {string} Id Stable identifier used as the route name from DescribeChatRoute.
 * @property {string[]} Aliases Command aliases that route to this provider. The first entry is
 *   treated as the canonical command name (used in usage hints and the commands reference).
 * @property {string} Label Human-readable provider label.
 * @property {string} LoadingMessage Slack message posted while the provider call is in flight.
 * @property {string} CommandsListDescription Description rendered in the `commands` reference.
 * @property {(ArgWorkspaceAI: import('./workspace-ai'), ArgQuery: string) => Promise<*>} InvokeAsync
 *   Provider-specific WorkspaceAI invocation returning the search result payload to be formatted
 *   by `ChatModule.BuildWebSearchResponseText`.
 */

/** @type {WebSearchProvider[]} */
const WebSearchProviders = [
  {
    Id: 'web-search',
    Aliases: ['web-search', 'search-web'],
    Label: 'OpenAI Web Search',
    LoadingMessage: '_Searching the web..._',
    CommandsListDescription: 'search the web with OpenAI Responses API and reply with sources',
    InvokeAsync: (ArgWorkspaceAI, ArgQuery) => ArgWorkspaceAI.ProcessWebSearchAsync(ArgQuery),
  },
  {
    Id: 'gemini-search',
    Aliases: ['gemini-search', 'search-gemini', 'google-search', 'search-google'],
    Label: 'Gemini Web Search',
    LoadingMessage: '_Searching the web with Gemini..._',
    CommandsListDescription: 'search the web with Google Gemini and reply with sources',
    InvokeAsync: (ArgWorkspaceAI, ArgQuery) => ArgWorkspaceAI.ProcessGeminiWebSearchAsync(ArgQuery),
  },
];

/**
 * Escape regex metacharacters so an alias can be interpolated into a RegExp without breaking
 * the pattern or matching unintended commands. Existing aliases (`web-search`, `gemini-search`,
 * etc.) are alphanumeric+hyphen and would pass through untouched, but the registry is meant to
 * be extended — a future alias like `c++-search` or `ask?` would otherwise corrupt the matcher.
 * @param {string} ArgText
 * @returns {string}
 */
function EscapeRegexLiteral(ArgText) {
  return ArgText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a matcher regex for a provider that accepts any of its aliases at the start of the
 * mention-stripped text and captures the trailing query (if any).
 * @param {WebSearchProvider} ArgProvider
 * @returns {RegExp}
 */
function BuildProviderMatcherRegex(ArgProvider) {
  const AliasGroup = ArgProvider.Aliases.map(EscapeRegexLiteral).join('|');
  return new RegExp(`^(?:${AliasGroup})(?:\\s+(.*))?$`, 'is');
}

/**
 * Find the first provider whose aliases match the supplied mention-stripped text.
 * Returns the matched provider and the trimmed query (empty string when the user supplied no
 * query after the command name).
 * @param {string} ArgText
 * @returns {{ Provider: WebSearchProvider, Query: string }|null}
 */
function FindMatchingWebSearchProvider(ArgText) {
  for(const Provider of WebSearchProviders) {
    const Match = ArgText.match(BuildProviderMatcherRegex(Provider));
    if(Match) return { Provider, Query: (Match[1] || '').trim() };
  }
  return null;
}

/**
 * Look up a registered provider by its stable id. Used by routing paths that always target a
 * specific provider (e.g. natural-language web-search routes always target OpenAI).
 * @param {string} ArgId
 * @returns {WebSearchProvider|null}
 */
function GetWebSearchProviderById(ArgId) {
  return WebSearchProviders.find((ArgProvider) => ArgProvider.Id === ArgId) || null;
}

/**
 * Format the canonical commands-reference line for a provider (`<canonical> <query>` plus
 * an "also:" footer listing the remaining aliases).
 * @param {WebSearchProvider} ArgProvider
 * @returns {string}
 */
function FormatProviderCommandsListLine(ArgProvider) {
  const [Canonical, ...AdditionalAliases] = ArgProvider.Aliases;
  const AliasNote = AdditionalAliases.length > 0
    ? ` (also: ${AdditionalAliases.map((ArgAlias) => `\`${ArgAlias}\``).join(', ')})`
    : '';
  return `\`@Sleuth AI ${Canonical} <query>\` — ${ArgProvider.CommandsListDescription}${AliasNote}`;
}

module.exports = {
  WebSearchProviders,
  BuildProviderMatcherRegex,
  FindMatchingWebSearchProvider,
  GetWebSearchProviderById,
  FormatProviderCommandsListLine,
};
