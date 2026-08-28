'use strict';

const RemindersAppMentionHandler = require('../src/reminders-app-mention-handler');
const DateUtils = require('../src/date-utils');
const { MockSlackApp } = require('./mocks/mock-slack-app');

// silence the [OFFSET CALC] console.log emitted by DateUtils.GetTimeZoneOffsetInMinutes
// (reached via GetCalendarWeekRange in the summarize-week path).
beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterAll(() => console.log.mockRestore());

const DefaultTimezone = 'America/Los_Angeles';

/**
 * Build a date offset from "today" in the workspace timezone.
 * @param {number} ArgDaysOffset Days to offset from today (negative for past).
 * @param {string} [ArgTimezone] Timezone name.
 * @returns {Date}
 */
function BuildRelativeDate(ArgDaysOffset, ArgTimezone = DefaultTimezone) {
  const Base = DateUtils.GetCurrentDateInTimeZone(ArgTimezone);
  const SafeBase = new Date(Base);
  SafeBase.setUTCHours(12, 0, 0, 0);
  SafeBase.setUTCDate(SafeBase.getUTCDate() + ArgDaysOffset);
  return SafeBase;
}

/**
 * Build a reminder fixture for app mention handler tests.
 * @param {Partial<any>} ArgOverrides Reminder overrides.
 * @returns {any}
 */
function MakeReminder(ArgOverrides = {}) {
  return {
    ReminderID: '11111111-1111-1111-1111-111111111111',
    CreatedOn: BuildRelativeDate(-6),
    ShouldPostOn: BuildRelativeDate(-5),
    TargetChannelID: 'C_REMINDERS',
    OriginalChannelID: 'C_GENERAL',
    OriginalMessageID: '1773990000.000001',
    OriginalSenderID: 'U_REQUESTER',
    ReminderMessageText: 'Review launch checklist',
    IgnoreSnooze: false,
    OriginalChannelName: 'general',
    AssigneeID: null,
    GitHubUrls: null,
    State: 'scheduled',
    ...ArgOverrides,
  };
}

