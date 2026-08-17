'use strict';

/**
 * @typedef {import('../workspaces').WorkspaceInfo} WorkspaceInfo
 * @typedef {import('../stats-module').WorkspaceStats} WorkspaceStats
 * @typedef {import('./index').AIProvider} AIProvider
 */

/**
 * Gemini implementation of the AIProvider interface. Uses the Google Generative Language
 * REST API to provide the Process* / GetAvailableModels / IsValidModel / TestConnectivity
 * surface so WorkspaceAI can dispatch to it.
 * @implements {AIProvider}
 */
class GeminiProvider {
  /** @type {WorkspaceInfo} */
  #WorkspaceInfo;

  /** @type {WorkspaceStats} */
  #WorkspaceStats;

  /** @type {string[] | null} */
  #AvailableModels = null;

  /**
   * @param {WorkspaceInfo} ArgWorkspaceInfo
   * @param {WorkspaceStats} ArgWorkspaceStats
   */
  constructor(ArgWorkspaceInfo, ArgWorkspaceStats) {
    this.#WorkspaceInfo = ArgWorkspaceInfo;
    this.#WorkspaceStats = ArgWorkspaceStats;
  }

  get Id() { return 'gemini'; }

  get Label() { return 'Google Gemini'; }

  /**
   * Extract the inner schema. The stored schema files use OpenAI's `{name, strict, schema}`
   * envelope. Gemini expects the bare JSON Schema object in `responseSchema`.
   * @param {any} ArgSchemaObject
   * @returns {object}
   */
  static #ExtractInnerSchema(ArgSchemaObject) {
    if(ArgSchemaObject && typeof ArgSchemaObject === 'object' && ArgSchemaObject.schema && typeof ArgSchemaObject.schema === 'object')
      return ArgSchemaObject.schema;
    return ArgSchemaObject;
  }

  /**
   * Recursively strip JSON Schema keywords that Gemini's `responseSchema` rejects. Gemini
   * accepts only an OpenAPI 3.0 Schema subset, but the stored schema files carry
   * `additionalProperties` (and may carry `$schema`) — passing those through makes
   * generateContent fail with a 400. OpenAI and Anthropic tolerate the same keys, so the
   * sanitization lives here rather than in the shared schema files.
   * @param {any} ArgSchema
   * @returns {any}
   */
  static #SanitizeSchemaForGemini(ArgSchema) {
    if(Array.isArray(ArgSchema))
      return ArgSchema.map((ArgItem) => GeminiProvider.#SanitizeSchemaForGemini(ArgItem));
    if(!ArgSchema || typeof ArgSchema !== 'object')
      return ArgSchema;
    /** @type {Record<string, any>} */
    const Sanitized = {};
    for(const [Key, Value] of Object.entries(ArgSchema)) {
      if(Key === 'additionalProperties' || Key === '$schema') continue;
      Sanitized[Key] = GeminiProvider.#SanitizeSchemaForGemini(Value);
    }
    return Sanitized;
  }

  /**
   * POST a generateContent request to the Google Generative Language REST API for multimodal input.
   * Sends an inline image (base64 + MIME type) alongside text as parts of the same content entry
   * so Gemini's vision model can reason over both. The JSON schema envelope is unwrapped and
   * sanitized exactly like ProcessMessageWithJsonResponseAsync so Gemini's responseSchema stays valid.
   * @param {string} ArgMessageText User-facing text prompt.
   * @param {string} ArgSystemInstructions System instructions string.
   * @param {object} ArgJsonSchemaObject Either the OpenAI `{name, strict, schema}` envelope or a bare JSON Schema.
   * @param {{ Base64: string, Mimetype: string }} ArgImage Image payload from SlackFileDownloadAsync.
   * @param {string} ArgModelName Model ID (e.g. 'gemini-2.5-flash').
   * @returns {Promise<object>} Parsed JSON response object.
   */
  async ProcessMultimodalMessageWithJsonResponseAsync(ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgImage, ArgModelName) {
    if(!ArgImage || !ArgImage.Base64 || !ArgImage.Mimetype)
      throw new Error('ProcessMultimodalMessageWithJsonResponseAsync requires an ArgImage with Base64 and Mimetype.');

    const InnerSchema = GeminiProvider.#SanitizeSchemaForGemini(
      GeminiProvider.#ExtractInnerSchema(ArgJsonSchemaObject)
    );

    // Build contents[0].parts with one image part followed by the text part — Gemini expects the
    // image first when pairing inlineData with text in a single user turn.
    const Payload = {
      systemInstruction: { parts: [{ text: ArgSystemInstructions }] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: ArgImage.Mimetype, data: ArgImage.Base64 } },
          { text: ArgMessageText },
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: InnerSchema
      }
    };

    const Data = await this.#GenerateContentAsync(ArgModelName, Payload);

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    const TotalPromptLength = ArgMessageText.length + ArgSystemInstructions.length + (ArgImage?.Base64 || '').length;
    this.#WorkspaceStats.OutgoingGptMessageLength += TotalPromptLength;

    const Candidate = Data.candidates?.[0];
    if(Candidate && Candidate.finishReason !== 'STOP') {
      throw new Error(`Model did not stop naturally: ${Candidate.finishReason}.`);
    }

    const Text = GeminiProvider.#ExtractText(Data);
    if(!Text)
      throw new Error('Gemini multimodal response contained no text content.');

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    try {
      return JSON.parse(Text);
    } catch(ParseError) {
      throw new Error(`Gemini multimodal returned invalid JSON (${ParseError.message}): ${Text.slice(0, 200)}`);
    }
  }

  /**
   * POST a generateContent request to the Google Generative Language REST API. The API key
   * goes in the `x-goog-api-key` header rather than the query string so it is not captured
   * in HTTP server logs.
   * @param {string} ArgModelName
   * @param {object} ArgPayload
   * @returns {Promise<any>}
   */
  async #GenerateContentAsync(ArgModelName, ArgPayload) {
    const Endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${ArgModelName}:generateContent`;
    const Response = await fetch(Endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#WorkspaceInfo.GEMINI_API_KEY },
      body: JSON.stringify(ArgPayload)
    });
    
    if(!Response.ok) {
      const ErrorText = await Response.text();
      throw new Error(`Gemini API failed (${Response.status}): ${ErrorText.slice(0, 300)}`);
    }
    
    return Response.json();
  }

  /**
   * Concatenate every text part in a generateContent response. Gemini returns a `parts`
   * array even for plain-text replies; reaching for `parts[0].text` directly loses partial
   * text when a response interleaves parts.
   * @param {any} ArgData
   * @returns {string}
   */
  static #ExtractText(ArgData) {
    const Candidate = ArgData.candidates?.[0];
    if(!Candidate) return '';
    const Parts = Candidate.content?.parts || [];
    return Parts.map((/** @type {any} */ ArgPart) => ArgPart.text || '').join('');
  }

  /**
   * @param {string} ArgMessageText
   * @param {string} ArgSystemInstructions
   * @param {object} ArgJsonSchemaObject Either the OpenAI `{name, strict, schema}` envelope or a bare JSON Schema.
   * @param {string} ArgModelName
   * @returns {Promise<object>}
   */
  async ProcessMessageWithJsonResponseAsync(ArgMessageText, ArgSystemInstructions, ArgJsonSchemaObject, ArgModelName) {
    const InnerSchema = GeminiProvider.#SanitizeSchemaForGemini(
      GeminiProvider.#ExtractInnerSchema(ArgJsonSchemaObject)
    );

    const Payload = {
      systemInstruction: { parts: [{ text: ArgSystemInstructions }] },
      contents: [{ role: 'user', parts: [{ text: ArgMessageText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: InnerSchema
      }
    };

    const Data = await this.#GenerateContentAsync(ArgModelName, Payload);

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgMessageText.length + ArgSystemInstructions.length;

    const Candidate = Data.candidates?.[0];
    if(Candidate && Candidate.finishReason !== 'STOP') {
      throw new Error(`Model did not stop naturally: ${Candidate.finishReason}.`);
    }

    const Text = GeminiProvider.#ExtractText(Data);
    if(!Text)
      throw new Error('Gemini response contained no text content.');

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    try {
      return JSON.parse(Text);
    } catch(ParseError) {
      throw new Error(`Gemini returned invalid JSON (${ParseError.message}): ${Text.slice(0, 200)}`);
    }
  }

  /**
   * @param {string} ArgMessageText
   * @param {string} ArgSystemInstructions
   * @param {string} ArgModelName
   * @returns {Promise<string>}
   */
  async ProcessMessageWithTextResponseAsync(ArgMessageText, ArgSystemInstructions, ArgModelName) {
    const Payload = {
      systemInstruction: { parts: [{ text: ArgSystemInstructions }] },
      contents: [{ role: 'user', parts: [{ text: ArgMessageText }] }]
    };

    const Data = await this.#GenerateContentAsync(ArgModelName, Payload);

    this.#WorkspaceStats.OutgoingGptMessageCount++;
    this.#WorkspaceStats.OutgoingGptMessageLength += ArgMessageText.length + ArgSystemInstructions.length;

    const Candidate = Data.candidates?.[0];
    if(Candidate && Candidate.finishReason !== 'STOP') {
      throw new Error(`Model did not stop naturally: ${Candidate.finishReason}.`);
    }

    const Text = GeminiProvider.#ExtractText(Data);
    if(!Text)
      throw new Error('Gemini response contained no text content.');

    this.#WorkspaceStats.IncomingGptMessageCount++;
    this.#WorkspaceStats.IncomingGptMessageLength += Text.length;

    return Text;
  }

  /**
   * @returns {Promise<string[]>}
   */
  async GetAvailableModelsAsync() {
    if(this.#AvailableModels) return this.#AvailableModels;

    const Endpoint = `https://generativelanguage.googleapis.com/v1beta/models`;
    const Response = await fetch(Endpoint, {
      headers: { 'x-goog-api-key': this.#WorkspaceInfo.GEMINI_API_KEY }
    });

    if(!Response.ok) {
      throw new Error(`Gemini models.list failed: ${Response.status}`);
    }

    // required lazily — index.js requires this module, so a top-level require is circular.
    // Reusing the registry's own pattern keeps the advertised catalog equal to the set of
    // models that actually route back to this provider.
    const { GeminiModelPattern } = require('./index');

    const Data = await Response.json();
    /** @type {string[]} */
    const Ids = [];
    for(const Model of (Data.models || [])) {
      if(Model && typeof Model.name === 'string') {
        const Name = Model.name.replace(/^models\//, '');
        // Keep a model only when it supports generateContent AND its name routes back to
        // this provider. The Gemini API also lists gemma-*, lyria-*, deep-research-*, etc.
        // — generateContent-capable but not gemini-*; the registry would send those to the
        // default (OpenAI) provider, so advertising them here is misleading and breaks.
        if(Model.supportedGenerationMethods
          && Model.supportedGenerationMethods.includes('generateContent')
          && GeminiModelPattern.test(Name)) {
          Ids.push(Name);
        }
      }
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
      const Endpoint = `https://generativelanguage.googleapis.com/v1beta/models`;
      const Response = await fetch(Endpoint, {
        headers: { 'x-goog-api-key': this.#WorkspaceInfo.GEMINI_API_KEY }
      });
      
      if(!Response.ok) {
        const Status = Response.status;
        const Code = Status === 401 || Status === 403 ? 'auth_failed'
          : Status === 429 ? 'rate_limited'
          : Status === 503 ? 'overloaded'
          : 'api_error';
        const ErrorText = await Response.text();
        return { ok: false, error: `Gemini API failed (${Status}): ${ErrorText.slice(0, 100)}`, code: Code };
      }
      
      return { ok: true };
    } catch(error) {
      return { ok: false, error: error.message, code: 'api_error' };
    }
  }
}

module.exports = GeminiProvider;
