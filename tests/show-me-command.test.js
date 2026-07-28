'use strict';

const HandleShowMeCommandAsync = require('../src/chat-commands/show-me-command');
const { FetchUserGitHubActivityAsync } = require('../src/chat-commands/show-me-command');

// ── Routing regex (copied from chat-module.js registration) ──────────────────
const SHOW_ME_PATTERN = /^show-me\s+(?:what\s+tasks?\s+)?(<@[UW][^>]+>)(?:\s+.*)?$/i;
const MY_TASKS_PATTERN = /^(?:what(?:'s|\s+are|\s+is)?\s+my\s+tasks?|show\s+me\s+my\s+tasks?|what\s+should\s+i\s+(?:work\s+on|do|focus\s+on)\s+today)\b/i;
const USER_TASKS_PATTERN = /^(?:what\s+(?:are|is)\s+(<@[UW][^>]+>)(?:'s?)?\s+tasks?|show\s+me\s+(<@[UW][^>]+>)(?:'s?)?\s+tasks?|what\s+should\s+(<@[UW][^>]+>)\s+(?:work\s+on|do|focus\s+on)\s+today)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @returns {import('../src/reminders-module').ReminderInfo} */
function MakeReminder(Overrides = {}) {
  return {
    ReminderID: 'r-' + Math.random().toString(36).slice(2),
    CreatedOn: new Date('2026-05-01T00:00:00Z'),
    ShouldPostOn: new Date('2026-06-02T09:00:00Z'),
    TargetChannelID: 'C_REMINDERS',
    OriginalChannelID: 'C_GENERAL',
    OriginalMessageID: '1000000000.000001',
    OriginalThreadTs: null,
    OriginalSenderID: 'U_SENDER',
    ReminderMessageText: 'Default task',
    IgnoreSnooze: false,
    AssigneeID: 'U_TARGET',
    GitHubUrls: null,
    State: 'scheduled',
    ...Overrides,
  };
}

function MakeEnv({ Reminders = [], AIResponse = null, AIError = null, WorkspaceInfo = {} } = {}) {
  const FullWorkspaceInfo = {
    MAIN_TIMEZONE: 'America/Los_Angeles',
    ...WorkspaceInfo,
  };
  const SlackApp = {
    Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    PostMessageTextAsync: jest.fn().mockResolvedValue(undefined),
    GetPermaLinkAsync: jest.fn().mockResolvedValue('https://slack.test/C_GENERAL/p1000000000000001'),
    WorkspaceInfo: FullWorkspaceInfo,
  };

  const DefaultAIResponse = {
    rankedReminders: Reminders.map(ArgReminder => ({
      ReminderID: ArgReminder.ReminderID,
      rationale: `Because ${ArgReminder.ReminderID} is next.`,
    })),
  };

  const MockProcessText = AIError
    ? jest.fn().mockRejectedValue(AIError)
    : jest.fn().mockResolvedValue(AIResponse || DefaultAIResponse);

  const WorkspaceAI = {
    ProcessMessageWithJsonResponseAsync: MockProcessText,
    ComplexModelName: 'gpt-4o',
  };

  const RemindersModule = { GetAllReminders: jest.fn().mockReturnValue(Reminders) };

  const EventInfo = { channel: 'C_GENERAL', ts: '1700000000.000001', user: 'U_ASKER', text: '' };

  return { SlackApp, WorkspaceAI, RemindersModule, EventInfo, MockProcessText };
}

function CallHandler(Env, ArgRawMention) {
  return HandleShowMeCommandAsync(
    Env.SlackApp,
    Env.EventInfo,
    ArgRawMention,
    { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule }
  );
}

function GetPostedTexts(Env) {
  return Env.SlackApp.PostMessageTextAsync.mock.calls.map(ArgCall => ArgCall[2]);
}

function GetReminderPosts(Env) {
  return Env.SlackApp.PostMessageTextAsync.mock.calls.filter(
    ArgCall => ArgCall[3]?.event_type === 'sleuth-ai-reminder-ids'
  );
}

// ── Pattern matching ──────────────────────────────────────────────────────────

describe('show-me command routing pattern', () => {
  test.each([
    ['show-me <@U000EXAMPLE1>', '<@U000EXAMPLE1>'],
    ['show-me <@U000EXAMPLE1|matthew>', '<@U000EXAMPLE1|matthew>'],
    ['show-me what tasks <@UABC123> should work on today', '<@UABC123>'],
    ['show-me what task <@UABC123> should work on today', '<@UABC123>'],
    ['show-me what tasks <@UABC123>', '<@UABC123>'],
    ['show-me <@W012AB3CD> should work on today', '<@W012AB3CD>'],
  ])('matches "%s" and captures "%s"', (Input, ExpectedCapture) => {
    const Match = Input.match(SHOW_ME_PATTERN);
    expect(Match).not.toBeNull();
    expect(Match[1]).toBe(ExpectedCapture);
  });

  test.each([
    'show-me',
    'show-me someone without a mention',
    'show-channel-model',
    'show me <@UABC123>',  // missing hyphen
  ])('does not match "%s"', (Input) => {
    expect(Input.match(SHOW_ME_PATTERN)).toBeNull();
  });
});

describe('"my tasks" self-referential routing pattern', () => {
  test.each([
    'what are my tasks',
    'what are my tasks?',
    "what's my tasks",
    'what is my task',
    'show me my tasks',
    'show me my task',
    'what should I work on today',
    'what should i do today',
    'what should I focus on today',
  ])('matches "%s"', (Input) => {
    expect(MY_TASKS_PATTERN.test(Input)).toBe(true);
  });

  test.each([
    'show-me <@UABC123>',          // original show-me route, not this alias
    'what are your tasks',         // wrong pronoun
    'list my tasks',               // different verb
    'what should I work on tomorrow', // not today
  ])('does not match "%s"', (Input) => {
    expect(MY_TASKS_PATTERN.test(Input)).toBe(false);
  });

  test('handler uses the caller\'s own user ID as the target when invoked via the my-tasks alias', async () => {
    const CallerUserId = 'UASKER001';
    const Env = MakeEnv({ Reminders: [MakeReminder({ AssigneeID: CallerUserId, State: 'overdue' })] });
    Env.EventInfo.user = CallerUserId;
    // Simulate the route handler: synthesise the mention from the event user.
    await HandleShowMeCommandAsync(
      Env.SlackApp,
      Env.EventInfo,
      `<@${CallerUserId}>`,
      { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule }
    );
    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
    // Loading message should mention the caller so they know it's their own tasks being shown.
    const LoadingMsg = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(LoadingMsg).toContain(`<@${CallerUserId}>`);
  });
});

describe('"what are @user tasks" third-person routing pattern', () => {
  test.each([
    ['what are <@UABC123> tasks', '<@UABC123>'],
    ["what are <@UABC123>'s tasks", '<@UABC123>'],
    ["what is <@UABC123>'s task", '<@UABC123>'],
    ['show me <@UABC123> tasks', '<@UABC123>'],
    ["show me <@UABC123>'s tasks", '<@UABC123>'],
    ['what should <@UABC123> work on today', '<@UABC123>'],
    ['what should <@UABC123> do today', '<@UABC123>'],
    ['what should <@UABC123> focus on today', '<@UABC123>'],
    ['what are <@W012AB3CD> tasks', '<@W012AB3CD>'],
  ])('matches "%s" and captures "%s"', (Input, ExpectedMention) => {
    const Match = Input.match(USER_TASKS_PATTERN);
    expect(Match).not.toBeNull();
    // Exactly one of the three alternation groups captures the mention.
    const Captured = Match[1] || Match[2] || Match[3];
    expect(Captured).toBe(ExpectedMention);
  });

  test.each([
    'what are my tasks',                // self-referential, handled by MY_TASKS_PATTERN
    'show-me <@UABC123>',              // original show-me route
    'what are <@UABC123> doing',       // wrong noun (not tasks)
    'what should <@UABC123> work on tomorrow', // not today
  ])('does not match "%s"', (Input) => {
    expect(USER_TASKS_PATTERN.test(Input)).toBe(false);
  });

  test('handler resolves the mentioned user ID as the target', async () => {
    const TargetUserId = 'UTARGET01';
    const Env = MakeEnv({ Reminders: [MakeReminder({ AssigneeID: TargetUserId, State: 'due' })] });
    await HandleShowMeCommandAsync(
      Env.SlackApp,
      Env.EventInfo,
      `<@${TargetUserId}>`,
      { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule }
    );
    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
    const LoadingMsg = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(LoadingMsg).toContain(`<@${TargetUserId}>`);
  });
});

// ── Handler: guard cases ──────────────────────────────────────────────────────

describe('HandleShowMeCommandAsync — guard cases', () => {
  test('replies with an unavailable message when RemindersModule is null', async () => {
    const SlackApp = {
      Logger: { error: jest.fn() },
      PostMessageTextAsync: jest.fn().mockResolvedValue(undefined),
    };
    await HandleShowMeCommandAsync(
      SlackApp,
      { channel: 'C_GENERAL', ts: '1700000000.000001' },
      '<@UABC123>',
      { WorkspaceAI: {}, RemindersModule: null }
    );
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_GENERAL',
      '1700000000.000001',
      expect.stringContaining('unavailable')
    );
  });

  test('replies with a usage hint when the mention cannot be parsed', async () => {
    const Env = MakeEnv();
    await CallHandler(Env, 'not-a-mention');
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      Env.EventInfo.channel,
      Env.EventInfo.ts,
      expect.stringContaining('@mention')
    );
    expect(Env.RemindersModule.GetAllReminders).not.toHaveBeenCalled();
  });

  test('does not call the AI when the mention is missing', async () => {
    const Env = MakeEnv();
    await CallHandler(Env, 'no-uid-here');
    expect(Env.MockProcessText).not.toHaveBeenCalled();
  });
});

