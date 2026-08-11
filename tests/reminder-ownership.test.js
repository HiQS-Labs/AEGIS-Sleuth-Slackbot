'use strict';

const {
  ResolveAssignees, DetectLeadingAddressBlock, HasFirstPersonCommitment, HasSecondPersonAsk,
  ConstrainAssigneeToParticipants, ReduceGroupOwner, IsSpanInsideQuotedSpeech,
} = require('../src/reminder-ownership');

// GH-43 Phase 1A — ownership from the grammatical subject of the commitment, not mention-scraping.
// Red before this phase: the module did not exist and every mention became an assignee.

describe('DetectLeadingAddressBlock', () => {
  test('detects consecutive mentions at the start followed by prose', () => {
    expect(DetectLeadingAddressBlock('<@U_A> <@U_B> heads up, the box is back'))
      .toEqual(['U_A', 'U_B']);
    expect(DetectLeadingAddressBlock('<@U_A>: quick update')).toEqual(['U_A']);
    expect(DetectLeadingAddressBlock('<@U_A|alpha> status below')).toEqual(['U_A']);
  });

  test('a message that is ONLY mentions has no address block — there is no statement to attribute', () => {
    expect(DetectLeadingAddressBlock('<@U_A> <@U_B>')).toEqual([]);
    expect(DetectLeadingAddressBlock('   <@U_A>  ')).toEqual([]);
  });

  test('a mention that is not at the start is not an address block', () => {
    expect(DetectLeadingAddressBlock('I spoke with <@U_A> about it')).toEqual([]);
    expect(DetectLeadingAddressBlock('')).toEqual([]);
  });
});

describe('first vs second person detection', () => {
  test.each([
    'i am going to deploy the changes',
    "I'll patch it",
    'I will merge and deploy it',
    'I need to work on the backfill',
  ])('%s reads as a first-person commitment', (ArgText) => {
    expect(HasFirstPersonCommitment(ArgText)).toBe(true);
  });

  test.each([
    'can you both test the new release',
    'please review the PR',
    'could you run the smoke tests',
  ])('%s reads as a second-person ask', (ArgText) => {
    expect(HasSecondPersonAsk(ArgText)).toBe(true);
    expect(HasFirstPersonCommitment(ArgText)).toBe(false);
  });

  test('a second-person ask wins even when it contains a stray first-person word', () => {
    // "me" here is the object of someone else's action, not a commitment by the speaker
    expect(HasFirstPersonCommitment('can you send me the logs')).toBe(false);
    expect(HasSecondPersonAsk('can you send me the logs')).toBe(true);
  });

  test('"we" is deliberately NOT treated as first-person singular', () => {
    // ambiguous between the speaker and the team; guessing wrong reassigns someone else's work
    expect(HasFirstPersonCommitment('we fixed the scan')).toBe(false);
  });

  test('empty input is neither', () => {
    expect(HasFirstPersonCommitment('')).toBe(false);
    expect(HasSecondPersonAsk('')).toBe(false);
  });
});

