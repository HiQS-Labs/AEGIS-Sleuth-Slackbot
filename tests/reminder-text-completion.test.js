'use strict';

const fs = require('fs').promises;
const path = require('path');

jest.mock('../src/workspace-ai');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');

const {
  DetectCompletionReply,
  ResolveThreadReminderIDsAsync,
} = require('../src/reminder-text-completion');
const RemindersModule = require('../src/reminders-module');
const workspaces = require('../src/workspaces');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const BOT = '<@UBOT123>';

describe('DetectCompletionReply', () => {
  describe('mention mode (reply addressed to the bot)', () => {
    test.each([
      [`${BOT} I did this`],                         // the reported production case
      [`${BOT} done`],
      [`${BOT} Done!`],
      [`${BOT} done ✅`],
      [`${BOT} :white_check_mark:`],
      [`${BOT} this is done`],
      [`${BOT} all done, thanks!`],
      [`${BOT} completed`],
      [`${BOT} I've sent it over`],
      [`${BOT} sent the doc over this morning, thanks`],
      [`${BOT} took care of it`],
      [`${BOT} mark this as done`],
      [`${BOT} please mark it complete`],
      [`${BOT} close this out`],
      [`${BOT} Just finished this`],
      [`${BOT} fixed and deployed`],
      [`${BOT} I did it yesterday`],
      [`${BOT} I did this`.replace('I', 'I')],
      [`I did this ${BOT}`],                          // trailing-mention form
    ])('completes: %s', (ArgText) => {
      expect(DetectCompletionReply(ArgText, 'mention').IsCompletion).toBe(true);
    });

    test.each([
      [`${BOT} not done yet`],
      [`${BOT} I haven't done this`],
      [`${BOT} I didn't finish it`],
      [`${BOT} is this done?`],
      [`${BOT} did you finish it`],
      [`${BOT} will do this tomorrow`],
      [`${BOT} I'll mark it done later`],
      [`${BOT} done by Friday`],
      [`${BOT} almost done`],
      [`${BOT} what's done so far`],
      [`${BOT} show done tasks`],
      [`${BOT} summarize what got completed this week`],
      [`${BOT} when done, ping me`],
      [`${BOT} can you look into this`],
      // a done-word plus a request: the request must survive (PR #202 review)
      [`${BOT} I sent the proposal, remind me to follow up with them Monday`],
      [`${BOT} merged, now create a reminder to deploy it Monday`],
      [`${BOT} give me my tasks sorted by priority`],
      [`${BOT} please show done tasks`],
      [`${BOT} reschedule to 3pm, the vendor closed early`],
      [`${BOT} snooze this, the client closed for the day`],
      [`${BOT} thanks`],
      [`${BOT} ${'word '.repeat(30)}done`],          // too long to be a completion reply
    ])('does not complete: %s', (ArgText) => {
      expect(DetectCompletionReply(ArgText, 'mention').IsCompletion).toBe(false);
    });
  });

  describe('strict mode (plain reply, no mention)', () => {
    test.each([
      ['done'], ['Done.'], ['done ✅'], ['✅'], [':white_check_mark:'], ['all done'], ['All done!'],
      ['I did this'], ['did it'], ['this is done'], ["it's done"], ['completed'], ['finished'],
      ['yep, done'], ['ok done thanks'], ["I've sent it over"], ['sent'], ['just finished this'],
      ['taken care of'], ['fixed'], ['shipped it'],
    ])('completes: %s', (ArgText) => {
      expect(DetectCompletionReply(ArgText, 'strict').IsCompletion).toBe(true);
    });

    test.each([
      ['done with the first half, rest tomorrow'],
      ['I sent the doc to the client and they said they will review it'],
      ['not done'],
      ['done?'],
      ['almost done'],
      ['will do'],
      ['sounds good'],
      ['thanks'],
      ['the deploy is done but QA found a bug in the checkout flow'],
      ['who has done this before'],
      [''],
    ])('does not complete: %s', (ArgText) => {
      expect(DetectCompletionReply(ArgText, 'strict').IsCompletion).toBe(false);
    });
  });
});