// ── Handler: empty results ────────────────────────────────────────────────────

describe('HandleShowMeCommandAsync — empty results', () => {
  test('posts a deterministic no-reminders reply and skips the AI when the user has no open reminders', async () => {
    const Env = MakeEnv({ Reminders: [] });
    await CallHandler(Env, '<@U000EXAMPLE1>');
    expect(Env.MockProcessText).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      Env.EventInfo.channel,
      Env.EventInfo.ts,
      expect.stringContaining('<@U000EXAMPLE1>')
    );
  });

  test('treats reminders in terminal states (completed, canceled) as absent', async () => {
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: 'U000EXAMPLE1', State: 'completed' }),
        MakeReminder({ AssigneeID: 'U000EXAMPLE1', State: 'canceled' }),
        MakeReminder({ AssigneeID: 'U000EXAMPLE1', State: 'posted' }),
      ],
    });
    await CallHandler(Env, '<@U000EXAMPLE1>');
    expect(Env.MockProcessText).not.toHaveBeenCalled();
  });

  test('excludes reminders assigned to a different user', async () => {
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: 'U_OTHER', State: 'overdue' }),
        MakeReminder({ AssigneeID: 'U_OTHER', State: 'due' }),
      ],
    });
    await CallHandler(Env, '<@U000EXAMPLE1>');
    expect(Env.MockProcessText).not.toHaveBeenCalled();
  });
});

