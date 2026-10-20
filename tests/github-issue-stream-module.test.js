
'use strict';

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const GitHubIssueStreamModule = require('../src/github-issue-stream-module');

/**
 * @param {object} [ArgWorkspaceInfo]
 */
function MakeMockSlackApp(ArgWorkspaceInfo = {}) {
  const Logger = {
    InfoMessages: [],
    WarnMessages: [],
    ErrorMessages: [],
    info(...ArgArgs) { this.InfoMessages.push(ArgArgs.join(' ')); },
    warn(...ArgArgs) { this.WarnMessages.push(ArgArgs.join(' ')); },
    error(...ArgArgs) { this.ErrorMessages.push(ArgArgs.join(' ')); },
  };
  return {
    WorkspaceInfo: {
      WORKSPACE_NAME: 'neochrome',
      GITHUB_PAT: 'test-pat',
      ...ArgWorkspaceInfo,
    },
    Logger,
    PostMessageTextAsync: jest.fn().mockImplementation(async (_Channel, _Thread, _Text) => {
      return `ts-${MakeMockSlackApp._Seq++}`;
    }),
  };
}
MakeMockSlackApp._Seq = 1;

function MakeDnd(ArgWorkspace = false, ArgChannels = []) {
  return {
    IsWorkspaceDnd: jest.fn(() => ArgWorkspace),
    IsChannelDnd: jest.fn((ArgChannelID) => ArgChannels.includes(ArgChannelID)),
  };
}

function MakeGithubClient() {
  return {
    ListIssuesSinceAsync: jest.fn().mockResolvedValue({ Items: [], RateLimit: { Remaining: 5000 }, Status: 200 }),
    ListIssueCommentsSinceAsync: jest.fn().mockResolvedValue({ Items: [], RateLimit: { Remaining: 5000 }, Status: 200 }),
    ListAllowlistFilesAsync: jest.fn().mockResolvedValue([]),
    GetAllowlistFileAsync: jest.fn().mockResolvedValue(''),
  };
}

/**
 * @param {object} ArgOpts
 */
function MakeModule(ArgOpts = {}) {
  const SlackApp = ArgOpts.slackApp ?? MakeMockSlackApp();
  const Dnd = ArgOpts.dnd ?? MakeDnd();
  const GithubClient = ArgOpts.githubClient ?? MakeGithubClient();
  const FixedNow = ArgOpts.now ?? (() => new Date('2026-10-20T12:00:00.000Z'));
  const Module = new GitHubIssueStreamModule(SlackApp, Dnd, {
    enabled: ArgOpts.enabled ?? true,
    channelId: ArgOpts.channelId ?? 'C_TEST',
    pat: 'test-pat',
    statePath: ArgOpts.statePath,
    pollIntervalMs: 999999,
    postBudget: ArgOpts.postBudget ?? 40,
    postGapMs: ArgOpts.postGapMs ?? 0,
    githubClient: GithubClient,
    now: FixedNow,
    sleepAsync: async () => {},
  });
  // force an explicit allowlist via private config by seeding state after StartAsync,
  // or by stubbing the allowlist client. Tests that need repos stub ListAllowlistFilesAsync.
  return { Module, SlackApp, Dnd, GithubClient };
}

describe('GitHubIssueStreamModule — enable gate', () => {
  const PrevWorkspaces = process.env.GITHUB_ISSUE_STREAM_WORKSPACES;
  const PrevChannel = process.env.GITHUB_ISSUE_STREAM_CHANNEL_ID;

  afterEach(() => {
    if(PrevWorkspaces === undefined) delete process.env.GITHUB_ISSUE_STREAM_WORKSPACES;
    else process.env.GITHUB_ISSUE_STREAM_WORKSPACES = PrevWorkspaces;
    if(PrevChannel === undefined) delete process.env.GITHUB_ISSUE_STREAM_CHANNEL_ID;
    else process.env.GITHUB_ISSUE_STREAM_CHANNEL_ID = PrevChannel;
  });

  test('disabled when env unset — StartAsync is a no-op', async () => {
    delete process.env.GITHUB_ISSUE_STREAM_WORKSPACES;
    delete process.env.GITHUB_ISSUE_STREAM_CHANNEL_ID;
    const SlackApp = MakeMockSlackApp();
    const Module = new GitHubIssueStreamModule(SlackApp, MakeDnd());
    expect(Module.EnabledForTest).toBe(false);
    await Module.StartAsync();
    expect(SlackApp.Logger.InfoMessages.some((ArgM) => ArgM.includes('disabled'))).toBe(true);
    await Module.StopAsync();
  });

  test('disabled when channel missing despite workspace allowlist', async () => {
    process.env.GITHUB_ISSUE_STREAM_WORKSPACES = 'neochrome';
    delete process.env.GITHUB_ISSUE_STREAM_CHANNEL_ID;
    const SlackApp = MakeMockSlackApp();
    const Module = new GitHubIssueStreamModule(SlackApp, MakeDnd());
    expect(Module.EnabledForTest).toBe(false);
    expect(SlackApp.Logger.WarnMessages.some((ArgM) => ArgM.includes('CHANNEL_ID'))).toBe(true);
  });
});