describe('ResolveThreadReminderIDsAsync', () => {
  const MetadataFor = (ArgIDs) => ({
    event_type: 'sleuth-ai-reminder-ids',
    event_payload: { ReminderIDs: JSON.stringify(ArgIDs) },
  });
  const SlackWith = (ArgMetadata) => ({ GetMessageMetadataAsync: jest.fn().mockResolvedValue(ArgMetadata) });
  const IsOwner = (ArgReminder, ArgUserID) =>
    (ArgReminder.AssigneeIDs || []).includes(ArgUserID) || ArgReminder.OriginalSenderID === ArgUserID;

  test('reads reminder IDs from the delivered reminder message the reply is threaded under', async () => {
    const Result = await ResolveThreadReminderIDsAsync(
      SlackWith(MetadataFor(['R1'])),
      { channel: 'C1', thread_ts: '100.1', user: 'U_A' },
      [{ ReminderID: 'R1', AssigneeIDs: ['U_A'] }, { ReminderID: 'R2', AssigneeIDs: ['U_A'] }],
      IsOwner
    );
    expect(Result).toEqual({ ReminderIDs: ['R1'], Source: 'reminder_message', NotOwnedCount: 0 });
  });

  test('falls back to reminders scheduled from the original thread (confirmation lives there)', async () => {
    const Result = await ResolveThreadReminderIDsAsync(
      SlackWith(null),
      { channel: 'C1', thread_ts: '200.1', user: 'U_A' },
      [
        { ReminderID: 'R1', OriginalChannelID: 'C1', OriginalMessageID: '200.1', OriginalThreadTs: null, AssigneeIDs: ['U_A'] },
        { ReminderID: 'R2', OriginalChannelID: 'C1', OriginalMessageID: '200.5', OriginalThreadTs: '200.1', OriginalSenderID: 'U_A' },
        { ReminderID: 'R3', OriginalChannelID: 'C2', OriginalMessageID: '200.1', AssigneeIDs: ['U_A'] },
      ],
      IsOwner
    );
    expect(Result).toEqual({ ReminderIDs: ['R1', 'R2'], Source: 'original_thread', NotOwnedCount: 0 });
  });

  test("narrows to the replier's own reminders when the thread holds several", async () => {
    const Result = await ResolveThreadReminderIDsAsync(
      SlackWith(MetadataFor(['R1', 'R2'])),
      { channel: 'C1', thread_ts: '100.1', user: 'U_ELAN' },
      [
        { ReminderID: 'R1', AssigneeIDs: ['U_NOEL'] },
        { ReminderID: 'R2', AssigneeIDs: ['U_ELAN'] },
      ],
      IsOwner
    );
    expect(Result.ReminderIDs).toEqual(['R2']);
    expect(Result.NotOwnedCount).toBe(1);
  });

  test("returns nothing when the replier owns none of the thread's reminders, even a single one", async () => {
    const Result = await ResolveThreadReminderIDsAsync(
      SlackWith(MetadataFor(['R1'])),
      { channel: 'C1', thread_ts: '100.1', user: 'U_CAROL' },
      [{ ReminderID: 'R1', AssigneeIDs: ['U_BOB'], OriginalSenderID: 'U_NOEL' }],
      IsOwner
    );
    expect(Result).toEqual({ ReminderIDs: [], Source: 'reminder_message', NotOwnedCount: 1 });
  });

  test('a plain reply in the original thread only counts from an assignee or the requester', async () => {
    const Pending = [{ ReminderID: 'R1', OriginalChannelID: 'C1', OriginalMessageID: '200.1', AssigneeIDs: ['U_BOB'], OriginalSenderID: 'U_NOEL' }];
    const Run = (ArgUser) => ResolveThreadReminderIDsAsync(SlackWith(null), { channel: 'C1', thread_ts: '200.1', user: ArgUser }, Pending, IsOwner);
    expect((await Run('U_BOB')).ReminderIDs).toEqual(['R1']);
    expect((await Run('U_NOEL')).ReminderIDs).toEqual(['R1']);
    expect((await Run('U_CAROL')).ReminderIDs).toEqual([]);
  });

  test('reports a reminder thread whose reminders are already closed', async () => {
    const Result = await ResolveThreadReminderIDsAsync(
      SlackWith(MetadataFor(['R_GONE'])),
      { channel: 'C1', thread_ts: '100.1', user: 'U_A' },
      [],
      IsOwner
    );
    expect(Result).toEqual({ ReminderIDs: [], Source: 'reminder_message', NotOwnedCount: 0 });
  });

  test('ignores non-reminder threads', async () => {
    const Result = await ResolveThreadReminderIDsAsync(
      SlackWith({ event_type: 'something-else', event_payload: {} }),
      { channel: 'C1', thread_ts: '100.1', user: 'U_A' },
      [{ ReminderID: 'R1', OriginalChannelID: 'C9', OriginalMessageID: '1.1' }],
      IsOwner
    );
    expect(Result).toEqual({ ReminderIDs: [], Source: 'none', NotOwnedCount: 0 });
  });
});

