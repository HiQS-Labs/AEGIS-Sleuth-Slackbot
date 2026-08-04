'use strict';

/**
 * GH-12 Phase 2 — durability of the reminder queue (Tier 1, the largest blast radius).
 *
 * Before this phase `#SaveRemindersAsync` did a bare `fs.writeFile` of the whole queue, with no
 * serialization between concurrent saves and no guard on a corrupt load. A hard kill mid-write left
 * unparseable JSON; the loader degraded that to an empty queue; and because nothing gated saves on
 * `#DataLoaded`, the next ordinary save wrote `[]` straight over the survivor data.
 */

jest.mock('../src/workspace-ai');

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');
const { BuildTempPath } = require('../src/durable-write');

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'DurabilityWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0, IncomingMessageLength: 0,
  OutgoingMessageCount: 0, OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0, OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0, IncomingGptMessageLength: 0,
};

const RuntimeDir = path.join(__dirname, '..', 'data', 'runtime', 'reminders');

/**
 * Per-test workspace so cases cannot collide on the shared runtime directory.
 * @param {string} ArgSuffix Unique suffix.
 * @returns {{ WorkspaceInfo: typeof TestWorkspaceInfo, RemindersPath: string }}
 */
function MakeWorkspace(ArgSuffix) {
  const WorkspaceName = `DurabilityWorkspace_${ArgSuffix}`;
  return {
    WorkspaceInfo: { ...TestWorkspaceInfo, WORKSPACE_NAME: WorkspaceName },
    RemindersPath: path.join(RuntimeDir, `${WorkspaceName}_reminders.json`),
  };
}

/**
 * Remove every runtime artefact for a workspace, including quarantine and temp files.
 * @param {string} ArgRemindersPath Reminders file path.
 * @returns {Promise<void>}
 */
async function CleanupAsync(ArgRemindersPath) {
  const Dir = path.dirname(ArgRemindersPath);
  const Base = path.basename(ArgRemindersPath).replace('_reminders.json', '');
  let Entries = [];
  try {
    Entries = await fs.readdir(Dir);
  } catch(error) {
    return;
  }
  await Promise.all(Entries
    .filter(ArgName => ArgName.startsWith(Base))
    .map(ArgName => fs.rm(path.join(Dir, ArgName), { force: true })));
}

/**
 * Sibling files produced by a quarantine.
 * @param {string} ArgRemindersPath Reminders file path.
 * @returns {string[]}
 */
function QuarantineFiles(ArgRemindersPath) {
  const Base = path.basename(ArgRemindersPath);
  return fsSync.readdirSync(path.dirname(ArgRemindersPath))
    .filter(ArgName => ArgName.startsWith(`${Base}.corrupt-`));
}

/**
 * Minimal persisted reminder accepted by the loader's reviver and indexes.
 * @param {number} ArgIndex Ordinal.
 * @returns {object}
 */
function MakeStoredReminder(ArgIndex) {
  return {
    ReminderID: `rem-${ArgIndex}`,
    ReminderMessageText: `task number ${ArgIndex}`,
    OriginalSenderID: 'U100',
    AssigneeID: 'U100',
    OriginalChannelID: 'C100',
    OriginalChannelName: 'general',
    State: 'scheduled',
    GitHubUrls: [],
    clientId: null,
    projectId: null,
    CreatedOn: new Date('2026-08-01T00:00:00.000Z').toISOString(),
    ShouldPostOn: new Date('2030-01-01T00:00:00.000Z').toISOString(),
  };
}

/**
 * Start a module against the given workspace.
 * @param {typeof TestWorkspaceInfo} ArgWorkspaceInfo Workspace info.
 * @returns {Promise<any>}
 */
async function StartModuleAsync(ArgWorkspaceInfo) {
  const SlackApp = new MockSlackApp({ WorkspaceInfo: ArgWorkspaceInfo });
  const Module = new RemindersModule(SlackApp);
  await Module.StartAsync(EmptyWorkspaceStats);
  return Module;
}

beforeAll(async () => {
  await fs.mkdir(RuntimeDir, { recursive: true });
});

