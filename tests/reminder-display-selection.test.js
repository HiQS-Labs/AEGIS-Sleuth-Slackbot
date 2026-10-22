'use strict';

const { SelectTaskText, SelectContextLine, DropUnresolvedReferenceCandidates } = require('../src/reminder-display-selection');
const { NeedsEarlierContext } = require('../src/reminder-context-resolution');

// GH-43, extracted after agy's branch relay (r1). Before this module the selection rule lived
// inline in a private method AND was reimplemented in scripts/decision-replay.js, so the harness
// could report a display the pipeline would never produce. These tests cover the shared rule
// directly; the harness and the module both call it.
//
// The over-compression heuristic below shipped in GH-337 with NO test coverage at all, which is how
// its threshold went unexamined until it started firing on the reported message.

describe('SelectTaskText — verbatim path', () => {
  test('synthesis off shows the user wording, normalized to the contract (GH-250)', () => {
    // the user's own sentence still wins the flag-off case — but it comes out in the one shape every
    // path shares: commitment framing dropped, imperative capital, nothing added.
    expect(SelectTaskText(
      { reminder_message: 'Deploy it', actionable_language: 'i will deploy it' },
      'i will deploy the hotfix tomorrow morning', false,
    )).toMatchObject({
      text: 'Deploy the hotfix tomorrow morning', source: 'verbatim', ungroundedTerms: [],
      contract: { normalized: ['request-framing', 'capitalized'], shortened: false, words: 5 },
    });
  });

  test('GH-250: a multi-sentence message is never a title, whatever the flag says', () => {
    const Selection = SelectTaskText(
      { reminder_message: 'Roll out the export bucket fix', actionable_language: 'I will roll it out' },
      'the nightly export was writing to the old bucket. I will roll it out tomorrow', false,
    );
    expect(Selection).toMatchObject({ text: 'Roll out the export bucket fix', source: 'title' });
    expect(Selection.contract.rejected).toEqual([{ source: 'verbatim', reasons: ['not-imperative', 'multi-sentence'] }]);
  });

  test('GH-250: an addressee, courtesy words and a trailing question mark never reach the bullet', () => {
    expect(SelectTaskText(
      {},
      '<@U_MIKE> can we please wrap up the LTVera website layout improvements tonight, please?', false,
    )).toMatchObject({ text: 'Wrap up the LTVera website layout improvements tonight', source: 'verbatim' });
  });

  test('an omitted routing decision does NOT take the verbatim path', () => {
    // absent means "no decision was computed", not "synthesis is off" — collapsing the two would
    // make every caller that forgets the argument silently dump the whole message.
    expect(SelectTaskText(
      { reminder_message: 'Deploy the hotfix', actionable_language: 'i will deploy the hotfix' },
      'i will deploy the hotfix tomorrow morning',
    ).source).toBe('title');
  });

  test('GH-250: a pointer with no resolvable object falls to the generic template, never a raw pointer', () => {
    const Selection = SelectTaskText(
      { reminder_message: 'Deploy it', actionable_language: 'i will deploy it' },
      'i will deploy it tomorrow morning', false,
    );
    expect(Selection).toMatchObject({ text: 'Follow up on the original message', source: 'fallback' });
    expect(Selection.contract.rejected.map(ArgEntry => ArgEntry.source)).toEqual(['verbatim', 'title', 'span']);
  });

  test('GH-250: a pointer resolves to a subject from the earlier context the analyzer saw', () => {
    const Analyzed = '[earlier messages in this thread, for reference]\n1. <@U_ALPHA> the invoice from Acme is overdue, please chase it\n[the message to act on]\nask him tomorrow';
    expect(SelectTaskText(
      { reminder_message: 'Ask him', actionable_language: 'ask him' },
      'ask him tomorrow', true, Analyzed,
    )).toMatchObject({ text: 'Follow up: The invoice from Acme is overdue', source: 'fallback' });
  });
});

