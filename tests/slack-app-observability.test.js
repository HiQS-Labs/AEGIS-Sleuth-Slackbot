'use strict';

const mockAuthTest = jest.fn();
const mockChatPostMessage = jest.fn();
const mockFilesUploadV2 = jest.fn();
const mockAppStart = jest.fn();
const mockAppStop = jest.fn();
const mockAppEvent = jest.fn();
const mockAppMessage = jest.fn();
const mockAppAction = jest.fn();
const mockAppConstructor = jest.fn(() => ({
  client: {
    auth: { test: mockAuthTest },
    chat: { postMessage: mockChatPostMessage },
    filesUploadV2: mockFilesUploadV2,
    users: {},
    conversations: {},
    reactions: {},
  },
  start: mockAppStart,
  stop: mockAppStop,
  event: mockAppEvent,
  message: mockAppMessage,
  action: mockAppAction,
}));

jest.mock('@slack/bolt', () => ({
  App: mockAppConstructor,
}));

const SlackApp = require('../src/slack-app');
const { MockLogger } = require('./mocks/mock-slack-app');

/**
 * Build a connected SlackApp instance wired to the mocked Bolt client.
 * @returns {Promise<{ App: import('../src/slack-app'), Logger: MockLogger }>}
 */
async function CreateConnectedSlackAppAsync() {
  const Logger = new MockLogger();
  const App = new SlackApp({
    WORKSPACE_NAME: 'TestWorkspace',
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test',
    LIVE_SIGNING_SECRET: 'secret',
    LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test',
    REMINDER_CHANNEL_NAME: 'test-reminders',
    MAIN_TIMEZONE: 'America/Los_Angeles',
  }, Logger);

  await App.ConnectOneShotAsync();
  return { App, Logger };
}

describe('SlackApp outbound write observability', () => {
  beforeEach(() => {
    mockAppConstructor.mockClear();
    mockAuthTest.mockReset();
    mockChatPostMessage.mockReset();
    mockFilesUploadV2.mockReset();
    mockAppStart.mockReset();
    mockAppStop.mockReset();
    mockAppEvent.mockReset();
    mockAppMessage.mockReset();
    mockAppAction.mockReset();

    mockAuthTest.mockResolvedValue({
      ok: true,
      user_id: 'UBOT123',
      team_id: 'T_TEST',
    });
  });

  test('adds opaque audit metadata and omits plaintext preview logging by default', async () => {
    mockChatPostMessage.mockResolvedValue({ ok: true, ts: '1710000000.000100' });

    const { App, Logger } = await CreateConnectedSlackAppAsync();
    await App.PostMessageTextAsync('C123', '1710000000.000001', 'super secret production response', undefined, { Tag: 'chat-reply' });

    expect(mockChatPostMessage).toHaveBeenCalledTimes(1);
    const PostedPayload = mockChatPostMessage.mock.calls[0][0];
    expect(PostedPayload.metadata).toEqual(expect.objectContaining({
      event_type: 'sleuth-write-audit',
      event_payload: expect.objectContaining({
        SleuthAuditWriteKind: 'text',
        SleuthAuditWriteTag: 'chat-reply',
      }),
    }));
    expect(PostedPayload.metadata.event_payload.SleuthAuditWriteID).toMatch(/^slk-\d+-\d+$/);
    expect(PostedPayload.metadata.event_payload.SleuthAuditWriteID).not.toContain('TestWorkspace');

    const InfoLogs = Logger.InfoMessages.join('\n');
    expect(InfoLogs).toContain('tag=chat-reply');
    expect(InfoLogs).not.toContain('super secret production response');
    expect(InfoLogs).not.toContain('preview=');
  });

  test('logs audit failure when text posts throw before Slack returns a response', async () => {
    mockChatPostMessage.mockRejectedValue(new Error('socket hang up'));

    const { App, Logger } = await CreateConnectedSlackAppAsync();

    await expect(
      App.PostMessageTextAsync('C123', null, 'message body', undefined, { Tag: 'daily-digest' })
    ).rejects.toThrow('socket hang up');

    expect(Logger.ErrorMessages.join('\n')).toContain('failure kind=text tag=daily-digest');
    expect(Logger.ErrorMessages.join('\n')).toContain('error=socket hang up');
  });

  test('logs audit failure when file uploads throw before Slack returns a response', async () => {
    mockFilesUploadV2.mockRejectedValue(new Error('ECONNRESET'));

    const { App, Logger } = await CreateConnectedSlackAppAsync();

    await expect(
      App.UploadFileAsync('C123', null, 'tmp/report.json', 'upload summary', 'report.json', { Tag: 'rebalance-export' })
    ).rejects.toThrow('ECONNRESET');

    expect(Logger.ErrorMessages.join('\n')).toContain('failure kind=file tag=rebalance-export');
    expect(Logger.ErrorMessages.join('\n')).toContain('error=ECONNRESET');
  });
});
