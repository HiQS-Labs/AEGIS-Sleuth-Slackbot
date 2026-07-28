'use strict';

const GitHubSyncModule = require('../src/github-sync-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

// minimal mock logger — prevents noise and satisfies the constructor.
const MockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// minimal mock RemindersModule for TestGitHubUrlAsync calls.
const MockRemindersModule = {
  SlackApp: {
    WorkspaceInfo: { WORKSPACE_NAME: 'TestWorkspace', GITHUB_PAT: 'ghp_test123' }
  }
};

// ---------------------------------------------------------------------------
// ParseGitHubUrl
// ---------------------------------------------------------------------------

describe('GitHubSyncModule.ParseGitHubUrl', () => {
  test('parses a valid issue URL', () => {
    const Result = GitHubSyncModule.ParseGitHubUrl('https://github.com/owner/repo/issues/42');
    expect(Result).toEqual({ owner: 'owner', repo: 'repo', type: 'issues', number: 42 });
  });

  test('parses a valid pull request URL', () => {
    const Result = GitHubSyncModule.ParseGitHubUrl('https://github.com/owner/repo/pull/7');
    expect(Result).toEqual({ owner: 'owner', repo: 'repo', type: 'pull', number: 7 });
  });

  test('accepts a trailing slash', () => {
    const Result = GitHubSyncModule.ParseGitHubUrl('https://github.com/owner/repo/issues/1/');
    expect(Result).toEqual({ owner: 'owner', repo: 'repo', type: 'issues', number: 1 });
  });

  test('returns null for a non-github.com domain', () => {
    expect(GitHubSyncModule.ParseGitHubUrl('https://gitlab.com/owner/repo/issues/1')).toBeNull();
  });

  test('returns null when the path has no issue/pull segment', () => {
    expect(GitHubSyncModule.ParseGitHubUrl('https://github.com/owner/repo')).toBeNull();
  });

  test('returns null for a github.com URL that is not an issue or PR', () => {
    expect(GitHubSyncModule.ParseGitHubUrl('https://github.com/owner/repo/actions/runs/999')).toBeNull();
  });

  test('returns null for invalid owner or repo slug characters', () => {
    expect(GitHubSyncModule.ParseGitHubUrl('https://github.com/owner:bad/repo/issues/1')).toBeNull();
    expect(GitHubSyncModule.ParseGitHubUrl('https://github.com/owner/repo:bad/issues/1')).toBeNull();
  });

  test('returns null for a plain string that is not a URL', () => {
    expect(GitHubSyncModule.ParseGitHubUrl('not a url at all')).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(GitHubSyncModule.ParseGitHubUrl(null)).toBeNull();
    expect(GitHubSyncModule.ParseGitHubUrl(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EvaluateAutoComplete
// ---------------------------------------------------------------------------

describe('GitHubSyncModule.EvaluateAutoComplete', () => {
  const closedIssue = { ok: true, stopCycle: false, type: 'issue', state: 'closed', mergedAt: null, failureMode: null };
  const openIssue = { ok: true, stopCycle: false, type: 'issue', state: 'open', mergedAt: null, failureMode: null };
  const mergedPullRequest = { ok: true, stopCycle: false, type: 'pull', state: 'closed', mergedAt: '2026-03-04T18:01:56Z', failureMode: null };
  const closedPullRequest = { ok: true, stopCycle: false, type: 'pull', state: 'closed', mergedAt: null, failureMode: null };
  const openPullRequest = { ok: true, stopCycle: false, type: 'pull', state: 'open', mergedAt: null, failureMode: null };
  const apiError = { ok: false, stopCycle: false, type: 'issue', state: null, mergedAt: null, failureMode: 'not-found' };
  const pullApiError = { ok: false, stopCycle: false, type: 'pull', state: null, mergedAt: null, failureMode: 'forbidden' };
  const rateLimited = { ok: false, stopCycle: true, type: 'issue', state: null, mergedAt: null, failureMode: 'forbidden' };

  test('single closed issue → shouldComplete true', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1'], [closedIssue]
    );
    expect(Result).toEqual({
      shouldComplete: true,
      stopCycle: false,
      completionItems: [{
        url: 'https://github.com/o/r/issues/1',
        type: 'issue',
        outcome: 'issue-closed',
      }],
      blockingItem: null,
    });
  });

  test('multiple closed issues → shouldComplete true with all URLs', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'],
      [closedIssue, closedIssue]
    );
    expect(Result.shouldComplete).toBe(true);
    expect(Result.completionItems).toHaveLength(2);
    expect(Result.completionItems.every(ArgItem => ArgItem.outcome === 'issue-closed')).toBe(true);
  });

  test('any open issue → shouldComplete false', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'],
      [closedIssue, openIssue]
    );
    expect(Result).toEqual({
      shouldComplete: false,
      stopCycle: false,
      completionItems: [],
      blockingItem: {
        url: 'https://github.com/o/r/issues/2',
        type: 'issue',
        state: 'open',
        reason: 'issue-open',
      }
    });
  });

  test('merged pull request → shouldComplete true', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/pull/5'], [mergedPullRequest]
    );
    expect(Result).toEqual({
      shouldComplete: true,
      stopCycle: false,
      completionItems: [{
        url: 'https://github.com/o/r/pull/5',
        type: 'pull',
        outcome: 'pr-merged',
      }],
      blockingItem: null,
    });
  });

  test('closed-unmerged pull request → shouldComplete true', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/pull/5'], [closedPullRequest]
    );
    expect(Result).toEqual({
      shouldComplete: true,
      stopCycle: false,
      completionItems: [{
        url: 'https://github.com/o/r/pull/5',
        type: 'pull',
        outcome: 'pr-closed',
      }],
      blockingItem: null,
    });
  });

  test('open pull request → shouldComplete false', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/pull/5'], [openPullRequest]
    );
    expect(Result).toEqual({
      shouldComplete: false,
      stopCycle: false,
      completionItems: [],
      blockingItem: {
        url: 'https://github.com/o/r/pull/5',
        type: 'pull',
        state: 'open',
        reason: 'pull-open',
      }
    });
  });

  test('mixed closed issue + merged pull request → shouldComplete true', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1', 'https://github.com/o/r/pull/5'],
      [closedIssue, mergedPullRequest]
    );
    expect(Result.shouldComplete).toBe(true);
    expect(Result.completionItems).toEqual([
      { url: 'https://github.com/o/r/issues/1', type: 'issue', outcome: 'issue-closed' },
      { url: 'https://github.com/o/r/pull/5', type: 'pull', outcome: 'pr-merged' },
    ]);
  });

  test('mixed closed issue + open pull request → shouldComplete false', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1', 'https://github.com/o/r/pull/5'],
      [closedIssue, openPullRequest]
    );
    expect(Result.shouldComplete).toBe(false);
    expect(Result.blockingItem).toEqual({
      url: 'https://github.com/o/r/pull/5',
      type: 'pull',
      state: 'open',
      reason: 'pull-open',
    });
  });

  test('API error on any URL → shouldComplete false', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1'], [apiError]
    );
    expect(Result).toEqual({
      shouldComplete: false,
      stopCycle: false,
      completionItems: [],
      blockingItem: {
        url: 'https://github.com/o/r/issues/1',
        type: 'issue',
        state: null,
        reason: 'not-found',
      }
    });
  });

  test('PR API error keeps reminder active instead of stopping the cycle', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/pull/5'], [pullApiError]
    );
    expect(Result).toEqual({
      shouldComplete: false,
      stopCycle: false,
      completionItems: [],
      blockingItem: {
        url: 'https://github.com/o/r/pull/5',
        type: 'pull',
        state: null,
        reason: 'forbidden',
      }
    });
  });

  test('rate-limited URL → stopCycle true', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1'], [rateLimited]
    );
    expect(Result).toEqual({
      shouldComplete: false,
      stopCycle: true,
      completionItems: [],
      blockingItem: {
        url: 'https://github.com/o/r/issues/1',
        type: 'issue',
        state: null,
        reason: 'forbidden',
      }
    });
  });

  test('empty URL list → shouldComplete false', () => {
    const Result = GitHubSyncModule.EvaluateAutoComplete([], []);
    expect(Result).toEqual({
      shouldComplete: false,
      stopCycle: false,
      completionItems: [],
      blockingItem: null,
    });
  });

  test('mismatched URL/status array lengths throw', () => {
    expect(() => GitHubSyncModule.EvaluateAutoComplete(
      ['https://github.com/o/r/issues/1'],
      []
    )).toThrow(/equal-length/i);
  });
});