describe('RemindersAppMentionHandler', () => {
  let SlackApp;
  let PendingReminders;
  let GitHubSyncModule;
  let ListsModule;
  let CompletedRecords;
  let ChannelSettings;
  let TryScheduleRemindersAsync;
  let CheckRemindersAsync;
  let ClientMappings;
  let Handler;

  beforeEach(() => {
    SlackApp = new MockSlackApp({
      AdminUsers: ['U_ADMIN'],
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
    });
    PendingReminders = [];
    GitHubSyncModule = null;
    ListsModule = null;
    CompletedRecords = [];
    ChannelSettings = {
      EnableRemindersForChannelAsync: jest.fn(),
      DisableRemindersForChannelAsync: jest.fn(),
    };
    TryScheduleRemindersAsync = jest.fn().mockResolvedValue(false);
    CheckRemindersAsync = jest.fn().mockResolvedValue();
    ClientMappings = [];

    Handler = new RemindersAppMentionHandler({
      GetPendingReminders: () => PendingReminders,
      GetRemindersTargetingUserID: (ArgUserID) => PendingReminders.filter(r => r.AssigneeID === ArgUserID),
      GetRemindersInvolvingUserID: (ArgUserID) => PendingReminders.filter(r =>
        r.OriginalSenderID === ArgUserID ||
        r.AssigneeID === ArgUserID ||
        r.ReminderMessageText.includes(`<@${ArgUserID}>`)
      ),
      GetGitHubSyncModule: () => GitHubSyncModule,
      GetListsModule: () => ListsModule,
      GetCompletedRemindersBetween: (ArgStartMs, ArgEndMs) =>
        CompletedRecords
          .filter(r => r.completedMs >= ArgStartMs && r.completedMs < ArgEndMs)
          .sort((a, b) => a.completedMs - b.completedMs),
      GetChannelSettings: () => ChannelSettings,
      TryScheduleRemindersAsync,
      CheckRemindersAsync,
      GetClientMappings: () => ClientMappings,
    });
  });

  test('registers deterministic reminder app-mention routes for validation', () => {
    const RegisteredRoutes = Handler.GetRegisteredCommandRoutes().map(ArgRoute => ArgRoute.Route);

    expect(RegisteredRoutes).toEqual(expect.arrayContaining([
      'create-reminder-from-task-above',
      'search-reminders',
      'search-projects',
      'search-reminders-for-user',
      'show-reminders',
      'show-reminders-for-user',
      'generate-user-list',
      'enable-reminders',
      'disable-reminders',
      'process-reminders-now',
      'sync-github',
      'test-github-sync',
      'test-random-reminder',
      'test-reminder-by-id',
    ]));
  });

  test('thread reminder command uses the task above and defaults to tomorrow at 8 AM when no time is specified', async () => {
    SlackApp = new MockSlackApp({
      AdminUsers: ['U_ADMIN'],
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
      ThreadMessagesById: {
        'C_GENERAL:1700000000.000001': [
          {
            user: 'U_SOURCE',
            text: 'Please review WP DB Toolkit issue 76 for the BigQuery sync plan.',
            ts: '1700000000.000001',
            bot_id: undefined,
            reactions: [],
          },
          {
            user: 'U_REQUESTER',
            text: `${'@Sleuth AI'} make a Sleuth reminder for <@U_TARGET> based on task above`,
            ts: '1700000000.000002',
            bot_id: undefined,
            reactions: [],
          },
        ],
      },
    });
    TryScheduleRemindersAsync.mockResolvedValue(true);

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000002',
      thread_ts: '1700000000.000001',
      text: `${SlackApp.AppMentionString} make a Sleuth reminder for <@U_TARGET> based on task above`,
    });

    expect(WasHandled).toBe(true);
    expect(TryScheduleRemindersAsync).toHaveBeenCalledTimes(1);
    expect(TryScheduleRemindersAsync).toHaveBeenCalledWith(
      SlackApp,
      expect.stringContaining('Please review WP DB Toolkit issue 76 for the BigQuery sync plan.'),
      'C_GENERAL',
      '1700000000.000001',
      'U_SOURCE',
      false,
      '1700000000.000001',
      // GH-143: the trailing three are the contract, not decoration. This door used to stitch its
      // own context and schedule with enrichment=off, so the routing facts described a decision
      // the pipeline had not made. It now reports resolved context like every other door.
      `${SlackApp.AppMentionString} make a Sleuth reminder for <@U_TARGET> based on task above`,
      true,
      // GH-143 (Codex review): this door no longer runs its own one-message lookup. It calls the
      // shared resolver, so the provenance — including the antecedent's author — is the resolver's,
      // and "do the above" over several earlier tasks can no longer silently drop one.
      { SourceTs: '1700000000.000001', SourceUser: 'U_SOURCE', Path: 'task_above_shorthand_in_thread' },
    );
    // The analyzed text is the resolver's marker block, byte-identical in shape to every other door.
    expect(TryScheduleRemindersAsync.mock.calls[0][1])
      .toContain('[earlier messages in this thread, for reference]');
    expect(TryScheduleRemindersAsync.mock.calls[0][1]).toContain('<@U_TARGET>');
    // The source message must arrive UNQUOTED. Wrapping it in quotes triggered the analyzer's
    // CRITICAL QUOTED TEXT RULE, which forbids summarizing quoted text — so the whole source
    // message became the reminder title verbatim.
    expect(TryScheduleRemindersAsync.mock.calls[0][1])
      .not.toContain('"Please review WP DB Toolkit issue 76 for the BigQuery sync plan."');
    expect(TryScheduleRemindersAsync.mock.calls[0][1]).toMatch(/tomorrow at \d{1,2}:\d{2} AM/);
  });

  describe('TryHandleTaskAboveShorthandAsync', () => {
    // GH-424: "follow on above" (dropping "up") fell through to the plain LLM path with no
    // thread context, so the reminder title kept the literal word "above" unresolved.
    test.each([
      ['follow up on above', 'please follow up on above with WP Engine support chat by 11 AM PT'],
      ['follow on above', 'please help follow on above with WP Engine support chat by 11 AM PT'],
    ])('"%s" phrasing resolves the task above shorthand', async (_Label, ArgText) => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_SOURCE',
              text: 'She\'ll need to use whatsmyip.com to get her IP address at home.',
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_REQUESTER',
              text: ArgText,
              ts: '1700000000.000002',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryHandleTaskAboveShorthandAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: ArgText,
      });

      expect(WasHandled).toBe(true);
      expect(TryScheduleRemindersAsync).toHaveBeenCalledTimes(1);
      expect(TryScheduleRemindersAsync.mock.calls[0][1]).toContain(
        'She\'ll need to use whatsmyip.com to get her IP address at home.'
      );
      expect(TryScheduleRemindersAsync.mock.calls[0][1]).toContain('<@U_REQUESTER>');
    });
  });

  describe('TryEnrichVagueCompletionFromAboveAsync', () => {
    test('enriches "will do it at 10pm" with the preceding thread message as task context', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_NOEL',
              text: 'How is the faucet replacement going?',
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_MIKE',
              text: '<@U_NOEL> will do it at 10pm pt',
              ts: '1700000000.000002',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_MIKE',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: '<@U_NOEL> will do it at 10pm pt',
      });

      expect(WasHandled).toBe(true);
      expect(TryScheduleRemindersAsync).toHaveBeenCalledTimes(1);
      const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
      expect(ScheduledText).toContain('How is the faucet replacement going?');
      expect(ScheduledText).toContain('will do it at 10pm pt');
      expect(TryScheduleRemindersAsync.mock.calls[0][6]).toBe('1700000000.000001');
      expect(TryScheduleRemindersAsync.mock.calls[0][7]).toBe('<@U_NOEL> will do it at 10pm pt');
      expect(TryScheduleRemindersAsync.mock.calls[0][8]).toBe(true);
      expect(
        SlackApp.Logger.InfoMessages.some((ArgMessage) =>
          ArgMessage.includes('path=vague_completion_in_thread') &&
          ArgMessage.includes('temporal_trigger="10pm"')
        )
      ).toBe(true);
    });

    test('enriches "I\'ll handle it tomorrow" with the preceding thread message', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_OTHER',
              text: 'The deployment pipeline needs to be fixed.',
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_SENDER',
              text: "I'll handle it tomorrow",
              ts: '1700000000.000002',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: "I'll handle it tomorrow",
      });

      expect(WasHandled).toBe(true);
      const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
      expect(ScheduledText).toContain('The deployment pipeline needs to be fixed.');
      expect(ScheduledText).toContain("I'll handle it tomorrow");
    });

    test('suppresses narrow hypothetical subordinate replies before AI scheduling', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_OTHER',
              text: 'Please reactivate that plugin.',
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_SENDER',
              text: "I'll keep that in mind when I get to that plugin asap.",
              ts: '1700000000.000002',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: "I'll keep that in mind when I get to that plugin asap.",
      });

      expect(WasHandled).toBe(true);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
      expect(
        SlackApp.Logger.InfoMessages.some((ArgMessage) =>
          ArgMessage.includes('reminder enrichment guard:') &&
          ArgMessage.includes('temporal_trigger="asap"')
        )
      ).toBe(true);
    });

    test('falls through when no scheduling trigger is present', async () => {
      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: 'will do it',
      });

      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
    });

    test('falls through when not in a thread', async () => {
      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        text: 'will do it at 10pm',
      });

      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
    });

    test('falls through when no preceding human message exists', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_SENDER',
              text: "I'll do it tonight",
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000001',
        thread_ts: '1700000000.000001',
        text: "I'll do it tonight",
      });

      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
    });

    test('falls through when the text does not match a vague completion phrase', async () => {
      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: 'will deploy the app at 10pm',
      });

      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
    });

    test('returns false when scheduler does not schedule (passes through to normal path)', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_OTHER',
              text: 'Some task description.',
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_SENDER',
              text: 'will do it tonight',
              ts: '1700000000.000002',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(false);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: 'will do it tonight',
      });

      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).toHaveBeenCalledTimes(1);
    });

    test('resolves "talk to @X more about it tomorrow" from preceding thread messages (prepositional pronoun)', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            {
              user: 'U_MATTHEW',
              text: 'NMI customer support fixed the vault issue. You can test subscriptions now on stg1.client-chemp.com',
              ts: '1700000000.000001',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_MIKE',
              text: 'still not working on my end. Do we really need to use NMI? Last time I used a test stripe account just to test a subscription purchase.',
              ts: '1700000000.000002',
              bot_id: undefined,
              reactions: [],
            },
            {
              user: 'U_NOEL',
              text: "Go ahead and test it. I'll talk to <@U_MATTHEW> more about it tomorrow.",
              ts: '1700000000.000003',
              bot_id: undefined,
              reactions: [],
            },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_NOEL',
        ts: '1700000000.000003',
        thread_ts: '1700000000.000001',
        text: "Go ahead and test it. I'll talk to <@U_MATTHEW> more about it tomorrow.",
      });

      expect(WasHandled).toBe(true);
      const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
      // Both preceding human messages are prepended so the AI can resolve "it" to the real subject.
      expect(ScheduledText).toContain('NMI customer support fixed the vault issue');
      expect(ScheduledText).toContain('test stripe account just to test a subscription purchase');
      expect(ScheduledText).toContain('talk to <@U_MATTHEW> more about it tomorrow');
      // Preceding context appears in chronological order, ahead of the current message.
      expect(ScheduledText.indexOf('NMI customer support'))
        .toBeLessThan(ScheduledText.indexOf('test stripe account'));
      expect(ScheduledText.indexOf('test stripe account'))
        .toBeLessThan(ScheduledText.indexOf('talk to <@U_MATTHEW>'));
    });

    test('gathers at most 3 preceding human messages and excludes bot messages', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            { user: 'U_A', text: 'oldest message four turns back', ts: '1700000000.000001', bot_id: undefined, reactions: [] },
            { user: 'U_B', text: 'third message back', ts: '1700000000.000002', bot_id: undefined, reactions: [] },
            { user: 'U_BOT', text: 'bot noise that must be skipped', ts: '1700000000.000003', bot_id: 'B_SLEUTH', reactions: [] },
            { user: 'U_C', text: 'second message back', ts: '1700000000.000004', bot_id: undefined, reactions: [] },
            { user: 'U_D', text: 'nearest message back', ts: '1700000000.000005', bot_id: undefined, reactions: [] },
            { user: 'U_SENDER', text: "I'll follow up on it tomorrow", ts: '1700000000.000006', bot_id: undefined, reactions: [] },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000006',
        thread_ts: '1700000000.000001',
        text: "I'll follow up on it tomorrow",
      });

      expect(WasHandled).toBe(true);
      const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
      // Only the 3 nearest human messages are kept; the 4th-back is dropped and the bot is skipped.
      expect(ScheduledText).toContain('nearest message back');
      expect(ScheduledText).toContain('second message back');
      expect(ScheduledText).toContain('third message back');
      expect(ScheduledText).not.toContain('oldest message four turns back');
      expect(ScheduledText).not.toContain('bot noise that must be skipped');
    });

    test('enriches a communication-verb direct object ("discuss it next week")', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            { user: 'U_OTHER', text: 'The pricing model proposal needs another look.', ts: '1700000000.000001', bot_id: undefined, reactions: [] },
            { user: 'U_SENDER', text: "let's discuss it next week", ts: '1700000000.000002', bot_id: undefined, reactions: [] },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: "let's discuss it next week",
      });

      expect(WasHandled).toBe(true);
      const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
      expect(ScheduledText).toContain('The pricing model proposal needs another look.');
    });

    test('keeps temporal "it" schedules ("send it monday") — "it" carries no temporal guard', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000000.000001': [
            { user: 'U_OTHER', text: 'The signed contract is ready for the client.', ts: '1700000000.000001', bot_id: undefined, reactions: [] },
            { user: 'U_SENDER', text: "I'll send it monday", ts: '1700000000.000002', bot_id: undefined, reactions: [] },
          ],
        },
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: "I'll send it monday",
      });

      expect(WasHandled).toBe(true);
      expect(TryScheduleRemindersAsync.mock.calls[0][1]).toContain('The signed contract is ready for the client.');
    });

    test('does not treat "about this week" as a pronoun reference (temporal guard on this/that)', async () => {
      const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        ts: '1700000000.000002',
        thread_ts: '1700000000.000001',
        text: "let's circle back about this week",
      });

      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
    });

    // GH-424: the literal word "above" is verb-agnostic — unlike TASK_ABOVE_SHORTHAND_PATTERN's
    // enumerated verb list, ANY phrasing containing "above" plus a schedule resolves thread context.
    describe('standalone "above" reference (ABOVE_REFERENCE_PATTERN)', () => {
      test.each([
        ['see above', 'please see above and meet at the park at 2 PM tomorrow'],
        ['check above', 'check above and get this done by 5pm'],
        ['per above', 'per above, submit the report by Friday'],
        ['as noted above', 'as noted above, wrap this up tonight'],
      ])('resolves "%s" phrasing from preceding thread context', async (_Label, ArgText) => {
        SlackApp = new MockSlackApp({
          AdminUsers: ['U_ADMIN'],
          ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
          ThreadMessagesById: {
            'C_GENERAL:1700000000.000001': [
              {
                user: 'U_OTHER',
                text: 'Can you also bring some food and drinks.',
                ts: '1700000000.000001',
                bot_id: undefined,
                reactions: [],
              },
              {
                user: 'U_SENDER',
                text: ArgText,
                ts: '1700000000.000002',
                bot_id: undefined,
                reactions: [],
              },
            ],
          },
        });
        TryScheduleRemindersAsync.mockResolvedValue(true);

        const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
          channel: 'C_GENERAL',
          user: 'U_SENDER',
          ts: '1700000000.000002',
          thread_ts: '1700000000.000001',
          text: ArgText,
        });

        expect(WasHandled).toBe(true);
        const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
        expect(ScheduledText).toContain('Can you also bring some food and drinks.');
        expect(ScheduledText).toContain(ArgText);
      });

      test('falls through when "above" appears with no scheduling trigger (purely informational)', async () => {
        const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
          channel: 'C_GENERAL',
          user: 'U_SENDER',
          ts: '1700000000.000002',
          thread_ts: '1700000000.000001',
          text: 'see above for the full list of options',
        });

        expect(WasHandled).toBe(false);
        expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
      });

      test('falls through when "above" has a schedule but no preceding human message exists', async () => {
        SlackApp = new MockSlackApp({
          AdminUsers: ['U_ADMIN'],
          ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
          ThreadMessagesById: {
            'C_GENERAL:1700000000.000001': [
              {
                user: 'U_SENDER',
                text: 'see above and finish by 5pm',
                ts: '1700000000.000001',
                bot_id: undefined,
                reactions: [],
              },
            ],
          },
        });

        const WasHandled = await Handler.TryEnrichVagueCompletionFromAboveAsync(SlackApp, {
          channel: 'C_GENERAL',
          user: 'U_SENDER',
          ts: '1700000000.000001',
          thread_ts: '1700000000.000001',
          text: 'see above and finish by 5pm',
        });

        expect(WasHandled).toBe(false);
        expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
      });
    });
  });

  test('thread reminder command explains that it must be used inside a thread', async () => {
    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000003',
      text: `${SlackApp.AppMentionString} make a Sleuth reminder for <@U_TARGET> based on task above`,
    });

    expect(WasHandled).toBe(true);
    expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('This command only works in a thread under the source task.');
  });

  test('show reminders uses the live pending-reminders getter', async () => {
    PendingReminders.push(MakeReminder());

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000001',
      text: `${SlackApp.AppMentionString} show reminders`,
    });

    expect(WasHandled).toBe(true);
    // summary + section label + reminder item (bucketed display, reminder is 5 days overdue).
    expect(SlackApp.SentMessages).toHaveLength(3);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders (1 total):');
    expect(SlackApp.SentMessages[1].text).toBe('*⚠️ Due within last 7 days*');
    expect(SlackApp.SentMessages[2].text).toContain('Review launch checklist');
  });

  test('summarize week posts the completed-this-week history and the still-open queue', async () => {
    // Pin the clock so the handler and this test compute the same Sun–Sat window (no boundary flake).
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z')); // a Wednesday
    try {
      const OpenReminder = MakeReminder({
        ReminderID: '33333333-3333-3333-3333-333333333333',
        ReminderMessageText: 'Ship the onboarding fix',
      });
      PendingReminders.push(OpenReminder);

      // The week window the handler computes for "now" in the workspace timezone.
      const Week = DateUtils.GetCalendarWeekRange(DefaultTimezone);
      // A completion recorded mid-week, plus one outside the window that must be filtered out.
      CompletedRecords = [
        {
          reminderId: 'R_DONE_1',
          summary: 'Reviewed the launch checklist',
          assigneeID: 'U_ASSIGNEE',
          sourceChannelID: 'C_GENERAL',
          dueDate: null,
          completedMs: Week.StartMs + 24 * 60 * 60 * 1000,
        },
        {
          reminderId: 'R_DONE_LAST_WEEK',
          summary: 'Finished something last week',
          assigneeID: null,
          sourceChannelID: 'C_GENERAL',
          dueDate: null,
          completedMs: Week.StartMs - 24 * 60 * 60 * 1000,
        },
      ];

      const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000000.000001',
        text: `${SlackApp.AppMentionString} summarize week`,
      });

      expect(WasHandled).toBe(true);

      const Texts = SlackApp.SentMessages.map(ArgMessage => ArgMessage.text);
      expect(Texts[0]).toContain('Week summary');
      // Only the in-window completion is counted; last week's row is filtered out.
      expect(Texts.some(ArgText => ArgText.includes('Completed this week (1):'))).toBe(true);
      expect(Texts.some(ArgText => ArgText.includes('Reviewed the launch checklist'))).toBe(true);
      expect(Texts.some(ArgText => ArgText.includes('Finished something last week'))).toBe(false);
      expect(Texts.some(ArgText => ArgText.includes('Still open (1):'))).toBe(true);
      expect(Texts.some(ArgText => ArgText.includes('Ship the onboarding fix'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  // INVERTED 2026-08-09. This asserted the projection became the completed source when the flag was
  // set. That flag is now PARKED along with the other three (reminders-projection.js
  // BLOCKED_PROJECTION_FLAGS), and this call site was the least protected of them — it reads the
  // flag at its own call site with no coverage gate at all, so its only guard was a catch that fires
  // on a thrown error, never on a silently-wrong fold. The fixture is unchanged on purpose: the two
  // sources still return deliberately different rows, so the assertions below prove which one won.
  test('summarize week IGNORES SUMMARIZE_WEEK_COMPLETED_SOURCE=projection — the flag is parked', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z')); // a Wednesday
    const PriorFlag = process.env.SUMMARIZE_WEEK_COMPLETED_SOURCE;
    process.env.SUMMARIZE_WEEK_COMPLETED_SOURCE = 'projection';
    try {
      const Week = DateUtils.GetCalendarWeekRange(DefaultTimezone);
      const CompletedAtIso = new Date(Week.StartMs + 24 * 60 * 60 * 1000).toISOString();

      // Events fold to exactly ONE in-window completion. The CompletionStore is deliberately given a
      // DIFFERENT row, so the assertions below can prove which source actually won.
      const ProjectionEvents = [
        {
          v: 1, id: 'evt_p1', ts: CompletedAtIso, workspace: 'W',
          type: 'ReminderCreated', reminderId: 'R_PROJ_1',
          payload: { text: 'Projected task body', assigneeId: 'U_PROJ', sourceChannelId: 'C_GENERAL', targetChannelId: 'C_GENERAL', source: 'fsm', githubUrls: [] },
        },
        {
          v: 1, id: 'evt_p2', ts: CompletedAtIso, workspace: 'W',
          type: 'ReminderCompleted', reminderId: 'R_PROJ_1',
          payload: { by: 'U_PROJ', method: 'reaction', summary: 'Projected completion summary', completedAt: CompletedAtIso },
        },
      ];
      CompletedRecords = [{
        reminderId: 'R_STORE_ONLY',
        summary: 'Store-sourced row that MUST appear',
        assigneeID: 'U_STORE', sourceChannelID: 'C_GENERAL', dueDate: null,
        completedMs: Week.StartMs + 2 * 60 * 60 * 1000,
      }];

      const ProjectionHandler = new RemindersAppMentionHandler({
        GetPendingReminders: () => PendingReminders,
        GetRemindersTargetingUserID: () => [],
        GetRemindersInvolvingUserID: () => [],
        GetGitHubSyncModule: () => GitHubSyncModule,
        GetListsModule: () => ListsModule,
        GetCompletedRemindersBetween: (ArgStartMs, ArgEndMs) =>
          CompletedRecords.filter(r => r.completedMs >= ArgStartMs && r.completedMs < ArgEndMs),
        ReadAllEventsAsync: async () => ProjectionEvents,
        GetChannelSettings: () => ChannelSettings,
        TryScheduleRemindersAsync,
        CheckRemindersAsync,
        GetClientMappings: () => ClientMappings,
      });

      const WasHandled = await ProjectionHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000000.000002',
        text: `${SlackApp.AppMentionString} summarize week`,
      });

      expect(WasHandled).toBe(true);
      const Texts = SlackApp.SentMessages.map(ArgMessage => ArgMessage.text);
      expect(Texts.some(ArgText => ArgText.includes('Completed this week (1):'))).toBe(true);
      // The AUTHORITATIVE store row is the one that must be rendered, with the flag set to
      // `projection`. That is the whole point of parking: the setting is inert, not honoured.
      expect(Texts.some(ArgText => ArgText.includes('Store-sourced row that MUST appear'))).toBe(true);
      expect(Texts.some(ArgText => ArgText.includes('Projected completion summary'))).toBe(false);
    } finally {
      if(PriorFlag === undefined) delete process.env.SUMMARIZE_WEEK_COMPLETED_SOURCE;
      else process.env.SUMMARIZE_WEEK_COMPLETED_SOURCE = PriorFlag;
      jest.useRealTimers();
    }
  });

  test('summarize week reports nothing completed when the Sleuth history is empty for the week', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z')); // a Wednesday
    try {
      CompletedRecords = []; // no completions recorded this week (the reported bug's condition)

      const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000000.000001',
        text: `${SlackApp.AppMentionString} weekly summary`,
      });

      expect(WasHandled).toBe(true);
      const Texts = SlackApp.SentMessages.map(ArgMessage => ArgMessage.text);
      expect(Texts.some(ArgText => ArgText.includes('Completed this week:') && ArgText.includes('nothing completed yet'))).toBe(true);
      // With no pending reminders, the open section reports all clear.
      expect(Texts.some(ArgText => ArgText.includes('all clear'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('enable reminders returns a startup message when channel settings are not ready yet', async () => {
    ChannelSettings = null;

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_CREATOR',
      ts: '1700000000.000001',
      text: `${SlackApp.AppMentionString} enable reminders`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe('Reminder system is still starting up. Try again in a moment.');
  });

  test('search reminders here stays aligned with the extracted search command scope', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: '22222222-2222-2222-2222-222222222222',
        ReminderMessageText: 'Review invoice with finance',
        OriginalChannelID: 'C_GENERAL',
      }),
      MakeReminder({
        ReminderID: '33333333-3333-3333-3333-333333333333',
        ReminderMessageText: 'Review invoice with legal',
        OriginalChannelID: 'C_OTHER',
      }),
      MakeReminder({
        ReminderID: '44444444-4444-4444-4444-444444444444',
        ReminderMessageText: 'Review launch checklist',
        OriginalChannelID: 'C_GENERAL',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000002',
      text: `${SlackApp.AppMentionString} search reminders here invoice`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(2);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders in this channel matching "invoice" (1 total):');
    expect(SlackApp.SentMessages[1].text).toContain('Review invoice with finance');
    expect(SlackApp.SentMessages[1].text).not.toContain('Review invoice with legal');
    expect(SlackApp.SentMessages[1].text).not.toContain('Review launch checklist');
  });

  test('github sync now resolves the GitHub sync module lazily after construction', async () => {
    GitHubSyncModule = {
      RunNowAsync: jest.fn().mockResolvedValue({ ok: true, message: 'sync complete' }),
    };

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_ADMIN',
      ts: '1700000000.000003',
      text: `${SlackApp.AppMentionString} github sync now`,
    });

    expect(WasHandled).toBe(true);
    expect(GitHubSyncModule.RunNowAsync).toHaveBeenCalledTimes(1);
    expect(SlackApp.SentMessages).toHaveLength(2);
    expect(SlackApp.SentMessages[0].text).toBe('Running GitHub sync now…');
    expect(SlackApp.SentMessages[1].text).toBe('SUCCESS: sync complete');
  });

  test('generate list for user creates a durable per-user Slack List from assigned reminders', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: '99999999-9999-9999-9999-999999999999',
        ReminderMessageText: 'Review launch checklist',
        AssigneeID: 'U_TARGET',
      }),
      MakeReminder({
        ReminderID: 'abababab-abab-abab-abab-abababababab',
        ReminderMessageText: 'Follow up with finance',
        AssigneeID: 'U_TARGET',
      }),
    ];

    ListsModule = {
      IsListsAvailable: true,
      EnsureUserListAsync: jest.fn().mockResolvedValue({
        ok: true,
        created: true,
        listId: 'F_USER_1',
        listName: 'Sleuth Reminders — @target.user',
        permalink: 'https://mock.slack.test/lists/T_TEST/F_USER_1',
        syncedItemCount: 2,
        requestedItemCount: 2,
      }),
    };

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000006',
      text: `${SlackApp.AppMentionString} generate-list for <@U_TARGET>`,
    });

    expect(WasHandled).toBe(true);
    expect(ListsModule.EnsureUserListAsync).toHaveBeenCalledWith(
      'U_TARGET',
      PendingReminders,
      'C_GENERAL'
    );
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('Created <https://mock.slack.test/lists/T_TEST/F_USER_1|Sleuth Reminders — @target.user> for <@U_TARGET> with 2 assigned tasks.');
    expect(SlackApp.SentMessages[0].text).toContain('stays in sync');
  });

  test('generate list for user resyncs an existing durable list', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: '99999999-9999-9999-9999-999999999999',
        ReminderMessageText: 'Review launch checklist',
        AssigneeID: 'U_TARGET',
      }),
    ];

    ListsModule = {
      IsListsAvailable: true,
      EnsureUserListAsync: jest.fn().mockResolvedValue({
        ok: true,
        created: false,
        listId: 'F_USER_1',
        listName: 'Sleuth Reminders — @target.user',
        permalink: 'https://mock.slack.test/lists/T_TEST/F_USER_1',
        syncedItemCount: 0,
        requestedItemCount: 1,
      }),
    };

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000007',
      text: `${SlackApp.AppMentionString} generate-list for <@U_TARGET>`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toContain('Resynced <https://mock.slack.test/lists/T_TEST/F_USER_1|Sleuth Reminders — @target.user> for <@U_TARGET> — now tracking 1 reminder.');
  });

  test('ShowRemindersForUserDeterministicAsync delegates to the extracted user-reminder flow', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: '55555555-5555-5555-5555-555555555555',
        ReminderMessageText: 'Follow up with <@U_TARGET> about launch',
        AssigneeID: 'U_TARGET',
        OriginalChannelID: 'C_GENERAL',
      }),
      MakeReminder({
        ReminderID: '66666666-6666-6666-6666-666666666666',
        ReminderMessageText: 'Follow up with <@U_TARGET> about invoices',
        AssigneeID: 'U_TARGET',
        OriginalChannelID: 'C_OTHER',
      }),
    ];

    const WasHandled = await Handler.ShowRemindersForUserDeterministicAsync(
      SlackApp,
      {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000000.000004',
        text: '',
      },
      '<@U_TARGET>',
      { limitToCurrentChannel: true }
    );

    expect(WasHandled).toBe(true);
    // summary + section label + reminder item (bucketed display, reminder is 5 days overdue).
    expect(SlackApp.SentMessages).toHaveLength(3);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders for <@U_TARGET> (1 total):');
    expect(SlackApp.SentMessages[1].text).toBe('*⚠️ Due within last 7 days*');
    expect(SlackApp.SentMessages[2].text).toContain('Follow up with <@U_TARGET> about launch');
    expect(SlackApp.SentMessages[2].text).not.toContain('Follow up with <@U_TARGET> about invoices');
  });

  // regression: "show my reminders" must not include reminders the requester created for someone else (Phase 5 invariant).
  test('show my reminders does not return reminders created for another user', async () => {
    PendingReminders = [
      // self-assigned: U_REQUESTER created this for themselves (AssigneeID defaults to sender).
      MakeReminder({
        ReminderID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        ReminderMessageText: 'Review my own notes',
        OriginalSenderID: 'U_REQUESTER',
        AssigneeID: 'U_REQUESTER',
        OriginalChannelID: 'C_GENERAL',
      }),
      // delegated: U_REQUESTER created this for U_OTHER — must NOT appear in "show my reminders".
      MakeReminder({
        ReminderID: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        ReminderMessageText: 'Follow up with <@U_OTHER> about the report',
        OriginalSenderID: 'U_REQUESTER',
        AssigneeID: 'U_OTHER',
        OriginalChannelID: 'C_GENERAL',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000005',
      text: `${SlackApp.AppMentionString} show my reminders`,
    });

    expect(WasHandled).toBe(true);
    // summary + section label + reminder item (bucketed display, reminder is 5 days overdue).
    expect(SlackApp.SentMessages).toHaveLength(3);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders (1 total):');
    expect(SlackApp.SentMessages[1].text).toBe('*⚠️ Due within last 7 days*');
    expect(SlackApp.SentMessages[2].text).toContain('Review my own notes');
    expect(SlackApp.SentMessages[2].text).not.toContain('Follow up with <@U_OTHER>');
  });

  test('search reminders matches by original channel name', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        ReminderMessageText: 'Investigate stuck checkout',
        OriginalChannelID: 'C_CLIENT_A',
        OriginalChannelName: 'client-a-eng',
      }),
      MakeReminder({
        ReminderID: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        ReminderMessageText: 'Review launch checklist',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000010',
      text: `${SlackApp.AppMentionString} search reminders client-a`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders matching "client-a" (1 total):');
    const RenderedItems = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(RenderedItems).toContain('Investigate stuck checkout');
    expect(RenderedItems).not.toContain('Review launch checklist');
  });

  test('search-reminders (hyphenated alias) routes the same as "search reminders"', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        ReminderMessageText: 'Investigate stuck checkout',
        OriginalChannelID: 'C_CLIENT_A',
        OriginalChannelName: 'client-a-eng',
      }),
      MakeReminder({
        ReminderID: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        ReminderMessageText: 'Review launch checklist',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000010',
      text: `${SlackApp.AppMentionString} search-reminders client-a`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders matching "client-a" (1 total):');
    const RenderedItems = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(RenderedItems).toContain('Investigate stuck checkout');
    expect(RenderedItems).not.toContain('Review launch checklist');
  });

  test('search-projects expands to a "PROJECT" keyword search', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        ReminderMessageText: 'PROJECT Client A order lookup plugin',
        OriginalChannelID: 'C_CLIENT_A',
        OriginalChannelName: 'client-a-eng',
      }),
      MakeReminder({
        ReminderID: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        ReminderMessageText: 'PROJECT switch over to Mailgun',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
      }),
      MakeReminder({
        ReminderID: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        ReminderMessageText: 'Reply to the support thread',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000012',
      text: `${SlackApp.AppMentionString} search-projects`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders matching "PROJECT" (2 total):');
    const RenderedItems = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(RenderedItems).toContain('PROJECT Client A order lookup plugin');
    expect(RenderedItems).toContain('PROJECT switch over to Mailgun');
    expect(RenderedItems).not.toContain('Reply to the support thread');
  });

  test('search-projects with trailing keywords narrows within PROJECT reminders', async () => {
    PendingReminders = [
      MakeReminder({
        // Uses the identifier form ("client-a") rather than the prose form ("Client A") because
        // the search keyword below is a single token — a space-separated prose name would not
        // match it exactly, which is a property of the keyword search, not of this scenario.
        ReminderID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        ReminderMessageText: 'PROJECT client-a order lookup plugin',
        OriginalChannelID: 'C_CLIENT_A',
        OriginalChannelName: 'client-a-eng',
      }),
      MakeReminder({
        ReminderID: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        ReminderMessageText: 'PROJECT switch over to Mailgun',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000013',
      text: `${SlackApp.AppMentionString} search-projects client-a`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders matching "PROJECT client-a" (1 total):');
    const RenderedItems = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(RenderedItems).toContain('PROJECT client-a order lookup plugin');
    expect(RenderedItems).not.toContain('PROJECT switch over to Mailgun');
  });

  test('search reminders matches by GitHub URL substring', async () => {
    PendingReminders = [
      MakeReminder({
        ReminderID: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        ReminderMessageText: 'Tracking upstream fix',
        OriginalChannelID: 'C_OTHER',
        OriginalChannelName: 'misc',
        GitHubUrls: ['https://github.com/Acme/client-a-app/issues/42'],
      }),
      MakeReminder({
        ReminderID: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ReminderMessageText: 'Tracking unrelated fix',
        OriginalChannelID: 'C_OTHER',
        OriginalChannelName: 'misc',
        GitHubUrls: ['https://github.com/Acme/other-app/issues/7'],
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000011',
      text: `${SlackApp.AppMentionString} search reminders client-a`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders matching "client-a" (1 total):');
    const RenderedItems = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(RenderedItems).toContain('Tracking upstream fix');
    expect(RenderedItems).not.toContain('Tracking unrelated fix');
  });

  test('fuzzy search matches typos against channel name + GitHub URL haystack tokens, not just reminder text', async () => {
    // 'cliont' is a Levenshtein-1 typo of 'client'. The reminder text contains neither —
    // only the channel name does. Without the new haystack tokenizer, the fuzzy path
    // would tokenize ReminderMessageText alone and find zero close matches.
    PendingReminders = [
      MakeReminder({
        ReminderID: '90909090-9090-9090-9090-909090909090',
        ReminderMessageText: 'Investigate stuck checkout flow',
        OriginalChannelID: 'C_X',
        OriginalChannelName: 'client-a-eng',
      }),
      MakeReminder({
        ReminderID: 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
        ReminderMessageText: 'Unrelated work item',
        OriginalChannelID: 'C_Y',
        OriginalChannelName: 'general',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000099',
      text: `${SlackApp.AppMentionString} search reminders cliont`,
    });

    expect(WasHandled).toBe(true);
    const Posted = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(Posted).toContain('No exact matches found for "cliont"');
    expect(Posted).toContain('Close matches for "cliont"');
    expect(Posted).toContain('Investigate stuck checkout flow');
    expect(Posted).not.toContain('Unrelated work item');
  });

  test('search reminders expands query to clients mapped by channel ID', async () => {
    ClientMappings = [
      {
        ClientName: 'Client A',
        Aliases: ['client-a'],
        ChannelIDs: ['C_CLIENT_A_PRIVATE'],
        ChannelNamePatterns: [],
        GitHubRepoPatterns: [],
      },
    ];
    PendingReminders = [
      MakeReminder({
        ReminderID: 'aabbccdd-0001-0001-0001-000000000001',
        ReminderMessageText: 'Discount stacking bug',
        OriginalChannelID: 'C_CLIENT_A_PRIVATE',
        OriginalChannelName: 'private-room',
      }),
      MakeReminder({
        ReminderID: 'aabbccdd-0002-0002-0002-000000000002',
        ReminderMessageText: 'Unrelated work item',
        OriginalChannelID: 'C_OTHER',
        OriginalChannelName: 'general',
      }),
    ];

    const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      ts: '1700000000.000012',
      text: `${SlackApp.AppMentionString} search reminders client-a`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages[0].text).toBe('Pending reminders matching "client-a" (1 total):');
    const RenderedItems = SlackApp.SentMessages.map(m => m.text).join('\n');
    expect(RenderedItems).toContain('Discount stacking bug');
    expect(RenderedItems).not.toContain('Unrelated work item');
  });

  // ─── Multi-task extraction (whole-thread, propose-and-confirm) ───────────────

  describe('multi-task extraction', () => {
    let AIPipeline;
    let MultiTaskHandler;

    beforeEach(() => {
      AIPipeline = {
        ExtractMultiTaskCandidatesAsync: jest.fn().mockResolvedValue({
          candidates: [
            {
              taskIndex: 1,
              title: 'Delete Silverpeak account',
              sourceMessageNumbers: [1],
              sourceTs: ['1700000001.000001'],
              assigneeID: 'U_DEFAULT',
              deadline: 'next Friday',
              deadlineResolution: 'explicit',
              confidence: 'high',
              flag: null,
              duplicateOpenReminderID: null,
            },
            {
              taskIndex: 2,
              title: 'Ingest Drive assets',
              sourceMessageNumbers: [2],
              sourceTs: ['1700000001.000002'],
              assigneeID: 'U_DEFAULT',
              deadline: null,
              deadlineResolution: 'blank',
              confidence: 'high',
              flag: null,
              duplicateOpenReminderID: null,
            },
            {
              taskIndex: 3,
              title: 'Add new locations',
              sourceMessageNumbers: [3],
              sourceTs: ['1700000001.000003'],
              assigneeID: null,
              deadline: null,
              deadlineResolution: 'blank',
              confidence: 'low',
              flag: 'needs linked-asset context',
              duplicateOpenReminderID: null,
            },
          ],
          rationale: 'Three tasks found in thread.',
        }),
      };

      MultiTaskHandler = new RemindersAppMentionHandler({
        GetPendingReminders: () => PendingReminders,
        GetRemindersTargetingUserID: (ArgUserID) => PendingReminders.filter(r => r.AssigneeID === ArgUserID),
        GetRemindersInvolvingUserID: (ArgUserID) => PendingReminders.filter(r =>
          r.OriginalSenderID === ArgUserID || r.AssigneeID === ArgUserID
        ),
        GetGitHubSyncModule: () => GitHubSyncModule,
        GetListsModule: () => ListsModule,
        GetCompletedRemindersBetween: () => [],
        GetChannelSettings: () => ChannelSettings,
        TryScheduleRemindersAsync,
        CheckRemindersAsync,
        GetClientMappings: () => ClientMappings,
        AIPipeline,
      });
    });

    test('whole-thread extraction trigger calls AIPipeline and posts proposal in-thread', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000001.000001': [
            { user: 'U_A', text: 'Delete Silverpeak account.', ts: '1700000001.000001', bot_id: undefined, reactions: [] },
            { user: 'U_B', text: 'Ingest Drive assets.', ts: '1700000001.000002', bot_id: undefined, reactions: [] },
            { user: 'U_C', text: 'Add new locations.', ts: '1700000001.000003', bot_id: undefined, reactions: [] },
            { user: 'U_REQUESTER', text: `${SlackApp.AppMentionString} extract tasks`, ts: '1700000001.000004', bot_id: undefined, reactions: [] },
          ],
        },
      });

      const WasHandled = await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000001.000004',
        thread_ts: '1700000001.000001',
        text: `${SlackApp.AppMentionString} extract tasks`,
      });

      expect(WasHandled).toBe(true);
      expect(AIPipeline.ExtractMultiTaskCandidatesAsync).toHaveBeenCalledTimes(1);
      // Must NOT auto-schedule — confirm only
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
      // Proposal posted in-thread
      expect(SlackApp.SentMessages).toHaveLength(1);
      const ProposalText = SlackApp.SentMessages[0].text;
      expect(ProposalText).toContain('Proposed tasks from thread');
      expect(ProposalText).toContain('Delete Silverpeak account');
      expect(ProposalText).toContain('Ingest Drive assets');
      expect(ProposalText).toContain('Add new locations');
      // Low-confidence candidate flagged
      expect(ProposalText).toContain('low confidence');
      expect(ProposalText).toContain('needs linked-asset context');
    });

    test('client-scoped dedup: open reminders from other clients are excluded from dedup check', async () => {
      ClientMappings = [
        {
          ClientID: 'client-client-a',
          ClientName: 'Client A',
          Aliases: ['client-a'],
          ChannelIDs: ['C_CLIENT_A'],
          ChannelNamePatterns: [],
          GitHubRepoPatterns: [],
          Defaults: { DefaultAssigneeID: 'U_DEFAULT', DeadlineConvention: 'next-friday' },
        },
      ];

      PendingReminders = [
        MakeReminder({
          ReminderID: 'client-a-rem-1',
          ReminderMessageText: 'Client A task',
          OriginalChannelID: 'C_CLIENT_A',
        }),
        MakeReminder({
          ReminderID: 'other-rem-2',
          ReminderMessageText: 'Other client task',
          OriginalChannelID: 'C_OTHER_CLIENT',
        }),
      ];

      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_CLIENT_A: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_CLIENT_A:1700000002.000001': [
            { user: 'U_A', text: 'Delete Silverpeak.', ts: '1700000002.000001', bot_id: undefined, reactions: [] },
            { user: 'U_REQUESTER', text: `${SlackApp.AppMentionString} propose tasks`, ts: '1700000002.000002', bot_id: undefined, reactions: [] },
          ],
        },
      });

      const HandlerWithClient = new RemindersAppMentionHandler({
        GetPendingReminders: () => PendingReminders,
        GetRemindersTargetingUserID: () => [],
        GetRemindersInvolvingUserID: () => [],
        GetGitHubSyncModule: () => null,
        GetListsModule: () => null,
        GetCompletedRemindersBetween: () => [],
        GetChannelSettings: () => ChannelSettings,
        TryScheduleRemindersAsync,
        CheckRemindersAsync,
        GetClientMappings: () => ClientMappings,
        AIPipeline,
      });

      await HandlerWithClient.OnAppMentionAsync(SlackApp, {
        channel: 'C_CLIENT_A',
        user: 'U_REQUESTER',
        ts: '1700000002.000002',
        thread_ts: '1700000002.000001',
        text: `${SlackApp.AppMentionString} propose tasks`,
      });

      expect(AIPipeline.ExtractMultiTaskCandidatesAsync).toHaveBeenCalledTimes(1);
      const PassedOpenReminders = AIPipeline.ExtractMultiTaskCandidatesAsync.mock.calls[0][2];
      // Only the Client A-channel reminder is passed — the other-client reminder is excluded
      expect(PassedOpenReminders.some((/** @type {any} */ r) => r.ReminderID === 'client-a-rem-1')).toBe(true);
      expect(PassedOpenReminders.some((/** @type {any} */ r) => r.ReminderID === 'other-rem-2')).toBe(false);
    });

    test('extraction with no AIPipeline falls through to legacy path', async () => {
      // Handler without AIPipeline — extraction trigger must not be handled
      const WasHandled = await Handler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000003.000001',
        text: `${SlackApp.AppMentionString} extract tasks`,
      });

      // No AIPipeline — falls through (returns false, no message posted)
      expect(WasHandled).toBe(false);
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(0);
    });

    test('confirm creates reminders from the synthesized title, NOT the raw source message (prod bug 2026-07-14)', async () => {
      // The proposal renders (and the user confirms) Candidate.title — the synthesized task. The
      // created reminder must carry that title, not the full raw chat message it was extracted from.
      // Regression: the confirm path used the verbatim source message, which the digest then mangled
      // ("Get the Woocommerce plugins done" → "com. I'll follow the same method…").
      const RawSourceMessage =
        "I'm starting plugin updates on ClientAcbd.com production based on our spreadsheet and what we " +
        "have on ClientChemp.com. I'll follow the same method we used before on Client C. I'll update to " +
        "the latest version we have tested allowing for patch updates, but sticking with major.minor " +
        "versions we have already tested.";
      AIPipeline.ExtractMultiTaskCandidatesAsync.mockResolvedValue({
        candidates: [{
          taskIndex: 1,
          title: 'Get the Woocommerce plugins done',
          sourceMessageNumbers: [1],
          sourceTs: ['1700000009.000001'],
          assigneeID: 'U_MIKE',
          deadline: null,
          deadlineResolution: 'blank',
          confidence: 'high',
          flag: null,
          duplicateOpenReminderID: null,
        }],
        rationale: 'one task',
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000009.000001': [
            { user: 'U_MATT', text: RawSourceMessage, ts: '1700000009.000001', bot_id: undefined, reactions: [] },
            { user: 'U_REQUESTER', text: `${SlackApp.AppMentionString} extract tasks`, ts: '1700000009.000002', bot_id: undefined, reactions: [] },
          ],
        },
      });

      // 1. Extract → proposal (nothing scheduled yet).
      await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL', user: 'U_REQUESTER', ts: '1700000009.000002', thread_ts: '1700000009.000001',
        text: `${SlackApp.AppMentionString} extract tasks`,
      });
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();
      // The proposal shows the synthesized title, not the raw message.
      const ProposalText = SlackApp.SentMessages[SlackApp.SentMessages.length - 1].text;
      expect(ProposalText).toContain('Get the Woocommerce plugins done');
      expect(ProposalText).not.toContain('major.minor');

      // 2. Confirm.
      const WasHandled = await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL', user: 'U_REQUESTER', ts: '1700000009.000003', thread_ts: '1700000009.000001',
        text: `${SlackApp.AppMentionString} confirm`,
      });

      expect(WasHandled).toBe(true);
      expect(TryScheduleRemindersAsync).toHaveBeenCalledTimes(1);
      const ScheduledText = TryScheduleRemindersAsync.mock.calls[0][1];
      expect(ScheduledText).toContain('Get the Woocommerce plugins done');
      expect(ScheduledText).not.toContain('major.minor versions'); // raw message must not leak in
      expect(ScheduledText).not.toContain('ClientChemp');
    });

    test('confirm skips a candidate with a missing/blank title but still schedules the valid ones (GH-399)', async () => {
      AIPipeline.ExtractMultiTaskCandidatesAsync.mockResolvedValue({
        candidates: [
          {
            taskIndex: 1,
            title: 'Delete Silverpeak account',
            sourceMessageNumbers: [1],
            sourceTs: ['1700000010.000001'],
            assigneeID: 'U_DEFAULT',
            deadline: null,
            deadlineResolution: 'blank',
            confidence: 'high',
            flag: null,
            duplicateOpenReminderID: null,
          },
          {
            taskIndex: 2,
            title: undefined,
            sourceMessageNumbers: [2],
            sourceTs: ['1700000010.000002'],
            assigneeID: 'U_DEFAULT',
            deadline: null,
            deadlineResolution: 'blank',
            confidence: 'high',
            flag: null,
            duplicateOpenReminderID: null,
          },
          {
            taskIndex: 3,
            title: '',
            sourceMessageNumbers: [3],
            sourceTs: ['1700000010.000003'],
            assigneeID: 'U_DEFAULT',
            deadline: null,
            deadlineResolution: 'blank',
            confidence: 'high',
            flag: null,
            duplicateOpenReminderID: null,
          },
          {
            taskIndex: 4,
            title: 'Ingest Drive assets',
            sourceMessageNumbers: [4],
            sourceTs: ['1700000010.000004'],
            assigneeID: 'U_DEFAULT',
            deadline: null,
            deadlineResolution: 'blank',
            confidence: 'high',
            flag: null,
            duplicateOpenReminderID: null,
          },
        ],
        rationale: 'four tasks found, two blank titles.',
      });
      TryScheduleRemindersAsync.mockResolvedValue(true);

      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000010.000001': [
            { user: 'U_A', text: 'Delete Silverpeak account.', ts: '1700000010.000001', bot_id: undefined, reactions: [] },
            { user: 'U_B', text: 'Some blank-title task.', ts: '1700000010.000002', bot_id: undefined, reactions: [] },
            { user: 'U_C', text: 'Another blank-title task.', ts: '1700000010.000003', bot_id: undefined, reactions: [] },
            { user: 'U_D', text: 'Ingest Drive assets.', ts: '1700000010.000004', bot_id: undefined, reactions: [] },
            { user: 'U_REQUESTER', text: `${SlackApp.AppMentionString} extract tasks`, ts: '1700000010.000005', bot_id: undefined, reactions: [] },
          ],
        },
      });

      // 1. Extract → proposal.
      await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL', user: 'U_REQUESTER', ts: '1700000010.000005', thread_ts: '1700000010.000001',
        text: `${SlackApp.AppMentionString} extract tasks`,
      });
      expect(TryScheduleRemindersAsync).not.toHaveBeenCalled();

      // 2. Confirm — should not throw, must skip the two blank-title candidates, and must still
      // schedule the two valid ones.
      const WasHandled = await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL', user: 'U_REQUESTER', ts: '1700000010.000006', thread_ts: '1700000010.000001',
        text: `${SlackApp.AppMentionString} confirm`,
      });

      expect(WasHandled).toBe(true);
      expect(TryScheduleRemindersAsync).toHaveBeenCalledTimes(2);
      const ScheduledTexts = TryScheduleRemindersAsync.mock.calls.map((ArgCall) => ArgCall[1]);
      expect(ScheduledTexts.some((ArgText) => ArgText.includes('Delete Silverpeak account'))).toBe(true);
      expect(ScheduledTexts.some((ArgText) => ArgText.includes('Ingest Drive assets'))).toBe(true);
      // No "undefined" text ever leaked into a scheduled reminder.
      expect(ScheduledTexts.some((ArgText) => ArgText.includes('undefined'))).toBe(false);
      // Warned about both skipped candidates.
      expect(SlackApp.Logger.WarnMessages.some((ArgMsg) => ArgMsg.includes('taskIndex=2'))).toBe(true);
      expect(SlackApp.Logger.WarnMessages.some((ArgMsg) => ArgMsg.includes('taskIndex=3'))).toBe(true);
    });

    test('extraction posts "no tasks found" when pipeline returns empty candidates', async () => {
      AIPipeline.ExtractMultiTaskCandidatesAsync.mockResolvedValue({ candidates: [], rationale: 'nothing' });

      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000004.000001': [
            { user: 'U_A', text: 'No real tasks here.', ts: '1700000004.000001', bot_id: undefined, reactions: [] },
            { user: 'U_REQUESTER', text: `${SlackApp.AppMentionString} extract tasks`, ts: '1700000004.000002', bot_id: undefined, reactions: [] },
          ],
        },
      });

      const WasHandled = await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000004.000002',
        thread_ts: '1700000004.000001',
        text: `${SlackApp.AppMentionString} extract tasks`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('did not find any distinct tasks');
    });

    test('whole-thread collector captures ALL messages (no 3-message cap)', async () => {
      SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
        ThreadMessagesById: {
          'C_GENERAL:1700000005.000001': [
            { user: 'U_A', text: 'msg1', ts: '1700000005.000001', bot_id: undefined, reactions: [] },
            { user: 'U_B', text: 'msg2', ts: '1700000005.000002', bot_id: undefined, reactions: [] },
            { user: 'U_C', text: 'msg3', ts: '1700000005.000003', bot_id: undefined, reactions: [] },
            { user: 'U_D', text: 'msg4', ts: '1700000005.000004', bot_id: undefined, reactions: [] },
            { user: 'U_E', text: 'msg5', ts: '1700000005.000005', bot_id: undefined, reactions: [] },
            { user: 'U_BOT', text: 'bot noise', ts: '1700000005.000006', bot_id: 'B_SLEUTH', reactions: [] },
            { user: 'U_F', text: 'msg6', ts: '1700000005.000007', bot_id: undefined, reactions: [] },
            { user: 'U_REQUESTER', text: `${SlackApp.AppMentionString} list tasks`, ts: '1700000005.000008', bot_id: undefined, reactions: [] },
          ],
        },
      });

      await MultiTaskHandler.OnAppMentionAsync(SlackApp, {
        channel: 'C_GENERAL',
        user: 'U_REQUESTER',
        ts: '1700000005.000008',
        thread_ts: '1700000005.000001',
        text: `${SlackApp.AppMentionString} list tasks`,
      });

      expect(AIPipeline.ExtractMultiTaskCandidatesAsync).toHaveBeenCalledTimes(1);
      const PassedMessages = AIPipeline.ExtractMultiTaskCandidatesAsync.mock.calls[0][0];
      // All 6 human messages (+ triggering msg) are passed — bot excluded — NOT capped at 3
      const PassedTexts = PassedMessages.map((/** @type {any} */ m) => m.text);
      expect(PassedTexts).toContain('msg1');
      expect(PassedTexts).toContain('msg4');
      expect(PassedTexts).toContain('msg5');
      expect(PassedTexts).toContain('msg6');
      expect(PassedTexts).not.toContain('bot noise');
      // Must pass more than 3 preceding messages (proving no cap)
      expect(PassedMessages.length).toBeGreaterThan(4);
    });
  });

  // ─── HasSchedulingTrigger temporal-gate coverage (1.4.142, expanded 1.4.145) ──
  //
  // This gate sits in front of every auto-scheduling LLM call in #OnMessageAsync. A false
  // negative (legitimate reminder language not matched) silently drops a real request; a
  // false positive (non-temporal language matched) wastes an LLM call and risks the
  // hallucination class 1.4.142 was meant to fix. Both rows are asserted explicitly here.

  describe('HasSchedulingTrigger', () => {
    /** @type {string[]} */
    const ShouldMatch = [
      // Original 1.4.142 vocabulary — must still match after the 1.4.145 expansion.
      'finish the design doc tomorrow',
      'ship it today',
      'send by EOD',
      'before COB',
      'review next week',
      'this week sometime',
      'tonight if possible',
      'at noon',
      'by midnight',
      'first thing in the morning',
      'this afternoon works',
      'Friday morning',
      '10am',
      '3 pm',
      '10:30',
      '10:30am',
      // 1.4.145 recall fixes.
      'Send the contract on May 30',                              // calendar date, no preposition
      'meeting June 1st',                                          // calendar date with ordinal
      'kickoff September 14th',
      'review Dec 22',
      'due on the 15th',                                           // ordinal day-of-month
      'remind me on the 3rd',
      'in 2 hours',                                                // relative offset
      'in 30 minutes',
      'in a day',
      'in an hour',
      'next month',                                                // next/this/last <unit>
      'next year',
      'last Friday',
      'this Friday',
      'next Tuesday morning',
      'after the standup',                                         // 'after' keyword
      'after lunch',
      'please send the contract asap',                             // contextual 'asap'
      'review this asap',
      "<@UTARGET> fix this asap",
      'should have been done yesterday',                           // 'yesterday'
    ];

    /** @type {string[]} */
    const ShouldNotMatch = [
      // 1.4.145 false-positive fixes — bare digits without am/pm or hh:mm no longer trip the gate.
      'working on issue #15',
      'see chapter 3',
      'version 12 ships next quarter',     // "next quarter" is intentionally not matched
      'page 4 of the spec',
      'PR 99 looks good',
      // Original 1.4.142 motivating cases.
      "Here's the plugin zip. Please note I'm not done testing and polishing it.",
      'the goal is to be able to reactivate that plugin asap',
      'asap please',
      'thanks for the help',
      'looks good to me',
      '',
    ];

    test.each(ShouldMatch)('matches: %s', (ArgText) => {
      expect(Handler.HasSchedulingTrigger(ArgText)).toBe(true);
    });

    test.each(ShouldNotMatch)('does not match: %s', (ArgText) => {
      expect(Handler.HasSchedulingTrigger(ArgText)).toBe(false);
    });

    test('"may" as a modal verb is not falsely matched (only "May <day>" is)', () => {
      expect(Handler.HasSchedulingTrigger('I may add a feature later')).toBe(false);
      expect(Handler.HasSchedulingTrigger('Ship by May 30')).toBe(true);
    });
  });
});
