'use strict';

const fs = require('fs').promises;
const path = require('path');

jest.mock('../src/workspace-ai');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');

const { StripQuotedText, IgnoreQuotedText, IsQuotedTextIgnoreEnabled } = require('../src/quoted-text');
const RemindersAIPipeline = require('../src/reminders-ai-pipeline');
const ReminderJudgement = require('../src/reminder-judgement');
const RemindersModule = require('../src/reminders-module');
const workspaces = require('../src/workspaces');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const FLAG = 'REMINDER_IGNORE_QUOTED_TEXT';

function WithFlag(ArgValue, ArgFn) {
  const Prior = process.env[FLAG];
  if(ArgValue === undefined) delete process.env[FLAG]; else process.env[FLAG] = ArgValue;
  const Restore = () => { if(Prior === undefined) delete process.env[FLAG]; else process.env[FLAG] = Prior; };
  try {
    const Result = ArgFn();
    if(Result && typeof Result.then === 'function') return Result.finally(Restore);
    Restore();
    return Result;
  } catch(error) { Restore(); throw error; }
}

describe('StripQuotedText', () => {
  test.each([
    // [input, expected]
    ['let\'s go to the races tomorrow at 8 am "in quotes like this"', "let's go to the races tomorrow at 8 am"],
    ['"in quotes" go to the races tomorrow', 'go to the races tomorrow'],
    ['ship it "by friday" and "also monday" tomorrow', 'ship it and tomorrow'],
    ['curly “tomorrow at 9” quotes', 'curly quotes'],
    ['guillemets «tomorrow at 9» too', 'guillemets too'],
    ['mixed "straight" and “curly”', 'mixed and'],
    ['check this:\n"line one\nline two tomorrow"\nthanks', 'check this:\n\nthanks'],
  ])('removes quoted spans: %s', (ArgInput, ArgExpected) => {
    expect(StripQuotedText(ArgInput)).toBe(ArgExpected);
  });

  test.each([
    ['no quotes at all, deploy tomorrow'],
    ["apostrophes aren't quotes: I'll ship today's build"],
    ["single 'quotes' are left alone, ship tomorrow"],
    ['a 12" monitor arrives tomorrow'],
    ['a lone stray " quote, ship tomorrow'],
    ['unbalanced "quote with the deploy tomorrow'],
    ['ship tomorrow "'],
  ])('leaves text intact: %s', (ArgInput) => {
    expect(StripQuotedText(ArgInput)).toBe(ArgInput);
  });

  test('an inch mark does not swallow a later real quote', () => {
    expect(StripQuotedText('a 12" pipe and "extra words" arrive tomorrow')).toBe('a 12" pipe and arrive tomorrow');
  });

  test('a message that is only a quote becomes empty', () => {
    expect(StripQuotedText('"I will ship it tomorrow at 9"')).toBe('');
  });

  test("Noel's example: the quoted deploy sentence is removed, the sender's own words remain", () => {
    const Message = '<@U_JOSE> please check if this a valid issue: "One thing that matters for today\'s deploy: last night\'s ' +
      'job failed. So the full test suite still isn\'t running ahead of the 3:30 PM window."';
    expect(StripQuotedText(Message)).toBe('<@U_JOSE> please check if this a valid issue:');
  });

  test('non-string input is tolerated', () => {
    expect(StripQuotedText(undefined)).toBe('');
    expect(StripQuotedText(null)).toBe('');
  });
});

describe('kill switch REMINDER_IGNORE_QUOTED_TEXT', () => {
  test.each([[undefined, true], ['', true], ['on', true], ['true', true],
    ['off', false], ['OFF', false], ['false', false], ['0', false], ['no', false], ['disabled', false],
  ])('value %p -> enabled=%p', (ArgValue, ArgExpected) => {
    WithFlag(ArgValue, () => expect(IsQuotedTextIgnoreEnabled()).toBe(ArgExpected));
  });

  test('IgnoreQuotedText honours it; StripQuotedText does not', () => {
    WithFlag('off', () => {
      expect(IgnoreQuotedText('go "x" tomorrow')).toBe('go "x" tomorrow');
      expect(StripQuotedText('go "x" tomorrow')).toBe('go tomorrow');
    });
  });
});

