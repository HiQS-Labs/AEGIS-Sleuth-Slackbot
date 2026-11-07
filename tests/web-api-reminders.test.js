'use strict';

const fs = require('fs').promises;
const path = require('path');
const WebAPI = require('../src/web-api');
const workspaces = require('../src/workspaces');
const AdminAuth = require('../src/admin-auth');

const TestBearerToken = 'test-bearer-token';
const TestPort = 19876; // fixed test port to avoid conflicts with dev server (2020).

/**
 * Create a minimal WebAPI instance for testing.
 * @param {Map<string, any>} [ArgSlackAppsByWorkspace] Optional workspace → mock SlackApp map.
 * @param {number} [ArgPort] Port (default TestPort).
 * @returns {WebAPI}
 */
function CreateTestWebAPI(ArgSlackAppsByWorkspace, ArgPort = TestPort) {
  const StatsMap = new Map();
  const MockSettingsModule = { GetLastManualFilePath: () => null, SetLastManualFilePathAsync: async () => {} };
  const MockAdminAuth = new AdminAuth();
  const MockAdminMailer = { SendPasswordResetEmailAsync: async () => {} };
  return new WebAPI(ArgPort, TestBearerToken, StatsMap, MockSettingsModule, MockAdminAuth, MockAdminMailer, ArgSlackAppsByWorkspace);
}

/**
 * Helper to make authenticated GET requests against the test server.
 * @param {number} ArgPort Port number.
 * @param {string} ArgPath Request path.
 * @returns {Promise<{success: boolean, data: any}>}
 */
async function AuthenticatedGetAsync(ArgPort, ArgPath) {
  const Response = await fetch(`http://127.0.0.1:${ArgPort}${ArgPath}`, {
    headers: { 'Authorization': `Bearer ${TestBearerToken}` },
  });
  return Response.json();
}

