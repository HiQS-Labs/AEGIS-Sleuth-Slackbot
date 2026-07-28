'use strict';

const fs = require('fs').promises;
const path = require('path');

jest.mock('../src/workspace-ai');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');

const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'HelpTestWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
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

describe('help command via ChatModule', () => {
  let ExpectedHelpText;

  beforeAll(async () => {
    ExpectedHelpText = await fs.readFile(
      path.join(__dirname, '..', 'data', 'static', 'HELP.md'), 'utf8'
    );
  });

  beforeEach(() => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI);
  });

  test('exact "@bot help" returns deterministic HELP.md content', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_HELP',
      user: 'U_USER1',
      text: `${SlackApp.AppMentionString} help`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(ExpectedHelpText);
  });

  test('exact "@bot features" returns deterministic HELP.md content', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_HELP',
      user: 'U_USER2',
      text: `${SlackApp.AppMentionString} features`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(ExpectedHelpText);
  });

  test('"@bot  help" with extra whitespace still returns HELP.md (normalized)', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_HELP',
      user: 'U_USER3',
      text: `${SlackApp.AppMentionString}  help`,  // double-space
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe(ExpectedHelpText);
  });
});
