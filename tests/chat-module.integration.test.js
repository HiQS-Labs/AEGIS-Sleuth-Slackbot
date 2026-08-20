'use strict';

const fs = require('fs').promises;
const path = require('path');
const Workspaces = require('../src/workspaces');
const JinhuiFixture = require('./fixtures/stratalist/jinhui2026.public-share.json');

const mockWorkspaceAIInstances = [];
const OriginalFetch = global.fetch;

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation((WorkspaceInfo) => {
    const Instance = {
      WorkspaceInfo,
      DefaultModelName: 'gpt-4o-mini',
      ComplexModelName: 'gpt-4o',
      ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
        intent_id: 'clarify',
        confidence: 0.25,
        rationale: 'mock clarify',
        needs_clarification: true,
        clarification_question: 'Which exact Sleuth command do you want?',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      }),
      ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
      ProcessWebSearchAsync: jest.fn().mockResolvedValue({
        text: 'mock web search response',
        sources: [
          { title: 'Example Source', url: 'https://example.com/source' },
        ],
        model: 'gpt-5.4-mini',
        responseId: 'resp_test',
        webSearchCallCount: 1,
      }),
      ProcessGeminiWebSearchAsync: jest.fn().mockResolvedValue({
        text: 'mock gemini web search response',
        sources: [
          { title: 'Gemini Source', url: 'https://example.com/gemini' },
        ],
        searchSuggestions: ['suggested gemini query'],
        model: 'gemini-flash-latest',
        responseId: null,
        webSearchCallCount: 1,
      }),
      TestConnectivityAsync: jest.fn().mockResolvedValue({ ok: true }),
      TestProviderConnectivityAsync: jest.fn().mockResolvedValue({
        openai: { ok: true, label: 'OpenAI', configured: true },
        anthropic: { ok: false, label: 'Anthropic Claude', configured: false },
      }),
      GetAvailableModelsAsync: jest.fn().mockResolvedValue([
        'text-embedding-3-small',
        'gpt-4o',
        'gpt-5',
        'o3-mini',
      ]),
      GetAvailableModelsByProviderAsync: jest.fn().mockResolvedValue({
        openai: ['text-embedding-3-small', 'gpt-4o', 'gpt-5', 'o3-mini'],
      }),
      GetAvailableModelCatalogStatusByProviderAsync: jest.fn().mockResolvedValue({
        openai: {
          label: 'OpenAI',
          configured: true,
          ok: true,
          modelIds: ['text-embedding-3-small', 'gpt-4o', 'gpt-5', 'o3-mini'],
        },
        anthropic: {
          label: 'Anthropic Claude',
          configured: false,
          ok: false,
          modelIds: [],
        },
      }),
      GetModelAvailabilityAsync: jest.fn().mockResolvedValue({
        ok: true,
        reason: 'valid',
        providerId: 'openai',
        providerLabel: 'OpenAI',
      }),
      IsValidModelAsync: jest.fn().mockResolvedValue(true),
    };
    mockWorkspaceAIInstances.push(Instance);
    return Instance;
  });
});

// GH-405 (lane p2 review): extend the real client mappings with a client whose NAME carries a time
// word ("Green Day") so the strict time-scope check can be proven NOT to false-positive on it. The
// real resolver (ResolveClientsFromQuery) is kept; only the loaded client list is augmented.
jest.mock('../src/client-mapping', () => {
  const Actual = jest.requireActual('../src/client-mapping');
  return {
    ...Actual,
    LoadClientMappingsSync: () => [
      ...Actual.LoadClientMappingsSync(),
      { ClientID: 'green-day', ClientName: 'Green Day', Aliases: ['green day', 'greenday'] },
    ],
  };
});

const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

/** Shared workspace info used across all integration tests. */
const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'IntegrationWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

/** Minimal stats shape required by ChatModule constructor. */
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

/**
 * Persist a test workspace file so command paths that intentionally call Workspaces.SaveWorkspaceInfoAsync
 * can succeed under integration tests.
 * @param {import('../src/workspaces').WorkspaceInfo} ArgWorkspaceInfo
 * @returns {Promise<void>}
 */
async function WriteWorkspaceFixtureAsync(ArgWorkspaceInfo) {
  const WorkspaceDirPath = Workspaces.GetDirPath();
  await fs.mkdir(WorkspaceDirPath, { recursive: true });
  await fs.writeFile(
    path.join(WorkspaceDirPath, `${ArgWorkspaceInfo.WORKSPACE_NAME}_workspace.json`),
    JSON.stringify(ArgWorkspaceInfo, null, 2)
  );
}

/**
 * Remove a persisted integration-test workspace fixture from disk.
 * @param {string} ArgWorkspaceName
 * @returns {Promise<void>}
 */
async function RemoveWorkspaceFixtureAsync(ArgWorkspaceName) {
  const WorkspaceDirPath = Workspaces.GetDirPath();
  await fs.unlink(path.join(WorkspaceDirPath, `${ArgWorkspaceName}_workspace.json`)).catch(() => {});
  await fs.unlink(path.join(WorkspaceDirPath, `${ArgWorkspaceName}_channel_models.json`)).catch(() => {});
}

