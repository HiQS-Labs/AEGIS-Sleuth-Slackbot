
'use strict';

const fs = require('fs').promises;
const path = require('path');
const workspaces = require('./workspaces');
const { WriteFileDurableAsync } = require('./durable-write');
const { BaseModule } = require('./base-module');
const {
  PlanRepoActions,
  NextCursor,
  PruneState,
  EmptyState,
} = require('./github-issue-stream-planner');
const { CanonicalRepoKey } = require('./github-url-utils');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_POST_BUDGET = 40;
const DEFAULT_POST_GAP_MS = 1100;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_ALLOWLIST_MAX = 200;
const DEFAULT_ALLOWLIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_FLOOR = 200;
const AUDIT_TAG = 'github-issue-stream';

/**
 * @typedef {object} RateLimitInfo
 * @property {number} [Remaining]
 * @property {number} [Reset]
 * @property {number} [RetryAfter]
 */

/**
 * @typedef {object} GithubListResult
 * @property {any[]} Items
 * @property {RateLimitInfo} RateLimit
 * @property {number} [Status]
 * @property {string} [Error]
 */

/**
 * @typedef {object} GithubIssueStreamClient
 * @property {(ArgRepo: string, ArgSince: string) => Promise<GithubListResult>} ListIssuesSinceAsync
 * @property {(ArgRepo: string, ArgSince: string) => Promise<GithubListResult>} ListIssueCommentsSinceAsync
 * @property {() => Promise<Array<{ name: string, sha: string }>>} ListAllowlistFilesAsync
 * @property {(ArgName: string) => Promise<string>} GetAllowlistFileAsync
 */

/**
 * @typedef {object} GitHubIssueStreamConfig
 * @property {boolean} [enabled]
 * @property {string} [channelId]
 * @property {string} [pat]
 * @property {string} [statePath]
 * @property {number} [pollIntervalMs]
 * @property {number} [postBudget]
 * @property {number} [postGapMs]
 * @property {GithubIssueStreamClient} [githubClient]
 * @property {() => Date} [now]
 * @property {(ArgMs: number) => Promise<void>} [sleepAsync]
 */

/**
 * Build the default GitHub API client using global fetch (Node 18+).
 * @param {{ Pat: string, PulseRepo: string, PulseBranch: string, PulseDir: string }} ArgConfig
 * @returns {GithubIssueStreamClient}
 */
