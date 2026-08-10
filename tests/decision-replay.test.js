'use strict';

const path = require('path');
const {
  ParseArgs, SerializeCanonical, RunScenarioAsync, RunAllAsync, DiffAgainstBaseline, CheckExpectations,
} = require('../scripts/decision-replay');

// GH-44 Phase 6 — the replay harness. Red before this phase: the script did not exist.

const BatteryPath = path.join(
  __dirname, 'fixtures', 'decision-scenarios', 'reminder-extraction-battery.json',
);

/**
 * @param {object} [ArgOverrides]
 * @returns {any} a minimal valid single-turn scenario.
 */
function MakeScenario(ArgOverrides = {}) {
  return {
    id: 'T-01',
    decision: 'reminder-analysis',
    sender: 'U_SENDER',
    turns: [{ user: 'U_SENDER', text: 'I will deploy tomorrow morning.' }],
    recordedResponse: {
      recommendation: 'schedule',
      rationale: 'commitment',
      reminders: [{
        actionable_language: 'I will deploy',
        scheduling_trigger: 'tomorrow morning',
        reminder_message: 'Deploy',
      }],
    },
    ...ArgOverrides,
  };
}

describe('ParseArgs', () => {
  test('defaults to the shipped battery and rejects unknown flags', () => {
    const Parsed = ParseArgs([]);
    expect(Parsed.ScenariosPath).toContain('reminder-extraction-battery.json');
    expect(Parsed.UpdateBaseline).toBe(false);
    expect(() => ParseArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
    expect(() => ParseArgs(['--scenarios'])).toThrow('Missing file path');
  });

  test('--update-baseline is explicit and never implied by a normal run', () => {
    expect(ParseArgs(['--json']).UpdateBaseline).toBe(false);
    expect(ParseArgs(['--update-baseline']).UpdateBaseline).toBe(true);
  });
});

describe('RunScenarioAsync', () => {
  test('a scenario with no recordedResponse is SKIP, never a silent pass', async () => {
    const Row = await RunScenarioAsync(MakeScenario({ recordedResponse: undefined }));
    expect(Row.status).toBe('SKIP');
    expect(Row.error).toBe('no recordedResponse');
  });

  test('a malformed scenario FAILs its own row rather than throwing', async () => {
    await expect(RunScenarioAsync({ id: 'BAD' })).resolves.toMatchObject({
      id: 'BAD', status: 'FAIL',
    });
  });

  test('observes ownership and routing for a single-message decision', async () => {
    const Row = await RunScenarioAsync(MakeScenario());
    expect(Row.status).toBe('PASS');
    // "I will deploy tomorrow morning." is a first-person commitment, so Phase 1A attributes it to
    // the speaker by that rule rather than by the no-mentions fallback it used to land in.
    expect(Row.observed.ownership).toMatchObject({
      resolvedFrom: 'first-person-commitment', senderIsAssignee: true,
    });
    expect(Row.observed.routing).toMatchObject({ segment: expect.any(String) });
  });

  test('a multi-turn thread scenario reaches the thread extractor with every turn', async () => {
    const Row = await RunScenarioAsync({
      id: 'T-THREAD',
      decision: 'multi-task-extraction',
      sender: 'U_SENDER',
      turns: [
        { user: 'U_SENDER', text: 'first turn' },
        { user: 'U_ALPHA', text: 'second turn' },
      ],
      recordedResponse: { candidates: [{ title: 't', assigneeID: 'U_ALPHA', deadline: null, confidence: 'high', flag: null }], rationale: 'r' },
    });
    expect(Row.status).toBe('PASS');
    expect(Row.observed.decision).toBe('multi-task-extraction');
    expect(Row.observed.candidates).toHaveLength(1);
  });
});

describe('RunAllAsync over the shipped GH-43 battery', () => {
  /** @type {any[]} */
  let Rows;
  beforeAll(async () => {
    const Battery = require(BatteryPath);
    Rows = await RunAllAsync(Battery.scenarios);
  });

  test('produces one row per scenario — a malformed row never aborts the batch', () => {
    expect(Rows).toHaveLength(15);
    expect(new Set(Rows.map(ArgR => ArgR.id)).size).toBe(15);
  });

  test('THE INSTRUMENT CAN FAIL: the OPEN GH-43 defect (verbatim task text) is red', () => {
    const ById = Object.fromEntries(Rows.map(ArgR => [ArgR.id, ArgR]));

    // S-01 is the reported production message. Its task text is still the whole message, because
    // the synthesis gate is GH-43 Phase 2 and has not landed yet.
    expect(ById['S-01'].status).toBe('FAIL');
    expect(ById['S-01'].error).toMatch(/root cause/);
    expect(ById['S-01'].observed.displayedTasks[0].length).toBeGreaterThan(400);

    // the gate misses it because unpunctuated lines undercount sentences
    expect(ById['S-01'].observed.routing.sentenceCount).toBeLessThan(4);
    expect(ById['S-01'].observed.routing.synthesisOn).toBe(false);
    expect(ById['S-07'].status).toBe('FAIL');
    expect(ById['S-12'].status).toBe('FAIL');
  });

  test('GH-43 Phase 1A CLOSED the ownership defect — S-01 now belongs to its author', () => {
    const ById = Object.fromEntries(Rows.map(ArgR => [ArgR.id, ArgR]));

    // this assertion is the inverse of the one that shipped with GH-44: before Phase 1A the same
    // row resolved to ["U_ALPHA","U_BETA"] with senderIsAssignee false.
    expect(ById['S-01'].observed.ownership.assignees).toEqual(['U_SENDER']);
    expect(ById['S-01'].observed.ownership.senderIsAssignee).toBe(true);
    expect(ById['S-01'].observed.ownership.resolvedFrom).toBe('first-person-commitment');
    // the addressees are retained as interested parties rather than silently dropped
    expect(ById['S-01'].observed.ownership.notify).toEqual(['U_ALPHA', 'U_BETA']);
    // and S-01 no longer fails for ownership — only for its task text
    expect(ById['S-01'].error).not.toMatch(/owner/);

    // the mention-as-subject case is fixed too
    expect(ById['S-05'].observed.ownership.assignees).toEqual(['U_SENDER']);
  });

  test('the GH-22 shared-assignment guard stays GREEN — the harness is not just failing everything', () => {
    const ById = Object.fromEntries(Rows.map(ArgR => [ArgR.id, ArgR]));
    expect(ById['S-06'].status).toBe('PASS');
    expect(ById['S-06'].observed.ownership.assignees.sort()).toEqual(['U_ALPHA', 'U_BETA']);

    // negative controls must not be turned into work
    expect(ById['S-10'].status).toBe('PASS');
    expect(ById['S-14'].status).toBe('PASS');
    expect(ById['S-15'].status).toBe('PASS');
  });

  test('runs are deterministic — a second pass produces byte-identical output', async () => {
    const Battery = require(BatteryPath);
    const Again = await RunAllAsync(Battery.scenarios);
    expect(SerializeCanonical(Again)).toBe(SerializeCanonical(Rows));
  });
});

describe('CheckExpectations', () => {
  test('reports every violated expectation, not just the first', () => {
    const Reasons = CheckExpectations(
      { expected: { recommendation: 'ignore', taskTextExcludes: ['secret'], maxTaskLength: 5 } },
      { recommendation: 'schedule', displayedTasks: ['a secret plan'], ownership: null },
    );
    expect(Reasons).toHaveLength(3);
  });

  test('a scenario with no expectations is vacuously satisfied', () => {
    expect(CheckExpectations({}, { recommendation: 'anything' })).toEqual([]);
  });
});

describe('DiffAgainstBaseline', () => {
  const Rows = [{ id: 'A', status: 'PASS', observed: { v: 1 }, error: null }];

  test('marks drift as CHANGED and an unseen id as NEW', () => {
    expect(DiffAgainstBaseline(Rows, { A: { v: 2 } })[0].status).toBe('CHANGED');
    expect(DiffAgainstBaseline(Rows, {})[0].status).toBe('NEW');
    expect(DiffAgainstBaseline(Rows, { A: { v: 1 } })[0].status).toBe('PASS');
  });

  test('key order does not count as drift (canonical comparison)', () => {
    const Wide = [{ id: 'A', status: 'PASS', observed: { a: 1, b: 2 }, error: null }];
    expect(DiffAgainstBaseline(Wide, { A: { b: 2, a: 1 } })[0].status).toBe('PASS');
  });

  test('no baseline means rows pass through untouched', () => {
    expect(DiffAgainstBaseline(Rows, null)).toBe(Rows);
  });
});
