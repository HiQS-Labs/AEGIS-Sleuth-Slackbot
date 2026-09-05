'use strict';

const fs = require('fs').promises;
const path = require('path');
const { RenderSnapshotContextLines } = require('./workspace-snapshot');
const { GetProviderDescriptorForModel } = require('./ai-providers');

/** @typedef {import('./workspace-ai')} WorkspaceAI */

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
 * @property {boolean} [IncludeInHelp]
 * @property {boolean} [IncludeInCommandsList]
 * @property {number} [HelpOrder]
 * @property {number} [CommandsListOrder]
 * @property {string} [HelpSection]
 */

/**
 * @typedef {Object} DirectCommandPatternEntry
 * @property {string} IntentId
 * @property {string} Pattern
 * @property {string[]} Arguments
 */

/**
 * @typedef {Object} CommandNormalizationConfig
 * @property {Array<{ Match: string, Replace: string }>} ModelAliases
 * @property {DirectCommandPatternEntry[]} DirectCommandPatterns
 */

/**
 * @typedef {Object} RmmIntentResponse
 * @property {string} intent_id
 * @property {number} confidence
 * @property {string} rationale
 * @property {boolean} needs_clarification
 * @property {string} clarification_question
 * @property {string} default_model_name
 * @property {string} complex_model_name
 * @property {string} channel_model_name
 * @property {string} query_text
 * @property {string} user_mention
 */

/**
 * @typedef {Object} RmmResolutionResult
 * @property {string|null} IntentId
 * @property {string|null} CanonicalCommand Set when the LLM picked an intent AND every required argument
 *   was supplied — the command is ready to suggest or execute.
 * @property {string|null} SyntaxTemplate Set when the LLM picked an intent but at least one required
 *   argument was empty (e.g. "how do I change models?"). Holds the command syntax with bracketed
 *   placeholders such as `switch-models:'<model>'` so the renderer can show the user what to type
 *   instead of asking for clarification. Mutually exclusive with CanonicalCommand.
 * @property {CommandCatalogEntry|null} CatalogEntry
 * @property {number} Confidence
 * @property {string} Rationale
 * @property {boolean} NeedsClarification
 * @property {string} ClarificationQuestion
 * @property {string[]} NormalizationNotes
 * @property {CommandCatalogEntry[]} CandidateEntries
 */

const AssetsBasePath = path.join(__dirname, '..', 'data', 'static', 'ai');

/** @type {CommandCatalogEntry[]|null} */
let CachedCommandCatalog = null;
/** @type {CommandNormalizationConfig|null} */
let CachedNormalizationConfig = null;
/** @type {string|null} */
let CachedRmmInstructions = null;
/** @type {import('./workspace-ai').ResponseSchema|null} */
let CachedRmmSchema = null;
/** @type {Array<{ IntentId: string, CanonicalCommand: string, Pattern: RegExp }>|null} */
let CachedArgumentInvariantCommands = null;

/**
 * @returns {Promise<void>}
 */
async function LoadCommandIntentAssetsAsync() {
  if(!CachedCommandCatalog) {
    const CommandCatalogText = await fs.readFile(path.join(AssetsBasePath, 'command-catalog.json'), 'utf8');
    CachedCommandCatalog = JSON.parse(CommandCatalogText);
  }

  if(!CachedNormalizationConfig) {
    const NormalizationText = await fs.readFile(path.join(AssetsBasePath, 'command-normalization.json'), 'utf8');
    CachedNormalizationConfig = JSON.parse(NormalizationText);
  }

  if(!CachedRmmInstructions)
    CachedRmmInstructions = await fs.readFile(path.join(AssetsBasePath, 'rmm-instructions.md'), 'utf8');

  if(!CachedRmmSchema) {
    const RmmSchemaText = await fs.readFile(path.join(AssetsBasePath, 'rmm-schema.json'), 'utf8');
    CachedRmmSchema = JSON.parse(RmmSchemaText);
  }
}

/**
 * @param {string} ArgValue
 * @returns {string}
 */
function EscapeRegex(ArgValue) {
  return ArgValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} ArgPhrase
 * @returns {RegExp}
 */
