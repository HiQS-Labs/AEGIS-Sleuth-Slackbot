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
    const Battery = require(BatteryPath);
    expect(Rows).toHaveLength(Battery.scenarios.length);
    expect(new Set(Rows.map(ArgR => ArgR.id)).size).toBe(Battery.scenarios.length);
  });

  test('GH-43 Phase 2 CLOSED the verbatim-task-text defect — the whole battery is green', () => {
    const ById = Object.fromEntries(Rows.map(ArgR => [ArgR.id, ArgR]));

    // S-01 is the reported production message. Before Phase 2 its task bullet was the entire
    // 480-character message; it now renders the analyzer's brief.
    expect(ById['S-01'].status).toBe('PASS');
    expect(ById['S-01'].observed.routing.synthesisOn).toBe(true);
    expect(ById['S-01'].observed.displayedTasks[0].length).toBeLessThan(80);
    expect(ById['S-01'].observed.displayedTasks[0]).not.toMatch(/root cause/);
    // the newline rule is what lifts it over the sentence threshold: it counted 3 before.
    expect(ById['S-01'].observed.routing.sentenceCount).toBe(5);

    expect(ById['S-07'].status).toBe('PASS');
    expect(ById['S-12'].status).toBe('PASS');
    expect(Rows.filter(ArgR => ArgR.status === 'FAIL')).toEqual([]);
  });

  test('each Phase 2 mechanism is INDEPENDENTLY load bearing — neither is dead code', async () => {
    const Battery = require(BatteryPath);
    const Pipeline = require('../src/reminders-ai-pipeline');

    /**
     * @param {any[]} ArgRows
     * @returns {string[]} ids that failed.
     */
    const FailedIDs = ArgRows => ArgRows.filter(ArgR => ArgR.status === 'FAIL').map(ArgR => ArgR.id);

    // 1. disable the buried-task ratio gate. S-07 and S-12 are single/low-sentence long notes that
    //    only the ratio can route, so they must go red.
    const OriginalMinLength = Pipeline.BURIED_TASK_MIN_LENGTH;
    Pipeline.BURIED_TASK_MIN_LENGTH = Number.MAX_SAFE_INTEGER;
    try {
      expect(FailedIDs(await RunAllAsync(Battery.scenarios)).sort()).toEqual(['S-07', 'S-12']);
    } finally {
      Pipeline.BURIED_TASK_MIN_LENGTH = OriginalMinLength;
    }

    // 2. revert CountSentences to the shipped punctuation-only rule. S-16 has no quoted span at all,
    //    so its ratio is 0 and unusable — the newline rule is the ONLY thing that can route it.
    const OriginalCountSentences = Pipeline.CountSentences;
    Pipeline.CountSentences = (/** @type {string} */ ArgText) => {
      const Text = (ArgText || '').trim();
      if(!Text) return 0;
      const Matches = Text.match(/[.!?]+(?=\s|$)/g);
      return Math.max(Matches ? Matches.length : 0, 1);
    };
    try {
      expect(FailedIDs(await RunAllAsync(Battery.scenarios))).toEqual(['S-16']);
    } finally {
      Pipeline.CountSentences = OriginalCountSentences;
    }

    // and the battery is green again once both are restored — the perturbation, not the code, was
    // what turned it red.
    expect(FailedIDs(await RunAllAsync(Battery.scenarios))).toEqual([]);
  });

  test('GH-43 Phase 3: task and context are separate, and the grounding constraint is enforced', async () => {
    const Battery = require(BatteryPath);
    const Grounding = require('../src/task-grounding');
    const ById = Object.fromEntries(Rows.map(ArgR => [ArgR.id, ArgR]));

    // S-01, the reported message: a short task with the background on its own line, and the
    // 480-character original left where it belongs — the blockquote.
    expect(ById['S-01'].observed.displayedTasks).toEqual(['deploy the changes']);
    expect(ById['S-01'].observed.displayedContext[0]).toMatch(/fixed batch/);
    expect(ById['S-01'].observed.displayedContext[0])
      .not.toBe(ById['S-01'].observed.displayedTasks[0]);

    // a short clean message has no background to give, and renders no context line at all.
    expect(ById['S-08'].observed.displayedContext).toEqual(['']);

    // S-20 is adversarial: the title names Snowflake and 4x, neither of which the author wrote.
    // Both are rejected and the bullet falls back to the quoted span.
    expect(ById['S-20'].status).toBe('PASS');
    expect(ById['S-20'].observed.displayedTasks).toEqual(['i will push that fix']);
    expect(ById['S-20'].observed.displayedContext).toEqual(['']);

    // PERTURBATION: let the grounding check pass everything, i.e. trust the prompt.
    const Original = Grounding.UngroundedTerms;
    Grounding.UngroundedTerms = () => [];
    try {
      const Failed = (await RunAllAsync(Battery.scenarios)).filter(ArgR => ArgR.status === 'FAIL');
      expect(Failed.map(ArgR => ArgR.id)).toEqual(['S-20']);
      expect(Failed[0].error).toMatch(/UNGROUNDED TERM "Snowflake"/);
    } finally {
      Grounding.UngroundedTerms = Original;
    }
  });

  test('GH-43 Phase 1B: the never-invent-users guard is real, not just a prompt instruction', async () => {
    const Battery = require(BatteryPath);
    const Ownership = require('../src/reminder-ownership');
    const ById = Object.fromEntries(Rows.map(ArgR => [ArgR.id, ArgR]));

    // shipped behavior: a fabricated id reaches neither path.
    expect(ById['S-17'].status).toBe('PASS');
    expect(ById['S-17'].observed.candidates[0].assigneeID).toBeNull();
    expect(ById['S-18'].status).toBe('PASS');
    expect(ById['S-18'].observed.ownership.assignees).toEqual(['U_ALPHA']);
    expect(ById['S-18'].observed.ownership.resolvedFrom).toBe('analyzer-mentioned');

    // and the ambiguous case the deterministic rules could not reach is now resolved.
    expect(ById['S-19'].observed.ownership.assignees).toEqual(['U_SENDER']);
    expect(ById['S-19'].observed.ownership.resolvedFrom).toBe('analyzer-speaker');

    // PERTURBATION: make the guard fail open, exactly as an un-enforced prompt rule would behave.
    const Original = Ownership.ConstrainAssigneeToParticipants;
    Ownership.ConstrainAssigneeToParticipants = (/** @type {any} */ ArgProposed) =>
      ({ assigneeID: ArgProposed || null, wasRejected: false });
    try {
      const Failed = (await RunAllAsync(Battery.scenarios))
        .filter(ArgR => ArgR.status === 'FAIL');
      expect(Failed.map(ArgR => ArgR.id)).toEqual(['S-17']);
      expect(Failed[0].error).toMatch(/INVENTED USER U_GHOST/);
    } finally {
      Ownership.ConstrainAssigneeToParticipants = Original;
    }
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
    // and S-01 no longer fails at all: Phase 1A took the ownership half, Phase 2 the task text.
    expect(ById['S-01'].error).toBeNull();

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

  test('a replay never mutates the fixture it replays', async () => {
    // Found while building the Phase 1B adversarial gate. The pipeline legitimately writes back to
    // the object a model returns (ExtractMultiTaskCandidatesAsync overwrites a rejected assigneeID
    // in place), and the harness was handing out the fixture BY REFERENCE — so the first run scrubbed
    // U_GHOST out of the require-cached scenario and every later run in that process replayed a
    // response the file never contained. The determinism test above could not see it, because the
    // corruption is idempotent: run 2 and run 3 agree with each other, just not with the fixture.
    const Battery = require(BatteryPath);
    const Adversarial = Battery.scenarios.find((/** @type {any} */ ArgS) => ArgS.id === 'S-17');
    const Before = JSON.stringify(Adversarial.recordedResponse);

    await RunAllAsync(Battery.scenarios);

    expect(JSON.stringify(Adversarial.recordedResponse)).toBe(Before);
    expect(Adversarial.recordedResponse.candidates[0].assigneeID).toBe('U_GHOST');
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
