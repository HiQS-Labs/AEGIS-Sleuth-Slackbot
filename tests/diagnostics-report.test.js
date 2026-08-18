'use strict';

const {
  CollectDiagnosticsBaselineAsync,
  FormatDiagnosticsBaselineLines,
  BuildDiagnosticsCommandReportAsync,
  FormatErrorReport,
  BuildErrorReportAsync,
  GetPackageVersion,
  GetGitBranch,
} = require('../src/diagnostics-report');
const diagnostics = require('../src/diagnostics');
const workspaces = require('../src/workspaces');

describe('DiagnosticsReport', () => {
  let MockSlackApp;
  let MockRemindersModule;
  let MockWorkspaceAI;
  let MockStatsModule;

  beforeEach(() => {
    MockSlackApp = {
      WorkspaceInfo: {
        WORKSPACE_NAME: 'test-workspace',
        REMINDER_CHANNEL_NAME: 'sleuth-reminders',
        ADMIN_EMAIL: 'admin@example.com',
        LIVE_TOKEN: 'xoxb-mock-token',
        LIVE_SIGNING_SECRET: 'mock-signing-secret',
        LIVE_APP_TOKEN: 'xapp-mock-token',
        MAIN_TIMEZONE: 'America/Los_Angeles',
        OPENAI_API_KEY: 'sk-mock-openai-key',
        ANTHROPIC_API_KEY: 'sk-mock-anthropic-key',
      },
      TeamId: 'T12345',
      CheckSlackConnectivityAsync: jest.fn().mockResolvedValue({ ok: true, user_id: 'U_BOT' }),
      GetChannelIdAsync: jest.fn().mockImplementation(async (name) => {
        if(name === 'sleuth-reminders') return 'C_REMINDERS';
        return null;
      }),
      Logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    };

    MockRemindersModule = {
      DataLoaded: true,
      AreRemindersEnabledForChannel: jest.fn((channelId) => channelId === 'C_ENABLED'),
    };

    MockWorkspaceAI = {
      DefaultModelName: 'gpt-4o-mini',
      TestProviderConnectivityAsync: jest.fn().mockResolvedValue({
        openai: { label: 'OpenAI', configured: true, ok: true },
        anthropic: { label: 'Anthropic Claude', configured: true, ok: true },
        gemini: { label: 'Google Gemini', configured: false, ok: false },
      }),
    };

    MockStatsModule = {
      DataLoaded: true,
    };
  });

  describe('CollectDiagnosticsBaselineAsync', () => {
    it('collects all 5 baseline items accurately', async () => {
      const Facts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_ENABLED', {
        RemindersModule: MockRemindersModule,
        WorkspaceAI: MockWorkspaceAI,
      });

      expect(Facts.Version).toBe(GetPackageVersion());
      expect(Facts.Branch).toBe(GetGitBranch());
      expect(Facts.WorkspaceName).toBe('test-workspace');
      expect(Facts.ChannelId).toBe('C_ENABLED');
      expect(Facts.AutoSchedulingEnabled).toBe(true);
      expect(Facts.TargetChannelName).toBe('sleuth-reminders');
      expect(Facts.IsTargetChannel).toBe(false);
      expect(Facts.SlackConnectivity).toEqual({ ok: true, user_id: 'U_BOT' });
      expect(Facts.RuntimeDirPath).toBe(workspaces.GetRuntimeDirPath());
      expect(Facts.RuntimeDirectoryAccess.ok).toBe(true);
      expect(Facts.ConfiguredProviders).toEqual(['OpenAI', 'Anthropic Claude']);
      expect(Facts.ActiveProviderLabel).toBe('OpenAI');
      expect(Facts.ActiveModelName).toBe('gpt-4o-mini');
    });

    it('reports disabled auto-scheduling for channels where reminders are off', async () => {
      const Facts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_DISABLED', {
        RemindersModule: MockRemindersModule,
        WorkspaceAI: MockWorkspaceAI,
      });

      expect(Facts.AutoSchedulingEnabled).toBe(false);
      const Formatted = FormatDiagnosticsBaselineLines(Facts);
      expect(Formatted[1]).toContain('Auto-scheduling in this channel: *disabled*');
    });

    it('flags when current channel is the reminder target channel', async () => {
      const Facts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_REMINDERS', {
        RemindersModule: MockRemindersModule,
        WorkspaceAI: MockWorkspaceAI,
      });

      expect(Facts.IsTargetChannel).toBe(true);
      const Formatted = FormatDiagnosticsBaselineLines(Facts);
      expect(Formatted[1]).toContain('#sleuth-reminders _(this channel)_');
    });

    it('is resilient against failing Slack connectivity check', async () => {
      MockSlackApp.CheckSlackConnectivityAsync = jest.fn().mockRejectedValue(new Error('network down'));

      const Facts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_ENABLED', {
        ForceFreshSlackCheck: true,
        RemindersModule: MockRemindersModule,
      });

      expect(Facts.SlackConnectivity.ok).toBe(false);
      expect(Facts.SlackConnectivity.error).toBe('network down');
      const Formatted = FormatDiagnosticsBaselineLines(Facts);
      expect(Formatted[2]).toContain('Slack API connectivity: FAILED - network down');
    });

    it('is resilient against directory access failure', async () => {
      const Spy = jest.spyOn(diagnostics, 'TestDirectoryAccessAsync').mockResolvedValue({
        ok: false,
        error: 'EACCES: permission denied',
      });

      const Facts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_ENABLED', {
        RemindersModule: MockRemindersModule,
      });

      expect(Facts.RuntimeDirectoryAccess.ok).toBe(false);
      expect(Facts.RuntimeDirectoryAccess.error).toBe('EACCES: permission denied');
      const Formatted = FormatDiagnosticsBaselineLines(Facts);
      expect(Formatted[3]).toContain('FAILED - EACCES: permission denied');

      Spy.mockRestore();
    });
  });

  describe('FormatDiagnosticsBaselineLines', () => {
    it('produces exactly 5 formatted bullet lines', async () => {
      const Facts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_ENABLED', {
        RemindersModule: MockRemindersModule,
        WorkspaceAI: MockWorkspaceAI,
      });

      const Lines = FormatDiagnosticsBaselineLines(Facts);
      expect(Lines).toHaveLength(5);
      expect(Lines[0]).toMatch(/^• Version: .+ • Workspace: test-workspace$/);
      expect(Lines[1]).toMatch(/^• Auto-scheduling in this channel: \*enabled\* • Target channel: #sleuth-reminders$/);
      expect(Lines[2]).toBe('• Slack API connectivity: OK');
      expect(Lines[3]).toMatch(/^• Runtime data directory: `.+` \(writable\)$/);
      expect(Lines[4]).toBe('• Configured AI providers: OpenAI, Anthropic Claude (active: OpenAI / `gpt-4o-mini`)');
    });
  });

  describe('BuildDiagnosticsCommandReportAsync', () => {
    it('includes baseline lines and extended probe lines', async () => {
      const Report = await BuildDiagnosticsCommandReportAsync(MockSlackApp, 'C_ENABLED', {
        WorkspaceAI: MockWorkspaceAI,
        StatsModule: MockStatsModule,
        RemindersModule: MockRemindersModule,
        NotionModule: null,
      });

      expect(Report).toContain('*Diagnostics Baseline:*');
      expect(Report).toContain('• Auto-scheduling in this channel: *enabled*');
      expect(Report).toContain('*Extended Probes:*');
      expect(Report).toContain('• Workspace configuration: OK');
      expect(Report).toContain('• Stats directory access: OK');
      expect(Report).toContain('• Reminders directory access: OK');
      expect(Report).toContain('• Stats data loaded: OK');
      expect(Report).toContain('• Reminders data loaded: OK');
      expect(Report).toContain('• OpenAI API connectivity: OK');
      expect(Report).toContain('• Anthropic Claude API connectivity: OK');
      expect(Report).toContain('• Google Gemini API connectivity: not configured');
    });
  });

  describe('BuildErrorReportAsync & FormatErrorReport', () => {
    it('formats error message, contextual lines, and identical baseline lines', async () => {
      const ErrorSummary = "couldn't file the GitHub issue (GitHub returned 404). Check the logs.";
      const ContextLines = ['• Attempted repo: `org/my-repo`'];

      const ErrorReport = await BuildErrorReportAsync(
        MockSlackApp,
        'C_ENABLED',
        ErrorSummary,
        ContextLines,
        {
          RemindersModule: MockRemindersModule,
          WorkspaceAI: MockWorkspaceAI,
        }
      );

      const BaselineFacts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_ENABLED', {
        RemindersModule: MockRemindersModule,
        WorkspaceAI: MockWorkspaceAI,
      });
      const ExpectedBaseline = FormatDiagnosticsBaselineLines(BaselineFacts).join('\n');

      expect(ErrorReport.startsWith(ErrorSummary)).toBe(true);
      expect(ErrorReport).toContain('• Attempted repo: `org/my-repo`');
      expect(ErrorReport).toContain('*Diagnostics:*');
      expect(ErrorReport).toContain(ExpectedBaseline);
    });

    it('asserts baseline lines are identical between user-triggered diagnostic and error-triggered one', async () => {
      const UserBaselineFacts = await CollectDiagnosticsBaselineAsync(MockSlackApp, 'C_ENABLED', {
        RemindersModule: MockRemindersModule,
        WorkspaceAI: MockWorkspaceAI,
      });
      const UserBaselineLines = FormatDiagnosticsBaselineLines(UserBaselineFacts);

      const ErrorReport = await BuildErrorReportAsync(
        MockSlackApp,
        'C_ENABLED',
        'Something failed.',
        [],
        {
          RemindersModule: MockRemindersModule,
          WorkspaceAI: MockWorkspaceAI,
        }
      );

      for(const Line of UserBaselineLines) {
        expect(ErrorReport).toContain(Line);
      }
    });
  });
});
