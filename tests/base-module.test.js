'use strict';

// Self-check for the BaseModule primitive (src/base-module.js). The load-bearing property is
// tenant isolation: a module bound to workspace B must reach workspace B's SlackApp, even when B
// shares a logger with the first-loaded workspace A. This is the #384 failure mode expressed at the
// primitive level — if it regresses, every module built on the base regresses with it.

const { BaseModule } = require('../src/base-module');

// Minimal fake SlackApp: only what BaseModule + the register helpers touch.
function MakeFakeSlackApp(ArgWorkspaceName, ArgSharedLogger) {
  const AppMentionHandlers = [];
  return {
    WorkspaceInfo: { WORKSPACE_NAME: ArgWorkspaceName },
    Logger: ArgSharedLogger,
    AppMentionHandlers,
    HandleAppMention(ArgHandler) { AppMentionHandlers.push(ArgHandler); },
    HandleMessage() {},
    HandleAction() {},
    HandleReactionAdded() {},
  };
}

// A tiny module that registers one route whose Handle reports which SlackApp it closed over.
class ProbeModule extends BaseModule {
  constructor(ArgSlackApp) {
    super(ArgSlackApp);
    this.RegisterCommandRoutes();
  }
  RegisterCommandRoutes() {
    let BoundApp = null;
    this.CommandRouter.Register({
      Pattern: /^whoami$/i,
      Route: 'whoami',
      // The exact anti-#384 discipline: the closure reaches this.SlackApp, not a global.
      Handle: () => { BoundApp = this.SlackApp; },
    });
    this._ReadBoundApp = () => BoundApp;
  }
}

test('requires a SlackApp — construction without one throws (no orphan modules)', () => {
  expect(() => new BaseModule(undefined)).toThrow(/ArgSlackApp is required/);
});

test('requires a non-empty WORKSPACE_NAME — a nameless workspace would share per-tenant paths', () => {
  const NamelessApp = { WorkspaceInfo: {}, Logger: { info() {}, warn() {}, error() {} } };
  expect(() => new BaseModule(NamelessApp)).toThrow(/WORKSPACE_NAME must be a non-empty string/);
});

test('getters resolve to the constructed workspace, not a shared/ambient source', () => {
  const SharedLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const App = MakeFakeSlackApp('neochrome', SharedLogger);
  const Module = new BaseModule(App);

  expect(Module.SlackApp).toBe(App);
  expect(Module.Logger).toBe(SharedLogger);
  expect(Module.WorkspaceName).toBe('neochrome');
  expect(Module.WorkspaceInfo).toBe(App.WorkspaceInfo);
});

test('two modules sharing one logger keep separate per-workspace route bindings (#384 regression)', async () => {
  const SharedLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const FirstApp = MakeFakeSlackApp('ocux', SharedLogger);       // first-loaded workspace
  const EventApp = MakeFakeSlackApp('neochrome', SharedLogger);  // the one that got the event

  const FirstModule = new ProbeModule(FirstApp);
  const EventModule = new ProbeModule(EventApp);

  await EventModule.CommandRouter.RouteAsync('whoami', { channel: 'C_NEO' });
  await FirstModule.CommandRouter.RouteAsync('whoami', { channel: 'C_OCUX' });

  // Each route closed over ITS OWN workspace's app — never leaked to the first-loaded one.
  expect(EventModule._ReadBoundApp()).toBe(EventApp);
  expect(EventModule._ReadBoundApp()).not.toBe(FirstApp);
  expect(FirstModule._ReadBoundApp()).toBe(FirstApp);
});

test('GetRegisteredCommandRoutes exposes routes for the catalog validator (same method legacy modules use)', () => {
  const App = MakeFakeSlackApp('ocux', { info() {}, warn() {}, error() {} });
  const Module = new ProbeModule(App);
  expect(Module.GetRegisteredCommandRoutes().map(r => r.Route)).toEqual(['whoami']);
});

test('register helpers bind the handler to the module instance', () => {
  const App = MakeFakeSlackApp('ocux', { info() {}, warn() {}, error() {} });
  class MentionModule extends BaseModule {
    constructor(a) { super(a); this.RegisterAppMention(this.OnMention); this.Seen = null; }
    OnMention() { this.Seen = this.WorkspaceName; return true; }
  }
  const Module = new MentionModule(App);
  App.AppMentionHandlers[0]({});
  expect(Module.Seen).toBe('ocux'); // `this` inside OnMention resolved to the module, not undefined
});
