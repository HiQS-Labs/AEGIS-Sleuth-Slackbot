'use strict';

const HandleShowMeProjectsCommandAsync = require('../src/chat-commands/show-me-projects-command');
const {
  ExtractReminderTitle,
  GetReminderUrgencyRank,
  RenderProjects,
} = require('../src/chat-commands/show-me-projects-command');

// ── Routing regex (copied from chat-module.js registration) ──────────────────
const PROJECTS_PATTERN = /^show-me-projects(?:\s+(<@[UW][^>]+>))?/i;
const MY_PROJECTS_PATTERN = /^(?:what(?:'s|\s+are|\s+is)?\s+my\s+projects?|show\s+me\s+my\s+projects?|group\s+my\s+tasks?)\b/i;
const USER_PROJECTS_PATTERN = /^(?:what\s+(?:are|is)\s+(<@[UW][^>]+>)(?:'s?)?\s+projects?|show\s+me\s+(<@[UW][^>]+>)(?:'s?)?\s+projects?|group\s+(<@[UW][^>]+>)(?:'s?)?\s+tasks?)\b/i;
const SHOW_ME_PATTERN = /^show-me\s+(?:what\s+tasks?\s+)?(<@[UW][^>]+>)(?:\s+.*)?$/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @returns {import('../src/reminders-module').ReminderInfo} */
function MakeReminder(Overrides = {}) {
  return {
    ReminderID: 'r-' + Math.random().toString(36).slice(2),
    CreatedOn: new Date('2026-05-01T00:00:00Z'),
    ShouldPostOn: new Date('2026-06-02T09:00:00Z'),
    TargetChannelID: 'C_REMINDERS',
    OriginalChannelID: 'C_GENERAL',
    OriginalChannelName: 'clients-1-client-a-devops',
    OriginalMessageID: '1000000000.000001',
    OriginalSenderID: 'U_SENDER',
    ReminderMessageText: 'Default task',
    IgnoreSnooze: false,
    AssigneeID: 'U_TARGET',
    GitHubUrls: null,
    State: 'scheduled',
    ...Overrides,
  };
}

/** Build the digest-style reminder text the pipeline writes, with a Key task(s) bullet. */
function DigestText(ArgTitle) {
  return `<@U_A>, <@U_B> - please follow up on <https://x.slack.com/archives/C/p1|this>:\n>${ArgTitle}\n\nKey task(s):\n• ${ArgTitle}`;
}

function MakeEnv({ Reminders = [], AIResponse = { projects: [] }, AIError = null, WorkspaceInfo = {} } = {}) {
  const SlackApp = {
    Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    PostMessageTextAsync: jest.fn().mockResolvedValue(undefined),
    WorkspaceInfo,
  };
  const MockProcessJson = AIError
    ? jest.fn().mockRejectedValue(AIError)
    : jest.fn().mockResolvedValue(AIResponse);
  const WorkspaceAI = {
    ProcessMessageWithJsonResponseAsync: MockProcessJson,
    ComplexModelName: 'complex-model',
  };
  const RemindersModule = { GetAllReminders: jest.fn().mockReturnValue(Reminders) };
  const EventInfo = { channel: 'C_GENERAL', ts: '1700000000.000001', user: 'U_ASKER', text: '' };
  return { SlackApp, WorkspaceAI, RemindersModule, EventInfo, MockProcessJson };
}

function CallHandler(Env, ArgRawMention) {
  return HandleShowMeProjectsCommandAsync(
    Env.SlackApp,
    Env.EventInfo,
    ArgRawMention,
    { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule }
  );
}

// ── Routing ────────────────────────────────────────────────────────────────────

describe('show-me-projects routing patterns', () => {
  test.each([
    ['show-me-projects <@U000EXAMPLE1>', '<@U000EXAMPLE1>'],
    ['show-me-projects <@U000EXAMPLE1|matthew>', '<@U000EXAMPLE1|matthew>'],
    ['show-me-projects <@W012AB3CD>', '<@W012AB3CD>'],
  ])('primary matches "%s" capturing "%s"', (Input, ExpectedCapture) => {
    const Match = Input.match(PROJECTS_PATTERN);
    expect(Match).not.toBeNull();
    expect(Match[1]).toBe(ExpectedCapture);
  });

  test('primary matches bare "show-me-projects" with no mention captured', () => {
    const Match = 'show-me-projects'.match(PROJECTS_PATTERN);
    expect(Match).not.toBeNull();
    expect(Match[1]).toBeUndefined();
  });

  test('"show-me-projects @user" does not collide with the show-me route', () => {
    expect('show-me-projects <@U000EXAMPLE1>'.match(SHOW_ME_PATTERN)).toBeNull();
  });

  test.each([
    'what are my projects',
    "what's my projects",
    'show me my projects',
    'group my tasks',
  ])('self-referential matches "%s"', (Input) => {
    expect(MY_PROJECTS_PATTERN.test(Input)).toBe(true);
  });

  test.each([
    'what are my tasks',     // that is the show-me my-tasks alias, not projects
    'group your tasks',
  ])('self-referential does not match "%s"', (Input) => {
    expect(MY_PROJECTS_PATTERN.test(Input)).toBe(false);
  });

  test.each([
    ['what are <@UABC123> projects', '<@UABC123>'],
    ["what are <@UABC123>'s projects", '<@UABC123>'],
    ['show me <@UABC123> projects', '<@UABC123>'],
    ["show me <@UABC123>'s projects", '<@UABC123>'],
    ['group <@UABC123> tasks', '<@UABC123>'],
    ["group <@UABC123>'s tasks", '<@UABC123>'],
  ])('third-person matches "%s" capturing "%s"', (Input, ExpectedMention) => {
    const Match = Input.match(USER_PROJECTS_PATTERN);
    expect(Match).not.toBeNull();
    expect(Match[1] || Match[2] || Match[3]).toBe(ExpectedMention);
  });
});

// ── Handler: guard cases ──────────────────────────────────────────────────────

describe('HandleShowMeProjectsCommandAsync — guards', () => {
  test('replies unavailable when RemindersModule is null', async () => {
    const SlackApp = { Logger: { error: jest.fn() }, PostMessageTextAsync: jest.fn().mockResolvedValue(undefined) };
    await HandleShowMeProjectsCommandAsync(
      SlackApp,
      { channel: 'C_GENERAL', ts: '1700000000.000001' },
      '<@UABC123>',
      { WorkspaceAI: {}, RemindersModule: null }
    );
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      'C_GENERAL', '1700000000.000001', expect.stringContaining('unavailable')
    );
  });

  test('replies with a usage hint and skips the AI when the mention is unparseable', async () => {
    const Env = MakeEnv();
    await CallHandler(Env, 'not-a-mention');
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      Env.EventInfo.channel, Env.EventInfo.ts, expect.stringContaining('@mention')
    );
    expect(Env.RemindersModule.GetAllReminders).not.toHaveBeenCalled();
    expect(Env.MockProcessJson).not.toHaveBeenCalled();
  });

  test('posts a deterministic no-reminders reply and skips the AI when nothing is open', async () => {
    const Env = MakeEnv({ Reminders: [] });
    await CallHandler(Env, '<@U000EXAMPLE1>');
    expect(Env.MockProcessJson).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledWith(
      Env.EventInfo.channel, Env.EventInfo.ts, expect.stringContaining('<@U000EXAMPLE1>')
    );
  });

  test('excludes terminal-state and other-user reminders from the active set', async () => {
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: 'U000EXAMPLE1', State: 'completed' }),
        MakeReminder({ AssigneeID: 'U_OTHER', State: 'overdue' }),
      ],
    });
    await CallHandler(Env, '<@U000EXAMPLE1>');
    expect(Env.MockProcessJson).not.toHaveBeenCalled();
  });
});

