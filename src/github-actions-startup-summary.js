'use strict';

/**
 * Default timeout for fetching a GitHub Actions startup summary.
 * @type {number}
 */
const DEFAULT_TIMEOUT_MS = 3500;

/**
 * Delay before posting the startup GitHub Actions follow-up message.
 * @type {number}
 */
const FOLLOW_UP_DELAY_MS = 4000;

/**
 * Build a Slack-ready summary of the latest GitHub Actions workflow run for startup messages.
 * Returns an empty string when the feature is not configured, no run is available, or the
 * request fails/times out.
 * @param {import('./workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace configuration.
 * @param {{ CurrentBranch?: string, TimeoutMs?: number, Logger?: import('@slack/logger').Logger }} [ArgOptions]
 * @returns {Promise<string>}
 */
async function BuildStartupGitHubActionsSummaryAsync(ArgWorkspaceInfo, ArgOptions = {}) {
  const WorkspacePat = NormalizeOptionalString(ArgWorkspaceInfo.GITHUB_PAT);
  const Repo = NormalizeOptionalString(ArgWorkspaceInfo.GITHUB_ACTIONS_REPO);
  if(!WorkspacePat || !Repo) {
    return '';
  }

  const ParsedRepo = ParseRepoName(Repo);
  if(!ParsedRepo) {
    ArgOptions.Logger?.warn(`[startup-actions] invalid GITHUB_ACTIONS_REPO for workspace ${ArgWorkspaceInfo.WORKSPACE_NAME}: ${Repo}`);
    return '';
  }

  const Workflow = NormalizeOptionalString(ArgWorkspaceInfo.GITHUB_ACTIONS_WORKFLOW);
  const PreferredBranch =
    NormalizeOptionalString(ArgWorkspaceInfo.GITHUB_ACTIONS_BRANCH) ||
    NormalizeOptionalString(ArgOptions.CurrentBranch) ||
    null;
  const TimeoutMs = Number.isInteger(ArgOptions.TimeoutMs) && ArgOptions.TimeoutMs > 0
    ? /** @type {number} */ (ArgOptions.TimeoutMs)
    : DEFAULT_TIMEOUT_MS;

  let WorkflowRun = await FetchLatestWorkflowRunAsync(
    ParsedRepo,
    WorkspacePat,
    Workflow,
    PreferredBranch,
    TimeoutMs
  );

  if(!WorkflowRun && PreferredBranch) {
    WorkflowRun = await FetchLatestWorkflowRunAsync(
      ParsedRepo,
      WorkspacePat,
      Workflow,
      null,
      TimeoutMs
    );
  }

  if(!WorkflowRun) {
    return '';
  }

  return FormatWorkflowRunForSlack(Repo, WorkflowRun);
}

/**
 * Post the GitHub Actions startup summary as a separate follow-up Slack message.
 * @param {any} ArgSlackApp Slack app wrapper.
 * @param {string} ArgCurrentBranch Current Sleuth git branch.
 * @param {import('@slack/logger').Logger} [ArgLogger] Logger instance.
 * @param {{ TimeoutMs?: number }} [ArgOptions]
 * @returns {Promise<boolean>}
 */
async function PostStartupGitHubActionsSummaryFollowUpAsync(ArgSlackApp, ArgCurrentBranch, ArgLogger, ArgOptions = {}) {
  if(!HasStartupGitHubActionsConfig(ArgSlackApp.WorkspaceInfo)) {
    return false;
  }

  const GitHubActionsSummary = await BuildStartupGitHubActionsSummaryAsync(
    ArgSlackApp.WorkspaceInfo,
    {
      CurrentBranch: ArgCurrentBranch,
      TimeoutMs: ArgOptions.TimeoutMs,
      Logger: ArgLogger,
    }
  );
  if(!GitHubActionsSummary) {
    return false;
  }

  const ReminderChannelName = ArgSlackApp.WorkspaceInfo.REMINDER_CHANNEL_NAME;
  const ReminderChannelID = await ArgSlackApp.GetChannelIdAsync(ReminderChannelName);
  if(!ReminderChannelID) {
    ArgLogger?.warn(`[startup-actions] could not find reminder channel ${ReminderChannelName} for workspace ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME}`);
    return false;
  }

  await ArgSlackApp.PostMessageTextAsync(ReminderChannelID, null, GitHubActionsSummary, undefined, { Tag: 'startup-actions' });
  ArgLogger?.info(`[startup-actions] posted GitHub Actions follow-up to ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME}#${ReminderChannelName}`);
  return true;
}

