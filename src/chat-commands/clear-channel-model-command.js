/**
 * Handle the `clear-channel-model` admin command — removes the per-channel model override so
 * the channel falls back to the workspace default. Workspace admins/owners only.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {import('../channel-model-settings')} ArgChannelModelSettings Per-channel override store.
 * @param {import('../workspace-ai')} ArgWorkspaceAI Workspace-scoped AI instance (used only to
 *   read the workspace default model name for the confirmation message).
 * @returns {Promise<void>}
 */
async function HandleClearChannelModelCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgChannelModelSettings,
  ArgWorkspaceAI
) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can clear the channel model.'
    );
    return;
  }

  try {
    const PreviousModel = ArgChannelModelSettings.GetModelForChannel(ArgEventInfo.channel);
    if(!PreviousModel) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `No channel model override is set for <#${ArgEventInfo.channel}>; chat is already using the workspace default \`${ArgWorkspaceAI.DefaultModelName}\`.`
      );
      return;
    }

    await ArgChannelModelSettings.ClearModelForChannelAsync(ArgEventInfo.channel);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Cleared channel model override for <#${ArgEventInfo.channel}>. Chat will now use the workspace default \`${ArgWorkspaceAI.DefaultModelName}\`.`
    );
    ArgSlackApp.Logger.info(
      `clear-channel-model by <@${ArgEventInfo.user}> in <#${ArgEventInfo.channel}>: was '${PreviousModel}'`
    );
  } catch(error) {
    ArgSlackApp.Logger.error('Error in OnClearChannelModelCommandAsync:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Failed to clear channel model: ${error.message}`
    );
  }
}

module.exports = HandleClearChannelModelCommandAsync;
