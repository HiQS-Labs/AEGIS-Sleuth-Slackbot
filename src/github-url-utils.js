
'use strict';

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

/**
 * Normalize a repo name to a canonical lowercased "owner/repo" key.
 * @param {string} ArgRepo Repo as "owner/repo" (any casing).
 * @returns {string}
 */
function CanonicalRepoKey(ArgRepo) {
  if(typeof ArgRepo !== 'string') return '';
  const Parts = ArgRepo.trim().split('/');
  if(Parts.length !== 2 || !Parts[0] || !Parts[1]) return '';
  return `${Parts[0].toLowerCase()}/${Parts[1].toLowerCase()}`;
}

/**
 * Extract issue references from GitHub text as canonical "owner/repo#n" keys.
 * Recognizes "#12" (resolved against ArgDefaultRepo), "owner/repo#12", and
 * https://github.com/owner/repo/issues/12 or /pull/12 URLs. Owner/repo are
 * lowercased so keys match regardless of casing; duplicates are removed.
 *
 * @param {string|null|undefined} ArgText PR title and body (or any GitHub markdown).
 * @param {string} ArgDefaultRepo Repo the text belongs to, as "owner/repo".
 * @returns {string[]}
 */
function ExtractIssueReferences(ArgText, ArgDefaultRepo) {
  if(!ArgText || typeof ArgText !== 'string') return [];

  const DefaultKey = CanonicalRepoKey(ArgDefaultRepo);
  /** @type {Set<string>} */
  const Keys = new Set();

  const UrlRegex = /https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/(?:issues|pull)\/(\d+)/gi;
  let Match;
  while((Match = UrlRegex.exec(ArgText)) !== null) {
    Keys.add(`${Match[1].toLowerCase()}/${Match[2].toLowerCase()}#${Match[3]}`);
  }

  const QualifiedRegex = /\b([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)\b/g;
  while((Match = QualifiedRegex.exec(ArgText)) !== null) {
    const RepoKey = CanonicalRepoKey(Match[1]);
    if(RepoKey) Keys.add(`${RepoKey}#${Match[2]}`);
  }

  if(DefaultKey) {
    const ShorthandRegex = /(^|[^A-Za-z0-9/_-])#(\d+)\b/g;
    while((Match = ShorthandRegex.exec(ArgText)) !== null) {
      Keys.add(`${DefaultKey}#${Match[2]}`);
    }
  }

  return [...Keys];
}

/**
 * Build a canonical issue key "owner/repo#n".
 * @param {string} ArgRepo Repo as "owner/repo".
 * @param {number|string} ArgNumber Issue or PR number.
 * @returns {string}
 */
function IssueKey(ArgRepo, ArgNumber) {
  const RepoKey = CanonicalRepoKey(ArgRepo);
  if(!RepoKey) return '';
  const NumberPart = String(ArgNumber).replace(/\D/g, '');
  if(!NumberPart) return '';
  return `${RepoKey}#${NumberPart}`;
}

module.exports = {
  ExtractGitHubUrls,
  ExtractIssueReferences,
  CanonicalRepoKey,
  IssueKey,
};
