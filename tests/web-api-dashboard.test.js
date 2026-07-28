'use strict';

const fs = require('fs').promises;
const path = require('path');
const WebAPI = require('../src/web-api');
const workspaces = require('../src/workspaces');

const TestSessionToken = 'dashboard-session-token';
const TestBearerToken = 'test-bearer-token';
const TestPort = 19877; // fixed test port to avoid conflicts with dev server (2020) and other suites.

/**
 * Create a WebAPI instance whose admin auth accepts a single fixed session token, so the
 * admin-session-protected dashboard routes can be exercised without a full login flow.
 * @param {Map<string, any>} [ArgSlackAppsByWorkspace] Optional workspace → mock SlackApp map.
 * @returns {WebAPI}
 */
function CreateTestWebAPI(ArgSlackAppsByWorkspace) {
  const StatsMap = new Map();
  const MockSettingsModule = { GetLastManualFilePath: () => null, SetLastManualFilePathAsync: async () => {} };
  const MockAdminAuth = { ValidateSessionToken: (ArgToken) => ArgToken === TestSessionToken };
  const MockAdminMailer = { SendPasswordResetEmailAsync: async () => {} };
  return new WebAPI(TestPort, TestBearerToken, StatsMap, MockSettingsModule, MockAdminAuth, MockAdminMailer, ArgSlackAppsByWorkspace);
}

/**
 * Authenticated GET against the test server using the admin session token.
 * @param {number} ArgPort Port number.
 * @param {string} ArgPath Request path.
 * @param {string} [ArgToken] Bearer token to send.
 * @returns {Promise<{success: boolean, data: any}>}
 */
async function SessionGetAsync(ArgPort, ArgPath, ArgToken = TestSessionToken) {
  const Response = await fetch(`http://127.0.0.1:${ArgPort}${ArgPath}`, {
    headers: { 'Authorization': `Bearer ${ArgToken}` },
  });
  return Response.json();
}