describe('GET /workspace/:name/reminders', () => {
  /** @type {WebAPI} */
  let API;
  let ActualPort;
  const RemindersDir = workspaces.GetSubdirPath('reminders');
  const EventsDir = workspaces.GetSubdirPath('events');
  const TestWorkspaceName = 'WebAPIRemindersTest';
  const RemindersFilePath = path.join(RemindersDir, `${TestWorkspaceName}_reminders.json`);
  const EventsFilePath = path.join(EventsDir, `${TestWorkspaceName}_events.jsonl`);
  // mutable map held by the WebAPI instance — tests that need a live mock SlackApp set it here.
  const TestSlackApps = new Map();

  beforeAll(async () => {
    API = CreateTestWebAPI(TestSlackApps);
    await API.StartAsync();
    ActualPort = TestPort;
  });

  afterAll(async () => {
    await API.StopAsync();
    await fs.rm(RemindersFilePath, { force: true });
    await fs.rm(EventsFilePath, { force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestSlackApps.clear();
    delete process.env.REMINDERS_READ_SOURCE;
    delete process.env.REBALANCE_EXPORT_SOURCE;
    delete process.env.COMPLETED_READ_SOURCE;
  });

  test('reminder and rebalance flags independently use a lossless event projection and roll back to JSON', async () => {
    const ReminderSeed = [{
      ReminderID: 'api-projection-1', CreatedOn: '2026-08-01T12:00:00.000Z', ShouldPostOn: '2026-08-02T12:00:00.000Z',
      TargetChannelID: 'C_REMINDERS', OriginalChannelID: 'C_SOURCE', OriginalMessageID: '100.200',
      OriginalThreadTs: '100.000', OriginalSenderID: 'U_SENDER', OriginalChannelName: 'engineering',
      ReminderMessageText: 'Use the projection', IgnoreSnooze: false, AssigneeID: 'U_OWNER', AssigneeIDs: ['U_OWNER'],
      GitHubUrls: [], clientId: null, projectId: null, State: 'scheduled',
    }];
    const Event = {
      v: 1, id: 'baseline-api-projection-1', ts: ReminderSeed[0].CreatedOn, workspace: TestWorkspaceName,
      type: 'BaselineReminderImported', reminderId: ReminderSeed[0].ReminderID,
      payload: {
        text: ReminderSeed[0].ReminderMessageText, assigneeId: 'U_OWNER', assigneeIds: ['U_OWNER'],
        sourceChannelId: 'C_SOURCE', targetChannelId: 'C_REMINDERS', dueAt: ReminderSeed[0].ShouldPostOn,
        state: 'scheduled', githubUrls: [], createdOn: ReminderSeed[0].CreatedOn,
        originalSenderId: 'U_SENDER', originalMessageId: '100.200', originalThreadTs: '100.000',
        originalChannelName: 'engineering', ignoreSnooze: false, clientId: null, projectId: null,
      },
    };
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.mkdir(EventsDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed), 'utf8');
    await fs.writeFile(EventsFilePath, `${JSON.stringify(Event)}\n`, 'utf8');

    process.env.REMINDERS_READ_SOURCE = 'projection';
    const ProjectedRaw = await AuthenticatedGetAsync(ActualPort, `/workspace/${TestWorkspaceName}/reminders`);
    expect(ProjectedRaw).toEqual({ success: true, data: ReminderSeed });
    delete process.env.REMINDERS_READ_SOURCE;
    const RolledBackRaw = await AuthenticatedGetAsync(ActualPort, `/workspace/${TestWorkspaceName}/reminders`);
    expect(RolledBackRaw).toEqual({ success: true, data: ReminderSeed });

    process.env.REBALANCE_EXPORT_SOURCE = 'projection';
    const ProjectedRebalance = await AuthenticatedGetAsync(ActualPort, `/workspace/${TestWorkspaceName}/reminders?format=rebalance`);
    delete process.env.REBALANCE_EXPORT_SOURCE;
    const RolledBackRebalance = await AuthenticatedGetAsync(ActualPort, `/workspace/${TestWorkspaceName}/reminders?format=rebalance`);
    expect(ProjectedRebalance.success).toBe(true);
    expect(RolledBackRebalance.success).toBe(true);
    expect(ProjectedRebalance.data.reminders).toEqual(RolledBackRebalance.data.reminders);
    expect(ProjectedRebalance.data.source).toEqual(RolledBackRebalance.data.source);
  });

  test('returns reminders array from disk for a valid workspace', async () => {
    const ReminderSeed = [
      {
        ReminderID: 'api-test-0001',
        CreatedOn: '2026-03-20T09:00:00.000Z',
        ShouldPostOn: '2026-03-28T09:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalMessageID: '1773990000.500001',
        OriginalSenderID: 'U_SENDER',
        ReminderMessageText: 'Review PR 240',
        IgnoreSnooze: false,
        State: 'scheduled',
      },
      {
        ReminderID: 'api-test-0002',
        CreatedOn: '2026-03-21T09:00:00.000Z',
        ShouldPostOn: '2026-03-29T09:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalMessageID: '1773990000.500002',
        OriginalSenderID: 'U_SENDER',
        ReminderMessageText: 'Ship hotfix',
        IgnoreSnooze: false,
        State: 'scheduled',
      },
    ];

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

    const Result = await AuthenticatedGetAsync(ActualPort, `/workspace/${TestWorkspaceName}/reminders`);

    expect(Result.success).toBe(true);
    expect(Result.data).toHaveLength(2);
    expect(Result.data[0].ReminderID).toBe('api-test-0001');
    expect(Result.data[0].ReminderMessageText).toBe('Review PR 240');
    expect(Result.data[1].ReminderID).toBe('api-test-0002');
  });

  test('returns rebalance-friendly reminder export for external consumers', async () => {
    const ReminderSeed = [
      {
        ReminderID: 'api-test-1001',
        CreatedOn: '2026-03-20T09:00:00.000Z',
        ShouldPostOn: '2026-03-28T09:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalChannelName: 'general',
        OriginalMessageID: '1773990000.900001',
        OriginalThreadTs: '1773990000.800001',
        OriginalSenderID: 'U_SENDER',
        AssigneeID: 'U_ASSIGNEE',
        ReminderMessageText: 'Review PR 240',
        IgnoreSnooze: false,
        GitHubUrls: ['https://github.com/NeochromeTeam/sleuth-app/pull/240'],
        State: 'scheduled',
      }
    ];

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

    const Result = await AuthenticatedGetAsync(
      ActualPort,
      `/workspace/${TestWorkspaceName}/reminders?format=rebalance`
    );

    expect(Result.success).toBe(true);
    expect(Result.data.workspaceName).toBe(TestWorkspaceName);
    expect(Result.data.totalReminderCount).toBe(1);
    expect(Result.data.returnedReminderCount).toBe(1);
    expect(Result.data.source.relativePath).toBe(`data/runtime/reminders/${TestWorkspaceName}_reminders.json`);
    expect(Array.isArray(Result.data.reminders)).toBe(true);
    expect(Result.data.reminders[0]).toMatchObject({
      reminderId: 'api-test-1001',
      state: 'scheduled',
      isActive: true,
      createdOn: '2026-03-20T09:00:00.000Z',
      shouldPostOn: '2026-03-28T09:00:00.000Z',
      reminderMessageText: 'Review PR 240',
      ignoreSnooze: false,
      assigneeId: 'U_ASSIGNEE',
      originalSenderId: 'U_SENDER',
      targetChannelId: 'C_REMINDERS',
      originalChannelId: 'C_GENERAL',
      originalChannelName: 'general',
      originalMessageId: '1773990000.900001',
      originalThreadTs: '1773990000.800001',
      githubUrls: ['https://github.com/NeochromeTeam/sleuth-app/pull/240'],
    });
    // GH-367 P2: clientId surfaced on the record, resolved from the client mapping. This seed's PR is
    // on NeochromeTeam/sleuth-app, which maps to the `sleuth` client (GitHubRepoPatterns: ["sleuth-app"]).
    expect(Result.data.reminders[0]).toHaveProperty('clientId', 'sleuth');

    // pre-rendered display block: show-reminders wording/sectioning baked into the export.
    const Display = Result.data.reminders[0].display;
    expect(Display.label).toBe('A');
    expect(Display.sectionKey).toBe('dueOlder'); // 2026-03 due date is long past
    expect(Display.sectionLabel).toBe('🔴 Due older than 7 days');
    expect(Display.summary).toBe('Review PR 240');
    expect(Display.slackSummary).toBe('Review PR 240');
    // no live SlackApp in this test → deterministic constructed archive URL.
    expect(Display.permalink).toBe(`https://${TestWorkspaceName}.slack.com/archives/C_GENERAL/p1773990000900001`);
    expect(Display.taggedUserId).toBe('U_ASSIGNEE');
    expect(Display.assigneeName).toBeNull();
    expect(typeof Display.ageDays).toBe('number');

    // top-level display metadata for consumers rendering the sections.
    expect(Result.data.display.timeZone).toBe('UTC');
    expect(Result.data.display.sectionOrder).toHaveLength(4);
    expect(Result.data.display.sectionOrder[0]).toEqual({ key: 'dueToday', label: '📅 Due Today' });

    expect(typeof Result.data.fetchedAt).toBe('string');
  });

  test('display.ageDays counts calendar days in the workspace time zone (GH-297)', async () => {
    // Production incident: 08:30 PT, reminder created 15:37 PT the day before. Only Date is faked
    // so the HTTP round trip still runs on real timers.
    jest.useFakeTimers({
      now: new Date('2026-11-04T16:30:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
        'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
    try {
      const ReminderSeed = [{
        ReminderID: 'api-test-297',
        CreatedOn: '2026-11-03T23:37:01.631Z',
        ShouldPostOn: '2026-11-04T16:35:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalMessageID: '1773990000.297001',
        OriginalSenderID: 'U_SENDER',
        AssigneeID: 'U_ASSIGNEE',
        ReminderMessageText: 'Install the patch locally',
        IgnoreSnooze: false,
        State: 'scheduled',
      }];

      jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
      jest.spyOn(workspaces, 'LoadWorkspaceInfoByNameAsync').mockResolvedValue({ MAIN_TIMEZONE: 'America/Los_Angeles' });
      await fs.mkdir(RemindersDir, { recursive: true });
      await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

      const Result = await AuthenticatedGetAsync(
        ActualPort,
        `/workspace/${TestWorkspaceName}/reminders?format=rebalance`
      );

      expect(Result.success).toBe(true);
      expect(Result.data.display.timeZone).toBe('America/Los_Angeles');
      expect(Result.data.reminders[0].display.ageDays).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('orders rebalance reminders by due-date section then chronologically, with global labels', async () => {
    const NoonUtcOffsetDays = (ArgDays) => {
      const Day = new Date(Date.now() + ArgDays * 24 * 60 * 60 * 1000);
      Day.setUTCHours(12, 0, 0, 0);
      return Day.toISOString();
    };
    const MakeSeed = (ArgId, ArgShouldPostOn) => ({
      ReminderID: ArgId,
      CreatedOn: NoonUtcOffsetDays(-40),
      ShouldPostOn: ArgShouldPostOn,
      TargetChannelID: 'C_REMINDERS',
      OriginalChannelID: 'C_GENERAL',
      OriginalMessageID: '1773990000.600001',
      OriginalSenderID: 'U_SENDER',
      ReminderMessageText: `Task ${ArgId}`,
      IgnoreSnooze: false,
      State: 'scheduled',
    });
    // seeded deliberately out of order: older-than-7d, upcoming, today, last-7-days.
    const ReminderSeed = [
      MakeSeed('older', NoonUtcOffsetDays(-30)),
      MakeSeed('upcoming', NoonUtcOffsetDays(3)),
      MakeSeed('today', NoonUtcOffsetDays(0)),
      MakeSeed('lastweek', NoonUtcOffsetDays(-2)),
    ];

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

    const Result = await AuthenticatedGetAsync(
      ActualPort,
      `/workspace/${TestWorkspaceName}/reminders?format=rebalance`
    );

    expect(Result.success).toBe(true);
    // section order: Due Today, Due after today, Due within last 7 days, Due older than 7 days.
    expect(Result.data.reminders.map(ArgReminder => ArgReminder.reminderId))
      .toEqual(['today', 'upcoming', 'lastweek', 'older']);
    expect(Result.data.reminders.map(ArgReminder => ArgReminder.display.label))
      .toEqual(['A', 'B', 'C', 'D']);
    expect(Result.data.reminders.map(ArgReminder => ArgReminder.display.sectionKey))
      .toEqual(['dueToday', 'dueUpcoming', 'dueLastWeek', 'dueOlder']);
  });

  test('resolves display names and real permalinks through the workspace SlackApp when available', async () => {
    const ReminderSeed = [{
      ReminderID: 'api-test-3001',
      CreatedOn: '2026-03-20T09:00:00.000Z',
      ShouldPostOn: '2026-03-28T09:00:00.000Z',
      TargetChannelID: 'C_REMINDERS',
      OriginalChannelID: 'C_GENERAL',
      OriginalMessageID: '1773990000.300001',
      OriginalSenderID: 'U_SENDER',
      AssigneeID: 'U_ASSIGNEE',
      ReminderMessageText: 'Ping <@U_OTHER> about the export',
      IgnoreSnooze: false,
      State: 'scheduled',
    }];

    TestSlackApps.set(TestWorkspaceName, {
      GetUserDisplayNameAsync: async (ArgUserId) =>
        ({ U_ASSIGNEE: 'Alex Rivera', U_OTHER: 'Mike' })[ArgUserId] || null,
      GetPermaLinkAsync: async () => 'https://neochrome.slack.com/archives/C_GENERAL/p1773990000300001?thread_ts=123',
    });

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

    const Result = await AuthenticatedGetAsync(
      ActualPort,
      `/workspace/${TestWorkspaceName}/reminders?format=rebalance`
    );

    expect(Result.success).toBe(true);
    const Display = Result.data.reminders[0].display;
    expect(Display.assigneeName).toBe('Alex Rivera');
    expect(Display.permalink).toBe('https://neochrome.slack.com/archives/C_GENERAL/p1773990000300001?thread_ts=123');
    // web-safe summary: mention token resolved to a readable name; Slack variant keeps the token.
    expect(Display.summary).toBe('Ping @Mike about the export');
    expect(Display.slackSummary).toBe('Ping <@U_OTHER> about the export');
  });

  test('filters reminders for rebalance export using activeOnly and state query parameters', async () => {
    const ReminderSeed = [
      {
        ReminderID: 'api-test-2001',
        CreatedOn: '2026-03-20T09:00:00.000Z',
        ShouldPostOn: '2026-03-28T09:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalMessageID: '1773990000.700001',
        OriginalSenderID: 'U_SENDER',
        ReminderMessageText: 'Still pending',
        IgnoreSnooze: false,
        State: 'scheduled',
      },
      {
        ReminderID: 'api-test-2002',
        CreatedOn: '2026-03-21T09:00:00.000Z',
        ShouldPostOn: '2026-03-29T09:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalMessageID: '1773990000.700002',
        OriginalSenderID: 'U_SENDER',
        ReminderMessageText: 'Dead letter',
        IgnoreSnooze: false,
        State: 'dead-letter',
      },
      {
        ReminderID: 'api-test-2003',
        CreatedOn: '2026-03-22T09:00:00.000Z',
        ShouldPostOn: '2026-03-30T09:00:00.000Z',
        TargetChannelID: 'C_REMINDERS',
        OriginalChannelID: 'C_GENERAL',
        OriginalMessageID: '1773990000.700003',
        OriginalSenderID: 'U_SENDER',
        ReminderMessageText: 'Legacy no-state reminder',
        IgnoreSnooze: false,
      },
    ];

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

    const ActiveOnlyResult = await AuthenticatedGetAsync(
      ActualPort,
      `/workspace/${TestWorkspaceName}/reminders?format=rebalance&activeOnly=true`
    );
    expect(ActiveOnlyResult.success).toBe(true);
    expect(ActiveOnlyResult.data.totalReminderCount).toBe(3);
    expect(ActiveOnlyResult.data.returnedReminderCount).toBe(2);
    expect(ActiveOnlyResult.data.reminders.map(ArgReminder => ArgReminder.reminderId)).toEqual([
      'api-test-2001',
      'api-test-2003',
    ]);
    expect(ActiveOnlyResult.data.reminders[1].state).toBe('scheduled');

    const StateFilterResult = await AuthenticatedGetAsync(
      ActualPort,
      `/workspace/${TestWorkspaceName}/reminders?format=rebalance&state=dead-letter`
    );
    expect(StateFilterResult.success).toBe(true);
    expect(StateFilterResult.data.returnedReminderCount).toBe(1);
    expect(StateFilterResult.data.reminders[0].reminderId).toBe('api-test-2002');
  });

  test('returns empty array when workspace has no reminders file', async () => {
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    // ensure no file exists.
    await fs.rm(RemindersFilePath, { force: true });

    const Result = await AuthenticatedGetAsync(ActualPort, `/workspace/${TestWorkspaceName}/reminders`);

    expect(Result.success).toBe(true);
    expect(Result.data).toEqual([]);
  });

  test('returns error when workspace does not exist', async () => {
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(false);

    const Result = await AuthenticatedGetAsync(ActualPort, '/workspace/NonExistentWorkspace/reminders');

    expect(Result.success).toBe(false);
    expect(Result.data).toContain('Workspace not found');
  });

  test('rejects unauthenticated requests', async () => {
    const Response = await fetch(`http://127.0.0.1:${ActualPort}/workspace/${TestWorkspaceName}/reminders`);
    const Result = await Response.json();

    expect(Result.success).toBe(false);
    expect(Result.data).toBe('Forbidden.');
  });

  test('returns an error for invalid reminders query values', async () => {
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);

    const Result = await AuthenticatedGetAsync(
      ActualPort,
      `/workspace/${TestWorkspaceName}/reminders?format=rebalance&activeOnly=maybe`
    );

    expect(Result.success).toBe(false);
    expect(Result.data).toContain('activeOnly');
  });
});

describe('POST /workspace/:name/reminders/bulk (GH-279)', () => {
  /** @type {WebAPI} */
  let API;
  const TestWorkspaceName = 'WebAPIRemindersBulkTest';
  const BulkPath = `/workspace/${TestWorkspaceName}/reminders/bulk`;
  const TestSlackApps = new Map();
  /** @type {Array<[string, string, string]>} writer, reminderId, reason — in call order */
  let Calls;
  // highest number of writer calls in flight at once; the endpoint must apply items serially.
  let MaxInFlight;

  /**
   * POST a JSON body to the test server.
   * @param {string} ArgPath Request path.
   * @param {any} ArgBody JSON body.
   * @param {string|null} [ArgToken] Bearer token; null sends no Authorization header.
   * @returns {Promise<{success: boolean, data: any}>}
   */
  async function PostAsync(ArgPath, ArgBody, ArgToken = TestBearerToken) {
    const Headers = { 'Content-Type': 'application/json' };
    if(ArgToken) Headers.Authorization = `Bearer ${ArgToken}`;
    const Response = await fetch(`http://127.0.0.1:${TestPort}${ArgPath}`, {
      method: 'POST', headers: Headers, body: JSON.stringify(ArgBody),
    });
    return Response.json();
  }

  /**
   * Install a mock live RemindersModule whose writers close only the given pending IDs.
   * @param {string[]} ArgPendingIds IDs the mock treats as pending.
   */
  function InstallMockModule(ArgPendingIds) {
    const Pending = new Set(ArgPendingIds);
    let InFlight = 0;
    const Close = ArgWriter => async (ArgId, ArgReason) => {
      Calls.push([ArgWriter, ArgId, ArgReason]);
      InFlight += 1;
      MaxInFlight = Math.max(MaxInFlight, InFlight);
      await new Promise(ArgResolve => setImmediate(ArgResolve));
      InFlight -= 1;
      if(ArgId === 'boom') throw new Error('writer failed');
      return Pending.delete(ArgId);
    };
    TestSlackApps.set(TestWorkspaceName, {
      RemindersModule: {
        CompleteReminderByIdAsync: Close('complete'),
        CancelReminderFromListAsync: Close('cancel'),
        // GH-290 edit writers: record the arguments the endpoint passes, answer like the real ones.
        UpdateReminderSummaryFromListAsync: async (ArgId, ArgTitle, ArgReason, ArgOptions) => {
          Calls.push(['retitle', ArgId, ArgReason, ArgTitle, ArgOptions]);
          return Pending.has(ArgId) ? 'updated' : 'not-found';
        },
        RescheduleReminderAsync: async (ArgId, ArgDate, ArgReason) => {
          Calls.push(['reschedule', ArgId, ArgReason, ArgDate.toISOString()]);
          return { status: Pending.has(ArgId) ? 'updated' : 'not-found', listFailures: [] };
        },
        ReassignReminderAsync: async (ArgId, ArgIds, ArgReason) => {
          Calls.push(['reassign', ArgId, ArgReason, ArgIds]);
          return Pending.has(ArgId) ? { status: 'updated', listFailures: ArgId === 'lagging' ? ['add to U2\'s list'] : [] } : { status: 'not-found' };
        },
        CreateReminderFromListRowAsync: async (ArgRow, ArgOptions) => {
          Calls.push(['create', ArgRow, ArgOptions]);
          return { ok: true, reminder: { ReminderID: 'new-1' } };
        },
      },
    });
  }

  beforeAll(async () => {
    API = CreateTestWebAPI(TestSlackApps);
    await API.StartAsync();
  });

  afterAll(async () => {
    await API.StopAsync();
  });

  beforeEach(() => {
    Calls = [];
    MaxInFlight = 0;
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestSlackApps.clear();
  });

  test('requires the bearer token', async () => {
    InstallMockModule(['r1']);
    const Result = await PostAsync(BulkPath, { actions: [{ reminderId: 'r1', action: 'complete' }] }, null);
    expect(Result).toEqual({ success: false, data: 'Forbidden.' });
    expect(Calls).toEqual([]);
  });

  test('rejects an unknown workspace and a workspace that is not running', async () => {
    const Body = { actions: [{ reminderId: 'r1', action: 'complete' }] };
    workspaces.WorkspaceExistsAsync.mockResolvedValue(false);
    expect(await PostAsync(BulkPath, Body)).toEqual({ success: false, data: 'Error: Workspace not found.' });

    workspaces.WorkspaceExistsAsync.mockResolvedValue(true);
    expect(await PostAsync(BulkPath, Body)).toEqual({ success: false, data: 'Error: Workspace is not running.' });
  });

  test.each([
    ['missing actions', {}],
    ['empty actions', { actions: [] }],
    ['too many actions', { actions: Array.from({ length: 101 }, (_, i) => ({ reminderId: `r${i}`, action: 'complete' })) }],
    ['bad action', { actions: [{ reminderId: 'r1', action: 'complete' }, { reminderId: 'r2', action: 'delete' }] }],
    ['missing reminderId', { actions: [{ action: 'cancel' }] }],
    ['non-string reason', { actions: [{ reminderId: 'r1', action: 'complete', reason: 5 }] }],
    // GH-290: a shape or title error anywhere refuses the whole batch, including valid items before it.
    ['refused title', { actions: [{ reminderId: 'r1', action: 'complete' }, { reminderId: 'r2', action: 'retitle', title: 'Can you please check this?' }] }],
    ['empty title', { actions: [{ reminderId: 'r1', action: 'retitle', title: '   ', force: true }] }],
    ['bad dueDate', { actions: [{ reminderId: 'r1', action: 'reschedule', dueDate: 'next tuesday' }] }],
    ['bad assigneeIds', { actions: [{ reminderId: 'r1', action: 'reassign', assigneeIds: ['not-a-user'] }] }],
    ['empty assigneeIds', { actions: [{ reminderId: 'r1', action: 'reassign', assigneeIds: [] }] }],
    ['create without channel', { actions: [{ action: 'create', title: 'Review the release notes', dueDate: '2026-11-02T17:00:00Z', assigneeIds: ['U1A'] }] }],
    ['create without owner', { actions: [{ action: 'create', title: 'Review the release notes', dueDate: '2026-11-02T17:00:00Z', channelId: 'C1' }] }],
  ])('rejects %s before any write', async (_Label, ArgBody) => {
    InstallMockModule(['r1', 'r2']);
    const Result = await PostAsync(BulkPath, ArgBody);
    expect(Result.success).toBe(false);
    expect(Calls).toEqual([]);
  });

  test('routes each action to its writer in order and reports per-item outcomes', async () => {
    InstallMockModule(['r1', 'r3']);
    const Result = await PostAsync(BulkPath, {
      actions: [
        { reminderId: 'r1', action: 'complete', reason: 'tracked in issue' },
        { reminderId: 'r2', action: 'complete' },
        { reminderId: 'r3', action: 'cancel', reason: 'duplicate' },
        { reminderId: 'boom', action: 'complete' },
      ],
    });

    expect(Calls).toEqual([
      ['complete', 'r1', 'api-bulk: tracked in issue'],
      ['complete', 'r2', 'api-bulk: complete'],
      ['cancel', 'r3', 'api-bulk: duplicate'],
      ['complete', 'boom', 'api-bulk: complete'],
    ]);
    expect(MaxInFlight).toBe(1);
    expect(Result).toEqual({
      success: true,
      data: {
        results: [
          { reminderId: 'r1', action: 'complete', status: 'completed' },
          { reminderId: 'r2', action: 'complete', status: 'not-found' },
          { reminderId: 'r3', action: 'cancel', status: 'canceled' },
          { reminderId: 'boom', action: 'complete', status: 'error', error: 'writer failed' },
        ],
        counts: { completed: 1, 'not-found': 1, canceled: 1, error: 1 },
      },
    });
  });
  test('GH-290: routes edit actions to the existing writers in request order', async () => {
    InstallMockModule(['r1', 'lagging']);
    const Result = await PostAsync(BulkPath, {
      actions: [
        { reminderId: 'r1', action: 'retitle', title: 'Review the release notes.' },
        { reminderId: 'r1', action: 'reschedule', dueDate: '2026-11-02T17:00:00Z', reason: 'pushed a week' },
        { reminderId: 'r1', action: 'reassign', assigneeIds: ['U1A', 'U2B'] },
        { reminderId: 'lagging', action: 'reassign', assigneeIds: ['U2B'] },
        { reminderId: 'gone', action: 'retitle', title: 'Ping it', force: true },
        { action: 'create', title: 'Draft the launch email', dueDate: '2026-11-03T16:00:00Z', channelId: 'C1', assigneeIds: ['U1A', 'U2B'] },
      ],
    });

    expect(Calls).toEqual([
      // normalized by the title contract (trailing punctuation dropped) before the writer sees it
      ['retitle', 'r1', 'api-bulk: retitle', 'Review the release notes', { SyncLists: true, ReturnStatus: true }],
      ['reschedule', 'r1', 'api-bulk: pushed a week', '2026-11-02T17:00:00.000Z'],
      ['reassign', 'r1', 'api-bulk: reassign', ['U1A', 'U2B']],
      ['reassign', 'lagging', 'api-bulk: reassign', ['U2B']],
      // force keeps a title the contract would refuse (too short / bare pointer)
      ['retitle', 'gone', 'api-bulk: retitle', 'Ping it', { SyncLists: true, ReturnStatus: true }],
      ['create', {
        summary: 'Draft the launch email', dueDate: '2026-11-03T16:00:00.000Z', assigneeID: null,
        assigneeIDs: ['U1A', 'U2B'], targetChannelID: 'C1', originalSenderID: null,
      }, { SkipListSync: false, RequireOwner: true }],
    ]);
    expect(Result.success).toBe(true);
    expect(Result.data.results.map(ArgItem => ArgItem.status)).toEqual(['updated', 'updated', 'updated', 'partial', 'not-found', 'created']);
    expect(Result.data.results[3].error).toMatch(/did not follow: add to U2's list/);
    expect(Result.data.results[5]).toEqual({ action: 'create', status: 'created', reminderId: 'new-1' });
    expect(Result.data.counts).toEqual({ updated: 3, partial: 1, 'not-found': 1, created: 1 });
  });
});

describe('Bot principals (GH-301 Phase 1)', () => {
  const Principals = require('../src/web-api-principals');
  /** @type {WebAPI} */
  let API;
  const WsA = 'BotPrincipalWsA';
  const WsB = 'BotPrincipalWsB';
  const R1 = 'aaaaaaaa-1111-4111-8111-000000000001';
  const R2 = 'aaaaaaaa-1111-4111-8111-000000000002';
  const TestSlackApps = new Map();
  const FilePath = Principals.PrincipalsFilePath();
  const RemindersDir = workspaces.GetSubdirPath('reminders');
  const Tokens = {
    a: Principals.MakeToken('bot-a'),
    reader: Principals.MakeToken('bot-reader'),
    old: Principals.MakeToken('bot-old'),
    gone: Principals.MakeToken('bot-gone'),
  };
  /** @type {any[]} writer calls in order */
  let Calls;
  /** @type {null | (() => void)} release for a held writer */
  let HoldRelease;
  let HoldNext;

  /** @param {any[]} [ArgOverride] */
  async function WritePrincipalsAsync(ArgOverride) {
    const Entries = ArgOverride ?? [
      { id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:read', 'reminders:write'] },
      { id: 'bot-reader', sha256: Principals.HashToken(Tokens.reader), workspaces: [WsA], scopes: ['reminders:read'] },
      { id: 'bot-old', sha256: Principals.HashToken(Tokens.old), workspaces: [WsA], scopes: ['reminders:read'], expiresAt: '2020-01-01T00:00:00Z' },
      { id: 'bot-gone', sha256: Principals.HashToken(Tokens.gone), workspaces: [WsA], scopes: ['reminders:read'], revoked: true },
    ];
    await fs.mkdir(path.dirname(FilePath), { recursive: true });
    await fs.writeFile(FilePath, typeof Entries === 'string' ? Entries : JSON.stringify(Entries));
  }

  /**
   * @param {string} ArgMethod
   * @param {string} ArgPath
   * @param {{ token?: string, key?: string, body?: any, headers?: Record<string, string>, port?: number }} [ArgOptions]
   */
  async function CallAsync(ArgMethod, ArgPath, ArgOptions = {}) {
    /** @type {Record<string, string>} */
    const Headers = { 'Content-Type': 'application/json', ...(ArgOptions.headers ?? {}) };
    Headers.Authorization = `Bearer ${ArgOptions.token ?? Tokens.a}`;
    if(ArgOptions.key) Headers['Idempotency-Key'] = ArgOptions.key;
    const Response = await fetch(`http://127.0.0.1:${ArgOptions.port ?? TestPort}${ArgPath}`, {
      method: ArgMethod, headers: Headers, body: ArgOptions.body === undefined ? undefined : JSON.stringify(ArgOptions.body),
    });
    return ArgMethod === 'HEAD' ? { status: Response.status } : { json: await Response.json(), total: Response.headers.get('x-total-count') };
  }
  const Bulk = ArgWs => `/workspace/${ArgWs}/reminders/bulk`;
  const List = ArgWs => `/workspace/${ArgWs}/reminders`;
  const { GetReminderVersion } = require('../src/reminders-module');
  /** @type {Map<string, any>} the mock module's pending reminders, by id */
  let Seeds;
  let SaveNowFails = false;
  /** @type {null | ((ArgId: string) => void)} runs inside a mock writer after it mutates, like a concurrent edit */
  let AfterMutation = null;
  const R3 = 'aaaaaaaa-1111-4111-8111-000000000003';
  const MakeSeed = ArgId => ({ ReminderID: ArgId, ReminderMessageText: `Task ${ArgId.slice(-1)}`, ShouldPostOn: new Date('2030-01-02T17:00:00Z'), AssigneeIDs: ['U0TESTA1'], State: 'scheduled' });
  const V = ArgId => GetReminderVersion(Seeds.get(ArgId));
  const Complete = ArgIds => ({ actions: ArgIds.map(ArgId => ({ action: 'complete', reminderId: ArgId, ifMatch: V(ArgId) })) });

  beforeAll(async () => {
    API = CreateTestWebAPI(TestSlackApps);
    await API.StartAsync();
  });

  afterAll(async () => {
    await API.StopAsync();
    await fs.rm(FilePath, { force: true });
    for(const Ws of [WsA, WsB]) await fs.rm(path.join(RemindersDir, `${Ws}_reminders.json`), { force: true });
  });

  beforeEach(async () => {
    process.env.WEB_API_BOT_PRINCIPALS = '1';
    Calls = [];
    HoldRelease = null;
    HoldNext = false;
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await WritePrincipalsAsync();
    Seeds = new Map([[R1, MakeSeed(R1)], [R2, MakeSeed(R2)]]);
    SaveNowFails = false;
    const Writer = ArgName => async (ArgId, ArgReason) => {
      Calls.push([ArgName, ArgId, ArgReason]);
      if(ArgId === R3) return false;
      if(HoldNext) {
        HoldNext = false;
        await new Promise(ArgResolve => { HoldRelease = ArgResolve; });
      }
      return true;
    };
    for(const Ws of [WsA, WsB]) {
      TestSlackApps.set(Ws, { RemindersModule: {
        CompleteReminderByIdAsync: Writer('complete'),
        CancelReminderFromListAsync: Writer('cancel'),
        GetAllReminders: () => [...Seeds.values()],
        SaveRemindersNowAsync: async () => { if(SaveNowFails) throw new Error('disk full'); },
        AreRemindersEnabledForChannel: ArgChannel => ArgChannel === 'C0ENABLED',
        FindPendingReminderByApiCreateKey: ArgKey => [...Seeds.values()].find(ArgR => ArgR.ApiCreateKey === ArgKey) ?? null,
        // GH-301 Phase 2 writers: record, and change the seed the way the real writer would.
        SetReminderGitHubLinksAsync: async (ArgId, ArgUrls, ArgReason, ArgOptions) => {
          Calls.push(['set-links', ArgId, ArgReason, ArgUrls]);
          Seeds.get(ArgId).GitHubUrls = ArgUrls;
          ArgOptions.OnVersion?.(GetReminderVersion(Seeds.get(ArgId)));
          return 'updated';
        },
        UpdateReminderSummaryFromListAsync: async (ArgId, ArgTitle, ArgReason, ArgOptions) => {
          Calls.push(['retitle', ArgId, ArgReason, ArgTitle, ArgOptions?.ExpectedVersion]);
          Seeds.get(ArgId).ReminderMessageText = ArgTitle;
          ArgOptions?.OnVersion?.(GetReminderVersion(Seeds.get(ArgId)));
          AfterMutation?.(ArgId);
          return 'updated';
        },
        RescheduleReminderAsync: async (ArgId, ArgDate, ArgReason, ArgOptions) => {
          Calls.push(['reschedule', ArgId, ArgReason, ArgDate.toISOString(), ArgOptions?.ExpectedVersion]);
          Seeds.get(ArgId).ShouldPostOn = ArgDate;
          ArgOptions?.OnVersion?.(GetReminderVersion(Seeds.get(ArgId)));
          return { status: 'updated', listFailures: ArgDate.getUTCFullYear() === 2031 ? ['shared list'] : [] };
        },
        CreateReminderFromListRowAsync: async (ArgRow, ArgOptions) => {
          Calls.push(['create', ArgRow.summary, ArgRow.targetChannelID, Boolean(ArgOptions.ApiCreateKey)]);
          const Created = { ...MakeSeed('cccccccc-1111-4111-8111-00000000000c'), ReminderMessageText: ArgRow.summary, ApiCreateKey: ArgOptions.ApiCreateKey, ApiCreateFingerprint: ArgOptions.ApiCreateFingerprint };
          Seeds.set(Created.ReminderID, Created);
          ArgOptions.OnVersion?.(GetReminderVersion(Created));
          return { ok: true, reminder: Created };
        },
      } });
    }
  });

  afterEach(() => {
    delete process.env.WEB_API_BOT_PRINCIPALS;
    jest.restoreAllMocks();
    TestSlackApps.clear();
    AfterMutation = null;
  });

  test('flag off: a principal token is refused like any unknown token', async () => {
    delete process.env.WEB_API_BOT_PRINCIPALS;
    const Result = await CallAsync('POST', Bulk(WsA), { key: 'k1', body: Complete([R1]) });
    expect(Result.json).toEqual({ success: false, data: 'Forbidden.' });
    expect(Calls).toEqual([]);
  });

  test('a valid principal reads its workspace and completes with a server-owned reason', async () => {
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(path.join(RemindersDir, `${WsA}_reminders.json`), JSON.stringify([]));
    expect((await CallAsync('GET', List(WsA))).json).toEqual({ success: true, data: [] });

    const Result = await CallAsync('POST', Bulk(WsA), { key: 'k-valid', body: { actions: [{ action: 'complete', reminderId: R1, ifMatch: V(R1), reason: 'client text' }] } });
    expect(Result.json.success).toBe(true);
    expect(Calls).toEqual([['complete', R1, 'api-bot:bot-a:complete']]);
  });

  test('cross-workspace access is denied and no writer runs', async () => {
    expect((await CallAsync('GET', List(WsB))).json.code).toBe('forbidden-workspace');
    expect((await CallAsync('POST', Bulk(WsB), { key: 'k-x', body: Complete([R1]) })).json.code).toBe('forbidden-workspace');
    expect(Calls).toEqual([]);
  });

  test('expired, revoked, unknown and wrong-secret tokens are denied; revocation needs no restart', async () => {
    expect((await CallAsync('GET', List(WsA), { token: Tokens.old })).json.code).toBe('expired');
    expect((await CallAsync('GET', List(WsA), { token: Tokens.gone })).json.code).toBe('revoked');
    const Nobody = Principals.MakeToken('bot-nobody');
    expect((await CallAsync('GET', List(WsA), { token: Nobody })).json.code).toBe('unknown');
    expect((await CallAsync('GET', List(WsA), { token: `${Tokens.a.slice(0, -1)}${Tokens.a.endsWith('A') ? 'B' : 'A'}` })).json.code).toBe('invalid');

    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-r1', body: Complete([R1]) })).json.success).toBe(true);
    await WritePrincipalsAsync([{ id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:write'], revoked: true }]);
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-r2', body: Complete([R2]) })).json.code).toBe('revoked');
    // a replay of the earlier, cached request is also refused once the principal is revoked
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-r1', body: Complete([R1]) })).json.code).toBe('revoked');
    expect(Calls).toEqual([['complete', R1, 'api-bot:bot-a:complete']]);
  });

  test('scopes and the route allowlist', async () => {
    const Warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await CallAsync('POST', Bulk(WsA), { token: Tokens.reader, key: 'k-s', body: Complete([R1]) })).json.code).toBe('forbidden');
    for(const [Method, Path] of [
      ['GET', '/workspaces'], ['DELETE', `/workspace/${WsA}`], ['GET', `/workspace/${WsA}/stats`],
      ['GET', `/Workspace/${WsA}/reminders`], ['GET', `/workspace/${WsA}/reminders/`], ['GET', `/workspace/Bot%2FPrincipalWsA/reminders`],
      ['POST', `/workspace/${WsA}/reminders/bulk/`],
    ]) {
      expect([Method, Path, (await CallAsync(Method, Path, { key: 'k-p', body: Method === 'GET' ? undefined : Complete([R1]) })).json.code])
        .toEqual([Method, Path, 'forbidden']);
    }
    // HEAD has no body: the structured denial line proves it was refused.
    expect((await CallAsync('HEAD', List(WsA))).status).toBe(200);
    expect(Warn.mock.calls.some(([ArgLine]) => /principal-denied .*"code":"forbidden".*"method":"HEAD"/.test(ArgLine))).toBe(true);
    // admin routes stay behind the admin session
    expect((await CallAsync('GET', '/admin/dashboard/reminders')).json.success).toBe(false);
    expect(Calls).toEqual([]);
  });

  test.each([
    ['a mixed batch with reassign', () => ({ actions: [{ action: 'complete', reminderId: R1, ifMatch: V(R1) }, { action: 'reassign', reminderId: R2, ifMatch: V(R2) }] }), 'action-not-allowed'],
    ['an unknown field on the second action', () => ({ actions: [{ action: 'complete', reminderId: R1, ifMatch: V(R1) }, { action: 'cancel', reminderId: R2, ifMatch: V(R2), hardDelete: true }] }), 'unknown-field'],
    ['an unknown envelope field', () => ({ actions: [{ action: 'complete', reminderId: R1, ifMatch: V(R1) }], dryRun: false }), 'unknown-field'],
    ['a non-UUID id', () => ({ actions: [{ action: 'complete', reminderId: 'x\nFAKE=1', ifMatch: '0000000000000000' }] }), 'invalid-reminder-id'],
    ['a missing ifMatch', () => ({ actions: [{ action: 'complete', reminderId: R1 }] }), 'if-match-required'],
    ['the same reminder twice', () => ({ actions: [{ action: 'complete', reminderId: R1, ifMatch: V(R1) }, { action: 'cancel', reminderId: R1, ifMatch: V(R1) }] }), 'duplicate-reminder'],
    ['force on a bot retitle', () => ({ actions: [{ action: 'retitle', reminderId: R1, ifMatch: V(R1), title: 'Review the release notes', force: true }] }), 'unknown-field'],
  ])('refuses %s whole, before any write', async (_Label, ArgBody, ArgCode) => {
    const Result = await CallAsync('POST', Bulk(WsA), { key: 'k-shape', body: ArgBody() });
    expect(Result.json).toMatchObject({ success: false, code: ArgCode });
    expect(Calls).toEqual([]);
  });

  test('Idempotency-Key is required and must be well formed', async () => {
    expect((await CallAsync('POST', Bulk(WsA), { body: Complete([R1]) })).json.code).toBe('idempotency-key-required');
    expect((await CallAsync('POST', Bulk(WsA), { key: 'audit result=completed', body: Complete([R1]) })).json.code).toBe('idempotency-key-required');
    expect(Calls).toEqual([]);
  });

  test('a replay returns the cached response without running the writer again', async () => {
    const First = await CallAsync('POST', Bulk(WsA), { key: 'k-replay', body: Complete([R1]) });
    const Second = await CallAsync('POST', Bulk(WsA), { key: 'k-replay', body: Complete([R1]) });
    expect(Second.json).toEqual(First.json);
    expect(Calls).toHaveLength(1);
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-replay', body: Complete([R2]) })).json.code).toBe('idempotency-key-reused');
    expect(Calls).toHaveLength(1);
  });

  test('overlapping requests with one key run the writer once; a different body conflicts mid-flight', async () => {
    HoldNext = true;
    const First = CallAsync('POST', Bulk(WsA), { key: 'k-overlap', body: Complete([R1]) });
    while(!HoldRelease) await new Promise(ArgResolve => setTimeout(ArgResolve, 5));
    const Second = CallAsync('POST', Bulk(WsA), { key: 'k-overlap', body: Complete([R1]) });
    const Changed = await CallAsync('POST', Bulk(WsA), { key: 'k-overlap', body: Complete([R2]) });
    expect(Changed.json.code).toBe('idempotency-key-reused');
    HoldRelease();
    const [FirstResult, SecondResult] = await Promise.all([First, Second]);
    expect(SecondResult.json).toEqual(FirstResult.json);
    expect(Calls).toEqual([['complete', R1, 'api-bot:bot-a:complete']]);
  });

  test('the audit line is one JSON record with no reason, raw key or token', async () => {
    const Log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await CallAsync('POST', Bulk(WsA), {
      key: 'k-audit.1', body: { actions: [{ action: 'cancel', reminderId: R2, ifMatch: V(R2), reason: 'line one\nline two sk-proj-SECRET' }] },
    });
    const Lines = Log.mock.calls.map(ArgArgs => ArgArgs.join(' ')).filter(ArgLine => ArgLine.includes('principal-write'));
    expect(Lines).toHaveLength(1);
    const Record = JSON.parse(Lines[0].slice(Lines[0].indexOf('{')));
    expect(Record).toMatchObject({ id: 'bot-a', workspace: WsA, replayed: false, actions: { cancel: 1 }, ids: [R2], counts: { canceled: 1 } });
    expect(Lines[0]).not.toMatch(/SECRET|line two|k-audit\.1|slp_/);
    expect(Calls).toEqual([['cancel', R2, 'api-bot:bot-a:cancel']]);
  });

  test('at the cap, a held key still replays or conflicts; only a new key evicts, and never an in-flight one', async () => {
    const Store = new Principals.IdempotencyStore({ Cap: 3 });
    let Writes = 0;
    const Work = async () => ({ success: true, n: ++Writes });
    for(const Key of ['k0', 'k1', 'k2']) await Store.Reserve(Key, 'body', Work, () => true).promise;
    const Replay = Store.Reserve('k0', 'body', Work, () => true);
    expect(Replay.replayed).toBe(true);
    expect(await Replay.promise).toEqual({ success: true, n: 1 });
    expect(Store.Reserve('k0', 'changed', Work, () => true).conflict).toBe(true);
    expect(Writes).toBe(3);
    // a held in-flight entry survives eviction; a new key then pushes out the oldest completed one (k0)
    let Release;
    const Held = Store.Reserve('k1-held', 'body', () => new Promise(ArgResolve => { Release = ArgResolve; }), () => true);
    expect(Store.Reserve('k-new', 'body', Work, () => true).replayed).toBe(false);
    expect(Store.Reserve('k1-held', 'body', Work, () => true).replayed).toBe(true);
    expect(Store.Reserve('k0', 'changed', Work, () => true).conflict).toBe(false); // k0 was evicted
    await new Promise(ArgResolve => setImmediate(ArgResolve)); // the work starts on a later tick
    Release({ success: true });
    await Held.promise;
  });

  test('every refused principal write logs exactly one redacted denial record', async () => {
    const Warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const Log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const RunningApp = TestSlackApps.get(WsA);
    const Cases = [
      [{ body: Complete([R1]) }, 'idempotency-key-required'],
      [{ key: 'k-den-1', body: { actions: [{ action: 'complete', reminderId: R1, ifMatch: V(R1), secretField: 'sk-proj-LEAK' }] } }, 'unknown-field'],
      [{ key: 'k-den-stale', body: { actions: [{ action: 'complete', reminderId: R1, ifMatch: '0000000000000000' }] } }, 'version-conflict'],
      [{ key: 'k-den-channel', body: { actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0OTHER', assigneeIds: ['U0TESTA1'] }] } }, 'channel-not-enabled'],
      [{ key: 'k-den-missing', body: Complete([R1]) }, 'invalid-request', () => workspaces.WorkspaceExistsAsync.mockResolvedValue(false)],
      [{ key: 'k-den-stopped', body: Complete([R1]) }, 'invalid-request', () => TestSlackApps.delete(WsA)],
    ];
    for(const [Options, Code, Prepare] of Cases) {
      workspaces.WorkspaceExistsAsync.mockResolvedValue(true);
      TestSlackApps.set(WsA, RunningApp);
      if(Prepare) Prepare();
      Warn.mockClear();
      Log.mockClear();
      const Payload = (await CallAsync('POST', Bulk(WsA), Options)).json;
      expect(Payload.success).toBe(false);
      expect(Payload.code ?? 'invalid-request').toBe(Code);
      const Lines = Warn.mock.calls.map(([ArgLine]) => String(ArgLine)).filter(ArgLine => ArgLine.includes('principal-denied'));
      expect(Lines).toHaveLength(1);
      expect(JSON.parse(Lines[0].slice(Lines[0].indexOf('{')))).toEqual({ code: Code, id: 'bot-a', method: 'POST', route: 'bulk' });
      expect(Lines[0]).not.toMatch(/LEAK|secretField|k-den|slp_/);
      expect(Log.mock.calls.filter(([ArgLine]) => String(ArgLine).includes('principal-write'))).toHaveLength(0);
      expect(Calls).toEqual([]);
    }
    TestSlackApps.set(WsA, RunningApp);
    // a key conflict is audited too
    await CallAsync('POST', Bulk(WsA), { key: 'k-den-2', body: Complete([R1]) });
    Warn.mockClear();
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-den-2', body: Complete([R2]) })).json.code).toBe('idempotency-key-reused');
    expect(Warn.mock.calls.filter(([ArgLine]) => String(ArgLine).includes('"code":"idempotency-key-reused"'))).toHaveLength(1);
    expect(Calls).toEqual([['complete', R1, 'api-bot:bot-a:complete']]);
  });

  test('a refused principal read without a specific code is still audited (invalid-request)', async () => {
    const Warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await CallAsync('GET', `${List(WsA)}?activeOnly=maybe`)).json.success).toBe(false);
    const Lines = Warn.mock.calls.map(([ArgLine]) => String(ArgLine)).filter(ArgLine => ArgLine.includes('principal-denied'));
    expect(Lines).toHaveLength(1);
    expect(JSON.parse(Lines[0].slice(Lines[0].indexOf('{')))).toEqual({ code: 'invalid-request', id: 'bot-a', method: 'GET', route: 'reminders' });
  });

  test('plain HTTP from a remote peer is refused, even with X-Forwarded-Proto', async () => {
    jest.spyOn(Principals, 'IsLoopbackAddress').mockReturnValue(false);
    for(const Headers of [{}, { 'X-Forwarded-Proto': 'https' }]) {
      expect((await CallAsync('POST', Bulk(WsA), { key: 'k-t', body: Complete([R1]), headers: Headers })).json.code).toBe('insecure-transport');
    }
    expect(Calls).toEqual([]);
  });

  test('set-links is fail-closed by repository grant, versioned, replayable, and removable', async () => {
    const Body = { actions: [{ action: 'set-links', reminderId: R1, ifMatch: V(R1), githubUrls: ['https://github.com/Owner/Repo/issues/42/', 'https://github.com/owner/repo/issues/42'] }] };
    expect((await CallAsync('POST', Bulk(WsA), { key: 'links-grant', body: Body })).json.code).toBe('forbidden-repository');
    expect(Calls).toEqual([]);
    const Entry = { id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:read', 'reminders:write'], githubRepositories: ['OWNER/REPO'] };
    await WritePrincipalsAsync([Entry]);
    const First = (await CallAsync('POST', Bulk(WsA), { key: 'links-grant', body: Body })).json;
    expect(First.data.results[0]).toMatchObject({ status: 'updated', version: V(R1) });
    expect(V(R1)).not.toBe(Body.actions[0].ifMatch);
    expect(Calls[0][3]).toEqual(['https://github.com/owner/repo/issues/42']);
    expect((await CallAsync('POST', Bulk(WsA), { key: 'links-grant', body: Body })).json).toEqual(First);
    expect(Calls).toHaveLength(1);
    await WritePrincipalsAsync([{ ...Entry, githubRepositories: [] }]);
    expect((await CallAsync('POST', Bulk(WsA), { key: 'links-grant', body: Body })).json.code).toBe('forbidden-repository');
    const Clear = { actions: [{ action: 'set-links', reminderId: R1, ifMatch: V(R1), githubUrls: [] }] };
    expect((await CallAsync('POST', Bulk(WsA), { key: 'links-clear', body: Clear })).json.data.results[0].status).toBe('updated');
    expect(Seeds.get(R1).GitHubUrls).toEqual([]);
  });

  test.each([
    null, ['https://github.com.evil.test/o/r/issues/1'], ['http://github.com/o/r/issues/1'],
    ['https://user:@github.com/o/r/issues/1'], ['https://github.com:443/o/r/issues/1'],
    ['https://github.com/o/r/issues/1?x=1'], ['https://github.com/o/r/issues/1#comment'],
    ['https://github.com/o/../issues/1'], ['https://github.com/o/r/issues/0'], Array(21).fill('https://github.com/o/r/issues/1'),
  ].map(ArgUrls => [ArgUrls]))('invalid replacement links refuse the whole batch: %j', async ArgLinks => {
    const Result = (await CallAsync('POST', Bulk(WsA), { key: 'invalid-links', body: { actions: [
      { action: 'complete', reminderId: R2, ifMatch: V(R2) },
      { action: 'set-links', reminderId: R1, ifMatch: V(R1), githubUrls: ArgLinks },
    ] } })).json;
    expect(Result.code).toBe('invalid-github-links');
    expect(Calls).toEqual([]);
  });

  test('Phase 2: principals read a version per reminder; legacy reads do not', async () => {
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(path.join(RemindersDir, `${WsA}_reminders.json`), JSON.stringify([MakeSeed(R1)]));
    const Bot = (await CallAsync('GET', List(WsA))).json.data;
    expect(Bot[0].version).toBe(GetReminderVersion(MakeSeed(R1)));
    const Legacy = (await CallAsync('GET', List(WsA), { token: TestBearerToken })).json.data;
    expect(Legacy[0]).not.toHaveProperty('version');
  });

  test('Phase 2: a stale ifMatch refuses the whole batch before any write and reports current versions', async () => {
    const Stale = V(R2);
    Seeds.get(R2).ReminderMessageText = 'changed elsewhere';
    const Result = await CallAsync('POST', Bulk(WsA), { key: 'k-stale', body: { actions: [
      { action: 'complete', reminderId: R1, ifMatch: V(R1) }, { action: 'cancel', reminderId: R2, ifMatch: Stale }] } });
    expect(Result.json).toMatchObject({ success: false, code: 'version-conflict', conflicts: [{ reminderId: R2, version: V(R2) }] });
    expect(Calls).toEqual([]);
  });

  test('Phase 2: retitle preserves weekday alternatives and refuses an incomplete conjunction', async () => {
    const Title = 'Move the call with Alex to tomorrow or Wednesday';
    const Updated = await CallAsync('POST', Bulk(WsA), { key: 'weekday-title', body: { actions: [{ action: 'retitle', reminderId: R1, ifMatch: V(R1), title: Title }] } });
    expect(Updated.json.success).toBe(true);
    expect(Calls[0][3]).toBe(Title);
    const Refused = await CallAsync('POST', Bulk(WsA), { key: 'incomplete-title', body: { actions: [{ action: 'retitle', reminderId: R1, ifMatch: V(R1), title: 'Move the call to tomorrow or' }] } });
    expect(Refused.json.success).toBe(false);
    expect(Calls).toHaveLength(1);
  });

  test('Phase 2: retitle and reschedule pass the version to the writer and return the new one', async () => {
    const Before = V(R1);
    const Result = await CallAsync('POST', Bulk(WsA), { key: 'k-edit', body: { actions: [
      { action: 'retitle', reminderId: R1, ifMatch: Before, title: 'Review the release notes' },
      { action: 'reschedule', reminderId: R2, ifMatch: V(R2), dueDate: '2030-03-01T17:00:00Z' }] } });
    expect(Result.json.success).toBe(true);
    expect(Calls).toEqual([
      ['retitle', R1, 'api-bot:bot-a:retitle', 'Review the release notes', Before],
      ['reschedule', R2, 'api-bot:bot-a:reschedule', '2030-03-01T17:00:00.000Z', expect.any(String)],
    ]);
    expect(Result.json.data.results[0].version).toBe(V(R1));
    expect(Result.json.data.results[0].version).not.toBe(Before);
    // the old version now conflicts
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-edit-2', body: { actions: [{ action: 'complete', reminderId: R1, ifMatch: Before }] } })).json.code).toBe('version-conflict');
  });

  test.each([
    ['create with another action', () => ({ actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0ENABLED', assigneeIds: ['U0TESTA1'] }, { action: 'complete', reminderId: R1, ifMatch: V(R1) }] }), 'create-must-be-alone'],
    ['create with senderId', () => ({ actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0ENABLED', assigneeIds: ['U0TESTA1'], senderId: 'U0TESTA1' }] }), 'unknown-field'],
    ['create without assignees', () => ({ actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0ENABLED' }] }), 'invalid-request'],
    ['create with a contract-refused title', () => ({ actions: [{ action: 'create', title: 'Can you please check this?', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0ENABLED', assigneeIds: ['U0TESTA1'] }] }), 'title-refused'],
    ['create in a channel without auto-scheduling', () => ({ actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0OTHER', assigneeIds: ['U0TESTA1'] }] }), 'channel-not-enabled'],
  ])('Phase 2: refuses %s', async (_Label, ArgBody, ArgCode) => {
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-create-bad', body: ArgBody() })).json).toMatchObject({ success: false, code: ArgCode });
    expect(Calls).toEqual([]);
  });

  test('Phase 2: a create is stamped with its key; a retry after the in-memory cache is gone finds it', async () => {
    const Warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const Body = { actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0ENABLED', assigneeIds: ['U0TESTA1'] }] };
    const First = await CallAsync('POST', Bulk(WsA), { key: 'k-create', body: Body });
    expect(First.json.data.results[0]).toMatchObject({ status: 'created', reminderId: 'cccccccc-1111-4111-8111-00000000000c' });
    expect(Calls).toEqual([['create', 'Draft the launch email', 'C0ENABLED', true]]);
    const Recovery = jest.spyOn(TestSlackApps.get(WsA).RemindersModule, 'SaveRemindersNowAsync');
    // a second API instance has an empty in-memory store, like a restart; the module still holds the stamped
    // reminder. (A second port, not a restart on the same port: a pooled keep-alive socket to a stopped server
    // fails on CI.)
    const Fresh = CreateTestWebAPI(TestSlackApps, TestPort + 7);
    await Fresh.StartAsync();
    try {
      // a replay whose save fails is refused and not cached ...
      SaveNowFails = true;
      expect((await CallAsync('POST', Bulk(WsA), { key: 'k-create', body: Body, port: TestPort + 7 })).json.code).toBe('save-failed');
      const Denials = Warn.mock.calls.map(([ArgLine]) => String(ArgLine)).filter(ArgLine => ArgLine.includes('principal-denied'));
      expect(Denials).toHaveLength(1);
      expect(JSON.parse(Denials[0].slice(Denials[0].indexOf('{')))).toEqual({ code: 'save-failed', id: 'bot-a', method: 'POST', route: 'bulk' });
      // ... so once the save works, the same key replays the stamped reminder (no second create).
      SaveNowFails = false;
      const Retry = await CallAsync('POST', Bulk(WsA), { key: 'k-create', body: Body, port: TestPort + 7 });
      expect(Retry.json.data.results[0]).toMatchObject({ status: 'created', reminderId: 'cccccccc-1111-4111-8111-00000000000c', replayed: true });
      expect(Recovery).toHaveBeenLastCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
      const Changed = await CallAsync('POST', Bulk(WsA), { key: 'k-create', body: { actions: [{ ...Body.actions[0], title: 'Draft the launch post' }] }, port: TestPort + 7 });
      expect(Changed.json.code).toBe('idempotency-key-reused');
      expect(Calls).toHaveLength(1);
    } finally {
      await Fresh.StopAsync();
    }
  });

  test('Phase 2: a create that failed at the writer is not cached, so the same key retries it', async () => {
    const Module = TestSlackApps.get(WsA).RemindersModule;
    const RealCreate = Module.CreateReminderFromListRowAsync;
    let Attempts = 0;
    Module.CreateReminderFromListRowAsync = async (ArgRow, ArgOptions) => {
      Attempts += 1;
      if(Attempts === 1) throw new Error('transient failure before stamp');
      return RealCreate(ArgRow, ArgOptions);
    };
    const Body = { actions: [{ action: 'create', title: 'Draft the launch email', dueDate: '2030-01-03T16:00:00Z', channelId: 'C0ENABLED', assigneeIds: ['U0TESTA1'] }] };
    const First = await CallAsync('POST', Bulk(WsA), { key: 'k-create-retry', body: Body });
    expect(First.json.data.results[0].status).toBe('error');
    const Second = await CallAsync('POST', Bulk(WsA), { key: 'k-create-retry', body: Body });
    expect(Second.json.data.results[0]).toMatchObject({ status: 'created' });
    expect(Attempts).toBe(2);
    expect([...Seeds.values()].filter(ArgR => ArgR.ReminderMessageText === 'Draft the launch email')).toHaveLength(1);
  });

  test('Phase 2: the returned version is the one the bot\'s change produced, not a later concurrent edit', async () => {
    // a human edits the same reminder while the bot's writer is still awaiting (simulated right after the mutation).
    AfterMutation = ArgId => { Seeds.get(ArgId).ReminderMessageText = 'edited by a human meanwhile'; };
    const Result = await CallAsync('POST', Bulk(WsA), { key: 'k-produced', body: { actions: [{ action: 'retitle', reminderId: R1, ifMatch: V(R1), title: 'Review the release notes' }] } });
    const Produced = Result.json.data.results[0].version;
    expect(Produced).not.toBe(V(R1)); // the live version already includes the human edit
    // the bot's next edit with its version conflicts instead of silently overwriting the human edit.
    expect((await CallAsync('POST', Bulk(WsA), { key: 'k-produced-2', body: { actions: [{ action: 'complete', reminderId: R1, ifMatch: Produced }] } })).json.code).toBe('version-conflict');
  });

  test('Phase 2: a partial reschedule still returns its new version; a missing reminder is not-found beside a valid item', async () => {
    const Partial = await CallAsync('POST', Bulk(WsA), { key: 'k-partial', body: { actions: [{ action: 'reschedule', reminderId: R1, ifMatch: V(R1), dueDate: '2031-01-01T17:00:00Z' }] } });
    expect(Partial.json.data.results[0]).toMatchObject({ status: 'partial', version: V(R1) });
    const Mixed = await CallAsync('POST', Bulk(WsA), { key: 'k-missing', body: { actions: [
      { action: 'complete', reminderId: R2, ifMatch: V(R2) }, { action: 'cancel', reminderId: R3, ifMatch: '0123456789abcdef' }] } });
    expect(Mixed.json.data.results.map(ArgR => ArgR.status)).toEqual(['completed', 'not-found']);
  });

  test.each([
    ['127.0.0.1', true], ['127.4.5.6', true], ['::1', true], ['::ffff:127.0.0.1', true],
    ['10.0.0.1', false], ['::ffff:10.0.0.1', false], ['1270.0.0.1', false], ['127.0.0.1.evil', false], [undefined, false],
  ])('IsLoopbackAddress(%s) is %s', (ArgAddress, ArgExpected) => {
    expect(Principals.IsLoopbackAddress(ArgAddress)).toBe(ArgExpected);
  });

  test.each([
    ['duplicate ids', () => [
      { id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:read'] },
      { id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:read'] }]],
    ['invalid hex', () => [{ id: 'bot-a', sha256: 'zz'.repeat(32), workspaces: [WsA], scopes: ['reminders:read'] }]],
    ['a 63-char digest', () => [{ id: 'bot-a', sha256: Principals.HashToken(Tokens.a).slice(1), workspaces: [WsA], scopes: ['reminders:read'] }]],
    ['an unknown scope', () => [{ id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['admin'] }]],
    ['a wildcard repository grant', () => [{ id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:read'], githubRepositories: ['owner/*'] }]],
    ['a bad expiresAt', () => [{ id: 'bot-a', sha256: Principals.HashToken(Tokens.a), workspaces: [WsA], scopes: ['reminders:read'], expiresAt: 'soon' }]],
    ['a non-JSON file', () => 'not json'],
  ])('a principals file with %s admits no one for that entry', async (_Label, ArgEntries) => {
    const Warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await WritePrincipalsAsync(ArgEntries());
    expect((await CallAsync('GET', List(WsA))).json.code).toBe('unknown');
    // the malformed-entry warnings name the array index and the rule, never the entry's unvalidated id
    const EntryWarnings = Warn.mock.calls.map(([ArgLine]) => String(ArgLine)).filter(ArgLine => /principals (entry|file)/.test(ArgLine));
    expect(EntryWarnings.length).toBeGreaterThan(0);
    expect(EntryWarnings.some(ArgLine => ArgLine.includes('bot-a'))).toBe(false);
  });

  test('principals can page the filtered list; bad bounds and rebalance paging are refused', async () => {
    const Seed = [1, 2, 3].map(ArgN => ({ ReminderID: `p${ArgN}`, CreatedOn: '2026-08-01T12:00:00.000Z', ShouldPostOn: '2026-08-02T12:00:00.000Z', ReminderMessageText: `r${ArgN}`, State: ArgN === 2 ? 'completed' : 'scheduled' }));
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(path.join(RemindersDir, `${WsA}_reminders.json`), JSON.stringify(Seed));
    const Page = await CallAsync('GET', `${List(WsA)}?activeOnly=true&limit=1&offset=1`);
    expect(Page.json.data.map(ArgR => ArgR.ReminderID)).toEqual(['p3']);
    expect(Page.total).toBe('2');
    expect((await CallAsync('GET', `${List(WsA)}?limit=0`)).json.code).toBe('invalid-pagination');
    expect((await CallAsync('GET', `${List(WsA)}?offset=-1`)).json.code).toBe('invalid-pagination');
    expect((await CallAsync('GET', `${List(WsA)}?format=rebalance&limit=5`)).json.code).toBe('pagination-unsupported');
  });
});
