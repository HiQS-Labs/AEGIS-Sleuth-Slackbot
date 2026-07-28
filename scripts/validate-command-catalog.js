'use strict';

const fs = require('fs');
const path = require('path');
const ChatModule = require('../src/chat-module');
const RemindersAppMentionHandler = require('../src/reminders-app-mention-handler');
const {
  CommandCatalogPath,
  LoadCommandCatalogSync,
  ValidateCommandCatalogShape,
  BuildHelpMarkdownFromCatalog,
  BuildRegisteredRouteMap,
} = require('../src/command-catalog');
const { BuildCanonicalCommandIntentIds } = require('../src/command-intent-resolver');

const HelpFilePath = path.join(__dirname, '..', 'data', 'static', 'HELP.md');
const DeterministicResponsesPath = path.join(__dirname, '..', 'data', 'static', 'deterministic-responses.json');

/**
 * @returns {import('../src/chat-module')}
 */
function BuildValidationChatModule() {
  const SlackAppStub = {
    WorkspaceInfo: {
      WORKSPACE_NAME: 'catalog-validation',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'test-secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'test-reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    },
    AppMentionString: '@Sleuth AI',
    HandleAppMention() {},
    HandleMessage() {},
    HandleAction() {},
  };

  const EmptyWorkspaceStats = {
    IncomingMessageCount: 0,
    IncomingMessageLength: 0,
    OutgoingMessageCount: 0,
    OutgoingMessageLength: 0,
    OutgoingGptMessageCount: 0,
    OutgoingGptMessageLength: 0,
    IncomingGptMessageCount: 0,
    IncomingGptMessageLength: 0,
  };

  return new ChatModule(SlackAppStub, EmptyWorkspaceStats, null, null, null);
}

/**
 * @returns {import('../src/reminders-app-mention-handler')}
 */
function BuildValidationRemindersHandler() {
  return new RemindersAppMentionHandler({
    GetPendingReminders: () => [],
    GetRemindersTargetingUserID: () => [],
    GetRemindersInvolvingUserID: () => [],
    GetGitHubSyncModule: () => null,
    GetListsModule: () => null,
    GetChannelSettings: () => null,
    TryScheduleRemindersAsync: async () => false,
    CheckRemindersAsync: async () => {},
    GetClientMappings: () => [],
  });
}

