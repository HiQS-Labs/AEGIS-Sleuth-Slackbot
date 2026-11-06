#!/usr/bin/env node
// Make a new Web API bot principal (GH-301). Prints the token ONCE (give it to the bot's secret storage)
// and the JSON entry to add to <data dir>/web-api-principals.json. Writes nothing itself: the operator
// stays the only writer of that file. See docs/web-api.md → "Bot principals (GH-301)".
//
// usage: node scripts/web-api-principal.js new <id> --workspace <name> [--workspace <name> ...]
//          --scopes read,write [--expires <ISO date>]
'use strict';
const { HashToken, MakeToken, WorkspaceNamePattern } = require('../src/web-api-principals');

const USAGE = 'usage: node scripts/web-api-principal.js new <id> --workspace <name> [--workspace <name> ...] --scopes read[,write] [--expires <ISO date>]';

function Main(ArgV) {
  if(ArgV[0] !== 'new' || !ArgV[1]) throw new Error(USAGE);
  const Id = ArgV[1];
  const Workspaces = [];
  let Scopes = null;
  let ExpiresAt;
  for(let Index = 2; Index < ArgV.length; Index++) {
    const Flag = ArgV[Index];
    const Value = ArgV[++Index];
    if(Value === undefined) throw new Error(`${Flag} needs a value\n${USAGE}`);
    if(Flag === '--workspace') Workspaces.push(Value);
    else if(Flag === '--scopes') Scopes = Value.split(',').map(ArgScope => `reminders:${ArgScope.trim()}`);
    else if(Flag === '--expires') ExpiresAt = Value;
    else throw new Error(`unknown argument: ${Flag}\n${USAGE}`);
  }
  if(Workspaces.length === 0 || !Scopes) throw new Error(USAGE);
  // the server drops an entry whose workspace names break this rule, so never print a token it would ignore.
  for(const Name of Workspaces) {
    if(!WorkspaceNamePattern.test(Name)) throw new Error(`workspace "${Name}" must match A-Z a-z 0-9 _ - (1-64 chars)`);
  }
  if(!Scopes.every(ArgScope => ArgScope === 'reminders:read' || ArgScope === 'reminders:write')) throw new Error('scopes are read and/or write');
  if(ExpiresAt !== undefined && isNaN(Date.parse(ExpiresAt))) throw new Error('--expires must be an ISO date');

  const Token = MakeToken(Id);
  const Entry = { id: Id, sha256: HashToken(Token), workspaces: Workspaces, scopes: Scopes, ...(ExpiresAt ? { expiresAt: ExpiresAt } : {}) };
  console.log('Token (shown once; store it in the bot\'s secret storage, never in a repo or chat):');
  console.log(`  ${Token}`);
  console.log('\nAdd this entry to the array in <data dir>/web-api-principals.json (mode 600):');
  console.log(JSON.stringify(Entry, null, 2));
}

try {
  Main(process.argv.slice(2));
} catch(error) {
  console.error(error.message);
  process.exit(2);
}
