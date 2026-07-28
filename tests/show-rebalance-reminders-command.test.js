'use strict';

const fs = require('fs');

const HandleShowRebalanceRemindersCommandAsync = require('../src/chat-commands/show-rebalance-reminders-command');
const {
  ResolveExportLocation,
  FormatYmdHms,
  FormatDualStamp,
  FormatAge,
  BuildDebugSummary,
} = require('../src/chat-commands/show-rebalance-reminders-command');

// ── Routing regex (copied from chat-module.js registration) ──────────────────
const ROUTE_PATTERN = /^show-rebalance-reminders\b/i;

// A fixed instant: 2026-06-09 14:32:07 UTC → 10:32:07 in America/New_York (EDT, UTC-4).
const FIXED_MS = Date.UTC(2026, 5, 9, 14, 32, 7);

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXPORT_ENV_KEYS = [
  'SLEUTH_RAG_GITHUB_PAT', 'GITHUB_PAT',
  'SLEUTH_EXPORT_WORKSPACE', 'SLEUTH_EXPORT_REPO', 'SLEUTH_EXPORT_PATH', 'SLEUTH_EXPORT_BRANCH',
];
let SavedEnv;
let SavedFetch;

beforeEach(() => {
  SavedEnv = {};
  for(const Key of EXPORT_ENV_KEYS) { SavedEnv[Key] = process.env[Key]; delete process.env[Key]; }
  SavedFetch = global.fetch;
});

afterEach(() => {
  for(const Key of EXPORT_ENV_KEYS) {
    if(SavedEnv[Key] === undefined) delete process.env[Key];
    else process.env[Key] = SavedEnv[Key];
  }
  global.fetch = SavedFetch;
  jest.restoreAllMocks();
});

function MakeFileJson({ reminders = 2, memories = 1, exportGeneratedAt = '2026-06-09T14:00:00.000Z' } = {}) {
  const Payload = {
    workspaceName: 'neochrome',
    exportGeneratedAt,
    reminders: Array.from({ length: reminders }, (_, i) => ({ reminderId: `r${i}`, state: 'scheduled' })),
    memories: Array.from({ length: memories }, (_, i) => ({ memoryId: `m${i}` })),
  };
  return JSON.stringify(Payload, null, 2) + '\n';
}

function MakeEnv({ IsAdmin = true, WorkspaceInfo = { MAIN_TIMEZONE: 'America/New_York', WORKSPACE_NAME: 'neochrome-dev' } } = {}) {
  const Uploaded = [];
  const SlackApp = {
    Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    WorkspaceInfo,
    IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(IsAdmin),
    PostMessageTextAsync: jest.fn().mockResolvedValue(undefined),
    UploadFileAsync: jest.fn(async (channel, ts, filePath, comment, fileName) => {
      // Read the temp file before the handler's finally-block unlinks it.
      const content = fs.readFileSync(filePath, 'utf8');
      Uploaded.push({ channel, ts, filePath, comment, fileName, content });
      return { Id: 'F1', Name: fileName };
    }),
  };
  const EventInfo = { channel: 'C_GENERAL', ts: '1700000000.000001', user: 'U_ADMIN' };
  return { SlackApp, EventInfo, Uploaded };
}

