'use strict';

/**
 * Phase 2-full: LLM escalation for near-misses the deterministic tier (Phase 2-lite) declines —
 * some lexical signal exists (score > 0) but below NEAR_MISS_SCORE_FLOOR. Escalates to the existing
 * RMM resolver (ResolveRmmIntentAsync) for a confidence-tiered suggestion, still suggest-only.
 * See PROJECT/2-WORKING/COMMAND-NEAR-MISS-AI-FALLBACK.md.
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
    };
    mockWorkspaceAIInstances.push(Instance);
    return Instance;
  });
});

const ChatModule = require('../src/chat-module');
const CommandIntentResolver = require('../src/command-intent-resolver');
const { MockSlackApp } = require('./mocks/mock-slack-app');

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

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'NearMissLlmWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

/**
 * @param {Partial<{
 *   intent_id: string,
 *   needs_clarification: boolean,
 *   clarification_question: string,
 *   rationale: string,
 *   confidence: number,
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

describe('Command Near-Miss Phase 2-full (LLM escalation)', () => {
  let OriginalEnv;

  beforeEach(() => {
    OriginalEnv = { ...process.env };
    mockWorkspaceAIInstances.length = 0;
  });

  afterEach(() => {
    process.env = OriginalEnv;
  });

  test('flag OFF -> no escalation reply even on a below-floor near-miss', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'false';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    // "command" (singular) scores 3 against the "commands" catalog entry — below
    // NEAR_MISS_SCORE_FLOOR (5) but above the LLM signal floor (3).
    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000001.000001',
      text: '<@UBOT123> command',
    });

    expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });

  test('flag ON + below-floor near-miss + high-confidence resolver -> exactly one suggestion, no auto-run', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(
      BuildLlmResponse({ intent_id: 'commands', confidence: 0.9 })
    );

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000002.000001',
      text: '<@UBOT123> command',
    });

    expect(WasHandled).toBe(true);
    const SuggestionMessages = SlackApp.SentMessages.filter((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessages.length).toBe(1);
    expect(SuggestionMessages[0].text).toMatch(/Did you mean the `commands` command\? Try `.*commands`\./);
    // suggest-only: no execution confirmation was ever posted.
    expect(SlackApp.SentMessages.some((M) => M.text.startsWith('On it'))).toBe(false);
  });

  test('flag ON + low-confidence resolver response -> falls through, no suggestion', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(
      BuildLlmResponse({ intent_id: 'commands', confidence: 0.3 })
    );

    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000003.000001',
      text: '<@UBOT123> command',
    });

    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });

  test('flag ON + below-signal-floor conversational message -> never calls the resolver at all', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000004.000001',
      text: '<@UBOT123> thanks so much, have a great weekend everyone',
    });

    expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });

  test('flag ON + score in range but tied with runner-up (common-word noise) -> never calls the resolver', async () => {
    // "sounds good, appreciate it" scores 3 against multiple unrelated catalog entries with no
    // clear leader (verified empirically) — the exact false-positive shape the margin check exists
    // to catch. Without NEAR_MISS_MARGIN_FLOOR this would have escalated to an LLM call on
    // ordinary chat.
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000005.000001',
      text: '<@UBOT123> sounds good, appreciate it',
    });

    expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });

  test('flag ON + resolver rejects -> falls through to generic chat, no crash, no suggestion', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockRejectedValueOnce(
      new Error('mock resolver network failure')
    );

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000006.000001',
      text: '<@UBOT123> command',
    });

    expect(WasHandled).toBe(true);
    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
    // proves genuine fallthrough occurred, not a swallowed/silent no-op.
    expect(mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
  });

  test('flag ON + resolver never settles -> times out and falls through to generic chat', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockImplementationOnce(
      () => new Promise(() => {}) // never resolves — exercises NEAR_MISS_LLM_TIMEOUT_MS (8000ms)
    );

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000007.000001',
      text: '<@UBOT123> command',
    });

    expect(WasHandled).toBe(true);
    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
    expect(mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
  }, 15000);

  test('flag ON + resolver needs clarification (in-range score) -> falls through, no suggestion', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(
      BuildLlmResponse({ intent_id: 'clarify', needs_clarification: true, confidence: 0.9 })
    );

    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000008.000001',
      text: '<@UBOT123> command',
    });

    const SuggestionMessage = SlackApp.SentMessages.find((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessage).toBeUndefined();
  });

  test('flag ON + discovery path (SyntaxTemplate, no CanonicalCommand) -> renders placeholder syntax', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
    // "model-switch-default" requires a model argument the resolver did not extract — an intent
    // match with no runnable canonical command produces a syntax-template suggestion, not a bare
    // command (same intent used by rmm-help-regression.test.js's discovery-path coverage).
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(
      BuildLlmResponse({ intent_id: 'model-switch-default', confidence: 0.9, default_model_name: '' })
    );

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000009.000001',
      text: '<@UBOT123> command',
    });

    expect(WasHandled).toBe(true);
    const SuggestionMessages = SlackApp.SentMessages.filter((M) => M.text.includes('Did you mean the'));
    expect(SuggestionMessages.length).toBe(1);
    expect(SuggestionMessages[0].text).toContain('Replace the bracketed placeholders with your values');
  });

  test('confidence boundary: exactly 0.6 is accepted, 0.59 is rejected', async () => {
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'off';

    const AcceptedApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(AcceptedApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(
      BuildLlmResponse({ intent_id: 'commands', confidence: 0.6 })
    );
    await AcceptedApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000010.000001',
      text: '<@UBOT123> command',
    });
    expect(AcceptedApp.SentMessages.some((M) => M.text.includes('Did you mean the'))).toBe(true);

    const RejectedApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    new ChatModule(RejectedApp, EmptyWorkspaceStats, null, null, null);
    mockWorkspaceAIInstances[1].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(
      BuildLlmResponse({ intent_id: 'commands', confidence: 0.59 })
    );
    await RejectedApp.SimulateAppMentionAsync({
      channel: 'C_TEST',
      ts: '1800000011.000001',
      text: '<@UBOT123> command',
    });
    expect(RejectedApp.SentMessages.some((M) => M.text.includes('Did you mean the'))).toBe(false);
  });

  test('both flags ON + deterministic scoring rejects -> both tiers fail open, generic chat still runs', async () => {
    // GH-132 round 3: RetrieveScoredCandidates throwing must not block either near-miss tier NOR
    // the generic-chat fallthrough. Spy on the shared module reference (chat-module.js reads it via
    // CommandIntentResolver.RetrieveScoredCandidates rather than a destructured value, specifically
    // so this is spy-able across the module boundary).
    process.env.COMMAND_NEAR_MISS_LLM = 'on';
    process.env.COMMAND_NEAR_MISS_LITE = 'on';

    const ScoringSpy = jest
      .spyOn(CommandIntentResolver, 'RetrieveScoredCandidates')
      .mockRejectedValueOnce(new Error('mock catalog read failure'));

    try {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST',
        ts: '1800000012.000001',
        text: '<@UBOT123> command',
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages.some((M) => M.text.includes('Did you mean the'))).toBe(false);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
      // the LLM tier's own RetrieveScoredCandidates call is a second, independent invocation —
      // confirms 2-lite's rejection didn't somehow short-circuit 2-full from running its own check.
      expect(ScoringSpy).toHaveBeenCalled();
    } finally {
      ScoringSpy.mockRestore();
    }
  });
});
