'use strict';

// Code-task relay (Slack → Claude Code Cloud), the reverse of the snapshot relay.
//
// Outbound:  the Slack command handler synthesizes a TaskSpec, then DispatchCodeTaskAsync writes
//            a code-tasks/<id>.md file to the shared private repo (desktop path) and/or opens a
//            labeled GitHub issue on the target repo (github-native path).
// Feedback:  CodeTaskRelayModule polls code-tasks/acks/ (written back by the desktop watcher or a
//            cloud step) and posts the session/PR link into the originating Slack thread.
//
// Transport, auth and the poll/seen-set lifecycle deliberately mirror src/snapshot-relay-module.js
// so both relays behave identically (first-run seed, restart resume, exactly-once posting).

const fs = require('fs').promises;
const path = require('path');

const Synthesis = require('./code-task-synthesis');

// No vendor default — a deployment must name its own relay repo via CODE_TASK_RELAY_REPO.
const DefaultRelayRepo = '';
const DefaultTasksDir = 'code-tasks';
const DefaultAcksDir = 'code-tasks/acks';
const ValidTriggerModes = new Set(['desktop', 'github', 'both']);

/**
 * @typedef {import('./code-task-synthesis').TaskSpec} TaskSpec
 *
 * @typedef {Object} GithubClient
 * @property {(repo: string, dir: string) => Promise<Array<{ name: string, sha: string }>>} ListAsync
 * @property {(repo: string, path: string) => Promise<string>} GetContentAsync
 * @property {(repo: string, path: string, content: string, message: string, branch: string) => Promise<{ ok: boolean, htmlUrl: string|null, status: number }>} WriteFileAsync
 * @property {(repo: string, issue: { title: string, body: string, labels?: string[] }) => Promise<{ ok: boolean, htmlUrl: string|null, status: number }>} CreateIssueAsync
 *
 * @typedef {Object} CodeTaskConfig
 * @property {boolean} enabled
 * @property {string} pat
 * @property {string} relayRepo
 * @property {string} relayBranch
 * @property {string} defaultRepo
 * @property {string} triggerMode
 * @property {string} tasksDir
 * @property {string} acksDir
 * @property {string} issueLabel
 * @property {string} seenPath
 * @property {number} pollIntervalMs
 * @property {GithubClient|null} githubClient
 */

/**
 * Build a GitHub API client (global fetch, Node 18+) bound only to a PAT. Repo is passed per call
 * because the task file goes to the drop repo while the github-native issue goes to the code repo.
 * @param {string} ArgPat GitHub personal access token.
 * @returns {GithubClient}
 */
