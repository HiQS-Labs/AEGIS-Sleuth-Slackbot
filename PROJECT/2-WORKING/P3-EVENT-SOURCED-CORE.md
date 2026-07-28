---
title: P3 — Event-Sourced Core (the log is the source of truth)
created: 2026-06-12
updated: 2026-07-06
branch: development
status: Phase 0/1 done; Phase 2 built + shipped behind a default-OFF flag (1.4.197/1.4.198). The shadow-diff WAS run against real prod neochrome data and surfaced a pre-ledger data gap (reminders created before the ledger was born 2026-06-17 have no ReminderCreated event → null assignee/sourceChannel in the fold). GH-355 baseline-import (1.4.211, 2026-07-06) fixed it — the prod shadow-diff went 11 → 0 mismatches (only the documented ±1ms completedMs divergence remains). Cutover is now technically UNBLOCKED and reduces to one human-gated step (run the import on prod + flip SUMMARIZE_WEEK_COMPLETED_SOURCE=projection). Parked in ROADMAP.md Queue.
owner: noel
author: Claude (Opus 4.8, 1M)
model: event-sourcing + projections (strangler migration)
goal: >
  Invert Sleuth's persistence model so an append-only per-workspace event log becomes the
  source of truth, via a reversible strangler migration that graduates one projection at a time.
complexity: 4
risk: 2
effort: 4
phases: 8
related:
  - PROJECT/RELAY/summarize-week-completion-review.md
  - PROJECT/RELAY/p3-event-sourced-core-review.md
  - PROJECT/2-WORKING/P1-SPLIT.md
  - PROJECT/2-WORKING/P2-TASK-BUCKETING.md
  - ARCHITECTURE.md
  - rebalance-OS PROJECT/2-WORKING/P2-TEAM-CALENDAR-SIGNAL.md (downstream consumer — HiQS)
summary: >-
  Invert Sleuth's persistence model. Today state lives as mutable in-memory
  objects best-effort flushed to per-workspace JSON; the FSM polices the three
  points where state may change. This plan makes the FSM's single transition
  chokepoint append an immutable event to a per-workspace append-only log as the
  blocking authoritative write, then turns every JSON file, summarize-week, the
  rebalance export, and client/project buckets into *projections* — pure folds
  over that log. Done via a reversible strangler migration (dual-write first,
  retire the old path last), it can delete the mutable-first durability bug class
  and make new views, new channels, and product pivots cheap. Wild forks
  (git-as-event-log, transport-agnostic kernel, LLM-as-runtime) become natural
  once the log exists.
---

# P3 — Event-Sourced Core

## Status

