
// import necessary modules.
const {
  GetProviderDescriptorForModel,
  GetDefaultProviderDescriptor,
  GetAllProviderDescriptors,
  GeminiModelPattern,
} = require('./ai-providers');
const OpenAIProvider = require('./ai-providers/openai-provider');

const DefaultWebSearchModelName = 'gpt-5.4-mini';
const BuiltInDefaultModelNamesByProvider = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-3.5-flash',
};
const BuiltInComplexModelNamesByProvider = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-3.1-pro-preview',
};

// add typedefs for our own types.
/**
 * @typedef {import('./workspaces').WorkspaceInfo} WorkspaceInfo
 * @typedef {import('./stats-module').WorkspaceStats} WorkspaceStats
 * @typedef {import('./ai-providers').AIProvider} AIProvider
 */

// add typedefs for OpenAI-defined types. Kept here (not in the OpenAI provider) because
// reminders-ai-pipeline and command-intent-resolver re-import ResponseSchema from this
// module and we want their public contract unchanged.
/**
 * @typedef {import('openai/resources/shared').ResponseFormatJSONSchema.JSONSchema} ResponseSchema
 */

/**
 * Source citation returned from a web-search response.
 * @typedef {Object} WebSearchSource
 * @property {string|null} title Source title when available.
 * @property {string} url Source URL.
 */
/**
 * Result returned from the Responses API web-search helper.
 * @typedef {Object} WebSearchResult
 * @property {string} text Final answer text.
 * @property {WebSearchSource[]} sources Sources extracted from web-search metadata.
 * @property {string[]} [searchSuggestions] Optional suggested searches (Gemini web search).
 * @property {string} model Model used for the request.
 * @property {string|null} responseId OpenAI response ID when available.
 * @property {number} webSearchCallCount Number of web-search tool calls detected in the response.
 */
/**
 * Options for Responses API web search.
 * @typedef {Object} WebSearchOptions
 * @property {string} [modelName] Model to use for web search.
 * @property {number} [maxOutputTokens] Maximum output tokens to request.
 */

/**
 * Per-provider live model catalog status.
 * @typedef {Object} ProviderModelCatalogStatus
 * @property {string} label Human-readable provider label.
 * @property {boolean} configured Whether the workspace has an API key for this provider.
 * @property {boolean} ok Whether the live model catalog fetch succeeded.
 * @property {string[]} modelIds Model IDs returned from the provider. Empty on failure or empty catalog.
 * @property {string} [error] Provider error text when the fetch failed.
 */

/**
 * Result of validating a model ID for this workspace.
 * @typedef {Object} ModelAvailabilityResult
 * @property {boolean} ok Whether the model is selectable right now.
 * @property {'valid'|'not-found'|'provider-not-configured'|'catalog-unavailable'} reason
 * @property {string} providerId Stable provider id.
 * @property {string} providerLabel Human-readable provider label.
 * @property {string} [error] Detailed error text for non-ok results.
 */

/**
 * Extract text from a Responses API response.
 * @param {any} ArgResponse Responses API response object.
 * @returns {string}
 */
function ExtractResponsesText(ArgResponse) {
  if(typeof ArgResponse?.output_text === 'string')
    return ArgResponse.output_text.trim();

  const TextParts = [];
  const OutputItems = Array.isArray(ArgResponse?.output) ? ArgResponse.output : [];
  for(const OutputItem of OutputItems) {
    const ContentItems = Array.isArray(OutputItem?.content) ? OutputItem.content : [];
    for(const ContentItem of ContentItems) {
      if(typeof ContentItem?.text === 'string')
        TextParts.push(ContentItem.text);
    }
  }

  return TextParts.join('\n').trim();
}

/**
 * Extract source citations from a Responses API web-search response.
 * @param {any} ArgResponse Responses API response object.
 * @returns {WebSearchSource[]}
 */
