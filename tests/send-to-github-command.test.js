'use strict';

const HandleSendToGithubCommandAsync = require('../src/chat-commands/send-to-github-command');
const { BuildIssueBody, ISSUE_REPO } = require('../src/chat-commands/send-to-github-command');
const { SEND_TO_GITHUB_PATTERN } = require('../src/reminders-app-mention-handler');

jest.mock('../src/thread-memory', () => ({
  CaptureThreadAsync: jest.fn(),
}));

const { CaptureThreadAsync } = require('../src/thread-memory');

const MENTION = '<@U07SLEUTH>';
const SAMPLE_RECORD = {
  MemoryId: 'mem-1',
  WorkspaceId: 'T123',
  WorkspaceName: 'neochrome',
  ChannelId: 'C_GENERAL',
  ChannelName: 'sleuth-bugs',
  ThreadTs: '1700000000.000001',
  CapturedAt: '2026-07-02T18:00:00.000Z',
  CapturedBy: 'U_ADMIN',
  Participants: ['U_ADMIN', 'U_OTHER'],
  GitHubRefs: [{ url: 'https://github.com/NeochromeTeam/sleuth-app/issues/1', ref: '#1' }],
  MessageCount: 2,
  RawText: 'Alice (2026-07-02T17:59:00.000Z): something broke',
  SummaryText: 'Alice (2026-07-02T17:59:00.000Z): something broke',
};

let SavedFetch;
let SavedEnvRepo;

beforeEach(() => {
  SavedFetch = global.fetch;
  SavedEnvRepo = process.env.SLEUTH_ISSUE_REPO;
  process.env.SLEUTH_ISSUE_REPO = 'HiQS-Suite/AEGIS-Sleuth-Slackbot';
  CaptureThreadAsync.mockReset();
  CaptureThreadAsync.mockResolvedValue(SAMPLE_RECORD);
});

afterEach(() => {
  global.fetch = SavedFetch;
  if(SavedEnvRepo !== undefined)
    process.env.SLEUTH_ISSUE_REPO = SavedEnvRepo;
  else
    delete process.env.SLEUTH_ISSUE_REPO;
  jest.restoreAllMocks();
});

function MakeEnv({
  IsAdmin = true,
  HasPat = true,
  HasThread = true,
  PriorMessages = [{ ts: '1700000000.000001', text: 'something broke', user: 'U_OTHER' }],
} = {}) {
  const SlackApp = {
    Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    WorkspaceInfo: HasPat ? { GITHUB_PAT: 'ghp_test', WORKSPACE_NAME: 'neochrome' } : {},
    IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(IsAdmin),
    PostMessageTextAsync: jest.fn().mockResolvedValue(undefined),
    GetPermaLinkAsync: jest.fn().mockResolvedValue('https://slack.example/archives/C_GENERAL/p1700000000000001'),
    GetUserDisplayNameAsync: jest.fn().mockResolvedValue('Admin User'),
    GetConversationMessagesAsync: jest.fn().mockResolvedValue(
      HasThread
        ? [...PriorMessages, { ts: '1700000000.000002', text: 'send to github', user: 'U_ADMIN' }]
        : [{ ts: '1700000000.000002', text: 'send to github', user: 'U_ADMIN' }]
    ),
  };
  const EventInfo = {
    channel: 'C_GENERAL',
    ts: '1700000000.000002',
    thread_ts: HasThread ? '1700000000.000001' : undefined,
    user: 'U_ADMIN',
  };
  return { SlackApp, EventInfo };
}

function StubGithubCreate({ Status = 201, Number = 341, HtmlUrl = 'https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/341' } = {}) {
  global.fetch = jest.fn(async (url, options) => {
    expect(String(url)).toBe('https://api.github.com/repos/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer ghp_test');
    if(Status === 201) {
      return {
        status: 201,
        json: async () => ({ number: Number, html_url: HtmlUrl }),
      };
    }
    return { status: Status, json: async () => ({}) };
  });
  return global.fetch;
}

describe('send-to-github routing pattern', () => {
  test.each([
    `${MENTION} send to github`,
    `${MENTION} send to github: reminder fired incorrectly`,
    'send to github',
    `${MENTION} please send to github`,
  ])('matches %p', (Text) => {
    expect(SEND_TO_GITHUB_PATTERN.test(Text)).toBe(true);
  });

  test.each([
    `${MENTION} ask-self how does send to github work`,
    `${MENTION} github sync now`,
    'send github issue somewhere else',
  ])('does not match %p', (Text) => {
    expect(SEND_TO_GITHUB_PATTERN.test(Text)).toBe(false);
  });
});

