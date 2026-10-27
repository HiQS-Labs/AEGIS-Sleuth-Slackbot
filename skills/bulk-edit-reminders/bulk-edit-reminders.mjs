#!/usr/bin/env node
// Bulk-close live Sleuth reminders through the app's own Web API (GH-279).
//
// Order is fixed: back up the workspace's raw reminder records → resolve every requested ID against
// that same backup → (stop here on --dry-run) → POST /workspace/:name/reminders/bulk. Any failure
// before the POST aborts with nothing written to the server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USAGE = `usage: bulk-edit-reminders.mjs [--complete id,...] [--cancel id,...] [--reason "text"]
       [--workspace name] [--env prod|dev] [--env-file path] [--backup-dir dir] [--dry-run]

IDs may be full ReminderIDs or unique prefixes of at least 8 characters.`;

function ParseArgs(ArgV) {
  const Options = { complete: [], cancel: [], env: 'prod', dryRun: false };
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
  return { BaseUrl: BaseUrl.replace(/\/+$/, ''), Token, Workspace, BackupDir };
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
  const Resolved = ArgRequested.map(({ id, action }) => {
    const Matches = ArgRecords.filter(Record => Record.ReminderID === id || (id.length >= 8 && Record.ReminderID?.startsWith(id)));
    if(Matches.length !== 1) Problems.push(`${id}: ${Matches.length === 0 ? 'no match' : `${Matches.length} matches`}`);
    return { action, record: Matches[0] };
  });
  const Seen = new Set();
  for(const { record } of Resolved) {
    if(!record) continue;
    if(Seen.has(record.ReminderID)) Problems.push(`${record.ReminderID}: requested more than once`);
    Seen.add(record.ReminderID);
  }
  if(Problems.length) throw new Error(`could not resolve every ID; nothing was changed:\n  ${Problems.join('\n  ')}`);
  return Resolved;
}

async function MainAsync() {
  const Options = ParseArgs(process.argv.slice(2));
  const Requested = [
    ...Options.complete.map(id => ({ id, action: 'complete' })),
    ...Options.cancel.map(id => ({ id, action: 'cancel' })),
  ];
  if(Requested.length === 0) throw new Error(`nothing to do.\n${USAGE}`);
  const Config = ResolveConfig(Options);

  // 1. backup — the raw records exactly as the server persists them.
  const Records = await CallApiAsync(Config, `/workspace/${encodeURIComponent(Config.Workspace)}/reminders`);
  if(!Array.isArray(Records) || Records.length === 0)
    throw new Error('backup read returned no reminders; refusing to continue');
  fs.mkdirSync(Config.BackupDir, { recursive: true, mode: 0o700 });
  const Stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const BackupPath = path.join(Config.BackupDir, `${Config.Workspace}_reminders_${Stamp}.json`);
  fs.writeFileSync(BackupPath, JSON.stringify(Records, null, 2), { mode: 0o600 });
  console.log(`backup: ${Records.length} records → ${BackupPath}`);

  // 2. resolve against the backup and show what will change.
  const Resolved = ResolveIds(Requested, Records);
  for(const { action, record } of Resolved) {
    const Text = String(record.ReminderMessageText || '').replace(/\s+/g, ' ').slice(0, 100);
    console.log(`  ${action.padEnd(8)} ${record.ReminderID.slice(0, 8)}  ${record.State || '?'}  ${String(record.CreatedOn || '').slice(0, 10)}  ${Text}`);
  }
  if(Options.dryRun) {
    console.log(`dry run: ${Resolved.length} reminder(s) would change; nothing was sent.`);
    return 0;
  }

  // 3. apply.
  const Actions = Resolved.map(({ action, record }) => ({
    reminderId: record.ReminderID, action, ...(Options.reason ? { reason: Options.reason } : {}),
  }));
  const Result = await CallApiAsync(Config, `/workspace/${encodeURIComponent(Config.Workspace)}/reminders/bulk`, { actions: Actions });
  for(const Item of Result.results)
    console.log(`  ${Item.status.padEnd(9)} ${Item.reminderId}${Item.error ? `  (${Item.error})` : ''}`);
  console.log(`result: ${JSON.stringify(Result.counts)}`);
  return Result.results.every(Item => Item.status === 'completed' || Item.status === 'canceled') ? 0 : 1;
}

MainAsync().then(Code => process.exit(Code), Error => {
  console.error(`ERROR: ${Error.message}`);
  process.exit(1);
});