describe('RemindersAIPipeline — quoted text never reaches the analyzer', () => {
  let Pipeline;
  let AI;
  beforeEach(() => {
    AI = { ProcessMessageWithJsonResponseAsync: jest.fn(), ComplexModelName: 'gpt-4o' };
    AI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({ recommendation: 'schedule', rationale: 'r', reminders: [] });
    Pipeline = new RemindersAIPipeline(AI, new MockSlackApp(), jest.fn(() => []));
  });

  test('the model receives the message without its quoted span', async () => {
    await Pipeline.AnalyzeMessageForRemindersAsync('go to the races tomorrow at 8 am "in quotes like this"');
    expect(AI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toBe('go to the races tomorrow at 8 am');
  });

  test('a message with nothing but a quote is ignored with no model call', async () => {
    const Result = await Pipeline.AnalyzeMessageForRemindersAsync('"I will ship it tomorrow at 9"');
    expect(Result).toMatchObject({ recommendation: 'ignore', reminders: [] });
    expect(AI.ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
  });

  test('force mode (explicit force-schedule) sends the whole message', async () => {
    await Pipeline.AnalyzeMessageForRemindersAsync('go "to the races" tomorrow', { Mode: 'force' });
    expect(AI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toBe('go "to the races" tomorrow');
  });

  test('an unquoted message is passed through byte-for-byte', async () => {
    await Pipeline.AnalyzeMessageForRemindersAsync("I'll deploy the hotfix tomorrow morning");
    expect(AI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toBe("I'll deploy the hotfix tomorrow morning");
  });

  test('kill switch off restores the previous behaviour', async () => {
    await WithFlag('off', () => Pipeline.AnalyzeMessageForRemindersAsync('go "to the races" tomorrow'));
    expect(AI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toBe('go "to the races" tomorrow');
  });

  test('the deterministic direct-ask fallback ignores a time that exists only inside quotes', () => {
    expect(ReminderJudgement.DetectDirectAskWithTimeTrigger('please review "the plan for tomorrow"')).toBeNull();
    expect(ReminderJudgement.DetectDirectAskWithTimeTrigger('please review the plan tomorrow "for context"'))
      .toMatchObject({ trigger: 'tomorrow' });
  });
});

// ─── end-to-end through RemindersModule + MockSlackApp ────────────────────────────────────────

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0, IncomingMessageLength: 0, OutgoingMessageCount: 0, OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0, OutgoingGptMessageLength: 0, IncomingGptMessageCount: 0, IncomingGptMessageLength: 0,
};

function MakeWorkspaceInfo(ArgSuffix) {
  return {
    WORKSPACE_NAME: `QuotedText_${ArgSuffix}`,
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test', LIVE_SIGNING_SECRET: 'secret', LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test', REMINDER_CHANNEL_NAME: 'test-reminders', MAIN_TIMEZONE: 'America/Los_Angeles',
  };
}

async function CleanupAsync(ArgWorkspaceName) {
  const RemindersDir = workspaces.GetSubdirPath('reminders');
  const EventsDir = workspaces.GetSubdirPath('events');
  await fs.mkdir(RemindersDir, { recursive: true });
  await Promise.all([
    `${ArgWorkspaceName}_reminders.json`, `${ArgWorkspaceName}_reminder_counter.json`,
    `${ArgWorkspaceName}_enabled_channels.json`, `${ArgWorkspaceName}_completed.json`,
  ].map(ArgName => fs.rm(path.join(RemindersDir, ArgName), { force: true }))
    .concat(fs.rm(path.join(EventsDir, `${ArgWorkspaceName}_events.jsonl`), { force: true })));
}

const WasScheduled = (ArgSlackApp) =>
  ArgSlackApp.SentMessages.some(ArgMessage => /Slack reminder.*been scheduled/.test(ArgMessage.text));

/** The message texts the reminder ANALYZER (not the date extractor) was asked about. */
const AnalyzedTexts = (ArgMockProcess) => ArgMockProcess.mock.calls
  .filter(ArgCall => !ArgCall[0].includes('BASE DATE:') && ArgCall[2]?.name !== 'manual_reminder_task_response')
  .map(ArgCall => ArgCall[0]);

describe('quoted text is ignored end-to-end (RemindersModule + MockSlackApp)', () => {
  async function RunDmAsync(ArgSuffix, ArgText) {
    const WorkspaceInfo = MakeWorkspaceInfo(ArgSuffix);
    const MockProcess = ConfigureMockWorkspaceAI(MockWorkspaceAI);
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    const Reminders = new RemindersModule(SlackApp);
    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync(EmptyWorkspaceStats);
      await SlackApp.SimulateMessageAsync({ channel: 'D_DM', user: 'U_NOEL', text: ArgText, channel_type: 'im' });
      return { SlackApp, MockProcess };
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  }

  test("Noel's pasted-quote case: a time that lives only inside the quote creates no reminder", async () => {
    const { SlackApp, MockProcess } = await RunDmAsync('pasted_quote',
      '<@U_JOSE> please check if this a valid issue: "One thing that matters for today\'s deploy: the job failed, ' +
      'so the full test suite still isn\'t running ahead of the 3:30 PM window."');
    expect(WasScheduled(SlackApp)).toBe(false);
    expect(AnalyzedTexts(MockProcess)).toHaveLength(0); // the gate stopped it before any model call
  });

  test('a quoted-only message creates no reminder', async () => {
    const { SlackApp, MockProcess } = await RunDmAsync('only_quote', '"I will ship it tomorrow at 9"');
    expect(WasScheduled(SlackApp)).toBe(false);
    expect(AnalyzedTexts(MockProcess)).toHaveLength(0);
  });

  test("the races example: the sender's own time still schedules, and the quoted words are not analyzed", async () => {
    const { SlackApp, MockProcess } = await RunDmAsync('races',
      'let\'s go to the races tomorrow at 8 am "in quotes like this"');
    expect(WasScheduled(SlackApp)).toBe(true);
    expect(AnalyzedTexts(MockProcess)).toEqual(["let's go to the races tomorrow at 8 am"]);
  });

  test('a quote beside the sender\'s own time does not stop scheduling', async () => {
    const { SlackApp, MockProcess } = await RunDmAsync('own_time_plus_quote',
      'please merge PR 766 tonight, the reviewer said "looks good to me, ship it by friday"');
    expect(WasScheduled(SlackApp)).toBe(true);
    expect(AnalyzedTexts(MockProcess)).toEqual(['please merge PR 766 tonight, the reviewer said']);
  });

  test('ordinary unquoted messages behave exactly as before', async () => {
    const { SlackApp, MockProcess } = await RunDmAsync('plain', 'please merge PR 766 tonight');
    expect(WasScheduled(SlackApp)).toBe(true);
    expect(AnalyzedTexts(MockProcess)).toEqual(['please merge PR 766 tonight']);
  });

  test('kill switch off: the pasted-quote message schedules as it did before this change', async () => {
    const Result = await WithFlag('off', () => RunDmAsync('kill_switch',
      'please review "the plan for tomorrow"'));
    expect(WasScheduled(Result.SlackApp)).toBe(true);
    expect(AnalyzedTexts(Result.MockProcess)).toEqual(['please review "the plan for tomorrow"']);
  });

  test('an explicit :alarm_clock: reaction keeps the whole message, quotes included', async () => {
    const WorkspaceInfo = MakeWorkspaceInfo('force_keeps_quotes');
    const MessageTS = '1774000000.000777';
    const Text = 'follow up on "the vendor quote" soon';
    const MockProcess = ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });
    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      ChannelIdsByName: { 'test-reminders': 'C_REMINDERS' },
      ThreadMessagesById: {
        [`C_CLIENT:${MessageTS}`]: [{ user: 'U_CLIENT', text: Text, ts: MessageTS, bot_id: undefined, reactions: [] }],
      },
    });
    const Reminders = new RemindersModule(SlackApp);
    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync(EmptyWorkspaceStats);
      await SlackApp.SimulateReactionAddedAsync({
        user: 'U_OPERATOR', reaction: 'alarm_clock', item: { channel: 'C_CLIENT', ts: MessageTS },
      });
      expect(AnalyzedTexts(MockProcess)[0]).toContain('"the vendor quote"');
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });
});
