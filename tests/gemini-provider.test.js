'use strict';

// Standalone suite for GeminiProvider's raw-fetch transport. It lives in its own file
// (not ai-providers.test.js) on purpose: GeminiProvider talks to the Google Generative
// Language REST API through the global `fetch`, so these tests stub `global.fetch`. Jest
// isolates each test file in its own module registry and global scope, so the stub here
// cannot leak into ai-providers.test.js (which mocks the Anthropic SDK instead). The
// per-test save/restore below is a second layer of protection.

const GeminiProvider = require('../src/ai-providers/gemini-provider');

describe('GeminiProvider (raw fetch transport)', () => {
  const WorkspaceInfo = { GEMINI_API_KEY: 'goog-test-key' };
  const OriginalFetch = global.fetch;
  /** @type {jest.Mock} */
  let FetchMock;

  /** Fresh zeroed stats object — the provider mutates these counters in place. */
  function MakeStats() {
    return {
      OutgoingGptMessageCount: 0,
      OutgoingGptMessageLength: 0,
      IncomingGptMessageCount: 0,
      IncomingGptMessageLength: 0,
    };
  }

  /**
   * Build a minimal stand-in for the WHATWG Response the provider's fetch consumers read
   * (`ok`, `status`, `json()`, `text()`).
   * @param {{ok?: boolean, status?: number, json?: any, text?: string}} ArgOptions
   */
  function FakeResponse({ ok = true, status = 200, json = {}, text = '' } = {}) {
    return {
      ok,
      status,
      json: async () => json,
      text: async () => text,
    };
  }

  beforeEach(() => {
    FetchMock = jest.fn();
    global.fetch = FetchMock;
  });

  afterEach(() => {
    global.fetch = OriginalFetch;
    jest.clearAllMocks();
  });

  describe('ProcessMessageWithTextResponseAsync', () => {
    test('returns the concatenated model text and records send/receive stats', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: {
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: 'Hello ' }, { text: 'world' }] },
          }],
        },
      }));
      const Stats = MakeStats();
      const Provider = new GeminiProvider(WorkspaceInfo, Stats);

      const Result = await Provider.ProcessMessageWithTextResponseAsync('ping', 'be terse', 'gemini-2.5-flash');

      expect(Result).toBe('Hello world');
      expect(Stats.OutgoingGptMessageCount).toBe(1);
      expect(Stats.OutgoingGptMessageLength).toBe('ping'.length + 'be terse'.length);
      expect(Stats.IncomingGptMessageCount).toBe(1);
      expect(Stats.IncomingGptMessageLength).toBe('Hello world'.length);
    });

    test('POSTs to the model-specific generateContent endpoint with the key in a header', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      await Provider.ProcessMessageWithTextResponseAsync('ping', 'be terse', 'gemini-2.5-flash');

      expect(FetchMock).toHaveBeenCalledTimes(1);
      const [Url, Init] = FetchMock.mock.calls[0];
      expect(Url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect(Init.method).toBe('POST');
      expect(Init.headers['x-goog-api-key']).toBe('goog-test-key');
      // key travels in the header, never the URL — it must not land in HTTP server logs.
      expect(Url).not.toContain('goog-test-key');

      const Body = JSON.parse(Init.body);
      expect(Body.systemInstruction.parts[0].text).toBe('be terse');
      expect(Body.contents[0].role).toBe('user');
      expect(Body.contents[0].parts[0].text).toBe('ping');
    });

    test('throws when the model stops for a reason other than STOP', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      await expect(Provider.ProcessMessageWithTextResponseAsync('q', 's', 'gemini-2.5-flash'))
        .rejects.toThrow('Model did not stop naturally: MAX_TOKENS');
    });

    test('throws with the status and body excerpt when the API responds non-OK', async () => {
      FetchMock.mockResolvedValue(FakeResponse({ ok: false, status: 400, text: 'bad request detail' }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      await expect(Provider.ProcessMessageWithTextResponseAsync('q', 's', 'gemini-2.5-flash'))
        .rejects.toThrow('Gemini API failed (400): bad request detail');
    });
  });

  describe('ProcessMessageWithJsonResponseAsync', () => {
    test('parses the JSON reply and strips schema keys Gemini rejects', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
      // OpenAI-style envelope with a nested additionalProperties — both must be removed
      // before the schema reaches Gemini's responseSchema.
      const Envelope = {
        name: 'demo',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            nested: {
              type: 'object',
              properties: { x: { type: 'integer' } },
              additionalProperties: false,
            },
          },
          required: ['ok'],
          additionalProperties: false,
        },
      };

      const Result = await Provider.ProcessMessageWithJsonResponseAsync('q', 'sys', Envelope, 'gemini-2.5-flash');

      expect(Result).toEqual({ ok: true });

      const Body = JSON.parse(FetchMock.mock.calls[0][1].body);
      expect(Body.generationConfig.responseMimeType).toBe('application/json');
      expect(Body.generationConfig.responseSchema).toEqual({
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          nested: {
            type: 'object',
            properties: { x: { type: 'integer' } },
          },
        },
        required: ['ok'],
      });
    });

    test('throws when the model returns text that is not valid JSON', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json at all' }] } }] },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      await expect(Provider.ProcessMessageWithJsonResponseAsync('q', 's', { schema: {} }, 'gemini-2.5-flash'))
        .rejects.toThrow('Gemini returned invalid JSON');
    });
  });

  describe('GetAvailableModelsAsync / IsValidModelAsync', () => {
    test('keeps only generateContent models, strips the models/ prefix, and caches the result', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: {
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/gemini-1.5-pro-latest', supportedGenerationMethods: ['generateContent'] },
          ],
        },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      const First = await Provider.GetAvailableModelsAsync();
      expect(First).toEqual(['gemini-2.5-flash', 'gemini-1.5-pro-latest']);

      // second call is served from the in-memory cache — no second network round-trip.
      const Second = await Provider.GetAvailableModelsAsync();
      expect(Second).toEqual(First);
      expect(FetchMock).toHaveBeenCalledTimes(1);

      const [Url, Init] = FetchMock.mock.calls[0];
      expect(Url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
      expect(Init.headers['x-goog-api-key']).toBe('goog-test-key');
    });

    test('excludes generateContent models whose names do not route back to this provider', async () => {
      // The Gemini API also lists gemma-*, lyria-*, deep-research-*, etc. They support
      // generateContent, but the registry routes only gemini-* here — advertising them
      // would surface models that fail validation or dispatch to the wrong provider.
      FetchMock.mockResolvedValue(FakeResponse({
        json: {
          models: [
            { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/lyria-3-pro-preview', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/deep-research-pro-preview-12-2025', supportedGenerationMethods: ['generateContent'] },
          ],
        },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      const Models = await Provider.GetAvailableModelsAsync();
      expect(Models).toEqual(['gemini-3.5-flash']);
    });

    test('throws when the models.list endpoint responds non-OK', async () => {
      FetchMock.mockResolvedValue(FakeResponse({ ok: false, status: 500 }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      await expect(Provider.GetAvailableModelsAsync()).rejects.toThrow('Gemini models.list failed: 500');
    });

    test('IsValidModelAsync reflects the live catalog', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] },
      }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      expect(await Provider.IsValidModelAsync('gemini-2.5-flash')).toBe(true);
      expect(await Provider.IsValidModelAsync('gemini-9-ultra')).toBe(false);
    });
  });

  describe('TestConnectivityAsync', () => {
    test('returns ok when the catalog endpoint responds successfully', async () => {
      FetchMock.mockResolvedValue(FakeResponse({ json: { models: [] } }));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      expect(await Provider.TestConnectivityAsync()).toEqual({ ok: true });
    });

    test('maps HTTP status codes to stable error codes', async () => {
      /** @type {Array<{status: number, code: string}>} */
      const Cases = [
        { status: 401, code: 'auth_failed' },
        { status: 403, code: 'auth_failed' },
        { status: 429, code: 'rate_limited' },
        { status: 503, code: 'overloaded' },
        { status: 500, code: 'api_error' },
      ];
      for(const Case of Cases) {
        FetchMock.mockResolvedValueOnce(FakeResponse({ ok: false, status: Case.status, text: 'err' }));
        const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
        const Result = await Provider.TestConnectivityAsync();
        expect(Result.ok).toBe(false);
        expect(Result.code).toBe(Case.code);
      }
    });

    test('reports a network-level failure as api_error rather than throwing', async () => {
      FetchMock.mockRejectedValue(new Error('socket hang up'));
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());

      const Result = await Provider.TestConnectivityAsync();
      expect(Result).toEqual({ ok: false, error: 'socket hang up', code: 'api_error' });
    });
  });
});
