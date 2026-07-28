#!/usr/bin/env node
// Self-contained smoke test for the Sleuth MCP connector.
//
// Spins up the connector over stdio against throwaway fixture data (its own temp data/runtime), then
// drives the MCP handshake and the read-only reminder tools, asserting the JSON-RPC responses. The
// live Slack tools are exercised only for their error path here (no real token/network); see
// mcp/README.md for live usage. Run with: `npm run mcp:smoke`.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let Failures = 0;
function Assert(ArgCondition, ArgLabel) {
  const Mark = ArgCondition ? 'PASS' : 'FAIL';
  if(!ArgCondition) Failures += 1;
  console.log(`  [${Mark}] ${ArgLabel}`);
}

async function WriteFixtures(ArgDir) {
  await mkdir(path.join(ArgDir, 'workspaces'), { recursive: true });
  await mkdir(path.join(ArgDir, 'reminders'), { recursive: true });
  await writeFile(path.join(ArgDir, 'workspaces', 'acme_workspace.json'), JSON.stringify({
    WORKSPACE_NAME: 'acme', ADMIN_EMAIL: 'admin@acme.test',
    LIVE_TOKEN: 'xoxb-fake', LIVE_SIGNING_SECRET: 'fake', LIVE_APP_TOKEN: 'xapp-fake',
    REMINDER_CHANNEL_NAME: 'general', MAIN_TIMEZONE: 'America/New_York', OPENAI_API_KEY: 'sk-fake',
  }, null, 2));
  await writeFile(path.join(ArgDir, 'reminders', 'acme_reminders.json'), JSON.stringify([
    { ReminderID: 'r1', CreatedOn: '2026-06-10T10:00:00.000Z', ShouldPostOn: '2026-06-20T17:00:00.000Z',
      OriginalChannelID: 'C1', TargetChannelID: 'C1', OriginalSenderID: 'U1', AssigneeID: 'U2',
      ReminderMessageText: 'Ship the quarterly report', State: 'scheduled', GitHubUrls: [] },
    { ReminderID: 'r2', CreatedOn: '2026-06-01T10:00:00.000Z', ShouldPostOn: '2026-06-05T17:00:00.000Z',
      OriginalChannelID: 'C2', TargetChannelID: 'C2', OriginalSenderID: 'U3', AssigneeID: 'U2',
      ReminderMessageText: 'Review the budget spreadsheet', State: 'overdue', GitHubUrls: [] },
  ], null, 2));
  await writeFile(path.join(ArgDir, 'reminders', 'acme_completed.json'), JSON.stringify([
    { reminderId: 'c1', summary: 'Closed the books', assigneeID: 'U2', sourceChannelID: 'C1',
      dueDate: '2026-06-08', completedMs: 1749500000000 },
  ], null, 2));
}

/** Minimal stdio JSON-RPC client for the connector. */
function MakeClient(ArgChild) {
  let Buffer = '';
  const Pending = new Map();
  let NextId = 1;
  ArgChild.stdout.on('data', (ArgChunk) => {
    Buffer += ArgChunk.toString();
    let Index;
    while((Index = Buffer.indexOf('\n')) >= 0) {
      const Line = Buffer.slice(0, Index).trim();
      Buffer = Buffer.slice(Index + 1);
      if(!Line) continue;
      const Message = JSON.parse(Line);
      if(Message.id && Pending.has(Message.id)) { Pending.get(Message.id)(Message); Pending.delete(Message.id); }
    }
  });
  return {
    Rpc(ArgMethod, ArgParams) {
      const Id = NextId++;
      return new Promise((ArgResolve) => {
        Pending.set(Id, ArgResolve);
        ArgChild.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: Id, method: ArgMethod, params: ArgParams }) + '\n');
      });
    },
    Notify(ArgMethod, ArgParams) {
      ArgChild.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: ArgMethod, params: ArgParams }) + '\n');
    },
  };
}

/** Pull the parsed JSON payload out of a tools/call result. */
function ToolJson(ArgResponse) {
  return JSON.parse(ArgResponse.result.content[0].text);
}

async function Main() {
  const DataDir = await mkdtemp(path.join(tmpdir(), 'sleuth-mcp-'));
  await WriteFixtures(DataDir);

  const Child = spawn('node', ['mcp/sleuth-mcp-server.mjs'], {
    cwd: RepoRoot,
    env: { ...process.env, SLEUTH_DATA_DIR: DataDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const Client = MakeClient(Child);

  try {
    const Init = await Client.Rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' },
    });
    Assert(Init.result?.serverInfo?.name === 'sleuth-connector', 'initialize returns serverInfo');
    Client.Notify('notifications/initialized', {});

    const Tools = await Client.Rpc('tools/list', {});
    const Names = Tools.result.tools.map(ArgTool => ArgTool.name);
    Assert(Names.includes('query_reminders') && Names.includes('slack_list_channels'), `tools/list exposes ${Names.length} tools`);

    const Workspaces = ToolJson(await Client.Rpc('tools/call', { name: 'list_workspaces', arguments: {} }));
    Assert(Workspaces.workspaces.includes('acme'), 'list_workspaces finds the acme fixture');

    const All = ToolJson(await Client.Rpc('tools/call', { name: 'query_reminders', arguments: {} }));
    Assert(All.total === 2 && All.reminders[0].state === 'overdue', 'query_reminders returns 2, soonest-due first');

    const Overdue = ToolJson(await Client.Rpc('tools/call', { name: 'query_reminders', arguments: { state: 'overdue' } }));
    Assert(Overdue.returned === 1 && Overdue.reminders[0].id === 'r2', 'query_reminders filters by state');

    const Search = ToolJson(await Client.Rpc('tools/call', { name: 'query_reminders', arguments: { assigneeId: 'U2', search: 'budget' } }));
    Assert(Search.returned === 1 && Search.reminders[0].id === 'r2', 'query_reminders filters by assignee + text');

    const One = ToolJson(await Client.Rpc('tools/call', { name: 'get_reminder', arguments: { reminderId: 'r1' } }));
    Assert(One.reminder.text === 'Ship the quarterly report', 'get_reminder fetches by id');

    const Stats = ToolJson(await Client.Rpc('tools/call', { name: 'reminder_stats', arguments: {} }));
    Assert(Stats.total === 2 && Stats.byState.overdue === 1, 'reminder_stats aggregates by state');

    const Completed = ToolJson(await Client.Rpc('tools/call', { name: 'list_completed_reminders', arguments: {} }));
    Assert(Completed.total === 1 && Completed.completed[0].id === 'c1', 'list_completed_reminders reads history');

    const BadWorkspace = await Client.Rpc('tools/call', { name: 'query_reminders', arguments: { workspace: 'nope' } });
    Assert(BadWorkspace.result.isError === true, 'unknown workspace surfaces a tool error, not a crash');
  } finally {
    Child.kill();
    await rm(DataDir, { recursive: true, force: true });
  }

  console.log(Failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${Failures})`);
  process.exit(Failures === 0 ? 0 : 1);
}

Main().catch((ArgError) => { console.error(ArgError); process.exit(1); });
