'use strict';

const fs = require('fs').promises;
const path = require('path');

jest.mock('../src/workspace-ai');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');

const RemindersModule = require('../src/reminders-module');
const workspaces = require('../src/workspaces');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0,
  IncomingMessageLength: 0,
  OutgoingMessageCount: 0,
  OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0,
  OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0,
  IncomingGptMessageLength: 0,
};

function MakeWorkspaceInfo(ArgSuffix) {
  return {
    WORKSPACE_NAME: `DndWorkspace_${ArgSuffix}`,
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test',
    LIVE_SIGNING_SECRET: 'secret',
    LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test',
    REMINDER_CHANNEL_NAME: 'main-reminders',
    MAIN_TIMEZONE: 'America/Los_Angeles',
  };
}

function GetRuntimePaths(ArgWorkspaceName) {
  const RemindersDirPath = workspaces.GetSubdirPath('reminders');
  return {
    reminders: path.join(RemindersDirPath, `${ArgWorkspaceName}_reminders.json`),
    counter: path.join(RemindersDirPath, `${ArgWorkspaceName}_reminder_counter.json`),
    enabledChannels: path.join(RemindersDirPath, `${ArgWorkspaceName}_enabled_channels.json`),
    completed: path.join(RemindersDirPath, `${ArgWorkspaceName}_completed.json`),
    dnd: path.join(RemindersDirPath, `${ArgWorkspaceName}_dnd.json`),
  };
}

async function CleanupPathsAsync(ArgWorkspaceName) {
  const Paths = GetRuntimePaths(ArgWorkspaceName);
  await fs.mkdir(path.dirname(Paths.reminders), { recursive: true });
  for(const FilePath of Object.values(Paths)) {
    try {
      await fs.unlink(FilePath);
    } catch {
      // ignore
    }
  }
}

