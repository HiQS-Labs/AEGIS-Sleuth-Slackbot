'use strict';

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const SnapshotRelayModule = require('../src/snapshot-relay-module');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock SlackApp for snapshot-relay tests.
 * @param {object} [ArgWorkspaceInfo] Workspace info overrides.
 * @returns {{ WorkspaceInfo: object, PostMessageTextAsync: jest.Mock, UploadFileAsync: jest.Mock, Logger: object }}
 */
function MakeMockSlackApp(ArgWorkspaceInfo = {}) {
  const WorkspaceInfo = {
    WORKSPACE_NAME: 'neochrome',
    SNAPSHOT_RELAY_ENABLED: true,
    ...ArgWorkspaceInfo,
  };

  const Logger = {
    InfoMessages: [],
    WarnMessages: [],
    ErrorMessages: [],
    info(...ArgArgs) { this.InfoMessages.push(ArgArgs.join(' ')); },
    warn(...ArgArgs) { this.WarnMessages.push(ArgArgs.join(' ')); },
    error(...ArgArgs) { this.ErrorMessages.push(ArgArgs.join(' ')); },
  };

  return {
    WorkspaceInfo,
    Logger,
    PostMessageTextAsync: jest.fn().mockResolvedValue('ts1'),
    UploadFileAsync: jest.fn().mockResolvedValue('ts2'),
  };
}

/**
 * Build a fake githubClient with controllable list/get behaviour.
 * @returns {{ ListSnapshotsAsync: jest.Mock, GetContentAsync: jest.Mock }}
 */
function MakeFakeGithubClient() {
  return {
    ListSnapshotsAsync: jest.fn().mockResolvedValue([]),
    GetContentAsync: jest.fn().mockResolvedValue(''),
  };
}

/** Default fixture content — short, well under 3500 chars. */
const DEFAULT_CONTENT = [
  '<!-- snapshot-sleuth-relay: forwarded-at=2026-06-17T10:00:00Z device="MacBook Pro" repo="sleuth-app" -->',
  '# Snapshot — 2026-06-17',
  '',
  'Session notes go here.',
].join('\n');

/**
 * Build a SnapshotRelayModule instance wired to a fake githubClient, no real git, no real network.
 * @param {object} ArgSlackApp Mock SlackApp.
 * @param {string} ArgSeenPath Seen-set persistence path.
 * @param {object} ArgGithubClient Fake githubClient.
 * @param {object} [ArgExtraConfig] Additional config overrides.
 * @returns {SnapshotRelayModule}
 */
function MakeModule(ArgSlackApp, ArgSeenPath, ArgGithubClient, ArgExtraConfig = {}) {
  return new SnapshotRelayModule(ArgSlackApp, ArgSlackApp.Logger, {
    enabled: true,
    channelId: 'C000EXAMPLE3',
    pat: 'test-pat',
    repo: 'test-org/test-repo',
    dir: 'snapshots',
    branch: 'main',
    seenPath: ArgSeenPath,
    pollIntervalMs: 999999,    // effectively never fires automatically
    githubClient: ArgGithubClient,
    ...ArgExtraConfig,
  });
}