describe('ResolveAssignees', () => {
  test('THE REPORTED DEFECT: address block + first-person commitment assigns to the AUTHOR', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> <@U_BETA> root cause: the scan only saw a fixed batch. i am going to deploy the changes tomorrow morning',
      ActionableLanguage: 'i am going to deploy the changes',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
    });

    expect(Result.assigneeIDs).toEqual(['U_SENDER']);
    expect(Result.resolvedBy).toBe('first-person-commitment');
    // the people it was addressed to are interested parties, not owners
    expect(Result.notifyIDs).toEqual(['U_ALPHA', 'U_BETA']);
  });

  test('GH-22 REGRESSION GUARD: an explicit ask to two people still assigns to both', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> <@U_BETA> can you both test the new release tomorrow morning?',
      ActionableLanguage: 'can you both test the new release',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
    });

    expect(Result.assigneeIDs).toEqual(['U_ALPHA', 'U_BETA']);
    expect(Result.resolvedBy).toBe('second-person-ask');
  });

  test('a mention used as a sentence subject does not steal ownership', () => {
    const Result = ResolveAssignees({
      MessageText: "<@U_ALPHA> found the root cause. I'll patch it tomorrow morning.",
      ActionableLanguage: "I'll patch it",
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    });

    expect(Result.assigneeIDs).toEqual(['U_SENDER']);
    expect(Result.notifyIDs).toEqual(['U_ALPHA']);
  });

  test('no mentions and a first-person commitment still resolves to the sender', () => {
    const Result = ResolveAssignees({
      MessageText: "I'll deploy the changes tomorrow morning.",
      ActionableLanguage: "I'll deploy the changes",
      MentionedIDs: [],
      SenderID: 'U_SENDER',
    });
    expect(Result.assigneeIDs).toEqual(['U_SENDER']);
    expect(Result.notifyIDs).toEqual([]);
  });

  test('no grammatical signal falls back to prior behavior: mentions, else sender', () => {
    expect(ResolveAssignees({
      MessageText: '<@U_ALPHA> the deploy is tomorrow morning',
      ActionableLanguage: 'the deploy is tomorrow morning',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    })).toMatchObject({ assigneeIDs: ['U_ALPHA'], resolvedBy: 'mentions' });

    expect(ResolveAssignees({
      MessageText: 'the deploy is tomorrow morning',
      ActionableLanguage: 'the deploy is tomorrow morning',
      MentionedIDs: [],
      SenderID: 'U_SENDER',
    })).toMatchObject({ assigneeIDs: ['U_SENDER'], resolvedBy: 'sender-fallback' });
  });

  test('the sender is never duplicated into notify when they are also mentioned', () => {
    const Result = ResolveAssignees({
      MessageText: "<@U_SENDER> <@U_ALPHA> I'll handle it tomorrow",
      ActionableLanguage: "I'll handle it",
      MentionedIDs: ['U_SENDER', 'U_ALPHA'],
      SenderID: 'U_SENDER',
    });
    expect(Result.assigneeIDs).toEqual(['U_SENDER']);
    expect(Result.notifyIDs).toEqual(['U_ALPHA']);
  });

  test('ownership derives from the ACTIONABLE SPAN, not the whole message', () => {
    // the surrounding note is full of first-person prose, but the task is an ask of someone else
    const Result = ResolveAssignees({
      MessageText: "I spent all week on this and I'm exhausted. <@U_ALPHA> please run the smoke tests tomorrow.",
      ActionableLanguage: 'please run the smoke tests',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
    expect(Result.resolvedBy).toBe('second-person-ask');
  });

  test('mentions are used when the sender is unknown, rather than producing an empty assignee set', () => {
    const Result = ResolveAssignees({
      MessageText: "<@U_ALPHA> I'll do it tomorrow",
      ActionableLanguage: "I'll do it",
      MentionedIDs: ['U_ALPHA'],
      SenderID: '',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
  });

  test('derives mentions from the message when the caller does not supply them', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> <@U_BETA> please deploy tomorrow',
      ActionableLanguage: 'please deploy',
      SenderID: 'U_SENDER',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA', 'U_BETA']);
  });
});

// GH-43 Phase 1B — the analyzer's ownership verdict. Red before this phase: ResolveAssignees ignored
// both new arguments, so every case below fell through to the mentions/sender fallbacks.
describe('ConstrainAssigneeToParticipants', () => {
  test('THE GUARANTEE: a user absent from the source is discarded, not assigned', () => {
    expect(ConstrainAssigneeToParticipants('U_GHOST', ['U_A', 'U_B'], null))
      .toEqual({ assigneeID: null, wasRejected: true });
  });

  test('a user present in the source passes through untouched', () => {
    expect(ConstrainAssigneeToParticipants('U_A', ['U_A', 'U_B']))
      .toEqual({ assigneeID: 'U_A', wasRejected: false });
  });

  test('an absent proposal takes the fallback and is NOT reported as a rejection', () => {
    // nothing was hallucinated here — the model simply declined to name anyone.
    expect(ConstrainAssigneeToParticipants(null, ['U_A'], 'U_DEFAULT'))
      .toEqual({ assigneeID: 'U_DEFAULT', wasRejected: false });
    expect(ConstrainAssigneeToParticipants('   ', ['U_A'], 'U_DEFAULT').wasRejected).toBe(false);
  });

  test('a rejected proposal still falls back rather than dropping the assignee entirely', () => {
    expect(ConstrainAssigneeToParticipants('U_GHOST', ['U_A'], 'U_DEFAULT'))
      .toEqual({ assigneeID: 'U_DEFAULT', wasRejected: true });
  });

  test('an empty allow-list rejects everything — it never fails open', () => {
    expect(ConstrainAssigneeToParticipants('U_A', []).assigneeID).toBeNull();
    expect(ConstrainAssigneeToParticipants('U_A', /** @type {any} */ (null)).assigneeID).toBeNull();
  });
});

describe('ReduceGroupOwner', () => {
  test('unanimous candidates keep their verdict; disagreement collapses to unclear', () => {
    expect(ReduceGroupOwner([{ owner: 'speaker' }, { owner: 'speaker' }]).owner).toBe('speaker');
    // one candidate says the author owns it, another says a mentioned user does. Picking a winner
    // would be guessing, and the deterministic rules handle ambiguity better than a coin flip.
    expect(ReduceGroupOwner([{ owner: 'speaker' }, { owner: 'mentioned' }]).owner).toBe('unclear');
  });

  test('candidates with no owner field at all yield null, not a guess', () => {
    expect(ReduceGroupOwner([{}, {}])).toEqual({ owner: null, ownerMentions: [] });
    expect(ReduceGroupOwner([])).toEqual({ owner: null, ownerMentions: [] });
  });

  test('owner_mentions are unioned across candidates and de-duplicated', () => {
    expect(ReduceGroupOwner([
      { owner: 'mentioned', owner_mentions: ['U_A'] },
      { owner: 'mentioned', owner_mentions: ['U_A', 'U_B'] },
    ]).ownerMentions).toEqual(['U_A', 'U_B']);
  });
});

describe('ResolveAssignees with the analyzer verdict', () => {
  test('a STRONG grammatical signal beats the analyzer — Phase 1A is not overridable', () => {
    // the analyzer is wrong here; the explicit first-person commitment is not.
    const Result = ResolveAssignees({
      MessageText: "<@U_ALPHA> I'll patch it tomorrow",
      ActionableLanguage: "I'll patch it",
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      AnalyzerOwnerMentions: ['U_ALPHA'],
    });
    expect(Result.assigneeIDs).toEqual(['U_SENDER']);
    expect(Result.resolvedBy).toBe('first-person-commitment');
  });

  test('GH-22 GUARD: the analyzer cannot take a shared ask away from the people asked', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> <@U_BETA> can you both test the release tomorrow?',
      ActionableLanguage: 'can you both test the release',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'speaker',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA', 'U_BETA']);
    expect(Result.resolvedBy).toBe('second-person-ask');
  });

  test('owner=speaker resolves an AMBIGUOUS message Phase 1A could not reach', () => {
    // no first- or second-person marker anywhere: Phase 1A alone would assign to the address block.
    const Input = {
      MessageText: '<@U_ALPHA> <@U_BETA> the connection-pool patch goes out tomorrow morning',
      ActionableLanguage: 'the connection-pool patch goes out',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
    };
    expect(ResolveAssignees(Input).assigneeIDs).toEqual(['U_ALPHA', 'U_BETA']);

    const WithVerdict = ResolveAssignees({ ...Input, AnalyzerOwner: 'speaker' });
    expect(WithVerdict.assigneeIDs).toEqual(['U_SENDER']);
    expect(WithVerdict.resolvedBy).toBe('analyzer-speaker');
    expect(WithVerdict.notifyIDs).toEqual(['U_ALPHA', 'U_BETA']);
  });

  test('THE INTERSECTION IS LOAD BEARING: owner_mentions can narrow but never extend', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> <@U_BETA> the cert rotation is tomorrow morning',
      ActionableLanguage: 'the cert rotation',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      // U_GHOST was never in the message. U_BETA was, but is not being asked.
      AnalyzerOwnerMentions: ['U_GHOST', 'U_ALPHA'],
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
    expect(Result.assigneeIDs).not.toContain('U_GHOST');
    expect(Result.resolvedBy).toBe('analyzer-mentioned');
    // the mentioned user who was NOT asked becomes an interested party rather than vanishing
    expect(Result.notifyIDs).toEqual(['U_BETA']);
  });

  test('an entirely invented owner_mentions set falls through rather than assigning nobody', () => {
    // a dropped reminder is worse than a slightly wrong assignee.
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> the cert rotation is tomorrow morning',
      ActionableLanguage: 'the cert rotation',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      AnalyzerOwnerMentions: ['U_GHOST'],
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
    expect(Result.resolvedBy).toBe('mentions');
  });

  test('owner=unclear and a missing verdict both leave Phase 1A behavior byte-identical', () => {
    const Base = {
      MessageText: '<@U_ALPHA> the deploy is tomorrow morning',
      ActionableLanguage: 'the deploy is tomorrow morning',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    };
    const Without = ResolveAssignees(Base);
    expect(ResolveAssignees({ ...Base, AnalyzerOwner: 'unclear' })).toEqual(Without);
    expect(ResolveAssignees({ ...Base, AnalyzerOwner: null })).toEqual(Without);
    expect(Without.resolvedBy).toBe('mentions');
  });

  test('owner=speaker with no known sender does not produce an empty assignee set', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> the deploy is tomorrow',
      ActionableLanguage: 'the deploy is tomorrow',
      MentionedIDs: ['U_ALPHA'],
      SenderID: '',
      AnalyzerOwner: 'speaker',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
  });
});

