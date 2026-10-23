'use strict';

// GH-277: a Slack startup step that never settles must fail this workspace's start after a bound, clean up the
// half-started Bolt app (including a start that completes late), and keep the retired instance's events out.

const mockAuthTest = jest.fn();
const mockAppInit = jest.fn();
const mockAppStart = jest.fn();
const mockAppStop = jest.fn();
const mockAppEvent = jest.fn();
const mockAppMessage = jest.fn();
const mockAppAction = jest.fn();
const mockAppConstructor = jest.fn(() => ({
  client: { auth: { test: mockAuthTest }, chat: {}, users: {}, conversations: {}, reactions: {} },
  init: mockAppInit,
  start: mockAppStart,
  stop: mockAppStop,
  event: mockAppEvent,
  message: mockAppMessage,
  action: mockAppAction,
}));

jest.mock('@slack/bolt', () => ({ App: mockAppConstructor }));

const SlackApp = require('../src/slack-app');
const { MockLogger } = require('./mocks/mock-slack-app');

const WorkspaceInfo = {
  WORKSPACE_NAME: 'TimeoutWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};
const EmptyStats = { IncomingMessageCount: 0, IncomingMessageLength: 0, OutgoingMessageCount: 0, OutgoingMessageLength: 0 };
const Never = () => new Promise(() => {});
const Flush = () => new Promise((ArgResolve) => setImmediate(ArgResolve));

describe('GH-277 SlackApp startup timeout', () => {
  const PreviousTimeout = process.env.SLACK_START_TIMEOUT_MS;
  /** @type {any[]} */
  let Unhandled;
  const OnUnhandled = (ArgReason) => { Unhandled.push(ArgReason); };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppInit.mockResolvedValue(undefined);
    mockAuthTest.mockResolvedValue({ ok: true, user_id: 'UBOT123', team_id: 'T1' });
    mockAppStart.mockResolvedValue(undefined);
    mockAppStop.mockResolvedValue(undefined);
    process.env.SLACK_START_TIMEOUT_MS = '40';
    Unhandled = [];
    process.on('unhandledRejection', OnUnhandled);
  });

  afterEach(() => {
    process.removeListener('unhandledRejection', OnUnhandled);
    if(PreviousTimeout === undefined) delete process.env.SLACK_START_TIMEOUT_MS;
    else process.env.SLACK_START_TIMEOUT_MS = PreviousTimeout;
  });

  test('constructs Bolt with deferred initialization and awaits init()', async () => {
    const App = new SlackApp(WorkspaceInfo, new MockLogger());
    await App.StartAsync(EmptyStats);
    expect(mockAppConstructor.mock.calls[0][0]).toMatchObject({ deferInitialization: true, socketMode: true });
    expect(mockAppInit).toHaveBeenCalledTimes(1);
    expect(mockAppStart).toHaveBeenCalledTimes(1);
    await App.StopAsync();
  });

  test('a start() that never settles rejects at the bound, logs, and stops the app (fails on the base: hangs)', async () => {
    mockAppStart.mockImplementation(Never);
    const Logger = new MockLogger();
    const App = new SlackApp(WorkspaceInfo, Logger);

    await expect(App.StartAsync(EmptyStats)).rejects.toThrow(/Slack Socket Mode start for workspace TimeoutWorkspace did not complete within 40 ms/);
    expect(mockAppStop).toHaveBeenCalledTimes(1);
    expect(Logger.ErrorMessages.some((ArgMessage) => ArgMessage.includes('Slack Socket Mode did not start for workspace TimeoutWorkspace'))).toBe(true);
  });

  test('a start() that completes after the bound is stopped again; a failing late stop is logged, not unhandled', async () => {
    /** @type {(value?: any) => void} */
    let ResolveStart = () => {};
    mockAppStart.mockImplementation(() => new Promise((ArgResolve) => { ResolveStart = ArgResolve; }));
    const Logger = new MockLogger();
    const App = new SlackApp(WorkspaceInfo, Logger);

    await expect(App.StartAsync(EmptyStats)).rejects.toThrow(/did not complete within 40 ms/);
    expect(mockAppStop).toHaveBeenCalledTimes(1);

    mockAppStop.mockRejectedValueOnce(new Error('socket already closing'));
    ResolveStart();
    await Flush();
    await Flush();

    expect(mockAppStop).toHaveBeenCalledTimes(2);
    expect(Logger.WarnMessages.some((ArgMessage) => ArgMessage.includes('late Slack shutdown for workspace TimeoutWorkspace failed: socket already closing'))).toBe(true);
    expect(Unhandled).toEqual([]);
  });

  test.each([
    ['init()', () => mockAppInit.mockImplementation(Never), /Slack initialization for workspace TimeoutWorkspace did not complete/],
    ['auth.test()', () => mockAuthTest.mockImplementation(Never), /Slack auth.test for workspace TimeoutWorkspace did not complete/],
  ])('%s that never settles rejects through the connectivity-test path', async (_ArgName, ArgArrange, ArgPattern) => {
    ArgArrange();
    const Logger = new MockLogger();
    const App = new SlackApp(WorkspaceInfo, Logger);

    await expect(App.StartAsync(EmptyStats)).rejects.toThrow(/Slack API connectivity test failed/);
    expect(Logger.ErrorMessages.some((ArgMessage) => ArgPattern.test(ArgMessage))).toBe(true);
    expect(mockAppStart).not.toHaveBeenCalled();
  });

  test('an abandoned init() that rejects later is not an unhandled rejection', async () => {
    /** @type {(reason?: any) => void} */
    let RejectInit = () => {};
    mockAppInit.mockImplementation(() => new Promise((_, ArgReject) => { RejectInit = ArgReject; }));
    const App = new SlackApp(WorkspaceInfo, new MockLogger());

    await expect(App.StartAsync(EmptyStats)).rejects.toThrow(/connectivity test failed/);
    RejectInit(new Error('late invalid_auth'));
    await Flush();
    expect(Unhandled).toEqual([]);
  });

  test('events from a retired instance reach no handler, even after the same wrapper starts again', async () => {
    mockAppStart.mockImplementationOnce(Never);
    const Logger = new MockLogger();
    const App = new SlackApp(WorkspaceInfo, Logger);
    const MessageHandler = jest.fn(async () => false);
    const MentionHandler = jest.fn(async () => false);
    App.HandleMessage(MessageHandler);
    App.HandleAppMention(MentionHandler);

    await expect(App.StartAsync(EmptyStats)).rejects.toThrow(/did not complete/);
    const RetiredMessage = mockAppMessage.mock.calls[0][0];
    const RetiredMention = mockAppEvent.mock.calls.find((ArgCall) => ArgCall[0] === 'app_mention')[1];
    const RetiredReaction = mockAppEvent.mock.calls.find((ArgCall) => ArgCall[0] === 'reaction_added')[1];
    await App.StopAsync(); // what the startup catch in src/app.js does

    const Payload = { message: { text: 'hello', channel: 'C_FAKE', user: 'U_FAKE', ts: '1.0' } };
    await expect(RetiredMessage(Payload)).resolves.toBeUndefined();
    await expect(RetiredMention({ event: { text: '<@UBOT123> hi', channel: 'C_FAKE', user: 'U_FAKE', ts: '2.0' } })).resolves.toBeUndefined();
    await expect(RetiredReaction({ event: { reaction: 'alarm_clock', user: 'U_FAKE', item: { channel: 'C_FAKE', ts: '1.0' } } })).resolves.toBeUndefined();

    // the same wrapper starts again (healthy); the old instance's callbacks still must not reach the new handlers.
    App.HandleMessage(MessageHandler);
    App.HandleAppMention(MentionHandler);
    await App.StartAsync(EmptyStats);
    await RetiredMessage(Payload);
    await RetiredMention({ event: { text: '<@UBOT123> hi', channel: 'C_FAKE', user: 'U_FAKE', ts: '2.0' } });

    expect(MessageHandler).not.toHaveBeenCalled();
    expect(MentionHandler).not.toHaveBeenCalled();
    expect(Unhandled).toEqual([]);
    await App.StopAsync();
  });

  test('a healthy start resolves and leaves no pending bound', async () => {
    jest.useFakeTimers();
    try {
      const App = new SlackApp(WorkspaceInfo, new MockLogger());
      await App.StartAsync(EmptyStats);
      expect(jest.getTimerCount()).toBe(0);
      await App.StopAsync();
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    ['', 60000, false],
    ['0', null, false],
    ['2500', 2500, false],
    ['-5', 60000, true],
    ['1.5', 60000, true],
    ['abc', 60000, true],
    ['9999999999', 60000, true],
  ])('SLACK_START_TIMEOUT_MS=%j resolves to %j (warn: %s)', (ArgRaw, ArgExpected, ArgWarns) => {
    const Logger = new MockLogger();
    expect(SlackApp.ResolveSlackStartTimeoutMs(ArgRaw, Logger)).toBe(ArgExpected);
    expect(Logger.WarnMessages.some((ArgMessage) => ArgMessage.includes('ignoring invalid SLACK_START_TIMEOUT_MS'))).toBe(ArgWarns);
  });

  test('SLACK_START_TIMEOUT_MS=0 applies no bound: a slow start is still awaited', async () => {
    process.env.SLACK_START_TIMEOUT_MS = '0';
    mockAppStart.mockImplementation(() => new Promise((ArgResolve) => setTimeout(ArgResolve, 80)));
    const App = new SlackApp(WorkspaceInfo, new MockLogger());
    await expect(App.StartAsync(EmptyStats)).resolves.toBeUndefined();
    expect(mockAppStop).not.toHaveBeenCalled();
    await App.StopAsync();
  });
});