// ---------------------------------------------------------------------------
// HTTP response handling — mocked fetch via TestGitHubUrlAsync
// ---------------------------------------------------------------------------

describe('GitHubSyncModule.TestGitHubUrlAsync — fetch response handling', () => {
  const IssueUrl = 'https://github.com/owner/repo/issues/42';
  const PullUrl = 'https://github.com/owner/repo/pull/15';
  let Module;

  beforeEach(() => {
    Module = new GitHubSyncModule([], MockLogger);
    jest.spyOn(global, 'fetch').mockReset();
  });

  afterAll(() => jest.restoreAllMocks());

  function mockFetch(status, body) {
    global.fetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  }

  test('open issue → ok: true with open state in message', async () => {
    mockFetch(200, { state: 'open' });
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, IssueUrl);
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/open/i);
  });

  test('closed issue → ok: true with closed state and auto-complete eligibility note', async () => {
    mockFetch(200, { state: 'closed' });
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, IssueUrl);
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/closed/i);
    expect(Result.message).toMatch(/auto-complete/i);
  });

  test('open pull request → ok: true with active reminder message', async () => {
    mockFetch(200, { state: 'open', merged_at: null });
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, PullUrl);
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/pull request/i);
    expect(Result.message).toMatch(/keep a reminder active/i);
  });

  test('merged pull request → ok: true with auto-complete eligibility note', async () => {
    mockFetch(200, { state: 'closed', merged_at: '2026-03-04T18:01:56Z' });
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, PullUrl);
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/merged/i);
    expect(Result.message).toMatch(/eligible for auto-complete/i);
  });

  test('closed-unmerged pull request → ok: true with auto-complete eligibility note', async () => {
    mockFetch(200, { state: 'closed', merged_at: null });
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, PullUrl);
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/closed without merge/i);
    expect(Result.message).toMatch(/eligible for auto-complete/i);
  });

  test('403 response → ok: false with rate-limited/forbidden message', async () => {
    mockFetch(403, {});
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, IssueUrl);
    expect(Result.ok).toBe(false);
    expect(Result.message).toMatch(/rate-limited|forbidden/i);
  });

  test('403 response for pull request → ok: false with conservative active-reminder message', async () => {
    mockFetch(403, {});
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, PullUrl);
    expect(Result.ok).toBe(false);
    expect(Result.message).toMatch(/remain active/i);
  });

  test('404 response → ok: false', async () => {
    mockFetch(404, {});
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, IssueUrl);
    expect(Result.ok).toBe(false);
  });

  test('response missing state field → ok: false', async () => {
    mockFetch(200, { title: 'No state here' });
    const Result = await Module.TestGitHubUrlAsync(MockRemindersModule, IssueUrl);
    expect(Result.ok).toBe(false);
  });

  test('no GITHUB_PAT configured → ok: false with config message', async () => {
    const NoPat = { SlackApp: { WorkspaceInfo: { WORKSPACE_NAME: 'TestWorkspace', GITHUB_PAT: null } } };
    const Result = await Module.TestGitHubUrlAsync(NoPat, IssueUrl);
    expect(Result.ok).toBe(false);
    expect(Result.message).toMatch(/not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BuildSingleUrlDebugResult
// ---------------------------------------------------------------------------

describe('GitHubSyncModule.BuildSingleUrlDebugResult', () => {
  test('open PR uses active reminder wording', () => {
    const Result = GitHubSyncModule.BuildSingleUrlDebugResult(
      'https://github.com/o/r/pull/223',
      { owner: 'o', repo: 'r', type: 'pull', number: 223 },
      { ok: true, stopCycle: false, type: 'pull', state: 'open', mergedAt: null, failureMode: null }
    );
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/keep a reminder active/i);
  });

  test('merged PR uses merged wording', () => {
    const Result = GitHubSyncModule.BuildSingleUrlDebugResult(
      'https://github.com/o/r/pull/221',
      { owner: 'o', repo: 'r', type: 'pull', number: 221 },
      { ok: true, stopCycle: false, type: 'pull', state: 'closed', mergedAt: '2026-03-04T18:01:56Z', failureMode: null }
    );
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/merged/i);
    expect(Result.message).toMatch(/eligible for auto-complete/i);
  });

  test('closed-unmerged PR uses closed wording', () => {
    const Result = GitHubSyncModule.BuildSingleUrlDebugResult(
      'https://github.com/o/r/pull/218',
      { owner: 'o', repo: 'r', type: 'pull', number: 218 },
      { ok: true, stopCycle: false, type: 'pull', state: 'closed', mergedAt: null, failureMode: null }
    );
    expect(Result.ok).toBe(true);
    expect(Result.message).toMatch(/closed without merge/i);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat copy and scheduled heartbeat behavior
// ---------------------------------------------------------------------------

describe('GitHubSyncModule heartbeat helpers', () => {
  test('BuildHeartbeatCopy returns success copy for completed cycle', () => {
    expect(GitHubSyncModule.BuildHeartbeatCopy({
      workspaceName: 'TestWorkspace',
      checkedReminderCount: 7,
      autoCompletedCount: 1,
      cycleStatus: 'completed',
      skippedReason: null,
    })).toBe(
      'GitHub sync heartbeat: cycle completed for workspace TestWorkspace. Checked 7 GitHub-linked reminder(s); auto-completed 1.'
    );
  });

  test('BuildHeartbeatCopy returns skipped copy', () => {
    expect(GitHubSyncModule.BuildHeartbeatCopy({
      workspaceName: 'TestWorkspace',
      checkedReminderCount: 0,
      autoCompletedCount: 0,
      cycleStatus: 'skipped',
      skippedReason: 'GITHUB_PAT not configured',
    })).toBe(
      'GitHub sync heartbeat: skipped for workspace TestWorkspace because GITHUB_PAT not configured.'
    );
  });

  test('BuildHeartbeatCopy returns error copy', () => {
    expect(GitHubSyncModule.BuildHeartbeatCopy({
      workspaceName: 'TestWorkspace',
      checkedReminderCount: 3,
      autoCompletedCount: 0,
      cycleStatus: 'error',
      skippedReason: null,
    })).toBe(
      'GitHub sync heartbeat: cycle encountered an error after checking 3 GitHub-linked reminder(s) in workspace TestWorkspace. Review logs for details.'
    );
  });
});

describe('GitHubSyncModule scheduled heartbeat behavior', () => {
  function CreateWorkspaceInfo(ArgOverrides = {}) {
    return {
      WORKSPACE_NAME: 'TestWorkspace',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'test-reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
      GITHUB_PAT: 'ghp_test123',
      ...ArgOverrides,
    };
  }

  function CreateReminder(ArgOverrides = {}) {
    return {
      ReminderID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      TargetChannelID: 'C_OTHER',
      ReminderMessageText: '<@U123> please review the GitHub work item',
      GitHubUrls: ['https://github.com/o/r/issues/42'],
      ...ArgOverrides,
    };
  }

  function CreateHarness(ArgSlackApp, ArgOverrides = {}) {
    return {
      DataLoaded: true,
      DataLoadError: null,
      SlackApp: ArgSlackApp,
      GetAllReminders: jest.fn(() => [CreateReminder()]),
      CompleteReminderByIdAsync: jest.fn(async () => true),
      ...ArgOverrides,
    };
  }

  let FetchSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    FetchSpy = jest.spyOn(global, 'fetch').mockReset();
  });

  afterEach(async () => {
    jest.useRealTimers();
  });

  afterAll(() => jest.restoreAllMocks());

  async function RunScheduledCycleAsync(ArgModule, ArgIntervalMs) {
    await ArgModule.StartAsync();
    await jest.advanceTimersByTimeAsync(ArgIntervalMs);
  }

  test('flag unset leaves scheduled heartbeat disabled', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: CreateWorkspaceInfo(),
      ChannelIdsByName: { 'test-reminders': 'C_MAIN' },
    });
    const RemindersModuleHarness = CreateHarness(SlackApp);
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 50);
    const GetChannelIdSpy = jest.spyOn(SlackApp, 'GetChannelIdAsync');

    FetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: 'open' }),
    });

    try {
      await RunScheduledCycleAsync(Module, 50);
      expect(SlackApp.SentMessages).toHaveLength(0);
      expect(GetChannelIdSpy).not.toHaveBeenCalled();
    } finally {
      await Module.StopAsync();
    }
  });

  test('flag enabled posts heartbeat to REMINDER_CHANNEL_NAME only', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: CreateWorkspaceInfo({ GITHUB_SYNC_HEARTBEAT_ENABLED: 'yes' }),
      ChannelIdsByName: { 'test-reminders': 'C_MAIN' },
    });
    const RemindersModuleHarness = CreateHarness(SlackApp);
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 50);

    FetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: 'open' }),
    });

    try {
      await RunScheduledCycleAsync(Module, 50);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].channel).toBe('C_MAIN');
      expect(SlackApp.SentMessages[0].channel).not.toBe('C_OTHER');
      expect(SlackApp.SentMessages[0].text).toBe(
        'GitHub sync heartbeat: cycle completed for workspace TestWorkspace. Checked 1 GitHub-linked reminder(s); auto-completed 0.'
      );
    } finally {
      await Module.StopAsync();
    }
  });

  test('zero eligible reminders posts zero-count heartbeat copy', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: CreateWorkspaceInfo({ GITHUB_SYNC_HEARTBEAT_ENABLED: 'true' }),
      ChannelIdsByName: { 'test-reminders': 'C_MAIN' },
    });
    const RemindersModuleHarness = CreateHarness(SlackApp, {
      GetAllReminders: jest.fn(() => [{
        ReminderID: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        TargetChannelID: 'C_OTHER',
        ReminderMessageText: 'No GitHub links here',
        GitHubUrls: null,
      }]),
    });
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 50);

    try {
      await RunScheduledCycleAsync(Module, 50);
      expect(FetchSpy).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toBe(
        'GitHub sync heartbeat: cycle completed for workspace TestWorkspace. Checked 0 GitHub-linked reminder(s); auto-completed 0.'
      );
    } finally {
      await Module.StopAsync();
    }
  });

  test('workspace error still posts error heartbeat copy', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: CreateWorkspaceInfo({ GITHUB_SYNC_HEARTBEAT_ENABLED: 'yes' }),
      ChannelIdsByName: { 'test-reminders': 'C_MAIN' },
    });
    const RemindersModuleHarness = CreateHarness(SlackApp, {
      GetAllReminders: jest.fn(() => {
        throw new Error('boom');
      }),
    });
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 50);

    try {
      await RunScheduledCycleAsync(Module, 50);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toBe(
        'GitHub sync heartbeat: cycle encountered an error after checking 0 GitHub-linked reminder(s) in workspace TestWorkspace. Review logs for details.'
      );
    } finally {
      await Module.StopAsync();
    }
  });

  test('heartbeat channel lookup is cached across cycles', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: CreateWorkspaceInfo({ GITHUB_SYNC_HEARTBEAT_ENABLED: 'yes' }),
      ChannelIdsByName: { 'test-reminders': 'C_MAIN' },
    });
    const RemindersModuleHarness = CreateHarness(SlackApp);
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 50);
    const GetChannelIdSpy = jest.spyOn(SlackApp, 'GetChannelIdAsync');

    FetchSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'open' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'open' }),
      });

    try {
      await Module.StartAsync();
      await jest.advanceTimersByTimeAsync(50);
      await jest.advanceTimersByTimeAsync(50);

      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(GetChannelIdSpy).toHaveBeenCalledTimes(1);
    } finally {
      await Module.StopAsync();
    }
  });
});

