'use strict';

const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

describe('RemindersModule.BuildGitHubMonitoringFeedback', () => {
  test('returns empty string when no scheduled reminders contain GitHub URLs', () => {
    const ScheduledReminders = new Map([
      [{
        ReminderID: '1',
        GitHubUrls: null,
      }, []],
      [{
        ReminderID: '2',
        GitHubUrls: [],
      }, []],
    ]);

    expect(RemindersModule.BuildGitHubMonitoringFeedback(ScheduledReminders)).toBe('');
  });

  test('returns singular message for one monitored GitHub URL', () => {
    const ScheduledReminders = new Map([
      [{
        ReminderID: '1',
        GitHubUrls: ['https://github.com/NeochromeTeam/sleuth-app/pull/225'],
      }, []],
    ]);

    expect(RemindersModule.BuildGitHubMonitoringFeedback(ScheduledReminders)).toBe('GitHub link now monitored.');
  });

  test('returns plural message for multiple monitored GitHub URLs', () => {
    const ScheduledReminders = new Map([
      [{
        ReminderID: '1',
        GitHubUrls: ['https://github.com/NeochromeTeam/sleuth-app/pull/225'],
      }, []],
      [{
        ReminderID: '2',
        GitHubUrls: [
          'https://github.com/NeochromeTeam/sleuth-app/issues/718',
          'https://github.com/NeochromeTeam/sleuth-app/pull/223'
        ],
      }, []],
    ]);

    expect(RemindersModule.BuildGitHubMonitoringFeedback(ScheduledReminders)).toBe('3 GitHub links now monitored.');
  });
});

// ---------------------------------------------------------------------------
// Proactive digest signals — #362 Phase 1
// ---------------------------------------------------------------------------

const OPEN_STATE = 'scheduled'; // one of the open states accepted by the signal engine

function makeItem(overrides) {
  return Object.assign(
    {
      ReminderID: 'task-1',
      State: OPEN_STATE,
      clientId: 'client-a',
      CreatedOn: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      ShouldPostOn: null,
      AssigneeID: 'U123',
    },
    overrides
  );
}

const FULL_SETTINGS = { enabled: true, goneQuiet: true, deadlineCollision: true, agingWithoutOwner: true };

