const { ResolveModelAliasAsync } = require('../command-intent-resolver');

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
    // GH-168: resolve vendor/family aliases at the executor (see model-switch-command.js).
    const Alias = await ResolveModelAliasAsync(ArgRequestedModel);
    const ModelId = Alias.ModelId;
    const Provenance = Alias.Note ? ` (resolved from '${ArgRequestedModel}')` : '';
    const Validation = await ArgWorkspaceAI.GetModelAvailabilityAsync(ModelId);
    if(!Validation.ok) {
      const Message = Validation.reason === 'provider-not-configured'
        ? Validation.error
        : Validation.reason === 'catalog-unavailable'
          ? `Couldn't verify '${ModelId}' right now: ${Validation.error}`
          : Alias.Note
            ? `'${ArgRequestedModel}' → '${ModelId}' is not in this workspace's ${Validation.providerLabel} catalog — the alias pin is stale. Channel model is unchanged.`
            : `'${ArgRequestedModel}' not found. Channel model is unchanged.`;
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        Message
      );
      return;
    }

    await ArgChannelModelSettings.SetModelForChannelAsync(ArgEventInfo.channel, ModelId);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Channel <#${ArgEventInfo.channel}> will now use \`${ModelId}\` for AI chat replies${Provenance}.`
    );
    ArgSlackApp.Logger.info(
      `set-channel-model by <@${ArgEventInfo.user}> in <#${ArgEventInfo.channel}>: '${ModelId}'`
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
