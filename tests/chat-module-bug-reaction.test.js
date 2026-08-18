'use strict';

// Regression tests for the admin :bug: reaction (GH-358 Phase 1) — files a GitHub issue for a
// Sleuth-authored Slack message, admin-gated, de-duped, with a persisted local log.

const fs = require('fs').promises;
const path = require('path');

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation(() => ({
    DefaultModelName: 'gpt-4o-mini',
    ComplexModelName: 'gpt-4o',
    ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
    TestConnectivityAsync: jest.fn().mockResolvedValue({ ok: true }),
    IsValidModelAsync: jest.fn().mockResolvedValue(true),
  }));
});

const ChatModule = require('../src/chat-module');
const workspaces = require('../src/workspaces');
const { ISSUE_REPO } = require('../src/github-issue-filer');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const WORKSPACE_NAME = 'GH358TestWorkspace';
const BOT_USER_ID = 'UBOT123';
const ADMIN_USER_ID = 'U_ADMIN';
const NON_ADMIN_USER_ID = 'U_OTHER';
const CHANNEL = 'C_TEST';
const MESSAGE_TS = '1700000000.000001';

const TestWorkspaceInfo = {
  WORKSPACE_NAME,
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
  GITHUB_PAT: 'ghp_test',
};

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0,
  IncomingMessageLength: 0,
  OutgoingMessageCount: 0,
  OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0,
  OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0,
  IncomingGptMessageLength: 0,
};

const BugReportsFilePath = workspaces.GetSubdirPath('bugs', `${WORKSPACE_NAME}_bugs.json`);

async function ReadBugReportsAsync() {
  try {
    return JSON.parse(await fs.readFile(BugReportsFilePath, 'utf8'));
  } catch(error) {
    if(error.code === 'ENOENT') return [];
    throw error;
  }
}

function StubGithubCreate({ Status = 201, Number = 999, HtmlUrl = 'https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/999' } = {}) {
  global.fetch = jest.fn(async (url, options) => {
    expect(String(url)).toBe('https://api.github.com/repos/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues');
    expect(options.method).toBe('POST');
    if(Status === 201) {
      return { status: 201, json: async () => ({ number: Number, html_url: HtmlUrl }) };
    }
    return { status: Status, json: async () => ({}) };
  });
  return global.fetch;
}

function BuildSlackApp({ MessageUser = BOT_USER_ID, WorkspaceInfo = TestWorkspaceInfo, MessageText = 'Sleuth reply text here' } = {}) {
  return new MockSlackApp({
    WorkspaceInfo,
    AppMentionString: `<@${BOT_USER_ID}>`,
    AdminUsers: [ADMIN_USER_ID],
    ThreadMessagesById: {
      [`${CHANNEL}:${MESSAGE_TS}`]: [
        { user: MessageUser, text: MessageText, ts: MESSAGE_TS },
      ],
    },
  });
}

