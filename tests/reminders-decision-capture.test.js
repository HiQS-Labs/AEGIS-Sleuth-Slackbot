'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const { MockSlackApp } = require('./mocks/mock-slack-app');
const RemindersAIPipeline = require('../src/reminders-ai-pipeline');
const { ResetAssetCache, DecisionOutcome } = require('../src/ai-decision');
const { createDecisionCorpusStore } = require('../src/decision-corpus-store');

// GH-44 Phase 3 — proof the reminder-analysis path actually runs through the shared chokepoint.
//
// This file is the phase's PROOF-OF-WORK gate, not a regression guard: every assertion here is red
// before the migration, because before it the path called ProcessMessageWithJsonResponseAsync
// directly and emitted no corpus record at all. The regression guards are the untouched suites
// (reminders-ai-pipeline, reminders-integration, reminders-module, reminders-app-mention-handler).

/** @returns {Promise<string>} a fresh temp corpus rootDir. */
function MakeRootDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reminders-capture-'));
}

/**
 * @param {any} ArgResponse Model response to resolve, or an Error to reject with.
 * @returns {{ProcessMessageWithJsonResponseAsync: jest.Mock}}
 */
function MakeWorkspaceAI(ArgResponse) {
  return {
    ProcessMessageWithJsonResponseAsync: jest.fn(() =>
      ArgResponse instanceof Error ? Promise.reject(ArgResponse) : Promise.resolve(ArgResponse)
    ),
  };
}

/**
 * @param {any} ArgWorkspaceAI
 * @returns {any} a pipeline wired to the given AI double.
 */
function MakePipeline(ArgWorkspaceAI) {
  return new RemindersAIPipeline(ArgWorkspaceAI, new MockSlackApp(), () => []);
}

const ScheduleResponse = Object.freeze({
  recommendation: 'schedule',
  rationale: 'firm commitment with a time trigger',
  reminders: [{
    actionable_language: 'i am going to deploy the changes',
    scheduling_trigger: 'tomorrow morning',
    reminder_message: 'Deploy the changes',
  }],
});

describe('GH-44 Phase 3 — reminder analysis emits decision-corpus records', () => {
  beforeEach(() => { ResetAssetCache(); });

  test('one analysis emits exactly one reminder-analysis record with routing debug facts', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 'decisions' });
    const Pipeline = MakePipeline(MakeWorkspaceAI(ScheduleResponse));
    Pipeline.SetDecisionCapture({ Store, Workspace: 'ws1', Mode: 'shadow' });

    await Pipeline.AnalyzeMessageForRemindersAsync('i am going to deploy the changes tomorrow morning');

    const Rows = await Store.readAll('ws1');
    expect(Rows).toHaveLength(1);
    expect(Rows[0]).toMatchObject({
      decision: 'reminder-analysis',
      outcome: DecisionOutcome.Ok,
      mode: 'shadow',
      promptVersion: 'reminders-v1',
      schemaVersion: 'reminders-schema-v1',
      workspace: 'ws1',
    });

    // the GH-337 Phase 4 routing facts, which before this phase existed only in a server log line
    expect(Rows[0].debugFacts).toMatchObject({
      segment: expect.any(String),
      synthesisOn: expect.any(Boolean),
      actionableSpanRatio: expect.any(Number),
      sentenceCount: expect.any(Number),
      recommendation: 'schedule',
      candidateCount: 1,
    });
  });

  test('capture is OFF by default — a pipeline nobody wired writes nothing', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 'decisions' });
    const Spy = jest.spyOn(Store, 'append');

    const Pipeline = MakePipeline(MakeWorkspaceAI(ScheduleResponse));
    // deliberately NOT calling SetDecisionCapture
    await Pipeline.AnalyzeMessageForRemindersAsync('i will deploy tomorrow morning');

    expect(Spy).not.toHaveBeenCalled();
    expect(await Store.readAll('ws1')).toEqual([]);
  });

  test('a rejected answer is captured as `invalid` while the legacy error still propagates', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 'decisions' });
    const Pipeline = MakePipeline(MakeWorkspaceAI({ rationale: 'x', reminders: [] }));
    Pipeline.SetDecisionCapture({ Store, Workspace: 'ws1' });

    await expect(Pipeline.AnalyzeMessageForRemindersAsync('anything'))
      .rejects.toThrow('GPT response is missing recommendation property or it is not a string.');

    const Rows = await Store.readAll('ws1');
    expect(Rows).toHaveLength(1);
    expect(Rows[0].outcome).toBe(DecisionOutcome.Invalid);
  });

  test('the dedup decision captures under its own decision name, so streams stay distinguishable', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 'decisions' });
    const Pipeline = MakePipeline(MakeWorkspaceAI(ScheduleResponse));
    Pipeline.SetDecisionCapture({ Store, Workspace: 'ws1' });

    await Pipeline.AnalyzeMessageForRemindersAsync('i will deploy tomorrow morning');
    const Rows = await Store.readAll('ws1');
    expect(Rows.map(ArgR => ArgR.decision)).toEqual(['reminder-analysis']);
  });
});