// ─── end-to-end through RemindersModule + MockSlackApp ────────────────────────────────────────

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0, IncomingMessageLength: 0, OutgoingMessageCount: 0, OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0, OutgoingGptMessageLength: 0, IncomingGptMessageCount: 0, IncomingGptMessageLength: 0,
};

function MakeWorkspaceInfo(ArgSuffix) {
  return {
    WORKSPACE_NAME: `TextCompletion_${ArgSuffix}`,
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test', LIVE_SIGNING_SECRET: 'secret', LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test', REMINDER_CHANNEL_NAME: 'test-reminders', MAIN_TIMEZONE: 'America/Los_Angeles',
  };
}

function RemindersFilePath(ArgWorkspaceName) {
  return path.join(workspaces.GetSubdirPath('reminders'), `${ArgWorkspaceName}_reminders.json`);
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

function MakeReminder(ArgOverrides) {
  return {
    ReminderID: 'r-1',
    CreatedOn: '2026-09-12T16:00:00.000Z',
    ShouldPostOn: '2026-09-28T16:00:00.000Z',
    TargetChannelID: 'C_REMINDERS',
    OriginalChannelID: 'C_GENERAL',
    OriginalMessageID: '1773990000.000001',
    OriginalSenderID: 'U_NOEL',
    ReminderMessageText: 'send over your edge case scenarios tracking doc',
    IgnoreSnooze: false,
    OriginalChannelName: 'general',
    AssigneeID: 'U_ELAN',
    AssigneeIDs: ['U_ELAN'],
    GitHubUrls: null,
    State: 'overdue',
    ...ArgOverrides,
  };
}

describe('text completion end-to-end (RemindersModule + MockSlackApp)', () => {
  const ReminderMessageTS = '1774000000.000001';

  async function StartAsync(ArgSuffix, ArgSeed) {
    const WorkspaceInfo = MakeWorkspaceInfo(ArgSuffix);
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    await fs.writeFile(RemindersFilePath(WorkspaceInfo.WORKSPACE_NAME), JSON.stringify(ArgSeed, null, 2), 'utf8');
    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      MessageMetadataById: {
        [`C_REMINDERS:${ReminderMessageTS}`]: {
          event_type: 'sleuth-ai-reminder-ids',
          event_payload: { ReminderIDs: JSON.stringify(ArgSeed.map(ArgR => ArgR.ReminderID)) },
        },
      },
    });
    const Reminders = new RemindersModule(SlackApp);
    await Reminders.StartAsync(EmptyWorkspaceStats);
    return { WorkspaceInfo, SlackApp, Reminders };
  }

  beforeEach(() => {
    // any fall-through to the AI must not schedule anything.
    ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });
  });

  test('"@Sleuth I did this" in the reminder thread completes it (reported case)', async () => {
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('mention', [MakeReminder()]);
    try {
      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, ts: '1774000100.000001',
        text: `${SlackApp.AppMentionString} I did this`,
      });

      expect(WasHandled).toBe(true);
      expect(JSON.parse(await fs.readFile(RemindersFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'))).toEqual([]);
      expect(SlackApp.AddedReactions).toContainEqual(
        { channel: 'C_REMINDERS', ts: '1774000100.000001', reaction: 'white_check_mark' }
      );
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0]).toMatchObject({ channel: 'C_REMINDERS', threadTs: ReminderMessageTS });
      expect(SlackApp.SentMessages[0].text).toMatch(/Marked reminder complete/);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('a plain "done" reply (no mention) completes it', async () => {
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('plain', [MakeReminder()]);
    try {
      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, ts: '1774000100.000002', text: 'done ✅',
      });
      expect(WasHandled).toBe(true);
      expect(JSON.parse(await fs.readFile(RemindersFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'))).toEqual([]);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('ordinary conversation in the thread leaves the reminder open', async () => {
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('chatter', [MakeReminder()]);
    try {
      await SlackApp.SimulateMessageAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, text: 'not done yet, blocked on the client',
      });
      await SlackApp.SimulateMessageAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, text: 'done with the first half, rest later',
      });
      const Persisted = JSON.parse(await fs.readFile(RemindersFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'));
      expect(Persisted.map(ArgR => ArgR.ReminderID)).toEqual(['r-1']);
      expect(SlackApp.AddedReactions.filter(ArgR => ArgR.reaction === 'white_check_mark')).toHaveLength(0);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test("one assignee's \"done\" does not close a teammate's reminder in the same message", async () => {
    const Seed = [
      MakeReminder({ ReminderID: 'r-elan', AssigneeID: 'U_ELAN', AssigneeIDs: ['U_ELAN'] }),
      MakeReminder({ ReminderID: 'r-noel', AssigneeID: 'U_NOEL', AssigneeIDs: ['U_NOEL'] }),
    ];
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('narrow', Seed);
    try {
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, text: `${SlackApp.AppMentionString} done`,
      });
      const Persisted = JSON.parse(await fs.readFile(RemindersFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'));
      expect(Persisted.map(ArgR => ArgR.ReminderID)).toEqual(['r-noel']);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test("a teammate's \"done\" leaves the reminder open and says why", async () => {
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('notmine', [MakeReminder()]);
    try {
      const Mentioned = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_REMINDERS', user: 'U_CAROL', thread_ts: ReminderMessageTS, text: `${SlackApp.AppMentionString} done`,
      });
      await SlackApp.SimulateMessageAsync({
        channel: 'C_REMINDERS', user: 'U_CAROL', thread_ts: ReminderMessageTS, text: 'fixed',
      });
      expect(Mentioned).toBe(true);
      expect(SlackApp.SentMessages.at(-1).text).toMatch(/isn't assigned to you/);
      const Persisted = JSON.parse(await fs.readFile(RemindersFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'));
      expect(Persisted.map(ArgR => ArgR.ReminderID)).toEqual(['r-1']);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('the "already closed" reply failing to post is not a handler failure', async () => {
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('closedfail', [MakeReminder()]);
    try {
      await SlackApp.SimulateReactionAddedAsync({
        user: 'U_ELAN', reaction: 'white_check_mark', item: { channel: 'C_REMINDERS', ts: ReminderMessageTS },
      });
      SlackApp.PostMessageTextAsync = jest.fn().mockRejectedValue(new Error('ratelimited'));
      await expect(SlackApp.SimulateAppMentionAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, text: `${SlackApp.AppMentionString} done`,
      })).resolves.toBe(true);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('replying "done" to an already-closed reminder says so instead of chatting', async () => {
    const { WorkspaceInfo, SlackApp, Reminders } = await StartAsync('closed', [MakeReminder()]);
    try {
      await SlackApp.SimulateReactionAddedAsync({
        user: 'U_ELAN', reaction: 'white_check_mark', item: { channel: 'C_REMINDERS', ts: ReminderMessageTS },
      });
      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_REMINDERS', user: 'U_ELAN', thread_ts: ReminderMessageTS, text: `${SlackApp.AppMentionString} done`,
      });
      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages.at(-1).text).toMatch(/already closed/);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });
});
