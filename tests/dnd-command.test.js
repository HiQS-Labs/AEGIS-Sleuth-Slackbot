'use strict';

const HandleDndCommandAsync = require('../src/chat-commands/dnd-command');

function MakeEnv({
  IsAdmin = false,
  IsCreator = false,
  IsWorkspaceDnd = false,
  IsChannelDnd = false,
  DndChannels = [],
} = {}) {
  const SlackApp = {
    Logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(IsAdmin),
    IsChannelCreatorAsync: jest.fn().mockResolvedValue(IsCreator),
    PostMessageTextAsync: jest.fn().mockResolvedValue(),
  };

  const DndSettings = {
    IsWorkspaceDnd: jest.fn().mockReturnValue(IsWorkspaceDnd),
    IsChannelDnd: jest.fn().mockImplementation((channelId) => {
      if(channelId === 'C_CHANNEL') return IsChannelDnd;
      return DndChannels.includes(channelId);
    }),
    GetDndChannelIds: jest.fn().mockReturnValue(DndChannels),
    SetWorkspaceDndAsync: jest.fn().mockResolvedValue(),
    SetChannelDndAsync: jest.fn().mockResolvedValue(),
  };

  const RemindersModule = {
    GetDndSettings: jest.fn().mockReturnValue(DndSettings),
  };

  const EventInfo = { user: 'U_USER', channel: 'C_CHANNEL', ts: '1700000000.000001' };

  return { SlackApp, RemindersModule, DndSettings, EventInfo };
}

describe('HandleDndCommandAsync', () => {
  test('handles uninitialized DND settings gracefully', async () => {
    const Env = MakeEnv();
    Env.RemindersModule.GetDndSettings.mockReturnValue(null);

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'on');

    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_CHANNEL',
      '1700000000.000001',
      expect.stringContaining('still initializing')
    );
  });

  test('reports status when no action is specified', async () => {
    const Env = MakeEnv({ IsWorkspaceDnd: true, DndChannels: ['C_CHANNEL', 'C_OTHER'] });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'status');

    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_CHANNEL',
      '1700000000.000001',
      expect.stringContaining('AEGIS Sleuth Reminders DND / Silent Mode Status')
    );
    const StatusMessage = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(StatusMessage).toContain('Workspace DND:* :no_bell: *ON*');
    expect(StatusMessage).toContain('Channels with DND enabled (2):');
  });

  test('rejects non-admin from toggling workspace DND', async () => {
    const Env = MakeEnv({ IsAdmin: false });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'workspace on');

    expect(Env.DndSettings.SetWorkspaceDndAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_CHANNEL',
      '1700000000.000001',
      'Only workspace admins or owners can change workspace DND settings.'
    );
  });

  test('allows admin to enable and disable workspace DND', async () => {
    const Env = MakeEnv({ IsAdmin: true });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'workspace on');
    expect(Env.DndSettings.SetWorkspaceDndAsync).toHaveBeenCalledWith(true);
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toContain(
      'Do Not Disturb (DND) / Silent Mode has been enabled for the entire workspace'
    );

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'workspace off');
    expect(Env.DndSettings.SetWorkspaceDndAsync).toHaveBeenCalledWith(false);
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[1][2]).toContain(
      'Do Not Disturb (DND) / Silent Mode has been disabled for the workspace'
    );
  });

  test('rejects non-creator and non-admin from toggling channel DND', async () => {
    const Env = MakeEnv({ IsAdmin: false, IsCreator: false });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'on');

    expect(Env.DndSettings.SetChannelDndAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_CHANNEL',
      '1700000000.000001',
      'Only the channel creator or a workspace admin/owner can change channel DND settings.'
    );
  });

  test('allows channel creator to enable and disable channel DND', async () => {
    const Env = MakeEnv({ IsAdmin: false, IsCreator: true });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'on');
    expect(Env.DndSettings.SetChannelDndAsync).toHaveBeenCalledWith('C_CHANNEL', true);
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toContain(
      'Do Not Disturb (DND) / Silent Mode has been enabled for this channel'
    );

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'off');
    expect(Env.DndSettings.SetChannelDndAsync).toHaveBeenCalledWith('C_CHANNEL', false);
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[1][2]).toContain(
      'Do Not Disturb (DND) / Silent Mode has been disabled for this channel'
    );
  });

  test('allows workspace admin to toggle channel DND even if not channel creator', async () => {
    const Env = MakeEnv({ IsAdmin: true, IsCreator: false });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'channel on');
    expect(Env.DndSettings.SetChannelDndAsync).toHaveBeenCalledWith('C_CHANNEL', true);
  });

  test('rejects unrecognized subcommands or arguments with usage instructions', async () => {
    const Env = MakeEnv({ IsAdmin: true, IsCreator: true });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'foobar');
    expect(Env.DndSettings.SetChannelDndAsync).not.toHaveBeenCalled();
    expect(Env.DndSettings.SetWorkspaceDndAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_CHANNEL',
      '1700000000.000001',
      expect.stringContaining('Unrecognized or conflicting DND command: `foobar`.')
    );
  });

  test('rejects conflicting on and off tokens with usage instructions', async () => {
    const Env = MakeEnv({ IsAdmin: true, IsCreator: true });

    await HandleDndCommandAsync(Env.SlackApp, Env.EventInfo, Env.RemindersModule, 'on off');
    expect(Env.DndSettings.SetChannelDndAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_CHANNEL',
      '1700000000.000001',
      expect.stringContaining('Unrecognized or conflicting DND command: `on off`.')
    );
  });
});
