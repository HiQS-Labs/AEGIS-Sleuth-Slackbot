'use strict';

const TitleContract = require('../src/reminder-title-contract');
const { SelectTaskText } = require('../src/reminder-display-selection');
const TaskGrounding = require('../src/task-grounding');
const { ReminderTitleContractViolations } = require('../scripts/decision-replay');
const Golden = require('./fixtures/reminder-title-golden.json');

// GH-250 — the output contract for a reminder's task title, and the golden set from the issue.
//
// Two layers are tested. The pure rules (normalize / validate / fit / fallback) directly, so a
// regression names the rule. And the golden set through the REAL selector, so the acceptance
// criteria of the issue are measured on what a user would see, whichever path produced it.

/** A source long enough to be a GH-243 long message (>500 chars). */
const LongSource = 'Background detail about the review. '.repeat(20) + 'Please review the plan tomorrow.';

describe('NormalizeReminderTitle', () => {
  test.each([
    ['addressee + courtesy + request + question mark',
      '<@U1> can we please wrap up the LTVera website layout improvements tonight, please?',
      'Wrap up the LTVera website layout improvements'],
    ['greeting before the addressee', 'hey <@U1>, could you send me the logs?', 'Send me the logs'],
    ['let\'s', '<@U2> let\'s connect the loop on the Mailgun alerts setup tomorrow morning, please.',
      'Connect the loop on the Mailgun alerts setup'],
    ['first-person commitment', 'I\'ll deploy the changes tomorrow morning.', 'Deploy the changes'],
    ['first-person with adverb', 'I will definitely resize the font tomorrow', 'Resize the font'],
    ['leading schedule wording precedes framing', 'Tomorrow I will deploy the hotfix', 'Deploy the hotfix'],
    ['leading schedule token does not damage a longer word', 'Tomorrowland release checklist', 'Tomorrowland release checklist'],
    ['weekday plus part of day is removed before framing', 'Next Friday morning I will deploy the hotfix', 'Deploy the hotfix'],
    ['trailing schedule wording is removed', 'Deploy the hotfix by Friday', 'Deploy the hotfix'],
    ['punctuated trailing schedule wording is removed', 'Deploy the hotfix by Friday.', 'Deploy the hotfix'],
    ['trailing weekday plus part of day is removed', 'Deploy the hotfix next Friday morning', 'Deploy the hotfix'],
    ['long-form end-of-period wording is removed', 'Deploy the release end of the week', 'Deploy the release'],
    ['multiword deadline lead-in is removed', 'Deploy the release no later than Friday', 'Deploy the release'],
    ['duration condition veto keeps the condition', 'Keep staging online until at least Friday', 'Keep staging online until at least Friday'],
    ['courtesy misspelling is removed before schedule wording', 'Check the report tomorrow, pleae', 'Check the report'],
    ['question wrapper', 'How hard is it to make our Ground Advantage $5 shipping to $6', 'Make our Ground Advantage $5 shipping to $6'],
    ['bare URL and its lead-in', 'Write up the initial email triage SOP going forward here: https://github.com/x/y/issues/1',
      'Write up the initial email triage SOP going forward'],
    ['labelled Slack link keeps its label', 'Review <https://github.com/x/pull/12|PR 12> before the release', 'Review PR 12 before the release'],
    ['trailing cc', 'rotate the certs tomorrow, cc <@U_BETA>', 'Rotate the certs'],
    ['trailing thanks and softener', 'review the PR if you get a chance, thanks!', 'Review the PR'],
    ['capitalizes only an all-lowercase first word', 'iOS build is red', 'iOS build is red'],
    ['already in shape', 'Review PR 697', 'Review PR 697'],
    ['a quoted name is opaque to the courtesy strip', 'Please review "The Kindly Migration" tomorrow', 'Review "The Kindly Migration"'],
    ['a quoted name is opaque to the framing strip', 'can you handle \'Please Let\'s Go\' by Friday?', 'Handle \'Please Let\'s Go\''],
  ])('%s', (_Label, ArgInput, ArgExpected) => {
    expect(TitleContract.NormalizeReminderTitle(ArgInput).text).toBe(ArgExpected);
  });

  test('reports which transforms fired', () => {
    expect(TitleContract.NormalizeReminderTitle('<@U1> can you please deploy it tomorrow?').changes)
      .toEqual(['mention', 'courtesy', 'request-framing', 'schedule', 'capitalized']);
    expect(TitleContract.NormalizeReminderTitle('Review PR 697').changes).toEqual([]);
  });

  test('only ever removes text — nothing a title did not already say can appear', () => {
    const Inputs = [
      '<@U1> can we please wrap up the LTVera website layout improvements tonight, please?',
      'I\'ll deploy the changes tomorrow morning.',
      'Write up the SOP here: https://example.test/x',
    ];
    for(const Input of Inputs) {
      const Output = TitleContract.NormalizeReminderTitle(Input).text;
      expect(TaskGrounding.UngroundedTerms(Output, Input)).toEqual([]);
    }
  });
});