describe('RemindersModule.ComputeProactiveSignalsFromData', () => {
  test('returns empty array when enabled:false', () => {
    const queue = [makeItem()];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: { enabled: false, goneQuiet: true, deadlineCollision: true, agingWithoutOwner: true },
    });
    expect(result).toEqual([]);
  });

  test('returns empty array when queue is empty', () => {
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue: [],
      store: null,
      settings: FULL_SETTINGS,
    });
    expect(result).toEqual([]);
  });

  test('goneQuiet fires for client with old items and no recent completions', () => {
    const nowMs = Date.now();
    const queue = [makeItem({ ReminderID: 'task-old', CreatedOn: new Date(nowMs - 20 * 24 * 60 * 60 * 1000) })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      nowMs,
    });
    const gq = result.filter(s => s.type === 'goneQuiet');
    expect(gq).toHaveLength(1);
    expect(gq[0].clientId).toBe('client-a');
    expect(gq[0].taskIds).toContain('task-old');
    expect(gq[0].details).toMatch(/task-old/);
  });

  test('goneQuiet does not fire when item was created within the quiet window', () => {
    const nowMs = Date.now();
    // Created 3 days ago — well within the default 14-day quiet window
    const queue = [makeItem({ ReminderID: 'task-new', CreatedOn: new Date(nowMs - 3 * 24 * 60 * 60 * 1000) })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      nowMs,
    });
    expect(result.filter(s => s.type === 'goneQuiet')).toHaveLength(0);
  });

  test('goneQuiet does not fire when store reports a recent completion for the client', () => {
    const nowMs = Date.now();
    const queue = [makeItem({ ReminderID: 'task-old', CreatedOn: new Date(nowMs - 20 * 24 * 60 * 60 * 1000) })];
    // Stub store that reports a completion 2 days ago for this clientId
    const stubStore = {
      GetLastCompletionMsForClientId: (clientId, startMs) => {
        if(clientId === 'client-a') return nowMs - 2 * 24 * 60 * 60 * 1000;
        return null;
      },
    };
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: stubStore,
      settings: FULL_SETTINGS,
      nowMs,
    });
    expect(result.filter(s => s.type === 'goneQuiet')).toHaveLength(0);
  });

  test('deadlineCollision fires when client DeadlineConvention next occurrence is within 48 h', () => {
    const nowMs = Date.now();
    // Build a DeadlineConvention whose next occurrence is ~20 h from now.
    // We need a day-of-week that is 20 hours ahead of nowMs.
    const targetMs = nowMs + 20 * 60 * 60 * 1000;
    const targetDate = new Date(targetMs);
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName = days[targetDate.getDay()];
    const hh = String(targetDate.getHours()).padStart(2, '0');
    const mm = String(targetDate.getMinutes()).padStart(2, '0');
    const convention = `${dayName} ${hh}:${mm}`;

    const queue = [makeItem({ ReminderID: 'task-dc', ShouldPostOn: null })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      getClientDefaults: (clientId) => clientId === 'client-a' ? { DeadlineConvention: convention } : {},
      nowMs,
    });
    const dc = result.filter(s => s.type === 'deadlineCollision');
    expect(dc).toHaveLength(1);
    expect(dc[0].clientId).toBe('client-a');
    expect(dc[0].taskIds).toContain('task-dc');
    expect(dc[0].details).toMatch(/task-dc/);
  });

  test('deadlineCollision does not fire when client has no DeadlineConvention', () => {
    const nowMs = Date.now();
    const queue = [makeItem({ ReminderID: 'task-noconv', ShouldPostOn: new Date(nowMs + 20 * 60 * 60 * 1000) })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      getClientDefaults: () => ({}),
      nowMs,
    });
    expect(result.filter(s => s.type === 'deadlineCollision')).toHaveLength(0);
  });

  test('deadlineCollision does not fire when DeadlineConvention next occurrence is beyond 48 h', () => {
    const nowMs = Date.now();
    // Pick a day-of-week that is ~60 hours from now (guaranteed beyond 48 h window).
    const targetMs = nowMs + 60 * 60 * 60 * 1000;
    const targetDate = new Date(targetMs);
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName = days[targetDate.getDay()];
    const hh = String(targetDate.getHours()).padStart(2, '0');
    const mm = String(targetDate.getMinutes()).padStart(2, '0');
    const convention = `${dayName} ${hh}:${mm}`;

    const queue = [makeItem({ ReminderID: 'task-far', ShouldPostOn: null })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      getClientDefaults: (clientId) => clientId === 'client-a' ? { DeadlineConvention: convention } : {},
      nowMs,
    });
    expect(result.filter(s => s.type === 'deadlineCollision')).toHaveLength(0);
  });

  test('agingWithoutOwner fires for old unowned items', () => {
    const nowMs = Date.now();
    // 40 days old, no assignee — past the default 30-day threshold
    const queue = [makeItem({ ReminderID: 'task-aged', AssigneeID: null, CreatedOn: new Date(nowMs - 40 * 24 * 60 * 60 * 1000) })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      nowMs,
    });
    const ao = result.filter(s => s.type === 'agingWithoutOwner');
    expect(ao).toHaveLength(1);
    expect(ao[0].taskIds).toContain('task-aged');
    expect(ao[0].details).toMatch(/task-aged/);
  });

  test('agingWithoutOwner does not fire when item has an assignee', () => {
    const nowMs = Date.now();
    const queue = [makeItem({ ReminderID: 'task-owned', AssigneeID: 'U999', CreatedOn: new Date(nowMs - 40 * 24 * 60 * 60 * 1000) })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      nowMs,
    });
    expect(result.filter(s => s.type === 'agingWithoutOwner')).toHaveLength(0);
  });

  test('goneQuiet respects per-client Defaults.PROACTIVE_QUIET_DAYS override', () => {
    const nowMs = Date.now();
    // Item is 10 days old — within the default 14-day window but beyond a per-client 7-day window.
    const queue = [makeItem({ ReminderID: 'task-client-override', clientId: 'client-short', CreatedOn: new Date(nowMs - 10 * 24 * 60 * 60 * 1000) })];

    // With no override, default 14 days: 10 days old is NOT quiet (within window).
    const resultNoOverride = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      getClientDefaults: () => ({}),
      nowMs,
    });
    expect(resultNoOverride.filter(s => s.type === 'goneQuiet')).toHaveLength(0);

    // With per-client override of 7 days: 10 days old IS quiet (outside the shorter window).
    const resultWithOverride = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: FULL_SETTINGS,
      getClientDefaults: (clientId) => clientId === 'client-short' ? { PROACTIVE_QUIET_DAYS: '7' } : {},
      nowMs,
    });
    const gq = resultWithOverride.filter(s => s.type === 'goneQuiet');
    expect(gq).toHaveLength(1);
    expect(gq[0].clientId).toBe('client-short');
    expect(gq[0].taskIds).toContain('task-client-override');
  });

  test('individual signal toggles suppress disabled signal types', () => {
    const nowMs = Date.now();
    // item qualifies for both goneQuiet and agingWithoutOwner
    const queue = [makeItem({ ReminderID: 'task-old', AssigneeID: null, CreatedOn: new Date(nowMs - 40 * 24 * 60 * 60 * 1000) })];
    const result = RemindersModule.ComputeProactiveSignalsFromData({
      queue,
      store: null,
      settings: { enabled: true, goneQuiet: false, deadlineCollision: false, agingWithoutOwner: false },
      nowMs,
    });
    expect(result).toHaveLength(0);
  });
});

