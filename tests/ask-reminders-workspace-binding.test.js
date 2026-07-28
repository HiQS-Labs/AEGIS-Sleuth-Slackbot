'use strict';

// #384 regression: ask-reminders must bind to the SlackApp of the workspace that received the event,
// not to global.__sleuthaskreminders__.slackApps[0] (the first-loaded workspace). All workspaces share
// one logger, so the legacy `find(app => app.Logger === ArgLogger)` always resolved to slackApps[0] —
// meaning every non-first workspace read the wrong reminders and replied with the wrong bot
// (channel_not_found). The route now receives its per-workspace SlackApp explicitly.

jest.mock('../src/chat-commands/ask-reminders-command', () => ({
  HandleAskRemindersCommandAsync: jest.fn().mockResolvedValue(undefined),
  ParseReminderQuery: jest.fn(),
  RenderCitedCandidates: jest.fn(),
}));

const { HandleAskRemindersCommandAsync } = require('../src/chat-commands/ask-reminders-command');
const { CommandRouter } = require('../src/chat-command-router');
const { RegisterCatalogRegexAliases } = require('../src/catalog-regex-aliases');

// One shared logger across workspaces — the real-world condition that broke the old logger match.
const SharedLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
const FirstWorkspaceApp = { WORKSPACE_NAME: 'ocux', Logger: SharedLogger };   // slackApps[0]
const EventWorkspaceApp = { WORKSPACE_NAME: 'neochrome', Logger: SharedLogger };

const EventInfo = { channel: 'C_NEO', ts: '1700000000.000001', user: 'U_ASKER', text: '' };
// isRealCatalog gate: an entry with Id 'ask-self' triggers the dynamic ask-reminders route registration.
// Any entry RegisterCatalogRegexAliases treats as the "this is the real catalog, not a stub"
// sentinel will do. `help-features` is that sentinel.
const MinimalCatalog = [{ Id: 'help-features' }];

beforeEach(() => {
  HandleAskRemindersCommandAsync.mockClear();
  // Reproduce the registry the Anti-Containment Hooks build: first-loaded workspace is slackApps[0].
  global.__sleuthaskreminders__ = { slackApps: [FirstWorkspaceApp, EventWorkspaceApp], remindersModules: [], workspaceAIs: [] };
});

test('binds ask-reminders to the passed per-workspace SlackApp, NOT slackApps[0] (#384)', async () => {
  const Router = new CommandRouter();
  RegisterCatalogRegexAliases(Router, MinimalCatalog, SharedLogger, EventWorkspaceApp);

  expect(await Router.RouteAsync("ask-reminders what's open for Client A?", EventInfo)).toBe(true);
  expect(HandleAskRemindersCommandAsync).toHaveBeenCalledTimes(1);

  const [PassedApp, PassedEvent, PassedQuery] = HandleAskRemindersCommandAsync.mock.calls[0];
  expect(PassedApp).toBe(EventWorkspaceApp);          // the workspace that received the event…
  expect(PassedApp).not.toBe(FirstWorkspaceApp);      // …not the first-loaded one (the bug).
  expect(PassedEvent).toBe(EventInfo);
  expect(PassedQuery).toBe("what's open for Client A?");
});

test('legacy fallback (no app passed) still resolves to slackApps[0] — documents the pre-fix behavior', async () => {
  const Router = new CommandRouter();
  RegisterCatalogRegexAliases(Router, MinimalCatalog, SharedLogger); // no ArgSlackApp

  await Router.RouteAsync('ask-reminders anything', EventInfo);
  expect(HandleAskRemindersCommandAsync.mock.calls[0][0]).toBe(FirstWorkspaceApp);
});
