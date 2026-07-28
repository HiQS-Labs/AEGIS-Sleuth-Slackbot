'use strict';

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

describe('ask-woo lazy-load failure path', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('../src/workspace-ai');
    jest.unmock('../src/wpdbtk-rag');
  });

  test('posts an availability error when the optional client module fails to load', async () => {
    let ChatModule;
    jest.isolateModules(() => {
      jest.doMock('../src/workspace-ai', () => {
        return jest.fn().mockImplementation(() => ({
          DefaultModelName: 'gpt-4o-mini',
          ComplexModelName: 'gpt-4o',
          ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
          TestConnectivityAsync: jest.fn().mockResolvedValue({ ok: true }),
          IsValidModelAsync: jest.fn().mockResolvedValue(true),
        }));
      });
      jest.doMock('../src/wpdbtk-rag', () => {
        throw new Error('load failed');
      });
      ChatModule = require('../src/chat-module');
    });

    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      AdminUsers: ['U_ADMIN'],
    });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C123',
      user: 'U_ADMIN',
      text: `${SlackApp.AppMentionString} ask-woo What sold best?`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('integration is unavailable');
  });
});