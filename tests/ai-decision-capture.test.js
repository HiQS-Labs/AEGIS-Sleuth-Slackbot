'use strict';

const { DecideAsync, ResetAssetCache, DecisionOutcome } = require('../src/ai-decision');

// GH-44 Phase 2 — the Validate hook and corpus capture inside the DecideAsync chokepoint.
// Every test here is RED before Phase 2: neither `Capture`, `Validate`, nor `DecisionOutcome`
// existed. tests/ai-decision.test.js is the untouched regression guard for prior behavior.

// the real dedup assets ship in the repo, so these exercise real file loading and the real schema.
const DedupSpec = Object.freeze({
  Name: 'reminder-dedup',
  InstructionsFile: 'reminders-dedup-instructions.md',
  SchemaFile: 'reminders-dedup-schema.json',
  RequiredFields: ['recommendation', 'rationale'],
});

/**
 * @param {any} ArgResult Value to resolve with, or an Error to reject with.
 * @returns {{ProcessMessageWithJsonResponseAsync: jest.Mock}}
 */
function MakeWorkspaceAI(ArgResult) {
  return {
    ProcessMessageWithJsonResponseAsync: jest.fn(() =>
      ArgResult instanceof Error ? Promise.reject(ArgResult) : Promise.resolve(ArgResult)
    ),
  };
}

/** @returns {{append: jest.Mock, rows: object[]}} an in-memory store honoring the {ok,error} contract. */
function MakeStore() {
  const Rows = [];
  const Append = jest.fn(async (ArgWorkspace, ArgRecord) => {
    Rows.push({ workspace: ArgWorkspace, ...ArgRecord });
    return { ok: true };
  });
  return { append: Append, rows: Rows };
}

const GoodResponse = { recommendation: 'schedule', rationale: 'distinct task' };

describe('DecideAsync — capture is opt-in', () => {
  beforeEach(() => { ResetAssetCache(); jest.restoreAllMocks(); });

  test('no Capture option means the store is never touched', async () => {
    const Store = MakeStore();
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);

    await DecideAsync(WorkspaceAI, DedupSpec, { a: 1 });

    // asserted on the mock, not assumed: capture must be genuinely inert when unconfigured.
    expect(Store.append).not.toHaveBeenCalled();
    expect(Store.rows).toHaveLength(0);
  });

  test('with Capture, one decision emits exactly one record stamped with spec metadata', async () => {
    const Store = MakeStore();
    const Spec = { ...DedupSpec, PromptVersion: 'dedup-v1', SchemaVersion: 'dedup-schema-v1' };
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);

    await DecideAsync(WorkspaceAI, Spec, { a: 1 }, { Capture: { Store, Workspace: 'ws1' } });

    expect(Store.append).toHaveBeenCalledTimes(1);
    expect(Store.rows[0]).toMatchObject({
      workspace: 'ws1',
      decision: 'reminder-dedup',
      outcome: DecisionOutcome.Ok,
      promptVersion: 'dedup-v1',
      schemaVersion: 'dedup-schema-v1',
      output: GoodResponse,
    });
    expect(typeof Store.rows[0].durationMs).toBe('number');
  });
});

describe('DecideAsync — capture never perturbs the decision', () => {
  beforeEach(() => { ResetAssetCache(); jest.restoreAllMocks(); });

  test('a store that THROWS changes neither the return value nor the throw behavior', async () => {
    const Exploding = { append: jest.fn(() => { throw new Error('store exploded'); }) };
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);

    // success path survives
    await expect(
      DecideAsync(WorkspaceAI, DedupSpec, { a: 1 }, { Capture: { Store: Exploding, Workspace: 'ws1' } })
    ).resolves.toEqual(GoodResponse);

    // failure path still throws the ORIGINAL error, not the store's
    const Failing = MakeWorkspaceAI(new Error('model down'));
    await expect(
      DecideAsync(Failing, DedupSpec, { a: 1 }, { Capture: { Store: Exploding, Workspace: 'ws1' } })
    ).rejects.toThrow('model down');
  });

  test('a store that rejects is swallowed and warned, not propagated', async () => {
    const Rejecting = { append: jest.fn(() => Promise.reject(new Error('disk full'))) };
    const Logger = { warn: jest.fn() };
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);

    await expect(
      DecideAsync(WorkspaceAI, DedupSpec, { a: 1 }, { Capture: { Store: Rejecting, Workspace: 'ws1' }, Logger })
    ).resolves.toEqual(GoodResponse);
    expect(Logger.warn).toHaveBeenCalled();
  });

  test('a DebugFacts extractor that throws is swallowed; the record still lands without facts', async () => {
    const Store = MakeStore();
    const Spec = { ...DedupSpec, DebugFacts: () => { throw new Error('bad extractor'); } };
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);

    await expect(
      DecideAsync(WorkspaceAI, Spec, { a: 1 }, { Capture: { Store, Workspace: 'ws1' } })
    ).resolves.toEqual(GoodResponse);

    expect(Store.rows).toHaveLength(1);
    expect(Store.rows[0].debugFacts).toBeNull();
  });

  test('DebugFacts receives (input, response) and its object lands on the record', async () => {
    const Store = MakeStore();
    const Spec = {
      ...DedupSpec,
      DebugFacts: (ArgInput, ArgResponse) => ({ sawInput: ArgInput.a, verdict: ArgResponse.recommendation }),
    };

    await DecideAsync(MakeWorkspaceAI(GoodResponse), Spec, { a: 7 }, { Capture: { Store, Workspace: 'ws1' } });

    expect(Store.rows[0].debugFacts).toEqual({ sawInput: 7, verdict: 'schedule' });
  });
});