function BuildDefaultGithubClient(ArgPat) {
  const Headers = {
    Authorization: `Bearer ${ArgPat}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sleuth-code-task-relay',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    /**
     * List .md files in a directory of a repo (used by the feedback poll).
     * @param {string} ArgRepo owner/repo.
     * @param {string} ArgDir Directory path.
     * @returns {Promise<Array<{ name: string, sha: string }>>}
     */
    async ListAsync(ArgRepo, ArgDir) {
      const Url = `https://api.github.com/repos/${ArgRepo}/contents/${encodeURIComponent(ArgDir)}`;
      const Res = await fetch(Url, { headers: Headers });
      if(Res.status === 404) return [];
      if(Res.status !== 200) throw new Error(`GitHub list ${Res.status}: ${(await Res.text()).slice(0, 200)}`);
      const Entries = /** @type {any[]} */ (await Res.json());
      return Entries
        .filter((ArgEntry) => ArgEntry.type === 'file' && ArgEntry.name.endsWith('.md'))
        .map((ArgEntry) => ({ name: ArgEntry.name, sha: ArgEntry.sha }));
    },

    /**
     * Fetch decoded UTF-8 content of a single file.
     * @param {string} ArgRepo owner/repo.
     * @param {string} ArgPath Full path within the repo.
     * @returns {Promise<string>}
     */
    async GetContentAsync(ArgRepo, ArgPath) {
      const Url = `https://api.github.com/repos/${ArgRepo}/contents/${ArgPath.split('/').map(encodeURIComponent).join('/')}`;
      const Res = await fetch(Url, { headers: Headers });
      if(!Res.ok) throw new Error(`GitHub get ${Res.status}: ${(await Res.text()).slice(0, 200)}`);
      const Meta = await Res.json();
      if(Meta.encoding === 'base64') return Buffer.from(Meta.content, 'base64').toString('utf8');
      if(Meta.download_url) return (await fetch(Meta.download_url, { headers: { Authorization: `Bearer ${ArgPat}` } })).text();
      throw new Error(`code-task-relay: unexpected encoding '${Meta.encoding}' for ${ArgPath}`);
    },

    /**
     * Create a file via the Contents API (PUT). Fails if the path already exists (no sha sent).
     * @param {string} ArgRepo owner/repo.
     * @param {string} ArgPath Full path within the repo.
     * @param {string} ArgContent UTF-8 content.
     * @param {string} ArgMessage Commit message.
     * @param {string} ArgBranch Branch to commit to.
     * @returns {Promise<{ ok: boolean, htmlUrl: string|null, status: number }>}
     */
    async WriteFileAsync(ArgRepo, ArgPath, ArgContent, ArgMessage, ArgBranch) {
      const Url = `https://api.github.com/repos/${ArgRepo}/contents/${ArgPath.split('/').map(encodeURIComponent).join('/')}`;
      const Res = await fetch(Url, {
        method: 'PUT',
        headers: { ...Headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: ArgMessage,
          content: Buffer.from(ArgContent, 'utf8').toString('base64'),
          branch: ArgBranch,
        }),
      });
      const Ok = Res.status === 201 || Res.status === 200;
      let HtmlUrl = null;
      if(Ok) { try { HtmlUrl = (await Res.json())?.content?.html_url ?? null; } catch { /* ignore */ } }
      else throw new Error(`GitHub put ${Res.status}: ${(await Res.text()).slice(0, 200)}`);
      return { ok: Ok, htmlUrl: HtmlUrl, status: Res.status };
    },

    /**
     * Open an issue on a repo (github-native trigger path).
     * @param {string} ArgRepo owner/repo.
     * @param {{ title: string, body: string, labels?: string[] }} ArgIssue
     * @returns {Promise<{ ok: boolean, htmlUrl: string|null, status: number }>}
     */
    async CreateIssueAsync(ArgRepo, ArgIssue) {
      const Url = `https://api.github.com/repos/${ArgRepo}/issues`;
      const Res = await fetch(Url, {
        method: 'POST',
        headers: { ...Headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: ArgIssue.title, body: ArgIssue.body, labels: ArgIssue.labels ?? [] }),
      });
      const Ok = Res.status === 201;
      let HtmlUrl = null;
      if(Ok) { try { HtmlUrl = (await Res.json())?.html_url ?? null; } catch { /* ignore */ } }
      else throw new Error(`GitHub issue ${Res.status}: ${(await Res.text()).slice(0, 200)}`);
      return { ok: Ok, htmlUrl: HtmlUrl, status: Res.status };
    },
  };
}

/**
 * Resolve code-task relay config from workspace info + env, mirroring snapshot-relay's gating.
 * @param {import('./slack-app')} ArgSlackApp
 * @param {Record<string, any>} [ArgOverrides] Test/explicit overrides.
 * @returns {CodeTaskConfig}
 */