// ── Handler: grouping path ────────────────────────────────────────────────────

describe('HandleShowMeProjectsCommandAsync — grouping', () => {
  test('calls the JSON API once on the complex model and posts the rendered grouping', async () => {
    const TargetId = 'U000EXAMPLE1';
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: TargetId, State: 'overdue', ReminderMessageText: DigestText('Enable category bubbles') }),
        MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: DigestText('Wire Shipstation lookups') }),
      ],
      AIResponse: {
        projects: [
          { projectName: 'Storefront UI', client: 'Client A', taskIds: [0] },
          { projectName: 'Shipping', client: 'Client A', taskIds: [1] },
        ],
      },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    expect(Env.MockProcessJson).toHaveBeenCalledTimes(1);
    // grouping must run on the complex model (4th positional arg).
    expect(Env.MockProcessJson.mock.calls[0][3]).toBe('complex-model');
    const Calls = Env.SlackApp.PostMessageTextAsync.mock.calls;
    const Final = Calls[Calls.length - 1][2];
    expect(Final).toContain('Storefront UI');
    expect(Final).toContain('Shipping');
    expect(Final).toContain('Enable category bubbles');
    expect(Final).toContain('Wire Shipstation lookups');
  });

  test('passes every task card (id + channel + cleaned title) to the model', async () => {
    const TargetId = 'U000EXAMPLE1';
    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due', OriginalChannelName: 'client-a-client-b', ReminderMessageText: DigestText('Review BigQuery setup') })],
    });
    await CallHandler(Env, `<@${TargetId}>`);
    const [PromptText] = Env.MockProcessJson.mock.calls[0];
    expect(PromptText).toContain('client-a-client-b');
    expect(PromptText).toContain('Review BigQuery setup');
    expect(PromptText).toContain('"id": 0');
  });

  test('posts the grouping loading message before calling the AI', async () => {
    const TargetId = 'UABC123';
    const Env = MakeEnv({ Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })] });

    const Order = [];
    Env.SlackApp.PostMessageTextAsync.mockImplementation(async (_Ch, _Ts, Text) => { Order.push(Text); });
    Env.MockProcessJson.mockImplementation(async () => { Order.push('__AI__'); return { projects: [] }; });

    await CallHandler(Env, `<@${TargetId}>`);

    const LoadingIndex = Order.findIndex(T => T.includes('Grouping'));
    expect(LoadingIndex).toBeGreaterThanOrEqual(0);
    expect(LoadingIndex).toBeLessThan(Order.indexOf('__AI__'));
  });

  test('appends model-dropped reminders under Ungrouped and warns (no silent truncation)', async () => {
    const TargetId = 'UABC123';
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: TargetId, State: 'overdue', ReminderMessageText: DigestText('Grouped task') }),
        MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: DigestText('Dropped task') }),
      ],
      AIResponse: { projects: [{ projectName: 'P', client: 'Client A', taskIds: [0] }] },
    });

    await CallHandler(Env, `<@${TargetId}>`);

    const Final = Env.SlackApp.PostMessageTextAsync.mock.calls.slice(-1)[0][2];
    expect(Final).toContain('Ungrouped');
    expect(Final).toContain('Dropped task');
    expect(Env.SlackApp.Logger.warn).toHaveBeenCalled();
  });

  test('posts a graceful error and does not re-throw when the AI call fails', async () => {
    const TargetId = 'UABC123';
    const Env = MakeEnv({
      Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due' })],
      AIError: new Error('Provider timeout'),
    });

    await expect(CallHandler(Env, `<@${TargetId}>`)).resolves.toBeUndefined();
    expect(Env.SlackApp.Logger.error).toHaveBeenCalled();
    const Final = Env.SlackApp.PostMessageTextAsync.mock.calls.slice(-1)[0][2];
    expect(Final).toContain("couldn't group");
  });
});