describe('GitHubIssueStreamModule — posting and idempotency', () => {
  let TempDir, StatePath, EnvRepos;

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gis-test-'));
    StatePath = path.join(TempDir, 'state.json');
    EnvRepos = process.env.GITHUB_ISSUE_STREAM_REPOS;
    process.env.GITHUB_ISSUE_STREAM_REPOS = 'hiqs-labs/demo';
    MakeMockSlackApp._Seq = 1;
  });

  afterEach(async () => {
    if(EnvRepos === undefined) delete process.env.GITHUB_ISSUE_STREAM_REPOS;
    else process.env.GITHUB_ISSUE_STREAM_REPOS = EnvRepos;
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('first run seeds and posts nothing', async () => {
    const { Module, SlackApp, GithubClient } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue({
      Items: [{
        number: 1,
        title: 'Pre-existing',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1',
        created_at: '2026-10-19T00:00:00.000Z',
        updated_at: '2026-10-20T11:00:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      RateLimit: { Remaining: 5000 },
      Status: 200,
    });
    await Module.StartAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    await Module.RunOnceAsync();
    // seeded at fixed now; issue created before SeededAt is skipped.
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    await Module.StopAsync();
  });

  test('new issue posts exactly once; restart with same payload posts nothing', async () => {
    const Issue = {
      number: 9,
      title: 'Brand new',
      state: 'open',
      html_url: 'https://github.com/hiqs-labs/demo/issues/9',
      created_at: '2026-10-20T12:05:00.000Z',
      updated_at: '2026-10-20T12:05:00.000Z',
      user: { login: 'alice', type: 'User' },
    };
    const Payload = { Items: [Issue], RateLimit: { Remaining: 5000 }, Status: 200 };
    const EmptyComments = { Items: [], RateLimit: { Remaining: 5000 }, Status: 200 };

    const First = MakeModule({
      statePath: StatePath,
      now: (() => {
        let N = 0;
        return () => {
          // first StartAsync seed at 12:00; subsequent polls also use 12:00 for prune.
          N += 1;
          return new Date('2026-10-20T12:00:00.000Z');
        };
      })(),
    });
    First.GithubClient.ListIssuesSinceAsync.mockResolvedValue(Payload);
    First.GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(EmptyComments);
    await First.Module.StartAsync();
    await First.Module.RunOnceAsync();
    expect(First.SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    expect(First.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toContain('Brand new');
    await First.Module.StopAsync();

    const Second = MakeModule({ statePath: StatePath });
    Second.GithubClient.ListIssuesSinceAsync.mockResolvedValue(Payload);
    Second.GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(EmptyComments);
    await Second.Module.StartAsync();
    await Second.Module.RunOnceAsync();
    expect(Second.SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    await Second.Module.StopAsync();
  });

  test('DND holds the cursor; clearing DND delivers the event', async () => {
    const Issue = {
      number: 3,
      title: 'Held',
      state: 'open',
      html_url: 'https://github.com/hiqs-labs/demo/issues/3',
      created_at: '2026-10-20T12:05:00.000Z',
      updated_at: '2026-10-20T12:05:00.000Z',
      user: { login: 'alice', type: 'User' },
    };
    const Payload = { Items: [Issue], RateLimit: { Remaining: 5000 }, Status: 200 };
    const EmptyComments = { Items: [], RateLimit: { Remaining: 5000 }, Status: 200 };
    const Dnd = MakeDnd(true);
    const Held = MakeModule({ statePath: StatePath, dnd: Dnd });
    Held.GithubClient.ListIssuesSinceAsync.mockResolvedValue(Payload);
    Held.GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(EmptyComments);
    await Held.Module.StartAsync();
    await Held.Module.RunOnceAsync();
    expect(Held.SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    expect(Held.GithubClient.ListIssuesSinceAsync).not.toHaveBeenCalled();
    await Held.Module.StopAsync();

    Dnd.IsWorkspaceDnd.mockReturnValue(false);
    const Open = MakeModule({ statePath: StatePath, dnd: Dnd });
    Open.GithubClient.ListIssuesSinceAsync.mockResolvedValue(Payload);
    Open.GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(EmptyComments);
    await Open.Module.StartAsync();
    await Open.Module.RunOnceAsync();
    expect(Open.SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    await Open.Module.StopAsync();
  });

  test('Slack failure mid-cycle leaves cursor; next cycle completes without duplicates', async () => {
    const Issue = {
      number: 4,
      title: 'Retry me',
      state: 'open',
      html_url: 'https://github.com/hiqs-labs/demo/issues/4',
      created_at: '2026-10-20T12:05:00.000Z',
      updated_at: '2026-10-20T12:05:00.000Z',
      user: { login: 'alice', type: 'User' },
    };
    const Payload = { Items: [Issue], RateLimit: { Remaining: 5000 }, Status: 200 };
    const EmptyComments = { Items: [], RateLimit: { Remaining: 5000 }, Status: 200 };
    const { Module, SlackApp, GithubClient } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Payload);
    GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(EmptyComments);
    SlackApp.PostMessageTextAsync
      .mockRejectedValueOnce(new Error('slack down'))
      .mockResolvedValueOnce('ts-ok');
    await Module.StartAsync();
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    await Module.StopAsync();
  });

  test('403 sets backoff and stops the cycle', async () => {
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue({
      Items: [],
      RateLimit: { Remaining: 0, Reset: Math.floor(Date.now() / 1000) + 60 },
      Status: 403,
      Error: 'rate limited',
    });
    await Module.StartAsync();
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    expect(SlackApp.Logger.WarnMessages.some((ArgM) => ArgM.includes('403'))).toBe(true);
    await Module.StopAsync();
  });

  test('post budget carries remaining actions to the next cycle', async () => {
    const Issues = [1, 2, 3].map((ArgN) => ({
      number: ArgN,
      title: `Issue ${ArgN}`,
      state: 'open',
      html_url: `https://github.com/hiqs-labs/demo/issues/${ArgN}`,
      created_at: '2026-10-20T12:05:00.000Z',
      updated_at: '2026-10-20T12:05:00.000Z',
      user: { login: 'alice', type: 'User' },
    }));
    const Payload = { Items: Issues, RateLimit: { Remaining: 5000 }, Status: 200 };
    const EmptyComments = { Items: [], RateLimit: { Remaining: 5000 }, Status: 200 };
    const { Module, SlackApp, GithubClient } = MakeModule({ statePath: StatePath, postBudget: 2 });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Payload);
    GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(EmptyComments);
    await Module.StartAsync();
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(3);
    await Module.StopAsync();
  });

  test('allowlist falls back to cache when git-pulse fails', async () => {
    delete process.env.GITHUB_ISSUE_STREAM_REPOS;
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    // seed a cache by writing state first via a successful allowlist, then fail.
    GithubClient.ListAllowlistFilesAsync.mockResolvedValueOnce([
      { name: 'mac.json', sha: 'a' },
    ]);
    GithubClient.GetAllowlistFileAsync.mockResolvedValueOnce(JSON.stringify({
      schema_version: 1,
      source: 'repos',
      device_id: 'mac',
      generated_at: '2026-10-20T11:00:00.000Z',
      row_count: 1,
      rows: ['hiqs-labs/demo'],
    }));
    await Module.StartAsync();
    GithubClient.ListAllowlistFilesAsync.mockRejectedValueOnce(new Error('pulse down'));
    GithubClient.ListIssuesSinceAsync.mockResolvedValue({
      Items: [{
        number: 8,
        title: 'From cache',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/issues/8',
        created_at: '2026-10-20T12:05:00.000Z',
        updated_at: '2026-10-20T12:05:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      RateLimit: { Remaining: 5000 },
      Status: 200,
    });
    GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue({
      Items: [], RateLimit: { Remaining: 5000 }, Status: 200,
    });
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    await Module.StopAsync();
    process.env.GITHUB_ISSUE_STREAM_REPOS = 'hiqs-labs/demo';
  });

  test('two workspaces get two separate state files', async () => {
    const PathA = path.join(TempDir, 'a.json');
    const PathB = path.join(TempDir, 'b.json');
    const AppA = MakeMockSlackApp({ WORKSPACE_NAME: 'neochrome' });
    const AppB = MakeMockSlackApp({ WORKSPACE_NAME: 'other' });
    const ModA = new GitHubIssueStreamModule(AppA, MakeDnd(), {
      enabled: true, channelId: 'C1', pat: 'p', statePath: PathA, pollIntervalMs: 999999,
      postGapMs: 0, githubClient: MakeGithubClient(), now: () => new Date('2026-10-20T12:00:00.000Z'),
      sleepAsync: async () => {},
    });
    const ModB = new GitHubIssueStreamModule(AppB, MakeDnd(), {
      enabled: true, channelId: 'C2', pat: 'p', statePath: PathB, pollIntervalMs: 999999,
      postGapMs: 0, githubClient: MakeGithubClient(), now: () => new Date('2026-10-20T12:00:00.000Z'),
      sleepAsync: async () => {},
    });
    await ModA.StartAsync();
    await ModB.StartAsync();
    expect(ModA.StatePathForTest).toBe(PathA);
    expect(ModB.StatePathForTest).toBe(PathB);
    expect(PathA).not.toBe(PathB);
    await ModA.StopAsync();
    await ModB.StopAsync();
  });
});