/**
 * Schedule the GitHub Actions startup summary as a delayed follow-up message.
 * @param {any} ArgSlackApp Slack app wrapper.
 * @param {string} ArgCurrentBranch Current Sleuth git branch.
 * @param {import('@slack/logger').Logger} [ArgLogger] Logger instance.
 * @param {{ DelayMs?: number, TimeoutMs?: number }} [ArgOptions]
 * @returns {NodeJS.Timeout|null}
 */
function ScheduleStartupGitHubActionsSummaryFollowUp(ArgSlackApp, ArgCurrentBranch, ArgLogger, ArgOptions = {}) {
  if(!HasStartupGitHubActionsConfig(ArgSlackApp.WorkspaceInfo)) {
    return null;
  }

  const DelayMs = Number.isInteger(ArgOptions.DelayMs) && ArgOptions.DelayMs >= 0
    ? /** @type {number} */ (ArgOptions.DelayMs)
    : FOLLOW_UP_DELAY_MS;
  const TimerId = setTimeout(() => {
    PostStartupGitHubActionsSummaryFollowUpAsync(
      ArgSlackApp,
      ArgCurrentBranch,
      ArgLogger,
      { TimeoutMs: ArgOptions.TimeoutMs }
    ).catch((error) => {
      ArgLogger?.warn(`[startup-actions] follow-up failed for workspace ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME}: ${error.message}`);
    });
  }, DelayMs);

  if(typeof TimerId.unref === 'function') {
    TimerId.unref();
  }

  return TimerId;
}

/**
 * Fetch the latest workflow run matching the configured repo/workflow/branch selectors.
 * @param {{ Owner: string, RepoName: string }} ArgRepo Parsed repo info.
 * @param {string} ArgGitHubPat GitHub token.
 * @param {string|null} ArgWorkflow Workflow filename or numeric ID.
 * @param {string|null} ArgBranch Branch filter.
 * @param {number} ArgTimeoutMs Request timeout.
 * @returns {Promise<any|null>}
 */
async function FetchLatestWorkflowRunAsync(ArgRepo, ArgGitHubPat, ArgWorkflow, ArgBranch, ArgTimeoutMs) {
  const Query = new URLSearchParams({ per_page: '1' });
  if(ArgBranch) {
    Query.set('branch', ArgBranch);
  }

  const EndpointPath = ArgWorkflow
    ? `/repos/${ArgRepo.Owner}/${ArgRepo.RepoName}/actions/workflows/${encodeURIComponent(ArgWorkflow)}/runs`
    : `/repos/${ArgRepo.Owner}/${ArgRepo.RepoName}/actions/runs`;
  const Response = await FetchJsonWithTimeoutAsync(
    `https://api.github.com${EndpointPath}?${Query.toString()}`,
    ArgGitHubPat,
    ArgTimeoutMs
  );

  if(!Response || !Array.isArray(Response.workflow_runs) || Response.workflow_runs.length === 0) {
    return null;
  }

  return Response.workflow_runs[0] || null;
}

/**
 * Fetch JSON from GitHub with a hard timeout.
 * @param {string} ArgUrl Absolute URL.
 * @param {string} ArgGitHubPat GitHub token.
 * @param {number} ArgTimeoutMs Timeout in milliseconds.
 * @returns {Promise<any|null>}
 */
async function FetchJsonWithTimeoutAsync(ArgUrl, ArgGitHubPat, ArgTimeoutMs) {
  const Controller = new AbortController();
  const TimeoutId = setTimeout(() => Controller.abort(), ArgTimeoutMs);

  try {
    const Response = await fetch(ArgUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ArgGitHubPat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: Controller.signal,
    });

    if(!Response.ok) {
      return null;
    }

    return await Response.json();
  } catch(error) {
    return null;
  } finally {
    clearTimeout(TimeoutId);
  }
}

/**
 * Format a workflow run into one Slack-ready summary line.
 * @param {string} ArgRepo Full owner/repo string.
 * @param {any} ArgWorkflowRun Workflow run payload.
 * @returns {string}
 */
