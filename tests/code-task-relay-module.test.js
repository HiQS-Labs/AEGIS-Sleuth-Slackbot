'use strict';

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const CodeTaskRelayModule = require('../src/code-task-relay-module');
const { ResolveCodeTaskConfig, DispatchCodeTaskAsync } = CodeTaskRelayModule;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MakeMockSlackApp(ArgWorkspaceInfo = {}) {
  const WorkspaceInfo = { WORKSPACE_NAME: 'neochrome', CODE_TASK_RELAY_ENABLED: true, ...ArgWorkspaceInfo };
  const Logger = {
    InfoMessages: [], WarnMessages: [], ErrorMessages: [],
    info(...A) { this.InfoMessages.push(A.join(' ')); },
    warn(...A) { this.WarnMessages.push(A.join(' ')); },
    error(...A) { this.ErrorMessages.push(A.join(' ')); },
  };
  return { WorkspaceInfo, Logger, PostMessageTextAsync: jest.fn().mockResolvedValue('ts1') };
}

function MakeFakeGithubClient() {
  return {
    ListAsync: jest.fn().mockResolvedValue([]),
    GetContentAsync: jest.fn().mockResolvedValue(''),
    WriteFileAsync: jest.fn().mockResolvedValue({ ok: true, htmlUrl: 'https://github.com/x/y/blob/main/code-tasks/f.md', status: 201 }),
    CreateIssueAsync: jest.fn().mockResolvedValue({ ok: true, htmlUrl: 'https://github.com/x/y/issues/1', status: 201 }),
  };
}

const SPEC = Object.freeze({
  title: 'Add retry to sync',
  summary: 'Wrap the fetch in a retry.',
  target_repo: 'NeochromeTeam/sleuth-app',
  target_branch: 'code-task/add-retry-to-sync',
  instructions: 'In src/github-sync-module.js add a 3-attempt retry.',
  acceptance_criteria: ['npm test passes'],
  affected_areas: ['src/github-sync-module.js'],
  open_questions: [],
  confidence: 0.8,
});

function AckContent(ArgFields) {
  const parts = Object.entries(ArgFields).map(([k, v]) => `${k}="${v}"`);
  return `<!-- code-task-relay: ${parts.join(' ')} -->\n\n# Cloud dispatch\n`;
}