function BuildDefaultGithubClient(ArgConfig) {
  const Headers = {
    Authorization: `Bearer ${ArgConfig.Pat}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sleuth-github-issue-stream',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  /**
   * @param {Response} ArgResponse
   * @returns {RateLimitInfo}
   */
  function ReadRateLimit(ArgResponse) {
    return {
      Remaining: Number(ArgResponse.headers.get('x-ratelimit-remaining') || NaN),
      Reset: Number(ArgResponse.headers.get('x-ratelimit-reset') || NaN),
      RetryAfter: Number(ArgResponse.headers.get('retry-after') || NaN),
    };
  }

  /**
   * @param {string} ArgUrl
   * @returns {Promise<GithubListResult>}
   */
  async function FetchJsonListAsync(ArgUrl) {
    const Response = await fetch(ArgUrl, { headers: Headers });
    const RateLimit = ReadRateLimit(Response);
    if(Response.status === 404)
      return { Items: [], RateLimit, Status: 404, Error: 'not found' };
    if(Response.status === 403 || Response.status === 429) {
      const Body = await Response.text();
      return {
        Items: [],
        RateLimit,
        Status: Response.status,
        Error: Body.slice(0, 200),
      };
    }
    if(!Response.ok) {
      const Body = await Response.text();
      throw new Error(`GitHub ${Response.status}: ${Body.slice(0, 200)}`);
    }
    const Items = await Response.json();
    return { Items: Array.isArray(Items) ? Items : [], RateLimit, Status: Response.status };
  }

  /**
   * Paginate a since-filtered list endpoint.
   * @param {string} ArgBaseUrl
   * @returns {Promise<GithubListResult>}
   */
  async function PaginateSinceAsync(ArgBaseUrl) {
    /** @type {any[]} */
    const Items = [];
    /** @type {RateLimitInfo} */
    let RateLimit = {};
    for(let Page = 1; Page <= DEFAULT_MAX_PAGES; Page++) {
      const Separator = ArgBaseUrl.includes('?') ? '&' : '?';
      const Url = `${ArgBaseUrl}${Separator}per_page=100&page=${Page}`;
      const Result = await FetchJsonListAsync(Url);
      RateLimit = Result.RateLimit;
      if(Result.Status === 403 || Result.Status === 429)
        return { Items, RateLimit, Status: Result.Status, Error: Result.Error };
      if(Result.Status === 404)
        return { Items: [], RateLimit, Status: 404, Error: Result.Error };
      Items.push(...Result.Items);
      if(Result.Items.length < 100) break;
    }
    return { Items, RateLimit, Status: 200 };
  }

  return {
    /**
     * @param {string} ArgRepo
     * @param {string} ArgSince
     * @returns {Promise<GithubListResult>}
     */
    async ListIssuesSinceAsync(ArgRepo, ArgSince) {
      const Encoded = ArgRepo.split('/').map(encodeURIComponent).join('/');
      const Since = encodeURIComponent(ArgSince);
      return PaginateSinceAsync(
        `https://api.github.com/repos/${Encoded}/issues?state=all&since=${Since}&sort=updated&direction=asc`
      );
    },

    /**
     * @param {string} ArgRepo
     * @param {string} ArgSince
     * @returns {Promise<GithubListResult>}
     */
    async ListIssueCommentsSinceAsync(ArgRepo, ArgSince) {
      const Encoded = ArgRepo.split('/').map(encodeURIComponent).join('/');
      const Since = encodeURIComponent(ArgSince);
      return PaginateSinceAsync(
        `https://api.github.com/repos/${Encoded}/issues/comments?since=${Since}&sort=updated&direction=asc`
      );
    },

    /**
     * @returns {Promise<Array<{ name: string, sha: string }>>}
     */
    async ListAllowlistFilesAsync() {
      if(!ArgConfig.PulseRepo) return [];
      const PulsePat = process.env.SLEUTH_RAG_GITHUB_PAT || ArgConfig.Pat;
      const Url = `https://api.github.com/repos/${ArgConfig.PulseRepo}/contents/${ArgConfig.PulseDir}?ref=${ArgConfig.PulseBranch}`;
      const Response = await fetch(Url, {
        headers: {
          ...Headers,
          Authorization: `Bearer ${PulsePat}`,
        },
      });
      if(Response.status === 404) return [];
      if(!Response.ok) {
        const Body = await Response.text();
        throw new Error(`GitHub list allowlist ${Response.status}: ${Body.slice(0, 200)}`);
      }
      const Entries = await Response.json();
      return (Array.isArray(Entries) ? Entries : [])
        .filter((/** @type {any} */ ArgEntry) => ArgEntry.type === 'file' && ArgEntry.name.endsWith('.json'))
        .map((/** @type {any} */ ArgEntry) => ({ name: ArgEntry.name, sha: ArgEntry.sha }));
    },

    /**
     * @param {string} ArgName
     * @returns {Promise<string>}
     */
    async GetAllowlistFileAsync(ArgName) {
      if(!ArgConfig.PulseRepo) return '';
      const PulsePat = process.env.SLEUTH_RAG_GITHUB_PAT || ArgConfig.Pat;
      const Url = `https://api.github.com/repos/${ArgConfig.PulseRepo}/contents/${encodeURIComponent(ArgConfig.PulseDir)}/${encodeURIComponent(ArgName)}?ref=${ArgConfig.PulseBranch}`;
      const Response = await fetch(Url, {
        headers: {
          ...Headers,
          Authorization: `Bearer ${PulsePat}`,
        },
      });
      if(!Response.ok) {
        const Body = await Response.text();
        throw new Error(`GitHub get allowlist ${Response.status}: ${Body.slice(0, 200)}`);
      }
      const Meta = await Response.json();
      if(Meta.encoding === 'base64')
        return Buffer.from(Meta.content, 'base64').toString('utf8');
      if(Meta.download_url) {
        const Raw = await fetch(Meta.download_url, {
          headers: { Authorization: `Bearer ${PulsePat}` },
        });
        return Raw.text();
      }
      throw new Error(`unexpected encoding '${Meta.encoding}' for ${ArgName}`);
    },
  };
}

