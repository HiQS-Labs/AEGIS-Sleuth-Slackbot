
'use strict';

const { ExtractIssueReferences, IssueKey } = require('./github-url-utils');

/**
 * @typedef {object} GitHubUser
 * @property {string} [login]
 * @property {string} [type]
 */

/**
 * @typedef {object} GitHubIssue
 * @property {number} number
 * @property {string} title
 * @property {string} [body]
 * @property {string} state
 * @property {string} [state_reason]
 * @property {string} html_url
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} [closed_at]
 * @property {GitHubUser} [user]
 * @property {{ merged_at?: string|null }} [pull_request]
 */

/**
 * @typedef {object} GitHubComment
 * @property {number} id
 * @property {string} body
 * @property {string} html_url
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} issue_url
 * @property {GitHubUser} [user]
 */

/**
 * @typedef {object} IssueThread
 * @property {string} ChannelID
 * @property {string} ThreadTs
 * @property {string[]} PostedKeys
 * @property {boolean} Closed
 * @property {string} LastActivityAt
 */

/**
 * @typedef {object} IssueStreamState
 * @property {number} SchemaVersion
 * @property {string[]} AllowlistCache
 * @property {Object<string, { Cursor: string, SeededAt: string, ParentScanAt?: string }>} Repos
 * @property {Object<string, IssueThread>} Issues
 */

/**
 * @typedef {object} StreamAction
 * @property {'parent'|'reply'} Kind
 * @property {string} IssueKey Canonical "owner/repo#n" for the thread.
 * @property {string} EventKey Idempotency key (e.g. "comment:123").
 * @property {string} Text Slack mrkdwn body.
 * @property {string} EventAt ISO timestamp used for ordering.
 * @property {boolean} [MarkClosed] Set Closed=true after a successful post.
 * @property {boolean} [MarkOpen] Set Closed=false after a successful post.
 */

const COMMENT_SNIPPET_MAX = 300;
const CURSOR_OVERLAP_MS = 60 * 1000;

/**
 * Escape Slack mrkdwn special characters in free text.
 * @param {string|null|undefined} ArgText Raw text.
 * @returns {string}
 */
