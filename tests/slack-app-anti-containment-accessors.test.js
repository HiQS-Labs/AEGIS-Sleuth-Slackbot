'use strict';

// Requiring command-catalog must NOT install anti-containment hooks or define global registries.
require('../src/command-catalog');
const SlackApp = require('../src/slack-app');
const RemindersModule = require('../src/reminders-module');

describe('SlackApp workspace accessors and multi-tenant isolation', () => {
  const WorkspaceInfo1 = { WORKSPACE_NAME: 'workspace-alpha', MAIN_TIMEZONE: 'America/Los_Angeles' };
  const WorkspaceInfo2 = { WORKSPACE_NAME: 'workspace-beta', MAIN_TIMEZONE: 'America/New_York' };

  test('command-catalog does not install global monkeypatches or registries', () => {
    // Requiring command-catalog must not introduce global registries
    delete (/** @type {any} */ (global)).__sleuthaskreminders__;
    require('../src/command-catalog');
    expect((/** @type {any} */ (global)).__sleuthaskreminders__).toBeUndefined();
  });

  test('the accessors are defined natively on SlackApp.prototype with getters and setters', () => {
    for(const Name of ['RemindersModule', 'WorkspaceAI']) {
      const Descriptor = Object.getOwnPropertyDescriptor(SlackApp.prototype, Name);
      expect(typeof Descriptor?.get).toBe('function');
      expect(typeof Descriptor?.set).toBe('function');
    }
  });

  test('instances do not shadow the accessors with an own property', () => {
    const App = new SlackApp(WorkspaceInfo1, console);
    expect(Object.getOwnPropertyDescriptor(App, 'RemindersModule')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(App, 'WorkspaceAI')).toBeUndefined();
    expect(App.RemindersModule).toBeNull();
    expect(App.WorkspaceAI).toBeNull();
  });

  test('a bound RemindersModule resolves through SlackApp.RemindersModule', () => {
    const App = new SlackApp(WorkspaceInfo1, console);
    const BoundModule = /** @type {any} */ ({ Name: 'module-alpha' });
    App.RemindersModule = BoundModule;

    expect(App.RemindersModule).toBe(BoundModule);
  });

  test('a bound WorkspaceAI resolves through SlackApp.WorkspaceAI', () => {
    const App = new SlackApp(WorkspaceInfo1, console);
    const BoundAI = /** @type {any} */ ({ DefaultModelName: 'gpt-4o' });
    App.WorkspaceAI = BoundAI;

    expect(App.WorkspaceAI).toBe(BoundAI);
  });

  test('RemindersModule constructor binds itself to the owning SlackApp instance', () => {
    const App = new SlackApp(WorkspaceInfo1, console);
    expect(App.RemindersModule).toBeNull();

    const Module = new RemindersModule(App);
    expect(App.RemindersModule).toBe(Module);
  });

  test('two simultaneously active workspaces maintain strict isolation with zero cross-workspace fallback', () => {
    const App1 = new SlackApp(WorkspaceInfo1, console);
    const App2 = new SlackApp(WorkspaceInfo2, console);

    const Module1 = /** @type {any} */ ({ Workspace: 'alpha', Reminders: ['r-alpha'] });
    const AI1 = /** @type {any} */ ({ Workspace: 'alpha', Model: 'gpt-4o' });

    App1.RemindersModule = Module1;
    App1.WorkspaceAI = AI1;

    // Strict multi-tenant check: App2 has no modules set, and MUST NOT fall back
    // to App1's RemindersModule or WorkspaceAI (the #384 / fallback bug).
    expect(App1.RemindersModule).toBe(Module1);
    expect(App1.WorkspaceAI).toBe(AI1);
    expect(App2.RemindersModule).toBeNull();
    expect(App2.WorkspaceAI).toBeNull();

    // Now bind App2 to its own distinct modules
    const Module2 = /** @type {any} */ ({ Workspace: 'beta', Reminders: ['r-beta'] });
    const AI2 = /** @type {any} */ ({ Workspace: 'beta', Model: 'claude-3-5-sonnet' });

    App2.RemindersModule = Module2;
    App2.WorkspaceAI = AI2;

    expect(App1.RemindersModule).toBe(Module1);
    expect(App2.RemindersModule).toBe(Module2);
    expect(App1.RemindersModule).not.toBe(App2.RemindersModule);

    expect(App1.WorkspaceAI).toBe(AI1);
    expect(App2.WorkspaceAI).toBe(AI2);
    expect(App1.WorkspaceAI).not.toBe(App2.WorkspaceAI);
  });
});
