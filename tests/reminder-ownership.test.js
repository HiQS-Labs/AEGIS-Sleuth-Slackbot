'use strict';

const {
  ResolveAssignees, DetectLeadingAddressBlock, HasFirstPersonCommitment, HasSecondPersonAsk,
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