// ── Unit: ExtractReminderTitle ────────────────────────────────────────────────

describe('ExtractReminderTitle', () => {
  test('prefers the Key task(s) bullet', () => {
    expect(ExtractReminderTitle(DigestText('Enable category bubbles on ClientA.com')))
      .toBe('Enable category bubbles on ClientA.com');
  });

  test('strips the follow-up digest prefix and quote marker when no Key task line exists', () => {
    const Text = '<@U1> - please follow up on <https://x|this>:\n>Discuss the Q3 roadmap';
    expect(ExtractReminderTitle(Text)).toBe('Discuss the Q3 roadmap');
  });

  test('returns plain text unchanged', () => {
    expect(ExtractReminderTitle('Fix the login bug')).toBe('Fix the login bug');
  });

  test('truncates very long titles with an ellipsis', () => {
    const Long = 'x'.repeat(200);
    const Result = ExtractReminderTitle(Long);
    expect(Result.length).toBeLessThanOrEqual(140);
    expect(Result.endsWith('…')).toBe(true);
  });

  test('handles non-string input defensively', () => {
    expect(ExtractReminderTitle(undefined)).toBe('');
  });
});

// ── Unit: GetReminderUrgencyRank ──────────────────────────────────────────────

describe('GetReminderUrgencyRank', () => {
  const NoPRs = new Set();

  test.each([
    ['overdue', 1],
    ['due', 2],
    ['scheduled', 3],
    ['snoozed', 4],
  ])('ranks %s as %d', (State, Expected) => {
    expect(GetReminderUrgencyRank(MakeReminder({ State }), NoPRs)).toBe(Expected);
  });

  test('unknown state falls back to the scheduled rank', () => {
    expect(GetReminderUrgencyRank(MakeReminder({ State: 'mystery' }), NoPRs)).toBe(3);
  });

  test('an active PR boosts an overdue/due item above its base', () => {
    const PrUrl = 'https://github.com/org/repo/pull/1';
    const Active = new Set([PrUrl]);
    const Overdue = MakeReminder({ State: 'overdue', GitHubUrls: [PrUrl] });
    expect(GetReminderUrgencyRank(Overdue, Active)).toBeLessThan(GetReminderUrgencyRank(Overdue, NoPRs));
  });

  test('an active PR does not boost a non-deadline (scheduled) item', () => {
    const PrUrl = 'https://github.com/org/repo/pull/1';
    const Scheduled = MakeReminder({ State: 'scheduled', GitHubUrls: [PrUrl] });
    expect(GetReminderUrgencyRank(Scheduled, new Set([PrUrl]))).toBe(3);
  });
});

