# AEGIS Pipeline

This document describes the live execution pipeline for AEGIS as it exists in the current codebase. It is intended to be the shortest path to understanding how the service starts, how Slack events flow through the modules, where AI is allowed to run, how data is persisted, and how the automated and real-workspace test layers fit together.

## Scope

AEGIS is a multi-tenant Node.js backend. The main moving parts are:

- Slack Socket Mode event handling through `src/slack-app.js`
- workspace-scoped orchestration in `src/app.js`
- AI-backed reminder and chat behavior through `src/reminders-module.js`, `src/chat-module.js`, and `src/workspace-ai.js`
- file-based persistence under `data/runtime/`
- optional Notion and GitHub integrations
- optional Slack Lists bi-directional sync through `src/lists-module.js` and `src/list-context.js`
- optional per-workspace plugins loaded from `data/plugin-registry.json`
- optional external WP DB Toolkit RAG integration for the admin-only `ask-woo` command
- REST administration through `src/web-api.js`
- local and live-workspace verification through Jest, Slack commands, and the one-shot Slack harness

## System Map

At a high level, the runtime graph is:

- `src/app.js` is the process entrypoint and orchestrator.
- `src/slack-app.js` owns Slack SDK wiring and Slack API operations.
- `src/stats-module.js` starts first per workspace and provides the shared stats object.
- `src/reminders-module.js` owns reminder extraction, persistence, scheduling, snooze enforcement, and posting.
- `src/chat-module.js` owns general chat behavior and dispatches admin/operator commands through a `CommandRouter` registry populated at startup.
- `src/chat-commands/` contains one free-function handler per chat command (e.g. `restart-command.js`, `model-switch-command.js`, `web-search-provider-command.js`). Handlers receive only what they need from `ChatModule`; they do not reach back into private fields.
- `src/web-search-providers.js` is the single registry of web-search providers (`{ Id, Aliases, Label, LoadingMessage, CommandsListDescription, InvokeAsync }`); both the OpenAI and Gemini paths share one handler that takes the matched provider as a parameter.
- `src/notion-module.js` owns optional Notion search.
- `src/lists-module.js` owns Slack Lists synchronization for both the shared workspace list and durable per-user lists.
- `src/list-context.js` is the per-list data-holder used by `ListsModule` — it carries `ListId`, `Schema`, `ItemCache` (Map<ReminderID→rowId>), `ListItemsCache`, `Kind` (`'shared'`|`'user'`), `DeleteRowOnComplete` policy, and `EchoSuppressRowIds` for suppressing the bot's own outbound writes during the next poll cycle.
- `src/workspace-ai.js` is the only supported path for workspace-scoped AI access. It is a dispatcher over provider implementations in `src/ai-providers/` rather than a vendor-specific client.
- `src/plugin-loader.js` loads enabled per-workspace plugins before chat starts.
- `src/github-actions-startup-summary.js` performs the short-lived startup-time GitHub Actions lookup used to post a delayed startup follow-up message.
- `src/github-sync-module.js` performs post-startup GitHub status synchronization across reminder modules.
- `src/web-api.js` exposes the HTTP management surface.
- `scripts/slack-harness-post.js` is a one-shot, operator-facing real-Slack smoke-test tool.
- `scripts/reconcile-channels.js` and `scripts/reconcile-users.js` are read-only Slack-API probes that dump per-workspace channel and user inventories as JSON. Used to populate `data/static/client-channel-mapping.json` and to audit per-tenant Slack metadata.

## Startup Pipeline

The process startup pipeline in `src/app.js` is:

1. Load New Relic first.
2. Create the shared logger.
3. Start `SettingsModule`.
4. Initialize admin auth and admin mailer helpers.
5. Ensure the workspace directory exists and is writable.
6. Enumerate workspace JSON files through `src/workspaces.js`.
7. For each workspace:
- Load and validate workspace config.
- Create `SlackApp`.
- Create and start `StatsModule` first.
- Create `ListsModule`, `RemindersModule`, and `NotionModule`.
- Start `PluginLoader` so plugin mention handlers register before chat.
- Create `ChatModule`.
- Wire `ListsModule` and `RemindersModule` together.
- Run the workspace AI connectivity check through `ChatModule.WorkspaceAI`. The startup probe tests whichever provider owns the workspace default model; the diagnostics command can probe every configured provider individually.
- Start `ChatModule` to load disk-backed chat state before Slack begins delivering events.
- Start `SlackApp`.
- Start `RemindersModule`.
- Start `ListsModule`.
- Start `NotionModule`.
8. Post startup notifications when the workspace config enables them. When `GITHUB_ACTIONS_REPO` is configured, `src/app.js` posts the normal startup message immediately and then schedules a short delayed follow-up from `src/github-actions-startup-summary.js` so the latest workflow run summary appears as its own Slack message.
9. Start GitHub sync after all reminder modules are ready.
10. Start the Web API server.
11. On shutdown, stop modules gracefully and persist final state before process exit.

This ordering matters. In particular:

- `StatsModule` must exist before the other per-workspace modules so they can share one stats object.
- `PluginLoader` must register plugin mention handlers before `ChatModule` so plugin commands are checked before chat's catch-all handler.
- `ChatModule` must start before `SlackApp` so per-channel model overrides and thread context memory are loaded before live events arrive.
- `SlackApp` must own Slack handler registration.
- `RemindersModule` must start before `ListsModule` so the in-memory reminder queue is loaded before list population reads it.