// ---------------------------------------------------------------------------
// Test suite 1 — Exactly-once: one remote file posts exactly once per RunOnceAsync
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — exactly-once posting', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GithubClient = MakeFakeGithubClient();

    // StartAsync seed: one file already exists remotely.
    GithubClient.ListSnapshotsAsync.mockResolvedValueOnce([
      { name: 'snapshot-2026-06-17.md', sha: 'sha1' },
    ]);

    Module = MakeModule(SlackApp, SeenPath, GithubClient);
  });

  afterEach(async () => {
    await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('one file seeded, new file appears → PostMessageTextAsync called once; second RunOnceAsync → still once', async () => {
    // StartAsync seeds the existing file (no post).
    await Module.StartAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();

    // Now a new file appears on the second list call.
    GithubClient.ListSnapshotsAsync.mockResolvedValue([
      { name: 'snapshot-2026-06-17.md', sha: 'sha1' },
      { name: 'snapshot-2026-06-18.md', sha: 'sha2' },
    ]);
    GithubClient.GetContentAsync.mockResolvedValue([
      '<!-- snapshot-sleuth-relay: forwarded-at=2026-06-18T08:00:00Z device="MacBook" repo="sleuth-app" -->',
      '# Snapshot — 2026-06-18',
      'New session.',
    ].join('\n'));

    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);

    // Second RunOnceAsync — same list, file now in seen-set → no re-post.
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test suite 2 — No-backlog-flood seeding
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — no-backlog-flood seeding', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GithubClient = MakeFakeGithubClient();

    GithubClient.ListSnapshotsAsync.mockResolvedValueOnce([
      { name: 'snapshot-a.md', sha: 'sha-a' },
      { name: 'snapshot-b.md', sha: 'sha-b' },
      { name: 'snapshot-c.md', sha: 'sha-c' },
    ]);

    Module = MakeModule(SlackApp, SeenPath, GithubClient);
  });

  afterEach(async () => {
    await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('StartAsync posts zero messages and seeds all 3 files into the seen-set', async () => {
    await Module.StartAsync();

    // no messages posted during seed.
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    expect(SlackApp.UploadFileAsync).not.toHaveBeenCalled();

    // GetContentAsync must NOT have been called during seed.
    expect(GithubClient.GetContentAsync).not.toHaveBeenCalled();

    // seen.json should now contain 3 entries.
    const SeenRaw = await fs.readFile(SeenPath, 'utf8');
    const SeenArray = JSON.parse(SeenRaw);
    expect(SeenArray).toHaveLength(3);
    expect(SeenArray).toContain('snapshot-a.md');
    expect(SeenArray).toContain('snapshot-b.md');
    expect(SeenArray).toContain('snapshot-c.md');

    // logger should mention the first-run seed.
    const SeedLog = SlackApp.Logger.InfoMessages.find((ArgMsg) => ArgMsg.includes('first run'));
    expect(SeedLog).toBeTruthy();
    expect(SeedLog).toMatch(/seeded 3 existing file/);
  });
});

// ---------------------------------------------------------------------------
// Test suite 2b — Restart does NOT re-seed: downtime arrivals still post
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — restart resumes without re-seeding', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GithubClient = MakeFakeGithubClient();

    // A persisted seen-set already exists (a prior run) → this start is a RESTART.
    await fs.writeFile(SeenPath, JSON.stringify(['snapshot-old.md']), 'utf8');

    // The remote now has the old file PLUS one that arrived while we were down.
    GithubClient.ListSnapshotsAsync.mockResolvedValue([
      { name: 'snapshot-old.md', sha: 'sha-old' },
      { name: 'snapshot-during-downtime.md', sha: 'sha-new' },
    ]);
    GithubClient.GetContentAsync.mockResolvedValue(DEFAULT_CONTENT);

    Module = MakeModule(SlackApp, SeenPath, GithubClient);
  });

  afterEach(async () => {
    await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('restart does not re-seed; a downtime arrival is posted, the already-seen file is not', async () => {
    await Module.StartAsync();
    // No seeding on restart → nothing posted yet, downtime file NOT pre-marked seen.
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    const ResumeLog = SlackApp.Logger.InfoMessages.find((ArgMsg) => ArgMsg.includes('resuming'));
    expect(ResumeLog).toBeTruthy();

    await Module.RunOnceAsync();
    // The downtime arrival posts exactly once; the already-seen file does not.
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    expect(GithubClient.GetContentAsync).toHaveBeenCalledWith('snapshot-during-downtime.md');
    expect(GithubClient.GetContentAsync).not.toHaveBeenCalledWith('snapshot-old.md');
  });
});

// ---------------------------------------------------------------------------
// Test suite 3 — Long content → UploadFileAsync (not a single full text post)
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — long content triggers file upload', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GithubClient = MakeFakeGithubClient();

    // Seed one short file.
    GithubClient.ListSnapshotsAsync.mockResolvedValueOnce([
      { name: 'snapshot-short.md', sha: 'sha-s' },
    ]);

    Module = MakeModule(SlackApp, SeenPath, GithubClient);
  });

  afterEach(async () => {
    await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('entry > 3500 chars → UploadFileAsync is called (not just a text post)', async () => {
    // StartAsync seeds the existing short file.
    await Module.StartAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();

    // Now a new long file appears.
    const LongContent = [
      '<!-- snapshot-sleuth-relay: forwarded-at=2026-06-18T09:00:00Z device="MacBook Pro" repo="sleuth-app" -->',
      '# Snapshot — 2026-06-18 long',
      '',
      'y'.repeat(4000),
    ].join('\n');

    GithubClient.ListSnapshotsAsync.mockResolvedValue([
      { name: 'snapshot-short.md', sha: 'sha-s' },
      { name: 'snapshot-long.md', sha: 'sha-l' },
    ]);
    GithubClient.GetContentAsync.mockResolvedValue(LongContent);

    await Module.RunOnceAsync();

    // UploadFileAsync must have been called once.
    expect(SlackApp.UploadFileAsync).toHaveBeenCalledTimes(1);
    // NO separate header text post — the header is the file's initial comment, so a
    // failed upload can't leave a re-posting header (the duplicate-spam fix).
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    // The compact header is passed as the file's initial comment (4th arg).
    const UploadArgs = SlackApp.UploadFileAsync.mock.calls[0];
    expect(UploadArgs[3]).toContain('Snapshot — 2026-06-18 long');
  });
});

