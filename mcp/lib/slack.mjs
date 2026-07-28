// Live, read-only window into a Sleuth workspace's Slack via the Slack Web API.
//
// Uses the SAME bot token the running app uses (workspace LIVE_TOKEN), instantiated as a standalone
// WebClient — no Bolt, no socket. Every method here is a read (conversations.*, users.*); nothing
// posts, edits, deletes, or reacts. That keeps the connector a safe lens on the workspace.

import { LoadWorkspace } from './config.mjs';

const { WebClient } = await import('@slack/web-api');

/** Cache one WebClient per workspace so repeated tool calls reuse the connection. @type {Map<string, any>} */
const ClientCache = new Map();

/**
 * Get (or build) a read-only WebClient for a workspace, authenticated with its bot token.
 * @param {string} ArgWorkspaceName
 * @returns {Promise<any>}
 */
export async function GetSlackClient(ArgWorkspaceName) {
  if(ClientCache.has(ArgWorkspaceName)) return ClientCache.get(ArgWorkspaceName);
  const Workspace = await LoadWorkspace(ArgWorkspaceName);
  if(!Workspace || !Workspace.LIVE_TOKEN) {
    throw new Error(`Workspace "${ArgWorkspaceName}" has no LIVE_TOKEN; cannot query Slack.`);
  }
  // Bound timeout and retries: a query connector must fail fast and surface an error rather than
  // hang Claude Desktop for minutes behind the WebClient's default (10-retry) backoff if Slack is
  // unreachable or the token is bad.
  const Client = new WebClient(Workspace.LIVE_TOKEN, {
    timeout: 15000,
    retryConfig: { retries: 2, factor: 2, minTimeout: 500, maxTimeout: 4000 },
  });
  ClientCache.set(ArgWorkspaceName, Client);
  return Client;
}

/**
 * List channels the bot can see. Follows cursor pagination up to a bounded page count so a huge
 * workspace can't make a single tool call run away.
 * @param {string} ArgWorkspaceName
 * @param {{ types?: string, includeArchived?: boolean, limit?: number }} [ArgOptions]
 */
export async function ListChannels(ArgWorkspaceName, ArgOptions = {}) {
  const Client = await GetSlackClient(ArgWorkspaceName);
  const Limit = Number.isFinite(ArgOptions.limit) && ArgOptions.limit > 0 ? Math.floor(ArgOptions.limit) : 200;
  /** @type {any[]} */
  const Channels = [];
  let Cursor;
  // Cap pages defensively: ~10 pages * 200 = 2000 channels is plenty for a query surface.
  for(let Page = 0; Page < 10 && Channels.length < Limit; Page += 1) {
    /** @type {any} */
    const Response = await Client.conversations.list({
      types: ArgOptions.types || 'public_channel,private_channel',
      exclude_archived: !ArgOptions.includeArchived,
      limit: Math.min(200, Limit - Channels.length),
      cursor: Cursor,
    });
    for(const Channel of Response.channels || []) {
      Channels.push({
        id: Channel.id,
        name: Channel.name,
        isPrivate: !!Channel.is_private,
        isArchived: !!Channel.is_archived,
        isMember: !!Channel.is_member,
        topic: Channel.topic?.value || '',
        purpose: Channel.purpose?.value || '',
        memberCount: Channel.num_members ?? null,
      });
    }
    Cursor = Response.response_metadata?.next_cursor;
    if(!Cursor) break;
  }
  return { returned: Channels.length, channels: Channels.slice(0, Limit) };
}

/** Map a raw Slack message into a compact shape. */
function ProjectMessage(ArgMessage) {
  return {
    ts: ArgMessage.ts,
    userId: ArgMessage.user || ArgMessage.bot_id || null,
    text: ArgMessage.text || '',
    threadTs: ArgMessage.thread_ts || null,
    replyCount: ArgMessage.reply_count ?? 0,
    reactions: (ArgMessage.reactions || []).map(ArgReaction => ({ name: ArgReaction.name, count: ArgReaction.count })),
    subtype: ArgMessage.subtype || null,
  };
}