function ResolveCodeTaskConfig(ArgSlackApp, ArgOverrides = {}) {
  const WorkspaceInfo = /** @type {Record<string, any>} */ (ArgSlackApp?.WorkspaceInfo ?? {});
  const WorkspaceName = WorkspaceInfo.WORKSPACE_NAME;
  const FlagEnabled = WorkspaceInfo.CODE_TASK_RELAY_ENABLED === true;
  const IsCorrectWorkspace = WorkspaceName === 'neochrome';

  const Pat = ArgOverrides.pat ?? process.env.SLEUTH_RAG_GITHUB_PAT ?? '';
  const RelayRepo = ArgOverrides.relayRepo ?? (process.env.CODE_TASK_RELAY_REPO || process.env.SNAPSHOT_RELAY_REPO || DefaultRelayRepo);
  const RelayBranch = ArgOverrides.relayBranch ?? (process.env.CODE_TASK_RELAY_BRANCH || 'main');
  const DefaultRepo = ArgOverrides.defaultRepo ?? (process.env.CODE_TASK_DEFAULT_REPO || '');
  let TriggerMode = ArgOverrides.triggerMode ?? (process.env.CODE_TASK_TRIGGER_MODE || 'desktop');
  if(!ValidTriggerModes.has(TriggerMode)) TriggerMode = 'desktop';

  let Enabled = ArgOverrides.enabled ?? (IsCorrectWorkspace && FlagEnabled);
  if(Enabled && !Pat) Enabled = false;

  return {
    enabled: Enabled,
    pat: Pat,
    relayRepo: RelayRepo,
    relayBranch: RelayBranch,
    defaultRepo: DefaultRepo,
    triggerMode: TriggerMode,
    tasksDir: ArgOverrides.tasksDir ?? DefaultTasksDir,
    acksDir: ArgOverrides.acksDir ?? DefaultAcksDir,
    issueLabel: ArgOverrides.issueLabel ?? (process.env.CODE_TASK_ISSUE_LABEL || 'claude-code-task'),
    seenPath: ArgOverrides.seenPath ?? path.resolve(path.join(__dirname, '..', 'data', 'runtime', 'code-task-relay-seen.json')),
    pollIntervalMs: ArgOverrides.pollIntervalMs ?? 60000,
    githubClient: ArgOverrides.githubClient ?? (Pat ? BuildDefaultGithubClient(Pat) : null),
  };
}

/**
 * Dispatch a synthesized task: write the task file (desktop path) and/or open a labeled issue
 * (github-native path), per the trigger mode. Returns the surfaces created.
 * @param {object} ArgArgs
 * @param {GithubClient} ArgArgs.githubClient GitHub client (BuildDefaultGithubClient or a fake).
 * @param {TaskSpec} ArgArgs.spec Normalized TaskSpec.
 * @param {{ channel: string, threadTs?: string, user?: string }} ArgArgs.origin Slack origin.
 * @param {CodeTaskConfig} ArgArgs.config Resolved config (relayRepo, relayBranch, tasksDir, triggerMode, issueLabel).
 * @param {Date} [ArgArgs.now] Injectable clock (tests).
 * @returns {Promise<{ taskId: string, fileName: string, filePath: string, fileUrl: string|null, issueUrl: string|null }>}
 */
async function DispatchCodeTaskAsync({ githubClient, spec, origin, config, now = new Date() }) {
  const TaskId = Synthesis.BuildTaskId(spec, origin, now);
  const FileName = `${TaskId}.md`;
  const FilePath = `${config.tasksDir}/${FileName}`;
  const Markdown = Synthesis.RenderTaskMarkdown(spec, {
    taskId: TaskId,
    channel: origin.channel,
    threadTs: origin.threadTs,
    user: origin.user,
    triggerMode: config.triggerMode,
    createdAt: now.toISOString(),
  });

  let FileUrl = null;
  let IssueUrl = null;

  // Desktop path (and 'both'): drop the task file the desktop watcher polls.
  if(config.triggerMode === 'desktop' || config.triggerMode === 'both') {
    const Written = await githubClient.WriteFileAsync(
      config.relayRepo, FilePath, Markdown, `code-task: ${spec.title}`, config.relayBranch
    );
    FileUrl = Written.htmlUrl;
  }

  // GitHub-native path (and 'both'): open a labeled issue on the target code repo so a Claude Code
  // GitHub trigger / routine can pick it up without the desktop.
  if(config.triggerMode === 'github' || config.triggerMode === 'both') {
    const Body = [
      Markdown,
      '',
      `<!-- task-id: ${TaskId} -->`,
    ].join('\n');
    const Issue = await githubClient.CreateIssueAsync(spec.target_repo, {
      title: `[code-task] ${spec.title}`,
      body: Body,
      labels: [config.issueLabel],
    });
    IssueUrl = Issue.htmlUrl;
  }

  return { taskId: TaskId, fileName: FileName, filePath: FilePath, fileUrl: FileUrl, issueUrl: IssueUrl };
}

