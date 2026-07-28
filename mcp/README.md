# Sleuth MCP Connector (Claude Desktop)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets **Claude Desktop**
(or any MCP client) **query Sleuth reminders** and run **live, read-only queries against the Slack
workspace** Sleuth is connected to.

It is a separate, stdio-based process from the Slack app. It **never opens a Slack socket and never
mutates anything** — it reads Sleuth's on-disk runtime state and makes read-only Slack Web API calls.

## What it exposes

### Reminders (read from Sleuth's on-disk state)
| Tool | What it does |
| --- | --- |
| `list_workspaces` | List the Sleuth workspaces this connector can see. |
| `query_reminders` | Pending/active reminders, filterable by `state`, `assigneeId`, `channelId`, `search`, `dueAfter`/`dueBefore`, `limit`. |
| `get_reminder` | A single reminder by `reminderId`. |
| `list_completed_reminders` | Completion history within a `since`/`until` window (≈365-day retention) — good for weekly/standup recaps. |
| `reminder_stats` | Counts of active reminders by state, plus an overdue tally. |

### Live Slack (read-only Web API, using the workspace bot token)
| Tool | What it does |
| --- | --- |
| `slack_list_channels` | Channels the bot can see, with topic/purpose/membership. |
| `slack_channel_history` | Recent messages in a channel (`channelId`, optional `oldest`/`latest`). |
| `slack_thread_replies` | Replies in a thread (`channelId` + `threadTs`). |
| `slack_list_users` | Workspace members (name, display name, email, bot/admin flags). |
| `slack_user_info` | A single user by `userId` — e.g. resolve a reminder's `assigneeId` to a name. |

All tools accept an optional `workspace` argument. With one workspace configured it is implied; with
several, pass it explicitly (use `list_workspaces` to discover names).

## How it reads data

- **Reminders** come straight from the JSON Sleuth owns:
  `data/runtime/reminders/<workspace>_reminders.json` and `…_completed.json`. No `RemindersModule`
  instance is constructed (that would need a live Slack socket), so the connector is safe to run
  alongside — or independently of — the app.
- **Slack** calls use the workspace's `LIVE_TOKEN` (bot token) from
  `data/runtime/workspaces/<workspace>_workspace.json`, via a standalone `@slack/web-api` `WebClient`
  with a bounded timeout/retry so a call fails fast instead of hanging the client.

By default both roots are resolved relative to this repo checkout. If the connector runs somewhere
else, point it at the app's runtime data with the `SLEUTH_DATA_DIR` env var (the directory that
contains `workspaces/` and `reminders/`).

## Setup

1. Install dependencies (once): `npm install`.
2. Quick check that it works: `npm run mcp:smoke` (spins the server against throwaway fixtures).
3. Register it in Claude Desktop. Open **Settings → Developer → Edit Config** (this edits
   `claude_desktop_config.json`) and add a server entry:

```json
{
  "mcpServers": {
    "sleuth": {
      "command": "node",
      "args": ["/absolute/path/to/sleuth-app/mcp/sleuth-mcp-server.mjs"],
      "env": {
        "SLEUTH_DATA_DIR": "/absolute/path/to/sleuth-app/data/runtime"
      }
    }
  }
}
```

   `SLEUTH_DATA_DIR` is optional when Claude Desktop runs on the same machine as the repo checkout
   (the default resolves to `<repo>/data/runtime`). It is required when the data lives elsewhere
   (e.g. a server deploy under `/opt/sleuth-app/data/runtime`).

4. Restart Claude Desktop. The `sleuth` connector and its tools will appear in the tools menu.

## Notes & limitations

- **Read-only by design.** There are no tools to create, complete, cancel, or post anything. Mutating
  Sleuth/Slack from Claude would be a deliberate, separate addition.
- **Slack scopes.** Live Slack tools rely on the bot token's existing scopes (`channels:read`,
  `groups:read`, `channels:history`, `users:read`, etc., already granted to the Sleuth app). Private
  channels are visible only where the bot is a member. Full-text message *search* is intentionally not
  exposed — it requires a user token Sleuth doesn't hold.
- **Run from the command line** for debugging: `npm run mcp` (it speaks JSON-RPC on stdio; logs go to
  stderr).