// ── Handler: AI ranking path ──────────────────────────────────────────────────

describe('HandleShowMeCommandAsync — AI ranking', () => {
  test('passes all active-state reminders for the target user to the AI', async () => {
    const TargetId = 'U000EXAMPLE1';
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: TargetId, State: 'overdue', ReminderMessageText: 'Fix the login bug' }),
        MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: 'Review PR #42' }),
        MakeReminder({ AssigneeID: TargetId, State: 'snoozed', ReminderMessageText: 'Update docs' }),
        MakeReminder({ AssigneeID: 'U_UNRELATED', State: 'overdue', ReminderMessageText: 'Should be excluded' }),
        MakeReminder({ AssigneeID: TargetId, State: 'completed', ReminderMessageText: 'Should be excluded too' }),
      ],
    });

    await CallHandler(Env, `<@${TargetId}>`);

    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).toContain('Fix the login bug');
    expect(PromptText).toContain('Review PR #42');
    expect(PromptText).toContain('Update docs');
    expect(PromptText).not.toContain('Should be excluded');
  });

  test('includes GitHub URLs in the AI prompt when the reminder carries them', async () => {
    const TargetId = 'UABC123';
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({
          AssigneeID: TargetId,
          State: 'overdue',
          ReminderMessageText: 'Finish the PR',
          GitHubUrls: ['https://github.com/org/repo/pull/77'],
        }),
      ],
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).toContain('https://github.com/org/repo/pull/77');
  });

  test('includes today\'s date in the AI prompt', async () => {
    const TargetId = 'UABC123';
    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })],
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).toContain('Today is');
  });

  test('posts a loading message before calling the AI', async () => {
    const TargetId = 'UABC123';
    const Reminder = MakeReminder({ AssigneeID: TargetId, State: 'due' });
    const Env = MakeEnv({
      Reminders: [Reminder],
    });

    const PostOrder = [];
    Env.SlackApp.PostMessageTextAsync.mockImplementation(async (_Ch, _Ts, Text) => {
      PostOrder.push(Text);
    });
    Env.MockProcessText.mockImplementation(async () => {
      PostOrder.push('__AI_CALLED__');
      return {
        rankedReminders: [
          { ReminderID: Reminder.ReminderID, rationale: 'Due now.' },
        ],
      };
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const LoadingIndex = PostOrder.findIndex(T => T.includes('hourglass'));
    const AiIndex = PostOrder.indexOf('__AI_CALLED__');
    expect(LoadingIndex).toBeGreaterThanOrEqual(0);
    expect(LoadingIndex).toBeLessThan(AiIndex);
  });

  test('renders ranked reminders as reactable bucketed reminder posts with rationale sub-lines', async () => {
    const TargetId = 'UABC123';
    const Reminder = MakeReminder({ AssigneeID: TargetId, State: 'overdue', ReminderMessageText: 'Fix the login bug' });
    const Env = MakeEnv({
      Reminders: [Reminder],
      AIResponse: {
        rankedReminders: [
          { ReminderID: Reminder.ReminderID, rationale: 'It is overdue and blocks progress.' },
        ],
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const ReminderPosts = GetReminderPosts(Env);
    expect(ReminderPosts).toHaveLength(1);
    expect(ReminderPosts[0][2]).toContain('Fix the login bug');
    expect(ReminderPosts[0][2]).toContain('↳ It is overdue and blocks progress.');
    expect(ReminderPosts[0][2]).toContain('https://slack.test/');
    expect(ReminderPosts[0][3]).toEqual({
      event_type: 'sleuth-ai-reminder-ids',
      event_payload: { ReminderIDs: JSON.stringify([Reminder.ReminderID]) },
    });
  });

  test('keeps AI priority order within due-date buckets and caps output at the top 5 reminders', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00Z'));

    try {
      const TargetId = 'UABC123';
      const Reminders = [
        MakeReminder({
          ReminderID: 'r-today-1',
          AssigneeID: TargetId,
          ReminderMessageText: 'Today first',
          ShouldPostOn: new Date('2026-07-03T18:00:00Z'),
        }),
        MakeReminder({
          ReminderID: 'r-today-2',
          AssigneeID: TargetId,
          ReminderMessageText: 'Today second',
          ShouldPostOn: new Date('2026-07-03T19:00:00Z'),
        }),
        MakeReminder({
          ReminderID: 'r-upcoming-1',
          AssigneeID: TargetId,
          ReminderMessageText: 'Tomorrow first',
          State: 'scheduled',
          ShouldPostOn: new Date('2026-07-04T18:00:00Z'),
        }),
        MakeReminder({
          ReminderID: 'r-upcoming-2',
          AssigneeID: TargetId,
          ReminderMessageText: 'Tomorrow second',
          State: 'scheduled',
          ShouldPostOn: new Date('2026-07-05T18:00:00Z'),
        }),
        MakeReminder({
          ReminderID: 'r-overdue',
          AssigneeID: TargetId,
          ReminderMessageText: 'Yesterday overdue',
          State: 'overdue',
          ShouldPostOn: new Date('2026-07-02T18:00:00Z'),
        }),
        MakeReminder({
          ReminderID: 'r-trimmed',
          AssigneeID: TargetId,
          ReminderMessageText: 'Should be trimmed out',
          State: 'scheduled',
          ShouldPostOn: new Date('2026-07-06T18:00:00Z'),
        }),
      ];
      const Env = MakeEnv({
        Reminders,
        AIResponse: {
          rankedReminders: [
            { ReminderID: 'r-today-2', rationale: 'Highest today.' },
            { ReminderID: 'r-today-1', rationale: 'Second today.' },
            { ReminderID: 'r-upcoming-2', rationale: 'Higher future priority.' },
            { ReminderID: 'r-upcoming-1', rationale: 'Lower future priority.' },
            { ReminderID: 'r-overdue', rationale: 'Older bucket.' },
            { ReminderID: 'r-trimmed', rationale: 'Falls outside top five.' },
          ],
        },
      });

      await CallHandler(Env, `<@${TargetId}>`);

      const ReminderPosts = GetReminderPosts(Env);
      expect(ReminderPosts).toHaveLength(5);
      expect(ReminderPosts.map(ArgCall => ArgCall[2])).toEqual([
        expect.stringContaining('Today second'),
        expect.stringContaining('Today first'),
        expect.stringContaining('Tomorrow second'),
        expect.stringContaining('Tomorrow first'),
        expect.stringContaining('Yesterday overdue'),
      ]);
      expect(ReminderPosts.map(ArgCall => ArgCall[3]?.event_payload?.ReminderIDs)).toEqual([
        JSON.stringify(['r-today-2']),
        JSON.stringify(['r-today-1']),
        JSON.stringify(['r-upcoming-2']),
        JSON.stringify(['r-upcoming-1']),
        JSON.stringify(['r-overdue']),
      ]);
      expect(ReminderPosts.map(ArgCall => ArgCall[2]).join('\n')).not.toContain('Should be trimmed out');

      const PostedTexts = GetPostedTexts(Env);
      const DueTodayIndex = PostedTexts.findIndex(ArgText => ArgText === '*📅 Due Today*');
      const UpcomingIndex = PostedTexts.findIndex(ArgText => ArgText === '*📆 Due after today*');
      const OverdueIndex = PostedTexts.findIndex(ArgText => ArgText === '*⚠️ Due within last 7 days*');
      expect(DueTodayIndex).toBeGreaterThanOrEqual(0);
      expect(UpcomingIndex).toBeGreaterThan(DueTodayIndex);
      expect(OverdueIndex).toBeGreaterThan(UpcomingIndex);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Handler: AI error path ────────────────────────────────────────────────────

describe('HandleShowMeCommandAsync — AI failure', () => {
  test('falls back to deterministic reminder rendering when the AI call throws', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00Z'));

    try {
      const TargetId = 'UABC123';
      const TodayReminder = MakeReminder({
        ReminderID: 'r-today',
        AssigneeID: TargetId,
        State: 'due',
        ReminderMessageText: 'Ship today task',
        ShouldPostOn: new Date('2026-07-03T17:00:00Z'),
      });
      const OverdueReminder = MakeReminder({
        ReminderID: 'r-overdue',
        AssigneeID: TargetId,
        State: 'overdue',
        ReminderMessageText: 'Clean up yesterday task',
        ShouldPostOn: new Date('2026-07-02T17:00:00Z'),
      });
      const Env = MakeEnv({
        Reminders: [OverdueReminder, TodayReminder],
        AIError: new Error('Provider timeout'),
      });

      await CallHandler(Env, `<@${TargetId}>`);

      expect(Env.SlackApp.Logger.warn).toHaveBeenCalled();
      const ReminderPosts = GetReminderPosts(Env);
      expect(ReminderPosts).toHaveLength(2);
      expect(ReminderPosts[0][2]).toContain('Ship today task');
      expect(ReminderPosts[1][2]).toContain('Clean up yesterday task');
      expect(ReminderPosts[0][2]).not.toContain('↳');
    } finally {
      jest.useRealTimers();
    }
  });

  test('does not re-throw when the AI call throws', async () => {
    const TargetId = 'UABC123';
    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })],
      AIError: new Error('Provider timeout'),
    });

    await expect(CallHandler(Env, `<@${TargetId}>`)).resolves.toBeUndefined();
  });

  test('falls back when the AI response drops or duplicates reminder IDs', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00Z'));

    try {
      const TargetId = 'UABC123';
      const ReminderA = MakeReminder({
        ReminderID: 'r-alpha',
        AssigneeID: TargetId,
        State: 'due',
        ReminderMessageText: 'Today priority',
        ShouldPostOn: new Date('2026-07-03T18:00:00Z'),
      });
      const ReminderB = MakeReminder({
        ReminderID: 'r-bravo',
        AssigneeID: TargetId,
        State: 'scheduled',
        ReminderMessageText: 'Tomorrow priority',
        ShouldPostOn: new Date('2026-07-04T18:00:00Z'),
      });
      const Env = MakeEnv({
        Reminders: [ReminderA, ReminderB],
        AIResponse: {
          rankedReminders: [
            { ReminderID: ReminderA.ReminderID, rationale: 'Due soon.' },
            { ReminderID: ReminderA.ReminderID, rationale: 'Duplicate id should fail validation.' },
          ],
        },
      });

      await CallHandler(Env, `<@${TargetId}>`);

      expect(Env.SlackApp.Logger.warn).toHaveBeenCalled();
      const ReminderPosts = GetReminderPosts(Env);
      expect(ReminderPosts).toHaveLength(2);
      expect(ReminderPosts[0][2]).toContain('Today priority');
      expect(ReminderPosts[1][2]).toContain('Tomorrow priority');
      expect(ReminderPosts[0][2]).not.toContain('↳');
      expect(ReminderPosts[1][2]).not.toContain('↳');
    } finally {
      jest.useRealTimers();
    }
  });

  test('falls back when the AI response hallucinates a reminder ID that was not in the input set', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00Z'));

    try {
      const TargetId = 'UABC123';
      const ReminderA = MakeReminder({
        ReminderID: 'r-alpha',
        AssigneeID: TargetId,
        State: 'due',
        ReminderMessageText: 'Today priority',
        ShouldPostOn: new Date('2026-07-03T18:00:00Z'),
      });
      const ReminderB = MakeReminder({
        ReminderID: 'r-bravo',
        AssigneeID: TargetId,
        State: 'scheduled',
        ReminderMessageText: 'Tomorrow priority',
        ShouldPostOn: new Date('2026-07-04T18:00:00Z'),
      });
      const Env = MakeEnv({
        Reminders: [ReminderA, ReminderB],
        AIResponse: {
          rankedReminders: [
            { ReminderID: ReminderA.ReminderID, rationale: 'Due soon.' },
            { ReminderID: 'r-invented', rationale: 'This id should force fallback.' },
          ],
        },
      });

      await CallHandler(Env, `<@${TargetId}>`);

      expect(Env.SlackApp.Logger.warn).toHaveBeenCalled();
      const ReminderPosts = GetReminderPosts(Env);
      expect(ReminderPosts).toHaveLength(2);
      expect(ReminderPosts[0][2]).toContain('Today priority');
      expect(ReminderPosts[1][2]).toContain('Tomorrow priority');
      expect(ReminderPosts[0][2]).not.toContain('↳');
      expect(ReminderPosts[1][2]).not.toContain('↳');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Handler: GitHub activity enrichment (Phase 2) ─────────────────────────────

describe('HandleShowMeCommandAsync — GitHub activity enrichment', () => {
  afterEach(() => {
    // restore global fetch after each test that may have overridden it.
    if(global.fetch && global.fetch.mockRestore) {
      global.fetch.mockRestore();
    }
    delete global.fetch;
  });

  test('skips GitHub fetch when GITHUB_USER_MAP is not in WorkspaceInfo', async () => {
    const TargetId = 'UABC123';
    const FetchSpy = jest.fn();
    global.fetch = FetchSpy;

    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })],
      WorkspaceInfo: { GITHUB_PAT: 'ghp_test123' },
      // no GITHUB_USER_MAP
    });

    await CallHandler(Env, `<@${TargetId}>`);

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
  });

  test('skips GitHub fetch when GITHUB_PAT is absent', async () => {
    const TargetId = 'UABC123';
    const FetchSpy = jest.fn();
    global.fetch = FetchSpy;

    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })],
      WorkspaceInfo: { GITHUB_USER_MAP: `{"${TargetId}": "devuser"}` },
      // no GITHUB_PAT
    });

    await CallHandler(Env, `<@${TargetId}>`);

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
  });

  test('skips GitHub fetch when the target user is not in GITHUB_USER_MAP', async () => {
    const TargetId = 'UABC123';
    const FetchSpy = jest.fn();
    global.fetch = FetchSpy;

    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: '{"UOTHER999": "otherdev"}',
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
  });

  test('includes GitHub activity in the AI prompt when map and PAT are present', async () => {
    const TargetId = 'UABC123';

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Fix auth flow', html_url: 'https://github.com/org/repo/pull/99' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Review deploy script', html_url: 'https://github.com/org/repo/pull/100' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { type: 'PushEvent', created_at: new Date().toISOString(), repo: { name: 'org/repo' } },
        ]),
      });

    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'overdue', ReminderMessageText: 'Deploy the fix' })],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: `{"${TargetId}": "devuser"}`,
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).toContain('GitHub activity');
    expect(PromptText).toContain('Fix auth flow');
    expect(PromptText).toContain('Review deploy script');
    expect(PromptText).toContain('org/repo');
  });

  test('falls back to Phase 1 prompt (no GitHub section) when all fetches return null', async () => {
    const TargetId = 'UABC123';

    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });

    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: 'Write tests' })],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: `{"${TargetId}": "devuser"}`,
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).not.toContain('GitHub activity');
    expect(PromptText).toContain('Write tests');
  });

  test('falls back gracefully when GitHub fetch throws', async () => {
    const TargetId = 'UABC123';

    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: 'Write tests' })],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: `{"${TargetId}": "devuser"}`,
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    // should not crash and should still call AI.
    expect(Env.MockProcessText).toHaveBeenCalledTimes(1);
    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).not.toContain('GitHub activity');
  });
});