/**
 * Stream new GitHub issues from allowlisted repos into one Slack channel, threading
 * follow-up activity (comments, referencing PRs, close/reopen) under each issue's parent post.
 *
 * Lifecycle:
 *  1. StartAsync() loads state; on first run seeds every repo cursor to now (no backlog), then starts the timer.
 *  2. RunOnceAsync() runs one poll cycle (see #RunCycleAsync); safe to call directly from tests.
 *  3. StopAsync() clears the timer and is idempotent.
 *
 * Delivery guarantee: an event key is persisted only after Slack confirms the post, and a repo cursor
 * advances only when every planned action for that repo was delivered, so restarts never duplicate posts
 * and failures never skip them.
 *
 * Enabled only when this workspace is in GITHUB_ISSUE_STREAM_WORKSPACES, GITHUB_ISSUE_STREAM_CHANNEL_ID
 * is set, and WorkspaceInfo.GITHUB_PAT exists (default OFF).
 */
class GitHubIssueStreamModule extends BaseModule {
  /** @type {import('./reminders-dnd-settings')} */
  #DndSettings;

  /**
   * @type {{
   *   Enabled: boolean,
   *   ChannelID: string,
   *   Pat: string,
   *   StatePath: string,
   *   PollIntervalMs: number,
   *   PostBudget: number,
   *   PostGapMs: number,
   *   IgnoreAuthors: Set<string>,
   *   ExplicitRepos: string[]|null,
   *   OrgFilter: Set<string>|null,
   *   GithubClient: GithubIssueStreamClient,
   *   Now: () => Date,
   *   SleepAsync: (ms: number) => Promise<void>,
   * }}
   */
  #Config;

  /** @type {import('./github-issue-stream-planner').IssueStreamState} */
  #State = EmptyState();

  /** @type {NodeJS.Timeout|null} */
  #TimerID = null;

  /** @type {boolean} */
  #Active = false;

  /** @type {boolean} */
  #CycleRunning = false;

  /** @type {number} */
  #BackoffUntil = 0;

  /**
   * @param {import('./slack-app')} ArgSlackApp Per-workspace SlackApp this module posts through.
   * @param {import('./reminders-dnd-settings')} ArgDndSettings DND settings owned by this workspace's RemindersModule (read-only).
   * @param {GitHubIssueStreamConfig} [ArgConfig] Overrides for tests (githubClient, statePath, now, channelId, enabled).
   */
  constructor(ArgSlackApp, ArgDndSettings, ArgConfig = {}) {
    super(ArgSlackApp);
    this.#DndSettings = ArgDndSettings;

    const WorkspaceName = this.WorkspaceName || '';
    const EnvAllowlist = (process.env.GITHUB_ISSUE_STREAM_WORKSPACES || '')
      .split(',')
      .map((ArgName) => ArgName.trim())
      .filter(Boolean);
    const ChannelID = ArgConfig.channelId
      ?? process.env.GITHUB_ISSUE_STREAM_CHANNEL_ID
      ?? '';
    const Pat = ArgConfig.pat ?? this.WorkspaceInfo.GITHUB_PAT ?? '';
    const EnabledViaEnv = EnvAllowlist.includes(WorkspaceName);
    let ShouldEnable = ArgConfig.enabled ?? (EnabledViaEnv && Boolean(ChannelID));

    if(EnabledViaEnv && !ChannelID) {
      this.Logger.warn(
        `${AUDIT_TAG}: workspace is allowlisted but GITHUB_ISSUE_STREAM_CHANNEL_ID is unset — staying disabled`
      );
      ShouldEnable = false;
    }
    if(ShouldEnable && !Pat) {
      this.Logger.warn(`${AUDIT_TAG}: enabled but no GITHUB_PAT found — staying disabled`);
      ShouldEnable = false;
    }

    const ExplicitReposRaw = process.env.GITHUB_ISSUE_STREAM_REPOS || '';
    const ExplicitRepos = ExplicitReposRaw
      ? ExplicitReposRaw.split(',').map((ArgRepo) => ArgRepo.trim()).filter(Boolean)
      : null;
    const OrgFilterRaw = process.env.GITHUB_ISSUE_STREAM_ORG_FILTER || '';
    const OrgFilter = OrgFilterRaw
      ? new Set(OrgFilterRaw.split(',').map((ArgOrg) => ArgOrg.trim().toLowerCase()).filter(Boolean))
      : null;
    const IgnoreAuthors = new Set(
      (process.env.GITHUB_ISSUE_STREAM_IGNORE_AUTHORS || '')
        .split(',')
        .map((ArgLogin) => ArgLogin.trim().toLowerCase())
        .filter(Boolean)
    );

    const PulseRepo = process.env.SNAPSHOT_RELAY_REPO || process.env.HIQS_DIGEST_REPO || '';
    const PulseBranch = process.env.SNAPSHOT_RELAY_BRANCH || process.env.HIQS_DIGEST_BRANCH || 'main';
    const DefaultStatePath = workspaces.GetSubdirPath(
      'github-issue-stream',
      `${WorkspaceName}_github-issue-stream.json`
    );

    const ClientConfig = {
      Pat,
      PulseRepo,
      PulseBranch,
      PulseDir: 'sync/repos',
    };

    this.#Config = {
      Enabled: ShouldEnable,
      ChannelID,
      Pat,
      StatePath: ArgConfig.statePath ?? DefaultStatePath,
      PollIntervalMs: Number(ArgConfig.pollIntervalMs ?? process.env.GITHUB_ISSUE_STREAM_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
      PostBudget: Number(ArgConfig.postBudget ?? DEFAULT_POST_BUDGET),
      PostGapMs: Number(ArgConfig.postGapMs ?? DEFAULT_POST_GAP_MS),
      IgnoreAuthors,
      ExplicitRepos,
      OrgFilter,
      GithubClient: ArgConfig.githubClient ?? BuildDefaultGithubClient(ClientConfig),
      Now: ArgConfig.now ?? (() => new Date()),
      SleepAsync: ArgConfig.sleepAsync ?? ((ArgMs) => new Promise((ArgResolve) => setTimeout(ArgResolve, ArgMs))),
    };
  }