function ExtractWebSearchSources(ArgResponse) {
  /** @type {Map<string, WebSearchSource>} */
  const SourcesByUrl = new Map();

  /**
   * Add a source if it has a usable URL.
   * @param {unknown} ArgRawSource Raw source-like object.
   * @returns {void}
   */
  function AddSource(ArgRawSource) {
    if(!ArgRawSource || typeof ArgRawSource !== 'object') return;

    const Source = /** @type {{ url?: unknown, uri?: unknown, title?: unknown }} */ (ArgRawSource);
    const Url = typeof Source.url === 'string'
      ? Source.url
      : typeof Source.uri === 'string'
        ? Source.uri
        : '';
    if(!Url) return;

    const Title = typeof Source.title === 'string' && Source.title.trim().length > 0
      ? Source.title.trim()
      : null;
    if(!SourcesByUrl.has(Url))
      SourcesByUrl.set(Url, { title: Title, url: Url });
  }

  const OutputItems = Array.isArray(ArgResponse?.output) ? ArgResponse.output : [];
  for(const OutputItem of OutputItems) {
    const ActionSources = Array.isArray(OutputItem?.action?.sources) ? OutputItem.action.sources : [];
    for(const CurrentSource of ActionSources)
      AddSource(CurrentSource);

    const ContentItems = Array.isArray(OutputItem?.content) ? OutputItem.content : [];
    for(const ContentItem of ContentItems) {
      const Annotations = Array.isArray(ContentItem?.annotations) ? ContentItem.annotations : [];
      for(const CurrentAnnotation of Annotations)
        AddSource(CurrentAnnotation);
    }
  }

  return [...SourcesByUrl.values()];
}

/**
 * Count Responses API web-search tool calls.
 * @param {any} ArgResponse Responses API response object.
 * @returns {number}
 */
function CountWebSearchCalls(ArgResponse) {
  const OutputItems = Array.isArray(ArgResponse?.output) ? ArgResponse.output : [];
  let Count = 0;
  for(const OutputItem of OutputItems) {
    if(OutputItem?.type === 'web_search_call')
      Count++;
  }
  return Count;
}

/**
 * Provides access to AI APIs (OpenAI, Anthropic, ...) to support AI functionality for a
 * given workspace. Dispatches each Process* call to the provider implementation that owns
 * the requested model — model name prefix decides routing (see `ai-providers/index.js`).
 * Provider clients are lazy-built and cached so a workspace that never touches Claude
 * never instantiates the Anthropic SDK.
 */
class WorkspaceAI {
  /**
   * Workspace information.
   * @type {WorkspaceInfo}
   */
  #WorkspaceInfo;

  /**
   * Stats for the workspace.
   * @type {WorkspaceStats}
   */
  #WorkspaceStats;

  /**
   * Cache of built provider instances keyed by provider id ('openai', 'anthropic'). Built
   * lazily by #GetProviderInstance to avoid spinning up SDK clients we'll never use.
   * @type {Map<string, AIProvider>}
   */
  #ProvidersById = new Map();

  /**
   * Default model name to use.
   * @type {string}
   */
  #DefaultModelName;

  /**
   * Complex model name to use for difficult tasks like date extraction.
   * @type {string}
   */
  #ComplexModelName;

  /**
   * Initialize a new instance of the WorkspaceAI with the given workspace info and default model name.
   * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info object.
   * @param {WorkspaceStats} ArgWorkspaceStats Stats for the workspace.
   * @param {string} [ArgDefaultModelName] Default model name to use; if not specified, "gpt-4o-mini" will be used.
   */
  constructor(ArgWorkspaceInfo, ArgWorkspaceStats, ArgDefaultModelName) {
    // save the workspace info and stats.
    this.#WorkspaceInfo = ArgWorkspaceInfo;
    this.#WorkspaceStats = ArgWorkspaceStats;

    // set the default model name. priority: explicit constructor arg > persisted workspace JSON
    // (DEFAULT_MODEL_NAME, set by `switch-models:default='...'`) > provider-aware fallback.
    this.#DefaultModelName =
      ArgDefaultModelName ||
      ArgWorkspaceInfo.DEFAULT_MODEL_NAME ||
      WorkspaceAI.#GetBuiltInDefaultModelName(ArgWorkspaceInfo);

    // set the complex model name for difficult tasks like date extraction. priority: persisted
    // workspace JSON (COMPLEX_MODEL_NAME, set by `switch-models:complex='...'`) > provider-aware fallback.
    this.#ComplexModelName =
      ArgWorkspaceInfo.COMPLEX_MODEL_NAME ||
      WorkspaceAI.#GetBuiltInComplexModelName(ArgWorkspaceInfo);
  }

