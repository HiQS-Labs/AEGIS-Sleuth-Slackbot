'use strict';

const {
  GetModelAliasRowsAsync,
  NormalizeDirectCommandTextAsync,
  ResolveModelAliasAsync,
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

  test('normalizes relaxed direct switch-models syntax but carries the model value RAW (GH-168)', async () => {
    // the executor handler resolves aliases and reports "resolved from"; pre-routing text
    // normalization must no longer rewrite the quoted model field.
    const Result = await NormalizeDirectCommandTextAsync(`model-switch 'chatgpt 5'`);
    expect(Result.NormalizedText).toBe(`switch-models:'chatgpt 5'`);
    expect(Result.Notes).toEqual([]);
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
    // GH-168: the canonical command keeps the raw phrase; the executor resolves it.
    expect(Result.CanonicalCommand).toBe(`switch-models:complex='gpt 5'`);
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

  describe('ResolveModelAliasAsync (GH-168) — entire-value, field-only, refuses rather than guesses', () => {
    test.each([
      // vendor defaults
      ['ChatGPT', 'gpt-5.6-terra'], ['Open AI', 'gpt-5.6-terra'], ['openai', 'gpt-5.6-terra'], ['chat gpt', 'gpt-5.6-terra'],
      ['gpt', 'gpt-5.6-terra'],
      ['Anthropic', 'claude-haiku-4-5-20251001'], ['Claude', 'claude-haiku-4-5-20251001'], ['haiku', 'claude-haiku-4-5-20251001'],
      ['Google', 'gemini-3.8-flash'], ['gemini', 'gemini-3.8-flash'],
      // family pins
      ['Claude Sonnet', 'claude-sonnet-5'], ['sonnet', 'claude-sonnet-5'], ['opus 5', 'claude-opus-5'],
      ['gemini pro', 'gemini-2.5-pro'], ['gemini flash', 'gemini-3.8-flash'],
      // explicit flagship rows — bare "gpt" must NOT land here
      ['gpt 6', 'gpt-6-astra'], ['astra', 'gpt-6-astra'],
      // prose forms of a pinned model
      ['chatgpt 5.6 terra', 'gpt-5.6-terra'], ['gpt 5.6 terra', 'gpt-5.6-terra'],
      // existing rows still resolve, and can no longer touch a longer value
      ['chatgpt 5', 'gpt-5'], ['gpt 5', 'gpt-5'], ['gpt 4o mini', 'gpt-4o-mini'],
      // leading vendor word stripped once, accepted only on a provider match
      ['openai chatgpt 5.6 terra', 'gpt-5.6-terra'], ['open ai chatgpt 5.6 terra', 'gpt-5.6-terra'],
      ['anthropic claude sonnet 5', 'claude-sonnet-5'], ['google gemini pro', 'gemini-2.5-pro'],
    ])('%s -> %s (with a provenance note)', async (Input, Expected) => {
      const Result = await ResolveModelAliasAsync(Input);
      expect(Result.ModelId).toBe(Expected);
      expect(Result.Note).toBe(`${Input.replace(/\s+/g, ' ').trim()} -> ${Expected}`);
    });

    test.each([
      // exact / structured IDs are never rewritten (no separate guard needed — they are not keys)
      'gpt-5.6-terra', 'o3-mini', 'claude-haiku-4-5-20251001', 'acme-sonnet-1', 'gpt-5-mini',
      // unknown value falls through unchanged -> the catalog validator refuses it
      'openai gpt-9', 'gpt 9 ultra',
      // NEGATIVE CONTROLS (refusal observed, xyz-3-agents-swarm#551): a stripped vendor prefix that
      // lands on another vendor's pin is a miss, never a cross-vendor switch
      'openai claude opus', 'anthropic gpt', 'google gpt',
    ])('%s is returned unchanged with no note', async (Input) => {
      const Result = await ResolveModelAliasAsync(Input);
      expect(Result.ModelId).toBe(Input);
      expect(Result.Note).toBeNull();
    });

    test('empty and whitespace-only input resolve to an empty ID', async () => {
      expect((await ResolveModelAliasAsync('')).ModelId).toBe('');
      expect((await ResolveModelAliasAsync('   ')).ModelId).toBe('');
    });

    test('GetModelAliasRowsAsync exposes the loaded table as plain rows', async () => {
      const Rows = await GetModelAliasRowsAsync();
      expect(Rows.length).toBeGreaterThan(20);
      expect(Rows).toEqual(expect.arrayContaining([{ Match: 'chatgpt', Replace: 'gpt-5.6-terra' }]));
      // every declared pin belongs to a known provider prefix (a pin nobody can route is a typo)
      const { GetProviderDescriptorForModel } = require('../src/ai-providers');
      for(const Row of Rows) expect(GetProviderDescriptorForModel(Row.Replace)).not.toBeNull();
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
