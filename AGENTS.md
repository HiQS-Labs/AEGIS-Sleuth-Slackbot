# AGENTS.md - Checklist-Driven Architecture Guide (AEGIS Node.js/Bolt/OpenAI/Express)

Attention LLMs: Claude, Open AI/Chat GPT, and Google Gemini.
This file provides canonical guidance to AI agents working in this repository.

> **PDDA startup note:** On your first action in this repo, follow the sequence in `ROUTER.md`
> before recommending or editing anything — it names the canonical files and read order (including
> this file). Re-run it (or `/pdda`) when you switch tasks, resume a long session, or feel context
> has drifted. See `GUIDING-PRINCIPLES.md` for the doc-governance north star PDDA's checks answer to.

**Version:** 2.0  
**Last Updated:** 2026-04-29  
**Last Audited:** _not yet audited_  
**Purpose:** Preserve AEGIS architecture contracts while enabling safe iterative delivery.

---

## TL;DR) Read This First (Non-Negotiables)

- Before starting a fresh code-search pass in a new session, first consult `ARCHITECTURE.md`, then `CHANGELOG.md` and `PROJECT/` for prior art. Prefer reading those over a broad grep.
- This repo is a **Node.js JavaScript backend**, not a React/Vite frontend.
- Core stack: **Slack Bolt + OpenAI + Express + optional Notion API**.
- Multi-tenant isolation is file-based using workspace-scoped JSON under `data/runtime/` (not Supabase/RLS).
- **Live reminders are mirrored locally, ready to read.** AEGIS's `neochrome` reminder list is published to `$HOME/git-pulse-sync/sync/sleuth/reminders-neochrome.json` (the `activeOnly:true` `?format=rebalance` export, refreshed ~every 5–15 min by `git-pulse-sync`). For any **local** tooling that needs the current reminder set — e.g. a "talk to my reminders" skill — read this file directly: no clone, no SSH tunnel, no Web API auth. Open reminders only (no completed history); it is a synced mirror, so `data/runtime/reminders/neochrome_reminders.json` in the running service stays authoritative. See ARCHITECTURE.md → "Local Reminder Export Mirror".
- Route Slack events through `src/slack-app.js` handler registration APIs.
- Route AI calls (OpenAI, Anthropic Claude, future Gemini) through `src/workspace-ai.js`; do not create ad-hoc provider clients in feature modules. WorkspaceAI dispatches to `src/ai-providers/` based on model name prefix.
- Use `npm run dev` and `npm run build`; do not introduce Bun-only core workflows.
- Follow `docs/coding-conventions.md` conventions.
- Log intentional architecture violations in `CHANGELOG.md` with `#lessonslearned`.

## 0) How To Use This Doc

- Treat each section as a pass/fail checklist.
- Mark items done only with code evidence (files, runtime behavior, logs, or docs updates).
- Follow order: pre-build -> build contract -> post-build -> continuous loop.
- Prefer small change clusters: implement, verify, then proceed.

## 0.1) AI Agent Working Guardrails

