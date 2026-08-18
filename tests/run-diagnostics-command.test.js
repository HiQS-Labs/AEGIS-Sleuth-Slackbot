'use strict';

const HandleRunDiagnosticsCommandAsync = require('../src/chat-commands/run-diagnostics-command');

describe('HandleRunDiagnosticsCommandAsync', () => {
  let MockSlackApp;
  let MockEventInfo;
  let MockDeps;

  beforeEach(() => {
    MockSlackApp = {
      WorkspaceInfo: {
        WORKSPACE_NAME: 'test-workspace',
        REMINDER_CHANNEL_NAME: 'sleuth-reminders',
        ADMIN_EMAIL: 'admin@example.com',
        LIVE_TOKEN: 'xoxb-token',
        LIVE_SIGNING_SECRET: 'secret',
        LIVE_APP_TOKEN: 'xapp-token',
        MAIN_TIMEZONE: 'America/Los_Angeles',
        OPENAI_API_KEY: 'sk-mock-key',
      },
      IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(true),
      PostMessageTextAsync: jest.fn().mockResolvedValue(undefined),
      CheckSlackConnectivityAsync: jest.fn().mockResolvedValue({ ok: true, user_id: 'U_BOT' }),
      GetChannelIdAsync: jest.fn().mockResolvedValue('C_REMINDERS'),
      Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };

    MockEventInfo = {
      channel: 'C_DIAG',
      ts: '1700000000.000001',
      user: 'U_ADMIN',
    };

    MockDeps = {
      WorkspaceAI: {
        DefaultModelName: 'gpt-4o-mini',
        TestProviderConnectivityAsync: jest.fn().mockResolvedValue({
          openai: { label: 'OpenAI', configured: true, ok: true },
        }),
      },
      StatsModule: { DataLoaded: true },
      RemindersModule: {
        DataLoaded: true,
        AreRemindersEnabledForChannel: jest.fn((id) => id === 'C_DIAG'),
      },
      NotionModule: null,
    };
  });

  it('rejects non-admin users', async () => {
    MockSlackApp.IsAdminOrOwnerAsync.mockResolvedValue(false);

    await HandleRunDiagnosticsCommandAsync(MockSlackApp, MockEventInfo, MockDeps);

    expect(MockSlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_DIAG',
      '1700000000.000001',
      'sorry, only workspace admins or owners can run diagnostics.'
    );
  });

  it('runs diagnostics and posts report with baseline and extended probes', async () => {
    await HandleRunDiagnosticsCommandAsync(MockSlackApp, MockEventInfo, MockDeps);

    expect(MockSlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_DIAG',
      '1700000000.000001',
      expect.stringContaining('*Diagnostics Baseline:*')
    );

    const PostedText = MockSlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(PostedText).toContain('• Auto-scheduling in this channel: *enabled*');
    expect(PostedText).toContain('*Extended Probes:*');
    expect(PostedText).toContain('• Workspace configuration: OK');
    expect(PostedText).toContain('• Stats data loaded: OK');
    expect(PostedText).toContain('• Reminders data loaded: OK');
  });

  it('reflects auto-scheduling disabled when run in a channel with reminders off', async () => {
    MockDeps.RemindersModule.AreRemindersEnabledForChannel = jest.fn().mockReturnValue(false);

    await HandleRunDiagnosticsCommandAsync(MockSlackApp, MockEventInfo, MockDeps);

    const PostedText = MockSlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(PostedText).toContain('• Auto-scheduling in this channel: *disabled*');
  });
});
