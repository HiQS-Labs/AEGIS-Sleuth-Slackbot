'use strict';

const mockWorkspaceAIInstances = [];

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation((WorkspaceInfo) => {
    const Instance = {
      WorkspaceInfo,
      DefaultModelName: 'gpt-4o-mini',
      ComplexModelName: 'gpt-4o',
      ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
    };
    mockWorkspaceAIInstances.push(Instance);
    return Instance;
  });
});

const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

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

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'IntegrationWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

describe('Command Near-Miss 2-lite', () => {
  let OriginalEnv;

  beforeEach(() => {
    OriginalEnv = { ...process.env };
    mockWorkspaceAIInstances.length = 0;
  });

  afterEach(() => {
    process.env = OriginalEnv;
  });

  test('flag OFF -> no near-miss reply (current behavior)', async () => {
    process.env.COMMAND_NEAR_MISS_LITE = 'false';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1700000001.000001',
      text: '<@UBOT123> switch model to gpt-5',
    });

    // It was handled by the generic chat fallback because near-miss intercepts only if flag is ON
    expect(WasHandled).toBe(true);

    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });

  test('flag ON + high-score wrong-syntax miss -> exactly one "did you mean" suggestion', async () => {
    process.env.COMMAND_NEAR_MISS_LITE = 'on';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1700000002.000001',
      text: '<@UBOT123> switch model to gpt-5',
    });

    expect(WasHandled).toBe(true);

    const SuggestionMessages = SlackApp.SentMessages.filter((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessages.length).toBe(1);
    expect(SuggestionMessages[0].text).toMatch(/Did you mean the `.*` command\? Try `.*`\./);
  });

  test('flag ON + below-floor conversational message -> falls through, no suggestion', async () => {
    process.env.COMMAND_NEAR_MISS_LITE = 'on';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1700000003.000001',
      text: '<@UBOT123> thanks so much, have a great weekend everyone',
    });

    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });
});
