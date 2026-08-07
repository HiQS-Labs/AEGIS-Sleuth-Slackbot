'use strict';

const DateUtils = require('../src/date-utils');
const {
  BucketRemindersByDueDate,
  TruncateCompactSummary,
  MAX_COMPACT_SUMMARY_LENGTH,
  REMINDER_DUE_SECTIONS,
  ExtractCompactSummary,
  BuildCompactReminderLine,
  ToWebSafeSummary,
  BuildCompactTextForReminder,
} = require('../src/reminders-display-utils');

describe('TruncateCompactSummary', () => {
  test('returns short summaries unchanged', () => {
    const Short = 'Restore Production to Dev';
    expect(TruncateCompactSummary(Short)).toBe(Short);
  });

  test('returns a summary at exactly the limit unchanged (no ellipsis)', () => {
    const Exact = 'a'.repeat(MAX_COMPACT_SUMMARY_LENGTH);
    expect(TruncateCompactSummary(Exact)).toBe(Exact);
  });

  test('truncates long summaries with an ellipsis and trims trailing space', () => {
    const Long = `${'word '.repeat(60)}end`; // well over the limit
    const Result = TruncateCompactSummary(Long);
    expect(Result.endsWith('…')).toBe(true);
    expect(Result.length).toBeLessThanOrEqual(MAX_COMPACT_SUMMARY_LENGTH + 1);
    expect(Result).not.toMatch(/ …$/); // trailing space trimmed before ellipsis
  });

  test('does not sever a Slack token (<@mention> / <url|label>) mid-bracket', () => {
    // place a long mention token straddling the cut boundary.
    const Prefix = 'x'.repeat(MAX_COMPACT_SUMMARY_LENGTH - 5);
    const Long = `${Prefix} <@U07ALICE99|alice> tail`;
    const Result = TruncateCompactSummary(Long);
    // either the whole token survives, or it is dropped entirely — never a dangling '<'.
    const OpenCount = (Result.match(/</g) || []).length;
    const CloseCount = (Result.match(/>/g) || []).length;
    expect(OpenCount).toBe(CloseCount);
    expect(Result.endsWith('…')).toBe(true);
  });
});