  /**
   * Resolved state path (tests only).
   * @returns {string}
   */
  get StatePathForTest() {
    return this.#Config.StatePath;
  }

  /**
   * Whether the module is enabled (tests only).
   * @returns {boolean}
   */
  get EnabledForTest() {
    return this.#Config.Enabled;
  }

  /**
   * Start the stream. Returns immediately when not enabled.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    if(!this.#Config.Enabled) {
      this.Logger.info(`${AUDIT_TAG}: disabled — StartAsync is a no-op`);
      return;
    }

    this.#Active = true;
    const HadPersistedState = await this.#LoadStateAsync();
    if(!HadPersistedState) {
      this.Logger.info(`${AUDIT_TAG}: first run — seeding cursors to now, no backlog posts`);
      await this.#SeedAllowlistAsync(true);
      await this.#SaveStateAsync();
    } else {
      this.Logger.info(
        `${AUDIT_TAG}: resuming with ${Object.keys(this.#State.Issues).length} mapped issue(s)`
      );
    }
    this.#ScheduleNextPoll();
  }

  /**
   * Run one poll cycle. Safe to call directly from tests.
   * @returns {Promise<void>}
   */
  async RunOnceAsync() {
    if(!this.#Active && !this.#Config.Enabled) return;
    if(!this.#Config.Enabled) return;
    await this.#RunCycleAsync();
  }

  /**
   * Stop the stream and clear the poll timer.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    if(this.#TimerID !== null) {
      clearTimeout(this.#TimerID);
      this.#TimerID = null;
    }
    this.#Active = false;
  }

  /**
   * One poll cycle.
   * @returns {Promise<void>}
   */
  async #RunCycleAsync() {
    if(this.#CycleRunning) return;
    this.#CycleRunning = true;
    const Started = Date.now();
    let Posted = 0;
    let Held = 0;
    let Skipped = 0;

    try {
      if(Date.now() < this.#BackoffUntil) {
        this.Logger.info(`${AUDIT_TAG}: backing off until ${new Date(this.#BackoffUntil).toISOString()}`);
        return;
      }

      if(this.#DndSettings?.IsWorkspaceDnd?.() || this.#DndSettings?.IsChannelDnd?.(this.#Config.ChannelID)) {
        this.Logger.info(`${AUDIT_TAG}: held for DND`);
        Held = 1;
        return;
      }

      const Allowlist = await this.#ResolveAllowlistAsync();
      let RemainingBudget = this.#Config.PostBudget;

      for(const Repo of Allowlist) {
        if(RemainingBudget <= 0) break;

        if(!this.#State.Repos[Repo]) {
          const NowIso = this.#Config.Now().toISOString();
          this.#State.Repos[Repo] = { Cursor: NowIso, SeededAt: NowIso };
          await this.#SaveStateAsync();
          this.Logger.info(`${AUDIT_TAG}: seeded new repo ${Repo} at ${NowIso}`);
          continue;
        }

        const Cursor = this.#State.Repos[Repo].Cursor;
        let IssuesResult;
        let CommentsResult;
        try {
          IssuesResult = await this.#Config.GithubClient.ListIssuesSinceAsync(Repo, Cursor);
          if(IssuesResult.Status === 403 || IssuesResult.Status === 429) {
            this.#ArmBackoff(IssuesResult.RateLimit);
            this.Logger.warn(`${AUDIT_TAG}: GitHub ${IssuesResult.Status} on ${Repo} — stopping cycle`);
            break;
          }
          if(IssuesResult.Status === 404) {
            this.Logger.warn(`${AUDIT_TAG}: repo not found or inaccessible: ${Repo}`);
            Skipped += 1;
            continue;
          }
          if(this.#RateLimitExhausted(IssuesResult.RateLimit)) {
            this.Logger.warn(`${AUDIT_TAG}: rate-limit floor hit — stopping cycle`);
            break;
          }

          CommentsResult = await this.#Config.GithubClient.ListIssueCommentsSinceAsync(Repo, Cursor);
          if(CommentsResult.Status === 403 || CommentsResult.Status === 429) {
            this.#ArmBackoff(CommentsResult.RateLimit);
            this.Logger.warn(`${AUDIT_TAG}: GitHub ${CommentsResult.Status} on comments for ${Repo} — stopping cycle`);
            break;
          }
          if(this.#RateLimitExhausted(CommentsResult.RateLimit)) {
            this.Logger.warn(`${AUDIT_TAG}: rate-limit floor hit — stopping cycle`);
            break;
          }
        } catch(error) {
          this.Logger.error(
            `${AUDIT_TAG}: fetch failed for ${Repo} (non-fatal):`,
            error instanceof Error ? error.message : String(error)
          );
          Skipped += 1;
          continue;
        }

        const Actions = PlanRepoActions(
          this.#State,
          Repo,
          IssuesResult.Items,
          CommentsResult.Items,
          { IgnoreAuthors: this.#Config.IgnoreAuthors }
        );

        let DeliveredAll = true;
        for(const Action of Actions) {
          if(RemainingBudget <= 0) {
            DeliveredAll = false;
            break;
          }
          try {
            const ThreadTs = Action.Kind === 'parent'
              ? null
              : this.#State.Issues[Action.IssueKey]?.ThreadTs ?? null;
            if(Action.Kind === 'reply' && !ThreadTs) {
              // parent not yet persisted (should not happen: parents precede replies in planner output).
              DeliveredAll = false;
              break;
            }
            const PostedTs = await this.SlackApp.PostMessageTextAsync(
              this.#Config.ChannelID,
              ThreadTs,
              Action.Text,
              undefined,
              { Tag: AUDIT_TAG }
            );
            if(!PostedTs) {
              DeliveredAll = false;
              break;
            }
            this.#ApplySuccessfulPost(Action, PostedTs);
            await this.#SaveStateAsync();
            Posted += 1;
            RemainingBudget -= 1;
            if(RemainingBudget > 0 && this.#Config.PostGapMs > 0)
              await this.#Config.SleepAsync(this.#Config.PostGapMs);
          } catch(error) {
            this.Logger.error(
              `${AUDIT_TAG}: Slack post failed for ${Action.IssueKey} ${Action.EventKey}:`,
              error instanceof Error ? error.message : String(error)
            );
            DeliveredAll = false;
            break;
          }
        }

        if(DeliveredAll) {
          this.#State.Repos[Repo].Cursor = NextCursor(
            IssuesResult.Items,
            CommentsResult.Items,
            Cursor
          );
          await this.#SaveStateAsync();
        } else {
          // leave cursor unchanged so undelivered events retry; PostedKeys prevent duplicates.
          break;
        }
      }

      PruneState(this.#State, this.#Config.Now(), Allowlist);
      await this.#SaveStateAsync();
    } finally {
      this.#CycleRunning = false;
      this.Logger.info(
        `${AUDIT_TAG}: ws=${this.WorkspaceName} repos=${Object.keys(this.#State.Repos).length} ` +
        `posted=${Posted} held=${Held} skipped=${Skipped} ms=${Date.now() - Started}`
      );
    }
  }

  /**
   * Record a successful Slack post into in-memory state.
   * @param {import('./github-issue-stream-planner').StreamAction} ArgAction
   * @param {string} ArgPostedTs
   */
  #ApplySuccessfulPost(ArgAction, ArgPostedTs) {
    if(ArgAction.Kind === 'parent') {
      this.#State.Issues[ArgAction.IssueKey] = {
        ChannelID: this.#Config.ChannelID,
        ThreadTs: ArgPostedTs,
        PostedKeys: [ArgAction.EventKey],
        Closed: Boolean(ArgAction.MarkClosed),
        LastActivityAt: ArgAction.EventAt,
      };
      return;
    }
    const Thread = this.#State.Issues[ArgAction.IssueKey];
    if(!Thread) return;
    if(!Thread.PostedKeys.includes(ArgAction.EventKey))
      Thread.PostedKeys.push(ArgAction.EventKey);
    Thread.LastActivityAt = ArgAction.EventAt;
    if(ArgAction.MarkClosed) Thread.Closed = true;
    if(ArgAction.MarkOpen) Thread.Closed = false;
  }

  /**
   * @param {RateLimitInfo} ArgRateLimit
   */
  #ArmBackoff(ArgRateLimit) {
    const Now = Date.now();
    if(Number.isFinite(ArgRateLimit.RetryAfter) && ArgRateLimit.RetryAfter > 0) {
      this.#BackoffUntil = Now + ArgRateLimit.RetryAfter * 1000;
      return;
    }
    if(Number.isFinite(ArgRateLimit.Reset) && ArgRateLimit.Reset > 0) {
      this.#BackoffUntil = Math.max(Now + 1000, ArgRateLimit.Reset * 1000);
      return;
    }
    this.#BackoffUntil = Now + 5 * 60 * 1000;
  }

  /**
   * @param {RateLimitInfo} ArgRateLimit
   * @returns {boolean}
   */
  #RateLimitExhausted(ArgRateLimit) {
    return Number.isFinite(ArgRateLimit.Remaining) && ArgRateLimit.Remaining < RATE_LIMIT_FLOOR;
  }

