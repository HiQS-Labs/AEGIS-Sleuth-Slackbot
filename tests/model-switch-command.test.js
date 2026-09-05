'use strict';

const HandleModelSwitchCommandAsync = require('../src/chat-commands/model-switch-command');

/**
 * Build a minimally-stubbed environment for direct handler invocation. Avoids ChatModule wiring
 * so we can assert the persist callback is invoked with the mutated WorkspaceInfo without
 * touching the real Workspaces module or the filesystem.
 */
function MakeEnv({
  IsAdmin = true,
  ValidationResult = { ok: true, reason: 'valid', providerId: 'openai', providerLabel: 'OpenAI' },
} = {}) {
  const WorkspaceInfo = {
    WORKSPACE_NAME: 'TestWorkspace',
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test',
    LIVE_SIGNING_SECRET: 'secret',
    LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test',
    REMINDER_CHANNEL_NAME: 'test-reminders',
    MAIN_TIMEZONE: 'America/Los_Angeles',
  };
  const SlackApp = {
    Logger: { info: jest.fn(), error: jest.fn() },
    IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(IsAdmin),
    PostMessageTextAsync: jest.fn().mockResolvedValue(),
  };
  const WorkspaceAI = {
    WorkspaceInfo,
    DefaultModelName: 'gpt-4o-mini',
    GetModelAvailabilityAsync: jest.fn().mockResolvedValue(ValidationResult),
  };
  const RemindersWorkspaceAI = {
    WorkspaceInfo,
    DefaultModelName: 'gpt-4o-mini',
    ComplexModelName: 'gpt-4o',
  };
  const RemindersModule = { WorkspaceAI: RemindersWorkspaceAI };
  const InvalidateTemplate = jest.fn();
  const PersistAsync = jest.fn().mockResolvedValue();
  const EventInfo = { user: 'U_ADMIN', channel: 'C_GENERAL', ts: '1700000000.000001', text: '' };
  return { WorkspaceInfo, SlackApp, WorkspaceAI, RemindersModule, InvalidateTemplate, PersistAsync, EventInfo };
}

describe('HandleModelSwitchCommandAsync — persistence', () => {
  test('writes DEFAULT_MODEL_NAME to WorkspaceInfo and calls the persist callback after a successful default switch', async () => {
    const Env = MakeEnv();
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'gpt-5-mini', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );

    // in-memory mutation (existing behavior)
    expect(Env.WorkspaceAI.DefaultModelName).toBe('gpt-5-mini');
    expect(Env.RemindersModule.WorkspaceAI.DefaultModelName).toBe('gpt-5-mini');
    // persisted mutation (the regression fix)
    expect(Env.WorkspaceInfo.DEFAULT_MODEL_NAME).toBe('gpt-5-mini');
    expect(Env.PersistAsync).toHaveBeenCalledTimes(1);
    expect(Env.PersistAsync).toHaveBeenCalledWith(Env.WorkspaceInfo);
    // the persist call must happen before the user-facing "switched" message so a persist
    // failure surfaces as a "Failed to switch model" reply rather than a misleading success.
    const PersistOrder = Env.PersistAsync.mock.invocationCallOrder[0];
    const PostOrder = Env.SlackApp.PostMessageTextAsync.mock.invocationCallOrder[0];
    expect(PersistOrder).toBeLessThan(PostOrder);
  });

  test('does not call persist when the model is invalid (no in-memory mutation either)', async () => {
    const Env = MakeEnv({
      ValidationResult: {
        ok: false,
        reason: 'not-found',
        providerId: 'openai',
        providerLabel: 'OpenAI',
      },
    });
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'gpt-nonexistent', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );

    expect(Env.WorkspaceAI.DefaultModelName).toBe('gpt-4o-mini');
    expect(Env.WorkspaceInfo.DEFAULT_MODEL_NAME).toBeUndefined();
    expect(Env.PersistAsync).not.toHaveBeenCalled();
  });

  test('surfaces missing provider configuration without mutating or persisting', async () => {
    const Env = MakeEnv({
      ValidationResult: {
        ok: false,
        reason: 'provider-not-configured',
        providerId: 'anthropic',
        providerLabel: 'Anthropic Claude',
        error: "Cannot use model 'claude-opus-4-7': Anthropic Claude API key is not configured for this workspace.",
      },
    });
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'claude-opus-4-7', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );

    expect(Env.WorkspaceAI.DefaultModelName).toBe('gpt-4o-mini');
    expect(Env.PersistAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      Env.EventInfo.channel,
      Env.EventInfo.ts,
      "Cannot use model 'claude-opus-4-7': Anthropic Claude API key is not configured for this workspace."
    );
  });
});

describe('HandleModelSwitchCommandAsync — GH-168 alias resolution at the executor', () => {
  test("resolves a vendor name to its pin, validates the PIN, and says what it resolved from", async () => {
    const Env = MakeEnv();
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'ChatGPT', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );

    expect(Env.WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('gpt-5.6-terra');
    expect(Env.WorkspaceAI.DefaultModelName).toBe('gpt-5.6-terra');
    expect(Env.WorkspaceInfo.DEFAULT_MODEL_NAME).toBe('gpt-5.6-terra');
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      Env.EventInfo.channel, Env.EventInfo.ts,
      "Default model switched to 'gpt-5.6-terra' (resolved from 'ChatGPT')"
    );
  });

  test('an exact model ID is passed through untouched with no provenance clause', async () => {
    const Env = MakeEnv();
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'gpt-5-mini', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );
    expect(Env.WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('gpt-5-mini');
    const Posted = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Posted).toBe("Default model switched to 'gpt-5-mini'");
    expect(Posted).not.toContain('resolved from');
  });

  test('the complex model resolves family aliases too', async () => {
    const Env = MakeEnv();
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, null, 'sonnet',
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );
    expect(Env.WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('claude-sonnet-5');
    expect(Env.RemindersModule.WorkspaceAI.ComplexModelName).toBe('claude-sonnet-5');
    expect(Env.WorkspaceInfo.COMPLEX_MODEL_NAME).toBe('claude-sonnet-5');
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe(
      "Complex model switched to 'claude-sonnet-5' (resolved from 'sonnet')"
    );
  });

  test('a pin the live catalog no longer lists is reported as a stale alias, not a user typo', async () => {
    const Env = MakeEnv({
      ValidationResult: { ok: false, reason: 'not-found', providerId: 'openai', providerLabel: 'OpenAI' },
    });
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'ChatGPT', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );
    expect(Env.WorkspaceAI.DefaultModelName).toBe('gpt-4o-mini');
    expect(Env.PersistAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe(
      "'ChatGPT' → 'gpt-5.6-terra' is not in this workspace's OpenAI catalog — the alias pin is stale. Default still using 'gpt-4o-mini'"
    );
  });

  test('a cross-vendor phrase is refused: passed through unresolved and reported as not found', async () => {
    const Env = MakeEnv({
      ValidationResult: { ok: false, reason: 'not-found', providerId: 'openai', providerLabel: 'OpenAI' },
    });
    await HandleModelSwitchCommandAsync(
      Env.SlackApp, Env.EventInfo, 'openai claude opus', null,
      Env.WorkspaceAI, Env.RemindersModule, Env.InvalidateTemplate, Env.PersistAsync
    );
    expect(Env.WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('openai claude opus');
    expect(Env.WorkspaceAI.DefaultModelName).toBe('gpt-4o-mini');
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe(
      "'openai claude opus' not found. Default still using 'gpt-4o-mini'"
    );
  });
});
