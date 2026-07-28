#!/usr/bin/env node
// Sleuth MCP connector for Claude Desktop.
//
// Exposes two read-only surfaces over stdio:
//   1. Sleuth reminders — queried from the on-disk runtime state the app owns (no socket, no writes).
//   2. The live Slack workspace — queried through the Slack Web API with the workspace's bot token.
//
// Register it in Claude Desktop's connector config (see mcp/README.md). All tools are read-only by
// design: this connector observes Sleuth and Slack, it never mutates them.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';

import { ListWorkspaceNames, ResolveWorkspaceName } from './lib/config.mjs';
import {
  QueryReminders, GetReminderById, QueryCompleted, ReminderStats,
} from './lib/reminders-store.mjs';
import {
  ListChannels, ChannelHistory, ThreadReplies, ListUsers, UserInfo,
} from './lib/slack.mjs';

const require = createRequire(import.meta.url);
const Pkg = require('../package.json');

const Server = new McpServer({ name: 'sleuth-connector', version: Pkg.version || '0.0.0' });

/** Shared optional-workspace input. Tools accept it; ResolveWorkspaceName fills in the default. */
const WorkspaceArg = {
  workspace: z.string().optional().describe(
    'Sleuth workspace name. Optional when only one workspace is configured; required otherwise (use list_workspaces).'),
};

/**
 * Wrap a tool handler so it always returns MCP content and surfaces errors as readable tool errors
 * (rather than crashing the transport). Success returns pretty JSON the model can read directly.
 * @param {(args: any) => Promise<any>} ArgHandler
 */