  /**
   * Resolve the repo allowlist for this cycle.
   * @returns {Promise<string[]>}
   */
  async #ResolveAllowlistAsync() {
    /** @type {string[]} */
    let Repos = [];
    if(this.#Config.ExplicitRepos) {
      Repos = this.#Config.ExplicitRepos;
    } else {
      try {
        Repos = await this.#LoadAllowlistFromPulseAsync();
        if(Repos.length > 0)
          this.#State.AllowlistCache = Repos;
      } catch(error) {
        this.Logger.warn(
          `${AUDIT_TAG}: allowlist fetch failed, using cache:`,
          error instanceof Error ? error.message : String(error)
        );
        Repos = this.#State.AllowlistCache || [];
      }
      if(Repos.length === 0)
        Repos = this.#State.AllowlistCache || [];
    }

    return this.#NormalizeAllowlist(Repos);
  }

  /**
   * Seed cursors for the current allowlist without posting.
   * @param {boolean} ArgForceNow Always set SeededAt/Cursor to now.
   * @returns {Promise<void>}
   */
  async #SeedAllowlistAsync(ArgForceNow) {
    const Allowlist = await this.#ResolveAllowlistAsync();
    const NowIso = this.#Config.Now().toISOString();
    for(const Repo of Allowlist) {
      if(ArgForceNow || !this.#State.Repos[Repo])
        this.#State.Repos[Repo] = { Cursor: NowIso, SeededAt: NowIso };
    }
    this.#State.AllowlistCache = Allowlist;
  }

  /**
   * Read and union device allowlist files from git-pulse.
   * @returns {Promise<string[]>}
   */
  async #LoadAllowlistFromPulseAsync() {
    const Files = await this.#Config.GithubClient.ListAllowlistFilesAsync();
    /** @type {Set<string>} */
    const Repos = new Set();
    const NowMs = this.#Config.Now().getTime();
    for(const File of Files) {
      if(File.name === 'latest.json') continue;
      let Raw;
      try {
        Raw = await this.#Config.GithubClient.GetAllowlistFileAsync(File.name);
      } catch {
        continue;
      }
      let Payload;
      try {
        Payload = JSON.parse(Raw);
      } catch {
        continue;
      }
      if(!Payload || Payload.schema_version !== 1 || Payload.source !== 'repos') continue;
      if(!Array.isArray(Payload.rows)) continue;
      const GeneratedAt = new Date(Payload.generated_at || 0).getTime();
      if(!Number.isFinite(GeneratedAt) || NowMs - GeneratedAt > DEFAULT_ALLOWLIST_MAX_AGE_MS)
        continue;
      for(const Row of Payload.rows) {
        if(typeof Row === 'string' && Row.includes('/'))
          Repos.add(Row);
      }
    }
    return [...Repos];
  }

  /**
   * Canonicalize, org-filter, dedupe, and cap the allowlist.
   * @param {string[]} ArgRepos
   * @returns {string[]}
   */
  #NormalizeAllowlist(ArgRepos) {
    /** @type {string[]} */
    const Out = [];
    /** @type {Set<string>} */
    const Seen = new Set();
    for(const Repo of ArgRepos) {
      const Key = CanonicalRepoKey(Repo);
      if(!Key || Seen.has(Key)) continue;
      if(this.#Config.OrgFilter) {
        const Owner = Key.split('/')[0];
        if(!this.#Config.OrgFilter.has(Owner)) continue;
      }
      Seen.add(Key);
      // canonical lowercased owner/repo — GitHub redirects case-insensitively, and
      // state / planner keys stay consistent across devices and env overrides.
      Out.push(Key);
      if(Out.length >= DEFAULT_ALLOWLIST_MAX) break;
    }
    return Out;
  }

  /**
   * Load persisted state. Missing/corrupt files start empty.
   * @returns {Promise<boolean>} True when a valid persisted file existed.
   */
  async #LoadStateAsync() {
    try {
      const Raw = await fs.readFile(this.#Config.StatePath, 'utf8');
      const Parsed = JSON.parse(Raw);
      if(!Parsed || typeof Parsed !== 'object' || Parsed.SchemaVersion !== 1)
        return false;
      this.#State = {
        SchemaVersion: 1,
        AllowlistCache: Array.isArray(Parsed.AllowlistCache) ? Parsed.AllowlistCache : [],
        Repos: Parsed.Repos && typeof Parsed.Repos === 'object' ? Parsed.Repos : {},
        Issues: Parsed.Issues && typeof Parsed.Issues === 'object' ? Parsed.Issues : {},
      };
      return true;
    } catch {
      this.#State = EmptyState();
      return false;
    }
  }

  /**
   * Persist state durably.
   * @returns {Promise<void>}
   */
  async #SaveStateAsync() {
    try {
      await fs.mkdir(path.dirname(this.#Config.StatePath), { recursive: true });
      await WriteFileDurableAsync(this.#Config.StatePath, JSON.stringify(this.#State, null, 2));
    } catch(error) {
      this.Logger.warn(
        `${AUDIT_TAG}: failed to save state (non-fatal):`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Schedule the next poll cycle using setTimeout (recursive, not setInterval).
   */
  #ScheduleNextPoll() {
    this.#TimerID = setTimeout(async () => {
      try {
        await this.RunOnceAsync();
      } catch(error) {
        this.Logger.error(
          `${AUDIT_TAG}: unhandled error in poll cycle (non-fatal):`,
          error instanceof Error ? error.message : String(error)
        );
      }
      if(this.#Active)
        this.#ScheduleNextPoll();
    }, this.#Config.PollIntervalMs);
  }
}

module.exports = GitHubIssueStreamModule;