describe('BuildIssueBody', () => {
  test('includes metadata, permalink, refs, and transcript', () => {
    const Body = BuildIssueBody(
      SAMPLE_RECORD,
      'https://slack.example/thread',
      'Admin User'
    );
    expect(Body).toContain('**Workspace:** neochrome');
    expect(Body).toContain('**Channel:** #sleuth-bugs');
    expect(Body).toContain('**Reported by:** Admin User');
    expect(Body).toContain('[View Slack thread](https://slack.example/thread)');
    expect(Body).toContain('[#1](https://github.com/NeochromeTeam/sleuth-app/issues/1)');
    expect(Body).toContain('something broke');
    expect(Body).toContain('_Filed from Slack by Sleuth_');
  });
});

describe('HandleSendToGithubCommandAsync', () => {
  test('denies non-admins and makes no GitHub call', async () => {
    const { SlackApp, EventInfo } = MakeEnv({ IsAdmin: false });
    global.fetch = jest.fn();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, '');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      'sorry, only workspace admins or owners can send to github.'
    );
  });

  test('rejects when there is no prior thread context to capture', async () => {
    const { SlackApp, EventInfo } = MakeEnv({ HasThread: false, PriorMessages: [] });
    global.fetch = jest.fn();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, '');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(CaptureThreadAsync).not.toHaveBeenCalled();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      expect.stringMatching(/Reply in thread/i)
    );
  });

  test('accepts a thread parent when other replies exist below it', async () => {
    const { SlackApp, EventInfo } = MakeEnv({ HasThread: false, PriorMessages: [] });
    EventInfo.ts = '1700000000.000001';
    SlackApp.GetConversationMessagesAsync.mockResolvedValue([
      { ts: '1700000000.000001', text: 'something broke', user: 'U_OTHER' },
      { ts: '1700000000.000003', text: 'more context', user: 'U_OTHER' },
    ]);
    StubGithubCreate();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, 'parent thread command');

    expect(CaptureThreadAsync).toHaveBeenCalledWith(
      SlackApp,
      { ...EventInfo, thread_ts: '1700000000.000001' },
      { excludeMessageTs: EventInfo.ts }
    );
  });

  test('rejects when SLEUTH_ISSUE_REPO is missing', async () => {
    delete process.env.SLEUTH_ISSUE_REPO;
    const { SlackApp, EventInfo } = MakeEnv();
    global.fetch = jest.fn();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, '');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      expect.stringMatching(/SLEUTH_ISSUE_REPO/i)
    );
  });

  test('rejects when GITHUB_PAT is missing', async () => {
    const { SlackApp, EventInfo } = MakeEnv({ HasPat: false });
    global.fetch = jest.fn();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, '');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      expect.stringMatching(/GITHUB_PAT/i)
    );
  });

  test('files issue with inline title and posts URL on success', async () => {
    const { SlackApp, EventInfo } = MakeEnv();
    StubGithubCreate();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, 'reminder fired incorrectly');

    expect(CaptureThreadAsync).toHaveBeenCalledWith(SlackApp, EventInfo, {
      excludeMessageTs: EventInfo.ts,
    });
    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Payload.title).toBe('reminder fired incorrectly');
    expect(Payload.body).toContain('something broke');
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      'Filed GitHub issue #341: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/341'
    );
  });

  test('auto-generates title when omitted', async () => {
    const { SlackApp, EventInfo } = MakeEnv();
    StubGithubCreate();

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, '');

    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Payload.title).toMatch(/^Slack report — #sleuth-bugs — \d{4}-\d{2}-\d{2}$/);
  });

  test('reports PAT scope error on GitHub 403', async () => {
    const { SlackApp, EventInfo } = MakeEnv();
    StubGithubCreate({ Status: 403 });

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, 'oops');

    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      expect.stringMatching(/issues:write/i)
    );
  });

  test('reports generic error on other GitHub failures', async () => {
    const { SlackApp, EventInfo } = MakeEnv();
    StubGithubCreate({ Status: 422 });

    await HandleSendToGithubCommandAsync(SlackApp, EventInfo, 'oops');

    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      EventInfo.channel,
      EventInfo.ts,
      expect.stringMatching(/GitHub returned 422/i)
    );
  });
});
