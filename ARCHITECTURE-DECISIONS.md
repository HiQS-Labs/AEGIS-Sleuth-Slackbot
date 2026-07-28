---
title: Sleuth Architecture Decision Record
status: Active
created: 2026-07-03
updated: 2026-07-03
generated_by: codebase-memory-mcp (manage_adr), from a full graph index (5,159 nodes / 9,857 edges)
source_of_truth: ARCHITECTURE.md and AGENTS.md remain canonical for day-to-day contracts; this doc is a point-in-time architectural snapshot, not a living spec
regenerate: run index_repository then manage_adr(mode="get") via the codebase-memory-mcp MCP tool, or ask an agent to refresh it
---

# Sleuth Architecture Decision Record

This is a point-in-time snapshot generated from `codebase-memory-mcp`'s knowledge graph of this
repo (captured 2026-07-03). It was originally stored only in that tool's local, per-machine cache
(`~/.cache/codebase-memory-mcp/<project>.db`, `project_summaries` table) — not committed anywhere
and not visible to anyone else who indexes this repo. This file makes it durable and shareable.

It complements, not replaces, `ARCHITECTURE.md` (the detailed, hand-maintained execution-pipeline
doc) and `AGENTS.md` (the canonical agent-facing contract checklist) — those stay authoritative for
current behavior. Treat this doc as a higher-altitude architectural summary that may drift from the
code over time; regenerate it (see frontmatter) rather than hand-editing it out of sync.

## PURPOSE
Sleuth is a multi-tenant Slack app that uses AI to parse chat messages, extract actionable tasks, and schedule/post reminders back into Slack. It also provides a general AI chat assistant with operator/admin commands, and optional Notion + Slack Lists + GitHub sync integrations.

## STACK
- Runtime: Node.js (CommonJS `src/**`, ESM `mcp/**`), TypeScript used only for `checkJs` type-checking (`tsc --project tsconfig.json`), not compiled output.
- Slack: `@slack/bolt` (Socket Mode) + `@slack/web-api`.
- AI providers: `openai` (default/general + web search), `@anthropic-ai/sdk` (claude-* models), Gemini via direct REST calls (no SDK) — routed by model-name prefix through `src/ai-providers/index.js`.
- Persistence: flat JSON files under `data/runtime/**`, workspace-scoped — no RDBMS for app state.
- Web admin: `express` REST surface (`src/web-api.js`) with session-based admin auth + bearer-token workspace routes; static admin UI under `public/admin/`.
- MCP: a separate `@modelcontextprotocol/sdk` stdio server (`mcp/`) exposing read-only reminder + live Slack query tools to external MCP clients (e.g. Claude Desktop) — fully decoupled from the main Socket Mode process.
- Observability: New Relic (`newrelic.js`), a custom `CombinedLogger` (highest fan-in node in the graph — 127 callers).
- Tests: Jest (unit/integration) + a mock Slack harness (`tests/mocks/mock-slack-app.js`) + a one-shot real-Slack smoke harness; `node --test` for a few event-sourcing modules.
- Doc automation: PDDA (`utils/pdda/*.sh`), a deterministic + optional-LLM hygiene layer over `PROJECT/**` docs, `ROADMAP.md`, and `CHANGELOG.md`.

## ARCHITECTURE
Single-process, per-workspace orchestration, entry point `src/app.js`:
1. Shared logger + `SettingsModule` + admin auth start first.
2. Per workspace (from `src/workspaces.js`): create `SlackApp`, start `StatsModule` first (shared stats object other modules depend on), then `ListsModule`, `RemindersModule`, `NotionModule`, `PluginLoader` (must register before chat), `ChatModule`, wire `ListsModule`↔`RemindersModule`, run an AI connectivity probe, then start everything (`ChatModule` before `SlackApp` so thread/model state loads before events arrive; `RemindersModule` before `ListsModule` so the reminder queue exists before list population reads it).
3. GitHub sync starts after reminder modules are ready; the Web API server starts last.

Event dispatch (`src/slack-app.js`, the single Slack ingress layer):
- `message` → GitHubCommentRelay → RemindersModule → ChatModule (first non-`false` handler wins).
- `app_mention` → NotionModule → RemindersModule → plugin mention handlers → ChatModule.
- `reaction_added` → ChatModule (`:wrench:` triage) → RemindersModule.