describe(':bug: reaction — admin GitHub bug-report filing', () => {
  const SavedFetch = global.fetch;
  let SavedEnvRepo;

  beforeEach(() => {
    SavedEnvRepo = process.env.SLEUTH_ISSUE_REPO;
    process.env.SLEUTH_ISSUE_REPO = 'HiQS-Suite/AEGIS-Sleuth-Slackbot';
  });

  afterEach(async () => {
    global.fetch = SavedFetch;
    if(SavedEnvRepo !== undefined)
      process.env.SLEUTH_ISSUE_REPO = SavedEnvRepo;
    else
      delete process.env.SLEUTH_ISSUE_REPO;
    await fs.rm(BugReportsFilePath, { force: true });
  });

  test('admin reacting on a Sleuth-authored message files a GitHub issue and confirms in-thread', async () => {
    const SlackApp = BuildSlackApp();
    StubGithubCreate({ Number: 1234, HtmlUrl: 'https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/1234' });
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    const WasHandled = await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug',
      user: ADMIN_USER_ID,
      item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(WasHandled).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Payload.title).toBe('Sleuth reply text here'); // clean summary of a short plain message
    expect(Payload.body).toContain('Sleuth reply text here');
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(
      "You've reported an issue with Sleuth - bug filed under GH 1234 (https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/1234). We'll review and resolve ASAP."
    );

    const Entries = await ReadBugReportsAsync();
    expect(Entries).toHaveLength(1);
    expect(Entries[0]).toMatchObject({
      Kind: 'bug',
      WorkspaceName: WORKSPACE_NAME,
      ChannelID: CHANNEL,
      MessageTS: MESSAGE_TS,
      GitHubIssueNumber: 1234,
    });
  });

  test('issue title is a clean summary, not a raw mid-token 15-char slice of a reminder-digest line (#378)', async () => {
    // Reproduces the reported prod symptom: a show-reminders digest line (with `A.)` label, a `<@U…>`
    // mention and a `<https://…>` link) is 🐛-reacted. The old slice(0,15) produced "A.) <@U072BF6K4".
    const DigestLine = 'A.) <@U072BF6K4XYZ> please follow up on '
      + '<https://neochrome.slack.com/archives/C04/p123|this> (3 days old) - <@U000EXAMPLE1> - '
      + '<!date^1784088963^{date_short}|Jul 14>';
    const SlackApp = BuildSlackApp({ MessageText: DigestLine });
    StubGithubCreate({ Number: 501, HtmlUrl: 'https://github.com/NeochromeTeam/sleuth-app/issues/501' });
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    // No raw Slack markup tokens leak into the title...
    expect(Payload.title).not.toMatch(/<@|<https?:|<!date|<#/);
    // ...it is not the old 15-char slice, and stays within a sane title length...
    expect(Payload.title).not.toBe('A.) <@U072BF6K4');
    expect(Payload.title.length).toBeGreaterThan(15);
    expect(Payload.title.length).toBeLessThanOrEqual(72);
    // ...and the markup is resolved to readable text.
    expect(Payload.title).toContain('@U072BF6K4XYZ'); // mention resolved
    expect(Payload.title).toContain('Jul 14');        // date token resolved to its fallback
  });

  test('mentions in the reacted message resolve to display names in both title and body (GH-428)', async () => {
    // Reproduces the reported prod symptom: a reminder-scheduled feedback message with raw
    // `<@U...>` mentions, 🐛-reacted, filed a GitHub issue whose title and code-fenced body still
    // showed the bare Slack user ids — Slack's own client resolves them, GitHub's markdown does not.
    const MessageText = '1 Slack reminder has been scheduled for <@U08BHQEAX>, <@U000EXAMPLE1>.';
    const SlackApp = BuildSlackApp({ MessageText });
    SlackApp.SetUserDisplayNames({ U08BHQEAX: 'Matt', U000EXAMPLE1: 'Robin' });
    StubGithubCreate({ Number: 428, HtmlUrl: 'https://github.com/NeochromeTeam/sleuth-app/issues/428' });
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Payload.title).toBe('1 Slack reminder has been scheduled for @Matt, @Robin.');
    expect(Payload.body).toContain('1 Slack reminder has been scheduled for @Matt, @Robin.');
    expect(Payload.body).not.toMatch(/<@U08BHQEAX>|<@U000EXAMPLE1>/);
  });

  test('quote-only message falls back to a sensible bug title (no "Untitled reminder" leak)', async () => {
    // Non-empty input that ExtractCleanSummary strips to empty (a bare `>` quote block) must not
    // surface the helper's reminder-specific 'Untitled reminder' fallback in a bug-report title.
    const SlackApp = BuildSlackApp({ MessageText: '> Some quoted error log from a thread' });
    StubGithubCreate({ Number: 503, HtmlUrl: 'https://github.com/NeochromeTeam/sleuth-app/issues/503' });
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Payload.title).toBe('Sleuth bug report');
    expect(Payload.title).not.toBe('Untitled reminder');
  });

  test('empty/whitespace-only message falls back to a sensible bug title', async () => {
    const SlackApp = BuildSlackApp({ MessageText: '   ' });
    StubGithubCreate({ Number: 502, HtmlUrl: 'https://github.com/NeochromeTeam/sleuth-app/issues/502' });
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    const Payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Payload.title).toBe('Sleuth bug report');
  });

  test('non-admin reacting is denied and files no issue', async () => {
    const SlackApp = BuildSlackApp();
    StubGithubCreate();
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    const WasHandled = await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug',
      user: NON_ADMIN_USER_ID,
      item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(WasHandled).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages[0].text).toContain('only workspace admins or owners');
    expect(await ReadBugReportsAsync()).toHaveLength(0);
  });

  test('reacting on a non-Sleuth message is a no-op (no issue filed)', async () => {
    const SlackApp = BuildSlackApp({ MessageUser: NON_ADMIN_USER_ID });
    StubGithubCreate();
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    const WasHandled = await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug',
      user: ADMIN_USER_ID,
      item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(WasHandled).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages[0].text).toContain('only files GitHub issues for Sleuth-authored messages');
    expect(await ReadBugReportsAsync()).toHaveLength(0);
  });

  test('repeat reactions on the same message do not file a duplicate issue', async () => {
    const SlackApp = BuildSlackApp();
    StubGithubCreate({ Number: 42, HtmlUrl: 'https://github.com/NeochromeTeam/sleuth-app/issues/42' });
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });
    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(SlackApp.SentMessages[1].text).toContain('already filed for this message');
    expect(await ReadBugReportsAsync()).toHaveLength(1);
  });

  test('missing SLEUTH_ISSUE_REPO reports a clear error and files no issue', async () => {
    delete process.env.SLEUTH_ISSUE_REPO;
    const SlackApp = BuildSlackApp();
    global.fetch = jest.fn();
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages[0].text).toContain('SLEUTH_ISSUE_REPO` is not configured');
    expect(await ReadBugReportsAsync()).toHaveLength(0);
  });

  test('missing GITHUB_PAT reports a clear error and files no issue', async () => {
    const SlackApp = BuildSlackApp({ WorkspaceInfo: { ...TestWorkspaceInfo, GITHUB_PAT: undefined } });
    StubGithubCreate();
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    await SlackApp.SimulateReactionAddedAsync({
      reaction: 'bug', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages[0].text).toContain('GITHUB_PAT` is not configured');
    expect(await ReadBugReportsAsync()).toHaveLength(0);
  });

  test('non-bug reaction is ignored (returns false)', async () => {
    const SlackApp = BuildSlackApp();
    StubGithubCreate();
    const Module = new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    await Module.StartAsync();

    const WasHandled = await SlackApp.SimulateReactionAddedAsync({
      reaction: 'eyes', user: ADMIN_USER_ID, item: { channel: CHANNEL, ts: MESSAGE_TS },
    });

    expect(WasHandled).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
