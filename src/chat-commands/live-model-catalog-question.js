const MaxLiveModelCatalogEntries = 120;

/**
 * Handle a natural-language question about currently available AI chat models. Fetches the
 * live provider catalogs from WorkspaceAI, narrows them to chat-shaped IDs, and asks the
 * model to answer the user's question grounded in that list (so we never guess from
 * training data).
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgQuestionText User question after removing the app mention.
 * @param {import('../workspace-ai')} ArgWorkspaceAI Workspace-scoped AI instance — used to
 *   fetch the live catalog.
 * @param {import('../channel-model-settings')} ArgChannelModelSettings Per-channel override
 *   store; consulted to resolve which model should answer the grounded question.
 * @param {(ArgModelIds: string[]) => string[]} ArgFilterLiveModelCatalogForChat Static helper
 *   from ChatModule that narrows the raw model list to chat-shaped IDs.
 * @param {() => Promise<string>} ArgPrepareSystemInstructionsAsync Builds the chat system
 *   instructions template (cached on chat-module).
 * @param {(SlackApp: import('../slack-app'), MessageText: string, SystemInstructions: string, ChannelID: string, ChannelModel: string|null) => Promise<string>} ArgProcessChatWithChannelModelAsync
 *   Chat-module's per-channel chat dispatch helper.
 * @param {(ArgText: string) => string} ArgFormatMessageForSlack Chat-module's Slack-output
 *   normalizer (markdown → mrkdwn).
 * @returns {Promise<void>}
 */
async function HandleLiveModelCatalogQuestionAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgQuestionText,
  ArgWorkspaceAI,
  ArgChannelModelSettings,
  ArgFilterLiveModelCatalogForChat,
  ArgPrepareSystemInstructionsAsync,
  ArgProcessChatWithChannelModelAsync,
  ArgFormatMessageForSlack
) {
  try {
    // pull models from every configured provider (OpenAI + Anthropic when API keys are
    // set) so a question like "what claude models can I use?" can be answered without
    // routing through the default provider only.
    const CatalogStatuses = await ArgWorkspaceAI.GetAvailableModelCatalogStatusByProviderAsync();
    const FailedProviders = Object.values(CatalogStatuses).filter((ArgStatus) => ArgStatus.configured && !ArgStatus.ok);
    if(FailedProviders.length > 0) {
      const FailedLabels = FailedProviders.map((ArgStatus) => {
        return `${ArgStatus.label}${ArgStatus.error ? ` (${ArgStatus.error})` : ''}`;
      }).join(', ');
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `I couldn't fetch the live model catalog from ${FailedLabels}, so I won't guess from memory. Try again in a minute.`
      );
      return;
    }

    /** @type {Array<{providerId: string, modelIds: string[]}>} */
    const ProviderSections = [];
    for(const [ProviderId, CatalogStatus] of Object.entries(CatalogStatuses)) {
      if(!CatalogStatus.configured || !CatalogStatus.ok) continue;
      const Filtered = ArgFilterLiveModelCatalogForChat(CatalogStatus.modelIds).slice(0, MaxLiveModelCatalogEntries);
      if(Filtered.length > 0) ProviderSections.push({ providerId: ProviderId, modelIds: Filtered });
    }

    if(ProviderSections.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "I couldn't find any model IDs in the live model lists for this workspace."
      );
      return;
    }

    const BaseSystemInstructions = await ArgPrepareSystemInstructionsAsync();
    const GroundedSystemInstructions = [
      BaseSystemInstructions,
      '',
      'For this response, answer naturally using the live model catalog provided by the application.',
      'Do not rely on memory for current OpenAI, ChatGPT, Claude, or Gemini model availability.',
      'Explain that the list reflects models available to this workspace API keys (OpenAI, Anthropic, and/or Gemini) and may differ from each vendor\'s app picker.',
      'Keep the answer concise and group related model families when helpful.',
    ].join('\n');
    const ProviderLines = ProviderSections.flatMap((Section) => [
      '',
      `Live ${Section.providerId} model IDs available to this workspace API key:`,
      ...Section.modelIds.map((ArgModelId) => `- ${ArgModelId}`),
    ]);
    const GroundedQuestion = [
      `User question: ${ArgQuestionText}`,
      ...ProviderLines,
    ].join('\n');
    const ChannelModel = ArgChannelModelSettings.GetModelForChannel(ArgEventInfo.channel);
    const ResponseText = await ArgProcessChatWithChannelModelAsync(
      ArgSlackApp,
      GroundedQuestion,
      GroundedSystemInstructions,
      ArgEventInfo.channel,
      ChannelModel
    );
    const FormattedResponseText = ArgFormatMessageForSlack(ResponseText);

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FormattedResponseText);
  } catch(error) {
    ArgSlackApp.Logger.error('failed to answer live model catalog question:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "I couldn't fetch the live model lists, so I won't guess from memory. Try again in a minute."
    );
  }
}

module.exports = HandleLiveModelCatalogQuestionAsync;
