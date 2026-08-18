
// import required modules.
const fs = require('fs').promises;
const path = require('path');
const { WriteFileDurableAsync } = require('./durable-write');
const SlackApp = require('./slack-app');
const WorkspaceAI = require('./workspace-ai');
const Workspaces = require('./workspaces');
const ChannelModelSettings = require('./channel-model-settings');
const SlackFormatUtils = require('./slack-format-utils');
const { ResolveMentionsForExternalDisplayAsync } = require('./slack-message-pipeline');
const {
  WebSearchProviders,
  BuildProviderMatcherRegex,
  GetWebSearchProviderById,
  FormatProviderCommandsListLine,
} = require('./web-search-providers');
const { CommandRouter } = require('./chat-command-router');
const { RegisterCatalogRegexAliases } = require('./catalog-regex-aliases');
const { CommandCatalogPath } = require('./command-catalog');
const { BuildErrorReportAsync } = require('./diagnostics-report');
const {
  SelectContextMemoryFile,
  IsBinaryMediaFile,
  LooksLikeHtmlErrorPage,
  SelectImageAttachment,
  ResolveAttachmentIntent,
} = require('./context-file-classifier');
const HandleRestartCommandAsync = require('./chat-commands/restart-command');
const HandleVersionCommandAsync = require('./chat-commands/version-command');
const HandleWebSearchAdvancedCommandAsync = require('./chat-commands/web-search-advanced-command');
const HandleRunDailyDigestCommandAsync = require('./chat-commands/run-daily-digest-command');
const HandleClearChannelModelCommandAsync = require('./chat-commands/clear-channel-model-command');
const HandleShowChannelModelCommandAsync = require('./chat-commands/show-channel-model-command');
const HandleAskCodeCommandAsync = require('./chat-commands/ask-code-command');

// OPTIONAL private plugin seam. `src/rag/` is planned as `sleuth-plugin-rag` (PROJECT/2-WORKING/
// P1-SPLIT.md:130) and is deliberately absent from the public repo, so this require MUST NOT be
// allowed to fail the process. When the overlay is missing, ask-self simply does not exist; when it
// is installed, the command and its triage path light up with no further wiring.
//
// This guard exists because the feature has already been lost once: a deploy that replaced the tree
// with a copy lacking `src/rag/` silently dropped ask-self, and nothing announced it. An absent
// overlay is now a supported state rather than an accident.
/** @type {{ HandleAskSelfCommandAsync: Function, PostAskSelfTriageAsync: Function }|null} */
let RagChatIntegration = null;
try {
  // @ts-ignore — resolved at runtime only. The overlay is absent from the public tree by design, so
  // static resolution MUST NOT be a build error; `tsc` correctly reports TS2307 without this, which
  // would make the public repo unbuildable for a feature it deliberately does not ship.
  RagChatIntegration = require('./rag/chat-integration');
} catch(error) {
  // MODULE_NOT_FOUND is the expected public-repo case. Anything else means the overlay IS present
  // but broken, which an operator needs to see rather than have swallowed as "not installed".
  if(!error || error.code !== 'MODULE_NOT_FOUND') {
    console.warn('[chat-module] RAG overlay present but failed to load:', error && error.message);
  }
}
const HandleAskWooCommandAsync = require('./chat-commands/ask-woo-command');
const HandleWebSearchProviderCommandAsync = require('./chat-commands/web-search-provider-command');
const HandleHelpFeaturesCommandAsync = require('./chat-commands/help-features-command');
const HandleViewStratalistCommandAsync = require('./chat-commands/view-stratalist-command');
const HandleScanImageCommandAsync = require('./chat-commands/scan-image-command');
const HandleConvertToListCommandAsync = require('./chat-commands/convert-to-list-command');
const HandleChangelogCommandAsync = require('./chat-commands/changelog-command');
const HandleCommandsListAsync = require('./chat-commands/commands-list-command');
const HandleRunDiagnosticsCommandAsync = require('./chat-commands/run-diagnostics-command');
const HandleShowRebalanceRemindersCommandAsync = require('./chat-commands/show-rebalance-reminders-command');
const HandleRunTestsCommandAsync = require('./chat-commands/run-tests-command');
const HandleCodeTaskCommandAsync = require('./chat-commands/code-task-command');
const HandleModelsCommandAsync = require('./chat-commands/models-command');
const HandleLiveModelCatalogQuestionAsync = require('./chat-commands/live-model-catalog-question');
const HandleModelSwitchCommandAsync = require('./chat-commands/model-switch-command');
const HandleSetChannelModelCommandAsync = require('./chat-commands/set-channel-model-command');
const { HandleRouterModeCommandAsync } = require('./chat-commands/router-mode-command');
const { RouterShadowModule } = require('./router-shadow-module');
const { createRouterShadowStore } = require('./router-shadow-store');
const { IsTruthyFlag } = require('./startup-message');
const { OPEN_REMINDER_STATES } = require('./workspace-snapshot');
const { AssembleCandidates } = require('./reminder-candidates');
const { FilterCandidates, ResolveTimeWindow } = require('./reminder-query-engine');
const {
  BuildPrivateChannelSetAsync,
  BuildMemberPrivateChannelSetAsync,
} = require('./chat-commands/ask-reminders-command');
const { LoadClientMappingsSync, ResolveClientsFromQuery } = require('./client-mapping');
const HandleRmmCommandAsync = require('./chat-commands/rmm-command');
const HandleShowMeCommandAsync = require('./chat-commands/show-me-command');
const HandleShowMeProjectsCommandAsync = require('./chat-commands/show-me-projects-command');
const HandleRefreshClientsCommandAsync = require('./chat-commands/refresh-clients-command');
const HandleRecallCommandAsync = require('./chat-commands/recall-command');
const { FileGithubIssueAsync } = require('./github-issue-filer');
const {
  NormalizeDirectCommandTextAsync,
  ResolveRmmIntentAsync,
  RetrieveScoredCandidates,
} = require('./command-intent-resolver');

const MaxJestFailureLines = 3;
const MaxWebSearchSources = 5;

// Provisional score floor pending Phase 0 counter data.
const NEAR_MISS_SCORE_FLOOR = 5;

/**
 * Configuration for deterministic responses.
 * @typedef {Object} DeterministicResponseConfig
 * @property {'static-text'|'reminders-for-user'} type Type of deterministic response to execute.
 * @property {string} [text] Static text to post when the response type is "static-text".
 * @property {string} [userMention] Slack user mention string used for reminders commands.
 * @property {boolean} [limitToCurrentChannel] Limit reminder queries to the current channel when true.
 */

/**
 * Deterministic response map entry.
 * @typedef {Object} DeterministicResponseEntry
 * @property {DeterministicResponseConfig} config Parsed configuration for the deterministic response.
 */

/**
 * Provides a ChatGPT experience within a Slack workspace.
 */
class ChatModule {
  /**
   * Regex matching `ask-code <slug> <query>` (after bot mention is stripped).
   * Captures everything after the separator as one group; the handler splits on
   * first whitespace to extract slug and query.
   * @type {RegExp}
   */
  static AskCodeCommandRegex = /^ask-code\b[\s,:;.!?]+(.+)/is;

  /**
   * `ask-self <query>`. Kept in the public core even though its handler is an optional overlay:
   * the pattern is not proprietary, and keeping it here means the router and the reaction path
   * agree on what counts as an ask-self message whether or not the overlay is installed.
   * @type {RegExp}
   */
  static AskSelfCommandRegex = /^ask-self\b[\s,:;.!?]+(.+)/is;

  /**
   * Slack app instance.
   * @type {SlackApp}
   */
  #SlackApp;

  /**
   * Workspace AI instance.
   * @type {WorkspaceAI}
   */
  #WorkspaceAI;

  /**
   * Per-channel model override store.
   * @type {ChannelModelSettings}
   */
  #ChannelModelSettings;

  /**
   * Reminders module reference.
   * @type {import('./reminders-module')}
   */
  #RemindersModule;

  /**
   * Stats module reference.
   * @type {import('./stats-module')}
   */
  #StatsModule;

  /**
   * Notion module reference.
   * @type {import('./notion-module')}
   */
  #NotionModule;

  /**
   * Lists module reference, injected directly at construction (GH-75). Nullable — the Slack Lists
   * integration is optional per workspace, and `#MaterializeListFromItemsAsync` degrades to a
   * plain-text items summary when it is absent.
   * @type {import('./lists-module')|null}
   */
  #ListsModule = null;

  /**
   * Chat system instructions template.
   * @type {string}
   */
  #SystemInstructionsTemplate;

  /**
   * Deterministic response configuration indexed by normalized phrase.
   * @type {Map<string, DeterministicResponseEntry>|null}
   */
  #DeterministicResponsesByPhrase = null;

  /**
   * Active background Jest run promise for this workspace, or null when idle.
   * @type {Promise<void>|null}
   */
  #ActiveJestRunPromise = null;

  /**
   * In-memory store of uploaded MD file context keyed by "channelID:threadTS".
   * @type {Map<string, {filename: string, content: string}>}
   */
  #ThreadContextMemory = new Map();

  /**
   * GH-397 per-workspace router mode (off/shadow/active) + Flash Lite shadow corpus. In-memory
   * (resets to `off` on restart), stored on this instance — never a global — so it stays per
   * workspace per the #387 isolation guard.
   * @type {RouterShadowModule}
   */
  #RouterShadow;

  /**
   * Registry of recognized chat commands. Populated by #RegisterCommandRoutes during
   * construction. Both #OnAppMentionAsync (dispatch) and #DescribeChatRoute (diagnostics)
   * read from this single source of truth.
   * @type {CommandRouter}
   */
  #CommandRouter;

  /**
   * Extract concise Jest summary details from raw process output.
   * @param {string} ArgOutputText Combined stdout/stderr text.
   * @returns {{ TestSuitesLine: string|null, TestsLine: string|null, TimeLine: string|null, TopFailures: string[] }}
   */
  static ExtractJestOutputSummary(ArgOutputText) {
    const Lines = (ArgOutputText || '').split(/\r?\n/);
    let TestSuitesLine = null;
    let TestsLine = null;
    let TimeLine = null;
    /** @type {string[]} */
    const TopFailures = [];

    for(const CurrentLine of Lines) {
      const TrimmedLine = CurrentLine.trim();
      if(!TrimmedLine) continue;

      if(!TestSuitesLine && /^Test Suites:/i.test(TrimmedLine))
        TestSuitesLine = TrimmedLine.replace(/\s+/g, ' ');

      if(!TestsLine && /^Tests:/i.test(TrimmedLine))
        TestsLine = TrimmedLine.replace(/\s+/g, ' ');

      if(!TimeLine && /^Time:/i.test(TrimmedLine))
        TimeLine = TrimmedLine.replace(/\s+/g, ' ');

      if(/^●\s+/.test(TrimmedLine)) {
        const FailureText = TrimmedLine.replace(/^●\s+/, '').trim();
        if(FailureText && !TopFailures.includes(FailureText))
          TopFailures.push(FailureText);
      }
    }

    return { TestSuitesLine, TestsLine, TimeLine, TopFailures };
  }

  /**
   * Format duration in human-readable minutes and seconds.
   * @param {number} ArgDurationMs Duration in milliseconds.
   * @returns {string}
   */
  static FormatDuration(ArgDurationMs) {
    const TotalSeconds = Math.max(0, Math.round(ArgDurationMs / 1000));
    const Minutes = Math.floor(TotalSeconds / 60);
    const Seconds = TotalSeconds % 60;

    if(Minutes <= 0) return `${Seconds}s`;

    return `${Minutes}m ${Seconds}s`;
  }

  /**
   * Build Slack-safe summary text for a completed Jest run.
   * @param {number|null} ArgExitCode Exit code from the Jest process.
   * @param {number} ArgDurationMs Run duration in milliseconds.
   * @param {string} ArgStdoutText Captured stdout text.
   * @param {string} ArgStderrText Captured stderr text.
   * @param {boolean} ArgTimedOut Whether the process timed out and was stopped.
   * @returns {string}
   */
  static BuildJestResultMessage(ArgExitCode, ArgDurationMs, ArgStdoutText, ArgStderrText, ArgTimedOut) {
    const CombinedOutputText = [ArgStdoutText || '', ArgStderrText || ''].filter(Boolean).join('\n');
    const Summary = ChatModule.ExtractJestOutputSummary(CombinedOutputText);
    /** @type {string[]} */
    const Lines = [];

    if(ArgTimedOut) Lines.push(`Jest suite timed out after ${ChatModule.FormatDuration(ArgDurationMs)} and was stopped.`);
    else if(ArgExitCode === 0) Lines.push('Jest suite passed.');
    else Lines.push('Jest suite failed.');

    if(ArgExitCode !== null) Lines.push(`Exit code: ${ArgExitCode}.`);

    Lines.push(`Duration: ${ChatModule.FormatDuration(ArgDurationMs)}.`);

    if(Summary.TestSuitesLine) Lines.push(Summary.TestSuitesLine);
    if(Summary.TestsLine) Lines.push(Summary.TestsLine);
    if(!ArgTimedOut && Summary.TimeLine) Lines.push(Summary.TimeLine);

    if((ArgTimedOut || ArgExitCode !== 0) && Summary.TopFailures.length > 0) {
      Lines.push('Top failures:');
      for(const FailureText of Summary.TopFailures.slice(0, MaxJestFailureLines))
        Lines.push(`- ${FailureText}`);
    }

    return Lines.join('\n');
  }

  /**
   * Initialize a new instance of the ChatModule with the given Slack app and workspace stats.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./stats-module').WorkspaceStats} ArgWorkspaceStats Stats for the workspace.
   * @param {import("./reminders-module")} ArgRemindersModule
   * @param {import("./stats-module")} ArgStatsModule
   * @param {import("./notion-module")} ArgNotionModule
   * @param {import("./lists-module")|null} [ArgListsModule] Lists module for OCR list
   *   materialization, injected directly rather than reached through RemindersModule (GH-75).
   *   Nullable: the Slack Lists integration is optional per workspace.
   */
  constructor(ArgSlackApp, ArgWorkspaceStats, ArgRemindersModule, ArgStatsModule, ArgNotionModule, ArgListsModule = null) {
    // save the Slack app instance.
    this.#SlackApp = ArgSlackApp;

    // module references for diagnostics.
    this.#RemindersModule = ArgRemindersModule;
    this.#StatsModule = ArgStatsModule;
    this.#NotionModule = ArgNotionModule;
    this.#ListsModule = ArgListsModule;

    // initialize the WorkspaceAI instance using the workspace info and stats.
    this.#WorkspaceAI = new WorkspaceAI(this.#SlackApp.WorkspaceInfo, ArgWorkspaceStats);

    // initialize the per-channel model override store. Disk load is deferred to StartAsync so
    // construction stays synchronous and matches the pattern used by other modules.
    const WorkspaceName = this.#SlackApp.WorkspaceInfo.WORKSPACE_NAME;
    const ChannelModelsFilePath = Workspaces.GetSubdirPath(
      'workspaces',
      `${WorkspaceName}_channel_models.json`
    );
    this.#ChannelModelSettings = new ChannelModelSettings(this.#SlackApp, ChannelModelsFilePath);

    // GH-397 router mode (off/shadow/active). Non-authoritative corpus lives OUTSIDE
    // data/runtime/events/ (that dir is the P3 authoritative ledger). Default mode is `off`.
    const RouterShadowStore = createRouterShadowStore({
      rootDir: Workspaces.GetSubdirPath('shadow'),
    });
    this.#RouterShadow = new RouterShadowModule({
      WorkspaceName,
      Logger: this.#SlackApp.Logger,
      Store: RouterShadowStore,
      // GH-405 (lane p1): the ROUTER closure — and ONLY this one — opt-passes the cached workspace
      // snapshot into the resolver when ROUTER_SNAPSHOT_ENABLED is on. The rmm / rmm ifl / help closures
      // deliberately keep the plain signature so they stay snapshot-free (byte-identical context).
      ResolveIntentAsync: (ArgText, ArgOptions) =>
        ResolveRmmIntentAsync(this.#WorkspaceAI, ArgText, this.#WithRouterSnapshotOptions(ArgOptions)),
    });

    // build the command router after all dependencies are in place — handler closures reach
    // back into the same `this` to invoke the existing private command implementations.
    this.#CommandRouter = new CommandRouter();
    this.#RegisterCommandRoutes();

    // add handlers for app_mention and message events.
    this.#SlackApp.HandleAppMention(this.#OnAppMentionAsync.bind(this));
    this.#SlackApp.HandleMessage(this.#OnMessageAsync.bind(this));

