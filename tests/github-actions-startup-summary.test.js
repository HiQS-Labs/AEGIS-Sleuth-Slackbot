'use strict';

const {
  BuildStartupGitHubActionsSummaryAsync,
  DEFAULT_TIMEOUT_MS,
  FOLLOW_UP_DELAY_MS,
  PostStartupGitHubActionsSummaryFollowUpAsync,
  ScheduleStartupGitHubActionsSummaryFollowUp,
} = require('../src/github-actions-startup-summary');
const { MockSlackApp } = require('./mocks/mock-slack-app');

describe('BuildStartupGitHubActionsSummaryAsync', () => {
  const OriginalFetch = global.fetch;

  afterEach(() => {
    global.fetch = OriginalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('returns a Slack-ready summary for the latest run on the preferred branch', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            name: 'CI',
            head_branch: 'development',
            status: 'completed',
            conclusion: 'success',
            run_number: 412,
            head_sha: 'abcdef1234567890',
            html_url: 'https://github.com/NeochromeTeam/sleuth-app/actions/runs/412',
            run_started_at: '2026-05-13T17:00:00.000Z',
            updated_at: '2026-05-13T17:06:14.000Z',
          }
        ]
      })
    });

    const Summary = await BuildStartupGitHubActionsSummaryAsync({
      WORKSPACE_NAME: 'neochrome',
      GITHUB_PAT: 'github_pat_example',
      GITHUB_ACTIONS_REPO: 'NeochromeTeam/sleuth-app',
    }, {
      CurrentBranch: 'development',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/repos/NeochromeTeam/sleuth-app/actions/runs?per_page=1&branch=development');
    expect(Summary).toContain('_GitHub Actions:_ NeochromeTeam/sleuth-app on development');
    expect(Summary).toContain('`CI`');
    expect(Summary).toContain('*success*');
    expect(Summary).toContain('#412');
    expect(Summary).toContain('abcdef1');
    expect(Summary).toContain('6m 14s');
  });

  test('uses the workflow-specific endpoint when a workflow is configured', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            name: 'Deploy',
            head_branch: 'main',
            status: 'in_progress',
            conclusion: null,
            run_number: 88,
            head_sha: '1234567890abcdef',
            html_url: 'https://github.com/NeochromeTeam/sleuth-app/actions/runs/88',
            created_at: '2026-05-13T17:00:00.000Z',
            updated_at: '2026-05-13T17:00:15.000Z',
          }
        ]
      })
    });

    const Summary = await BuildStartupGitHubActionsSummaryAsync({
      WORKSPACE_NAME: 'neochrome',
      GITHUB_PAT: 'github_pat_example',
      GITHUB_ACTIONS_REPO: 'NeochromeTeam/sleuth-app',
      GITHUB_ACTIONS_WORKFLOW: 'deploy.yml',
      GITHUB_ACTIONS_BRANCH: 'main',
    });

    expect(global.fetch.mock.calls[0][0]).toContain('/repos/NeochromeTeam/sleuth-app/actions/workflows/deploy.yml/runs?per_page=1&branch=main');
    expect(Summary).toContain('`Deploy`');
    expect(Summary).toContain('*in_progress*');
  });

  test('falls back to the latest overall run when the preferred branch has no runs', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workflow_runs: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workflow_runs: [
            {
              name: 'CI',
              head_branch: 'main',
              status: 'completed',
              conclusion: 'failure',
              run_number: 500,
              head_sha: 'fedcba9876543210',
              html_url: 'https://github.com/NeochromeTeam/sleuth-app/actions/runs/500',
              run_started_at: '2026-05-13T18:00:00.000Z',
              updated_at: '2026-05-13T18:02:10.000Z',
            }
          ]
        })
      });

    const Summary = await BuildStartupGitHubActionsSummaryAsync({
      WORKSPACE_NAME: 'neochrome',
      GITHUB_PAT: 'github_pat_example',
      GITHUB_ACTIONS_REPO: 'NeochromeTeam/sleuth-app',
    }, {
      CurrentBranch: 'development',
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/NeochromeTeam/sleuth-app/actions/runs?per_page=1');
    expect(Summary).toContain('on main');
    expect(Summary).toContain('*failure*');
  });

  test('returns an empty string when the request times out', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((ArgUrl, ArgOptions) => new Promise((ArgResolve, ArgReject) => {
      ArgOptions.signal.addEventListener('abort', () => {
        const AbortError = new Error('aborted');
        AbortError.name = 'AbortError';
        ArgReject(AbortError);
      });
    }));

    const SummaryPromise = BuildStartupGitHubActionsSummaryAsync({
      WORKSPACE_NAME: 'neochrome',
      GITHUB_PAT: 'github_pat_example',
      GITHUB_ACTIONS_REPO: 'NeochromeTeam/sleuth-app',
    }, {
      TimeoutMs: DEFAULT_TIMEOUT_MS,
    });

    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    await expect(SummaryPromise).resolves.toBe('');
  });

  test('posts the summary as a delayed follow-up message instead of appending it to the main startup post', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            name: 'CI',
            head_branch: 'development',
            status: 'completed',
            conclusion: 'success',
            run_number: 412,
            head_sha: 'abcdef1234567890',
            html_url: 'https://github.com/NeochromeTeam/sleuth-app/actions/runs/412',
            run_started_at: '2026-05-13T17:00:00.000Z',
            updated_at: '2026-05-13T17:06:14.000Z',
          }
        ]
      })
    });

    const SlackApp = new MockSlackApp({
      WorkspaceInfo: {
        WORKSPACE_NAME: 'neochrome-dev',
        ADMIN_EMAIL: 'admin@example.com',
        LIVE_TOKEN: 'xoxb-test',
        LIVE_SIGNING_SECRET: 'secret',
        LIVE_APP_TOKEN: 'xapp-test',
        OPENAI_API_KEY: 'sk-test',
        REMINDER_CHANNEL_NAME: 'test-reminders',
        MAIN_TIMEZONE: 'America/Los_Angeles',
        GITHUB_PAT: 'github_pat_example',
        GITHUB_ACTIONS_REPO: 'NeochromeTeam/sleuth-app',
      },
      ChannelIdsByName: {
        'test-reminders': 'C_REMINDERS'
      }
    });

    const TimerId = ScheduleStartupGitHubActionsSummaryFollowUp(
      SlackApp,
      'development',
      SlackApp.Logger,
      {
        DelayMs: FOLLOW_UP_DELAY_MS,
        TimeoutMs: DEFAULT_TIMEOUT_MS,
      }
    );

    expect(TimerId).not.toBeNull();
    expect(SlackApp.SentMessages).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(FOLLOW_UP_DELAY_MS);

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0]).toMatchObject({
      channel: 'C_REMINDERS',
      threadTs: null,
    });
    expect(SlackApp.SentMessages[0].text).toContain('_GitHub Actions:_ NeochromeTeam/sleuth-app on development');
  });

  test('does not post a follow-up when the workspace is not configured for startup GitHub Actions', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: {
        WORKSPACE_NAME: 'neochrome-dev',
        ADMIN_EMAIL: 'admin@example.com',
        LIVE_TOKEN: 'xoxb-test',
        LIVE_SIGNING_SECRET: 'secret',
        LIVE_APP_TOKEN: 'xapp-test',
        OPENAI_API_KEY: 'sk-test',
        REMINDER_CHANNEL_NAME: 'test-reminders',
        MAIN_TIMEZONE: 'America/Los_Angeles',
      },
      ChannelIdsByName: {
        'test-reminders': 'C_REMINDERS'
      }
    });

    const WasPosted = await PostStartupGitHubActionsSummaryFollowUpAsync(
      SlackApp,
      'development',
      SlackApp.Logger,
      { TimeoutMs: DEFAULT_TIMEOUT_MS }
    );

    expect(WasPosted).toBe(false);
    expect(SlackApp.SentMessages).toHaveLength(0);
  });
});