
// gh-301 phase 2 smoke: the real WebAPI + a real RemindersModule (test MockSlackApp) in an empty throwaway
// SLEUTH_DATA_DIR, driven over HTTP as a bot principal. Usage: node gh301-phase2-smoke.cjs <repo> <empty temp dir>
'use strict';
global.jest = { fn: (ArgImpl = () => undefined) => { const Fn = (...ArgArgs) => { Fn.mock.calls.push(ArgArgs); return ArgImpl(...ArgArgs); }; Fn.mock = { calls: [] }; Fn.mockResolvedValue = ArgValue => { ArgImpl = async () => ArgValue; return Fn; }; Fn.mockImplementation = ArgNew => { ArgImpl = ArgNew; return Fn; }; return Fn; } };
const Repo = process.argv[2]; const DataDir = process.argv[3];
if(!DataDir || !require('fs').existsSync(DataDir) || require('fs').readdirSync(DataDir).length > 0) {
  console.error('usage: node gh301-phase2-smoke.cjs <repo> <empty temporary data dir>');
  process.exit(2);
}
process.env.SLEUTH_DATA_DIR = DataDir;
process.env.WEB_API_BOT_PRINCIPALS = '1';
const fs = require('fs'); const path = require('path');
const WebAPI = require(path.join(Repo, 'src/web-api'));
const workspaces = require(path.join(Repo, 'src/workspaces'));
const AdminAuth = require(path.join(Repo, 'src/admin-auth'));
const RemindersModule = require(path.join(Repo, 'src/reminders-module'));
const Principals = require(path.join(Repo, 'src/web-api-principals'));
const { MockSlackApp } = require(path.join(Repo, 'tests/mocks/mock-slack-app'));
workspaces.AssertNotLiveRuntimeDir('gh301-phase2-smoke');
const WS = 'SmokeBotWs'; const Port = 19880; const Channel = 'smoke-channel-on';
const Token = Principals.MakeToken('smoke-bot');
const Stats = { IncomingMessageCount: 0, IncomingMessageLength: 0, OutgoingMessageCount: 0, OutgoingMessageLength: 0 };

async function CallAsync(ArgLabel, ArgMethod, ArgUrl, ArgKey, ArgBody) {
  const Headers = { Authorization: `Bearer ${Token}`, 'Content-Type': 'application/json', ...(ArgKey ? { 'Idempotency-Key': ArgKey } : {}) };
  const Response = await fetch(`http://127.0.0.1:${Port}${ArgUrl}`, { method: ArgMethod, headers: Headers, body: ArgBody ? JSON.stringify(ArgBody) : undefined });
  const Json = await Response.json();
  console.log(`\n$ ${ArgLabel}\n  ${ArgMethod} ${ArgUrl}${ArgKey ? `  Idempotency-Key: ${ArgKey}` : ''}\n  → ${JSON.stringify(Json).slice(0, 260)}`);
  return Json;
}

async function StartAsync() {
  const SlackApp = new MockSlackApp({ WorkspaceInfo: { ...new MockSlackApp().WorkspaceInfo, WORKSPACE_NAME: WS } });
  const Reminders = new RemindersModule(SlackApp);
  await Reminders.StartAsync(Stats);
  const Api = new WebAPI(Port, 'operator-token', new Map(), { GetLastManualFilePath: () => null, SetLastManualFilePathAsync: async () => {} },
    new AdminAuth(), { SendPasswordResetEmailAsync: async () => {} }, new Map([[WS, { RemindersModule: Reminders }]]));
  await Api.StartAsync();
  return { Reminders, Api, SlackApp };
}

(async () => {
  fs.mkdirSync(workspaces.GetDirPath(), { recursive: true });
  fs.writeFileSync(workspaces.MakeWorkspaceFilePath(WS), '{}');
  fs.mkdirSync(workspaces.GetSubdirPath('reminders'), { recursive: true });
  fs.writeFileSync(path.join(workspaces.GetSubdirPath('reminders'), `${WS}_enabled_channels.json`), JSON.stringify([Channel]));
  fs.writeFileSync(Principals.PrincipalsFilePath(), JSON.stringify([{ id: 'smoke-bot', sha256: Principals.HashToken(Token), workspaces: [WS], scopes: ['reminders:read', 'reminders:write'] }]), { mode: 0o600 });
  const Bulk = `/workspace/${WS}/reminders/bulk`;
  const CreateBody = { actions: [{ action: 'create', title: 'Draft the smoke launch email', dueDate: '2030-01-03T16:00:00Z', channelId: Channel, assigneeIds: ['U0SMOKE1'] }] };
  let Live = await StartAsync();
  let Posts = 0;
  try {
    console.log(`data dir: <tmp>/${path.basename(DataDir)} (throwaway)`);
    const Created = await CallAsync('MAIN: create', 'POST', Bulk, 'smoke-create-1', CreateBody);
    const Id = Created.data.results[0].reminderId;
    const V1 = Created.data.results[0].version;
    const Retitled = await CallAsync('MAIN: retitle with ifMatch', 'POST', Bulk, 'smoke-edit-1', { actions: [{ action: 'retitle', reminderId: Id, ifMatch: V1, title: 'Draft the smoke launch post' }] });
    const V2 = Retitled.data.results[0].version;
    await CallAsync('ADJACENT: stale ifMatch (the version before the retitle)', 'POST', Bulk, 'smoke-edit-2', { actions: [{ action: 'reschedule', reminderId: Id, ifMatch: V1, dueDate: '2030-02-01T16:00:00Z' }] });
    const Moved = await CallAsync('MAIN: reschedule with the current version', 'POST', Bulk, 'smoke-edit-3', { actions: [{ action: 'reschedule', reminderId: Id, ifMatch: V2, dueDate: '2030-02-01T16:00:00Z' }] });
    const V3 = Moved.data.results[0].version;
    Posts += Live.SlackApp.SentMessages.length;
    await Live.Api.StopAsync(); await Live.Reminders.StopAsync();
    Live = await StartAsync();
    console.log('\n(module and API rebuilt from disk: the in-memory idempotency store is empty)');
    await CallAsync('ADJACENT: replay the create after the rebuild', 'POST', Bulk, 'smoke-create-1', CreateBody);
    await CallAsync('ADJACENT: same create key, different body', 'POST', Bulk, 'smoke-create-1', { actions: [{ ...CreateBody.actions[0], title: 'Draft something else entirely' }] });
    await CallAsync('ADJACENT: create in a channel without auto-scheduling', 'POST', Bulk, 'smoke-create-2', { actions: [{ ...CreateBody.actions[0], channelId: 'smoke-channel-off' }] });
    await CallAsync('MAIN: complete with the current version', 'POST', Bulk, 'smoke-close-1', { actions: [{ action: 'complete', reminderId: Id, ifMatch: V3 }] });
    console.log(`\npending reminders left: ${Live.Reminders.GetAllReminders().length}`);
    Posts += Live.SlackApp.SentMessages.length;
    console.log(`Slack posts during smoke: ${Posts}`);
  } finally { await Live.Api.StopAsync(); await Live.Reminders.StopAsync(); }
  process.exit(0);
})().catch(ArgError => { console.error(ArgError); process.exit(1); });

