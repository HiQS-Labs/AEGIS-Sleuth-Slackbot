/**
 * Handle the `set-channel-model:'<model>'` admin command — overrides the chat model for the
 * current channel. Validates the requested model against the live provider catalog before
 * persisting.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgRequestedModel Model name requested by the user.
 * @param {import('../workspace-ai')} ArgWorkspaceAI Workspace-scoped AI instance — used to
 *   validate the requested model against the live provider catalog.
 * @param {import('../channel-model-settings')} ArgChannelModelSettings Per-channel override
 *   store; receives the persisted override.
 * @returns {Promise<void>}
 */
async function HandleSetChannelModelCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgRequestedModel,
  ArgWorkspaceAI,
  ArgChannelModelSettings
) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can change the channel model.'
    );
    return;
  }

  try {
    const Validation = await ArgWorkspaceAI.GetModelAvailabilityAsync(ArgRequestedModel);
    if(!Validation.ok) {
      const Message = Validation.reason === 'provider-not-configured'
        ? Validation.error
        : Validation.reason === 'catalog-unavailable'
          ? `Couldn't verify '${ArgRequestedModel}' right now: ${Validation.error}`
          : `'${ArgRequestedModel}' not found. Channel model is unchanged.`;
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        Message
      );
      return;
    }

    await ArgChannelModelSettings.SetModelForChannelAsync(ArgEventInfo.channel, ArgRequestedModel);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Channel <#${ArgEventInfo.channel}> will now use \`${ArgRequestedModel}\` for AI chat replies.`
    );
    ArgSlackApp.Logger.info(
      `set-channel-model by <@${ArgEventInfo.user}> in <#${ArgEventInfo.channel}>: '${ArgRequestedModel}'`
    );
  } catch(error) {
    ArgSlackApp.Logger.error('Error in OnSetChannelModelCommandAsync:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Failed to set channel model: ${error.message}`
    );
  }
}

module.exports = HandleSetChannelModelCommandAsync;