describe('GH-44 Phase 4 — thread multi-task extraction through the chokepoint', () => {
  beforeEach(() => { ResetAssetCache(); });

  const ThreadResponse = Object.freeze({
    candidates: [
      {
        taskIndex: 1, title: 'deploy the changes', sourceMessageNumbers: [2], sourceTs: ['2.0'],
        assigneeID: 'U_SENDER', deadline: 'tomorrow morning', deadlineResolution: 'explicit',
        confidence: 'high', flag: null, duplicateOpenReminderID: null,
      },
      {
        taskIndex: 2, title: 'run the smoke tests', sourceMessageNumbers: [3], sourceTs: ['3.0'],
        assigneeID: 'U_ALPHA', deadline: null, deadlineResolution: 'blank',
        confidence: 'low', flag: 'no explicit deadline', duplicateOpenReminderID: 'R-99',
      },
    ],
    rationale: 'two distinct commitments',
  });

  /** A three-turn thread — the multi-message case the single-message analyzer cannot express. */
  const Thread = [
    { ts: '1.0', user: 'U_SENDER', text: 'root cause: the scan only ever saw a fixed batch' },
    { ts: '2.0', user: 'U_SENDER', text: 'i am going to deploy the changes tomorrow morning' },
    { ts: '3.0', user: 'U_ALPHA', text: 'i can run the smoke tests after that' },
  ];

  test('emits one multi-task-extraction record with confidence + dedup debug facts', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 'decisions' });
    const WorkspaceAI = MakeWorkspaceAI(ThreadResponse);
    WorkspaceAI.ComplexModelName = 'complex-model-x';

    const Pipeline = MakePipeline(WorkspaceAI);
    Pipeline.SetDecisionCapture({ Store, Workspace: 'ws1' });

    await Pipeline.ExtractMultiTaskCandidatesAsync(Thread, null, [], []);

    const Rows = await Store.readAll('ws1');
    expect(Rows).toHaveLength(1);
    expect(Rows[0]).toMatchObject({
      decision: 'multi-task-extraction',
      outcome: DecisionOutcome.Ok,
      promptVersion: 'multi-task-v1',
      schemaVersion: 'multi-task-schema-v1',
      modelName: 'complex-model-x',
    });
    expect(Rows[0].debugFacts).toEqual({
      candidateCount: 2, highConfidence: 1, lowConfidence: 1, flagged: 1, duplicatesOfOpenReminders: 1,
    });
  });

  test('the complex model is actually used — asserted on the call, not assumed', async () => {
    const WorkspaceAI = MakeWorkspaceAI(ThreadResponse);
    WorkspaceAI.ComplexModelName = 'complex-model-x';
    await MakePipeline(WorkspaceAI).ExtractMultiTaskCandidatesAsync(Thread, null, [], []);

    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][3]).toBe('complex-model-x');
  });

  test('every thread turn reaches the model, in order — a harness that truncated would look green', async () => {
    const WorkspaceAI = MakeWorkspaceAI(ThreadResponse);
    WorkspaceAI.ComplexModelName = 'complex-model-x';
    await MakePipeline(WorkspaceAI).ExtractMultiTaskCandidatesAsync(Thread, null, [], []);

    const InputText = WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0];
    expect(InputText).toContain('[msg:1 user:U_SENDER ts:1.0] root cause');
    expect(InputText).toContain('[msg:2 user:U_SENDER ts:2.0] i am going to deploy');
    expect(InputText).toContain('[msg:3 user:U_ALPHA ts:3.0] i can run the smoke tests');
    expect(InputText.indexOf('msg:1')).toBeLessThan(InputText.indexOf('msg:2'));
    expect(InputText.indexOf('msg:2')).toBeLessThan(InputText.indexOf('msg:3'));
  });

  test('the prompt the model receives is the extracted asset, not a rewrite', async () => {
    const Fs = require('fs');
    const Asset = Fs.readFileSync(
      path.join(__dirname, '..', 'data', 'static', 'ai', 'multi-task-extraction-instructions.md'), 'utf8',
    );
    const WorkspaceAI = MakeWorkspaceAI(ThreadResponse);
    WorkspaceAI.ComplexModelName = 'complex-model-x';
    await MakePipeline(WorkspaceAI).ExtractMultiTaskCandidatesAsync(Thread, null, [], []);

    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][1]).toBe(Asset);
  });

  test('low-confidence candidates are flagged, never dropped', async () => {
    const WorkspaceAI = MakeWorkspaceAI(ThreadResponse);
    WorkspaceAI.ComplexModelName = 'complex-model-x';
    const Result = await MakePipeline(WorkspaceAI).ExtractMultiTaskCandidatesAsync(Thread, null, [], []);

    expect(Result.candidates).toHaveLength(2);
    expect(Result.candidates.find(ArgC => ArgC.confidence === 'low').flag).toBe('no explicit deadline');
  });

  test('a non-array candidates field still throws the original message', async () => {
    const WorkspaceAI = MakeWorkspaceAI({ candidates: 'nope', rationale: 'x' });
    WorkspaceAI.ComplexModelName = 'complex-model-x';
    await expect(MakePipeline(WorkspaceAI).ExtractMultiTaskCandidatesAsync(Thread, null, [], []))
      .rejects.toThrow('Multi-task extraction: invalid response from model.');
  });
});

