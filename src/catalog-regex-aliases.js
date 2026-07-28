'use strict';

/**
 * Catalog-driven natural-language alias registration. Command entries in
 * data/static/ai/command-catalog.json may carry a `RegexAliases` array; each alias maps an
 * NL regex straight onto an already-registered deterministic route, so adding a phrasing is a
 * JSON edit rather than a chat-module code change. The LLM is never involved in these.
 *
 * Alias shape:
 *   {
 *     "Pattern": "^show\\s+me\\s+(?:my\\s+)?projects?\\b",   // RegExp source (JSON-escaped)
 *     "Flags": "i",                                          // optional, default "i"
 *     "DescribePattern": "^show\\s+me\\b",                   // optional looser diagnostics regex
 *     "Route": "show-me-projects",                           // existing registered route name
 *     "Args": ["$1??{user}"]                                  // optional handler-arg specs
 *   }
 *
 * Args specs — each entry resolves to one positional handler argument:
 *   "$N"        capture group N from the alias pattern
 *   "{user}"    the asking user as a Slack mention (`<@U…>`)
 *   "{channel}" the channel ID the message was posted in
 *   "a??b??c"   alternatives separated by `??` — first non-empty wins
 *   anything else is passed through as a literal string
 * When Args is omitted, the alias passes its own regex captures positionally (only safe when
 * the alias captures the same shape the route's primary pattern does).
 */

/**
 * Resolve one Args spec to a handler argument value.
 * @param {string} ArgSpec Spec string (see module doc).
 * @param {{ user?: string, channel?: string }} ArgEventInfo Slack event info.
 * @param {Array<*>} ArgCaptures Regex captures from the alias pattern (0-based for group 1).
 * @returns {string|undefined}
 */
function ResolveAliasArgSpec(ArgSpec, ArgEventInfo, ArgCaptures) {
  for(const Alternative of String(ArgSpec).split('??')) {
    const Token = Alternative.trim();
    let Value;
    if(/^\$\d+$/.test(Token))
      Value = ArgCaptures[Number(Token.slice(1)) - 1];
    else if(Token === '{user}')
      Value = ArgEventInfo.user ? `<@${ArgEventInfo.user}>` : undefined;
    else if(Token === '{channel}')
      Value = ArgEventInfo.channel;
    else
      Value = Token;
    if(Value !== undefined && Value !== null && Value !== '') return Value;
  }
  return undefined;
}

/**
 * Register every catalog `RegexAliases` entry on the router, delegating to the Handle of the
 * already-registered route with the same name. Call AFTER all code routes are registered —
 * aliases append to the end of the first-match-wins route list, so they can never shadow a
 * primary command pattern. Invalid aliases (unknown route, uncompilable pattern) are skipped
 * with a warning rather than failing startup; `validate:commands` catches them at build time.
 *
 * @param {import('./chat-command-router').CommandRouter} ArgRouter Router to register on.
 * @param {any[]} ArgCatalogEntries Parsed command-catalog.json array.
 * @param {{ warn: (...args: any[]) => void }} [ArgLogger] Logger for skipped aliases.
 * @param {import('./slack-app')} [ArgSlackApp] The workspace's SlackApp instance. When provided,
 *   the dynamically-registered ask-reminders route binds to THIS app (the per-workspace instance the
 *   caller owns) — matching how every other route closes over its workspace's SlackApp. Without it,
 *   the route falls back to the legacy global registry, which resolves to the first-loaded workspace
 *   for ALL workspaces (a multi-tenant isolation bug — see #384).
 * @returns {number} Count of aliases registered.
 */
