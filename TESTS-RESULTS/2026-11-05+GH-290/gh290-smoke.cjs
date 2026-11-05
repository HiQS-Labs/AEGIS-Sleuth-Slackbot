// GH-290 smoke: real WebAPI + real RemindersModule (mock Slack, throwaway SLEUTH_DATA_DIR), driven by the
// real skill script over HTTP. Usage: node gh290-smoke.cjs <repo> <datadir>
'use strict';
global.jest = { fn: (Impl = () => undefined) => { const F = (...A) => { F.mock.calls.push(A); return Impl(...A); }; F.mock = { calls: [] }; F.mockResolvedValue = V => { Impl = async () => V; return F; }; F.mockImplementation = I => { Impl = I; return F; }; return F; } };
const Repo = process.argv[2]; const DataDir = process.argv[3];
process.env.SLEUTH_DATA_DIR = DataDir;
const fs = require('fs'); const path = require('path'); const { execFile } = require('child_process');
const WebAPI = require(path.join(Repo, 'src/web-api'));
const workspaces = require(path.join(Repo, 'src/workspaces'));
const AdminAuth = require(path.join(Repo, 'src/admin-auth'));
const RemindersModule = require(path.join(Repo, 'src/reminders-module'));
const { MockSlackApp } = require(path.join(Repo, 'tests/mocks/mock-slack-app'));
const WS = 'SmokeWorkspace'; const Port = 19877; const Token = 'smoke-token';
const Script = path.join(Repo, 'skills/bulk-edit-reminders/bulk-edit-reminders.mjs');
const EnvFile = path.join(DataDir, 'smoke.env'); const BackupDir = path.join(DataDir, 'backups');

function Run(Label, Args, EnvPath = EnvFile) {
  return new Promise(Resolve => execFile('node', [Script, ...Args, '--env-file', EnvPath, '--backup-dir', BackupDir],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME } }, (Err, Out, ErrOut) => {
      console.log(`\n$ ${Label}\n  args: ${Args.join(' ')}\n  exit: ${Err ? Err.code : 0}`);
      console.log((Out + ErrOut).trim().split('\n').map(L => '  | ' + L.replace(DataDir, '<data>')).join('\n'));
      Resolve(Out + ErrOut);
    }));
}
const Stored = () => JSON.parse(fs.readFileSync(path.join(workspaces.GetSubdirPath('reminders'), `${WS}_reminders.json`), 'utf8'));

(async () => {
  fs.mkdirSync(workspaces.GetDirPath(), { recursive: true });
  fs.writeFileSync(workspaces.MakeWorkspaceFilePath(WS), '{}');
  fs.mkdirSync(workspaces.GetSubdirPath('reminders'), { recursive: true });
  const Overdue = { ReminderID: 'aaaaaaaa-1111-4111-8111-000000000001', CreatedOn: '2026-10-01T12:00:00.000Z',
    ShouldPostOn: new Date(Date.now() - 3600e3).toISOString(), TargetChannelID: 'C_REMINDERS', OriginalChannelID: 'C_REMINDERS',
    OriginalMessageID: '1790000000.000100', OriginalSenderID: 'U_SENDER', ReminderMessageText: 'Review the smoke report',
    IgnoreSnooze: false, OriginalChannelName: 'reminders', AssigneeID: 'U_OWNER', AssigneeIDs: ['U_OWNER'], GitHubUrls: null, State: 'overdue' };
  fs.writeFileSync(path.join(workspaces.GetSubdirPath('reminders'), `${WS}_reminders.json`), JSON.stringify([Overdue]));
  fs.writeFileSync(EnvFile, `SLEUTH_WEB_API_BASE_URL=http://127.0.0.1:${Port}\nSLEUTH_WEB_API_TOKEN=${Token}\nSLEUTH_WORKSPACE_NAME=${WS}\n`);
  const DirectEnv = path.join(DataDir, 'direct.env');
  fs.writeFileSync(DirectEnv, `SLEUTH_WEB_API_BASE_URL=http://198.51.100.7:2020\nSLEUTH_WEB_API_TOKEN=x\nSLEUTH_WORKSPACE_NAME=${WS}\n`);

  const SlackApp = new MockSlackApp({ WorkspaceInfo: { ...new MockSlackApp().WorkspaceInfo, WORKSPACE_NAME: WS } });
  const Reminders = new RemindersModule(SlackApp);
  await Reminders.StartAsync({ IncomingMessageCount: 0, IncomingMessageLength: 0, OutgoingMessageCount: 0, OutgoingMessageLength: 0 });
  const Api = new WebAPI(Port, Token, new Map(), { GetLastManualFilePath: () => null, SetLastManualFilePathAsync: async () => {} },
    new AdminAuth(), { SendPasswordResetEmailAsync: async () => {} }, new Map([[WS, { RemindersModule: Reminders }]]));
  await Api.StartAsync();
  try {
    await Run('backup subcommand', ['backup']);
    await Run('dry-run mixed batch (no write)', ['--retitle', 'aaaaaaaa="Review the smoke report v2"', '--reschedule', 'aaaaaaaa=2030-01-02T17:00:00Z',
      '--create', '{"title":"Draft the smoke email","dueDate":"2030-01-03T16:00:00Z","channelId":"C_REMINDERS","assigneeIds":["U0SMOKE1"]}', '--dry-run']);
    console.log(`  stored after dry-run: ${Stored().length} record(s), title "${Stored()[0].ReminderMessageText}"`);
    const CreateOut = await Run('create', ['--create', '{"title":"Draft the smoke email","dueDate":"2030-01-03T16:00:00Z","channelId":"C_REMINDERS","assigneeIds":["U0SMOKE1"]}']);
    const NewId = (CreateOut.match(/created\s+create\s+(\S+)/) || [])[1];
    const Edit = ['--retitle', `${NewId}=Draft the smoke launch email`, '--reschedule', `${NewId}=2030-01-04T16:00:00Z`, '--reassign', `${NewId}=U0SMOKE2,U0SMOKE1`,
      '--reschedule', 'aaaaaaaa=2030-01-02T17:00:00Z'];
    await Run('edit batch: retitle+reschedule+reassign new one, reschedule the overdue one', Edit);
    const New = Stored().find(R => R.ReminderID === NewId); const Old = Stored().find(R => R.ReminderID === Overdue.ReminderID);
    console.log(`  stored new: title="${New.ReminderMessageText}" due=${New.ShouldPostOn} owners=${New.AssigneeIDs} state=${New.State}`);
    console.log(`  stored overdue one: due=${Old.ShouldPostOn} state=${Old.State}`);
    await Run('ADJACENT: rerun the same edit batch → unchanged', Edit);
    await Run('refused title without --force-title (whole batch refused)', ['--retitle', `${NewId}=Can you please check this?`, '--complete', 'aaaaaaaa']);
    console.log(`  stored after refusal: ${Stored().length} record(s) (overdue one still pending: ${Stored().some(R => R.ReminderID === Overdue.ReminderID)})`);
    await Run('--tunnel refuses an occupied port (the smoke server holds it)', ['backup', '--tunnel']);
    await Run('--tunnel refuses a non-loopback URL', ['backup', '--tunnel'], DirectEnv);
    await Run('complete the created reminder', ['--complete', NewId]);
    console.log(`  posts sent to Slack during smoke: ${SlackApp.SentMessages.length}`);
  } finally { await Api.StopAsync(); await Reminders.StopAsync(); }
  process.exit(0);
})().catch(E => { console.error(E); process.exit(1); });
