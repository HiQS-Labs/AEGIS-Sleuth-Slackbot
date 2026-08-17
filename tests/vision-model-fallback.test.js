'use strict';

/**
 * GH-63 round 2 — raised by the agy relay review of PR #65.
 *
 * `VisionModelPreference` declared three models while `ResolveVisionModelName()` only ever returned
 * index 0, so entries [1] and [2] were unreachable: a retired lead model would have taken OCR down
 * with two "fallbacks" that had never been wired to anything.
 *
 * The provider registry is mocked at module load because `workspace-ai.js` destructures
 * `GetProviderDescriptorForModel` at require time — reassigning the module property afterwards has
 * no effect on the already-captured binding (learned the hard way writing the first version of this).
 */

const FakeProviderState = {
  Tried: [],
  Behavior: () => ({ title: 'ok', items: [{ text: 'item' }] }),
};

jest.mock('../src/ai-providers', () => {
  const Actual = jest.requireActual('../src/ai-providers');
  return {
    ...Actual,
    GetProviderDescriptorForModel: () => ({
      Id: 'gemini',
      Label: 'Google Gemini',
      Detect: () => true,
      Build: () => ({
        Id: 'gemini',
        ProcessMultimodalMessageWithJsonResponseAsync: async (_T, _S, _J, _I, ArgModelName) => {
          FakeProviderState.Tried.push(ArgModelName);
          return FakeProviderState.Behavior(ArgModelName, FakeProviderState.Tried.length);
        },
      }),
    }),
  };
});

const WorkspaceAI = require('../src/workspace-ai');

function MakeAgent(ArgDefaultModel) {
  return new WorkspaceAI(
    { WORKSPACE_NAME: 'FallbackWorkspace', GEMINI_API_KEY: 'g-key' },
    { RecordAIRequest: () => {}, RecordAIResponse: () => {}, RecordAIError: () => {}, IncrementCounter: () => {} },
    ArgDefaultModel
  );
}

function CallVision(ArgAgent) {
  return ArgAgent.ProcessMultimodalMessageWithJsonResponseAsync(
    'Extract items.',
    'instructions',
    { name: 'ocr_list_extraction', schema: { type: 'object' } },
    { Base64: 'aW1hZ2U=', Mimetype: 'image/png' }
  );
}

describe('GH-63 r2: the declared vision fallbacks are actually reachable', () => {
  let WarnSpy;

  beforeEach(() => {
    FakeProviderState.Tried = [];
    FakeProviderState.Behavior = () => ({ title: 'ok', items: [{ text: 'item' }] });
    WarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => WarnSpy.mockRestore());

  test('the happy path still uses only the lead model', async () => {
    await CallVision(MakeAgent('gpt-4o-mini'));
    expect(FakeProviderState.Tried).toEqual([WorkspaceAI.VisionModelPreference[0]]);
  });

  test('an unavailable lead model falls through to the next candidate', async () => {
    FakeProviderState.Behavior = (ArgModelName, ArgAttempt) => {
      if(ArgAttempt === 1) throw new Error(`model ${ArgModelName} not found`);
      return { title: 'Recovered', items: [{ text: 'item' }] };
    };

    const Result = await CallVision(MakeAgent('gpt-4o-mini'));
    expect(Result.title).toBe('Recovered');
    expect(FakeProviderState.Tried).toHaveLength(2);
    expect(FakeProviderState.Tried[0]).toBe(WorkspaceAI.VisionModelPreference[0]);
    expect(FakeProviderState.Tried[1]).toBe(WorkspaceAI.VisionModelPreference[1]);
  });

  test('every declared preference entry is reachable, not just the first two', async () => {
    FakeProviderState.Behavior = (ArgModelName, ArgAttempt) => {
      if(ArgAttempt < WorkspaceAI.VisionModelPreference.length) {
        throw new Error(`model ${ArgModelName} not found`);
      }
      return { title: 'Last resort', items: [{ text: 'item' }] };
    };

    const Result = await CallVision(MakeAgent('gpt-4o-mini'));
    expect(Result.title).toBe('Last resort');
    expect(FakeProviderState.Tried).toEqual(WorkspaceAI.VisionModelPreference);
  });

  test('a downgrade is logged rather than silent', async () => {
    FakeProviderState.Behavior = (ArgModelName, ArgAttempt) => {
      if(ArgAttempt === 1) throw new Error(`model ${ArgModelName} not found`);
      return { title: 'ok', items: [{ text: 'item' }] };
    };

    await CallVision(MakeAgent('gpt-4o-mini'));
    expect(WarnSpy).toHaveBeenCalled();
    expect(String(WarnSpy.mock.calls[0][0])).toMatch(/falling back/i);
  });

  test('a NON-availability error stops immediately instead of burning the list', async () => {
    FakeProviderState.Behavior = () => { throw new Error('image payload was rejected as malformed'); };

    await expect(CallVision(MakeAgent('gpt-4o-mini'))).rejects.toThrow(/malformed/);
    // The whole point of the narrow predicate: one attempt, not three.
    expect(FakeProviderState.Tried).toHaveLength(1);
  });

  test('when every candidate is unavailable the last error propagates', async () => {
    FakeProviderState.Behavior = (ArgModelName) => { throw new Error(`model ${ArgModelName} not found`); };

    await expect(CallVision(MakeAgent('gpt-4o-mini'))).rejects.toThrow(/not found/);
    expect(FakeProviderState.Tried).toEqual(WorkspaceAI.VisionModelPreference);
  });

  test('an explicit model argument is honored and never falls back', async () => {
    FakeProviderState.Behavior = (ArgModelName) => { throw new Error(`model ${ArgModelName} not found`); };

    const Agent = MakeAgent('gpt-4o-mini');
    await expect(
      Agent.ProcessMultimodalMessageWithJsonResponseAsync(
        'text', 'instructions', { name: 's', schema: {} },
        { Base64: 'aW1hZ2U=', Mimetype: 'image/png' },
        'gemini-caller-pinned'
      )
    ).rejects.toThrow(/not found/);
    // A caller that named a model gets that model, not a silent substitution.
    expect(FakeProviderState.Tried).toEqual(['gemini-caller-pinned']);
  });

  test('a pinned Gemini default leads, then the standard fallbacks follow', async () => {
    FakeProviderState.Behavior = (ArgModelName, ArgAttempt) => {
      if(ArgAttempt === 1) throw new Error(`model ${ArgModelName} not found`);
      return { title: 'ok', items: [{ text: 'item' }] };
    };

    await CallVision(MakeAgent('gemini-3.0-experimental'));
    expect(FakeProviderState.Tried[0]).toBe('gemini-3.0-experimental');
    expect(FakeProviderState.Tried[1]).toBe(WorkspaceAI.VisionModelPreference[0]);
  });
});