describe('RemindersModule DND Integration', () => {
  let WorkspaceAIInstance;

  beforeEach(() => {
    WorkspaceAIInstance = ConfigureMockWorkspaceAI(MockWorkspaceAI);
  });

  describe('Morning Daily Digest DND Suppression', () => {
    test('posts DND status notice on main channel in lieu of morning reminders when workspace DND is active', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('digest_ws');
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      SlackApp.GetChannelIdAsync = jest.fn().mockImplementation(async (channelName) => {
        if(channelName === 'main-reminders') return 'C_MAIN_REMINDERS';
        return `C_${channelName}`;
      });

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      // Turn on workspace DND
      await Reminders.GetDndSettings().SetWorkspaceDndAsync(true);

      // Force run daily digest
      await Reminders.RunDailyDigestNowAsync();

      // Verify DND notice was posted to C_MAIN_REMINDERS
      const PostedMessages = SlackApp.SentMessages;
      const DndNotice = PostedMessages.find(m => m.text && m.text.includes('AEGIS Sleuth Reminders are DND'));
      expect(DndNotice).toBeDefined();
      expect(DndNotice.channel).toBe('C_MAIN_REMINDERS');
      expect(DndNotice.text).toContain('Note: AEGIS Sleuth Reminders are DND on this workspace.');
      expect(DndNotice.text).toContain('@Sleuth AI dnd workspace off');

      // Verify no daily-digest threads were posted
      const DigestThreads = PostedMessages.filter(m => m.text && !m.text.includes('AEGIS Sleuth Reminders are DND'));
      expect(DigestThreads.length).toBe(0);

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });

    test('posts DND status notice on main channel when single channel has DND active', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('digest_single_ch');
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      // In a single-channel setup, the main channel is the only channel
      SlackApp.GetChannelIdAsync = jest.fn().mockResolvedValue('C_ONLY_CHANNEL');

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      // Turn on channel DND on that single channel
      await Reminders.GetDndSettings().SetChannelDndAsync('C_ONLY_CHANNEL', true);

      // Force run daily digest
      await Reminders.RunDailyDigestNowAsync();

      // Notice should still be posted to C_ONLY_CHANNEL in lieu of morning reminders
      const PostedMessages = SlackApp.SentMessages;
      const DndNotice = PostedMessages.find(m => m.text && m.text.includes('AEGIS Sleuth Reminders are DND'));
      expect(DndNotice).toBeDefined();
      expect(DndNotice.channel).toBe('C_ONLY_CHANNEL');
      expect(DndNotice.text).toContain('Note: AEGIS Sleuth Reminders are DND on the following channel(s): <#C_ONLY_CHANNEL>.');
      expect(DndNotice.text).toContain('@Sleuth AI dnd off');

      // Normal digest threads are suppressed
      const DigestThreads = PostedMessages.filter(m => m.text && !m.text.includes('AEGIS Sleuth Reminders are DND'));
      expect(DigestThreads.length).toBe(0);

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });

    test('posts DND status notice on main channel on a snooze day even with no IgnoreSnooze reminders', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('digest_snooze');
      WorkspaceInfo.SNOOZE_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      SlackApp.GetChannelIdAsync = jest.fn().mockResolvedValue('C_MAIN_REMINDERS');

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      // Turn on workspace DND
      await Reminders.GetDndSettings().SetWorkspaceDndAsync(true);

      // Force run daily digest
      await Reminders.RunDailyDigestNowAsync();

      // DND notice should still be posted to C_MAIN_REMINDERS even though today is a snooze day
      const PostedMessages = SlackApp.SentMessages;
      const DndNotice = PostedMessages.find(m => m.text && m.text.includes('AEGIS Sleuth Reminders are DND'));
      expect(DndNotice).toBeDefined();
      expect(DndNotice.channel).toBe('C_MAIN_REMINDERS');

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });
  });

  describe('Due Reminder Post DND Suppression', () => {
    test('suppresses overdue reminder delivery when workspace DND is active and delivers after DND is disabled', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('due_ws');
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const Paths = GetRuntimePaths(WorkspaceInfo.WORKSPACE_NAME);

      // Seed an overdue reminder
      const PastDate = new Date(Date.now() - 3600 * 1000);
      const SeededReminders = [
        {
          ReminderID: 'rem-1',
          TargetChannelID: 'C_TARGET',
          OriginalChannelID: 'C_TARGET',
          TargetUserID: 'U123',
          AssigneeID: 'U123',
          ReminderMessageText: 'Test DND task',
          ShouldPostOn: PastDate.toISOString(),
          CreatedOn: new Date().toISOString(),
          State: 'scheduled',
          IgnoreSnooze: false,
        }
      ];
      await fs.writeFile(Paths.reminders, JSON.stringify(SeededReminders), 'utf8');

      // Seed workspace DND = true
      await fs.writeFile(Paths.dnd, JSON.stringify({ workspace: true, channels: [] }), 'utf8');

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      SlackApp.GetChannelIdAsync = jest.fn().mockResolvedValue('C_TARGET');
      SlackApp.GetChannelNameAsync = jest.fn().mockResolvedValue('general');
      SlackApp.IsChannelMemberAsync = jest.fn().mockResolvedValue(true);

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      // Check reminders while DND is on
      await Reminders.CheckRemindersNowAsync();

      // Delivery to target channel should NOT have occurred
      const DeliveryMessages = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Test DND task'));
      expect(DeliveryMessages.length).toBe(0);

      // The reminder should be marked 'overdue' (from pass 1) and kept pending
      const PendingReminders = Reminders.GetPendingReminders();
      expect(PendingReminders.length).toBe(1);
      expect(PendingReminders[0].State).toBe('overdue');

      // Now turn off workspace DND
      await Reminders.GetDndSettings().SetWorkspaceDndAsync(false);

      // Run check again
      await Reminders.CheckRemindersNowAsync();

      // Delivery should now succeed!
      const DeliveryMessagesAfter = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Test DND task'));
      expect(DeliveryMessagesAfter.length).toBe(1);
      expect(DeliveryMessagesAfter[0].channel).toBe('C_TARGET');

      // Reminder should be rescheduled to scheduled
      const PendingRemindersAfter = Reminders.GetPendingReminders();
      expect(PendingRemindersAfter[0].State).toBe('scheduled');

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });

    test('suppresses reminder delivery when target and original channels are in channel DND', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('due_channel');
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const Paths = GetRuntimePaths(WorkspaceInfo.WORKSPACE_NAME);

      const PastDate = new Date(Date.now() - 3600 * 1000);
      const SeededReminders = [
        {
          ReminderID: 'rem-2',
          TargetChannelID: 'C_CH1',
          OriginalChannelID: 'C_CH1',
          TargetUserID: 'U123',
          AssigneeID: 'U123',
          ReminderMessageText: 'Channel DND task',
          ShouldPostOn: PastDate.toISOString(),
          CreatedOn: new Date().toISOString(),
          State: 'scheduled',
          IgnoreSnooze: false,
        }
      ];
      await fs.writeFile(Paths.reminders, JSON.stringify(SeededReminders), 'utf8');

      // Seed channel DND for C_CH1
      await fs.writeFile(Paths.dnd, JSON.stringify({ workspace: false, channels: ['C_CH1'] }), 'utf8');

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      SlackApp.GetChannelIdAsync = jest.fn().mockResolvedValue('C_CH1');
      SlackApp.GetChannelNameAsync = jest.fn().mockResolvedValue('channel1');
      SlackApp.IsChannelMemberAsync = jest.fn().mockResolvedValue(true);

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      await Reminders.CheckRemindersNowAsync();

      // Delivery should be suppressed
      const DeliveryMessages = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Channel DND task'));
      expect(DeliveryMessages.length).toBe(0);

      // Turn off DND for C_CH1
      await Reminders.GetDndSettings().SetChannelDndAsync('C_CH1', false);

      await Reminders.CheckRemindersNowAsync();

      // Now it delivers
      const DeliveryAfter = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Channel DND task'));
      expect(DeliveryAfter.length).toBe(1);

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });

    test('process reminders now (force mode) does NOT bypass workspace or channel DND', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('force_dnd');
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const Paths = GetRuntimePaths(WorkspaceInfo.WORKSPACE_NAME);
      const PastDate = new Date(Date.now() - 3600 * 1000);
      const SeededReminders = [
        {
          ReminderID: 'rem-force',
          TargetChannelID: 'C_CH1',
          OriginalChannelID: 'C_CH1',
          TargetUserID: 'U123',
          AssigneeID: 'U123',
          ReminderMessageText: 'Task under force DND',
          ShouldPostOn: PastDate.toISOString(),
          CreatedOn: new Date().toISOString(),
          State: 'scheduled',
          IgnoreSnooze: false,
        }
      ];
      await fs.writeFile(Paths.reminders, JSON.stringify(SeededReminders), 'utf8');
      await fs.writeFile(Paths.dnd, JSON.stringify({ workspace: true, channels: [] }), 'utf8');

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      SlackApp.GetChannelIdAsync = jest.fn().mockResolvedValue('C_CH1');
      SlackApp.GetChannelNameAsync = jest.fn().mockResolvedValue('channel1');
      SlackApp.IsChannelMemberAsync = jest.fn().mockResolvedValue(true);

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      // Simulate process reminders now / force mode
      await Reminders.CheckRemindersNowAsync(true);

      // Reminder must remain suppressed!
      const DeliveryMessages = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Task under force DND'));
      expect(DeliveryMessages.length).toBe(0);

      const PendingReminders = Reminders.GetPendingReminders();
      expect(PendingReminders[0].State).toBe('overdue');

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });

    test('holds reminder when target channel is in DND even if origin channel is not in DND', async () => {
      const WorkspaceInfo = MakeWorkspaceInfo('split_dest_target_dnd');
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);

      const Paths = GetRuntimePaths(WorkspaceInfo.WORKSPACE_NAME);
      const PastDate = new Date(Date.now() - 3600 * 1000);
      const SeededReminders = [
        {
          ReminderID: 'rem-split',
          TargetChannelID: 'C_TARGET_DND',
          OriginalChannelID: 'C_ORIGIN_OPEN',
          TargetUserID: 'U123',
          AssigneeID: 'U123',
          ReminderMessageText: 'Split destination task',
          ShouldPostOn: PastDate.toISOString(),
          CreatedOn: new Date().toISOString(),
          State: 'scheduled',
          IgnoreSnooze: false,
        }
      ];
      await fs.writeFile(Paths.reminders, JSON.stringify(SeededReminders), 'utf8');
      // Target channel is in DND, origin channel is NOT
      await fs.writeFile(Paths.dnd, JSON.stringify({ workspace: false, channels: ['C_TARGET_DND'] }), 'utf8');

      const SlackApp = new MockSlackApp({ WorkspaceInfo });
      SlackApp.GetChannelIdAsync = jest.fn().mockImplementation(async name => `C_${name}`);
      SlackApp.GetChannelNameAsync = jest.fn().mockImplementation(async id => id.toLowerCase());
      SlackApp.IsChannelMemberAsync = jest.fn().mockResolvedValue(true);

      const Reminders = new RemindersModule(SlackApp, WorkspaceAIInstance);
      await Reminders.StartAsync(EmptyWorkspaceStats);

      await Reminders.CheckRemindersNowAsync();

      // Neither target nor origin should receive a post while target is in DND (whole reminder held)
      const DeliveryMessages = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Split destination task'));
      expect(DeliveryMessages.length).toBe(0);

      const PendingReminders = Reminders.GetPendingReminders();
      expect(PendingReminders[0].State).toBe('overdue');

      // Now turn off target DND
      await Reminders.GetDndSettings().SetChannelDndAsync('C_TARGET_DND', false);
      await Reminders.CheckRemindersNowAsync();

      // Both target and origin receive their posts now
      const DeliveryAfter = SlackApp.SentMessages.filter(m => m.text && m.text.includes('Split destination task'));
      expect(DeliveryAfter.length).toBe(2);
      expect(DeliveryAfter.map(m => m.channel).sort()).toEqual(['C_ORIGIN_OPEN', 'C_TARGET_DND']);

      await Reminders.StopAsync();
      await CleanupPathsAsync(WorkspaceInfo.WORKSPACE_NAME);
    });
  });
});
