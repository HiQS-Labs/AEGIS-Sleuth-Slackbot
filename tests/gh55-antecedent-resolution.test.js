'use strict';

const RemindersAppMentionHandler = require('../src/reminders-app-mention-handler');
const { IsObjectPositionPronounReference, CHANNEL_ANTECEDENT_MAX_AGE_SECONDS } = RemindersAppMentionHandler;
const { MockSlackApp } = require('./mocks/mock-slack-app');

/**
 * GH-55 — resolve the antecedent before scheduling.
 *
 * The reported production failure: two TOP-LEVEL channel posts 47 minutes apart. The first named the
 * task and its owner (`@Vishal`); the second said only "Can we try to get it done by end of day on
 * Monday?" and was scheduled verbatim, losing both. Two independent blockers, each fatal alone:
 * enrichment required a thread, and no pattern matched `get <pronoun> done`.
 *
 * The corpus below is the improvement instrument. The GH-44 decision-replay battery CANNOT serve that
 * role — it exercises single-message routing with no thread context, so it never reaches the
 * enrichment path at all. It is a regression guard here, nothing more.
 */

const CHANNEL = 'C_GENERAL';
const AUTHOR = 'U_NOEL';
const OTHER = 'U_VISHAL';

/** Seconds -> Slack ts string. */
function Ts(ArgSeconds) { return `${ArgSeconds}.000000`; }

const NOW = 1755201720; // the follow-up
const TASK_TS = NOW - 47 * 60; // 47 minutes earlier, matching the production case exactly

function MakeHandler(ArgSlackApp, ArgTrySchedule) {
  return new RemindersAppMentionHandler({
    SlackApp: ArgSlackApp,
    GetPendingReminders: () => [],
    GetGitHubSyncModule: () => null,
    GetListsModule: () => null,
    GetCompletedRecords: () => [],
    GetChannelSettings: () => ({
      EnableRemindersForChannelAsync: jest.fn(),
      DisableRemindersForChannelAsync: jest.fn(),
    }),
    GetClientMappings: () => [],
    TryScheduleRemindersAsync: ArgTrySchedule,
    CheckRemindersAsync: jest.fn().mockResolvedValue(),
  });
}