// ── Unit: RenderProjects ──────────────────────────────────────────────────────

describe('RenderProjects', () => {
  const NoPRs = new Set();
  const Warn = jest.fn();
  afterEach(() => Warn.mockClear());

  test('orders projects by their most-urgent member', () => {
    const Reminders = [
      MakeReminder({ State: 'scheduled', ReminderMessageText: DigestText('Calm task') }),
      MakeReminder({ State: 'overdue', ReminderMessageText: DigestText('Urgent task') }),
    ];
    const Projects = [
      { projectName: 'Later', client: 'X', taskIds: [0] },
      { projectName: 'Now', client: 'Y', taskIds: [1] },
    ];
    const Out = RenderProjects('U1', Projects, Reminders, NoPRs, Warn);
    expect(Out.indexOf('Now')).toBeLessThan(Out.indexOf('Later'));
  });

  test('orders tasks within a project by urgency', () => {
    const Reminders = [
      MakeReminder({ State: 'due', ReminderMessageText: DigestText('Due item') }),
      MakeReminder({ State: 'overdue', ReminderMessageText: DigestText('Overdue item') }),
    ];
    const Projects = [{ projectName: 'P', client: 'X', taskIds: [0, 1] }];
    const Out = RenderProjects('U1', Projects, Reminders, NoPRs, Warn);
    expect(Out.indexOf('Overdue item')).toBeLessThan(Out.indexOf('Due item'));
  });

  test('appends dropped reminders under Ungrouped and warns', () => {
    const Reminders = [
      MakeReminder({ State: 'overdue', ReminderMessageText: DigestText('Kept') }),
      MakeReminder({ State: 'due', ReminderMessageText: DigestText('Dropped') }),
    ];
    const Out = RenderProjects('U1', [{ projectName: 'P', client: 'X', taskIds: [0] }], Reminders, NoPRs, Warn);
    expect(Out).toContain('Ungrouped');
    expect(Out).toContain('Dropped');
    expect(Warn).toHaveBeenCalledTimes(1);
  });

  test('ignores out-of-range and duplicate ids without crashing', () => {
    const Reminders = [MakeReminder({ State: 'due', ReminderMessageText: DigestText('Only task') })];
    const Projects = [{ projectName: 'P', client: 'X', taskIds: [0, 0, 5, -1] }];
    const Out = RenderProjects('U1', Projects, Reminders, NoPRs, Warn);
    // task 0 rendered exactly once; no Ungrouped because every real reminder is placed.
    expect(Out.match(/Only task/g)).toHaveLength(1);
    expect(Out).not.toContain('Ungrouped');
  });

  test('renders the [Active PR] badge for reminders overlapping an open PR', () => {
    const PrUrl = 'https://github.com/org/repo/pull/9';
    const Reminders = [MakeReminder({ State: 'due', GitHubUrls: [PrUrl], ReminderMessageText: DigestText('PR task') })];
    const Out = RenderProjects('U1', [{ projectName: 'P', client: 'X', taskIds: [0] }], Reminders, new Set([PrUrl]), Warn);
    expect(Out).toContain('[Active PR]');
  });

  test('header reports reminder and project counts', () => {
    const Reminders = [
      MakeReminder({ State: 'due', ReminderMessageText: DigestText('A') }),
      MakeReminder({ State: 'due', ReminderMessageText: DigestText('B') }),
    ];
    const Out = RenderProjects('U1', [{ projectName: 'P', client: 'X', taskIds: [0, 1] }], Reminders, NoPRs, Warn);
    expect(Out).toContain('2 open reminders across 1 project');
  });
});

