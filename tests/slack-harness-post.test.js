'use strict';

const {
  ParseArgs,
  ValidateOptions,
  LoadMessageTextAsync,
  ResolveTargetChannelAsync,
  RunPostHarnessAsync,
} = require('../scripts/slack-harness-post');

describe('slack-harness-post ParseArgs', () => {
  test('parses execute mode with explicit channel and text', () => {
    const Result = ParseArgs([
      '--workspace', 'dev-workspace',
      '--channel', 'sleuth-test',
      '--text', 'hello world',
      '--execute',
      '--timeout-ms', '45000',
    ]);

    expect(Result).toEqual({
      WorkspaceName: 'dev-workspace',
      ChannelName: 'sleuth-test',
      ChannelID: null,
      ThreadTS: null,
      MessageText: 'hello world',
      MessageFilePath: null,
      Execute: true,
      HelpRequested: false,
      TimeoutMs: 45000,
    });
  });
});

describe('slack-harness-post ValidateOptions', () => {
  test('rejects missing workspace', () => {
    expect(() => ValidateOptions(ParseArgs(['--text', 'hello']))).toThrow('--workspace');
  });

  test('rejects both channel selectors', () => {
    expect(() => ValidateOptions(ParseArgs([
      '--workspace', 'dev',
      '--channel', 'one',
      '--channel-id', 'C123ABC456',
      '--text', 'hello',
    ]))).toThrow('either --channel or --channel-id');
  });

  test('rejects invalid timeout', () => {
    expect(() => ValidateOptions(ParseArgs([
      '--workspace', 'dev',
      '--text', 'hello',
      '--timeout-ms', '999999',
    ]))).toThrow('Timeout must be an integer');
  });
});

describe('slack-harness-post LoadMessageTextAsync', () => {
  test('prefixes harness messages with workspace name', async () => {
    await expect(LoadMessageTextAsync({
      WorkspaceName: 'dev-workspace',
      MessageText: 'hello world',
      MessageFilePath: null,
    })).resolves.toBe('[sleuth-harness:dev-workspace] hello world');
  });
});

describe('slack-harness-post ResolveTargetChannelAsync', () => {
  test('rejects inexact channel-name matches', async () => {
    const SlackApp = {
      GetChannelIdAsync: jest.fn().mockResolvedValue('C123ABC456'),
      GetChannelNameAsync: jest.fn().mockResolvedValue('sleuth-test-archive'),
    };

    await expect(ResolveTargetChannelAsync(SlackApp, {
      REMINDER_CHANNEL_NAME: 'sleuth-test',
    }, {
      ChannelName: 'sleuth-test',
      ChannelID: null,
    })).rejects.toThrow('refusing inexact match');
  });
});

describe('slack-harness-post RunPostHarnessAsync', () => {
  test('dry-run resolves target without posting', async () => {
    const ConnectOneShotAsync = jest.fn().mockResolvedValue(undefined);
    const PostMessageTextAsync = jest.fn().mockResolvedValue('1700000000.000001');
    const StopAsync = jest.fn().mockResolvedValue(undefined);

    const SlackAppClass = jest.fn().mockImplementation(() => ({
      ConnectOneShotAsync,
      GetChannelIdAsync: jest.fn().mockResolvedValue('C123ABC456'),
      GetChannelNameAsync: jest.fn().mockResolvedValue('sleuth-test'),
      PostMessageTextAsync,
      GetPermaLinkAsync: jest.fn().mockResolvedValue('https://example.test/permalink'),
      StopAsync,
    }));

    const Result = await RunPostHarnessAsync({
      WorkspaceName: 'dev-workspace',
      ChannelName: 'sleuth-test',
      ChannelID: null,
      ThreadTS: null,
      MessageText: 'hello world',
      MessageFilePath: null,
      Execute: false,
      TimeoutMs: 30000,
    }, {
      Workspaces: {
        LoadWorkspaceInfoByNameAsync: jest.fn().mockResolvedValue({
          WORKSPACE_NAME: 'dev-workspace',
          ADMIN_EMAIL: 'admin@example.com',
          LIVE_TOKEN: 'xoxb-test',
          LIVE_SIGNING_SECRET: 'secret',
          LIVE_APP_TOKEN: 'xapp-test',
          OPENAI_API_KEY: 'sk-test',
          REMINDER_CHANNEL_NAME: 'sleuth-test',
          MAIN_TIMEZONE: 'America/Los_Angeles',
        }),
        ValidateWorkspaceInfo: jest.fn(),
      },
      SlackAppClass,
      LoggerFactory: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
      AcquireLockAsync: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
    });

    expect(Result).toEqual({
      success: true,
      dryRun: true,
      workspace: 'dev-workspace',
      channel: 'sleuth-test',
      channelId: 'C123ABC456',
      threadTs: null,
      messageTs: null,
      permalink: null,
    });
    expect(ConnectOneShotAsync).toHaveBeenCalledTimes(1);
    expect(PostMessageTextAsync).not.toHaveBeenCalled();
    expect(StopAsync).toHaveBeenCalledTimes(1);
  });
});