describe('GET /admin/dashboard/* (reminders dashboard)', () => {
  /** @type {WebAPI} */
  let API;
  const RemindersDir = path.join(__dirname, '..', 'data', 'runtime', 'reminders');
  const TestWorkspaceName = 'WebAPIDashboardTest';
  const RemindersFilePath = path.join(RemindersDir, `${TestWorkspaceName}_reminders.json`);
  const CompletedFilePath = path.join(RemindersDir, `${TestWorkspaceName}_completed.json`);
  const TestSlackApps = new Map();

  beforeAll(async () => {
    API = CreateTestWebAPI(TestSlackApps);
    await API.StartAsync();
  });

  afterAll(async () => {
    await API.StopAsync();
    await fs.rm(RemindersFilePath, { force: true });
    await fs.rm(CompletedFilePath, { force: true });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    TestSlackApps.clear();
    await fs.rm(RemindersFilePath, { force: true });
    await fs.rm(CompletedFilePath, { force: true });
  });

  test('lists workspace names for the selector', async () => {
    jest.spyOn(workspaces, 'EnumerateWorkspaceNamesAsync').mockResolvedValue(['alpha', 'beta']);

    const Result = await SessionGetAsync(TestPort, '/admin/dashboard/workspaces');

    expect(Result.success).toBe(true);
    expect(Result.data).toEqual(['alpha', 'beta']);
  });

  test('returns flat rows with task, assignee, assignor and due date', async () => {
    const ReminderSeed = [{
      ReminderID: 'dash-0001',
      CreatedOn: '2026-03-20T09:00:00.000Z',
      ShouldPostOn: '2026-03-28T09:00:00.000Z',
      OriginalChannelID: 'C_GENERAL',
      OriginalMessageID: '1773990000.100001',
      OriginalSenderID: 'U_SENDER',
      AssigneeID: 'U_ASSIGNEE',
      ReminderMessageText: 'Key task(s):\n• Disable logging in the custom plugins.',
      IgnoreSnooze: false,
      State: 'scheduled',
    }];

    TestSlackApps.set(TestWorkspaceName, {
      GetUserDisplayNameAsync: async (ArgUserId) =>
        ({ U_ASSIGNEE: 'Alex Rivera', U_SENDER: 'Robin Lee' })[ArgUserId] || null,
      GetPermaLinkAsync: async () => null,
    });

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');

    const Result = await SessionGetAsync(TestPort, `/admin/dashboard/reminders?workspace=${TestWorkspaceName}`);

    expect(Result.success).toBe(true);
    expect(Result.data.workspaceName).toBe(TestWorkspaceName);
    expect(Result.data.reminderCount).toBe(1);
    expect(Result.data.reminders[0]).toMatchObject({
      reminderId: 'dash-0001',
      taskName: 'Disable logging in the custom plugins.',
      assigneeId: 'U_ASSIGNEE',
      assigneeName: 'Alex Rivera',
      assignorId: 'U_SENDER',
      assignorName: 'Robin Lee',
      createdOn: '2026-03-20T09:00:00.000Z',
      dueDate: '2026-03-28T09:00:00.000Z',
      completedDate: null,
      state: 'scheduled',
    });
    // best-effort archive permalink is constructed even without a live permalink.
    expect(Result.data.reminders[0].permalink).toBe(
      `https://${TestWorkspaceName}.slack.com/archives/C_GENERAL/p1773990000100001`
    );
  });

  test('merges completed date from completion history onto the active reminder', async () => {
    const ReminderSeed = [{
      ReminderID: 'dash-1001',
      CreatedOn: '2026-03-20T09:00:00.000Z',
      ShouldPostOn: '2026-03-28T09:00:00.000Z',
      OriginalChannelID: 'C_GENERAL',
      OriginalMessageID: '1773990000.200001',
      OriginalSenderID: 'U_SENDER',
      ReminderMessageText: 'Review PR 240',
      State: 'posted',
    }];
    const CompletedMs = Date.parse('2026-03-27T12:00:00.000Z');
    const CompletedSeed = [{
      reminderId: 'dash-1001',
      summary: 'Review PR 240',
      assigneeID: 'U_SENDER',
      sourceChannelID: 'C_GENERAL',
      dueDate: '2026-03-28T09:00:00.000Z',
      completedMs: CompletedMs,
    }];

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify(ReminderSeed, null, 2), 'utf8');
    await fs.writeFile(CompletedFilePath, JSON.stringify(CompletedSeed, null, 2), 'utf8');

    const Result = await SessionGetAsync(TestPort, `/admin/dashboard/reminders?workspace=${TestWorkspaceName}`);

    expect(Result.success).toBe(true);
    expect(Result.data.reminderCount).toBe(1);
    expect(Result.data.reminders[0].completedDate).toBe('2026-03-27T12:00:00.000Z');
    expect(Result.data.reminders[0].state).toBe('completed');
  });

  test('folds in reminders that exist only in completion history', async () => {
    const CompletedMs = Date.parse('2026-03-27T12:00:00.000Z');
    const CompletedSeed = [{
      reminderId: 'dash-only-completed',
      summary: 'Archived task',
      assigneeID: 'U_ASSIGNEE',
      sourceChannelID: 'C_GENERAL',
      dueDate: '2026-03-25T09:00:00.000Z',
      completedMs: CompletedMs,
    }];

    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(true);
    await fs.mkdir(RemindersDir, { recursive: true });
    await fs.writeFile(RemindersFilePath, JSON.stringify([], null, 2), 'utf8');
    await fs.writeFile(CompletedFilePath, JSON.stringify(CompletedSeed, null, 2), 'utf8');

    const Result = await SessionGetAsync(TestPort, `/admin/dashboard/reminders?workspace=${TestWorkspaceName}`);

    expect(Result.success).toBe(true);
    expect(Result.data.reminderCount).toBe(1);
    expect(Result.data.reminders[0]).toMatchObject({
      reminderId: 'dash-only-completed',
      taskName: 'Archived task',
      assigneeId: 'U_ASSIGNEE',
      assignorName: null,
      dueDate: '2026-03-25T09:00:00.000Z',
      completedDate: '2026-03-27T12:00:00.000Z',
      state: 'completed',
    });
  });

  test('requires a workspace query parameter', async () => {
    const Result = await SessionGetAsync(TestPort, '/admin/dashboard/reminders');

    expect(Result.success).toBe(false);
    expect(Result.data).toContain('workspace');
  });

  test('returns an error when the workspace does not exist', async () => {
    jest.spyOn(workspaces, 'WorkspaceExistsAsync').mockResolvedValue(false);

    const Result = await SessionGetAsync(TestPort, '/admin/dashboard/reminders?workspace=Nope');

    expect(Result.success).toBe(false);
    expect(Result.data).toContain('Workspace not found');
  });

  test('rejects requests without a valid admin session token', async () => {
    const NoToken = await fetch(`http://127.0.0.1:${TestPort}/admin/dashboard/workspaces`);
    const NoTokenResult = await NoToken.json();
    expect(NoTokenResult.success).toBe(false);
    expect(NoTokenResult.data).toBe('Forbidden.');

    // the legacy bearer token must NOT grant access to admin routes.
    const BearerResult = await SessionGetAsync(TestPort, '/admin/dashboard/workspaces', TestBearerToken);
    expect(BearerResult.success).toBe(false);
    expect(BearerResult.data).toBe('Forbidden.');
  });
});