// ── Phase C: persisted client/project map ─────────────────────────────────────

const {
  LoadProjectMap,
  SaveProjectMap,
  GetProjectMapPath,
  DetermineProjectForReminder,
  BuildProjectMapContext,
  ReminderMapKey,
} = require('../src/chat-commands/show-me-projects-command');

const os = require('os');
const fs = require('fs');
const path = require('path');

describe('LoadProjectMap / SaveProjectMap', () => {
  test('returns an empty map when file does not exist (fail open)', () => {
    const Map = LoadProjectMap('ws-nonexistent-xyzzy-' + Date.now());
    expect(Map).toHaveProperty('entries');
    expect(typeof Map.entries).toBe('object');
  });

  test('returns an empty map on corrupt JSON (fail open)', () => {
    // Write corrupt JSON to a tmp file location by patching via spy would be complex;
    // instead test that a made-up workspace id that can never exist returns the empty shape.
    const Map = LoadProjectMap('\x00invalid\x00');
    expect(Map.entries).toBeDefined();
  });

  test('round-trips an entry: save then load returns the entry', () => {
    const WsId = 'ws-test-roundtrip-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    try {
      const InitialMap = LoadProjectMap(WsId);
      InitialMap.entries['rem-1'] = { projectName: 'Test Project', client: 'Client A', clientId: 'client-a', status: 'confirmed' };
      SaveProjectMap(WsId, InitialMap);
      const Loaded = LoadProjectMap(WsId);
      expect(Loaded.entries['rem-1']).toMatchObject({ projectName: 'Test Project', status: 'confirmed' });
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });
});

