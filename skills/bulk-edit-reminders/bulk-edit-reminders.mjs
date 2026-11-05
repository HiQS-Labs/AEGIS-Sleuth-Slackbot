#!/usr/bin/env node
// Edit live Sleuth reminders through the app's own Web API (GH-279 close, GH-290 edits).
//
// Order is fixed: back up the workspace's raw reminder records → resolve every requested ID against
// that same backup → (stop here on --dry-run) → POST /workspace/:name/reminders/bulk. Any failure
// before the POST aborts with nothing written to the server. `backup` runs only the first step.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const USAGE = `usage: bulk-edit-reminders.mjs [backup] [--complete id,...] [--cancel id,...]
       [--retitle id="Title"] [--force-title] [--reschedule id=ISO-date] [--reassign id=U1,U2]
       [--create '{"title":…,"dueDate":…,"channelId":…,"assigneeIds":[…]}'] [--reason "text"]
       [--workspace name] [--env prod|dev] [--env-file path] [--backup-dir dir] [--tunnel] [--dry-run]

IDs may be full ReminderIDs or unique prefixes of at least 8 characters.
--retitle, --reschedule, --reassign and --create are repeatable; edits run in the order given.`;

// `id=value` → [id, value]; the value may itself contain '='.
function SplitPair(ArgFlag, ArgText) {
  const At = ArgText.indexOf('=');
  if(At <= 0 || At === ArgText.length - 1) throw new Error(`${ArgFlag} expects id=value (got '${ArgText}')`);
  return [ArgText.slice(0, At).trim(), ArgText.slice(At + 1).trim()];
}

function ParseArgs(ArgV) {
  const Options = { complete: [], cancel: [], edits: [], env: 'prod', dryRun: false, backupOnly: false, forceTitle: false, tunnel: false };
  if(ArgV[0] === 'backup') { Options.backupOnly = true; ArgV = ArgV.slice(1); }
  for(let Index = 0; Index < ArgV.length; Index++) {
    const Flag = ArgV[Index];
    const Next = () => {
      const Value = ArgV[++Index];
      if(Value === undefined) throw new Error(`${Flag} needs a value`);
      return Value;
    };
    const List = () => Next().split(',').map(Item => Item.trim()).filter(Boolean);
    switch(Flag) {
      case '--complete': Options.complete.push(...List()); break;
      case '--cancel': Options.cancel.push(...List()); break;
      case '--retitle': { const [id, title] = SplitPair(Flag, Next()); Options.edits.push({ id, action: 'retitle', fields: { title } }); break; }
      case '--reschedule': { const [id, dueDate] = SplitPair(Flag, Next()); Options.edits.push({ id, action: 'reschedule', fields: { dueDate } }); break; }
      case '--reassign': {
        const [id, ids] = SplitPair(Flag, Next());
        Options.edits.push({ id, action: 'reassign', fields: { assigneeIds: ids.split(',').map(Item => Item.trim()).filter(Boolean) } });
        break;
      }
      case '--create': {
        const Raw = Next();
        let Fields;
        try { Fields = JSON.parse(Raw); } catch { throw new Error(`--create expects a JSON object (got '${Raw}')`); }
        if(!Fields || typeof Fields !== 'object' || Array.isArray(Fields)) throw new Error('--create expects a JSON object');
        Options.edits.push({ id: null, action: 'create', fields: Fields });
        break;
      }
      case '--force-title': Options.forceTitle = true; break;
      case '--tunnel': Options.tunnel = true; break;
      case '--reason': Options.reason = Next(); break;
      case '--workspace': Options.workspace = Next(); break;
      case '--env': Options.env = Next(); break;
      case '--env-file': Options.envFile = Next(); break;
      case '--backup-dir': Options.backupDir = Next(); break;
      case '--dry-run': Options.dryRun = true; break;
      case '-h': case '--help': console.log(USAGE); process.exit(0);
      default: throw new Error(`unknown argument: ${Flag}`);
    }
  }
  return Options;
}

// KEY=VALUE lines only; the secrets file is parsed, never executed.
function ReadEnvFile(ArgPath) {
  if(!fs.existsSync(ArgPath)) return {};
  const Values = {};
  for(const Line of fs.readFileSync(ArgPath, 'utf8').split('\n')) {
    const Match = Line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if(Match) Values[Match[1]] = Match[2].trim();
  }
  return Values;
}

function ResolveConfig(ArgOptions) {
  const EnvName = { prod: 'production', production: 'production', dev: 'development', development: 'development' }[ArgOptions.env];
  if(!EnvName) throw new Error(`--env must be prod or dev (got '${ArgOptions.env}')`);
  const EnvFile = ArgOptions.envFile || path.join(os.homedir(), 'secrets', 'sleuth', `sleuth-web-api-${EnvName}.env`);
  const FileValues = ReadEnvFile(EnvFile);
  const BaseUrl = process.env.SLEUTH_WEB_API_BASE_URL || FileValues.SLEUTH_WEB_API_BASE_URL;
  const Token = process.env.SLEUTH_WEB_API_TOKEN || FileValues.SLEUTH_WEB_API_TOKEN;
  const Workspace = ArgOptions.workspace || process.env.SLEUTH_WORKSPACE_NAME || FileValues.SLEUTH_WORKSPACE_NAME;
  if(!BaseUrl || !Token) throw new Error(`no SLEUTH_WEB_API_BASE_URL/SLEUTH_WEB_API_TOKEN in the environment or ${EnvFile}`);
  if(!Workspace) throw new Error('no workspace: pass --workspace or set SLEUTH_WORKSPACE_NAME');
  const BackupDir = ArgOptions.backupDir || path.join(os.homedir(), 'secrets', 'sleuth', 'backups');
  return { BaseUrl: BaseUrl.replace(/\/+$/, ''), Token, Workspace, BackupDir, EnvName };
}

// true when something already accepts connections on the port.
function PortOpenAsync(ArgPort) {
  return new Promise(Resolve => {
    const Socket = net.connect({ host: '127.0.0.1', port: ArgPort });
    Socket.once('connect', () => { Socket.destroy(); Resolve(true); });
    Socket.once('error', () => Resolve(false));
  });
}

// Open `ssh -L <port>:127.0.0.1:2020` to the host for --env, and return the child to kill on exit.
// Production: host/user/password from vultr-sleuth-production.env (parsed, never sourced; the
// password goes to sshpass through $SSHPASS, so it never shows in `ps`). Development: the
// `sleuth-oracle-dev` ssh alias with key auth.
async function OpenTunnelAsync(ArgConfig) {
  const Url = new URL(ArgConfig.BaseUrl);
  if(!['127.0.0.1', 'localhost'].includes(Url.hostname) || !Url.port)
    throw new Error(`--tunnel needs SLEUTH_WEB_API_BASE_URL on 127.0.0.1/localhost with a port (got ${Url.host}); this env already reaches the API directly`);
  const Port = Number(Url.port);
  if(await PortOpenAsync(Port))
    throw new Error(`--tunnel: port ${Port} is already in use; close that tunnel/process or run without --tunnel`);

  const SshArgs = ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-L', `${Port}:127.0.0.1:2020`];
  let Command = 'ssh';
  let Args;
  const Env = { ...process.env };
  if(ArgConfig.EnvName === 'production') {
    const Prod = ReadEnvFile(path.join(os.homedir(), 'secrets', 'sleuth', 'vultr-sleuth-production.env'));
    if(!Prod.SLEUTH_PROD_HOST) throw new Error('--tunnel: no SLEUTH_PROD_HOST in ~/secrets/sleuth/vultr-sleuth-production.env');
    const Target = `${Prod.SLEUTH_PROD_USER || 'root'}@${Prod.SLEUTH_PROD_HOST}`;
    if(Prod.SLEUTH_PROD_PASS) {
      Command = 'sshpass';
      Env.SSHPASS = Prod.SLEUTH_PROD_PASS;
      Args = ['-e', 'ssh', '-o', 'StrictHostKeyChecking=accept-new', ...SshArgs, Target];
    } else {
      Args = ['-o', 'BatchMode=yes', ...SshArgs, Target];
    }
  } else {
    Args = ['-o', 'BatchMode=yes', ...SshArgs, 'sleuth-oracle-dev'];
  }

  const Child = spawn(Command, Args, { env: Env, stdio: ['ignore', 'ignore', 'inherit'] });
  let Exited = false;
  Child.once('exit', () => { Exited = true; });
  Child.once('error', () => { Exited = true; });
  for(let Waited = 0; Waited < 10000; Waited += 250) {
    if(Exited) throw new Error(`--tunnel: ${Command} exited before the tunnel came up`);
    if(await PortOpenAsync(Port)) {
      console.log(`tunnel: 127.0.0.1:${Port} → ${ArgConfig.EnvName} :2020`);
      return Child;
    }
    await new Promise(Resolve => setTimeout(Resolve, 250));
  }
  Child.kill();
  throw new Error(`--tunnel: port ${Port} did not open within 10 s`);
}

async function CallApiAsync(ArgConfig, ArgPath, ArgBody) {
  const Response = await fetch(`${ArgConfig.BaseUrl}${ArgPath}`, {
    method: ArgBody ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${ArgConfig.Token}`, ...(ArgBody ? { 'Content-Type': 'application/json' } : {}) },
    body: ArgBody ? JSON.stringify(ArgBody) : undefined,
  });
  const Payload = await Response.json();
  if(Payload?.success !== true) throw new Error(`${ArgPath}: ${typeof Payload?.data === 'string' ? Payload.data : 'request failed'}`);
  return Payload.data;
}