/** Stub global.fetch routing by URL: contents API vs commits API. */
function StubFetch({ ContentsStatus = 200, FileJson = MakeFileJson(), CommitDate = '2026-06-09T14:00:05Z' } = {}) {
  global.fetch = jest.fn(async (url) => {
    if(String(url).includes('/contents/')) {
      if(ContentsStatus === 404)
        return { ok: false, status: 404, text: async () => 'Not Found' };
      if(ContentsStatus !== 200)
        return { ok: false, status: ContentsStatus, text: async () => 'error body' };
      return { ok: true, status: 200, json: async () => ({ content: Buffer.from(FileJson, 'utf8').toString('base64'), encoding: 'base64' }) };
    }
    if(String(url).includes('/commits')) {
      return { ok: true, status: 200, json: async () => [{ commit: { committer: { date: CommitDate } } }] };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
  return global.fetch;
}

// ── Routing pattern ─────────────────────────────────────────────────────────

describe('show-rebalance-reminders routing pattern', () => {
  test.each([
    'show-rebalance-reminders',
    'show-rebalance-reminders ',
    'Show-Rebalance-Reminders',
  ])('matches %p', (Text) => {
    expect(ROUTE_PATTERN.test(Text)).toBe(true);
  });

  test.each([
    'show reminders',
    'show-me-projects',
    'rebalance-reminders',
  ])('does not match %p', (Text) => {
    expect(ROUTE_PATTERN.test(Text)).toBe(false);
  });
});

// ── Pure helpers ───────────────────────────────────────────────────────────

describe('FormatYmdHms', () => {
  test('renders UTC deterministically', () => {
    expect(FormatYmdHms(FIXED_MS, 'UTC')).toBe('2026-06-09 14:32:07');
  });
  test('renders a named zone (EDT offset -4)', () => {
    expect(FormatYmdHms(FIXED_MS, 'America/New_York')).toBe('2026-06-09 10:32:07');
  });
  test('normalizes midnight hour 24 → 00', () => {
    const Midnight = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(FormatYmdHms(Midnight, 'UTC')).toBe('2026-01-01 00:00:00');
  });
});

describe('FormatDualStamp', () => {
  test('shows both UTC and the workspace zone', () => {
    const Out = FormatDualStamp(FIXED_MS, 'America/New_York');
    expect(Out).toContain('2026-06-09 14:32:07 UTC');
    expect(Out).toContain('2026-06-09 10:32:07 (America/New_York)');
  });
});

describe('FormatAge', () => {
  test('minutes', () => { expect(FormatAge(0, 32 * 60000)).toBe('32m ago'); });
  test('hours and minutes', () => { expect(FormatAge(0, 125 * 60000)).toBe('2h 5m ago'); });
  test('days and hours', () => { expect(FormatAge(0, 26 * 3600000)).toBe('1d 2h ago'); });
  test('never negative', () => { expect(FormatAge(100, 0)).toBe('0m ago'); });
});

describe('ResolveExportLocation', () => {
  test('defaults mirror the publisher — Repo has NO vendor default, it must be configured', () => {
    const Loc = ResolveExportLocation();
    expect(Loc).toEqual({
      Workspace: 'neochrome',
      // Deliberately empty: shipping a default would point every deployment's export at
      // someone else's private repo. SLEUTH_EXPORT_REPO is required — see the env override
      // test below, which covers the configured path.
      Repo: '',
      FilePath: 'sync/sleuth/reminders-neochrome.json',
      Branch: 'main',
    });
  });
  test('honors env overrides', () => {
    process.env.SLEUTH_EXPORT_WORKSPACE = 'acme';
    process.env.SLEUTH_EXPORT_REPO = 'Org/repo';
    process.env.SLEUTH_EXPORT_BRANCH = 'develop';
    const Loc = ResolveExportLocation();
    expect(Loc.Workspace).toBe('acme');
    expect(Loc.Repo).toBe('Org/repo');
    expect(Loc.FilePath).toBe('sync/sleuth/reminders-acme.json');
    expect(Loc.Branch).toBe('develop');
  });
  test('explicit SLEUTH_EXPORT_PATH wins over the workspace-derived default', () => {
    process.env.SLEUTH_EXPORT_PATH = 'custom/path.json';
    expect(ResolveExportLocation().FilePath).toBe('custom/path.json');
  });
});

describe('BuildDebugSummary', () => {
  test('includes dual stamps, age, and counts', () => {
    const Out = BuildDebugSummary({
      Repo: 'example-org/export-repo',
      FilePath: 'sync/sleuth/reminders-neochrome.json',
      Branch: 'main',
      NowMs: FIXED_MS,
      TimeZone: 'America/New_York',
      ReminderCount: 27,
      MemoryCount: 3,
      ExportGeneratedAtIso: '2026-06-09T14:00:00.000Z',
      CommitIso: '2026-06-09T14:00:05.000Z',
    });
    // Pulled-at in both zones.
    expect(Out).toContain('2026-06-09 14:32:07 UTC');
    expect(Out).toContain('(America/New_York)');
    // Heartbeat stamp + age.
    expect(Out).toContain('exportGeneratedAt:');
    expect(Out).toContain('2026-06-09 14:00:00 UTC');
    expect(Out).toContain('32m ago');
    // Commit line present.
    expect(Out).toContain('Last commit:');
    // Counts + repo/path.
    expect(Out).toContain('*Reminders:* 27');
    expect(Out).toContain('*Memories:* 3');
    expect(Out).toContain('export-repo');
  });

  test('notes an absent heartbeat without throwing', () => {
    const Out = BuildDebugSummary({
      Repo: 'r', FilePath: 'p', Branch: 'main', NowMs: FIXED_MS, TimeZone: 'UTC',
      ReminderCount: '?', MemoryCount: 0, ExportGeneratedAtIso: null, CommitIso: null,
    });
    expect(Out).toContain('exportGeneratedAt:* (absent from file)');
    expect(Out).not.toContain('Last commit:');
  });
});

// ── Handler ─────────────────────────────────────────────────────────────────

describe('HandleShowRebalanceRemindersCommandAsync', () => {
  test('denies non-admins and makes no GitHub call', async () => {
    const Env = MakeEnv({ IsAdmin: false });
    const Fetch = StubFetch();
    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo);
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toMatch(/only workspace admins/i);
    expect(Fetch).not.toHaveBeenCalled();
    expect(Env.SlackApp.UploadFileAsync).not.toHaveBeenCalled();
  });

  test('reports a missing token without calling GitHub', async () => {
    const Env = MakeEnv({ WorkspaceInfo: { MAIN_TIMEZONE: 'America/New_York' } }); // no GITHUB_PAT
    const Fetch = StubFetch();
    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo);
    expect(Fetch).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toMatch(/no GitHub token/i);
  });

  test('reports when the file is not published yet (404)', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    const Env = MakeEnv();
    StubFetch({ ContentsStatus: 404 });
    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo);
    expect(Env.SlackApp.UploadFileAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toMatch(/no published rebalance export/i);
  });

  test('uploads the verbatim published file with dual-stamp summary, then cleans up the temp file', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    // Explicit: there is no vendor default repo, so the configured path must be set to exercise it.
    process.env.SLEUTH_EXPORT_REPO = 'example-org/export-repo';
    const FileJson = MakeFileJson({ reminders: 2, memories: 1 });
    const Env = MakeEnv();
    const Fetch = StubFetch({ FileJson });
    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo);

    // GitHub contents API hit with the published repo + path, authenticated.
    const ContentsCall = Fetch.mock.calls.find(([u]) => String(u).includes('/contents/'));
    expect(ContentsCall[0]).toContain('example-org/export-repo');
    expect(ContentsCall[0]).toContain('sync/sleuth/reminders-neochrome.json');
    expect(ContentsCall[1].headers.Authorization).toBe('Bearer tok');

    expect(Env.Uploaded).toHaveLength(1);
    const Up = Env.Uploaded[0];
    // Dumped content is the file verbatim.
    expect(Up.content).toBe(FileJson);
    expect(Up.fileName).toMatch(/^rebalance-neochrome-\d+\.json$/);
    // Summary (initial comment) carries both timestamps and the counts.
    expect(Up.comment).toContain('UTC');
    expect(Up.comment).toContain('(America/New_York)');
    expect(Up.comment).toContain('2026-06-09 14:00:00 UTC'); // exportGeneratedAt heartbeat
    expect(Up.comment).toContain('*Reminders:* 2');
    expect(Up.comment).toContain('*Memories:* 1');
    // Temp file removed after upload.
    expect(fs.existsSync(Up.filePath)).toBe(false);
  });

  test('falls back to an inline post when the file upload fails', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    const FileJson = MakeFileJson({ reminders: 1, memories: 0 });
    const Env = MakeEnv();
    Env.SlackApp.UploadFileAsync.mockRejectedValue(new Error('missing_scope'));
    StubFetch({ FileJson });
    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo);

    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    const Posted = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Posted).toContain('*Reminders:* 1');
    expect(Posted).toContain('"workspaceName": "neochrome"'); // inline dump present
  });
});

