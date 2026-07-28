'use strict';

const mockResponsesCreate = jest.fn();
const mockChatCompletionsCreate = jest.fn();

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    responses: {
      create: mockResponsesCreate,
    },
    models: {
      list: jest.fn(),
    },
    chat: {
      completions: {
        create: mockChatCompletionsCreate,
      },
    },
  })),
}));

const WorkspaceAI = require('../src/workspace-ai');

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'TestWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

function CreateStats() {
  return {
    IncomingMessageCount: 0,
    IncomingMessageLength: 0,
    OutgoingMessageCount: 0,
    OutgoingMessageLength: 0,
    OutgoingGptMessageCount: 0,
    OutgoingGptMessageLength: 0,
    IncomingGptMessageCount: 0,
    IncomingGptMessageLength: 0,
  };
}

describe('WorkspaceAI.ProcessGeminiWebSearchAsync', () => {
  let OriginalFetch;

  beforeAll(() => {
    OriginalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = OriginalFetch;
  });

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test('calls Gemini REST API with integrated web search and extracts sources', async () => {
    const MockResponse = {
      candidates: [
        {
          content: { parts: [{ text: 'Answer from Gemini web search.' }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { title: 'Gemini News', uri: 'https://gemini.google.com/news/' } },
              { web: { title: 'Google', uri: 'https://google.com/' } },
            ],
            webSearchQueries: ['latest gemini news', 'gemini release notes'],
            searchEntryPoint: { renderedContent: '<style>...</style><p>Search Suggestions</p>' }
          }
        }
      ]
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MockResponse,
    });

    const Stats = CreateStats();
    const AI = new WorkspaceAI({ ...TestWorkspaceInfo, GEMINI_API_KEY: 'test-gemini-key' }, Stats);

    const Result = await AI.ProcessGeminiWebSearchAsync('latest Gemini news');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'test-gemini-key' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'latest Gemini news' }] }],
          tools: [{ googleSearch: {} }]
        })
      })
    );

    expect(Result).toEqual({
      text: 'Answer from Gemini web search.',
      sources: [
        { title: 'Gemini News', url: 'https://gemini.google.com/news/' },
        { title: 'Google', url: 'https://google.com/' },
      ],
      searchSuggestions: ['latest gemini news', 'gemini release notes'],
      model: 'gemini-flash-latest',
      responseId: null,
      webSearchCallCount: 1,
    });
    expect(Stats.OutgoingGptMessageCount).toBe(1);
    expect(Stats.IncomingGptMessageCount).toBe(1);
  });

  test('throws error if GEMINI_API_KEY is missing', async () => {
    const AI = new WorkspaceAI(TestWorkspaceInfo, CreateStats()); // Missing GEMINI_API_KEY

    await expect(AI.ProcessGeminiWebSearchAsync('latest Gemini news'))
      .rejects.toThrow('GEMINI_API_KEY is not configured for this workspace');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws error on network failure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    const AI = new WorkspaceAI({ ...TestWorkspaceInfo, GEMINI_API_KEY: 'test-gemini-key' }, CreateStats());

    await expect(AI.ProcessGeminiWebSearchAsync('latest Gemini news'))
      .rejects.toThrow('Gemini web search failed (500): Internal Server Error');
  });
});

describe('WorkspaceAI.ProcessWebSearchAsync', () => {
  beforeEach(() => {
    mockResponsesCreate.mockReset();
    mockChatCompletionsCreate.mockReset();
  });

  test('calls Responses API with integrated web search and extracts sources', async () => {
    mockResponsesCreate.mockResolvedValue({
      id: 'resp_test',
      output_text: 'Answer from web search.',
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [
              { title: 'OpenAI News', url: 'https://openai.com/news/' },
            ],
          },
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Answer from web search.',
              annotations: [
                { title: 'OpenAI', url: 'https://openai.com/' },
              ],
            },
          ],
        },
      ],
    });
    const Stats = CreateStats();
    const AI = new WorkspaceAI(TestWorkspaceInfo, Stats);

    const Result = await AI.ProcessWebSearchAsync('latest OpenAI news');

    expect(mockResponsesCreate).toHaveBeenCalledWith({
      model: 'gpt-5.4-mini',
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      input: 'latest OpenAI news',
      max_output_tokens: 1200,
    });
    expect(Result).toEqual({
      text: 'Answer from web search.',
      sources: [
        { title: 'OpenAI News', url: 'https://openai.com/news/' },
        { title: 'OpenAI', url: 'https://openai.com/' },
      ],
      model: 'gpt-5.4-mini',
      responseId: 'resp_test',
      webSearchCallCount: 1,
    });
    expect(Stats.OutgoingGptMessageCount).toBe(1);
    expect(Stats.IncomingGptMessageCount).toBe(1);
  });

  test('rejects empty queries before calling OpenAI', async () => {
    const AI = new WorkspaceAI(TestWorkspaceInfo, CreateStats());

    await expect(AI.ProcessWebSearchAsync('   ')).rejects.toThrow('web search query must be a non-empty string');

    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });
});

describe('WorkspaceAI chat completions', () => {
  beforeEach(() => {
    mockChatCompletionsCreate.mockReset();
  });

  test('retries once with temperature 1 when an unknown model rejects temperature 0', async () => {
    mockChatCompletionsCreate
      .mockRejectedValueOnce(Object.assign(new Error(
        "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."
      ), {
        code: 'unsupported_value',
        param: 'temperature',
        status: 400,
      }))
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'retry succeeded' },
          },
        ],
      });

    const AI = new WorkspaceAI(TestWorkspaceInfo, CreateStats(), 'future-chat-model');

    const Result = await AI.ProcessMessageWithTextResponseAsync('hello', 'system');

    expect(Result).toBe('retry succeeded');
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(2);
    expect(mockChatCompletionsCreate.mock.calls[0][0].temperature).toBe(0);
    expect(mockChatCompletionsCreate.mock.calls[1][0].temperature).toBe(1);
    expect(mockChatCompletionsCreate.mock.calls[1][0].model).toBe('future-chat-model');
  });

  test('uses temperature 1 immediately for GPT-5-family dotted model names matched by config', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'ok' },
        },
      ],
    });

    const AI = new WorkspaceAI(TestWorkspaceInfo, CreateStats(), 'gpt-5.5');

    await AI.ProcessMessageWithTextResponseAsync('hello', 'system', 'gpt-5.5');

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCompletionsCreate.mock.calls[0][0].temperature).toBe(1);
  });
});

describe('WorkspaceAI constructor — persisted model names from WorkspaceInfo', () => {
  test('uses DEFAULT_MODEL_NAME / COMPLEX_MODEL_NAME from WorkspaceInfo when present, and the hardcoded fallbacks when absent', () => {
    // when the persisted fields are set on the workspace JSON, the constructor must surface them
    // — otherwise the `switch-models:'...'` command's effect would not survive a process restart.
    const Persisted = new WorkspaceAI(
      { ...TestWorkspaceInfo, DEFAULT_MODEL_NAME: 'gpt-5-mini', COMPLEX_MODEL_NAME: 'gpt-5' },
      CreateStats()
    );
    expect(Persisted.DefaultModelName).toBe('gpt-5-mini');
    expect(Persisted.ComplexModelName).toBe('gpt-5');

    const Defaults = new WorkspaceAI(TestWorkspaceInfo, CreateStats());
    expect(Defaults.DefaultModelName).toBe('gpt-4o-mini');
    expect(Defaults.ComplexModelName).toBe('gpt-4o');
  });
});
