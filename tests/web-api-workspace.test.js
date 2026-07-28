'use strict';

const fs = require('fs').promises;
const WebAPI = require('../src/web-api');
const workspaces = require('../src/workspaces');
const AdminAuth = require('../src/admin-auth');

const TestBearerToken = 'test-bearer-token-workspace';
const TestPort = 0;

/**
 * Create a minimal WebAPI instance for testing.
 * @returns {WebAPI}
 */
function CreateTestWebAPI() {
  const StatsMap = new Map();
  const MockSettingsModule = { GetLastManualFilePath: () => null, SetLastManualFilePathAsync: async () => {} };
  const MockAdminAuth = new AdminAuth();
  const MockAdminMailer = { SendPasswordResetEmailAsync: async () => {} };
  return new WebAPI(TestPort, TestBearerToken, StatsMap, MockSettingsModule, MockAdminAuth, MockAdminMailer);
}

/**
 * Helper to make authenticated POST requests against the test server.
 * @param {number} ArgPort Port number.
 * @param {string} ArgPath Request path.
 * @param {object} ArgBody JSON body.
 * @returns {Promise<{success: boolean, data: any}>}
 */
async function AuthenticatedPostAsync(ArgPort, ArgPath, ArgBody) {
  const Response = await fetch(`http://127.0.0.1:${ArgPort}${ArgPath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TestBearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ArgBody),
  });
  return Response.json();
}

describe('POST /workspace', () => {
  /** @type {WebAPI} */
  let API;
  let ActualPort;
  const AnthropicWorkspaceName = 'WebApiAnthropicOnly';
  const GeminiWorkspaceName = 'WebApiGeminiOnly';

  beforeAll(async () => {
    API = CreateTestWebAPI();
    await API.StartAsync();
    ActualPort = API.PortNumber;
  });

  afterAll(async () => {
    await API.StopAsync();
    await fs.rm(workspaces.MakeWorkspaceFilePath(AnthropicWorkspaceName), { force: true });
    await fs.rm(workspaces.MakeWorkspaceFilePath(GeminiWorkspaceName), { force: true });
  });

  test('accepts an Anthropic-only workspace and strips blank sibling provider keys', async () => {
    const Result = await AuthenticatedPostAsync(ActualPort, '/workspace', {
      WORKSPACE_NAME: AnthropicWorkspaceName,
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: '   ',
      ANTHROPIC_API_KEY: '  sk-anthropic-test  ',
      GEMINI_API_KEY: '',
      REMINDER_CHANNEL_NAME: 'reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    });

    expect(Result).toEqual({ success: true, data: 'Workspace saved.' });

    const SavedWorkspace = JSON.parse(
      await fs.readFile(workspaces.MakeWorkspaceFilePath(AnthropicWorkspaceName), 'utf8')
    );
    expect(SavedWorkspace.OPENAI_API_KEY).toBeUndefined();
    expect(SavedWorkspace.GEMINI_API_KEY).toBeUndefined();
    expect(SavedWorkspace.ANTHROPIC_API_KEY).toBe('sk-anthropic-test');
  });

  test('accepts a Gemini-only workspace when OPENAI_API_KEY is omitted', async () => {
    const Result = await AuthenticatedPostAsync(ActualPort, '/workspace', {
      WORKSPACE_NAME: GeminiWorkspaceName,
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      GEMINI_API_KEY: 'goog-gemini-test',
      REMINDER_CHANNEL_NAME: 'reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    });

    expect(Result).toEqual({ success: true, data: 'Workspace saved.' });

    const SavedWorkspace = JSON.parse(
      await fs.readFile(workspaces.MakeWorkspaceFilePath(GeminiWorkspaceName), 'utf8')
    );
    expect(SavedWorkspace.OPENAI_API_KEY).toBeUndefined();
    expect(SavedWorkspace.GEMINI_API_KEY).toBe('goog-gemini-test');
  });

  test('rejects a workspace when none of the supported AI keys are provided', async () => {
    const Result = await AuthenticatedPostAsync(ActualPort, '/workspace', {
      WORKSPACE_NAME: 'WebApiNoKeys',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      REMINDER_CHANNEL_NAME: 'reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    });

    expect(Result).toEqual({
      success: false,
      data: 'Error: At least one AI API key is required: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY',
    });
  });
});