| What was just completed | What's next |
|---|---|
| **GH-355 baseline-import SHIPPED — 1.4.211 (2026-07-06), the blocker to Phase 2 cutover is cleared.** The Phase 2 shadow-diff (`scripts/summarize-week-shadow-diff.js`) *was* run against real prod `neochrome` data; it surfaced a Phase-0-anticipated gap — reminders created before the ledger was born (2026-06-17) have no `ReminderCreated` event, so the fold yielded `null` assignee/sourceChannel for them (11 mismatches over two post-floor weeks). `scripts/baseline-import.js` (one-shot, idempotent, scans both active + completed stores, emits `BaselineReminderImported` events carrying every projection-critical field) took the diff to **0** mismatches (only the documented ±1ms `completedMs` divergence remains). Full suite green (1198); prod-validated. See [GH-355](../3-COMPLETED/GH-355-P3-BASELINE-IMPORT.md). **Earlier:** Phase 2 (`summarize-week` projection) built + shipped behind a default-OFF flag — 1.4.197 (2026-06-16) + 1.4.198 (2026-06-17): `summarizeWeekFromEvents(...)` pure fold + shadow-diff CLI, then the staged read-path wiring (`SUMMARIZE_WEEK_COMPLETED_SOURCE=projection`, unset = current behavior byte-for-byte, error-wrapped fallback to `CompletionStore`). Phase 1 (non-authoritative dual-write) shipped 1.4.192/1.4.193, 2026-06-15. | **Cutover is technically UNBLOCKED — one human-gated step remains.** With GH-355 the shadow-diff is clean, so the only work left for Phase 2's exit criterion is the operator decision: run `scripts/baseline-import.js --write` on prod, then flip `SUMMARIZE_WEEK_COMPLETED_SOURCE=projection` to move users onto the projection. This is a supervised decision, not a build task — the code has been ready since 1.4.198 and the data gap is fixed since 1.4.211. Parked in `ROADMAP.md`'s Queue. Only after that cutover should **Phase 3: Entity Linking Read-Model** (fully spec'd below, zero code) be considered. The authority flips (Phase 4 boot-rebuild, Phase 6 retire-mutable-writes) remain **NOT an assumed continuation** — per the [direction review](#direction-review-codex-2026-06-16) they return as a **fresh proposal** only if Phase 2/3/5 evidence shows the app materially benefits from authoritative replay. |

### Direction review (Codex, 2026-06-16)

Independent strategic sanity-check of this whole direction, run as an automated Claude⇄Codex
relay (transcript: `relay-system/2026-06-16/p3-direction-sanity-check.md`). Verdict:
**Proceed-with-changes** — the sequencing is sound and Phase 1 is justified, but two corrections
to the framing, adopted here:

1. **Scope the durability claim.** "This deletes the durability bug class" is true **only** for
   paths that actually cut over to **append-first authority**. Phase 1 as built is mutate-first,
   best-effort, no-`fsync`, so the side ledger *by itself* does **not** yet remove the bug class —
   it sets up the option. The original "Why" overstates this for the current non-authoritative state.
2. **The destination is not "full event-sourced core by default."** The committed near-term scope
  is the **ledger + projection toolkit**: Phase 2 (`summarize-week` parity + cutover), Phase 3
  (entity linking as a read-model), and the outcome/HiQS export — the needs the repo actually
  evidences. **Then stop and re-decide.** Phases 4 & 6 (the authoritative authority-flips) are
  **not** an assumed continuation; they come back as a *fresh proposal* only if Phase 2/3/5 evidence shows a material benefit from authoritative
   replay. Event sourcing is genuinely worth it here for durable completion/outcome history and
   cheap read-models; the broader "pivotable asset / transport-agnostic kernel" case is speculative
   for a single-node, per-workspace-JSON Slack bot and should not drive the roadmap.

This caps ambition at the high-confidence wins and keeps the one-way doors (Phase 4/6) behind an
explicit, evidence-gated re-decision rather than momentum.

## Plain-English Benefits vs Today

Today, Sleuth mostly works by keeping live state in memory and then writing JSON files to disk.
That works, but it means the app can briefly believe something happened before the durable write is
finished.

The revised architecture changes that shape. Instead of treating the JSON files as the main truth,
it treats a simple event log as the history of what happened, and then rebuilds useful views from
that history.

In simple English, the benefits are:

- **Safer writes.** The long-term goal is to make the durable fact the first thing that happens,
  instead of a best-effort write after memory already changed.
- **Better history.** Instead of only seeing the latest snapshot, we keep a trail of what happened
  over time.
- **Cheaper new views.** Features like `summarize-week`, HiQS exports, or future client/project
  bucketing become new read-models over the same history, not brand-new persistence systems.
- **Better debugging.** When something looks wrong later, we can inspect or replay the event stream
  instead of guessing from the current JSON snapshot.
- **Better foundation for semantic linking.** Client ↔ project ↔ task association gets easier once
  the app has durable, replayable facts instead of only today's mutable state.

## Plain-English Pros and Cons

**Pros**

- It gives Sleuth a cleaner long-term source of truth.
- It makes historical analysis and new projections easier.
- It fits the direction of the newer work already underway: summarize-week parity, HiQS exports,
  and entity linking.
- It reduces repeated one-off inference by letting new read-models reuse the same event history.

**Cons**

- It is more complex than the current JSON-first model.
- Event schemas become a long-term contract, so mistakes are more expensive.
- During migration there are multiple representations of the same reality, which means more
  testing and shadow-diff work.
- The authority-flip phases are meaningful operational changes and should not be treated as
  automatic follow-through.

## Production Server / Existing Data Migration

Short answer: **not at first, and not as a big-bang migration.**

- **Phases 1, 2, 3, and 5 do not require replacing production data in one move.** They are
  additive: the current JSON files stay in place while the event log and new projections are
  built, compared, and validated.
- **Early production rollout is mostly side-by-side.** The server can keep using today's files and
  behavior while writing events and testing new read-models in shadow mode.
- **If Phase 4 ever happens, active data needs a baseline import/backfill.** Old live reminders
  need a synthetic starting point in the event log so boot-time rebuild can reconstruct the same
  in-memory state after restart.
- **Historic completions from before the log may be incomplete forever.** The plan already assumes
  we can seed active reminders, but we cannot magically recover old event history that was never
  recorded as events.
- **Production cutovers should be one-way only after proof.** The server should not trust the log
  as authority until shadow-diffs and real-server testing show the new projections match reality.

So the practical answer is: **no immediate production data migration is required for the additive
phases, but a later authority flip would require a careful baseline import for active state and a
clear statement that pre-log history is partial.**

## High-Impact Notes

- **The current plan is intentionally staged.** The app does not need to become "fully event
  sourced" to get value; Phase 2, Phase 3, and the HiQS export may be enough.
- **Entity linking is now a first-class reason for this architecture.** The revised plan is not
  only about safer writes; it is also about creating a better substrate for client/project/task
  identity over time.
- **Authority changes are the real risk boundary.** Writing events and building projections are one
  class of work; making the log the source of truth is a different, riskier class and should stay
  explicitly gated.
- **Server testing matters more than elegance here.** A week of real-world parity is more valuable
  than a theoretically cleaner design that has not survived production behavior.
- **The final destination is still conditional.** If the ledger + projection toolkit solves the
  real problems, later phases are optional rather than mandatory.

## Table of Contents

- [Plain-English Benefits vs Today](#plain-english-benefits-vs-today)
- [Plain-English Pros and Cons](#plain-english-pros-and-cons)
- [Production Server / Existing Data Migration](#production-server--existing-data-migration)
- [High-Impact Notes](#high-impact-notes)
- [Context](#context)
- [History & Background](#history--background)
- [The Core Idea](#the-core-idea)
- [Why](#why)
- [Pros & Cons](#pros--cons)
- [Roads Not Taken (and future forks)](#roads-not-taken-and-future-forks)
- [Downstream Consumer: rebalanceOS HiQS (further-adapted integration)](#downstream-consumer-rebalanceos-hiqs-further-adapted-integration)
- [How — Phased Migration](#how--phased-migration)
  - [Phase 0: Decision Gate & Seam Map](#phase-0-decision-gate--seam-map)
  - [Phase 1: Dual-Write the Event Log](#phase-1-dual-write-the-event-log)
  - [Phase 2: First Projection — summarize-week](#phase-2-first-projection--summarize-week)
  - [Phase 3: Entity Linking Read-Model — clients, projects, tasks](#phase-3-entity-linking-read-model--clients-projects-tasks)
  - [Phase 4: Boot-Time Rebuild — log becomes source of truth](#phase-4-boot-time-rebuild--log-becomes-source-of-truth)
  - [Phase 5: Migrate Remaining Projections](#phase-5-migrate-remaining-projections)
  - [Phase 6: Retire Mutable Writes](#phase-6-retire-mutable-writes)
  - [Phase 7 (Optional): Unlock the Forks](#phase-7-optional-unlock-the-forks)
- [Risks & Mitigations](#risks--mitigations)
- [Open Questions](#open-questions)
- [Appendix A: Event Schema Sketch](#appendix-a-event-schema-sketch)
- [Appendix B: Compatibility Contract Impact](#appendix-b-compatibility-contract-impact)

## Context

Sleuth is a multi-tenant Node.js app on Slack Socket Mode. State is **file-based, not
database-backed**: runtime state is mutable in-memory objects, isolated per workspace,
best-effort flushed to JSON under `data/runtime/` (e.g.
`data/runtime/reminders/<WORKSPACE>_reminders.json`,
`<WORKSPACE>_completed.json`). An explicit FSM governs reminder lifecycle through three
non-bypassable enforcement points — `#MakeScheduledReminder` (creation gate),
`#TryScheduleRemindersAsync` (scheduling gateway), and `#TransitionReminderState` (the
**only** place state changes mid-lifecycle) — and the contract is structurally enforced by
[scripts/validate-fsm-invariants.js](../../scripts/validate-fsm-invariants.js) at build time.

Downstream consumers are fed by a **push-based** export: a systemd timer runs
[publish-reminders-export.mjs](../../deploy/reminders-export/publish-reminders-export.mjs) every 5 minutes,
pulls the local Web API's `?format=rebalance` view, and commits the JSON to the private
`export-repo` GitHub repo. **Sleuth already treats git as a data plane.**

This plan proposes inverting the persistence model. It is written as a reversible
**strangler migration**, not a rewrite.

## History & Background

The architecture arrived at its current shape through a series of correct, incremental
hardening steps — each of which is also a breadcrumb pointing at this proposal:

- **v1.4.146 — FSM invariants enforced.** State transitions were funnelled to a single
  chokepoint (`#TransitionReminderState`) and a build script forbids rogue assignments.
  *This is the precondition that makes event sourcing cheap:* there is already exactly one
  place to emit a `ReminderStateChanged` event.
- **v1.4.164 — push-based GitHub export.** State started flowing into a git repo on a timer.
  *Sleuth is already half-way to "git as the log."*
- **v1.4.189 — `CompletionStore` introduced.** Completions were split into their own
  durable store, decoupled from Slack Lists, so `summarize-week` reads Sleuth-owned data.
- **v1.4.190 — durability hardening.** `FlushAsync()` on shutdown + durable load pruning,
  after review found `Record()` was fire-and-forget.
- **2026-06-12 — review (the trigger).** The [completion review](../RELAY/summarize-week-completion-review.md)
  found that a completion could be visible in memory before its durable write completed.
  v1.4.190 fixes the graceful-shutdown case by flushing the write chain, but the structural
  concern remains: state is mutated first and durability is defended afterward. A hard
  process kill, a future store that forgets its own flush hook, or a partial dual-write can
  still recreate the class. Durable append must become the first-class operation, not a
  best-effort side effect.

Related in-flight plans this dovetails with: [P1-SPLIT](P1-SPLIT.md) (open-core seam — a
log-based core is even cleaner to split) and [P2-TASK-BUCKETING](P2-TASK-BUCKETING.md)
(client/project inference, which becomes a projection here).

## The Core Idea

Today, `#TransitionReminderState` mutates an object and queues a JSON write.

**Proposal:** that same chokepoint first **appends one immutable event** to a
per-workspace append-only log (`<WORKSPACE>_events.jsonl`) and awaits the durable append
before mutating in-memory state or writing derived caches:
`ReminderCreated`, `ReminderScheduled`, `ReminderCompleted`, `ReminderSnoozed`,
`ReminderCancelled`, … — facts, in order, never mutated.

This ordering is non-negotiable. Event sourcing only fixes the durability class if the
event append is the authoritative write:

```
append + fsync succeeds -> mutate memory / update JSON cache / update Slack Lists
append fails            -> transition fails; no local state advances
```

If the FSM mutates first and fire-and-forgets `EventStore.AppendAsync(...)`, this plan
recreates the `CompletionStore.Record()` bug with a larger name.

The migration should be treated as two nested ambitions:

1. **Lifecycle ledger first.** Capture durable reminder lifecycle facts and use them for
   `summarize-week`. This is the near-term spike and the first payoff.
2. **Full event-sourced core later.** Rebuild active reminders, exports, buckets, and caches
   from projections once the ledger has proven deterministic and complete.

Everything else becomes a **projection** — a pure function that folds the log into a view:

| Today (mutable store) | After (projection over the log) |
|---|---|
| `<WORKSPACE>_reminders.json` | `reduce(events) → active reminders` |
| `<WORKSPACE>_completed.json` + `CompletionStore` | `reduce(events) → completed in window` |
| `summarize-week` | `reduce(events, [weekStart, weekEnd]) → summary` |
| `?format=rebalance` export | `reduce(events) → rebalance shape` |
| client/project buckets ([P2](P2-TASK-BUCKETING.md)) | `reduce(events) → buckets`, recomputable over all history |

The JSON files don't disappear — they become **disposable derived caches** rebuilt from the
log on boot. The log is the only thing that must be durable, and appending one line to a file
is the simplest durable operation there is once append ordering, `fsync`, and corrupt-tail
recovery are explicitly handled.

## Why

Mapped directly to the three properties requested — flexible, adaptable, pivotable:

- **Flexible.** A new feature is a new `reduce` over data you already have. summarize-month,
  per-client SLAs, "what did I drop and never finish," streaks, audit trails — all computable
  **retroactively over full history**, with no schema migration and no new durable write path
  to defend.
- **Adaptable.** Replay, time-travel, and backfill come for free. Change the bucketing logic
  and reprocess the whole log; the world heals itself. Debug a past incident by folding the
  log up to a timestamp.
- **Pivotable.** The asset becomes *the log of human commitments*, not the reminder product.
  You can change what Sleuth **is** — a different UI, a different channel, a different vertical
  — without touching the thing that holds the value.

And the immediate, concrete payoff: **the durability bug class from the review can
evaporate, but only after append becomes authoritative.** There is no "did the completion
flush before shutdown?" race because completion *is* an appended fact, not an in-memory
mutation waiting for a later write. Boot rebuilds the caches from the log. The `FlushAsync`
fix is correct for today's design — authoritative append deletes the category instead of
patching instances.

## Pros & Cons

**Pros**

- Durability becomes structural, not defensive — kills the [review](../RELAY/summarize-week-completion-review.md) finding's whole class.
- New views are pure functions; no migrations; full history available retroactively.
- Time-travel debugging, audit trail, and replay are intrinsic.
- Plays to existing strengths: one FSM chokepoint to emit from; git already used as a data plane.
- Strangler path is low-risk and reversible — old JSON stays as a safety net until the last phase.
- Makes [P1-SPLIT](P1-SPLIT.md) cleaner (the core owns a log + projection contract) and turns [P2](P2-TASK-BUCKETING.md) buckets into a projection.

**Cons / costs (honest)**

Each con is tagged by *when* it actually applies. Note that the additive phases you are
committing to now (Phases 1–3) carry only the `[permanent]` and `[one-time]` costs; the heaviest
items are gated behind the deferred authority-flip phases.

- `[permanent]` **Event schema versioning** is a real, permanent discipline — events are forever, so additive-only evolution and upcasters are required.
- `[permanent, mitigated]` **Replay cost** grows with history; needs snapshotting/compaction (mitigated: per-workspace volumes are small — tens to low-hundreds of reminders).
- `[migration-only]` **Two sources of truth during migration** — dual-write windows must be shadow-diffed, not trusted.
- `[authority-flip only]` **Authoritative append changes control flow** — state transitions that are synchronous today
  may need an async command/transition boundary so the log append can be awaited before mutation.
- `[one-time]` Reading a fold is less obvious than `cat`-ing a JSON file; tooling (a `replay` CLI) is needed for operator ergonomics.
- `[authority-flip only]` Touches **startup order** (boot-time rebuild), which is a High-risk runtime-behavior contract per [AGENTS.md](../../AGENTS.md) — requires explicit compatibility review (see [Appendix B](#appendix-b-compatibility-contract-impact)).
- `[one-time, build cost]` Not free: realistically a multi-week effort to reach Phase 6, even done incrementally.

## Roads Not Taken (and future forks)

These were considered as the "wild" framing and are **deliberately deferred** behind the log,
not discarded — each becomes trivial once an event log exists (see [Phase 7](#phase-7-optional-unlock-the-forks)):

1. **git *is* the database.** Since [publish-reminders-export.mjs](../../deploy/reminders-export/publish-reminders-export.mjs)
   already pushes state to git every 5 min, the event log could *live* in git — every
   completion a commit. Audit, diff, branch, free multi-machine sync, PR-reviewable state.
2. **Transport-agnostic kernel (hexagonal).** Today [src/slack-app.js](../../src/slack-app.js)
   *is* the app. Once the core speaks "commitments" via events, Slack becomes one adapter and
   SMS / email / web / voice are interchangeable ports.
3. **LLM-as-runtime, FSM-as-guardrail.** [P2](P2-TASK-BUCKETING.md) proved the model can infer
   structure from raw reminder text. With a typed event/command layer, an agent loop can
   orchestrate while the FSM invariants keep it legal.

Doing the log first is what makes all three cheap later. That ordering is the whole point.

## Downstream Consumer: rebalanceOS HiQS (further-adapted integration)

The `?format=rebalance` export already feeds a live downstream system: **rebalanceOS**, a
local-first work-intelligence app whose in-flight **HiQS** effort ("high-quality signals") is
building a *"what should we work on next?"* ranker and a **dropped-ball detector** (see the
rebalance-OS doc `PROJECT/2-WORKING/P2-TEAM-CALENDAR-SIGNAL.md`). Sleuth reminders are already one
of its input signals — so the event log is not just an internal cleanup, it is a **further-adapted
integration** that upgrades a real consumer. Captured here so the two projects stay in step.

**Today's coupling is snapshot-only.** rebalanceOS reads the published `activeOnly: true` snapshot —
current open reminders, no outcomes. When a reminder completes, snoozes, or is cancelled it simply
disappears from the next export. HiQS therefore sees *what is open*, never *what was committed and
then finished or dropped*.

**What the log adds — a label oracle.** A dropped-ball detector is a learning problem whose
answer-key is outcome history. HiQS's own dataset research concluded that no public corpus joins
multi-source activity with real "dropped-ball" labels, so those labels must be self-logged. Sleuth
reminders are the highest-precision label source available: an explicit commitment with a verifiable
outcome (GitHub/calendar/email are activity *traces*; a reminder is a *declared intent*). Two
log-derived facts are the payload:

- **Outcome stream** — `ReminderCompleted` / `ReminderSnoozed` / `ReminderCancelled` over time →
  completion velocity, cycle-time, snooze-as-low-priority, and abandonment labels.
- **Delegation edge** — reminders already carry `assigneeId` vs `originalSenderId` (*X asked Y*), so
  the log records *X delegated Z to Y; Y never completed it within N days* — a **delegated dropped
  ball**, the one feature HiQS's prior-art scan found has **zero prior art anywhere**.

**Why this needs P3, not just exporting `CompletionStore`.** A lossy label set is worse than none:
the same shutdown-window completion drop the [completion review](../RELAY/summarize-week-completion-review.md)
caught would inject *phantom* dropped-balls and silently poison the detector. Authoritative append
makes the labels complete and ordered — **label integrity**, a second reason the append-first
ordering matters beyond Sleuth's own durability.

**Integration shape (additive, low-risk).** The export is a new **projection** — a completion/event
feed (`completions-<workspace>.json` or `events-<workspace>.jsonl`) committed to `export-repo`
beside today's snapshot. It folds the same log as every other projection (lands naturally in
[Phase 5](#phase-5-migrate-remaining-projections)), changes no existing output, and re-uses the
existing git-as-data-plane push. It is the **inverse** of giving HiQS the Slack MCP server: Sleuth
publishes facts; HiQS consumes them — no per-user OAuth, no admin approval, no plan gating.

**Bootstrap before any Sleuth change.** `export-repo` already commits the snapshot every
~5 min, so its git history is a crude event log. HiQS can diff consecutive snapshots (present at T,
gone at T+1 → completed/dropped) to stand up its eval harness now — lossy but enough to prove the
signal earns a first-class export. This is exactly the [git-as-log fork](#roads-not-taken-and-future-forks),
used early and read-only.

**Sequencing.** The export is a Phase-5 projection; nothing here changes Phase 0. The only near-term
obligation is to keep the completion/event feed in mind when finalizing the event schema
([Appendix A](#appendix-a-event-schema-sketch)) so the outcome facts **and** the delegation edge are
first-class from day one.

## How — Phased Migration

Principle throughout: **add before you remove.** Every phase up to 5 leaves the existing JSON
write path intact, so any phase can be reverted by deleting the new code.

### Phase 0: Decision Gate & Seam Map

- Approve or kill this proposal at a decision gate (consider running `/take-a-step-back` and
  `/record-decision` on the outcome).
- Cut a feature branch (e.g. `feat/event-sourced-core`).
- Write the **event schema** ([Appendix A](#appendix-a-event-schema-sketch)) and an exhaustive
  **read inventory**: every place in the codebase that reads `_reminders.json` /
  `_completed.json` / `CompletionStore`, because each is a future projection.
- Define the per-workspace log location and format (`data/runtime/events/<WORKSPACE>_events.jsonl`).
  Per-workspace is the default decision unless Phase 0 uncovers a concrete reason to centralize:
  it preserves today's tenant-isolation boundary, keeps log size bounded, and makes workspace
  deletion a file-level operation.
- Define the authoritative write contract: append + `fsync` must complete before any in-memory
  lifecycle mutation or derived-cache write is allowed to advance.
- Define corrupt-tail recovery for JSONL (e.g. detect and quarantine a partial last line on
  startup rather than poisoning replay).
- Define the **baseline event** strategy for existing reminders/completions. Old completion
  history cannot be recovered, but active reminders need a synthetic starting point if the log
  will ever rebuild the live queue.
- Decide the event boundary: business facts needed by projections vs. operational noise. Do
  not log every retry/status detail unless a projection, audit trail, or rollback path needs it.
  Start with state-change **events only**; raw incoming commands/intents stay out of the log
  unless a later phase proves they are needed.
- Identify projection-critical denormalized fields that must be captured at event time
  (display text, assignee, source channel, GitHub URLs, due date, completion method, etc.) so
  replay does not secretly depend on current Slack/API state.
- Define schema validation for emitted events, including whether
  [scripts/validate-fsm-invariants.js](../../scripts/validate-fsm-invariants.js) should grow a
  payload-schema check or delegate to a dedicated validator. Goal: prevent poison-pill events
  from entering the log.
- **Exit criteria:** schema, validation approach, write-order contract, corrupt-tail policy,
  baseline strategy, and read inventory reviewed; no production code touched yet.

### Phase 1: Dual-Write the Event Log

> **⚠️ Counter-view — RECOMMENDED on resume (Codex, 2026-06-13; author agrees).** The dual-write below
> makes the append **authoritative** (await-before-mutate, fail-closed). The [Phase 0 spike](../4-MISC/PHASE-0-SPIKE.md)
> + three Codex review rounds showed that authority pulls in a large sharp-edge burden — rebuild
> **stranding**, a per-workspace **critical section**, **baseline fidelity**, **recorded-after-effect**
> posting. **Every one of those edges is a consequence of the log being authoritative for boot rebuild.**
> Recommended re-scoping: make Phase 1's append **NON-authoritative first** — a side completion/audit
> ledger; mutate-first behavior still leads; the log may lag or be lossy. That banks the two motivating
> wins (durable completion history + the rebalanceOS **HiQS** export) with **none** of the
> authoritative-rebuild edges. Then graduate specific projections to authoritative **one at a time**,
> each only after a shadow-diff proves it for a real week. The authoritative design (the bullets below +
> the spike's Contracts 1–4, resting-state event model, critical section, and risk table) is fully
> specified and **held in reserve** for that graduation. **The moment the log becomes authoritative,
> every edge in the spike must be honored.**

*The bullets below describe the authoritative design (held in reserve per the counter-view):*

- At `#TransitionReminderState` (and the creation gate), **append** an event to the workspace
  log *in addition to* today's behavior. Pure addition — nothing removed, nothing read back yet.
- Append must be durable, ordered, and authoritative (append + `fsync`, single writer per
  workspace — reuse the `#WriteChain` serialization pattern already in
  [src/completion-store.js](../../src/completion-store.js)). If append fails, the transition
  fails; JSON cache writes remain rollback compatibility, not authority.
- Add parity logging for partial failures: event append success + JSON cache failure is
  recoverable; JSON success + event append failure must not be allowed to advance local state.
- Add a `replay` dev CLI that folds a log to a view for inspection.
- **Exit criteria:** for a week of real activity, the event log contains a superset of the
  facts in the JSON files; no append failures are masked; FSM invariant build check still green;
  zero behavior change observable to users.

**Validation strategy (harness → dev server).** Emission is provable in the existing mock harness
([tests/reminders-integration.test.js](../../tests/reminders-integration.test.js),
[tests/mocks/mock-slack-app.js](../../tests/mocks/mock-slack-app.js)): reaction-driven lifecycle
transitions already flow through `#TransitionReminderState`, per-workspace isolation is built in, and
the **fail-closed contract** is directly testable by injecting an append failure and asserting the
transition does not advance. The previously-uncovered 20% — the **natural (non-forced) check cycle**,
where the due-time and snooze-day gates live — is now covered by fake-timer tests (the
`time-driven check cycle` block added in v1.4.191); force mode (`process reminders now`) bypasses both
gates and so cannot validate them. The harness is the **correctness** gate (deterministic, fail-closed);
the **neochrome dev server** is the **fidelity** gate the exit criterion actually requires (a week of
real activity producing a superset log) — the two are complementary, not either/or. On this repo, **merge
to `development` auto-deploys** via CI ([.github/workflows/cicd-development.yml](../../.github/workflows/cicd-development.yml)),
so green tests + validators gate the merge; after deploy, confirm the service restarted onto the new
commit (`journalctl --unit=sleuth-app`: service-start vs. commit time) before trusting it live. Dual-write
is additive and read-nothing, so live dev exposure is low-risk — the high-risk staged rollout belongs to
Phase 4 (boot-time rebuild), not here. See [README → Testing](../../README.md#testing--the-mock-slack-harness)
for how to drive the harness.

### Phase 2: First Projection — summarize-week

- Re-implement **only** `summarize-week` as a fold over the event log instead of reading
  `CompletionStore`.
- Run it in **shadow mode**: compute both the old and new results, log/diff them, ship the old
  result to users. Diff for a full week.
- Keep `CompletionStore` as the user-facing source until the event projection has survived a
  complete calendar week. The first cutover is a lifecycle-ledger cutover, not approval of the
  full event-sourced core.
- This is the thesis test. If the fold matches the store for a week, the model holds.
- **Exit criteria:** new and old `summarize-week` outputs match across a week of real data;
  then cut users over to the projection. This phase **resolves the original review finding** —
  completions can no longer be lost in graceful or crash-window scenarios because the durable
  appended fact is the first write.

> **▶ Execution: designated Claude Code Cloud task (build + shadow-diff only).** Phase 2 is the
> first remaining piece that is safe to hand to an autonomous Cloud session because it is
> **additive, fully verifiable, and reversible** — a pure fold plus a diff harness, with **no
> authority change** (the user-facing path stays on `CompletionStore`). This is deliberately the
> *opposite* of doing "the whole remainder" in one Cloud pass: the authority flips (Phase 4
> boot-rebuild, Phase 6 retire-mutable-writes) are one-way doors and stay supervised, one
> projection at a time.
>
> **Cloud scope (what the session builds):**
> 1. `summarizeWeekFromEvents(events, { workspace, weekStart, weekEnd })` — a **pure fold** over
>    the event log (`ReminderCompleted` in `[weekStart, weekEnd)` + still-open reminders),
>    returning the same shape `#HandleSummarizeWeekAsync` renders today. No I/O, no Slack/GitHub.
>    Reuse the Phase 1 consumer style in [deploy/reminders-export/events-projection.js](../../deploy/reminders-export/events-projection.js).
> 2. A **shadow-diff harness** (dev CLI + test) that, for a given workspace + week, computes BOTH
>    the current `CompletionStore`-based result and the new fold, and reports any mismatch
>    (missing/extra/different completions) as structured output. This is the thesis test made
>    runnable.
> 3. Wiring to compute the new result in **shadow mode** alongside the live path and log the diff
>    — **without** changing what users receive.
>
> **Data feeding (Cloud has NO access to local `data/runtime/`, which is gitignored):** the Cloud
> sandbox is a separate machine seeded from the repo, so it cannot see local snapshots. Feed it a
> real-data snapshot via a channel it has credentials for — the published-data repo
> (`export-repo`, already updated every 5 min) it can clone, or a read-only `scp` from the
> dev server into `data/runtime/` *inside the sandbox*. Do **not** commit workspace data
> (`data/runtime/` is gitignored precisely to prevent that).
>
> **Acceptance check (what "done" means for the Cloud pass):** the fold + harness exist and are
> green (`node --test` / `jest`); running the harness over the snapshot produces a structured
> diff report; `validate:fsm` stays green; `tsc` clean. **Out of scope for Cloud:** the actual
> user-facing **cutover** — that remains a supervised, human-gated decision after the shadow-diff
> matches across a real calendar week (the exit criterion above). Bring the result **local for the
> cutover decision and any fine-tuning**, then promote.

### Phase 3: Entity Linking Read-Model — clients, projects, tasks

- After the Phase 2 cutover gate, use the event ledger as a **non-authoritative semantic substrate**
  for client ↔ project ↔ task association before considering any authority flip.
- Build a workspace-scoped read-model that derives **canonical entities**, **alias tables**,
  and **typed edges** (`task -> project`, `project -> client`, `task -> client`, delegation,
  GitHub/repo association) from reminder events plus denormalized event payload fields.
- Treat this as a **hybrid resolution layer**: deterministic mappings and regex/channel/repo rules
  first; LLM-assisted inference second; human-curated corrections optional; every inferred link
  should carry **confidence** and **provenance** so the model can be rerun over history safely.
- Keep the phase strictly additive: no reminder write-path change, no new authority boundary,
  no dependency from core reminder scheduling on entity resolution.
- Use the phase to power better downstream features that already appear elsewhere in the roadmap:
  [P2-TASK-BUCKETING](P2-TASK-BUCKETING.md), richer `summarize-week` grouping, `search reminders`
  expansion, and HiQS exports that need stable client/project identity rather than one-off text matches.

**Borrow from Splink (reference architecture, not runtime dependency).** The useful ideas to steal
from [Splink](https://github.com/moj-analytical-services/splink) are architectural, not necessarily
the Python package itself:

- **Blocking / candidate generation.** Do not compare every task to every client/project. Generate
  candidate pairs from cheap signals first: exact/normalized aliases, channel mappings, GitHub repo
  mappings, shared participants, and time-local co-occurrence.
- **Multi-signal comparison instead of one fuzzy score.** Score links from several explainable
  signals rather than one bag-of-words similarity: normalized string match, repo match, channel
  match, sender/assignee overlap, historical co-occurrence, and prior accepted alias mappings.
- **Weighted confidence, not binary truth.** Persist per-link confidence and the individual pieces
  of evidence so thresholds can move later without rewriting history.
- **Cluster after pairwise linkage.** First infer candidate edges, then cluster them into canonical
  client/project identities; do not let one early LLM guess become the canonical ID by accident.
- **Diagnostics and review tooling.** Keep shadow-diff outputs, false-merge/false-split examples,
  low-confidence queues, and comparison traces so the system is debuggable and tunable.
- **Human override lane.** Preserve space for curated alias tables or explicit merges/splits that
  override model output while remaining replayable over the historical event stream.

**Minimal Sleuth-native design (Node-first, projection-first).** Keep the first implementation small
and local to this repo rather than importing a heavyweight runtime:

1. **Projection inputs.** Extend the event projection inputs with normalized fields that entity
   linking actually needs: cleaned reminder text, assignee/original sender, source/target channel,
   GitHub URLs/repos, due/completed timestamps, and any explicit client/project hints.
2. **Core tables/views.** Build four replayable read-models: `CanonicalEntities`, `EntityAliases`,
   `EntityEdges`, and `EntityEvidence`. The first stores stable IDs; the others explain how tasks,
   projects, and clients connect.
3. **Resolution pipeline.** Run deterministic rules first, then optional LLM enrichment only on the
   unresolved or ambiguous candidate set. Store the LLM output as evidence, never as untraceable
   truth.
4. **Stable IDs and provenance.** Every canonical client/project/task cluster gets a stable local ID,
   and every link stores `reason`, `source`, `confidence`, and `resolvedAtVersion` so replay and
   audits stay possible.
5. **Correction path.** Human-reviewed merges, splits, and alias fixes append to a curated override
   layer that is reapplied on rebuild; they do not mutate past events.
6. **Read surfaces first.** Consume the projection in reporting/search/bucketing/export paths before
   considering any operational dependency in core reminder flows.

**Adoption decision for this phase.** Use Splink as a **reference model and benchmark**, not as the
default in-process dependency for Sleuth:

- **Default decision: reference only.** Borrow its blocking, scoring, clustering, and evaluation
  ideas while implementing the first pass natively in Node/read-model code.
- **Possible later option: offline sidecar/batch job.** If the matching problem becomes materially
  more complex, a Python helper or batch pipeline can score projected datasets and publish canonical
  IDs back into Sleuth-owned read-model artifacts.
- **Not recommended for now: direct runtime integration.** A hard Python dependency in the main
  Slack/Node request path adds operational weight before the data volume or ambiguity level justifies it.

- **Exit criteria:** a replayable projection exists; it can rebuild canonical client/project/task
  associations from real server data; diff tooling identifies unresolved/ambiguous aliases; and the
  layer proves useful **without** requiring Phase 4 authority changes.

### Phase 4: Boot-Time Rebuild — log becomes source of truth

- On startup, **rebuild** the in-memory reminder/completion state by folding the event log,
  instead of loading the mutable JSON.
- Keep writing the JSON as a *cache* (and as a rollback escape hatch) but stop *trusting* it.
- This flips authority: the log is now the source of truth; JSON is derived.
- **High-risk** — changes module startup order/semantics. Requires the compatibility review in
  [Appendix B](#appendix-b-compatibility-contract-impact) and a staged rollout (one workspace first).
- Pull snapshotting forward from Phase 6 if replay latency becomes visible during staged
  startup tests.
- **Exit criteria:** cold start from log-only reproduces exact prior in-memory state on the
  `neochrome` workspace; verified across a restart.

### Phase 5: Migrate Remaining Projections

- Convert the remaining reads to projections: `_reminders.json`, `_completed.json`, and the
  `?format=rebalance` export consumed by [publish-reminders-export.mjs](../../deploy/reminders-export/publish-reminders-export.mjs).
- Fold the Phase 3 entity-linking layer into these projections where it materially improves
  output quality, so buckets and exports can reuse canonical client/project identity rather than
  repeating one-off inference at each read surface.
- Add a projection parity harness before cutover: compare old JSON/API output vs. folded event
  output, byte-compatible where feasible and semantically diffed where timestamps/order differ.
- **Exit criteria:** every downstream view is produced by a fold; export output byte-compatible
  with today's (shadow-diff the rebalance JSON before cutover).

### Phase 6: Retire Mutable Writes

- Remove the mutable JSON **write** path (keep read for cold rollback for one release, then drop).
- Collapse `CompletionStore` into a projection; delete the bespoke durability queue and the
  `FlushAsync` shutdown coupling it required.
- Add **snapshotting/compaction**: event-count-based snapshots by default (for predictable replay
  bounds), plus truncated log so replay stays bounded. Time-based or shutdown snapshots can be
  added later if operations need them.
- **Exit criteria:** log + snapshots are the only durable state; full test suite green;
  `validate:fsm` green; a restart-after-completion regression test (from the review) passes by construction.

### Phase 7 (Optional): Unlock the Forks

Pick any/all once Phase 6 is stable — each is now a small project, not a rewrite:

- **git-as-log:** point the append writer at a git-backed log; reuse the existing push pattern.
  Keep local JSON/in-memory projections beside it for fast synchronous reads; git is the durable
  remote/audit plane, not the request-time read path.
- **Adapters:** extract a `CommitmentKernel` and demote Slack to one adapter (pairs with [P1-SPLIT](P1-SPLIT.md)).
- **Agent runtime:** expose events/commands as typed tools and let an LLM orchestrate under FSM guardrails.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Event schema mistakes are permanent | Additive-only evolution; version field per event; upcasters; schema reviewed at Phase 0 gate |
| Poison-pill event enters the log | Validate emitted payloads against the event schema before append; extend `validate:fsm` or add a dedicated event-schema validator |
| Event append is accidentally fire-and-forget | Make append + `fsync` the blocking authoritative write; state cannot mutate if append fails |
| Dual-write drift (log ≠ JSON) | Shadow-diff every projection for a full week before cutover (Phases 2 & 4) |
| Partial JSONL line or corrupt tail poisons replay | Define startup repair/quarantine policy in Phase 0; test interrupted append recovery |
| Projection depends on current Slack/API state | Capture projection-critical denormalized fields inside events at write time |
| Event log gets polluted with operational noise | Log business facts first; require a projection/audit/rollback use case for noisy retry/status events |
| Boot rebuild changes startup behavior | High-risk compatibility review ([Appendix B](#appendix-b-compatibility-contract-impact)); stage to one workspace first |
| Replay cost grows unbounded | Snapshot + compaction in Phase 6; per-workspace volumes are small |
| Concurrent writers corrupt the log | Single-writer-per-workspace serialization (reuse `#WriteChain` pattern); append + fsync |
| Effort overruns / loses momentum | Strangler design means value lands at Phase 2 and can deepen at Phase 3 even if 4–7 never happen |

## Open Questions

1. **Business facts vs. operational events:** which retry/posting/status transitions are product
   history, and which are cache/runtime noise?
2. **Baseline events:** how do we seed active reminders that existed before the log without
   pretending to recover historical completions that were never persisted?
3. **Schema validation home:** should event payload validation live inside
   `validate:fsm`, a dedicated `validate:events`, or both?

## Appendix A: Event Schema Sketch

One event per line in `data/runtime/events/<WORKSPACE>_events.jsonl`. Illustrative only —
finalized at the Phase 0 gate:

```jsonl
{"v":1,"id":"evt_...","ts":"2026-06-12T14:03:22Z","workspace":"neochrome","type":"ReminderCreated","reminderId":"rem_123","payload":{"text":"...","assigneeId":"U0..","sourceChannelId":"C0..","targetChannelId":"C1..","source":"app_mention","githubUrls":[]}}
{"v":1,"id":"evt_...","ts":"2026-06-12T14:03:25Z","workspace":"neochrome","type":"ReminderScheduled","reminderId":"rem_123","payload":{"dueAt":"2026-06-13T09:00:00Z","via":"ai"}}
{"v":1,"id":"evt_...","ts":"2026-06-13T09:14:10Z","workspace":"neochrome","type":"ReminderCompleted","reminderId":"rem_123","payload":{"by":"U0..","method":"reaction","summary":"...","completedAt":"2026-06-13T09:14:10Z"}}
{"v":1,"id":"evt_...","ts":"2026-06-13T09:15:00Z","workspace":"neochrome","type":"BaselineReminderImported","reminderId":"rem_legacy","payload":{"text":"...","assigneeId":"U0..","sourceChannelId":"C0..","targetChannelId":"C1..","dueAt":"2026-06-14T16:00:00Z","state":"scheduled"}}
```

Invariants: append-only; `ts` monotonic per workspace; `type` from a closed enum mirroring the
FSM states plus migration-only baseline events; `v` enables upcasting; `reminderId` ties events
into a per-entity stream. Payloads must include every field required by current projections so
replay is deterministic without calling Slack or GitHub. Every emitted event must validate
against the Phase 0 schema before append; invalid events fail the transition rather than
entering the log.

A projection is then just:

```
fold(events.filter(workspace).filter(window), reducerForView) → view
```

## Appendix B: Compatibility Contract Impact

Per [AGENTS.md](../../AGENTS.md), the relevant contract tiers this plan touches:

- **High — Runtime behavior contract:** Phase 4 changes how state is loaded at startup (module
  startup behavior). Requires explicit compatibility review and staged rollout before it reaches
  all workspaces.
- **Moderate — Operator workflow contract:** new `data/runtime/events/` directory and a `replay`
  CLI; document in `ARCHITECTURE.md` and operator notes.
- **Build contract:** event emission must not bypass FSM enforcement —
  [scripts/validate-fsm-invariants.js](../../scripts/validate-fsm-invariants.js) may need a rule
  extension so "emit event" is recognized as part of the legal transition, not a rogue write.
- **Validation contract:** emitted event payloads must be schema-checked before append. Phase 0
  decides whether this extends `validate:fsm`, becomes `validate:events`, or both.

Phases 1, 2, 3, and 5 are additive/behind-shadow and low-risk. Phase 4 is the one gate that demands the
full High-tier review. Phase 6 is a removal and needs a one-release rollback window.