describe('corrupt reminders file is quarantined, never silently overwritten', () => {
  // The exact GH-12 cascade: a truncated file used to load as [] and then get overwritten by the
  // next save, destroying every pending reminder with only one warn line as evidence.
  test('truncated JSON is moved aside with its bytes intact', async () => {
    const { WorkspaceInfo, RemindersPath } = MakeWorkspace('truncated');
    await CleanupAsync(RemindersPath);

    const Truncated = JSON.stringify([MakeStoredReminder(1), MakeStoredReminder(2)], null, 2).slice(0, 180);
    await fs.writeFile(RemindersPath, Truncated, 'utf8');

    await StartModuleAsync(WorkspaceInfo);

    const Quarantined = QuarantineFiles(RemindersPath);
    expect(Quarantined).toHaveLength(1);
    const Preserved = await fs.readFile(path.join(RuntimeDir, Quarantined[0]), 'utf8');
    expect(Preserved).toBe(Truncated);

    await CleanupAsync(RemindersPath);
  });

  test('valid JSON of the wrong shape is quarantined too', async () => {
    const { WorkspaceInfo, RemindersPath } = MakeWorkspace('wrongshape');
    await CleanupAsync(RemindersPath);
    await fs.writeFile(RemindersPath, JSON.stringify({ not: 'an array' }), 'utf8');

    await StartModuleAsync(WorkspaceInfo);

    expect(QuarantineFiles(RemindersPath)).toHaveLength(1);
    await CleanupAsync(RemindersPath);
  });

  // A legitimately empty queue (every reminder completed) must NOT be treated as corruption —
  // quarantining it would churn a file on every boot of an idle workspace.
  test('an empty array is a valid state, not corruption', async () => {
    const { WorkspaceInfo, RemindersPath } = MakeWorkspace('emptyarray');
    await CleanupAsync(RemindersPath);
    await fs.writeFile(RemindersPath, '[]', 'utf8');

    await StartModuleAsync(WorkspaceInfo);

    expect(QuarantineFiles(RemindersPath)).toHaveLength(0);
    await CleanupAsync(RemindersPath);
  });

  // ENOENT is the ordinary first-run case. Quarantining or refusing to save here would break
  // every fresh install.
  test('a missing file is a normal first run — no quarantine', async () => {
    const { WorkspaceInfo, RemindersPath } = MakeWorkspace('firstrun');
    await CleanupAsync(RemindersPath);

    await StartModuleAsync(WorkspaceInfo);

    expect(QuarantineFiles(RemindersPath)).toHaveLength(0);
    await CleanupAsync(RemindersPath);
  });
});

describe('concurrent saves do not lose an update', () => {
  // Atomic rename makes each save all-or-nothing but does NOT order saves. Without the write chain:
  // A snapshots the queue, B snapshots it, B renames, A renames its stale snapshot on top — and B's
  // completion is silently gone, leaving a perfectly valid JSON file. Reachable in normal operation
  // because the GitHubCommentRelay save callback is invoked without being awaited.
  test('completing several reminders concurrently loses none of them', async () => {
    const { WorkspaceInfo, RemindersPath } = MakeWorkspace('concurrent');
    await CleanupAsync(RemindersPath);

    const Seeded = Array.from({ length: 8 }, (ArgUnused, ArgIndex) => MakeStoredReminder(ArgIndex));
    await fs.writeFile(RemindersPath, JSON.stringify(Seeded, null, 2), 'utf8');

    const Module = await StartModuleAsync(WorkspaceInfo);

    // Fire them all at once so their snapshot-then-write pairs overlap.
    await Promise.all(Seeded.map(ArgReminder =>
      Module.CompleteReminderByIdAsync(ArgReminder.ReminderID, 'concurrency test')));

    const OnDisk = JSON.parse(await fs.readFile(RemindersPath, 'utf8'));
    // Every completion must be reflected. A lost update leaves a stale reminder behind.
    expect(OnDisk).toHaveLength(0);

    await CleanupAsync(RemindersPath);
  });
});

describe('stale temp files', () => {
  test('a temp stranded by an earlier hard kill is swept on load', async () => {
    const { WorkspaceInfo, RemindersPath } = MakeWorkspace('sweep');
    await CleanupAsync(RemindersPath);
    await fs.writeFile(RemindersPath, JSON.stringify([MakeStoredReminder(1)], null, 2), 'utf8');

    const Stray = BuildTempPath(RemindersPath);
    await fs.writeFile(Stray, 'half-written payload from a killed process', 'utf8');
    const Old = new Date(Date.now() - (2 * 60 * 60 * 1000));
    await fs.utimes(Stray, Old, Old);

    await StartModuleAsync(WorkspaceInfo);

    expect(fsSync.existsSync(Stray)).toBe(false);
    // The store itself is untouched by the sweep.
    expect(JSON.parse(await fs.readFile(RemindersPath, 'utf8'))).toHaveLength(1);

    await CleanupAsync(RemindersPath);
  });
});