/**
 * Feedback poller: watches code-tasks/acks/ and posts cloud session / PR links back to the
 * originating Slack thread. Lifecycle mirrors SnapshotRelayModule.
 */
class CodeTaskRelayModule {
  /** @type {import('./slack-app')} */
  #SlackApp;
  /** @type {import('@slack/logger').Logger} */
  #Logger;
  /** @type {CodeTaskConfig} */
  #Config;
  /** @type {Set<string>} */
  #SeenFilenames = new Set();
  /** @type {NodeJS.Timeout|null} */
  #TimerID = null;
  #Active = false;

  /**
   * @param {import('./slack-app')} ArgSlackApp
   * @param {import('@slack/logger').Logger} ArgLogger
   * @param {Record<string, any>} [ArgConfig] Overrides (tests).
   */
  constructor(ArgSlackApp, ArgLogger, ArgConfig = {}) {
    this.#SlackApp = ArgConfig.slackApp ?? ArgSlackApp;
    this.#Logger = ArgLogger;
    this.#Config = ResolveCodeTaskConfig(this.#SlackApp, ArgConfig);
    if(this.#Config.enabled && !this.#Config.githubClient) this.#Config.enabled = false;
  }

  /** Start the feedback poll. No-op when disabled. */
  async StartAsync() {
    if(!this.#Config.enabled) {
      this.#Logger.info('code-task-relay: disabled — StartAsync is a no-op');
      return;
    }
    this.#Active = true;

    const HadPersistedState = await this.#LoadSeenAsync();
    if(!HadPersistedState) {
      /** @type {Array<{name:string, sha:string}>} */
      /** @type {Array<{name:string, sha:string}>} */
    let Files;
      try { Files = await this.#Config.githubClient.ListAsync(this.#Config.relayRepo, this.#Config.acksDir); }
      catch(error) { this.#Logger.error('code-task-relay: first-run seed list failed (non-fatal):', error.message ?? error); Files = []; }
      for(const { name } of Files) this.#SeenFilenames.add(name);
      await this.#SaveSeenAsync();
      this.#Logger.info(`code-task-relay: first run — seeded ${this.#SeenFilenames.size} existing ack(s), none posted`);
    } else {
      this.#Logger.info(`code-task-relay: resuming with ${this.#SeenFilenames.size} seen ack(s); new arrivals will post`);
    }
    this.#ScheduleNextPoll();
  }

  /** One poll cycle: list acks, post new ones to their originating threads. Never throws. */
  async RunOnceAsync() {
    if(!this.#Active) return;

    let Files;
    try { Files = await this.#Config.githubClient.ListAsync(this.#Config.relayRepo, this.#Config.acksDir); }
    catch(error) { this.#Logger.error('code-task-relay: ack list failed (non-fatal):', error.message ?? error); return; }

    for(const { name: FileName } of Files) {
      if(this.#SeenFilenames.has(FileName)) continue;

      let Content;
      try { Content = await this.#Config.githubClient.GetContentAsync(this.#Config.relayRepo, `${this.#Config.acksDir}/${FileName}`); }
      catch(error) { this.#Logger.error(`code-task-relay: failed to fetch ack ${FileName} (non-fatal):`, error.message ?? error); continue; }

      try {
        await this.#PostAckAsync(FileName, Content);
        this.#SeenFilenames.add(FileName);
        await this.#SaveSeenAsync();
      } catch(error) {
        this.#Logger.error(`code-task-relay: failed to post ack ${FileName} (non-fatal):`, error.message ?? error);
      }
    }
  }

  /** Stop the poll and clear the timer. */
  async StopAsync() {
    if(this.#TimerID !== null) { clearTimeout(this.#TimerID); this.#TimerID = null; }
    this.#Active = false;
  }

  /**
   * Post a single ack to the Slack thread named in its metadata.
   * @param {string} ArgFileName
   * @param {string} ArgContent
   */
  async #PostAckAsync(ArgFileName, ArgContent) {
    const Meta = Synthesis.ParseMetadataHeader(ArgContent);
    const Channel = Meta.channel;
    if(!Channel) {
      this.#Logger.warn(`code-task-relay: ack ${ArgFileName} has no channel in metadata — skipping post`);
      // Mark seen by returning normally so we do not retry a permanently unroutable ack.
      return;
    }
    const ThreadTs = Meta['thread-ts'] || null;
    const Status = Meta.status || 'started';
    const SessionUrl = Meta['session-url'] || '';
    const PrUrl = Meta['pr-url'] || '';
    const TaskId = Meta['task-id'] || ArgFileName.replace(/\.md$/, '');

    const Lines = [`:robot_face: *Claude Code Cloud — ${Status}* for task \`${TaskId}\``];
    if(SessionUrl) Lines.push(`• Session: ${SessionUrl}`);
    if(PrUrl) Lines.push(`• PR: ${PrUrl}`);
    if(Meta.error) Lines.push(`• Error: ${Meta.error}`);

    await this.#SlackApp.PostMessageTextAsync(Channel, ThreadTs, Lines.join('\n'), undefined, { Tag: 'code-task-relay' });
    this.#Logger.info(`code-task-relay: posted ack ${ArgFileName} to ${Channel}`);
  }

  /**
   * Load the seen-set. Missing/corrupt file → empty set, treated as first-ever run.
   * @returns {Promise<boolean>} True when persisted state existed (restart).
   */
  async #LoadSeenAsync() {
    try {
      const Parsed = JSON.parse(await fs.readFile(this.#Config.seenPath, 'utf8'));
      if(Array.isArray(Parsed)) {
        this.#SeenFilenames = new Set(Parsed.filter((ArgItem) => typeof ArgItem === 'string'));
        return true;
      }
      return false;
    } catch {
      this.#SeenFilenames = new Set();
      return false;
    }
  }

  /** Persist the seen-set. */
  async #SaveSeenAsync() {
    try {
      await fs.mkdir(path.dirname(this.#Config.seenPath), { recursive: true });
      await fs.writeFile(this.#Config.seenPath, JSON.stringify([...this.#SeenFilenames], null, 2), 'utf8');
    } catch(error) {
      this.#Logger.warn('code-task-relay: failed to save seen-set (non-fatal):', error.message ?? error);
    }
  }

  /** Schedule the next poll (recursive setTimeout, like snapshot relay). */
  #ScheduleNextPoll() {
    this.#TimerID = setTimeout(async () => {
      try { await this.RunOnceAsync(); }
      catch(error) { this.#Logger.error('code-task-relay: unhandled error in poll cycle (non-fatal):', error.message ?? error); }
      if(this.#Active) this.#ScheduleNextPoll();
    }, this.#Config.pollIntervalMs);
  }
}

module.exports = CodeTaskRelayModule;
module.exports.BuildDefaultGithubClient = BuildDefaultGithubClient;
module.exports.ResolveCodeTaskConfig = ResolveCodeTaskConfig;
module.exports.DispatchCodeTaskAsync = DispatchCodeTaskAsync;