// ---------------------------------------------------------------------------
// DispatchCodeTaskAsync — trigger modes
// ---------------------------------------------------------------------------
describe('DispatchCodeTaskAsync — trigger modes', () => {
  const BaseConfig = { relayRepo: 'org/drop', relayBranch: 'main', tasksDir: 'code-tasks', issueLabel: 'claude-code-task' };
  const Origin = { channel: 'C123', threadTs: '111.222', user: 'U1' };
  const Now = new Date('2026-06-20T20:30:45Z');

  test('desktop mode writes the task file, opens no issue', async () => {
    const GH = MakeFakeGithubClient();
    const Result = await DispatchCodeTaskAsync({ githubClient: GH, spec: SPEC, origin: Origin, config: { ...BaseConfig, triggerMode: 'desktop' }, now: Now });

    expect(GH.WriteFileAsync).toHaveBeenCalledTimes(1);
    expect(GH.CreateIssueAsync).not.toHaveBeenCalled();
    const [Repo, FilePath, Markdown, , Branch] = GH.WriteFileAsync.mock.calls[0];
    expect(Repo).toBe('org/drop');
    expect(FilePath).toMatch(/^code-tasks\/20260620T203045Z__add-retry-to-sync__[0-9a-f]{8}\.md$/);
    expect(Branch).toBe('main');
    expect(Markdown).toContain('# Add retry to sync');
    expect(Markdown).toContain('code-task-relay:');
    expect(Result.taskId).toMatch(/^20260620T203045Z__add-retry-to-sync__[0-9a-f]{8}$/);
    expect(Result.fileUrl).toContain('github.com');
    expect(Result.issueUrl).toBeNull();
  });

  test('github mode opens a labeled issue on the target repo, writes no file', async () => {
    const GH = MakeFakeGithubClient();
    const Result = await DispatchCodeTaskAsync({ githubClient: GH, spec: SPEC, origin: Origin, config: { ...BaseConfig, triggerMode: 'github' }, now: Now });

    expect(GH.WriteFileAsync).not.toHaveBeenCalled();
    expect(GH.CreateIssueAsync).toHaveBeenCalledTimes(1);
    const [Repo, Issue] = GH.CreateIssueAsync.mock.calls[0];
    expect(Repo).toBe('NeochromeTeam/sleuth-app');
    expect(Issue.title).toBe('[code-task] Add retry to sync');
    expect(Issue.labels).toEqual(['claude-code-task']);
    expect(Result.issueUrl).toContain('issues/1');
    expect(Result.fileUrl).toBeNull();
  });

  test('both mode writes the file AND opens the issue', async () => {
    const GH = MakeFakeGithubClient();
    await DispatchCodeTaskAsync({ githubClient: GH, spec: SPEC, origin: Origin, config: { ...BaseConfig, triggerMode: 'both' }, now: Now });
    expect(GH.WriteFileAsync).toHaveBeenCalledTimes(1);
    expect(GH.CreateIssueAsync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ResolveCodeTaskConfig — gating
// ---------------------------------------------------------------------------
describe('ResolveCodeTaskConfig — gating', () => {
  test('enabled requires neochrome workspace + flag + PAT', () => {
    const C = ResolveCodeTaskConfig(MakeMockSlackApp(), { pat: 'p' });
    expect(C.enabled).toBe(true);
  });
  test('wrong workspace disables', () => {
    const C = ResolveCodeTaskConfig(MakeMockSlackApp({ WORKSPACE_NAME: 'other' }), { pat: 'p' });
    expect(C.enabled).toBe(false);
  });
  test('flag off disables', () => {
    const C = ResolveCodeTaskConfig(MakeMockSlackApp({ CODE_TASK_RELAY_ENABLED: false }), { pat: 'p' });
    expect(C.enabled).toBe(false);
  });
  test('missing PAT disables even when flagged', () => {
    const C = ResolveCodeTaskConfig(MakeMockSlackApp(), { pat: '' });
    expect(C.enabled).toBe(false);
  });
  test('invalid trigger mode falls back to desktop', () => {
    const C = ResolveCodeTaskConfig(MakeMockSlackApp(), { pat: 'p', triggerMode: 'bogus' });
    expect(C.triggerMode).toBe('desktop');
  });
});

// ---------------------------------------------------------------------------
// Feedback poll — seed, exactly-once posting to origin thread, restart, disabled
// ---------------------------------------------------------------------------
describe('CodeTaskRelayModule — feedback poll', () => {
  let TempDir, SeenPath, SlackApp, GH, Module;

  function MakeModule(ArgExtra = {}) {
    return new CodeTaskRelayModule(SlackApp, SlackApp.Logger, {
      enabled: true, pat: 'test-pat', relayRepo: 'org/drop', acksDir: 'code-tasks/acks',
      seenPath: SeenPath, pollIntervalMs: 999999, githubClient: GH, ...ArgExtra,
    });
  }

  beforeEach(async () => {
    TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-task-relay-test-'));
    SeenPath = path.join(TempDir, 'seen.json');
    SlackApp = MakeMockSlackApp();
    GH = MakeFakeGithubClient();
  });

  afterEach(async () => {
    if(Module) await Module.StopAsync();
    await fs.rm(TempDir, { recursive: true, force: true });
  });

  test('first run seeds existing acks without posting; a new ack posts once to its thread', async () => {
    GH.ListAsync.mockResolvedValueOnce([{ name: 'old.md', sha: 's0' }]);
    Module = MakeModule();

    await Module.StartAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();

    GH.ListAsync.mockResolvedValue([{ name: 'old.md', sha: 's0' }, { name: 'new.md', sha: 's1' }]);
    GH.GetContentAsync.mockResolvedValue(AckContent({
      'task-id': 'T1', channel: 'C9', 'thread-ts': '333.444', status: 'started', 'session-url': 'https://claude.ai/code/sess1',
    }));

    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    const [Channel, ThreadTs, Text] = SlackApp.PostMessageTextAsync.mock.calls[0];
    expect(Channel).toBe('C9');
    expect(ThreadTs).toBe('333.444');
    expect(Text).toContain('https://claude.ai/code/sess1');
    expect(Text).toContain('T1');

    // second cycle, same list → no re-post.
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
  });

  test('restart does not re-seed; an ack that arrived during downtime is posted', async () => {
    await fs.writeFile(SeenPath, JSON.stringify(['old.md']), 'utf8');
    GH.ListAsync.mockResolvedValue([{ name: 'old.md', sha: 's0' }, { name: 'during.md', sha: 's1' }]);
    GH.GetContentAsync.mockResolvedValue(AckContent({ 'task-id': 'T2', channel: 'C9', 'thread-ts': '1.2', status: 'started' }));
    Module = MakeModule();

    await Module.StartAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    expect(GH.GetContentAsync).toHaveBeenCalledWith('org/drop', 'code-tasks/acks/during.md');
    expect(GH.GetContentAsync).not.toHaveBeenCalledWith('org/drop', 'code-tasks/acks/old.md');
  });

  test('an ack missing a channel is skipped (no post)', async () => {
    GH.ListAsync.mockResolvedValueOnce([]); // first-run seed: nothing yet
    GH.ListAsync.mockResolvedValue([{ name: 'bad.md', sha: 's1' }]);
    GH.GetContentAsync.mockResolvedValue(AckContent({ 'task-id': 'T3', status: 'started' }));
    Module = MakeModule();
    await Module.StartAsync();
    await Module.RunOnceAsync();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
    const Warn = SlackApp.Logger.WarnMessages.find((m) => m.includes('no channel'));
    expect(Warn).toBeTruthy();
  });

  test('disabled → StartAsync is a no-op, client never called', async () => {
    SlackApp = MakeMockSlackApp({ CODE_TASK_RELAY_ENABLED: false });
    GH = MakeFakeGithubClient();
    Module = MakeModule({ enabled: false });
    await Module.StartAsync();
    expect(GH.ListAsync).not.toHaveBeenCalled();
    expect(SlackApp.PostMessageTextAsync).not.toHaveBeenCalled();
  });
});