- On each new session, orient with `ARCHITECTURE.md` first and prefer the local RAG corpus for repo-level context before broad codebase searches.
- Edit surgically; do not rewrite unrelated areas without explicit request.
- Check existing modules before creating new modules/services/helpers.
- Prefer extending current contracts instead of introducing parallel abstractions.
- If a pattern is unclear, inspect `src/` and align with existing behavior.
- **Always follow the existing proven pattern.** Before adding a route, handler, module, or helper, find the closest existing one of the same kind and mirror it exactly — same construction, same wiring, same ownership. If you find yourself deviating (a global, a singleton, a side-channel registry) to make something work, stop: the deviation is a bug, not a shortcut. New patterns need an explicit, reviewed reason recorded in `CHANGELOG.md`.
- **Never resolve per-workspace state through module-level globals or singletons.** Every workspace runs in the same process; a `global.*`/static keyed by anything shared across workspaces (logger, team id, etc.) will collide and silently bind to the wrong tenant. Pass the owning `SlackApp` (or its module) in explicitly and close over it — this is the multi-tenant isolation contract. *(See #384: `ask-reminders` resolved its `SlackApp` from a global registry and answered every workspace from the first-loaded one.)* This class of bug is guarded structurally by `npm run validate:workspace-isolation` (`scripts/validate-workspace-isolation.js`), which fails on global-singleton state reads and on primary routes registered outside `RegisterCommandRoutes`; reviewed exceptions carry an inline `// ISOLATION-OK: <reason>` pragma (mirrors `// FSM-BACKFILL-OK`).
- **Render reminder lists ONLY through the canonical per-reminder poster.** Any command or flow that shows a user a list of reminders (`ask-reminders`, `show-me`, digests, "what's open") must delegate to `PostRemindersListAsync` / `PostBucketedReminderSectionsAsync` (`src/reminders-display-utils.js`) — never hand-roll a text blob, and never let a model phrase the list. Each reminder is then its own message carrying the `sleuth-ai-reminder-ids` metadata the reaction-handler needs for per-item ✅/🗑. **Internal reminder ids (`id:<uuid>`) are model-facing debug context only — never user-facing.** *(See #391: `ask-reminders` posted a model-authored blob with raw `id:` prefixes instead of individual reactable messages.)* Guarded by `npm run validate:reminder-render` (`scripts/validate-reminder-render.js`), which fails on a raw `id:${…}` construction and on a prompt instructing the model to cite reminder ids; model-input renders carry an inline `// RENDER-OK: <reason>` pragma.

### 0.1.1) Canonical command-route pattern (follow verbatim)

Every Slack chat command is registered inside `ChatModule#RegisterCommandRoutes()`, and its `Handle` **closes over `this.#SlackApp`** (the per-workspace instance ChatModule was constructed with):

```js
Router.Register({
  Pattern: /^my-command\b[\s,:;.!?]+(.+)/is,
  Route: 'my-command',
  Handle: (ArgEventInfo, ...ArgCaptures) => HandleMyCommandAsync(this.#SlackApp, ArgEventInfo, ...ArgCaptures),
});
```

Catalog-driven NL aliases (`data/static/ai/command-catalog.json` → `catalog-regex-aliases.js`) may delegate to an already-registered route, but the **primary** route always lives in `#RegisterCommandRoutes` with the closure above. Do not register a primary route from outside ChatModule, and do not fetch the `SlackApp` from anywhere other than the closure. `npm run validate:commands` guards the catalog; the closure discipline is on you.

### 0.1.2) Module primitive — `BaseModule` (extend it for new modules)

`src/base-module.js` is the first-class per-workspace module primitive. **New feature modules extend `BaseModule`** rather than re-deriving the convention by hand. It makes tenant isolation structural: the owning `SlackApp` is mandatory at `super(ArgSlackApp)`, and workspace state is reached only through `this.SlackApp` / `this.Logger` / `this.WorkspaceInfo` / `this.WorkspaceName` and the owned `this.CommandRouter` — so there is no global to reach for (the #384 failure mode). Register Slack handlers via `this.RegisterAppMention/Message/Action/ReactionAdded(...)` (they `.bind(this)`), override `RegisterCommandRoutes()` + `StartAsync()` / `StopAsync()`, and keep constructors synchronous (disk I/O in `StartAsync`). Existing modules (`chat`, `reminders`, `lists`, `notion`, `stats`) use the equivalent hand-rolled convention and migrate incrementally. Full contract + worked example: `docs/module-primitive.md`.

## 0.2) Dependency And Import Contract

- Keep dependency direction one-way: orchestrator (`app.js`) -> modules (`chat/reminders/lists/notion/stats`) -> helpers/utilities.
- Reuse shared utilities (`workspaces`, `date-utils`, `slack-format-utils`, loggers) before adding new helpers.
- Avoid circular imports between feature modules.
- Preserve ownership boundaries:
  - `SlackApp` owns Slack SDK wiring and event fan-out.
  - `WorkspaceAI` owns OpenAI API calls and model settings.
  - `Workspaces` owns workspace file validation/load/save/delete.
  - `WebAPI` owns REST surface for workspace/settings management.

## 0.3) Build Break Recovery Protocol

- Capture failing command and first actionable error.
- Isolate the latest change that introduced failure.
- Fix the smallest root cause first (contract/path/import/type mismatch before refactor).
- Re-run failing command, then full verification checklist.

## 1) Pre-Build Checklist (Before First Feature)

- Define which existing module should own behavior (`chat`, `reminders`, `lists`, `notion`, `stats`, `web-api`, etc.).
- Define tenant scope impact (workspace config, reminders, stats, lists cache, settings).
- If adding/changing workspace fields, update:
  - `src/workspaces.js` typedef + validation.
  - request examples in `docs/web-api.md`.
  - templates in `config/` when relevant.
- If changing AI behavior, identify impacted instruction/schema files in `data/static/ai/`.
- If changing disk-persisted structures, include backward-compatible reads for legacy JSON.

## 2) Runtime Build Contract Checklist (Current Repo Rules)

- `src/app.js` remains the orchestration entry point.
- New Relic load (`require('newrelic')`) stays first in startup path.
- `SettingsModule` starts before Web API startup.
- Per-workspace startup order remains:
  1. Load and validate workspace via `workspaces`.
  2. Create `SlackApp`.
  3. Start `StatsModule` first.
  4. Create `ListsModule`, `RemindersModule`, and `NotionModule`.
  5. Start `PluginLoader` before `ChatModule` so plugin mention handlers register first.
  6. Create `ChatModule`.
  7. Start `ChatModule`, then `SlackApp`, then `RemindersModule`, then `ListsModule`, then `NotionModule`.
- Register handlers through:
  - `HandleReactionAdded(...)`
  - `HandleAppMention(...)`
  - `HandleMessage(...)`
- Handler contract: return `true` only when handled; return `false` to allow downstream handlers.
- Preserve graceful shutdown and final persistence in module `StopAsync()` calls.
- Reminder snooze guard invariant:
  - Any code path that can post reminders (scheduled, digest, manual/admin, or future pipeline) must call `#ShouldSuppressForSnooze(...)` in `src/reminders-module.js`, or document an explicit bypass reason in code comments and in `CHANGELOG.md`.
- Reminder FSM invariants — three rules, no exceptions:
  1. **Creation:** Always build new `ReminderInfo` objects through `#MakeScheduledReminder(fields)`. Never construct an inline object literal with `State`, `IgnoreSnooze`, `ReminderID`, or `CreatedOn` — the factory owns those. If you pass them in `fields` they will be silently overwritten by the factory's invariants.
  2. **Scheduling gateway:** New event-driven scheduling paths must call `#TryScheduleRemindersAsync` via the injected callback (available on `RemindersAppMentionHandler` and `RemindersReactionHandler`). Do not call `#QueueReminderAsync` directly — doing so skips AI analysis, dedup, date extraction, channel resolution, and the `#MakeScheduledReminder` invariants.
  3. **State transitions:** After creation, `reminder.State` may only be changed via `#TransitionReminderState(reminder, nextState, reason)`. Never assign `reminder.State` directly. The `reason` string becomes the FSM audit log entry — make it descriptive.
  - See `ARCHITECTURE.md` § *Reminder FSM and Write-Path Contract* for the full approved-caller list and decision table.
  - These rules are enforced structurally by `npm run validate:fsm` (`scripts/validate-fsm-invariants.js`), which scans `src/reminders-module.js` and fails on any direct `.State =` assignment outside `#TransitionReminderState` / `#MakeScheduledReminder`, or any inline `ReminderInfo` cast outside `#MakeScheduledReminder`. Legitimate legacy backfill paths (e.g. promoting un-stated reminders loaded from disk) carry a `// FSM-BACKFILL-OK` line pragma so each exception is reviewable. Run the validator before raising a PR that touches the reminder write path.
  - The sibling `npm run validate:workspace-isolation` guard (`scripts/validate-workspace-isolation.js`) enforces the multi-tenant isolation contract from §0.1 the same way: scan `src/**/*.js`, flag global-singleton state reads and primary routes registered outside `RegisterCommandRoutes`, honor an `// ISOLATION-OK:` pragma, report file:line, exit non-zero on any violation.
  - The sibling `npm run validate:reminder-render` guard (`scripts/validate-reminder-render.js`) enforces the reminder-render contract from §0.1 the same way: scan `src/**/*.js`, flag a raw `id:${…}` construction and a prompt instructing the model to cite reminder ids, honor a `// RENDER-OK:` pragma, report file:line, exit non-zero on any violation. All three guards run under `npm test` via their `tests/validate-*.test.js` "tree is clean" assertion.

## 3) AI Integration Contract Checklist

- AI access goes through `WorkspaceAI` only — feature modules must not instantiate OpenAI / Anthropic / Gemini SDK clients directly.
- `WorkspaceAI` dispatches to a provider implementation under `src/ai-providers/` based on the requested model name prefix:
  - `gpt-*` / `o[0-9]-*` / `chatgpt-*` / `codex-*` / `computer-use-*` → `src/ai-providers/openai-provider.js`.
  - `claude-*` → `src/ai-providers/anthropic-provider.js` (requires `ANTHROPIC_API_KEY` on the workspace).
  - Unknown prefixes fall back to the OpenAI provider so custom/fine-tuned IDs still work.
- Adding a new provider (e.g. Gemini chat) means: implement the `AIProvider` interface, append an entry to `Providers` in `src/ai-providers/index.js`, and add the workspace API-key field to `src/workspaces.js`. No existing feature module needs to change.
- Default model for general tasks remains `gpt-4o-mini` unless intentionally changed via `model-switch:default='...'` (per-workspace persisted).
- Complex date extraction uses `gpt-4o` unless intentionally changed via `model-switch:complex='...'`.
- Keep OpenAI-specific model parameter logic centralized in `MODEL_CONFIGURATIONS` (`src/ai-providers/openai-provider.js`).
- Prompt/instruction files remain in `data/static/ai/`:
  - `chat-instructions.md`
  - `reminders-instructions.md`
  - `reminders-dedup-instructions.md`
  - `date-extraction-instructions.md`
- Schema-driven responses must keep instruction and schema files in sync. The OpenAI `{name, strict, schema}` schema envelope is reused for Claude — the Anthropic provider unwraps it.
- Deterministic pre-AI behavior remains in `data/static/deterministic-responses.json`.

## 4) Canonical Inventories And Config Homes

- `AGENTS.md` is contract-only: do not mirror persistence inventories, endpoint lists, workspace field tables, or system maps here.
- `ARCHITECTURE.md` owns the system map, startup pipeline, reminder write-path contract, and persistence inventories.
- `ARCHITECTURE-DECISIONS.md` owns the regenerated architecture snapshot; treat it as graph-derived reference, not hand-maintained policy.
- `docs/web-api.md` owns REST endpoint, auth, and request/response inventories.
- `src/workspaces.js` owns workspace field definitions, required/optional validation, and backward-compatible read rules; `docs/web-api.md` owns the request examples that exercise those fields.
- Keep only repo-wide behavior flags here when they materially change runtime behavior across modules.

## 6) Code Conventions Checklist

The project follows conventions in `docs/coding-conventions.md`:

- Multi-word identifiers are PascalCase.
- Class names are PascalCase.
- Async functions end with `Async`.
- Parameter names use `Arg` prefix.
- Catch variables are named `error`.
- Single-line comments start with `// `, lowercase first word, and end with a period.
- Single-line conditionals do not use braces.
- JSDoc avoids "The" prefix and avoids hyphens before descriptions.

Keep `npm run build` passing (`checkJs` + `noImplicitAny` workflow).

## 7) Observability And Error Handling Checklist

- Use module logger patterns consistently (`CombinedLogger` + Slack logger interfaces).
- Keep startup connectivity diagnostics for Slack/OpenAI intact.
- Log actionable context: workspace name, channel/message/reminder IDs when available.
- Wrap async file/network boundaries in try/catch with explicit failure logs.
- Timers (`setTimeout`/`setInterval`) must be clearable and cleaned up on shutdown.

## 8) Post-Build Verification Checklist

- Type check:
  - `npm run build`
- Runtime smoke:
  - `npm run dev`
- AI prompt/schema validation (when AI assets changed):
  - `npm run validate:ai`
- Startup regression tests (when reminder lifecycle or FSM changed):
  - The `startup with stale reminders` suite in `tests/reminders-integration.test.js` seeds overdue reminders to disk, loads via `StartAsync`, and triggers `process reminders now` to verify post counts and persisted state.
  - Any change to `#CheckRemindersAsync`, `#LoadRemindersAsync`, rescheduling logic, or FSM transitions should include a corresponding startup test case.
  - See `docs/reminder-fsm-audit.md` § *Startup regression test coverage* for the full test matrix.
- Manual checks in a test Slack workspace:
  - App mention chat flow.
  - Reminder creation from natural language.
  - Reminder cancel/complete reaction flows.
  - Optional Notion search flow when `NOTION_TOKEN` exists.
  - Web API bearer auth and workspace CRUD.
- If behavior changed, bump `package.json` version and update `CHANGELOG.md`.

## 9) Continuous Audit -> Fix -> Iterate Checklist

- Audit runtime logs for errors, retries, and noisy loops.
- Review runtime JSON data for drift/corruption risks.
- Prioritize by user impact and recurrence.
- Ship fixes in small diffs, then rerun verification checklist.
- Record lessons in `CHANGELOG.md` with `#lessonslearned`.

## 10) Breaking Change Management Checklist

**Definition:** A breaking change causes current Slack/API/workspace consumers to fail without their own code/config updates.

### Severity Tiers

| Tier | Scope | Examples | Handling |
|---|---|---|---|
| Critical | Persistence/API contract | Workspace JSON field removal/rename, web API response shape changes | Requires migration plan and rollback path |
| High | Runtime behavior contract | Event handler ordering changes, module startup order changes | Requires explicit compatibility review |
| Moderate | Operator workflow contract | Changed env var expectations or setup steps | Requires docs and deployment note updates |

### Pre-Merge Gate

- Search all call sites of changed contracts.
- Add compatibility/backfill logic for disk-persisted data changes.
- Re-run verification checklist and manual Slack workflow checks.
- Update `CHANGELOG.md` with migration/rollback notes for high/critical changes.
- For reminder pipeline changes, include reviewer confirmation that snooze behavior is preserved:
  - `#ShouldSuppressForSnooze(...)` is used in the path, or a documented and approved bypass exists.

## 12) Process Environment Flags

- `REMINDER_TEXT_SYNTHESIS` — controls whether reminders display an AI-rewritten "task title" or the **original Slack message verbatim**. Default (unset) and any non-truthy value (`off`/`false`/`0`/`disabled`/blank) = **OFF** → original text preserved. Set to `on`/`true`/`1`/`yes`/`enabled` (case/space-insensitive) to re-enable LLM title synthesis. Affects only the displayed task text (digest summary + "Key task(s)" bullet); detection, date extraction, dedup, and triage are unaffected. See `RemindersAIPipeline.IsTextSynthesisEnabled()`.

## 13) Key Features

### Reminder System
- Automatic actionable-language detection.
- Displayed task text preserves the **original message verbatim** by default; AI title synthesis is opt-in via `REMINDER_TEXT_SYNTHESIS` (see Process Environment Flags).
- Manual reminder creation via `:alarm_clock:` reaction.
- Reminder cancellation via `:wastebasket:` reaction.
- Duplicate detection with gemini emoji indicator.
- Per-channel enable/disable settings.

### Chat Integration
- Direct mention handling for chat interactions.
- Hands-free mode for continued conversation.
- Context-aware responses with thread history.
- Timezone queries and calculations.

### Notion Integration
- Notion search command via mention.
- Returns top results with direct links.

## 14) Common Tasks

### Adding New Workspace
1. Use Web API `POST /workspace` with required configuration.
2. Restart service: `systemctl restart sleuth-app.service`.

### SSH Access To Servers

Canonical deployment and SSH instructions live in
`docs/server-installation-guide.md` under:

- `Routine Deployments`
- `Operator SSH Access From This Machine`

Use that document as the source of truth for:

- Vultr hostnames and secrets-file paths
- the password-metacharacter gotcha
- the safe `sshpass -e` flow

Quick reminders for agents:

- App checkout on the server: `/root/sleuth-app`
- Service name: `sleuth-app.service`
- `PubkeyAuthentication=no` is required when using `sshpass`

### OCI ARM64 Test VM (Cactus / Needle sandbox)

A throwaway Oracle Cloud **Always-Free ARM64** VM (Ubuntu 24.04 aarch64, 4 OCPU / 24 GB) exists on
this machine's operator for experimenting with the Cactus engine / Needle 26M model and for standing
up a disposable copy of the AEGIS stack. It is **personal and local-only** — not part of any
deployment contract. Full connection details, resource OCIDs, relaunch, and teardown commands live in
the git-excluded local record:

- `OCI-TEST-VM.local.md` (repo root; ignored via `.git/info/exclude`)
- SSH key: `oci-sleuth-vm` / `oci-sleuth-vm.pub` (also git-excluded)
- Relaunch on capacity errors: `oci-retry-launch.sh`

These files are absent on any fresh clone — this pointer just tells a future session where to look if
they are present. For real deployment/SSH, use `docs/server-installation-guide.md` above, not this VM.

### Viewing Logs
- Development: console output via `npm run dev`.
- Production: `journalctl --unit=sleuth-app --follow`.
- New Relic: `newrelic_agent.log`.

### Adding Command Aliases or NL Phrasings

For an **existing command** (route already registered), do not add a new `Router.Register(...)` block in source code. Configure in `data/static/ai/command-catalog.json` instead:

- **Exact-text aliases** (RMM reachability, `commands` list): add to the entry's `Aliases` array.
- **Natural-language intent phrases** (RMM candidate broadening): add to `IntentPhrases`.
- **Regex-matched deterministic NL phrasings** (route without AI involvement): add to `RegexAliases` with `Pattern`/`Flags`/`Route`/`Args`. The `Route` must be registered in `ChatModule`; routes registered only in `RemindersAppMentionHandler` cannot be targeted (see ARCHITECTURE.md scope constraint).

After any catalog change run `npm run validate:commands`. If the entry has `IncludeInHelp: true`, also run `node scripts/generate-help.js`. For a **brand-new command** (new handler + new route), see the four-touchpoint checklist in ARCHITECTURE.md § *Command Catalog, Help, and RMM Intent Resolution*.

### Modifying AI Behavior
- Chat instructions: `data/static/ai/chat-instructions.md`
- Reminder detection: `data/static/ai/reminders-instructions.md`
- Date extraction: `data/static/ai/date-extraction-instructions.md`

### Backup And Maintenance
- Data backup: `./backup-sleuth-data.sh`
- Configuration templates: `config/workspace-template.json`, `config/servers.json`

## 15) Anti-Patterns To Avoid

- Introducing React/Vite/Supabase assumptions into this backend-focused repo.
- Bypassing `workspaces.js` for workspace file naming/validation.
- Creating additional OpenAI / Anthropic / Gemini SDK clients outside `workspace-ai.js` or `src/ai-providers/`.
- Hardcoding workspace names, channel IDs, or secrets in source.
- Changing web API contracts without updating docs and consumers.
- Adding architecture rules to this file without code evidence.
- **Registering new NL command phrasings as inline `Router.Register(...)` blocks when the target route already exists.** Add the phrasing to `Aliases`, `IntentPhrases`, or `RegexAliases` in `data/static/ai/command-catalog.json` instead. Code-only aliases are invisible to `rmm`, help generation, and `validate:commands`. The only accepted exception is a pattern that requires runtime function logic or closes over private module state — if that applies, document the exception in code comments and note it in `CHANGELOG.md`.

## Architectural Baseline (current state)

_Diagnosed, not prescribed — this reflects how the repo actually works today, not a target._

**Closest camp:** The Radical Pragmatists (Worse is Better / KISS)

**Evidence** (cross-checked via `/consult` against Codex + agy, both independently confirmed the label — see `relay-system/2026-07-03/arch-diagnosis-214750/` and `relay-system/2026-07-03/arch-diagnosis-codex-retry-215312/`):
- Flat, majestic-monolith `src/` layout (49 files directly under `src/`, no `domain/`/`adapters/`/`ports/`/`services/` boundaries); large single-file domain modules carry most of the logic directly rather than being decomposed — `reminders-module.js` (2867 lines), `lists-module.js` (2896 lines), `chat-module.js` (2207 lines), `slack-app.js` (1607 lines).
- File-based persistence instead of a database for the whole app: workspace-scoped JSON under `data/runtime/<kind>/<WORKSPACE_NAME>_<kind>.json`, explicitly chosen over Supabase/RLS (AGENTS.md line 25; ARCHITECTURE-DECISIONS.md TRADEOFFS notes "no transactions/migrations... acceptable at current scale").
- Direct framework/SDK usage from feature modules (`@slack/bolt`, `express`, `openai`) with no repository/gateway abstraction layer. A handful of pragmatic registry-style seams exist (`src/ai-providers/index.js`'s `AIProvider` typedef with 3 providers, `src/web-search-providers.js`'s `WebSearchProvider` registry, `src/chat-command-router.js` + `src/catalog-regex-aliases.js`), but these are plain-array dispatch tables, not a layered DI/ports-and-adapters system.
- Slack event dispatch is a synchronous, ordered handler chain with short-circuit (`GitHubCommentRelay → RemindersModule → ChatModule`, first non-false wins) rather than pub/sub, message queues, or CQRS — no `EventEmitter`, no queue client in `package.json`.
- TypeScript is used only as a JSDoc checker over plain `.js` (`checkJs: true`, `noImplicitAny: true`, no `strict: true`); no property-based tests (fast-check/jsverify absent); `zod`/`ajv` are not used directly in `src/` — the copies in `node_modules` come from `@modelcontextprotocol/sdk` (a dependency of the separate `mcp/` server) and as an optional peer of `openai`, not from app code.

Note: one localized exception stands out against this baseline — the reminders module enforces a hand-rolled FSM through three named write chokepoints (`#MakeScheduledReminder`, `#TryScheduleRemindersAsync`, `#TransitionReminderState`), mechanically checked by `scripts/validate-fsm-invariants.js` and covered by a dedicated `reminders-fsm-invariants.test.js`. This is real Correctness-Zealot-flavored rigor, but it's confined to one subsystem rather than pervasive across the repo, so it doesn't unseat Pragmatism as the dominant, load-bearing pattern — it reads as "keep everything simple except the one state machine that has bitten us before."

**What this camp optimizes for (extracted verbatim):**
Simplicity is the default (Pragmatism). Build the simplest thing that satisfies the stated requirement and nothing more — no interface with one implementation, no config for a value that never changes, no scaffolding "for later." Reach for the standard library before custom code and a native platform feature before a dependency. Ship the lazy version and question extra scope in the same breath; do not relitigate an explicit requirement, only the machinery around it. Simplicity governs unless the Precedence stack gives another principle a specific reason to override.
