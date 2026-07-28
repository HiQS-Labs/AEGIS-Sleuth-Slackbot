'use strict';

const { RouterShadowModule } = require('../router-shadow-module');

/**
 * Handle the `router-mode` admin command — set (or report) the GH-397 command-router mode for this
 * workspace: `off`, `shadow`, or `active`. Admin/owner only. The mode is in-memory per workspace;
 * on restart/redeploy it resets to the `ROUTER_SHADOW_DEFAULT_MODE` env value (default `off`) — set
 * that env to make e.g. production `shadow` sticky across deploys without re-issuing this command.
 *
 * - `@Sleuth AI router-mode`         → report the current mode + usage.
 * - `@Sleuth AI router-mode shadow`  → Flash Lite shadows the resolver, logs a corpus, zero authority.
 * - `@Sleuth AI router-mode active`  → Flash Lite takes over resolution above the confidence floor.
 * - `@Sleuth AI router-mode off`     → disable.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string|null} ArgMode Requested mode, or null to just report the current mode.
 * @param {{ GetRouterMode: () => string, SetRouterMode: (ArgMode: string) => string }} ArgDeps
 *   Injected accessors bound to the per-workspace RouterShadowModule instance.
 * @returns {Promise<void>}
 */
async function HandleRouterModeCommandAsync(ArgSlackApp, ArgEventInfo, ArgMode, ArgDeps) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can change the router mode.'
    );
    return;
  }

  const Current = ArgDeps.GetRouterMode();
  const Requested = typeof ArgMode === 'string' ? ArgMode.trim().toLowerCase() : '';

  if(!Requested) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Router mode is currently *${Current}*. Usage: \`router-mode <off | shadow | active>\`.`
    );
    return;
  }

  if(!RouterShadowModule.IsValidMode(Requested)) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Unknown router mode \`${Requested}\`. Valid modes: ${RouterShadowModule.ValidModes.join(', ')}. Currently *${Current}*.`
    );
    return;
  }

  ArgDeps.SetRouterMode(Requested);

  const Descriptions = {
    off: 'the Flash Lite router experiment is disabled — the normal command resolver is in full control.',
    shadow: 'Flash Lite now *shadows* the resolver — every mention is logged to the router corpus with zero authority. Production behavior is unchanged.',
    active: ':warning: Flash Lite is now the *active* router (full takeover) — above the confidence floor it will execute whatever it resolves, including Risk-tagged commands. In-memory only: resets to `off` on restart.',
  };
  const Note = Descriptions[/** @type {'off'|'shadow'|'active'} */ (Requested)] || '';

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    `Router mode set to *${Requested}* (was *${Current}*). ${Note}`
  );

  ArgSlackApp.Logger.info('router-mode changed:', {
    workspace: ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME ?? null,
    by: ArgEventInfo.user ?? null,
    from: Current,
    to: Requested,
  });
}

module.exports = { HandleRouterModeCommandAsync };
