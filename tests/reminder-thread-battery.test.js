'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// mock WorkspaceAI so this test exercises the harness plumbing + the real reminders pipeline's
// trigger/enrichment logic without making real LLM calls, mirroring reminders-integration.test.js.
jest.mock('../src/workspace-ai');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');

const Workspaces = require('../src/workspaces');

const { MockSlackApp } = require('./mocks/mock-slack-app');

const {
  ParseArgs,
  LoadScenarioAsync,
  GetReminderRuntimeFilePaths,
  CleanupRuntimeFilesAsync,
  IsolateRuntimeTreeAsync,
  SeedEnabledChannelAsync,
  MakeTurnTS,
  RunScenarioAsync,
} = require('../scripts/reminder-thread-battery');

const FakeWorkspaceInfo = {
  WORKSPACE_NAME: 'BatteryTestWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

describe('reminder-thread-battery ParseArgs', () => {
  test('requires --workspace and --scenario at the call site (not enforced by ParseArgs itself)', () => {
    expect(ParseArgs(['--workspace', 'neochrome-dev', '--scenario', 'scenario.json'])).toEqual({
      WorkspaceName: 'neochrome-dev',
      ScenarioPath: 'scenario.json',
      KeepData: false,
      HelpRequested: false,
    });
  });

  test('parses --keep-data and --help flags', () => {
    expect(ParseArgs(['--keep-data', '--help'])).toEqual({
      WorkspaceName: null,
      ScenarioPath: null,
      KeepData: true,
      HelpRequested: true,
    });
  });

  test('throws on an unknown argument', () => {
    expect(() => ParseArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
  });

  test('throws when --workspace has no value', () => {
    expect(() => ParseArgs(['--workspace'])).toThrow('Missing workspace name after --workspace.');
  });
});

describe('reminder-thread-battery standalone `node` invocation (no jest global)', () => {
  // Codex review (relay-system/2026-07-21/gh-424-phase-2-review-...): jest defines `global.jest`
  // automatically, so every jest-run test above masks the fact that MockSlackApp's constructor
  // calls `jest.fn()` unconditionally. This script's only documented invocation is plain `node`,
  // where `global.jest` does not exist at all — reproduce that exact environment via a real child
  // process rather than jest's own (already-jest-shimmed) process.
  test('requiring the script installs a jest shim so MockSlackApp construction does not throw', () => {
    const Probe = `
      require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'reminder-thread-battery.js'))});
      const { MockSlackApp } = require(${JSON.stringify(path.join(__dirname, 'mocks', 'mock-slack-app.js'))});
      new MockSlackApp({ WorkspaceInfo: { WORKSPACE_NAME: 'probe' } });
      console.log('OK');
    `;
    const Output = execFileSync(process.execPath, ['-e', Probe], { encoding: 'utf8' });
    expect(Output.trim()).toBe('OK');
  });
});

describe('reminder-thread-battery LoadScenarioAsync', () => {
  const TmpScenarioPath = path.join(os.tmpdir(), 'reminder-thread-battery-test-scenario.json');

  afterEach(async () => {
    await fs.rm(TmpScenarioPath, { force: true });
  });

  test('parses a valid scenario with defaults applied', async () => {
    await fs.writeFile(TmpScenarioPath, JSON.stringify({
      turns: [{ user: 'U_NOEL', text: "let's run to the park" }],
    }));

    const Scenario = await LoadScenarioAsync(TmpScenarioPath);
    expect(Scenario.channel).toBe('C_HARNESS');
    // GH-68: was 'im'. A DM skips the enabled-channels gate, so the harness's DEFAULT shape was
    // one real reports almost never have. The harness now seeds that gate, so defaulting to a
    // channel thread costs nothing and stops the default run from diverging from production.
    expect(Scenario.channelType).toBe('channel');
    expect(Scenario.turns).toEqual([{ user: 'U_NOEL', text: "let's run to the park" }]);
  });

  test('honors an explicit channel/channelType and defaults a missing turn user', async () => {
    await fs.writeFile(TmpScenarioPath, JSON.stringify({
      channel: 'C_CUSTOM',
      channelType: undefined,
      turns: [{ text: 'no user given' }],
    }));

    const Scenario = await LoadScenarioAsync(TmpScenarioPath);
    expect(Scenario.channel).toBe('C_CUSTOM');
    expect(Scenario.turns[0].user).toBe('U_HARNESS');
  });

  test('throws when "turns" is missing or empty', async () => {
    await fs.writeFile(TmpScenarioPath, JSON.stringify({ turns: [] }));
    await expect(LoadScenarioAsync(TmpScenarioPath)).rejects.toThrow('non-empty "turns" array');
  });

  test('throws when a turn has empty text', async () => {
    await fs.writeFile(TmpScenarioPath, JSON.stringify({ turns: [{ text: '   ' }] }));
    await expect(LoadScenarioAsync(TmpScenarioPath)).rejects.toThrow('non-empty "text" field');
  });
});

describe('reminder-thread-battery path/ts helpers', () => {
  test('GetReminderRuntimeFilePaths returns the 5 workspace-scoped runtime files, including the event ledger', () => {
    const Paths = GetReminderRuntimeFilePaths('SomeWorkspace-test-harness');
    expect(Paths).toHaveLength(5);
    expect(Paths.some((p) => p.endsWith('SomeWorkspace-test-harness_reminders.json'))).toBe(true);
    expect(Paths.some((p) => p.endsWith('SomeWorkspace-test-harness_reminder_counter.json'))).toBe(true);
    expect(Paths.some((p) => p.endsWith('SomeWorkspace-test-harness_enabled_channels.json'))).toBe(true);
    expect(Paths.some((p) => p.endsWith('SomeWorkspace-test-harness_completed.json'))).toBe(true);
    // GH-424 Codex review: RemindersModule's EventStore also appends
    // data/runtime/events/<workspace>_events.jsonl — previously untracked by cleanup.
    expect(Paths.some((p) => p.endsWith(`${path.sep}events${path.sep}SomeWorkspace-test-harness_events.jsonl`))).toBe(true);
  });

  test('MakeTurnTS produces deterministic, increasing timestamps', () => {
    const First = MakeTurnTS(0);
    const Second = MakeTurnTS(1);
    expect(Number(Second)).toBeGreaterThan(Number(First));
    expect(MakeTurnTS(0)).toBe(First); // deterministic — no Date.now()/Math.random().
  });
});

describe('reminder-thread-battery RunScenarioAsync (mocked WorkspaceAI, no real LLM calls)', () => {
  // GH-68: the harness no longer renames the workspace. Production resolves client mappings and
  // display identity from WORKSPACE_NAME, so a suffixed name disabled the very rendering the
  // harness exists to reproduce. Isolation is by SLEUTH_DATA_DIR instead — already in force here,
  // per-worker, from tests/runtime-setup.js, so RunScenarioAsync leaves it alone.
  const HarnessWorkspaceName = FakeWorkspaceInfo.WORKSPACE_NAME;

  let LoadWorkspaceSpy;
  beforeEach(() => {
    LoadWorkspaceSpy = jest.spyOn(Workspaces, 'LoadWorkspaceInfoByNameAsync').mockResolvedValue(FakeWorkspaceInfo);
    // RemindersModule.StartAsync unconditionally schedules a daily-digest + weekly-report
    // setTimeout, neither cleared by StopAsync (the weekly one isn't cleared at all — a
    // pre-existing gap). Their delay is computed from real wall-clock math and can floor to
    // ~1s, so left as real timers they can fire *after* this test finishes and race unrelated
    // test files sharing the same jest worker. Fake timers make them inert without ever
    // needing to touch that production scheduling code.
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if(LoadWorkspaceSpy) LoadWorkspaceSpy.mockRestore();
    jest.useRealTimers();
    // safety net in case a test throws before the harness's own cleanup runs.
    await CleanupRuntimeFilesAsync(HarnessWorkspaceName);
  });

  test('writes and then cleans up the throwaway harness workspace runtime files by default', async () => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });

    await RunScenarioAsync(
      FakeWorkspaceInfo.WORKSPACE_NAME,
      { channel: 'C_HARNESS', channelType: 'im', turns: [{ user: 'U_NOEL', text: "let's run to the park" }] },
      false
    );

    const RuntimeFiles = GetReminderRuntimeFilePaths(HarnessWorkspaceName);
    for(const FilePath of RuntimeFiles) {
      await expect(fs.stat(FilePath)).rejects.toThrow();
    }
  });

  test('keeps runtime files when --keep-data is requested', async () => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });

    await RunScenarioAsync(
      FakeWorkspaceInfo.WORKSPACE_NAME,
      { channel: 'C_HARNESS', channelType: 'im', turns: [{ user: 'U_NOEL', text: "let's run to the park" }] },
      true
    );

    const RemindersFilePath = GetReminderRuntimeFilePaths(HarnessWorkspaceName)[0];
    await expect(fs.stat(RemindersFilePath)).resolves.toBeDefined();
  });

  test('rejects (does not exit clean) when a turn throws, and still cleans up runtime files', async () => {
    ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });
    // MockSlackApp's own dispatch loop catches+logs handler errors internally (mirroring real
    // SlackApp), so a normal turn can never actually make SimulateMessageAsync reject. Force the
    // scenario this harness's own try/catch defends against by stubbing the method directly,
    // rather than asserting on an unreachable path.
    const SimulateSpy = jest.spyOn(MockSlackApp.prototype, 'SimulateMessageAsync')
      .mockRejectedValueOnce(new Error('simulated dispatch failure'));

    try {
      await expect(RunScenarioAsync(
        FakeWorkspaceInfo.WORKSPACE_NAME,
        { channel: 'C_HARNESS', channelType: 'im', turns: [{ user: 'U_NOEL', text: "let's run to the park" }] },
        false
      )).rejects.toThrow(/turn\(s\) threw.*simulated dispatch failure/s);
    } finally {
      SimulateSpy.mockRestore();
    }

    const RuntimeFiles = GetReminderRuntimeFilePaths(HarnessWorkspaceName);
    for(const FilePath of RuntimeFiles) {
      await expect(fs.stat(FilePath)).rejects.toThrow();
    }
  });

  test('a GH-424 "see above" scenario reaches the AI with the enriched thread context, not just the bare turn', async () => {
    const MockProcessMessage = ConfigureMockWorkspaceAI(MockWorkspaceAI, {
      recommendation: 'schedule',
      reminderMessage: 'meet at the park at 2 PM tomorrow',
      schedulingTrigger: '2 PM tomorrow',
    });

    await RunScenarioAsync(
      FakeWorkspaceInfo.WORKSPACE_NAME,
      {
        channel: 'C_HARNESS',
        channelType: 'im',
        turns: [
          { user: 'U_NOEL', text: "let's run to the park" },
          { user: 'U_NOEL', text: 'Can you also bring some food' },
          { user: 'U_NOEL', text: 'please see above and meet at the park at 2 PM tomorrow' },
        ],
      },
      false
    );

    // the reminder-analysis call (not the date-extraction call) is the one whose input text
    // reflects what TryEnrichVagueCompletionFromAboveAsync actually enriched.
    const AnalysisCall = MockProcessMessage.mock.calls.find(
      ([MessageText]) => !MessageText.includes('BASE DATE:')
    );
    expect(AnalysisCall).toBeDefined();
    const [EnrichedText] = AnalysisCall;
    expect(EnrichedText).toContain('Can you also bring some food');
    expect(EnrichedText).toContain('please see above and meet at the park at 2 PM tomorrow');
  });

  // GH-68 — THE PIN. Before this change a channel-typed scenario was rejected by the
  // enabled-channels gate (reminders-module.js:1442) before any AI ran, so a scenario faithfully
  // describing the reported thread produced ZERO reminders and read as "no bug here". That silent
  // empty result is precisely why the harness diverged from Slack, so it gets a regression test
  // rather than a comment.
  test('a CHANNEL-typed scenario reaches AI extraction — the enabled-channels gate is seeded', async () => {
    const MockProcessMessage = ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });

    await RunScenarioAsync(
      FakeWorkspaceInfo.WORKSPACE_NAME,
      {
        channel: 'C_REAL_CHANNEL',
        channelType: 'channel',
        turns: [{ user: 'U_NOEL', text: 'ship the thing by 2 PM tomorrow' }],
      },
      false
    );

    expect(MockProcessMessage.mock.calls.length).toBeGreaterThan(0);
  });

  test('SeedEnabledChannelAsync writes the channel list RemindersChannelSettings expects', async () => {
    await SeedEnabledChannelAsync(HarnessWorkspaceName, 'C_SEEDED');

    const SeededPath = Workspaces.GetSubdirPath(
      'reminders', `${HarnessWorkspaceName}_enabled_channels.json`
    );
    // shape matters: LoadEnabledChannelsAsync does `new Set(JSON.parse(...))`, so a bare array is
    // the contract. An object would parse and then silently enable nothing.
    expect(JSON.parse(await fs.readFile(SeededPath, 'utf8'))).toEqual(['C_SEEDED']);
  });

  test('IsolateRuntimeTreeAsync leaves a caller-established SLEUTH_DATA_DIR alone', async () => {
    // Under Jest, runtime-setup.js already isolated this worker. If the harness clobbered that, it
    // would redirect the REST of the worker's tests to its own temp tree mid-run and then delete
    // it — the exact cross-worker leakage GH-60 fixed.
    const PreExisting = process.env.SLEUTH_DATA_DIR;
    expect(PreExisting).toBeTruthy();

    await expect(IsolateRuntimeTreeAsync(HarnessWorkspaceName)).resolves.toBeNull();
    expect(process.env.SLEUTH_DATA_DIR).toBe(PreExisting);
  });
});