describe('GH-55 object-position pronoun rule', () => {
  // Blocker 2: these are the phrasings the three existing patterns all miss. The pronoun sits
  // BETWEEN verb and participle — a shape no entry in the enumerated verb list has.
  test.each([
    ['the reported production message', 'Can we try to get it done by end of day on Monday?'],
    ['second person', 'can you get it done by friday'],
    ['demonstrative this', 'lets get this done tomorrow'],
    ['demonstrative that', 'please get that done today'],
  ])('fires on %s', (_Label, ArgText) => {
    expect(IsObjectPositionPronounReference(ArgText)).toBe(true);
  });

  // The naive "pronoun + scheduling trigger" rule fires on ALL of these. Each was reproduced as a
  // false positive before the object-position rule replaced it. This corpus is a fixture, not a
  // comment: extend it whenever production shows a new one.
  test.each([
    ['subject pronoun, weather', 'it will rain on friday'],
    ['subject demonstrative', 'that is a problem for next week'],
    ['subject pronoun, copula', 'it will be sunny tomorrow'],
    // AUXILIARY-ONLY cases — the mirror of the boundary-only block below. The pronoun is NOT
    // clause-initial (it follows a matrix verb), so the boundary test cannot see it; only the
    // auxiliary that follows reveals it as a subject. Kept plural for the same reason the
    // boundary block is: one example is not a corpus.
    ['subject pronoun after a matrix verb', 'I think it will rain on friday'],
    ['subject pronoun after a reporting verb', 'he said it would slip to monday'],
    ['subject demonstrative after a matrix verb', 'we know that is blocked until friday'],
    ['subject pronoun after a coordinator', 'this is due tomorrow and it is fine'],
    ['subject pronoun after sentence end', 'The deploy is done. It looks fine for monday.'],
    ['past-tense subject', 'that was broken yesterday'],
    // ---------------------------------------------------------------------------------------
    // CLAUSE-BOUNDARY-ONLY cases. Added after mutation testing: disabling the boundary check left
    // the FIRST nine noise cases all still passing, because every one of them happens to use an
    // AUXILIARY ("will", "is", "was", "looks") and so is caught twice over. The corpus could not
    // fail on the half of the rule it was supposed to pin.
    //
    // A clause-initial pronoun followed by a SIMPLE MAIN VERB has no auxiliary to catch it, so
    // these are rejected by the boundary test alone — and "It broke again yesterday" is ordinary
    // Slack, not a contrived string. Do not delete these without re-running the M3 mutation.
    ['subject + simple present', 'It rains on friday'],
    ['subject + simple past', 'That broke yesterday'],
    ['demonstrative subject + simple present', 'This ships monday'],
    ['subject + main verb with a preposition', 'It depends on the deploy tomorrow'],
    ['demonstrative subject + main verb', 'That matters for next week'],
    ['subject + main verb + object', 'It needs review by friday'],
    // The temporal guard the existing pattern already applies — "discuss this week" schedules,
    // it does not refer.
    ['temporal demonstrative', "let's discuss this week"],
    ['temporal demonstrative, weekday', 'ship that morning'],
  ])('stays quiet on %s', (_Label, ArgText) => {
    expect(IsObjectPositionPronounReference(ArgText)).toBe(false);
  });

  // "it" is never temporal, so the demonstrative guard must not be applied to it — otherwise
  // "send it monday" (a real reference, matched today by VAGUE_REFERENCE_IN_THREAD_PATTERN) would
  // be silently dropped by the new rule.
  test('"send it monday" stays a reference — the temporal guard applies only to demonstratives', () => {
    expect(IsObjectPositionPronounReference('send it monday')).toBe(true);
  });

  test('a message with no pronoun at all never fires', () => {
    expect(IsObjectPositionPronounReference('deploy the release on friday')).toBe(false);
    expect(IsObjectPositionPronounReference('')).toBe(false);
  });
});

