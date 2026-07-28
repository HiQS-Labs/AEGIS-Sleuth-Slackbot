'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  ParseArgs,
  ValidateOptions,
  BuildInitialComment,
  ResolveUploadedMessageInfoAsync,
  FindUploadedShareMessage,
  FindHarnessReplyMessage,
  RunFileUploadHarnessAsync,
} = require('../scripts/slack-harness-file-upload');

async function CreateTempFileAsync(ArgFileName, ArgContent) {
  const TempPath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(16).slice(2)}-${ArgFileName}`);
  await fs.writeFile(TempPath, ArgContent, 'utf8');
  return TempPath;
}

describe('slack-harness-file-upload ParseArgs', () => {
  test('parses execute mode with explicit question and upload file', () => {
    const Result = ParseArgs([
      '--workspace', 'dev-workspace',
      '--channel', 'sleuth-test',
      '--upload-file', '/tmp/contract.md',
      '--question', 'summarize this document',
      '--execute',
      '--timeout-ms', '45000',
    ]);

    expect(Result).toEqual({
      WorkspaceName: 'dev-workspace',
      ChannelName: 'sleuth-test',
      ChannelID: null,
      ThreadTS: null,
      UploadFilePath: '/tmp/contract.md',
      QuestionText: 'summarize this document',
      QuestionFilePath: null,
      Execute: true,
      HelpRequested: false,
      TimeoutMs: 45000,
    });
  });
});

describe('slack-harness-file-upload ValidateOptions', () => {
  test('rejects missing upload file', () => {
    expect(() => ValidateOptions(ParseArgs([
      '--workspace', 'dev',
      '--question', 'hello',
    ]))).toThrow('--upload-file');
  });

  test('rejects both question selectors', () => {
    expect(() => ValidateOptions(ParseArgs([
      '--workspace', 'dev',
      '--upload-file', '/tmp/contract.md',
      '--question', 'hello',
      '--question-file', '/tmp/question.txt',
    ]))).toThrow('exactly one of --question or --question-file');
  });
});

describe('slack-harness-file-upload helpers', () => {
  test('builds the upload comment with the bot mention first', () => {
    expect(BuildInitialComment('<@UBOT123>', 'summarize this file')).toBe('<@UBOT123> summarize this file');
  });

  test('resolves upload timestamps from channel history fallback', async () => {
    const SlackApp = {
      GetRecentChannelMessagesAsync: jest.fn().mockResolvedValue([
        {
          user: 'UBOT123',
          text: '<@UBOT123> summarize this file',
          ts: '1710000000.000101',
          thread_ts: undefined,
          bot_id: 'B123',
          files: [{
            id: 'F123',
            name: 'contract.md',
            mimetype: 'text/markdown',
            url_private: 'https://example.test/private',
            url_private_download: 'https://example.test/download',
            size: 123,
          }],
          reactions: [],
        },
      ]),
      GetConversationMessagesAsync: jest.fn(),
    };

    await expect(ResolveUploadedMessageInfoAsync(
      SlackApp,
      'C123ABC456',
      null,
      '<@UBOT123> summarize this file',
      {
        File: {
          id: 'F123',
          name: 'contract.md',
          mimetype: 'text/markdown',
          url_private: 'https://example.test/private',
          url_private_download: 'https://example.test/download',
          size: 123,
        },
        MessageTS: null,
        ThreadTS: null,
        Permalink: null,
      }
    )).resolves.toEqual({
      MessageTS: '1710000000.000101',
      ThreadTS: '1710000000.000101',
    });
  });

  test('finds the bot reply while skipping root and upload share messages', () => {
    const Result = FindHarnessReplyMessage([
      { user: 'UBOT123', text: 'root', ts: '1710000000.000100', thread_ts: undefined, bot_id: 'B123', reactions: [] },
      { user: 'UBOT123', text: 'uploaded file share', ts: '1710000000.000101', thread_ts: '1710000000.000100', bot_id: 'B123', reactions: [] },
      { user: 'UBOT123', text: 'answer text', ts: '1710000000.000102', thread_ts: '1710000000.000100', bot_id: 'B123', reactions: [] },
    ], 'UBOT123', '1710000000.000100', '1710000000.000101');

    expect(Result?.text).toBe('answer text');
  });

  test('prefers matching the uploaded file ID over duplicate question text', () => {
    const Result = FindUploadedShareMessage([
      {
        user: 'UBOT123',
        text: '<@UBOT123> summarize this file',
        ts: '1710000000.000100',
        thread_ts: undefined,
        bot_id: 'B123',
        files: [{ id: 'F_OLD', name: 'old.md', mimetype: 'text/markdown', url_private: 'a', url_private_download: 'a', size: 10 }],
        reactions: [],
      },
      {
        user: 'UBOT123',
        text: '<@UBOT123> summarize this file',
        ts: '1710000000.000200',
        thread_ts: undefined,
        bot_id: 'B123',
        files: [{ id: 'F_NEW', name: 'new.md', mimetype: 'text/markdown', url_private: 'b', url_private_download: 'b', size: 11 }],
        reactions: [],
      },
    ], '<@UBOT123> summarize this file', 'F_NEW');

    expect(Result?.ts).toBe('1710000000.000200');
  });
});

describe('slack-harness-file-upload RunFileUploadHarnessAsync', () => {
  test('rejects oversized files before starting the harness runtime', async () => {
    const UploadFilePath = await CreateTempFileAsync('too-large.md', 'a'.repeat((200 * 1024) + 1));

    try {
      await expect(RunFileUploadHarnessAsync({
        WorkspaceName: 'dev-workspace',
        ChannelName: 'sleuth-test',
        ChannelID: null,
        ThreadTS: null,
        UploadFilePath,
        QuestionText: 'summarize this document',
        QuestionFilePath: null,
        Execute: true,
        HelpRequested: false,
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
        LoggerFactory: jest.fn().mockReturnValue({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
        AcquireLockAsync: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
        CreateHarnessRuntimeAsync: jest.fn(),
      })).rejects.toThrow('too large to use as context memory');
    } finally {
      await fs.unlink(UploadFilePath);
    }
  });

  test('dry-run resolves the target channel without uploading', async () => {
    const UploadFilePath = await CreateTempFileAsync('contract.md', '# contract');
    const CleanupAsync = jest.fn().mockResolvedValue(undefined);
    const Runtime = {
      SlackAppInstance: {
        GetChannelIdAsync: jest.fn().mockResolvedValue('C123ABC456'),
        GetChannelNameAsync: jest.fn().mockResolvedValue('sleuth-test'),
      },
      CleanupAsync,
    };

    try {
      const Result = await RunFileUploadHarnessAsync({
        WorkspaceName: 'dev-workspace',
        ChannelName: 'sleuth-test',
        ChannelID: null,
        ThreadTS: null,
        UploadFilePath,
        QuestionText: 'summarize this document',
        QuestionFilePath: null,
        Execute: false,
        HelpRequested: false,
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
        LoggerFactory: jest.fn().mockReturnValue({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
        AcquireLockAsync: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
        CreateHarnessRuntimeAsync: jest.fn().mockResolvedValue(Runtime),
      });

      expect(Result).toEqual({
        success: true,
        dryRun: true,
        workspace: 'dev-workspace',
        channel: 'sleuth-test',
        channelId: 'C123ABC456',
        threadTs: null,
        uploadMessageTs: null,
        replyTs: null,
        handled: null,
        uploadFileName: path.basename(UploadFilePath),
        uploadFileSizeBytes: 10,
      });
      expect(CleanupAsync).toHaveBeenCalledTimes(1);
    } finally {
      await fs.unlink(UploadFilePath);
    }
  });

  test('preserves the primary error when cleanup also fails', async () => {
    const UploadFilePath = await CreateTempFileAsync('contract.md', '# contract');
    const CleanupAsync = jest.fn().mockRejectedValue(new Error('cleanup failed'));
    const Runtime = {
      SlackAppInstance: {
        AppMentionString: '<@UBOT123>',
        BotUserID: 'UBOT123',
        GetChannelIdAsync: jest.fn().mockResolvedValue('C123ABC456'),
        GetChannelNameAsync: jest.fn().mockResolvedValue('sleuth-test'),
        UploadFileAsync: jest.fn().mockRejectedValue({
          data: {
            error: 'missing_scope',
            needed: 'files:write',
            provided: 'chat:write,channels:history',
          },
        }),
      },
      CleanupAsync,
    };

    try {
      await expect(RunFileUploadHarnessAsync({
        WorkspaceName: 'dev-workspace',
        ChannelName: 'sleuth-test',
        ChannelID: null,
        ThreadTS: null,
        UploadFilePath,
        QuestionText: 'summarize this document',
        QuestionFilePath: null,
        Execute: true,
        HelpRequested: false,
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
        LoggerFactory: jest.fn().mockReturnValue({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
        AcquireLockAsync: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
        CreateHarnessRuntimeAsync: jest.fn().mockResolvedValue(Runtime),
      })).rejects.toThrow('Slack file upload failed: Slack API scope "files:write" is required');
      expect(CleanupAsync).toHaveBeenCalledTimes(1);
    } finally {
      await fs.unlink(UploadFilePath);
    }
  });

  test('uploads the file, simulates the mention, and returns the reply', async () => {
    const UploadFilePath = await CreateTempFileAsync('contract.md', '# contract');
    const UploadFileAsync = jest.fn().mockResolvedValue({
      File: {
        id: 'F123',
        name: 'contract.md',
        mimetype: 'text/markdown',
        url_private: 'https://example.test/private',
        url_private_download: 'https://example.test/download',
        size: 10,
      },
      MessageTS: '1710000000.000100',
      ThreadTS: '1710000000.000100',
      Permalink: 'https://example.test/file',
    });
    const SimulateAppMentionAsync = jest.fn().mockResolvedValue(true);
    const GetConversationMessagesAsync = jest.fn().mockResolvedValue([
      {
        user: 'UBOT123',
        text: '<@UBOT123> summarize this document',
        ts: '1710000000.000100',
        thread_ts: undefined,
        bot_id: 'B123',
        reactions: [],
      },
      {
        user: 'UBOT123',
        text: 'Summary reply',
        ts: '1710000000.000101',
        thread_ts: '1710000000.000100',
        bot_id: 'B123',
        reactions: [],
      },
    ]);
    const CleanupAsync = jest.fn().mockResolvedValue(undefined);
    const Runtime = {
      SlackAppInstance: {
        AppMentionString: '<@UBOT123>',
        BotUserID: 'UBOT123',
        GetChannelIdAsync: jest.fn().mockResolvedValue('C123ABC456'),
        GetChannelNameAsync: jest.fn().mockResolvedValue('sleuth-test'),
        UploadFileAsync,
        SimulateAppMentionAsync,
        GetConversationMessagesAsync,
        GetPermaLinkAsync: jest.fn().mockResolvedValue('https://example.test/permalink'),
      },
      CleanupAsync,
    };

    try {
      const Result = await RunFileUploadHarnessAsync({
        WorkspaceName: 'dev-workspace',
        ChannelName: 'sleuth-test',
        ChannelID: null,
        ThreadTS: null,
        UploadFilePath,
        QuestionText: 'summarize this document',
        QuestionFilePath: null,
        Execute: true,
        HelpRequested: false,
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
        LoggerFactory: jest.fn().mockReturnValue({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
        AcquireLockAsync: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
        CreateHarnessRuntimeAsync: jest.fn().mockResolvedValue(Runtime),
      });

      expect(Result).toMatchObject({
        success: true,
        dryRun: false,
        workspace: 'dev-workspace',
        channel: 'sleuth-test',
        channelId: 'C123ABC456',
        threadTs: '1710000000.000100',
        uploadMessageTs: '1710000000.000100',
        replyTs: '1710000000.000101',
        handled: true,
        uploadFileName: path.basename(UploadFilePath),
        uploadFileSizeBytes: 10,
        replyText: 'Summary reply',
      });
      expect(UploadFileAsync).toHaveBeenCalledWith(
        'C123ABC456',
        null,
        UploadFilePath,
        '<@UBOT123> summarize this document',
        path.basename(UploadFilePath)
      );
      expect(SimulateAppMentionAsync).toHaveBeenCalledWith({
        channel: 'C123ABC456',
        text: '<@UBOT123> summarize this document',
        ts: '1710000000.000100',
        thread_ts: undefined,
        user: 'U_SLEUTH_FILE_HARNESS',
        files: [expect.objectContaining({ id: 'F123', name: 'contract.md' })],
      });
      expect(CleanupAsync).toHaveBeenCalledTimes(1);
    } finally {
      await fs.unlink(UploadFilePath);
    }
  });

  test('surfaces missing Slack upload scope as an actionable error', async () => {
    const UploadFilePath = await CreateTempFileAsync('contract.md', '# contract');
    const CleanupAsync = jest.fn().mockResolvedValue(undefined);
    const Runtime = {
      SlackAppInstance: {
        AppMentionString: '<@UBOT123>',
        BotUserID: 'UBOT123',
        GetChannelIdAsync: jest.fn().mockResolvedValue('C123ABC456'),
        GetChannelNameAsync: jest.fn().mockResolvedValue('sleuth-test'),
        UploadFileAsync: jest.fn().mockRejectedValue({
          data: {
            error: 'missing_scope',
            needed: 'files:write',
            provided: 'chat:write,channels:history',
          },
        }),
      },
      CleanupAsync,
    };

    try {
      await expect(RunFileUploadHarnessAsync({
        WorkspaceName: 'dev-workspace',
        ChannelName: 'sleuth-test',
        ChannelID: null,
        ThreadTS: null,
        UploadFilePath,
        QuestionText: 'summarize this document',
        QuestionFilePath: null,
        Execute: true,
        HelpRequested: false,
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
        LoggerFactory: jest.fn().mockReturnValue({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
        AcquireLockAsync: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
        CreateHarnessRuntimeAsync: jest.fn().mockResolvedValue(Runtime),
      })).rejects.toThrow('Slack file upload failed: Slack API scope "files:write" is required');
      expect(CleanupAsync).toHaveBeenCalledTimes(1);
    } finally {
      await fs.unlink(UploadFilePath);
    }
  });
});