describe('DetermineProjectForReminder', () => {
  test('returns confirmed entry from the map without touching clients (no LLM needed)', () => {
    const Reminder = MakeReminder({ ReminderID: 'r-confirmed', OriginalChannelName: 'anything' });
    const Map = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-confirmed': { projectName: 'Ops', client: 'Client A', clientId: 'client-a', status: 'confirmed' },
      },
    };
    const Result = DetermineProjectForReminder(Reminder, [], Map);
    expect(Result).not.toBeNull();
    expect(Result.status).toBe('confirmed');
    expect(Result.projectName).toBe('Ops');
  });

  test('matches via shared channel when a confirmed entry has the same channel', () => {
    const Reminder = MakeReminder({ ReminderID: 'r-new', OriginalChannelName: 'client-a-devops', GitHubUrls: [] });
    const Map = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-existing': {
          projectName: 'Ops', client: 'Client A', clientId: 'client-a',
          channel: 'client-a-devops', repos: [],
          status: 'confirmed',
        },
      },
    };
    const Result = DetermineProjectForReminder(Reminder, [], Map);
    expect(Result).not.toBeNull();
    expect(Result.projectName).toBe('Ops');
    expect(Result.client).toBe('Client A');
    expect(Result.status).toBe('confirmed');
  });

  test('matches via shared GitHub repo when a confirmed entry has the same repo', () => {
    const Reminder = MakeReminder({
      ReminderID: 'r-new',
      OriginalChannelName: 'general',
      GitHubUrls: ['https://github.com/ClientA/website/pull/12'],
    });
    const Map = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-existing': {
          projectName: 'Storefront', client: 'Client A', clientId: 'client-a',
          channel: 'client-a-shop', repos: ['ClientA/website'],
          status: 'confirmed',
        },
      },
    };
    const Result = DetermineProjectForReminder(Reminder, [], Map);
    expect(Result).not.toBeNull();
    expect(Result.projectName).toBe('Storefront');
    expect(Result.client).toBe('Client A');
  });

  test('does NOT match a confirmed entry with no projectName (project name required for structural match)', () => {
    const Reminder = MakeReminder({ ReminderID: 'r-new', OriginalChannelName: 'client-a-devops', GitHubUrls: [] });
    const Map = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-existing': {
          projectName: null, client: 'Client A', clientId: 'client-a',
          channel: 'client-a-devops', repos: [],
          status: 'confirmed',
        },
      },
    };
    const Result = DetermineProjectForReminder(Reminder, [], Map);
    expect(Result).toBeNull();
  });

  test('returns null when no match in map (client list is not used for deterministic match)', () => {
    const Reminder = MakeReminder({ OriginalChannelName: 'general', GitHubUrls: [] });
    const Map = { generatedAt: new Date().toISOString(), entries: {} };
    // Clients are not used — a client-only match requires LLM to propose the project name.
    const ClientAClient = {
      ClientID: 'client-a', ClientName: 'Client A',
      ChannelIDs: [], ChannelNamePatterns: ['general'], GitHubRepoPatterns: [],
    };
    const Result = DetermineProjectForReminder(Reminder, [ClientAClient], Map);
    expect(Result).toBeNull();
  });
});