// ── Formatted variant ────────────────────────────────────────────────────────

const FORMATTED_ROUTE_PATTERN = /^show-rebalance-reminders-formatted\b/i;

describe('show-rebalance-reminders-formatted routing pattern', () => {
  test.each([
    'show-rebalance-reminders-formatted',
    'Show-Rebalance-Reminders-Formatted',
  ])('matches %p', (Text) => {
    expect(FORMATTED_ROUTE_PATTERN.test(Text)).toBe(true);
  });

  test('does not match the plain command', () => {
    expect(FORMATTED_ROUTE_PATTERN.test('show-rebalance-reminders')).toBe(false);
  });

  test('plain pattern also matches the formatted text — registration order must keep formatted first', () => {
    // `\b` treats the hyphen as a word boundary; chat-module.js registers the formatted
    // route before the plain one so first-match dispatch picks the right handler.
    expect(ROUTE_PATTERN.test('show-rebalance-reminders-formatted')).toBe(true);
  });
});

describe('TrimToOneLine', () => {
  const { TrimToOneLine } = HandleShowRebalanceRemindersCommandAsync;

  test('collapses internal whitespace and newlines', () => {
    expect(TrimToOneLine('a\n  b\t c', 50)).toBe('a b c');
  });

  test('ellipsizes over-long text at the cap', () => {
    const Result = TrimToOneLine('x'.repeat(30), 10);
    expect(Result).toHaveLength(10);
    expect(Result.endsWith('…')).toBe(true);
  });

  test('tolerates null/undefined', () => {
    expect(TrimToOneLine(null, 10)).toBe('');
    expect(TrimToOneLine(undefined, 10)).toBe('');
  });
});

