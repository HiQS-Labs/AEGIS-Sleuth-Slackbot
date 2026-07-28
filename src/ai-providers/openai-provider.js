'use strict';

const { OpenAI } = require('openai');

/**
 * @typedef {import('../workspaces').WorkspaceInfo} WorkspaceInfo
 * @typedef {import('../stats-module').WorkspaceStats} WorkspaceStats
 * @typedef {import('openai/resources/shared').ResponseFormatJSONSchema.JSONSchema} ResponseSchema
 * @typedef {import('./index').AIProvider} AIProvider
 */

/**
 * Per-model OpenAI request parameters.
 * @typedef {Object} OpenAIModelConfig
 * @property {number} temperature
 * @property {number} max_completion_tokens
 * @property {number} frequency_penalty
 * @property {number} presence_penalty
 */

// model-specific configuration table. The first regex that matches a requested model name
// wins, so more specific patterns must come first. o-series and gpt-5* reject temperature 0
// (verified from API errors) — everything else can run deterministic.
/** @type {Array<{pattern: RegExp, config: OpenAIModelConfig}>} */
const MODEL_CONFIGURATIONS = [
  { pattern: /^o1-preview$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^o1-mini$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^o1$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^o3-mini$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^o3$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^o4-mini$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^o4$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^gpt-5(?:\.\d+)?$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^gpt-5(?:\.\d+)?-mini$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^gpt-5(?:\.\d+)?-nano$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /^gpt-5(?:\.\d+)?-pro$/, config: { temperature: 1, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
  { pattern: /.*/, config: { temperature: 0, max_completion_tokens: 2048, frequency_penalty: 0, presence_penalty: 0 } },
];

/**
 * Resolve the request parameter set for a given OpenAI model name.
 * @param {string} ArgModelName Model name to look up.
 * @returns {OpenAIModelConfig}
 */
function GetModelConfig(ArgModelName) {
  for(const Entry of MODEL_CONFIGURATIONS) {
    if(Entry.pattern.test(ArgModelName)) return Entry.config;
  }
  return MODEL_CONFIGURATIONS[MODEL_CONFIGURATIONS.length - 1].config;
}

/**
 * Detect the OpenAI error shape raised when a model rejects temperature 0 and only accepts
 * the default temperature value.
 * @param {any} ArgError
 * @returns {boolean}
 */
function IsTemperatureUnsupportedError(ArgError) {
  if(!ArgError) return false;
  if(ArgError.param === 'temperature' && ArgError.code === 'unsupported_value') return true;
  const Message = typeof ArgError.message === 'string' ? ArgError.message : '';
  return /temperature.+does not support 0/i.test(Message);
}

/**
 * OpenAI implementation of the AIProvider interface. Wraps the OpenAI SDK and exposes
 * uniform Process* / GetAvailableModels / IsValidModel / TestConnectivity methods so
 * WorkspaceAI can dispatch to it interchangeably with other providers.
 * @implements {AIProvider}
 */
class OpenAIProvider {
  /** @type {OpenAI} */
  #OpenAI;

  /** @type {WorkspaceStats} */
  #WorkspaceStats;

  /** @type {string[] | null} */
  #AvailableModels = null;

  /**
   * @param {WorkspaceInfo} ArgWorkspaceInfo
   * @param {WorkspaceStats} ArgWorkspaceStats
   */
  constructor(ArgWorkspaceInfo, ArgWorkspaceStats) {
    this.#OpenAI = new OpenAI({ apiKey: ArgWorkspaceInfo.OPENAI_API_KEY });
    this.#WorkspaceStats = ArgWorkspaceStats;
  }

  get Id() { return 'openai'; }

  get Label() { return 'OpenAI'; }

  /**
   * Expose the SDK client for the few callers that need provider-specific endpoints (e.g.
   * the Responses API for web search). New feature paths should prefer adding interface
   * methods over reading the raw client.
   * @returns {OpenAI}
   */
  get Client() {
    return this.#OpenAI;
  }

  /**
   * @param {string} ArgMessageText
   * @param {string} ArgSystemInstructions
   * @param {ResponseSchema} ArgJsonSchemaObject
   * @param {string} ArgModelName
   * @returns {Promise<object>}
   */
  async ProcessMessageWithJsonResponseAsync(ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgModelName) {
    const ModelConfig = GetModelConfig(ArgModelName);
    const RequestPayload = {
      model: ArgModelName,
      messages: [
        { role: 'system', content: ArgSystemInstructions },
        { role: 'user', content: ArgMessageText },
      ],
      temperature: ModelConfig.temperature,
      max_completion_tokens: ModelConfig.max_completion_tokens,
      frequency_penalty: ModelConfig.frequency_penalty,
      presence_penalty: ModelConfig.presence_penalty,
      response_format: {
        type: 'json_schema',
        json_schema: ArgJsonSchemaObject,
      },
    };

    let CompletionResponse;
    try {
      CompletionResponse = await this.#OpenAI.chat.completions.create(/** @type {any} */ (RequestPayload));
    } catch(error) {
      if(ModelConfig.temperature === 1 || !IsTemperatureUnsupportedError(error)) throw error;
      CompletionResponse = await this.#OpenAI.chat.completions.create({
        .../** @type {any} */ (RequestPayload),
        temperature: 1,
      });
    }

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgMessageText.length + ArgSystemInstructions.length;

    if(CompletionResponse.choices[0].finish_reason !== 'stop')
      throw new Error(`Model did not stop naturally: ${CompletionResponse.choices[0].finish_reason}.`);

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += CompletionResponse.choices[0].message.content.length;

    const RawContent = CompletionResponse.choices[0].message.content;
    try {
      return JSON.parse(RawContent);
    } catch(ParseError) {
      throw new Error(`OpenAI returned invalid JSON (${ParseError.message}): ${RawContent.slice(0, 200)}`);
    }
  }

  /**
   * @param {string} ArgMessageText
   * @param {string} ArgSystemInstructions
   * @param {string} ArgModelName
   * @returns {Promise<string>}
   */
  async ProcessMessageWithTextResponseAsync(ArgMessageText, ArgSystemInstructions, ArgModelName) {
    const ModelConfig = GetModelConfig(ArgModelName);
    const RequestPayload = {
      model: ArgModelName,
      messages: [
        { role: 'system', content: ArgSystemInstructions },
        { role: 'user', content: ArgMessageText },
      ],
      temperature: ModelConfig.temperature,
      max_completion_tokens: ModelConfig.max_completion_tokens,
      frequency_penalty: ModelConfig.frequency_penalty,
      presence_penalty: ModelConfig.presence_penalty,
    };

    let CompletionResponse;
    try {
      CompletionResponse = await this.#OpenAI.chat.completions.create(/** @type {any} */ (RequestPayload));
    } catch(error) {
      if(ModelConfig.temperature === 1 || !IsTemperatureUnsupportedError(error)) throw error;
      CompletionResponse = await this.#OpenAI.chat.completions.create({
        .../** @type {any} */ (RequestPayload),
        temperature: 1,
      });
    }

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgMessageText.length + ArgSystemInstructions.length;

    if(CompletionResponse.choices[0].finish_reason !== 'stop')
      throw new Error(`Model did not stop naturally: ${CompletionResponse.choices[0].finish_reason}.`);

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += CompletionResponse.choices[0].message.content.length;

    return CompletionResponse.choices[0].message.content;
  }

  /**
   * @returns {Promise<string[]>}
   */
  async GetAvailableModelsAsync() {
    if(this.#AvailableModels) return this.#AvailableModels;

    const response = await this.#OpenAI.models.list();
    this.#AvailableModels = [];
    for await (const model of response) {
      this.#AvailableModels.push(model.id);
    }
    return this.#AvailableModels;
  }

  /**
   * @param {string} ArgModelName
   * @returns {Promise<boolean>}
   */
  async IsValidModelAsync(ArgModelName) {
    const models = await this.GetAvailableModelsAsync();
    return models.includes(ArgModelName);
  }

  /**
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async TestConnectivityAsync() {
    try {
      await this.#OpenAI.models.list();
      return { ok: true };
    } catch(error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = OpenAIProvider;
