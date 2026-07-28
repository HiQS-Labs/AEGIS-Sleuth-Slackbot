
const path = require('path');
const PluginLoader = require('../src/plugin-loader');

// minimal SlackApp stub used by all tests.
function makeSlackApp(appMentionString = '<@U999>') {
  const handlers = [];
  return {
    AppMentionString: appMentionString,
    Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    HandleAppMention: jest.fn((fn) => handlers.push(fn)),
    PostMessageTextAsync: jest.fn(),
    WorkspaceInfo: { WORKSPACE_NAME: 'test-workspace' },
    // expose registered handlers for dispatch testing.
    _fireAppMention: async (eventInfo) => {
      for(const handler of handlers) {
        const handled = await handler({ AppMentionString: appMentionString, Logger: { info: jest.fn() }, PostMessageTextAsync: jest.fn(), WorkspaceInfo: { WORKSPACE_NAME: 'test-workspace' } }, eventInfo);
        if(handled) return true;
      }
      return false;
    },
  };
}

const WORKSPACE_INFO = { WORKSPACE_NAME: 'test-workspace' };

// helper: override the registry path used by PluginLoader.
function makeLoader(slackApp, registryJson) {
  const loader = new PluginLoader(slackApp, WORKSPACE_INFO);
  // inject a fake registry read by patching the private field indirectly via mock.
  jest.spyOn(require('fs').promises, 'readFile').mockImplementation(async (filePath) => {
    if(String(filePath).endsWith('plugin-registry.json'))
      return typeof registryJson === 'string' ? registryJson : JSON.stringify(registryJson);
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  return loader;
}

afterEach(() => jest.restoreAllMocks());

// ─── registry loading ────────────────────────────────────────────────────────

test('gracefully skips when registry file is absent', async () => {
  jest.spyOn(require('fs').promises, 'readFile').mockRejectedValue(
    Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  );
  const slackApp = makeSlackApp();
  const loader = new PluginLoader(slackApp, WORKSPACE_INFO);
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).not.toHaveBeenCalled();
});

test('gracefully skips when registry JSON is malformed', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, 'not valid json {{{');
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).toHaveBeenCalled();
});

test('gracefully skips when registry has no plugins array', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, { version: '1' });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).toHaveBeenCalled();
});

// ─── per-entry validation ────────────────────────────────────────────────────

test('skips entry with missing name field without aborting remaining entries', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: '', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'test', phase: 1 },
    ],
  });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).toHaveBeenCalled();
});

test('skips entry with missing entryPoint without aborting remaining entries', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: 'bad-plugin', entryPoint: null, enabled: true, version: '1.0.0', publisher: 'test', phase: 1 },
    ],
  });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).toHaveBeenCalled();
});

test('skips null entry without aborting the loop', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      null,
      { name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'NeochromeTeam', phase: 1 },
    ],
  });
  await loader.StartAsync();
  // null entry is skipped; the valid echo-command entry still loads.
  expect(loader.ActiveCount).toBe(1);
  expect(slackApp.Logger.error).toHaveBeenCalledWith(expect.stringContaining('malformed'));
});

test('skips entry with entryPoint that escapes project root', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: 'evil-plugin', entryPoint: '../../etc/passwd', enabled: true, version: '1.0.0', publisher: 'attacker', phase: 1 },
    ],
  });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).toHaveBeenCalledWith(expect.stringContaining('outside project root'));
});

test('skips entry with non-existent entryPoint path without aborting', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: 'ghost-plugin', entryPoint: 'src/plugins/does-not-exist/index.js', enabled: true, version: '1.0.0', publisher: 'test', phase: 1 },
    ],
  });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.error).toHaveBeenCalled();
});

test('skips disabled plugins and logs info', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: false, version: '1.0.0', publisher: 'test', phase: 1 },
    ],
  });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(0);
  expect(slackApp.Logger.info).toHaveBeenCalledWith(expect.stringContaining('disabled'));
});

// ─── successful load ─────────────────────────────────────────────────────────

test('loads echo-command plugin and increments ActiveCount', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'NeochromeTeam', phase: 1 },
    ],
  });
  await loader.StartAsync();
  expect(loader.ActiveCount).toBe(1);
  expect(slackApp.HandleAppMention).toHaveBeenCalledTimes(1);
});

test('StopAsync reduces ActiveCount to zero', async () => {
  const slackApp = makeSlackApp();
  const loader = makeLoader(slackApp, {
    version: '1',
    plugins: [
      { name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'NeochromeTeam', phase: 1 },
    ],
  });
  await loader.StartAsync();
  await loader.StopAsync();
  expect(loader.ActiveCount).toBe(0);
});

// ─── echo-command dispatch ───────────────────────────────────────────────────

function makeEchoDispatchApp() {
  const appMentionString = '<@U999>';
  const handlers = [];
  const PostMessageTextAsync = jest.fn();
  const Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const slackApp = {
    AppMentionString: appMentionString,
    Logger,
    PostMessageTextAsync,
    HandleAppMention: (fn) => handlers.push(fn),
    WorkspaceInfo: { WORKSPACE_NAME: 'test-workspace' },
    _dispatch: async (text) => {
      const eventInfo = { text, channel: 'C001', ts: '123.456', thread_ts: null };
      for(const handler of handlers) {
        const handled = await handler(slackApp, eventInfo);
        if(handled) return { handled: true, postedWith: PostMessageTextAsync.mock.calls };
      }
      return { handled: false };
    },
  };
  return slackApp;
}

test('echo-command replies with echoed text', async () => {
  const slackApp = makeEchoDispatchApp();
  jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(JSON.stringify({
    version: '1',
    plugins: [{ name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'NeochromeTeam', phase: 1 }],
  }));
  const loader = new PluginLoader(slackApp, WORKSPACE_INFO);
  await loader.StartAsync();

  const result = await slackApp._dispatch('<@U999> echo hello world');
  expect(result.handled).toBe(true);
  expect(result.postedWith[0][2]).toBe('Echo: hello world');
});

test('echo-command returns false for non-echo mention', async () => {
  const slackApp = makeEchoDispatchApp();
  jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(JSON.stringify({
    version: '1',
    plugins: [{ name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'NeochromeTeam', phase: 1 }],
  }));
  const loader = new PluginLoader(slackApp, WORKSPACE_INFO);
  await loader.StartAsync();

  const result = await slackApp._dispatch('<@U999> help');
  expect(result.handled).toBe(false);
});

test('echo-command returns false for empty echo', async () => {
  const slackApp = makeEchoDispatchApp();
  jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(JSON.stringify({
    version: '1',
    plugins: [{ name: 'echo-command', entryPoint: 'src/plugins/echo-command/index.js', enabled: true, version: '1.0.0', publisher: 'NeochromeTeam', phase: 1 }],
  }));
  const loader = new PluginLoader(slackApp, WORKSPACE_INFO);
  await loader.StartAsync();

  const result = await slackApp._dispatch('<@U999> echo ');
  expect(result.handled).toBe(false);
});
