'use strict';

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation(() => ({
    DefaultModelName: 'gpt-4o-mini',
    ComplexModelName: 'gpt-4o',
    ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
    TestConnectivityAsync: jest.fn().mockResolvedValue({ ok: true }),
    IsValidModelAsync: jest.fn().mockResolvedValue(true),
  }));
});

const MockAskQuestionAsync = jest.fn();
const MockIsWpdbtkRagEnabled = jest.fn();

jest.mock('../src/wpdbtk-rag', () => ({
  AskQuestionAsync: MockAskQuestionAsync,
  IsWpdbtkRagEnabled: MockIsWpdbtkRagEnabled,
}));

const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const WorkspaceInfo = {
  WORKSPACE_NAME: 'Neochrome',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'general',
  MAIN_TIMEZONE: 'America/Los_Angeles',
  WPDBTK_RAG_ENABLED: 'yes',
  WPDBTK_RAG_BASE_URL: 'https://rag.example.com',
  WPDBTK_RAG_SERVICE_TOKEN: 'rag_token_123',
  WPDBTK_RAG_DEFAULT_SOURCE: 'bq_client-a',
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

describe('ask-woo command', () => {
  beforeEach(() => {
    MockAskQuestionAsync.mockReset();
    MockIsWpdbtkRagEnabled.mockReset();
  });

  test('is admin-only', async () => {
    MockIsWpdbtkRagEnabled.mockReturnValue(true);
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C123',
      user: 'U_NON_ADMIN',
      text: `${SlackApp.AppMentionString} ask-woo What sold best?`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('only workspace admins or owners');
    expect(MockAskQuestionAsync).not.toHaveBeenCalled();
  });

  test('prompts for a missing question', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      AdminUsers: ['U_ADMIN'],
    });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C123',
      user: 'U_ADMIN',
      text: `${SlackApp.AppMentionString} ask-woo`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('please provide a question');
    expect(MockAskQuestionAsync).not.toHaveBeenCalled();
  });

  test('fails closed when the workspace is not configured', async () => {
    MockIsWpdbtkRagEnabled.mockReturnValue(false);
    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      AdminUsers: ['U_ADMIN'],
      TeamId: 'T_NEO',
    });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C123',
      user: 'U_ADMIN',
      text: `${SlackApp.AppMentionString} ask-woo What sold best?`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('not configured');
    expect(MockAskQuestionAsync).not.toHaveBeenCalled();
  });

  test('posts a working message and then the upstream answer', async () => {
    MockIsWpdbtkRagEnabled.mockReturnValue(true);
    MockAskQuestionAsync.mockResolvedValue({
      answer: 'Top products: Gummies, Tinctures.',
      mode: 'analytics',
      requestId: 'req_123',
      diagnostics: { request_id: 'req_123' },
    });

    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      AdminUsers: ['U_ADMIN'],
      TeamId: 'T_NEO',
    });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C123',
      user: 'U_ADMIN',
      ts: '1712345678.123456',
      text: `${SlackApp.AppMentionString} ask-woo What sold best?`,
    });

    expect(WasHandled).toBe(true);
    expect(MockAskQuestionAsync).toHaveBeenCalledTimes(1);
    expect(MockAskQuestionAsync).toHaveBeenCalledWith(WorkspaceInfo, {
      question: 'What sold best?',
      caller: {
        app: 'sleuth-app',
        workspace_name: 'Neochrome',
        team_id: 'T_NEO',
        slack_user_id: 'U_ADMIN',
        channel_id: 'C123',
        thread_ts: '1712345678.123456',
      },
    });
    expect(SlackApp.SentMessages).toHaveLength(2);
    expect(SlackApp.SentMessages[0].text).toBe('Working on it...');
    expect(SlackApp.SentMessages[1].text).toContain('Top products');
  });

  test('maps timeout failures to concise Slack copy', async () => {
    MockIsWpdbtkRagEnabled.mockReturnValue(true);
    MockAskQuestionAsync.mockRejectedValue({
      name: 'WpdbtkRagError',
      code: 'timeout',
      message: 'WPDBTK RAG request timed out.',
      requestId: 'req_timeout',
    });

    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      AdminUsers: ['U_ADMIN'],
      TeamId: 'T_NEO',
    });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C123',
      user: 'U_ADMIN',
      text: `${SlackApp.AppMentionString} ask-woo What sold best?`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(2);
    expect(SlackApp.SentMessages[1].text).toContain('took too long');
  });
});