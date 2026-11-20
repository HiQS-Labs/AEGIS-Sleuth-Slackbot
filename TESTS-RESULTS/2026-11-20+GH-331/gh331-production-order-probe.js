// production order: reminders-module first (as app.js does), then the sync module; no app start.
const Root = process.argv[2];
const Reminders = require(Root + '/src/reminders-module');
const Sync = require(Root + '/src/github-sync-module');
const Errors = [];
const Logger = { info() {}, warn() {}, debug() {}, error: (...A) => Errors.push(A.map(String).join(' ')) };
const Reminder = { ReminderID: 'probe-1', TargetChannelID: 'C1', ReminderMessageText: 'probe', GitHubUrls: ['https://github.com/o/r/issues/1'] };
let Completed = 0;
const Harness = { DataLoaded: true, DataLoadError: null, GetAllReminders: () => [Reminder],
  SlackApp: { Logger, WorkspaceInfo: { WORKSPACE_NAME: 'probe', GITHUB_PAT: 'x', MAIN_TIMEZONE: 'UTC' }, PostMessageAsync: async () => ({}), PostMessageTextAsync: async () => ({ ok: true }), SendMessageAsync: async () => ({}) },
  CompleteReminderByIdAsync: async (Id, Reason, Opts) => { Completed += Opts.ExpectedVersion === Reminders.GetReminderVersion(Reminder) ? 1 : 0; return true; } };
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ state: 'closed' }) });
(async () => {
  const M = new Sync([Harness], Logger, 9999999);
  await M.StartAsync(); const R = await M.RunNowAsync(); await M.StopAsync();
  Errors.forEach(E=>console.log("ERR:",E.slice(0,220)));console.log(`ok=${R.ok} completed=${Completed} cycleErrors=${Errors.filter(E => /is not a function/.test(E)).length}`);
  process.exit(0);
})();
