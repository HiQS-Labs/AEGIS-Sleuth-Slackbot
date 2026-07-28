'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createRouterShadowStore, ShadowFilePath } = require('../src/router-shadow-store');
const {
  RouterShadowModule,
  DEFAULT_SHADOW_MODEL,
  DEFAULT_ACTIVE_CONFIDENCE_MIN,
  DEFAULT_MODE_ENV,
} = require('../src/router-shadow-module');
const { HandleRouterModeCommandAsync } = require('../src/chat-commands/router-mode-command');

/** @returns {Promise<string>} a fresh temp rootDir. */
function MakeRootDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'router-shadow-'));
}

// ---------------------------------------------------------------------------
// router-shadow-store — non-authoritative, never-throws append-only JSONL
// ---------------------------------------------------------------------------
describe('createRouterShadowStore', () => {
  test('append + readAll roundtrip stamps ts and workspace, in order', async () => {
    const RootDir = await MakeRootDir();
    const Store = createRouterShadowStore({ rootDir: RootDir });

    const A = await Store.append('ws1', { mode: 'shadow', rawText: 'a', routerOutcome: 'matched' });
    const B = await Store.append('ws1', { mode: 'shadow', rawText: 'b', routerOutcome: 'unmatched' });
    expect(A.ok).toBe(true);
    expect(B.ok).toBe(true);

    const Records = await Store.readAll('ws1');
    expect(Records.map((ArgR) => ArgR.rawText)).toEqual(['a', 'b']);
    expect(Records[0].workspace).toBe('ws1');
    expect(typeof Records[0].ts).toBe('string');
    // file lives under rootDir with the sanitized workspace name
    expect(ShadowFilePath(RootDir, 'ws1')).toBe(path.join(RootDir, 'ws1_router-shadow.jsonl'));
  });

  test('preserves a caller-supplied ts', async () => {
    const RootDir = await MakeRootDir();
    const Store = createRouterShadowStore({ rootDir: RootDir });
    await Store.append('ws1', { ts: '2026-01-01T00:00:00.000Z', mode: 'shadow', rawText: 'x', routerOutcome: 'matched' });
    const [Rec] = await Store.readAll('ws1');
    expect(Rec.ts).toBe('2026-01-01T00:00:00.000Z');
  });

  test('isolates workspaces into separate files', async () => {
    const RootDir = await MakeRootDir();
    const Store = createRouterShadowStore({ rootDir: RootDir });
    await Store.append('alpha', { mode: 'shadow', rawText: 'a', routerOutcome: 'matched' });
    await Store.append('beta', { mode: 'shadow', rawText: 'b', routerOutcome: 'matched' });
    expect((await Store.readAll('alpha')).map((ArgR) => ArgR.rawText)).toEqual(['a']);
    expect((await Store.readAll('beta')).map((ArgR) => ArgR.rawText)).toEqual(['b']);
  });

  test('never throws on bad input — resolves {ok:false} and writes nothing', async () => {
    const RootDir = await MakeRootDir();
    const Store = createRouterShadowStore({ rootDir: RootDir });
    expect((await Store.append('', { mode: 'shadow' })).ok).toBe(false);
    expect((await Store.append('ws1', null)).ok).toBe(false);
    expect((await Store.append('ws1', [1, 2])).ok).toBe(false);
    expect(await Store.readAll('ws1')).toEqual([]); // nothing written
  });

  test('readAll returns [] for a missing file and skips a torn final line', async () => {
    const RootDir = await MakeRootDir();
    const Store = createRouterShadowStore({ rootDir: RootDir });
    expect(await Store.readAll('never')).toEqual([]);

    await Store.append('ws1', { mode: 'shadow', rawText: 'good', routerOutcome: 'matched' });
    // simulate an interrupted append: a half-written final line with no newline
    await fs.appendFile(ShadowFilePath(RootDir, 'ws1'), '{"mode":"shadow","rawText":"tor', 'utf8');
    const Records = await Store.readAll('ws1');
    expect(Records).toHaveLength(1);
    expect(Records[0].rawText).toBe('good');
  });
});