// ── FetchUserGitHubActivityAsync unit tests ───────────────────────────────────

describe('FetchUserGitHubActivityAsync', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('returns null when all three requests fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });

    const Result = await FetchUserGitHubActivityAsync('ghp_test', 'devuser');

    expect(Result).toBeNull();
  });

  test('returns activity data when at least one request succeeds', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'My PR', html_url: 'https://github.com/org/repo/pull/1' }] }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const Result = await FetchUserGitHubActivityAsync('ghp_test', 'devuser');

    expect(Result).not.toBeNull();
    expect(Result.OpenPRs).toEqual(['My PR (https://github.com/org/repo/pull/1)']);
    expect(Result.ReviewRequested).toEqual([]);
    expect(Result.RecentRepos).toEqual([]);
  });

  test('extracts repos from PushEvents within the cutoff window', async () => {
    const RecentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const OldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { type: 'PushEvent', created_at: RecentDate, repo: { name: 'org/active-repo' } },
          { type: 'PushEvent', created_at: OldDate, repo: { name: 'org/old-repo' } },
          { type: 'IssueCommentEvent', created_at: RecentDate, repo: { name: 'org/comment-repo' } },
        ]),
      });

    const Result = await FetchUserGitHubActivityAsync('ghp_test', 'devuser', 7);

    expect(Result.RecentRepos).toEqual(['org/active-repo']);
    expect(Result.RecentRepos).not.toContain('org/old-repo');
    expect(Result.RecentRepos).not.toContain('org/comment-repo');
  });

  test('deduplicates repeated pushes to the same repo', async () => {
    const RecentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { type: 'PushEvent', created_at: RecentDate, repo: { name: 'org/repo' } },
          { type: 'PushEvent', created_at: RecentDate, repo: { name: 'org/repo' } },
        ]),
      });

    const Result = await FetchUserGitHubActivityAsync('ghp_test', 'devuser', 7);

    expect(Result.RecentRepos).toEqual(['org/repo']);
  });
});

