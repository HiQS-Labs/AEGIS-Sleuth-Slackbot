'use strict';

const { SelectTaskText, SelectContextLine } = require('../src/reminder-display-selection');

// GH-43, extracted after agy's branch relay (r1). Before this module the selection rule lived
// inline in a private method AND was reimplemented in scripts/decision-replay.js, so the harness
// could report a display the pipeline would never produce. These tests cover the shared rule
// directly; the harness and the module both call it.
//
// The over-compression heuristic below shipped in GH-337 with NO test coverage at all, which is how
// its threshold went unexamined until it started firing on the reported message.

describe('SelectTaskText — verbatim path', () => {
  test('synthesis off shows the normalized original unchanged', () => {
    expect(SelectTaskText(
      { reminder_message: 'Deploy it', actionable_language: 'i will deploy it' },
      'i will deploy it tomorrow morning', false,
    )).toEqual({ text: 'i will deploy it tomorrow morning', source: 'verbatim', ungroundedTerms: [] });
  });

  test('an omitted routing decision does NOT take the verbatim path', () => {
    // absent means "no decision was computed", not "synthesis is off" — collapsing the two would
    // make every caller that forgets the argument silently dump the whole message.
    expect(SelectTaskText(
      { reminder_message: 'Deploy it', actionable_language: 'i will deploy it' },
      'i will deploy it tomorrow morning',
    ).source).toBe('title');
  });
});

describe('SelectTaskText — the over-compression fallback', () => {
  test('a ONE-word title loses to a much richer span — the rule its threshold exists for', () => {
    expect(SelectTaskText(
      { reminder_message: 'Deploy', actionable_language: 'I will deploy the whole staging cluster' },
      'I will deploy the whole staging cluster tonight', true,
    )).toMatchObject({ text: 'I will deploy the whole staging cluster', source: 'span' });
  });

  test('GH-43: a THREE-word imperative title WINS over a first-person span', () => {
    // This is the reported message. Under GH-337's `<= 3` threshold the title lost, because the span
    // is longer only by its "i am going to" preamble — dropping that is the point, not compression.
    expect(SelectTaskText(
      { reminder_message: 'deploy the changes', actionable_language: 'i am going to deploy the changes' },
      'i am going to deploy the changes tomorrow morning', true,
    )).toMatchObject({ text: 'deploy the changes', source: 'title' });
  });

  test('a short title against a similarly short span is not over-compressed', () => {
    expect(SelectTaskText(
      { reminder_message: 'Ship', actionable_language: 'I will ship it' },
      'I will ship it tomorrow', true,
    )).toMatchObject({ text: 'Ship', source: 'title' });
  });
});

describe('SelectTaskText — the grounding constraint', () => {
  const Source = 'i will push that fix tomorrow morning after the index change';

  test('an invented entity is rejected and the quoted span is shown instead', () => {
    expect(SelectTaskText(
      { reminder_message: 'Bump the Snowflake query timeout', actionable_language: 'i will push that fix' },
      Source, true,
    )).toEqual({ text: 'i will push that fix', source: 'span', ungroundedTerms: ['Snowflake'] });
  });

  test('the rejected terms are RETURNED, not logged — this module stays pure', () => {
    const Result = SelectTaskText(
      { reminder_message: 'Ship PayloadV2 by 9', actionable_language: 'i will push that fix' },
      Source, true,
    );
    expect(Result.ungroundedTerms).toEqual(['9', 'PayloadV2']);
  });

  test('a grounded rewrite survives — the constraint is on entities, not phrasing', () => {
    expect(SelectTaskText(
      { reminder_message: 'Push the index change fix', actionable_language: 'i will push that fix' },
      Source, true,
    )).toMatchObject({ text: 'Push the index change fix', source: 'title', ungroundedTerms: [] });
  });

  test('with no title at all the span is used and nothing is reported as ungrounded', () => {
    expect(SelectTaskText({ actionable_language: 'i will push that fix' }, Source, true))
      .toEqual({ text: 'i will push that fix', source: 'span', ungroundedTerms: [] });
  });

  test('with neither title nor span it falls back rather than rendering empty', () => {
    expect(SelectTaskText({}, Source, true)).toMatchObject({ text: Source, source: 'fallback' });
    expect(SelectTaskText({}, '', true)).toMatchObject({ text: 'Task not specified', source: 'fallback' });
  });
});

describe('SelectContextLine', () => {
  const Source = 'the nightly export was writing to the old bucket. I will roll it out tomorrow';

  test('a grounded context distinct from the task is kept', () => {
    expect(SelectContextLine(
      {
        reminder_message: 'Roll out the export bucket fix',
        actionable_language: 'I will roll it out',
        context: 'the nightly export was writing to the old bucket',
      },
      Source, true,
    )).toEqual({ text: 'the nightly export was writing to the old bucket', suppressedBy: null });
  });

  test.each([
    ['empty', { context: '' }, true, 'empty'],
    ['verbatim path', { context: 'the nightly export was writing to the old bucket' }, false, 'verbatim-path'],
    ['ungrounded', { context: 'the Snowflake warehouse was starved' }, true, 'ungrounded'],
  ])('%s suppresses the line, and says why', (ArgName, ArgCandidate, ArgSynthesisOn, ArgReason) => {
    const Result = SelectContextLine(
      { actionable_language: 'I will roll it out', ...ArgCandidate }, Source, ArgSynthesisOn,
    );
    expect(Result).toEqual({ text: '', suppressedBy: ArgReason });
  });

  test('a context that merely restates the task is suppressed as noise', () => {
    expect(SelectContextLine(
      {
        reminder_message: 'Roll it out',
        actionable_language: 'I will roll it out',
        context: 'roll it out',
      },
      Source, true,
    )).toEqual({ text: '', suppressedBy: 'restates-task' });
  });

  test('restatement is judged after normalization, so punctuation and case do not hide it', () => {
    expect(SelectContextLine(
      {
        reminder_message: 'Roll it out',
        actionable_language: 'I will roll it out',
        context: 'Roll it out!',
      },
      Source, true,
    ).suppressedBy).toBe('restates-task');
  });
});
