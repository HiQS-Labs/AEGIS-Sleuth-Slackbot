'use strict';

// import required modules.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Build the default GitHub API client using global fetch (Node 18+).
 * @param {{ pat: string, repo: string, dir: string, branch: string }} ArgConfig
 * @returns {{ ListSnapshotsAsync: function, GetContentAsync: function }}
 */
function BuildDefaultGithubClient({ pat, repo, dir, branch }) {
  const H = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sleuth-snapshot-relay',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    /**
     * List .md files in the snapshots directory.
     * @returns {Promise<Array<{ name: string, sha: string }>>}
     */
    async ListSnapshotsAsync() {
      const url = `https://api.github.com/repos/${repo}/contents/${dir}?ref=${branch}`;
      const res = await fetch(url, { headers: H });
      if(res.status === 404) return [];
      if(res.status !== 200) {
        const body = await res.text();
        throw new Error(`GitHub list ${res.status}: ${body.slice(0, 200)}`);
      }
      const entries = await res.json();
      return entries
        .filter((/** @type {any} */ ArgEntry) => ArgEntry.type === 'file' && ArgEntry.name.endsWith('.md'))
        .map((/** @type {any} */ ArgEntry) => ({ name: ArgEntry.name, sha: ArgEntry.sha }));
    },

    /**
     * Get the decoded UTF-8 content of a single file.
     * @param {string} ArgName Filename within the snapshots dir.
     * @returns {Promise<string>}
     */
    async GetContentAsync(ArgName) {
      const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(dir)}/${encodeURIComponent(ArgName)}?ref=${branch}`;
      const res = await fetch(url, { headers: H });
      if(!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub get ${res.status}: ${body.slice(0, 200)}`);
      }
      const meta = await res.json();
      if(meta.encoding === 'base64') {
        return Buffer.from(meta.content, 'base64').toString('utf8');
      }
      if(meta.download_url) {
        // file > 1 MB — fetch raw content.
        const rawRes = await fetch(meta.download_url, { headers: { Authorization: `Bearer ${pat}` } });
        return rawRes.text();
      }
      throw new Error(`snapshot-relay: unexpected encoding '${meta.encoding}' for ${ArgName}`);
    },
  };
}

/**
 * Relay snapshot .md files from a GitHub repository directory to a Slack channel.
 *
 * Lifecycle:
 *  1. StartAsync() — load seen-set, seed from existing remote files (no post), start poll timer.
 *  2. RunOnceAsync() — list remote files, post new ones, update seen-set.
 *  3. StopAsync() — clear timer.
 *
 * Enabled only when:
 *  - ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME === 'neochrome'
 *  - ArgSlackApp.WorkspaceInfo.SNAPSHOT_RELAY_ENABLED === true (default OFF)
 *  - A PAT is present (process.env.SLEUTH_RAG_GITHUB_PAT or config.pat)
 */
class SnapshotRelayModule {
  /**
   * Slack app instance.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Logger instance.
   * @type {import('@slack/logger').Logger}
   */
  #Logger;

  /**
   * Resolved config for this instance.
   * @type {{ enabled: boolean, channelId: string, pat: string, repo: string, dir: string, branch: string, seenPath: string, pollIntervalMs: number, githubClient: { ListSnapshotsAsync: () => Promise<Array<{ name: string, sha: string }>>, GetContentAsync: (name: string) => Promise<string> } }}
   */
  #Config;

  /**
   * Set of snapshot filenames (basename only) already relayed to Slack.
   * @type {Set<string>}
   */
  #SeenFilenames = new Set();

  /**
   * Timer ID for the poll interval.
   * @type {NodeJS.Timeout|null}
   */
  #TimerID = null;

  /**
   * Whether this module is active (enabled + correct workspace).
   * @type {boolean}
   */
  #Active = false;

