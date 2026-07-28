
// import required modules.
const RemindersModule = require('./reminders-module');
const SlackFormatUtils = require('./slack-format-utils');

/**
 * Syncs GitHub issue and pull request state to Sleuth reminders.
 */
class GitHubSyncModule {
  /**
   * Reminder modules to inspect across workspaces.
   * @type {RemindersModule[]}
   */
  #RemindersModules;

  /**
   * Logger instance.
   * @type {import('@slack/logger').Logger}
   */
  #Logger;

  /**
   * Poll interval in milliseconds.
   * @type {number}
   */
  #PollIntervalMs;

  /**
   * Timer ID for the polling loop.
   * @type {NodeJS.Timeout|null}
   */
  #PollTimerId = null;

  /**
   * Cached heartbeat channel IDs keyed by workspace name.
   * @type {Map<string, string>}
   */
  #HeartbeatChannelIdsByWorkspaceName = new Map();

  /**
   * Indicates whether polling should continue.
   * @type {boolean}
   */
  #IsRunning = false;

  /**
   * Initialize a GitHub sync module.
   * @param {RemindersModule[]} ArgRemindersModules Reminder modules across workspaces.
   * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
   * @param {number} [ArgPollIntervalMs] Poll interval in milliseconds.
   */
  constructor(ArgRemindersModules, ArgLogger, ArgPollIntervalMs = 30 * 60 * 1000) {
    this.#RemindersModules = ArgRemindersModules;
    this.#Logger = ArgLogger;
    this.#PollIntervalMs = ArgPollIntervalMs;
  }

