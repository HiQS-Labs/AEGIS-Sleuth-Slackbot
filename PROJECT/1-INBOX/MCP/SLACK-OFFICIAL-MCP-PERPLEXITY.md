Based on my research, here's a comprehensive breakdown of Slack's MCP integration as of March 2026.

***

## What Slack Shipped

**Official name:** **Slack MCP Server** (not "MCP client" — Slack hosts the server; AI assistants are MCP clients).

**Release date:** GA on **February 17, 2026** (changelog entry: `docs.slack.dev/changelog/2026/02/17/slack-mcp` ). [docs.slack](https://docs.slack.dev/changelog/2026/02/17/slack-mcp)

**What it is:** A **hosted, Slack-maintained MCP server** at `https://mcp.slack.com/mcp` that exposes Slack workspace data and actions as standardized MCP tools. It uses **JSON-RPC 2.0 over Streamable HTTP** (no SSE, no Dynamic Client Registration). It is **not** a new REST endpoint or a Bolt SDK replacement — it's a distinct protocol layer purpose-built for LLM/agent consumption. [docs.slack](https://docs.slack.dev/ai/slack-mcp-server/)

**Where it's documented:**  
- Developer docs: `docs.slack.dev/ai/slack-mcp-server` [docs.slack](https://docs.slack.dev/ai/slack-mcp-server/)
- Admin/help guide: `slack.com/help/articles/48855576908307` [slack](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server)
- GA announcement blog: `slack.com/blog/news/mcp-real-time-search-api-now-available` [slack](https://slack.com/blog/news/mcp-real-time-search-api-now-available)

***

## Capabilities Exposed (MCP Tools)

| Category | Tools (as of May 2026) | Key Scopes Required |
|----------|------------------------|---------------------|
| **Search** | `search_messages`, `search_channels`, `search_users`, `search_files`, `search_emoji` | `search:read.public`, `.private`, `.im`, `.mpim`, `.files`; `emoji:read` |
| **Messaging** | `send_message`, `draft_message`, `read_channel`, `read_thread`, `create_conversation`, `add_reaction` | `chat:write`; `channels:history`/`groups:history`/`im:history`/`mpim:history`; `channels:write`/`groups:write`/`im:write`/`mpim:write`; `reactions:write` |
| **Canvases** | `create_canvas`, `update_canvas`, `read_canvas` | `canvases:read`, `canvases:write` |
| **Users** | `read_user_profile`, `list_channel_members` | `users:read`, `users:read.email`; `channels:read`/`groups:read`/`mpim:read` |

**Your specific use cases mapped:**
- ✅ **Read messages / list channels / post messages / react** — all covered
- ✅ **Read thread history** — `read_thread` tool
- ✅ **App mentions / DMs** — readable via `read_channel` (IM/MPIM) and searchable
- ⚠️ **Manage users/workspaces** — *only* `list_channel_members` and `read_user_profile`; no admin APIs (user provisioning, workspace settings, etc.)
- ⚠️ **Real-time event subscriptions (app_mention, message.channels, etc.)** — **NOT supported** in MCP. No webhooks, no Socket Mode, no streaming. Pure request/response.

**OAuth flow:** Confidential OAuth 2.0 with **user-level tokens** (not bot tokens). The MCP client must be a published Slack app (Marketplace or internal) with a fixed `client_id`. Admins approve the app in the workspace admin panel. [docs.slack](https://docs.slack.dev/ai/slack-mcp-server/)

***

## MCP vs. Bolt SDK / Events API / Web API

| Dimension | Slack MCP Server | Slack Web API + Bolt SDK |
|-----------|------------------|--------------------------|
| **Paradigm** | LLM-native: tools self-describe at runtime; returns human-readable markdown | Deterministic REST: fixed schemas, JSON I/O |
| **Auth** | OAuth user tokens only (per-user identity) | Bot tokens (`xoxb-`), user tokens (`xoxp-`), app-level tokens (Socket Mode) |
| **Event-driven / real-time** | ❌ No — request/response only | ✅ Yes — Events API, Socket Mode, webhooks |
| **Surface coverage** | ~15 tools (search, msg, canvas, users, reactions) | 200+ methods (admin, workflows, slash commands, etc.) |
| **Rate limits** | Same tier limits as underlying Web API methods | Same |
| **Governance** | Admin approval required for each MCP client | Standard app install/approval |
| **Best for** | Interactive, user-present agents (Claude, Cursor, custom chat UIs) | Headless bots, scheduled jobs, high-volume monitoring, event-driven flows, admin automation |

**Key takeaway from Scalekit's analysis**: MCP is a **complement** for conversational agents; Web API remains the foundation for deterministic, event-driven, or high-scale automation. MCP does **not** replace Bolt or the Events API. [scalekit](https://www.scalekit.com/blog/slack-mcp-vs-api)

***

## Real-Time vs. Poll Model

- **MCP = request/response only.** No streaming, no webhooks, no Socket Mode.
- If you need **real-time event handling** (e.g., "listen for app_mention and react immediately"), you **must** use the Events API / Socket Mode / Bolt SDK.
- The **Real-Time Search (RTS) API** (separate from MCP) provides low-latency search over live Slack data but is still pull-based, not push.

***

## Rate Limits & Pricing

- **Rate limits:** Mirror the underlying Web API method tiers (Tier 2–4). Example: `send_message` and `search_messages` have "special" limits; `read_channel` = Tier 3 (50+/min); `read_user_profile` = Tier 4 (100+/min). [docs.slack](https://docs.slack.dev/ai/slack-mcp-server/)
- **No new pricing tier.** MCP access falls under existing Slack app quotas and the workspace's plan.
- **Plan gating:** Only **directory-published or internal apps** may use MCP; unlisted apps are blocked. Some AI features (Slack AI, Agentforce) require paid plans (Pro/Business+/Enterprise Grid), but the MCP server itself is available to all customers with a valid Slack app. [mindstudio](https://www.mindstudio.ai/blog/slack-ai-mcp-client-agentic-slackbot-features)

***

## Use Case: Node.js Slack Reminders Bot

| Flow | Current (Bolt/Web API) | With MCP | Can MCP Simplify/Replace? |
|------|------------------------|----------|---------------------------|
| **(a) Listen for app_mentions to trigger commands** | Events API + Socket Mode (real-time) | ❌ Not possible — MCP has no event subscriptions | **No** — keep Bolt/Socket Mode |
| **(b) Post scheduled reminder messages to channels** | `chat.postMessage` + `chat.scheduleMessage` (or cron + `chat.postMessage`) | ✅ `send_message` tool (supports drafting/formatting) | **Partially** — simpler if the scheduler runs inside an MCP client (e.g., an LLM agent that decides *when* to post), but raw scheduling is still easier via Web API |
| **(c) Read completion history to generate weekly summaries** | `conversations.history` + `conversations.replies` + pagination + token management | ✅ `read_channel`, `read_thread`, `search_messages` — LLM-friendly markdown output, auto-pagination handled by server | **Yes** — MCP excels here: the agent can "search for messages from @bot in #reminders last week" and get readable context without you writing pagination/format logic |

**Practical architecture for your bot:**
- Keep a **lightweight Bolt app** (Socket Mode) for **(a)** real-time mention handling.
- For **(b)** and **(c)**, you can either:
  - Call the **Web API directly** from your Node.js service (simpler for scheduled posts), or
  - Offload **(c)** to an **MCP client** (e.g., a LangGraph/auto-gen agent that uses the Slack MCP server to fetch history and draft the summary), then post the summary via Web API or MCP `send_message`.

***

## Beta / Paid-Tier Flags

| Item | Status |
|------|--------|
| Slack MCP Server | **GA since Feb 17, 2026** — not beta |
| New tools (reactions, create channel, list members, emoji, read files) | Shipped **May 13, 2026** — GA |
| Admin approval requirement | Mandatory for all MCP clients |
| Unlisted apps | **Blocked** from MCP |
| Slack AI / Agentforce features | Require paid plans (Pro/Business+/Enterprise)  [mindstudio](https://www.mindstudio.ai/blog/slack-ai-mcp-client-agentic-slackbot-features) |
| RTS API | GA, separate from MCP  [slack](https://slack.com/blog/news/mcp-real-time-search-api-now-available) |

***

## TL;DR for Your Project

- **MCP is a complement**, not a replacement. Use it for **LLM-driven search/read/summarize** flows where natural-language tool discovery and markdown output save you code.
- **Keep Bolt + Socket Mode** for real-time mention listening and any event-driven logic.
- **No new rate-limit tier or pricing** — same Web API quotas.
- **Auth is per-user OAuth**; plan for token storage/refresh if you build a multi-user MCP client.
- **Documentation:** Start at `docs.slack.dev/ai/slack-mcp-server` for tool schemas, scopes, and the `https://mcp.slack.com/mcp` endpoint.

Would you like a minimal Node.js example showing how to call the Slack MCP server from a custom client (e.g., using `@modelcontextprotocol/sdk`)?