describe('GH-55 channel antecedent lookback', () => {
  let TrySchedule;
  let SlackApp;
  let Handler;

  /** The production failure, reconstructed: task + follow-up as top-level channel posts. */
  function MakeChannelFixture(ArgTimeline) {
    SlackApp = new MockSlackApp({
      AdminUsers: ['U_ADMIN'],
      ChannelCreatorsById: { [CHANNEL]: 'U_CREATOR' },
      // conversations.history is newest-first; the fixture must match or the test passes against
      // an ordering production never produces.
      RecentChannelMessagesById: { [CHANNEL]: ArgTimeline },
    });
    Handler = MakeHandler(SlackApp, TrySchedule);
  }

  const FOLLOW_UP = {
    channel: CHANNEL,
    user: AUTHOR,
    ts: Ts(NOW),
    text: 'Can we try to get it done by end of day on Monday?',
  };

  const TASK_MESSAGE = {
    user: AUTHOR,
    text: '<@U_VISHAL> please make new faster Subscription customer email search GH issue on KISS Woo Fast Search, assign yourself, and work on it.',
    ts: Ts(TASK_TS),
    bot_id: undefined,
  };

  beforeEach(() => {
    TrySchedule = jest.fn().mockResolvedValue(true);
    delete process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED;
  });

  afterEach(() => {
    delete process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED;
  });

  // THE KILL SWITCH. Unset must mean byte-identical call volume to before GH-55: no
  // conversations.history read, no OpenAI call. This is the item that makes the change safe to
  // merge before it is safe to arm.
  test('is inert with the flag unset — no history read and no schedule attempt', async () => {
    MakeChannelFixture([TASK_MESSAGE]);
    const HistorySpy = jest.spyOn(SlackApp, 'GetRecentChannelMessagesAsync');

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP);

    expect(WasHandled).toBe(false);
    expect(HistorySpy).not.toHaveBeenCalled();
    expect(TrySchedule).not.toHaveBeenCalled();
  });

  test.each([['1'], ['true'], ['yes'], ['on'], ['TRUE']])('arms on %s', (ArgValue) => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = ArgValue;
    expect(RemindersAppMentionHandler.IsChannelAntecedentLookbackEnabled()).toBe(true);
  });

  test.each([[''], ['  '], ['0'], ['false'], ['off'], ['maybe']])('stays off on %j', (ArgValue) => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = ArgValue;
    expect(RemindersAppMentionHandler.IsChannelAntecedentLookbackEnabled()).toBe(false);
  });

  // THE REPORTED CASE. Both blockers cleared: the pattern now matches "get it done", and the
  // thread gate no longer blocks a top-level post.
  test('resolves the reported production case — real task text AND the real owner reach the analyzer', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([TASK_MESSAGE]);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP);

    expect(WasHandled).toBe(true);
    expect(TrySchedule).toHaveBeenCalledTimes(1);
    const EnrichedText = TrySchedule.mock.calls[0][1];
    expect(EnrichedText).toContain('faster Subscription customer email search');
    expect(EnrichedText).toContain('Can we try to get it done by end of day on Monday?');
    // Ownership is not free: it rides on the mentions fallback, which only sees @Vishal because
    // the enriched block carries him. This assertion is the ownership half of the bug.
    expect(EnrichedText).toContain('<@U_VISHAL>');
  });

  // PARTICIPANT CONTINUITY. Recency alone stitches unrelated conversations together in a busy
  // channel — a thread is an explicit human assertion that messages belong together, and a channel
  // offers no such signal.
  test('refuses an antecedent from another author that does not mention the follow-up author', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([{
      user: OTHER,
      text: 'unrelated: rolling the staging database tonight',
      ts: Ts(NOW - 120),
      bot_id: undefined,
    }]);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP);

    expect(WasHandled).toBe(false);
    expect(TrySchedule).not.toHaveBeenCalled();
  });

  test('accepts an antecedent from another author when it mentions the follow-up author', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([{
      user: OTHER,
      text: `<@${AUTHOR}> can you take the billing export migration`,
      ts: Ts(NOW - 300),
      bot_id: undefined,
    }]);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP);

    expect(WasHandled).toBe(true);
    expect(TrySchedule.mock.calls[0][1]).toContain('billing export migration');
  });

  // The interleaving case participant continuity exists for: a NEARER but unrelated message must
  // not win over the correct, older one.
  test('skips a nearer unrelated message and reaches the author\'s own earlier one', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([
      { user: OTHER, text: 'unrelated chatter about the office wifi', ts: Ts(NOW - 60), bot_id: undefined },
      TASK_MESSAGE,
    ]);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP);

    expect(WasHandled).toBe(true);
    const EnrichedText = TrySchedule.mock.calls[0][1];
    expect(EnrichedText).toContain('faster Subscription customer email search');
    expect(EnrichedText).not.toContain('office wifi');
  });

  test('ignores bot messages as antecedent candidates', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([{
      user: 'UBOT123', text: 'Sleuth: 3 reminders are due today', ts: Ts(NOW - 60), bot_id: 'B123',
    }]);

    expect(await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP)).toBe(false);
  });

  // The recency window must be wide enough for the case this issue was FILED for. A window under
  // an hour would have left the production failure unfixed while every test still passed.
  test('the recency window covers the reported 47-minute gap', () => {
    expect(CHANNEL_ANTECEDENT_MAX_AGE_SECONDS).toBeGreaterThan(47 * 60);
  });

  test('refuses an antecedent older than the recency window', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([{
      ...TASK_MESSAGE,
      ts: Ts(NOW - CHANNEL_ANTECEDENT_MAX_AGE_SECONDS - 60),
    }]);

    expect(await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP)).toBe(false);
  });

  // Preserves the 1.4.142 hallucination guard: without a time anchor the model must invent both the
  // trigger and the title.
  test('a pronoun with NO scheduling trigger does not fire an AI call', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([TASK_MESSAGE]);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
      ...FOLLOW_UP,
      text: 'can we get it done',
    });

    expect(WasHandled).toBe(false);
    expect(TrySchedule).not.toHaveBeenCalled();
  });

  test('still suppresses the hypothetical subordinate reply without an AI call', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([TASK_MESSAGE]);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
      ...FOLLOW_UP,
      text: "I'll keep that in mind when I get to it tomorrow",
    });

    expect(WasHandled).toBe(true);
    expect(TrySchedule).not.toHaveBeenCalled();
  });

  test('never reads a channel other than the one the follow-up was posted in', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    MakeChannelFixture([TASK_MESSAGE]);
    const HistorySpy = jest.spyOn(SlackApp, 'GetRecentChannelMessagesAsync');

    await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, FOLLOW_UP);

    expect(HistorySpy).toHaveBeenCalledTimes(1);
    expect(HistorySpy.mock.calls[0][0]).toBe(CHANNEL);
  });
});