  /**
   * Resolve which provider should supply the built-in fallback models.
   * Preserves the long-standing OpenAI preference when OPENAI_API_KEY exists,
   * while still allowing Anthropic-only or Gemini-only workspaces to operate.
   * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info object.
   * @returns {'openai'|'anthropic'|'gemini'}
   */
  static #GetPreferredProviderIdForFallbacks(ArgWorkspaceInfo) {
    if(ArgWorkspaceInfo.OPENAI_API_KEY) return 'openai';
    if(ArgWorkspaceInfo.ANTHROPIC_API_KEY) return 'anthropic';
    if(ArgWorkspaceInfo.GEMINI_API_KEY) return 'gemini';
    return 'openai';
  }

  /**
   * Get the built-in general-purpose fallback model for this workspace.
   * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info object.
   * @returns {string}
   */
  static #GetBuiltInDefaultModelName(ArgWorkspaceInfo) {
    const ProviderId = WorkspaceAI.#GetPreferredProviderIdForFallbacks(ArgWorkspaceInfo);
    return BuiltInDefaultModelNamesByProvider[ProviderId];
  }

  /**
   * Get the built-in complex-task fallback model for this workspace.
   * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info object.
   * @returns {string}
   */
  static #GetBuiltInComplexModelName(ArgWorkspaceInfo) {
    const ProviderId = WorkspaceAI.#GetPreferredProviderIdForFallbacks(ArgWorkspaceInfo);
    return BuiltInComplexModelNamesByProvider[ProviderId];
  }

  /**
   * Get the workspace info.
   * @returns {WorkspaceInfo}
   */
  get WorkspaceInfo() {
    return this.#WorkspaceInfo;
  }

  /**
   * Get the default model name. This is the model that will be used if no model name is specified
   * when calling the ProcessXXX methods to process a message.
   * @returns {string}
   */
  get DefaultModelName() {
    return this.#DefaultModelName;
  }

  /**
   * Set the default model name.
   * @param {string} value New default model name.
   */
  set DefaultModelName(value) {
    this.#DefaultModelName = value;
  }

  /**
   * Get the complex model name used for difficult tasks like date extraction.
   * @returns {string}
   */
  get ComplexModelName() {
    return this.#ComplexModelName;
  }

  /**
   * Set the complex model name.
   * @param {string} value New complex model name.
   */
  set ComplexModelName(value) {
    this.#ComplexModelName = value;
  }

  /**
   * Resolve which provider owns a given model name and return its (lazily built) instance.
   * Throws when the descriptor matches but the workspace lacks the required API key — that
   * surfaces a clear "switch to claude-* but ANTHROPIC_API_KEY missing" error instead of
   * an obscure SDK failure later. Unknown model names route to the default (OpenAI)
   * provider so a custom/fine-tuned OpenAI model id still works.
   * @param {string} ArgModelName Model name to resolve.
   * @returns {AIProvider}
   */
  #GetProviderForModel(ArgModelName) {
    const Descriptor = GetProviderDescriptorForModel(ArgModelName) || GetDefaultProviderDescriptor();
    const Cached = this.#ProvidersById.get(Descriptor.Id);
    if(Cached) return Cached;

    const Instance = Descriptor.Build(this.#WorkspaceInfo, this.#WorkspaceStats);
    if(!Instance) {
      const error = /** @type {Error & { code?: string, providerId?: string, providerLabel?: string }} */ (
        new Error(`Cannot use model '${ArgModelName}': ${Descriptor.Label} API key is not configured for this workspace.`)
      );
      error.code = 'provider_not_configured';
      error.providerId = Descriptor.Id;
      error.providerLabel = Descriptor.Label;
      throw error;
    }

    this.#ProvidersById.set(Descriptor.Id, Instance);
    return Instance;
  }

  /**
   * Provider instance that owns the OpenAI Responses API (used by web search). Returns
   * null when OPENAI_API_KEY is absent so callers can degrade gracefully.
   * @returns {OpenAIProvider|null}
   */
  #GetOpenAIProviderOrNull() {
    if(!this.#WorkspaceInfo.OPENAI_API_KEY) return null;
    const Cached = this.#ProvidersById.get('openai');
    if(Cached instanceof OpenAIProvider) return Cached;
    const Instance = new OpenAIProvider(this.#WorkspaceInfo, this.#WorkspaceStats);
    this.#ProvidersById.set('openai', Instance);
    return Instance;
  }

  /**
   * Get the list of available models from the provider that owns the default model. Kept
   * for backward compatibility with the live-model-catalog feature, which reads this once
   * per workspace to ground its answers. Callers that need the full multi-provider view
   * should use GetAvailableModelsByProviderAsync.
   * @returns {Promise<string[]>}
   */
  async GetAvailableModelsAsync() {
    const Provider = this.#GetProviderForModel(this.#DefaultModelName);
    return Provider.GetAvailableModelsAsync();
  }

  /**
   * Fetch the live model-catalog status from every known provider. This preserves enough
   * detail for callers to distinguish "provider not configured", "provider returned an
   * empty catalog", and "provider catalog lookup failed".
   * @returns {Promise<Record<string, ProviderModelCatalogStatus>>}
   */
  async GetAvailableModelCatalogStatusByProviderAsync() {
    /** @type {Record<string, ProviderModelCatalogStatus>} */
    const Results = {};
    for(const Descriptor of GetAllProviderDescriptors()) {
      const Instance = Descriptor.Build(this.#WorkspaceInfo, this.#WorkspaceStats);
      if(!Instance) {
        Results[Descriptor.Id] = {
          label: Descriptor.Label,
          configured: false,
          ok: false,
          modelIds: [],
        };
        continue;
      }

      this.#ProvidersById.set(Descriptor.Id, Instance);
      try {
        Results[Descriptor.Id] = {
          label: Descriptor.Label,
          configured: true,
          ok: true,
          modelIds: await Instance.GetAvailableModelsAsync(),
        };
      } catch(error) {
        Results[Descriptor.Id] = {
          label: Descriptor.Label,
          configured: true,
          ok: false,
          modelIds: [],
          error: error.message,
        };
      }
    }
    return Results;
  }

  /**
   * Fetch the available models from every configured provider, keyed by provider id. Throws
   * when any configured provider catalog lookup fails so callers do not silently treat a
   * transient provider outage as "this workspace has no models from that vendor".
   * @returns {Promise<Record<string, string[]>>}
   */
  async GetAvailableModelsByProviderAsync() {
    const CatalogStatuses = await this.GetAvailableModelCatalogStatusByProviderAsync();
    const FailedProviders = Object.values(CatalogStatuses).filter((ArgStatus) => ArgStatus.configured && !ArgStatus.ok);
    if(FailedProviders.length > 0) {
      const Summary = FailedProviders.map((ArgStatus) => {
        return `${ArgStatus.label}${ArgStatus.error ? ` (${ArgStatus.error})` : ''}`;
      }).join(', ');
      throw new Error(`Failed to fetch live model catalog from: ${Summary}`);
    }

    /** @type {Record<string, string[]>} */
    const Result = {};
    for(const [ProviderId, Status] of Object.entries(CatalogStatuses)) {
      if(Status.configured && Status.ok)
        Result[ProviderId] = Status.modelIds;
    }
    return Result;
  }

  /**
   * Validate whether a model is selectable for this workspace and preserve the reason when
   * it is not.
   * @param {string} ArgModelName Model name to validate.
   * @returns {Promise<ModelAvailabilityResult>}
   */
  async GetModelAvailabilityAsync(ArgModelName) {
    const Descriptor = GetProviderDescriptorForModel(ArgModelName) || GetDefaultProviderDescriptor();
    let Provider;
    try {
      Provider = this.#GetProviderForModel(ArgModelName);
    } catch(error) {
      if(error?.code === 'provider_not_configured') {
        return {
          ok: false,
          reason: 'provider-not-configured',
          providerId: Descriptor.Id,
          providerLabel: Descriptor.Label,
          error: error.message,
        };
      }

      throw error;
    }

    try {
      const IsValid = await Provider.IsValidModelAsync(ArgModelName);
      return {
        ok: IsValid,
        reason: IsValid ? 'valid' : 'not-found',
        providerId: Provider.Id,
        providerLabel: Provider.Label,
      };
    } catch(error) {
      return {
        ok: false,
        reason: 'catalog-unavailable',
        providerId: Provider.Id,
        providerLabel: Provider.Label,
        error: error.message,
      };
    }
  }

  /**
   * Check if a model name is valid by asking the provider that claims it. Returns false
   * only for a confirmed "not found" result; provider configuration and catalog failures
   * are surfaced as errors so callers do not misreport them as invalid model IDs.
   * @param {string} ArgModelName Model name to validate.
   * @returns {Promise<boolean>}
   */
  async IsValidModelAsync(ArgModelName) {
    const Result = await this.GetModelAvailabilityAsync(ArgModelName);
    if(Result.reason === 'provider-not-configured' || Result.reason === 'catalog-unavailable')
      throw new Error(Result.error || `Failed to validate model '${ArgModelName}' against ${Result.providerLabel}.`);
    return Result.ok;
  }

  /**
   * Send a message to the configured AI provider for processing and return a response object matching the given JSON schema.
   * @param {string} ArgMessageText Message text to send.
   * @param {string} ArgSystemInstructions System instructions to use when processing the message.
   * @param {ResponseSchema} ArgJsonSchemaObject JSON schema defining the expected structure of the response object.
   * @param {string} [ArgModelName] Model name to use; if not specified, the default model will be used.
   * @returns {Promise<object>}
   */
  async ProcessMessageWithJsonResponseAsync(ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgModelName) {
    const ModelName = ArgModelName || this.#DefaultModelName;
    const Provider = this.#GetProviderForModel(ModelName);
    return Provider.ProcessMessageWithJsonResponseAsync(
      ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ModelName
    );
  }

  /**
   * Send a message with an inline image attachment to the configured AI provider and return a
   * structured JSON response matching the given schema. Routes to whichever provider owns the
   * requested model name (e.g. gemini-* → GeminiProvider) which implements the actual
   * generateContent call with inlineData parts.
   * @param {string} ArgMessageText Message text to send.
   * @param {string} ArgSystemInstructions System instructions to use when processing the message.
   * @param {ResponseSchema} ArgJsonSchemaObject JSON schema defining the expected structure of the response object.
   * @param {{ Base64: string, Mimetype: string }} ArgImage Image payload from SlackApp.DownloadFileBase64Async.
   * @param {string} [ArgModelName] Model name to use; if not specified, the default model will be used.
   * @returns {Promise<object>}
   */
  async ProcessMultimodalMessageWithJsonResponseAsync(ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgImage, ArgModelName) {
    // GH-63 r2 (agy relay review): walk the whole preference list rather than only its head.
    // Declaring three fallbacks and reaching only the first is a latent outage — when the lead
    // model is retired the feature dies with two "fallbacks" that were never wired up.
    const Candidates = ArgModelName ? [ArgModelName] : this.ResolveVisionModelNames();
    let LastError = null;

    for(let Index = 0; Index < Candidates.length; Index++) {
      const ModelName = Candidates[Index];
      const Provider = this.#GetProviderForModel(ModelName);
      if(typeof Provider.ProcessMultimodalMessageWithJsonResponseAsync !== 'function') {
        throw new Error(`Provider '${Provider.Id}' does not implement ProcessMultimodalMessageWithJsonResponseAsync.`);
      }

      try {
        return await Provider.ProcessMultimodalMessageWithJsonResponseAsync(
          ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgImage, ModelName
        );
      } catch(error) {
        LastError = error;
        // Only a model-availability failure is worth another attempt. Retrying a bad image or a
        // quota error against every candidate would triple latency on failures that cannot succeed.
        const HasNextCandidate = Index < Candidates.length - 1;
        if(!HasNextCandidate || !WorkspaceAI.IsModelUnavailableError(error)) throw error;
        this.#WarnVisionFallback(ModelName, Candidates[Index + 1], error);
      }
    }

    throw LastError || new Error('No vision model candidates were available.');
  }

  /**
   * Decide whether an error means "this model is not available to this workspace" — the only class
   * of failure where trying the next candidate can help. Deliberately narrow: an unrecognized error
   * propagates rather than silently burning the whole preference list.
   * @param {any} ArgError Error thrown by a provider call.
   * @returns {boolean}
   */
  static IsModelUnavailableError(ArgError) {
    if(!ArgError) return false;
    const Status = ArgError.status ?? ArgError.statusCode ?? null;
    if(Status === 404) return true;
    const Message = String(ArgError.message || '').toLowerCase();
    return /model.*(not found|not supported|does not exist|unavailable|deprecated|retired)/.test(Message)
      || /(not found|unsupported).*model/.test(Message);
  }

  /**
   * Record a vision-model fallback so a silent downgrade is visible in production logs.
   * @param {string} ArgFailedModel Model that reported itself unavailable.
   * @param {string} ArgNextModel Next candidate being tried.
   * @param {any} ArgError Originating error.
   * @returns {void}
   */
  #WarnVisionFallback(ArgFailedModel, ArgNextModel, ArgError) {
    const Detail = ArgError && ArgError.message ? ArgError.message : 'unknown error';
    // eslint-disable-next-line no-console
    console.warn(`[vision] model '${ArgFailedModel}' unavailable (${Detail}); falling back to '${ArgNextModel}'.`);
  }

  /**
   * Resolve a model capable of vision/multimodal work, independent of the workspace's default
   * chat model (GH-63).
   *
   * Vision is pinned the same way web search is pinned to OpenAI (see
   * `ProcessGeminiWebSearchAsync` / the Responses API accessor below): capability lives with a
   * specific provider, so following the workspace default silently breaks the feature whenever an
   * operator switches the default to Claude or GPT. Before this, that mismatch surfaced to users
   * as "Image analysis failed — please try again later", which invites a retry that can never
   * succeed.
   *
   * @returns {string} The best Gemini model name suitable for multimodal requests.
   * @throws {Error & { code: string }} `vision_provider_not_configured` when the workspace has no
   *   Gemini credentials, so callers can render an honest message instead of a transient one.
   */
  ResolveVisionModelName() {
    return this.ResolveVisionModelNames()[0];
  }

  /**
   * The ordered vision-model candidates for this workspace, best first (GH-63 r2).
   *
   * `ProcessMultimodalMessageWithJsonResponseAsync` walks this whole list, so every entry in
   * `VisionModelPreference` is genuinely reachable. The single-value `ResolveVisionModelName()`
   * is the head of this list and exists for callers that only need the primary choice.
   *
   * @returns {string[]} One or more Gemini model names, best first.
   * @throws {Error & { code: string }} `vision_provider_not_configured` when the workspace has no
   *   Gemini credentials.
   */
  ResolveVisionModelNames() {
    // An already-Gemini default is honored as-is — an operator who pinned a specific Gemini
    // model (including a future one this list does not know about) should keep getting it, and it
    // leads the candidate order rather than being replaced by our defaults.
    const PinnedDefault = GeminiModelPattern.test(this.#DefaultModelName || '')
      ? this.#DefaultModelName
      : null;

    if(!PinnedDefault && !this.#WorkspaceInfo.GEMINI_API_KEY) {
      const error = /** @type {Error & { code?: string }} */ (
        new Error('Image OCR requires a Gemini model, which is not configured for this workspace.')
      );
      error.code = 'vision_provider_not_configured';
      throw error;
    }

    const Candidates = PinnedDefault ? [PinnedDefault] : [];
    for(const ModelName of WorkspaceAI.VisionModelPreference) {
      if(!Candidates.includes(ModelName)) Candidates.push(ModelName);
    }
    return Candidates;
  }

  /**
   * Preferred vision-capable models, best first. Extend here — and only here — if another
   * provider gains multimodal support.
   * @type {string[]}
   */
  static VisionModelPreference = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

  /**
   * Send a message to the configured AI provider and return the response as text.
   * @param {string} ArgMessageText Message text to send.
   * @param {string} ArgSystemInstructions System instructions to use when processing the message.
   * @param {string} [ArgModelName] Model name to use; if not specified, the default model will be used.
   * @returns {Promise<string>}
   */
  async ProcessMessageWithTextResponseAsync(ArgMessageText, ArgSystemInstructions, ArgModelName) {
    const ModelName = ArgModelName || this.#DefaultModelName;
    const Provider = this.#GetProviderForModel(ModelName);
    return Provider.ProcessMessageWithTextResponseAsync(
      ArgMessageText, ArgSystemInstructions, ModelName
    );
  }

  /**
   * Send a query to the OpenAI Responses API with integrated web search. Pinned to OpenAI
   * even when the workspace's default chat model is Claude — Claude's hosted web tool is a
   * separate integration (see `ProcessGeminiWebSearchAsync` for the Gemini parallel).
   * @param {string} ArgQuery Search query and user-facing prompt.
   * @param {WebSearchOptions} [ArgOptions] Optional web-search settings.
   * @returns {Promise<WebSearchResult>}
   */
  async ProcessWebSearchAsync(ArgQuery, ArgOptions = {}) {
    if(typeof ArgQuery !== 'string' || ArgQuery.trim().length === 0)
      throw new Error('web search query must be a non-empty string.');

    const OpenAIProviderInstance = this.#GetOpenAIProviderOrNull();
    if(!OpenAIProviderInstance)
      throw new Error('OPENAI_API_KEY is not configured for this workspace.');

    const ModelName = ArgOptions.modelName || DefaultWebSearchModelName;
    const MaxOutputTokens = ArgOptions.maxOutputTokens || 1200;
    const Response = await OpenAIProviderInstance.Client.responses.create({
      model: ModelName,
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      input: ArgQuery,
      max_output_tokens: MaxOutputTokens,
    });
    const Text = ExtractResponsesText(Response);
    if(!Text)
      throw new Error('web search returned an empty response.');

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgQuery.length;
    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    return {
      text: Text,
      sources: ExtractWebSearchSources(Response),
      model: ModelName,
      responseId: typeof Response.id === 'string' ? Response.id : null,
      webSearchCallCount: CountWebSearchCalls(Response),
    };
  }

  /**
   * Send a query to the Gemini API with integrated web search enabled.
   * @param {string} ArgQuery Search query and user-facing prompt.
   * @param {WebSearchOptions} [ArgOptions] Optional web-search settings.
   * @returns {Promise<WebSearchResult>}
   */
  async ProcessGeminiWebSearchAsync(ArgQuery, ArgOptions = {}) {
    if(typeof ArgQuery !== 'string' || ArgQuery.trim().length === 0)
      throw new Error('web search query must be a non-empty string.');

    const ApiKey = this.#WorkspaceInfo.GEMINI_API_KEY;
    if(!ApiKey)
      throw new Error('GEMINI_API_KEY is not configured for this workspace.');

    const ModelName = ArgOptions.modelName || 'gemini-flash-latest';
    const Endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${ModelName}:generateContent`;

    const Payload = {
      contents: [{ role: 'user', parts: [{ text: ArgQuery }] }],
      tools: [{ googleSearch: {} }]
    };

    // API key in header rather than query string so it is not captured in HTTP server logs.
    const Response = await fetch(Endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ApiKey },
      body: JSON.stringify(Payload)
    });

    if(!Response.ok) {
      const ErrorText = await Response.text();
      throw new Error(`Gemini web search failed (${Response.status}): ${ErrorText.slice(0, 300)}`);
    }

    const Data = await Response.json();
    const Candidate = Data.candidates?.[0];
    if(!Candidate)
      throw new Error('Gemini web search returned an empty response.');

    const Text = Candidate.content?.parts?.[0]?.text || '';
    if(!Text)
      throw new Error('Gemini web search returned an empty text response.');

    const GroundingMetadata = Candidate.groundingMetadata || {};
    const Chunks = /** @type {any[]} */ (GroundingMetadata.groundingChunks || []);
    /** @type {WebSearchSource[]} */
    const Sources = [];
    for(const Chunk of Chunks) {
      const WebChunk = Chunk?.web;
      if(!WebChunk?.uri) continue;
      Sources.push({
        title: WebChunk.title || null,
        url: WebChunk.uri,
      });
    }

    // Google ToS compliance: pass the suggested searches up to the renderer.
    // searchEntryPoint.renderedContent is HTML+CSS — useless in Slack — so we forward
    // the structured queries instead and let the chat renderer build text-friendly links.
    /** @type {string[]} */
    const SearchSuggestions = [];
    if(Array.isArray(GroundingMetadata.webSearchQueries)) {
      for(const Query of GroundingMetadata.webSearchQueries) {
        if(typeof Query !== 'string') continue;
        if(Query.trim().length === 0) continue;
        SearchSuggestions.push(Query);
      }
    }

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgQuery.length;
    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    return {
      text: Text,
      sources: Sources,
      searchSuggestions: SearchSuggestions,
      model: ModelName,
      responseId: null,
      webSearchCallCount: Chunks.length > 0 ? 1 : 0,
    };
  }

  /**
   * Lightweight connectivity test against the provider that owns the default model. Lets
   * the existing startup probe (`AiTest` in `app.js`) stay generic — the diagnostics
   * command can call TestProviderConnectivityAsync for per-provider results.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async TestConnectivityAsync() {
    try {
      const Provider = this.#GetProviderForModel(this.#DefaultModelName);
      return await Provider.TestConnectivityAsync();
    } catch(error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Run a connectivity test against each configured provider. Returns a map keyed by
   * provider id with `{ok, error?, label, configured}` — `configured: false` indicates the
   * workspace has no API key for that provider (so the diagnostics output can render
   * "not configured" rather than "FAILED").
   * @returns {Promise<Record<string, {ok: boolean, error?: string, label: string, configured: boolean}>>}
   */
  async TestProviderConnectivityAsync() {
    /** @type {Record<string, {ok: boolean, error?: string, label: string, configured: boolean}>} */
    const Results = {};
    for(const Descriptor of GetAllProviderDescriptors()) {
      const Instance = Descriptor.Build(this.#WorkspaceInfo, this.#WorkspaceStats);
      if(!Instance) {
        Results[Descriptor.Id] = { ok: false, label: Descriptor.Label, configured: false };
        continue;
      }
      this.#ProvidersById.set(Descriptor.Id, Instance);
      const ProbeResult = await Instance.TestConnectivityAsync();
      Results[Descriptor.Id] = {
        ok: ProbeResult.ok,
        error: ProbeResult.error,
        label: Descriptor.Label,
        configured: true,
      };
    }
    return Results;
  }
}

// export the class.
module.exports = WorkspaceAI;