    // handle clicks on the "Search the web" suggestion button attached to freeform chat answers.
    this.#SlackApp.HandleAction(
      ChatModule.ChatGoogleSearchActionId, this.#OnChatGoogleSearchActionAsync.bind(this)
    );
  }

  /**
   * Register every recognized chat command on #CommandRouter. Adding a new command means
   * appending one entry here (and supplying its handler) — the dispatcher and DescribeRoute
   * then pick it up automatically. Order matters: more specific patterns must register before
   * broader ones (e.g. web-search-advanced before any web-search* alias).
   *
   * BEFORE adding a new Router.Register entry here, ask: does the target route already exist?
   * If yes, add the phrasing to data/static/ai/command-catalog.json (Aliases, IntentPhrases,
   * or RegexAliases) rather than hardcoding it here. Catalog-only changes are registered
   * automatically by #RegisterCatalogRegexAliasesAsync and remain visible to rmm, help
   * generation, and validate:commands. New Router.Register entries are only needed for
   * entirely new commands (new route, new handler) or patterns requiring runtime function logic.
   * See AGENTS.md §14 "Adding Command Aliases or NL Phrasings" and ARCHITECTURE.md
   * § "Command Catalog, Help, and RMM Intent Resolution".
   */
  #RegisterCommandRoutes() {
    const Router = this.#CommandRouter;

    Router.Register({
      Pattern: /^(help|features)\b[\s,:;.!?]+(.+)/is,
      DescribePattern: /^(help|features)\b/i,
      Route: 'help/features guidance',
      Handle: (ArgEventInfo, _ArgCommandWord, ArgQueryText) => HandleHelpFeaturesCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        {
          QueryText: ArgQueryText.trim(),
          ResolveIntentAsync: (ArgText, ArgOptions) => ResolveRmmIntentAsync(this.#WorkspaceAI, ArgText, ArgOptions),
          BuildChannelModelStatus: (ArgChannelID) => this.#BuildChannelModelStatus(ArgChannelID),
        }
      ),
    });

    Router.Register({
      Pattern: /^(help|features)$/i,
      Route: 'help/features',
      Handle: (ArgEventInfo) => HandleHelpFeaturesCommandAsync(this.#SlackApp, ArgEventInfo),
    });

    Router.Register({
      Pattern: /^view\s+stratalist\b[\s,:;.!?]+(.+)/is,
      DescribePattern: /^view\s+stratalist(?:\b|[\s,:;.!?])/i,
      Route: 'view stratalist',
      Handle: (ArgEventInfo, ArgReferenceText) =>
        HandleViewStratalistCommandAsync(this.#SlackApp, ArgEventInfo, ArgReferenceText.trim()),
    });

    Router.Register({
      Pattern: /^refresh\s+clients\b/i,
      Route: 'refresh clients',
      Handle: (ArgEventInfo) => HandleRefreshClientsCommandAsync(this.#SlackApp, ArgEventInfo),
    });

    // GH-64: explicit OCR / list-conversion commands. These dispatch into the same extraction and
    // materialization seams the natural-language route uses — deliberately NOT a third pipeline.
    Router.Register({
      Pattern: /^(?:scan|ocr)\s+(?:the\s+)?image(?:\s+for\s+text)?\b/i,
      DescribePattern: /^(?:scan|ocr)\s+(?:the\s+)?image/i,
      Route: 'scan image for text',
      Handle: (ArgEventInfo) => HandleScanImageCommandAsync(this.#SlackApp, ArgEventInfo, {
        ExtractTextFromImageAsync: (ArgSlackApp, ArgEvent) =>
          this.#ExtractListItemsFromImageAsync(ArgSlackApp, ArgEvent, 'Extract all text from this image.'),
      }),
    });

    // GH-74: explicit image→List counterpart to the natural-language attachment route. Same
    // extraction + materialization seams as the unified attachment dispatch — not a third
    // pipeline. Reachable when the request is worded as a command but no image is attached, in
    // which case the extractor posts its own "did not find an image attachment" guidance.
    Router.Register({
      Pattern: /^(?:make|create|build|generate)\s+(?:a\s+|an\s+)?(?:[a-z-]+\s+)?(?:list|checklist)\s+(?:from|of|out\s+of)\s+(?:the\s+|this\s+|that\s+)?(?:attached\s+)?image\b/i,
      DescribePattern: /^(?:make|create|build|generate)\s+(?:a\s+|an\s+)?(?:[a-z-]+\s+)?(?:list|checklist)\s+(?:from|of|out\s+of)\s+.*image/i,
      Route: 'make list from image',
      // Router routes return void; the journey helper's boolean is a handler-chain signal the
      // router does not consume, so it is awaited and discarded here.
      Handle: async (ArgEventInfo) => {
        await this.#TryProcessImageForListCreationAsync(
          this.#SlackApp,
          ArgEventInfo,
          'Extract all list items from this image.'
        );
      },
    });

    Router.Register({
      Pattern: /^convert\s+(?:the\s+)?text\s+into\s+(?:a\s+)?slack\s+list\b[\s,:;.!?]*(.*)/is,
      DescribePattern: /^convert\s+(?:the\s+)?text\s+into\s+(?:a\s+)?slack\s+list/i,
      Route: 'convert text into slack list',
      Handle: (ArgEventInfo, ArgSourceText) => HandleConvertToListCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgSourceText,
        {
          ExtractItemsFromTextAsync: (ArgText) => this.#ExtractItemsFromTextAsync(ArgText),
          MaterializeListAsync: (ArgSlackApp, ArgEvent, ArgTitle, ArgItems) =>
            this.#MaterializeListFromItemsAsync(ArgSlackApp, ArgEvent, ArgTitle, ArgItems),
        }
      ),
    });

    Router.Register({
      Pattern: /^changelog\b/i,
      Route: 'changelog',
      Handle: (ArgEventInfo) => HandleChangelogCommandAsync(this.#SlackApp, ArgEventInfo, {
        WorkspaceAI: this.#WorkspaceAI,
      }),
    });

    Router.Register({
      Pattern: /^rmm\s+ifl\b[\s,:;.!?]+(.+)/is,
      DescribePattern: /^rmm\s+ifl\b/i,
      Route: 'rmm ifl',
      Handle: (ArgEventInfo, ArgRequestText) => HandleRmmCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgRequestText.trim(),
        true,
        {
          ResolveIntentAsync: (ArgText, ArgOptions) => ResolveRmmIntentAsync(this.#WorkspaceAI, ArgText, ArgOptions),
          ExecuteCanonicalCommandAsync: (ArgCanonicalCommand) => this.#CommandRouter.RouteAsync(ArgCanonicalCommand, ArgEventInfo),
          BuildChannelModelStatus: (ArgChannelID) => this.#BuildChannelModelStatus(ArgChannelID),
        }
      ),
    });

    Router.Register({
      Pattern: /^rmm\b[\s,:;.!?]+(.+)/is,
      DescribePattern: /^rmm\b/i,
      Route: 'rmm',
      Handle: (ArgEventInfo, ArgRequestText) => HandleRmmCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgRequestText.trim(),
        false,
        {
          ResolveIntentAsync: (ArgText, ArgOptions) => ResolveRmmIntentAsync(this.#WorkspaceAI, ArgText, ArgOptions),
          ExecuteCanonicalCommandAsync: (ArgCanonicalCommand) => this.#CommandRouter.RouteAsync(ArgCanonicalCommand, ArgEventInfo),
          BuildChannelModelStatus: (ArgChannelID) => this.#BuildChannelModelStatus(ArgChannelID),
        }
      ),
    });

    Router.Register({
      Pattern: /^commands\b/i,
      Route: 'commands',
      Handle: (ArgEventInfo) => HandleCommandsListAsync(this.#SlackApp, ArgEventInfo),
    });

    // GH-397: admin-only toggle for the Gemini Flash Lite router experiment (off/shadow/active).
    Router.Register({
      Pattern: /^router-mode(?:\s+(off|shadow|active))?\s*$/i,
      DescribePattern: /^router-mode\b/i,
      Route: 'router-mode',
      Handle: (ArgEventInfo, ArgMode) => HandleRouterModeCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgMode ? ArgMode.trim() : null,
        {
          GetRouterMode: () => this.#RouterShadow.GetMode(),
          SetRouterMode: (ArgRequestedMode) => this.#RouterShadow.SetMode(ArgRequestedMode),
        }
      ),
    });

    Router.Register({
      Pattern: /^run-diagnostics\b/i,
      Route: 'run-diagnostics',
      Handle: (ArgEventInfo) => HandleRunDiagnosticsCommandAsync(this.#SlackApp, ArgEventInfo, {
        WorkspaceAI: this.#WorkspaceAI,
        StatsModule: this.#StatsModule,
        RemindersModule: this.#RemindersModule,
        NotionModule: this.#NotionModule,
      }),
    });

    // registered BEFORE the plain route: `\b` treats the hyphen as a word boundary, so the
    // broader pattern below would otherwise swallow the `-formatted` variant (first match wins).
    Router.Register({
      Pattern: /^show-rebalance-reminders-formatted\b/i,
      Route: 'show-rebalance-reminders-formatted',
      Handle: (ArgEventInfo) =>
        HandleShowRebalanceRemindersCommandAsync(this.#SlackApp, ArgEventInfo, { Formatted: true }),
    });

    Router.Register({
      Pattern: /^show-rebalance-reminders\b/i,
      Route: 'show-rebalance-reminders',
      Handle: (ArgEventInfo) => HandleShowRebalanceRemindersCommandAsync(this.#SlackApp, ArgEventInfo),
    });

    Router.Register({
      Pattern: /^recall\b[\s,:;.!?]+(.+)/is,
      DescribePattern: /^recall\b/i,
      Route: 'recall',
      Handle: (ArgEventInfo, ArgQuery) =>
        HandleRecallCommandAsync(this.#SlackApp, ArgEventInfo, ArgQuery.trim()),
    });

    Router.Register({
      Pattern: ChatModule.AskCodeCommandRegex,
      Route: 'ask-code',
      Handle: (ArgEventInfo, ArgQuery) =>
        HandleAskCodeCommandAsync(this.#SlackApp, ArgEventInfo, ArgQuery.trim()),
    });

    // Registered only when the private RAG overlay is installed, so the public build does not
    // advertise a command that cannot answer. The handler itself is tenancy-gated on
    // NEOCHROME_TEAM_ID and fail-closed, so this is the outer of two independent gates.
    if(RagChatIntegration) {
      Router.Register({
        Pattern: ChatModule.AskSelfCommandRegex,
        Route: 'ask-self',
        Handle: (ArgEventInfo, ArgQuery) =>
          RagChatIntegration.HandleAskSelfCommandAsync(this.#SlackApp, ArgEventInfo, ArgQuery.trim()),
      });
    }

    Router.Register({
      Pattern: /^ask-woo(?:\s+(.+))?$/is,
      DescribePattern: /^ask-woo(?:\s|$)/i,
      Route: 'ask-woo',
      Handle: (ArgEventInfo, ArgQuery) =>
        HandleAskWooCommandAsync(this.#SlackApp, ArgEventInfo, (ArgQuery || '').trim()),
    });

    Router.Register({
      Pattern: /^web-search-advanced(?:\s|$)/i,
      Route: 'web-search-advanced',
      Handle: (ArgEventInfo) => HandleWebSearchAdvancedCommandAsync(this.#SlackApp, ArgEventInfo),
    });

    // web-search providers (web-search, gemini-search and their aliases). One route per registered
    // provider so DescribeRoute returns the specific provider id ('web-search', 'gemini-search')
    // instead of a generic name. Adding a new provider in src/web-search-providers.js auto-extends
    // both dispatch and route classification — no edit here.
    for(const Provider of WebSearchProviders) {
      Router.Register({
        Pattern: BuildProviderMatcherRegex(Provider),
        Route: Provider.Id,
        Handle: (ArgEventInfo, ArgQuery) => HandleWebSearchProviderCommandAsync(
          this.#SlackApp,
          ArgEventInfo,
          Provider,
          (ArgQuery || '').trim(),
          this.#WorkspaceAI,
          ChatModule.BuildWebSearchResponseText
        ),
      });
    }

    Router.Register({
      Pattern: /^version$/i,
      Route: 'version',
      Handle: (ArgEventInfo) => HandleVersionCommandAsync(this.#SlackApp, ArgEventInfo),
    });

    // NL phrasings ("what version", "show version") are catalog-driven RegexAliases on the
    // version entry — see #RegisterCatalogRegexAliasesAsync.

    Router.Register({
      Pattern: /^restart\b/i,
      Route: 'restart',
      Handle: (ArgEventInfo) => HandleRestartCommandAsync(this.#SlackApp, ArgEventInfo),
    });

    Router.Register({
      Pattern: /^run-tests\b/i,
      Route: 'run-tests',
      Handle: (ArgEventInfo) => HandleRunTestsCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        {
          IsActive: () => this.#ActiveJestRunPromise !== null,
          TrackRun: (ArgPromise) => {
            this.#ActiveJestRunPromise = ArgPromise.finally(() => { this.#ActiveJestRunPromise = null; });
          },
        },
        ChatModule.BuildJestResultMessage
      ),
    });

    Router.Register({
      Pattern: /^code-?task\b/i,
      Route: 'code-task',
      Handle: (ArgEventInfo) => HandleCodeTaskCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        { WorkspaceAI: this.#WorkspaceAI }
      ),
    });

    Router.Register({
      Pattern: /^show-me\s+(?:what\s+tasks?\s+)?(<@[UW][^>]+>)(?:\s+.*)?$/i,
      DescribePattern: /^show-me\b/i,
      Route: 'show-me',
      Handle: (ArgEventInfo, ArgRawMention) => HandleShowMeCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgRawMention,
        { WorkspaceAI: this.#WorkspaceAI, RemindersModule: this.#RemindersModule }
      ),
    });

    // NL phrasings for show-me ("what are my tasks?", "for-today", third-person variants) are
    // catalog-driven: see the `RegexAliases` array on the show-me entry in command-catalog.json,
    // registered by #RegisterCatalogRegexAliasesAsync during StartAsync.

    // ── show-me-projects family: group a user's open reminders into client + project buckets. ──
    // "show-me-projects @user" (third-person) or bare "show-me-projects" (self-referential).
    Router.Register({
      Pattern: /^show-me-projects(?:\s+(<@[UW][^>]+>))?/i,
      DescribePattern: /^show-me-projects\b/i,
      Route: 'show-me-projects',
      Handle: (ArgEventInfo, ArgMention) => HandleShowMeProjectsCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgMention || `<@${ArgEventInfo.user}>`,
        { WorkspaceAI: this.#WorkspaceAI, RemindersModule: this.#RemindersModule }
      ),
    });

    // NL phrasings for show-me-projects ("show me projects", "what are my projects", third-person
    // variants) are catalog-driven RegexAliases on the show-me-projects entry — see
    // #RegisterCatalogRegexAliasesAsync.

    Router.Register({
      Pattern: /^run\s+daily\s+digest\b/i,
      Route: 'run daily digest',
      Handle: (ArgEventInfo) => HandleRunDailyDigestCommandAsync(
        this.#SlackApp, ArgEventInfo, this.#RemindersModule
      ),
    });

    // Anchored to the start of the mention-stripped command so a message that merely
    // mentions `switch-models:'...'` in conversational prose can't be routed as a command.
    Router.Register({
      Pattern: (ArgStrippedText) => {
        const SimpleMatch = ArgStrippedText.match(/^(?:switch-models?|model-switch):'([^']+)'/i);
        if(SimpleMatch) return [SimpleMatch[1], null];
        const KeyValueMatch = ArgStrippedText.match(
          /^(?:switch-models?|model-switch):(?:default='([^']*)')?(?:,)?(?:complex='([^']*)')?/i
        );
        if(KeyValueMatch && (KeyValueMatch[1] || KeyValueMatch[2]))
          return [KeyValueMatch[1] || null, KeyValueMatch[2] || null];
        return null;
      },
      DescribePattern: /^(?:switch-models?|model-switch):/i,
      Route: 'switch-models',
      Handle: (ArgEventInfo, ArgDefaultModel, ArgComplexModel) => HandleModelSwitchCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgDefaultModel,
        ArgComplexModel,
        this.#WorkspaceAI,
        this.#RemindersModule,
        () => { this.#SystemInstructionsTemplate = null; },
        (ArgWorkspaceInfo) => Workspaces.SaveWorkspaceInfoAsync(ArgWorkspaceInfo)
      ),
    });

    Router.Register({
      Pattern: /^models$/i,
      Route: 'models',
      Handle: (ArgEventInfo) => HandleModelsCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        (ArgChannelID) => this.#BuildChannelModelStatus(ArgChannelID),
        this.#ChannelModelSettings,
        this.#RemindersModule,
        {
          mode: this.#RouterShadow.GetMode(),
          model: this.#RouterShadow.EffectiveModelName(),
          armed: this.#RouterShadow.IsArmed(),
          confidenceMin: this.#RouterShadow.ActiveConfidenceMin(),
        }
      ),
    });

    Router.Register({
      Pattern: (ArgStrippedText) =>
        ChatModule.IsLiveModelCatalogQuestion(ArgStrippedText) ? [ArgStrippedText] : null,
      Route: 'live-model-catalog-question',
      Handle: (ArgEventInfo, ArgQuestionText) => HandleLiveModelCatalogQuestionAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgQuestionText,
        this.#WorkspaceAI,
        this.#ChannelModelSettings,
        ChatModule.FilterLiveModelCatalogForChat,
        () => this.#PrepareSystemInstructionsAsync(),
        (SlackApp, MessageText, SystemInstructions, ChannelID, ChannelModel) =>
          this.#ProcessChatWithChannelModelAsync(SlackApp, MessageText, SystemInstructions, ChannelID, ChannelModel),
        (Text) => this.#FormatMessageForSlack(Text)
      ),
    });

    Router.Register({
      Pattern: /^set-channel-model:'([^']+)'$/i,
      DescribePattern: /^set-channel-model:/i,
      Route: 'set-channel-model',
      Handle: (ArgEventInfo, ArgModelName) => HandleSetChannelModelCommandAsync(
        this.#SlackApp,
        ArgEventInfo,
        ArgModelName,
        this.#WorkspaceAI,
        this.#ChannelModelSettings
      ),
    });

    Router.Register({
      Pattern: /^clear-channel-model$/i,
      Route: 'clear-channel-model',
      Handle: (ArgEventInfo) => HandleClearChannelModelCommandAsync(
        this.#SlackApp, ArgEventInfo, this.#ChannelModelSettings, this.#WorkspaceAI
      ),
    });

    Router.Register({
      Pattern: /^show-channel-model$/i,
      Route: 'show-channel-model',
      Handle: (ArgEventInfo) => HandleShowChannelModelCommandAsync(
        this.#SlackApp, ArgEventInfo, (ArgChannelID) => this.#BuildChannelModelStatus(ArgChannelID)
      ),
    });

    // NL model-identity phrasings ("what model are you running?", "which model is this channel
    // using?", etc.) are catalog-driven RegexAliases on the show-channel-model entry — see
    // #RegisterCatalogRegexAliasesAsync. ModelIdentityPattern is still exported for the
    // thread-reply intercept below (line ~1569), which is a justified code-only use.
  }

  /**
   * Load disk-backed state for the chat module (currently the per-channel model overrides).
   * Also registers the reaction handler used by the `:wrench:` chat triage feature.
   * Registered here (not in the constructor) so it lands in the SlackApp reaction-handler
   * chain BEFORE RemindersModule.StartAsync runs — that ordering lets the chat module
   * claim wrench reactions on chat messages and fall through to reminder triage for
   * everything else. Safe to call once during workspace startup.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    await this.#ChannelModelSettings.LoadAsync();
    await this.#LoadThreadMemoryAsync();
    await this.#RegisterCatalogRegexAliasesAsync();
    this.#SlackApp.HandleReactionAdded(this.#OnReactionAddedAsync.bind(this));
  }

  /**
   * Register natural-language regex aliases declared in command-catalog.json (`RegexAliases`
   * per entry) onto the command router. Runs after construction so every code-registered route
   * exists to delegate to; aliases append to the end of the first-match-wins list, so they can
   * never shadow a primary command pattern. A missing/corrupt catalog only disables aliases —
   * it never blocks startup.
   * @returns {Promise<void>}
   */
  async #RegisterCatalogRegexAliasesAsync() {
    try {
      const CatalogEntries = JSON.parse(await fs.readFile(CommandCatalogPath, 'utf8'));
      const Count = RegisterCatalogRegexAliases(this.#CommandRouter, CatalogEntries, this.#SlackApp.Logger, this.#SlackApp);
      this.#SlackApp.Logger.info(`registered ${Count} catalog regex aliases.`);
    } catch(error) {
      this.#SlackApp.Logger.warn(`catalog regex aliases not registered: ${error.message}`);
    }
  }

  /**
   * Persist thread context memory to disk on shutdown.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    if(this.#ThreadContextMemory.size > 0)
      await this.#SaveThreadMemoryAsync();
  }

  /**
   * Expose the WorkspaceAI instance.
   * @returns {WorkspaceAI}
   */
  get WorkspaceAI() {
    return this.#WorkspaceAI;
  }

  /**
   * Expose the registered command routes for validation tooling.
   * @returns {import('./chat-command-router').CommandRoute[]}
   */
  GetRegisteredCommandRoutes() {
    return this.#CommandRouter.GetRoutes();
  }

  /**
   * GH-405: is the workspace-snapshot router feature enabled? Default OFF; truthy is 'true'/'yes'
   * (case- and whitespace-insensitive) via the shared IsTruthyFlag helper. Read at inject/answer time
   * so flipping the env var takes effect without a restart. OFF ⇒ byte-identical behavior to before.
   * @returns {boolean}
   */
  #IsRouterSnapshotEnabled() {
    return IsTruthyFlag(process.env.ROUTER_SNAPSHOT_ENABLED);
  }

  /**
   * GH-405 (lane p1): opt-merge the cached workspace snapshot into a resolver ArgOptions object — but
   * ONLY for the router closure and ONLY when the gate is on. When the gate is off (or no reminders
   * module / snapshot is available) the original ArgOptions object is returned UNCHANGED (same
   * reference), so the resolver context stays byte-identical to today for every other caller.
   * @param {any} ArgOptions Resolver options from the router closure.
   * @returns {any}
   */
  #WithRouterSnapshotOptions(ArgOptions) {
    if(!this.#IsRouterSnapshotEnabled()) return ArgOptions;
    if(!this.#RemindersModule || typeof this.#RemindersModule.GetWorkspaceSnapshot !== 'function') return ArgOptions;
    const Snapshot = this.#RemindersModule.GetWorkspaceSnapshot();
    if(!Snapshot) return ArgOptions;
    return { ...(ArgOptions || {}), WorkspaceSnapshot: Snapshot };
  }

  /**
   * GH-405 (lane p2): detect an UNAMBIGUOUS "how many open for <client>" question and resolve the
   * single client it targets. Deterministic, no LLM. Returns null (→ caller falls through to the normal
   * resolver) on ANY ambiguity: not a count question, no open/pending word, a user mention present (an
   * assignee dimension), a time phrase present (a time-scoped count this all-time path can't answer), or
   * zero / more-than-one resolved client. The single-client requirement is what makes the answer safe to
   * emit without a model.
   * @param {string} ArgText Raw mention text (mention already stripped upstream).
   * @returns {{ clientId: string, clientName: string }|null}
   */
  #DetectOpenCountIntent(ArgText) {
    const Text = typeof ArgText === 'string' ? ArgText : '';
    if(!/\bhow\s+many\b/i.test(Text)) return null;
    if(!/\b(open|pending|outstanding|active|unfinished|remaining)\b/i.test(Text)) return null;
    // A Slack user mention means the question is about an assignee, not a pure client count — ambiguous.
    if(/<@[A-Z0-9]+>/i.test(Text)) return null;
    // First-person means an assignee-scoped question ("open tasks do I have"), not a pure client count.
    if(/\b(i|me|my|mine)\b/i.test(Text)) return null;

    const MatchedClients = ResolveClientsFromQuery(Text, LoadClientMappingsSync());
    if(MatchedClients.length !== 1) return null;
    const Client = MatchedClients[0];
    const ClientId = typeof Client.ClientID === 'string' && Client.ClientID.length > 0 ? Client.ClientID : null;
    const ClientName = typeof Client.ClientName === 'string' && Client.ClientName.length > 0 ? Client.ClientName : null;
    if(!ClientId || !ClientName) return null;

    // Time-scope check — a time phrase means a time-scoped count this live all-time path can't answer,
    // so bail. Strip the resolved client's name + aliases FIRST so a client name that happens to carry a
    // time word (e.g. "Green Day") does not false-trip the \bday\b branch. Then decline if the residual
    // resolves to a concrete window OR carries any broad relative-time word. tz is only for phrase
    // DETECTION here (not a precise window), so the workspace tz — else UTC — is sufficient.
    let Residual = Text.toLowerCase();
    const ClientTerms = [Client.ClientName, ...(Array.isArray(Client.Aliases) ? Client.Aliases : [])]
      .filter((/** @type {any} */ ArgTerm) => typeof ArgTerm === 'string' && ArgTerm.length > 0);
    for(const Term of ClientTerms) Residual = Residual.split(Term.toLowerCase()).join(' ');

    const Timezone = (this.#SlackApp && this.#SlackApp.WorkspaceInfo && this.#SlackApp.WorkspaceInfo.MAIN_TIMEZONE) || 'UTC';
    if(ResolveTimeWindow(Residual, Date.now(), Timezone)) return null;
    if(/\b(today|yesterday|tomorrow|tonight|week|weeks|weekend|month|months|year|years|quarter|day|days|this|last|next|upcoming|recent|since|until|before|after|by|ago|soon|later|overdue)\b/i.test(Residual)) return null;

    return { clientId: ClientId, clientName: ClientName };
  }

  /**
   * GH-405 (lane p2): answer "how many open for <client>?" deterministically. The count is recomputed
   * LIVE from RemindersModule.GetAllReminders() at answer time (NEVER the cached snapshot, which may be
   * stale) — filtered to OPEN_REMINDER_STATES + the resolved clientId — and channel-privacy scoped the
   * same way ask-reminders does: private/DM candidates are excluded unless the asker is a confirmed
   * member (the command channel is always allowed). Returns false (fall through) when the intent is not
   * an unambiguous client count or no reminders module is wired.
   * @param {SlackApp} ArgSlackApp
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo
   * @param {string} ArgRawText Raw mention text.
   * @returns {Promise<boolean>} true only when a deterministic answer was posted.
   */
  async #TryDeterministicOpenCountAnswerAsync(ArgSlackApp, ArgEventInfo, ArgRawText) {
    const Intent = this.#DetectOpenCountIntent(ArgRawText);
    if(!Intent) return false;
    if(!this.#RemindersModule || typeof this.#RemindersModule.GetAllReminders !== 'function') return false;

    // LIVE authoritative reminders — the whole point of lane p2 is to never trust the cached snapshot.
    const ActiveReminders = this.#RemindersModule.GetAllReminders();
    const NowMs = Date.now();

    /** @type {Set<string|null>} */
    const CandidateChannels = new Set();
    for(const Reminder of ActiveReminders)
      CandidateChannels.add(Reminder.OriginalChannelID || Reminder.TargetChannelID || null);

    // Reuse the canonical fail-closed privacy/membership helpers (same ones ask-reminders uses) rather
    // than a divergent copy. `unresolved` are channels Slack couldn't classify right now.
    const { private: PrivateChannels, unresolved: UnresolvedChannels } =
      await BuildPrivateChannelSetAsync(ArgSlackApp, CandidateChannels, NowMs);

    // Correctness gate: an incomplete privacy view must NOT yield a confident exact count. A transient
    // Slack failure (unresolved channel) would otherwise silently undercount, so decline and fall
    // through to the normal resolver — post nothing.
    if(UnresolvedChannels.size > 0) return false;

    const MemberPrivateChannels = await BuildMemberPrivateChannelSetAsync(ArgSlackApp, ArgEventInfo.user, PrivateChannels, NowMs);
    const AllowedChannelIds = [ArgEventInfo.channel, ...MemberPrivateChannels];

    const Candidates = AssembleCandidates({
      activeReminders: ActiveReminders,
      isChannelPrivate: (/** @type {string|null} */ ArgChannelId) => PrivateChannels.has(ArgChannelId),
    });
    const Result = FilterCandidates(Candidates, {
      clientId: Intent.clientId,
      channelScope: { allowedChannelIds: AllowedChannelIds },
    });

    // Open-state gate — mirrors the snapshot's single source of truth. Only active reminders were
    // assembled (no completion history), but gating on OPEN_REMINDER_STATES keeps the definition aligned.
    const OpenCount = Result.matched.filter(
      (/** @type {any} */ ArgCandidate) => OPEN_REMINDER_STATES.has(String(ArgCandidate.state || '').trim().toLowerCase())
    ).length;

    const Noun = OpenCount === 1 ? 'open task' : 'open tasks';
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `${Intent.clientName} has *${OpenCount}* ${Noun}.`
    );
    ArgSlackApp.Logger.info(
      `router deterministic count: client=${Intent.clientId} open=${OpenCount} channel=${ArgEventInfo.channel}`
    );
    return true;
  }

  /**
   * GH-397 active router mode: let Gemini Flash Lite resolve the command and, above the confidence
   * floor, execute it (FULL takeover — any canonical command, including Risk-tagged ones, per the
   * operator decision). Always logs a corpus record. Returns true only when it actually executed a
   * command; otherwise false so the caller falls back to the normal resolver. Never throws — a
   * resolve/execute/log failure degrades to false (normal pipeline runs).
   * @param {SlackApp} ArgSlackApp
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo
   * @param {string} ArgRawText Original (un-normalized) mention text — the corpus signal.
   * @param {string} ArgNormalizedText Normalized command text used for routing/matching.
   * @returns {Promise<boolean>}
   */
  async #TryRouterActiveTakeoverAsync(ArgSlackApp, ArgEventInfo, ArgRawText, ArgNormalizedText) {
    const EventInfoAny = /** @type {any} */ (ArgEventInfo);
    if(EventInfoAny.bot_id || (EventInfoAny.user && EventInfoAny.user === ArgSlackApp.BotUserID))
      return false;

    // GH-405 (lane p2): before the model resolves anything, try a deterministic open-count answer.
    // Inert unless ROUTER_SNAPSHOT_ENABLED is on; fires ONLY on an unambiguous "how many open for
    // <resolved client>" question with a single confidently-resolved client. The count is recomputed
    // LIVE from GetAllReminders() (never the cached snapshot) and channel-privacy-scoped. Any ambiguity
    // falls through to the normal active-takeover resolution below — no guessing.
    if(this.#IsRouterSnapshotEnabled()) {
      try {
        if(await this.#TryDeterministicOpenCountAnswerAsync(ArgSlackApp, ArgEventInfo, ArgRawText))
          return true;
      } catch(Error) {
        ArgSlackApp.Logger.warn(
          `router deterministic count failed (non-fatal): ${Error && /** @type {Error} */ (Error).message ? /** @type {Error} */ (Error).message : Error}`
        );
      }
    }

    const IncumbentRoute = this.#CommandRouter.MatchRouteName(ArgNormalizedText, ArgEventInfo);
    const Candidate = await this.#RouterShadow.ResolveCandidateAsync(ArgRawText, ArgEventInfo.channel);

    let Executed = false;
    if(this.#RouterShadow.ShouldExecute(Candidate)) {
      try {
        Executed = await this.#CommandRouter.RouteAsync(/** @type {string} */ (Candidate.canonicalCommand), ArgEventInfo);
      } catch(Error) {
        ArgSlackApp.Logger.error(
          `router active execution failed for '${Candidate.canonicalCommand}': ${Error && /** @type {Error} */ (Error).message ? /** @type {Error} */ (Error).message : Error}`
        );
        Executed = false;
      }
    }

    this.#RouterShadow.AppendRecordAsync({
      mode: 'active',
      channelId: ArgEventInfo.channel,
      rawText: ArgRawText,
      routerOutcome: IncumbentRoute ? 'matched' : 'unmatched',
      matchedRoute: IncumbentRoute,
      candidate: Candidate,
      executed: Executed,
    }).catch((Error) => ArgSlackApp.Logger.warn(`router shadow log failed: ${Error && Error.message ? Error.message : Error}`));

    return Executed;
  }

  /**
   * Phase 0 near-miss probe: a best-effort, no-LLM measurement emitted when an app-mention matched no
   * command and is about to fall through to generic AI chat. Logs only the top deterministic candidate +
   * score (no raw message text) so unmatched mentions can later be bucketed into "wrong syntax for a real
   * command" (high score) vs genuine chat (~0) — the input that decides whether the AI recovery tier is
   * worth building. Temporary measurement scaffolding; remove once the dead-end rate is known. See
   * PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md (Phase 0).
   * @param {SlackApp} ArgSlackApp
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo
   * @param {string} ArgNormalizedText Mention-stripped, normalized command text (the scored signal).
   * @returns {Promise<void>}
   */
  async #EmitNearMissProbeAsync(ArgSlackApp, ArgEventInfo, ArgNormalizedText) {
    const ScoredCandidates = await RetrieveScoredCandidates(ArgNormalizedText);
    const TopCandidate = ScoredCandidates[0];
    const TopScore = TopCandidate ? TopCandidate.Score : 0;
    ArgSlackApp.Logger.info('near-miss probe (unmatched mention fell through to chat):', {
      workspace: ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME ?? null,
      channel: ArgEventInfo.channel ?? null,
      user: ArgEventInfo.user ?? null,
      topCandidateId: TopScore > 0 ? TopCandidate.Entry.Id : null,
      topScore: TopScore,
    });
  }

  /**
   * Deterministic near-miss command handler tier.
   * If the user message is a near-miss for a registered command (wrong syntax but matches command catalog
   * with high enough score), reply with that candidate's syntax example and return true.
   * @param {SlackApp} ArgSlackApp
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo
   * @param {string} ArgNormalizedText Mention-stripped, normalized command text (the scored signal).
   * @returns {Promise<boolean>}
   */
  async #TryHandleNearMissCommandAsync(ArgSlackApp, ArgEventInfo, ArgNormalizedText) {
    const EventInfoAny = /** @type {any} */ (ArgEventInfo);
    if(EventInfoAny.bot_id || (EventInfoAny.user && EventInfoAny.user === ArgSlackApp.BotUserID))
      return false;

    const RawFlag = (process.env.COMMAND_NEAR_MISS_LITE || '').trim().toLowerCase();
    const IsEnabled = RawFlag === 'on' || RawFlag === 'true' || RawFlag === '1' || RawFlag === 'yes' || RawFlag === 'enabled';
    if(!IsEnabled)
      return false;

    const ScoredCandidates = await RetrieveScoredCandidates(ArgNormalizedText);
    const TopCandidate = ScoredCandidates[0];
    if(!TopCandidate)
      return false;

    if(TopCandidate.Score >= NEAR_MISS_SCORE_FLOOR) {
      const SuggestionSyntax = (TopCandidate.Entry.SyntaxExamples?.[0] || '').replace(/@Sleuth AI/g, ArgSlackApp.AppMentionString);
      const ResponseMessage = `Did you mean the \`${TopCandidate.Entry.Id}\` command? Try \`${SuggestionSyntax}\`.`;
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ResponseMessage);
      return true;
    }

    return false;
  }

  /**
   * Handle Slack app_mention event.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
   * @returns {Promise<boolean>}
   */
  async #OnAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    // log the app_mention event.
    ArgSlackApp.Logger.info(
      `app_mention event handled by ChatModule:`,
      ChatModule.#BuildSafeInboundEventLogInfo(ArgEventInfo)
    );

    // normalize app mention commands so they are resilient to trailing punctuation or extra spacing.
    // computed before the file check so we can suppress the confirmation when question text is present.
    const CommandTextWithoutMention = ArgEventInfo.text.replace(ArgSlackApp.AppMentionString, '').trim();

    const NormalizedCommandTextResult = await NormalizeDirectCommandTextAsync(CommandTextWithoutMention);
    const NormalizedCommandText = NormalizedCommandTextResult.NormalizedText;

    // check for an uploaded text file (Markdown, snippet, log, CSV, code, etc.) and store it as
    // thread context memory before any other handling. Suppress the "I've loaded…" confirmation
    // post when the user also asked a question — the AI's attribution footer signals which file was
    // used, and suppressing prevents the confirmation from appearing in the thread context the AI
    // reads on the same turn.
    const AttachmentResult = await this.#HandleAttachmentAsync(
      ArgSlackApp,
      ArgEventInfo,
      NormalizedCommandText,
      !!NormalizedCommandText,
      true // GH-91: this path reaches #CommandRouter.RouteAsync below, so it can serve the fall-through.
    );
    if(AttachmentResult.Handled) return true;
    const FileWasLoaded = AttachmentResult.TextFileWasStored;

    if(FileWasLoaded) {
      // if the message contained only the file with no question, the confirmation is sufficient.
      if(!NormalizedCommandText) return true;
      // question text is present alongside the upload — skip command routing and fall through
      // to generate an AI answer grounded in the just-loaded context memory.
    } else {
      // no attachment took ownership — run the normal command routing pipeline.

      // GH-397 router mode: when armed, Gemini Flash Lite either shadows the resolver (logs a corpus
      // record, ZERO authority) or, in `active`, takes over resolution above a confidence floor.
      // `off`/`shadow` never change production behavior; `active` takeover falls back to the normal
      // pipeline below whenever it declines or errors. All paths are best-effort — a Flash Lite
      // outage cannot break the hot path.
      if(CommandTextWithoutMention && this.#RouterShadow.IsArmed()) {
        if(this.#RouterShadow.GetMode() === 'active') {
          if(await this.#TryRouterActiveTakeoverAsync(ArgSlackApp, ArgEventInfo, CommandTextWithoutMention, NormalizedCommandText))
            return true;
        } else {
          const IncumbentRoute = this.#CommandRouter.MatchRouteName(NormalizedCommandText, ArgEventInfo);
          this.#RouterShadow.LogShadowAsync({
            rawText: CommandTextWithoutMention,
            channelId: ArgEventInfo.channel,
            routerOutcome: IncumbentRoute ? 'matched' : 'unmatched',
            matchedRoute: IncumbentRoute,
          }).catch((Error) => ArgSlackApp.Logger.warn(`router shadow log failed: ${Error && Error.message ? Error.message : Error}`));
        }
      }

      // dispatch any registered chat command — see #RegisterCommandRoutes for the full list.
      if(await this.#CommandRouter.RouteAsync(NormalizedCommandText, ArgEventInfo)) return true;

      // run deterministic response handling before invoking the AI model.
      if(await this.#TryHandleDeterministicResponseAsync(ArgSlackApp, ArgEventInfo))
        return true;

      if(await this.#TryHandleUnsupportedReminderActionAsync(ArgSlackApp, ArgEventInfo, NormalizedCommandText))
        return true;

      // natural-language and freshness-driven auto-routes always target the OpenAI provider — that
      // is the documented product behavior, not a registry concern.
      const OpenAIWebSearchProvider = GetWebSearchProviderById('web-search');

      // route explicit natural-language web lookup aliases before the generic chat fallback.
      const NaturalLanguageWebSearchQuery = ChatModule.ExtractNaturalLanguageWebSearchQuery(NormalizedCommandText);
      if(NaturalLanguageWebSearchQuery) {
        await HandleWebSearchProviderCommandAsync(
          ArgSlackApp,
          ArgEventInfo,
          OpenAIWebSearchProvider,
          NaturalLanguageWebSearchQuery,
          this.#WorkspaceAI,
          ChatModule.BuildWebSearchResponseText
        );
        return true;
      }

      // route a narrow class of freshness-sensitive external questions to web search.
      if(ChatModule.ShouldAutoRouteToWebSearchForFreshness(NormalizedCommandText)) {
        await HandleWebSearchProviderCommandAsync(
          ArgSlackApp,
          ArgEventInfo,
          OpenAIWebSearchProvider,
          NormalizedCommandText,
          this.#WorkspaceAI,
          ChatModule.BuildWebSearchResponseText
        );
        return true;
      }

      // Phase 0 near-miss probe: every deterministic route + web-search auto-route declined, so this
      // mention is about to fall through to generic AI chat — exactly the dead-end we want to measure.
      // Fire-and-forget; the .catch keeps a probe failure from ever affecting the chat fallthrough.
      this.#EmitNearMissProbeAsync(ArgSlackApp, ArgEventInfo, NormalizedCommandText)
        .catch((Error) => ArgSlackApp.Logger.warn(`near-miss probe failed: ${Error && Error.message ? Error.message : Error}`));

      if(await this.#TryHandleNearMissCommandAsync(ArgSlackApp, ArgEventInfo, NormalizedCommandText))
        return true;
    }

    // gather thread context. For a root message that just had a file loaded, use event.ts as the
    // thread root so the context memory block is included in the AI call even though thread_ts is
    // not set on the root message event.
    const ContextThreadTS = ArgEventInfo.thread_ts ?? (FileWasLoaded ? ArgEventInfo.ts : null);
    const MessageText = ContextThreadTS
      ? await this.#GatherThreadContextAsync(ArgSlackApp, ArgEventInfo.channel, ContextThreadTS)
      : ArgEventInfo.text;

    // prepare system instructions.
    const SystemInstructions = await this.#PrepareSystemInstructionsAsync();

    // resolve the per-channel model override (if any) and process the message with the AI.
    const ChannelModel = this.#ChannelModelSettings.GetModelForChannel(ArgEventInfo.channel);
    const ResponseText = await this.#ProcessChatWithChannelModelAsync(
      ArgSlackApp, MessageText, SystemInstructions, ArgEventInfo.channel, ChannelModel
    );

    // append a grounding attribution when the answer was based on a context memory file, so the
    // user can see which document was used. Suppress the web-search suggestion in this case —
    // document analysis is not a web-search scenario.
    const UsedMemoryKey = ContextThreadTS ? `${ArgEventInfo.channel}:${ContextThreadTS}` : null;
    const UsedMemory = UsedMemoryKey ? this.#ThreadContextMemory.get(UsedMemoryKey) : null;
    const Attribution = UsedMemory ? `\n\n_Answer based on context from: *${UsedMemory.filename}*_` : '';
    const FormattedResponseText = this.#FormatMessageForSlack(ResponseText) + Attribution;

    // only attach the "search the web" suggestion when the user is plainly asking Sleuth (no
    // teammate mentions, no empty query) and the answer was not grounded in a context memory file.
    const SearchSuggestionQuery = CommandTextWithoutMention.replace(/[?.!]+$/, '').trim();
    const ShouldSuggestWebSearch = !UsedMemory
      && SearchSuggestionQuery.length > 0
      && !ChatModule.HasOtherUserMentions(ArgEventInfo.text, ArgSlackApp.BotUserID);

    if(ShouldSuggestWebSearch) {
      const SuggestionBlocks = ChatModule.BuildGoogleSearchSuggestionBlocks(
        FormattedResponseText, SearchSuggestionQuery
      );
      await ArgSlackApp.PostMessageTextWithBlocksAsync(
        ArgEventInfo.channel, FormattedResponseText, SuggestionBlocks, undefined, ArgEventInfo.ts
      );
    } else {
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FormattedResponseText);
    }

    // return true to indicate that the event was handled.
    return true;
  }

  /**
   * Handle a click on the "Search the web" suggestion button attached to a freeform chat answer.
   * Re-routes the suggested query through the OpenAI web-search provider, posting the result as a
   * sibling reply in the same thread as the original answer.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').BlockActionInfo} ArgActionInfo Action payload.
   * @returns {Promise<boolean>}
   */
  async #OnChatGoogleSearchActionAsync(ArgSlackApp, ArgActionInfo) {
    ArgSlackApp.Logger.info(`chat-google-search action handled by ChatModule:`, ArgActionInfo);

    const Query = (ArgActionInfo.value ?? '').trim();
    if(!Query) return true;

    // Post the result in the same thread. If the bot message was itself a thread reply, threadTs
    // points at the original mention's TS. Otherwise it stood alone, so its own TS becomes the
    // thread root once we post under it.
    const ReplyTS = ArgActionInfo.threadTs || ArgActionInfo.messageTs;

    /** @type {import('./slack-app').AppMentionEventInfo} */
    const SyntheticEventInfo = {
      channel: ArgActionInfo.channel,
      text: Query,
      ts: ReplyTS,
      thread_ts: ReplyTS,
      user: ArgActionInfo.user,
      files: [],
    };

    await HandleWebSearchProviderCommandAsync(
      ArgSlackApp,
      SyntheticEventInfo,
      GetWebSearchProviderById('web-search'),
      Query,
      this.#WorkspaceAI,
      ChatModule.BuildWebSearchResponseText
    );

    return true;
  }

  /**
   * Process a chat message with the channel's overridden model when set, falling back to the workspace
   * default only when the override is rejected as an invalid/deprecated model. Transient failures
   * (rate limits, timeouts, 5xx, network) propagate so we don't double-bill or duplicate responses.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgMessageText User message text to process.
   * @param {string} ArgSystemInstructions System instructions for the AI request.
   * @param {string} ArgChannelID Channel ID where the message was posted.
   * @param {string|null} ArgChannelModel Per-channel model override, or null to use the workspace default.
   * @returns {Promise<string>}
   */
  async #ProcessChatWithChannelModelAsync(ArgSlackApp, ArgMessageText, ArgSystemInstructions, ArgChannelID, ArgChannelModel) {
    const SelectedModel = ArgChannelModel || this.#WorkspaceAI.DefaultModelName;
    const StartTime = Date.now();

    if(!ArgChannelModel) {
      try {
        const ResponseText = await this.#WorkspaceAI.ProcessMessageWithTextResponseAsync(
          ArgMessageText,
          ArgSystemInstructions
        );
        ArgSlackApp.Logger.info(
          `[chat-ai] reply succeeded in ${Date.now() - StartTime}ms ` +
          `(channel=${ArgChannelID}, model=${SelectedModel}, promptChars=${ArgMessageText.length})`
        );
        return ResponseText;
      } catch(error) {
        ArgSlackApp.Logger.error(
          `[chat-ai] reply failed after ${Date.now() - StartTime}ms ` +
          `(channel=${ArgChannelID}, model=${SelectedModel}, promptChars=${ArgMessageText.length}):`,
          error
        );
        throw error;
      }
    }

    try {
      const ResponseText = await this.#WorkspaceAI.ProcessMessageWithTextResponseAsync(
        ArgMessageText, ArgSystemInstructions, ArgChannelModel
      );
      ArgSlackApp.Logger.info(
        `[chat-ai] reply succeeded in ${Date.now() - StartTime}ms ` +
        `(channel=${ArgChannelID}, model=${SelectedModel}, promptChars=${ArgMessageText.length}, override=yes)`
      );
      return ResponseText;
    } catch(error) {
      // only fall back to the workspace default when the error looks like a model-validity problem
      // (e.g. the stored override has been deprecated since it was saved). All other failures
      // propagate so we don't issue a second OpenAI request during transient outages.
      if(!ChatModule.IsInvalidModelError(error)) {
        ArgSlackApp.Logger.error(
          `[chat-ai] reply failed after ${Date.now() - StartTime}ms ` +
          `(channel=${ArgChannelID}, model=${SelectedModel}, promptChars=${ArgMessageText.length}, override=yes):`,
          error
        );
        throw error;
      }

      ArgSlackApp.Logger.error(
        `channel model override '${ArgChannelModel}' is no longer valid in channel ${ArgChannelID}, falling back to default:`,
        error
      );
      const FallbackStartTime = Date.now();
      const ResponseText = await this.#WorkspaceAI.ProcessMessageWithTextResponseAsync(
        ArgMessageText,
        ArgSystemInstructions
      );
      ArgSlackApp.Logger.info(
        `[chat-ai] fallback reply succeeded in ${Date.now() - FallbackStartTime}ms ` +
        `(channel=${ArgChannelID}, model=${this.#WorkspaceAI.DefaultModelName}, promptChars=${ArgMessageText.length}, overrideFallbackFrom=${SelectedModel})`
      );
      return ResponseText;
    }
  }

  /**
   * Heuristic check for OpenAI errors that indicate the requested model is invalid, deprecated, or
   * unavailable to this account. Used to decide whether a per-channel model override should be
   * silently retried with the workspace default.
   * @param {any} ArgError Error thrown by the OpenAI client.
   * @returns {boolean}
   */
  static IsInvalidModelError(ArgError) {
    if(!ArgError) return false;

    // OpenAI APIError surfaces a structured code on model-not-found responses.
    if(ArgError.code === 'model_not_found') return true;

    // 404 from the chat completions endpoint when the model id is not recognized.
    if(ArgError.status === 404) return true;

    // text-shape fallback for SDK versions that don't populate a structured code.
    const Message = typeof ArgError.message === 'string' ? ArgError.message : '';
    if(/model[^a-z0-9]+.*(?:not found|does not exist|is not allowed|not a valid model|invalid model|cannot be found)/i.test(Message)) return true;

    return false;
  }

  /**
   * Check whether a user is asking for the live OpenAI/ChatGPT model catalog.
   * @param {string} ArgCommandText App mention text after removing the bot mention.
   * @returns {boolean}
   */
  static IsLiveModelCatalogQuestion(ArgCommandText) {
    if(typeof ArgCommandText !== 'string') return false;

    const NormalizedText = ArgCommandText
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if(NormalizedText.length === 0) return false;

    if(/^(models|show-channel-model|set-channel-model|clear-channel-model|switch-models?|model-switch)\b/.test(NormalizedText))
      return false;

    const MentionsModelCatalog = /\bmodels?\b/.test(NormalizedText)
      && /\b(?:chatgpt|openai|gpt|claude|anthropic|gemini)\b/.test(NormalizedText);
    const AsksForAvailability = /\b(?:available|availability|current|currently|latest|list|supported|options|choices)\b/.test(NormalizedText);
    const IsQuestionShape = /\?|\b(?:what|which|list|show|tell)\b/.test(NormalizedText);

    return MentionsModelCatalog && AsksForAvailability && IsQuestionShape;
  }

  /**
   * Detect reminder-creation requests that should not fall through to freeform chat.
   * @param {string} ArgCommandText App mention text after removing the bot mention.
   * @returns {boolean}
   */
  static IsReminderActionIntent(ArgCommandText) {
    if(typeof ArgCommandText !== 'string') return false;

    const NormalizedText = ArgCommandText
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if(NormalizedText.length === 0) return false;

    const HasReminderNoun = /\breminder(?:s)?\b/.test(NormalizedText);
    const HasCreationVerb = /\b(?:make|create|set|add|schedule)\b/.test(NormalizedText);
    return HasReminderNoun && HasCreationVerb;
  }

  // GH-62: #IsImageListCreationRequest moved to context-file-classifier.HasListCreationIntent so
  // that attachment classification and the intent selecting a handler are decided in one place.
  // Splitting them across two modules is what let the image path and the text path disagree.

  /**
   * Action ID for the "Search the web" suggestion button attached to freeform chat answers.
   * Keep this stable — Slack matches block_actions payloads against it.
   */
  static ChatGoogleSearchActionId = 'chat-google-search';

  /**
   * Detect whether an inbound Slack message text contains a user mention other than the bot
   * itself. Used to suppress the web-search suggestion when the user is involving a teammate.
   * @param {string} ArgMessageText Raw Slack message text containing `<@U...>` mention encodings.
   * @param {string|null} ArgBotUserID Bot's own Slack user ID (excluded from the check).
   * @returns {boolean}
   */
  static HasOtherUserMentions(ArgMessageText, ArgBotUserID) {
    if(typeof ArgMessageText !== 'string') return false;
    const UserMentionRegex = /<@([A-Z0-9]+)>/g;
    let Match;
    while((Match = UserMentionRegex.exec(ArgMessageText)) !== null) {
      if(Match[1] !== ArgBotUserID) return true;
    }
    return false;
  }

  /**
   * Build the Block Kit payload for a freeform chat answer that includes a "Search the web"
   * suggestion button. The button's value carries the search query verbatim; the chat-google-search
   * action handler re-routes that query into the OpenAI web-search provider when clicked.
   * @param {string} ArgAnswerText Slack-formatted answer body (mrkdwn).
   * @param {string} ArgSearchQuery Suggested search query (already trimmed of trailing punctuation).
   * @returns {Array<any>} Blocks array suitable for chat.postMessage.
   */
  static BuildGoogleSearchSuggestionBlocks(ArgAnswerText, ArgSearchQuery) {
    // Slack section text caps at 3000 chars — trim the body so the API rejects nothing.
    const SectionTextLimit = 2900;
    const AnswerSection = ArgAnswerText.length > SectionTextLimit
      ? ArgAnswerText.slice(0, SectionTextLimit) + '…'
      : ArgAnswerText;

    // Slack button text caps at 75 chars; the prefix consumes some, so cap the query at 45.
    const ButtonTextLimit = 45;
    const ButtonQuery = ArgSearchQuery.length > ButtonTextLimit
      ? ArgSearchQuery.slice(0, ButtonTextLimit - 1) + '…'
      : ArgSearchQuery;

    // Slack button value caps at 2000 chars; trim defensively so the click payload always
    // represents what the label promises.
    const ButtonValueLimit = 1800;
    const ButtonValue = ArgSearchQuery.length > ButtonValueLimit
      ? ArgSearchQuery.slice(0, ButtonValueLimit)
      : ArgSearchQuery;

    return [
      { type: 'section', text: { type: 'mrkdwn', text: AnswerSection } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: ChatModule.ChatGoogleSearchActionId,
            text: { type: 'plain_text', text: `Search the web for: ${ButtonQuery}` },
            value: ButtonValue,
          },
        ],
      },
    ];
  }

  /**
   * Extract a web-search query from a narrow set of natural-language lookup aliases.
   * @param {string} ArgCommandText App mention text after removing the bot mention.
   * @returns {string|null}
   */
  static ExtractNaturalLanguageWebSearchQuery(ArgCommandText) {
    if(typeof ArgCommandText !== 'string') return null;

    const NormalizedText = ArgCommandText
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if(NormalizedText.length === 0) return null;

    const Prefix = '(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+)?';
    const AliasPatterns = [
      new RegExp(`^${Prefix}search (?:the )?web for (.+)$`, 'i'),
      new RegExp(`^${Prefix}search the web (.+)$`, 'i'),
      new RegExp(`^${Prefix}(?:look up|lookup) (.+)$`, 'i'),
      new RegExp(`^${Prefix}google (.+)$`, 'i'),
      new RegExp(`^${Prefix}find (?:recent|current|latest) (?:info|information) (?:on|about) (.+)$`, 'i'),
      // "check <domain.tld> ..." — TLD presence is the high-confidence signal; won't false-positive on internal commands.
      new RegExp(`^${Prefix}(?:check|look\\s+at)\\s+((?:[\\w-]+\\.)+(?:com|org|net|io|co|app|dev|ai|uk|us)(?:/\\S*)?(?:\\s+.*)?)$`, 'i'),
      // "search <domain.tld> ..." — requires a TLD to avoid colliding with "search reminders", "search my reminders", etc.
      new RegExp(`^${Prefix}search\\s+((?:[\\w-]+\\.)+(?:com|org|net|io|co|app|dev|ai|uk|us)(?:/\\S*)?(?:\\s+.*)?)$`, 'i'),
    ];

    for(const AliasPattern of AliasPatterns) {
      const Match = NormalizedText.match(AliasPattern);
      if(!Match) continue;

      const Query = Match[1].trim().replace(/[?.!]+$/, '').trim();
      if(Query.length > 0) return Query;
    }

    return null;
  }

  /**
   * Detect a narrow class of current-events or live-facts questions that should use web search.
   * @param {string} ArgCommandText App mention text after removing the bot mention.
   * @returns {boolean}
   */
  static ShouldAutoRouteToWebSearchForFreshness(ArgCommandText) {
    if(typeof ArgCommandText !== 'string') return false;

    const NormalizedText = ArgCommandText
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if(NormalizedText.length === 0) return false;

    const IsQuestionShape = /\?|^(?:what|which|who|when|where|why|how|is|are|do|does|did|can|could|would)\b/.test(NormalizedText);
    if(!IsQuestionShape) return false;

    const IsFreshNewsQuestion = /\b(?:latest|recent|current)\b.*\b(?:news|updates?|headlines?|developments?)\b/.test(NormalizedText)
      || /\b(?:news|updates?|headlines?|developments?)\b.*\b(?:latest|recent|current)\b/.test(NormalizedText)
      || /\bwhat'?s the latest on\b/.test(NormalizedText)
      || /\bany (?:recent|latest|current)?\s*news on\b/.test(NormalizedText)
      || /\bwhat(?:'s| is) happening with\b.*\b(?:today|right now|currently)\b/.test(NormalizedText);

    const IsLiveFactQuestion = /\b(?:current|latest)\s+(?:price|stock price|weather|forecast|status|score|version)\b/.test(NormalizedText)
      || /\b(?:price|stock price|weather|forecast|status|score|version)\s+(?:of|for|in)\b.*\b(?:today|right now|currently|current|latest)\b/.test(NormalizedText);

    return IsFreshNewsQuestion || IsLiveFactQuestion;
  }

  /**
   * Filter a raw OpenAI model list down to IDs useful for chat model questions.
   * @param {string[]} ArgModelIds Raw model IDs returned by the OpenAI API.
   * @returns {string[]}
   */
  static FilterLiveModelCatalogForChat(ArgModelIds) {
    if(!Array.isArray(ArgModelIds)) return [];

    const UniqueModelIds = [...new Set(ArgModelIds.filter((ArgModelId) =>
      typeof ArgModelId === 'string' && ArgModelId.trim().length > 0
    ).map((ArgModelId) => ArgModelId.trim()))].sort();

    const ChatLikeModelIds = UniqueModelIds.filter((ArgModelId) =>
      /^(?:chatgpt|codex|computer-use|gpt-|o[0-9]|claude-|gemini-)/.test(ArgModelId) &&
      !/(?:embedding|moderation|tts|whisper|transcribe|dall-e|image|vision-preview)/.test(ArgModelId)
    );

    return ChatLikeModelIds.length > 0 ? ChatLikeModelIds : UniqueModelIds;
  }

  /**
   * Build the Slack message for a web-search result.
   * @param {{ text: string, sources: Array<{ title: string|null, url: string }>, searchSuggestions?: string[] }} ArgResult Web-search result.
   * @returns {string}
   */
  static BuildWebSearchResponseText(ArgResult) {
    const Lines = [SlackFormatUtils.NormalizeModelMarkdownForSlack(ArgResult.text)];
    const Sources = Array.isArray(ArgResult.sources) ? ArgResult.sources.slice(0, MaxWebSearchSources) : [];

    if(Sources.length > 0) {
      Lines.push('', '*Sources:*');
      for(const Source of Sources) {
        const SafeUrl = ChatModule.BuildSafeSlackLinkUrl(Source.url);
        if(!SafeUrl) continue;
        const SourceTitle = SlackFormatUtils.SanitizeForInlineSlack(Source.title || Source.url, 120);
        Lines.push(`- <${SafeUrl}|${SourceTitle}>`);
      }
    }

    const Suggestions = Array.isArray(ArgResult.searchSuggestions)
      ? ArgResult.searchSuggestions.slice(0, MaxWebSearchSources)
      : [];
    if(Suggestions.length > 0) {
      const SuggestionLinks = Suggestions
        .map((Query) => {
          const SafeUrl = ChatModule.BuildSafeSlackLinkUrl(`https://www.google.com/search?q=${encodeURIComponent(Query)}`);
          if(!SafeUrl) return null;
          const SafeLabel = SlackFormatUtils.SanitizeForInlineSlack(Query, 80);
          return `<${SafeUrl}|${SafeLabel}>`;
        })
        .filter(Boolean);
      if(SuggestionLinks.length > 0) Lines.push('', `_Related searches: ${SuggestionLinks.join(' · ')}_`);
    }

    return Lines.join('\n');
  }

  /**
   * Validate and minimally escape a URL before embedding it in Slack link markup.
   * @param {string|undefined|null} ArgUrl Candidate source URL.
   * @returns {string|null}
   */
  static BuildSafeSlackLinkUrl(ArgUrl) {
    if(typeof ArgUrl !== 'string' || ArgUrl.trim().length === 0) return null;

    try {
      const ParsedUrl = new URL(ArgUrl.trim());
      if(ParsedUrl.protocol !== 'http:' && ParsedUrl.protocol !== 'https:')
        return null;

      return ParsedUrl.toString()
        .replace(/>/g, '%3E')
        .replace(/\|/g, '%7C');
    } catch {
      return null;
    }
  }




  /**
   * Handle Slack reaction_added event. Intercepts `:bug:` and `:wrench:` reactions for Sleuth-
   * owned chat diagnostics and GitHub filing, while returning false for unrelated messages so the
   * reminders reaction handler (registered after this one) still gets to run for reminder triage
   * and lifecycle reactions.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event payload.
   * @returns {Promise<boolean>}
   */
  async #OnReactionAddedAsync(ArgSlackApp, ArgEventInfo) {
    // handle stop sign reaction — stops handsfree mode and confirms to the user.
    if(ArgEventInfo.reaction === 'octagonal_sign') {
      return await this.#HandleStopReactionAsync(ArgSlackApp, ArgEventInfo);
    }

    if(ArgEventInfo.reaction === 'bug')
      return await this.#HandleBugReportReactionAsync(ArgSlackApp, ArgEventInfo);

    if(ArgEventInfo.reaction !== 'wrench') return false;

    // fetch the parent message text. failures here fall through to the reminders handler so
    // a transient Slack API error doesn't swallow reminder triage on unrelated messages.
    /** @type {Array<import('./slack-app').MessageInfo>} */
    let ThreadMessages;
    try {
      ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(
        ArgEventInfo.item.channel, ArgEventInfo.item.ts
      );
    } catch(error) {
      ArgSlackApp.Logger.warn('chat triage: failed to fetch thread for wrench reaction:', error);
      return false;
    }

    const OriginalMessage = ThreadMessages[0];
    if(!OriginalMessage || typeof OriginalMessage.text !== 'string') return false;

    const MessageMetadata = await ArgSlackApp.GetMessageMetadataAsync(
      ArgEventInfo.item.channel, ArgEventInfo.item.ts
    );
    if(MessageMetadata?.event_type === 'sleuth-ai-reminder-ids') return false;

    // strip the bot mention so the regex matches both leading-mention and trailing-mention forms,
    // and so a route description matches either placement too.
    const TextWithoutMention = ArgSlackApp.AppMentionString
      ? OriginalMessage.text.replace(ArgSlackApp.AppMentionString, '').trim()
      : OriginalMessage.text.trim();

    // ask-self gets its own triage rather than the generic chat one, because the useful diagnosis
    // is the tenancy gate and the RAG module's real error — neither of which the generic path can
    // see. Only reachable when the private overlay is installed; otherwise a wrench on an ask-self
    // message falls through to normal chat triage, which is the honest answer for a build where
    // the command does not exist.
    if(RagChatIntegration) {
      const AskSelfMatch = TextWithoutMention.match(ChatModule.AskSelfCommandRegex);
      if(AskSelfMatch) {
        await RagChatIntegration.PostAskSelfTriageAsync(
          ArgSlackApp,
          ArgEventInfo.item.channel,
          ArgEventInfo.item.ts,
          ArgEventInfo.user,
          AskSelfMatch[1].trim()
        );
        return true;
      }
    }

    const ThreadDebugInfo = this.#GetThreadDebugInfo(
      ArgSlackApp,
      ArgEventInfo.item.channel,
      ArgEventInfo.item.ts,
      ThreadMessages
    );
    if(!ThreadDebugInfo.ShouldHandleAsChatDebug) return false;

    await this.#PostChatTriageAsync(
      ArgSlackApp,
      ArgEventInfo.item.channel,
      ArgEventInfo.item.ts,
      ArgEventInfo.user,
      OriginalMessage,
      TextWithoutMention,
      ThreadMessages,
      ThreadDebugInfo
    );
    return true;
  }

  /**
   * Summarize how Sleuth would route a thread for chat auto-response and context-memory lookup.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgChannelID Channel ID containing the thread.
   * @param {string} ArgReactedMessageTS Timestamp of the reacted message.
   * @param {Array<import('./slack-app').MessageInfo>} ArgThreadMessages Thread messages returned by Slack.
   * @returns {{
   *   ThreadRootTS: string,
   *   ThreadStartsWithMention: boolean,
   *   ShouldAutoRespond: boolean,
   *   Memory: { filename: string, content: string }|null,
   *   ShouldHandleAsChatDebug: boolean
   * }}
   */
  #GetThreadDebugInfo(ArgSlackApp, ArgChannelID, ArgReactedMessageTS, ArgThreadMessages) {
    const FirstMessage = ArgThreadMessages[0] || null;
    const ThreadRootTS = FirstMessage?.thread_ts || FirstMessage?.ts || ArgReactedMessageTS;
    const ThreadStartsWithMention = !!FirstMessage?.text?.includes(ArgSlackApp.AppMentionString);

    let ShouldAutoRespond = ThreadStartsWithMention;
    for(const Message of ArgThreadMessages) {
      if(!Message.reactions) continue;
      if(Message.reactions.includes('bell')) ShouldAutoRespond = true;
      if(Message.reactions.includes('no_bell')) ShouldAutoRespond = false;
    }

    const Memory = this.#ThreadContextMemory.get(`${ArgChannelID}:${ThreadRootTS}`) || null;
    const ShouldHandleAsChatDebug = ThreadStartsWithMention || !!Memory;

    return {
      ThreadRootTS,
      ThreadStartsWithMention,
      ShouldAutoRespond,
      Memory,
      ShouldHandleAsChatDebug,
    };
  }

  /**
   * Describe the high-level routing path for a chat/app-mention message. Used by the wrench-
   * reaction triage diagnostic to surface where a message would be dispatched.
   *
   * The registered chat commands are described via the CommandRouter (which uses each route's
   * DescribePattern when supplied — generally a looser prefix-only check so malformed commands
   * still classify under their intended route, e.g. `switch-models:badformat` → `switch-models`).
   * The natural-language / freshness / generic-chat paths are not router routes — they are
   * downstream fallbacks in #OnAppMentionAsync — and remain hardcoded here.
   *
   * @param {string} ArgTextWithoutMention Message text after removing the bot mention.
   * @param {import('./slack-app').AppMentionEventInfo} [ArgEventInfo] Original Slack event info;
   *   only required when classifying a command whose Pattern function reads from it (currently
   *   `switch-models`).
   * @returns {Promise<string>}
   */
  async #DescribeChatRouteAsync(ArgTextWithoutMention, ArgEventInfo) {
    const NormalizedCommandTextResult = await NormalizeDirectCommandTextAsync(ArgTextWithoutMention);
    const NormalizedCommandText = NormalizedCommandTextResult.NormalizedText;

    const RegisteredRoute = this.#CommandRouter.DescribeRoute(NormalizedCommandText, ArgEventInfo);
    if(RegisteredRoute) return RegisteredRoute;
    if(ChatModule.ExtractNaturalLanguageWebSearchQuery(NormalizedCommandText)) return 'natural-language web-search';
    if(ChatModule.ShouldAutoRouteToWebSearchForFreshness(NormalizedCommandText)) return 'freshness auto-web-search';
    return 'generic chat';
  }

  /**
   * Post generic chat triage diagnostics for Sleuth chat threads and app mentions.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgChannelID Channel ID of the reacted message.
   * @param {string} ArgMessageTS Timestamp of the reacted message.
   * @param {string} ArgReactingUserID User who reacted with :wrench:.
   * @param {import('./slack-app').MessageInfo} ArgOriginalMessage First/root message returned for the thread.
   * @param {string} ArgTextWithoutMention Message text after mention stripping.
   * @param {Array<import('./slack-app').MessageInfo>} ArgThreadMessages Loaded thread messages.
   * @param {{
   *   ThreadRootTS: string,
   *   ThreadStartsWithMention: boolean,
   *   ShouldAutoRespond: boolean,
   *   Memory: { filename: string, content: string }|null
   * }} ArgThreadDebugInfo Thread debug summary.
   * @returns {Promise<void>}
   */
  async #PostChatTriageAsync(
    ArgSlackApp,
    ArgChannelID,
    ArgMessageTS,
    ArgReactingUserID,
    ArgOriginalMessage,
    ArgTextWithoutMention,
    ArgThreadMessages,
    ArgThreadDebugInfo
  ) {
    const ChannelModelStatus = this.#BuildChannelModelStatus(ArgChannelID);
    const ComplexModel = this.#RemindersModule?.WorkspaceAI?.ComplexModelName || 'not available';
    const ParsedRoute = await this.#DescribeChatRouteAsync(ArgTextWithoutMention, {
      channel: ArgChannelID,
      ts: ArgMessageTS,
      user: ArgOriginalMessage.user,
      text: ArgOriginalMessage.text,
      thread_ts: ArgOriginalMessage.thread_ts || ArgMessageTS,
    });
    const PreviewSourceText = ArgTextWithoutMention || ArgOriginalMessage.text || '';
    const TextPreview = SlackFormatUtils.SanitizeForInlineSlack(PreviewSourceText, 200);

    const FeedbackLines = [
      `:wrench: Chat triage requested by <@${ArgReactingUserID}>.`,
      '*Routing:*',
      `• Thread starts with app mention: *${ArgThreadDebugInfo.ThreadStartsWithMention ? 'yes' : 'no'}*`,
      `• Parsed route: *${ParsedRoute}*`,
      `• Auto-respond for this thread: *${ArgThreadDebugInfo.ShouldAutoRespond ? 'enabled' : 'disabled'}*`,
      '*Model selection:*',
      ...ChannelModelStatus.lines.map((ArgLine) => `• ${ArgLine}`),
      `• Complex/date extraction model: \`${ComplexModel}\``,
      '*Thread context:*',
      `• Thread root ts: \`${ArgThreadDebugInfo.ThreadRootTS}\``,
      `• Reacted message ts: \`${ArgMessageTS}\``,
      `• Loaded thread messages: ${ArgThreadMessages.length}`,
      `• Stored context memory: ${ArgThreadDebugInfo.Memory ? `yes (\`${ArgThreadDebugInfo.Memory.filename}\`)` : 'no'}`,
      '*Target message:*',
      `• Sender: <@${ArgOriginalMessage.user}>`,
      `• Sender role: ${ArgOriginalMessage.bot_id ? 'assistant/bot' : 'user'}`,
      `• Text preview: ${TextPreview || '_(empty)_'}`
    ];

    await ArgSlackApp.PostMessageTextAsync(ArgChannelID, ArgMessageTS, FeedbackLines.join('\n'));
  }







  /**
   * Build reusable channel model status lines for admin/debug surfaces.
   * @param {string} ArgChannelID Channel being inspected.
   * @returns {{ override: string|null, defaultModel: string, effectiveModel: string, lines: string[] }}
   */
  #BuildChannelModelStatus(ArgChannelID) {
    const Override = this.#ChannelModelSettings.GetModelForChannel(ArgChannelID);
    const DefaultModel = this.#WorkspaceAI.DefaultModelName;
    const EffectiveModel = Override || DefaultModel;

    return {
      override: Override,
      defaultModel: DefaultModel,
      effectiveModel: EffectiveModel,
      lines: [
        `Channel override: ${Override ? `\`${Override}\`` : '_(none — using workspace default)_'}`,
        `Channel basic model: \`${EffectiveModel}\``,
        `Workspace default chat model: \`${DefaultModel}\``,
      ],
    };
  }






  /**
   * Handle Slack message event.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').MessageEventInfo} ArgEventInfo Event payload.
   * @returns {Promise<boolean>}
   */
  async #OnMessageAsync(ArgSlackApp, ArgEventInfo) {
    try {
      // check if we should respond to this message. This functionality allows the chat module to respond to messages
      // without having to explicitly mention the app, and addresses a common user request for a "hands-free" mode.
      const { ShouldRespond } = await this.#ShouldRespondToMessageAsync(ArgSlackApp, ArgEventInfo);
      if(!ShouldRespond) return false;

      // check for an uploaded text file (Markdown, snippet, log, CSV, code, etc.) and store it as
      // thread context memory before any other handling. Suppress the confirmation when the message
      // also has question text (same-turn contamination fix).
      const HasQuestionText = !!ArgEventInfo.text.trim();
      // GH-62: same unified dispatch as #OnAppMentionAsync. Previously this site called the text
      // ingest directly and had no image path at all, so a screenshot uploaded without an
      // @mention could never OCR even once the app_mention ordering was correct.
      const AttachmentResult = await this.#HandleAttachmentAsync(
        ArgSlackApp,
        ArgEventInfo,
        ArgEventInfo.text,
        HasQuestionText
      );
      if(AttachmentResult.Handled) return true;
      const FileWasLoaded = AttachmentResult.TextFileWasStored;
      if(FileWasLoaded && !HasQuestionText) return true;

      // attempt to handle deterministic responses first (skip when file was just loaded).
      if(!FileWasLoaded && await this.#TryHandleDeterministicResponseAsync(ArgSlackApp, ArgEventInfo))
        return true;

      // model-identity guard: when a thread participant asks "what model are you running?",
      // answer from runtime config instead of forwarding to the chat model, whose self-knowledge
      // about its own model name is unreliable and prone to hallucination.
      if(!FileWasLoaded
        && HandleShowChannelModelCommandAsync.ModelIdentityPattern.test((ArgEventInfo.text ?? '').trim())) {
        await HandleShowChannelModelCommandAsync(
          ArgSlackApp, ArgEventInfo, (ArgChannelID) => this.#BuildChannelModelStatus(ArgChannelID)
        );
        return true;
      }

      // gather thread context. Use event.ts as the thread root for root messages that just had a
      // file loaded so the context memory block is included even without thread_ts being set.
      const ContextThreadTS = ArgEventInfo.thread_ts ?? (FileWasLoaded ? ArgEventInfo.ts : null);
      const MessageText = ContextThreadTS
        ? await this.#GatherThreadContextAsync(ArgSlackApp, ArgEventInfo.channel, ContextThreadTS)
        : ArgEventInfo.text;

      const SystemInstructions = await this.#PrepareSystemInstructionsAsync();
      const ChannelModel = this.#ChannelModelSettings.GetModelForChannel(ArgEventInfo.channel);
      const ResponseText = await this.#ProcessChatWithChannelModelAsync(
        ArgSlackApp, MessageText, SystemInstructions, ArgEventInfo.channel, ChannelModel
      );

      // append grounding attribution when context memory was used.
      const UsedMemoryKey = ContextThreadTS ? `${ArgEventInfo.channel}:${ContextThreadTS}` : null;
      const UsedMemory = UsedMemoryKey ? this.#ThreadContextMemory.get(UsedMemoryKey) : null;
      const Attribution = UsedMemory ? `\n\n_Answer based on context from: *${UsedMemory.filename}*_` : '';
      const FormattedResponseText = this.#FormatMessageForSlack(ResponseText) + Attribution;

      // send the AI response and return true to indicate that the event was handled.
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FormattedResponseText);
      return true;
    } catch(error) {
      // log any errors that occur during message processing and return false to indicate that the event was not handled.
      ArgSlackApp.Logger.error("Error in OnMessageAsync:", error);
      return false;
    }
  }

  /**
   * Attempt to handle a deterministic response before calling the AI model.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo|import('./slack-app').MessageEventInfo} ArgEventInfo Event payload.
   * @returns {Promise<boolean>}
   */
  async #TryHandleDeterministicResponseAsync(ArgSlackApp, ArgEventInfo) {
    try {
      const ResponsesByPhrase = await this.#GetDeterministicResponseMapAsync();
      if(ResponsesByPhrase.size === 0) return false;

      const NormalizedText = this.#NormalizeDeterministicPhrase(ArgEventInfo.text ?? '');
      if(NormalizedText.length === 0) return false;

      const CaseSensitiveKey = `cs:${NormalizedText}`;
      const CaseInsensitiveKey = `ci:${NormalizedText.toLowerCase()}`;
      const Entry = ResponsesByPhrase.get(CaseSensitiveKey) ?? ResponsesByPhrase.get(CaseInsensitiveKey);
      if(!Entry) return false;

      return await this.#ExecuteDeterministicResponseAsync(ArgSlackApp, ArgEventInfo, Entry.config);
    } catch(error) {
      ArgSlackApp.Logger.error("Error in TryHandleDeterministicResponseAsync:", error);
      return false;
    }
  }

  /**
   * Prevent freeform chat from pretending it completed a reminder action when no
   * deterministic reminder route actually handled the request.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
   * @param {string} ArgNormalizedCommandText App mention text after removing the bot mention.
   * @returns {Promise<boolean>}
   */
  async #TryHandleUnsupportedReminderActionAsync(ArgSlackApp, ArgEventInfo, ArgNormalizedCommandText) {
    if(!ChatModule.IsReminderActionIntent(ArgNormalizedCommandText)) return false;

    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `I didn't create a reminder. Supported creation paths are :alarm_clock: on the source message, or in a thread use \`${ArgSlackApp.AppMentionString} make a Sleuth reminder for @user based on task above\`. If no time is specified, that thread command defaults to tomorrow morning.`
    );
    return true;
  }

  /**
   * Execute the deterministic response associated with a matching phrase.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo|import('./slack-app').MessageEventInfo} ArgEventInfo Event payload.
   * @param {DeterministicResponseConfig} ArgResponseConfig Parsed deterministic response configuration.
   * @returns {Promise<boolean>}
   */
  async #ExecuteDeterministicResponseAsync(ArgSlackApp, ArgEventInfo, ArgResponseConfig) {
    switch(ArgResponseConfig.type) {
      case 'static-text': {
        if(!ArgResponseConfig.text || ArgResponseConfig.text.trim().length === 0) {
          ArgSlackApp.Logger.warn('deterministic response skipped due to missing static text.');
          return false;
        }

        await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ArgResponseConfig.text);
        return true;
      }

      case 'reminders-for-user': {
        if(!this.#RemindersModule) {
          ArgSlackApp.Logger.warn('deterministic reminders request ignored because reminders module is unavailable.');
          return false;
        }

        if(!ArgResponseConfig.userMention || ArgResponseConfig.userMention.trim().length === 0) {
          ArgSlackApp.Logger.warn('deterministic reminders request skipped due to missing user mention.');
          return false;
        }

        return await this.#RemindersModule.ShowRemindersForUserDeterministicAsync(
          ArgEventInfo,
          ArgResponseConfig.userMention,
          { limitToCurrentChannel: ArgResponseConfig.limitToCurrentChannel === true }
        );
      }

      default:
        ArgSlackApp.Logger.warn('unsupported deterministic response type:', ArgResponseConfig.type);
        return false;
    }
  }

  /**
   * Load deterministic response configuration from disk on first use.
   * @returns {Promise<Map<string, DeterministicResponseEntry>>}
   */
  async #GetDeterministicResponseMapAsync() {
    if(this.#DeterministicResponsesByPhrase)
      return this.#DeterministicResponsesByPhrase;

    const ResponsesByPhrase = new Map();
    const ConfigPath = path.join(__dirname, '..', 'data', 'static', 'deterministic-responses.json');

    try {
      const FileContents = await fs.readFile(ConfigPath, 'utf8');
      const ParsedConfig = JSON.parse(FileContents);

      if(Array.isArray(ParsedConfig.entries)) {
        for(const CurrentEntry of ParsedConfig.entries) {
          if(!CurrentEntry || !Array.isArray(CurrentEntry.phrases) || CurrentEntry.phrases.length === 0) continue;

          const ParsedResponseConfig = this.#ParseDeterministicResponseConfig(CurrentEntry.response);
          if(!ParsedResponseConfig) {
            this.#SlackApp.Logger.warn('skipping deterministic response entry due to invalid response configuration.');
            continue;
          }

          const IsCaseInsensitive = CurrentEntry.caseInsensitive === true;
          for(const CurrentPhrase of CurrentEntry.phrases) {
            if(typeof CurrentPhrase !== 'string') continue;

            const NormalizedPhrase = this.#NormalizeDeterministicPhrase(CurrentPhrase);
            if(NormalizedPhrase.length === 0) continue;

            const MapKey = IsCaseInsensitive
              ? `ci:${NormalizedPhrase.toLowerCase()}`
              : `cs:${NormalizedPhrase}`;
            ResponsesByPhrase.set(MapKey, { config: ParsedResponseConfig });
          }
        }
      }
    } catch(error) {
      const NodeError = /** @type {NodeJS.ErrnoException} */ (error);
      if(NodeError.code === 'ENOENT')
        this.#SlackApp.Logger.info('no deterministic responses configuration file found. skipping.');
      else
        this.#SlackApp.Logger.error('failed to load deterministic responses configuration:', error);
    }

    this.#DeterministicResponsesByPhrase = ResponsesByPhrase;
    return ResponsesByPhrase;
  }

  /**
   * Normalize deterministic response phrases by trimming whitespace and collapsing spaces.
   * @param {string} ArgPhrase Raw phrase string.
   * @returns {string}
   */
  #NormalizeDeterministicPhrase(ArgPhrase) {
    if(typeof ArgPhrase !== 'string') return '';
    return ArgPhrase.replace(/\s+/g, ' ').trim();
  }

  /**
   * Validate and normalize deterministic response configuration objects.
   * @param {unknown} ArgResponse Raw response configuration object.
   * @returns {DeterministicResponseConfig|null}
   */
  #ParseDeterministicResponseConfig(ArgResponse) {
    if(!ArgResponse || typeof ArgResponse !== 'object') return null;

    const ResponseType = /** @type {{ type?: string }} */ (ArgResponse).type;
    if(ResponseType === 'static-text') {
      const TextValue = /** @type {{ text?: string }} */ (ArgResponse).text;
      if(typeof TextValue !== 'string' || TextValue.trim().length === 0) return null;

      return { type: 'static-text', text: TextValue };
    }

    if(ResponseType === 'reminders-for-user') {
      const UserMentionValue = /** @type {{ userMention?: string }} */ (ArgResponse).userMention;
      if(typeof UserMentionValue !== 'string' || UserMentionValue.trim().length === 0) return null;

      const LimitToCurrentChannel = /** @type {{ limitToCurrentChannel?: boolean }} */ (ArgResponse).limitToCurrentChannel;
      return {
        type: 'reminders-for-user',
        userMention: UserMentionValue,
        limitToCurrentChannel: LimitToCurrentChannel === true,
      };
    }

    return null;
  }

  /**
   * Handle octagonal_sign (🛑) reaction — stops handsfree mode and posts a confirmation.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Reaction event information.
   * @returns {Promise<boolean>}
   */
  async #HandleStopReactionAsync(ArgSlackApp, ArgEventInfo) {
    try {
      // resolve the thread root ts — the reacted message could be the root or a reply.
      const ThreadTs = await ArgSlackApp.GetMessageThreadTsAsync(
        ArgEventInfo.item.channel, ArgEventInfo.item.ts
      );
      if(!ThreadTs) return false;

      // fetch the full thread to check if handsfree mode is active.
      const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(
        ArgEventInfo.item.channel, ThreadTs
      );
      const FirstMessage = ThreadMessages[0];
      if(!FirstMessage?.text?.includes(ArgSlackApp.AppMentionString)) return false;

      // post the confirmation reply in the thread.
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.item.channel, ThreadTs,
        "Got it, I'll stop monitoring this thread unless you tag me again."
      );
      return true;
    } catch(error) {
      ArgSlackApp.Logger.warn('handsfree stop reaction: failed to process octagonal_sign:', error);
      return false;
    }
  }

  /**
   * Handle `:bug:` reaction by filing a GitHub issue for a Sleuth-authored message.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Reaction event information.
   * @returns {Promise<boolean>}
   */
  async #HandleBugReportReactionAsync(ArgSlackApp, ArgEventInfo) {
    let ReplyTS = ArgEventInfo.item.ts;

    try {
      const ThreadRootTS = await ArgSlackApp.GetMessageThreadTsAsync(
        ArgEventInfo.item.channel,
        ArgEventInfo.item.ts
      );
      if(ThreadRootTS) ReplyTS = ThreadRootTS;

      const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
      if(!HasAccess) {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.item.channel,
          ReplyTS,
          'sorry, only workspace admins or owners can file GitHub bug reports from reactions.'
        );
        return true;
      }

      const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(
        ArgEventInfo.item.channel,
        ReplyTS
      );
      const ReactedMessage = ThreadMessages.find((ArgMessage) => ArgMessage.ts === ArgEventInfo.item.ts);
      if(!ReactedMessage || typeof ReactedMessage.text !== 'string') return false;

      const MessageMetadata = await ArgSlackApp.GetMessageMetadataAsync(
        ArgEventInfo.item.channel,
        ArgEventInfo.item.ts
      );
      if(!this.#IsSleuthAuthoredMessage(ArgSlackApp, ReactedMessage, MessageMetadata)) {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.item.channel,
          ReplyTS,
          'the :bug: reaction only files GitHub issues for Sleuth-authored messages.'
        );
        return true;
      }

      const ChannelName = await ArgSlackApp.GetChannelNameAsync(ArgEventInfo.item.channel);
      const Permalink = await ArgSlackApp.GetPermaLinkAsync(ArgEventInfo.item.channel, ArgEventInfo.item.ts, ReplyTS);
      const ReportedByName = (await ArgSlackApp.GetUserDisplayNameAsync(ArgEventInfo.user))
        || ArgEventInfo.user
        || 'Unknown';
      // GH-428: resolve raw `<@U...>` mentions to display names before this text leaves Slack —
      // Slack's own client resolves them automatically, but a GitHub issue body/title cannot.
      const ResolvedMessageText = await ResolveMentionsForExternalDisplayAsync(ArgSlackApp, ReactedMessage.text);
      const ExistingBugReport = await this.#FindExistingBugReportAsync(
        ArgSlackApp,
        ArgEventInfo.item.channel,
        ArgEventInfo.item.ts
      );
      if(ExistingBugReport) {
        const ExistingIssueSuffix = ExistingBugReport.GitHubIssueUrl
          ? `: #${ExistingBugReport.GitHubIssueNumber} ${ExistingBugReport.GitHubIssueUrl}`
          : '.';
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.item.channel,
          ReplyTS,
          `A GitHub bug report was already filed for this message${ExistingIssueSuffix}`
        );
        return true;
      }

      const Title = this.#BuildBugReportIssueTitle(ResolvedMessageText);
      const Body = this.#BuildBugReportIssueBody(ArgSlackApp, {
        ChannelID: ArgEventInfo.item.channel,
        ChannelName,
        MessageText: ResolvedMessageText,
        MessageTS: ArgEventInfo.item.ts,
        ThreadRootTS: ReplyTS,
        Permalink,
        ReportedByName,
        MessageMetadata,
      });
      const Result = await FileGithubIssueAsync(ArgSlackApp.WorkspaceInfo, Title, Body);

      if(Result.ok) {
        await this.#AppendBugReportAsync({
          Kind: 'bug',
          WorkspaceName: ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME || 'unknown',
          ChannelID: ArgEventInfo.item.channel,
          MessageTS: ArgEventInfo.item.ts,
          ThreadRootTS: ReplyTS,
          ReportedByUserID: ArgEventInfo.user,
          ReportedByName,
          GitHubIssueNumber: Result.number,
          GitHubIssueUrl: Result.htmlUrl,
          GitHubRepo: Result.repo,
          CreatedAt: new Date().toISOString(),
        });
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.item.channel,
          ReplyTS,
          `You've reported an issue with Sleuth - bug filed under GH ${Result.number} (${Result.htmlUrl}). We'll review and resolve ASAP.`
        );
        return true;
      }

      if(Result.reason === 'no-repo') {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.item.channel,
          ReplyTS,
          'cannot file a GitHub issue: `SLEUTH_ISSUE_REPO` is not configured.'
        );
        return true;
      }

      if(Result.reason === 'no-pat') {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.item.channel,
          ReplyTS,
          'cannot file a GitHub issue: `GITHUB_PAT` is not configured for this workspace.'
        );
        return true;
      }

      if(Result.reason === 'forbidden') {
        const ErrorText = await BuildErrorReportAsync(
          ArgSlackApp,
          ArgEventInfo.item.channel,
          "couldn't file the GitHub issue: `GITHUB_PAT` lacks permission (filing issues requires `issues:write` scope).",
          Result.repo ? [`• Attempted repo: \`${Result.repo}\``] : []
        );
        await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.item.channel, ReplyTS, ErrorText);
        return true;
      }

      if(Result.reason === 'github-error') {
        ArgSlackApp.Logger.warn(`[bug-reaction] GitHub API returned ${Result.status} for ${Result.apiUrl}`);
        const ErrorText = await BuildErrorReportAsync(
          ArgSlackApp,
          ArgEventInfo.item.channel,
          `couldn't file the GitHub issue (GitHub returned ${Result.status}). Check the logs.`,
          Result.repo ? [`• Attempted repo: \`${Result.repo}\``] : []
        );
        await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.item.channel, ReplyTS, ErrorText);
        return true;
      }

      ArgSlackApp.Logger.error('[bug-reaction] failed:', Result.error);
      const FailureText = await BuildErrorReportAsync(
        ArgSlackApp,
        ArgEventInfo.item.channel,
        "Sorry - couldn't file the GitHub issue. Check the logs.",
        Result.repo ? [`• Attempted repo: \`${Result.repo}\``] : []
      );
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.item.channel, ReplyTS, FailureText);
      return true;
    } catch(error) {
      ArgSlackApp.Logger.error('[bug-reaction] failed:', error);
      const CatchErrorText = await BuildErrorReportAsync(
        ArgSlackApp,
        ArgEventInfo.item.channel,
        "Sorry - couldn't file the GitHub issue. Check the logs."
      );
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.item.channel, ReplyTS, CatchErrorText);
      return true;
    }
  }

  /**
   * Check whether a Slack message was authored by Sleuth itself.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').MessageInfo} ArgMessage Message information.
   * @param {import('./slack-app').MessageMetadata|null} ArgMessageMetadata Optional Slack metadata.
   * @returns {boolean}
   */
  #IsSleuthAuthoredMessage(ArgSlackApp, ArgMessage, ArgMessageMetadata) {
    if(typeof ArgMessageMetadata?.event_type === 'string' && ArgMessageMetadata.event_type.startsWith('sleuth-'))
      return true;

    const BotUserID = ArgSlackApp.BotUserID;
    return !!BotUserID && ArgMessage.user === BotUserID;
  }

  /**
   * Build the GitHub issue title from the reacted-to message. Reuses the shared clean-summary
   * extractor: it drops quote blocks + "Key task(s):" boilerplate, collapses whitespace, and
   * truncates to a readable length. A blind `slice(0, 15)` produced raw, mid-token-cut titles like
   * "A.) <@U072BF6K4" when a reminder-digest line was reacted to (issue #378). No AI synthesis —
   * still refinable by a human editing the issue.
   *
   * Callers must pass text already run through `ResolveMentionsForExternalDisplayAsync` (GH-428) —
   * any remaining `<@U...>`/`<url|label>`/`<!date…>` markup is stripped to a fallback form here,
   * not resolved to a name.
   * @param {string} ArgMessageText Sleuth message text, mentions already resolved to display names.
   * @returns {string}
   */
  #BuildBugReportIssueTitle(ArgMessageText) {
    if(!ArgMessageText || !ArgMessageText.trim()) return 'Sleuth bug report';
    const Title = SlackFormatUtils.ExtractCleanSummary(ArgMessageText, { maxLength: 72 });
    // ExtractCleanSummary is reminder-oriented: input that strips to empty (e.g. a quote-only
    // message) returns its 'Untitled reminder' fallback. Don't leak that wording into a bug title.
    return (!Title || Title === 'Untitled reminder') ? 'Sleuth bug report' : Title;
  }

  /**
   * Return the absolute path for the bug report log JSON file for this workspace.
   * @returns {string}
   */
  #GetBugReportsFilePath() {
    const WorkspaceName = this.#SlackApp.WorkspaceInfo.WORKSPACE_NAME;
    return Workspaces.GetSubdirPath('bugs', `${WorkspaceName}_bugs.json`);
  }

  /**
   * Load persisted GitHub bug report entries from disk.
   * Missing files are treated as empty logs.
   * @returns {Promise<Array<{
   *   Kind: string,
   *   WorkspaceName: string,
   *   ChannelID: string,
   *   MessageTS: string,
   *   ThreadRootTS?: string,
   *   ReportedByUserID?: string,
   *   ReportedByName?: string,
   *   GitHubIssueNumber?: number,
   *   GitHubIssueUrl?: string,
   *   GitHubRepo?: string,
   *   CreatedAt?: string
   * }>>}
   */
  async #LoadBugReportsAsync() {
    const FilePath = this.#GetBugReportsFilePath();

    try {
      const RawJson = await fs.readFile(FilePath, 'utf8');
      const Parsed = JSON.parse(RawJson);
      if(!Array.isArray(Parsed)) return [];

      return Parsed.filter((ArgEntry) => (
        ArgEntry
        && typeof ArgEntry.Kind === 'string'
        && typeof ArgEntry.WorkspaceName === 'string'
        && typeof ArgEntry.ChannelID === 'string'
        && typeof ArgEntry.MessageTS === 'string'
      ));
    } catch(error) {
      if(error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Persist GitHub bug report entries to disk.
   * @param {Array<object>} ArgEntries Bug report log entries.
   * @returns {Promise<void>}
   */
  async #SaveBugReportsAsync(ArgEntries) {
    const FilePath = this.#GetBugReportsFilePath();
    await fs.mkdir(path.dirname(FilePath), { recursive: true });
    await WriteFileDurableAsync(FilePath, JSON.stringify(ArgEntries, null, 2)); // crash-atomic (GH-12)
  }

  /**
   * Find an existing bug-report entry for a Slack message.
   * De-duplicates by workspace, channel, message ts, and Kind.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgChannelID Slack channel ID.
   * @param {string} ArgMessageTS Reacted Slack message ts.
   * @returns {Promise<{
   *   Kind: string,
   *   WorkspaceName: string,
   *   ChannelID: string,
   *   MessageTS: string,
   *   GitHubIssueNumber?: number,
   *   GitHubIssueUrl?: string
   * }|null>}
   */
  async #FindExistingBugReportAsync(ArgSlackApp, ArgChannelID, ArgMessageTS) {
    const WorkspaceName = ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME || 'unknown';
    const Entries = await this.#LoadBugReportsAsync();
    return Entries.find((ArgEntry) => (
      ArgEntry.Kind === 'bug'
      && ArgEntry.WorkspaceName === WorkspaceName
      && ArgEntry.ChannelID === ArgChannelID
      && ArgEntry.MessageTS === ArgMessageTS
    )) || null;
  }

  /**
   * Append a bug-report entry to the workspace log.
   * @param {{
   *   Kind: 'bug',
   *   WorkspaceName: string,
   *   ChannelID: string,
   *   MessageTS: string,
   *   ThreadRootTS: string,
   *   ReportedByUserID: string,
   *   ReportedByName: string,
   *   GitHubIssueNumber: number,
   *   GitHubIssueUrl: string,
   *   GitHubRepo: string,
   *   CreatedAt: string
   * }} ArgEntry Log entry to append.
   * @returns {Promise<void>}
   */
  async #AppendBugReportAsync(ArgEntry) {
    const Entries = await this.#LoadBugReportsAsync();
    Entries.push(ArgEntry);
    await this.#SaveBugReportsAsync(Entries);
  }

  /**
   * Build the GitHub issue body for a reacted-to Sleuth message.
   * `MessageText` must already be resolved via `ResolveMentionsForExternalDisplayAsync` (GH-428) —
   * this just lays out the fenced code block, it does not touch mention markup.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {{
   *   ChannelID: string,
   *   ChannelName: string|null,
   *   MessageText: string,
   *   MessageTS: string,
   *   ThreadRootTS: string,
   *   Permalink: string|null,
   *   ReportedByName: string,
   *   MessageMetadata: import('./slack-app').MessageMetadata|null
   * }} ArgIssueInfo Message context.
   * @returns {string}
   */
  #BuildBugReportIssueBody(ArgSlackApp, ArgIssueInfo) {
    const WorkspaceName = ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME || 'unknown';
    const ChannelLabel = ArgIssueInfo.ChannelName
      ? `#${ArgIssueInfo.ChannelName}`
      : ArgIssueInfo.ChannelID;
    const Lines = [
      '## Slack bug report',
      '',
      `**Workspace:** ${WorkspaceName}`,
      `**Channel:** ${ChannelLabel}`,
      `**Reported by:** ${ArgIssueInfo.ReportedByName}`,
      `**Message ts:** ${ArgIssueInfo.MessageTS}`,
      `**Thread root ts:** ${ArgIssueInfo.ThreadRootTS}`,
    ];

    if(typeof ArgIssueInfo.MessageMetadata?.event_type === 'string')
      Lines.push(`**Sleuth event type:** ${ArgIssueInfo.MessageMetadata.event_type}`);

    if(ArgIssueInfo.Permalink) {
      Lines.push('');
      Lines.push(`[View Slack message](${ArgIssueInfo.Permalink})`);
    }

    Lines.push('');
    Lines.push('## Sleuth message');
    Lines.push('');
    Lines.push('````');
    Lines.push(ArgIssueInfo.MessageText);
    Lines.push('````');
    Lines.push('');
    Lines.push('---');
    Lines.push('_Filed from Slack by Sleuth_');

    return Lines.join('\n');
  }

  /**
   * Check if the app should respond to a message based on thread context and reactions.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').MessageEventInfo} ArgEventInfo Message event information.
   * @returns {Promise<{ ShouldRespond: boolean, IsStopping?: boolean }>}
   */
  async #ShouldRespondToMessageAsync(ArgSlackApp, ArgEventInfo) {
    try {
      // a 1:1 DM is an inherently personal, user-initiated conversation — always respond, regardless
      // of mentions or thread state. This must run before the mention/thread checks below: those exist
      // to keep hands-free mode from firing in shared channels, but a DM has no other participants to
      // mention and no hands-free ceremony to opt into (GH-412).
      if(ArgEventInfo.channel_type === 'im') return { ShouldRespond: true, IsStopping: false };

      // we don't want to respond to messages that mention other users directly. NOTE: if the message mentions the
      // app directly, it will be handled by the app_mention event handler and we should never reach this point.
      if(ArgEventInfo.text.includes('<@')) return { ShouldRespond: false };

      // if the message is not part of a thread, then it is a top-level message and we only respond to those
      // if they mention the app directly which is handled by the app_mention event handler.
      if(!ArgEventInfo.thread_ts) return { ShouldRespond: false };

      // get all messages in the thread.
      const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(
        ArgEventInfo.channel, ArgEventInfo.thread_ts
      );

      // check if the first message in thread has an app mention (hands-free mode).
      const FirstMessage = ThreadMessages[0];
      const ThreadStartsWithMention = FirstMessage?.text.includes(ArgSlackApp.AppMentionString);

      // find the last bell/no_bell/octagonal_sign reaction in the thread to determine current state. Initially,
      // we auto-respond if the thread starts with an app mention, but this can be overridden by reactions below.
      let ShouldAutoRespond = ThreadStartsWithMention;

      // messages are ordered chronologically, so iterate through them to track state changes.
      for(const Message of ThreadMessages) {
        // we only care about messages with reactions so skip those without any.
        if(!Message.reactions) continue;

        // check for bell/no_bell/octagonal_sign reactions in this message. These control auto-response behavior.
        const HasBell = Message.reactions.includes('bell');
        const HasNoBell = Message.reactions.includes('no_bell');
        const HasStop = Message.reactions.includes('octagonal_sign');

        // update state based on reactions (last one wins). bell re-enables, no_bell and octagonal_sign disable.
        if(HasBell) ShouldAutoRespond = true;
        if(HasNoBell || HasStop) ShouldAutoRespond = false;
      }

      // return the final auto-response state.
      return { ShouldRespond: ShouldAutoRespond, IsStopping: false };
    } catch(error) {
      // log any errors that occur during message processing and return false to indicate that the event was not handled.
      ArgSlackApp.Logger.error("Error in ShouldRespondToMessageAsync:", error);
      return { ShouldRespond: false };
    }
  }

  /**
   * Return the absolute path for the thread memory JSON file for this workspace.
   * @returns {string}
   */
  #GetThreadMemoryFilePath() {
    const WorkspaceName = this.#SlackApp.WorkspaceInfo.WORKSPACE_NAME;
    return Workspaces.GetSubdirPath('context-memory', `${WorkspaceName}_thread_memory.json`);
  }

  /**
   * Load persisted thread context memory from disk into the in-memory map.
   * Missing files are silently ignored (first run or memory never populated).
   * @returns {Promise<void>}
   */
  async #LoadThreadMemoryAsync() {
    try {
      const FilePath = this.#GetThreadMemoryFilePath();
      const RawJson = await fs.readFile(FilePath, 'utf8');
      const Parsed = JSON.parse(RawJson);
      if(Parsed && typeof Parsed === 'object') {
        for(const [Key, Value] of Object.entries(Parsed)) {
          if(Value && typeof Value.filename === 'string' && typeof Value.content === 'string')
            this.#ThreadContextMemory.set(Key, { filename: Value.filename, content: Value.content });
        }
      }
      this.#SlackApp.Logger.info(`thread context memory loaded (${this.#ThreadContextMemory.size} entries).`);
    } catch(error) {
      if(error.code !== 'ENOENT')
        this.#SlackApp.Logger.error('failed to load thread context memory:', error);
    }
  }

  /**
   * Persist the current thread context memory map to disk.
   * @returns {Promise<void>}
   */
  async #SaveThreadMemoryAsync() {
    try {
      const FilePath = this.#GetThreadMemoryFilePath();
      await fs.mkdir(path.dirname(FilePath), { recursive: true });
      await WriteFileDurableAsync(FilePath, JSON.stringify(Object.fromEntries(this.#ThreadContextMemory))); // crash-atomic (GH-12)
    } catch(error) {
      this.#SlackApp.Logger.error('failed to save thread context memory:', error);
    }
  }

  /**
   * Single dispatch point for every Slack attachment (GH-62).
   *
   * Before this existed, `#OnAppMentionAsync` and `#OnMessageAsync` each reached for attachment
   * handling on their own: the text ingest ran first and unconditionally, and the image/OCR check
   * lived in a mutually exclusive `else` branch reached only when no attachment was recognized.
   * Because the text classifier reports an image as 'unsupported' — which counts as recognized —
   * the OCR branch was unreachable and GH-58's feature never ran in production. Routing every
   * attachment through one resolver here is what makes that class of bug structurally impossible
   * rather than merely fixed once.
   *
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo|import('./slack-app').MessageEventInfo} ArgEventInfo Event payload.
   * @param {string} ArgText Message text with the bot mention stripped.
   * @param {boolean} ArgSuppressConfirmation Suppress the "I've loaded…" post when question text
   *   accompanies the upload (same-turn context contamination fix).
   * @param {boolean} [ArgAllowCommandFallthrough] When true, an `unsupported` attachment whose text
   *   matches a registered command route is handed BACK to the caller instead of being rejected, so
   *   the caller can route it (GH-91). Only the app_mention path sets this, because it is the only
   *   caller that reaches `#CommandRouter.RouteAsync`; the message path would fall through to an AI
   *   answer instead, which is not what "route the command" means.
   * @returns {Promise<{ Handled: boolean, TextFileWasStored: boolean }>}
   *   `Handled` means the event is fully dealt with and the caller must stop. `TextFileWasStored`
   *   means a text file became thread context memory and the caller may continue to an AI answer.
   */
  async #HandleAttachmentAsync(ArgSlackApp, ArgEventInfo, ArgText, ArgSuppressConfirmation, ArgAllowCommandFallthrough = false) {
    const Intent = ResolveAttachmentIntent(ArgEventInfo.files, ArgText);

    if(Intent.Kind === 'none')
      return { Handled: false, TextFileWasStored: false };

    // Both image arms hand the resolved file straight through — re-selecting here could pick a
    // different attachment than the one this dispatch decision was made on.
    if(Intent.Kind === 'image-list') {
      await this.#TryProcessImageForListCreationAsync(ArgSlackApp, ArgEventInfo, ArgText, Intent.File);
      return { Handled: true, TextFileWasStored: false };
    }

    // GH-73: a scan-only intent stops after extraction and posts the text — it must never
    // materialize a Slack List. Reuses the explicit scan command's posting shape (bullets plus
    // the "convert" hint) so both entry points render identically.
    if(Intent.Kind === 'image-text') {
      await HandleScanImageCommandAsync(this.#SlackApp, ArgEventInfo, {
        ExtractTextFromImageAsync: (ArgScanSlackApp, ArgScanEvent) =>
          this.#ExtractListItemsFromImageAsync(ArgScanSlackApp, ArgScanEvent, 'Extract all text from this image.', Intent.File),
      });
      return { Handled: true, TextFileWasStored: false };
    }

    // GH-91: `unsupported` means the RESOLVER did not recognise the phrasing — not that the user
    // asked for nothing. Before this, an explicit command plus an image was the one case that could
    // never work: this returned Handled:true, the caller returned at the `if(AttachmentResult.Handled)`
    // line, and `#CommandRouter.RouteAsync` below it was unreachable. So `@Sleuth convert text into slack list`
    // with an image attached — the exact situation that command exists for — got the text-files-only
    // rejection. Hand the event back when a registered route matches, and let the router serve it.
    //
    // Scoped to 'unsupported' on purpose: a 'text' attachment is genuine context-memory input and
    // must keep being ingested even when the text also looks like a command.
    if(Intent.Kind === 'unsupported' && ArgAllowCommandFallthrough) {
      const MatchedRoute = this.#CommandRouter?.MatchRouteName(ArgText, ArgEventInfo);
      if(MatchedRoute) {
        ArgSlackApp.Logger.info(
          `[attachment] unsupported attachment but '${MatchedRoute}' matches — deferring to the command router`
        );
        return { Handled: false, TextFileWasStored: false };
      }
    }

    // 'text' and 'unsupported' are both owned by the context-memory ingest, which already posts
    // the right message for each case.
    const FileStoreResult = await this.#TryStoreThreadMemoryFileAsync(
      ArgSlackApp,
      ArgEventInfo,
      ArgSuppressConfirmation
    );

    if(FileStoreResult.FileWasStored)
      return { Handled: false, TextFileWasStored: true };

    return { Handled: true, TextFileWasStored: false };
  }

  /**
   * Detect an uploaded MD file in the event, download it, and store as thread context memory.
   * Only processes when the event is in a thread (thread_ts is set). Replaces any prior memory
   * for the same thread. Posts a confirmation reply on success, or an error reply on oversized files.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo|import('./slack-app').MessageEventInfo} ArgEventInfo Event payload.
   * @param {boolean} [ArgSuppressConfirmation] When true, skip the "I've loaded…" confirmation post.
   *   Pass true when question text is present alongside the upload so the confirmation does not
   *   contaminate the same-turn thread context that the AI will read immediately afterwards.
   * @returns {Promise<{ FoundContextFile: boolean, FileWasStored: boolean }>}
   *   `FoundContextFile` is true whenever an attachment was recognized as something to act on
   *   (a text file, an oversized/failed text file, or an unsupported binary) so the caller stops
   *   instead of falling through to an ungrounded AI answer.
   */
  async #TryStoreThreadMemoryFileAsync(ArgSlackApp, ArgEventInfo, ArgSuppressConfirmation = false) {
    // accept any text-readable attachment (Markdown, plain text, code, logs, CSV/JSON/YAML, SQL,
    // and Slack code snippets) — not just `.md`. See src/context-file-classifier.js for the rules.
    const Selection = SelectContextMemoryFile(ArgEventInfo.files);
    if(Selection.Kind === 'no-files')
      return { FoundContextFile: false, FileWasStored: false };

    const ReplyThreadTS = ArgEventInfo.thread_ts ?? ArgEventInfo.ts;

    // a file is attached but none of the attachments are text-readable (image, PDF, archive, etc.).
    // Tell the user explicitly instead of silently falling through to an ungrounded AI answer that
    // claims "I don't see any files" — the exact failure mode this method guards against.
    if(Selection.Kind === 'unsupported') {
      const UnsupportedFile = Selection.File;
      const Descriptor = IsBinaryMediaFile(UnsupportedFile) ? 'a binary' : 'an unsupported';
      ArgSlackApp.Logger.info(
        `[TryStoreThreadMemoryFile] ignoring ${Descriptor} attachment '${UnsupportedFile.name}' (mimetype: ${UnsupportedFile.mimetype || 'unknown'})`
      );
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ReplyThreadTS,
        `I can only read text-based files as context — Markdown, plain text, code, logs, CSV/JSON/YAML, SQL, and Slack code snippets. *${UnsupportedFile.name}* isn't a text file I can analyze.`
      );
      return { FoundContextFile: true, FileWasStored: false };
    }

    const ContextFile = Selection.File;

    const MaxFileSizeBytes = 200 * 1024;
    if(ContextFile.size > MaxFileSizeBytes) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ReplyThreadTS,
        `The file *${ContextFile.name}* is too large to use as context memory (max 200 KB). Please upload a smaller file.`
      );
      return { FoundContextFile: true, FileWasStored: false };
    }

    let Content = '';
    try {
      const DownloadURL = ContextFile.url_private_download ?? ContextFile.url_private;
      const DownloadHost = SlackApp.GetSafeUrlHostForLog(DownloadURL);
      ArgSlackApp.Logger.info(
        `[TryStoreThreadMemoryFile] url_private_download present: ${!!ContextFile.url_private_download} | host: ${DownloadHost}`
      );
      Content = await ArgSlackApp.GetFileContentAsync(DownloadURL);
    } catch(error) {
      ArgSlackApp.Logger.error(`failed to download context memory file '${ContextFile.name}':`, error);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ReplyThreadTS,
        `I couldn't download *${ContextFile.name}* right now (Slack file access failed). Please try uploading it again.`
      );
      return { FoundContextFile: true, FileWasStored: false };
    }

    if(LooksLikeHtmlErrorPage(Content)) {
      ArgSlackApp.Logger.error(`context memory file '${ContextFile.name}' returned HTML — likely unauthenticated redirect`);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ReplyThreadTS,
        `I couldn't read *${ContextFile.name}* — Slack returned a page instead of the file content. Please try uploading it again.`
      );
      return { FoundContextFile: true, FileWasStored: false };
    }

    const ThreadKey = `${ArgEventInfo.channel}:${ArgEventInfo.thread_ts ?? ArgEventInfo.ts}`;
    this.#ThreadContextMemory.set(ThreadKey, { filename: ContextFile.name, content: Content });
    await this.#SaveThreadMemoryAsync();

    if(!ArgSuppressConfirmation) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ReplyThreadTS,
        `I've loaded *${ContextFile.name}* as context memory for this thread. I'll reference it in every response here.`
      );
    }
    return { FoundContextFile: true, FileWasStored: true };
  }

  /**
   * Build a log-safe summary for inbound chat events that may include Slack file metadata.
   * @param {import('./slack-app').AppMentionEventInfo|import('./slack-app').MessageEventInfo} ArgEventInfo Event payload.
   * @returns {{ channel: string, user: string, ts: string, thread_ts?: string, text: string, files?: Array<{ name: string, size: number, host: string, hasDownloadUrl: boolean }> }}
   */
  static #BuildSafeInboundEventLogInfo(ArgEventInfo) {
    return {
      channel: ArgEventInfo.channel,
      user: ArgEventInfo.user,
      ts: ArgEventInfo.ts,
      thread_ts: ArgEventInfo.thread_ts,
      text: ArgEventInfo.text,
      files: ArgEventInfo.files?.map((ArgFile) => ({
        name: ArgFile.name,
        size: ArgFile.size,
        host: SlackApp.GetSafeUrlHostForLog(ArgFile.url_private_download ?? ArgFile.url_private ?? ''),
        hasDownloadUrl: !!ArgFile.url_private_download,
      })),
    };
  }

  /**
   * Gather context from a Slack thread.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgChannelID Channel ID where the thread is located.
   * @param {string} ArgThreadTS Timestamp of the parent message of the thread.
   * @returns {Promise<string>}
   */
  async #GatherThreadContextAsync(ArgSlackApp, ArgChannelID, ArgThreadTS) {
    // get all the messages in the thread.
    const ThreadMessages = await ArgSlackApp.GetConversationMessagesAsync(ArgChannelID, ArgThreadTS);

    // concatenate all the messages in the thread into a single message.
    const ThreadText = ThreadMessages.reduce((ArgAccumulatedText, ArgCurrentMessage) => {
      // compose the message text according to the structure described in the chat-instructions.md file. These
      // details are used to provide context to the AI model so it can answer questions based on the context
      // (e.g. "Summarize everything said by @UserX in this thread").
      const MessageText =
        `Message Sender ID: <@${ArgCurrentMessage.user}>\n` +
        `Message Sender Role: ${ArgCurrentMessage.bot_id ? "assistant" : "user"}\n` +
        `Message Sent On: ${new Date(Number(ArgCurrentMessage.ts) * 1000).toUTCString()}\n` +
        `Message Text (Triple Quoted): """\n${ArgCurrentMessage.text}\n"""`;

      // return the accumulated text with the current message appended and separated by a line of dashes.
      return ArgAccumulatedText + MessageText + `\n${"-".repeat(5)}\n`;
    }, "");

    // prepend context memory file content if one has been stored for this thread.
    const MemoryKey = `${ArgChannelID}:${ArgThreadTS}`;
    const Memory = this.#ThreadContextMemory.get(MemoryKey);
    if(!Memory) return ThreadText;

    const MemoryPrefix =
      `=== Context Memory File: ${Memory.filename} ===\n` +
      `${Memory.content}\n` +
      `=== End Context Memory ===\n\n`;
    return MemoryPrefix + ThreadText;
  }

  /**
   * Prepare chat system instructions by replacing placeholders so they are ready to be sent to the OpenAI chat API.
   * @returns {Promise<string>}
   */
  async #PrepareSystemInstructionsAsync() {
    // load the system instructions template if not already loaded.
    if(!this.#SystemInstructionsTemplate) {
      // build the file path dynamically (this assumes we are in the /src folder and are looking for the file in
      // the /data/static/ai folder, both of which are rooted in the project folder).
      const TargetFilePath = path.join(__dirname, '..', 'data', 'static', 'ai', 'chat-instructions.md');

      // read the file, replace static placeholders which don't change at runtime and cache the result.
      let TargetInstructions = await fs.readFile(TargetFilePath, 'utf8');
      TargetInstructions = TargetInstructions.replace('{{OPENAI_MODEL_NAME}}', this.#WorkspaceAI.DefaultModelName);
      this.#SystemInstructionsTemplate = TargetInstructions;
    }

    // replace dynamic placeholders and return the resulting system instructions without modifying the template.
    return this.#SystemInstructionsTemplate.replace('{{CURRENT_DATETIME_UTC}}', new Date().toISOString());
  }

  /**
   * Format message text to ensure compatibility with Slack formatting.
   * @param {string} ArgMessageText Message text to format (received from OpenAI).
   * @returns {string}
   */
  #FormatMessageForSlack(ArgMessageText) {
    // the Context Memory File block (see #GatherThreadContextAsync and chat-instructions.md) is input-only context
    // that the model is told never to echo. Defensively strip any leaked block — and any orphaned marker lines — so
    // the internal delimiters never reach Slack even if the model parrots them back.
    let FormattedText = ArgMessageText
      .replace(/===\s*Context Memory File:[\s\S]*?===\s*End Context Memory\s*===\n*/g, '')
      .replace(/^[ \t]*===\s*(?:Context Memory File:.*|End Context Memory)\s*===[ \t]*\n?/gm, '')
      .replace(/^\s+/, '');

    // sometimes the model uses three hashes to indicate a heading, which is not supported in Slack. We need to replace
    // the three hashes with something that will make the text stand out in Slack (we'll strip the hashes, wrap the text
    // in asterisks to make it bold, and prefix it with :point_right: emoji).
    FormattedText = FormattedText.replace(/### (.+)$/gm, ':point_right: *$1*');

    // sometimes the model uses double asterisks to indicate bold text, which is not supported in Slack. We need to
    // replace the double asterisks with the appropriate Slack syntax for bold text. NOTE: since we may add asterisks
    // in the previous step, we generally replace two or more asterisks with a single asterisk to avoid making the text
    // too bold.
    FormattedText = FormattedText.replace(/\*{2,}/g, '*');

    // return the formatted text.
    return FormattedText;
  }

  /**
   * Run Vision OCR over an image attachment and return the structured items (GH-58, split out in
   * GH-64). Downloads via SlackApp.DownloadFileBase64Async, then runs
   * WorkspaceAI.ProcessMultimodalMessageWithJsonResponseAsync against the
   * ocr-list-extraction-instructions/schema pair.
   *
   * Extraction is deliberately separate from list materialization so `scan image for text` can
   * stop here while the list route continues — one extraction implementation, two consumers.
   * Every failure posts its own specific message before returning `{ ok: false }`, so callers
   * must not post a second, vaguer one.
   *
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
   * @param {string} [ArgCommandTextRaw] Raw (mention-stripped) command text used as the prompt.
   * @param {import('./slack-app').SlackFileInfo|null} [ArgImageFile] The image already chosen by
   *   `ResolveAttachmentIntent`. Passed through so the dispatch path does not re-run selection and
   *   risk picking a different attachment than the one it routed on (agy relay review r1). Callers
   *   without a resolved file (the explicit `scan image for text` command) omit it and selection
   *   falls back to the same helper the resolver uses.
   * @returns {Promise<{ ok: boolean, Title?: string, Items?: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }> }>}
   */
  async #ExtractListItemsFromImageAsync(ArgSlackApp, ArgEventInfo, ArgCommandTextRaw, ArgImageFile = null) {
    const ReplyTS = ArgEventInfo.thread_ts ?? ArgEventInfo.ts;
    const ImageSelection = ArgImageFile || SelectImageAttachment(ArgEventInfo.files);
    if(!ImageSelection) {
      ArgSlackApp.Logger.warn('[ocr-list] no image attachment found in files array.');
      return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'I did not find an image attachment to process.');
    }

    try {
      // Step 1: download the image as base64.
      const DownloadURL = ImageSelection.url_private_download || ImageSelection.url_private;
      if(!DownloadURL) {
        ArgSlackApp.Logger.error('[ocr-list] image missing url_private_download/url_private.');
        return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'Could not access the image file for processing.');
      }

      let DownloadResult;
      try {
        DownloadResult = await ArgSlackApp.DownloadFileBase64Async(DownloadURL);
      } catch(downloadError) {
        ArgSlackApp.Logger.error(`[ocr-list] failed to download image '${ImageSelection.name}':`, downloadError);
        return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'Failed to download the image. Please try uploading it again.');
      }

      if(!DownloadResult || !DownloadResult.Base64) {
        ArgSlackApp.Logger.warn('[ocr-list] DownloadFileBase64Async returned empty result.');
        return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'The image file appeared to be empty.');
      }

      ArgSlackApp.Logger.info(
        `[ocr-list] downloaded image ${ImageSelection.name} (${ImageSelection.mimetype}, ${(DownloadResult.Base64 || '').length} base64 chars)`
      );

      // GH-83: Vision OCR takes 10-30s, during which the thread showed nothing at all and the user
      // could not tell a slow run from a dropped one. Posted AFTER the download rather than on entry
      // so a fetch failure never leaves a promise the next message contradicts. Best-effort: an ack
      // that fails must not abort the extraction it is only narrating.
      try {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ReplyTS,
          '🔍 Reading your image — this usually takes 10-30 seconds.'
        );
      } catch(ackError) {
        ArgSlackApp.Logger.warn(`[ocr-list] could not post the in-progress ack: ${ackError.message}`);
      }

      // Step 2: load OCR instructions + schema from disk.
      let InstructionsText;
      let SchemaObject;
      try {
        InstructionsText = await fs.readFile(
          path.join(__dirname, '..', 'data', 'static', 'ai', 'ocr-list-extraction-instructions.md'),
          'utf8'
        );
      } catch(readError) {
        ArgSlackApp.Logger.error('[ocr-list] could not read OCR instruction file:', readError);
        return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'OCR instruction file is missing on the server.');
      }
      try {
        const SchemaPath = path.join(__dirname, '..', 'data', 'static', 'ai', 'ocr-list-extraction-schema.json');
        SchemaObject = JSON.parse(await fs.readFile(SchemaPath, 'utf8'));
      } catch(schemaError) {
        ArgSlackApp.Logger.error('[ocr-list] could not read OCR schema file:', schemaError);
        return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'OCR schema file is missing on the server.');
      }

      // Step 3: run Gemini Vision OCR via WorkspaceAI.
      /** @type {{ title?: string, items?: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }> }} */
      let OcrResult;
      try {
        // GH-63: no explicit model — WorkspaceAI pins a vision-capable one. Passing the workspace
        // default here is what made OCR fail permanently on Claude/GPT-default workspaces.
        OcrResult = await this.#WorkspaceAI.ProcessMultimodalMessageWithJsonResponseAsync(
          ArgCommandTextRaw || 'Extract all list items from this image.',
          InstructionsText.trim(),
          SchemaObject,
          { Base64: DownloadResult.Base64, Mimetype: DownloadResult.Mimetype }
        );
      } catch(ocrError) {
        ArgSlackApp.Logger.error('[ocr-list] Gemini Vision OCR failed:', ocrError);
        // GH-63: a missing Gemini credential is permanent, not transient. Telling the user to
        // "try again later" invites a retry that can never succeed and hides the real fix.
        const IsConfigurationFailure = ocrError
          && (ocrError.code === 'vision_provider_not_configured' || ocrError.code === 'provider_not_configured');
        return this.#FailOcrAsync(
          ArgSlackApp,
          ArgEventInfo.channel,
          ReplyTS,
          IsConfigurationFailure
            ? "Image OCR needs a Gemini model, which isn't configured for this workspace. Ask a workspace admin to add a Gemini API key."
            : 'Image analysis failed — please try again later.',
          [
            '• AI Provider: Google Gemini',
            `• Model: \`${this.#WorkspaceAI?.DefaultModelName || 'unknown'}\``,
          ]
        );
      }

      const ExtractedItems = (OcrResult && Array.isArray(OcrResult.items)) ? OcrResult.items : [];
      if(ExtractedItems.length === 0) {
        ArgSlackApp.Logger.info('[ocr-list] model returned zero extracted items.');
        return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, "I didn't detect any list items in that image. Try another screenshot with clearer text.");
      }

      return {
        ok: true,
        Title: (OcrResult && typeof OcrResult.title === 'string') ? OcrResult.title : 'Extracted List',
        Items: ExtractedItems,
      };
    } catch(unexpectedError) {
      ArgSlackApp.Logger.error('[ocr-list] unexpected failure during extraction:', unexpectedError);
      return this.#FailOcrAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, 'Something went wrong while reading that image.');
    }
  }

  /**
   * Post an OCR extraction failure message and yield the not-ok result (GH-76).
   *
   * Deliberately minimal: it centralizes ONLY the repeated posting + return mechanics. Each call
   * site keeps its own log level, diagnostic message, and error object, and the GH-63
   * permanent-vs-transient message choice stays at the site that knows the error code. There is
   * intentionally no catch boundary and no logging here — a variadic do-everything helper would be
   * harder to audit than the duplication it removes.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgChannelID Channel to post the failure message to.
   * @param {string} ArgReplyTS Thread timestamp to reply in (already computed by the caller).
   * @param {string} ArgUserMessage User-facing failure message, already selected by the caller.
   * @param {string[]} [ArgContextLines] Extra contextual diagnostic lines for this failure (GH-88).
   * @returns {Promise<{ ok: false }>}
   */
  async #FailOcrAsync(ArgSlackApp, ArgChannelID, ArgReplyTS, ArgUserMessage, ArgContextLines = []) {
    // GH-88: every OCR failure carries the diagnostics baseline. This is the ONLY place that
    // happens for this route — which is exactly why GH-76 collapsed the seven duplicated failure
    // blocks into this helper first. Attaching the baseline at nine call sites would have
    // reintroduced the duplication GH-76 removed.
    const FullErrorMsg = await BuildErrorReportAsync(
      ArgSlackApp,
      ArgChannelID,
      ArgUserMessage,
      ArgContextLines
    );
    await ArgSlackApp.PostMessageTextAsync(ArgChannelID, ArgReplyTS, FullErrorMsg);
    return { ok: false };
  }

  /**
   * Materialize OCR-extracted items into a Slack List (GH-58; separated from extraction in GH-64).
   * `ListsModule.CreateListFromExtractedItemsAsync` stays the single materialization seam, shared
   * by the image route and the text→list command.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
   * @param {string} ArgTitle List title.
   * @param {Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }>} ArgItems Extracted items.
   * @returns {Promise<boolean>} true when the event was handled.
   */
  async #MaterializeListFromItemsAsync(ArgSlackApp, ArgEventInfo, ArgTitle, ArgItems) {
    const ReplyTS = ArgEventInfo.thread_ts ?? ArgEventInfo.ts;
    const ExtractedItems = ArgItems;
    // agy relay review r1: the extraction result was previously re-wrapped as `{ title: ArgTitle }`
    // purely so the lifted body could keep reading `OcrResult.title`. The title is already a
    // parameter — read it directly rather than carrying a shim that outlives the refactor.
    const ListTitle = (typeof ArgTitle === 'string' && ArgTitle.trim().length > 0)
      ? ArgTitle
      : 'Extracted List';

    try {
      // Step 4: create the Slack List via ListsModule — injected directly at construction (GH-75),
      // no longer reached through RemindersModule. Nullable: the Lists integration is optional.
      /** @type {import('./lists-module')|null} */
      const ListsModuleInstance = this.#ListsModule;
      if(!ListsModuleInstance || typeof ListsModuleInstance.CreateListFromExtractedItemsAsync !== 'function') {
        ArgSlackApp.Logger.warn('[ocr-list] ListsModule not available (not configured for this workspace).');
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ReplyTS,
          'Slack Lists is not configured for this workspace yet. The items have been extracted but the list could not be created.'
        );
        // Still post the extracted items summary so the user sees what was parsed.
        await this.#PostExtractedItemsSummaryAsync(ArgSlackApp, ArgEventInfo.channel, ReplyTS, ListTitle, ExtractedItems);
        return true;
      }

      let ListResult;
      try {
        ListResult = await ListsModuleInstance.CreateListFromExtractedItemsAsync({
          ListTitle,
          Items: ExtractedItems,
          ChannelID: ArgEventInfo.channel,
          UserID: ArgEventInfo.user,
          ThreadTS: ReplyTS,
        });
      } catch(listError) {
        ArgSlackApp.Logger.error('[ocr-list] failed to create Slack List:', listError);
        const FullErrorMsg = await BuildErrorReportAsync(
          ArgSlackApp,
          ArgEventInfo.channel,
          'Failed to create the Slack List. Check the logs for details.'
        );
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ReplyTS,
          FullErrorMsg
        );
        return true;
      }

      if(!ListResult || !ListResult.ok) {
        ArgSlackApp.Logger.warn(`[ocr-list] create-list returned ok:false — ${ListResult?.error || 'unknown error'}`);
        const FullErrorMsg = await BuildErrorReportAsync(
          ArgSlackApp,
          ArgEventInfo.channel,
          'List creation failed: ' + (ListResult?.error || 'unknown error.')
        );
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ReplyTS,
          FullErrorMsg
        );
        return true;
      }

      // Step 5: success. ListsModule already posted "📋 New OCR list created: <link|title>" into
      // this thread, which renders the list card — so this is a FALLBACK, not the normal path
      // (GH-83). It previously always fired, giving the user two confirmations for one list: a
      // linked one from ListsModule in the channel and a raw-list-ID one here in the thread, whose
      // `<a|url>` was reversed mrkdwn that rendered as literal text. Announce only what the other
      // path could not.
      const ItemCount = ListResult.ItemCount ?? ExtractedItems.length;
      if(!ListResult.Announced) {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ReplyTS,
          ListResult.Permalink
            ? `✅ Created <${ListResult.Permalink}|${ListTitle}> with ${ItemCount} item(s).`
            : `✅ Created "${ListTitle}" with ${ItemCount} item(s) (permalink unavailable).`
        );
      }

      ArgSlackApp.Logger.info(
        `[ocr-list] list created successfully: id=${ListResult.ListId} items=${ItemCount}`
      );
      return true;
    } catch(error) {
      ArgSlackApp.Logger.error('[ocr-list] unexpected error:', error);
      const FullErrorMsg = await BuildErrorReportAsync(
        ArgSlackApp,
        ArgEventInfo.channel,
        'An unexpected error occurred during image processing.'
      );
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ReplyTS,
        FullErrorMsg
      );
      return true;
    }
  }

  /**
   * Extract structured list items from plain text (GH-64).
   *
   * Reuses `ocr-list-extraction-schema.json` — the same contract the image route uses — so both
   * entry points produce one item shape and feed the same materialization seam. Uses the
   * workspace's normal text model, not the pinned vision model: no image is involved, so there is
   * no multimodal requirement and pinning would needlessly narrow provider choice.
   *
   * @param {string} ArgSourceText Text to convert into list items.
   * @returns {Promise<{ ok: boolean, Title?: string, Items?: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }> }>}
   */
  async #ExtractItemsFromTextAsync(ArgSourceText) {
    const InstructionsText = await fs.readFile(
      path.join(__dirname, '..', 'data', 'static', 'ai', 'ocr-list-extraction-instructions.md'),
      'utf8'
    );
    const SchemaObject = JSON.parse(await fs.readFile(
      path.join(__dirname, '..', 'data', 'static', 'ai', 'ocr-list-extraction-schema.json'),
      'utf8'
    ));

    /** @type {{ title?: string, items?: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }> }} */
    const Result = await this.#WorkspaceAI.ProcessMessageWithJsonResponseAsync(
      ArgSourceText,
      InstructionsText.trim(),
      SchemaObject
    );

    const Items = (Result && Array.isArray(Result.items)) ? Result.items : [];
    return {
      ok: Items.length > 0,
      Title: (Result && typeof Result.title === 'string') ? Result.title : 'Extracted List',
      Items,
    };
  }

  /**
   * Image → Slack List, composed from the two seams above (GH-58 behavior, GH-64 structure).
   * Kept as one method because the unified attachment dispatch and the natural-language route both
   * want the whole journey; the explicit `scan image for text` command stops after extraction.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
   * @param {string} ArgCommandTextRaw Raw (mention-stripped) command text.
   * @param {import('./slack-app').SlackFileInfo|null} [ArgImageFile] Image already resolved by the
   *   unified dispatch, threaded through so selection happens exactly once per event.
   * @returns {Promise<boolean>} true when the event was handled.
   */
  async #TryProcessImageForListCreationAsync(ArgSlackApp, ArgEventInfo, ArgCommandTextRaw, ArgImageFile = null) {
    const Extraction = await this.#ExtractListItemsFromImageAsync(ArgSlackApp, ArgEventInfo, ArgCommandTextRaw, ArgImageFile);
    if(!Extraction.ok) return true;
    return this.#MaterializeListFromItemsAsync(
      ArgSlackApp,
      ArgEventInfo,
      Extraction.Title,
      Extraction.Items
    );
  }

  /**
   * Fallback: post extracted items as a plain-text summary in Slack when ListsModule is unavailable.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string} ArgChannelID Target channel ID.
   * @param {string} ArgReplyTS Thread root timestamp.
   * @param {string} ArgTitle List title.
   * @param {Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }>} ArgItems Extracted item objects.
   * @returns {Promise<void>}
   */
  async #PostExtractedItemsSummaryAsync(ArgSlackApp, ArgChannelID, ArgReplyTS, ArgTitle, ArgItems) {
    const Lines = [`*${ArgTitle}* — ${ArgItems.length} item(s):`];
    for(const Item of ArgItems.slice(0, 20)) {
      const Num = Item.item_number != null ? `[${Item.item_number}] ` : '';
      const Text = Item.text || '';
      const Amt = Item.amount ? ` (${Item.amount})` : '';
      const Notes = Item.notes ? ` — ${Item.notes}` : '';
      Lines.push(`${Num}*${Text}*${Amt}${Notes}`);
    }
    if(ArgItems.length > 20) Lines.push(`\n_…and ${ArgItems.length - 20} more._`);
    await ArgSlackApp.PostMessageTextAsync(ArgChannelID, ArgReplyTS, Lines.join('\n'));
  }
}

// export the class.
module.exports = ChatModule;