// Codex branch relay r1 [Should]: the `:wrench:` triage claimed to run "the REAL resolver" so it
// could not drift from scheduling — but it called ResolveAssignees WITHOUT the analyzer's
// owner/owner_mentions that the scheduling path passes. For an ambiguous addressed message the two
// therefore disagreed: scheduling resolved `analyzer-speaker`, triage reported `mentions`. A triage
// that confidently explains a rule the reminder did not follow is worse than no triage.
//
// This pins the CONTRACT rather than the call site: both paths must feed the resolver the same
// inputs derived the same way, so both must produce the same verdict for the same message.
describe('GH-43: the triage and scheduling ownership inputs cannot diverge', () => {
  const AmbiguousCandidates = [{
    actionable_language: 'the connection-pool patch goes out',
    scheduling_trigger: 'tomorrow morning',
    reminder_message: 'Ship the connection-pool patch',
    owner: 'speaker',
    owner_mentions: [],
  }];
  const MessageText = '<@U_ALPHA> <@U_BETA> the connection-pool patch goes out tomorrow morning';

  /**
   * Derive resolver inputs exactly as a call site should, from a candidate list.
   * @param {any[]} ArgCandidates
   * @returns {any}
   */
  function ResolveFromCandidates(ArgCandidates) {
    const GroupOwner = ReduceGroupOwner(ArgCandidates);
    return ResolveAssignees({
      MessageText,
      ActionableLanguage: ArgCandidates.map(ArgC => ArgC.actionable_language || '').join(' ').trim(),
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: GroupOwner.owner,
      AnalyzerOwnerMentions: GroupOwner.ownerMentions,
    });
  }

  test('the analyzer verdict changes the answer — so omitting it is a real divergence, not a nit', () => {
    const WithVerdict = ResolveFromCandidates(AmbiguousCandidates);
    expect(WithVerdict).toMatchObject({
      assigneeIDs: ['U_SENDER'], resolvedBy: 'analyzer-speaker',
    });

    // what the triage path used to compute: the same message, resolver called without the verdict
    const WithoutVerdict = ResolveAssignees({
      MessageText,
      ActionableLanguage: 'the connection-pool patch goes out',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
    });
    expect(WithoutVerdict).toMatchObject({
      assigneeIDs: ['U_ALPHA', 'U_BETA'], resolvedBy: 'mentions',
    });

    // the two disagree about WHO OWNS THE WORK, which is the whole point of the section
    expect(WithVerdict.assigneeIDs).not.toEqual(WithoutVerdict.assigneeIDs);
  });

  test('owner=mentioned narrowing and its notify set are also lost without the verdict', () => {
    const Narrowed = ResolveFromCandidates([{
      ...AmbiguousCandidates[0], owner: 'mentioned', owner_mentions: ['U_ALPHA'],
    }]);
    expect(Narrowed).toMatchObject({
      assigneeIDs: ['U_ALPHA'], notifyIDs: ['U_BETA'], resolvedBy: 'analyzer-mentioned',
    });
  });
});