## Slack Event Pipeline

`src/slack-app.js` is the single Slack ingress layer. It owns the Bolt client, handler registration, event dispatch, posting, reactions, metadata lookup, channel lookup, and permalink lookup.

The active event routes are:

- `message` events: `GitHubCommentRelay`, then `RemindersModule`, then `ChatModule` if the earlier handlers decline the event.
- `app_mention` events: `NotionModule`, then `RemindersModule`, then any plugin mention handlers, then `ChatModule`.
- `reaction_added` events: `ChatModule` first for `:wrench:` chat triage, then `RemindersModule`.

Handler contract:

- Return `true` when the event was handled and the chain should stop.
- Return `false` to fall through to downstream handlers.
- Thrown errors are logged and do not terminate the dispatch chain.

## Reminder Pipeline

The reminder pipeline is centered in `src/reminders-module.js` and its helper components:

- `RemindersAIPipeline` handles AI-backed reminder analysis, date extraction, and deduplication.
- `RemindersReactionHandler` handles emoji-driven lifecycle actions.
- `RemindersAppMentionHandler` handles reminder commands. The "create-reminder-from-task-above" route catches the formal `make a AEGIS reminder for @user based on task above` syntax; a sibling shorthand route also catches natural delegation phrases (`do above`, `handle above`, `complete the above`, `take care of above`, `tackle`, `finish`, `follow up on`, `knock out`). When no `@mention` is captured by the regex, `#ExtractTargetMentionFromText` scans the raw event text for the first non-bot, non-sender mention before the word "above". The synthesis prompt passes the resolved source task's verbatim text so the AI names the reminder from the actual request rather than the shorthand phrase.
- `GitHubCommentRelay` forwards Slack thread replies to linked GitHub issues or PRs.

The normal reminder creation flow is:

1. Slack message or app mention enters the handler chain. `#OnMessageAsync` returns early if `ArgEventInfo.text` is empty or whitespace-only — this guards against `file_share` events (image/attachment posts with no caption) reaching the AI analyzer, which would produce hallucinated task descriptions from empty context.
2. Reminder heuristics and AI analysis determine whether the message is actionable.
3. Date extraction resolves the scheduling trigger.
4. Duplicate detection runs before persistence.
5. Reminder records are written to the workspace-scoped runtime files.
6. The reminder check timer periodically marks due reminders and posts eligible reminders.
7. Snooze suppression must pass through `#ShouldSuppressForSnooze(...)` before posting.
8. Posted reminders can be completed, canceled, snoozed, retried, or dead-lettered depending on the state transition.

### Reminder FSM and Write-Path Contract

Reminder state is an explicit FSM with three enforcement points — do not bypass any of them:

| Enforcement point | Location | Purpose |
|---|---|---|
| `#MakeScheduledReminder(fields)` | `RemindersModule` | **Creation gate.** Every new `ReminderInfo` must be built here. Owns `ReminderID`, `CreatedOn`, `State=Scheduled`, `IgnoreSnooze=false`. Caller fields spread first; invariants are applied last and cannot be overridden. |
| `#TryScheduleRemindersAsync(...)` | `RemindersModule` | **AI-driven scheduling gateway.** All event-driven paths (auto-scheduling, reactions, app-mention commands, task-above, vague-completion) funnel here via the injected callback. It runs AI analysis, dedup, date extraction, channel resolution, GitHub URL extraction, and calls `#MakeScheduledReminder`. |
| `#TransitionReminderState(reminder, nextState, reason)` | `RemindersModule` | **Mid-lifecycle transitions.** The only place `reminder.State` may be changed after creation. Logs every transition for the FSM audit trail. |

**Approved write paths:**
- `#TryScheduleRemindersAsync` — AI-driven auto-scheduling and forced (reaction) scheduling.
- `CreateReminderFromListRowAsync` — list-sync path; bypasses AI by design (row already has all data), but still uses `#MakeScheduledReminder`.

**Rules for adding new reminder behavior:**
- New event-driven scheduling → call `#TryScheduleRemindersAsync` via the injected callback. Do not construct a `ReminderInfo` inline.
- New non-AI creation path → call `#MakeScheduledReminder` and then `#QueueReminderAsync`. Document the bypass of AI analysis in code comments and `CHANGELOG.md`.
- New lifecycle state → add a `#TransitionReminderState` call. Never assign `reminder.State` directly outside that method or the factory.
- Any new `ReminderInfo` field that must be initialized at creation → add it to `#MakeScheduledReminder`, not to individual call sites.

Reminder search (the `search reminders` command family handled by `RemindersAppMentionHandler`) matches against a haystack of `ReminderMessageText`, `OriginalChannelName`, and any `GitHubUrls` on the reminder. When the query mentions a client name or alias as a whole word, the result set is expanded with all reminders matching that client's mappings (channel IDs, channel-name patterns, or GitHub repo patterns). Mappings live in `data/static/client-channel-mapping.json` and load through `src/client-mapping.js`.

## Chat And Command Pipeline

`src/chat-module.js` handles:

