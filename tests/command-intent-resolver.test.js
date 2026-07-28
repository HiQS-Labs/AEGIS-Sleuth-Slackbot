'use strict';

const {
  NormalizeDirectCommandTextAsync,
  ResolveRmmIntentAsync,
  RetrieveScoredCandidates,
} = require('../src/command-intent-resolver');

describe('command-intent-resolver', () => {
  test('auto-normalizes hyphen and space variants for zero-argument commands', async () => {
    const RunDiagnostics = await NormalizeDirectCommandTextAsync('run diagnostics');
    expect(RunDiagnostics.NormalizedText).toBe('run-diagnostics');

    const RunDailyDigest = await NormalizeDirectCommandTextAsync('run-daily-digest');
    expect(RunDailyDigest.NormalizedText).toBe('run daily digest');

    const ShowChannelModel = await NormalizeDirectCommandTextAsync('show channel model');
    expect(ShowChannelModel.NormalizedText).toBe('show-channel-model');

    const ClearChannelModel = await NormalizeDirectCommandTextAsync('clear-channel model');
    expect(ClearChannelModel.NormalizedText).toBe('clear-channel-model');
  });

  test('does not auto-normalize optional-argument commands that only look zero-arg', async () => {
    const SearchProjects = await NormalizeDirectCommandTextAsync('search projects');
    expect(SearchProjects.NormalizedText).toBe('search projects');

    const TestGithubSync = await NormalizeDirectCommandTextAsync('test github sync');
    expect(TestGithubSync.NormalizedText).toBe('test github sync');
  });

  test('normalizes relaxed direct switch-models syntax and GPT-5 aliases', async () => {
    const Result = await NormalizeDirectCommandTextAsync(`model-switch 'chatgpt 5'`);
    expect(Result.NormalizedText).toBe(`switch-models:'gpt-5'`);
    expect(Result.Notes).toContain('chatgpt 5 -> gpt-5');
  });

  test('builds a canonical command from the structured rmm model response', async () => {
    const WorkspaceAI = {
      DefaultModelName: 'gpt-4o-mini',
      ComplexModelName: 'gpt-4o',
      ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
        intent_id: 'model-switch-complex',
        confidence: 0.88,
        rationale: 'User explicitly referenced the complex model.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: '',
        complex_model_name: 'gpt 5',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      }),
    };

    const Result = await ResolveRmmIntentAsync(WorkspaceAI, 'switch the complex model to gpt5', {
      RequestMode: 'suggest',
      ChannelID: 'C_TEST',
      ChannelModelStatus: { override: null, defaultModel: 'gpt-4o-mini', effectiveModel: 'gpt-4o-mini' },
    });

    expect(Result.IntentId).toBe('model-switch-complex');
    expect(Result.CanonicalCommand).toBe(`switch-models:complex='gpt-5'`);
    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][3]).toBe('gpt-4o');
  });

  test('retrieves web-search candidates for google-style lookup requests', async () => {
    const WorkspaceAI = {
      DefaultModelName: 'gpt-4o-mini',
      ComplexModelName: 'gpt-4o',
      ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
        intent_id: 'gemini-search',
        confidence: 0.9,
        rationale: 'The user wants a Google-style search.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: 'automated web browsers',
        user_mention: '',
      }),
    };

    const Result = await ResolveRmmIntentAsync(WorkspaceAI, 'search google for automated web browsers', {
      RequestMode: 'suggest',
      ChannelID: 'C_TEST',
      ChannelModelStatus: { override: null, defaultModel: 'gpt-4o-mini', effectiveModel: 'gpt-4o-mini' },
    });

    const PromptText = WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];
    expect(PromptText).toContain('ID: web-search');
    expect(PromptText).toContain('ID: gemini-search');
    expect(Result.CanonicalCommand).toBe('gemini-search automated web browsers');
  });

  describe('GH-405 workspace-snapshot context injection', () => {
    /**
     * Minimal WorkspaceAI mock that captures the prompt text handed to the model.
     * @returns {any}
     */
    function MakeCapturingWorkspaceAI() {
      return {
        DefaultModelName: 'gpt-4o-mini',
        ComplexModelName: 'gpt-4o',
        ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
          intent_id: 'clarify',
          confidence: 0,
          rationale: '',
          needs_clarification: true,
          clarification_question: '',
          default_model_name: '',
          complex_model_name: '',
          channel_model_name: '',
          query_text: '',
          user_mention: '',
        }),
      };
    }

    const BaseOptions = {
      RequestMode: 'suggest',
      ChannelID: 'C_TEST',
      ChannelModelStatus: { override: null, defaultModel: 'gpt-4o-mini', effectiveModel: 'gpt-4o-mini' },
    };

    const Snapshot = { openTotal: 3, topClientsByOpen: [{ name: 'Client A', count: 2 }, { name: 'Acme', count: 1 }] };

    test('opt absent ⇒ prompt carries NO snapshot lines (byte-identical to today)', async () => {
      const WorkspaceAI = MakeCapturingWorkspaceAI();
      await ResolveRmmIntentAsync(WorkspaceAI, 'what is open', { ...BaseOptions });
      const Prompt = WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];
      expect(Prompt).not.toContain('open_total:');
      expect(Prompt).not.toContain('top_clients_by_open:');
    });

    test('opt present ⇒ snapshot lines are appended verbatim, and only appended', async () => {
      const BaseAI = MakeCapturingWorkspaceAI();
      await ResolveRmmIntentAsync(BaseAI, 'what is open', { ...BaseOptions });
      const BasePrompt = BaseAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];

      const SnapAI = MakeCapturingWorkspaceAI();
      await ResolveRmmIntentAsync(SnapAI, 'what is open', { ...BaseOptions, WorkspaceSnapshot: Snapshot });
      const SnapPrompt = SnapAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];

      // The snapshot-on prompt is EXACTLY the snapshot-off prompt plus the rendered snapshot lines —
      // proving the opt is purely additive (no reordering, no other drift).
      expect(SnapPrompt).toBe(`${BasePrompt}\nopen_total: 3\ntop_clients_by_open: Client A (2), Acme (1)`);
    });

    test('two workspaces never share snapshot context (per-workspace isolation)', async () => {
      const AiA = MakeCapturingWorkspaceAI();
      await ResolveRmmIntentAsync(AiA, 'what is open', {
        ...BaseOptions,
        WorkspaceSnapshot: { openTotal: 7, topClientsByOpen: [{ name: 'Client A', count: 7 }] },
      });
      const AiB = MakeCapturingWorkspaceAI();
      await ResolveRmmIntentAsync(AiB, 'what is open', {
        ...BaseOptions,
        WorkspaceSnapshot: { openTotal: 1, topClientsByOpen: [{ name: 'Acme', count: 1 }] },
      });

      const PromptA = AiA.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];
      const PromptB = AiB.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];
      expect(PromptA).toContain('open_total: 7');
      expect(PromptA).toContain('top_clients_by_open: Client A (7)');
      expect(PromptA).not.toContain('Acme');
      expect(PromptB).toContain('open_total: 1');
      expect(PromptB).toContain('top_clients_by_open: Acme (1)');
      expect(PromptB).not.toContain('Client A');
    });
  });

  test('RetrieveScoredCandidates surfaces scores, sorted, ranking a near-miss far above genuine chat', async () => {
    const NearMiss = await RetrieveScoredCandidates('switch model to gpt-5');

    // The score is exposed (RetrieveCandidateCommands discards it) and the top candidate is a real command.
    expect(NearMiss[0].Score).toBeGreaterThan(0);
    expect(NearMiss[0].Entry.Id).toMatch(/model-switch|set-channel-model|^models$/);

    // Sorted high → low, so [0] is always the top candidate the Phase 0 probe / Phase 2-lite gate read.
    for(let Index = 1; Index < NearMiss.length; Index++)
      expect(NearMiss[Index - 1].Score).toBeGreaterThanOrEqual(NearMiss[Index].Score);

    // Genuine off-topic chatter scores far below a wrong-syntax near-miss — the separation the probe relies on.
    const Chat = await RetrieveScoredCandidates('thanks so much, have a great weekend everyone');
    expect(NearMiss[0].Score).toBeGreaterThan(Chat[0].Score);
  });
});