  /**
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @param {import('@slack/logger').Logger} ArgLogger Logger instance.
   * @param {object} [ArgConfig] Optional config overrides (for tests).
   * @param {boolean} [ArgConfig.enabled]
   * @param {string} [ArgConfig.channelId]
   * @param {string} [ArgConfig.pat]
   * @param {string} [ArgConfig.repo]
   * @param {string} [ArgConfig.dir]
   * @param {string} [ArgConfig.branch]
   * @param {string} [ArgConfig.seenPath]
   * @param {number} [ArgConfig.pollIntervalMs]
   * @param {object} [ArgConfig.githubClient] Injectable GitHub client (for tests).
   * @param {() => Promise<Array<{ name: string, sha: string }>>} ArgConfig.githubClient.ListSnapshotsAsync
   * @param {(name: string) => Promise<string>} ArgConfig.githubClient.GetContentAsync
   * @param {import('./slack-app')} [ArgConfig.slackApp]
   */
  constructor(ArgSlackApp, ArgLogger, ArgConfig = {}) {
    this.#SlackApp = ArgConfig.slackApp ?? ArgSlackApp;
    this.#Logger = ArgLogger;

    const WorkspaceName = this.#SlackApp.WorkspaceInfo.WORKSPACE_NAME;

    // Enable gate. Two paths, in precedence order:
    //  1. DURABLE (canonical): the env allowlist `SNAPSHOT_RELAY_WORKSPACES` (comma-separated
    //     workspace names). Env lives in the server's .env.runtime, which SURVIVES redeploys —
    //     unlike the per-workspace JSON, which a redeploy/restore can overwrite (observed
    //     2026-07-06: SNAPSHOT_RELAY_ENABLED silently reverted to false after a redeploy).
      // 2. LEGACY (backward-compat): the `neochrome` workspace with WorkspaceInfo.SNAPSHOT_RELAY_ENABLED
      //     === 'true' — exact prior behavior, kept so existing config keeps working.
      const EnvAllowlist = (process.env.SNAPSHOT_RELAY_WORKSPACES || '')
        .split(',').map((ArgName) => ArgName.trim()).filter(Boolean);
      const EnabledViaEnv = EnvAllowlist.includes(WorkspaceName);
      const EnabledViaConfig = WorkspaceName === 'neochrome'
        && this.#SlackApp.WorkspaceInfo.SNAPSHOT_RELAY_ENABLED === true;
      const FlagEnabled = EnabledViaEnv || EnabledViaConfig;

    const DefaultSeenPath = path.resolve(path.join(__dirname, '..', 'data', 'runtime', 'snapshot-relay-seen.json'));
    const DefaultPat = ArgConfig.pat ?? process.env.SLEUTH_RAG_GITHUB_PAT ?? '';
    const DefaultRepo = ArgConfig.repo ?? (process.env.SNAPSHOT_RELAY_REPO || '');
    const DefaultDir = ArgConfig.dir ?? (process.env.SNAPSHOT_RELAY_DIR || 'snapshots');
    const DefaultBranch = ArgConfig.branch ?? (process.env.SNAPSHOT_RELAY_BRANCH || 'main');

    // Determine enabled state: flag gate + PAT check.
    let ShouldEnable = ArgConfig.enabled ?? FlagEnabled;
    if(ShouldEnable && !DefaultPat) {
      this.#Logger.warn('snapshot-relay: enabled (env allowlist or workspace flag) but no PAT found — staying disabled');
      ShouldEnable = false;
    }

    const ClientConfig = { pat: DefaultPat, repo: DefaultRepo, dir: DefaultDir, branch: DefaultBranch };

    this.#Config = {
      enabled: ShouldEnable,
      channelId: ArgConfig.channelId ?? 'C000EXAMPLE3',
      pat: DefaultPat,
      repo: DefaultRepo,
      dir: DefaultDir,
      branch: DefaultBranch,
      seenPath: ArgConfig.seenPath ?? DefaultSeenPath,
      pollIntervalMs: ArgConfig.pollIntervalMs ?? 60000,
      githubClient: ArgConfig.githubClient ?? /** @type {{ ListSnapshotsAsync: () => Promise<Array<{ name: string, sha: string }>>, GetContentAsync: (name: string) => Promise<string> }} */ (BuildDefaultGithubClient(ClientConfig)),
    };
  }

  /**
   * Start the snapshot relay. Returns immediately when not enabled.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    if(!this.#Config.enabled) {
      this.#Logger.info('snapshot-relay: disabled — StartAsync is a no-op');
      return;
    }

    this.#Active = true;

    // Load the persisted seen-set. Whether it existed distinguishes a first-ever
    // run from a restart — which decides whether we seed (to skip backlog) or not.
    const HadPersistedState = await this.#LoadSeenAsync();

    if(!HadPersistedState) {
      // FIRST-EVER run: record existing remote files as seen WITHOUT posting, so
      // enabling the relay doesn't replay backlog into the channel.
      /** @type {Array<{ name: string, sha: string }>} */
      let RemoteFiles;
      try {
        RemoteFiles = await this.#Config.githubClient.ListSnapshotsAsync();
      } catch(error) {
        this.#Logger.error('snapshot-relay: first-run seed list failed (non-fatal):', error.message ?? error);
        RemoteFiles = [];
      }
      for(const { name: FileName } of RemoteFiles) {
        this.#SeenFilenames.add(FileName);
      }
      await this.#SaveSeenAsync();
      this.#Logger.info(`snapshot-relay: first run — seeded ${this.#SeenFilenames.size} existing file(s), none posted`);
    } else {
      // RESTART: do NOT re-seed. RunOnce will post anything that arrived while we
      // were down (remote files not in the persisted seen-set) — this closes the
      // restart-seed gap where downtime arrivals would be skipped forever.
      this.#Logger.info(`snapshot-relay: resuming with ${this.#SeenFilenames.size} seen file(s); new arrivals will post`);
    }

    // start the poll timer.
    this.#ScheduleNextPoll();
  }

  /**
   * Run one poll cycle: list remote files, post new ones. Safe to call directly from tests.
   * Non-fatal — errors are logged and swallowed; never throws.
   * @returns {Promise<void>}
   */
  async RunOnceAsync() {
    if(!this.#Active) return;

    let Files;
    try {
      Files = await this.#Config.githubClient.ListSnapshotsAsync();
    } catch(error) {
      this.#Logger.error('snapshot-relay: list failed (non-fatal):', error.message ?? error);
      return;
    }

    for(const { name: FileName } of Files) {
      if(this.#SeenFilenames.has(FileName)) continue;

      let Content;
      try {
        Content = await this.#Config.githubClient.GetContentAsync(FileName);
      } catch(error) {
        this.#Logger.error(`snapshot-relay: failed to fetch ${FileName} (non-fatal):`, error.message ?? error);
        continue;
      }

      try {
        await this.#PostSnapshotAsync(FileName, Content);
        // only add to seen-set on success.
        this.#SeenFilenames.add(FileName);
        await this.#SaveSeenAsync();
      } catch(error) {
        this.#Logger.error(`snapshot-relay: failed to post ${FileName} (non-fatal):`, error.message ?? error);
      }
    }
  }

  /**
   * Stop the snapshot relay and clear the poll timer.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    if(this.#TimerID !== null) {
      clearTimeout(this.#TimerID);
      this.#TimerID = null;
    }
    this.#Active = false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Post one snapshot to Slack given its filename and content string.
   * - Short entries (≤ 3500 chars): single text message (header + full content).
   * - Long entries: a SINGLE file upload with the header as the file's comment.
   * Each path is one visible operation: it either fully succeeds (caller marks the
   * file seen) or fully fails (nothing visible, retried next cycle) — so a partial
   * failure can never leave a re-posting header.
   * @param {string} ArgFileName Snapshot filename (e.g. snapshot-2026-06-17.md).
   * @param {string} ArgContent Decoded UTF-8 content of the snapshot.
   * @returns {Promise<void>}
   */
  async #PostSnapshotAsync(ArgFileName, ArgContent) {
    // parse the relay header comment.
    const HeaderCommentMatch = ArgContent.match(
      /<!--\s*snapshot-sleuth-relay:\s*forwarded-at=([^\s]+)\s+device="([^"]+)"\s+repo="([^"]+)"\s*-->/
    );
    const TitleMatch = ArgContent.match(/^#[^\n]*/m);

    const ForwardedAt = HeaderCommentMatch ? HeaderCommentMatch[1] : '';
    const Device = HeaderCommentMatch ? HeaderCommentMatch[2] : '';
    const Repo = HeaderCommentMatch ? HeaderCommentMatch[3] : '';
    const TitleLine = TitleMatch ? TitleMatch[0].replace(/^#+\s*/, '').trim() : ArgFileName;

    const HeaderParts = [
      `*${TitleLine}*`,
      ForwardedAt ? `forwarded-at: ${ForwardedAt}` : '',
      Device ? `device: ${Device}` : '',
      Repo ? `repo: ${Repo}` : '',
    ].filter(Boolean);
    const CompactHeader = HeaderParts.join('  |  ');

    const { channelId } = this.#Config;
    const Tag = { Tag: 'snapshot-relay' };

    if(ArgContent.length <= 3500) {
      // post as a single text message.
      await this.#SlackApp.PostMessageTextAsync(channelId, null, `${CompactHeader}\n\n${ArgContent}`, undefined, Tag);
    } else {
      // Long entry: deliver as a SINGLE file upload with the header as the file's
      // initial comment. No separate header message — so a failed upload (e.g. the
      // bot missing files:write scope) leaves nothing visible and is retried next
      // cycle, instead of spamming a header that re-posts every poll. The full
      // content is the uploaded file.
      const TempFilePath = path.join(os.tmpdir(), `snapshot-relay-${process.pid}-${ArgFileName}`);
      try {
        await fs.writeFile(TempFilePath, ArgContent, 'utf8');
        await this.#SlackApp.UploadFileAsync(channelId, null, TempFilePath, CompactHeader, ArgFileName, Tag);
      } finally {
        try {
          await fs.unlink(TempFilePath);
        } catch {
          // ignore cleanup errors.
        }
      }
    }

    this.#Logger.info(`snapshot-relay: posted ${ArgFileName}`);
  }

  /**
   * Load the seen-set from disk. Treats a missing or corrupt file as an empty set.
   * @returns {Promise<boolean>} True if persisted state existed (restart); false on first-ever run.
   */
  async #LoadSeenAsync() {
    try {
      const Raw = await fs.readFile(this.#Config.seenPath, 'utf8');
      const Parsed = JSON.parse(Raw);
      if(Array.isArray(Parsed)) {
        this.#SeenFilenames = new Set(Parsed.filter((ArgItem) => typeof ArgItem === 'string'));
        return true; // persisted state existed → this is a restart, not the first run
      }
      return false;
    } catch {
      this.#SeenFilenames = new Set();
      return false; // missing/invalid persisted state → treat as first-ever run
    }
  }

  /**
   * Persist the seen-set to disk.
   * @returns {Promise<void>}
   */
  async #SaveSeenAsync() {
    try {
      await fs.mkdir(path.dirname(this.#Config.seenPath), { recursive: true });
      await fs.writeFile(this.#Config.seenPath, JSON.stringify([...this.#SeenFilenames], null, 2), 'utf8');
    } catch(error) {
      this.#Logger.warn('snapshot-relay: failed to save seen-set (non-fatal):', error.message ?? error);
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
        this.#Logger.error('snapshot-relay: unhandled error in poll cycle (non-fatal):', error.message ?? error);
      }
      if(this.#Active) {
        this.#ScheduleNextPoll();
      }
    }, this.#Config.pollIntervalMs);
  }
}

module.exports = SnapshotRelayModule;
