'use strict';

// GH-172: `#OnAppMentionAsync` built `AppMentionInfo` with `text: ArgEvent.text` raw, while the
// `message` path already refused a non-string `text` before dispatch. Every registered app_mention
// handler assumes a string — `src/chat-command-router.js` calls `.match` on it,
// `src/reminders-app-mention-handler.js` and `src/chat-module.js` call `.replace` — so a malformed
// payload became a TypeError inside the handler chain. The chain catches it and the GH-113 fallback
// posts the raw TypeError text to the channel, so the user saw
// "sorry, something went wrong handling that: Cannot read properties of undefined (reading 'match')".
//
// Found by the GH-169 malformed-event corpus. These tests pin the dispatch-level guard.

const mockAuthTest = jest.fn();
const mockAppStart = jest.fn();
const mockAppStop = jest.fn();
const mockAppEvent = jest.fn();
const mockAppMessage = jest.fn();
const mockAppAction = jest.fn();
const mockPostMessage = jest.fn();
const mockAppConstructor = jest.fn(() => ({
  client: {
    auth: { test: mockAuthTest },
    users: { info: jest.fn() },
    chat: { postMessage: mockPostMessage },
    conversations: {},
    reactions: {},
  },
  start: mockAppStart,
  stop: mockAppStop,
  event: mockAppEvent,
  message: mockAppMessage,
  action: mockAppAction,
}));

jest.mock('@slack/bolt', () => ({ App: mockAppConstructor }));

const SlackApp = require('../src/slack-app');
const { MockLogger } = require('./mocks/mock-slack-app');

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'TestWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

/**
 * Start a SlackApp against the mocked Bolt client and return it with the app_mention callback Bolt
 * was handed, so a raw event can be dispatched exactly as Slack would deliver it.
 * @returns {Promise<{ App: import('../src/slack-app'), Logger: MockLogger, DispatchAsync: (ArgEvent: any) => Promise<void> }>}
 */
async function StartAppAsync() {
  const Logger = new MockLogger();
  const App = new SlackApp(TestWorkspaceInfo, Logger);
  await App.StartAsync(SlackApp.CreateEmptyWorkspaceStats());

  const Registered = mockAppEvent.mock.calls.find((ArgCall) => ArgCall[0] === 'app_mention');
  if(!Registered) throw new Error('app_mention was never registered on the Bolt app');

  return { App, Logger, DispatchAsync: (ArgEvent) => Registered[1]({ event: ArgEvent }) };
}

/** A well-formed app_mention event, minus whatever the case under test is overriding. */
const BaseEvent = { channel: 'C_TEST', ts: '1700000000.000100', user: 'U_TEST' };

describe('GH-172 app_mention dispatch guards a non-string text', () => {
  beforeEach(() => {
    for(const Mock of [mockAppConstructor, mockAuthTest, mockAppStart, mockAppStop, mockAppEvent,
      mockAppMessage, mockAppAction, mockPostMessage]) Mock.mockReset();
    mockAppConstructor.mockImplementation(() => ({
      client: {
        auth: { test: mockAuthTest },
        users: { info: jest.fn() },
        chat: { postMessage: mockPostMessage },
        conversations: {},
        reactions: {},
      },
      start: mockAppStart,
      stop: mockAppStop,
      event: mockAppEvent,
      message: mockAppMessage,
      action: mockAppAction,
    }));
    mockAuthTest.mockResolvedValue({ ok: true, user_id: 'UBOT123', team_id: 'T_TEST' });
    mockPostMessage.mockResolvedValue({ ok: true, ts: '1700000000.000200' });
  });

  test.each([
    ['text undefined', { text: undefined }],
    ['text null', { text: null }],
    ['text key absent', {}],
    ['text a number', { text: 42 }],
    ['text an object', { text: { rich: 'block' } }],
    ['text an array', { text: ['a'] }],
  ])('%s: handlers receive a string and the chain logs no handler error', async (ArgLabel, ArgOverride) => {
    const { App, Logger, DispatchAsync } = await StartAppAsync();

    /** @type {any[]} */
    const Seen = [];
    // mirror what the real handlers do with the field: CommandRouter calls .match, ChatModule and
    // RemindersAppMentionHandler call .replace. A raw non-string reaches them as a TypeError.
    App.HandleAppMention(async (ArgSlackApp, ArgEventInfo) => {
      Seen.push(ArgEventInfo.text);
      ArgEventInfo.text.match(/nothing/);
      ArgEventInfo.text.replace(ArgSlackApp.AppMentionString, '');
      return true;
    });

    await DispatchAsync({ ...BaseEvent, ...ArgOverride });

    expect(Seen).toHaveLength(1);
    expect(typeof Seen[0]).toBe('string');
    const HandlerErrors = Logger.ErrorMessages.filter((ArgEntry) => /Error in app_mention handler/.test(String(ArgEntry)));
    expect({ Case: ArgLabel, HandlerErrors }).toEqual({ Case: ArgLabel, HandlerErrors: [] });
  });

  test('a well-formed text is passed through verbatim, including the mention and any whitespace', async () => {
    const { App, DispatchAsync } = await StartAppAsync();
    /** @type {any[]} */
    const Seen = [];
    App.HandleAppMention(async (_, ArgEventInfo) => { Seen.push(ArgEventInfo.text); return true; });

    const Text = '<@UBOT123>   show my reminders  ';
    await DispatchAsync({ ...BaseEvent, text: Text });

    expect(Seen).toEqual([Text]);
  });

  test('an empty-string text is preserved, not replaced by a default', async () => {
    const { App, DispatchAsync } = await StartAppAsync();
    /** @type {any[]} */
    const Seen = [];
    App.HandleAppMention(async (_, ArgEventInfo) => { Seen.push(ArgEventInfo.text); return true; });

    await DispatchAsync({ ...BaseEvent, text: '' });

    expect(Seen).toEqual(['']);
  });

  test('red control: without the guard the chain would log a handler error — a throwing handler still does', async () => {
    const { App, Logger, DispatchAsync } = await StartAppAsync();
    App.HandleAppMention(async () => { throw new TypeError('control: handler threw'); });

    await DispatchAsync({ ...BaseEvent, text: '<@UBOT123> hi' });

    const HandlerErrors = Logger.ErrorMessages.filter((ArgEntry) => /Error in app_mention handler/.test(String(ArgEntry)));
    expect(HandlerErrors).toHaveLength(1);
  });

  test('the other dispatch fields are still forwarded raw, so the guard is scoped to text', async () => {
    const { App, DispatchAsync } = await StartAppAsync();
    /** @type {any[]} */
    const Seen = [];
    App.HandleAppMention(async (_, ArgEventInfo) => { Seen.push(ArgEventInfo); return true; });

    await DispatchAsync({ ...BaseEvent, text: 'hi', thread_ts: '1700000000.000001' });

    expect(Seen[0]).toMatchObject({
      channel: 'C_TEST',
      ts: '1700000000.000100',
      user: 'U_TEST',
      thread_ts: '1700000000.000001',
      files: [],
    });
  });
});
