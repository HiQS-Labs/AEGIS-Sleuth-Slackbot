'use strict';

const SlackApp = require('../src/slack-app');

describe('SlackApp.GetFileContentAsync', () => {
  /** @type {typeof global.fetch} */
  let OriginalFetch;

  beforeAll(() => {
    OriginalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = OriginalFetch;
  });

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  function CreateSlackApp() {
    const WorkspaceInfo = {
      WORKSPACE_NAME: 'test-workspace',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test-token',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    };
    const Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    return {
      App: new SlackApp(WorkspaceInfo, Logger),
      Logger,
    };
  }

  function CreateFetchResponse(ArgStatus, ArgLocation, ArgContentType, ArgText = '') {
    return {
      status: ArgStatus,
      ok: ArgStatus >= 200 && ArgStatus < 300,
      headers: {
        get: (ArgHeaderName) => {
          const HeaderName = ArgHeaderName.toLowerCase();
          if(HeaderName === 'location') return ArgLocation;
          if(HeaderName === 'content-type') return ArgContentType;
          return null;
        },
      },
      text: async () => ArgText,
    };
  }

  test('strips auth on cross-origin redirects and keeps redirect logs redacted', async () => {
    const { App, Logger } = CreateSlackApp();

    global.fetch
      .mockResolvedValueOnce(CreateFetchResponse(
        302,
        'https://downloads.slack-edge.com/files-pri/T123-F456/report.md?signature=super-secret',
        null
      ))
      .mockResolvedValueOnce(CreateFetchResponse(200, null, 'text/plain', '# report'));

    const Content = await App.GetFileContentAsync(
      'https://files.slack.com/files-pri/T123-F456/report.md?download=1&token=top-secret'
    );

    expect(Content).toBe('# report');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Bearer xoxb-test-token' },
      redirect: 'manual',
    });
    expect(String(global.fetch.mock.calls[1][0])).toBe(
      'https://downloads.slack-edge.com/files-pri/T123-F456/report.md?signature=super-secret'
    );
    expect(global.fetch.mock.calls[1][1]).toEqual({});

    const LogOutput = Logger.info.mock.calls.map((ArgCall) => ArgCall.join(' ')).join('\n');
    expect(LogOutput).toContain('following redirect to host: downloads.slack-edge.com | forwarded auth: false');
    expect(LogOutput).not.toContain('top-secret');
    expect(LogOutput).not.toContain('super-secret');
  });

  test('preserves auth on same-origin redirects', async () => {
    const { App, Logger } = CreateSlackApp();

    global.fetch
      .mockResolvedValueOnce(CreateFetchResponse(
        302,
        'https://files.slack.com/files-pri/T123-F456/report.md?download=1',
        null
      ))
      .mockResolvedValueOnce(CreateFetchResponse(200, null, 'text/plain', '# report'));

    const Content = await App.GetFileContentAsync(
      'https://files.slack.com/files-pri/T123-F456/report.md?preview=1'
    );

    expect(Content).toBe('# report');
    expect(global.fetch.mock.calls[1][1]).toEqual({
      headers: { Authorization: 'Bearer xoxb-test-token' },
    });

    const LogOutput = Logger.info.mock.calls.map((ArgCall) => ArgCall.join(' ')).join('\n');
    expect(LogOutput).toContain('following redirect to host: files.slack.com | forwarded auth: true');
  });

  test('rejects non-https redirect targets', async () => {
    const { App } = CreateSlackApp();

    global.fetch.mockResolvedValueOnce(CreateFetchResponse(
      302,
      'http://downloads.slack-edge.com/files-pri/T123-F456/report.md',
      null
    ));

    await expect(App.GetFileContentAsync(
      'https://files.slack.com/files-pri/T123-F456/report.md?download=1'
    )).rejects.toThrow("Refusing to follow Slack file redirect to non-HTTPS host 'downloads.slack-edge.com'.");
  });
});