describe('ValidateReminderTitle', () => {
  test.each([
    ['a question', 'Confirming this is ready for deployment today?', ['question', 'status-remark']],
    ['an interrogative without the mark', 'When is the deploy', ['question']],
    ['a status remark', 'I don\'t think those issues are related to Meettie implementation', ['status-remark']],
    ['a heads-up note', 'Heads up on the warehouse sync the connector has been retrying', ['status-remark']],
    ['a determiner-led statement', 'The staging cert rotation is tomorrow morning', ['not-imperative']],
    ['a bare pointer', 'Ask him', ['bare-pointer']],
    ['a pointer idiom', 'Close the loop on that', ['bare-pointer']],
    ['all of the above', 'Do all of the above tomorrow', ['bare-pointer']],
    ['one word', 'Deploy', ['too-short', 'bare-pointer']],
    ['a pointer idiom with a pointer object', 'Continue there', ['bare-pointer']],
    ['a pre-cut title', 'Clarify work allocation: author takes #205 gate idempotency and #123…', ['truncated']],
    ['empty', '', ['empty']],
  ])('%s is refused with the rule that refused it', (_Label, ArgInput, ArgReasons) => {
    expect(TitleContract.ValidateReminderTitle(ArgInput).reasons).toEqual(ArgReasons);
  });

  test.each([
    'Review PR 697',
    'Review the release',
    'Complete the alignment',
    'Install this for Binoid LTVera account',
    'Change Ground Advantage $5 shipping to $6',
    'Review \'Quarterly Rollout Checklist\'',
    'Ping <@U_OTHER> about the invoice',
    'Have the logs ready by 5',
    'Update on-call rota',
    'Do the migration',
    'Continue migration',
    'Review "Please Handle Me" doc',
  ])('%s satisfies the contract', ArgInput => {
    expect(TitleContract.ValidateReminderTitle(ArgInput)).toEqual({ ok: true, reasons: [] });
  });

  test('RequireSingleSentence refuses a multi-sentence dump and a pasted list, but not a version or a list marker in prose', () => {
    const Opts = { RequireSingleSentence: true };
    expect(TitleContract.ValidateReminderTitle('Found it. I will fix it', Opts).reasons).toEqual(['multi-sentence']);
    expect(TitleContract.ValidateReminderTitle('Review the items 1. deploy 2. test 3. ship', Opts).reasons).toEqual(['list']);
    expect(TitleContract.ValidateReminderTitle('Bump to the v1.2 release', Opts).ok).toBe(true);
    expect(TitleContract.ValidateReminderTitle('Review PR 1. and the follow-up', Opts).ok).toBe(true);
    // a sentence ending after a NUMBER is a boundary when a capitalized sentence follows...
    expect(TitleContract.ValidateReminderTitle('Review PR 123. Deploy the release tomorrow', Opts).reasons).toEqual(['multi-sentence']);
    // ...while an enumerator keeps its bracket or lowercase item and is the list rule's business.
    expect(TitleContract.ValidateReminderTitle('WEEK items: 1.) Client C 2.) QueryGuard logs', Opts).reasons).toEqual(['list']);
    // plain hyphen and asterisk bullets, as a multi-line message reads once collapsed.
    expect(TitleContract.ValidateReminderTitle('- Review invoices - Send receipts tomorrow', Opts).reasons).toEqual(['list']);
    expect(TitleContract.ValidateReminderTitle('* Review invoices * Send receipts', Opts).reasons).toEqual(['list']);
    expect(TitleContract.ValidateReminderTitle('HiQS - Clarify work allocation with the author', Opts).ok).toBe(true);
  });

  test('MaxSourceChars refuses anything over the GH-243 bound outright', () => {
    expect(TitleContract.ValidateReminderTitle(LongSource, { MaxSourceChars: 280 }).reasons).toContain('oversized');
  });
});