describe('ChatModule integration via MockSlackApp', () => {
  beforeEach(() => {
    mockWorkspaceAIInstances.length = 0;
    global.fetch = OriginalFetch;
  });

  afterAll(async () => {
    global.fetch = OriginalFetch;
    await RemoveWorkspaceFixtureAsync('IntegrationWorkspace');
    await RemoveWorkspaceFixtureAsync('IntegrationWorkspaceModels');
  });

  describe('commands command', () => {
    test('admin user receives the full command reference', async () => {
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_COMMANDS',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} commands`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('*Sleuth AI — Command Reference*');
      expect(SlackApp.SentMessages[0].text).not.toContain('run-tests');
    });

    test('non-admin user is rejected from the commands list', async () => {
      // AdminUsers is empty → IsAdminOrOwnerAsync returns false.
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_COMMANDS',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} commands`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(
        'sorry, only workspace admins or owners can view the commands list.'
      );
    });
  });

  describe('ask-code command', () => {
    test('posts the documented upstream answer string', async () => {
      const OriginalTeamId = process.env.NEOCHROME_TEAM_ID;
      const OriginalSecret = process.env.CLIENT_B_RAG_SECRET;
      process.env.NEOCHROME_TEAM_ID = 'T_NEO';
      process.env.CLIENT_B_RAG_SECRET = 'secret-123';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          answer: 'Client B is a FastAPI + Reflex analytics platform.',
          integration_version: '1.1',
        }),
      });

      try {
        const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo, TeamId: 'T_NEO' });
        new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

        const WasHandled = await SlackApp.SimulateAppMentionAsync({
          channel: 'C_CODE',
          user: 'U_REGULAR',
          text: `${SlackApp.AppMentionString} ask-code client-b what does this project do?`,
        });

        expect(WasHandled).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(SlackApp.SentMessages).toHaveLength(1);
        expect(SlackApp.SentMessages[0].text).toContain('Client B is a FastAPI + Reflex analytics platform.');
      } finally {
        if(OriginalTeamId === undefined) delete process.env.NEOCHROME_TEAM_ID;
        else process.env.NEOCHROME_TEAM_ID = OriginalTeamId;
        if(OriginalSecret === undefined) delete process.env.CLIENT_B_RAG_SECRET;
        else process.env.CLIENT_B_RAG_SECRET = OriginalSecret;
      }
    });

    test('unwraps one accidental nested JSON layer in the upstream answer string', async () => {
      const OriginalTeamId = process.env.NEOCHROME_TEAM_ID;
      const OriginalSecret = process.env.CLIENT_B_RAG_SECRET;
      process.env.NEOCHROME_TEAM_ID = 'T_NEO';
      process.env.CLIENT_B_RAG_SECRET = 'secret-123';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          answer: JSON.stringify({
            answer: 'ClientB-Analytics is a multi-tenant SaaS application for e-commerce analytics.',
            integration_version: '1.1',
          }),
          integration_version: '1.1',
        }),
      });

      try {
        const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo, TeamId: 'T_NEO' });
        new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

        const WasHandled = await SlackApp.SimulateAppMentionAsync({
          channel: 'C_CODE',
          user: 'U_REGULAR',
          text: `${SlackApp.AppMentionString} ask-code client-b what does this project do?`,
        });

        expect(WasHandled).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(SlackApp.SentMessages).toHaveLength(1);
        expect(SlackApp.SentMessages[0].text).toContain('ClientB-Analytics is a multi-tenant SaaS application');
        expect(SlackApp.SentMessages[0].text).not.toContain('"answer":');
        expect(SlackApp.SentMessages[0].text).not.toMatch(/^\s*\{/);
      } finally {
        if(OriginalTeamId === undefined) delete process.env.NEOCHROME_TEAM_ID;
        else process.env.NEOCHROME_TEAM_ID = OriginalTeamId;
        if(OriginalSecret === undefined) delete process.env.CLIENT_B_RAG_SECRET;
        else process.env.CLIENT_B_RAG_SECRET = OriginalSecret;
      }
    });

    test('recovers the inner prose when the nested JSON answer is truncated mid-stream', async () => {
      const OriginalTeamId = process.env.NEOCHROME_TEAM_ID;
      const OriginalSecret = process.env.CLIENT_B_RAG_SECRET;
      process.env.NEOCHROME_TEAM_ID = 'T_NEO';
      process.env.CLIENT_B_RAG_SECRET = 'secret-123';
      // Upstream double-encoded the answer AND truncated it mid-stream: the inner JSON has no
      // closing quote/brace, so JSON.parse fails and we must recover the prose by hand.
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          answer: '{\n  "answer": "The context does not mention a v1.1 release branch. Recent V1.1 additions include Phase 14 (the /analysis Reflex page',
          integration_version: '1.1',
        }),
      });

      try {
        const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo, TeamId: 'T_NEO' });
        new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

        const WasHandled = await SlackApp.SimulateAppMentionAsync({
          channel: 'C_CODE',
          user: 'U_REGULAR',
          text: `${SlackApp.AppMentionString} ask-code client-b what was in the v1.1 release branch?`,
        });

        expect(WasHandled).toBe(true);
        expect(SlackApp.SentMessages).toHaveLength(1);
        const Posted = SlackApp.SentMessages[0].text;
        // Inner prose is surfaced (including the part right up to the truncation point)...
        expect(Posted).toContain('The context does not mention a v1.1 release branch');
        expect(Posted).toContain('Phase 14 (the /analysis Reflex page');
        // ...and the raw JSON wrapper is NOT shown to the user...
        expect(Posted).not.toContain('"answer":');
        expect(Posted).not.toMatch(/^\s*\{/);
        // ...with an explicit truncation notice so the partial answer isn't read as complete.
        expect(Posted).toMatch(/truncated/i);
      } finally {
        if(OriginalTeamId === undefined) delete process.env.NEOCHROME_TEAM_ID;
        else process.env.NEOCHROME_TEAM_ID = OriginalTeamId;
        if(OriginalSecret === undefined) delete process.env.CLIENT_B_RAG_SECRET;
        else process.env.CLIENT_B_RAG_SECRET = OriginalSecret;
      }
    });
  });

  describe('help / features command family', () => {
    test('bare help still returns the static help/features documentation', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_HELP',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} help`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('Sleuth');
    });

    test('help with extra guidance text switches into suggestion-only intent mode', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'model-switch-default',
        confidence: 0.92,
        rationale: 'The user is asking how to switch the workspace default model.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: 'gpt-5',
        complex_model_name: '',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_HELP',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} help switch models`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('*Best matching command:*');
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} switch-models:'gpt-5'\``);
    });

    test('features with extra guidance text can suggest a web-search command', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'web-search',
        confidence: 0.89,
        rationale: 'The user wants guidance on the generic web-search command.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: 'automated web browsers',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_HELP',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} features search web for automated web browsers`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} web-search automated web browsers\``);
    });

    test('help with vague search guidance shows concrete search options instead of a weak best-match guess', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'web-search',
        confidence: 0.9,
        rationale: 'The request sounds like a generic search, but it does not say what kind of search Sleuth should perform.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: 'things',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_HELP',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} help search things`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('*Help Mode:* `search` can mean a few different Sleuth commands.');
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} web-search <topic>\``);
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} gemini-search <topic>\``);
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} search reminders <keywords>\``);
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} notion search <keywords>\``);
      expect(SlackApp.SentMessages[0].text).not.toContain('*Best matching command:*');
    });
  });

  describe('view stratalist command', () => {
    test('renders a public Stratalist list from a raw slug', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => JinhuiFixture,
      });

      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_STRATALIST',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} view stratalist jinhui2026`,
      });

      expect(WasHandled).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://stratalist.net/api/public/share/jinhui2026',
        expect.objectContaining({ method: 'GET' })
      );
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('*Jinhui*');
      expect(SlackApp.SentMessages[0].text).toContain('☐ Maintain LinkedIn cadence: 1 post per week');
      expect(SlackApp.SentMessages[0].text).toContain('Stratalist: https://stratalist.net/go/jinhui2026');
    });

    test('returns the Stratalist not-found message instead of falling through to chat', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        json: async () => ({}),
      });

      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_STRATALIST',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} view stratalist missing-list`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('No public Stratalist list found for slug missing-list.');
    });
  });

  describe('changelog command', () => {
    test('summarizes the recent changelog versions through the workspace AI', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync.mockResolvedValueOnce(
        '*Recent changes (last 10 versions)*\n- *1.4.101 — 2026-05-05*: short summary'
      );

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} changelog`,
      });

      expect(WasHandled).toBe(true);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync).toHaveBeenCalledTimes(1);
      const [UserInput, SystemInstructions] =
        mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync.mock.calls[0];
      const VersionHeadingCount = (UserInput.match(/^##\s/gm) || []).length;
      expect(VersionHeadingCount).toBeGreaterThan(0);
      expect(VersionHeadingCount).toBeLessThanOrEqual(10);
      expect(UserInput).not.toContain('# Changelog\n');
      expect(SystemInstructions).toContain('CHANGELOG.md');
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('Recent changes');
    });
  });

  describe('remote test-suite prevention', () => {
    test('admin run-tests command posts a unified error report without starting a Jest process', async () => {
      const SpawnSpy = jest.spyOn(require('child_process'), 'spawn');
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_ADMIN',
        text: [SlackApp.AppMentionString, 'run-tests'].join(' '),
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('Sorry, we cannot run the test suite.');
      expect(SlackApp.SentMessages[0].text).toContain('*Diagnostics:*');
      expect(SpawnSpy).not.toHaveBeenCalled();
      SpawnSpy.mockRestore();
    });
  });

  describe('run-diagnostics command', () => {
    test('non-admin user is rejected from running diagnostics', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} run-diagnostics`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(
        'sorry, only workspace admins or owners can run diagnostics.'
      );
    });

    test('admin user receives a diagnostics results message', async () => {
      const SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        WorkspaceInfo: TestWorkspaceInfo,
        SlackConnectivityResult: { ok: true },
      });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} run-diagnostics`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      // message should contain at least one diagnostics result line.
      expect(SlackApp.SentMessages[0].text).toMatch(/connectivity|OK|FAILED/i);
    });

    test('admin diagnostics include the thread-memory Gemini pipeline probe when GOOGLE_API_KEY is configured', async () => {
      const OriginalGoogleApiKey = process.env.GOOGLE_API_KEY;
      process.env.GOOGLE_API_KEY = 'test-google-key';
      global.fetch = jest.fn(async () => ({
        ok: true,
        text: async () => '',
        json: async () => ({
          embedding: {
            values: Array.from({ length: 768 }, (_v, ArgI) => (ArgI === 0 ? 1 : 0)),
          },
        }),
      }));

      try {
        const SlackApp = new MockSlackApp({
          AdminUsers: ['U_ADMIN'],
          WorkspaceInfo: TestWorkspaceInfo,
          SlackConnectivityResult: { ok: true },
          TeamId: 'T_DIAG',
        });
        new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

        const WasHandled = await SlackApp.SimulateAppMentionAsync({
          channel: 'C_GENERAL',
          user: 'U_ADMIN',
          text: `${SlackApp.AppMentionString} run-diagnostics`,
        });

        expect(WasHandled).toBe(true);
        expect(SlackApp.SentMessages).toHaveLength(1);
        expect(SlackApp.SentMessages[0].text).toContain('Thread-memory Gemini pipeline: OK');
      } finally {
        if(OriginalGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
        else process.env.GOOGLE_API_KEY = OriginalGoogleApiKey;
      }
    });
  });

  describe('switch-models command', () => {
    test('non-admin user is rejected and the model is not changed', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} switch-models:'gpt-4o-mini'`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(
        'sorry, only workspace admins or owners can switch models.'
      );
      expect(WorkspaceAI.GetModelAvailabilityAsync).not.toHaveBeenCalled();
    });

    test('conversational mention of switch-models: in prose does not route as a command', async () => {
      // even an admin user — we isolate the routing anchor here. if the regex weren't anchored,
      // this would route, hit the gate (admin passes), and reach GetModelAvailabilityAsync.
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} please run switch-models:'gpt-4o-mini' for me`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.GetModelAvailabilityAsync).not.toHaveBeenCalled();
      // also confirm no switch-models result message was posted (success or denial).
      const Posted = SlackApp.SentMessages.map(m => m.text).join('\n');
      expect(Posted).not.toContain('switched to');
      expect(Posted).not.toContain('only workspace admins or owners can switch models');
    });

    test('normalizes relaxed direct command syntax and model aliases before routing', async () => {
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
      await WriteWorkspaceFixtureAsync(TestWorkspaceInfo);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} model-switch 'gpt 5'`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('gpt-5');
      expect(SlackApp.SentMessages[0].text).toContain("Default model switched to 'gpt-5'");
    });
  });

  describe('rmm command family', () => {
    test('suggests the closest exact command in a child-thread reply', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'model-switch-default',
        confidence: 0.93,
        rationale: 'User wants to change the workspace default chat model.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: 'gpt-5',
        complex_model_name: '',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} rmm I want to switch to chatgpt 5`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} switch-models:'gpt-5'\``);
      expect(SlackApp.SentMessages[0].text).toContain('Requires workspace admin or owner access');
    });

    test('rmm ifl executes a pre-authorized command through the existing handler path', async () => {
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
      await WriteWorkspaceFixtureAsync(TestWorkspaceInfo);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'model-switch-default',
        confidence: 0.95,
        rationale: 'User explicitly asked to switch the default model to GPT-5.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: 'gpt-5',
        complex_model_name: '',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} rmm ifl switch us to gpt5`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.GetModelAvailabilityAsync).toHaveBeenCalledWith('gpt-5');
      expect(SlackApp.SentMessages[0].text).toContain("On it — running");
      expect(SlackApp.SentMessages[1].text).toContain("Default model switched to 'gpt-5'");
    });

    test('rmm ifl refuses commands that are not pre-authorized for automatic execution', async () => {
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'restart',
        confidence: 0.91,
        rationale: 'User is asking for a service restart.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: '',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} rmm ifl restart sleuth`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('not pre-authorized for `rmm ifl` execution');
    });

    test('suggests a web-search command for google-style search requests', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'gemini-search',
        confidence: 0.9,
        rationale: 'The user explicitly asked to search Google, which maps best to the Gemini-backed Google search command.',
        needs_clarification: false,
        clarification_question: '',
        default_model_name: '',
        complex_model_name: '',
        channel_model_name: '',
        query_text: 'automated web browsers',
        user_mention: '',
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} rmm search google for automated web browsers`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(`\`${SlackApp.AppMentionString} gemini-search automated web browsers\``);
    });
  });

  describe('models command', () => {
    test('shows the current channel override and effective model', async () => {
      const WorkspaceInfo = {
        ...TestWorkspaceInfo,
        WORKSPACE_NAME: 'IntegrationWorkspaceModels',
      };
      const SlackApp = new MockSlackApp({
        AdminUsers: ['U_ADMIN'],
        WorkspaceInfo,
      });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const SetHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_MODELS',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} set-channel-model:'gpt-5'`,
      });
      const ModelsHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_MODELS',
        user: 'U_ADMIN',
        text: `${SlackApp.AppMentionString} models`,
      });

      expect(SetHandled).toBe(true);
      expect(ModelsHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(SlackApp.SentMessages[1].text).toContain('Channel: <#C_MODELS>');
      expect(SlackApp.SentMessages[1].text).toContain('Channel override: `gpt-5`');
      expect(SlackApp.SentMessages[1].text).toContain('Channel basic model: `gpt-5`');
      expect(SlackApp.SentMessages[1].text).toContain('Workspace default chat model: `gpt-4o-mini`');
      // GH-397: the models command surfaces the first-responder (router) tier.
      expect(SlackApp.SentMessages[1].text).toContain('System router mode: `off`');
      expect(SlackApp.SentMessages[1].text).toContain('System router model (first responder): `gemini-3.1-flash-lite`');
    });
  });

  describe('live model catalog questions', () => {
    test('natural current-model question is grounded with the live OpenAI model list', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} what are the available ChatGPT models currently?`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.GetAvailableModelCatalogStatusByProviderAsync).toHaveBeenCalledTimes(1);
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).toHaveBeenCalledTimes(1);
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0]).toContain('gpt-4o');
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0]).toContain('gpt-5');
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0]).not.toContain('text-embedding-3-small');
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toBe('mock response');
    });

    test('refuses to answer from a partial provider catalog and names the failing provider', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      mockWorkspaceAIInstances[0].GetAvailableModelCatalogStatusByProviderAsync.mockResolvedValueOnce({
        openai: {
          label: 'OpenAI',
          configured: true,
          ok: true,
          modelIds: ['gpt-4o', 'gpt-5'],
        },
        anthropic: {
          label: 'Anthropic Claude',
          configured: true,
          ok: false,
          modelIds: [],
          error: 'upstream timeout',
        },
      });

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} what claude models are available?`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain(
        "I couldn't fetch the live model catalog from Anthropic Claude (upstream timeout)"
      );
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
    });
  });

  describe('gemini-search command', () => {
    test('passes the query through to WorkspaceAI gemini search and posts sources', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} gemini-search latest Gemini news`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessGeminiWebSearchAsync).toHaveBeenCalledWith('latest Gemini news');
      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web with Gemini..._');
      expect(SlackApp.SentMessages[1].text).toContain('mock gemini web search response');
      expect(SlackApp.SentMessages[1].text).toContain('<https://example.com/gemini|Gemini Source>');
    });

    test('shows usage when gemini-search query is missing', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} gemini-search`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessGeminiWebSearchAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('Usage: `@Sleuth AI gemini-search <query>`');
    });

    test('search-gemini reverse alias routes to the same gemini-search handler', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} search-gemini latest Gemini news`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessGeminiWebSearchAsync).toHaveBeenCalledWith('latest Gemini news');
      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web with Gemini..._');
      expect(SlackApp.SentMessages[1].text).toContain('mock gemini web search response');
    });

    test.each(['google-search', 'search-google'])('%s alias routes to the gemini-search handler', async (Alias) => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} ${Alias} latest Gemini news`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessGeminiWebSearchAsync).toHaveBeenCalledWith('latest Gemini news');
      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web with Gemini..._');
      expect(SlackApp.SentMessages[1].text).toContain('mock gemini web search response');
    });

    test('renders Gemini search suggestions as Slack-friendly Google links (no raw HTML)', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} gemini-search latest Gemini news`,
      });

      const Posted = SlackApp.SentMessages[1].text;
      expect(Posted).not.toMatch(/<style|class="container"|searchEntryPoint/);
      expect(Posted).toContain('_Related searches:');
      expect(Posted).toContain('<https://www.google.com/search?q=suggested%20gemini%20query|suggested gemini query>');
    });

    test('surfaces the underlying provider error to Slack instead of a generic message', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      WorkspaceAI.ProcessGeminiWebSearchAsync.mockRejectedValueOnce(
        new Error('Gemini web search failed (400): {"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')
      );

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} gemini-search broken query`,
      });

      // [0] is the LoadingMessage, [1] is the failure response.
      expect(SlackApp.SentMessages).toHaveLength(2);
      const Posted = SlackApp.SentMessages[1].text;
      expect(Posted).toContain("Sorry, I couldn't complete that web search.");
      expect(Posted).toContain('Gemini web search failed (400)');
      expect(Posted).toContain('API_KEY_INVALID');
    });

    test('redacts the api key from a surfaced error that contains a key= query string', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      WorkspaceAI.ProcessGeminiWebSearchAsync.mockRejectedValueOnce(
        new Error('fetch failed: https://example.com/v1?key=AIzaSyTOPSECRETabc123&extra=1')
      );

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} gemini-search broken query`,
      });

      const Posted = SlackApp.SentMessages[1].text;
      expect(Posted).toContain('key=<redacted>');
      expect(Posted).not.toContain('AIzaSyTOPSECRETabc123');
    });
  });

  describe('web-search command', () => {
    test('passes the query through to WorkspaceAI web search and posts sources', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} web-search latest OpenAI news`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).toHaveBeenCalledWith('latest OpenAI news');
      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web..._');
      expect(SlackApp.SentMessages[1].text).toContain('mock web search response');
      expect(SlackApp.SentMessages[1].text).toContain('<https://example.com/source|Example Source>');
    });

    test('shows usage when web-search query is missing', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} web-search`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('Usage: `@Sleuth AI web-search <query>`');
    });

    test('shows usage when web-search is followed only by whitespace', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} web-search    `,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('Usage: `@Sleuth AI web-search <query>`');
    });

    test('search-web reverse alias routes to the same web-search handler', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} search-web latest OpenAI news`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).toHaveBeenCalledWith('latest OpenAI news');
      expect(SlackApp.SentMessages).toHaveLength(2);
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web..._');
      expect(SlackApp.SentMessages[1].text).toContain('mock web search response');
    });

    test('web-search-advanced is reserved without running Phase 1 search', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} web-search-advanced latest OpenAI news`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('not enabled yet');
    });

    test('natural-language search alias routes to web search without the explicit command', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} could you look up Slack API rate limits?`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).toHaveBeenCalledWith('Slack API rate limits');
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web..._');
    });

    test('freshness-sensitive question auto-routes to web search', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} what's the latest on OpenAI today?`,
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).toHaveBeenCalledWith("what's the latest on OpenAI today?");
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web..._');
    });
  });

  describe('freeform chat answer "Search the web" suggestion button', () => {
    test('renders a chat-google-search button when no other users are tagged', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} is there a Markdown viewer plugin for Slack`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(0);
      expect(SlackApp.SentBlockMessages).toHaveLength(1);

      const Posted = SlackApp.SentBlockMessages[0];
      expect(Posted.text).toBe('mock response');

      const ActionsBlock = Posted.blocks.find((Block) => Block.type === 'actions');
      expect(ActionsBlock).toBeTruthy();
      const Button = ActionsBlock.elements[0];
      expect(Button.action_id).toBe('chat-google-search');
      expect(Button.value).toBe('is there a Markdown viewer plugin for Slack');
      expect(Button.text.text).toContain('is there a Markdown viewer plugin');
    });

    test('suppresses the button when another user is tagged in the inbound message', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} <@U07ALICE99> what do you think about this idea`,
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentBlockMessages).toHaveLength(0);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toBe('mock response');
    });
  });

  describe('unsupported reminder actions', () => {
    test('posts an explicit non-success message instead of falling through to freeform AI', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        text: `${SlackApp.AppMentionString} make a reminder for <@U07ALICE99> based on task above`,
      });

      expect(WasHandled).toBe(true);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain("I didn't create a reminder.");
      expect(SlackApp.SentMessages[0].text).toContain('tomorrow morning');
    });
  });

  describe('chat-google-search button click', () => {
    test('routes the carried query through the OpenAI web-search provider', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateActionAsync('chat-google-search', {
        channel: 'C_GENERAL',
        user: 'U_REGULAR',
        value: 'Markdown viewer plugin for Slack',
        messageTs: '1700000000.000100',
        threadTs: '1700000000.000050',
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WasHandled).toBe(true);
      expect(WorkspaceAI.ProcessWebSearchAsync).toHaveBeenCalledWith('Markdown viewer plugin for Slack');
      expect(SlackApp.SentMessages[0].text).toBe('_Searching the web..._');
      expect(SlackApp.SentMessages[0].threadTs).toBe('1700000000.000050');
    });
  });

  describe('GH-412: DM top-level messages get a chat reply', () => {
    test('a 1:1 DM (channel_type=im) top-level message with no thread/mention gets a reply', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'D_DM_TEST',
        text: 'what can you help me with today?',
        channel_type: 'im',
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('mock response');
    });

    test('a regular channel top-level message with no thread/mention is unaffected (still no reply)', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'C_TEST',
        text: 'what can you help me with today?',
      });

      expect(WasHandled).toBe(false);
      expect(SlackApp.SentMessages).toHaveLength(0);
    });

    test('a group DM (channel_type=mpim) top-level message is NOT bypassed', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'G_GROUP_DM_TEST',
        text: 'what can you help me with today?',
        channel_type: 'mpim',
      });

      expect(WasHandled).toBe(false);
      expect(SlackApp.SentMessages).toHaveLength(0);
    });

    test('a threaded follow-up reply in a 1:1 DM still gets a reply (GH-412 follow-up fix)', async () => {
      const RootTS = '1700000009.000001';
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      // first DM message (no thread yet) — establishes the conversation.
      await SlackApp.SimulateMessageAsync({
        channel: 'D_DM_TEST', ts: RootTS, text: 'hey, question for you', channel_type: 'im',
      });
      SlackApp.SentMessages.length = 0;

      // second message, now threaded off Sleuth's own reply — the case that used to fall through
      // to the old hands-free logic (no app mention in the thread root, no :bell: reaction) and
      // silently get ignored.
      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'D_DM_TEST', ts: '1700000009.000002', thread_ts: RootTS,
        text: 'actually, following up on that', channel_type: 'im',
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('mock response');
    });

    test('a DM message that mentions another user still gets a reply (GH-412 follow-up fix)', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'D_DM_TEST',
        text: 'can you help me draft something for <@U999>?',
        channel_type: 'im',
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toContain('mock response');
    });

    test('a group DM (mpim) message mentioning another user is still dropped (mention check unaffected)', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'G_GROUP_DM_TEST',
        text: 'can you help me draft something for <@U999>?',
        channel_type: 'mpim',
      });

      expect(WasHandled).toBe(false);
      expect(SlackApp.SentMessages).toHaveLength(0);
    });
  });

  describe('thread context memory', () => {
    const MSA_CONTENT = '# Master Services Agreement\n\nBetween BiomeScope, Inc. and Neochrome, Inc.';
    const MD_FILE = {
      name: 'MSA-DRAFT.md',
      size: MSA_CONTENT.length,
      url_private: 'https://files.slack.test/MSA-DRAFT.md?preview=1&token=secret-preview',
      url_private_download: 'https://files.slack.test/MSA-DRAFT.md?download=1&token=secret-download',
    };

    test('file-only upload posts confirmation and returns without an AI answer', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue(MSA_CONTENT);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000001.000001', text: '<@UBOT123>',
        files: [MD_FILE],
      });

      expect(WasHandled).toBe(true);
      // confirmation posted, no AI call
      expect(SlackApp.SentMessages[0].text).toMatch(/I've loaded \*MSA-DRAFT\.md\*/);
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      const DownloadLog = SlackApp.Logger.InfoMessages.find((ArgMessage) => ArgMessage.includes('[TryStoreThreadMemoryFile]'));
      expect(DownloadLog).toContain('host: files.slack.test');
      expect(DownloadLog).not.toContain('secret-download');
      const ChatModuleEventLog = SlackApp.Logger.InfoMessages.find((ArgMessage) => ArgMessage.includes('app_mention event handled by ChatModule:'));
      expect(ChatModuleEventLog).toContain('"host":"files.slack.test"');
      expect(ChatModuleEventLog).not.toContain('secret-download');
    });

    test('file + question suppresses confirmation and posts AI answer with attribution footer', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue(MSA_CONTENT);
      const WorkspaceAI_PreCreate = { ProcessMessageWithTextResponseAsync: null };
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000002.000001',
        text: '<@UBOT123> what are your thoughts on the attached MSA?',
        files: [MD_FILE],
      });

      expect(WasHandled).toBe(true);
      // no "I've loaded" confirmation
      expect(SlackApp.SentMessages.some((M) => /I've loaded/.test(M.text))).toBe(false);
      // AI was called
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
      // attribution footer present
      const ResponseMsg = SlackApp.SentMessages.find((M) => /Answer based on context from/.test(M.text));
      expect(ResponseMsg).toBeDefined();
      expect(ResponseMsg.text).toMatch(/MSA-DRAFT\.md/);
    });

    test('leaked Context Memory File block is stripped from the posted answer', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue(MSA_CONTENT);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      // model parrots the input-only context wrapper back into its answer (the bug from the screenshot).
      mockWorkspaceAIInstances[0].ProcessMessageWithTextResponseAsync.mockResolvedValueOnce(
        '=== Context Memory File: MSA-DRAFT.md ===\n' +
        '# Master Services Agreement\nBetween BiomeScope, Inc. and Neochrome, Inc.\n' +
        '=== End Context Memory ===\n\n' +
        'The agreement is between BiomeScope and Neochrome.'
      );

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000002.000050',
        text: '<@UBOT123> what are your thoughts on the attached MSA?',
        files: [MD_FILE],
      });

      expect(WasHandled).toBe(true);
      const ResponseMsg = SlackApp.SentMessages.find((M) => /BiomeScope and Neochrome/.test(M.text));
      expect(ResponseMsg).toBeDefined();
      // the internal delimiters must never reach Slack...
      expect(ResponseMsg.text).not.toMatch(/Context Memory File/);
      expect(ResponseMsg.text).not.toMatch(/End Context Memory/);
      expect(ResponseMsg.text).not.toMatch(/===/);
      // ...but the actual answer (and attribution footer) survive.
      expect(ResponseMsg.text).toMatch(/^The agreement is between BiomeScope and Neochrome\./);
      expect(ResponseMsg.text).toMatch(/Answer based on context from: \*MSA-DRAFT\.md\*/);
    });

    test('file + question posts the download failure and does not fall through to an ungrounded AI answer', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockRejectedValue(new Error('Slack denied download'));
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000002.000099',
        text: '<@UBOT123> summarize the attached agreement',
        files: [MD_FILE],
      });

      expect(WasHandled).toBe(true);
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toMatch(/couldn't download \*MSA-DRAFT\.md\*/i);
    });

    test('thread auto-response with a failed file load posts the error and skips the AI call', async () => {
      const RootTS = '1700000002.000200';
      const SlackApp = new MockSlackApp({
        WorkspaceInfo: TestWorkspaceInfo,
        ThreadMessagesById: {
          [`C_TEST:${RootTS}`]: [
            { user: 'U_USER', ts: RootTS, text: '<@UBOT123> please review uploads here', bot_id: null },
          ],
        },
      });
      SlackApp.GetFileContentAsync.mockRejectedValue(new Error('Slack denied download'));
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateMessageAsync({
        channel: 'C_TEST',
        ts: '1700000002.000201',
        thread_ts: RootTS,
        text: 'Can you summarize this file?',
        files: [MD_FILE],
      });

      expect(WasHandled).toBe(true);
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].threadTs).toBe(RootTS);
      expect(SlackApp.SentMessages[0].text).toMatch(/couldn't download \*MSA-DRAFT\.md\*/i);
    });

    test('follow-up reply in thread reuses stored context memory and appends attribution', async () => {
      const RootTS = '1700000003.000001';
      const SlackApp = new MockSlackApp({
        WorkspaceInfo: TestWorkspaceInfo,
        ThreadMessagesById: {
          [`C_TEST:${RootTS}`]: [
            { user: 'U_USER', ts: RootTS, text: '<@UBOT123> review this MSA', bot_id: null },
          ],
        },
      });
      SlackApp.GetFileContentAsync.mockResolvedValue(MSA_CONTENT);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      // simulate initial file upload (stores context memory)
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: RootTS,
        text: '<@UBOT123> review this MSA',
        files: [MD_FILE],
      });

      // simulate follow-up reply in thread (thread_ts = root ts)
      SlackApp.SentMessages.length = 0;
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      WorkspaceAI.ProcessMessageWithTextResponseAsync.mockClear();

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000003.000050', thread_ts: RootTS,
        text: '<@UBOT123> is the IP section fair?',
      });

      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
      const PromptArg = WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0];
      expect(PromptArg).toMatch(/Context Memory File: MSA-DRAFT\.md/);
      expect(PromptArg).toMatch(/Master Services Agreement/);
      // attribution in response
      const ResponseMsg = SlackApp.SentMessages.find((M) => /Answer based on context from/.test(M.text));
      expect(ResponseMsg).toBeDefined();
    });

    test('attribution footer is absent when no context memory file was stored', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000004.000001',
        text: '<@UBOT123> what is 2 + 2?',
      });

      const AnyAttribution = SlackApp.SentMessages.some((M) => /Answer based on context from/.test(M.text));
      expect(AnyAttribution).toBe(false);
    });

    test('overwriting with a second file replaces context memory for the thread', async () => {
      const SecondContent = '# Statement of Work\n\nDeliverables: widget dashboard';
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync
        .mockResolvedValueOnce(MSA_CONTENT)
        .mockResolvedValueOnce(SecondContent);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const RootTS = '1700000005.000001';

      // first upload
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: RootTS, text: '<@UBOT123>',
        files: [MD_FILE],
      });
      // second upload in same thread (thread reply)
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000005.000050', thread_ts: RootTS,
        text: '<@UBOT123>',
        files: [{ name: 'SOW.md', size: SecondContent.length, url_private: 'https://files.slack.test/SOW.md' }],
      });

      SlackApp.SentMessages.length = 0;
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      WorkspaceAI.ProcessMessageWithTextResponseAsync.mockClear();

      // follow-up should use the second file
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000005.000100', thread_ts: RootTS,
        text: '<@UBOT123> summarize the document',
      });

      const PromptArg = WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0];
      expect(PromptArg).toMatch(/Context Memory File: SOW\.md/);
      expect(PromptArg).not.toMatch(/MSA-DRAFT\.md/);
    });

    // --- regression: broadened detection beyond `.md` (the slow-query snippet bug) ---

    test('a Slack code snippet (no .md extension) is loaded and analyzed via mimetype/filetype', async () => {
      const SNIPPET_CONTENT = 'pt-query-digest --since=12h /var/log/mysql/mysql-slow.log';
      // exact shape of the failing attachment from the bug report: a snippet with no ".md" name,
      // a text mimetype and a language filetype.
      const SNIPPET_FILE = {
        name: 'shop2client-a-slowqueries',
        mimetype: 'text/plain',
        filetype: 'shell',
        size: SNIPPET_CONTENT.length,
        url_private: 'https://files.slack.test/snippet?preview=1',
        url_private_download: 'https://files.slack.test/snippet?download=1',
      };
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue(SNIPPET_CONTENT);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000006.000001',
        text: '<@UBOT123> analyze attached files for WP slow queries and give me top 3 issues',
        files: [SNIPPET_FILE],
      });

      expect(WasHandled).toBe(true);
      // the AI was called with the snippet content as grounded context...
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
      const PromptArg = WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0];
      expect(PromptArg).toMatch(/Context Memory File: shop2client-a-slowqueries/);
      expect(PromptArg).toMatch(/pt-query-digest/);
      // ...and the attribution footer names the snippet, not a generic "I don't see any files".
      const ResponseMsg = SlackApp.SentMessages.find((M) => /Answer based on context from/.test(M.text));
      expect(ResponseMsg).toBeDefined();
      expect(ResponseMsg.text).toMatch(/shop2client-a-slowqueries/);
    });

    test('a .log file with question text is loaded as context (broadened extensions)', async () => {
      const LOG_CONTENT = 'ERROR query took 12.4s on wp_postmeta';
      const LOG_FILE = {
        name: 'mysql-slow.log', size: LOG_CONTENT.length,
        url_private_download: 'https://files.slack.test/mysql-slow.log?download=1',
      };
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue(LOG_CONTENT);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000006.000050',
        text: '<@UBOT123> what is the slowest query?',
        files: [LOG_FILE],
      });

      const WorkspaceAI = mockWorkspaceAIInstances[0];
      const PromptArg = WorkspaceAI.ProcessMessageWithTextResponseAsync.mock.calls[0][0];
      expect(PromptArg).toMatch(/Context Memory File: mysql-slow\.log/);
      expect(PromptArg).toMatch(/wp_postmeta/);
    });

    test('a binary/unsupported attachment posts a clear message and does not fall through to an AI answer', async () => {
      const IMAGE_FILE = {
        name: 'screenshot.png', mimetype: 'image/png', size: 2048,
        url_private_download: 'https://files.slack.test/screenshot.png',
      };
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000006.000100',
        text: '<@UBOT123> review attached files',
        files: [IMAGE_FILE],
      });

      expect(WasHandled).toBe(true);
      const WorkspaceAI = mockWorkspaceAIInstances[0];
      expect(WorkspaceAI.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
      expect(SlackApp.SentMessages).toHaveLength(1);
      expect(SlackApp.SentMessages[0].text).toMatch(/only read text-based files/i);
      expect(SlackApp.SentMessages[0].text).toMatch(/screenshot\.png/);
      // the download was never attempted for an unsupported file.
      expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalled();
    });

    test('an .xml/HTML-fragment file that starts with "<" is NOT rejected as an HTML error page', async () => {
      const XML_CONTENT = '<?xml version="1.0"?>\n<config><timeout>30</timeout></config>';
      const XML_FILE = {
        name: 'config.xml', size: XML_CONTENT.length,
        url_private_download: 'https://files.slack.test/config.xml?download=1',
      };
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue(XML_CONTENT);
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000006.000150', text: '<@UBOT123>',
        files: [XML_FILE],
      });

      // file-only upload posts the "I've loaded" confirmation (not the HTML-page error).
      expect(SlackApp.SentMessages[0].text).toMatch(/I've loaded \*config\.xml\*/);
      expect(SlackApp.SentMessages.some((M) => /returned a page/.test(M.text))).toBe(false);
    });

    test('an actual Slack HTML error page IS still rejected', async () => {
      const HTML_FILE = {
        name: 'notes.md', size: 4096,
        url_private_download: 'https://files.slack.test/notes.md?download=1',
      };
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue('<!DOCTYPE html>\n<html><body>Sign in to Slack</body></html>');
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEST', ts: '1700000006.000200', text: '<@UBOT123>',
        files: [HTML_FILE],
      });

      expect(WasHandled).toBe(true);
      expect(SlackApp.SentMessages[0].text).toMatch(/returned a page instead of the file content/i);
    });
  });

  // GH-397: router mode (off/shadow/active). Exercises the real hot-path hook in #OnAppMentionAsync:
  // the admin toggle flips per-workspace mode, and in `active` mode Flash Lite's resolved command is
  // executed via the same CommandRouter (full takeover) above the confidence floor, else falls back.
  describe('router-mode (GH-397)', () => {
    const ShadowFile = Workspaces.GetSubdirPath('shadow', 'IntegrationWorkspace_router-shadow.jsonl');
    afterEach(async () => { await fs.unlink(ShadowFile).catch(() => {}); });

    /** Flip the workspace into a given router mode via the admin command; returns the ChatModule env. */
    async function ArmModeAsync(ArgMode) {
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
      const Handled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} router-mode ${ArgMode}`,
      });
      expect(Handled).toBe(true);
      expect(SlackApp.SentMessages[SlackApp.SentMessages.length - 1].text).toMatch(new RegExp(`set to \\*${ArgMode}\\*`, 'i'));
      SlackApp.SentMessages.length = 0; // clear the confirmation so later assertions are clean
      return SlackApp;
    }

    test('non-admins cannot change the mode', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo }); // no admins
      new ChatModule(SlackApp, EmptyWorkspaceStats, null, null, null);
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_REGULAR', text: `${SlackApp.AppMentionString} router-mode active`,
      });
      expect(SlackApp.SentMessages[0].text).toMatch(/only workspace admins or owners can change the router mode/i);
    });

    test('active mode executes a Flash-Lite-resolved command (full takeover)', async () => {
      const SlackApp = await ArmModeAsync('active');
      // Flash Lite resolves the free-text mention to the `commands` intent with high confidence.
      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'commands', confidence: 0.98, rationale: 'wants the command list',
        needs_clarification: false, clarification_question: '',
        default_model_name: '', complex_model_name: '', channel_model_name: '', query_text: '', user_mention: '',
      });

      const Handled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} what can you do for me`,
      });

      expect(Handled).toBe(true);
      // takeover ran the resolved `commands` route (not the generic chat fallback)
      expect(SlackApp.SentMessages.some((ArgM) => /\*Sleuth AI — Command Reference\*/.test(ArgM.text))).toBe(true);
    });

    test('active mode falls back to the normal pipeline below the confidence floor', async () => {
      const SlackApp = await ArmModeAsync('active');
      // Low confidence → ShouldExecute is false → no takeover → normal pipeline handles it.
      mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce({
        intent_id: 'commands', confidence: 0.10, rationale: 'unsure',
        needs_clarification: false, clarification_question: '',
        default_model_name: '', complex_model_name: '', channel_model_name: '', query_text: '', user_mention: '',
      });

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} what can you do for me`,
      });

      // did NOT execute the command; fell through to generic AI chat instead
      expect(SlackApp.SentMessages.some((ArgM) => /\*Sleuth AI — Command Reference\*/.test(ArgM.text))).toBe(false);
    });

    test('shadow mode leaves production behavior unchanged', async () => {
      const SlackApp = await ArmModeAsync('shadow');
      // A real command still routes normally while shadow observes.
      const Handled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} commands`,
      });
      expect(Handled).toBe(true);
      expect(SlackApp.SentMessages.some((ArgM) => /\*Sleuth AI — Command Reference\*/.test(ArgM.text))).toBe(true);
    });
  });

  // GH-405 (lane p2): active-mode deterministic open-count answers. The count is recomputed LIVE from
  // RemindersModule.GetAllReminders() at answer time — never the cached snapshot — and channel-privacy
  // scoped. Doubly gated: router mode must be `active` AND ROUTER_SNAPSHOT_ENABLED must be truthy.
  describe('GH-405 active-mode deterministic open-count', () => {
    const ShadowFile = Workspaces.GetSubdirPath('shadow', 'IntegrationWorkspace_router-shadow.jsonl');
    let SavedSnapshotEnv;
    beforeEach(() => { SavedSnapshotEnv = process.env.ROUTER_SNAPSHOT_ENABLED; });
    afterEach(async () => {
      if(SavedSnapshotEnv === undefined) delete process.env.ROUTER_SNAPSHOT_ENABLED;
      else process.env.ROUTER_SNAPSHOT_ENABLED = SavedSnapshotEnv;
      await fs.unlink(ShadowFile).catch(() => {});
    });

    /**
     * A minimal per-workspace RemindersModule stand-in. GetAllReminders returns the LIVE array (mutate
     * it to prove live recompute). GetWorkspaceSnapshot deliberately reports a WRONG number so any test
     * that passed if the count read the cache would fail.
     * @param {any[]} ArgReminders
     * @returns {any}
     */
    function MakeFakeRemindersModule(ArgReminders) {
      return {
        GetAllReminders: () => ArgReminders,
        GetWorkspaceSnapshot: () => ({ openTotal: 999, topClientsByOpen: [{ name: 'Client A', count: 999 }] }),
      };
    }

    /**
     * @param {any} ArgReminder
     * @returns {any}
     */
    function MakeReminder(ArgReminder) {
      return {
        ReminderID: ArgReminder.id,
        clientId: ArgReminder.clientId ?? null,
        State: ArgReminder.state ?? 'scheduled',
        OriginalChannelID: ArgReminder.channel ?? 'C_ROUTER',
        CreatedOn: new Date('2026-07-15T12:00:00Z'),
      };
    }

    /** Arm active mode with a supplied RemindersModule; returns the wired SlackApp. */
    async function ArmActiveWithRemindersAsync(ArgReminders, ArgOptions = {}) {
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      // Default: every candidate channel is public and membership is irrelevant.
      SlackApp.IsChannelPrivateAsync = jest.fn().mockResolvedValue(false);
      SlackApp.IsUserChannelMemberAsync = jest.fn().mockResolvedValue(false);
      if(ArgOptions.privacyResolvers) ArgOptions.privacyResolvers(SlackApp);
      new ChatModule(SlackApp, EmptyWorkspaceStats, MakeFakeRemindersModule(ArgReminders), null, null);
      const Handled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} router-mode active`,
      });
      expect(Handled).toBe(true);
      SlackApp.SentMessages.length = 0;
      return SlackApp;
    }

    const CountRe = /Client A has \*(\d+)\* open task/;

    test('answers with the correct LIVE count for a resolved client (no LLM call)', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const Reminders = [
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
        MakeReminder({ id: 'r2', clientId: 'client-a', state: 'overdue' }),
        MakeReminder({ id: 'r3', clientId: 'client-b', state: 'scheduled' }),
        MakeReminder({ id: 'r4', clientId: 'client-a', state: 'completed' }), // not an OPEN state
      ];
      const SlackApp = await ArmActiveWithRemindersAsync(Reminders);

      const Handled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });

      expect(Handled).toBe(true);
      const Answer = SlackApp.SentMessages.find((ArgM) => CountRe.test(ArgM.text));
      expect(Answer).toBeDefined();
      expect(Answer.text.match(CountRe)[1]).toBe('2'); // r1 + r2 (open), NOT r3 (other client) / r4 (completed)
      // Deterministic: the router never consulted the model to produce the count.
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
    });

    test('count reflects a just-created reminder — proves LIVE recompute, not the cached snapshot', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const Reminders = [
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
        MakeReminder({ id: 'r2', clientId: 'client-a', state: 'scheduled' }),
      ];
      const SlackApp = await ArmActiveWithRemindersAsync(Reminders);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });
      const First = SlackApp.SentMessages.find((ArgM) => CountRe.test(ArgM.text));
      expect(First.text.match(CountRe)[1]).toBe('2');

      // A new client-a reminder is created after the first answer. If the count read the cached snapshot
      // (which reports 999) or a memoized value, this second answer would be wrong.
      Reminders.push(MakeReminder({ id: 'r3', clientId: 'client-a', state: 'scheduled' }));
      SlackApp.SentMessages.length = 0;

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });
      const Second = SlackApp.SentMessages.find((ArgM) => CountRe.test(ArgM.text));
      expect(Second.text.match(CountRe)[1]).toBe('3');
    });

    test('excludes private-channel reminders the asker is not a member of', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const Reminders = [
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled', channel: 'C_ROUTER' }),   // command channel — visible
        MakeReminder({ id: 'r2', clientId: 'client-a', state: 'scheduled', channel: 'C_PRIVATE' }),  // private, non-member — hidden
      ];
      const SlackApp = await ArmActiveWithRemindersAsync(Reminders, {
        privacyResolvers: (ArgApp) => {
          ArgApp.IsChannelPrivateAsync = jest.fn().mockImplementation(async (ArgId) => ArgId === 'C_PRIVATE');
          ArgApp.IsUserChannelMemberAsync = jest.fn().mockResolvedValue(false); // asker is in no private channel
        },
      });

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });
      const Answer = SlackApp.SentMessages.find((ArgM) => CountRe.test(ArgM.text));
      expect(Answer.text.match(CountRe)[1]).toBe('1'); // only the command-channel reminder is countable
    });

    test('unresolved channel privacy declines — an incomplete view yields no exact count (falls through)', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      // The single candidate channel can't be classified right now (transient Slack failure → UNRESOLVED).
      const Reminders = [
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled', channel: 'C_UNRESOLVED' }),
      ];
      const SlackApp = await ArmActiveWithRemindersAsync(Reminders, {
        privacyResolvers: (ArgApp) => {
          ArgApp.IsChannelPrivateAsync = jest.fn().mockResolvedValue(null); // null → UNRESOLVED (never true/false)
        },
      });

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });

      // No confident count is posted; the request falls through to the normal model resolver.
      expect(SlackApp.SentMessages.some((ArgM) => CountRe.test(ArgM.text))).toBe(false);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).toHaveBeenCalled();
    });

    test.each([
      'how many open tasks for client-a this year',
      'how many open tasks for client-a next week',
      'how many open tasks for client-a tomorrow',
    ])('time-scoped question declines: "%s"', async (ArgText) => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const SlackApp = await ArmActiveWithRemindersAsync([
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
      ]);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} ${ArgText}`,
      });

      // A time-scoped count can't be answered by the live all-time path — decline and fall through.
      expect(SlackApp.SentMessages.some((ArgM) => CountRe.test(ArgM.text))).toBe(false);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).toHaveBeenCalled();
    });

    test('first-person assignee question declines ("how many open tasks do I have for client-a")', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const SlackApp = await ArmActiveWithRemindersAsync([
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
      ]);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks do I have for client-a`,
      });

      // An assignee-scoped question is not a pure client count — decline and fall through.
      expect(SlackApp.SentMessages.some((ArgM) => CountRe.test(ArgM.text))).toBe(false);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).toHaveBeenCalled();
    });

    test('a client whose NAME contains a time word ("Green Day") STILL answers — no false-positive', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const Reminders = [
        MakeReminder({ id: 'r1', clientId: 'green-day', state: 'scheduled' }),
        MakeReminder({ id: 'r2', clientId: 'green-day', state: 'overdue' }),
      ];
      const SlackApp = await ArmActiveWithRemindersAsync(Reminders);

      const Handled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for green day`,
      });

      expect(Handled).toBe(true);
      const GreenDayRe = /Green Day has \*(\d+)\* open task/;
      const Answer = SlackApp.SentMessages.find((ArgM) => GreenDayRe.test(ArgM.text));
      expect(Answer).toBeDefined();
      expect(Answer.text.match(GreenDayRe)[1]).toBe('2'); // "day" in the client name must NOT trip the time-scope check
    });

    test('ambiguous query (no resolved client) falls through to the normal resolver', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const SlackApp = await ArmActiveWithRemindersAsync([
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
      ]);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks are there`,
      });

      // No deterministic count posted; the model resolver was consulted (normal fall-through).
      expect(SlackApp.SentMessages.some((ArgM) => CountRe.test(ArgM.text))).toBe(false);
      expect(mockWorkspaceAIInstances[0].ProcessMessageWithJsonResponseAsync).toHaveBeenCalled();
    });

    test('no deterministic answer when the gate (ROUTER_SNAPSHOT_ENABLED) is off', async () => {
      delete process.env.ROUTER_SNAPSHOT_ENABLED;
      const SlackApp = await ArmActiveWithRemindersAsync([
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
      ]);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });
      expect(SlackApp.SentMessages.some((ArgM) => CountRe.test(ArgM.text))).toBe(false);
    });

    test('no deterministic answer when router mode is not active (shadow)', async () => {
      process.env.ROUTER_SNAPSHOT_ENABLED = 'true';
      const SlackApp = new MockSlackApp({ AdminUsers: ['U_ADMIN'], WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.IsChannelPrivateAsync = jest.fn().mockResolvedValue(false);
      new ChatModule(SlackApp, EmptyWorkspaceStats, MakeFakeRemindersModule([
        MakeReminder({ id: 'r1', clientId: 'client-a', state: 'scheduled' }),
      ]), null, null);
      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} router-mode shadow`,
      });
      SlackApp.SentMessages.length = 0;

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_ROUTER', user: 'U_ADMIN', text: `${SlackApp.AppMentionString} how many open tasks for client-a`,
      });
      expect(SlackApp.SentMessages.some((ArgM) => CountRe.test(ArgM.text))).toBe(false);
    });
  });
});
