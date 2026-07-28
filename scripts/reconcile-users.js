#!/usr/bin/env node
'use strict';

/**
 * Reconcile Slack user IDs ↔ names.
 *
 * Usage:
 *   node scripts/reconcile-users.js [options]
 *
 * Options:
 *   --token <xoxb-...>     Bot token. Otherwise read from SLACK_BOT_TOKEN env var.
 *   --workspace <name>     Use LIVE_TOKEN from data/runtime/workspaces/<name>_workspace.json.
 *   --out <path>           Write JSON to this path instead of stdout.
 *   --include-bots         Include bot users (default).
 *   --exclude-bots         Exclude bot users.
 *   --include-deleted      Include deleted users (default).
 *   --exclude-deleted      Exclude deleted users.
 *   --help
 *
 * Token resolution priority: --token > SLACK_BOT_TOKEN > --workspace.
 *
 * On the production Vultr server, source the secrets file first, e.g.:
 *   source ~/bin/secrets.nd && node scripts/reconcile-users.js --out /tmp/users.json
 *
 * Required Slack scopes: users:read (and users:read.email if you want emails).
 */

const fs = require('fs').promises;
const { WebClient } = require('@slack/web-api');

const Workspaces = require('../src/workspaces');

const PageLimit = 1000;

async function MainAsync() {
  const Args = ParseArgs(process.argv.slice(2));
  if(Args.HelpRequested) {
    PrintUsage();
    return;
  }

  const Token = await ResolveTokenAsync(Args);
  if(!Token) {
    process.stderr.write('error: no Slack token. pass --token, set SLACK_BOT_TOKEN, or pass --workspace.\n');
    process.exit(1);
  }

  const Client = new WebClient(Token);

  const Users = [];
  let Cursor;
  do {
    const Response = await Client.users.list({ limit: PageLimit, cursor: Cursor });
    for(const U of Response.members || []) {
      if(!Args.IncludeBots && U.is_bot) continue;
      if(!Args.IncludeDeleted && U.deleted) continue;
      Users.push({
        id: U.id,
        name: U.name,
        real_name: U.real_name || U.profile?.real_name || null,
        display_name: U.profile?.display_name || null,
        email: U.profile?.email || null,
        is_bot: !!U.is_bot,
        is_deleted: !!U.deleted,
        is_admin: !!U.is_admin,
      });
    }
    Cursor = Response.response_metadata?.next_cursor || undefined;
  } while(Cursor);

  Users.sort((A, B) => (A.name || '').localeCompare(B.name || ''));

  const Output = JSON.stringify(Users, null, 2);
  if(Args.OutPath) {
    await fs.writeFile(Args.OutPath, Output + '\n', 'utf8');
    process.stderr.write(`wrote ${Users.length} users to ${Args.OutPath}\n`);
  } else {
    process.stdout.write(Output + '\n');
  }
}

function ParseArgs(ArgArgv) {
  const Result = {
    Token: null,
    Workspace: null,
    OutPath: null,
    IncludeBots: true,
    IncludeDeleted: true,
    HelpRequested: false,
  };
  for(let i = 0; i < ArgArgv.length; i++) {
    const A = ArgArgv[i];
    if(A === '--help' || A === '-h') { Result.HelpRequested = true; continue; }
    if(A === '--token') { Result.Token = ArgArgv[++i]; continue; }
    if(A === '--workspace') { Result.Workspace = ArgArgv[++i]; continue; }
    if(A === '--out') { Result.OutPath = ArgArgv[++i]; continue; }
    if(A === '--include-bots') { Result.IncludeBots = true; continue; }
    if(A === '--exclude-bots') { Result.IncludeBots = false; continue; }
    if(A === '--include-deleted') { Result.IncludeDeleted = true; continue; }
    if(A === '--exclude-deleted') { Result.IncludeDeleted = false; continue; }
    throw new Error(`unknown argument: ${A}`);
  }
  return Result;
}

async function ResolveTokenAsync(ArgArgs) {
  if(ArgArgs.Token) return ArgArgs.Token;
  if(process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;
  if(ArgArgs.Workspace) {
    const Info = await Workspaces.LoadWorkspaceInfoByNameAsync(ArgArgs.Workspace);
    return Info.LIVE_TOKEN || null;
  }
  return null;
}

function PrintUsage() {
  process.stdout.write([
    'Reconcile Slack user IDs ↔ names.',
    '',
    'Usage: node scripts/reconcile-users.js [options]',
    '',
    'Options:',
    '  --token <xoxb-...>     Bot token (else reads SLACK_BOT_TOKEN env var)',
    '  --workspace <name>     Use LIVE_TOKEN from a workspace JSON',
    '  --out <path>           Write JSON to this path (default: stdout)',
    '  --include-bots         Include bot users (default)',
    '  --exclude-bots         Exclude bot users',
    '  --include-deleted      Include deleted users (default)',
    '  --exclude-deleted      Exclude deleted users',
    '  --help',
    '',
    'Example:',
    '  source ~/bin/secrets.nd && node scripts/reconcile-users.js --exclude-bots --out /tmp/users.json',
    '',
  ].join('\n'));
}

MainAsync().catch((/** @type {any} */ ArgError) => {
  process.stderr.write(`error: ${ArgError.stack || ArgError.message || ArgError}\n`);
  process.exit(1);
});