describe('GH-55 ownership is not free — enrichment changes the ownership resolver input', () => {
  const ReminderOwnership = require('../src/reminder-ownership');

  // CHARACTERIZATION, not a claim that this is solved. The gate item exists because enrichment is
  // framed as "text only" while it demonstrably changes what the ownership resolver sees.
  test('a prepended block with TWO mentions assigns to BOTH — the known mentions-fallback behavior', () => {
    const Result = ReminderOwnership.ResolveAssignees({
      MessageText: '<@U_VISHAL> <@U_PRIYA> please look at the fast-search issue\nCan we try to get it done by end of day on Monday?',
      ActionableLanguage: 'get it done by end of day on Monday',
      MentionedIDs: ['U_VISHAL', 'U_PRIYA'],
      SenderID: AUTHOR,
      AnalyzerOwner: null,
      AnalyzerOwnerMentions: null,
    });

    // Two assignees from one antecedent. This is why the channel collector returns at most ONE
    // message rather than the thread path's three: each extra prepended message is another chance
    // to drag an unrelated <@U…> into the assignee set.
    expect(Result.assigneeIDs).toEqual(['U_VISHAL', 'U_PRIYA']);
  });

  test('the single-mention case — the reported one — resolves to exactly the real owner', () => {
    const Result = ReminderOwnership.ResolveAssignees({
      MessageText: '<@U_VISHAL> please make the fast-search GH issue and work on it\nCan we try to get it done by end of day on Monday?',
      ActionableLanguage: 'get it done by end of day on Monday',
      MentionedIDs: ['U_VISHAL'],
      SenderID: AUTHOR,
      AnalyzerOwner: null,
      AnalyzerOwnerMentions: null,
    });

    expect(Result.assigneeIDs).toEqual(['U_VISHAL']);
    // The bug being fixed: WITHOUT enrichment there are no mentions in scope at all, so the
    // resolver falls back to the sender — the wrong owner, exactly as production logged
    // (resolved_by=sender-fallback).
    const WithoutEnrichment = ReminderOwnership.ResolveAssignees({
      MessageText: 'Can we try to get it done by end of day on Monday?',
      ActionableLanguage: 'get it done by end of day on Monday',
      MentionedIDs: [],
      SenderID: AUTHOR,
      AnalyzerOwner: null,
      AnalyzerOwnerMentions: null,
    });
    expect(WithoutEnrichment.assigneeIDs).toEqual([AUTHOR]);
    expect(WithoutEnrichment.resolvedBy).toBe('sender-fallback');
  });

  // The bound that keeps the above from getting worse in the channel case.
  test('the channel collector returns at most ONE message, bounding mention exposure', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    const TrySchedule = jest.fn().mockResolvedValue(true);
    const SlackApp = new MockSlackApp({
      ChannelCreatorsById: { [CHANNEL]: 'U_CREATOR' },
      RecentChannelMessagesById: {
        [CHANNEL]: [
          { user: AUTHOR, text: '<@U_VISHAL> take the fast-search issue', ts: Ts(NOW - 300), bot_id: undefined },
          { user: AUTHOR, text: '<@U_PRIYA> take the billing export', ts: Ts(NOW - 600), bot_id: undefined },
        ],
      },
    });
    const Handler = MakeHandler(SlackApp, TrySchedule);

    await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
      channel: CHANNEL, user: AUTHOR, ts: Ts(NOW),
      text: 'Can we try to get it done by end of day on Monday?',
    });

    const EnrichedText = TrySchedule.mock.calls[0][1];
    expect(EnrichedText).toContain('<@U_VISHAL>');
    expect(EnrichedText).not.toContain('<@U_PRIYA>');
    delete process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED;
  });
});

