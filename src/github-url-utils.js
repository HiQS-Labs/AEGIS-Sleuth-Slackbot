
/**
 * Extract GitHub issue and pull request URLs from raw Slack message text.
 * Handles bare URLs, <url> links, and <url|anchor text> links while stripping
 * fragments, trailing path segments, and Slack anchor text.
 *
 * @param {string|null|undefined} ArgMessageText Raw message text from Slack.
 * @returns {string[]}
 */
function ExtractGitHubUrls(ArgMessageText) {
  if(!ArgMessageText || typeof ArgMessageText !== 'string')
    return [];

  const GitHubUrlRegex = /(?:<)?(https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:issues|pull)\/\d+)(?:[^>\s|]*)?(?:\|[^>]*)?(?:>)?/gi;
  const Matches = [];
  let CurrentMatch;

  while((CurrentMatch = GitHubUrlRegex.exec(ArgMessageText)) !== null)
    Matches.push(CurrentMatch[1]);

  return [...new Set(Matches)];
}

module.exports = {
  ExtractGitHubUrls,
};

