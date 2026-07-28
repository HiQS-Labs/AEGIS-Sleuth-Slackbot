'use strict';

/**
 * @typedef {import('../workspaces').WorkspaceInfo} WorkspaceInfo
 * @typedef {import('../stats-module').WorkspaceStats} WorkspaceStats
 * @typedef {import('./index').AIProvider} AIProvider
 */

// max output tokens per response. Sleuth's response payloads (chat replies, JSON schemas
// for reminders/date extraction) are small enough that 4K is generous; raising it costs
// nothing on cache reads but caps streaming-less HTTP timeouts at SDK defaults. If a future
// path needs longer outputs it should pass max_tokens via an options argument.
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Anthropic implementation of the AIProvider interface. Wraps the @anthropic-ai/sdk
 * Messages API and exposes the same Process* / GetAvailableModels / IsValidModel /
 * TestConnectivity surface as the OpenAI provider so WorkspaceAI can dispatch by model
 * name without caring which vendor handles the request.
 * @implements {AIProvider}
 */
class AnthropicProvider {
  /** @type {any} */
  #Anthropic;

  /** @type {WorkspaceStats} */
  #WorkspaceStats;

  /** @type {string[] | null} */
  #AvailableModels = null;

  /**
   * @param {WorkspaceInfo} ArgWorkspaceInfo
   * @param {WorkspaceStats} ArgWorkspaceStats
   */
  constructor(ArgWorkspaceInfo, ArgWorkspaceStats) {
    const { Anthropic } = require('@anthropic-ai/sdk');
    this.#Anthropic = new Anthropic({ apiKey: ArgWorkspaceInfo.ANTHROPIC_API_KEY });
    this.#WorkspaceStats = ArgWorkspaceStats;
  }

  get Id() { return 'anthropic'; }

  get Label() { return 'Anthropic Claude'; }

  /**
   * Pull the OpenAI-style ResponseSchema apart for Anthropic's structured-output API. The
   * stored schema files use OpenAI's `{name, strict, schema}` envelope; Anthropic only
   * needs the inner JSON Schema. Accept both shapes so callers don't need to rewrite their
   * schema files.
   * @param {any} ArgSchemaObject
   * @returns {object}
   */
  static #ExtractInnerSchema(ArgSchemaObject) {
    if(ArgSchemaObject && typeof ArgSchemaObject === 'object' && ArgSchemaObject.schema && typeof ArgSchemaObject.schema === 'object')
      return ArgSchemaObject.schema;
    return ArgSchemaObject;
  }

  /**
   * Concatenate every text block in a Messages API response. Anthropic always returns a
   * content array even for plain text replies; reaching for `content[0].text` directly
   * loses partial text when a response interleaves blocks.
   * @param {any} ArgMessage
   * @returns {string}
   */
  static #ExtractText(ArgMessage) {
    const Blocks = Array.isArray(ArgMessage?.content) ? ArgMessage.content : [];
    /** @type {string[]} */
    const Parts = [];
    for(const Block of Blocks) {
      if(Block?.type === 'text' && typeof Block.text === 'string') Parts.push(Block.text);
    }
    return Parts.join('');
  }

  /**
   * @param {string} ArgMessageText
   * @param {string} ArgSystemInstructions
   * @param {object} ArgJsonSchemaObject Either the OpenAI `{name, strict, schema}` envelope or a bare JSON Schema.
   * @param {string} ArgModelName
   * @returns {Promise<object>}
   */
  async ProcessMessageWithJsonResponseAsync(ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgModelName) {
    const InnerSchema = AnthropicProvider.#ExtractInnerSchema(ArgJsonSchemaObject);

    // system is an array so we can attach cache_control and get a cache hit on repeated
    // calls with the same schema-backed system prompt (reminder extraction, deduplication, etc.).
    const Response = await this.#Anthropic.messages.create(/** @type {any} */ ({
      model: ArgModelName,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: [{ type: 'text', text: ArgSystemInstructions, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: ArgMessageText }],
      output_config: { format: { type: 'json_schema', schema: InnerSchema } },
    }));

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgMessageText.length + ArgSystemInstructions.length;

    if(Response.stop_reason !== 'end_turn' && Response.stop_reason !== 'stop_sequence')
      throw new Error(`Model did not stop naturally: ${Response.stop_reason}.`);

    const Text = AnthropicProvider.#ExtractText(Response);
    if(!Text)
      throw new Error('Anthropic response contained no text content.');

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    try {
      return JSON.parse(Text);
    } catch(ParseError) {
      throw new Error(`Anthropic returned invalid JSON (${ParseError.message}): ${Text.slice(0, 200)}`);
    }
  }

  /**
   * @param {string} ArgMessageText
   * @param {string} ArgSystemInstructions
   * @param {string} ArgModelName
   * @returns {Promise<string>}
   */
  async ProcessMessageWithTextResponseAsync(ArgMessageText, ArgSystemInstructions, ArgModelName) {
    const Response = await this.#Anthropic.messages.create(/** @type {any} */ ({
      model: ArgModelName,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: [{ type: 'text', text: ArgSystemInstructions, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: ArgMessageText }],
    }));

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgMessageText.length + ArgSystemInstructions.length;

    if(Response.stop_reason !== 'end_turn' && Response.stop_reason !== 'stop_sequence')
      throw new Error(`Model did not stop naturally: ${Response.stop_reason}.`);

    const Text = AnthropicProvider.#ExtractText(Response);
    if(!Text)
      throw new Error('Anthropic response contained no text content.');

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    return Text;
  }

  /**
   * @returns {Promise<string[]>}
   */
  async GetAvailableModelsAsync() {
    if(this.#AvailableModels) return this.#AvailableModels;

    /** @type {string[]} */
    const Ids = [];
    // models.list() returns a paginated iterable — drain it the same way the OpenAI
    // provider does so callers see a flat list of every model available to the API key.
    for await (const Model of this.#Anthropic.models.list()) {
      if(Model && typeof Model.id === 'string') Ids.push(Model.id);
    }
    this.#AvailableModels = Ids;
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
   * @returns {Promise<{ok: boolean, error?: string, code?: string}>}
   */
  async TestConnectivityAsync() {
    try {
      // drain just enough of the paginated list to confirm the API key works without
      // pulling every page — list() returns an async iterator that hits the API on the
      // first read.
      const Iterator = this.#Anthropic.models.list()[Symbol.asyncIterator]();
      await Iterator.next();
      return { ok: true };
    } catch(error) {
      const Status = error?.status;
      const Code = Status === 401 ? 'auth_failed'
        : Status === 429 ? 'rate_limited'
        : Status === 529 ? 'overloaded'
        : 'api_error';
      return { ok: false, error: error.message, code: Code };
    }
  }
}

module.exports = AnthropicProvider;
