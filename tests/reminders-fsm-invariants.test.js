'use strict';

/**
 * FSM entry-invariant regression tests.
 *
 * Purpose: catch any code path that creates a ReminderInfo without going through
 * #MakeScheduledReminder — which would leave State, IgnoreSnooze, ReminderID, or
 * CreatedOn in a wrong/missing state. Every approved creation path is exercised here
 * and asserted against the four invariants both in-memory and in the persisted JSON.
 *
 * If a new creation path is added and its test omits one of these assertions, this
 * file documents the expected invariants so the reviewer has a clear reference.
 */

const fs = require('fs').promises;
const path = require('path');

jest.mock('../src/workspace-ai');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');

const RemindersModule = require('../src/reminders-module');
const RemindersChannelSettings = require('../src/reminders-channel-settings');
const workspaces = require('../src/workspaces');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BaseWorkspaceInfo = {
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

const EmptyStats = {
  IncomingMessageCount: 0, IncomingMessageLength: 0,
  OutgoingMessageCount: 0, OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0, OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0, IncomingGptMessageLength: 0,
};

function MakeWorkspaceInfo(ArgSuffix) {
  return { ...BaseWorkspaceInfo, WORKSPACE_NAME: `FsmInvariantWorkspace_${ArgSuffix}` };
}

function GetReminderFilePath(ArgWorkspaceName) {
  return workspaces.GetSubdirPath('reminders', `${ArgWorkspaceName}_reminders.json`);
}

async function CleanupAsync(ArgWorkspaceName) {
  const Dir = workspaces.GetSubdirPath('reminders');
  await fs.mkdir(Dir, { recursive: true });
  await Promise.all([
    `${ArgWorkspaceName}_reminders.json`,
    `${ArgWorkspaceName}_reminder_counter.json`,
    `${ArgWorkspaceName}_enabled_channels.json`,
    `${ArgWorkspaceName}_completed.json`,
  ].map((ArgFile) => fs.rm(path.join(Dir, ArgFile), { force: true })));
}

/**
 * Assert every FSM entry invariant on a ReminderInfo object.
 * Call this on every reminder produced by every creation path.
 */
function AssertFsmEntryInvariants(ArgReminder) {
  expect(ArgReminder.State).toBe(RemindersModule.ReminderState.Scheduled);
  expect(ArgReminder.IgnoreSnooze).toBe(false);
  expect(ArgReminder.ReminderID).toMatch(UUID_PATTERN);
  expect(ArgReminder.CreatedOn).toBeInstanceOf(Date);
}

// ─── ReminderState constants ──────────────────────────────────────────────────

describe('ReminderState constants', () => {
  test('ReminderState object is frozen — mutation cannot silently corrupt the FSM', () => {
    expect(Object.isFrozen(RemindersModule.ReminderState)).toBe(true);
  });

  test('Scheduled is the canonical entry state string', () => {
    expect(typeof RemindersModule.ReminderState.Scheduled).toBe('string');
    expect(RemindersModule.ReminderState.Scheduled.length).toBeGreaterThan(0);
  });
});

// ─── CreateReminderFromListRowAsync ──────────────────────────────────────────

describe('CreateReminderFromListRowAsync FSM entry invariants', () => {
  let Module;
  const WorkspaceInfo = MakeWorkspaceInfo('ListRow');

  beforeEach(async () => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI);
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    Module = new RemindersModule(SlackApp);
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    await Module.StartAsync(EmptyStats);
  });

  afterEach(async () => {
    await Module.StopAsync();
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
  });

  const ValidRow = {
    summary: 'Ship the landing page',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    targetChannelID: 'C_REMINDERS',
    assigneeID: 'U_ASSIGNEE',
    originalSenderID: 'U_SENDER',
  };

  test('result reminder has State=Scheduled, IgnoreSnooze=false, UUID ReminderID, Date CreatedOn', async () => {
    const Result = await Module.CreateReminderFromListRowAsync(ValidRow);
    expect(Result.ok).toBe(true);
    AssertFsmEntryInvariants(Result.reminder);
  });

  test('two successive calls produce distinct ReminderIDs — factory calls randomUUID() each time', async () => {
    const R1 = await Module.CreateReminderFromListRowAsync(ValidRow);
    const R2 = await Module.CreateReminderFromListRowAsync({ ...ValidRow, summary: 'Second task' });
    expect(R1.reminder.ReminderID).not.toBe(R2.reminder.ReminderID);
  });

  test('CreatedOn is set at call time, not before', async () => {
    const Before = new Date();
    const Result = await Module.CreateReminderFromListRowAsync(ValidRow);
    const After = new Date();
    expect(Result.reminder.CreatedOn.getTime()).toBeGreaterThanOrEqual(Before.getTime());
    expect(Result.reminder.CreatedOn.getTime()).toBeLessThanOrEqual(After.getTime());
  });

  test('persisted JSON retains FSM invariants — catches bypass via direct #QueueReminderAsync with wrong state', async () => {
    await Module.CreateReminderFromListRowAsync(ValidRow);
    const Persisted = JSON.parse(await fs.readFile(GetReminderFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'));
    expect(Persisted).toHaveLength(1);
    expect(Persisted[0].State).toBe(RemindersModule.ReminderState.Scheduled);
    expect(Persisted[0].IgnoreSnooze).toBe(false);
    expect(Persisted[0].ReminderID).toMatch(UUID_PATTERN);
    expect(new Date(Persisted[0].CreatedOn).toString()).not.toBe('Invalid Date');
  });

  test('returns error without creating a reminder for missing summary', async () => {
    const Result = await Module.CreateReminderFromListRowAsync({ ...ValidRow, summary: '' });
    expect(Result.ok).toBe(false);
    expect(Result.error).toBeTruthy();
  });

  test('returns error without creating a reminder for missing due date', async () => {
    const Result = await Module.CreateReminderFromListRowAsync({ ...ValidRow, dueDate: null });
    expect(Result.ok).toBe(false);
    expect(Result.error).toBeTruthy();
  });

  test('returns error without creating a reminder for missing target channel', async () => {
    const Result = await Module.CreateReminderFromListRowAsync({ ...ValidRow, targetChannelID: '' });
    expect(Result.ok).toBe(false);
    expect(Result.error).toBeTruthy();
  });
});

// ─── Auto-scheduling via OnMessageAsync (#TryScheduleRemindersAsync path) ────

describe('auto-scheduled reminders FSM entry invariants', () => {
  const WorkspaceInfo = MakeWorkspaceInfo('AutoSchedule');

  beforeEach(() => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI, {
      recommendation: 'schedule',
      reminderMessage: 'Finish the design doc',
      schedulingTrigger: 'tomorrow',
    });
  });

  test('reminder created via OnMessageAsync has State=Scheduled, IgnoreSnooze=false, UUID ReminderID, Date CreatedOn', async () => {
    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
      ChannelIdsByName: { 'test-reminders': 'C_GENERAL' },
    });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync(EmptyStats);
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL', user: 'U_CREATOR',
        text: `${SlackApp.AppMentionString} enable reminders`,
      });

      await SlackApp.SimulateMessageAsync({
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        text: 'finish the design doc tomorrow',
      });

      const Persisted = JSON.parse(
        await fs.readFile(GetReminderFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8')
      );
      expect(Persisted).toHaveLength(1);
      expect(Persisted[0].State).toBe(RemindersModule.ReminderState.Scheduled);
      expect(Persisted[0].IgnoreSnooze).toBe(false);
      expect(Persisted[0].ReminderID).toMatch(UUID_PATTERN);
      expect(new Date(Persisted[0].CreatedOn).toString()).not.toBe('Invalid Date');
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('two auto-scheduled reminders have distinct ReminderIDs', async () => {
    const WsInfo2 = MakeWorkspaceInfo('AutoSchedule2');
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: WsInfo2,
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
      ChannelIdsByName: { 'test-reminders': 'C_GENERAL' },
    });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WsInfo2.WORKSPACE_NAME);
      await Reminders.StartAsync(EmptyStats);
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL', user: 'U_CREATOR',
        text: `${SlackApp.AppMentionString} enable reminders`,
      });

      await SlackApp.SimulateMessageAsync({
        channel: 'C_GENERAL', user: 'U_SENDER', text: 'finish the design doc tomorrow',
      });
      await SlackApp.SimulateMessageAsync({
        channel: 'C_GENERAL', user: 'U_SENDER', text: 'review the PR tomorrow',
      });

      const Persisted = JSON.parse(
        await fs.readFile(GetReminderFilePath(WsInfo2.WORKSPACE_NAME), 'utf8')
      );
      expect(Persisted).toHaveLength(2);
      expect(Persisted[0].ReminderID).not.toBe(Persisted[1].ReminderID);
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WsInfo2.WORKSPACE_NAME);
    }
  });
});