function FormatWorkflowRunForSlack(ArgRepo, ArgWorkflowRun) {
  const WorkflowName = NormalizeOptionalString(ArgWorkflowRun.name) || 'GitHub Actions';
  const Branch = NormalizeOptionalString(ArgWorkflowRun.head_branch);
  const RunNumber = Number.isInteger(ArgWorkflowRun.run_number) ? `#${ArgWorkflowRun.run_number}` : null;
  const HeadSha = NormalizeOptionalString(ArgWorkflowRun.head_sha);
  const ShortSha = HeadSha ? HeadSha.slice(0, 7) : null;
  const HtmlUrl = NormalizeOptionalString(ArgWorkflowRun.html_url);
  const StatusLabel = BuildRunStatusLabel(ArgWorkflowRun.status, ArgWorkflowRun.conclusion);
  const DurationLabel = BuildRunDurationLabel(ArgWorkflowRun.run_started_at, ArgWorkflowRun.updated_at, ArgWorkflowRun.created_at);

  const Details = [RunNumber, ShortSha, DurationLabel].filter(Boolean).join(', ');
  const BranchText = Branch ? ` on ${Branch}` : '';
  const DetailsText = Details ? ` (${Details})` : '';
  const LinkText = HtmlUrl ? ` <${HtmlUrl}|View run>.` : '.';

  return `_GitHub Actions:_ ${ArgRepo}${BranchText} \`${WorkflowName}\` *${StatusLabel}*${DetailsText}${LinkText}`;
}

/**
 * Build a human-friendly status label from GitHub run state.
 * @param {string|null|undefined} ArgStatus Run status.
 * @param {string|null|undefined} ArgConclusion Run conclusion.
 * @returns {string}
 */
function BuildRunStatusLabel(ArgStatus, ArgConclusion) {
  const NormalizedStatus = NormalizeOptionalString(ArgStatus);
  const NormalizedConclusion = NormalizeOptionalString(ArgConclusion);
  if(NormalizedStatus === 'completed') {
    return NormalizedConclusion || 'completed';
  }

  return NormalizedStatus || 'unknown';
}

/**
 * Build a short duration label when timestamps are available.
 * @param {string|null|undefined} ArgRunStartedAt Run started timestamp.
 * @param {string|null|undefined} ArgUpdatedAt Updated timestamp.
 * @param {string|null|undefined} ArgCreatedAt Created timestamp.
 * @returns {string|null}
 */
function BuildRunDurationLabel(ArgRunStartedAt, ArgUpdatedAt, ArgCreatedAt) {
  const StartedAt = ParseTimestamp(ArgRunStartedAt) || ParseTimestamp(ArgCreatedAt);
  const EndedAt = ParseTimestamp(ArgUpdatedAt);
  if(!StartedAt || !EndedAt) {
    return null;
  }

  const DurationMs = Math.max(0, EndedAt.getTime() - StartedAt.getTime());
  const TotalSeconds = Math.floor(DurationMs / 1000);
  const Minutes = Math.floor(TotalSeconds / 60);
  const Seconds = TotalSeconds % 60;
  if(Minutes > 0) {
    return `${Minutes}m ${Seconds}s`;
  }

  return `${Seconds}s`;
}

/**
 * Parse an owner/repo string.
 * @param {string} ArgRepo Repo name.
 * @returns {{ Owner: string, RepoName: string }|null}
 */
function ParseRepoName(ArgRepo) {
  const Match = ArgRepo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if(!Match) {
    return null;
  }

  return {
    Owner: Match[1],
    RepoName: Match[2],
  };
}

/**
 * Check whether the workspace has enough config to attempt the startup Actions follow-up.
 * @param {import('./workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace configuration.
 * @returns {boolean}
 */
function HasStartupGitHubActionsConfig(ArgWorkspaceInfo) {
  return !!NormalizeOptionalString(ArgWorkspaceInfo.GITHUB_PAT)
    && !!NormalizeOptionalString(ArgWorkspaceInfo.GITHUB_ACTIONS_REPO);
}

/**
 * Normalize an optional string.
 * @param {any} ArgValue Candidate string.
 * @returns {string|null}
 */
function NormalizeOptionalString(ArgValue) {
  if(typeof ArgValue !== 'string') {
    return null;
  }

  const TrimmedValue = ArgValue.trim();
  return TrimmedValue.length > 0 ? TrimmedValue : null;
}

/**
 * Parse an ISO timestamp if present.
 * @param {string|null|undefined} ArgValue Timestamp value.
 * @returns {Date|null}
 */
function ParseTimestamp(ArgValue) {
  const NormalizedValue = NormalizeOptionalString(ArgValue);
  if(!NormalizedValue) {
    return null;
  }

  const ParsedDate = new Date(NormalizedValue);
  return Number.isNaN(ParsedDate.getTime()) ? null : ParsedDate;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  FOLLOW_UP_DELAY_MS,
  BuildStartupGitHubActionsSummaryAsync,
  PostStartupGitHubActionsSummaryFollowUpAsync,
  ScheduleStartupGitHubActionsSummaryFollowUp,
};