describe('BucketRemindersByDueDate', () => {
  const TZ = 'America/Los_Angeles';
  /** Fixed "now": 2026-03-27 noon Pacific (PDT). */
  const FrozenNow = new Date('2026-03-27T19:00:00.000Z');

  let GetCurrentSpy;

  beforeEach(() => {
    GetCurrentSpy = jest.spyOn(DateUtils, 'GetCurrentDateInTimeZone').mockImplementation((argTz) =>
      DateUtils.GetLocalizedUtcDate(argTz, FrozenNow)
    );
  });

  afterEach(() => {
    GetCurrentSpy.mockRestore();
  });

  function MakeReminder(shouldPostOn) {
    return { ShouldPostOn: shouldPostOn, ReminderID: `r-${shouldPostOn.getTime()}` };
  }

  test('places only same-calendar-day dues in dueToday; tomorrow+ in dueUpcoming', () => {
    const Today = DateUtils.GetLocalizedUtcDate(TZ, FrozenNow);
    const StartOfToday = new Date(Today);
    StartOfToday.setUTCHours(0, 0, 0, 0);
    const StartOfTomorrow = new Date(StartOfToday);
    StartOfTomorrow.setUTCDate(StartOfTomorrow.getUTCDate() + 1);

    const DueLaterToday = MakeReminder(new Date(StartOfToday.getTime() + 2 * 60 * 60 * 1000));
    const DueTomorrow = MakeReminder(new Date(StartOfTomorrow.getTime() + 60 * 60 * 1000));

    const Result = BucketRemindersByDueDate([DueLaterToday, DueTomorrow], TZ);

    expect(Result.dueToday).toEqual([DueLaterToday]);
    expect(Result.dueUpcoming).toEqual([DueTomorrow]);
    expect(Result.dueLastWeek).toEqual([]);
    expect(Result.dueOlder).toEqual([]);
  });

  test('places overdue within 7 days in dueLastWeek; older in dueOlder', () => {
    const Today = DateUtils.GetLocalizedUtcDate(TZ, FrozenNow);
    const StartOfToday = new Date(Today);
    StartOfToday.setUTCHours(0, 0, 0, 0);
    const StartOf7DaysAgo = new Date(StartOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

    const DueYesterday = MakeReminder(new Date(StartOfToday.getTime() - 12 * 60 * 60 * 1000));
    const DueEightDaysAgo = MakeReminder(new Date(StartOf7DaysAgo.getTime() - 24 * 60 * 60 * 1000));

    const Result = BucketRemindersByDueDate([DueYesterday, DueEightDaysAgo], TZ);

    expect(Result.dueToday).toEqual([]);
    expect(Result.dueUpcoming).toEqual([]);
    expect(Result.dueLastWeek).toEqual([DueYesterday]);
    expect(Result.dueOlder).toEqual([DueEightDaysAgo]);
  });

  test('boundary: due exactly at StartOfTomorrow is upcoming, not today', () => {
    const Today = DateUtils.GetLocalizedUtcDate(TZ, FrozenNow);
    const StartOfToday = new Date(Today);
    StartOfToday.setUTCHours(0, 0, 0, 0);
    const StartOfTomorrow = new Date(StartOfToday);
    StartOfTomorrow.setUTCDate(StartOfTomorrow.getUTCDate() + 1);

    const AtTomorrowMidnight = MakeReminder(new Date(StartOfTomorrow.getTime()));

    const Result = BucketRemindersByDueDate([AtTomorrowMidnight], TZ);

    expect(Result.dueToday).toEqual([]);
    expect(Result.dueUpcoming).toEqual([AtTomorrowMidnight]);
  });
});

describe('REMINDER_DUE_SECTIONS', () => {
  test('keys match BucketRemindersByDueDate bucket names, in display order', () => {
    expect(REMINDER_DUE_SECTIONS.map(Section => Section.key))
      .toEqual(['dueToday', 'dueUpcoming', 'dueLastWeek', 'dueOlder']);
    expect(REMINDER_DUE_SECTIONS[1].label).toBe('*📆 Due after today*');
  });
});

describe('ExtractCompactSummary', () => {
  test('prefers the first bullet line', () => {
    const Text = '<@U123>, please follow up on this:\n• Ship the hotfix\nmore context';
    expect(ExtractCompactSummary(Text)).toBe('Ship the hotfix');
  });

  test('skips mention-led and follow-up lines when no bullet exists', () => {
    const Text = '<@U123>\nplease follow up on this\nReview the Client B connector page';
    expect(ExtractCompactSummary(Text)).toBe('Review the Client B connector page');
  });

  test('falls back to the first line when every line is a mention or follow-up', () => {
    const Text = '<@U123> please handle\nfollow up tomorrow';
    expect(ExtractCompactSummary(Text)).toBe('<@U123> please handle');
  });

  test('truncates to the compact max length', () => {
    const Result = ExtractCompactSummary('x'.repeat(MAX_COMPACT_SUMMARY_LENGTH + 50));
    expect(Result.length).toBeLessThanOrEqual(MAX_COMPACT_SUMMARY_LENGTH + 1); // +1 for the ellipsis
    expect(Result.endsWith('…')).toBe(true);
  });

  test('tolerates empty/undefined text', () => {
    expect(ExtractCompactSummary('')).toBe('');
    expect(ExtractCompactSummary(undefined)).toBe('');
  });
});

describe('ExtractCompactSummary — GH-337 Phase 3 quoted-original excerpt', () => {
  test('excerpts the first sentences of a quoted original, trims greeting/signoff edges, and ends with … when truncated', () => {
    const Text = 'Reminder for <@U1>:\n> Hi team,\n> Please migrate the production database this weekend. '
      + 'Back up the tables first. Then run the migration script. Finally verify the row counts.\n> Thanks!';
    const Result = ExtractCompactSummary(Text);
    expect(Result).toContain('migrate the production database');
    expect(Result).not.toMatch(/\bHi team\b/i);   // greeting edge trimmed (#29)
    expect(Result).not.toMatch(/\bThanks\b/i);    // signoff edge trimmed (#29)
    expect(Result.endsWith('…')).toBe(true);      // truncated → ellipsis
  });

  test('does not append an ellipsis when the whole quoted original fits (ellipsis only when truncated)', () => {
    const Text = 'Reminder:\n> Please deploy the hotfix to prod.';
    const Result = ExtractCompactSummary(Text);
    expect(Result).toBe('Please deploy the hotfix to prod.');
    expect(Result.endsWith('…')).toBe(false);
  });

  test('does not collapse a greeting-heavy short message to junk — floor keeps the real task (#193)', () => {
    const Text = 'Reminder:\n> Hey,\n> Ship it.\n> Thanks!';
    const Result = ExtractCompactSummary(Text);
    expect(Result).toContain('Ship it');
    expect(Result).not.toBe('');
  });

  test('prefers the synthesized Key task bullet over the quoted-original excerpt (prod bug 2026-07-14)', () => {
    // A long message keeps its full original in a blockquote AND gets a synthesized "Key task(s)"
    // bullet. The digest must show the clean task (what the confirmation showed), not the quote lead.
    const Text = '<@U08BHQEAX>, <@U000EXAMPLE1> - please follow up on <https://x|this>:\n'
      + '> I\'m starting plugin updates on ClientAcbd.com production based on our spreadsheet. '
      + 'I\'ll follow the same method we used before on Client C. '
      + 'sticking with major.minor versions we have already tested.\n\n'
      + 'Key task(s):\n• Get the Woocommerce plugins done';
    const Result = ExtractCompactSummary(Text);
    expect(Result).toBe('Get the Woocommerce plugins done');
    expect(Result).not.toMatch(/follow the same method|major\.minor/i); // quote lead must not win
  });
});

describe('BuildCompactReminderLine', () => {
  const BaseParts = {
    Label: 'A',
    Summary: 'Ship the hotfix',
    PermaLink: 'https://x.slack.com/archives/C1/p123',
    AgeDays: 3,
    TaggedUserMention: '<@U_TARGET>',
    ShouldPostOnMs: Date.UTC(2026, 5, 12, 12, 0, 0),
  };

  test('builds the canonical line with permalink-wrapped summary', () => {
    const Line = BuildCompactReminderLine(BaseParts);
    expect(Line).toBe(
      'A.) <https://x.slack.com/archives/C1/p123|Ship the hotfix> (3 days old) - <@U_TARGET> - ' +
      '<!date^1781265600^{date_short} {time}|Fri, 12 Jun 2026 12:00:00 GMT>'
    );
  });

  test('appends an arrow link instead when the summary contains Slack tokens', () => {
    const Line = BuildCompactReminderLine({ ...BaseParts, Summary: 'Ping <@U_OTHER> about it' });
    expect(Line).toContain('Ping <@U_OTHER> about it <https://x.slack.com/archives/C1/p123|↗︎>');
  });

  test('omits the age suffix for same-day reminders and the link for missing permalinks', () => {
    const Line = BuildCompactReminderLine({ ...BaseParts, PermaLink: null, AgeDays: 0 });
    expect(Line).toContain('A.) Ship the hotfix - <@U_TARGET> - ');
    expect(Line).not.toContain('days old');
    expect(Line).not.toContain('|↗︎>');
  });
});

describe('ToWebSafeSummary', () => {
  test('resolves user mentions to display names with @ prefix', () => {
    expect(ToWebSafeSummary('Ping <@U_OTHER> now', { U_OTHER: 'Mike' })).toBe('Ping @Mike now');
  });

  test('falls back to the raw ID when no name is known', () => {
    expect(ToWebSafeSummary('Ping <@U_OTHER> now')).toBe('Ping @U_OTHER now');
  });

  test('collapses labelled links, bare links, channel and special tokens', () => {
    expect(ToWebSafeSummary('See <https://x.test/page|the page> in <#C123|general>')).toBe('See the page in #general');
    expect(ToWebSafeSummary('Open <https://x.test/raw>')).toBe('Open https://x.test/raw');
    expect(ToWebSafeSummary('Due <!date^123^{date_short}|Jun 12>')).toBe('Due Jun 12');
  });
});

describe('BuildCompactTextForReminder (parity with the shared line builder)', () => {
  test('produces the same canonical line as before the refactor', async () => {
    const SlackApp = {
      WorkspaceInfo: { MAIN_TIMEZONE: 'UTC' },
      GetPermaLinkAsync: jest.fn().mockResolvedValue('https://x.slack.com/archives/C1/p123'),
    };
    const NowMs = Date.now();
    const Reminder = {
      ReminderMessageText: '<@U123>, please follow up on this:\n• Ship the hotfix',
      OriginalChannelID: 'C1',
      OriginalMessageID: '123.456',
      CreatedOn: new Date(NowMs - 3 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000), // safely > 3 days
      ShouldPostOn: new Date(Date.UTC(2026, 5, 12, 12, 0, 0)),
      AssigneeID: 'U_TARGET',
      OriginalSenderID: 'U_SENDER',
    };

    const Line = await BuildCompactTextForReminder(SlackApp, Reminder, 'B');

    expect(Line).toBe(
      'B.) <https://x.slack.com/archives/C1/p123|Ship the hotfix> (3 days old) - <@U_TARGET> - ' +
      '<!date^1781265600^{date_short} {time}|Fri, 12 Jun 2026 12:00:00 GMT>'
    );
    expect(SlackApp.GetPermaLinkAsync).toHaveBeenCalledWith('C1', '123.456');
  });
});