function BuildWholePhraseRegex(ArgPhrase) {
  const Segments = ArgPhrase.trim().split(/\s+/).map(EscapeRegex);
  return new RegExp(`\\b${Segments.join('\\s+')}\\b`, 'ig');
}

/**
 * @param {string} ArgText
 * @returns {string}
 */
function NormalizeFreeformText(ArgText) {
  return String(ArgText || '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize free-form command text. GH-168: model aliases are NO LONGER substituted here —
 * substituting a phrase anywhere in the text let a `chatgpt 5` row rewrite the inside of
 * `chatgpt 5.6 terra`, and it destroyed the raw value the executor needs to report
 * "resolved from '…'". Model fields are resolved as whole values by ResolveModelAlias at the
 * executor handlers instead. `Notes` is kept in the return shape for the callers that render it.
 * @param {string} ArgText
 * @param {CommandNormalizationConfig} ArgNormalizationConfig
 * @returns {{ NormalizedText: string, Notes: string[] }}
 */
function ApplyNormalizationRules(ArgText, ArgNormalizationConfig) { // eslint-disable-line no-unused-vars
  return {
    NormalizedText: NormalizeFreeformText(ArgText),
    Notes: [],
  };
}

/**
 * @param {string} ArgValue
 * @returns {string}
 */
function SanitizeSingleQuotedValue(ArgValue) {
  return String(ArgValue || '').trim().replace(/'/g, '');
}

/**
 * Leading vendor words a user may prefix a model phrase with, and the provider a stripped-prefix
 * retry must land on. `openai claude opus` strips to `claude opus` -> an Anthropic pin, which is a
 * provider mismatch -> refused, never a cross-vendor switch (GH-168, Codex round 2).
 * @type {Array<{ Pattern: RegExp, ProviderId: string }>}
 */
const VendorPrefixProviders = [
  { Pattern: /^open\s?ai\s+/, ProviderId: 'openai' },
  { Pattern: /^anthropic\s+/, ProviderId: 'anthropic' },
  { Pattern: /^google\s+/, ProviderId: 'gemini' },
];

/** @type {Map<string, string>|null} */
let CachedModelAliasMap = null;

/**
 * Entire-value alias map (lower-cased `Match` -> `Replace`), first table row wins on a duplicate.
 * @param {CommandNormalizationConfig} ArgNormalizationConfig
 * @returns {Map<string, string>}
 */
function GetModelAliasMap(ArgNormalizationConfig) {
  if(CachedModelAliasMap) return CachedModelAliasMap;
  const AliasMap = new Map();
  for(const Row of ArgNormalizationConfig.ModelAliases || []) {
    const Key = NormalizeFreeformText(Row.Match).toLowerCase();
    const Value = String(Row.Replace || '').trim();
    if(Key && Value && !AliasMap.has(Key)) AliasMap.set(Key, Value);
  }
  CachedModelAliasMap = AliasMap;
  return AliasMap;
}

/**
 * Resolve a user-typed model field to a model ID (GH-168). Staged, field-only, entire-value:
 *   1. the whole value is a declared alias -> its pin;
 *   2. else strip ONE leading vendor word and retry, accepted only when the pin belongs to that
 *      vendor's provider;
 *   3. else unchanged — an exact ID, or an unknown name the catalog validator will refuse.
 * No substring replacement anywhere: a declared key can never rewrite part of a longer value, so
 * "exact always wins" needs no separate guard.
 * @param {string} ArgValue Raw model field (quotes already stripped by the command regex).
 * @param {CommandNormalizationConfig} ArgNormalizationConfig
 * @returns {{ ModelId: string, Note: string|null }} `Note` is `'<raw> -> <pin>'` when an alias fired.
 */
function ResolveModelAlias(ArgValue, ArgNormalizationConfig) {
  const Raw = SanitizeSingleQuotedValue(NormalizeFreeformText(ArgValue));
  if(!Raw) return { ModelId: '', Note: null };

  const AliasMap = GetModelAliasMap(ArgNormalizationConfig);
  const Key = Raw.toLowerCase();
  const Direct = AliasMap.get(Key);
  if(Direct) return { ModelId: Direct, Note: `${Raw} -> ${Direct}` };

  for(const Vendor of VendorPrefixProviders) {
    const Match = Key.match(Vendor.Pattern);
    if(!Match) continue;
    const Rest = Key.slice(Match[0].length).trim();
    const Pin = Rest ? AliasMap.get(Rest) : undefined;
    const Descriptor = Pin ? GetProviderDescriptorForModel(Pin) : null;
    if(Pin && Descriptor && Descriptor.Id === Vendor.ProviderId) return { ModelId: Pin, Note: `${Raw} -> ${Pin}` };
    break; // ponytail: a stripped prefix that does not land on its own vendor is a refusal, not a guess
  }

  return { ModelId: Raw, Note: null };
}

/**
 * Executor-facing alias resolution — loads the table on first use.
 * @param {string} ArgValue
 * @returns {Promise<{ ModelId: string, Note: string|null }>}
 */
async function ResolveModelAliasAsync(ArgValue) {
  await LoadCommandIntentAssetsAsync();
  return ResolveModelAlias(ArgValue, /** @type {CommandNormalizationConfig} */ (CachedNormalizationConfig));
}

/**
 * The loaded alias table, for display (the `models` command). File I/O once; no provider I/O.
 * @returns {Promise<Array<{ Match: string, Replace: string }>>}
 */
async function GetModelAliasRowsAsync() {
  await LoadCommandIntentAssetsAsync();
  return (CachedNormalizationConfig?.ModelAliases || []).map((ArgRow) => ({ Match: ArgRow.Match, Replace: ArgRow.Replace }));
}

/**
 * @param {string} ArgIntentId
 * @returns {Promise<CommandCatalogEntry|null>}
 */
async function GetCommandCatalogEntryByIdAsync(ArgIntentId) {
  await LoadCommandIntentAssetsAsync();
  return CachedCommandCatalog?.find((ArgEntry) => ArgEntry.Id === ArgIntentId) || null;
}

/**
 * @param {string} ArgIntentId
 * @param {{
 *   DefaultModelName?: string,
 *   ComplexModelName?: string,
 *   ChannelModelName?: string,
 *   QueryText?: string,
 *   UserMention?: string
 * }} [ArgArguments]
 * @returns {string|null}
 */
function BuildCanonicalCommand(ArgIntentId, ArgArguments = {}) {
  if(!CachedNormalizationConfig)
    throw new Error('command normalization config must be loaded before building canonical commands.');

  // GH-168: model fields are passed through RAW (quotes stripped, whitespace collapsed) so the
  // executor handler can resolve the alias and say what it resolved from.
  const DefaultModelName = SanitizeSingleQuotedValue(NormalizeFreeformText(ArgArguments.DefaultModelName || ''));
  const ComplexModelName = SanitizeSingleQuotedValue(NormalizeFreeformText(ArgArguments.ComplexModelName || ''));
  const ChannelModelName = SanitizeSingleQuotedValue(NormalizeFreeformText(ArgArguments.ChannelModelName || ''));
  const QueryText = String(ArgArguments.QueryText || '').trim().replace(/\s+/g, ' ');
  const UserMention = String(ArgArguments.UserMention || '').trim();

  switch(ArgIntentId) {
  case 'help-features':
    return 'help';
  case 'commands':
    return 'commands';
  case 'run-diagnostics':
    return 'run-diagnostics';
  case 'show-rebalance-reminders':
    return 'show-rebalance-reminders';
  case 'show-rebalance-reminders-formatted':
    return 'show-rebalance-reminders-formatted';
  case 'restart':
    return 'restart';
  case 'run-daily-digest':
    return 'run daily digest';
  case 'models':
    return 'models';
  case 'show-channel-model':
    return 'show-channel-model';
  case 'clear-channel-model':
    return 'clear-channel-model';
  case 'web-search':
    return QueryText ? `web-search ${QueryText}` : null;
  case 'gemini-search':
    return QueryText ? `gemini-search ${QueryText}` : null;
  case 'notion-search':
    return QueryText ? `notion search ${QueryText}` : null;
  case 'search-reminders':
    return QueryText ? `search reminders ${QueryText}` : null;
  case 'search-projects':
    // PROJECT is the implicit keyword, so this is runnable with no trailing query.
    return QueryText ? `search-projects ${QueryText}` : 'search-projects';
  case 'search-reminders-for-user':
    if(!UserMention || !QueryText) return null;
    return `search reminders for ${UserMention} ${QueryText}`;
  case 'search-reminders-here':
    return QueryText ? `search reminders here ${QueryText}` : null;
  case 'search-my-reminders':
    return QueryText ? `search my reminders ${QueryText}` : null;
  case 'show-reminders':
    return 'show reminders';
  case 'show-reminders-for-user':
    return UserMention ? `show reminders for ${UserMention}` : null;
  case 'show-reminders-here':
    return 'show reminders here';
  case 'show-github-reminders':
    return 'show reminders github';
  case 'show-my-reminders':
    return 'show my reminders';
  case 'summarize-week':
    return 'summarize week';
  case 'enable-reminders':
    return 'enable reminders';
  case 'disable-reminders':
    return 'disable reminders';
  case 'process-reminders-now':
    return 'process reminders now';
  case 'github-sync-now':
    return 'sync-github';
  case 'test-github-sync':
    return QueryText ? `test github sync ${QueryText}` : 'test github sync';
  case 'show-stats':
    return 'show-stats';
  case 'ping':
    return 'ping';
  case 'set-channel-model':
    return ChannelModelName ? `set-channel-model:'${ChannelModelName}'` : null;
  case 'model-switch-default':
    return DefaultModelName ? `switch-models:'${DefaultModelName}'` : null;
  case 'model-switch-complex':
    return ComplexModelName ? `switch-models:complex='${ComplexModelName}'` : null;
  case 'model-switch-both':
    if(!DefaultModelName || !ComplexModelName) return null;
    return `switch-models:default='${DefaultModelName}',complex='${ComplexModelName}'`;
  case 'version':
    return 'version';
  case 'changelog':
    return 'changelog';
  case 'view-stratalist':
    return QueryText ? `view stratalist ${QueryText}` : null;
  case 'rmm':
    return QueryText ? `rmm ${QueryText}` : null;
  case 'ask-code':
    return QueryText ? `ask-code ${QueryText}` : null;
  case 'recall':
    return QueryText ? `recall ${QueryText}` : null;
  default:
    return null;
  }
}

/**
 * Return a placeholder-bearing syntax template for an intent that takes arguments. Used when
 * the LLM picks an intent confidently but the user did not supply the argument value (the
 * "how do I X?" discovery path). For no-arg intents this returns null because BuildCanonicalCommand
 * already produces a runnable command without arguments.
 *
 * @param {string} ArgIntentId
 * @returns {string|null}
 */
function BuildSyntaxTemplate(ArgIntentId) {
  switch(ArgIntentId) {
  case 'set-channel-model':
    return "set-channel-model:'<model>'";
  case 'model-switch-default':
    return "switch-models:'<model>'";
  case 'model-switch-complex':
    return "switch-models:complex='<model>'";
  case 'model-switch-both':
    return "switch-models:default='<model>',complex='<model>'";
  case 'web-search':
    return 'web-search <topic>';
  case 'gemini-search':
    return 'gemini-search <topic>';
  case 'notion-search':
    return 'notion search <keywords>';
  case 'search-reminders':
    return 'search reminders <keywords>';
  case 'search-reminders-for-user':
    return 'search reminders for @user <keywords>';
  case 'search-reminders-here':
    return 'search reminders here <keywords>';
  case 'search-my-reminders':
    return 'search my reminders <keywords>';
  case 'show-reminders-for-user':
    return 'show reminders for @user';
  case 'test-github-sync':
    return 'test github sync <github-url>';
  case 'view-stratalist':
    return 'view stratalist <list-slug-or-url>';
  case 'rmm':
    return 'rmm <request>';
  case 'ask-code':
    return 'ask-code <project> <question>';
  case 'recall':
    return 'recall <keywords>';
  default:
    return null;
  }
}

/**
 * @param {string} ArgCommandText
 * @returns {Promise<{ NormalizedText: string, Notes: string[] }>}
 */
async function NormalizeDirectCommandTextAsync(ArgCommandText) {
  await LoadCommandIntentAssetsAsync();

  const NormalizedResult = ApplyNormalizationRules(ArgCommandText, CachedNormalizationConfig);

  for(const InvariantCommand of RetrieveArgumentInvariantCommands()) {
    if(!InvariantCommand.Pattern.test(NormalizedResult.NormalizedText))
      continue;

    return {
      NormalizedText: InvariantCommand.CanonicalCommand,
      Notes: NormalizedResult.Notes,
    };
  }

  for(const PatternEntry of CachedNormalizationConfig.DirectCommandPatterns) {
    const Match = NormalizedResult.NormalizedText.match(new RegExp(PatternEntry.Pattern, 'i'));
    if(!Match) continue;

    /** @type {{ DefaultModelName?: string, ComplexModelName?: string, ChannelModelName?: string }} */
    const Arguments = {};
    for(let Index = 0; Index < PatternEntry.Arguments.length; Index++) {
      const ArgumentName = PatternEntry.Arguments[Index];
      const ArgumentValue = Match[Index + 1] || '';
      if(ArgumentName === 'DefaultModelName') Arguments.DefaultModelName = ArgumentValue;
      if(ArgumentName === 'ComplexModelName') Arguments.ComplexModelName = ArgumentValue;
      if(ArgumentName === 'ChannelModelName') Arguments.ChannelModelName = ArgumentValue;
    }

    const CanonicalCommand = BuildCanonicalCommand(PatternEntry.IntentId, Arguments);
    if(CanonicalCommand) {
      return {
        NormalizedText: CanonicalCommand,
        Notes: NormalizedResult.Notes,
      };
    }
  }

  return NormalizedResult;
}

/**
 * @param {string} ArgText
 * @returns {string[]}
 */
function TokenizeText(ArgText) {
  return NormalizeFreeformText(ArgText)
    .toLowerCase()
    .split(/[^a-z0-9.:-]+/)
    .map((ArgToken) => ArgToken.trim())
    .filter((ArgToken) => ArgToken.length >= 2);
}

/**
 * @param {string} ArgHaystack
 * @param {string} ArgNeedle
 * @returns {boolean}
 */
function IncludesWholePhrase(ArgHaystack, ArgNeedle) {
  return BuildWholePhraseRegex(ArgNeedle).test(ArgHaystack);
}

/**
 * @param {CommandCatalogEntry} ArgEntry
 * @param {string} ArgNormalizedText
 * @param {Set<string>} ArgTokens
 * @returns {number}
 */
function ScoreCommandEntry(ArgEntry, ArgNormalizedText, ArgTokens) {
  let Score = 0;
  const EntryText = [
    ArgEntry.Description,
    ...ArgEntry.SyntaxExamples,
    ...ArgEntry.Aliases,
    ...ArgEntry.IntentPhrases,
    ...ArgEntry.ArgumentHints,
    ...ArgEntry.DisambiguationNotes,
  ].join(' ').toLowerCase();

  for(const Phrase of [...ArgEntry.Aliases, ...ArgEntry.IntentPhrases]) {
    const LowerPhrase = Phrase.toLowerCase();
    if(IncludesWholePhrase(ArgNormalizedText, LowerPhrase)) Score += Math.max(6, LowerPhrase.split(/\s+/).length * 3);
  }

  for(const Token of ArgTokens) {
    if(ArgEntry.Id.toLowerCase().includes(Token)) Score += 2;
    if(EntryText.includes(Token)) Score += 1;
  }

  return Score;
}

/**
 * @param {string} ArgNormalizedText
 * @returns {CommandCatalogEntry[]}
 */
function RetrieveCandidateCommands(ArgNormalizedText) {
  const Tokens = new Set(TokenizeText(ArgNormalizedText));
  const ScoredEntries = CachedCommandCatalog
    .map((ArgEntry) => ({ Entry: ArgEntry, Score: ScoreCommandEntry(ArgEntry, ArgNormalizedText.toLowerCase(), Tokens) }))
    .sort((ArgA, ArgB) => ArgB.Score - ArgA.Score || ArgA.Entry.Id.localeCompare(ArgB.Entry.Id));

  const PositiveMatches = ScoredEntries.filter((ArgItem) => ArgItem.Score > 0).map((ArgItem) => ArgItem.Entry);
  if(PositiveMatches.length > 0) return PositiveMatches.slice(0, 6);

  return CachedCommandCatalog.slice(0, 6);
}

/**
 * Like RetrieveCandidateCommands, but surfaces the deterministic `{ Entry, Score }` pairs instead of
 * discarding the score, and loads catalog assets on demand so it is safe to call standalone. The score
 * is the cheap, no-LLM signal that separates "wrong syntax for a real command" (high score) from genuine
 * off-topic chat (~0). Used by the Phase 0 near-miss probe and the Phase 2-lite deterministic "did you
 * mean?" tier (see PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md).
 * @param {string} ArgText Raw or normalized request text.
 * @returns {Promise<Array<{ Entry: CommandCatalogEntry, Score: number }>>} all entries, sorted high→low by Score.
 */
async function RetrieveScoredCandidates(ArgText) {
  await LoadCommandIntentAssetsAsync();
  const { NormalizedText } = ApplyNormalizationRules(ArgText, CachedNormalizationConfig);
  const Tokens = new Set(TokenizeText(NormalizedText));
  return CachedCommandCatalog
    .map((ArgEntry) => ({ Entry: ArgEntry, Score: ScoreCommandEntry(ArgEntry, NormalizedText.toLowerCase(), Tokens) }))
    .sort((ArgA, ArgB) => ArgB.Score - ArgA.Score || ArgA.Entry.Id.localeCompare(ArgB.Entry.Id));
}

/**
 * @param {CommandCatalogEntry[]} ArgEntries
 * @returns {string}
 */
function BuildCandidateContext(ArgEntries) {
  return ArgEntries.map((ArgEntry) => {
    const Lines = [
      `ID: ${ArgEntry.Id}`,
      `Permission: ${ArgEntry.Permission}`,
      `Risk: ${ArgEntry.Risk}`,
      `CanExecuteWithIfl: ${ArgEntry.CanExecuteWithIfl ? 'yes' : 'no'}`,
      `Description: ${ArgEntry.Description}`,
      `SyntaxExamples: ${ArgEntry.SyntaxExamples.join(' | ')}`,
      `Aliases: ${ArgEntry.Aliases.join(' | ')}`,
      `IntentPhrases: ${ArgEntry.IntentPhrases.join(' | ')}`,
      `ArgumentHints: ${ArgEntry.ArgumentHints.join(', ') || '(none)'}`,
      `DisambiguationNotes: ${ArgEntry.DisambiguationNotes.join(' | ')}`,
    ];
    return Lines.join('\n');
  }).join('\n\n');
}

/**
 * @param {WorkspaceAI} ArgWorkspaceAI
 * @param {string} ArgUserText
 * @param {{
 *   ChannelID?: string,
 *   ChannelModelStatus?: { override: string|null, defaultModel: string, effectiveModel: string },
 *   RequestMode?: 'suggest'|'execute',
 *   ModelNameOverride?: string,
 *   WorkspaceSnapshot?: import('./workspace-snapshot').WorkspaceSnapshot
 * }} [ArgOptions]
 * @returns {Promise<RmmResolutionResult>}
 */
async function ResolveRmmIntentAsync(ArgWorkspaceAI, ArgUserText, ArgOptions = {}) {
  await LoadCommandIntentAssetsAsync();

  const NormalizedResult = ApplyNormalizationRules(ArgUserText, CachedNormalizationConfig);
  const CandidateEntries = RetrieveCandidateCommands(NormalizedResult.NormalizedText);
  const ChannelModelStatus = ArgOptions.ChannelModelStatus;
  const ContextLines = [
    `request_mode: ${ArgOptions.RequestMode || 'suggest'}`,
    `normalized_request: ${NormalizedResult.NormalizedText}`,
    `workspace_default_model: ${ArgWorkspaceAI.DefaultModelName}`,
    `workspace_complex_model: ${ArgWorkspaceAI.ComplexModelName}`,
    `channel_id: ${ArgOptions.ChannelID || ''}`,
    `channel_override_model: ${ChannelModelStatus?.override || ''}`,
    `channel_effective_model: ${ChannelModelStatus?.effectiveModel || ''}`,
    `normalization_notes: ${NormalizedResult.Notes.join(' | ') || '(none)'}`,
    '',
    'candidate_commands:',
    BuildCandidateContext(CandidateEntries),
  ];

  // GH-405: the router closure (chat-module.js) opt-passes a cached, token-bounded workspace snapshot
  // ONLY when ROUTER_SNAPSHOT_ENABLED is on. Appended here so the resolver stays snapshot-agnostic for
  // every other caller (rmm / rmm ifl / help) — when the opt is absent the context is byte-identical to
  // before this feature existed.
  if(ArgOptions.WorkspaceSnapshot) {
    ContextLines.push(...RenderSnapshotContextLines(ArgOptions.WorkspaceSnapshot));
  }

  const AiResponse = /** @type {RmmIntentResponse} */ (await ArgWorkspaceAI.ProcessMessageWithJsonResponseAsync(
    ContextLines.join('\n'),
    CachedRmmInstructions,
    CachedRmmSchema,
    // GH-397: shadow/active router mode forces a specific model (default gemini-3.1-flash-lite);
    // every other caller omits the override and keeps the incumbent complex model.
    ArgOptions.ModelNameOverride || ArgWorkspaceAI.ComplexModelName
  ));

  const IntentId = typeof AiResponse.intent_id === 'string' ? AiResponse.intent_id.trim() : '';
  const NeedsClarification = !!AiResponse.needs_clarification || IntentId === 'clarify';
  const ClarificationQuestion = typeof AiResponse.clarification_question === 'string'
    ? AiResponse.clarification_question.trim()
    : '';
  const Rationale = typeof AiResponse.rationale === 'string' ? AiResponse.rationale.trim() : '';
  const Confidence = typeof AiResponse.confidence === 'number' ? AiResponse.confidence : 0;
  const CatalogEntry = CandidateEntries.find((ArgEntry) => ArgEntry.Id === IntentId)
    || CachedCommandCatalog.find((ArgEntry) => ArgEntry.Id === IntentId)
    || null;

  if(NeedsClarification || !CatalogEntry) {
    return {
      IntentId: null,
      CanonicalCommand: null,
      SyntaxTemplate: null,
      CatalogEntry,
      Confidence,
      Rationale,
      NeedsClarification: true,
      ClarificationQuestion: ClarificationQuestion || 'Which exact Sleuth action do you want me to map this to?',
      NormalizationNotes: NormalizedResult.Notes,
      CandidateEntries,
    };
  }

  const CanonicalCommand = BuildCanonicalCommand(IntentId, {
    DefaultModelName: AiResponse.default_model_name,
    ComplexModelName: AiResponse.complex_model_name,
    ChannelModelName: AiResponse.channel_model_name,
    QueryText: AiResponse.query_text,
    UserMention: AiResponse.user_mention,
  });

  // Discovery path: the LLM picked an intent but did not fill in the required argument
  // (e.g. user asked "how do I change models?"). Surface the syntax template instead of
  // demanding clarification — see rmm-instructions.md rule 2a.
  if(!CanonicalCommand) {
    const SyntaxTemplate = BuildSyntaxTemplate(IntentId);
    if(SyntaxTemplate) {
      return {
        IntentId,
        CanonicalCommand: null,
        SyntaxTemplate,
        CatalogEntry,
        Confidence,
        Rationale,
        NeedsClarification: false,
        ClarificationQuestion: '',
        NormalizationNotes: NormalizedResult.Notes,
        CandidateEntries,
      };
    }

    return {
      IntentId: null,
      CanonicalCommand: null,
      SyntaxTemplate: null,
      CatalogEntry,
      Confidence,
      Rationale,
      NeedsClarification: true,
      ClarificationQuestion: ClarificationQuestion || 'I need a bit more detail before I can build the exact Sleuth command.',
      NormalizationNotes: NormalizedResult.Notes,
      CandidateEntries,
    };
  }

  return {
    IntentId,
    CanonicalCommand,
    SyntaxTemplate: null,
    CatalogEntry,
    Confidence,
    Rationale,
    NeedsClarification: false,
    ClarificationQuestion: '',
    NormalizationNotes: NormalizedResult.Notes,
    CandidateEntries,
  };
}

/**
 * Every intent ID that has a case in BuildCanonicalCommand. Keep this in sync with the switch
 * above — validate-command-catalog.js checks catalog entries with CanExecuteWithIfl:true and
 * DirectCommandPatterns entries against this set.
 */
const BuildCanonicalCommandIntentIds = new Set([
  'help-features', 'commands', 'run-diagnostics', 'show-rebalance-reminders',
  'show-rebalance-reminders-formatted', 'restart', 'run-daily-digest',
  'models', 'show-channel-model', 'clear-channel-model', 'web-search', 'gemini-search',
  'notion-search', 'search-reminders', 'search-projects', 'search-reminders-for-user',
  'search-reminders-here', 'search-my-reminders', 'show-reminders', 'show-reminders-for-user',
  'show-reminders-here', 'show-github-reminders', 'show-my-reminders', 'summarize-week',
  'enable-reminders',
  'disable-reminders', 'process-reminders-now', 'github-sync-now', 'test-github-sync',
  'show-stats', 'ping', 'set-channel-model', 'model-switch-default', 'model-switch-complex',
  'model-switch-both', 'version', 'changelog', 'view-stratalist', 'rmm',
  'ask-code', 'recall',
]);

/**
 * @param {string} ArgCanonicalCommand
 * @returns {RegExp}
 */
function BuildHyphenSpaceCommandPattern(ArgCanonicalCommand) {
  const Tokens = ArgCanonicalCommand
    .trim()
    .split(/[-\s]+/)
    .filter((ArgToken) => ArgToken.length > 0)
    .map(EscapeRegex);

  return new RegExp(`^${Tokens.join('(?:-|\\s+)')}$`, 'i');
}

/**
 * Build a lazy catalog of commands whose canonical string does not change when every possible
 * argument slot is populated. Those are the only commands safe to auto-normalize across hyphen
 * and space separators because they are truly argument-invariant.
 *
 * @returns {Array<{ IntentId: string, CanonicalCommand: string, Pattern: RegExp }>}
 */
function RetrieveArgumentInvariantCommands() {
  if(CachedArgumentInvariantCommands)
    return CachedArgumentInvariantCommands;

  const SentinelArguments = new Proxy({}, {
    get: () => 'x',
    has: () => true,
  });

  /** @type {Array<{ IntentId: string, CanonicalCommand: string, Pattern: RegExp }>} */
  const InvariantCommands = [];

  for(const ArgIntentId of BuildCanonicalCommandIntentIds) {
    const NoArgumentCommand = BuildCanonicalCommand(ArgIntentId, {});
    if(!NoArgumentCommand)
      continue;

    const SentinelCommand = BuildCanonicalCommand(ArgIntentId, SentinelArguments);
    if(SentinelCommand !== NoArgumentCommand)
      continue;

    InvariantCommands.push({
        IntentId: ArgIntentId,
        CanonicalCommand: NoArgumentCommand,
        Pattern: BuildHyphenSpaceCommandPattern(NoArgumentCommand),
    });
  }

  CachedArgumentInvariantCommands = InvariantCommands;

  return CachedArgumentInvariantCommands;
}

module.exports = {
  BuildCanonicalCommand,
  GetModelAliasRowsAsync,
  ResolveModelAliasAsync,
  BuildCanonicalCommandIntentIds,
  BuildSyntaxTemplate,
  GetCommandCatalogEntryByIdAsync,
  LoadCommandIntentAssetsAsync,
  NormalizeDirectCommandTextAsync,
  ResolveRmmIntentAsync,
  RetrieveScoredCandidates,
};
