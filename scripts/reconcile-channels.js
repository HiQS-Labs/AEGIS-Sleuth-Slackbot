#!/usr/bin/env node
'use strict';

/**
 * Reconcile Slack channel names ↔ IDs.
 *
 * Usage:
 *   node scripts/reconcile-channels.js [options]
 *
 * Options:
 *   --token <xoxb-...>     Bot token. Otherwise read from SLACK_BOT_TOKEN env var.
 *   --workspace <name>     Use LIVE_TOKEN from data/runtime/workspaces/<name>_workspace.json.
 *   --out <path>           Write JSON to this path instead of stdout.
 *   --include-archived     Include archived channels (default: include).
 *   --exclude-archived     Exclude archived channels.
 *   --types <list>         Comma-separated channel types (default: public_channel,private_channel).
 *   --help
 *
 * Token resolution priority: --token > SLACK_BOT_TOKEN > --workspace.
 *
 * On the production Vultr server, source the secrets file first, e.g.:
 *   source ~/bin/secrets.nd && node scripts/reconcile-channels.js --out /tmp/channels.json
 *
 * Required Slack scopes: channels:read, groups:read.
 */

const fs = require('fs').promises;
const path = require('path');
const { WebClient } = require('@slack/web-api');

const Workspaces = require('../src/workspaces');

const DefaultTypes = 'public_channel,private_channel';
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

  const Channels = [];
  let Cursor;
  do {
    const Response = await Client.conversations.list({
      types: Args.Types,
      exclude_archived: !Args.IncludeArchived,
      limit: PageLimit,
      cursor: Cursor,
    });
    for(const C of Response.channels || []) {
      Channels.push({
        id: C.id,
        name: C.name,
        is_private: !!C.is_private,
        is_archived: !!C.is_archived,
        num_members: C.num_members ?? null,
      });
    }
    Cursor = Response.response_metadata?.next_cursor || undefined;
  } while(Cursor);

  Channels.sort((A, B) => (A.name || '').localeCompare(B.name || ''));

  const Output = JSON.stringify(Channels, null, 2);
  if(Args.OutPath) {
    await fs.writeFile(Args.OutPath, Output + '\n', 'utf8');
    process.stderr.write(`wrote ${Channels.length} channels to ${Args.OutPath}\n`);
  } else {
    process.stdout.write(Output + '\n');
  }
}

function ParseArgs(ArgArgv) {
  const Result = {
    Token: null,
    Workspace: null,
    OutPath: null,
    IncludeArchived: true,
    Types: DefaultTypes,
    HelpRequested: false,
  };
  for(let i = 0; i < ArgArgv.length; i++) {
    const A = ArgArgv[i];
    if(A === '--help' || A === '-h') { Result.HelpRequested = true; continue; }
    if(A === '--token') { Result.Token = ArgArgv[++i]; continue; }
    if(A === '--workspace') { Result.Workspace = ArgArgv[++i]; continue; }
    if(A === '--out') { Result.OutPath = ArgArgv[++i]; continue; }
    if(A === '--include-archived') { Result.IncludeArchived = true; continue; }
    if(A === '--exclude-archived') { Result.IncludeArchived = false; continue; }
    if(A === '--types') { Result.Types = ArgArgv[++i]; continue; }
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
    'Reconcile Slack channel names ↔ IDs.',
    '',
    'Usage: node scripts/reconcile-channels.js [options]',
    '',
    'Options:',
    '  --token <xoxb-...>     Bot token (else reads SLACK_BOT_TOKEN env var)',
    '  --workspace <name>     Use LIVE_TOKEN from a workspace JSON',
    '  --out <path>           Write JSON to this path (default: stdout)',
    '  --include-archived     Include archived channels (default)',
    '  --exclude-archived     Exclude archived channels',
    '  --types <list>         Comma-separated types (default: public_channel,private_channel)',
    '  --help',
    '',
    'Example:',
    '  source ~/bin/secrets.nd && node scripts/reconcile-channels.js --out /tmp/channels.json',
    '',
  ].join('\n'));
}

MainAsync().catch((/** @type {any} */ ArgError) => {
  process.stderr.write(`error: ${ArgError.stack || ArgError.message || ArgError}\n`);
  process.exit(1);
});
