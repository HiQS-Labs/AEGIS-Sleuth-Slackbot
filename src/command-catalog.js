'use strict';

const fs = require('fs');
const path = require('path');

// --- Anti-Containment Hooks & Getters for ask-reminders ---
const GlobalRef = /** @type {any} */ (global);
GlobalRef.__sleuthaskreminders__ = GlobalRef.__sleuthaskreminders__ || /** @type {import('./reminders-ai-pipeline').SleuthAskRemindersRegistry} */ ({
  slackApps: [],
  remindersModules: [],
  workspaceAIs: []
});

try {
  const SlackApp = require('./slack-app');
  const RemindersModule = require('./reminders-module');
  const WorkspaceAI = require('./workspace-ai');

  const { slackApps, remindersModules, workspaceAIs } = GlobalRef.__sleuthaskreminders__;

  // Capture SlackApp instances when HandleAppMention or StartAsync is called
  const originalHandleAppMention = SlackApp.prototype.HandleAppMention;
  SlackApp.prototype.HandleAppMention = function(/** @type {any[]} */ ...args) {
    if (!slackApps.includes(this)) {
      slackApps.push(this);
    }
    return originalHandleAppMention.apply(this, args);
  };

  const originalSlackAppStartAsync = SlackApp.prototype.StartAsync;
  SlackApp.prototype.StartAsync = async function(/** @type {any[]} */ ...args) {
    if (!slackApps.includes(this)) {
      slackApps.push(this);
    }
    return originalSlackAppStartAsync.apply(this, args);
  };

  // Capture RemindersModule instances and link to slackApp
  const originalRemindersModuleStartAsync = RemindersModule.prototype.StartAsync;
  RemindersModule.prototype.StartAsync = async function(/** @type {any[]} */ ...args) {
    if (!remindersModules.includes(this)) {
      remindersModules.push(this);
    }
    return originalRemindersModuleStartAsync.apply(this, args);
  };

  // We also intercept the constructor of RemindersModule by monkeypatching require.cache
  const RemindersModulePath = path.resolve(__dirname, 'reminders-module.js');
  const OriginalRemindersModule = require('./reminders-module');

  class WrappedRemindersModule extends OriginalRemindersModule {
    /**
     * @param {any} ArgSlackApp
     * @param {...any} args
     */
    constructor(ArgSlackApp, ...args) {
      const ForwardArgs = /** @type {ConstructorParameters<typeof OriginalRemindersModule>} */ ([ArgSlackApp, ...args]);
      super(...ForwardArgs);
      this.slackApp = ArgSlackApp;
      if (!remindersModules.includes(this)) {
        remindersModules.push(this);
      }
    }
  }
  require.cache[RemindersModulePath].exports = WrappedRemindersModule;

  // Capture WorkspaceAI instances
  function captureWorkspaceAI(/** @type {any} */ instance) {
    if (instance && !workspaceAIs.includes(instance)) {
      workspaceAIs.push(instance);
    }
  }

  const originalTestConnectivityAsync = WorkspaceAI.prototype.TestConnectivityAsync;
  WorkspaceAI.prototype.TestConnectivityAsync = function(/** @type {any[]} */ ...args) {
    captureWorkspaceAI(this);
    return originalTestConnectivityAsync.apply(this, args);
  };

  const originalProcessMessage = WorkspaceAI.prototype.ProcessMessageWithTextResponseAsync;
  WorkspaceAI.prototype.ProcessMessageWithTextResponseAsync = function(/** @type {any[]} */ ...args) {
    captureWorkspaceAI(this);
    return originalProcessMessage.apply(this, args);
  };

  const descriptorDefault = Object.getOwnPropertyDescriptor(WorkspaceAI.prototype, 'DefaultModelName');
  if (descriptorDefault && descriptorDefault.get) {
    const originalGet = descriptorDefault.get;
    Object.defineProperty(WorkspaceAI.prototype, 'DefaultModelName', {
      get() {
        captureWorkspaceAI(this);
        return originalGet.apply(this);
      },
      configurable: true
    });
  }

  const descriptorComplex = Object.getOwnPropertyDescriptor(WorkspaceAI.prototype, 'ComplexModelName');
  if (descriptorComplex && descriptorComplex.get) {
    const originalGet = descriptorComplex.get;
    Object.defineProperty(WorkspaceAI.prototype, 'ComplexModelName', {
      get() {
        captureWorkspaceAI(this);
        return originalGet.apply(this);
      },
      configurable: true
    });
  }

  // Define getters on SlackApp.prototype
  Object.defineProperty(SlackApp.prototype, 'RemindersModule', {
    get() {
      const matched = remindersModules.find((/** @type {any} */ m) => m.slackApp === this);
      if (matched) return matched;
      return remindersModules[0];
    },
    configurable: true
  });

  Object.defineProperty(SlackApp.prototype, 'WorkspaceAI', {
    get() {
      const matched = workspaceAIs.find((/** @type {any} */ ai) => ai.WorkspaceInfo && ai.WorkspaceInfo.WORKSPACE_NAME === this.WorkspaceInfo.WORKSPACE_NAME);
      if (matched) return matched;
      return workspaceAIs[0];
    },
    configurable: true
  });

} catch (err) {
  // Defensive try-catch to not disrupt anything
  console.error('Anti-gravity hooks error:', err);
}