/**
 * Read recent messages from a channel.
 * @param {string} ArgWorkspaceName
 * @param {{ channelId: string, limit?: number, oldest?: string, latest?: string }} ArgOptions
 */
export async function ChannelHistory(ArgWorkspaceName, ArgOptions) {
  const Client = await GetSlackClient(ArgWorkspaceName);
  const Limit = Number.isFinite(ArgOptions.limit) && ArgOptions.limit > 0 ? Math.min(200, Math.floor(ArgOptions.limit)) : 50;
  /** @type {any} */
  const Response = await Client.conversations.history({
    channel: ArgOptions.channelId,
    limit: Limit,
    oldest: ArgOptions.oldest,
    latest: ArgOptions.latest,
  });
  return {
    channelId: ArgOptions.channelId,
    returned: (Response.messages || []).length,
    hasMore: !!Response.has_more,
    messages: (Response.messages || []).map(ProjectMessage),
  };
}

/**
 * Read the replies in a thread.
 * @param {string} ArgWorkspaceName
 * @param {{ channelId: string, threadTs: string, limit?: number }} ArgOptions
 */
export async function ThreadReplies(ArgWorkspaceName, ArgOptions) {
  const Client = await GetSlackClient(ArgWorkspaceName);
  const Limit = Number.isFinite(ArgOptions.limit) && ArgOptions.limit > 0 ? Math.min(200, Math.floor(ArgOptions.limit)) : 50;
  /** @type {any} */
  const Response = await Client.conversations.replies({
    channel: ArgOptions.channelId,
    ts: ArgOptions.threadTs,
    limit: Limit,
  });
  return {
    channelId: ArgOptions.channelId,
    threadTs: ArgOptions.threadTs,
    returned: (Response.messages || []).length,
    messages: (Response.messages || []).map(ProjectMessage),
  };
}

/** Map a raw Slack user into a compact shape. */
function ProjectUser(ArgUser) {
  return {
    id: ArgUser.id,
    name: ArgUser.name,
    realName: ArgUser.real_name || ArgUser.profile?.real_name || '',
    displayName: ArgUser.profile?.display_name || '',
    email: ArgUser.profile?.email || null,
    isBot: !!ArgUser.is_bot,
    isAdmin: !!ArgUser.is_admin,
    deleted: !!ArgUser.deleted,
    tz: ArgUser.tz || null,
  };
}

/**
 * List workspace members (paginated, bounded).
 * @param {string} ArgWorkspaceName
 * @param {{ limit?: number, includeDeleted?: boolean }} [ArgOptions]
 */
export async function ListUsers(ArgWorkspaceName, ArgOptions = {}) {
  const Client = await GetSlackClient(ArgWorkspaceName);
  const Limit = Number.isFinite(ArgOptions.limit) && ArgOptions.limit > 0 ? Math.floor(ArgOptions.limit) : 200;
  /** @type {any[]} */
  const Users = [];
  let Cursor;
  for(let Page = 0; Page < 20 && Users.length < Limit; Page += 1) {
    /** @type {any} */
    const Response = await Client.users.list({ limit: Math.min(200, Limit - Users.length), cursor: Cursor });
    for(const User of Response.members || []) {
      if(!ArgOptions.includeDeleted && User.deleted) continue;
      Users.push(ProjectUser(User));
    }
    Cursor = Response.response_metadata?.next_cursor;
    if(!Cursor) break;
  }
  return { returned: Users.length, users: Users.slice(0, Limit) };
}

/**
 * Look up a single user by id.
 * @param {string} ArgWorkspaceName
 * @param {string} ArgUserId
 */
export async function UserInfo(ArgWorkspaceName, ArgUserId) {
  const Client = await GetSlackClient(ArgWorkspaceName);
  /** @type {any} */
  const Response = await Client.users.info({ user: ArgUserId });
  return ProjectUser(Response.user || {});
}