describe('GH-44 Phase 3 — behavior parity (the errors that keep migrated callers honest)', () => {
  beforeEach(() => { ResetAssetCache(); });

  test.each([
    ['missing recommendation', { rationale: 'x', reminders: [] }, 'GPT response is missing recommendation property or it is not a string.'],
    ['missing rationale', { recommendation: 'ignore', reminders: [] }, 'GPT response is missing rationale property or it is not a string.'],
    ['missing reminders', { recommendation: 'ignore', rationale: 'x' }, 'GPT response is missing reminders property or it is not an array.'],
    ['wrong-typed recommendation', { recommendation: 123, rationale: 'x', reminders: [] }, 'GPT response is missing recommendation property or it is not a string.'],
    ['wrong-typed reminders', { recommendation: 'ignore', rationale: 'x', reminders: 'nope' }, 'GPT response is missing reminders property or it is not an array.'],
  ])('%s throws the exact legacy message', async (ArgName, ArgResponse, ArgExpected) => {
    const Pipeline = MakePipeline(MakeWorkspaceAI(ArgResponse));
    await expect(Pipeline.AnalyzeMessageForRemindersAsync('anything')).rejects.toThrow(ArgExpected);
  });

  test('an empty reminders array is a value, not an absence — it survives to the caller', async () => {
    const Pipeline = MakePipeline(MakeWorkspaceAI({ recommendation: 'ignore', rationale: 'no task', reminders: [] }));
    const Result = await Pipeline.AnalyzeMessageForRemindersAsync('just an FYI, nothing to do');
    expect(Result.recommendation).toBe('ignore');
    expect(Result.reminders).toEqual([]);
  });

  test('the deterministic direct-ask fallback still fires when the model says ignore', async () => {
    const Pipeline = MakePipeline(MakeWorkspaceAI({ recommendation: 'ignore', rationale: 'missed it', reminders: [] }));
    const Result = await Pipeline.AnalyzeMessageForRemindersAsync('please deploy the fix tomorrow');
    expect(Result.recommendation).toBe('schedule');
    expect(Result.reminders).toHaveLength(1);
  });
});