function Tool(ArgHandler) {
  return async (ArgArgs) => {
    try {
      const Result = await ArgHandler(ArgArgs || {});
      return { content: [{ type: 'text', text: JSON.stringify(Result, null, 2) }] };
    } catch(error) {
      const Message = error && error.message ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${Message}` }], isError: true };
    }
  };
}

// ── Workspace discovery ────────────────────────────────────────────────────────────────────────

Server.registerTool('list_workspaces', {
  title: 'List Sleuth workspaces',
  description: 'List the Sleuth workspace names this connector can query. Call this first when unsure which workspace to target.',
  inputSchema: {},
}, Tool(async () => {
  const Names = await ListWorkspaceNames();
  return { count: Names.length, workspaces: Names };
}));

// ── Reminders (read-only, from on-disk state) ───────────────────────────────────────────────────

Server.registerTool('query_reminders', {
  title: 'Query Sleuth reminders',
  description: 'Query pending/active reminders for a workspace. Filter by state, assignee, channel, free-text, and due-date window. States include: scheduled, overdue, snoozed, posting, posted, rescheduled, failed.',
  inputSchema: {
    ...WorkspaceArg,
    state: z.string().optional().describe('Filter to a single reminder state, e.g. "scheduled" or "overdue".'),
    assigneeId: z.string().optional().describe('Slack user ID the reminder is assigned to (e.g. "U012ABC").'),
    channelId: z.string().optional().describe('Slack channel ID the reminder originates from or targets.'),
    search: z.string().optional().describe('Case-insensitive substring match against the reminder text.'),
    dueAfter: z.string().optional().describe('ISO date/time lower bound for the due date (inclusive).'),
    dueBefore: z.string().optional().describe('ISO date/time upper bound for the due date (inclusive).'),
    limit: z.number().int().positive().max(500).optional().describe('Max reminders to return (default 50).'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await QueryReminders(Workspace, ArgArgs);
  return { workspace: Workspace, ...Result };
}));

Server.registerTool('get_reminder', {
  title: 'Get a Sleuth reminder by id',
  description: 'Fetch a single reminder by its reminder ID.',
  inputSchema: {
    ...WorkspaceArg,
    reminderId: z.string().describe('The reminder ID (UUID) to fetch.'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Reminder = await GetReminderById(Workspace, ArgArgs.reminderId);
  if(!Reminder) throw new Error(`No reminder with id "${ArgArgs.reminderId}" in workspace "${Workspace}".`);
  return { workspace: Workspace, reminder: Reminder };
}));

Server.registerTool('list_completed_reminders', {
  title: 'List completed Sleuth reminders',
  description: 'Query completion history (what got done) within a time window. Useful for weekly/standup summaries. Retains roughly the last 365 days.',
  inputSchema: {
    ...WorkspaceArg,
    since: z.string().optional().describe('ISO date/time lower bound for when the reminder was completed.'),
    until: z.string().optional().describe('ISO date/time upper bound for when the reminder was completed.'),
    assigneeId: z.string().optional().describe('Slack user ID who the completed reminder was assigned to.'),
    limit: z.number().int().positive().max(500).optional().describe('Max records to return (default 50).'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await QueryCompleted(Workspace, ArgArgs);
  return { workspace: Workspace, ...Result };
}));

Server.registerTool('reminder_stats', {
  title: 'Sleuth reminder stats',
  description: 'Summary counts of active reminders by state, plus an overdue tally, for a workspace.',
  inputSchema: { ...WorkspaceArg },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await ReminderStats(Workspace);
  return { workspace: Workspace, ...Result };
}));

// ── Live Slack workspace (read-only Web API) ────────────────────────────────────────────────────

Server.registerTool('slack_list_channels', {
  title: 'List Slack channels (live)',
  description: 'List channels the Sleuth bot can see in the live Slack workspace, with topic/purpose and membership.',
  inputSchema: {
    ...WorkspaceArg,
    types: z.string().optional().describe('Comma-separated channel types: public_channel, private_channel, mpim, im. Default public+private.'),
    includeArchived: z.boolean().optional().describe('Include archived channels (default false).'),
    limit: z.number().int().positive().max(2000).optional().describe('Max channels to return (default 200).'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await ListChannels(Workspace, ArgArgs);
  return { workspace: Workspace, ...Result };
}));

Server.registerTool('slack_channel_history', {
  title: 'Read Slack channel history (live)',
  description: 'Read recent messages from a Slack channel by channel ID. Optionally bound by oldest/latest Slack timestamps.',
  inputSchema: {
    ...WorkspaceArg,
    channelId: z.string().describe('Slack channel ID (e.g. "C012ABC"). Use slack_list_channels to find it.'),
    limit: z.number().int().positive().max(200).optional().describe('Max messages to return (default 50).'),
    oldest: z.string().optional().describe('Only messages after this Slack ts (epoch seconds, e.g. "1700000000.000100").'),
    latest: z.string().optional().describe('Only messages before this Slack ts.'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await ChannelHistory(Workspace, ArgArgs);
  return { workspace: Workspace, ...Result };
}));

Server.registerTool('slack_thread_replies', {
  title: 'Read a Slack thread (live)',
  description: 'Read the replies in a Slack thread by channel ID and the thread root timestamp.',
  inputSchema: {
    ...WorkspaceArg,
    channelId: z.string().describe('Slack channel ID containing the thread.'),
    threadTs: z.string().describe('The thread root message timestamp (ts).'),
    limit: z.number().int().positive().max(200).optional().describe('Max replies to return (default 50).'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await ThreadReplies(Workspace, ArgArgs);
  return { workspace: Workspace, ...Result };
}));

Server.registerTool('slack_list_users', {
  title: 'List Slack users (live)',
  description: 'List members of the live Slack workspace with names, display names, email, and bot/admin flags.',
  inputSchema: {
    ...WorkspaceArg,
    includeDeleted: z.boolean().optional().describe('Include deactivated users (default false).'),
    limit: z.number().int().positive().max(2000).optional().describe('Max users to return (default 200).'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const Result = await ListUsers(Workspace, ArgArgs);
  return { workspace: Workspace, ...Result };
}));

Server.registerTool('slack_user_info', {
  title: 'Get a Slack user (live)',
  description: 'Look up a single Slack user by ID (resolve an assigneeId from a reminder to a real name/email).',
  inputSchema: {
    ...WorkspaceArg,
    userId: z.string().describe('Slack user ID (e.g. "U012ABC").'),
  },
}, Tool(async (ArgArgs) => {
  const Workspace = await ResolveWorkspaceName(ArgArgs.workspace);
  const User = await UserInfo(Workspace, ArgArgs.userId);
  return { workspace: Workspace, user: User };
}));

// ── Boot ────────────────────────────────────────────────────────────────────────────────────────

async function Main() {
  const Transport = new StdioServerTransport();
  await Server.connect(Transport);
  // stderr is safe to log to; stdout is the JSON-RPC channel and must not be polluted.
  process.stderr.write(`sleuth-connector v${Pkg.version || '0.0.0'} ready on stdio\n`);
}

Main().catch((ArgError) => {
  process.stderr.write(`sleuth-connector failed to start: ${ArgError && ArgError.stack ? ArgError.stack : ArgError}\n`);
  process.exit(1);
});
