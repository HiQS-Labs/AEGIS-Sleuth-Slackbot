/**
 * Handle the `models` command — posts the current AI model configuration for this channel
 * (override + effective + workspace default), the complex/date-extraction model, and the count
 * of saved channel overrides in this workspace.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {(ArgChannelID: string) => { lines: string[] }} ArgBuildChannelModelStatus
 *   ChatModule helper that returns the per-channel model status block.
 * @param {import('../channel-model-settings')} ArgChannelModelSettings Per-channel override store
 *   (used to count saved overrides).
 * @param {import('../reminders-module')|null} ArgRemindersModule Reminders module — its
 *   WorkspaceAI owns the complex/date-extraction model name. Null/undefined when the workspace
 *   is configured without reminders.
 * @param {{ mode: string, model: string, armed: boolean, confidenceMin: number }} [ArgRouterInfo]
 *   GH-397 first-responder (router) state: the current mode, the effective router model, whether the
 *   router is actually armed for this workspace, and the active-mode confidence floor. Omitted when
 *   the caller has no router module (older call sites / tests) — the router rows are then skipped.
 * @returns {Promise<void>}
 */
async function HandleModelsCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgBuildChannelModelStatus,
  ArgChannelModelSettings,
  ArgRemindersModule,
  ArgRouterInfo
) {
  const ChannelModelStatus = ArgBuildChannelModelStatus(ArgEventInfo.channel);
  const ComplexModel = ArgRemindersModule?.WorkspaceAI?.ComplexModelName || 'not available';
  const OverrideCount = Object.keys(ArgChannelModelSettings.ListAll()).length;

  // GH-397: describe the first-responder (router) tier. `armed` is mode≠off AND this workspace is
  // allowed to arm — so `shadow`/`active` while unarmed reads as idle (won't actually run).
  const RouterRows = ArgRouterInfo
    ? [
      `System router mode: \`${ArgRouterInfo.mode}\`${
        ArgRouterInfo.mode !== 'off' && !ArgRouterInfo.armed ? ' _(idle — not armed for this workspace)_' : ''
      }`,
      `System router model (first responder): \`${ArgRouterInfo.model}\``,
    ]
    : [];

  const Response = [
    '*Current Model Configuration*',
    `Channel: <#${ArgEventInfo.channel}>`,
    ...ChannelModelStatus.lines,
    `Complex/date extraction model: \`${ComplexModel}\``,
    ...RouterRows,
    `Saved channel overrides in this workspace: ${OverrideCount}`,
    '',
    '*Switch Models*',
    'To switch the default (basic) model: `@Sleuth AI switch-models:\'gpt-4o-mini\'`',
    'To switch the complex model: `@Sleuth AI switch-models:complex=\'gpt-4o\'`',
    'To switch both: `@Sleuth AI switch-models:default=\'gpt-4o-mini\',complex=\'gpt-4o\'`',
    '',
    '*System Router (first responder)*',
    'Set the router mode (admins only): `@Sleuth AI router-mode shadow` (or `active` / `off`).',
    'The router model is set server-side via the `ROUTER_SHADOW_MODEL` env (default `gemini-3.1-flash-lite`); the startup mode is seeded by `ROUTER_SHADOW_DEFAULT_MODE`.',
    '',
    '*Per-channel Overrides*',
    'To override the model for this channel: `@Sleuth AI set-channel-model:\'gpt-4o\'`',
    'To remove this channel’s override: `@Sleuth AI clear-channel-model`',
    'To inspect this channel’s effective model: `@Sleuth AI show-channel-model`',
    '',
    '*Common OpenAI Models*: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo`, `gpt-5-mini`, `gpt-5`, `gpt-5.5`',
    '*Common Anthropic Claude Models* (require `ANTHROPIC_API_KEY` on the workspace): `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`',
    '*Common Google Gemini Models* (require `GEMINI_API_KEY` on the workspace): `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`',
    '_Note: GPT-5-family models can be noticeably slower than `gpt-4o-mini` for threaded chats. Switching to a `claude-*` or `gemini-*` model requires the workspace to have the respective API key configured._'
  ].join('\n');

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Response);
}

module.exports = HandleModelsCommandAsync;