function ResolveIds(ArgRequested, ArgRecords) {
  const Problems = [];
  const Resolved = ArgRequested.map(({ id, action, fields }) => {
    if(action === 'create') return { action, fields, record: null };
    const Matches = ArgRecords.filter(Record => Record.ReminderID === id || (id.length >= 8 && Record.ReminderID?.startsWith(id)));
    if(Matches.length !== 1) Problems.push(`${id}: ${Matches.length === 0 ? 'no match' : `${Matches.length} matches`}`);
    return { action, fields, record: Matches[0] };
  });
  // one id may get several different edits (ordered as given), but not the same action twice.
  const Seen = new Set();
  for(const { action, record } of Resolved) {
    if(!record) continue;
    const Key = `${action} ${record.ReminderID}`;
    if(Seen.has(Key)) Problems.push(`${record.ReminderID}: ${action} requested more than once`);
    Seen.add(Key);
  }
  if(Problems.length) throw new Error(`could not resolve every ID; nothing was changed:\n  ${Problems.join('\n  ')}`);
  return Resolved;
}

const SuccessStatuses = new Set(['completed', 'canceled', 'updated', 'unchanged', 'created']);

async function MainAsync() {
  const Options = ParseArgs(process.argv.slice(2));
  const Requested = [
    ...Options.complete.map(id => ({ id, action: 'complete' })),
    ...Options.cancel.map(id => ({ id, action: 'cancel' })),
    ...Options.edits,
  ];
  if(Requested.length === 0 && !Options.backupOnly) throw new Error(`nothing to do.\n${USAGE}`);
  if(Requested.length > 0 && Options.backupOnly) throw new Error('backup takes no edit flags');
  const Config = ResolveConfig(Options);
  if(Options.tunnel) {
    const Tunnel = await OpenTunnelAsync(Config);
    const Close = () => { if(Tunnel.exitCode === null) Tunnel.kill(); };
    process.once('exit', Close);
    for(const Signal of ['SIGINT', 'SIGTERM']) process.once(Signal, () => { Close(); process.exit(130); });
  }

  // 1. backup — the raw pending records exactly as the server persists them (not completion
  // history; that is in the server's nightly ZIP). An empty workspace is a valid, empty backup.
  const Records = await CallApiAsync(Config, `/workspace/${encodeURIComponent(Config.Workspace)}/reminders`);
  if(!Array.isArray(Records))
    throw new Error('backup read did not return a reminder list; refusing to continue');
  fs.mkdirSync(Config.BackupDir, { recursive: true, mode: 0o700 });
  // millisecond stamp + exclusive create: a later run can never overwrite an earlier backup.
  const Stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const BackupPath = path.join(Config.BackupDir, `${Config.Workspace}_reminders_${Stamp}.json`);
  fs.writeFileSync(BackupPath, JSON.stringify(Records, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`backup: ${Records.length} records → ${BackupPath}`);
  if(Options.backupOnly) return 0;

  // 2. resolve against the backup and show what will change.
  const Resolved = ResolveIds(Requested, Records);
  for(const { action, fields, record } of Resolved) {
    const Change = fields ? `  → ${JSON.stringify(fields)}` : '';
    if(!record) { console.log(`  ${action.padEnd(10)} (new)${Change}`); continue; }
    const Text = String(record.ReminderMessageText || '').replace(/\s+/g, ' ').slice(0, 100);
    console.log(`  ${action.padEnd(10)} ${record.ReminderID.slice(0, 8)}  ${record.State || '?'}  ${String(record.CreatedOn || '').slice(0, 10)}  ${Text}${Change}`);
  }
  if(Options.dryRun) {
    console.log(`dry run: ${Resolved.length} reminder(s) would change; nothing was sent.`);
    return 0;
  }

  // 3. apply.
  const Actions = Resolved.map(({ action, fields, record }) => ({
    ...(record ? { reminderId: record.ReminderID } : {}), action, ...fields,
    ...(action === 'retitle' && Options.forceTitle ? { force: true } : {}),
    ...(Options.reason ? { reason: Options.reason } : {}),
  }));
  const Result = await CallApiAsync(Config, `/workspace/${encodeURIComponent(Config.Workspace)}/reminders/bulk`, { actions: Actions });
  for(const Item of Result.results)
    console.log(`  ${Item.status.padEnd(9)} ${Item.action.padEnd(10)} ${Item.reminderId || '(new)'}${Item.error ? `  (${Item.error})` : ''}`);
  console.log(`result: ${JSON.stringify(Result.counts)}`);
  return Result.results.every(Item => SuccessStatuses.has(Item.status)) ? 0 : 1;
}

MainAsync().then(Code => process.exit(Code), Error => {
  console.error(`ERROR: ${Error.message}`);
  process.exit(1);
});