// ── Handler: Phase 3 synthesis hardening ─────────────────────────────────────

describe('HandleShowMeCommandAsync — Phase 3 synthesis', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('annotates a reminder with [Active PR] when its GitHub URL matches an open PR', async () => {
    const TargetId = 'UABC123';
    const PrUrl = 'https://github.com/org/repo/pull/42';

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Fix auth flow', html_url: PrUrl }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([]) });

    const Env = MakeEnv({
      Reminders: [
        MakeReminder({
          AssigneeID: TargetId,
          State: 'overdue',
          ReminderMessageText: 'Finish the auth PR',
          GitHubUrls: [PrUrl],
        }),
      ],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: `{"${TargetId}": "devuser"}`,
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).toContain('"HasActivePR": true');
  });

  test('does not annotate a reminder whose GitHub URL is not in the open PR list', async () => {
    const TargetId = 'UABC123';

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Different PR', html_url: 'https://github.com/org/repo/pull/99' }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([]) });

    const Env = MakeEnv({
      Reminders: [
        MakeReminder({
          AssigneeID: TargetId,
          State: 'due',
          ReminderMessageText: 'Review the deploy script',
          GitHubUrls: ['https://github.com/org/repo/pull/77'],
        }),
      ],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: `{"${TargetId}": "devuser"}`,
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).not.toContain('[Active PR]');
  });

  test('reminder-only path produces no [Active PR] annotations when enrichment is absent', async () => {
    const TargetId = 'UABC123';
    // no WorkspaceInfo — enrichment skipped.
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({
          AssigneeID: TargetId,
          State: 'overdue',
          ReminderMessageText: 'Ship the hotfix',
          GitHubUrls: ['https://github.com/org/repo/pull/55'],
        }),
      ],
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    expect(PromptText).not.toContain('[Active PR]');
    expect(PromptText).not.toContain('GitHub activity');
  });

  test('only annotates reminders whose URLs overlap with open PRs, not review-requested PRs', async () => {
    const TargetId = 'UABC123';
    const AuthoredPrUrl = 'https://github.com/org/repo/pull/10';
    const ReviewRequestedUrl = 'https://github.com/org/repo/pull/20';

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'My PR', html_url: AuthoredPrUrl }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Other PR', html_url: ReviewRequestedUrl }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ([]) });

    const Env = MakeEnv({
      Reminders: [
        MakeReminder({
          AssigneeID: TargetId,
          State: 'due',
          ReminderMessageText: 'Authored task',
          GitHubUrls: [AuthoredPrUrl],
        }),
        MakeReminder({
          AssigneeID: TargetId,
          State: 'due',
          ReminderMessageText: 'Review task',
          GitHubUrls: [ReviewRequestedUrl],
        }),
      ],
      WorkspaceInfo: {
        GITHUB_PAT: 'ghp_test123',
        GITHUB_USER_MAP: `{"${TargetId}": "devuser"}`,
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const [PromptText] = Env.MockProcessText.mock.calls[0];
    // only authored PRs are in the OpenPRs set — only that reminder gets HasActivePR=true.
    const Lines = PromptText.split('\n');
    const AuthoredIndex = Lines.findIndex(L => L.includes('"Task": "Authored task"'));
    const ReviewIndex = Lines.findIndex(L => L.includes('"Task": "Review task"'));
    const AuthoredSlice = Lines.slice(AuthoredIndex, AuthoredIndex + 6).join('\n');
    const ReviewSlice = Lines.slice(ReviewIndex, ReviewIndex + 6).join('\n');
    expect(AuthoredSlice).toContain('"HasActivePR": true');
    expect(ReviewSlice).toContain('"HasActivePR": false');
  });
});
