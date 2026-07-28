'use strict';

// Mock both provider SDKs before requiring the modules under test so constructor calls
// hit the mocks rather than the real OpenAI / Anthropic clients (which would try to make
// network calls).
jest.mock('openai', () => {
  const Ctor = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
    models: { list: jest.fn() },
    responses: { create: jest.fn() },
  }));
  return { OpenAI: Ctor };
});

jest.mock('@anthropic-ai/sdk', () => {
  const Ctor = jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
    models: { list: jest.fn() },
  }));
  return { Anthropic: Ctor };
}, { virtual: true });

const WorkspaceAI = require('../src/workspace-ai');

const BaseWorkspaceInfo = {
  WORKSPACE_NAME: 'TestWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-openai-test',
  ANTHROPIC_API_KEY: 'sk-anthropic-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};
const EmptyStats = {
  OutgoingGptMessageCount: 0,
  OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0,
  IncomingGptMessageLength: 0,
};

describe('WorkspaceAI provider routing', () => {
  beforeEach(() => {
    require('openai').OpenAI.mockClear();
    require('@anthropic-ai/sdk').Anthropic.mockClear();
  });

  test('defaults to gpt-4o-mini when no DEFAULT_MODEL_NAME is set', () => {
    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats);
    expect(Ai.DefaultModelName).toBe('gpt-4o-mini');
    expect(Ai.ComplexModelName).toBe('gpt-4o');
  });

  test('honors DEFAULT_MODEL_NAME from the workspace JSON (claude default supported)', () => {
    const Ai = new WorkspaceAI(
      { ...BaseWorkspaceInfo, DEFAULT_MODEL_NAME: 'claude-haiku-4-5' },
      EmptyStats,
    );
    expect(Ai.DefaultModelName).toBe('claude-haiku-4-5');
  });

  test('falls back to Anthropic models when the workspace only has ANTHROPIC_API_KEY configured', () => {
    const AnthropicOnlyWorkspace = { ...BaseWorkspaceInfo };
    delete AnthropicOnlyWorkspace.OPENAI_API_KEY;

    const Ai = new WorkspaceAI(AnthropicOnlyWorkspace, EmptyStats);
    expect(Ai.DefaultModelName).toBe('claude-sonnet-4-6');
    expect(Ai.ComplexModelName).toBe('claude-sonnet-4-6');
  });

  test('falls back to Gemini models when the workspace only has GEMINI_API_KEY configured', () => {
    const GeminiOnlyWorkspace = {
      ...BaseWorkspaceInfo,
      GEMINI_API_KEY: 'goog-gemini-test',
    };
    delete GeminiOnlyWorkspace.OPENAI_API_KEY;
    delete GeminiOnlyWorkspace.ANTHROPIC_API_KEY;

    const Ai = new WorkspaceAI(GeminiOnlyWorkspace, EmptyStats);
    expect(Ai.DefaultModelName).toBe('gemini-3.5-flash');
    expect(Ai.ComplexModelName).toBe('gemini-3.1-pro-preview');
  });

  test('routes a gpt-* text request to OpenAI without instantiating the Anthropic SDK', async () => {
    const OpenAIMock = require('openai').OpenAI;
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;

    OpenAIMock.mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'hello from openai' }, finish_reason: 'stop' }],
          }),
        },
      },
      models: { list: jest.fn() },
      responses: { create: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats);
    const Result = await Ai.ProcessMessageWithTextResponseAsync('hi', 'sys');

    expect(Result).toBe('hello from openai');
    expect(OpenAIMock).toHaveBeenCalledTimes(1);
    expect(AnthropicMock).not.toHaveBeenCalled();
  });

  test('routes a claude-* text request to Anthropic without instantiating the OpenAI SDK', async () => {
    const OpenAIMock = require('openai').OpenAI;
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    AnthropicMock.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'hello from claude' }],
        }),
      },
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    const Result = await Ai.ProcessMessageWithTextResponseAsync('hi', 'sys');

    expect(Result).toBe('hello from claude');
    expect(AnthropicMock).toHaveBeenCalledTimes(1);
    expect(OpenAIMock).not.toHaveBeenCalled();
  });

  test('routes a claude-* JSON request through the Anthropic structured-output API', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    const CreateMock = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"answer":"42"}' }],
    });
    AnthropicMock.mockImplementation(() => ({
      messages: { create: CreateMock },
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    const Schema = {
      name: 'simple',
      strict: true,
      schema: { type: 'object', properties: { answer: { type: 'string' } } },
    };

    const Result = await Ai.ProcessMessageWithJsonResponseAsync('q', 'sys', Schema);

    expect(Result).toEqual({ answer: '42' });
    expect(CreateMock).toHaveBeenCalledTimes(1);
    const CallArgs = CreateMock.mock.calls[0][0];
    expect(CallArgs.model).toBe('claude-opus-4-7');
    expect(CallArgs.output_config).toEqual({
      format: { type: 'json_schema', schema: Schema.schema },
    });
  });

  test('reports a claude-* model as provider-not-configured when ANTHROPIC_API_KEY is missing', async () => {
    const NoKey = { ...BaseWorkspaceInfo };
    delete NoKey.ANTHROPIC_API_KEY;
    const Ai = new WorkspaceAI(NoKey, EmptyStats);

    const Result = await Ai.GetModelAvailabilityAsync('claude-opus-4-7');
    expect(Result).toEqual({
      ok: false,
      reason: 'provider-not-configured',
      providerId: 'anthropic',
      providerLabel: 'Anthropic Claude',
      error: "Cannot use model 'claude-opus-4-7': Anthropic Claude API key is not configured for this workspace.",
    });
  });

  test('throws from IsValidModelAsync when provider configuration is missing so callers do not misreport it as not found', async () => {
    const NoKey = { ...BaseWorkspaceInfo };
    delete NoKey.ANTHROPIC_API_KEY;
    const Ai = new WorkspaceAI(NoKey, EmptyStats);

    await expect(Ai.IsValidModelAsync('claude-opus-4-7')).rejects.toThrow(
      "Cannot use model 'claude-opus-4-7': Anthropic Claude API key is not configured for this workspace."
    );
  });

  test('sends system instructions as a cached content block for Anthropic text requests', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    const CreateMock = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
    });
    AnthropicMock.mockImplementation(() => ({
      messages: { create: CreateMock },
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    await Ai.ProcessMessageWithTextResponseAsync('hi', 'be helpful');

    const CallArgs = CreateMock.mock.calls[0][0];
    expect(Array.isArray(CallArgs.system)).toBe(true);
    expect(CallArgs.system[0]).toEqual({
      type: 'text',
      text: 'be helpful',
      cache_control: { type: 'ephemeral' },
    });
  });

  test('sends system instructions as a cached content block for Anthropic JSON requests', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    const CreateMock = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"x":1}' }],
    });
    AnthropicMock.mockImplementation(() => ({
      messages: { create: CreateMock },
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    await Ai.ProcessMessageWithJsonResponseAsync('q', 'sys', { name: 's', strict: true, schema: { type: 'object' } });

    const CallArgs = CreateMock.mock.calls[0][0];
    expect(Array.isArray(CallArgs.system)).toBe(true);
    expect(CallArgs.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('accepts a bare JSON Schema (no OpenAI envelope) for Anthropic JSON requests', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    const CreateMock = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"x":1}' }],
    });
    AnthropicMock.mockImplementation(() => ({
      messages: { create: CreateMock },
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    const BareSchema = { type: 'object', properties: { x: { type: 'number' } } };
    const Result = await Ai.ProcessMessageWithJsonResponseAsync('q', 'sys', BareSchema);

    expect(Result).toEqual({ x: 1 });
    const CallArgs = CreateMock.mock.calls[0][0];
    expect(CallArgs.output_config.format.schema).toEqual(BareSchema);
  });

  test('wraps malformed JSON from Anthropic in a descriptive error', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    AnthropicMock.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'not-valid-json{' }],
        }),
      },
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    await expect(
      Ai.ProcessMessageWithJsonResponseAsync('q', 'sys', { name: 's', strict: true, schema: { type: 'object' } })
    ).rejects.toThrow('Anthropic returned invalid JSON');
  });

  test('wraps malformed JSON from OpenAI in a descriptive error', async () => {
    const OpenAIMock = require('openai').OpenAI;
    OpenAIMock.mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'not-valid-json{' }, finish_reason: 'stop' }],
          }),
        },
      },
      models: { list: jest.fn() },
      responses: { create: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats);
    await expect(
      Ai.ProcessMessageWithJsonResponseAsync('q', 'sys', { name: 's', strict: true, schema: { type: 'object' } })
    ).rejects.toThrow('OpenAI returned invalid JSON');
  });

  test('TestConnectivityAsync returns auth_failed code on Anthropic 401', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    const AuthError = Object.assign(new Error('Invalid API key'), { status: 401 });
    AnthropicMock.mockImplementation(() => ({
      messages: { create: jest.fn() },
      models: {
        list: jest.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => ({ next: jest.fn().mockRejectedValue(AuthError) }),
        }),
      },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    const Result = await Ai.TestConnectivityAsync();
    expect(Result.ok).toBe(false);
    expect(Result.code).toBe('auth_failed');
  });

  test('TestConnectivityAsync returns rate_limited code on Anthropic 429', async () => {
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    const RateLimitError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    AnthropicMock.mockImplementation(() => ({
      messages: { create: jest.fn() },
      models: {
        list: jest.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => ({ next: jest.fn().mockRejectedValue(RateLimitError) }),
        }),
      },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats, 'claude-opus-4-7');
    const Result = await Ai.TestConnectivityAsync();
    expect(Result.ok).toBe(false);
    expect(Result.code).toBe('rate_limited');
  });

  test('switching the default model name re-routes subsequent calls to the new provider', async () => {
    const OpenAIMock = require('openai').OpenAI;
    const AnthropicMock = require('@anthropic-ai/sdk').Anthropic;
    OpenAIMock.mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'oa' }, finish_reason: 'stop' }],
      })}},
      models: { list: jest.fn() },
      responses: { create: jest.fn() },
    }));
    AnthropicMock.mockImplementation(() => ({
      messages: { create: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'an' }],
      })},
      models: { list: jest.fn() },
    }));

    const Ai = new WorkspaceAI(BaseWorkspaceInfo, EmptyStats); // default gpt-4o-mini
    await Ai.ProcessMessageWithTextResponseAsync('q', 's');
    expect(OpenAIMock).toHaveBeenCalled();
    expect(AnthropicMock).not.toHaveBeenCalled();

    Ai.DefaultModelName = 'claude-opus-4-7';
    await Ai.ProcessMessageWithTextResponseAsync('q', 's');
    expect(AnthropicMock).toHaveBeenCalled();
  });
});