- general conversational replies
- thread-aware context and hands-free mode
- thread-scoped uploaded Markdown context memory persisted per workspace (see Thread Context Memory below)
- deterministic responses from `data/static/deterministic-responses.json`
- OpenAI-backed web search routing through explicit commands, natural-language search aliases, and a narrow freshness auto-route
- operator/admin commands such as `commands`, `run-diagnostics`, `run-tests`, restart flows, model inspection and switching, per-channel model overrides, and the optional `ask-woo` external RAG command

The rule of thumb is:

- reminder-specific commands and reminder scheduling stay in `RemindersModule`
- optional Notion lookup stays in `NotionModule`
- everything else conversational falls through to `ChatModule`

Inside `ChatModule`, command dispatch goes through a single `CommandRouter` registry populated by `#RegisterCommandRoutes` at construction time. Each route entry carries a `Pattern` (regex or function), an optional `DescribePattern` for diagnostic classification (so malformed commands like `model-switch:badformat` still classify under their intended route while strict dispatch only fires on a valid match), a `Route` label, and a `Handle` closure that injects the dependencies each free-function handler needs. Adding a new chat command means adding one entry to `#RegisterCommandRoutes` and one file under `src/chat-commands/` — no edits in the dispatcher, the route describer, or the `commands` admin output.

Web search dispatch follows the same pattern through `src/web-search-providers.js`. Adding a new provider (or alias) is one registry entry; the dispatcher, route classification, command handler, and `commands` listing all read from that registry.

<!-- ============================================================================
     BEGIN MANUAL SECTION: command-catalog-help-rmm
     Human-authored. DO NOT auto-generate or overwrite this block. Any doc
     regeneration tooling (e.g. the architecture
     generator) must preserve everything between the BEGIN/END markers verbatim.
     Added 2026-06-08 (CHANGELOG v1.4.170). Owner: hand-curated architecture notes.
     ============================================================================ -->
### Command Catalog, Help, and RMM Intent Resolution

**Design principle: prefer JSON configuration over code for command discovery.** When adding or modifying command behavior, reach for `data/static/ai/command-catalog.json` first. Code is the right layer only for execution (handler logic, permissions, response rendering). Discovery metadata — NL phrasings, aliases, intent hints, help text — belongs in the catalog. Code-only aliases are invisible to `rmm`, help generation, and `validate:commands`. See the boundary table below for the full breakdown.

The `CommandRouter` registries (in `ChatModule` and `RemindersAppMentionHandler`) decide *how a typed command executes*. A separate, declarative layer — `data/static/ai/command-catalog.json` — decides *how commands are discovered*: it is the single source of truth for the `help`/`features` output, the `commands` reference list, and the candidate set the `rmm` ("read my mind") intent resolver chooses from. Each catalog entry carries `Id`, `Permission`, `Risk`, `CanExecuteWithIfl`, a ≤2-sentence `Description`, `SyntaxExamples`, `Aliases`, `IntentPhrases`, `RegisteredRoutes`, and help/commands ordering + section fields.

**Three-file discovery boundary.** Natural-language command discovery is split across three files with distinct responsibilities:

| File | Owns |
|------|------|
| `data/static/ai/command-catalog.json` | Canonical registry for all NL command discovery: `Aliases`, `IntentPhrases`, and `RegexAliases` (see below). Any phrasing that should resolve to an existing route belongs here. |
| `data/static/ai/command-normalization.json` | Preprocessing rewrites applied *before* route dispatch: model-name aliases (`ModelAliases`) and `DirectCommandPatterns`. `DirectCommandPatterns` match command-syntax variations (e.g. `model switch:default='X'`, `show channel model` with spaces) and canonicalize them into the hyphenated form the router expects — they are not NL discovery and do not help users find commands they don't know about. Add here when a typed command has multiple valid syntaxes; add to `command-catalog.json` RegexAliases when adding a new NL phrasing for a known command. |
| `data/static/deterministic-responses.json` | True canned replies (exact-phrase matches that return a static string). Command-shaped entries were migrated to the catalog (UNIFY-COMMANDS Phase 3); remaining entries (`ping`, `reminders-for-user`) are genuine canned replies. |

A route's inline code regex is only acceptable when its behavior cannot be expressed as declarative alias data (e.g., it closes over private module state). Any such exception must be commented in the code.

- **Help is generated, not authored.** `data/static/HELP.md` is produced from the catalog by `scripts/generate-help.js` (via `BuildHelpMarkdownFromCatalog` in `src/command-catalog.js`); `HandleHelpFeaturesCommandAsync` serves that pre-generated file. After any catalog change, run `node scripts/generate-help.js` to regenerate it.
- **RMM resolves against the catalog, not the live route registry.** `src/command-intent-resolver.js` retrieves the top candidate catalog entries for the user's text, asks the LLM (schema `data/static/ai/rmm-schema.json`, instructions `rmm-instructions.md`) to pick one `intent_id`, then `BuildCanonicalCommand` maps that intent to a runnable command string which is re-dispatched through the normal router. Consequence: **a newly registered route is not automatically rmm-reachable** — it must also be added to the catalog and to the `BuildCanonicalCommand`/`BuildSyntaxTemplate` switches.
- **Catalog-backed NL regex aliases.** Catalog entries may carry a `RegexAliases` array; each alias maps an NL regex onto an already-registered route without any code change. `src/catalog-regex-aliases.js` (`RegisterCatalogRegexAliases`) registers these at startup after all code routes are in place, so aliases can never shadow a primary command pattern. Adding a new NL phrasing for an existing command is therefore a JSON-only change. The `show-me` and `show-me-projects` families use this mechanism as the reference examples. **Scope constraint:** `RegisterCatalogRegexAliases` is only called for the `ChatModule` router; routes that exist only in `RemindersAppMentionHandler` cannot be targeted by catalog `RegexAliases` — the alias will be silently skipped at startup. `validate:commands` enforces this.
- **A bidirectional invariant binds the two layers.** `scripts/validate-command-catalog.js` (`npm run validate:commands`) asserts every registered route has a catalog `RegisteredRoutes` entry and vice versa, and that `HELP.md` exactly matches the generated output. It is **advisory** (not wired into CI, `pretest`, or git hooks).

