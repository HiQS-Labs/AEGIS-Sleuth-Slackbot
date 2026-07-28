'use strict';

// Where `:bug:` reports are filed. Env-overridable with NO vendor default: a hardcoded repo
// means every deployment files its users' bug reports into someone else's tracker (and fails
// anyway, since their PAT has no access there). Callers may still pass `Repo` explicitly.
const ISSUE_REPO = process.env.SLEUTH_ISSUE_REPO || '';

/**
 * @typedef {{
 *   Repo?: string
 * }} FileGithubIssueOptions
 */

/**
 * Result of a file attempt. `ok` discriminates the shape in practice (fields below apply
 * only for the matching outcome), but is typed as a flat optional-field object rather than a
 * true discriminated union — TypeScript's checkJs mode does not narrow a JSDoc union of inline
 * object types via `if(result.ok)` in this project's tsconfig (verified in isolation: fails to
 * narrow in either branch direction, even split into two named type declarations joined by a
 * union), so a flat shape avoids relying on narrowing that silently doesn't apply here.
 * @typedef {object} FileGithubIssueResult
 * @property {boolean} ok
 * @property {string} repo
 * @property {string} apiUrl
 * @property {number} [number] Issue number — present when `ok` is true.
 * @property {string} [htmlUrl] Issue URL — present when `ok` is true.
 * @property {'no-pat'|'forbidden'|'github-error'|'request-failed'} [reason] Present when `ok` is false.
 * @property {number} [status] HTTP status — present when `reason` is 'forbidden' or 'github-error'.
 * @property {Error} [error] Present when `reason` is 'request-failed'.
 */

/**
 * Create a GitHub issue in the configured repo using the workspace PAT.
 * Caller owns title/body construction and user-facing Slack messages.
 * @param {{ GITHUB_PAT?: string|null }} ArgWorkspaceInfo
 * @param {string} ArgTitle
 * @param {string} ArgBody
 * @param {FileGithubIssueOptions} [ArgOptions]
 * @returns {Promise<FileGithubIssueResult>}
 */
async function FileGithubIssueAsync(ArgWorkspaceInfo, ArgTitle, ArgBody, ArgOptions = {}) {
  const Repo = typeof ArgOptions.Repo === 'string' && ArgOptions.Repo.trim()
    ? ArgOptions.Repo.trim()
    : ISSUE_REPO;
  const ApiUrl = `https://api.github.com/repos/${Repo}/issues`;
  const Pat = typeof ArgWorkspaceInfo?.GITHUB_PAT === 'string'
    ? ArgWorkspaceInfo.GITHUB_PAT.trim()
    : '';
  if(!Pat)
    return { ok: false, repo: Repo, apiUrl: ApiUrl, reason: 'no-pat' };

  try {
    const Response = await fetch(ApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: ArgTitle, body: ArgBody }),
    });

    if(Response.status === 201) {
      const Data = await Response.json();
      return {
        ok: true,
        repo: Repo,
        apiUrl: ApiUrl,
        number: Number(Data.number),
        htmlUrl: String(Data.html_url || ''),
      };
    }

    if(Response.status === 403)
      return { ok: false, repo: Repo, apiUrl: ApiUrl, reason: 'forbidden', status: Response.status };

    return { ok: false, repo: Repo, apiUrl: ApiUrl, reason: 'github-error', status: Response.status };
  } catch(error) {
    return {
      ok: false,
      repo: Repo,
      apiUrl: ApiUrl,
      reason: 'request-failed',
      error: /** @type {Error} */ (error),
    };
  }
}

module.exports = { FileGithubIssueAsync, ISSUE_REPO };