// ---------------------------------------------------------------------------
// RouterShadowModule — mode state, gating, resolve, execute-decision, logging
// ---------------------------------------------------------------------------
describe('RouterShadowModule', () => {
  /** A fake store that records appends and can be told to fail. */
  function MakeFakeStore({ Fail = false } = {}) {
    const Appended = [];
    return {
      Appended,
      append: jest.fn(async (ArgWorkspace, ArgRecord) => {
        if(Fail) return { ok: false, error: new Error('disk full') };
        Appended.push({ workspace: ArgWorkspace, record: ArgRecord });
        return { ok: true };
      }),
    };
  }

  function MakeModule({ Resolve, Store } = {}) {
    return new RouterShadowModule({
      WorkspaceName: 'neochrome',
      Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      Store: Store || MakeFakeStore(),
      ResolveIntentAsync: Resolve || jest.fn().mockResolvedValue({
        IntentId: 'models', CanonicalCommand: 'models', Confidence: 0.9, NeedsClarification: false,
      }),
    });
  }

  const SavedEnv = {};
  beforeEach(() => {
    SavedEnv.ROUTER_SHADOW_WORKSPACES = process.env.ROUTER_SHADOW_WORKSPACES;
    SavedEnv.ROUTER_SHADOW_MODEL = process.env.ROUTER_SHADOW_MODEL;
    SavedEnv.ROUTER_ACTIVE_CONFIDENCE_MIN = process.env.ROUTER_ACTIVE_CONFIDENCE_MIN;
    SavedEnv[DEFAULT_MODE_ENV] = process.env[DEFAULT_MODE_ENV];
    delete process.env.ROUTER_SHADOW_WORKSPACES;
    delete process.env.ROUTER_SHADOW_MODEL;
    delete process.env.ROUTER_ACTIVE_CONFIDENCE_MIN;
    delete process.env[DEFAULT_MODE_ENV];
  });
  afterEach(() => {
    for(const Key of Object.keys(SavedEnv)) {
      if(SavedEnv[Key] === undefined) delete process.env[Key];
      else process.env[Key] = SavedEnv[Key];
    }
  });

  test('mode validation and transitions', () => {
    expect(RouterShadowModule.IsValidMode('shadow')).toBe(true);
    expect(RouterShadowModule.IsValidMode('ACTIVE')).toBe(true);
    expect(RouterShadowModule.IsValidMode('nonsense')).toBe(false);
    expect(RouterShadowModule.ValidModes).toEqual(['off', 'shadow', 'active']);

    const Module = MakeModule();
    expect(Module.GetMode()).toBe('off'); // default
    expect(Module.SetMode('Shadow')).toBe('shadow');
    expect(Module.GetMode()).toBe('shadow');
    expect(() => Module.SetMode('bogus')).toThrow(/invalid router mode/);
    expect(Module.GetMode()).toBe('shadow'); // unchanged after a bad set
  });

  describe('startup default mode (ROUTER_SHADOW_DEFAULT_MODE)', () => {
    test('unset → built-in default off', () => {
      delete process.env[DEFAULT_MODE_ENV];
      expect(MakeModule().GetMode()).toBe('off');
    });

    test('valid value seeds the startup mode (case/space-insensitive)', () => {
      process.env[DEFAULT_MODE_ENV] = '  Shadow ';
      expect(MakeModule().GetMode()).toBe('shadow');
      process.env[DEFAULT_MODE_ENV] = 'active';
      expect(MakeModule().GetMode()).toBe('active');
    });

    test('invalid value is warned and falls back to off (fail-safe, never arm on a typo)', () => {
      process.env[DEFAULT_MODE_ENV] = 'shadoww';
      const Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const Module = new RouterShadowModule({
        WorkspaceName: 'neochrome',
        Logger,
        Store: MakeFakeStore(),
        ResolveIntentAsync: jest.fn(),
      });
      expect(Module.GetMode()).toBe('off');
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringMatching(/ignoring invalid ROUTER_SHADOW_DEFAULT_MODE/));
    });

    test('runtime SetMode still overrides the env default (env is only the startup seed)', () => {
      process.env[DEFAULT_MODE_ENV] = 'shadow';
      const Module = MakeModule();
      expect(Module.GetMode()).toBe('shadow');
      Module.SetMode('off');
      expect(Module.GetMode()).toBe('off');
    });
  });

  test('workspace allowlist gates IsArmed', () => {
    const Module = MakeModule();
    Module.SetMode('shadow');
    expect(Module.IsArmed()).toBe(true); // no allowlist => armed

    process.env.ROUTER_SHADOW_WORKSPACES = 'other,another';
    expect(Module.IsWorkspaceAllowed()).toBe(false);
    expect(Module.IsArmed()).toBe(false);

    process.env.ROUTER_SHADOW_WORKSPACES = 'other, neochrome';
    expect(Module.IsWorkspaceAllowed()).toBe(true);
    expect(Module.IsArmed()).toBe(true);

    Module.SetMode('off');
    expect(Module.IsArmed()).toBe(false); // off is never armed
  });

  test('ResolveCandidateAsync maps the resolution and forces the Flash Lite model', async () => {
    const Resolve = jest.fn().mockResolvedValue({
      IntentId: 'models', CanonicalCommand: 'models', Confidence: 0.42, NeedsClarification: false,
    });
    const Module = MakeModule({ Resolve });
    const Candidate = await Module.ResolveCandidateAsync('what models are there', 'C1');

    expect(Resolve).toHaveBeenCalledWith('what models are there', { ChannelID: 'C1', ModelNameOverride: DEFAULT_SHADOW_MODEL });
    expect(Candidate.model).toBe(DEFAULT_SHADOW_MODEL);
    expect(Candidate.intentId).toBe('models');
    expect(Candidate.canonicalCommand).toBe('models');
    expect(Candidate.confidence).toBe(0.42);
    expect(Candidate.error).toBeNull();
    expect(typeof Candidate.latencyMs).toBe('number');
  });

  test('ROUTER_SHADOW_MODEL overrides the default model id', async () => {
    process.env.ROUTER_SHADOW_MODEL = 'gemini-3.1-flash-lite';
    const Resolve = jest.fn().mockResolvedValue({ IntentId: 'models', CanonicalCommand: 'models', Confidence: 1 });
    const Module = MakeModule({ Resolve });
    const Candidate = await Module.ResolveCandidateAsync('x', 'C1');
    expect(Candidate.model).toBe('gemini-3.1-flash-lite');
    expect(Resolve).toHaveBeenCalledWith('x', { ChannelID: 'C1', ModelNameOverride: 'gemini-3.1-flash-lite' });
  });

  test('ResolveCandidateAsync never throws — a resolver failure becomes an error candidate', async () => {
    const Resolve = jest.fn().mockRejectedValue(new Error('gemini 503'));
    const Module = MakeModule({ Resolve });
    const Candidate = await Module.ResolveCandidateAsync('x', 'C1');
    expect(Candidate.error).toBe('gemini 503');
    expect(Candidate.canonicalCommand).toBeNull();
    expect(Candidate.confidence).toBeNull();
  });

  test('ShouldExecute — full takeover only above the confidence floor with a runnable command', () => {
    const Module = MakeModule();
    const Base = { model: 'm', intentId: 'models', canonicalCommand: 'models', confidence: 0.9, needsClarification: false, latencyMs: 1, error: null };
    expect(Module.ShouldExecute(Base)).toBe(true);
    expect(Module.ActiveConfidenceMin()).toBe(DEFAULT_ACTIVE_CONFIDENCE_MIN);

    expect(Module.ShouldExecute({ ...Base, confidence: 0.5 })).toBe(false); // below floor
    expect(Module.ShouldExecute({ ...Base, canonicalCommand: null })).toBe(false); // no runnable command
    expect(Module.ShouldExecute({ ...Base, needsClarification: true })).toBe(false);
    expect(Module.ShouldExecute({ ...Base, error: 'boom' })).toBe(false);
    expect(Module.ShouldExecute(null)).toBe(false);
  });

  test('ROUTER_ACTIVE_CONFIDENCE_MIN tunes the execution floor', () => {
    process.env.ROUTER_ACTIVE_CONFIDENCE_MIN = '0.95';
    const Module = MakeModule();
    const Cand = { model: 'm', intentId: 'x', canonicalCommand: 'x', confidence: 0.9, needsClarification: false, latencyMs: 1, error: null };
    expect(Module.ShouldExecute(Cand)).toBe(false); // 0.9 < 0.95
    expect(Module.ActiveConfidenceMin()).toBe(0.95);
  });

  test('LogShadowAsync resolves + appends a well-formed record', async () => {
    const Store = MakeFakeStore();
    const Module = MakeModule({ Store });
    const Result = await Module.LogShadowAsync({ rawText: 'hi', channelId: 'C1', routerOutcome: 'unmatched', matchedRoute: null });
    expect(Result.ok).toBe(true);
    expect(Store.Appended).toHaveLength(1);
    const { workspace, record } = Store.Appended[0];
    expect(workspace).toBe('neochrome');
    expect(record.mode).toBe('shadow');
    expect(record.rawText).toBe('hi');
    expect(record.routerOutcome).toBe('unmatched');
    expect(record.executed).toBeNull();
    expect(record.candidate.intentId).toBe('models');
    expect(record.promptVersion).toBeTruthy();
    expect(record.schemaVersion).toBeTruthy();
  });

  test('AppendRecordAsync never throws when the store fails — returns {ok:false} and warns', async () => {
    const Store = MakeFakeStore({ Fail: true });
    const Module = MakeModule({ Store });
    const Result = await Module.AppendRecordAsync({ mode: 'active', rawText: 'x', routerOutcome: 'matched', candidate: null, executed: false });
    expect(Result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HandleRouterModeCommandAsync — admin gating + report/set/validate
// ---------------------------------------------------------------------------
describe('HandleRouterModeCommandAsync', () => {
  function MakeEnv({ IsAdmin = true, CurrentMode = 'off' } = {}) {
    let Mode = CurrentMode;
    const SlackApp = {
      Logger: { info: jest.fn() },
      WorkspaceInfo: { WORKSPACE_NAME: 'neochrome' },
      IsAdminOrOwnerAsync: jest.fn().mockResolvedValue(IsAdmin),
      PostMessageTextAsync: jest.fn().mockResolvedValue(),
    };
    const Deps = {
      GetRouterMode: () => Mode,
      SetRouterMode: jest.fn((ArgMode) => { Mode = ArgMode; return Mode; }),
    };
    const EventInfo = { user: 'U_ADMIN', channel: 'C1', ts: '1700000000.000001', text: '' };
    return { SlackApp, Deps, EventInfo };
  }

  test('rejects non-admins without changing the mode', async () => {
    const Env = MakeEnv({ IsAdmin: false });
    await HandleRouterModeCommandAsync(Env.SlackApp, Env.EventInfo, 'active', Env.Deps);
    expect(Env.Deps.SetRouterMode).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toMatch(/only workspace admins or owners/i);
  });

  test('no argument reports the current mode', async () => {
    const Env = MakeEnv({ CurrentMode: 'shadow' });
    await HandleRouterModeCommandAsync(Env.SlackApp, Env.EventInfo, null, Env.Deps);
    expect(Env.Deps.SetRouterMode).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toMatch(/currently \*shadow\*/i);
  });

  test('an invalid mode is rejected with the valid options and no state change', async () => {
    const Env = MakeEnv();
    await HandleRouterModeCommandAsync(Env.SlackApp, Env.EventInfo, 'turbo', Env.Deps);
    expect(Env.Deps.SetRouterMode).not.toHaveBeenCalled();
    expect(Env.SlackApp.PostMessageTextAsync.mock.calls[0][2]).toMatch(/unknown router mode/i);
  });

  test('a valid mode is applied and confirmed', async () => {
    const Env = MakeEnv({ CurrentMode: 'off' });
    await HandleRouterModeCommandAsync(Env.SlackApp, Env.EventInfo, 'active', Env.Deps);
    expect(Env.Deps.SetRouterMode).toHaveBeenCalledWith('active');
    const Msg = Env.SlackApp.PostMessageTextAsync.mock.calls[0][2];
    expect(Msg).toMatch(/set to \*active\*/i);
    expect(Msg).toMatch(/was \*off\*/i);
    expect(Env.SlackApp.Logger.info).toHaveBeenCalled();
  });
});
