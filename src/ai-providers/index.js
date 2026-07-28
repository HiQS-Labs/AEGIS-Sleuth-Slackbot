'use strict';

// AI provider registry and resolution. Adding a new provider (e.g. Gemini chat) means:
//   1. Implement the AIProvider interface in a new file in this directory.
//   2. Append an entry to `Providers` below with a Detect() pattern matching model IDs.
// Provider selection is by model name prefix (e.g. claude-* -> anthropic, gpt-/o[0-9]-/...
// -> openai). Callers (WorkspaceAI) ask GetProviderForModel(...) and route the call.

const OpenAIProvider = require('./openai-provider');
const AnthropicProvider = require('./anthropic-provider');
const GeminiProvider = require('./gemini-provider');

/**
 * Common interface implemented by every AI provider. WorkspaceAI dispatches to whichever
 * provider matches the requested model name.
 * @typedef {Object} AIProvider
 * @property {string} Id Stable provider identifier (e.g. 'openai', 'anthropic').
 * @property {string} Label Human-readable provider label for diagnostics and messages.
 * @property {(ArgMessageText: string, ArgSystemInstructions: string, ArgJsonSchemaObject: object, ArgModelName: string) => Promise<object>} ProcessMessageWithJsonResponseAsync
 *   Send a message to the model and return a structured JSON response matching the schema.
 * @property {(ArgMessageText: string, ArgSystemInstructions: string, ArgModelName: string) => Promise<string>} ProcessMessageWithTextResponseAsync
 *   Send a message to the model and return the response as text.
 * @property {() => Promise<string[]>} GetAvailableModelsAsync
 *   Return the list of model IDs available to this workspace via this provider.
 * @property {(ArgModelName: string) => Promise<boolean>} IsValidModelAsync
 *   Check whether a model ID exists in the live catalog for this provider.
 * @property {() => Promise<{ok: boolean, error?: string}>} TestConnectivityAsync
 *   Lightweight connectivity check against the provider's API.
 */

/**
 * Provider descriptor used by the registry. `Detect` returns true when the provider should
 * handle the given model name. `Build` constructs the provider for a workspace, returning
 * null when the workspace lacks the required API key.
 * @typedef {Object} ProviderDescriptor
 * @property {string} Id
 * @property {string} Label
 * @property {(ArgModelName: string) => boolean} Detect
 * @property {(ArgWorkspaceInfo: import('../workspaces').WorkspaceInfo, ArgWorkspaceStats: import('../stats-module').WorkspaceStats) => AIProvider|null} Build
 */

// pattern that matches OpenAI chat-shaped model IDs (gpt-*, o-series, chatgpt-*, codex-*,
// computer-use-*). Kept loose so future GPT releases pick up automatically.
const OpenAIModelPattern = /^(?:chatgpt|codex|computer-use|gpt-|o[0-9])/i;
const AnthropicModelPattern = /^claude-/i;
const GeminiModelPattern = /^gemini-/i;

/** @type {ProviderDescriptor[]} */
const Providers = [
  {
    Id: 'anthropic',
    Label: 'Anthropic Claude',
    Detect: (ArgModelName) => AnthropicModelPattern.test(ArgModelName),
    Build: (ArgWorkspaceInfo, ArgWorkspaceStats) => {
      if(!ArgWorkspaceInfo.ANTHROPIC_API_KEY) return null;
      return new AnthropicProvider(ArgWorkspaceInfo, ArgWorkspaceStats);
    },
  },
  {
    Id: 'gemini',
    Label: 'Google Gemini',
    Detect: (ArgModelName) => GeminiModelPattern.test(ArgModelName),
    Build: (ArgWorkspaceInfo, ArgWorkspaceStats) => {
      if(!ArgWorkspaceInfo.GEMINI_API_KEY) return null;
      return new GeminiProvider(ArgWorkspaceInfo, ArgWorkspaceStats);
    },
  },
  {
    Id: 'openai',
    Label: 'OpenAI',
    Detect: (ArgModelName) => OpenAIModelPattern.test(ArgModelName),
    Build: (ArgWorkspaceInfo, ArgWorkspaceStats) => {
      if(!ArgWorkspaceInfo.OPENAI_API_KEY) return null;
      return new OpenAIProvider(ArgWorkspaceInfo, ArgWorkspaceStats);
    },
  },
];

/**
 * Resolve the provider descriptor that handles the given model name. Returns null when the
 * name does not match any known prefix — callers fall back to the default provider.
 * @param {string} ArgModelName Model ID to resolve.
 * @returns {ProviderDescriptor|null}
 */
function GetProviderDescriptorForModel(ArgModelName) {
  if(typeof ArgModelName !== 'string') return null;
  for(const Descriptor of Providers) {
    if(Descriptor.Detect(ArgModelName)) return Descriptor;
  }
  return null;
}

/**
 * Get the provider descriptor for the default fallback when no other provider matches.
 * The default is OpenAI to preserve existing single-provider behavior.
 * @returns {ProviderDescriptor}
 */
function GetDefaultProviderDescriptor() {
  const Default = Providers.find((ArgEntry) => ArgEntry.Id === 'openai');
  if(!Default) throw new Error('default provider (openai) missing from registry.');
  return Default;
}

/**
 * Enumerate every provider descriptor.
 * @returns {ProviderDescriptor[]}
 */
function GetAllProviderDescriptors() {
  return Providers.slice();
}

module.exports = {
  GetProviderDescriptorForModel,
  GetDefaultProviderDescriptor,
  GetAllProviderDescriptors,
  OpenAIModelPattern,
  AnthropicModelPattern,
  GeminiModelPattern,
};
