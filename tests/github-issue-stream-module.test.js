
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

// GH-257: synthetic failure-path coverage in the existing module suite.
describe('GH-257 review regressions', () => {
  let TempDir, StatePath, EnvRepos;
  const Repo = 'hiqs-labs/demo';
  const Stamp = '2026-10-20T12:05:00.000Z';
  const Result = (Items = [], Extra = {}) => ({ Items, RateLimit: { Remaining: 5000 }, Status: 200, ...Extra });
  const Issue = (number = 1) => ({ number, title: `Task ${number}`, state: 'open', html_url: `https://github.com/${Repo}/issues/${number}`, created_at: Stamp, updated_at: Stamp, user: { login: 'alice' } });
  const Comment = (id = 1) => ({ id, body: 'Update', html_url: `https://github.com/${Repo}/issues/1#issuecomment-${id}`, issue_url: `https://api.github.com/repos/${Repo}/issues/1`, created_at: Stamp, updated_at: Stamp, user: { login: 'alice' } });
  const ReadState = async () => JSON.parse(await fs.readFile(StatePath, 'utf8'));
  async function Seed(Thread = false) {
    const State = { SchemaVersion: 1, AllowlistCache: [Repo], Repos: { [Repo]: { Cursor: '2026-10-20T12:00:00.000Z', SeededAt: '2026-10-20T12:00:00.000Z' } }, Issues: {} };
    if(Thread) State.Issues[`${Repo}#1`] = { ChannelID: 'C_OLD', ThreadTs: 'old-ts', PostedKeys: [`parent:${Repo}#1`], Closed: false, LastActivityAt: Stamp };
    await fs.writeFile(StatePath, JSON.stringify(State));
  }
  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gis-gh257-'));
    StatePath = path.join(TempDir, 'state.json');
    EnvRepos = process.env.GITHUB_ISSUE_STREAM_REPOS;
    process.env.GITHUB_ISSUE_STREAM_REPOS = Repo;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if(EnvRepos === undefined) delete process.env.GITHUB_ISSUE_STREAM_REPOS;
    else process.env.GITHUB_ISSUE_STREAM_REPOS = EnvRepos;
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test.each(['issues', 'comments'])('incomplete %s bounds shared cursor despite newer other endpoint', async (Endpoint) => {
    await Seed(true);
    const { Module, GithubClient } = MakeModule({ statePath: StatePath });
    const Earlier = { ...Issue(), updated_at: Stamp };
    const Later = '2026-10-20T18:00:00.000Z';
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([{ ...Earlier, updated_at: Endpoint === 'issues' ? Stamp : Later }], { Complete: Endpoint !== 'issues' }));
    GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(Result([{ ...Comment(), updated_at: Endpoint === 'comments' ? Stamp : Later }], { Complete: Endpoint !== 'comments' }));
    await Module.StartAsync();
    try {
      await Module.RunOnceAsync();
      expect((await ReadState()).Repos[Repo].Cursor).toBe('2026-10-20T12:04:00.000Z');
      // the next bounded batch can progress after the unread range is fetched.
      GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([{ ...Earlier, updated_at: Later }], { Complete: true }));
      GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(Result([{ ...Comment(), updated_at: Later }], { Complete: true }));
      await Module.RunOnceAsync();
      expect((await ReadState()).Repos[Repo].Cursor).toBe('2026-10-20T17:59:00.000Z');
    } finally { await Module.StopAsync(); }
  });

  test.each(['comment', 'pr'])('incomplete issues hold unresolved %s parent without discarding its replay', async (Kind) => {
    await Seed();
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    const Old = Array.from({ length: 500 }, (_, N) => ({ ...Issue(N + 10), created_at: '2026-10-19T00:00:00.000Z', updated_at: '2026-10-20T12:20:00.000Z' }));
    const Pr = { ...Issue(900), title: 'Fix #501', body: '', pull_request: {}, updated_at: '2026-10-20T12:10:00.000Z' };
    const Reply = { ...Comment(9), issue_url: `https://api.github.com/repos/${Repo}/issues/501`, updated_at: '2026-10-20T12:10:00.000Z' };
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result(Kind === 'pr' ? [...Old.slice(0, 499), Pr] : Old, { Complete: false }));
    GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(Result(Kind === 'comment' ? [Reply] : []));
    await Module.StartAsync();
    try {
      await Module.RunOnceAsync();
      expect((await ReadState()).Repos[Repo].Cursor).toBe('2026-10-20T12:00:00.000Z');
      expect(SlackApp.Logger.WarnMessages.some((M) => M.includes('parent'))).toBe(true);
      const Parent = { ...Issue(501), updated_at: '2026-10-20T13:00:00.000Z' };
      GithubClient.ListIssuesSinceAsync.mockImplementation(async (_Repo, Since) => Result([Parent, ...(Kind === 'pr' ? [Pr] : [])].filter((Item) => Item.updated_at >= Since), { Complete: true }));
      GithubClient.ListIssueCommentsSinceAsync.mockImplementation(async (_Repo, Since) => Result(Kind === 'comment' && Reply.updated_at >= Since ? [Reply] : []));
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    } finally { await Module.StopAsync(); }
  });

  test('default client reports a five-page boundary without unbounded fetch', async () => {
    await Seed();
    const Fetch = jest.spyOn(global, 'fetch').mockImplementation(async (Url) => {
      const IsComments = String(Url).includes('/comments?');
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => IsComments ? [{ ...Comment(), updated_at: '2026-10-20T18:00:00.000Z' }] : Array.from({ length: 100 }, (_, I) => ({ ...Issue(I + 1), user: { type: 'Bot' } })) };
    });
    const App = MakeMockSlackApp();
    const Module = new GitHubIssueStreamModule(App, MakeDnd(), { enabled: true, channelId: 'C_TEST', pat: 'test', statePath: StatePath, pollIntervalMs: 999999, postGapMs: 0 });
    await Module.StartAsync();
    try {
      await Module.RunOnceAsync();
      expect(Fetch).toHaveBeenCalledTimes(6);
      expect((await ReadState()).Repos[Repo].Cursor).toBe('2026-10-20T12:04:00.000Z');
    } finally { await Module.StopAsync(); }
  });

  test('channel change keeps replies paired with saved parent and respects old-channel DND', async () => {
    await Seed(true);
    const Dnd = MakeDnd(false, ['C_OLD']);
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath, channelId: 'C_NEW', dnd: Dnd });
    GithubClient.ListIssueCommentsSinceAsync.mockResolvedValue(Result([Comment()]));
    await Module.StartAsync();
    try {
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
      expect((await ReadState()).Repos[Repo].Cursor).toBe('2026-10-20T12:00:00.000Z');
      Dnd.IsChannelDnd.mockReturnValue(false);
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith('C_OLD', 'old-ts', expect.any(String), undefined, expect.any(Object));
    } finally { await Module.StopAsync(); }
  });

  test('DND enabled by first post holds remaining batch and resumes without repeating it', async () => {
    await Seed();
    const { Module, GithubClient, SlackApp, Dnd } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue(1), Issue(2)]));
    SlackApp.PostMessageTextAsync.mockImplementationOnce(async () => { Dnd.IsWorkspaceDnd.mockReturnValue(true); return 'first'; });
    await Module.StartAsync();
    try {
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
      expect((await ReadState()).Repos[Repo].Cursor).toBe('2026-10-20T12:00:00.000Z');
      Dnd.IsWorkspaceDnd.mockReturnValue(false);
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    } finally { await Module.StopAsync(); }
  });

  test.each(['empty', 'stale', 'transport', 'file-transport'])('dynamic %s never reuses legacy allowlist cache', async (Mode) => {
    await Seed();
    delete process.env.GITHUB_ISSUE_STREAM_REPOS;
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue()]));
    if(Mode === 'transport') GithubClient.ListAllowlistFilesAsync.mockRejectedValue(new Error('pulse down'));
    if(Mode === 'stale' || Mode === 'file-transport') {
      GithubClient.ListAllowlistFilesAsync.mockResolvedValue([{ name: 'mac.json' }]);
      GithubClient.GetAllowlistFileAsync.mockResolvedValue(JSON.stringify({ schema_version: 1, source: 'repos', generated_at: '2026-10-01T00:00:00.000Z', rows: [Repo] }));
      if(Mode === 'file-transport') GithubClient.GetAllowlistFileAsync.mockRejectedValue(new Error('file down'));
    }
    await Module.StartAsync();
    try {
      await Module.RunOnceAsync();
      expect(GithubClient.ListIssuesSinceAsync).not.toHaveBeenCalled();
      expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
      if(Mode.includes('transport')) expect((await ReadState()).Repos[Repo]).toBeDefined();
      else expect((await ReadState()).Repos[Repo]).toBeUndefined();
    } finally { await Module.StopAsync(); }
  });

  test('save failure after Slack acceptance stops batch; recovery flushes pending keys before restart', async () => {
    await Seed();
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue(1), Issue(2)]));
    const Mkdir = fs.mkdir.bind(fs);
    let Fail = false;
    jest.spyOn(fs, 'mkdir').mockImplementation(async (...Args) => { if(Fail) throw new Error('disk full'); return Mkdir(...Args); });
    SlackApp.PostMessageTextAsync.mockImplementationOnce(async () => { Fail = true; return 'accepted'; });
    await Module.StartAsync();
    try {
      await expect(Module.RunOnceAsync()).rejects.toThrow('disk full');
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
      await expect(Module.RunOnceAsync()).rejects.toThrow('disk full');
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
      Fail = false;
      await Module.RunOnceAsync();
      expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    } finally { Fail = false; await Module.StopAsync(); }
    const Restart = MakeModule({ statePath: StatePath });
    Restart.GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue(1), Issue(2)]));
    await Restart.Module.StartAsync();
    try { await Restart.Module.RunOnceAsync(); expect(Restart.SlackApp.PostMessageTextAsync).not.toHaveBeenCalled(); }
    finally { await Restart.Module.StopAsync(); }
  });

  test('unwritable state before delivery prevents all Slack writes', async () => {
    await Seed();
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue()]));
    await Module.StartAsync();
    const Mkdir = jest.spyOn(fs, 'mkdir').mockRejectedValue(new Error('unwritable'));
    try { await expect(Module.RunOnceAsync()).rejects.toThrow('unwritable'); expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled(); }
    finally { Mkdir.mockRestore(); await Module.StopAsync(); }
  });

  test('shutdown waits for in-flight accepted post, saves it, cancels rest, and prevents restart repeats', async () => {
    await Seed();
    const { Module, GithubClient, SlackApp } = MakeModule({ statePath: StatePath });
    GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue(1), Issue(2)]));
    let Accept;
    let Entered;
    const InPost = new Promise((Resolve) => { Entered = Resolve; });
    SlackApp.PostMessageTextAsync.mockImplementationOnce(() => { Entered(); return new Promise((Resolve) => { Accept = Resolve; }); });
    await Module.StartAsync();
    const Cycle = Module.RunOnceAsync();
    await InPost;
    let Stopped = false;
    const Stop = Module.StopAsync().then(() => { Stopped = true; });
    try {
      await Promise.resolve();
      expect(Stopped).toBe(false);
    } finally { Accept('accepted-before-stop'); await Cycle; await Stop; }
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    expect((await ReadState()).Issues[`${Repo}#1`].ThreadTs).toBe('accepted-before-stop');
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    const Restart = MakeModule({ statePath: StatePath });
    Restart.GithubClient.ListIssuesSinceAsync.mockResolvedValue(Result([Issue(1), Issue(2)]));
    await Restart.Module.StartAsync();
    try { await Restart.Module.RunOnceAsync(); expect(Restart.SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1); expect(Restart.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toContain('Task 2'); }
    finally { await Restart.Module.StopAsync(); }
  });
});