// ─── OnMessageAsync temporal gate (1.4.142) ──────────────────────────────────

describe('OnMessageAsync temporal prefilter — no reminder without scheduling trigger', () => {
  const WorkspaceInfo = MakeWorkspaceInfo('TemporalGate');

  test('message with no temporal language never reaches the LLM and creates no reminder', async () => {
    const MockProcess = ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'schedule' });
    const SlackApp = new MockSlackApp({
      WorkspaceInfo,
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
    });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
      await Reminders.StartAsync(EmptyStats);
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL', user: 'U_CREATOR',
        text: `${SlackApp.AppMentionString} enable reminders`,
      });

      await SlackApp.SimulateMessageAsync({
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        text: "Here's the plugin zip. Please note I'm not done testing and polishing it.",
      });

      expect(MockProcess).not.toHaveBeenCalled();
      await expect(
        fs.readFile(GetReminderFilePath(WorkspaceInfo.WORKSPACE_NAME), 'utf8')
      ).rejects.toThrow();
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    }
  });

  test('message with temporal language does reach the LLM', async () => {
    const WsInfo2 = MakeWorkspaceInfo('TemporalGate2');
    const MockProcess = ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });
    const SlackApp = new MockSlackApp({
      WorkspaceInfo: WsInfo2,
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
    });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await CleanupAsync(WsInfo2.WORKSPACE_NAME);
      await Reminders.StartAsync(EmptyStats);
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL', user: 'U_CREATOR',
        text: `${SlackApp.AppMentionString} enable reminders`,
      });

      await SlackApp.SimulateMessageAsync({
        channel: 'C_GENERAL',
        user: 'U_SENDER',
        text: "Here's the plugin zip. I'll finish polishing it tomorrow.",
      });

      expect(MockProcess).toHaveBeenCalled();
    } finally {
      await Reminders.StopAsync();
      await CleanupAsync(WsInfo2.WORKSPACE_NAME);
    }
  });
});