describe('BuildFormattedBody', () => {
  const { BuildFormattedBody } = HandleShowRebalanceRemindersCommandAsync;

  function MakeReminder(Overrides = {}) {
    return {
      reminderId: 'r1',
      state: 'scheduled',
      shouldPostOn: '2026-06-12T12:00:00.000Z',
      reminderMessageText: 'Follow up with Client A',
      assigneeId: 'U_TARGET',
      originalChannelName: 'client-a-clients',
      ...Overrides,
    };
  }

  test('renders reminders sorted by due time with state, assignee mention, and channel', () => {
    const Body = BuildFormattedBody({
      reminders: [
        MakeReminder({ reminderId: 'late', shouldPostOn: '2026-06-20T12:00:00.000Z', reminderMessageText: 'Later task' }),
        MakeReminder({ reminderId: 'soon', shouldPostOn: '2026-06-11T12:00:00.000Z', reminderMessageText: 'Sooner task' }),
      ],
      memories: [],
    }, 'America/New_York');

    expect(Body).toContain('*Reminders (2)* — due times in America/New_York');
    expect(Body.indexOf('Sooner task')).toBeLessThan(Body.indexOf('Later task'));
    expect(Body).toContain('`scheduled`');
    expect(Body).toContain('<@U_TARGET>');
    expect(Body).toContain('_(#client-a-clients)_');
    // 2026-06-11T12:00Z is 08:00 EDT; minute precision, no seconds.
    expect(Body).toContain('*2026-06-11 08:00*');
  });

  test('sorts undated reminders last and labels missing fields', () => {
    const Body = BuildFormattedBody({
      reminders: [
        MakeReminder({ reminderId: 'undated', shouldPostOn: null, assigneeId: null, reminderMessageText: '', originalChannelName: null, state: null }),
        MakeReminder({ reminderId: 'dated' }),
      ],
      memories: [],
    }, 'UTC');

    const Lines = Body.split('\n');
    const UndatedIndex = Lines.findIndex(L => L.includes('no due date'));
    const DatedIndex = Lines.findIndex(L => L.includes('2026-06-12'));
    expect(DatedIndex).toBeLessThan(UndatedIndex);
    expect(Lines[UndatedIndex]).toContain('_unassigned_');
    expect(Lines[UndatedIndex]).toContain('_(no text)_');
    expect(Lines[UndatedIndex]).toContain('`unknown`');
  });

  test('caps reminder lines and notes the overflow', () => {
    const Reminders = Array.from({ length: 25 }, (_, i) =>
      MakeReminder({ reminderId: `r${i}`, reminderMessageText: `Task ${i}` }));
    const Body = BuildFormattedBody({ reminders: Reminders, memories: [] }, 'UTC', { MaxReminders: 20 });

    expect(Body).toContain('*Reminders (25)*');
    expect(Body).toContain('… and 5 more — use `show-rebalance-reminders` for the full JSON.');
  });

  test('renders memories with captured date, channel, preview, and message count', () => {
    const Body = BuildFormattedBody({
      reminders: [],
      memories: [{
        memoryId: 'm1',
        capturedAt: '2026-06-05T15:30:00.000Z',
        channelName: 'neochrome-team-tech',
        preview: 'Discussed the export pipeline',
        messageCount: 8,
      }],
    }, 'UTC');

    expect(Body).toContain('*Memories (1)*');
    expect(Body).toContain('*2026-06-05* #neochrome-team-tech — Discussed the export pipeline _(8 msgs)_');
  });

  test('shows _none_ for empty sections', () => {
    const Body = BuildFormattedBody({ reminders: [], memories: [] }, 'UTC');
    expect(Body.match(/_none_/g)).toHaveLength(2);
  });
});

