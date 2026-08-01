'use strict';

// Requiring command-catalog installs the anti-containment hooks, which define the
// RemindersModule and WorkspaceAI accessors on SlackApp.prototype.
require('../src/command-catalog');
const SlackApp = require('../src/slack-app');

describe('SlackApp anti-containment accessors', () => {
  const WorkspaceInfo = { WORKSPACE_NAME: 'accessor-test-workspace', MAIN_TIMEZONE: 'UTC' };

  /** @type {any} */
  let Registry;
  /** @type {number} */
  let RemindersModuleCount;
  /** @type {number} */
  let WorkspaceAICount;

  beforeEach(() => {
    Registry = global.__sleuthaskreminders__;
    RemindersModuleCount = Registry.remindersModules.length;
    WorkspaceAICount = Registry.workspaceAIs.length;
  });

  afterEach(() => {
    Registry.remindersModules.length = RemindersModuleCount;
    Registry.workspaceAIs.length = WorkspaceAICount;
  });

  test('the hooks install accessors on the prototype', () => {
    for(const Name of ['RemindersModule', 'WorkspaceAI']) {
      const Descriptor = Object.getOwnPropertyDescriptor(SlackApp.prototype, Name);
      expect(typeof Descriptor?.get).toBe('function');
    }
  });

  test('instances do not shadow the accessors with an own property', () => {
    const App = new SlackApp(WorkspaceInfo, console);

    // A class field declaration would install an own data property here. Own properties win
    // over prototype accessors on every read, which would make the hooks dead code and every
    // lookup return the field's initial value.
    expect(Object.getOwnPropertyDescriptor(App, 'RemindersModule')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(App, 'WorkspaceAI')).toBeUndefined();
  });

  test('a registered RemindersModule resolves through SlackApp.RemindersModule', () => {
    const App = new SlackApp(WorkspaceInfo, console);
    const BoundModule = { slackApp: App };
    Registry.remindersModules.push(BoundModule);

    // This is the lookup ask-reminders-command.js depends on.
    expect(App.RemindersModule).toBe(BoundModule);
  });

  test('a registered WorkspaceAI resolves through SlackApp.WorkspaceAI', () => {
    const App = new SlackApp(WorkspaceInfo, console);
    const BoundAI = { WorkspaceInfo: { WORKSPACE_NAME: WorkspaceInfo.WORKSPACE_NAME } };
    Registry.workspaceAIs.push(BoundAI);

    expect(App.WorkspaceAI).toBe(BoundAI);
  });
});
