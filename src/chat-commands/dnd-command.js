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

  const KnownScopeTokens = new Set(['workspace', 'group', 'global', 'channel', 'here', 'this', 'in', 'for']);
  const KnownOnTokens = new Set(['on', 'enable', 'start', 'mute']);
  const KnownOffTokens = new Set(['off', 'disable', 'stop', 'unmute']);
  const KnownStatusTokens = new Set(['status', 'check']);

  const ChannelMentionMatch = (ArgArgString || '').match(/<#([a-zA-Z0-9_-]+)(?:\|[^>]+)?>/);
  let ExplicitTargetChannel = null;
  if(ChannelMentionMatch) {
    ExplicitTargetChannel = ChannelMentionMatch[1];
  } else {
    const RawIdToken = Tokens.find(
      Token => !KnownScopeTokens.has(Token) &&
               !KnownOnTokens.has(Token) &&
               !KnownOffTokens.has(Token) &&
               !KnownStatusTokens.has(Token) &&
               /^[cg][a-z0-9_-]{4,}$/i.test(Token)
    );
    if(RawIdToken) {
      ExplicitTargetChannel = RawIdToken.toUpperCase();
    }
  }

  const TargetChannelID = ExplicitTargetChannel || ArgEventInfo.channel;

  const UnrecognizedTokens = Tokens.filter(
    Token => !KnownScopeTokens.has(Token) &&
             !KnownOnTokens.has(Token) &&
             !KnownOffTokens.has(Token) &&
             !KnownStatusTokens.has(Token) &&
             !Token.startsWith('<#') &&
             (!ExplicitTargetChannel || Token.toLowerCase() !== ExplicitTargetChannel.toLowerCase())
  );

  const HasOn = Tokens.some(Token => KnownOnTokens.has(Token));
  const HasOff = Tokens.some(Token => KnownOffTokens.has(Token));
  const HasStatus = Tokens.some(Token => KnownStatusTokens.has(Token));
  const ActionKinds = [HasOn, HasOff, HasStatus].filter(Boolean).length;

  if(UnrecognizedTokens.length > 0 || ActionKinds > 1) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Unrecognized or conflicting DND command: \`${ArgArgString}\`.\nUsage:\n• \`@Sleuth AI dnd [on|off]\` (current channel)\n• \`@Sleuth AI dnd [on|off] <#channel>\` (target channel)\n• \`@Sleuth AI dnd workspace [on|off]\` (entire workspace)\n• \`@Sleuth AI dnd status\``
    );
    return;
  }

  const Scope = Tokens.some(Token => Token === 'workspace' || Token === 'group' || Token === 'global')
    ? 'workspace'
    : 'channel';

  let Action = null;
  if(HasOn) Action = 'on';
  else if(HasOff) Action = 'off';
  else if(HasStatus) Action = 'status';

  // If no action or status requested, report current DND status.
  if(!Action || Action === 'status') {
    const IsWorkspaceDnd = DndSettings.IsWorkspaceDnd();
    const IsChannelDnd = DndSettings.IsChannelDnd(TargetChannelID);
    const DndChannels = DndSettings.GetDndChannelIds();

    const ChannelLabel = TargetChannelID === ArgEventInfo.channel
      ? `Current Channel (<#${ArgEventInfo.channel}>)`
      : `Channel <#${TargetChannelID}>`;

    const Lines = [
      '*AEGIS Sleuth Reminders DND / Silent Mode Status:*',
      `• *Workspace DND:* ${IsWorkspaceDnd ? ':no_bell: *ON* (all reminder notifications suppressed workspace-wide)' : ':bell: OFF'}`,
      `• *${ChannelLabel} DND:* ${IsChannelDnd ? ':no_bell: *ON* (reminders suppressed in this channel)' : ':bell: OFF'}`,
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
  const IsCreator = await ArgSlackApp.IsChannelCreatorAsync(TargetChannelID, ArgEventInfo.user);
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
  await DndSettings.SetChannelDndAsync(TargetChannelID, TurnOn);

  const ChannelLabel = TargetChannelID === ArgEventInfo.channel
    ? `this channel (<#${TargetChannelID}>)`
    : `<#${TargetChannelID}>`;
  const TurnOffHint = TargetChannelID === ArgEventInfo.channel
    ? '`@Sleuth AI dnd off`'
    : `\`@Sleuth AI dnd off <#${TargetChannelID}>\``;

  if(TurnOn) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Do Not Disturb (DND) / Silent Mode has been enabled for ${ChannelLabel}. Reminder notifications for this channel are paused. Turn it off with ${TurnOffHint}.`
    );
  } else {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Do Not Disturb (DND) / Silent Mode has been disabled for ${ChannelLabel}. Reminder notifications for this channel are active.`
    );
  }
}

module.exports = HandleDndCommandAsync;