describe('HandleShowRebalanceRemindersCommandAsync — formatted mode', () => {
  function MakeRichFileJson({ reminders = 3, textLength = 20 } = {}) {
    return JSON.stringify({
      workspaceName: 'neochrome',
      exportGeneratedAt: '2026-06-09T14:00:00.000Z',
      reminders: Array.from({ length: reminders }, (_, i) => ({
        reminderId: `r${i}`,
        state: 'scheduled',
        shouldPostOn: `2026-06-1${(i % 9) + 1}T12:00:00.000Z`,
        reminderMessageText: `Task ${i} ${'x'.repeat(textLength)}`,
        assigneeId: 'U_TARGET',
        originalChannelName: 'client-a-clients',
      })),
      memories: [{ memoryId: 'm1', capturedAt: '2026-06-05T15:30:00.000Z', channelName: 'tech', preview: 'p', messageCount: 2 }],
    });
  }

  test('posts Slack-formatted lines instead of uploading the file', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    const Env = MakeEnv();
    StubFetch({ FileJson: MakeRichFileJson() });

    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo, { Formatted: true });

    expect(Env.SlackApp.UploadFileAsync).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    const Posted = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Posted).toContain('*Rebalance reminders export — published file*'); // summary retained
    expect(Posted).toContain('*Reminders (3)*');
    expect(Posted).toContain('<@U_TARGET>');
    expect(Posted).toContain('*Memories (1)*');
    expect(Posted).not.toContain('"workspaceName"'); // no raw JSON
  });

  test('re-renders with tighter caps when the message would exceed the Slack limit', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    const Env = MakeEnv();
    StubFetch({ FileJson: MakeRichFileJson({ reminders: 30, textLength: 160 }) });

    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo, { Formatted: true });

    const Posted = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Posted.length).toBeLessThanOrEqual(4000);
    expect(Posted).toContain('… and 20 more'); // 30 reminders, fallback cap of 10
  });

  test('warns instead of formatting when the published file is not valid JSON', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    const Env = MakeEnv();
    StubFetch({ FileJson: 'not json {' });

    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo, { Formatted: true });

    expect(Env.SlackApp.UploadFileAsync).not.toHaveBeenCalled();
    const Posted = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Posted).toContain('not valid JSON');
    expect(Posted).toContain('`show-rebalance-reminders`');
  });

  test('still denies non-admins', async () => {
    const Env = MakeEnv({ IsAdmin: false });
    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo, { Formatted: true });
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toContain('only workspace admins');
  });
});

// ── Formatted variant: show-reminders-style rendering from display fields ────