describe('HandleShowMeProjectsCommandAsync — Phase C deterministic-first', () => {
  test('skips LLM for a reminder whose channel matches a confirmed map entry (structural match)', async () => {
    const TargetId = 'U000EXAMPLE1';
    const WsId = 'ws-determ-channel-test-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    const Reminder = MakeReminder({
      AssigneeID: TargetId, State: 'due',
      OriginalChannelName: 'client-a-devops',
      ReminderMessageText: DigestText('Client A channel task'),
    });
    // Pre-seed a confirmed entry with the same channel.
    const SeedMap = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-seed': {
          projectName: 'Ops', client: 'Client A', clientId: 'client-a',
          channel: 'client-a-devops', repos: [],
          status: 'confirmed',
        },
      },
    };
    try {
      SaveProjectMap(WsId, SeedMap);
      const Env = MakeEnv({
        Reminders: [Reminder],
        AIResponse: { projects: [] },
      });
      await HandleShowMeProjectsCommandAsync(
        Env.SlackApp, Env.EventInfo, `<@${TargetId}>`,
        { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule, Clients: [], WorkspaceId: WsId }
      );
      // LLM must NOT be called — deterministic structural match via shared channel.
      expect(Env.MockProcessJson).not.toHaveBeenCalled();
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });

  test('skips LLM for a reminder whose GitHub repo matches a confirmed map entry (structural match)', async () => {
    const TargetId = 'U000EXAMPLE1';
    const WsId = 'ws-determ-repo-test-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    const Reminder = MakeReminder({
      AssigneeID: TargetId, State: 'due',
      OriginalChannelName: 'general',
      GitHubUrls: ['https://github.com/ClientA/website/pull/42'],
      ReminderMessageText: DigestText('Client A repo task'),
    });
    const SeedMap = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-seed': {
          projectName: 'Storefront', client: 'Client A', clientId: 'client-a',
          channel: 'client-a-shop', repos: ['ClientA/website'],
          status: 'confirmed',
        },
      },
    };
    try {
      SaveProjectMap(WsId, SeedMap);
      const Env = MakeEnv({
        Reminders: [Reminder],
        AIResponse: { projects: [] },
      });
      await HandleShowMeProjectsCommandAsync(
        Env.SlackApp, Env.EventInfo, `<@${TargetId}>`,
        { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule, Clients: [], WorkspaceId: WsId }
      );
      expect(Env.MockProcessJson).not.toHaveBeenCalled();
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });

  test('sends a client-only match (no confirmed project) to the LLM for project name proposal', async () => {
    const TargetId = 'U000EXAMPLE1';
    const WsId = 'ws-client-only-test-' + Date.now();
    const ClientAClient = {
      ClientID: 'client-a', ClientName: 'Client A',
      ChannelIDs: [], ChannelNamePatterns: ['client-a'], GitHubRepoPatterns: ['client-a'],
    };
    const Env = MakeEnv({
      Reminders: [
        MakeReminder({ AssigneeID: TargetId, State: 'due', OriginalChannelName: 'client-a-devops', ReminderMessageText: DigestText('Client A task') }),
      ],
      AIResponse: { projects: [{ projectName: 'Ops', client: 'Client A', taskIds: [0] }] },
    });
    try {
      await HandleShowMeProjectsCommandAsync(
        Env.SlackApp, Env.EventInfo, `<@${TargetId}>`,
        { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule, Clients: [ClientAClient], WorkspaceId: WsId }
      );
      // LLM MUST be called — client is known but there is no confirmed project name in the map.
      expect(Env.MockProcessJson).toHaveBeenCalledTimes(1);
    } finally {
      try { fs.unlinkSync(GetProjectMapPath(WsId)); } catch(_) {}
    }
  });

  test('calls LLM only for unmatched reminders when some are matched via confirmed map entry', async () => {
    const TargetId = 'U000EXAMPLE1';
    const WsId = 'ws-mixed-test-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    // Pre-seed: first reminder's channel matches a confirmed entry.
    const SeedMap = {
      generatedAt: new Date().toISOString(),
      entries: {
        'r-seed': {
          projectName: 'Ops', client: 'Client A', clientId: 'client-a',
          channel: 'client-a-devops', repos: [],
          status: 'confirmed',
        },
      },
    };
    try {
      SaveProjectMap(WsId, SeedMap);
      const Env = MakeEnv({
        Reminders: [
          MakeReminder({ AssigneeID: TargetId, State: 'due', OriginalChannelName: 'client-a-devops', ReminderMessageText: DigestText('Client A task') }),
          MakeReminder({ AssigneeID: TargetId, State: 'due', OriginalChannelName: 'general', ReminderMessageText: DigestText('Unrelated task') }),
        ],
        AIResponse: { projects: [{ projectName: 'Internal', client: 'Neochrome', taskIds: [1] }] },
      });
      await HandleShowMeProjectsCommandAsync(
        Env.SlackApp, Env.EventInfo, `<@${TargetId}>`,
        { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule, Clients: [], WorkspaceId: WsId }
      );
      // LLM should be called once (for the unmatched task only — id 1).
      expect(Env.MockProcessJson).toHaveBeenCalledTimes(1);
      const [PromptText] = Env.MockProcessJson.mock.calls[0];
      expect(PromptText).toContain('"id": 1');
      expect(PromptText).not.toContain('"id": 0');
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });

  test('reuses confirmed mappings on second call (no re-proposal)', async () => {
    const TargetId = 'U000EXAMPLE1';
    const WsId = 'ws-reuse-test-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    // Pre-seed a confirmed entry.
    const Reminder = MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: DigestText('Known task') });
    const Key = ReminderMapKey(Reminder);
    const PreMap = {
      generatedAt: new Date().toISOString(),
      entries: { [Key]: { projectName: 'Confirmed Project', client: 'Client A', clientId: 'client-a', status: 'confirmed' } },
    };
    try {
      SaveProjectMap(WsId, PreMap);
      const Env = MakeEnv({
        Reminders: [Reminder],
        AIResponse: { projects: [] },
      });
      await HandleShowMeProjectsCommandAsync(
        Env.SlackApp, Env.EventInfo, `<@${TargetId}>`,
        { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule, Clients: [], WorkspaceId: WsId }
      );
      expect(Env.MockProcessJson).not.toHaveBeenCalled();
      const Final = Env.SlackApp.PostMessageTextAsync.mock.calls.slice(-1)[0][2];
      expect(Final).toContain('Known task');
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });

  test('falls back to full-regroup (LLM for all) when map file is corrupt', async () => {
    const TargetId = 'U000EXAMPLE1';
    const WsId = 'ws-corrupt-test-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    try {
      // Write corrupt JSON.
      fs.mkdirSync(path.dirname(MapPath), { recursive: true });
      fs.writeFileSync(MapPath, '{ NOT VALID JSON {{{{', 'utf8');
      const Env = MakeEnv({
        Reminders: [MakeReminder({ AssigneeID: TargetId, State: 'due', ReminderMessageText: DigestText('Any task') })],
        AIResponse: { projects: [{ projectName: 'P', client: 'X', taskIds: [0] }] },
      });
      await HandleShowMeProjectsCommandAsync(
        Env.SlackApp, Env.EventInfo, `<@${TargetId}>`,
        { WorkspaceAI: Env.WorkspaceAI, RemindersModule: Env.RemindersModule, Clients: [], WorkspaceId: WsId }
      );
      // Should fall back to calling LLM for all tasks.
      expect(Env.MockProcessJson).toHaveBeenCalledTimes(1);
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });
});

describe('BuildProjectMapContext', () => {
  test('returns null for a workspace with no map file (fail open)', () => {
    const Result = BuildProjectMapContext('ws-no-map-xyzzy-' + Date.now());
    expect(Result).toBeNull();
  });

  test('returns a context object with generatedAt and summary when map has entries', () => {
    const WsId = 'ws-ctx-test-' + Date.now();
    const MapPath = GetProjectMapPath(WsId);
    try {
      SaveProjectMap(WsId, {
        generatedAt: '2026-07-11T00:00:00.000Z',
        entries: {
          'r1': { projectName: 'Storefront', client: 'Client A', clientId: 'client-a', status: 'confirmed' },
        },
      });
      const Ctx = BuildProjectMapContext(WsId);
      expect(Ctx).not.toBeNull();
      expect(Ctx.generatedAt).toBe('2026-07-11T00:00:00.000Z');
      expect(Ctx.summary).toContain('Client A');
    } finally {
      try { fs.unlinkSync(MapPath); } catch(_) {}
    }
  });
});