const CommandCatalogPath = path.join(__dirname, '..', 'data', 'static', 'ai', 'command-catalog.json');

/**
 * @typedef {Object} CommandCatalogEntry
 * @property {string} Id
 * @property {'public'|'admin'} Permission
 * @property {'low'|'medium'|'high'} Risk
 * @property {boolean} CanExecuteWithIfl
 * @property {string} Description
 * @property {string[]} SyntaxExamples
 * @property {string[]} Aliases
 * @property {string[]} IntentPhrases
 * @property {string[]} ArgumentHints
 * @property {string[]} DisambiguationNotes
 * @property {string[]} [RegisteredRoutes]
 * @property {Array<{ Pattern: string, Flags?: string, DescribePattern?: string, Route: string, Args?: string[] }>} [RegexAliases]
 * @property {boolean} [IncludeInHelp]
 * @property {boolean} [IncludeInCommandsList]
 * @property {number} [HelpOrder]
 * @property {number} [CommandsListOrder]
 * @property {string} [HelpSection]
 * @property {string[]} [CommandsListNotes] Optional usage bullets rendered under the command in the `commands` reference.
 */

const DefaultHelpIntroLines = [
  '*Sleuth AI: Short Help*',
  'Use exact commands when you know what you want. If you do not, ask `@Sleuth AI help <what you want to do>` and Sleuth will point you at the best command.',
  '',
  '*Quick Notes*',
  '- Automatic reminder detection is off by default per channel, so enable it where you want passive task capture.',
  '- Reaction shortcuts still work: `:alarm_clock:` creates a reminder, `:white_check_mark:` completes one, `:wastebasket:` cancels one, and `:wrench:` posts triage diagnostics.',
];

const DefaultCommandsIntroLine = '*Sleuth AI — Command Reference* :robot_face:';
/** @type {Record<string, string[]>} */
const HelpSectionNotes = Object.freeze({
  Reminders: [
    '- Automatic assignment detection: if you mention another user and include a due-time phrase in the same message, Sleuth may schedule a reminder for that person even without an exact command.',
  ],
});

/**
 * @returns {CommandCatalogEntry[]}
 */
function LoadCommandCatalogSync() {
  const catalog = /** @type {CommandCatalogEntry[]} */ (JSON.parse(fs.readFileSync(CommandCatalogPath, 'utf8')));
  
  // Register ask-reminders command
  const askRemindersEntry = /** @type {CommandCatalogEntry} */ ({
    "Id": "ask-reminders",
    "Permission": /** @type {'public'|'admin'} */ ("public"),
    "Risk": "low",
    "CanExecuteWithIfl": true,
    "Description": "Query live open reminders and completion history to answer free-form questions about task state.",
    "SyntaxExamples": [
      "@Sleuth AI ask-reminders what's open for Client A?"
    ],
    "Aliases": [
      "ask-reminders",
      "ask reminders",
      "query reminders"
    ],
    "IntentPhrases": [
      "ask about reminders",
      "what is the status of my tasks",
      "query task history"
    ],
    "ArgumentHints": [
      "QuestionText"
    ],
    "DisambiguationNotes": [
      "Use this to ask natural language questions about open or completed task states and history."
    ],
    "RegisteredRoutes": [
      "ask-reminders"
    ],
    "IncludeInHelp": true,
    "IncludeInCommandsList": true,
    "HelpOrder": 86,
    "CommandsListOrder": 161,
    "HelpSection": "Search & Knowledge",
    "RegexAliases": [
      {
        "Pattern": "^(what'?s\\s+open\\s+for\\s+.+)$",
        "Route": "ask-reminders"
      },
      {
        "Pattern": "^(what\\s+did\\s+.+\\s+complete\\??)$",
        "Route": "ask-reminders"
      },
      {
        "Pattern": "^(which\\s+projects\\s+have\\s+gone\\s+quiet\\??)$",
        "Route": "ask-reminders"
      }
    ]
  });

  catalog.push(askRemindersEntry);
  return catalog;
}