describe('BuildDisplayReminderLines (export v1.4.184+ display fields)', () => {
  const { BuildDisplayReminderLines } = HandleShowRebalanceRemindersCommandAsync;

  function MakeDisplayReminder(Overrides = {}, DisplayOverrides = {}) {
    return {
      reminderId: 'r1',
      createdOn: '2026-06-07T12:00:00.000Z',
      shouldPostOn: '2026-06-12T12:00:00.000Z',
      display: {
        label: 'A',
        sectionKey: 'dueUpcoming',
        sectionLabel: '📆 Due after today',
        summary: 'Ship the hotfix',
        slackSummary: 'Ship the hotfix',
        permalink: 'https://x.slack.com/archives/C1/p123',
        taggedUserId: 'U_TARGET',
        assigneeName: 'Alex Rivera',
        ageDays: 3,
        ...DisplayOverrides,
      },
      ...Overrides,
    };
  }

  test('renders the exact show-reminders digest style: header, section, canonical line', () => {
    const NowMs = Date.parse('2026-06-10T12:00:00.000Z');
    const Body = BuildDisplayReminderLines({
      display: { sectionOrder: [{ key: 'dueUpcoming', label: '📆 Due after today' }] },
      reminders: [MakeDisplayReminder()],
    }, { NowMs });

    expect(Body).toBe([
      'Pending reminders (1 total):',
      '*📆 Due after today*',
      'A.) <https://x.slack.com/archives/C1/p123|Ship the hotfix> (3 days old) - <@U_TARGET> - ' +
        '<!date^1781265600^{date_short} {time}|Fri, 12 Jun 2026 12:00:00 GMT>',
    ].join('\n'));
  });

  test('renders sections in order and recomputes ages from createdOn at render time', () => {
    const NowMs = Date.parse('2026-06-10T12:00:00.000Z');
    const Body = BuildDisplayReminderLines({
      reminders: [
        MakeDisplayReminder({ reminderId: 'up' }, { label: 'B', sectionKey: 'dueUpcoming' }),
        MakeDisplayReminder(
          { reminderId: 'today', createdOn: '2026-06-10T01:00:00.000Z' },
          { label: 'A', sectionKey: 'dueToday', sectionLabel: '📅 Due Today', ageDays: 99 } // stale baked age
        ),
      ],
    }, { NowMs });

    const Lines = Body.split('\n');
    expect(Lines[1]).toBe('*📅 Due Today*');
    expect(Lines[2]).toMatch(/^A\.\)/);
    expect(Lines[2]).not.toContain('99 days old'); // recomputed from createdOn (same day → no suffix)
    expect(Lines[3]).toBe('*📆 Due after today*');
    expect(Lines[4]).toMatch(/^B\.\)/);
  });

  test('caps globally with an overflow note', () => {
    const NowMs = Date.parse('2026-06-10T12:00:00.000Z');
    const Reminders = Array.from({ length: 5 }, (_, i) =>
      MakeDisplayReminder({ reminderId: `r${i}` }, { label: 'ABCDE'[i] }));
    const Body = BuildDisplayReminderLines({ reminders: Reminders }, { NowMs, MaxReminders: 3 });

    expect(Body).toContain('Pending reminders (5 total):');
    expect(Body).toContain('… and 2 more — use `show-rebalance-reminders` for the full JSON.');
  });

  test('returns null when any reminder lacks display fields (legacy file)', () => {
    expect(BuildDisplayReminderLines({ reminders: [{ reminderId: 'old' }] })).toBeNull();
    expect(BuildDisplayReminderLines({ reminders: [] })).toBeNull();
    expect(BuildDisplayReminderLines({
      reminders: [MakeDisplayReminder(), { reminderId: 'old' }],
    })).toBeNull();
  });
});

describe('formatted mode with display-enriched files', () => {
  function MakeDisplayFileJson() {
    return JSON.stringify({
      workspaceName: 'neochrome',
      exportGeneratedAt: '2026-06-09T14:00:00.000Z',
      display: {
        timeZone: 'America/New_York',
        sectionOrder: [
          { key: 'dueToday', label: '📅 Due Today' },
          { key: 'dueUpcoming', label: '📆 Due after today' },
          { key: 'dueLastWeek', label: '⚠️ Due within last 7 days' },
          { key: 'dueOlder', label: '🔴 Due older than 7 days' },
        ],
      },
      reminders: [{
        reminderId: 'r1',
        createdOn: '2026-06-07T12:00:00.000Z',
        shouldPostOn: '2026-06-12T12:00:00.000Z',
        display: {
          label: 'A',
          sectionKey: 'dueUpcoming',
          sectionLabel: '📆 Due after today',
          summary: 'Ship the hotfix',
          slackSummary: 'Ship the hotfix',
          permalink: 'https://x.slack.com/archives/C1/p123',
          taggedUserId: 'U_TARGET',
          assigneeName: 'Alex Rivera',
          ageDays: 2,
        },
      }],
      memories: [],
    });
  }

  test('posts the show-reminders digest style instead of the legacy bullet list', async () => {
    process.env.SLEUTH_RAG_GITHUB_PAT = 'tok';
    const Env = MakeEnv();
    StubFetch({ FileJson: MakeDisplayFileJson() });

    await HandleShowRebalanceRemindersCommandAsync(Env.SlackApp, Env.EventInfo, { Formatted: true });

    const Posted = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Posted).toContain('Pending reminders (1 total):');
    expect(Posted).toContain('*📆 Due after today*');
    expect(Posted).toContain('A.) <https://x.slack.com/archives/C1/p123|Ship the hotfix>');
    expect(Posted).toContain('<@U_TARGET>');
    expect(Posted).toContain('<!date^1781265600^');
    expect(Posted).not.toContain('— due times in'); // legacy header absent
  });
});
