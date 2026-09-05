const { ResolveModelAliasAsync } = require('../command-intent-resolver');

/**
 * Handle the `switch-models` admin command — runtime change of the default and/or complex
 * (date-extraction) model. Validates each requested model against the live provider
 * catalog before applying. Posts a per-attempt result line and an admin-visible log entry.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string|null} ArgRequestedDefaultModel The default model name requested by the user
 *   (or null when the command did not include a default).
 * @param {string|null} ArgRequestedComplexModel The complex model name requested by the user
 *   (or null when the command did not include a complex).
 * @param {import('../workspace-ai')} ArgWorkspaceAI Workspace-scoped AI instance — its
 *   DefaultModelName is updated in place when the new default validates.
 * @param {import('../reminders-module')|null} ArgRemindersModule Reminders module — its
 *   WorkspaceAI carries the complex model name and a parallel default copy that must stay in
 *   sync with the chat default.
 * @param {() => void} ArgInvalidateSystemInstructionsTemplate Clears chat-module's cached
 *   system-instructions template so it gets regenerated with the new default model name on
 *   next use.
 * @param {(ArgWorkspaceInfo: import('../workspaces').WorkspaceInfo) => Promise<void>} ArgPersistWorkspaceInfoAsync
 *   Persists the (mutated) WorkspaceInfo back to the workspace JSON so the change survives
 *   service restarts. Passed in by the caller (production binding goes through
 *   `Workspaces.SaveWorkspaceInfoAsync`); injected by tests.
 * @returns {Promise<void>}
 */
async function HandleModelSwitchCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgRequestedDefaultModel,
  ArgRequestedComplexModel,
  ArgWorkspaceAI,
  ArgRemindersModule,
  ArgInvalidateSystemInstructionsTemplate,
  ArgPersistWorkspaceInfoAsync
) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can switch models.'
    );
    return;
  }

  const CurrentDefaultModel = ArgWorkspaceAI.DefaultModelName;
  const CurrentComplexModel = ArgRemindersModule?.WorkspaceAI?.ComplexModelName || 'gpt-4o';
  const Results = [];
  const Changes = [];

  try {
    if(ArgRequestedDefaultModel) {
      // GH-168: resolve vendor/family aliases ("ChatGPT", "sonnet") to a pinned ID here, at the
      // executor, so every entry path (direct, rmm ifl, router-active) resolves once and the reply
      // can say what it resolved from. An exact ID passes through untouched.
      const DefaultAlias = await ResolveModelAliasAsync(ArgRequestedDefaultModel);
      const DefaultModelId = DefaultAlias.ModelId;
      const DefaultProvenance = DefaultAlias.Note ? ` (resolved from '${ArgRequestedDefaultModel}')` : '';
      const Validation = await ArgWorkspaceAI.GetModelAvailabilityAsync(DefaultModelId);

      if(!Validation.ok) {
        if(Validation.reason === 'provider-not-configured')
          Results.push(Validation.error);
        else if(Validation.reason === 'catalog-unavailable')
          Results.push(`Couldn't verify '${DefaultModelId}' right now: ${Validation.error}`);
        else if(DefaultAlias.Note)
          Results.push(`'${ArgRequestedDefaultModel}' → '${DefaultModelId}' is not in this workspace's ${Validation.providerLabel} catalog — the alias pin is stale. Default still using '${CurrentDefaultModel}'`);
        else
          Results.push(`'${ArgRequestedDefaultModel}' not found. Default still using '${CurrentDefaultModel}'`);
      } else {
        ArgWorkspaceAI.DefaultModelName = DefaultModelId;

        if(ArgRemindersModule?.WorkspaceAI) {
          ArgRemindersModule.WorkspaceAI.DefaultModelName = DefaultModelId;
        }

        // mutate the shared WorkspaceInfo so the next persist+restart picks up the new default.
        ArgWorkspaceAI.WorkspaceInfo.DEFAULT_MODEL_NAME = DefaultModelId;

        ArgInvalidateSystemInstructionsTemplate();

        Results.push(`Default model switched to '${DefaultModelId}'${DefaultProvenance}`);
        Changes.push(`default: '${CurrentDefaultModel}' → '${DefaultModelId}'`);
      }
    }

    if(ArgRequestedComplexModel) {
      const ComplexAlias = await ResolveModelAliasAsync(ArgRequestedComplexModel);
      const ComplexModelId = ComplexAlias.ModelId;
      const ComplexProvenance = ComplexAlias.Note ? ` (resolved from '${ArgRequestedComplexModel}')` : '';
      const Validation = await ArgWorkspaceAI.GetModelAvailabilityAsync(ComplexModelId);

      if(!Validation.ok) {
        if(Validation.reason === 'provider-not-configured')
          Results.push(Validation.error);
        else if(Validation.reason === 'catalog-unavailable')
          Results.push(`Couldn't verify '${ComplexModelId}' right now: ${Validation.error}`);
        else if(ComplexAlias.Note)
          Results.push(`'${ArgRequestedComplexModel}' → '${ComplexModelId}' is not in this workspace's ${Validation.providerLabel} catalog — the alias pin is stale. Complex still using '${CurrentComplexModel}'`);
        else
          Results.push(`'${ArgRequestedComplexModel}' not found. Complex still using '${CurrentComplexModel}'`);
      } else {
        if(ArgRemindersModule?.WorkspaceAI) {
          ArgRemindersModule.WorkspaceAI.ComplexModelName = ComplexModelId;
          ArgWorkspaceAI.WorkspaceInfo.COMPLEX_MODEL_NAME = ComplexModelId;
          Results.push(`Complex model switched to '${ComplexModelId}'${ComplexProvenance}`);
          Changes.push(`complex: '${CurrentComplexModel}' → '${ComplexModelId}'`);
        } else {
          Results.push(`Cannot update complex model: reminders module not available`);
        }
      }
    }

    // persist the mutated WorkspaceInfo before reporting success. if persist throws we land in
    // the outer catch and the user sees a "Failed to switch model" message instead of a misleading
    // success — the in-memory state is still applied for the running session, but the user knows
    // it won't survive a restart.
    if(Changes.length > 0) {
      await ArgPersistWorkspaceInfoAsync(ArgWorkspaceAI.WorkspaceInfo);
    }

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      Results.join('\n')
    );

    if(Changes.length > 0) {
      ArgSlackApp.Logger.info(`Model switch by <@${ArgEventInfo.user}>: ${Changes.join(', ')}`);
    }
  } catch(error) {
    ArgSlackApp.Logger.error('Error in OnModelSwitchCommandAsync:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Failed to switch model: ${error.message}`
    );
  }
}

module.exports = HandleModelSwitchCommandAsync;