Reminder FSM (`src/reminders-module.js`) has exactly three enforcement points that must never be bypassed: `#MakeScheduledReminder` (creation gate — owns ID/CreatedOn/initial State), `#TryScheduleRemindersAsync` (the only AI-driven scheduling gateway — dedup, date extraction, channel/GitHub resolution), `#TransitionReminderState` (the only place state changes post-creation, with an audit log).

Command discovery is a three-file declarative system, deliberately separate from execution: `CommandRouter` registries (code, in `ChatModule`/`RemindersAppMentionHandler`) own *how* a command executes; `data/static/ai/command-catalog.json` owns *how it's discovered* (aliases, NL intent phrases, regex aliases, help/commands text) — this is also the sole candidate pool for the `rmm` ("read my mind") LLM intent resolver, so a route not added to the catalog is invisible to `rmm` even if it works when typed exactly. `command-normalization.json` handles pure syntax normalization (not discovery); `deterministic-responses.json` holds true canned replies.

Two independent AI paths: `src/workspace-ai.js` (OpenAI/Anthropic/Gemini dispatcher for reminders, chat, web search — provider chosen by model-name prefix, clients lazy-built per workspace).

Lists sync (`src/lists-module.js` + `src/list-context.js`) maintains a shared output-only list and bidirectional per-user lists, with one-shot echo suppression (`EchoSuppressRowIds`) to stop the bot's own writes from re-triggering inbound handlers on the next poll.

## PATTERNS
- **Declarative-over-code for discovery, code for execution.** New chat commands are one `CommandRouter` entry + one catalog entry, never a bespoke regex scattered in the dispatcher.
- **Provider registries, not vendor-specific branches.** Both web-search providers and AI model providers are `{Id, Aliases, ..., InvokeAsync}` registry entries dispatched generically — adding a provider is additive, not a conditional rewritten in three places.
- **Single write gateway per mutable domain.** The reminder FSM's three enforcement points are the only legal mutation paths; list-sync and AI-scheduling both funnel through `#MakeScheduledReminder`.
- **Handler-chain-with-short-circuit for Slack events**, not a pub/sub fan-out — ordering encodes precedence (e.g. GitHubCommentRelay before RemindersModule before ChatModule) and a `true` return stops the chain.
- **File-based, workspace-scoped persistence** instead of a shared database — strict tenant isolation is a path convention (`data/runtime/<kind>/<WORKSPACE_NAME>_<kind>.json>`), not a schema/row-level concern.
- **PDDA doc hygiene**: deterministic shell checks (frontmatter, status tables, hardcoded paths, ROADMAP shape/coverage, changelog freshness, staleness, GH-issue/doc-status drift) gate `PROJECT/**` docs; an optional LLM layer (unset by default here) adds judgment-based review on top, never replacing the deterministic gate.

## TRADEOFFS
- **JSON-file persistence** is simple and trivially tenant-isolated, but has no transactions/migrations and relies on discipline (single write gateway) rather than a schema to prevent invalid state — acceptable at current scale, would need revisiting under concurrent-write load or multi-instance deployment.
- **Catalog/router duality** for commands adds a mandatory sync step (four touch points to make a command `rmm`-visible) in exchange for keeping NL discovery data-driven and out of code; `validate:commands` exists specifically to catch drift between the two.
- **PDDA's LLM review layer is opt-in** (`PDDA_LLM_BIN` unset by default in this environment) — deterministic checks always run, but doc *quality* judgment (vs. structural hygiene) is currently skipped unless a model CLI is configured.

## PHILOSOPHY
Favor small, additive, declarative extension points (registries, catalog entries) over conditionals embedded in dispatch code, so new commands/providers/aliases are data changes, not code-path rewrites. Enforce invariants (reminder FSM, tenancy gates, write paths) through a small number of named chokepoints rather than convention alone, and document the chokepoint contract in `ARCHITECTURE.md` so new code doesn't accidentally bypass it. Keep multi-tenant isolation a structural property (path-per-workspace, hard-gated tenancy checks) rather than something enforced only by application logic. Treat docs (`ROADMAP.md`, `PROJECT/**`, `CHANGELOG.md`) as first-class, automatable artifacts (PDDA) rather than best-effort narration that drifts from the code.