describe('DecideAsync — outcome classification', () => {
  beforeEach(() => { ResetAssetCache(); jest.restoreAllMocks(); });

  test('a rejected answer records `invalid`, a missing answer records `error`', async () => {
    const Store = MakeStore();

    // model answered, but the answer failed RequiredFields => the answer was rejected
    await expect(
      DecideAsync(MakeWorkspaceAI({ recommendation: 'schedule' }), DedupSpec, {}, { Capture: { Store, Workspace: 'ws1' } })
    ).rejects.toThrow('Invalid reminder-dedup response from the AI model.');
    expect(Store.rows[0].outcome).toBe(DecisionOutcome.Invalid);

    // model never answered => we failed to get one at all
    await expect(
      DecideAsync(MakeWorkspaceAI(new Error('timeout')), DedupSpec, {}, { Capture: { Store, Workspace: 'ws1' } })
    ).rejects.toThrow('timeout');
    expect(Store.rows[1].outcome).toBe(DecisionOutcome.Error);
  });

  test('the error message is recorded but never the stack', async () => {
    const Store = MakeStore();
    const Boom = new Error('model down');

    await expect(
      DecideAsync(MakeWorkspaceAI(Boom), DedupSpec, {}, { Capture: { Store, Workspace: 'ws1' } })
    ).rejects.toThrow('model down');

    expect(Store.rows[0].error).toBe('model down');
    expect(JSON.stringify(Store.rows[0])).not.toContain('at Object.');
  });

  test('a fallback still emits a record — the decision failed even though the caller recovered', async () => {
    const Store = MakeStore();
    const Fallback = { recommendation: 'schedule', rationale: 'fallback' };

    const Result = await DecideAsync(
      MakeWorkspaceAI(new Error('nope')), DedupSpec, {},
      { Fallback, Logger: { warn: jest.fn() }, Capture: { Store, Workspace: 'ws1' } },
    );

    expect(Result).toBe(Fallback);
    expect(Store.rows[0].outcome).toBe(DecisionOutcome.Error);
  });
});

describe('DecideAsync — Validate hook', () => {
  beforeEach(() => { ResetAssetCache(); jest.restoreAllMocks(); });

  test('a Validate throw propagates byte-identically and is classified `invalid`', async () => {
    const Store = MakeStore();
    const Spec = {
      ...DedupSpec,
      RequiredFields: [],
      Validate: (ArgResponse) => {
        if(typeof ArgResponse.recommendation !== 'string')
          throw new Error('GPT response is missing recommendation property or it is not a string.');
      },
    };

    // the caller's own message survives — this is what keeps migrated call sites' tests green
    await expect(
      DecideAsync(MakeWorkspaceAI({ recommendation: 123 }), Spec, {}, { Capture: { Store, Workspace: 'ws1' } })
    ).rejects.toThrow('GPT response is missing recommendation property or it is not a string.');

    // ...and the corpus still classifies it as a rejected answer rather than a false `ok`
    expect(Store.rows[0].outcome).toBe(DecisionOutcome.Invalid);
  });

  test('Validate is skipped when RequiredFields already failed (one error, not two)', async () => {
    const Validate = jest.fn();
    const Spec = { ...DedupSpec, Validate };

    await expect(DecideAsync(MakeWorkspaceAI({}), Spec, {})).rejects.toThrow('Invalid reminder-dedup response');
    expect(Validate).not.toHaveBeenCalled();
  });

  test('a passing Validate does not disturb the returned value', async () => {
    const Spec = { ...DedupSpec, Validate: () => undefined };
    await expect(DecideAsync(MakeWorkspaceAI(GoodResponse), Spec, {})).resolves.toEqual(GoodResponse);
  });
});

describe('DecideAsync — ModelName', () => {
  beforeEach(() => { ResetAssetCache(); jest.restoreAllMocks(); });

  test('omitted ModelName keeps the 3-arg call so WorkspaceAI applies its own default', async () => {
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);
    await DecideAsync(WorkspaceAI, DedupSpec, {});
    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0]).toHaveLength(3);
  });

  test('a pinned ModelName is passed through as the 4th argument and recorded', async () => {
    const Store = MakeStore();
    const WorkspaceAI = MakeWorkspaceAI(GoodResponse);
    const Spec = { ...DedupSpec, ModelName: 'complex-model-x' };

    await DecideAsync(WorkspaceAI, Spec, {}, { Capture: { Store, Workspace: 'ws1' } });

    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][3]).toBe('complex-model-x');
    expect(Store.rows[0].modelName).toBe('complex-model-x');
  });
});