// Codex branch relay r2 [Blocker]: HasFirstPersonCommitment was not a commitment parser. It matched
// ANY first-person token, so a possessive or a piece of reported speech produced the strong
// sender override — the module claimed to read the grammatical subject while doing nothing of the
// kind. Both witnesses below assigned the work to the wrong person before this fix.
describe('GH-43: first person must mean the speaker is ACTING', () => {
  test('THE WITNESS: reported speech belongs to the person quoted, not the reporter', () => {
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> said "I will deploy the patch tomorrow"',
      ActionableLanguage: 'I will deploy the patch',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
    expect(Result.resolvedBy).not.toBe('first-person-commitment');
  });

  test('THE WITNESS: a possessive is not a commitment', () => {
    // "my report" says the speaker OWNS the report, not that they are deploying it.
    const Result = ResolveAssignees({
      MessageText: '<@U_ALPHA> will deploy my report tomorrow',
      ActionableLanguage: 'will deploy my report',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
  });

  test.each(['my', 'me', 'myself'])('"%s" alone no longer reads as a commitment', (ArgToken) => {
    expect(HasFirstPersonCommitment(`will deploy ${ArgToken} thing`)).toBe(false);
  });

  test('genuine subject-form commitments still resolve to the sender', () => {
    // the reported production message must not become collateral damage
    expect(ResolveAssignees({
      MessageText: '<@U_ALPHA> <@U_BETA> root cause: the scan only saw a fixed batch. i am going to deploy the changes tomorrow',
      ActionableLanguage: 'i am going to deploy the changes',
      MentionedIDs: ['U_ALPHA', 'U_BETA'],
      SenderID: 'U_SENDER',
    })).toMatchObject({ assigneeIDs: ['U_SENDER'], resolvedBy: 'first-person-commitment' });
  });

  test('the QUOTED TASK NAME rule is not mistaken for reported speech', () => {
    // here the span CONTAINS a short quotation rather than sitting inside one — it is the author's
    // own commitment and must keep resolving to them (battery S-11).
    expect(ResolveAssignees({
      MessageText: 'I need to work on "On-going Project: Yard Photo Backfill" tomorrow',
      ActionableLanguage: 'I need to work on "On-going Project: Yard Photo Backfill"',
      MentionedIDs: [],
      SenderID: 'U_SENDER',
    })).toMatchObject({ assigneeIDs: ['U_SENDER'], resolvedBy: 'first-person-commitment' });
  });

  test('single quotes are NOT treated as quotation — they are apostrophes', () => {
    // "I'll" and "don't" would otherwise read as reported speech
    expect(IsSpanInsideQuotedSpeech("I'll patch it and don't worry", "I'll patch it")).toBe(false);
  });
});

// Codex branch relay r3 [Blocker]: a bare "I" anywhere in the span was still taken as proof the
// sender owns the task, and that verdict outranked a correct analyzer. "I asked <@alpha> to deploy"
// is first-person about a DELEGATION — Alpha is the subject of the obligation.
describe('GH-43: reporting a delegation is not committing to it', () => {
  test('THE WITNESS: "I asked <@alpha> to deploy" belongs to Alpha, not the sender', () => {
    const Result = ResolveAssignees({
      MessageText: 'I asked <@U_ALPHA> to deploy tomorrow',
      ActionableLanguage: 'I asked <@U_ALPHA> to deploy tomorrow',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      AnalyzerOwnerMentions: ['U_ALPHA'],
    });
    expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
    expect(Result.resolvedBy).toBe('analyzer-mentioned');
  });

  test.each(['asked', 'told', 'pinged', 'requested', 'assigned', 'delegated'])(
    '"I %s <@alpha> to ..." is not a commitment', (ArgVerb) => {
      expect(HasFirstPersonCommitment(`I ${ArgVerb} <@U_ALPHA> to deploy it`)).toBe(false);
    });

  test('"have"/"had" are NOT delegation — they are the most common way to state a commitment', () => {
    // an over-broad delegation pattern would reassign real work, which is worse than missing a
    // delegation (that only degrades to the analyzer verdict).
    expect(HasFirstPersonCommitment('I have to deploy it')).toBe(true);
    expect(HasFirstPersonCommitment('I had to restart it')).toBe(true);
  });

  test('the production message is unaffected', () => {
    expect(HasFirstPersonCommitment('i am going to deploy the changes')).toBe(true);
    expect(HasFirstPersonCommitment('I will merge and deploy it')).toBe(true);
  });
});

// Codex branch relay r4 [Blocker]: the any-`I` precedence bug survived r3, because r3 only added
// another exclusion to a DENYLIST. Each round produced a new phrase to exclude — `my report`, quoted
// speech, `I asked … to`, then `I need <@alpha> to`, then `I won't` — while the underlying test
// stayed "does a first-person token appear anywhere", which is not a subject test at all.
//
// Replaced with a POSITIVE allowlist of commitment constructions. A denylist of ways to be wrong can
// never be finished; an allowlist of ways to be right can.
describe('GH-43: first-person commitment is an allowlist, not a denylist', () => {
  test.each([
    ['an object intervenes', 'I need <@U_ALPHA> to deploy tomorrow'],
    ['reported delegation', 'I asked <@U_ALPHA> to deploy it'],
    ['negated', 'I won’t deploy; <@U_ALPHA> will deploy tomorrow'],
    ['negated, spelled out', 'I will not deploy it'],
    ['possessive only', 'will deploy my report'],
  ])('%s is NOT a commitment', (ArgName, ArgSpan) => {
    expect(HasFirstPersonCommitment(ArgSpan)).toBe(false);
  });

  test.each([
    'i am going to deploy the changes',
    "I'll patch it",
    'I will merge and deploy it',
    'I need to work on the backfill',
    'I have to deploy it',
    'I had to restart it',
    'im going to deploy the changes',
    "I'll roll it out",
  ])('%s IS a commitment', (ArgSpan) => {
    expect(HasFirstPersonCommitment(ArgSpan)).toBe(true);
  });

  test('THE WITNESS: "I need <@alpha> to deploy" defers to the analyzer', () => {
    expect(ResolveAssignees({
      MessageText: 'I need <@U_ALPHA> to deploy tomorrow',
      ActionableLanguage: 'I need <@U_ALPHA> to deploy tomorrow',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      AnalyzerOwnerMentions: ['U_ALPHA'],
    })).toMatchObject({ assigneeIDs: ['U_ALPHA'], resolvedBy: 'analyzer-mentioned' });
  });

  test('THE WITNESS: a negated first person does not claim the work', () => {
    expect(ResolveAssignees({
      MessageText: 'I won’t deploy; <@U_ALPHA> will deploy tomorrow',
      ActionableLanguage: 'I won’t deploy; <@U_ALPHA> will deploy tomorrow',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      AnalyzerOwnerMentions: ['U_ALPHA'],
    })).toMatchObject({ assigneeIDs: ['U_ALPHA'] });
  });

  test('every alternative is word-anchored — "will" must not match via its "ill"', () => {
    // caught by this module's own table before shipping
    expect(HasFirstPersonCommitment('<@U_ALPHA> will deploy the patch')).toBe(false);
  });
});

// Codex branch relay r5: the per-modal negative lookaheads only rejected an IMMEDIATELY following
// negative, so an intervening adverb walked straight past them — and the work was assigned to
// somebody who had just said they would not do it.
describe('GH-43: layered negation is still negation', () => {
  test.each([
    'I will definitely not deploy; <@U_ALPHA> will deploy tomorrow',
    'I can no longer deploy; <@U_ALPHA> will deploy tomorrow',
    'I will probably never get to it; <@U_ALPHA> will deploy tomorrow',
    "I won't deploy it",
    'I will not deploy it',
  ])('%s is NOT a commitment', (ArgSpan) => {
    expect(HasFirstPersonCommitment(ArgSpan)).toBe(false);
  });

  test('THE WITNESS: a negated first person defers to the analyzer', () => {
    expect(ResolveAssignees({
      MessageText: 'I will definitely not deploy; <@U_ALPHA> will deploy tomorrow',
      ActionableLanguage: 'I will definitely not deploy; <@U_ALPHA> will deploy tomorrow',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'mentioned',
      AnalyzerOwnerMentions: ['U_ALPHA'],
    })).toMatchObject({ assigneeIDs: ['U_ALPHA'], resolvedBy: 'analyzer-mentioned' });
  });

  test('genuine commitments are unaffected', () => {
    expect(HasFirstPersonCommitment('i am going to deploy the changes')).toBe(true);
    expect(HasFirstPersonCommitment('I have to deploy it')).toBe(true);
  });
});
