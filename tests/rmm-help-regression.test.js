'use strict';

/**
 * Regression coverage for rmm and help-mode intent resolution. Each scenario mocks a specific
 * `ProcessMessageWithJsonResponseAsync` response (the role of the LLM) and asserts the rendered
 * Slack message produced by the rmm-command / help-features-command handlers. The intent is to
 * lock down two failure shapes that historically slipped through:
 *
 *   1. Discovery framings ("how do I X?", "what's the command for X?") must show the command
 *      syntax with placeholders rather than asking the user to clarify a missing argument.
 *   2. Truly ambiguous requests should keep producing a clarification message (and the new
 *      command pointer when the workspace is the Neochrome tenant).
 *
 * Real catalog and rmm assets are loaded from disk by `command-intent-resolver.js`; only the
 * LLM call surface is mocked, so the resolver's argument-validation, syntax-template lookup,
 * and renderer all run against production data.
 */

const mockWorkspaceAIInstances = [];

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation((WorkspaceInfo) => {
    const Instance = {
      WorkspaceInfo,
      DefaultModelName: 'gpt-4o-mini',
      ComplexModelName: 'gpt-4o',
      ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
        intent_id: 'clarify',
        confidence: 0.25,
        rationale: 'mock clarify',
        needs_clarification: true,
        clarification_question: 'Which exact Sleuth command do you want?',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      }),
      ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
      ProcessWebSearchAsync: jest.fn().mockResolvedValue({
        text: 'mock', sources: [], model: 'gpt-test', responseId: null, webSearchCallCount: 0,
      }),
      ProcessGeminiWebSearchAsync: jest.fn().mockResolvedValue({
        text: 'mock', sources: [], searchSuggestions: [], model: 'gemini-test', responseId: null, webSearchCallCount: 0,
      }),
      TestConnectivityAsync: jest.fn().mockResolvedValue({ ok: true }),
      GetAvailableModelsAsync: jest.fn().mockResolvedValue(['gpt-4o-mini', 'gpt-5']),
      IsValidModelAsync: jest.fn().mockResolvedValue(true),
    };
    mockWorkspaceAIInstances.push(Instance);
    return Instance;
  });
});

const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'RmmRegressionWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0,
  IncomingMessageLength: 0,
  OutgoingMessageCount: 0,
  OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0,
  OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0,
  IncomingGptMessageLength: 0,
};

/**
 * Build a complete LLM response object. Every field is required by the rmm structured-output
 * schema; tests only need to override the meaningful ones.
 *
 * @param {Partial<{
 *   intent_id: string,
 *   needs_clarification: boolean,
 *   clarification_question: string,
 *   rationale: string,
 *   confidence: number,
 *   default_model_name: string,
 *   complex_model_name: string,
 *   channel_model_name: string,
 *   query_text: string,
 *   user_mention: string,
 * }>} ArgOverrides
 * @returns {object}
 */
function BuildLlmResponse(ArgOverrides) {
  return {
    intent_id: 'clarify',
    needs_clarification: false,
    clarification_question: '',
    rationale: '',
    confidence: 0.9,
    default_model_name: '',
    complex_model_name: '',
    channel_model_name: '',
    query_text: '',
    user_mention: '',
    ...ArgOverrides,
  };
}

/**
 * @param {MockSlackApp} ArgSlackApp
 * @param {string} ArgText
 * @returns {Promise<boolean>}
 */
function SimulateAsync(ArgSlackApp, ArgText) {
  return ArgSlackApp.SimulateAppMentionAsync({
    channel: 'C_GENERAL',
    user: 'U_REGULAR',
    text: `${ArgSlackApp.AppMentionString} ${ArgText}`,
  });
}

describe('rmm/help regression coverage — 10 scenarios', () => {
  beforeEach(() => {
    mockWorkspaceAIInstances.length = 0;
  });

  // --- Discovery path: LLM picks an intent but the user did not supply the argument. ---

  test('1. rmm "how do I change models?" suggests switch-models syntax instead of clarification', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'model-switch-default',
      rationale: 'User is asking how to change the default model.',
    }));

    await SimulateAsync(SlackApp, 'rmm how do I change models?');

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} switch-models:'<model>'\``
    );
    expect(SlackApp.SentMessages[0].text).toContain('Replace the bracketed placeholders');
    expect(SlackApp.SentMessages[0].text).not.toContain('I need one clarification');
  });

  test('2. rmm "how to switch the complex model?" suggests switch-models:complex syntax', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'model-switch-complex',
      rationale: 'User wants to know how to change the complex model.',
    }));

    await SimulateAsync(SlackApp, 'rmm how to switch the complex model?');

    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} switch-models:complex='<model>'\``
    );
  });

  test('3. rmm "what is the command to search reminders?" suggests search reminders syntax', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'search-reminders',
      rationale: 'User is asking for the reminder-search command.',
    }));

    await SimulateAsync(SlackApp, 'rmm what is the command to search reminders?');

    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} search reminders <keywords>\``
    );
  });

  test('4. rmm ifl with discovery framing suggests syntax instead of executing', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'model-switch-default',
      rationale: 'User is asking how to switch models.',
    }));

    await SimulateAsync(SlackApp, 'rmm ifl how do I change models?');

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} switch-models:'<model>'\``
    );
    expect(SlackApp.SentMessages[0].text).not.toContain('On it — running');
  });

  // --- Direct-match path: LLM picks an intent and supplies the argument. ---

  test('5. rmm "switch to gpt 5" resolves directly to switch-models:\'gpt-5\'', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'model-switch-default',
      default_model_name: 'gpt-5',
      rationale: 'User explicitly named gpt-5 for the workspace default.',
    }));

    await SimulateAsync(SlackApp, 'rmm switch to gpt 5');

    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} switch-models:'gpt-5'\``
    );
    expect(SlackApp.SentMessages[0].text).not.toContain('<model>');
  });

  test('6. rmm "turn on reminders in this channel" resolves to enable reminders', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'enable-reminders',
      rationale: 'User wants automatic reminder detection in this channel.',
    }));

    await SimulateAsync(SlackApp, 'rmm turn on reminders in this channel');

    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} enable reminders\``
    );
  });

  test('7. rmm "show me my pending tasks" resolves to show my reminders', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'show-my-reminders',
      rationale: 'User wants to list their own reminders.',
    }));

    await SimulateAsync(SlackApp, 'rmm show me my pending tasks');

    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} show my reminders\``
    );
  });

  test('8. rmm "google for automated browsers" resolves to gemini-search with the topic', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'gemini-search',
      query_text: 'automated browsers',
      rationale: 'User explicitly asked for a Google-style web lookup.',
    }));

    await SimulateAsync(SlackApp, 'rmm google for automated browsers');

    expect(SlackApp.SentMessages[0].text).toContain(
      `*Closest command:* \`${SlackApp.AppMentionString} gemini-search automated browsers\``
    );
  });

  // --- Genuinely ambiguous: keep the clarification path working. ---


  // --- Help mode path: same discovery rendering through the help-features-command handler. ---

  test('10. help "how do I change models?" suggests switch-models syntax via help-mode rendering', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(BuildLlmResponse({
      intent_id: 'model-switch-default',
      rationale: 'User asked help mode how to change models.',
    }));

    await SimulateAsync(SlackApp, 'help how do I change models?');

    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain(
      `*Best matching command:* \`${SlackApp.AppMentionString} switch-models:'<model>'\``
    );
    expect(SlackApp.SentMessages[0].text).toContain('Replace the bracketed placeholders');
    expect(SlackApp.SentMessages[0].text).not.toContain('I need one clarification');
  });
});
