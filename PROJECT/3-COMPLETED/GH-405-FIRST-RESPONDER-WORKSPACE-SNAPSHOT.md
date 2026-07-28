---
title: "First-responder workspace awareness: cached workspace snapshot into the router"
status: Completed — shipped v1.4.234 (PR #409, merged to development 2026-07-17); Phase 1 (snapshot injection) + Phase 2 (deterministic count) both delivered
created: 2026-07-16
owner: noel
gh_issue: 405
source: https://github.com/NeochromeTeam/sleuth-app/issues/405
doc_type: feature
complexity: 2
risk: 2
effort: 2
phases: 3
ratings_provisional: false
non_goals:
  - Giving the event store any authority (it stays non-authoritative; snapshot base = live authoritative reminders)
  - The "workspace pulse" / event-log velocity surface (a separate follow-on — this issue is the enabler)
  - Snooze/Cancel-derived signal (those events are sparse / not-yet-reliably-emitted)
  - Any new always-on LLM call (the snapshot is deterministic; the router already runs)
  - Changing the query engine (#367) or the reminder-render primitive (#391)
related:
  - "GH-397 / PR #401 (Flash Lite first-responder router — this enriches its context)"
  - "#404 (Gemini context caching for the extraction pipeline — COMPLEMENTARY, different layer; see 'Relationship to #404')"
  - "P3 event-sourced core (FoldReminders / summarizeWeekFromEvents supply the optional week-completions enrichment)"
  - "#384 / #391 (convention-drift incidents — better slot-filling reduces the misroute class)"
  - "client-mapping.js (existing client/project attribution — reused, no new inference)"
goal: >
  Give the first responder (GH-397 router) a cached, token-bounded snapshot of authoritative
  workspace state (open count, top clients/projects, this-week completions) injected into its RMM
  context, so it fills client/project slots with higher confidence, misroutes less, and can answer
  trivial count questions deterministically (no model round-trip, no hallucinated numbers).
---

# GH-405 — First-responder workspace awareness (cached workspace snapshot)

> **1-INBOX capture**, not the active-work doc — no `## Status` table yet. On promotion to
> `PROJECT/2-WORKING/`, add the status table + per-phase QA gates and carry `gh_issue` forward.
>
> **Marathon:** preflighted into a 2-lane marathon at
> [`marathon-plans/gh-405-workspace-snapshot/`](../../marathon-plans/gh-405-workspace-snapshot/README.md)
> (p1 = gated snapshot injection, p2 = live-recompute counts; reviewer agy). **Built + preflighted, not
> auto-fired** — Phase 0 below (confirm seam + shape, clear `ratings_provisional`) precedes firing.

## Quad Concepts
- Router is blind to workspace state → inject a cached snapshot so it routes/slot-fills with awareness.
- "How many open for X" needs an LLM guess → answer it deterministically from the snapshot in `active` mode.
- Event store is non-authoritative → base the snapshot on live authoritative reminders; event log is enrichment only.

## Key concepts
- **The gap.** [`ResolveRmmIntentAsync`](../../src/command-intent-resolver.js) builds model context from
  the command catalog + model names + channel id + normalization notes only — **zero** workspace state.
  Reminder state is fully available (authoritative live reminders in memory; event log for enrichment).
- **Authoritative base, event-log enrichment.** Base counts (open total, per-client/project open) come
  from `RemindersModule.GetAllReminders()` — the source of truth. This-week *completion* count may come
  from the event log (`summarizeWeekFromEvents` / `FoldReminders`, read-only). The event store stays
  non-authoritative; it never becomes the base for a count.
- **Cached, never hot-path.** The snapshot is rebuilt on reminder lifecycle changes (create / complete /
  schedule), not recomputed per mention. Routing latency is untouched.
- **Bounded tokens.** A few `ContextLines`: `open_total`, `top_clients_by_open` (capped, top 5). No
  unbounded dumps. _(Phase 0: `top_projects_by_open` dropped — `projectId` is null in v1;
  `completed_this_week` deferred to a fast-follow to keep p1 tiny.)_
- **Reuse attribution.** Client/project bucketing reuses `client-mapping.js` resolvers — no new inference.
- **Opt-in via opts — the blast-radius rule.** `ResolveRmmIntentAsync` is shared by 4 callers (the router
  closure at `chat-module.js:308` **plus** the user-typed `rmm` / `rmm ifl` / `help <query>` commands).
  The snapshot MUST be passed through `ArgOptions` from the **router closure only** — never baked into
  `ResolveRmmIntentAsync` itself — so the other three callers are untouched and a bug can't leak into them.
- **`ROUTER_SNAPSHOT_ENABLED` gate (default OFF).** A process-wide env, read at snapshot-build time,
  mirrors the `ROUTER_SHADOW_*` family. It is a **kill switch** AND an **A/B lever** — run the router
  *with* vs *without* the snapshot to measure whether awareness actually improves routing, and roll the
  snapshot back independently of the router mode. Ships dark; enable per rollout.

## Idea
Thread a cached workspace-snapshot provider into the first responder's context (chat-module closure →
router-shadow-module → `ResolveRmmIntentAsync` opts) and, in `active` mode, answer trivial count
questions straight from it.

## Why
- **Better routing/disambiguation.** "what's open for Client A?" → the router *knows* Client A is a real
  client with N open → higher-confidence client slot, fewer misroutes (the #384/#391 class).
- **Perceived intelligence.** A router aware of the workspace is the cheapest lever on "Sleuth is smart
  about my workspace."
- **Enabler.** The snapshot is the substrate the later event-log "workspace pulse" builds on.

## Relationship to #404 (Gemini context caching) — complementary, keep the boundary
#404 caches **static** content (extraction instructions/schemas/few-shots) **server-side** to make
the *extraction pipeline* cheaper. #405 caches **dynamic** workspace state **in-process** to make
*routing* smarter. Different layer, different cache — not overlapping.

- **Correctness constraint (load-bearing if both land):** this snapshot changes on every reminder
  create/complete, so it MUST ride in the **live-text** portion of a request, **never inside** a
  #404 context-cache block — else the router serves **stale** workspace state *and* busts the cache.
  Boundary rule: cache = static (instructions/schemas/few-shots); live text = dynamic (snapshot + message).
- **Coordination:** #404 originally named `gemini-2.5-flash-lite`; the router is pinned to
  `gemini-3.1-flash-lite` (#397). Reconcile the flash-lite version if both standardize on it.
- **Future cross-link (not this issue's scope):** the router re-sends its largely-static
  `candidate_commands` catalog on every mention — itself a #404 caching candidate (separate follow-on).

## Blast radius & rollout (verified against the call graph 2026-07-16)
- **Runtime reach = the router path only, and only when armed.** Router `off` (prod default) ⇒ #405 is
  fully dormant. It rides entirely on the already-gated GH-397 mode; nothing in the mainline message flow,
  the extraction pipeline, or the FSM is touched. Layered under that, `ROUTER_SNAPSHOT_ENABLED` (default
  off) gates it a second time.
- **Files:** ~4, all additive — a per-workspace snapshot builder, the `chat-module.js:308` closure, a
  cache-invalidation hook piggybacking the existing `ReminderCreated`/`ReminderCompleted` emit points in
  `reminders-module.js`, and reading the optional snapshot from opts in `command-intent-resolver.js`.
- **The one sharp edge = the active-mode deterministic count** (the only user-visible place a stale/wrong
  snapshot shows). Mitigated by (a) moving it to its own Phase 2 and (b) requiring it to **recompute from
  live `GetAllReminders()` at answer time**, not trust the cache. Everything else is advisory routing
  context where wrong data just means a slightly worse slot guess.
- **Isolation:** the cache lives on the per-workspace `RemindersModule`, never a module global; the
  `validate-workspace-isolation` CI guard backstops the #387 class.

## Phase 0 — Explore & scope (go/no-go) — ✅ DONE 2026-07-16 (GO)
> Discovery phase: findings written **back into this doc** (below); `ratings_provisional` cleared.

### Checklist
- [x] **Seam confirmed.** Four closures bind `ResolveIntentAsync` with the identical signature
      `(ArgText, ArgOptions) => ResolveRmmIntentAsync(this.#WorkspaceAI, ArgText, ArgOptions)`:
      **router = [chat-module.js:308](../../src/chat-module.js#L308)**, help = 353, rmm ifl = 397, rmm = 414.
      Inject the snapshot into `ArgOptions` **in the 308 closure only**; the other three are untouched.
      `ResolveRmmIntentAsync` ([command-intent-resolver.js:521](../../src/command-intent-resolver.js#L521))
      builds a `ContextLines` array (527–539) — append snapshot lines **only when `ArgOptions.WorkspaceSnapshot`
      is set**, so context is byte-identical for the other callers / gate-off.
- [x] **Snapshot shape decided (trimmed by a real finding).** `projectId` is **`null` in v1**
      ([reminders-module.js:86](../../src/reminders-module.js#L86) — "reserved for a future phase"), so
      **`top_projects_by_open` is dropped** (no data). Shape = `{ openTotal, topClientsByOpen: [{name,count}] }`,
      top-list cap 5, `openTotal` accurate even when truncated. Context lines: `open_total`, `top_clients_by_open`.
- [x] **Cache-invalidation hook = the single chokepoint** `#EmitLifecycleEvent`
      ([reminders-module.js:493](../../src/reminders-module.js#L493)) — every create/complete/schedule/
      snooze/cancel routes through it. Invalidate the cached snapshot there (cleaner than the originally
      assumed "scattered `ReminderCreated`/`ReminderCompleted` points"). No per-mention recompute.
- [x] **Attribution reuses existing resolvers, no new inference.** Reminders already carry a stamped
      `clientId` slug ([reminders-module.js:571](../../src/reminders-module.js#L571)); bucket open counts
      by `clientId` and map slug→display name via `client-mapping.js` (`ResolveClientNameForReminder` /
      `ResolveClientIdentity`). `openTotal`/open filter mirrors `GetOpenReminders` (`OpenStates`).
- [x] **`completed_this_week` DEFERRED** (keeps p1 tiny; avoids pulling event-store deps into the snapshot
      builder). `summarizeWeekFromEvents` ([summarize-week-projection.js:31](../../src/summarize-week-projection.js#L31))
      exists and returns `{ completed: [...] }` — wire it as a fast-follow, not in lane p1. Pass `null`, omit the line.
- [x] Findings written back; ratings set (cx 2 / risk 2 / eff 2 — simpler than the provisional 3/2/3:
      one invalidation hook, no projects, no event-store coupling in p1); `ratings_provisional` cleared.

> **GO.** Grounded in the real router seam + live reminder state; snapshot base is authoritative live
> reminders; event store keeps zero authority; composes with GH-397 (enriches its existing context).

### QA checklist — Phase 0
- [ ] Grounded in the real router seam + real reminder state (not hypothetical).
- [ ] Snapshot base is authoritative live reminders; event store keeps zero authority.
- [ ] Cached off lifecycle events — no per-mention recompute in the hot path.
- [ ] Composes with GH-397 (enriches existing context) — no parallel routing path.

## Phase 1 — Build (snapshot injection into routing context, gated)
> Routing-context enrichment only — no user-visible answers yet, so the only failure mode is a slightly
> worse slot guess. Ships behind `ROUTER_SNAPSHOT_ENABLED=off`.
- [ ] `ROUTER_SNAPSHOT_ENABLED` env gate (default **off**), read at snapshot-build time — kill switch + A/B lever.
- [ ] Cached, per-workspace snapshot builder off authoritative reminders (+ optional week-completions from
      the event log), rebuilt on the existing `ReminderCreated`/`ReminderCompleted` lifecycle points.
- [ ] Thread the provider through `ArgOptions` from the **router closure only** (`chat-module.js:308`);
      add bounded `ContextLines` in `ResolveRmmIntentAsync` **only when the snapshot opt is present** — the
      `rmm` / `rmm ifl` / `help` callers stay untouched.
- [ ] Tests: gate off ⇒ no snapshot + identical router context; gate on ⇒ snapshot present; snapshot
      shape/cap; cache rebuild on lifecycle events; the 3 non-router callers unchanged; hot-path unaffected
      when the workspace is empty; per-workspace isolation (two workspaces don't share a snapshot).

### QA checklist — Phase 1
- [ ] `ROUTER_SNAPSHOT_ENABLED` default off; disabled ⇒ byte-identical router context vs today.
- [ ] Snapshot passed via opts from the router closure only; `ResolveRmmIntentAsync` unchanged for the other callers.
- [ ] Snapshot is token-bounded and cached; routing latency unchanged.
- [ ] Per-workspace isolation preserved (snapshot is per-workspace, never a global) — passes the #387 guard.

## Phase 2 — Deterministic count answers (active mode)
> Gated separately behind Phase 1 proving out. This is the only user-visible surface, so correctness is strict.
- [ ] In `active` mode, answer trivial "how many open for X?" without a model round-trip — but **recompute
      the count from live `GetAllReminders()` at answer time**, not from the (possibly-stale) cached snapshot.
- [ ] Only answer when the intent is unambiguously a count query for a resolved client/project; otherwise
      fall through to the normal resolver (no guessing).
- [ ] Tests: correct count for a resolved client/project; ambiguous query falls through; count reflects a
      just-created/just-completed reminder (proves live recompute, not stale cache); no answer when router
      is not `active`.

### QA checklist — Phase 2
- [ ] Counts trace to **live** authoritative reminders at answer time — never a stale snapshot; no hallucinated numbers.
- [ ] Answers only on an unambiguous count intent; everything else falls through unchanged.
- [ ] Behavior is off unless router mode is `active` AND `ROUTER_SNAPSHOT_ENABLED` is on.
