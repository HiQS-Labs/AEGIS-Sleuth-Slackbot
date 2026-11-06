// GH-301 smoke: the real WebAPI + a real RemindersModule (test MockSlackApp, throwaway SLEUTH_DATA_DIR),
// driven over HTTP the way a bot would, with WEB_API_BOT_PRINCIPALS=1. Usage: node gh301-smoke.cjs <repo> <datadir>
'use strict';
global.jest = { fn: (Impl = () => undefined) => { const F = (...A) => { F.mock.calls.push(A); return Impl(...A); }; F.mock = { calls: [] }; F.mockResolvedValue = V => { Impl = async () => V; return F; }; F.mockImplementation = I => { Impl = I; return F; }; return F; } };
const Repo = process.argv[2]; const DataDir = process.argv[3];
process.env.SLEUTH_DATA_DIR = DataDir;
process.env.WEB_API_BOT_PRINCIPALS = '1';
const fs = require('fs'); const path = require('path');
const WebAPI = require(path.join(Repo, 'src/web-api'));
const workspaces = require(path.join(Repo, 'src/workspaces'));
const AdminAuth = require(path.join(Repo, 'src/admin-auth'));
const RemindersModule = require(path.join(Repo, 'src/reminders-module'));
const Principals = require(path.join(Repo, 'src/web-api-principals'));
const { MockSlackApp } = require(path.join(Repo, 'tests/mocks/mock-slack-app'));
const WS = 'SmokeBotWs'; const OTHER = 'SmokeOtherWs'; const Port = 19879;
const Id = 'aaaaaaaa-1111-4111-8111-000000000301';
const Token = Principals.MakeToken('smoke-bot');
const Base = `http://127.0.0.1:${Port}`;

async function Call(Label, Method, Url, Key, Body, TokenValue = Token) {
  const Headers = { Authorization: `Bearer ${TokenValue}`, 'Content-Type': 'application/json', ...(Key ? { 'Idempotency-Key': Key } : {}) };
  const Response = await fetch(Base + Url, { method: Method, headers: Headers, body: Body ? JSON.stringify(Body) : undefined });
  const Json = await Response.json();
  console.log(`\n$ ${Label}\n  ${Method} ${Url}${Key ? `  Idempotency-Key: ${Key}` : ''}\n  → ${JSON.stringify(Json).slice(0, 220)}`);
  return Json;
}
const Stored = () => JSON.parse(fs.readFileSync(path.join(workspaces.GetSubdirPath('reminders'), `${WS}_reminders.json`), 'utf8'));
const WritePrincipals = Entries => fs.writeFileSync(Principals.PrincipalsFilePath(), JSON.stringify(Entries), { mode: 0o600 });

(async () => {
  fs.mkdirSync(workspaces.GetDirPath(), { recursive: true });
  for(const W of [WS, OTHER]) fs.writeFileSync(workspaces.MakeWorkspaceFilePath(W), '{}');
  fs.mkdirSync(workspaces.GetSubdirPath('reminders'), { recursive: true });
  fs.writeFileSync(path.join(workspaces.GetSubdirPath('reminders'), `${WS}_reminders.json`), JSON.stringify([{
    ReminderID: Id, CreatedOn: '2026-11-01T12:00:00.000Z', ShouldPostOn: '2030-01-02T17:00:00.000Z', TargetChannelID: 'C_REMINDERS',
    OriginalChannelID: 'C_REMINDERS', OriginalMessageID: '1790000000.000100', OriginalSenderID: 'U_SENDER',
    ReminderMessageText: 'Review the smoke report', IgnoreSnooze: false, OriginalChannelName: 'reminders',
    AssigneeID: 'U_OWNER', AssigneeIDs: ['U_OWNER'], GitHubUrls: null, State: 'scheduled' }]));
  const Entry = { id: 'smoke-bot', sha256: Principals.HashToken(Token), workspaces: [WS], scopes: ['reminders:read', 'reminders:write'] };
  WritePrincipals([Entry]);

  const SlackApp = new MockSlackApp({ WorkspaceInfo: { ...new MockSlackApp().WorkspaceInfo, WORKSPACE_NAME: WS } });
  const Reminders = new RemindersModule(SlackApp);
  await Reminders.StartAsync({ IncomingMessageCount: 0, IncomingMessageLength: 0, OutgoingMessageCount: 0, OutgoingMessageLength: 0 });
  const Api = new WebAPI(Port, 'operator-token', new Map(), { GetLastManualFilePath: () => null, SetLastManualFilePathAsync: async () => {} },
    new AdminAuth(), { SendPasswordResetEmailAsync: async () => {} }, new Map([[WS, { RemindersModule: Reminders }]]));
  await Api.StartAsync();
  try {
    console.log(`data dir: <tmp>/${path.basename(DataDir)} (throwaway); principals file mode ${(fs.statSync(Principals.PrincipalsFilePath()).mode & 0o777).toString(8)}`);
    await Call('MAIN: read own workspace', 'GET', `/workspace/${WS}/reminders?limit=10`);
    await Call('MAIN: complete with Idempotency-Key', 'POST', `/workspace/${WS}/reminders/bulk`, 'smoke-1', { actions: [{ action: 'complete', reminderId: Id }] });
    console.log(`  stored pending after complete: ${Stored().length}`);
    await Call('ADJACENT: replay the same request (no second write)', 'POST', `/workspace/${WS}/reminders/bulk`, 'smoke-1', { actions: [{ action: 'complete', reminderId: Id }] });
    await Call('ADJACENT: same key, different body', 'POST', `/workspace/${WS}/reminders/bulk`, 'smoke-1', { actions: [{ action: 'cancel', reminderId: Id }] });
    await Call('ADJACENT: second workspace', 'GET', `/workspace/${OTHER}/reminders`);
    await Call('ADJACENT: operator-only route', 'GET', '/workspaces');
    WritePrincipals([{ ...Entry, revoked: true }]);
    await Call('ADJACENT: after revoking in the file (no restart)', 'GET', `/workspace/${WS}/reminders`);
    console.log(`\nSlack posts during smoke: ${SlackApp.SentMessages.length}`);
  } finally { await Api.StopAsync(); await Reminders.StopAsync(); }
  process.exit(0);
})().catch(E => { console.error(E); process.exit(1); });
