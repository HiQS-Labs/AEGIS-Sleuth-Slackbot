'use strict';

const HandleSetChannelModelCommandAsync = require('../src/chat-commands/set-channel-model-command');

/**
 * Minimal handler environment — mirrors tests/model-switch-command.test.js so the two executor
 * handlers are pinned by the same shape of test (GH-168).
 */
function MakeEnv({
  IsAdmin = true,
  ValidationResult = { ok: true, reason: 'valid', providerId: 'anthropic', providerLabel: 'Anthropic Claude' },
} = {}) {
  const SlackApp = {
    Logger: { info: jest.fn(), error: jest.fn() },
    IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(IsAdmin),
    PostMessageTextAsync: jest.fn().mockResolvedValue(),
  };
  const WorkspaceAI = { GetModelAvailabilityAsync: jest.fn().mockResolvedValue(ValidationResult) };
  const ChannelModelSettings = { SetModelForChannelAsync: jest.fn().mockResolvedValue() };
  const EventInfo = { user: 'U_ADMIN', channel: 'C_GENERAL', ts: '1700000000.000001', text: '' };
  return { SlackApp, WorkspaceAI, ChannelModelSettings, EventInfo };
}

describe('HandleSetChannelModelCommandAsync', () => {
  test('rejects non-admins before any validation', async () => {
    const Env = MakeEnv({ IsAdmin: false });
    await HandleSetChannelModelCommandAsync(Env.SlackApp, Env.EventInfo, 'Claude', Env.WorkspaceAI, Env.ChannelModelSettings);
    expect(Env.WorkspaceAI.GetModelAvailabilityAsync).not.toHaveBeenCalled();
    expect(Env.ChannelModelSettings.SetModelForChannelAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe('sorry, only workspace admins or owners can change the channel model.');
  });

  test("resolves 'Claude' to the pinned Haiku ID, persists the PIN, and reports provenance (GH-168)", async () => {
    const Env = MakeEnv();
    await HandleSetChannelModelCommandAsync(Env.SlackApp, Env.EventInfo, 'Claude', Env.WorkspaceAI, Env.ChannelModelSettings);
    expect(Env.WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
    expect(Env.ChannelModelSettings.SetModelForChannelAsync).toHaveBeenCalledWith('C_GENERAL', 'claude-haiku-4-5-20251001');
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe(
      "Channel <#C_GENERAL> will now use `claude-haiku-4-5-20251001` for AI chat replies (resolved from 'Claude')."
    );
  });

  test('an exact ID is persisted as typed with no provenance clause', async () => {
    const Env = MakeEnv();
    await HandleSetChannelModelCommandAsync(Env.SlackApp, Env.EventInfo, 'gpt-5', Env.WorkspaceAI, Env.ChannelModelSettings);
    expect(Env.ChannelModelSettings.SetModelForChannelAsync).toHaveBeenCalledWith('C_GENERAL', 'gpt-5');
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe('Channel <#C_GENERAL> will now use `gpt-5` for AI chat replies.');
  });

  test('an unknown name is reported as not found and nothing is persisted', async () => {
    const Env = MakeEnv({ ValidationResult: { ok: false, reason: 'not-found', providerId: 'openai', providerLabel: 'OpenAI' } });
    await HandleSetChannelModelCommandAsync(Env.SlackApp, Env.EventInfo, 'gpt-nonexistent', Env.WorkspaceAI, Env.ChannelModelSettings);
    expect(Env.ChannelModelSettings.SetModelForChannelAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe("'gpt-nonexistent' not found. Channel model is unchanged.");
  });

  test('a stale pin is named as such (negative control: the refusal is observed)', async () => {
    const Env = MakeEnv({ ValidationResult: { ok: false, reason: 'not-found', providerId: 'anthropic', providerLabel: 'Anthropic Claude' } });
    await HandleSetChannelModelCommandAsync(Env.SlackApp, Env.EventInfo, 'sonnet', Env.WorkspaceAI, Env.ChannelModelSettings);
    expect(Env.ChannelModelSettings.SetModelForChannelAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toBe(
      "'sonnet' → 'claude-sonnet-5' is not in this workspace's Anthropic Claude catalog — the alias pin is stale. Channel model is unchanged."
    );
  });
});
