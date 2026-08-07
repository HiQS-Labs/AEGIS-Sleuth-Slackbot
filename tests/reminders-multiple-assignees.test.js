'use strict';

jest.mock('../src/workspace-ai');

const fs = require('fs').promises;
const path = require('path');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');
const RemindersModule = require('../src/reminders-module');
const { BuildCompactTextForReminder } = require('../src/reminders-display-utils');
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
});