// ─── Completion capture to Sleuth's own history (powers summarize-week) ──────────
// Regression guard: every completion must be recorded to the Sleuth-owned completion store,
// regardless of whether Slack Lists is configured. If a refactor drops the capture at the FSM
// chokepoint, summarize-week silently reports "nothing completed" again.
describe('completion capture to the Sleuth completion store', () => {
  let Module;
  const WorkspaceInfo = MakeWorkspaceInfo('Completion');

  const ValidRow = {
    summary: 'Cross this off',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    targetChannelID: 'C_REMINDERS',
    assigneeID: 'U_ASSIGNEE',
    originalSenderID: 'U_SENDER',
  };

  beforeEach(async () => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI);
    const SlackApp = new MockSlackApp({ WorkspaceInfo });
    Module = new RemindersModule(SlackApp);
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    await Module.StartAsync(EmptyStats);
  });

  afterEach(async () => {
    await Module.StopAsync();
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
  });

  test('completing a reminder records it (no Slack Lists configured)', async () => {
    const Created = await Module.CreateReminderFromListRowAsync(ValidRow);
    expect(Created.ok).toBe(true);

    const Before = Date.now();
    const Completed = await Module.CompleteReminderByIdAsync(Created.reminder.ReminderID, 'test-complete');
    const After = Date.now();
    expect(Completed).toBe(true);

    const Rows = Module.GetCompletedRemindersBetween(0, Number.MAX_SAFE_INTEGER);
    expect(Rows).toHaveLength(1);
    expect(Rows[0].reminderId).toBe(Created.reminder.ReminderID);
    expect(Rows[0].summary).toBe('Cross this off');
    expect(Rows[0].assigneeID).toBe('U_ASSIGNEE');
    expect(Rows[0].sourceChannelID).toBe('C_REMINDERS');
    expect(Rows[0].completedMs).toBeGreaterThanOrEqual(Before);
    expect(Rows[0].completedMs).toBeLessThanOrEqual(After);
  });

  test('a completion outside the queried window is excluded', async () => {
    const Created = await Module.CreateReminderFromListRowAsync(ValidRow);
    await Module.CompleteReminderByIdAsync(Created.reminder.ReminderID, 'test-complete');

    // A window entirely before the completion contains nothing.
    expect(Module.GetCompletedRemindersBetween(0, Date.now() - 86400000)).toHaveLength(0);
  });

  test('a completion survives a restart — StopAsync flushes the fire-and-forget write', async () => {
    const Created = await Module.CreateReminderFromListRowAsync(ValidRow);
    await Module.CompleteReminderByIdAsync(Created.reminder.ReminderID, 'test-complete');
    // StopAsync must flush the queued completion write before the process would exit on a deploy.
    await Module.StopAsync();

    // A fresh module for the same workspace (simulating the post-restart process) loads the file.
    const RestartedApp = new MockSlackApp({ WorkspaceInfo });
    const Restarted = new RemindersModule(RestartedApp);
    await Restarted.StartAsync(EmptyStats);
    Module = Restarted; // hand afterEach the live instance to stop + clean up

    const Rows = Restarted.GetCompletedRemindersBetween(0, Number.MAX_SAFE_INTEGER);
    expect(Rows.map(r => r.reminderId)).toContain(Created.reminder.ReminderID);
  });

  test('shutdown does not persist memory over disk for enabled channels (GH-86 Phase 3)', async () => {
    // Seed enabled channels file on disk with pre-existing channels
    const RemindersDirPath = workspaces.GetSubdirPath('reminders');
    const EnabledChannelsFile = path.join(RemindersDirPath, `${WorkspaceInfo.WORKSPACE_NAME}_enabled_channels.json`);
    const SeededChannels = ['C_CHAN_1', 'C_CHAN_2', 'C_CHAN_3'];
    await fs.writeFile(EnabledChannelsFile, JSON.stringify(SeededChannels), 'utf8');

    const SaveSpy = jest.spyOn(RemindersChannelSettings.prototype, 'SaveEnabledChannelsAsync');

    // Create a new module instance, start it and immediately stop it without any channel changes
    const App = new MockSlackApp({ WorkspaceInfo });
    const TestModule = new RemindersModule(App);
    await TestModule.StartAsync(EmptyStats);

    // Stop the module — it must NOT write memory over disk
    await TestModule.StopAsync();

    expect(SaveSpy).not.toHaveBeenCalled();

    // Verify disk content is preserved intact
    const DiskContent = JSON.parse(await fs.readFile(EnabledChannelsFile, 'utf8'));
    expect(DiskContent).toEqual(SeededChannels);

    SaveSpy.mockRestore();
  });
});