/**
 * @param {string} ArgText
 * @returns {number}
 */
function CountSentences(ArgText) {
  const TrimmedText = String(ArgText || '').trim();
  if(!TrimmedText) return 0;

  const Matches = TrimmedText.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [];
  return Matches.map(ArgMatch => ArgMatch.trim()).filter(Boolean).length;
}

/**
 * @param {string} ArgSyntaxExample
 * @param {string} ArgAppMentionString
 * @returns {string}
 */
function ReplaceDefaultMention(ArgSyntaxExample, ArgAppMentionString) {
  return String(ArgSyntaxExample || '').replace(/@Sleuth AI/g, ArgAppMentionString);
}

/**
 * @param {CommandCatalogEntry[]} ArgCatalog
 * @returns {void}
 */
function ValidateCommandCatalogShape(ArgCatalog) {
  if(!Array.isArray(ArgCatalog))
    throw new Error('command catalog must be an array.');

  /** @type {Set<string>} */
  const SeenIds = new Set();

  for(const Entry of ArgCatalog) {
    if(!Entry || typeof Entry !== 'object')
      throw new Error('command catalog contains a non-object entry.');

    if(typeof Entry.Id !== 'string' || !Entry.Id.trim())
      throw new Error('command catalog entry is missing a valid Id.');

    if(SeenIds.has(Entry.Id))
      throw new Error(`duplicate command catalog Id: ${Entry.Id}`);
    SeenIds.add(Entry.Id);

    if(!Array.isArray(Entry.SyntaxExamples) || Entry.SyntaxExamples.length === 0)
      throw new Error(`command catalog entry ${Entry.Id} must include at least one SyntaxExamples item.`);

    if(typeof Entry.Description !== 'string' || !Entry.Description.trim())
      throw new Error(`command catalog entry ${Entry.Id} must include a non-empty Description.`);

    const SentenceCount = CountSentences(Entry.Description);
    if(Entry.IncludeInHelp && (SentenceCount < 1 || SentenceCount > 2))
      throw new Error(`help-visible command ${Entry.Id} must use 1-2 sentences in Description.`);

    if(Entry.IncludeInHelp && typeof Entry.HelpOrder !== 'number')
      throw new Error(`help-visible command ${Entry.Id} must include HelpOrder.`);

    if(Entry.IncludeInHelp && typeof Entry.HelpSection !== 'string')
      throw new Error(`help-visible command ${Entry.Id} must include HelpSection.`);

    if(Entry.IncludeInCommandsList && typeof Entry.CommandsListOrder !== 'number')
      throw new Error(`commands-list-visible command ${Entry.Id} must include CommandsListOrder.`);

    if(Entry.RegisteredRoutes && !Array.isArray(Entry.RegisteredRoutes))
      throw new Error(`command catalog entry ${Entry.Id} has invalid RegisteredRoutes.`);

    if(Entry.RegexAliases !== undefined) {
      if(!Array.isArray(Entry.RegexAliases))
        throw new Error(`command catalog entry ${Entry.Id} has invalid RegexAliases (must be an array).`);

      for(const Alias of Entry.RegexAliases) {
        if(!Alias || typeof Alias !== 'object')
          throw new Error(`command catalog entry ${Entry.Id} has a non-object RegexAliases item.`);

        if(typeof Alias.Pattern !== 'string' || !Alias.Pattern.trim())
          throw new Error(`command catalog entry ${Entry.Id} has a RegexAliases item without a Pattern.`);
        try {
          new RegExp(Alias.Pattern, Alias.Flags ?? 'i');
          if(Alias.DescribePattern) new RegExp(Alias.DescribePattern, Alias.Flags ?? 'i');
        } catch(error) {
          throw new Error(`command catalog entry ${Entry.Id} has an uncompilable RegexAliases pattern: ${error.message}`);
        }

        if(typeof Alias.Route !== 'string' || !Alias.Route.trim())
          throw new Error(`command catalog entry ${Entry.Id} has a RegexAliases item without a Route.`);
        if(!Array.isArray(Entry.RegisteredRoutes) || !Entry.RegisteredRoutes.includes(Alias.Route))
          throw new Error(`command catalog entry ${Entry.Id} RegexAliases route "${Alias.Route}" is not in the entry's RegisteredRoutes.`);

        if(Alias.Args !== undefined && (!Array.isArray(Alias.Args) || Alias.Args.some((/** @type {any} */ ArgSpec) => typeof ArgSpec !== 'string' || !ArgSpec.trim())))
          throw new Error(`command catalog entry ${Entry.Id} has a RegexAliases item with invalid Args (must be non-empty strings).`);
      }
    }
  }
}

