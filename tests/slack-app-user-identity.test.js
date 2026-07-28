'use strict';

const mockUsersInfo = jest.fn();
const mockAuthTest = jest.fn();
const mockAppStart = jest.fn();
const mockAppStop = jest.fn();
const mockAppEvent = jest.fn();
const mockAppMessage = jest.fn();
const mockAppAction = jest.fn();
const mockAppConstructor = jest.fn(() => ({
  client: {
    auth: { test: mockAuthTest },
    users: { info: mockUsersInfo },
    chat: {},
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
 * Build a SlackApp instance connected to the mocked Bolt client.
 * @returns {Promise<import('../src/slack-app')>}
 */
async function CreateConnectedSlackAppAsync() {
  const App = new SlackApp({
    WORKSPACE_NAME: 'TestWorkspace',
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test',
    LIVE_SIGNING_SECRET: 'secret',
    LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test',
    REMINDER_CHANNEL_NAME: 'test-reminders',
    MAIN_TIMEZONE: 'America/Los_Angeles',
  }, new MockLogger());

  await App.ConnectOneShotAsync();
  return App;
}

describe('SlackApp user identity resolver', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockAppConstructor.mockClear();
    mockUsersInfo.mockReset();
    mockAuthTest.mockReset();
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

  test('coalesces concurrent users.info lookups and serves later reads from cache', async () => {
    /** @type {(ArgValue: any) => void} */
    let ResolveLookup;
    mockUsersInfo.mockImplementationOnce(() => new Promise((ArgResolve) => {
      ResolveLookup = ArgResolve;
    }));

    const App = await CreateConnectedSlackAppAsync();

    const FirstLookupPromise = App.GetUserIdentityAsync('U_ALICE');
    const SecondLookupPromise = App.GetUserIdentityAsync('U_ALICE');

    expect(mockUsersInfo).toHaveBeenCalledTimes(1);
    ResolveLookup({
      ok: true,
      user: {
        id: 'U_ALICE',
        name: 'alice',
        profile: {
          display_name: 'Alice Smith',
          real_name: 'Alice Example',
          email: 'alice@example.com',
        },
      },
    });

    const [FirstIdentity, SecondIdentity] = await Promise.all([FirstLookupPromise, SecondLookupPromise]);
    expect(FirstIdentity).toEqual(SecondIdentity);
    expect(FirstIdentity).toMatchObject({
      UserID: 'U_ALICE',
      DisplayName: 'Alice Smith',
      RealName: 'Alice Example',
      Username: 'alice',
      Email: 'alice@example.com',
      Mention: '<@U_ALICE>',
    });

    const CachedIdentity = await App.GetUserIdentityAsync('U_ALICE');
    expect(CachedIdentity).toEqual(FirstIdentity);
    expect(mockUsersInfo).toHaveBeenCalledTimes(1);
  });

  test('returns stale cached identity on refresh failure', async () => {
    mockUsersInfo.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'U_ALICE',
        name: 'alice',
        profile: {
          display_name: 'Alice Smith',
        },
      },
    });

    const App = await CreateConnectedSlackAppAsync();
    const CachedIdentity = await App.GetUserIdentityAsync('U_ALICE');

    const LookupError = new Error('rate limited');
    LookupError.data = { error: 'ratelimited' };
    mockUsersInfo.mockRejectedValueOnce(LookupError);

    const RefreshedIdentity = await App.GetUserIdentityAsync('U_ALICE', { ForceRefresh: true });
    expect(RefreshedIdentity).toEqual(CachedIdentity);
    expect(mockUsersInfo).toHaveBeenCalledTimes(2);
  });

  test('enters temporary backoff after stale-cache fallback so sequential reads do not hammer Slack', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));

    mockUsersInfo.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'U_ALICE',
        name: 'alice',
        profile: {
          display_name: 'Alice Smith',
        },
      },
    });

    const App = await CreateConnectedSlackAppAsync();
    const CachedIdentity = await App.GetUserIdentityAsync('U_ALICE', { CacheTTLMS: 1 });

    jest.advanceTimersByTime(5);

    const LookupError = new Error('rate limited');
    LookupError.data = { error: 'ratelimited' };
    mockUsersInfo.mockRejectedValueOnce(LookupError);

    const StaleIdentity = await App.GetUserIdentityAsync('U_ALICE', { CacheTTLMS: 1 });
    expect(StaleIdentity).toEqual(CachedIdentity);
    expect(mockUsersInfo).toHaveBeenCalledTimes(2);

    const BackoffIdentity = await App.GetUserIdentityAsync('U_ALICE', { CacheTTLMS: 1 });
    expect(BackoffIdentity).toEqual(CachedIdentity);
    expect(mockUsersInfo).toHaveBeenCalledTimes(2);
  });

  test('shares one cached identity across display-name and admin checks', async () => {
    mockUsersInfo.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'U_OWNER',
        name: 'owner.handle',
        is_owner: true,
        profile: {
          display_name: '',
          real_name: '',
        },
      },
    });

    const App = await CreateConnectedSlackAppAsync();

    expect(await App.IsAdminOrOwnerAsync('U_OWNER')).toBe(true);
    expect(await App.GetUserDisplayNameAsync('U_OWNER')).toBe('owner.handle');
    expect(mockUsersInfo).toHaveBeenCalledTimes(1);
  });
});