Adding a help-/rmm-visible command therefore touches four places: (1) register the route in the relevant `CommandRouter`, (2) add a catalog entry whose `RegisteredRoutes` names that route, (3) add the intent to `BuildCanonicalCommand` (and `BuildSyntaxTemplate` if it takes arguments), (4) regenerate `HELP.md`. The `search-projects` command (sugar for `search reminders PROJECT`) is the reference example. Note `search-projects` (deterministic keyword search for PROJECT-tagged reminders) is distinct from `show-me-projects` (LLM grouping of a user's reminders into client + project buckets) — they are complementary, not duplicates.

**Final command-discovery boundary summary.**

| Layer | Owns | Add here when… |
|-------|------|----------------|
| `CommandRouter` (code) | Command execution — handler, permissions, response logic | Adding a new command |
| `data/static/ai/command-catalog.json` — `Aliases`, `IntentPhrases`, `RegexAliases` | NL command discovery — help text, RMM candidates, catalog-driven regex aliases | Adding a new NL phrasing or discoverability for an existing route |
| `data/static/ai/command-normalization.json` — `DirectCommandPatterns` | Command syntax normalization — canonicalizes typed variants before routing | A typed command has multiple valid syntaxes (spacing, key order, hyphen/space) |
| `data/static/deterministic-responses.json` | True canned replies and workspace-specific exact-phrase triggers | Adding a static response (health probe, workspace user-ID trigger) that must not go through AI |

Code-only inline patterns are only acceptable when the behavior cannot be expressed as declarative alias data (e.g., the pattern closes over private module state or requires runtime function logic). Any such exception must be commented in the code.
<!-- ============================================================================
     END MANUAL SECTION: command-catalog-help-rmm
     ============================================================================ -->

<!-- ============================================================================
     BEGIN MANUAL SECTION: local-reminder-export-mirror
     Human-authored. DO NOT auto-generate or overwrite this block. Any doc
     regeneration or RAG re-ingest tooling must preserve everything between the
     BEGIN/END markers verbatim.
     Added 2026-07-15. Owner: hand-curated architecture notes.
     ============================================================================ -->
### Local Reminder Export Mirror (git-pulse-sync)

AEGIS already publishes its live `neochrome` reminder list to disk on this operator's machine — no
SSH tunnel, no Web API auth, no clone needed for local tooling to read the current reminder set:

- **Path:** `$HOME/git-pulse-sync/sync/sleuth/reminders-neochrome.json` (machine-local absolute path; a **synced mirror**, not authoritative).
- **Content:** the `?format=rebalance` export — `{ workspaceName, totalReminderCount, filters: { activeOnly: true }, source, reminders[], exportGeneratedAt }`. Each reminder carries `reminderId`, `state`, `isActive`, `assigneeId`, `reminderMessageText`, `originalChannelName`, `dueDate`/`shouldPostOn`, `githubUrls`, etc.
- **Scope:** `activeOnly: true` — **open reminders only**; no completed/outcome history (that still needs the CompletionStore / Web API path).
- **Freshness:** committed ~every 5–15 min by the `git-pulse-sync` process (`chore(sleuth): publish neochrome reminders export`), so it is near-live.
- **Provenance:** `source.type: "sleuth-reminders-file"` ← AEGIS's own authoritative `data/runtime/reminders/neochrome_reminders.json`.

This is the fast, zero-network read path for any **local** "talk to my reminders" tooling / skill: read the file, synthesize. Do not treat the mirror as a write surface or a source of truth — `data/runtime/` in the running service remains authoritative.
<!-- ============================================================================
     END MANUAL SECTION: local-reminder-export-mirror
     ============================================================================ -->

### Thread Context Memory

When a user uploads a text-readable file alongside an `@Sleuth` mention (or in a thread), `ChatModule.#TryStoreThreadMemoryFileAsync` downloads the file via the Slack file API and stores it in `#ThreadContextMemory` keyed by `"channelID:threadTS"`. For a root message (no `thread_ts`), the key uses `event.ts`; for replies, `event.thread_ts` equals the root's `event.ts`, so the key always resolves to the root message timestamp and survives across reply chains.

File eligibility is decided by `src/context-file-classifier.js` (`SelectContextMemoryFile`), not a bare `.md` check. A file counts as text when **any** of its MIME type (`text/*` or a known textual `application/*`), Slack `filetype` (snippet language tag such as `shell`/`sql`/`markdown`), or name extension (Markdown, plain text, code, logs, CSV/JSON/YAML, SQL, etc.) indicates text. This is deliberately signal-redundant because Slack code snippets routinely arrive with an extensionless name (e.g. `shop2client-a-slowqueries`) but a `text/plain` MIME type and a language `filetype` — name-only matching missed them, which is why snippet uploads silently fell through to an ungrounded "I don't see any files" answer. When a file is attached but none are text-readable (image/PDF/archive), the handler posts a clear "I can only read text-based files" message instead of falling through. The download HTML-error guard (`LooksLikeHtmlErrorPage`) only trips on a leading HTML document marker (`<!doctype html`/`<html`), so genuine text uploads that start with `<` (XML, SVG, HTML fragments, JSX) are not misclassified as a failed download.

The stored entry is persisted immediately to `data/runtime/context-memory/<workspace>_thread_memory.json` (not just on shutdown), so it survives service restarts. On startup, `#LoadThreadMemoryAsync` restores all entries into the in-memory map before Slack begins delivering events.

When generating any reply in a thread, `#GatherThreadContextAsync` looks up the memory for that thread and prepends it to the full thread text as a labeled block:

```
=== Context Memory File: <filename> ===
<file content>
=== End Context Memory ===
```

This combined text becomes the user message sent to the AI. The system prompt in `data/static/ai/chat-instructions.md` instructs the model to treat this block as authoritative, to use it when the user refers to "the attached file" or "the document", and not to claim it cannot see the file when the block is present — a critical guard against the model producing contradictory responses where it simultaneously uses content from the block while telling the user it has no access to the document.

## AI Pipeline

All workspace-scoped AI access is supposed to flow through `src/workspace-ai.js`.

The current contract is:

- default general-purpose model: `gpt-4o-mini`
- complex date extraction model: `gpt-4o`
- provider routing is model-prefix based through `src/ai-providers/index.js`
- OpenAI model parameter policy lives in `src/ai-providers/openai-provider.js` `MODEL_CONFIGURATIONS`
- per-channel chat model overrides are persisted under `data/runtime/workspaces/`
- OpenAI Responses API web search still runs through `WorkspaceAI.ProcessWebSearchAsync()`
- prompt and schema assets live under `data/static/ai/`

Current AI-backed areas include:

- reminder extraction
- reminder date extraction
- deduplication decisions
- general chat replies
- web search responses with source extraction
- live multi-provider model catalog lookups for model-availability questions

Provider behavior:

- `gpt-*`, `o[0-9]-*`, `chatgpt-*`, `codex-*`, and `computer-use-*` route to `src/ai-providers/openai-provider.js`
- `claude-*` routes to `src/ai-providers/anthropic-provider.js`
- `gemini-*` routes to `src/ai-providers/gemini-provider.js`
- unknown model-name prefixes fall back to OpenAI so custom/fine-tuned OpenAI IDs still work
- provider clients are lazy-built per workspace, so unused vendors do not instantiate SDK clients
- provider-aware validation and catalog lookups preserve "not configured", "not found", and "catalog unavailable" as separate states so admin commands do not misreport outages as bad model IDs
- Anthropic calls pass the system prompt as a `cache_control: ephemeral` content block so repeated calls with the same schema-backed instructions (reminder extraction, deduplication, date parsing) receive a prompt-cache hit
- the OpenAI and Anthropic providers wrap their vendor SDKs; the Gemini provider calls the Google Generative Language REST API directly (`generateContent`), passing the key in the `x-goog-api-key` request header rather than as a URL query parameter — the same header convention the Gemini web-search path uses
- the Gemini provider strips JSON Schema keywords its `responseSchema` rejects (`additionalProperties`, `$schema`) so the shared OpenAI-shaped schema assets under `data/static/ai/` work unchanged across all three providers
- the Gemini model catalog (`GetAvailableModelsAsync`) is filtered to the `^gemini-` routing prefix so the provider only advertises models that resolve back to it — the live API also returns `gemma-*`, `lyria-*`, and other non-routable `generateContent` models
- `TestConnectivityAsync` on the Anthropic and Gemini providers returns a typed `code` field (`auth_failed` / `rate_limited` / `overloaded` / `api_error`) in addition to the error message so callers can distinguish transient outages from configuration problems without parsing strings


<!-- ============================================================================
     BEGIN MANUAL SECTION: model-tier-hierarchy
     Human-authored. DO NOT auto-generate or overwrite this block. Any doc
     regeneration or RAG re-ingest tooling must preserve everything between the
     BEGIN/END markers verbatim.
     Added 2026-07-16 (CHANGELOG v1.4.232). Owner: hand-curated architecture notes.
     ============================================================================ -->
### Model Tiers & Resolution Hierarchy

AEGIS resolves models in **tiers**, surfaced by the `models` command. The label in
parentheses is the row shown in that command's output.

1. **First responder / router** *(System router model)* — GH-397. When the per-workspace
   router mode is `shadow` or `active`, `RouterShadowModule` resolves the mention with a cheap
   model first. Model = `ROUTER_SHADOW_MODEL` env → else `DEFAULT_SHADOW_MODEL`
   (`gemini-3.1-flash-lite`). In `active`, if confidence ≥ `ROUTER_ACTIVE_CONFIDENCE_MIN`
   (default 0.7) and it resolves a runnable canonical command, it **executes** (full takeover);
   below threshold / error / needs-clarification it **falls back** to the incumbent resolver. In
   `shadow` it logs a corpus record with zero authority. `off` (the default) skips the tier
   entirely. Mode is in-memory, seeded at startup from `ROUTER_SHADOW_DEFAULT_MODE` and flipped
   live by the admin `router-mode` command. This tier is **independent** of the two below —
   it is not a per-channel/per-provider setting.
2. **Complex model** *(Complex/date extraction model)* — `WorkspaceAI.ComplexModelName`. Used
   for the harder reasoning: RMM intent resolution (the incumbent router the first-responder
   falls back to) and reminder date/slot extraction. Resolution: `COMPLEX_MODEL_NAME` (workspace
   JSON, set by `switch-models:complex='…'`) → provider-aware built-in.
3. **Basic model** *(Channel basic model / Workspace default chat model)* —
   `WorkspaceAI.DefaultModelName`. Used for freeform conversational chat replies. Resolution
   (highest priority first): **per-channel override** (`set-channel-model`, persisted under
   `data/runtime/workspaces/`) → `DEFAULT_MODEL_NAME` (workspace JSON, set by
   `switch-models:default='…'`) → provider-aware built-in. The channel override applies to **this
   tier only** — not the complex or router tiers. *(Renamed 2026-07-16 from "Effective chat model
   here" — it is the basic conversational model, not the extraction model.)*
4. **Web-search model** — `DefaultWebSearchModelName` (`gpt-5.4-mini`), used only by the
   OpenAI Responses web-search answer path.

**Provider-aware built-in fallback** (tiers 2–3, when no explicit model is set):
`#GetPreferredProviderIdForFallbacks` picks the provider by key presence —
`OPENAI_API_KEY` → openai, else `ANTHROPIC_API_KEY` → anthropic, else `GEMINI_API_KEY` → gemini
(else openai). The built-in per provider: basic = `gpt-4o-mini` / `claude-sonnet-4-6` /
`gemini-3.5-flash`; complex = `gpt-4o` / `claude-sonnet-4-6` / `gemini-3.1-pro-preview`
(see `BuiltInDefaultModelNamesByProvider` / `BuiltInComplexModelNamesByProvider` in
`src/workspace-ai.js`). Provider routing for any resolved model id is prefix-based (see
"Provider behavior" above): unknown prefixes fall back to OpenAI.
<!-- ============================================================================
     END MANUAL SECTION: model-tier-hierarchy
     ============================================================================ -->

## Lists Sync Pipeline

`src/lists-module.js` maintains two parallel subsystems for Slack Lists synchronization.

### Shared list

The shared `AEGIS To-do's` workspace list is output-only. Reminders are written to it on creation, update, and deletion. Its inbound poll handlers remain no-op stubs — edits made to this list in Slack have no effect on AEGIS state.

### Per-user lists

Per-user lists are durable and bi-directionally synced. A list is created on demand via `@Sleuth AI generate-list for @user` (backed by `ListsModule.EnsureUserListAsync`). After creation the list is registered under the user's Slack ID, persisted in the v2 cache, and polled on every poll cycle. Subsequent `generate-list` calls resync the existing list in place rather than creating a new one.

List title format: `AEGIS Reminders — @username` (no date stamp). Registry key: Slack user ID.

### Context abstraction

Each list — shared or per-user — is represented by a `ListContext` instance (`src/list-context.js`). `ListsModule` holds:
- `#SharedContext` — the shared list context
- `#UserContexts` — `Map<userID, ListContext>` for per-user lists
- `#ContextsByListId` — `Map<listId, ListContext>` for poll-event routing

### Polling and echo suppression

One `setInterval` drives `#PollAllContextsAsync()`, which iterates all contexts sequentially with ~250 ms inter-context spacing. Each context is polled independently — a failure in one list does not block others.

Echo suppression prevents the bot's own outbound writes from triggering inbound handlers. Every successful outbound row mutation adds the affected row ID to `ctx.EchoSuppressRowIds`. On the next poll, changed rows whose IDs appear in that set are silently dropped and the set is cleared (one-shot). Outbound mutations also update `ctx.ListItemsCache` in place so that even a missed suppression entry produces `HasItemChanged === false`.

### Inbound handlers (user lists only)

- **Row completed** (`#HandleUpdatedListItemAsync`): detects the completion edge (`completed === true` and row was not already completed) → calls `RemindersModule.CompleteReminderFromListAsync(reminderId, 'list-checkbox')`. The per-user row stays as a history record; `ItemCache` drops the entry. The shared list's handler is a no-op.
- **Row deleted** (`#HandleDeletedListItemAsync`): looks up the reminder ID from `ItemCache` → calls `RemindersModule.CancelReminderFromListAsync(reminderId, 'list-row-deleted')`. Rows with no mapped reminder ID (already-completed or unmanaged rows) produce no reminder action.
- **Row added** (`#HandleAddedListItemAsync`): if `reminder_id` is present, adopts the row (maps it in `ItemCache`, no new reminder — covers restart re-surfacing). If absent, Phase 2 create-from-row runs (see below).

### Outbound fan-out

Every outbound reminder mutation (`AddReminderToListAsync`, `MarkReminderPostedAsync`, etc.) writes to the shared context **and** to the assignee's user context if a registered list exists for that user.

The shared list's `DeleteRowOnComplete` is `true` (row is deleted on completion, preserving current behavior). Per-user lists have `DeleteRowOnComplete: false` (row is kept as a history record, marked done).

`RemindersModule.#DeleteRemindersAsync(ids, reason)` routes by reason:
- `'completed'` → `ListsModule.HandleReminderCompletedAsync` (marks done; keeps per-user row, deletes shared row)
- any other reason → `ListsModule.HandleReminderRemovedAsync` (deletes the row from all contexts)

### Phase 2: create reminder from a hand-authored row

A new row in a per-user list that has no `reminder_id` triggers `RemindersModule.CreateReminderFromListRowAsync`. Minimum column contract: **summary** (required) + **due_date** parseable as a JavaScript `Date` (required); **assignee** and **target channel** are optional (default to the row's `created_by` and the list's `AccessChannelID`). The new reminder is queued with `SkipListSync: true` to avoid duplicating the row that just arrived. `ListsModule` then writes the assigned `reminder_id` back into the existing row and creates a fresh shared-list row. Rows missing required fields receive a `needs-info` status marker instead of looping.

<!-- ============================================================================
     BEGIN MANUAL SECTION: operator-clients-list
     Human-authored. DO NOT auto-generate or overwrite this block. Any doc
     regeneration or RAG re-ingest tooling must preserve everything between the
     BEGIN/END markers verbatim.
     Added 2026-07-17 (CHANGELOG v1.4.237). Owner: hand-curated architecture notes.
     ============================================================================ -->
### Operator-Managed Clients List (GH-396)

Separate from the Lists Sync Pipeline above — this Slack List is **not** registered with `ListsModule`/`ListContext` and is never polled. It's read on demand by the `refresh clients` chat command (`src/chat-commands/refresh-clients-command.js`), which pulls rows via `slackLists.items.list` and writes them into a per-workspace runtime overlay (`WriteClientOverlaySync` in `src/client-mapping.js`), merged **extend-only** on top of the static base in `data/static/client-channel-mapping.json` — the overlay can add new clients or extend an existing client's alias/pattern arrays, but can never remove or override a curated base entry (`MergeClientLists`).

Config lives in the base file's `ClientsList` block (`ListId` + a logical→Slack `column_id` `Columns` map — Slack has no fetch-by-name for columns), or `ListId` alone via the `SLEUTH_CLIENTS_LIST_ID` env override. `refresh clients` posts setup help instead of syncing when neither is configured.

**Permission model — the part that's easy to misdiagnose.** The bot's OAuth scopes already include both `lists:read` and `lists:write` — write access is not blocked at the app/scope level. What actually blocks it is Slack's **per-resource** List ACL: `slackLists.items.list`, `slackLists.items.create`, and even `slackLists.access.set` all return `list_not_found` (not a permission/scope error) when the bot has zero prior visibility into that specific list ID — the same way a bot that's never been invited to a private channel can't see it exists. There is no API path to bootstrap access from zero visibility; `slackLists.access.set` can only grant access to a list the caller can already see. **A session that hits `list_not_found` on one list should not conclude the bot lacks write permission generally** — it means the bot has no relationship yet with *that specific list ID*.

Two ways to establish that relationship:
1. **A human shares the list** via Slack's List "Share" dialog, adding the bot user directly. This can silently fail with *"Sending messages to this app has been turned off"* — a Slack-side per-user or app-level messaging restriction, not a AEGIS bug; the fix lives in Slack's UI (open the bot's own DM thread and re-enable messages) or the workspace Admin console's app-management settings, not in this codebase.
2. **AEGIS creates the list itself** via `slackLists.create` (passing the desired column `schema`) and immediately self-grants access via `slackLists.access.set` — the same mechanism `ListsModule` already uses for per-user reminder lists (`#CreateListWithReminderSchemaAsync`). This sidesteps the sharing wall entirely, and the create response's `list_metadata.schema` hands back the real `column_id`s directly with no separate lookup step.

Production state (`neochrome`): list `F000EXAMPLE1` was created via path 2, so the bot already has write access to it and can both read rows (`refresh clients`) and write new ones (used once for a first-pass backfill from local git history).
<!-- ============================================================================
     END MANUAL SECTION: operator-clients-list
     ============================================================================ -->

## Persistence Pipeline

AEGIS is file-based, not database-backed. Runtime state lives under `data/runtime/`.

Key paths:

- workspaces: `data/runtime/workspaces/<WORKSPACE_NAME>_workspace.json`
- channel model overrides: `data/runtime/workspaces/<WORKSPACE_NAME>_channel_models.json`
- reminders: `data/runtime/reminders/<WORKSPACE_NAME>_reminders.json`
- reminder counter: `data/runtime/reminders/<WORKSPACE_NAME>_reminder_counter.json`
- enabled channels: `data/runtime/reminders/<WORKSPACE_NAME>_enabled_channels.json`
- stats: `data/runtime/stats/<WORKSPACE_NAME>_stats.json`
- settings: `data/runtime/settings.json`
- lists cache: `data/runtime/workspaces/lists/<WORKSPACE_NAME>_lists_cache.json` — v2 format `{ version:2, shared:{listId,listSchema,itemCache,lastSync}, userLists:{<userID>:{listId,listSchema,itemCache,lastSync,ownerUserID,accessChannelID,displayTitle}} }`; legacy flat (no `version` key) is migrated on first load
- thread context memory: `data/runtime/context-memory/<WORKSPACE_NAME>_thread_memory.json`

The persistence rule is strict multi-tenant isolation by workspace name. New code should derive file paths through existing helpers rather than building ad hoc paths.

## Web API Pipeline

`src/web-api.js` provides the management plane. It serves:

- workspace CRUD
- workspace existence checks
- workspace reminder retrieval
- workspace stats retrieval
- settings storage
- admin auth-status, login, logout, forgot-password, and reset-password flows
- normalized reminder export options through `GET /workspace/:name/reminders?format=rebalance&activeOnly=true&state=...`

Auth model:

- `/admin/*` routes use admin session auth
- non-admin routes use the configured bearer token
- current API response contract is HTTP 200 with `{ success, data }`

## Testing Pipeline

AEGIS has three practical test layers.

### 1. Local verification

Primary commands:

- `npm run build` for `checkJs` type safety
- `npm test` for unit and integration coverage
- `npm run validate:ai` when prompt or schema assets change

This is the main regression net and should catch most logic, parsing, and module-integration bugs before live testing.

### 2. Mock Slack harness

The Layer 2 harness is `tests/mocks/mock-slack-app.js`.

It mirrors the AEGIS wrapper contract closely enough to test:

- handler registration and dispatch chaining
- message, app mention, and reaction simulation
- Slack output capture through in-memory `SentMessages`, `SentBlockMessages`, reactions, updates, and deletions
- module behavior without connecting to a real Slack workspace

This is the preferred layer for repeatable Slack-flow regression coverage.

### 3. Real Slack smoke tests

AEGIS currently has two live-workspace operator surfaces:

- `@Sleuth AI run-tests` in Slack for an admin-only full Jest run
- `npm run slack:harness:post -- ...` for a one-shot real Slack post through the AEGIS wrapper

These are smoke-test layers, not the primary test strategy.

## One-Shot Slack Harness

The new single-post harness is `scripts/slack-harness-post.js`.

Purpose:

- allow a VS Code agent or operator to perform a narrow, real-workspace Slack smoke test
- reuse AEGIS’s Slack wrapper behavior without starting the long-lived Socket Mode event loop

Safety model:

- dry-run by default
- explicit `--execute` required for a live post
- exactly one of `--text` or `--text-file`
- exact channel validation before any live post
- single global lock file to prevent concurrent harness runs
- hard timeout with process exit on overrun
- fixed harness message prefix: `[sleuth-harness:<workspace>]`
- no background worker mode
- no arbitrary shell execution
- no inbound event simulation against the live process

Examples:

```bash
npm run slack:harness:post -- --workspace MY_WORKSPACE --text "hello"
npm run slack:harness:post -- --workspace MY_WORKSPACE --channel sleuth-test --text "hello" --execute
npm run slack:harness:post -- --workspace MY_WORKSPACE --channel-id C123ABC456 --thread-ts 1712345678.123456 --text "reply" --execute
```

The harness uses `SlackApp.ConnectOneShotAsync()` to authenticate with Slack through `auth.test`, populate the bot identity fields, and then stop cleanly without opening the normal event listener.

## Reconcile Scripts

`scripts/reconcile-channels.js` and `scripts/reconcile-users.js` are read-only inventory probes against the Slack Web API. They were added to help populate `data/static/client-channel-mapping.json` and to audit per-tenant Slack metadata (e.g. confirm a private channel ID before adding it to a client mapping).

Purpose:

- enumerate every channel or user visible to a workspace's bot token
- write a sorted JSON inventory to stdout or `--out <path>` for inspection or downstream tooling

Safety model (looser than the one-shot Slack harness because there is no write surface):

- pure read-only — calls only `conversations.list` and `users.list`
- no `--execute` flag, no lock file, no safety prefix — they cannot mutate Slack state
- token resolution priority: `--token <xoxb-...>` > `SLACK_BOT_TOKEN` env var > `--workspace <name>` (loads `LIVE_TOKEN` from the workspace JSON, same as the live app)
- output is workspace-scoped by Slack token; cannot leak across tenants

Examples:

```bash
node scripts/reconcile-channels.js --workspace neochrome --out /tmp/channels.json
node scripts/reconcile-users.js    --workspace neochrome --exclude-bots --exclude-deleted --out /tmp/users.json
```

When running against multiple workspaces sequentially, use distinct `--out` paths per run (e.g. `/tmp/<workspace>-channels.json`) — the default behavior is to overwrite.

## Recommended Usage

Use the test layers in this order:

1. `npm run build`
2. targeted or full `npm test`
3. `npm run validate:ai` when AI assets changed
4. `@Sleuth AI run-tests` or `npm run slack:harness:post -- ...` only when you need real-workspace confirmation

That ordering keeps live-workspace checks narrow and intentional, while the repeatable logic coverage stays in Jest where it belongs.