  /**
   * Start the GitHub sync polling loop.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    if(this.#IsRunning)
      throw new Error('GitHubSyncModule is already running.');

    this.#IsRunning = true;
    this.#Logger.info(`[github-sync] starting polling loop (${this.#PollIntervalMs} ms)`);
    this.#ScheduleNextPoll();
  }

  /**
   * Stop the GitHub sync polling loop.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    this.#IsRunning = false;

    if(this.#PollTimerId) {
      clearTimeout(this.#PollTimerId);
      this.#PollTimerId = null;
    }

    this.#HeartbeatChannelIdsByWorkspaceName.clear();

    this.#Logger.info('[github-sync] stopped polling loop');
  }

  /**
   * Run a GitHub sync poll immediately, outside the normal schedule.
   * @returns {Promise<GitHubDebugResult>}
   */
  async RunNowAsync() {
    if(!this.#IsRunning)
      return { ok: false, message: 'GitHub sync module is not running.' };

    this.#Logger.info('[github-sync] manual sync triggered');
    try {
      const PollResult = await this.#PollGitHubStatusesAsync(false);
      return {
        ok: !PollResult.hadError,
        message: GitHubSyncModule.BuildRunNowMessage(PollResult),
      };
    } catch(error) {
      this.#Logger.error('[github-sync] error during manual sync:', error);
      return { ok: false, message: `GitHub sync failed: ${error.message}` };
    }
  }

  /**
   * Test whether the workspace GitHub PAT is configured and accepted by the API.
   * @param {RemindersModule} ArgRemindersModule Reminder module for the workspace.
   * @returns {Promise<GitHubDebugResult>}
   */
  async TestWorkspacePatAsync(ArgRemindersModule) {
    const WorkspaceName = ArgRemindersModule.SlackApp.WorkspaceInfo.WORKSPACE_NAME;
    const WorkspacePat = ArgRemindersModule.SlackApp.WorkspaceInfo.GITHUB_PAT;

    if(!WorkspacePat) {
      return {
        ok: false,
        message: `GitHub PAT is not configured for workspace ${WorkspaceName}.`
      };
    }

    try {
      const Response = await fetch('https://api.github.com/rate_limit', {
        headers: {
          Authorization: `Bearer ${WorkspacePat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }
      });

      if(!Response.ok) {
        return {
          ok: false,
          message: `GitHub PAT test failed for workspace ${WorkspaceName}: HTTP ${Response.status}.`
        };
      }

      const Data = await Response.json();
      const CoreLimit = Data?.resources?.core?.limit ?? 'unknown';
      const CoreRemaining = Data?.resources?.core?.remaining ?? 'unknown';
      return {
        ok: true,
        message: `GitHub PAT is configured and API access succeeded for workspace ${WorkspaceName}. Core rate limit: ${CoreRemaining}/${CoreLimit} remaining.`
      };
    } catch(error) {
      return {
        ok: false,
        message: `GitHub PAT test failed for workspace ${WorkspaceName}: ${error.message}`
      };
    }
  }

  /**
   * Test a specific GitHub issue or pull request URL for the workspace.
   * @param {RemindersModule} ArgRemindersModule Reminder module for the workspace.
   * @param {string} ArgUrl GitHub URL to test.
   * @returns {Promise<GitHubDebugResult>}
   */
  async TestGitHubUrlAsync(ArgRemindersModule, ArgUrl) {
    const WorkspaceName = ArgRemindersModule.SlackApp.WorkspaceInfo.WORKSPACE_NAME;
    const WorkspacePat = ArgRemindersModule.SlackApp.WorkspaceInfo.GITHUB_PAT;
    if(!WorkspacePat) {
      return {
        ok: false,
        message: `GitHub PAT is not configured for workspace ${WorkspaceName}.`
      };
    }

    const ParsedUrl = this.#ParseGitHubUrl(ArgUrl);
    if(!ParsedUrl) {
      return {
        ok: false,
        message: 'No valid GitHub issue or pull request URL found in the command.'
      };
    }

    const StatusResult = ParsedUrl.type === 'issues'
      ? await this.#CheckGitHubIssueAsync(ParsedUrl, WorkspacePat)
      : await this.#CheckGitHubPullRequestAsync(ParsedUrl, WorkspacePat);

    return GitHubSyncModule.BuildSingleUrlDebugResult(ArgUrl, ParsedUrl, StatusResult);
  }

  /**
   * Schedule the next GitHub sync poll.
   */
  #ScheduleNextPoll() {
    if(!this.#IsRunning) return;

    this.#PollTimerId = setTimeout(async function ProcessPollAsync() {
      try {
        await this.#PollGitHubStatusesAsync(true);
      } catch(error) {
        this.#Logger.error('[github-sync] error while polling GitHub:', error);
      }

      if(!this.#IsRunning) {
        this.#PollTimerId = null;
        return;
      }

      this.#ScheduleNextPoll();
    }.bind(this), this.#PollIntervalMs);
  }

  /**
   * Poll GitHub for eligible reminders across workspaces.
   * @param {boolean} ArgPostHeartbeat Should heartbeat messages be posted after the cycle?
   * @returns {Promise<GitHubPollResult>}
   */
  async #PollGitHubStatusesAsync(ArgPostHeartbeat) {
    /** @type {Map<string, GitHubStatusResult>} */
    const StatusCache = new Map();
    const WorkspaceContexts = [];
    let TotalEligibleReminderCount = 0;
    let TotalCheckedReminderCount = 0;
    let TotalAutoCompletedCount = 0;
    let HadError = false;

    for(const CurrentRemindersModule of this.#RemindersModules) {
      const CurrentSummary = GitHubSyncModule.CreateWorkspacePollSummary(CurrentRemindersModule.SlackApp.WorkspaceInfo);
      WorkspaceContexts.push({
        RemindersModule: CurrentRemindersModule,
        Summary: CurrentSummary,
      });

      try {
        if(!CurrentRemindersModule.DataLoaded) {
          CurrentSummary.cycleStatus = 'skipped';
          CurrentSummary.skippedReason = `reminder data not loaded (${CurrentRemindersModule.DataLoadError || 'unknown'})`;
          this.#Logger.warn(
            `[github-sync] skipping workspace ${CurrentSummary.workspaceName}: ${CurrentSummary.skippedReason}`
          );
          continue;
        }

        const WorkspacePat = CurrentRemindersModule.SlackApp.WorkspaceInfo.GITHUB_PAT;
        if(!WorkspacePat) {
          CurrentSummary.cycleStatus = 'skipped';
          CurrentSummary.skippedReason = 'GITHUB_PAT not configured';
          continue;
        }

        const RemindersToCheck = CurrentRemindersModule.GetAllReminders().filter(ArgReminder => {
          return Array.isArray(ArgReminder.GitHubUrls) && ArgReminder.GitHubUrls.length > 0;
        });

        CurrentSummary.eligibleReminderCount = RemindersToCheck.length;
        TotalEligibleReminderCount += RemindersToCheck.length;

        for(const CurrentReminder of RemindersToCheck) {
          CurrentSummary.checkedReminderCount += 1;
          TotalCheckedReminderCount += 1;

          const CheckResult = await this.#ShouldAutoCompleteReminderAsync(
            CurrentRemindersModule,
            CurrentReminder,
            WorkspacePat,
            StatusCache
          );

          if(CheckResult.stopCycle) {
            const BlockingReason = CheckResult.blockingItem?.reason || 'stop-cycle';
            CurrentSummary.cycleStatus = 'stopped';
            CurrentSummary.stopCycle = true;
            CurrentSummary.errorMessage = `poll cycle stopped early due to ${BlockingReason}`;
            this.#Logger.warn('[github-sync] stopping current poll cycle early');
            HadError = true;
            break;
          }

          if(!CheckResult.shouldComplete) continue;

          const CompletionReason = `terminal: github-complete ${GitHubSyncModule.BuildCompletionReason(CheckResult.completionItems)}`;
          const Completed = await CurrentRemindersModule.CompleteReminderByIdAsync(
            CurrentReminder.ReminderID,
            CompletionReason
          );

          if(!Completed) continue;

          CurrentSummary.autoCompletedCount += 1;
          TotalAutoCompletedCount += 1;

          const NotificationPosted = await this.#PostAutoCompleteNotificationAsync(
            CurrentRemindersModule.SlackApp,
            CurrentReminder,
            CheckResult.completionItems
          );
          if(!NotificationPosted)
            CurrentRemindersModule.SlackApp.Logger.warn(`[github-sync] reminder ${CurrentReminder.ReminderID} completed without Slack notification delivery`);
        }

        if(CurrentSummary.cycleStatus === 'pending')
          CurrentSummary.cycleStatus = 'completed';

        if(CurrentSummary.stopCycle)
          break;
      } catch(error) {
        CurrentSummary.cycleStatus = 'error';
        CurrentSummary.errorMessage = error.message;
        CurrentRemindersModule.SlackApp.Logger.error(
          `[github-sync] workspace ${CurrentSummary.workspaceName} heartbeat cycle error:`,
          error
        );
        HadError = true;
      }
    }

    if(TotalCheckedReminderCount > 0)
      this.#Logger.info(`[github-sync] checked ${TotalCheckedReminderCount} reminder(s) this cycle`);

    /** @type {GitHubPollResult} */
    const PollResult = {
      workspaceSummaries: WorkspaceContexts.map(ArgContext => ArgContext.Summary),
      totalEligibleReminderCount: TotalEligibleReminderCount,
      totalCheckedReminderCount: TotalCheckedReminderCount,
      totalAutoCompletedCount: TotalAutoCompletedCount,
      hadError: HadError,
    };

    if(ArgPostHeartbeat)
      await this.#PostHeartbeatMessagesAsync(WorkspaceContexts);

    return PollResult;
  }

  /**
   * Post heartbeat messages for a completed poll cycle.
   * @param {Array<{ RemindersModule: RemindersModule, Summary: GitHubWorkspacePollSummary }>} ArgWorkspaceContexts Workspace contexts.
   * @returns {Promise<void>}
   */
  async #PostHeartbeatMessagesAsync(ArgWorkspaceContexts) {
    for(const CurrentContext of ArgWorkspaceContexts) {
      const CurrentSummary = CurrentContext.Summary;
      if(!CurrentSummary.heartbeatEnabled) continue;

      const HeartbeatChannelId = await this.#ResolveHeartbeatChannelIdAsync(CurrentContext.RemindersModule.SlackApp);
      if(!HeartbeatChannelId) continue;

      CurrentSummary.heartbeatChannelId = HeartbeatChannelId;

      try {
        await CurrentContext.RemindersModule.SlackApp.PostMessageTextAsync(
          HeartbeatChannelId,
          null,
          GitHubSyncModule.BuildHeartbeatCopy(CurrentSummary),
          undefined,
          { Tag: 'github-sync-heartbeat' }
        );
      } catch(error) {
        CurrentContext.RemindersModule.SlackApp.Logger.error(
          `[github-sync] failed to post heartbeat for workspace ${CurrentSummary.workspaceName}:`,
          error
        );
      }
    }
  }

  /**
   * Resolve and cache the heartbeat channel ID for a workspace.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @returns {Promise<string|null>}
   */
  async #ResolveHeartbeatChannelIdAsync(ArgSlackApp) {
    const WorkspaceName = ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME;
    const CachedChannelId = this.#HeartbeatChannelIdsByWorkspaceName.get(WorkspaceName);
    if(CachedChannelId)
      return CachedChannelId;

    const ReminderChannelName = ArgSlackApp.WorkspaceInfo.REMINDER_CHANNEL_NAME;
    const ResolvedChannelId = await ArgSlackApp.GetChannelIdAsync(ReminderChannelName);
    if(!ResolvedChannelId) {
      ArgSlackApp.Logger.warn(
        `[github-sync] could not resolve heartbeat channel ${ReminderChannelName} for workspace ${WorkspaceName}`
      );
      return null;
    }

    this.#HeartbeatChannelIdsByWorkspaceName.set(WorkspaceName, ResolvedChannelId);
    return ResolvedChannelId;
  }

  /**
   * Determine if a reminder should be auto-completed based on linked GitHub URLs.
   * @param {RemindersModule} ArgRemindersModule Reminder module.
   * @param {import('./reminders-module').ReminderInfo} ArgReminder Reminder to inspect.
   * @param {string} ArgWorkspacePat Workspace GitHub PAT.
   * @param {Map<string, GitHubStatusResult>} ArgStatusCache Per-cycle URL status cache.
   * @returns {Promise<GitHubCompletionDecision>}
   */
  async #ShouldAutoCompleteReminderAsync(ArgRemindersModule, ArgReminder, ArgWorkspacePat, ArgStatusCache) {
    const Urls = ArgReminder.GitHubUrls || [];
    const StatusResults = [];

    for(const CurrentUrl of Urls) {
      const StatusResult = await this.#GetGitHubStatusWithCacheAsync(CurrentUrl, ArgWorkspacePat, ArgStatusCache);
      StatusResults.push(StatusResult);
      // early exit: stop additional API calls on rate-limit or auth failure.
      if(StatusResult.stopCycle) break;
    }

    const Decision = GitHubSyncModule.EvaluateAutoComplete(Urls.slice(0, StatusResults.length), StatusResults);

    if(!Decision.shouldComplete && !Decision.stopCycle && Decision.blockingItem) {
      const BlockingReason = Decision.blockingItem.reason || `${Decision.blockingItem.type}:${Decision.blockingItem.state ?? 'unknown'}`;
      ArgRemindersModule.SlackApp.Logger.info(
        `[github-sync] reminder ${ArgReminder.ReminderID} remains active due to ${BlockingReason} at ${Decision.blockingItem.url}`
      );
    }

    return Decision;
  }

  /**
   * Evaluate whether a reminder should auto-complete given pre-fetched GitHub statuses.
   * Pure function — no network calls. Processes URLs in order and stops at the first
   * status that prevents completion, mirroring poll-cycle early-exit behavior.
   * @param {string[]} ArgGitHubUrls Ordered list of GitHub URLs on the reminder.
   * @param {GitHubStatusResult[]} ArgStatusResults Status result for each URL, same order.
   * Arrays must have identical length. A mismatch indicates a programming error in the caller.
   * @returns {GitHubCompletionDecision}
   */
  static EvaluateAutoComplete(ArgGitHubUrls, ArgStatusResults) {
    const Urls = ArgGitHubUrls || [];
    if(Urls.length !== ArgStatusResults.length)
      throw new Error('GitHubSyncModule.EvaluateAutoComplete requires equal-length URL and status arrays.');

    /** @type {GitHubCompletionItem[]} */
    const CompletionItems = [];

    for(let Index = 0; Index < Urls.length; Index++) {
      const Status = ArgStatusResults[Index];
      const CurrentUrl = Urls[Index];
      if(Status.stopCycle) {
        return {
          shouldComplete: false,
          stopCycle: true,
          completionItems: [],
          blockingItem: {
            url: CurrentUrl,
            type: Status.type,
            state: Status.state,
            reason: Status.failureMode || 'stop-cycle',
          }
        };
      }

      if(!Status.ok) {
        return {
          shouldComplete: false,
          stopCycle: false,
          completionItems: [],
          blockingItem: {
            url: CurrentUrl,
            type: Status.type,
            state: Status.state,
            reason: Status.failureMode || 'lookup-failed',
          }
        };
      }

      if(Status.state !== 'closed') {
        return {
          shouldComplete: false,
          stopCycle: false,
          completionItems: [],
          blockingItem: {
            url: CurrentUrl,
            type: Status.type,
            state: Status.state,
            reason: Status.type === 'pull' ? 'pull-open' : 'issue-open',
          }
        };
      }

      const CompletionType = Status.type === 'pull' ? 'pull' : 'issue';
      CompletionItems.push({
        url: CurrentUrl,
        type: CompletionType,
        outcome: CompletionType === 'pull'
          ? (Status.mergedAt ? 'pr-merged' : 'pr-closed')
          : 'issue-closed',
      });
    }

    return {
      shouldComplete: CompletionItems.length > 0,
      stopCycle: false,
      completionItems: CompletionItems,
      blockingItem: null,
    };
  }

  /**
   * Fetch GitHub status for a URL with per-cycle caching.
   * @param {string} ArgUrl GitHub URL to inspect.
   * @param {string} ArgWorkspacePat Workspace GitHub PAT.
   * @param {Map<string, GitHubStatusResult>} ArgStatusCache Per-cycle cache.
   * @returns {Promise<GitHubStatusResult>}
   */
  async #GetGitHubStatusWithCacheAsync(ArgUrl, ArgWorkspacePat, ArgStatusCache) {
    const Cached = ArgStatusCache.get(ArgUrl);
    if(Cached) return Cached;

    const ParsedUrl = this.#ParseGitHubUrl(ArgUrl);
    if(!ParsedUrl) {
      /** @type {GitHubStatusResult} */
      const InvalidResult = {
        ok: false,
        stopCycle: false,
        type: 'invalid',
        state: null,
      };
      ArgStatusCache.set(ArgUrl, InvalidResult);
      return InvalidResult;
    }

    /** @type {GitHubStatusResult} */
    let Result;
    if(ParsedUrl.type === 'issues')
      Result = await this.#CheckGitHubIssueAsync(ParsedUrl, ArgWorkspacePat);
    else
      Result = await this.#CheckGitHubPullRequestAsync(ParsedUrl, ArgWorkspacePat);

    ArgStatusCache.set(ArgUrl, Result);
    return Result;
  }

  /**
   * Parse a GitHub issue or pull request URL.
   * Delegates to the public static for testability.
   * @param {string} ArgUrl GitHub URL.
   * @returns {{ owner: string, repo: string, type: 'issues'|'pull', number: number }|null}
   */
  #ParseGitHubUrl(ArgUrl) {
    return GitHubSyncModule.ParseGitHubUrl(ArgUrl);
  }

  /**
   * Parse a GitHub issue or pull request URL.
   * @param {string} ArgUrl GitHub URL.
   * @returns {{ owner: string, repo: string, type: 'issues'|'pull', number: number }|null}
   */
  static ParseGitHubUrl(ArgUrl) {
    try {
      const ParsedUrl = new URL(ArgUrl);
      if(ParsedUrl.hostname !== 'github.com') return null;

      const Match = ParsedUrl.pathname.match(/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/(issues|pull)\/(\d+)\/?$/);
      if(!Match) return null;

      return {
        owner: Match[1],
        repo: Match[2],
        type: /** @type {'issues'|'pull'} */ (Match[3]),
        number: parseInt(Match[4], 10),
      };
    } catch {
      return null;
    }
  }

  /**
   * Check the status of a GitHub issue.
   * @param {{ owner: string, repo: string, type: 'issues'|'pull', number: number }} ArgParsedUrl Parsed GitHub URL.
   * @param {string} ArgWorkspacePat Workspace GitHub PAT.
   * @returns {Promise<GitHubStatusResult>}
   */
  async #CheckGitHubIssueAsync(ArgParsedUrl, ArgWorkspacePat) {
    const ApiUrl = `https://api.github.com/repos/${ArgParsedUrl.owner}/${ArgParsedUrl.repo}/issues/${ArgParsedUrl.number}`;
    return await this.#FetchGitHubStateAsync(ApiUrl, ArgWorkspacePat, 'issue');
  }

  /**
   * Check the status of a GitHub pull request.
   * @param {{ owner: string, repo: string, type: 'issues'|'pull', number: number }} ArgParsedUrl Parsed GitHub URL.
   * @param {string} ArgWorkspacePat Workspace GitHub PAT.
   * @returns {Promise<GitHubStatusResult>}
   */
  async #CheckGitHubPullRequestAsync(ArgParsedUrl, ArgWorkspacePat) {
    const ApiUrl = `https://api.github.com/repos/${ArgParsedUrl.owner}/${ArgParsedUrl.repo}/pulls/${ArgParsedUrl.number}`;
    return await this.#FetchGitHubStateAsync(ApiUrl, ArgWorkspacePat, 'pull');
  }

  /**
   * Fetch state from a GitHub API endpoint.
   * @param {string} ArgApiUrl GitHub API URL.
   * @param {string} ArgWorkspacePat Workspace GitHub PAT.
   * @param {'issue'|'pull'} ArgType Resource type.
   * @returns {Promise<GitHubStatusResult>}
   */
  async #FetchGitHubStateAsync(ArgApiUrl, ArgWorkspacePat, ArgType) {
    try {
      const Response = await fetch(ArgApiUrl, {
        headers: {
          Authorization: `Bearer ${ArgWorkspacePat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }
      });

      if(Response.status === 403) {
        this.#Logger.warn(`[github-sync] received 403 from GitHub for ${ArgApiUrl}`);
        // Preserve the existing issue-path stop-cycle behavior on 403 because issue checks
        // remain the primary completion path and a likely rate-limit should stop extra calls.
        // For PRs we keep the failure reminder-local so linked reminders stay active without
        // aborting unrelated issue checks.
        return {
          ok: false,
          stopCycle: ArgType === 'issue',
          type: ArgType,
          state: null,
          mergedAt: null,
          failureMode: 'forbidden',
        };
      }

      if(Response.status === 404) {
        this.#Logger.warn(`[github-sync] resource not found or inaccessible: ${ArgApiUrl}`);
        return { ok: false, stopCycle: false, type: ArgType, state: null, mergedAt: null, failureMode: 'not-found' };
      }

      if(!Response.ok) {
        this.#Logger.warn(`[github-sync] unexpected GitHub response ${Response.status} for ${ArgApiUrl}`);
        return { ok: false, stopCycle: false, type: ArgType, state: null, mergedAt: null, failureMode: 'unexpected-response' };
      }

      const Data = await Response.json();
      if(Data && (Data.state === 'open' || Data.state === 'closed')) {
        return {
          ok: true,
          stopCycle: false,
          type: ArgType,
          state: Data.state,
          mergedAt: typeof Data.merged_at === 'string' ? Data.merged_at : null,
          failureMode: null,
        };
      }

      this.#Logger.warn(`[github-sync] missing state in GitHub response for ${ArgApiUrl}`);
      return { ok: false, stopCycle: false, type: ArgType, state: null, mergedAt: null, failureMode: 'missing-state' };
    } catch(error) {
      this.#Logger.warn(`[github-sync] network error checking ${ArgApiUrl}: ${error.message}`);
      return { ok: false, stopCycle: false, type: ArgType, state: null, mergedAt: null, failureMode: 'network-error' };
    }
  }

  /**
   * Post a Slack notification for an auto-completed reminder.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @param {import('./reminders-module').ReminderInfo} ArgReminder Completed reminder.
   * @param {GitHubCompletionItem[]} ArgCompletionItems Completed GitHub items.
   * @returns {Promise<boolean>}
   */
  async #PostAutoCompleteNotificationAsync(ArgSlackApp, ArgReminder, ArgCompletionItems) {
    const ReminderSnippet = this.#BuildReminderSnippet(ArgReminder.ReminderMessageText);
    const NotificationSummary = GitHubSyncModule.BuildCompletionSummary(ArgCompletionItems);
    const NotificationText = `✅ Auto-completed: "${ReminderSnippet}" - ${NotificationSummary}\n${ArgCompletionItems.map(ArgItem => ArgItem.url).join('\n')}`;

    for(let Attempt = 1; Attempt <= 2; Attempt++) {
      try {
        await ArgSlackApp.PostMessageTextAsync(ArgReminder.TargetChannelID, null, NotificationText, undefined, { Tag: 'github-sync-autocomplete' });
        ArgSlackApp.Logger.info(
          `[github-sync] posted auto-complete notification for reminder ${ArgReminder.ReminderID}`
        );

        // mirror the notification into the originating thread for visibility on the
        // conversation that produced the reminder. Failures here are isolated so
        // the main-channel post outcome and the FSM transition both remain authoritative.
        await this.#PostOriginatingThreadNotificationAsync(ArgSlackApp, ArgReminder, NotificationText);

        return true;
      } catch(error) {
        if(Attempt < 2) {
          ArgSlackApp.Logger.warn(
            `[github-sync] notification post failed for reminder ${ArgReminder.ReminderID}; retrying once:`,
            error
          );
          continue;
        }

        ArgSlackApp.Logger.error(
          `[github-sync] failed to post auto-complete notification for reminder ${ArgReminder.ReminderID} after retry:`,
          error
        );
      }
    }

    return false;
  }

  /**
   * Mirror an auto-complete notification into the originating Slack thread when its coordinates exist.
   * Skips silently when OriginalChannelID or the thread anchor is missing (legacy reminders).
   * Failures are logged at warn level and never propagate.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @param {import('./reminders-module').ReminderInfo} ArgReminder Completed reminder.
   * @param {string} ArgNotificationText Notification text to post.
   * @returns {Promise<void>}
   */
  async #PostOriginatingThreadNotificationAsync(ArgSlackApp, ArgReminder, ArgNotificationText) {
    const OriginalChannelID = ArgReminder.OriginalChannelID;
    const OriginalThreadAnchor = ArgReminder.OriginalThreadTs ?? ArgReminder.OriginalMessageID;

    // skip when we have no coordinates for the originating thread.
    if(!OriginalChannelID || !OriginalThreadAnchor) return;

    try {
      await ArgSlackApp.PostMessageTextAsync(OriginalChannelID, OriginalThreadAnchor, ArgNotificationText, undefined, { Tag: 'github-sync-thread-mirror' });
      ArgSlackApp.Logger.info(
        `[github-sync] mirrored auto-complete notification to originating thread for reminder ${ArgReminder.ReminderID}`
      );
    } catch(error) {
      ArgSlackApp.Logger.warn(
        `[github-sync] failed to mirror auto-complete notification to originating thread for reminder ${ArgReminder.ReminderID}:`,
        error
      );
    }
  }

  /**
   * Build a compact snippet for reminder text.
   * Delegates to SlackFormatUtils.BuildReminderSnippet for testable, shared logic.
   * @param {string} ArgReminderMessageText Reminder message text.
   * @returns {string}
   */
  #BuildReminderSnippet(ArgReminderMessageText) {
    return SlackFormatUtils.BuildReminderSnippet(ArgReminderMessageText);
  }

  /**
   * Build a human-readable completion summary for Slack notifications.
   * @param {GitHubCompletionItem[]} ArgCompletionItems Completed GitHub items.
   * @returns {string}
   */
  static BuildCompletionSummary(ArgCompletionItems) {
    const CompletionItems = ArgCompletionItems || [];
    if(CompletionItems.length === 0)
      return 'linked GitHub items were completed.';

    if(CompletionItems.length === 1) {
      const SingleItem = CompletionItems[0];
      if(SingleItem.outcome === 'issue-closed') return 'linked GitHub issue was closed.';
      if(SingleItem.outcome === 'pr-merged') return 'linked GitHub PR was merged.';
      return 'linked GitHub PR was closed.';
    }

    const OutcomeCounts = {
      'issue-closed': 0,
      'pr-merged': 0,
      'pr-closed': 0,
    };

    for(const CurrentItem of CompletionItems)
      OutcomeCounts[CurrentItem.outcome] += 1;

    /** @type {string[]} */
    const SummaryParts = [];
    if(OutcomeCounts['issue-closed'] > 0)
      SummaryParts.push(`${OutcomeCounts['issue-closed']} ${OutcomeCounts['issue-closed'] === 1 ? 'issue' : 'issues'} closed`);
    if(OutcomeCounts['pr-merged'] > 0)
      SummaryParts.push(`${OutcomeCounts['pr-merged']} ${OutcomeCounts['pr-merged'] === 1 ? 'PR' : 'PRs'} merged`);
    if(OutcomeCounts['pr-closed'] > 0)
      SummaryParts.push(`${OutcomeCounts['pr-closed']} ${OutcomeCounts['pr-closed'] === 1 ? 'PR' : 'PRs'} closed`);

    return `linked GitHub items were completed (${SummaryParts.join(', ')}).`;
  }

  /**
   * Build a compact audit reason for completion logs.
   * @param {GitHubCompletionItem[]} ArgCompletionItems Completed GitHub items.
   * @returns {string}
   */
  static BuildCompletionReason(ArgCompletionItems) {
    return ArgCompletionItems.map(ArgItem => `${ArgItem.outcome} ${ArgItem.url}`).join(', ');
  }

  /**
   * Build a workspace poll summary object.
   * @param {import('./workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace info.
   * @returns {GitHubWorkspacePollSummary}
   */
  static CreateWorkspacePollSummary(ArgWorkspaceInfo) {
    return {
      workspaceName: ArgWorkspaceInfo.WORKSPACE_NAME,
      reminderChannelName: ArgWorkspaceInfo.REMINDER_CHANNEL_NAME,
      heartbeatEnabled: GitHubSyncModule.IsHeartbeatEnabled(ArgWorkspaceInfo),
      heartbeatChannelId: null,
      eligibleReminderCount: 0,
      checkedReminderCount: 0,
      autoCompletedCount: 0,
      cycleStatus: 'pending',
      skippedReason: null,
      errorMessage: null,
      stopCycle: false,
    };
  }

  /**
   * Determine whether heartbeat posting is enabled for a workspace.
   * @param {import('./workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace info.
   * @returns {boolean}
   */
  static IsHeartbeatEnabled(ArgWorkspaceInfo) {
    const RawFlag = (ArgWorkspaceInfo.GITHUB_SYNC_HEARTBEAT_ENABLED || '').toLowerCase();
    return RawFlag === 'true' || RawFlag === 'yes';
  }

  /**
   * Build heartbeat copy for a workspace summary.
   * @param {GitHubWorkspacePollSummary} ArgSummary Workspace summary.
   * @returns {string}
   */
  static BuildHeartbeatCopy(ArgSummary) {
    if(ArgSummary.cycleStatus === 'skipped')
      return `GitHub sync heartbeat: skipped for workspace ${ArgSummary.workspaceName} because ${ArgSummary.skippedReason}.`;

    if(ArgSummary.cycleStatus === 'error' || ArgSummary.cycleStatus === 'stopped') {
      return `GitHub sync heartbeat: cycle encountered an error after checking ${ArgSummary.checkedReminderCount} GitHub-linked reminder(s) in workspace ${ArgSummary.workspaceName}. Review logs for details.`;
    }

    return `GitHub sync heartbeat: cycle completed for workspace ${ArgSummary.workspaceName}. Checked ${ArgSummary.checkedReminderCount} GitHub-linked reminder(s); auto-completed ${ArgSummary.autoCompletedCount}.`;
  }

  /**
   * Build the manual sync result message from a poll result.
   * @param {GitHubPollResult} ArgPollResult Poll result.
   * @returns {string}
   */
  static BuildRunNowMessage(ArgPollResult) {
    const ErrorCount = ArgPollResult.workspaceSummaries.filter(ArgSummary => {
      return ArgSummary.cycleStatus === 'error' || ArgSummary.cycleStatus === 'stopped';
    }).length;

    if(ErrorCount > 0) {
      return `GitHub sync completed with issues. Checked ${ArgPollResult.totalCheckedReminderCount} GitHub-linked reminder(s); auto-completed ${ArgPollResult.totalAutoCompletedCount}.`;
    }

    return `GitHub sync completed. Checked ${ArgPollResult.totalCheckedReminderCount} GitHub-linked reminder(s); auto-completed ${ArgPollResult.totalAutoCompletedCount}.`;
  }

  /**
   * Build a debug command result for a single GitHub URL using the same completion semantics
   * as the real poll path.
   * @param {string} ArgUrl GitHub URL.
   * @param {{ owner: string, repo: string, type: 'issues'|'pull', number: number }} ArgParsedUrl Parsed GitHub URL.
   * @param {GitHubStatusResult} ArgStatusResult Status result for the URL.
   * @returns {GitHubDebugResult}
   */
  static BuildSingleUrlDebugResult(ArgUrl, ArgParsedUrl, ArgStatusResult) {
    if(!ArgStatusResult.ok) {
      if(ArgStatusResult.stopCycle) {
        return {
          ok: false,
          message: `GitHub lookup for ${ArgUrl} was rate-limited or forbidden.`
        };
      }

      if(ArgParsedUrl.type === 'pull') {
        return {
          ok: false,
          message: `GitHub lookup could not confirm the pull request status for ${ArgUrl}. Linked reminders would remain active until the lookup succeeds.`
        };
      }

      return {
        ok: false,
        message: `GitHub lookup failed for ${ArgUrl}.`
      };
    }

    const Decision = GitHubSyncModule.EvaluateAutoComplete([ArgUrl], [ArgStatusResult]);
    const AutoCompleteMessage = ArgParsedUrl.type === 'issues'
      ? (Decision.shouldComplete
          ? 'This issue is closed and would be eligible for auto-complete if all linked URLs on the reminder are complete.'
          : 'This issue is open and would not auto-complete a reminder.')
      : (Decision.shouldComplete
          ? (ArgStatusResult.mergedAt
              ? 'This pull request was merged and would be eligible for auto-complete if all linked URLs on the reminder are complete.'
              : 'This pull request was closed without merge and would still be eligible for auto-complete if all linked URLs on the reminder are complete.')
          : 'This pull request is open and would keep a reminder active.');

    return {
      ok: true,
      message: `GitHub lookup succeeded for ${ArgUrl}. Type: ${ArgParsedUrl.type}. State: ${ArgStatusResult.state}. ${AutoCompleteMessage}`
    };
  }
}

/**
 * GitHub URL status result.
 * @typedef {Object} GitHubStatusResult
 * @property {boolean} ok Was the lookup successful?
 * @property {boolean} stopCycle Should the current poll cycle stop?
 * @property {'issue'|'pull'|'invalid'} type Resource type.
 * @property {'open'|'closed'|null} state Current GitHub state.
 * @property {string|null} [mergedAt] Pull request merge timestamp when available.
 * @property {'forbidden'|'not-found'|'unexpected-response'|'missing-state'|'network-error'|null} [failureMode] Failure mode when ok is false.
 */

/**
 * GitHub completion item used for notifications and audit logs.
 * @typedef {Object} GitHubCompletionItem
 * @property {string} url Completed GitHub URL.
 * @property {'issue'|'pull'} type Resource type.
 * @property {'issue-closed'|'pr-merged'|'pr-closed'} outcome Completion outcome.
 */

/**
 * Completion decision for a reminder after checking all linked GitHub URLs.
 * @typedef {Object} GitHubCompletionDecision
 * @property {boolean} shouldComplete Should the reminder auto-complete?
 * @property {boolean} stopCycle Should the current poll cycle stop?
 * @property {GitHubCompletionItem[]} completionItems Completed items contributing to completion.
 * @property {{url: string, type: 'issue'|'pull'|'invalid', state: 'open'|'closed'|null, reason: string|null}|null} blockingItem Blocking item when shouldComplete is false.
 */

/**
 * GitHub debug command result.
 * @typedef {Object} GitHubDebugResult
 * @property {boolean} ok Was the debug test successful?
 * @property {string} message Human-readable result message.
 */

/**
 * Workspace-level GitHub poll summary.
 * @typedef {Object} GitHubWorkspacePollSummary
 * @property {string} workspaceName Workspace name.
 * @property {string} reminderChannelName Configured reminder channel name.
 * @property {boolean} heartbeatEnabled Is heartbeat posting enabled for this workspace?
 * @property {string|null} heartbeatChannelId Cached/resolved heartbeat channel ID when available.
 * @property {number} eligibleReminderCount Reminder count eligible for GitHub checks.
 * @property {number} checkedReminderCount Reminder count actually checked in the cycle.
 * @property {number} autoCompletedCount Reminder count auto-completed in the cycle.
 * @property {'pending'|'completed'|'skipped'|'error'|'stopped'} cycleStatus Workspace cycle status.
 * @property {string|null} skippedReason Reason when the workspace was skipped.
 * @property {string|null} errorMessage Error text when the cycle failed or stopped early.
 * @property {boolean} stopCycle Did this workspace stop the overall cycle early?
 */

/**
 * Aggregate GitHub poll result.
 * @typedef {Object} GitHubPollResult
 * @property {GitHubWorkspacePollSummary[]} workspaceSummaries Per-workspace summaries.
 * @property {number} totalEligibleReminderCount Total eligible reminders across workspaces.
 * @property {number} totalCheckedReminderCount Total checked reminders across workspaces.
 * @property {number} totalAutoCompletedCount Total auto-completed reminders across workspaces.
 * @property {boolean} hadError Did any workspace encounter an error or stop-cycle condition?
 */

module.exports = GitHubSyncModule;