describe('GH-250 phase 3 — structured fields and the deterministic object repair', () => {
  const { ValidateReminderCandidate } = require('../src/reminder-display-selection');
  const Source = 'can you review it by Friday? PR 697 is waiting on the API deploy and the smoke tests';

  test('a grounded object_ref repairs a pointer title in place, and the repair is reported', () => {
    const Selection = SelectTaskText(
      { reminder_message: 'Review it', actionable_language: 'review it', object_ref: 'PR 697' }, Source, true,
    );
    expect(Selection).toMatchObject({ text: 'Review PR 697', source: 'title' });
    expect(Selection.contract.repair).toEqual({ by: 'object-ref', from: 'Review it' });
    expect(Selection.contract.rejected.map(ArgE => ArgE.source)).toEqual(['title', 'span', 'verbatim']);
  });

  test('an ungrounded object_ref is dropped and the template is used instead', () => {
    const Selection = SelectTaskText(
      { reminder_message: 'Review it', actionable_language: 'review it', object_ref: 'PR 9999' }, Source, true,
    );
    expect(Selection.source).toBe('fallback');
    expect(Selection.text).not.toContain('9999');
  });

  test('`them` can be a person too: never rebuilt around a thing (Greptile on #268)', () => {
    const Analyzed = '[earlier messages in this thread, for reference]\n1. <@U_ALPHA> the invoice from Acme is overdue\n[the message to act on]\nask them tomorrow';
    const Selection = SelectTaskText(
      { reminder_message: 'Ask them', actionable_language: 'ask them', object_ref: 'the invoice' }, 'ask them tomorrow', true, Analyzed,
    );
    expect(Selection.text).not.toBe('Ask the invoice');
    expect(Selection.source).toBe('fallback');
  });

  test('a person pointer is never repaired deterministically — that is the model\'s job', () => {
    const Analyzed = '[earlier messages in this thread, for reference]\n1. <@U_ALPHA> PR 697 needs a second review\n[the message to act on]\nask him tomorrow';
    const Selection = SelectTaskText(
      { reminder_message: 'Ask him', actionable_language: 'ask him', object_ref: 'PR 697' }, 'ask him tomorrow', true, Analyzed,
    );
    expect(Selection).toMatchObject({ text: 'Follow up: PR 697 needs a second review', source: 'fallback' });
    expect(Selection.contract.repair).toBeNull();
  });

  test('a title that was repaired by the model reports that repair when shown', () => {
    const Selection = SelectTaskText(
      { reminder_message: 'Deploy the hotfix', actionable_language: 'do it', title_repair: { from: 'Do it', by: 'model', reasons: ['title:bare-pointer'] } },
      'the hotfix is ready, can you do it tomorrow?', true,
    );
    expect(Selection).toMatchObject({ text: 'Deploy the hotfix', source: 'title' });
    expect(Selection.contract.repair).toEqual({ by: 'model', from: 'Do it' });
  });

  test('ValidateReminderCandidate grounds object_ref and validates, de-duplicates and caps subtasks', () => {
    const Structure = ValidateReminderCandidate(
      { object_ref: 'PR 697', subtasks: ['Deploy the API', 'deploy the api', 'Do it', 'Run the smoke tests', 'Review Snowflake'] },
      Source,
    );
    expect(Structure).toEqual({ objectRef: 'PR 697', subtasks: ['Deploy the API', 'Run the smoke tests'], reasons: ['subtask-refused', 'subtask-refused'] });
    const Capped = ValidateReminderCandidate(
      { object_ref: 'Acme', subtasks: ['Deploy the API', 'Run the smoke tests', 'Review PR 697', 'Ship the Friday build'] }, Source,
    );
    expect(Capped.objectRef).toBe('');
    expect(Capped.subtasks).toHaveLength(3);
    expect(Capped.reasons).toEqual(['object-ref-ungrounded', 'subtasks-capped']);
    expect(ValidateReminderCandidate({}, Source)).toEqual({ objectRef: '', subtasks: [], reasons: [] });
    // a sub-item the budget cut reduces to its verb is refused, as a title would be (Greptile on #268).
    const QuotedName = 'Quarterly Rollout Checklist for the Northern Region Retail Partners and Wholesale Accounts';
    expect(ValidateReminderCandidate({ subtasks: [`Review "${QuotedName}"`] }, `review "${QuotedName}" tomorrow`))
      .toEqual({ objectRef: '', subtasks: [], reasons: ['subtask-refused'] });
  });
});

