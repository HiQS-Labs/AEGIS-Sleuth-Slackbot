---
title: P1 — Sleuth Open-Core Split (sleuth-core OSS + premium plugins)
created: 2026-05-20
updated: 2026-05-20
branch: docs/p1-split-project-plan
status: Planning — deferred·vision; not started. Strategic dependency substrate for P3 event-sourced core.
owner: noel
model: open-core
phases: 7
complexity: 4
risk: 3
effort: 5
goal: >-
  Split Sleuth into one free, open-source core (sleuth-core) plus paid,
  closed-source premium add-on plugins. The codebase is already plugin-shaped
  (PluginLoader, CommandRouter, the provider registries), so the work is
  naming and hardening the seam, not rebuilding architecture.
---

# Sleuth Open-Core Split — Project Plan

## Status

| What was just completed | What's next |
|---|---|
| Plan authored (2026-05-20): 7-phase open-core cleavage on the already-plugin-shaped codebase. Not started. | Deferred·vision — hold until the [P3 event-sourced core](P3-EVENT-SOURCED-CORE.md) seam settles (a log-based core is cleaner to split); revisit at a decision gate before committing. |

## Table of Contents

- [Overview](#overview)
- [The Cleavage Plane](#the-cleavage-plane)
- [Phase 0: Foundations and Decisions](#phase-0-foundations-and-decisions)
- [Phase 1: Freeze the Plugin Contract](#phase-1-freeze-the-plugin-contract)
- [Phase 2: Plugin-Extensible Chat and Persistence](#phase-2-plugin-extensible-chat-and-persistence)
- [Phase 3: Invert the app.js Orchestration](#phase-3-invert-the-appjs-orchestration)
- [Phase 4: Extract the Premium Plugins](#phase-4-extract-the-premium-plugins)
- [Phase 5: Package, Licensing, and Repo Split](#phase-5-package-licensing-and-repo-split)
- [Phase 6: Hardening and Growth](#phase-6-hardening-and-growth)

## Overview

This plan splits Sleuth from one multi-tenant service into an **open-core** product:

- **`sleuth-core`** — **one free, open-source** Slack-bot core anyone can self-host BYOK (bring-your-own API key).
- **Premium plugins** — **paid, closed-source** add-on packages (reminders, lists, RAG, …) that snap into core through a stable plugin contract.

The core is the free OSS project; **every premium capability is a separately-licensed paid add-on**. The codebase is already mostly plugin-shaped — `PluginLoader` + `data/plugin-registry.json`, the `CommandRouter` (`src/chat-command-router.js`), and the provider / web-search registries — and `src/plugins/echo-command/` is already a working reference plugin. The work is **naming and hardening the seam**, not rebuilding architecture.

Phase 1 is the keystone: once the plugin contract is frozen and `app.js` discovers rather than imports, every later extraction becomes mechanical.

## The Cleavage Plane

**Free core (`sleuth-core`, OSS):**

- `slack-app.js`, `app.js` (slimmed), `settings-module.js`, `stats-module.js`
- `chat-module.js` minus admin/operator commands that depend on premium modules
- `workspace-ai.js` + all of `ai-providers/` — all three providers ship BYOK; the gate is the user's API key, not the code
- `plugin-loader.js` — this *is* the product seam
- thread context memory, deterministic responses, basic `web-api.js` (workspace CRUD + settings + auth)
- `chat-commands/` minimum set: `commands`, `model-switch`, `run-diagnostics`
- reconcile scripts and the one-shot harness — keep OSS, they are good DX bait

**Premium plugins (paid, closed-source):**

- `sleuth-plugin-reminders` — `reminders-module.js`, the FSM, AI extraction pipeline, snooze, GitHub comment relay. **Platform plugin — other plugins depend on it.**
- `sleuth-plugin-lists` — `lists-module.js` + `list-context.js` (high-value, hard to replicate); depends on `reminders`
- `sleuth-plugin-rag` — `src/rag/` + `ask-self` + `ask-woo` glue
- `sleuth-plugin-notion`, `sleuth-plugin-github-sync` — thinner wrappers; depend on `reminders`
- `sleuth-plugin-web-search-pro` — multi-provider routing, freshness auto-route, source extraction

Keep the differentiated web-search experience premium: core ships one basic single-provider grounded search; the plugin gates multi-provider routing.

## Phase 0: Foundations and Decisions

**Goal:** lock the model, licensing, and repo strategy so every later phase has a fixed target.
**Exit criteria:** every decision below is recorded in this doc (or a linked ADR) with a chosen option.

- [ ] Licensing model chosen and recorded — one of: (a) honor-system + closed tarballs on a paid registry, (b) signed license-key file verified at plugin `init()`, (c) phone-home activation. Recorded caveat: closed-source JS on customer infra is readable and patchable, so the license is a contract + friction, not a hard technical lock.
- [ ] Repo strategy chosen: single-repo open-core (`core/` + `plugins/` with an architecture-lint boundary) vs. multi-repo (`sleuth-core` public + `sleuth-plugins` private). Recommendation on record: stay single-repo until a second contributor or a real community PR exists.
- [ ] Core OSS license selected (Apache 2.0 proposed) and the `LICENSE` decision recorded.
- [ ] SKU lineup decided — which plugins are paid headline SKUs, which are bundled, which are free. Explicit decision recorded on whether `notion` / `github-sync` (thin wrappers) headline or ship bundled.
- [ ] Brand decision recorded: `Sleuth` (OSS) vs `Sleuth Pro` (paid bundle) vs per-plugin SKUs.
- [ ] Tension resolved on record: "telemetry-free by default" conflicts with phone-home licensing — pick one.

## Phase 1: Freeze the Plugin Contract

**Goal:** replace the current ad-hoc `StartAsync(slackApp, workspaceInfo)` shape with a typed, versioned plugin contract — the keystone everything else hangs off.
**Exit criteria:** `echo-command` runs on the new contract and `npm run build` + `npm test` pass.

Current state to evolve: `PluginLoader` instantiates a class and calls `StartAsync(slackApp, workspaceInfo)` + optional `StopAsync()`; `data/plugin-registry.json` entries already carry `name`, `version`, `publisher`, `phase`, `entryPoint`, `enabled`.

- [ ] Typed `Plugin` interface defined (e.g. `src/plugin-contract.js` JSDoc typedefs): `{ name, version, apiVersion, init(ctx), start(), stop() }`.
- [ ] `PluginContext` (`ctx`) dependency bag defined and documented: `logger`, `stats`, `workspaceAI`, `slackApp`, `settings`, `commandRouter`, and a `services` registry.
- [ ] **Service registry** added to `ctx` so one plugin can publish a named API and another can consume it — this is what makes `lists` → `reminders` possible (`ctx.services.provide(name, api)` / `ctx.services.require(name, versionRange)`).
- [ ] `apiVersion` compatibility check: `PluginLoader` refuses to start a plugin whose `apiVersion` is outside core's supported range, with a clear logged reason.
- [ ] `echo-command` migrated to the new contract and still answers `@Sleuth echo <text>` in a live workspace — retained as the canonical reference plugin.
- [ ] Plugin contract documented in `ARCHITECTURE.md` (or a dedicated `PLUGINS.md`).

## Phase 2: Plugin-Extensible Chat and Persistence

**Goal:** let plugins contribute chat commands and own isolated storage without editing core.
**Exit criteria:** a plugin can register a command that appears in `commands` output and persists state, with zero edits to `chat-module.js`.

- [ ] `CommandRouter` (`src/chat-command-router.js`) accepts external route registration via `ctx.commandRouter.register(...)`.
- [ ] Premium-only routes removed from `chat-module.js` `#RegisterCommandRoutes`; each is registered by its owning plugin instead.
- [ ] The `commands` admin output is generated from all registered routes (core + plugin) so plugin commands self-document.
- [ ] Per-plugin persistence convention enforced: plugins write only under `data/runtime/plugins/<plugin-name>/`, via a path helper.
- [ ] Migration step recorded for existing runtime data that moves out of core paths (`data/runtime/reminders/`, lists cache, etc.).

## Phase 3: Invert the app.js Orchestration

**Goal:** `app.js` discovers plugins instead of importing premium modules by name. This is the hardest phase — not a "quick win".
**Exit criteria:** with all premium plugins disabled, core boots, passes the AI connectivity probe, and serves basic chat; enabling a plugin requires only a registry edit.

- [ ] Handler-chain order is data-driven — a priority-sorted list per event type that plugins contribute to. Preserve the existing exception: `ChatModule` runs **first** on `reaction_added` (`:wrench:` triage), last on `message` / `app_mention`.
- [ ] `app.js` no longer calls `new RemindersModule(...)` etc. directly — premium modules load only via the plugin registry.
- [ ] Startup ordering derived from plugin-declared dependencies (topological sort), preserving today's constraints (`StatsModule` first; reminders before lists).
- [ ] Cross-module wiring (`ListsModule` ↔ `RemindersModule`) flows through the Phase 1 service registry, not direct constructor wiring.
- [ ] Core boots green with `data/plugin-registry.json` empty — verified on the dev server.

## Phase 4: Extract the Premium Plugins

**Goal:** move each premium capability into its own plugin package behind the frozen contract.
**Exit criteria:** each plugin loads from the registry, and the same plugin disabled means that capability is cleanly absent.

- [ ] `sleuth-plugin-reminders` extracted **first** (platform plugin) — `reminders-module.js`, FSM, AI pipeline, snooze, comment relay; publishes its API to the service registry.
- [ ] `sleuth-plugin-lists` extracted — declares a `reminders` service dependency; verified inert-but-clean when `reminders` is absent.
- [ ] `sleuth-plugin-notion` extracted.
- [ ] `sleuth-plugin-github-sync` extracted — declares a `reminders` service dependency.
- [ ] `sleuth-plugin-rag` extracted — `src/rag/`, `ask-self`, `ask-woo` glue; tenancy gate preserved.
- [ ] Web search split: core keeps one basic provider; `sleuth-plugin-web-search-pro` gates multi-provider routing + freshness auto-route + source extraction.
- [ ] Existing-data migration executed on dev, then prod, with a rollback note.
- [ ] Full `npm test` green with all plugins enabled; smoke-tested on the dev server.

## Phase 5: Package, Licensing, and Repo Split

**Goal:** ship the split — packaging, CI, licensing mechanism, and a public demo.
**Exit criteria:** `sleuth-core` is installable standalone and a premium plugin installs and activates against it.

- [ ] Repo structure executed per the Phase 0 decision (single-repo boundary, or `sleuth-core` public + `sleuth-plugins` private).
- [ ] Core CI: build, jest, `validate:ai`, type-check; publish on tag. No premium fixtures in the core repo.
- [ ] Plugin CI: matrix against pinned core versions (last minor + current); publish to the chosen registry on tag.
- [ ] Plugins declare a `peerDependencies` range on `sleuth-core`; the contract breaks only at major versions.
- [ ] Chosen licensing mechanism (Phase 0) implemented and verified end-to-end.
- [ ] `docker-compose.yml` in core spins up a Slack-ready bot with a sample workspace JSON — the conversion funnel.
- [ ] Public `README` for `sleuth-core` with BYOK setup steps.

## Phase 6: Hardening and Growth

**Goal:** the month-2+ work that strengthens the moat and the funnel.
**Exit criteria:** not gating the split — tracked as ongoing.

- [ ] Signed license keys with offline verification (Ed25519 keypair, license file in the workspace dir).
- [ ] Plugin marketplace / docs site (Astro or Starlight).
- [ ] Brand split executed: `Sleuth` (OSS) vs `Sleuth Pro` (paid bundle) vs per-plugin SKUs.
- [ ] CLA Assistant wired up if community PRs into core are accepted.
- [ ] Hosted SaaS option scoped — bundles everything for customers who do not want to self-host.
