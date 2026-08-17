'use strict';

const FsPromises = require('fs').promises;
const { DecideAsync, ResetAssetCache } = require('../src/ai-decision');

// the real dedup assets ship in the repo, so the happy path exercises actual file loading and the
// actual schema rather than a stub of both.
const DedupSpec = Object.freeze({
  Name: 'reminder-dedup',
  InstructionsFile: 'reminders-dedup-instructions.md',
  SchemaFile: 'reminders-dedup-schema.json',
  RequiredFields: ['recommendation', 'rationale'],
});

/**
 * Build a WorkspaceAI double whose JSON call resolves or rejects as directed.
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

describe('DecideAsync', () => {
  beforeEach(() => {
    ResetAssetCache();
    jest.restoreAllMocks();
  });

  test('loads the real prompt assets and returns a validated response', async () => {
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'schedule', rationale: 'distinct task' });

    const Result = await DecideAsync(WorkspaceAI, DedupSpec, { new_reminder: {} });

    expect(Result).toEqual({ recommendation: 'schedule', rationale: 'distinct task' });

    // the helper must hand the model the real instructions text and the parsed schema object.
    const [, Instructions, Schema] = WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0];
    expect(typeof Instructions).toBe('string');
    expect(Instructions.length).toBeGreaterThan(0);
    expect(Schema).toMatchObject({ name: 'reminder_deduplication_response' });
  });

  test('passes a string input through unchanged and serializes an object input', async () => {
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'ignore', rationale: 'same task' });

    await DecideAsync(WorkspaceAI, DedupSpec, 'already-serialized');
    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toBe('already-serialized');

    await DecideAsync(WorkspaceAI, DedupSpec, { a: 1 });
    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[1][0]).toBe('{\n  "a": 1\n}');
  });

  test('reads each asset once and serves later calls from cache', async () => {
    const ReadSpy = jest.spyOn(FsPromises, 'readFile');
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'schedule', rationale: 'ok' });

    await DecideAsync(WorkspaceAI, DedupSpec, {});
    await DecideAsync(WorkspaceAI, DedupSpec, {});

    // two assets, read once each despite two decisions.
    expect(ReadSpy).toHaveBeenCalledTimes(2);
  });

  test('concurrent first calls share a single read of each asset', async () => {
    const ReadSpy = jest.spyOn(FsPromises, 'readFile');
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'schedule', rationale: 'ok' });

    await Promise.all([
      DecideAsync(WorkspaceAI, DedupSpec, {}),
      DecideAsync(WorkspaceAI, DedupSpec, {}),
      DecideAsync(WorkspaceAI, DedupSpec, {}),
    ]);

    expect(ReadSpy).toHaveBeenCalledTimes(2);
  });

  test('throws when a required field is missing and no fallback is configured', async () => {
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'schedule' });

    await expect(DecideAsync(WorkspaceAI, DedupSpec, {}))
      .rejects.toThrow('Invalid reminder-dedup response from the AI model.');
  });

  test('throws when the model call itself rejects and no fallback is configured', async () => {
    const WorkspaceAI = MakeWorkspaceAI(new Error('model exploded'));

    await expect(DecideAsync(WorkspaceAI, DedupSpec, {})).rejects.toThrow('model exploded');
  });

  test('returns the configured fallback and warns instead of throwing', async () => {
    const WorkspaceAI = MakeWorkspaceAI(new Error('model exploded'));
    const Logger = { warn: jest.fn() };

    const Result = await DecideAsync(WorkspaceAI, DedupSpec, {}, {
      Fallback: { recommendation: 'schedule', rationale: 'fallback' },
      Logger,
    });

    expect(Result).toEqual({ recommendation: 'schedule', rationale: 'fallback' });
    expect(Logger.warn).toHaveBeenCalledTimes(1);
  });

  test('falls back without a logger when none is supplied', async () => {
    const WorkspaceAI = MakeWorkspaceAI(null);

    await expect(DecideAsync(WorkspaceAI, DedupSpec, {}, { Fallback: { decision: 'skip' } }))
      .resolves.toEqual({ decision: 'skip' });
  });

  test('treats a zero-valued required field as present, not missing', async () => {
    // guards the falsy-check trap: a numeric confidence of 0 is a real answer, not an absent one.
    const GateSpec = { ...DedupSpec, Name: 'relay-gate', RequiredFields: ['decision', 'confidence'] };
    const WorkspaceAI = MakeWorkspaceAI({ decision: 'skip', confidence: 0 });

    await expect(DecideAsync(WorkspaceAI, GateSpec, {}))
      .resolves.toEqual({ decision: 'skip', confidence: 0 });
  });

  test('treats an empty-string required field as missing', async () => {
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'schedule', rationale: '' });

    await expect(DecideAsync(WorkspaceAI, DedupSpec, {}))
      .rejects.toThrow('Invalid reminder-dedup response from the AI model.');
  });

  test('rejects a non-object response', async () => {
    const WorkspaceAI = MakeWorkspaceAI('not an object');

    await expect(DecideAsync(WorkspaceAI, DedupSpec, {}))
      .rejects.toThrow('Invalid reminder-dedup response from the AI model.');
  });

  test('does not cache a failed asset read', async () => {
    const ReadSpy = jest.spyOn(FsPromises, 'readFile')
      .mockRejectedValueOnce(new Error('disk gone'))
      .mockRejectedValueOnce(new Error('disk gone'));
    const WorkspaceAI = MakeWorkspaceAI({ recommendation: 'schedule', rationale: 'ok' });

    await expect(DecideAsync(WorkspaceAI, DedupSpec, {})).rejects.toThrow('disk gone');

    // a poisoned cache entry would short-circuit here; the retry must reach the filesystem again.
    ReadSpy.mockRestore();
    await expect(DecideAsync(WorkspaceAI, DedupSpec, {}))
      .resolves.toEqual({ recommendation: 'schedule', rationale: 'ok' });
  });
});