describe('GH-250 — the pointer-echo filter still sees the pointer behind the template', () => {
  const Analyzed = '[earlier messages in this thread, for reference]\n1. <@U_ALPHA> let\'s take the car.\n2. <@U_BETA> please bring the cooler.\n[the message to act on]\n<@U_BETA> can you do all of the above tomorrow?';
  const Live = '<@U_BETA> can you do all of the above tomorrow?';
  const Candidates = [
    { reminder_message: 'Take the car', actionable_language: 'let\'s take the car' },
    { reminder_message: 'Bring the cooler', actionable_language: 'please bring the cooler' },
    { reminder_message: 'Do all of the above', actionable_language: 'can you do all of the above' },
  ];
  const Rendered = Candidates.map(ArgCandidate => ({
    candidate: ArgCandidate,
    text: SelectTaskText(ArgCandidate, 'can you do all of the above tomorrow?', true, Analyzed).text,
    rawText: ArgCandidate.reminder_message,
  }));

  test('the pointer renders as the template, which on its own no longer reads as an echo', () => {
    expect(Rendered[2].text).toBe('Follow up: Take the car');
    expect(NeedsEarlierContext(Rendered[2].text)).toBe(false);
  });

  test('judged on the candidate\'s own words the echo is dropped beside its expansions', () => {
    const Result = DropUnresolvedReferenceCandidates(Rendered, true, NeedsEarlierContext, Live);
    expect(Result.droppedCount).toBe(1);
    expect(Result.kept.map(ArgCandidate => ArgCandidate.reminder_message)).toEqual(['Take the car', 'Bring the cooler']);
  });

  test('a pointer title whose displayed text is a concrete span is a task, not an echo — predicates pair on one text', () => {
    const Reply = 'I\'ll deploy the hotfix tomorrow and ping the client';
    const Entries = [
      { candidate: { reminder_message: 'Ping the client' }, text: 'Ping the client', rawText: 'Ping the client' },
      { candidate: { reminder_message: 'Do it' }, text: 'Deploy the hotfix tomorrow', rawText: 'Do it' },
    ];
    expect(DropUnresolvedReferenceCandidates(Entries, true, NeedsEarlierContext, Reply).droppedCount).toBe(0);
  });

  test('a distinct pronoun-bearing task is still kept (the GH-143 over-drop)', () => {
    const Reply = 'I\'ll file a GH issue about it tomorrow and discuss it with the team Friday';
    const Entries = [
      { candidate: { reminder_message: 'File a GH issue about the cache bug' }, text: 'File a GH issue about the cache bug', rawText: 'File a GH issue about the cache bug' },
      { candidate: { reminder_message: 'Discuss it with the team' }, text: 'Discuss it with the team', rawText: 'Discuss it with the team' },
    ];
    expect(DropUnresolvedReferenceCandidates(Entries, true, NeedsEarlierContext, Reply).droppedCount).toBe(0);
  });
});