describe('RemindersModule.RenderProactiveSection', () => {
  test('returns empty string for empty signals array (zero-signals suppression)', () => {
    expect(RemindersModule.RenderProactiveSection([])).toBe('');
  });

  test('returns empty string for null signals', () => {
    expect(RemindersModule.RenderProactiveSection(null)).toBe('');
  });

  test('renders up to 3 signals and suppresses the rest with overflow count', () => {
    const signals = [
      { type: 'deadlineCollision', clientId: 'c1', label: 'c1 label', taskIds: ['t1'], details: 'details-1' },
      { type: 'agingWithoutOwner', clientId: null,  label: 'aging label', taskIds: ['t2'], details: 'details-2' },
      { type: 'goneQuiet',         clientId: 'c2', label: 'c2 label', taskIds: ['t3'], details: 'details-3' },
      { type: 'goneQuiet',         clientId: 'c3', label: 'c3 label', taskIds: ['t4'], details: 'details-4' },
      { type: 'goneQuiet',         clientId: 'c4', label: 'c4 label', taskIds: ['t5'], details: 'details-5' },
    ];
    const rendered = RemindersModule.RenderProactiveSection(signals);
    // Must show exactly 3 items
    expect(rendered).toContain('details-1');
    expect(rendered).toContain('details-2');
    expect(rendered).toContain('details-3');
    // Must NOT show items 4 and 5 in detail
    expect(rendered).not.toContain('details-4');
    expect(rendered).not.toContain('details-5');
    // Must show overflow count "and 2 more"
    expect(rendered).toMatch(/and 2 more/);
  });

  test('renders exactly 3 signals with no overflow when exactly 3 signals provided', () => {
    const signals = [
      { type: 'deadlineCollision', clientId: 'c1', label: 'c1 label', taskIds: ['t1'], details: 'details-1' },
      { type: 'agingWithoutOwner', clientId: null,  label: 'aging label', taskIds: ['t2'], details: 'details-2' },
      { type: 'goneQuiet',         clientId: 'c2', label: 'c2 label', taskIds: ['t3'], details: 'details-3' },
    ];
    const rendered = RemindersModule.RenderProactiveSection(signals);
    expect(rendered).toContain('details-1');
    expect(rendered).toContain('details-2');
    expect(rendered).toContain('details-3');
    expect(rendered).not.toMatch(/and \d+ more/);
  });

  test('rendered section includes task ids cited in signal details', () => {
    const signals = [
      { type: 'goneQuiet', clientId: 'acme', label: '*acme* has gone quiet', taskIds: ['uuid-001'], details: '1 open item, no activity in 14d (task IDs: uuid-001)' },
    ];
    const rendered = RemindersModule.RenderProactiveSection(signals);
    expect(rendered).toContain('uuid-001');
    expect(rendered).toContain('*Proactive signals:*');
  });
});

describe('RemindersModule startup-window handler safety', () => {
  test('constructor-time message handler ignores messages before StartAsync finishes', async () => {
    const SlackApp = new MockSlackApp();
    new RemindersModule(SlackApp);

    const WasHandled = await SlackApp.SimulateMessageAsync({
      channel: 'C_GENERAL',
      user: 'U_REQUESTER',
      text: 'finish the report tomorrow',
    });

    expect(WasHandled).toBe(false);
    expect(
      SlackApp.Logger.WarnMessages.some((ArgMessage) =>
        ArgMessage.includes('ignoring reminder message before channel settings finished initializing.')
      )
    ).toBe(true);
  });

  test('constructor-time app mention does not throw when reminders are enabled before StartAsync finishes', async () => {
    const SlackApp = new MockSlackApp({
      ChannelCreatorsById: { C_GENERAL: 'U_CREATOR' },
    });
    new RemindersModule(SlackApp);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      channel: 'C_GENERAL',
      user: 'U_CREATOR',
      text: `${SlackApp.AppMentionString} enable reminders`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.SentMessages).toHaveLength(1);
    expect(SlackApp.SentMessages[0].text).toBe('Reminder system is still starting up. Try again in a moment.');
    expect(
      SlackApp.Logger.ErrorMessages.some((ArgMessage) => ArgMessage.includes('Cannot read properties of undefined'))
    ).toBe(false);
  });
});