// ---------------------------------------------------------------------------
// RunNowAsync — notification wording via MockSlackApp harness
// ---------------------------------------------------------------------------

describe('GitHubSyncModule.RunNowAsync — notification wording', () => {
  function CreateWorkspaceInfo() {
    return {
      WORKSPACE_NAME: 'TestWorkspace',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'test-reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
      GITHUB_PAT: 'ghp_test123',
    };
  }

  function CreateReminder(ArgGitHubUrls) {
    return {
      ReminderID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      TargetChannelID: 'C_REMINDERS',
      ReminderMessageText: '<@U123> please review the GitHub work item',
      GitHubUrls: ArgGitHubUrls,
    };
  }

  function CreateRemindersModuleHarness(ArgSlackApp, ArgReminder) {
    return {
      DataLoaded: true,
      DataLoadError: null,
      SlackApp: ArgSlackApp,
      GetAllReminders() { return [ArgReminder]; },
      CompleteReminderByIdAsync: jest.fn(async () => true),
    };
  }

  let FetchSpy;

  beforeEach(() => {
    FetchSpy = jest.spyOn(global, 'fetch').mockReset();
  });

  afterAll(() => jest.restoreAllMocks());

  async function RunModuleOnceAsync(ArgReminder, ArgFetchResponses) {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: CreateWorkspaceInfo() });
    const RemindersModuleHarness = CreateRemindersModuleHarness(SlackApp, ArgReminder);
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 9999999);

    for(const CurrentResponse of ArgFetchResponses)
      FetchSpy.mockResolvedValueOnce(CurrentResponse);

    await Module.StartAsync();
    try {
      const Result = await Module.RunNowAsync();
      return { Result, SlackApp, RemindersModuleHarness };
    } finally {
      await Module.StopAsync();
    }
  }

  test('merged PR notification uses merged wording', async () => {
    const Reminder = CreateReminder(['https://github.com/o/r/pull/221']);
    const { SlackApp, RemindersModuleHarness } = await RunModuleOnceAsync(Reminder, [{
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed', merged_at: '2026-03-04T18:01:56Z' }),
    }]);

    expect(RemindersModuleHarness.CompleteReminderByIdAsync).toHaveBeenCalledWith(
      Reminder.ReminderID,
      expect.stringContaining('pr-merged https://github.com/o/r/pull/221')
    );
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(
      '✅ Auto-completed: "<@U123> please review the GitHub work item" - linked GitHub PR was merged.\nhttps://github.com/o/r/pull/221'
    );
  });

  test('closed-unmerged PR notification uses closed wording', async () => {
    const Reminder = CreateReminder(['https://github.com/o/r/pull/218']);
    const { SlackApp } = await RunModuleOnceAsync(Reminder, [{
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed', merged_at: null }),
    }]);

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(
      '✅ Auto-completed: "<@U123> please review the GitHub work item" - linked GitHub PR was closed.\nhttps://github.com/o/r/pull/218'
    );
  });

  test('mixed issue + merged PR notification uses combined wording', async () => {
    const Reminder = CreateReminder([
      'https://github.com/o/r/issues/42',
      'https://github.com/o/r/pull/221',
    ]);
    const { SlackApp } = await RunModuleOnceAsync(Reminder, [
      {
        ok: true,
        status: 200,
        json: async () => ({ state: 'closed' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({ state: 'closed', merged_at: '2026-03-04T18:01:56Z' }),
      }
    ]);

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(
      '✅ Auto-completed: "<@U123> please review the GitHub work item" - linked GitHub items were completed (1 issue closed, 1 PR merged).\nhttps://github.com/o/r/issues/42\nhttps://github.com/o/r/pull/221'
    );
  });

  // -------------------------------------------------------------------------
  // originating-thread mirror behavior
  // -------------------------------------------------------------------------

  test('mirrors auto-complete notification to originating thread when coordinates are set', async () => {
    const Reminder = {
      ...CreateReminder(['https://github.com/o/r/issues/42']),
      OriginalChannelID: 'C_ORIGIN',
      OriginalThreadTs: '1700000000.000111',
    };
    const { SlackApp } = await RunModuleOnceAsync(Reminder, [{
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed' }),
    }]);

    expect(SlackApp.SentMessages).toHaveLength(2);
    const ExpectedText = '✅ Auto-completed: "<@U123> please review the GitHub work item" - linked GitHub issue was closed.\nhttps://github.com/o/r/issues/42';

    // main channel post (no thread).
    expect(SlackApp.SentMessages[0].channel).toBe('C_REMINDERS');
    expect(SlackApp.SentMessages[0].threadTs).toBeNull();
    expect(SlackApp.SentMessages[0].text).toBe(ExpectedText);

    // originating thread mirror.
    expect(SlackApp.SentMessages[1].channel).toBe('C_ORIGIN');
    expect(SlackApp.SentMessages[1].threadTs).toBe('1700000000.000111');
    expect(SlackApp.SentMessages[1].text).toBe(ExpectedText);
  });

  test('falls back to OriginalMessageID when OriginalThreadTs is absent', async () => {
    const Reminder = {
      ...CreateReminder(['https://github.com/o/r/issues/43']),
      OriginalChannelID: 'C_ORIGIN',
      OriginalMessageID: '1700000000.000222',
    };
    const { SlackApp } = await RunModuleOnceAsync(Reminder, [{
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed' }),
    }]);

    expect(SlackApp.SentMessages).toHaveLength(2);
    expect(SlackApp.SentMessages[1].channel).toBe('C_ORIGIN');
    expect(SlackApp.SentMessages[1].threadTs).toBe('1700000000.000222');
  });

  test('skips originating-thread mirror when OriginalChannelID is missing', async () => {
    const Reminder = {
      ...CreateReminder(['https://github.com/o/r/issues/44']),
      OriginalThreadTs: '1700000000.000333',
    };
    const { SlackApp } = await RunModuleOnceAsync(Reminder, [{
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed' }),
    }]);

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].channel).toBe('C_REMINDERS');
  });

  test('skips originating-thread mirror when both thread anchors are missing (legacy reminder)', async () => {
    const Reminder = {
      ...CreateReminder(['https://github.com/o/r/issues/45']),
      OriginalChannelID: 'C_ORIGIN',
    };
    const { SlackApp } = await RunModuleOnceAsync(Reminder, [{
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed' }),
    }]);

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].channel).toBe('C_REMINDERS');
  });

  test('mirror failure is isolated: main-channel post is not retried or duplicated, mirror error is warn-logged', async () => {
    const Reminder = {
      ...CreateReminder(['https://github.com/o/r/issues/46']),
      OriginalChannelID: 'C_ORIGIN',
      OriginalThreadTs: '1700000000.000444',
    };
    const SlackApp = new MockSlackApp({ WorkspaceInfo: CreateWorkspaceInfo() });
    const RemindersModuleHarness = CreateRemindersModuleHarness(SlackApp, Reminder);
    const Module = new GitHubSyncModule([RemindersModuleHarness], SlackApp.Logger, 9999999);

    FetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: 'closed' }),
    });

    // First PostMessageTextAsync call (main channel) delegates to the original
    // implementation so SentMessages records the post. Second call (originating-thread
    // mirror) throws to exercise the documented isolation contract.
    const OriginalPost = SlackApp.PostMessageTextAsync.bind(SlackApp);
    const PostSpy = jest.spyOn(SlackApp, 'PostMessageTextAsync')
      .mockImplementationOnce((ArgChannel, ArgThreadTs, ArgText, ArgMetadata) =>
        OriginalPost(ArgChannel, ArgThreadTs, ArgText, ArgMetadata)
      )
      .mockImplementationOnce(async () => { throw new Error('mirror network error'); });

    await Module.StartAsync();
    try {
      const Result = await Module.RunNowAsync();
      // RunNowAsync should not surface the mirror failure.
      expect(Result).toBeDefined();
    } finally {
      await Module.StopAsync();
    }

    // Main-channel post recorded exactly once — no retry, no duplication.
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].channel).toBe('C_REMINDERS');
    expect(SlackApp.SentMessages[0].threadTs).toBeNull();

    // PostMessageTextAsync was called exactly twice: main + mirror attempt.
    // (3+ would indicate the retry path fired, which is the contract violation.)
    expect(PostSpy).toHaveBeenCalledTimes(2);

    // FSM transition still happened: auto-complete reached the reminder module.
    expect(RemindersModuleHarness.CompleteReminderByIdAsync).toHaveBeenCalledTimes(1);

    // Mirror failure is warn-logged and does not appear as an error.
    const MirrorWarn = SlackApp.Logger.WarnMessages.find(ArgMessage =>
      ArgMessage.includes('failed to mirror auto-complete notification to originating thread')
    );
    expect(MirrorWarn).toBeDefined();
    const MirrorErrorLogged = SlackApp.Logger.ErrorMessages.some(ArgMessage =>
      ArgMessage.includes('failed to mirror')
    );
    expect(MirrorErrorLogged).toBe(false);
  });
});