describe('SelectTaskText — the over-compression fallback', () => {
  test('a ONE-word title loses to a much richer span — the rule its threshold exists for', () => {
    expect(SelectTaskText(
      { reminder_message: 'Deploy', actionable_language: 'I will deploy the whole staging cluster' },
      'I will deploy the whole staging cluster tonight', true,
    )).toMatchObject({ text: 'Deploy the whole staging cluster', source: 'span' });
  });

  test('GH-43: a THREE-word imperative title WINS over a first-person span', () => {
    // This is the reported message. Under GH-337's `<= 3` threshold the title lost, because the span
    // is longer only by its "i am going to" preamble — dropping that is the point, not compression.
    expect(SelectTaskText(
      { reminder_message: 'deploy the changes', actionable_language: 'i am going to deploy the changes' },
      'i am going to deploy the changes tomorrow morning', true,
    )).toMatchObject({ text: 'Deploy the changes', source: 'title' });
  });

  test('a short title against a similarly short span is not over-compressed — but GH-250 still refuses one word', () => {
    // nothing here names an object: the one-word title, the pointer span and the pointer message
    // are all refused, and with no subject anywhere the generic template is shown.
    const Selection = SelectTaskText(
      { reminder_message: 'Ship', actionable_language: 'I will ship it' },
      'I will ship it tomorrow', true,
    );
    expect(Selection).toMatchObject({ text: 'Follow up on the original message', source: 'fallback' });
    expect(Selection.contract.rejected[0]).toEqual({ source: 'title', reasons: ['too-short', 'bare-pointer'] });
  });
});

describe('SelectTaskText — the grounding constraint', () => {
  const Source = 'i will push that fix tomorrow morning after the index change';

  test('an invented entity is rejected and the quoted span is shown instead', () => {
    expect(SelectTaskText(
      { reminder_message: 'Bump the Snowflake query timeout', actionable_language: 'i will push that fix' },
      Source, true,
    )).toMatchObject({ text: 'Push that fix', source: 'span', ungroundedTerms: ['Snowflake'] });
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
      .toMatchObject({ text: 'Push that fix', source: 'span', ungroundedTerms: [] });
  });

  test('with neither title nor span the (normalized) message is used, and with no message at all the template', () => {
    expect(SelectTaskText({}, Source, true))
      .toMatchObject({ text: 'Push that fix tomorrow morning after the index change', source: 'verbatim' });
    expect(SelectTaskText({}, '', true)).toMatchObject({ text: 'Follow up on the original message', source: 'fallback' });
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
        reminder_message: 'Roll out the fix',
        actionable_language: 'I will roll it out',
        context: 'roll out the fix',
      },
      Source, true,
    )).toEqual({ text: '', suppressedBy: 'restates-task' });
  });

  test('restatement is judged after normalization, so punctuation and case do not hide it', () => {
    expect(SelectContextLine(
      {
        reminder_message: 'Roll out the fix',
        actionable_language: 'I will roll it out',
        context: 'Roll out the fix!',
      },
      Source, true,
    ).suppressedBy).toBe('restates-task');
  });
});

describe('GH-243 long-source safety', () => {
  const Original = 'Background detail about the review. '.repeat(20) + 'Please review the plan tomorrow.';
  test.each([
    ['flags off', { reminder_message: 'Review the plan', actionable_language: Original }, false, 'Review the plan'],
    ['whole-source title', { reminder_message: Original, actionable_language: Original }, true, 'Follow up on the original message'],
    ['no title', { actionable_language: Original }, true, 'Follow up on the original message'],
    ['rejected title', { reminder_message: 'Review Snowflake', actionable_language: Original }, true, 'Follow up on the original message'],
  ])('%s never returns the full long source', (_Label, Candidate, SynthesisOn, Expected) => {
    const Result = SelectTaskText(Candidate, Original, SynthesisOn, Original);
    expect(Result.text).toBe(Expected);
    expect(Result.text.length).toBeLessThanOrEqual(280);
    expect(Result.text).not.toContain('Background detail');
  });
  test('long analyzed context cannot leak through a short live reply', () => {
    expect(SelectTaskText({ reminder_message: Original, actionable_language: Original }, 'Please do that tomorrow', false, Original).text)
      .toBe('Follow up on the original message');
  });
  test('oversized subordinate context is suppressed', () => {
    expect(SelectContextLine({ reminder_message: 'Review the plan', context: Original }, Original, true, Original).text).toBe('');
  });
});
