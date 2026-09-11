'use strict';

/**
 * Handle the `dnd` command family — toggles Do Not Disturb / Silent Mode for reminders
 * at either the channel level or workspace level, or reports current DND status.
 *
 * Syntax:
 *   @Sleuth AI dnd [status]
 *   @Sleuth AI dnd [on|off]
 *   @Sleuth AI dnd channel [on|off]
 *   @Sleuth AI dnd workspace [on|off]
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
 * @param {import('../reminders-module')} ArgRemindersModule Reminders module instance.
 * @param {string} [ArgArgString] Arguments following 'dnd'.
 * @returns {Promise<void>}
 */
async function HandleDndCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgRemindersModule,
  ArgArgString
) {
  const DndSettings = ArgRemindersModule?.GetDndSettings?.();
  if(!DndSettings) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Reminders system or DND settings are still initializing. Please try again in a moment.'
    );
    return;
  }

  const Tokens = (ArgArgString || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let Scope = 'channel';
  let Action = null;

  for(const Token of Tokens) {
    if(Token === 'workspace' || Token === 'group' || Token === 'global') {
      Scope = 'workspace';
    } else if(Token === 'channel' || Token === 'here' || Token === 'this') {
      Scope = 'channel';
    } else if(Token === 'on' || Token === 'enable' || Token === 'start' || Token === 'mute') {
      Action = 'on';
    } else if(Token === 'off' || Token === 'disable' || Token === 'stop' || Token === 'unmute') {
      Action = 'off';
    } else if(Token === 'status' || Token === 'check') {
      Action = 'status';
    }
  }

  // If no action or status requested, report current DND status.
  if(!Action || Action === 'status') {
    const IsWorkspaceDnd = DndSettings.IsWorkspaceDnd();
    const IsChannelDnd = DndSettings.IsChannelDnd(ArgEventInfo.channel);
    const DndChannels = DndSettings.GetDndChannelIds();

    const Lines = [
      '*AEGIS Sleuth Reminders DND / Silent Mode Status:*',
      `• *Workspace DND:* ${IsWorkspaceDnd ? ':no_bell: *ON* (all reminder notifications suppressed workspace-wide)' : ':bell: OFF'}`,
      `• *Current Channel (<#${ArgEventInfo.channel}>) DND:* ${IsChannelDnd ? ':no_bell: *ON* (reminders suppressed in this channel)' : ':bell: OFF'}`,
    ];

    if(DndChannels.length > 0) {
      const ChannelList = DndChannels.map(ArgID => `<#${ArgID}>`).join(', ');
      Lines.push(`• *Channels with DND enabled (${DndChannels.length}):* ${ChannelList}`);
    } else {
      Lines.push('• *Channels with DND enabled:* none');
    }

    Lines.push('');
    Lines.push('Commands to toggle:');
    Lines.push('• `@Sleuth AI dnd on` / `@Sleuth AI dnd off` (this channel)');
    Lines.push('• `@Sleuth AI dnd workspace on` / `@Sleuth AI dnd workspace off` (whole workspace)');

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      Lines.join('\n')
    );
    return;
  }

  // Handle Workspace DND toggle.
  if(Scope === 'workspace') {
    const IsAdmin = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
    if(!IsAdmin) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Only workspace admins or owners can change workspace DND settings.'
      );
      return;
    }

    const TurnOn = Action === 'on';
    await DndSettings.SetWorkspaceDndAsync(TurnOn);

    if(TurnOn) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Do Not Disturb (DND) / Silent Mode has been enabled for the entire workspace. All reminder notifications are paused. Turn it off with `@Sleuth AI dnd workspace off`.'
      );
    } else {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Do Not Disturb (DND) / Silent Mode has been disabled for the workspace. Reminder notifications are active.'
      );
    }
    return;
  }

  // Handle Channel DND toggle.
  const IsCreator = await ArgSlackApp.IsChannelCreatorAsync(ArgEventInfo.channel, ArgEventInfo.user);
  const IsAdminOrOwner = IsCreator ? false : await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!IsCreator && !IsAdminOrOwner) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Only the channel creator or a workspace admin/owner can change channel DND settings.'
    );
    return;
  }

  const TurnOn = Action === 'on';
  await DndSettings.SetChannelDndAsync(ArgEventInfo.channel, TurnOn);

  if(TurnOn) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Do Not Disturb (DND) / Silent Mode has been enabled for this channel (<#${ArgEventInfo.channel}>). Reminder notifications for this channel are paused. Turn it off with \`@Sleuth AI dnd off\`.`
    );
  } else {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Do Not Disturb (DND) / Silent Mode has been disabled for this channel (<#${ArgEventInfo.channel}>). Reminder notifications for this channel are active.`
    );
  }
}

module.exports = HandleDndCommandAsync;