// ---------------------------------------------------------------------------
// Test suite 4 — Flag OFF or PAT missing → StartAsync does nothing
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — flag OFF gate', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  afterEach(async () => {
    if(Module) await Module.StopAsync();
    if(TempDir) await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('SNAPSHOT_RELAY_ENABLED false → StartAsync is a no-op (no posts, no seen-set, no timer, client never called)', async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp({ SNAPSHOT_RELAY_ENABLED: false });
    GithubClient = MakeFakeGithubClient();
    Module = MakeModule(SlackApp, SeenPath, GithubClient, { enabled: false });

    await Module.StartAsync();

    // no messages posted.
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    expect(SlackApp.UploadFileAsync).not.toHaveBeenCalled();

    // GitHub client must NOT have been called.
    expect(GithubClient.ListSnapshotsAsync).not.toHaveBeenCalled();
    expect(GithubClient.GetContentAsync).not.toHaveBeenCalled();

    // seen.json should NOT exist (nothing was seeded).
    let SeenExists = false;
    try {
      await fs.access(SeenPath);
      SeenExists = true;
    } catch {
      // expected.
    }
    expect(SeenExists).toBe(false);

    // RunOnceAsync should also be a no-op when not active.
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
  });

  test('PAT missing → constructor disables the module, StartAsync is a no-op', async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp({ SNAPSHOT_RELAY_ENABLED: true });
    GithubClient = MakeFakeGithubClient();

    // Force PAT to empty string to trigger the PAT-missing branch.
    // enabled is NOT explicitly passed — the constructor derives it from workspace flags,
    // then disables because pat is ''.
    Module = new SnapshotRelayModule(SlackApp, SlackApp.Logger, {
      channelId: 'C000EXAMPLE3',
      pat: '',
      repo: 'test-org/test-repo',
      dir: 'snapshots',
      branch: 'main',
      seenPath: SeenPath,
      pollIntervalMs: 999999,
      githubClient: GithubClient,
    });

    await Module.StartAsync();

    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    expect(GithubClient.ListSnapshotsAsync).not.toHaveBeenCalled();

    // A warning about missing PAT should have been logged.
    const WarnLog = SlackApp.Logger.WarnMessages.find((ArgMsg) => ArgMsg.includes('no PAT'));
    expect(WarnLog).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test suite — durable env-allowlist enable path (SNAPSHOT_RELAY_WORKSPACES)
// The workspace JSON flag can silently revert on a redeploy/restore (observed
// 2026-07-06); the env allowlist lives in .env.runtime, which survives redeploys.
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — durable env-allowlist enable', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;
  const SavedAllowlist = process.env.SNAPSHOT_RELAY_WORKSPACES;

  afterEach(async () => {
    if(Module) await Module.StopAsync();
    if(SavedAllowlist === undefined) delete process.env.SNAPSHOT_RELAY_WORKSPACES;
    else process.env.SNAPSHOT_RELAY_WORKSPACES = SavedAllowlist;
    if(TempDir) await fs.rm(TempDir, { recursive: true, force: true }).catch(() => {});
  });

  test('env allowlist enables even when the workspace SNAPSHOT_RELAY_ENABLED flag is false (redeploy-durable)', async () => {
    process.env.SNAPSHOT_RELAY_WORKSPACES = 'neochrome';
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp({ SNAPSHOT_RELAY_ENABLED: false }); // workspace flag OFF (reverted-by-redeploy scenario)
    GithubClient = MakeFakeGithubClient();

    // `enabled` is NOT passed — the constructor must derive it from the env allowlist.
    Module = new SnapshotRelayModule(SlackApp, SlackApp.Logger, {
      channelId: 'C000EXAMPLE3', pat: 'test-pat', repo: 'test-org/test-repo',
      dir: 'snapshots', branch: 'main', seenPath: SeenPath, pollIntervalMs: 999999,
      githubClient: GithubClient,
    });
    await Module.StartAsync();

    // Enabled → StartAsync seeds via the github client.
    expect(GithubClient.ListSnapshotsAsync).toHaveBeenCalled();
  });

  test('env allowlist NOT including the workspace leaves it disabled (with the flag also off)', async () => {
    process.env.SNAPSHOT_RELAY_WORKSPACES = 'someotherworkspace';
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp({ SNAPSHOT_RELAY_ENABLED: false });
    GithubClient = MakeFakeGithubClient();

    Module = new SnapshotRelayModule(SlackApp, SlackApp.Logger, {
      channelId: 'C000EXAMPLE3', pat: 'test-pat', repo: 'test-org/test-repo',
      dir: 'snapshots', branch: 'main', seenPath: SeenPath, pollIntervalMs: 999999,
      githubClient: GithubClient,
    });
    await Module.StartAsync();

    // Disabled → StartAsync is a no-op, the github client is never touched.
    expect(GithubClient.ListSnapshotsAsync).not.toHaveBeenCalled();
  });

  test('legacy workspace-flag path still enables neochrome when the env allowlist is unset', async () => {
    delete process.env.SNAPSHOT_RELAY_WORKSPACES;
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp({ SNAPSHOT_RELAY_ENABLED: true }); // legacy config path
    GithubClient = MakeFakeGithubClient();

    Module = new SnapshotRelayModule(SlackApp, SlackApp.Logger, {
      channelId: 'C000EXAMPLE3', pat: 'test-pat', repo: 'test-org/test-repo',
      dir: 'snapshots', branch: 'main', seenPath: SeenPath, pollIntervalMs: 999999,
      githubClient: GithubClient,
    });
    await Module.StartAsync();

    expect(GithubClient.ListSnapshotsAsync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test suite 7 — Second instance isolation (GH-157 progress digest relay)
//
// app.js runs a SECOND SnapshotRelayModule against a different directory and
// channel. Everything below is a way the two could silently become
// indistinguishable — which is worse than a crash, because the symptom is a
// post in the wrong place or a digest that never appears at all.
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — second-instance isolation', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GithubClient = MakeFakeGithubClient();
    GithubClient.GetContentAsync.mockResolvedValue(DEFAULT_CONTENT);
    Module = null;
  });

  afterEach(async () => {
    if(Module) await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  /**
   * Drive one real post: StartAsync seeds an empty remote (so nothing is skipped as
   * backlog), then a file appears and RunOnceAsync relays it. RunOnceAsync alone is a
   * no-op — it returns early unless StartAsync has marked the module active.
   * @param {object} ArgModule Module under test.
   * @returns {Promise<void>}
   */
  async function StartThenPostAsync(ArgModule) {
    GithubClient.ListSnapshotsAsync.mockResolvedValueOnce([]);
    await ArgModule.StartAsync();
    GithubClient.ListSnapshotsAsync.mockResolvedValue([{ name: 'a.md', sha: 's1' }]);
    await ArgModule.RunOnceAsync();
  }

  test('audit Tag defaults to snapshot-relay so existing observability is unchanged', async () => {
    Module = MakeModule(SlackApp, SeenPath, GithubClient);
    await StartThenPostAsync(Module);

    const [, , , , Tag] = SlackApp.PostMessageTextAsync.mock.calls[0];
    expect(Tag).toEqual({ Tag: 'snapshot-relay' });
  });

  test('a custom auditTag reaches the write audit — the two instances are distinguishable', async () => {
    Module = MakeModule(SlackApp, SeenPath, GithubClient, { auditTag: 'hiqs-digest-relay' });
    await StartThenPostAsync(Module);

    const [, , , , Tag] = SlackApp.PostMessageTextAsync.mock.calls[0];
    expect(Tag).toEqual({ Tag: 'hiqs-digest-relay' });
  });

  test('a custom auditTag prefixes the log lines, not just the audit record', async () => {
    // `journalctl -u sleuth-app | grep '<tag>:'` is the only way this module is
    // diagnosed in production, so the prefix has to move with the tag.
    Module = MakeModule(SlackApp, SeenPath, GithubClient, { auditTag: 'hiqs-digest-relay' });
    await StartThenPostAsync(Module);

    const Posted = SlackApp.Logger.InfoMessages.filter((ArgMsg) => ArgMsg.includes('posted'));
    expect(Posted.length).toBeGreaterThan(0);
    expect(Posted.every((ArgMsg) => ArgMsg.startsWith('hiqs-digest-relay:'))).toBe(true);
    expect(Posted.some((ArgMsg) => ArgMsg.startsWith('snapshot-relay:'))).toBe(false);
  });

  test('the configured channel is used verbatim — never the sanitized placeholder default', async () => {
    // The real channel id is env-only (sanitize-scan flags it as HIGH), so the
    // in-repo default is a placeholder. An instance that silently fell back to it
    // would post into a channel that does not exist, or worse, one that does.
    Module = MakeModule(SlackApp, SeenPath, GithubClient, { channelId: 'C0TESTDIGEST' });
    await StartThenPostAsync(Module);

    const [ChannelID] = SlackApp.PostMessageTextAsync.mock.calls[0];
    expect(ChannelID).toBe('C0TESTDIGEST');
  });

  test('two instances with different tags do not share a seen-set', async () => {
    // Regression guard for the failure that has no error message: a shared seen-set
    // makes the second instance treat the first instance's already-relayed files as
    // seen, so its own digests are never posted and nothing is logged.
    const First = MakeModule(SlackApp, undefined, GithubClient, { auditTag: 'relay-one' });
    const Second = MakeModule(SlackApp, undefined, GithubClient, { auditTag: 'relay-two' });

    expect(First.SeenPathForTest).not.toBe(Second.SeenPathForTest);
    expect(First.SeenPathForTest).toContain('relay-one-seen.json');
    expect(Second.SeenPathForTest).toContain('relay-two-seen.json');
  });
});

// ---------------------------------------------------------------------------
// Test suite — GH-163: renderMrkdwn converts the Markdown body on the short path
// ---------------------------------------------------------------------------
describe('SnapshotRelayModule — renderMrkdwn (GH-163)', () => {
  let TempDir, SeenPath, SlackApp, GithubClient, Module;

  const DIGEST = [
    '# Progress digest — 2026-09-02',
    '',
    '* **repo/a**: Merged a thing (#1).',
    '',
    '---',
    '3 commits · 1 merged',
  ].join('\n');

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-relay-mrkdwn-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GithubClient = MakeFakeGithubClient();
    GithubClient.ListSnapshotsAsync.mockResolvedValueOnce([]);
  });

  afterEach(async () => {
    if(Module) await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  async function PostOneAsync(ArgExtraConfig) {
    Module = MakeModule(SlackApp, SeenPath, GithubClient, ArgExtraConfig);
    await Module.StartAsync();
    GithubClient.ListSnapshotsAsync.mockResolvedValue([{ name: 'hiqs-2026-09-02-1305.md', sha: 'd1' }]);
    GithubClient.GetContentAsync.mockResolvedValue(DIGEST);
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    return SlackApp.PostMessageTextAsync.mock.calls[0][2];
  }

  test('default (off): body is posted verbatim — existing snapshot relay is unchanged', async () => {
    const Text = await PostOneAsync({});
    expect(Text).toContain('# Progress digest — 2026-09-02');
    expect(Text).toContain('* **repo/a**');
    expect(Text).toContain('\n---\n');
  });

  test('renderMrkdwn: true → mrkdwn body, title once (in the header), no Markdown syntax', async () => {
    const Text = await PostOneAsync({ renderMrkdwn: true, auditTag: 'hiqs-digest-relay' });
    expect(Text.startsWith('*Progress digest — 2026-09-02*')).toBe(true);
    expect(Text.match(/Progress digest — 2026-09-02/g)).toHaveLength(1);
    expect(Text).toContain('• *repo/a*: Merged a thing (#1).');
    expect(Text).not.toMatch(/\*\*/);
    expect(Text).not.toMatch(/^#/m);
    expect(Text).not.toMatch(/^---$/m);
    expect(Text).toContain('3 commits · 1 merged');
  });
});