describe('FitTitleToBudget', () => {
  test('leaves a title within budget untouched', () => {
    const Text = 'Migrate the reporting cron job from the legacy box to the new scheduler';
    expect(TitleContract.FitTitleToBudget(Text)).toEqual({ text: Text, shortened: false });
    // exactly at both budgets is still untouched.
    const AtBudget = Array.from({ length: TitleContract.TITLE_MAX_WORDS }, (_, ArgI) => `w${ArgI}`).join(' ');
    expect(TitleContract.FitTitleToBudget(AtBudget)).toEqual({ text: AtBudget, shortened: false });
    expect(TitleContract.FitTitleToBudget('x'.repeat(TitleContract.TITLE_MAX_CHARS))).toEqual({ text: 'x'.repeat(TitleContract.TITLE_MAX_CHARS), shortened: false });
  });

  test('shortens at a clause boundary, never mid-word, and stays within the budget', () => {
    const Text = 'Run the Bounce cluster bridge fix on the VM to clear the "Delta 9 Edibles isn\'t in the reference model" warning on Recommendations';
    const Result = TitleContract.FitTitleToBudget(Text);
    expect(Result).toEqual({ text: 'Run the Bounce cluster bridge fix on the VM…', shortened: true });
    expect(Result.text.length).toBeLessThanOrEqual(TitleContract.TITLE_MAX_CHARS);
  });

  test('falls back to the last word boundary when no clause boundary is in range', () => {
    const Text = `${'word '.repeat(40)}end`;
    const Result = TitleContract.FitTitleToBudget(Text);
    expect(Result.shortened).toBe(true);
    expect(Result.text.length).toBeLessThanOrEqual(TitleContract.TITLE_MAX_CHARS);
    expect(Result.text).toMatch(/\bword…$/);
  });

  test('the word budget applies too', () => {
    const Text = Array.from({ length: 30 }, (_, ArgI) => `w${ArgI}`).join(' '); // 30 short words, 110 chars
    const Result = TitleContract.FitTitleToBudget(Text);
    expect(Result.shortened).toBe(true);
    expect(TitleContract.CountTitleWords(Result.text)).toBeLessThanOrEqual(TitleContract.TITLE_MAX_WORDS);
  });

  test('never severs a Slack token or an open quotation', () => {
    const Tail = ' <@U07ALICE99|alice> and then some more words after the mention token to push it over';
    const Result = TitleContract.FitTitleToBudget(`${'x'.repeat(70)}${Tail}`);
    expect((Result.text.match(/</g) || []).length).toBe((Result.text.match(/>/g) || []).length);
    const Quoted = TitleContract.FitTitleToBudget(`Review the "${'long quoted task name '.repeat(5)}" and more`);
    expect((Quoted.text.match(/"/g) || []).length % 2).toBe(0);
  });

  test('a custom budget (the digest\'s 140) is honoured with no word cap', () => {
    const Text = `${'word '.repeat(60)}end`;
    const Result = TitleContract.FitTitleToBudget(Text, 140, Number.POSITIVE_INFINITY);
    expect(Result.text.length).toBeLessThanOrEqual(140);
    expect(Result.text.endsWith('word…')).toBe(true);
  });
});

describe('BuildFallbackTitle', () => {
  test('takes the first line that names something, normalized, as the subject', () => {
    expect(TitleContract.BuildFallbackTitle(['ask him', '<@U1> the invoice from Acme is overdue, please chase it']))
      .toEqual({ text: 'Follow up: The invoice from Acme is overdue', subjectFrom: 1, shortened: false, unshortened: '' });
  });

  test('prefers a sentence that reads as a task over the commentary before it', () => {
    expect(TitleContract.BuildFallbackTitle([
      'Heads up everyone. Some background context here. Please raise Ground Advantage shipping to six dollars.',
    ]).text).toBe('Follow up: Raise Ground Advantage shipping to six dollars');
  });

  test('a rejected list does not come back as the subject', () => {
    expect(TitleContract.BuildFallbackTitle(['Review • invoices • receipts tomorrow']).text).toBe('Follow up on the original message');
  });

  test('the subject honours the word budget including the prefix, and is re-checked after the cut', () => {
    const Long = `the ${Array.from({ length: 20 }, (_, ArgI) => `w${ArgI}`).join(' ')} are broken`;
    const Result = TitleContract.BuildFallbackTitle([Long]);
    expect(TitleContract.CountTitleWords(Result.text)).toBeLessThanOrEqual(TitleContract.TITLE_MAX_WORDS);
    expect(Result.text.length).toBeLessThanOrEqual(TitleContract.TITLE_MAX_CHARS);
    expect(Result.text.startsWith('Follow up: The w0')).toBe(true);
  });

  test('never a pointer, never a question, and the generic title when nothing names anything', () => {
    expect(TitleContract.BuildFallbackTitle(['can you do this by tomorrow morning?', 'ask him']))
      .toMatchObject({ text: 'Follow up on the original message', subjectFrom: null });
    expect(TitleContract.BuildFallbackTitle([])).toMatchObject({ text: 'Follow up on the original message', subjectFrom: null });
  });

  test('the subject is within the title budget', () => {
    const Result = TitleContract.BuildFallbackTitle([`the ${'very '.repeat(40)}long status line`]);
    expect(Result.text.length).toBeLessThanOrEqual(TitleContract.TITLE_MAX_CHARS);
    expect(Result.text.startsWith('Follow up: The very')).toBe(true);
  });
});

describe('GH-250 golden set — the acceptance criteria hold on every sample, through the real selector', () => {
  /** @param {any} ArgSample */
  const Expand = ArgSample => {
    const Source = ArgSample.source === 'LONG' ? LongSource : ArgSample.source;
    const Candidate = Object.fromEntries(Object.entries(ArgSample.candidate || {})
      .map(([ArgKey, ArgValue]) => [ArgKey, ArgValue === 'LONG' ? LongSource : ArgValue]));
    return { Source, Candidate, Analyzed: ArgSample.analyzedSource || '' };
  };

  const Results = Golden.samples.map((/** @type {any} */ ArgSample) => {
    const { Source, Candidate, Analyzed } = Expand(ArgSample);
    return { sample: ArgSample, selection: SelectTaskText(Candidate, Source, ArgSample.synthesisOn, Analyzed), Source, Candidate, Analyzed };
  });

  test('the set is the issue\'s evidence plus coverage of every rule — at least 30 samples', () => {
    expect(Golden.samples.length).toBeGreaterThanOrEqual(30);
    expect(new Set(Golden.samples.map((/** @type {any} */ ArgS) => ArgS.id)).size).toBe(Golden.samples.length);
  });

  test.each(Results.map(ArgR => [ArgR.sample.id, ArgR]))('%s renders as expected', (_Id, ArgR) => {
    const { sample: Sample, selection: Selection } = ArgR;
    const Expected = Sample.expect || {};
    if(Expected.text !== undefined) expect(Selection.text).toBe(Expected.text);
    if(Expected.source !== undefined) expect(Selection.source).toBe(Expected.source);
    if(Expected.shortened !== undefined) expect(Selection.contract.shortened).toBe(Expected.shortened);
    for(const Needle of Expected.contains || []) expect(Selection.text).toContain(Needle);
    for(const Needle of Expected.excludes || []) expect(Selection.text).not.toContain(Needle);
    if(Expected.rejected !== undefined) {
      expect(Selection.contract.rejected.map(ArgE => `${ArgE.source}:${ArgE.reasons.join('+')}`)).toEqual(Expected.rejected);
    }
  });

  test('GH-258: an invented person-topic title is rejected by grounding', () => {
    const Selection = SelectTaskText(
      { reminder_message: 'Reply to Person One re: Zephyr audit', actionable_language: 'reply to Person One' },
      'Please reply to Person One tomorrow.', true,
      '[earlier messages] Atlas compliance review needs a response from Person One.',
    );
    expect(Selection.contract.rejected).toContainEqual({ source: 'title', reasons: ['ungrounded'] });
    expect(Selection.text).not.toContain('Zephyr audit');
  });

  test('100% within the length limits, 0 mid-word truncations, 0 addressee/please titles, 0 bare pointers', () => {
    const Violations = ReminderTitleContractViolations(
      Results.map(ArgR => ArgR.selection.text), Results.map(ArgR => ArgR.selection.contract),
    );
    expect(Violations).toEqual([]);
    for(const { selection: Selection } of Results) {
      expect(Selection.text.length).toBeLessThanOrEqual(TitleContract.TITLE_MAX_CHARS);
      expect(TitleContract.CountTitleWords(Selection.text)).toBeLessThanOrEqual(TitleContract.TITLE_MAX_WORDS);
      expect(Selection.text).not.toMatch(/^<@/);
      expect(Selection.text).not.toMatch(/\bplease\b/i);
      expect(Selection.text).not.toMatch(/\?$/);
    }
  });

  test('the shared invariant check catches the reported mid-word cut, and a cut it cannot verify', () => {
    // the defect from the issue, as a multi-word title: only the source text can prove the cut.
    const Broken = 'Test the pixel tester on my en…';
    const Source = 'Test the pixel tester on my end before I can say anything';
    expect(ReminderTitleContractViolations([Broken], [{ unshortened: Source }]).join(' ')).toMatch(/mid-word truncation/);
    expect(ReminderTitleContractViolations(['Test the pixel tester on my…'], [{ unshortened: Source }])).toEqual([]);
    expect(ReminderTitleContractViolations([Broken], [])).toEqual([expect.stringMatching(/cannot be verified/)]);
  });

  test('every rendered title is grounded in what the analyzer saw — GH-43/68 unchanged', () => {
    for(const { selection: Selection, Source, Candidate, Analyzed } of Results) {
      const GroundingSource = `${Source} ${Candidate.actionable_language || ''} ${Analyzed}`;
      const Text = Selection.text.startsWith(TitleContract.FALLBACK_TITLE_PREFIX)
        ? Selection.text.slice(TitleContract.FALLBACK_TITLE_PREFIX.length)
        : Selection.text;
      if(Text === TitleContract.GENERIC_FALLBACK_TITLE) continue;
      expect(TaskGrounding.UngroundedTerms(Text.replace(/…$/, ''), GroundingSource)).toEqual([]);
    }
  });

  test('the title-length distribution sits where the issue targets it (interquartile range within 4–14 words)', () => {
    const Words = Results
      .filter(ArgR => ArgR.selection.text !== TitleContract.GENERIC_FALLBACK_TITLE)
      .map(ArgR => TitleContract.CountTitleWords(ArgR.selection.text))
      .sort((ArgA, ArgB) => ArgA - ArgB);
    const Q1 = Words[Math.floor(Words.length * 0.25)];
    const Q3 = Words[Math.floor(Words.length * 0.75)];
    // GH-258 removes redundant due wording; a valid three-word imperative is still above the hard two-word floor.
    expect(Q1).toBeGreaterThanOrEqual(3);
    expect(Q3).toBeLessThanOrEqual(TitleContract.TITLE_TARGET_WORDS.max);
  });
});