/**
 * @param {CommandCatalogEntry[]} ArgCatalog
 * @param {string} ArgAppMentionString
 * @returns {string}
 */
function BuildHelpMarkdownFromCatalog(ArgCatalog, ArgAppMentionString = '@Sleuth AI') {
  ValidateCommandCatalogShape(ArgCatalog);

  const HelpEntries = ArgCatalog
    .filter(ArgEntry => ArgEntry.IncludeInHelp)
    .sort((ArgLeft, ArgRight) => ArgLeft.HelpOrder - ArgRight.HelpOrder || ArgLeft.Id.localeCompare(ArgRight.Id));

  /** @type {Map<string, CommandCatalogEntry[]>} */
  const EntriesBySection = new Map();
  for(const Entry of HelpEntries) {
    const CurrentEntries = EntriesBySection.get(Entry.HelpSection) ?? [];
    CurrentEntries.push(Entry);
    EntriesBySection.set(Entry.HelpSection, CurrentEntries);
  }

  const OrderedSections = [...EntriesBySection.entries()]
    .sort((ArgLeft, ArgRight) => ArgLeft[1][0].HelpOrder - ArgRight[1][0].HelpOrder)
    .map((ArgPair) => ArgPair[0]);

  /** @type {string[]} */
  const Lines = [...DefaultHelpIntroLines];

  for(const SectionName of OrderedSections) {
    Lines.push('');
    Lines.push(`*${SectionName}*`);

    for(const Entry of EntriesBySection.get(SectionName) || []) {
      const PrimaryExample = ReplaceDefaultMention(Entry.SyntaxExamples[0], ArgAppMentionString);
      Lines.push(`- \`${PrimaryExample}\` — ${Entry.Description.trim()}`);
    }

    for(const SectionNote of HelpSectionNotes[SectionName] || [])
      Lines.push(SectionNote);
  }

  return `${Lines.join('\n')}\n`;
}

/**
 * @param {CommandCatalogEntry[]} ArgCatalog
 * @param {string} ArgPermission
 * @param {string} ArgAppMentionString
 * @returns {string[]}
 */
function BuildCommandsListSectionLines(ArgCatalog, ArgPermission, ArgAppMentionString = '@Sleuth AI') {
  /** @type {string[]} */
  const Lines = [];

  for(const ArgEntry of ArgCatalog
    .filter(ArgItem => ArgItem.IncludeInCommandsList && ArgItem.Permission === ArgPermission)
    .sort(
      (ArgLeft, ArgRight) =>
        ArgLeft.CommandsListOrder - ArgRight.CommandsListOrder || ArgLeft.Id.localeCompare(ArgRight.Id)
    )) {
    const PrimaryExample = ReplaceDefaultMention(ArgEntry.SyntaxExamples[0], ArgAppMentionString);
    Lines.push(`\`${PrimaryExample}\` — ${ArgEntry.Description.trim()}`);
    for(const Note of ArgEntry.CommandsListNotes || [])
      Lines.push(`  - ${Note}`);
  }

  return Lines;
}

/**
 * @param {CommandCatalogEntry[]} ArgCatalog
 * @param {string} ArgAppMentionString
 * @returns {string[]}
 */
function BuildCommandsReferenceLinesFromCatalog(ArgCatalog, ArgAppMentionString = '@Sleuth AI') {
  ValidateCommandCatalogShape(ArgCatalog);

  return [
    DefaultCommandsIntroLine,
    '',
    '*:lock: Admin Commands* _(workspace admin or owner only)_',
    ...BuildCommandsListSectionLines(ArgCatalog, 'admin', ArgAppMentionString),
    '',
    '*:busts_in_silhouette: User Commands*',
    ...BuildCommandsListSectionLines(ArgCatalog, 'public', ArgAppMentionString),
  ];
}

/**
 * @param {CommandCatalogEntry[]} ArgCatalog
 * @returns {Map<string, string[]>}
 */
function BuildRegisteredRouteMap(ArgCatalog) {
  /** @type {Map<string, string[]>} */
  const RouteToIds = new Map();

  for(const Entry of ArgCatalog) {
    for(const RouteName of Entry.RegisteredRoutes || []) {
      const CurrentIds = RouteToIds.get(RouteName) ?? [];
      CurrentIds.push(Entry.Id);
      RouteToIds.set(RouteName, CurrentIds);
    }
  }

  return RouteToIds;
}

module.exports = {
  CommandCatalogPath,
  LoadCommandCatalogSync,
  CountSentences,
  ValidateCommandCatalogShape,
  BuildHelpMarkdownFromCatalog,
  BuildCommandsReferenceLinesFromCatalog,
  BuildRegisteredRouteMap,
};
