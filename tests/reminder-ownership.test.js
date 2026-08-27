'use strict';

const {
  ResolveAssignees, DetectLeadingAddressBlock, HasFirstPersonCommitment, HasSecondPersonAsk,
  ConstrainAssigneeToParticipants, ReduceGroupOwner, IsSpanInsideQuotedSpeech,
  StripQuotedRegions, FindOwnerDisagreement,
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

  // GH-143 — THE SCREENSHOT DEFECT: on the enriched thread path the analyzer's span quoted the ask
  // out of the PREPENDED context message ("Could you please file a new GH issue?"), written by the
  // asker, whose "you" meant the replier. Rule 2 then assigned the work back to the asker via the
  // reply's mention of them. The reply's own first-person grammar must outrank a span the sender
  // did not write.
  describe('LiveReplyText (GH-143 enriched thread replies)', () => {
    test('THE SCREENSHOT DEFECT: a committing reply beats a second-person ask quoted from context', () => {
      const Result = ResolveAssignees({
        MessageText: "<@U_NOEL> can do I'll work on it today",
        // the analyzer, reading context+reply as one blob, quoted the CONTEXT author's ask:
        ActionableLanguage: 'Could you please file a new GH issue?',
        MentionedIDs: ['U_NOEL'],
        SenderID: 'U_SAMUEL',
        LiveReplyText: "<@U_NOEL> can do I'll work on it today",
      });
      expect(Result.assigneeIDs).toEqual(['U_SAMUEL']);
      expect(Result.resolvedBy).toBe('live-reply-commitment');
      // the asker was told, not assigned
      expect(Result.notifyIDs).toEqual(['U_NOEL']);
    });

    test('a non-committing live reply still lets the second-person ask resolve to mentions', () => {
      const Result = ResolveAssignees({
        MessageText: '<@U_NOEL> sounds good, makes sense to me',
        ActionableLanguage: 'Could you please file a new GH issue?',
        MentionedIDs: ['U_NOEL'],
        SenderID: 'U_SAMUEL',
        LiveReplyText: '<@U_NOEL> sounds good, makes sense to me',
      });
      expect(Result.resolvedBy).toBe('second-person-ask');
      expect(Result.assigneeIDs).toEqual(['U_NOEL']);
    });

    test('a declining live reply does not take the work (negation guard applies)', () => {
      const Result = ResolveAssignees({
        MessageText: "<@U_NOEL> I can't work on it this week",
        ActionableLanguage: 'Could you please file a new GH issue?',
        MentionedIDs: ['U_NOEL'],
        SenderID: 'U_SAMUEL',
        LiveReplyText: "<@U_NOEL> I can't work on it this week",
      });
      expect(Result.resolvedBy).not.toBe('live-reply-commitment');
    });

    test('rule 1 still wins when the analyzer span is the sender\'s own commitment', () => {
      const Result = ResolveAssignees({
        MessageText: "I'll handle it tomorrow morning.",
        ActionableLanguage: "I'll handle it",
        MentionedIDs: [],
        SenderID: 'U_SENDER',
        LiveReplyText: "I'll handle it tomorrow morning.",
      });
      expect(Result.resolvedBy).toBe('first-person-commitment');
      expect(Result.assigneeIDs).toEqual(['U_SENDER']);
    });

    // Cross-model review (Codex, 2026-08-27) found the inverse of the original defect: a reply
    // that RELAYS someone else's commitment was taken as the replier's own. StripQuotedRegions
    // only knows double quotes, and Slack's `>` blockquote is how people actually quote.
    test.each([
      ['a Slack blockquote', '> <@U_ALPHA>: I will deploy it tomorrow'],
      ['an HTML-escaped blockquote', '&gt; I will deploy it tomorrow'],
      ['a mention attribution', '<@U_ALPHA> said I will deploy it tomorrow'],
      ['a name attribution', 'Alpha mentioned I will deploy it tomorrow'],
      ['a pronoun attribution', 'they told me I will deploy it tomorrow'],
    ])('does not take ownership from %s — that is somebody else committing', (_Label, ArgLive) => {
      const Result = ResolveAssignees({
        MessageText: ArgLive,
        ActionableLanguage: 'Could you please deploy the hotfix tomorrow?',
        MentionedIDs: ['U_ALPHA'],
        SenderID: 'U_SAMUEL',
        LiveReplyText: ArgLive,
      });
      expect(Result.resolvedBy).not.toBe('live-reply-commitment');
      expect(Result.assigneeIDs).not.toEqual(['U_SAMUEL']);
    });

    test('quoting someone and then committing yourself still assigns to you', () => {
      const Live = '> <@U_ALPHA>: should we deploy?\nyes I will deploy it tomorrow';
      const Result = ResolveAssignees({
        MessageText: Live,
        ActionableLanguage: 'Could you please deploy the hotfix tomorrow?',
        MentionedIDs: ['U_ALPHA'],
        SenderID: 'U_SAMUEL',
        LiveReplyText: Live,
      });
      expect(Result.resolvedBy).toBe('live-reply-commitment');
      expect(Result.assigneeIDs).toEqual(['U_SAMUEL']);
    });

    test('"I said I will…" is the speaker quoting THEMSELVES and still counts', () => {
      const Live = 'I said I will deploy it tomorrow';
      const Result = ResolveAssignees({
        MessageText: Live,
        ActionableLanguage: 'Could you please deploy the hotfix tomorrow?',
        MentionedIDs: ['U_ALPHA'],
        SenderID: 'U_SAMUEL',
        LiveReplyText: Live,
      });
      expect(Result.resolvedBy).toBe('live-reply-commitment');
    });

    test('absent LiveReplyText (direct, un-enriched messages) changes nothing', () => {
      const Result = ResolveAssignees({
        MessageText: '<@U_ALPHA> can you test the release?',
        ActionableLanguage: 'can you test the release',
        MentionedIDs: ['U_ALPHA'],
        SenderID: 'U_SENDER',
      });
      expect(Result.resolvedBy).toBe('second-person-ask');
      expect(Result.assigneeIDs).toEqual(['U_ALPHA']);
    });
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

// Codex branch relay r6: IsSpanInsideQuotedSpeech required the quotation to contain the ENTIRE
// actionable span, so when the analyzer's byte-exact span included the reporting prefix — span and
// message both `<@U_ALPHA> said "I will deploy the patch tomorrow"` — the span CONTAINED the
// quotation rather than sitting inside it, and containment could never see it.
//
// Quoted regions are now removed before the commitment test, which handles both shapes and keeps the
// quoted-task-name rule working for the right reason: there the commitment is OUTSIDE the quotes.
describe('GH-43: reported speech, whichever way the span was cut', () => {
  const Message = '<@U_ALPHA> said "I will deploy the patch tomorrow"';

  test.each([
    ['the inner quotation only', 'I will deploy the patch'],
    ['the whole reporting sentence', '<@U_ALPHA> said "I will deploy the patch tomorrow"'],
  ])('span = %s resolves to Alpha, not the reporter', (ArgName, ArgSpan) => {
    expect(ResolveAssignees({
      MessageText: Message,
      ActionableLanguage: ArgSpan,
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    }).assigneeIDs).toEqual(['U_ALPHA']);
  });

  test('a commitment OUTSIDE the quotes is still the author’s', () => {
    // the quoted-task-name rule (battery S-11)
    expect(HasFirstPersonCommitment('I need to work on "On-going Project: Yard Photo Backfill"'))
      .toBe(true);
    // and a commitment with an unrelated quotation alongside it
    expect(HasFirstPersonCommitment('I will deploy the fix <@U_ALPHA> called "the big one"')).toBe(true);
  });
});

// Codex branch relay r7: round 6 stripped quoted regions before the FIRST-person test but not the
// second-person one, so a `please` inside a quoted task NAME still read as a request. Stripping for
// one test and not the other is worse than not stripping at all — the two now share one helper.
describe('GH-43: quoted text decides nothing, in either direction', () => {
  test('THE WITNESS: a "Please …" task NAME does not hand the work to a mentioned user', () => {
    expect(ResolveAssignees({
      MessageText: '<@U_ALPHA> FYI: I will deploy the feature called "Please Retry" tomorrow',
      ActionableLanguage: 'I will deploy the feature called "Please Retry"',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
      AnalyzerOwner: 'speaker',
    })).toMatchObject({ assigneeIDs: ['U_SENDER'], resolvedBy: 'first-person-commitment' });
  });

  test('a GENUINE please ask is untouched', () => {
    expect(ResolveAssignees({
      MessageText: '<@U_ALPHA> please review this tomorrow',
      ActionableLanguage: 'please review this',
      MentionedIDs: ['U_ALPHA'],
      SenderID: 'U_SENDER',
    })).toMatchObject({ assigneeIDs: ['U_ALPHA'], resolvedBy: 'second-person-ask' });
  });

  test('both person tests strip the same way — asserted through the shared helper', () => {
    expect(StripQuotedRegions('I will ship "Please Retry"').includes('Please')).toBe(false);
    expect(HasSecondPersonAsk('I will ship the "Please Retry" feature')).toBe(false);
    expect(HasSecondPersonAsk('please ship it')).toBe(true);
  });
});

describe('GH-43: FindOwnerDisagreement is shared by scheduling and triage', () => {
  test('reports the distinct decided owners within a trigger, and nothing when they agree', () => {
    expect(FindOwnerDisagreement([
      { owner: 'speaker', scheduling_trigger: 'tomorrow' },
      { owner: 'mentioned', scheduling_trigger: 'tomorrow' },
    ])).toEqual(['speaker', 'mentioned']);
    expect(FindOwnerDisagreement([{ owner: 'speaker' }, { owner: 'speaker' }])).toEqual([]);
    // `unclear` is not a decided owner, so it never manufactures a disagreement
    expect(FindOwnerDisagreement([{ owner: 'speaker' }, { owner: 'unclear' }])).toEqual([]);
    expect(FindOwnerDisagreement([{ owner: 'speaker' }])).toEqual([]);
    expect(FindOwnerDisagreement([])).toEqual([]);
  });

  // Codex r8: grouping used to be the CALLER's job, so triage — which holds the whole ungrouped
  // candidate list — reported a limitation that does not exist. Production schedules two different
  // triggers as two separate reminders, each with its own owner. A diagnostic that invents a
  // limitation is as bad as one that hides a real one, so the grouping rule lives in the helper.
  test('THE WITNESS: candidates under DIFFERENT triggers do not disagree', () => {
    expect(FindOwnerDisagreement([
      { owner: 'speaker', scheduling_trigger: 'tomorrow' },
      { owner: 'mentioned', scheduling_trigger: 'friday' },
    ])).toEqual([]);
  });

  test('a disagreement inside ONE trigger is still found among several triggers', () => {
    expect(FindOwnerDisagreement([
      { owner: 'speaker', scheduling_trigger: 'friday' },
      { owner: 'speaker', scheduling_trigger: 'tomorrow' },
      { owner: 'mentioned', scheduling_trigger: 'tomorrow' },
    ])).toEqual(['speaker', 'mentioned']);
  });

  test('the scheduling caller passes one already-grouped trigger, and grouping is a no-op there', () => {
    const OneGroup = [
      { owner: 'speaker', scheduling_trigger: 'tomorrow morning' },
      { owner: 'mentioned', scheduling_trigger: 'tomorrow morning' },
    ];
    expect(FindOwnerDisagreement(OneGroup)).toEqual(['speaker', 'mentioned']);
  });
});