function EscapeMrkdwn(ArgText) {
  if(!ArgText) return '';
  return String(ArgText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Whether an author should be skipped (bots and configured ignore list).
 * @param {GitHubUser|null|undefined} ArgUser GitHub user object.
 * @param {Set<string>} ArgIgnoreAuthors Lowercased logins to skip.
 * @returns {boolean}
 */
function IsIgnoredAuthor(ArgUser, ArgIgnoreAuthors) {
  if(!ArgUser) return false;
  const Login = typeof ArgUser.login === 'string' ? ArgUser.login : '';
  if(ArgUser.type === 'Bot') return true;
  if(Login.endsWith('[bot]')) return true;
  if(Login && ArgIgnoreAuthors.has(Login.toLowerCase())) return true;
  return false;
}

/**
 * Parse an issue number from a GitHub issue_url.
 * @param {string} ArgIssueUrl API or html issue URL.
 * @param {string} ArgRepo Canonical "owner/repo".
 * @returns {string} Issue key or empty string.
 */
function IssueKeyFromCommentUrl(ArgIssueUrl, ArgRepo) {
  if(typeof ArgIssueUrl !== 'string') return '';
  const Match = ArgIssueUrl.match(/\/issues\/(\d+)(?:\/|$)/i);
  if(!Match) return '';
  return IssueKey(ArgRepo, Match[1]);
}

/**
 * Collapse whitespace and truncate a comment body for Slack.
 * @param {string|null|undefined} ArgBody Comment body.
 * @returns {string}
 */
function CommentSnippet(ArgBody) {
  const Collapsed = String(ArgBody || '').replace(/\s+/g, ' ').trim();
  if(Collapsed.length <= COMMENT_SNIPPET_MAX) return EscapeMrkdwn(Collapsed);
  return EscapeMrkdwn(`${Collapsed.slice(0, COMMENT_SNIPPET_MAX - 1)}…`);
}

/**
 * Format a parent Slack message for a newly opened issue.
 * @param {string} ArgRepo Canonical "owner/repo".
 * @param {GitHubIssue} ArgIssue Issue payload.
 * @returns {string}
 */
function FormatParentMessage(ArgRepo, ArgIssue) {
  const Login = EscapeMrkdwn(ArgIssue.user?.login || 'unknown');
  const Title = EscapeMrkdwn(ArgIssue.title || '');
  const Label = EscapeMrkdwn(`${ArgRepo}#${ArgIssue.number}`);
  return `:new: *<${ArgIssue.html_url}|${Label}>* ${Title}\nOpened by \`${Login}\``;
}

/**
 * Format a comment reply.
 * @param {GitHubComment} ArgComment Comment payload.
 * @returns {string}
 */
function FormatCommentReply(ArgComment) {
  const Login = EscapeMrkdwn(ArgComment.user?.login || 'unknown');
  const Snippet = CommentSnippet(ArgComment.body);
  return `:speech_balloon: \`${Login}\` commented (<${ArgComment.html_url}|view>):\n>${Snippet}`;
}

/**
 * Format a PR-opened reply.
 * @param {GitHubIssue} ArgPr Pull request represented as an issues item.
 * @returns {string}
 */
function FormatPrOpenedReply(ArgPr) {
  const Login = EscapeMrkdwn(ArgPr.user?.login || 'unknown');
  const Title = EscapeMrkdwn(ArgPr.title || '');
  const Label = EscapeMrkdwn(ArgPr.html_url?.replace(/^https:\/\/github\.com\//, '').replace(/\/pull\//, '#') || `PR #${ArgPr.number}`);
  return `:arrow_heading_up: PR <${ArgPr.html_url}|${Label}> opened by \`${Login}\`: ${Title}`;
}

/**
 * Format a PR-merged reply.
 * @param {GitHubIssue} ArgPr Pull request represented as an issues item.
 * @returns {string}
 */
function FormatPrMergedReply(ArgPr) {
  const Label = EscapeMrkdwn(ArgPr.html_url?.replace(/^https:\/\/github\.com\//, '').replace(/\/pull\//, '#') || `PR #${ArgPr.number}`);
  return `:twisted_rightwards_arrows: PR <${ArgPr.html_url}|${Label}> merged`;
}

/**
 * Format a close or reopen reply.
 * @param {GitHubIssue} ArgIssue Issue payload.
 * @param {boolean} ArgClosed Whether this is a close (true) or reopen (false).
 * @returns {string}
 */
function FormatCloseReply(ArgIssue, ArgClosed) {
  if(ArgClosed) {
    const Reason = EscapeMrkdwn(ArgIssue.state_reason || 'closed');
    return `:white_check_mark: Issue closed (${Reason})`;
  }
  return ':arrows_counterclockwise: Issue reopened';
}

/**
 * Whether an issue qualifies as a new parent post.
 * @param {IssueStreamState} ArgState Persisted state.
 * @param {string} ArgRepo Canonical "owner/repo".
 * @param {GitHubIssue} ArgIssue Issue payload.
 * @param {Set<string>} ArgIgnoreAuthors Ignore list.
 * @returns {boolean}
 */
function IsNewIssueParent(ArgState, ArgRepo, ArgIssue, ArgIgnoreAuthors) {
  if(ArgIssue.pull_request) return false;
  if(IsIgnoredAuthor(ArgIssue.user, ArgIgnoreAuthors)) return false;
  const Key = IssueKey(ArgRepo, ArgIssue.number);
  if(!Key || ArgState.Issues[Key]) return false;
  const SeededAt = ArgState.Repos[ArgRepo]?.SeededAt;
  if(!SeededAt) return false;
  return String(ArgIssue.created_at) >= SeededAt;
}

/**
 * Decide which Slack posts one repo's GitHub changes require, without performing any I/O.
 * Actions are ordered parent posts first, then replies by event time, so a reply never
 * precedes its thread. Callers execute actions in order and record each EventKey only
 * after Slack confirms the post, which is what makes the stream idempotent.
 *
 * @param {IssueStreamState} ArgState Current persisted state (read-only here).
 * @param {string} ArgRepo Canonical "owner/repo".
 * @param {GitHubIssue[]} ArgIssues Items from GET /repos/{r}/issues?since= (issues and PRs).
 * @param {GitHubComment[]} ArgComments Items from GET /repos/{r}/issues/comments?since=.
 * @param {{ IgnoreAuthors?: Set<string> }} [ArgOptions] Author filter.
 * @returns {StreamAction[]}
 */
function PlanRepoActions(ArgState, ArgRepo, ArgIssues, ArgComments, ArgOptions = {}) {
  const IgnoreAuthors = ArgOptions.IgnoreAuthors instanceof Set
    ? ArgOptions.IgnoreAuthors
    : new Set();

  /** @type {StreamAction[]} */
  const Parents = [];
  /** @type {StreamAction[]} */
  const Replies = [];

  /** @type {Set<string>} */
  const PlannedParents = new Set();

  for(const Issue of ArgIssues || []) {
    if(!IsNewIssueParent(ArgState, ArgRepo, Issue, IgnoreAuthors)) continue;
    const Key = IssueKey(ArgRepo, Issue.number);
    Parents.push({
      Kind: 'parent',
      IssueKey: Key,
      EventKey: `parent:${Key}`,
      Text: FormatParentMessage(ArgRepo, Issue),
      EventAt: Issue.created_at,
      MarkClosed: Issue.state === 'closed',
    });
    PlannedParents.add(Key);
  }

  /**
   * @param {string} ArgKey
   * @returns {boolean}
   */
  function HasThread(ArgKey) {
    return Boolean(ArgState.Issues[ArgKey]) || PlannedParents.has(ArgKey);
  }

  /**
   * @param {string} ArgKey
   * @param {string} ArgEventKey
   * @returns {boolean}
   */
  function AlreadyPosted(ArgKey, ArgEventKey) {
    const Thread = ArgState.Issues[ArgKey];
    return Boolean(Thread?.PostedKeys?.includes(ArgEventKey));
  }

  for(const Comment of ArgComments || []) {
    if(IsIgnoredAuthor(Comment.user, IgnoreAuthors)) continue;
    const Key = IssueKeyFromCommentUrl(Comment.issue_url, ArgRepo);
    if(!Key || !HasThread(Key)) continue;
    const EventKey = `comment:${Comment.id}`;
    if(AlreadyPosted(Key, EventKey)) continue;
    Replies.push({
      Kind: 'reply',
      IssueKey: Key,
      EventKey,
      Text: FormatCommentReply(Comment),
      EventAt: Comment.created_at || Comment.updated_at,
    });
  }

  for(const Item of ArgIssues || []) {
    if(Item.pull_request) {
      if(IsIgnoredAuthor(Item.user, IgnoreAuthors)) continue;
      const CombinedText = `${Item.title || ''}\n${Item.body || ''}`;
      const Refs = ExtractIssueReferences(CombinedText, ArgRepo);
      const PrKey = IssueKey(ArgRepo, Item.number);
      for(const RefKey of Refs) {
        if(!HasThread(RefKey)) continue;
        const OpenKey = `pr-open:${PrKey}`;
        if(!AlreadyPosted(RefKey, OpenKey)) {
          Replies.push({
            Kind: 'reply',
            IssueKey: RefKey,
            EventKey: OpenKey,
            Text: FormatPrOpenedReply(Item),
            EventAt: Item.created_at,
          });
        }
        if(Item.pull_request.merged_at) {
          const MergedKey = `pr-merged:${PrKey}`;
          if(!AlreadyPosted(RefKey, MergedKey)) {
            Replies.push({
              Kind: 'reply',
              IssueKey: RefKey,
              EventKey: MergedKey,
              Text: FormatPrMergedReply(Item),
              EventAt: Item.pull_request.merged_at,
            });
          }
        }
      }
      continue;
    }

    const Key = IssueKey(ArgRepo, Item.number);
    if(!HasThread(Key)) continue;
    const Thread = ArgState.Issues[Key];
    const CurrentlyClosed = Thread ? Thread.Closed : false;

    if(Item.state === 'closed' && !CurrentlyClosed) {
      const EventKey = `closed:${Item.closed_at || Item.updated_at}`;
      if(!AlreadyPosted(Key, EventKey)) {
        Replies.push({
          Kind: 'reply',
          IssueKey: Key,
          EventKey,
          Text: FormatCloseReply(Item, true),
          EventAt: Item.closed_at || Item.updated_at,
          MarkClosed: true,
        });
      }
    } else if(Item.state === 'open' && CurrentlyClosed) {
      const EventKey = `reopened:${Item.updated_at}`;
      if(!AlreadyPosted(Key, EventKey)) {
        Replies.push({
          Kind: 'reply',
          IssueKey: Key,
          EventKey,
          Text: FormatCloseReply(Item, false),
          EventAt: Item.updated_at,
          MarkOpen: true,
        });
      }
    }
  }

  Parents.sort((ArgA, ArgB) => String(ArgA.EventAt).localeCompare(String(ArgB.EventAt)));
  Replies.sort((ArgA, ArgB) => String(ArgA.EventAt).localeCompare(String(ArgB.EventAt)));
  return [...Parents, ...Replies];
}

/**
 * Whether a fetched reply's parent eligibility is still unknown.
 * Fetched old/ignored issues and PRs are known exclusions; absent issues are not.
 * @param {IssueStreamState} ArgState
 * @param {string} ArgRepo
 * @param {GitHubIssue[]} ArgIssues
 * @param {GitHubComment[]} ArgComments
 * @param {Set<string>} ArgIgnoreAuthors
 * @param {boolean} ArgIssuesComplete
 * @param {string[]} ArgAllowlist
 * @returns {boolean}
 */
function HasUnmappedParents(ArgState, ArgRepo, ArgIssues, ArgComments, ArgIgnoreAuthors, ArgIssuesComplete, ArgAllowlist) {
  const Known = new Set(Object.keys(ArgState.Issues));
  for(const Item of ArgIssues)
    Known.add(IssueKey(ArgRepo, Item.number));
  for(const Comment of ArgComments) {
    if(IsIgnoredAuthor(Comment.user, ArgIgnoreAuthors)) continue;
    const Key = IssueKeyFromCommentUrl(Comment.issue_url, ArgRepo);
    if(!ArgIssuesComplete && Key && !Known.has(Key)) return true;
  }
  for(const Item of ArgIssues) {
    if(!Item.pull_request || IsIgnoredAuthor(Item.user, ArgIgnoreAuthors)) continue;
    for(const Key of ExtractIssueReferences(`${Item.title || ''}\n${Item.body || ''}`, ArgRepo)) {
      if(Known.has(Key)) continue;
      const TargetRepo = Key.split('#')[0];
      if(TargetRepo === ArgRepo.toLowerCase()) {
        if(!ArgIssuesComplete) return true;
        continue;
      }
      const Target = ArgState.Repos[TargetRepo];
      const EventAt = Item.updated_at || Item.created_at;
      if(!ArgAllowlist.includes(TargetRepo) || !Target || EventAt < Target.SeededAt) continue;
      if(!Target.ParentScanAt || Target.ParentScanAt < EventAt) return true;
    }
  }
  return false;
}

/**
 * Compute the next per-repo cursor from the newest event timestamps, overlapping by 60s.
 * Incomplete endpoints cap that progress at their own fetched watermark.
 * Never moves backwards relative to ArgPrevious.
 *
 * @param {GitHubIssue[]} ArgIssues Issues/PRs fetched this cycle.
 * @param {GitHubComment[]} ArgComments Comments fetched this cycle.
 * @param {string} ArgPrevious Previous cursor ISO string.
 * @param {{ Issues?: boolean, Comments?: boolean }} [ArgComplete] Endpoint traversal completion.
 * @returns {string}
 */
function NextCursor(ArgIssues, ArgComments, ArgPrevious, ArgComplete = {}) {
  let Newest = ArgPrevious || '';
  for(const Issue of ArgIssues || []) {
    const Stamp = Issue.updated_at || Issue.created_at || '';
    if(Stamp && Stamp > Newest) Newest = Stamp;
  }
  for(const Comment of ArgComments || []) {
    const Stamp = Comment.updated_at || Comment.created_at || '';
    if(Stamp && Stamp > Newest) Newest = Stamp;
  }
  if(!Newest) return ArgPrevious || '';
  const Overlapped = new Date(new Date(Newest).getTime() - CURSOR_OVERLAP_MS).toISOString();
  let Next = ArgPrevious && Overlapped < ArgPrevious ? ArgPrevious : Overlapped;
  if(ArgComplete.Issues === false)
    Next = [Next, NextCursor(ArgIssues, [], ArgPrevious)].sort()[0];
  if(ArgComplete.Comments === false)
    Next = [Next, NextCursor([], ArgComments, ArgPrevious)].sort()[0];
  return Next;
}

/**
 * Drop repo cursors no longer on the allowlist; retain delivery identity and keys.
 * Age alone cannot revoke a Slack parent: old issues can reopen or receive replies.
 *
 * @param {IssueStreamState} ArgState Mutable state object.
 * @param {Date|string} ArgNow Current time.
 * @param {string[]} [ArgAllowlist] Current allowlist; repos not in it are dropped.
 * @returns {IssueStreamState}
 */
function PruneState(ArgState, ArgNow, ArgAllowlist) {
  const Allow = ArgAllowlist
    ? new Set(ArgAllowlist.map((ArgRepo) => ArgRepo.toLowerCase()))
    : null;

  if(Allow) {
    for(const Repo of Object.keys(ArgState.Repos || {})) {
      if(!Allow.has(Repo.toLowerCase())) delete ArgState.Repos[Repo];
    }
    ArgState.AllowlistCache = [...ArgAllowlist];
  }

  return ArgState;
}

/**
 * Build an empty stream state document.
 * @returns {IssueStreamState}
 */
function EmptyState() {
  return {
    SchemaVersion: 1,
    AllowlistCache: [],
    Repos: {},
    Issues: {},
  };
}

module.exports = {
  PlanRepoActions,
  NextCursor,
  HasUnmappedParents,
  PruneState,
  EmptyState,
  EscapeMrkdwn,
  IsIgnoredAuthor,
  FormatParentMessage,
  FormatCommentReply,
  FormatPrOpenedReply,
  FormatPrMergedReply,
  FormatCloseReply,
  COMMENT_SNIPPET_MAX,
  CURSOR_OVERLAP_MS,
};
