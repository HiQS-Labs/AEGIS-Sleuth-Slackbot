'use strict';

// Regression tests for GetPermaLinkAsync's canonical-URL hardening (GH-428). A GitHub bug report
// filed from a `:bug:` reaction linked to a "View Slack message" permalink that rendered a blank
// page for the reporter. Slack's own `chat.getPermalink` can return that link wrapped in a
// `/?redir=%2Farchives%2F...` auth-bounce form; since we already have the channel/message ts/thread
// ts locally once the API call confirms access, we build the canonical `/archives/...` URL
// ourselves instead of trusting the wrapped form verbatim.

const mockGetPermalink = jest.fn();
const mockAuthTest = jest.fn();
const mockAppConstructor = jest.fn(() => ({
  client: {
    auth: { test: mockAuthTest },
    users: { info: jest.fn() },
    chat: { getPermalink: mockGetPermalink },
    conversations: {},
    reactions: {},
  },
  start: jest.fn(),
  stop: jest.fn(),
  event: jest.fn(),
  message: jest.fn(),
  action: jest.fn(),
}));

jest.mock('@slack/bolt', () => ({
  App: mockAppConstructor,
}));

const SlackApp = require('../src/slack-app');
const { MockLogger } = require('./mocks/mock-slack-app');

const WORKSPACE_NAME = 'neochrome';
const CHANNEL = 'C000EXAMPLE2';
const MESSAGE_TS = '1784770017.896739';
const THREAD_ROOT_TS = '1784769851.784529';

// the exact shape Slack's own API returned for the reported bug — a redir-wrapped auth-bounce URL,
// not the plain documented `/archives/CHANNEL/pTS` permalink form.
const REDIR_WRAPPED_PERMALINK = 'https://neochrome.slack.com/?redir=%2Farchives%2FC000EXAMPLE2%2Fp1784770017896739'
  + '%3Fthread_ts%3D1784769851.784529%26cid%3DC000EXAMPLE2%26name%3DC000EXAMPLE2%26perma%3D1784770017896739';

/**
 * Build a SlackApp instance connected to the mocked Bolt client.
 * @returns {Promise<import('../src/slack-app')>}
 */
async function CreateConnectedSlackAppAsync() {
  const App = new SlackApp({
    WORKSPACE_NAME,
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test',
    LIVE_SIGNING_SECRET: 'secret',
    LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test',
    REMINDER_CHANNEL_NAME: 'test-reminders',
    MAIN_TIMEZONE: 'America/Los_Angeles',
  }, new MockLogger());

  mockAuthTest.mockResolvedValue({ ok: true, user_id: 'UBOT123', team_id: 'T_TEST' });
  await App.ConnectOneShotAsync();
  return App;
}

describe('SlackApp.GetPermaLinkAsync canonical URL (GH-428)', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockGetPermalink.mockReset();
  });

  test('builds our own canonical archive URL instead of trusting a redir-wrapped response', async () => {
    mockGetPermalink.mockResolvedValue({ ok: true, permalink: REDIR_WRAPPED_PERMALINK });
    const App = await CreateConnectedSlackAppAsync();

    const Permalink = await App.GetPermaLinkAsync(CHANNEL, MESSAGE_TS, THREAD_ROOT_TS);

    expect(Permalink).toBe(
      `https://${WORKSPACE_NAME}.slack.com/archives/${CHANNEL}/p1784770017896739?thread_ts=${THREAD_ROOT_TS}&cid=${CHANNEL}`
    );
    expect(Permalink).not.toContain('redir=');
    expect(mockGetPermalink).toHaveBeenCalledWith({ channel: CHANNEL, message_ts: MESSAGE_TS });
  });

  test('omits the thread_ts query when the message is not a threaded reply', async () => {
    mockGetPermalink.mockResolvedValue({ ok: true, permalink: REDIR_WRAPPED_PERMALINK });
    const App = await CreateConnectedSlackAppAsync();

    const Permalink = await App.GetPermaLinkAsync(CHANNEL, MESSAGE_TS);

    expect(Permalink).toBe(`https://${WORKSPACE_NAME}.slack.com/archives/${CHANNEL}/p1784770017896739`);
  });

  test('omits the thread_ts query when the reacted message IS the thread root', async () => {
    mockGetPermalink.mockResolvedValue({ ok: true, permalink: REDIR_WRAPPED_PERMALINK });
    const App = await CreateConnectedSlackAppAsync();

    const Permalink = await App.GetPermaLinkAsync(CHANNEL, MESSAGE_TS, MESSAGE_TS);

    expect(Permalink).toBe(`https://${WORKSPACE_NAME}.slack.com/archives/${CHANNEL}/p1784770017896739`);
  });

  test('returns null when Slack reports the lookup failed (access/existence gate preserved)', async () => {
    mockGetPermalink.mockResolvedValue({ ok: false });
    const App = await CreateConnectedSlackAppAsync();

    expect(await App.GetPermaLinkAsync(CHANNEL, MESSAGE_TS)).toBeNull();
  });

  test('returns null when the Slack API call throws', async () => {
    mockGetPermalink.mockRejectedValue(new Error('network error'));
    const App = await CreateConnectedSlackAppAsync();

    expect(await App.GetPermaLinkAsync(CHANNEL, MESSAGE_TS)).toBeNull();
  });
});
