'use strict';

jest.mock('@anthropic-ai/sdk', () => {
  const Ctor = jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
    models: { list: jest.fn() },
  }));
  return { Anthropic: Ctor };
}, { virtual: true });

const {
  GetProviderDescriptorForModel,
  GetDefaultProviderDescriptor,
  GetAllProviderDescriptors,
} = require('../src/ai-providers');

describe('AI provider registry', () => {
  describe('GetProviderDescriptorForModel', () => {
    test('routes claude-* model names to the anthropic provider', () => {
      const Descriptor = GetProviderDescriptorForModel('claude-opus-4-7');
      expect(Descriptor).not.toBeNull();
      expect(Descriptor.Id).toBe('anthropic');
    });

    test('routes gpt-* model names to the openai provider', () => {
      const Descriptor = GetProviderDescriptorForModel('gpt-4o-mini');
      expect(Descriptor).not.toBeNull();
      expect(Descriptor.Id).toBe('openai');
    });

    test('routes o-series model names to the openai provider', () => {
      const Descriptor = GetProviderDescriptorForModel('o3-mini');
      expect(Descriptor).not.toBeNull();
      expect(Descriptor.Id).toBe('openai');
    });

    test('routes chatgpt-* / codex-* / computer-use-* model names to the openai provider', () => {
      expect(GetProviderDescriptorForModel('chatgpt-4o-latest').Id).toBe('openai');
      expect(GetProviderDescriptorForModel('codex-mini-latest').Id).toBe('openai');
      expect(GetProviderDescriptorForModel('computer-use-preview').Id).toBe('openai');
    });

    test('routes gemini-* model names to the gemini provider', () => {
      const Descriptor = GetProviderDescriptorForModel('gemini-1.5-flash-latest');
      expect(Descriptor).not.toBeNull();
      expect(Descriptor.Id).toBe('gemini');
    });

    test('returns null for unknown model name prefixes so the caller can fall back', () => {
      expect(GetProviderDescriptorForModel('some-fine-tuned-model')).toBeNull();
      expect(GetProviderDescriptorForModel('')).toBeNull();
      expect(GetProviderDescriptorForModel(null)).toBeNull();
    });

    test('matches model names case-insensitively (defensive against canonicalization)', () => {
      expect(GetProviderDescriptorForModel('CLAUDE-OPUS-4-7').Id).toBe('anthropic');
      expect(GetProviderDescriptorForModel('GPT-4o').Id).toBe('openai');
    });
  });

  describe('GetDefaultProviderDescriptor', () => {
    test('returns the openai descriptor so unprefixed/custom model IDs route to OpenAI', () => {
      expect(GetDefaultProviderDescriptor().Id).toBe('openai');
    });
  });

  describe('GetAllProviderDescriptors', () => {
    test('returns all registered providers (openai, anthropic, and gemini)', () => {
      const Ids = GetAllProviderDescriptors().map((ArgEntry) => ArgEntry.Id).sort();
      expect(Ids).toEqual(['anthropic', 'gemini', 'openai']);
    });

    test('returns a fresh array so callers can mutate without corrupting the registry', () => {
      const First = GetAllProviderDescriptors();
      First.length = 0;
      const Second = GetAllProviderDescriptors();
      expect(Second.length).toBeGreaterThan(0);
    });
  });

  describe('provider Build()', () => {
    const BaseWorkspaceInfo = {
      WORKSPACE_NAME: 'TestWorkspace',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'test-reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    };
    const EmptyStats = {
      OutgoingGptMessageCount: 0,
      OutgoingGptMessageLength: 0,
      IncomingGptMessageCount: 0,
      IncomingGptMessageLength: 0,
    };

    test('anthropic Build() returns null when ANTHROPIC_API_KEY is missing', () => {
      const Anthropic = GetAllProviderDescriptors().find((ArgEntry) => ArgEntry.Id === 'anthropic');
      expect(Anthropic.Build(BaseWorkspaceInfo, EmptyStats)).toBeNull();
    });

    test('anthropic Build() returns a provider instance when ANTHROPIC_API_KEY is set', () => {
      const Anthropic = GetAllProviderDescriptors().find((ArgEntry) => ArgEntry.Id === 'anthropic');
      const WithKey = { ...BaseWorkspaceInfo, ANTHROPIC_API_KEY: 'sk-ant-test' };
      const Instance = Anthropic.Build(WithKey, EmptyStats);
      expect(Instance).not.toBeNull();
      expect(Instance.Id).toBe('anthropic');
      expect(typeof Instance.ProcessMessageWithJsonResponseAsync).toBe('function');
      expect(typeof Instance.ProcessMessageWithTextResponseAsync).toBe('function');
      expect(typeof Instance.GetAvailableModelsAsync).toBe('function');
      expect(typeof Instance.IsValidModelAsync).toBe('function');
      expect(typeof Instance.TestConnectivityAsync).toBe('function');
    });

    test('openai Build() returns null when OPENAI_API_KEY is missing', () => {
      const OpenAI = GetAllProviderDescriptors().find((ArgEntry) => ArgEntry.Id === 'openai');
      const NoKey = { ...BaseWorkspaceInfo, OPENAI_API_KEY: '' };
      expect(OpenAI.Build(NoKey, EmptyStats)).toBeNull();
    });

    test('gemini Build() returns null when GEMINI_API_KEY is missing', () => {
      const Gemini = GetAllProviderDescriptors().find((ArgEntry) => ArgEntry.Id === 'gemini');
      expect(Gemini.Build(BaseWorkspaceInfo, EmptyStats)).toBeNull();
    });

    test('gemini Build() returns a provider instance when GEMINI_API_KEY is set', () => {
      const Gemini = GetAllProviderDescriptors().find((ArgEntry) => ArgEntry.Id === 'gemini');
      const WithKey = { ...BaseWorkspaceInfo, GEMINI_API_KEY: 'goog-test' };
      const Instance = Gemini.Build(WithKey, EmptyStats);
      expect(Instance).not.toBeNull();
      expect(Instance.Id).toBe('gemini');
      expect(typeof Instance.ProcessMessageWithJsonResponseAsync).toBe('function');
      expect(typeof Instance.ProcessMessageWithTextResponseAsync).toBe('function');
      expect(typeof Instance.GetAvailableModelsAsync).toBe('function');
      expect(typeof Instance.IsValidModelAsync).toBe('function');
      expect(typeof Instance.TestConnectivityAsync).toBe('function');
    });
  });
});