function main() {
  const Catalog = LoadCommandCatalogSync();
  ValidateCommandCatalogShape(Catalog);

  const RouteMap = BuildRegisteredRouteMap(Catalog);
  const Chat = BuildValidationChatModule();
  const Reminders = BuildValidationRemindersHandler();
  const RegisteredRoutes = [
    ...Chat.GetRegisteredCommandRoutes().map(ArgRoute => ArgRoute.Route),
    ...Reminders.GetRegisteredCommandRoutes().map(ArgRoute => ArgRoute.Route),
  ];
  const UniqueRegisteredRoutes = [...new Set(RegisteredRoutes)];

  const MissingCatalogRoutes = UniqueRegisteredRoutes.filter(ArgRoute => !RouteMap.has(ArgRoute));
  if(MissingCatalogRoutes.length > 0) {
    throw new Error(
      `registered command routes missing from ${path.relative(process.cwd(), CommandCatalogPath)}: ${MissingCatalogRoutes.join(', ')}`
    );
  }

  const StaleCatalogRoutes = [...RouteMap.keys()].filter(ArgRoute => !UniqueRegisteredRoutes.includes(ArgRoute));
  if(StaleCatalogRoutes.length > 0) {
    throw new Error(
      `catalog RegisteredRoutes entries missing from the command registries: ${StaleCatalogRoutes.join(', ')}`
    );
  }

  // Cross-check: every catalog entry with CanExecuteWithIfl:true must have a BuildCanonicalCommand
  // case, otherwise RMM can identify the intent but cannot build a runnable command.
  const MissingCanonicalCoverage = Catalog
    .filter(ArgEntry => ArgEntry.CanExecuteWithIfl && !BuildCanonicalCommandIntentIds.has(ArgEntry.Id));
  if(MissingCanonicalCoverage.length > 0) {
    throw new Error(
      `catalog entries with CanExecuteWithIfl:true are missing BuildCanonicalCommand coverage: ${MissingCanonicalCoverage.map(ArgEntry => ArgEntry.Id).join(', ')} — add a case to BuildCanonicalCommand and BuildCanonicalCommandIntentIds in src/command-intent-resolver.js`
    );
  }

  // Cross-check: every DirectCommandPatterns entry must reference a known BuildCanonicalCommand
  // intent ID, otherwise the normalization step would silently produce a null command.
  const NormConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'static', 'ai', 'command-normalization.json'), 'utf8'));
  const UnknownDirectPatternIntents = (NormConfig.DirectCommandPatterns || [])
    .filter(ArgEntry => !BuildCanonicalCommandIntentIds.has(ArgEntry.IntentId))
    .map(ArgEntry => ArgEntry.IntentId);
  if(UnknownDirectPatternIntents.length > 0) {
    throw new Error(
      `DirectCommandPatterns reference intent IDs with no BuildCanonicalCommand case: ${[...new Set(UnknownDirectPatternIntents)].join(', ')}`
    );
  }

  // Cross-check: RegexAliases only attach to the ChatModule router (RegisterCatalogRegexAliases is
  // only called there). An alias targeting a route that exists only in RemindersAppMentionHandler
  // would pass shape validation but be silently skipped at startup.
  const ChatRouteSet = new Set(Chat.GetRegisteredCommandRoutes().map(ArgRoute => ArgRoute.Route));
  const RemindersOnlyRoutes = new Set(
    Reminders.GetRegisteredCommandRoutes()
      .map(ArgRoute => ArgRoute.Route)
      .filter(ArgRoute => !ChatRouteSet.has(ArgRoute))
  );
  for(const Entry of Catalog) {
    for(const Alias of Entry.RegexAliases || []) {
      if(RemindersOnlyRoutes.has(Alias.Route)) {
        throw new Error(
          `catalog entry "${Entry.Id}" has a RegexAlias targeting route "${Alias.Route}" which is only registered in RemindersAppMentionHandler — RegexAliases only attach to the ChatModule router and this alias will never fire. Move the alias to code or register the route in ChatModule.`
        );
      }
    }
  }

  // Cross-check: no deterministic-response phrase (after stripping the app mention prefix) should
  // also appear as a catalog Alias or match a catalog RegexAlias — the router runs before the
  // deterministic handler, so a matching alias would silently hijack the deterministic response.
  const DeterministicConfig = JSON.parse(fs.readFileSync(DeterministicResponsesPath, 'utf8'));
  const CatalogAliasSet = new Set(
    Catalog.flatMap(ArgEntry => ArgEntry.Aliases || []).map(ArgAlias => ArgAlias.toLowerCase().trim())
  );
  const CatalogRegexAliasPatterns = Catalog.flatMap(ArgEntry =>
    (ArgEntry.RegexAliases || []).map(ArgAlias => {
      try {
        return { re: new RegExp(ArgAlias.Pattern, ArgAlias.Flags || 'i'), id: ArgEntry.Id };
      } catch(_) {
        return null;
      }
    })
  ).filter(Boolean);
  const MentionPrefixPattern = /^<@[^>]+>\s*/i;
  for(const Entry of DeterministicConfig.entries || []) {
    for(const Phrase of Entry.phrases || []) {
      const Stripped = Phrase.replace(MentionPrefixPattern, '').toLowerCase().trim();
      if(CatalogAliasSet.has(Stripped)) {
        throw new Error(
          `phrase "${Stripped}" is declared in both deterministic-responses.json and a catalog Aliases array — remove it from one source.`
        );
      }
      const RegexMatch = CatalogRegexAliasPatterns.find(ArgSpec => ArgSpec.re.test(Stripped));
      if(RegexMatch) {
        throw new Error(
          `phrase "${Stripped}" from deterministic-responses.json matches catalog RegexAlias in entry "${RegexMatch.id}" — the alias would hijack this phrase before the deterministic handler runs. Narrow the regex or remove the deterministic phrase.`
        );
      }
    }
  }

  const ExpectedHelpText = BuildHelpMarkdownFromCatalog(Catalog);
  const CurrentHelpText = fs.readFileSync(HelpFilePath, 'utf8');
  if(CurrentHelpText !== ExpectedHelpText) {
    throw new Error(
      `generated help output is out of date. Run: node ${path.relative(process.cwd(), path.join(__dirname, 'generate-help.js'))}`
    );
  }

  process.stdout.write('command catalog validation passed.\n');
}

main();
