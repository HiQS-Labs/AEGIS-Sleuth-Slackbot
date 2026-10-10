'use strict';

// GH-149: every reminder false-positive class is one row in the seeded corpus, run through the one
// judgement entry point with the model stubbed. A row whose expectation changes fails here.

const path = require('path');
const ReminderJudgement = require('../src/reminder-judgement');
const RemindersAIPipeline = require('../src/reminders-ai-pipeline');
const DateUtils = require('../src/date-utils');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const Corpus = require(path.join(__dirname, '..', 'data', 'static', 'ai', 'reminder-judgement-corpus.json'));

/** Spec shaped like ReminderAnalysisDecisionSpec, minus prompt assets the stub never reads. */
const StubSpec = Object.freeze({
  Name: 'reminder-analysis', InstructionsFile: 'reminders-instructions.md', SchemaFile: 'reminders-schema.json',
  RequiredFields: [], PromptVersion: 'reminders-v1', SchemaVersion: 'reminders-schema-v1',
});

describe('reminder judgement corpus (GH-149)', () => {
  test('the corpus seeds all four shipped classes', () => {
    const Issues = new Set(Corpus.Rows.map(ArgRow => ArgRow.Issue));
    for(const Issue of [197, 201, 205, 211]) expect(Issues.has(Issue)).toBe(true);
    expect(new Set(Corpus.Rows.map(ArgRow => ArgRow.Id)).size).toBe(Corpus.Rows.length);
  });

  test.each(Corpus.Rows.map(ArgRow => [ArgRow.Id, ArgRow]))('%s', async (ArgId, ArgRow) => {
    const WorkspaceAI = {
      ProcessMessageWithJsonResponseAsync: jest.fn(async () => {
        if(ArgRow.Model === null) throw new Error(`model must not be called for ${ArgId}`);
        return JSON.parse(JSON.stringify(ArgRow.Model));
      }),
    };

    const Judgement = await ReminderJudgement.JudgeReminderTextAsync(ArgRow.Text, {
      Mode: ArgRow.Mode, WorkspaceAI, DecisionSpec: StubSpec,
    });

    expect(Judgement.Verdict).toBe(ArgRow.Expect.Verdict);
    expect(Judgement.Reasons[0]).toBe(ArgRow.Expect.Reason);
    if(ArgRow.Expect.Detail !== undefined) expect(Judgement.Reasons).toContain(ArgRow.Expect.Detail);
    expect(Judgement.Exclusion).toBe(ArgRow.Expect.Exclusion ?? null);
    if(ArgRow.Expect.ModelCalled !== undefined)
      expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls.length > 0).toBe(ArgRow.Expect.ModelCalled);
    if(ArgRow.Expect.OwnWords !== undefined) expect(Judgement.OwnWords).toBe(ArgRow.Expect.OwnWords);
    if(ArgRow.Expect.PeriodOnly !== undefined)
      expect(Judgement.Triggers.map(ArgTrigger => ArgTrigger.PeriodOnly)).toEqual(ArgRow.Expect.PeriodOnly);

    // scheduling modes always hand the scheduler a model-shaped analysis.
    if(ArgRow.Mode === 'auto' || ArgRow.Mode === 'force') {
      expect(['schedule', 'ignore']).toContain(Judgement.Analysis.recommendation);
      expect(Array.isArray(Judgement.Analysis.reminders)).toBe(true);
    } else {
      expect(Judgement.Analysis).toBeNull();
    }

    // rows with a Date block also run the real date stage on their first trigger with a past anchor.
    if(ArgRow.Date) {
      const SlackApp = new MockSlackApp();
      const DateAI = { ProcessMessageWithJsonResponseAsync: jest.fn() };
      const Pipeline = new RemindersAIPipeline(DateAI, SlackApp, () => []);
      const MainTzOffset = DateUtils.GetTimeZoneOffsetInMinutes(SlackApp.WorkspaceInfo.MAIN_TIMEZONE);
      const Now = Date.now();
      const LocalPast = new Date(Now - (ArgRow.Date.AnchorAgeHours * 3600 * 1000) + (MainTzOffset * 60 * 1000));
      DateAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        year: LocalPast.getUTCFullYear(), month: LocalPast.getUTCMonth() + 1, day: LocalPast.getUTCDate(),
        hour: LocalPast.getUTCHours(), minute: LocalPast.getUTCMinutes(), second: 0, rationale: 'corpus past anchor',
      });
      const Result = await Pipeline.ExtractDateWithGptAsync(Judgement.Triggers[0].Phrase);
      expect(Result.success).toBe(true);
      expect(Result.wasAdjustedForward).toBe(ArgRow.Date.WasAdjustedForward);
      expect(Result.date.getTime()).toBeGreaterThan(Now);
    }
  });
});