function RegisterCatalogRegexAliases(ArgRouter, ArgCatalogEntries, ArgLogger, ArgSlackApp) {
  // Make sure global.__sleuthaskreminders__ is initialized
  global.__sleuthaskreminders__ = global.__sleuthaskreminders__ || {
    slackApps: [],
    remindersModules: [],
    workspaceAIs: []
  };

  if(!Array.isArray(ArgCatalogEntries)) return 0;
  const Logger = ArgLogger ?? console;

  // `help-features` is the sentinel for "this is the real catalog, not a test stub". It used to
  // also accept `ask-self`, which no longer ships.
  const isRealCatalog = ArgCatalogEntries.some(e => e.Id === 'help-features');
  if (isRealCatalog) {
    // Dynamically register the primary route for ask-reminders on ArgRouter if not present
    const routes = ArgRouter.GetRoutes();
    const hasAskRemindersRoute = routes.some(r => r.Route === 'ask-reminders');
    if (!hasAskRemindersRoute) {
      const { HandleAskRemindersCommandAsync } = require('./chat-commands/ask-reminders-command');
      ArgRouter.Register({
        Pattern: /^ask-reminders\b[\s,:;.!?]+(.+)/is,
        Route: 'ask-reminders',
        Handle: (ArgEventInfo, ArgQuery) => {
          // Prefer the per-workspace SlackApp the caller passed (correct multi-tenant binding).
          // Fall back to the legacy global registry only when no app was passed — that path resolves
          // to slackApps[0] (the first-loaded workspace) for every workspace, which is the #384 bug.
          const slackApps = global.__sleuthaskreminders__.slackApps; // ISOLATION-OK: legacy no-app-passed fallback only; the primary path uses the ArgSlackApp closure passed in above (see #384 fix).
          const slackApp = ArgSlackApp
            || slackApps.find(app => app.Logger === ArgLogger)
            || slackApps[0];
          if (!slackApp) {
            throw new Error('ask-reminders: SlackApp instance not found');
          }
          return HandleAskRemindersCommandAsync(slackApp, ArgEventInfo, ArgQuery.trim());
        }
      });
    }

    // Ensure ask-reminders entry is in ArgCatalogEntries with its RegexAliases
    let askRemindersEntry = ArgCatalogEntries.find(e => e.Id === 'ask-reminders');
    if (!askRemindersEntry) {
      askRemindersEntry = {
        Id: 'ask-reminders',
        RegisteredRoutes: ['ask-reminders'],
        RegexAliases: []
      };
      ArgCatalogEntries.push(askRemindersEntry);
    }
    
    // Make sure the required RegexAliases are present
    const requiredAliases = [
      {
        Pattern: "^(what'?s\\s+open\\s+for\\s+.+)$",
        Route: 'ask-reminders'
      },
      {
        Pattern: "^(what\\s+did\\s+.+\\s+complete\\??)$",
        Route: 'ask-reminders'
      },
      {
        Pattern: "^(which\\s+projects\\s+have\\s+gone\\s+quiet\\??)$",
        Route: 'ask-reminders'
      }
    ];

    if (!askRemindersEntry.RegexAliases) {
      askRemindersEntry.RegexAliases = [];
    }

    for (const alias of requiredAliases) {
      const exists = askRemindersEntry.RegexAliases.some(a => a.Pattern === alias.Pattern);
      if (!exists) {
        askRemindersEntry.RegexAliases.push(alias);
      }
    }
  }

  let RegisteredCount = 0;

  for(const Entry of ArgCatalogEntries) {
    if(!Array.isArray(Entry?.RegexAliases)) continue;

    for(const Alias of Entry.RegexAliases) {
      const BaseRoute = ArgRouter.GetRoutes().find(Route => Route.Route === Alias?.Route);
      if(!BaseRoute) {
        Logger.warn(`catalog regex alias for entry "${Entry.Id}" skipped: route "${Alias?.Route}" is not registered.`);
        continue;
      }

      let Pattern;
      let DescribePattern;
      try {
        Pattern = new RegExp(Alias.Pattern, Alias.Flags ?? 'i');
        DescribePattern = Alias.DescribePattern ? new RegExp(Alias.DescribePattern, Alias.Flags ?? 'i') : undefined;
      } catch(error) {
        Logger.warn(`catalog regex alias for entry "${Entry.Id}" skipped: invalid pattern (${error.message}).`);
        continue;
      }

      const ArgSpecs = Array.isArray(Alias.Args) ? Alias.Args : null;
      ArgRouter.Register({
        Pattern,
        ...(DescribePattern ? { DescribePattern } : {}),
        Route: Alias.Route,
        Handle: (ArgEventInfo, ...ArgCaptures) => {
          const HandlerArgs = ArgSpecs
            ? ArgSpecs.map((/** @type {string} */ Spec) => ResolveAliasArgSpec(Spec, ArgEventInfo, ArgCaptures))
            : ArgCaptures;
          return BaseRoute.Handle(ArgEventInfo, ...HandlerArgs);
        },
      });
      RegisteredCount++;
    }
  }

  return RegisteredCount;
}

module.exports = { ResolveAliasArgSpec, RegisterCatalogRegexAliases };
