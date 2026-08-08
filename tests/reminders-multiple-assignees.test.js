'use strict';

jest.mock('../src/workspace-ai');

const fs = require('fs').promises;
const path = require('path');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');
const RemindersModule = require('../src/reminders-module');
const { BuildCompactTextForReminder } = require('../src/reminders-display-utils');
const { GetActiveRemindersForUser } = require('../src/chat-commands/show-me-context');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const RuntimeDir = path.join(__dirname, '..', 'data', 'runtime', 'reminders');
const WorkspaceBase = {
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

/** @returns {object} */
function MakeWorkspaceInfo(ArgSuffix) {
  return { ...WorkspaceBase, WORKSPACE_NAME: `MultipleAssignees_${ArgSuffix}` };
}

/** @returns {string} */
function GetReminderPath(ArgWorkspaceName) {
  return path.join(RuntimeDir, `${ArgWorkspaceName}_reminders.json`);
}

/** @returns {Promise<void>} */
async function CleanupAsync(ArgWorkspaceName) {
  const Prefix = `${ArgWorkspaceName}_`;
  try {
    const Entries = await fs.readdir(RuntimeDir);
    await Promise.all(Entries.filter(ArgName => ArgName.startsWith(Prefix)).map(
      ArgName => fs.rm(path.join(RuntimeDir, ArgName), { force: true })
    ));
  } catch(error) {
    if(error.code !== 'ENOENT') throw error;
  }
}

describe('multiple reminder assignees', () => {
  beforeAll(async () => {
    await fs.mkdir(RuntimeDir, { recursive: true });
  });

  afterEach(() => {
    MockWorkspaceAI.mockReset();
  });

  test('schedules one shared reminder for two human mentions and confirms the persisted owners', async () => {
    const WorkspaceInfo = MakeWorkspaceInfo('schedule');
    ConfigureMockWorkspaceAI(MockWorkspaceAI, {
      reminderMessage: 'review the release notes',
      extractedDate: { year: 2030, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
    });
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync();
      await SlackApp.SimulateMessageAsync({
        channel: 'D_MULTI',
        channel_type: 'im',
        user: 'U_SENDER',
        text: '<@U_ALICE> <@U_BOB> please review the release notes tomorrow',
      });

      const Stored = Reminders.GetAllReminders();
      expect(Stored).toHaveLength(1);
      expect(Stored[0].AssigneeIDs).toEqual(['U_ALICE', 'U_BOB']);
      expect(Stored[0].AssigneeID).toBe('U_ALICE');
      expect(RemindersModule.IsAssignedTo(Stored[0], 'U_ALICE')).toBe(true);
      expect(RemindersModule.IsAssignedTo(Stored[0], 'U_BOB')).toBe(true);
      expect(RemindersModule.IsAssignedTo(Stored[0], 'U_OTHER')).toBe(false);

      const OnDisk = JSON.parse(await fs.readFile(GetReminderPath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'));
      expect(OnDisk).toHaveLength(1);
      expect(OnDisk[0]).toMatchObject({ AssigneeID: 'U_ALICE', AssigneeIDs: ['U_ALICE', 'U_BOB'] });
      expect(SlackApp.SentMessages.some(ArgMessage =>
        ArgMessage.text.includes('shared work for <@U_ALICE>, <@U_BOB>')
      )).toBe(true);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('normalizes a legacy single-assignee record on load without changing its owner', async () => {
    const WorkspaceInfo = MakeWorkspaceInfo('legacy');
    const ReminderPath = GetReminderPath(WorkspaceInfo.WORKSPACE_NAME);
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await fs.writeFile(ReminderPath, JSON.stringify([{
        ReminderID: 'legacy-reminder',
        CreatedOn: '2026-08-01T00:00:00.000Z',
        ShouldPostOn: '2030-01-01T00:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
        OriginalMessageID: '1.000001',
        OriginalSenderID: 'U_LEGACY',
        ReminderMessageText: 'legacy task',
        IgnoreSnooze: false,
        AssigneeID: 'U_LEGACY',
        State: 'scheduled',
        GitHubUrls: [],
        clientId: null,
        projectId: null,
      }], null, 2));

      await Reminders.StartAsync();
      const Loaded = Reminders.GetAllReminders();
      expect(Loaded).toHaveLength(1);
      expect(Loaded[0].AssigneeIDs).toEqual(['U_LEGACY']);
      expect(Loaded[0].AssigneeID).toBe('U_LEGACY');
      expect(RemindersModule.IsAssignedTo(Loaded[0], 'U_LEGACY')).toBe(true);
      expect(JSON.parse(await fs.readFile(ReminderPath, 'utf8'))[0]).toMatchObject({
        AssigneeID: 'U_LEGACY', AssigneeIDs: ['U_LEGACY']
      });
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('normalizes duplicates and bot-only assignment data without indexing the bot', () => {
    const Shared = {
      AssigneeIDs: ['U_ALICE', 'U_BOT', 'U_ALICE', ' U_BOB '],
      AssigneeID: 'U_OLD',
      OriginalSenderID: 'U_SENDER',
    };
    expect(RemindersModule.GetAssigneeIDs(Shared, 'U_BOT')).toEqual(['U_ALICE', 'U_BOB']);
    expect(RemindersModule.GetAssigneeIDs({ AssigneeIDs: ['U_BOT'], OriginalSenderID: 'U_SENDER' }, 'U_BOT'))
      .toEqual(['U_SENDER']);
  });

  test('compact reminder rendering names every normalized assignee', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: MakeWorkspaceInfo('display') });
    const Text = await BuildCompactTextForReminder(SlackApp, {
      ReminderID: 'shared-reminder',
      CreatedOn: new Date('2026-08-01T00:00:00.000Z'),
      ShouldPostOn: new Date('2030-01-01T00:00:00.000Z'),
      OriginalChannelID: 'C_GENERAL',
      OriginalMessageID: '1.000001',
      OriginalSenderID: 'U_SENDER',
      ReminderMessageText: 'Review the release notes',
      AssigneeID: 'U_ALICE',
      AssigneeIDs: ['U_ALICE', 'U_BOB'],
    }, 'A');
    expect(Text).toContain('<@U_ALICE>, <@U_BOB>');
  });

  // GH-22 regression, the original reported symptom. This is the test that must FAIL against the
  // pre-fix code: show-me's shared read path filtered with `Reminder.AssigneeID === userId`, which
  // only ever matched the FIRST assignee, so the second person's show-me silently omitted work
  // genuinely assigned to them. Driven through the real creation flow, not a hand-built record, so
  // it also proves normalization and the read path agree on what "assigned" means.
  test('show-me surfaces one shared reminder for EVERY assignee, not just the first', async () => {
    const WorkspaceInfo = MakeWorkspaceInfo('showme');
    ConfigureMockWorkspaceAI(MockWorkspaceAI, {
      reminderMessage: 'review the release notes',
      extractedDate: { year: 2030, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
    });
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync();
      await SlackApp.SimulateMessageAsync({
        channel: 'D_MULTI',
        channel_type: 'im',
        user: 'U_SENDER',
        text: '<@U_ALICE> <@U_BOB> please review the release notes tomorrow',
      });

      const Stored = Reminders.GetAllReminders();
      expect(Stored).toHaveLength(1);
      const SharedID = Stored[0].ReminderID;

      const AliceView = GetActiveRemindersForUser(Reminders, 'U_ALICE', SlackApp.BotUserID ?? null);
      const BobView = GetActiveRemindersForUser(Reminders, 'U_BOB', SlackApp.BotUserID ?? null);

      // Alice is AssigneeID[0] — she saw it before the fix too.
      expect(AliceView.map(ArgReminder => ArgReminder.ReminderID)).toEqual([SharedID]);
      // Bob is the second assignee — this is the assertion the old singular compare failed.
      expect(BobView.map(ArgReminder => ArgReminder.ReminderID)).toEqual([SharedID]);
      // One shared reminder, not a per-assignee copy (per the plan doc's non-goals).
      expect(AliceView[0]).toBe(BobView[0]);
      // Nobody else picks it up.
      expect(GetActiveRemindersForUser(Reminders, 'U_OTHER', SlackApp.BotUserID ?? null)).toEqual([]);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  // Per-assignee completion state is an explicit NON-goal in the plan doc: there is ONE reminder with
  // one lifecycle, so whoever ticks it off closes it for everyone. Completion takes only a reminder
  // ID — no user — which is the design saying the same thing.
  test('completion by one assignee clears the shared reminder from every assignee view', async () => {
    const WorkspaceInfo = MakeWorkspaceInfo('complete');
    ConfigureMockWorkspaceAI(MockWorkspaceAI, {
      reminderMessage: 'review the release notes',
      extractedDate: { year: 2030, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
    });
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync();
      await SlackApp.SimulateMessageAsync({
        channel: 'D_MULTI',
        channel_type: 'im',
        user: 'U_SENDER',
        text: '<@U_ALICE> <@U_BOB> please review the release notes tomorrow',
      });

      const SharedID = Reminders.GetAllReminders()[0].ReminderID;
      expect(GetActiveRemindersForUser(Reminders, 'U_ALICE', SlackApp.BotUserID ?? null)).toHaveLength(1);
      expect(GetActiveRemindersForUser(Reminders, 'U_BOB', SlackApp.BotUserID ?? null)).toHaveLength(1);

      // Bob ticks the checkbox on HIS per-user Slack List — the second assignee, not the first.
      expect(await Reminders.CompleteReminderFromListAsync(SharedID, 'completed by U_BOB')).toBe(true);

      expect(GetActiveRemindersForUser(Reminders, 'U_ALICE', SlackApp.BotUserID ?? null)).toEqual([]);
      expect(GetActiveRemindersForUser(Reminders, 'U_BOB', SlackApp.BotUserID ?? null)).toEqual([]);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });
});