describe('GH-55 antecedent provenance reaches the scheduler', () => {
  // The ledger half of the fix. Without this, a WRONG stitch is a silently wrong reminder; with it,
  // the source ts and the author's own pre-enrichment words are recoverable after the fact.
  test('passes SourceTs, Path and the original text through as the 10th argument', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = '1';
    const TrySchedule = jest.fn().mockResolvedValue(true);
    const SlackApp = new MockSlackApp({
      ChannelCreatorsById: { [CHANNEL]: 'U_CREATOR' },
      RecentChannelMessagesById: {
        [CHANNEL]: [{
          user: AUTHOR,
          text: '<@U_VISHAL> please build the fast-search issue',
          ts: Ts(TASK_TS),
          bot_id: undefined,
        }],
      },
    });
    const Handler = MakeHandler(SlackApp, TrySchedule);

    await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
      channel: CHANNEL,
      user: AUTHOR,
      ts: Ts(NOW),
      text: 'Can we try to get it done by end of day on Monday?',
    });

    const Call = TrySchedule.mock.calls[0];
    // 8th arg is the pre-enrichment live reply text — the "original as reference".
    expect(Call[7]).toBe('Can we try to get it done by end of day on Monday?');
    expect(Call[9]).toEqual({
      SourceTs: Ts(TASK_TS),
      // GH-143 (Codex review): the antecedent's AUTHOR rides along, so a caller that needs its
      // identity does not run a second private lookup — that lookup was its own context decision.
      SourceUser: 'U_NOEL',
      Path: 'object_position_pronoun_in_channel',
    });
    delete process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED;
  });

  test('an in-thread enrichment is labelled in_thread, not in_channel', async () => {
    const TrySchedule = jest.fn().mockResolvedValue(true);
    const SlackApp = new MockSlackApp({
      ChannelCreatorsById: { [CHANNEL]: 'U_CREATOR' },
      ThreadMessagesById: {
        [`${CHANNEL}:${Ts(TASK_TS)}`]: [
          { user: AUTHOR, text: 'How is the faucet replacement going?', ts: Ts(TASK_TS), bot_id: undefined },
          { user: OTHER, text: 'can you get it done by friday', ts: Ts(NOW), bot_id: undefined },
        ],
      },
    });
    const Handler = MakeHandler(SlackApp, TrySchedule);

    const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
      channel: CHANNEL,
      user: OTHER,
      ts: Ts(NOW),
      thread_ts: Ts(TASK_TS),
      text: 'can you get it done by friday',
    });

    expect(WasHandled).toBe(true);
    expect(TrySchedule.mock.calls[0][9].Path).toBe('object_position_pronoun_in_thread');
  });
});
