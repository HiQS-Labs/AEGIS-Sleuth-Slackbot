---
title: P3 — Event-Sourced Core (the log is the source of truth)
created: 2026-06-12
updated: 2026-08-08
branch: development
status: Phase 0/1 done; Phase 2 built + shipped behind a default-OFF flag (1.4.197/1.4.198). The shadow-diff WAS run against real prod neochrome data and surfaced a pre-ledger data gap (reminders created before the ledger was born 2026-06-17 have no ReminderCreated event → null assignee/sourceChannel in the fold). GH-355 baseline-import (1.4.211, 2026-07-06) fixed it — the prod shadow-diff went 11 → 0 mismatches (only the documented ±1ms completedMs divergence remains). Cutover is now technically UNBLOCKED and reduces to one human-gated step (run the import on prod + flip SUMMARIZE_WEEK_COMPLETED_SOURCE=projection), now scheduled as a POST-DEPLOYMENT switch rather than a front gate. Phase 3 (entity-linking read-model) is DELIVERED as of the 2026-08-08 marathon. Phase 4 was BLOCKED on an event-schema gap; schema v2 (PR #31, 1.4.267) CLOSED three of that gap's four blockers — what remains is `readAll()` having no read-error signal, plus wiring the coverage gate that currently records state nothing reads. Phases 5 and 6a produced modules but converted no reads, because their marathon lanes excluded the files they were meant to change; lanes corrected, but ONLY Phase 5 (p6) may be re-run — Phase 6a is blocked with Phase 4. All three projection read flags REMAIN BLOCKED and must stay so until the coverage gate is default-deny and wired; see "STATUS UPDATE 2026-08-08 (post-schema-v2)" below for the per-blocker scoring. See "Marathon run 2026-08-08" for the full accounting.
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
  - RELEASES.md -> Release 1.5.0 "Ledger" — the finish-line goal post for this plan (band 1.5.0-1.5.9)
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
| **GH-355 baseline-import SHIPPED — 1.4.211 (2026-07-06), the blocker to Phase 2 cutover is cleared.** The Phase 2 shadow-diff (`scripts/summarize-week-shadow-diff.js`) *was* run against real prod `neochrome` data; it surfaced a Phase-0-anticipated gap — reminders created before the ledger was born (2026-06-17) have no `ReminderCreated` event, so the fold yielded `null` assignee/sourceChannel for them (11 mismatches over two post-floor weeks). `scripts/baseline-import.js` (one-shot, idempotent, scans both active + completed stores, emits `BaselineReminderImported` events carrying every projection-critical field) took the diff to **0** mismatches (only the documented ±1ms `completedMs` divergence remains). Full suite green (1198); prod-validated. See [GH-355](../3-COMPLETED/GH-355-P3-BASELINE-IMPORT.md). **Earlier:** Phase 2 (`summarize-week` projection) built + shipped behind a default-OFF flag — 1.4.197 (2026-06-16) + 1.4.198 (2026-06-17): `summarizeWeekFromEvents(...)` pure fold + shadow-diff CLI, then the staged read-path wiring (`SUMMARIZE_WEEK_COMPLETED_SOURCE=projection`, unset = current behavior byte-for-byte, error-wrapped fallback to `CompletionStore`). Phase 1 (non-authoritative dual-write) shipped 1.4.192/1.4.193, 2026-06-15. | **Cutover is technically UNBLOCKED — one human-gated step remains.** With GH-355 the shadow-diff is clean, so the only work left for Phase 2's exit criterion is the operator decision: run `scripts/baseline-import.js --write` on prod, then flip `SUMMARIZE_WEEK_COMPLETED_SOURCE=projection` to move users onto the projection. This is a supervised decision, not a build task — the code has been ready since 1.4.198 and the data gap is fixed since 1.4.211. Parked in `ROADMAP.md`'s Queue. **Sequencing changed (operator decision 2026-08-07):** this cutover is no longer a front gate on **Phase 3: Entity Linking Read-Model** — which as of 2026-08-08 is **DELIVERED, not "zero code"** (see "Marathon run 2026-08-08" below). It is a **post-deployment switch** — run the import and flip the flag after the phase work merges and deploys. **Current sequence (2026-08-08, corrected after Codex review round 5):** (1) PR the delivered, additive Phase 3 work; (2) re-run **p6 ONLY** on a new branch against the corrected `MARATHON.yaml` lane, to actually convert the reads — Phase 5's cutovers are independently reversible (flag + fallback), so they need nothing from boot-authority; (3) **defer p5 (Phase 4), p7 (Phase 6a) and p8 (the drill) together** behind one event-schema-expansion proposal. p7 is blocked for the *same* reason as p5, which I originally missed: its exit criterion is "flip `REMINDER_STATE_SOURCE` off **after running on the log**, reboot from the derived snapshot" — that requires the log-authoritative boot Phase 4 was meant to deliver, and `REMINDER_STATE_SOURCE` does not exist in `src/` at all. p8's drill asserts the p7 seams, so it waits with them. The Phase 2 prod flip below is an unrelated, human-gated deployment action and is not on that critical path. A switch on a remote server does not gate whether local code is built, reviewed and tested; verified that no phase artifact reads `SUMMARIZE_WEEK_COMPLETED_SOURCE` (it is confined to `src/reminders-app-mention-handler.js:1250`, whose test sets the flag itself). The validation that originally justified the gate already happened — GH-355 took the prod shadow-diff 11 → 0. The authority flips (Phase 4 boot-rebuild, Phase 6 retire-mutable-writes) remain **NOT an assumed continuation** — per the [direction review](#direction-review-codex-2026-06-16) they return as a **fresh proposal** only if Phase 2/3/5 evidence shows the app materially benefits from authoritative replay. |

### Marathon run 2026-08-08 — what actually shipped, and what did not

The `ledger-p3-entity-linking` marathon ran all 8 phases on branch
`marathon/p3-event-sourced-core-2026-08-08`. Recording the real outcome, because the status above
described Phase 3 as "fully spec'd, zero code" and that is no longer true.

| Plan phase | Marathon | Outcome |
|---|---|---|
| **Phase 3** — entity-linking read-model | p1–p4 | **DELIVERED.** `src/entity-projection-inputs.js`, `src/entity-linking.js`, `src/entity-read-model.js`, `scripts/entity-linking-diagnostics.js` + suites. Additive, no write-path or authority change. Nothing in `src/` imports them — which is Phase 3's stated design ("useful *without* requiring Phase 4 authority changes"). |
| **Phase 4** — boot-time rebuild | p5 | **HALTED, correctly.** Structurally blocked — see below. No code. |
| **Phase 5** — remaining projections | p6 | **PARTIAL.** `src/reminders-projection.js` + parity harness built and unit-tested, but **not one read was converted.** Exit criterion ("every downstream view is produced by a fold") unmet. |
| **Phase 6a** — retire mutable writes | p7 | **PARTIAL.** `src/state-snapshot-writer.js` built, wired to no live reader. |
| Reversibility drill | p8 | **Correctly RED.** Its stop gate refuses to certify switches that have no owning reader. This is the gate working. |

**Why Phase 4 is blocked (p5's halt analysis, reviewer-confirmed).** The ledger cannot reconstruct
boot state, so the required deep-equality and fallback guarantees are unreachable without a schema
change:

- `ReminderCreated` persists only the display/identity subset. It omits `OriginalChannelName`,
  `OriginalMessageID`, `OriginalThreadTs`, `OriginalSenderID`, `IgnoreSnooze`. `ReminderScheduled`
  carries only `dueAt` and `via` and cannot backfill them.
- The ledger deliberately omits the `due`, `overdue`, `posting`, `posted`, `rescheduled`, `failed`
  and `dead-letter` transitions, so a fold cannot reproduce in-memory state for active reminders
  even when every creation event is present.
- `ReminderCompleted` lacks `sourceChannelID`, `dueDate` and `clientId`, so a log-only
  `CompletionStore` rebuild cannot match the JSON path either.
- `event-store.readAll()` returns an empty/partial stream on read failure with **no error signal**,
  so it structurally cannot trigger contract item (c)'s warn-and-fall-back-to-JSON behaviour.

**Phase 4 therefore needs an explicit schema-expansion proposal first** — widen the event payloads,
extend emission coverage to the omitted transitions, add a strict boot-read error signal, backfill
the new fields, and only then establish parity. That is its own plan, not a retry of p5.

#### STATUS UPDATE 2026-08-08 (post-schema-v2) — three of those four blockers are CLOSED

The schema expansion called for above was written and shipped as **schema v2 (PR #31, 1.4.267)**, see
[`P3-EVENT-SCHEMA-EXPANSION.md`](./P3-EVENT-SCHEMA-EXPANSION.md). Scoring the four blockers above
against `src/event-store.js` as it now stands, rather than leaving the list reading as though none had
moved:

| # | Blocker above | Status |
|---|---|---|
| 1 | `ReminderCreated` omits `Original*` / `IgnoreSnooze` | **CLOSED.** v2 requires `createdOn`, `originalSenderId`, `originalMessageId`, `originalThreadTs`, `originalChannelName`, `ignoreSnooze`, `assigneeIds`, `clientId`. |
| 2 | omitted `due`/`overdue`/`posting`/`posted`/`rescheduled`/`failed`/`dead-letter` transitions | **CLOSED.** `ReminderStateChanged` covers all seven; `ReminderRemoved` covers queue exit, which this list never identified and real data proved was the worst of them. |
| 3 | `ReminderCompleted` lacks `sourceChannelID`, `dueDate`, `clientId` | **CLOSED.** v2 requires those three plus `completedMs`, sampled once and threaded to both writes. |
| 4 | `readAll()` degrades to an empty stream with **no error signal** | **STILL OPEN.** `src/event-store.js` still returns `[]` for *any* read error, so I/O failure is indistinguishable from a genuinely empty ledger and contract item (c) remains structurally untriggerable. |

The separate GitHub-relay finding recorded under the Phase 5 table below is also **CLOSED**: v2
carries `gitHubRelayStarted`/`gitHubRelayStopped` on creation and import, and `ThreadRelayStateChanged`
carries every later change, thread-scoped.

**Phase 4 is therefore no longer blocked on schema.** It is blocked on blocker 4 plus the coverage
wiring described below. That is a materially smaller remaining scope than this section implied, and
the distinction matters: leaving it unstated caused `ask-self` to report the schema gap as open
weeks after it was closed, because this document is what it reads.

#### The gate that does not yet gate — found 2026-08-08

`src/ledger-coverage.js` exists and is correct, and `ReadWithProjectionFallbackAsync` accepts an
`IsCoverageCleanAsync` callback. **Neither is connected.** Two defects, both verified in code:

1. **No production caller supplies it.** `IsCleanAsync` appears nowhere outside
   `tests/ledger-coverage.test.js`. All three read sites — `reminders-module.js:2984`,
   `web-api.js:408`, and the export path at `web-api.js:937` — omit the callback. The append path
   records coverage faithfully (`BeginAppend`/`SettleAppend`); nothing ever asks for the result.
2. **The gate fails OPEN when omitted.** The check is wrapped in
   `if(typeof ArgOptions.IsCoverageCleanAsync === 'function')`, so a caller that supplies nothing
   skips it and serves the projection. Its own comment says an ungated caller "is simply unverified,
   which is itself a reason not to serve" — the code does not do that. `ledger-coverage.js` defaults
   to unclean; this call site defaults to permissive, which cancels it out.

Consequence: unblocking any flag today would serve a projection with **no coverage gate at all**,
which is the precise failure the gate was built to prevent. Fix before any flip: default-deny in
`ReadWithProjectionFallbackAsync` (absent callback ⇒ do not serve) and thread
`#LedgerCoverage.IsCleanAsync` through all three call sites.

> **DONE.** Both landed 2026-08-08. The gate is default-deny (absent, non-`true`, or throwing all
> refuse), instances are shared per `rootDir` so `web-api` sees `reminders-module`'s in-flight
> appends, `readAll` signals read errors and mid-file corruption instead of returning `[]`, and
> `projection-parity-harness --record-coverage` is the one sanctioned way to reach `verified`.
> `BLOCKED_PROJECTION_FLAGS` is now empty and kept only as the emergency stop.

#### What the gate caught the moment it was pointed at production — 2026-08-09

The first thing it reported was a **real defect in schema v2 itself**, not a coverage question.

`neochrome_ledger_coverage.json` read `{"state":"gap","reason":"append-failed","detail":
"ReminderScheduled"}`. The cause was not I/O — the log line is
`event-store: invalid event shape, not written`:

```
#EmitTransitionEvent → case State.Scheduled:
  this.#EmitLifecycleEvent('ReminderScheduled', ArgReminder, { dueAt, via })   // no ignoreSnooze
```

Schema v2 **requires** `ignoreSnooze` on `ReminderScheduled`. The creation-time emitter
(`reminders-module.js:745`) carries it; the transition-time emitter did not. So **every reschedule
since the v2 deploy was rejected and silently dropped from the ledger.** Nothing surfaced: appends
are best-effort, the warning is non-fatal, and the reminder itself reschedules correctly. The only
durable trace was the coverage marker.

Two conclusions worth keeping:

1. **The mechanism paid for itself before serving a single projection.** A gate whose first act is to
   refuse on real evidence is behaving correctly; the temptation is to read a `gap` as the gate being
   broken rather than as the ledger being short.
2. **No test covered a transition INTO `scheduled`.** The suite drove creation, completion,
   cancellation, and snooze. `AssertNoDroppedAppendsAsync` now reads the coverage marker at the end
   of an emission scenario, so any dropped append in any covered path fails the suite — a rejected
   append changes nothing else a test can observe.

#### Why a flag flip is still inert today, on real data

Rehearsed against a copy of the dev workspace's real ledger (347 events) and again against
production's (1809 events, 1467 v1 / 342 v2). Even after `--enrich` and compaction, parity does not
come back clean, for reasons that are data-shape rather than code:

| Symptom | Cause |
|---|---|
| `IgnoreSnooze` missing for enriched reminders | their later `ReminderScheduled` events are **v1** and cannot carry it; nothing backfills a v1 transition |
| ordering differs | the fold emits baseline-imported reminders first, the JSON store keeps queue order — byte parity compares positionally |
| `AssigneeIDs`, `GitHubRelayStarted/Stopped` differ on every record | the fold sets them; legacy JSON records omit the fields entirely |

So the honest position: the switches are now **verifiable and safe**, and on today's data they
correctly evaluate to "do not serve". Enabling a flag is therefore a no-op that logs its refusal —
which is the right thing for it to do, and is not the same as being switched over.

> **SUPERSEDED, same day.** The table above was written before compaction was seeded from the
> authoritative store. Two of its three rows no longer apply. See the corrected accounting below,
> which is the one to trust.

### THE COMPLETE REMAINING INVENTORY — 2026-08-09

Written in one pass, after an exhaustive sweep, because this plan had been surfacing its own gaps one
at a time. Everything known to stand between today and a served projection is in this section. Where
something is *not* known, that is stated rather than omitted.

#### What compaction actually achieves, measured on a copy of production

`BuildCompactedEvents` now accepts `authoritative` and prefers it over the fold. Compaction replaces
the log, so seeding it from the fold would bake in whatever the ledger was missing with no earlier
event left to correct it — which was not hypothetical: reminder `9ba4c949` held a due date two days
stale because its reschedules were the events the emitter bug dropped.

| Measure | Fold-seeded | Authoritative-seeded |
|---|---|---|
| events | 1809 → 327 | 1809 → 327 |
| strict fold | PASSES | PASSES |
| reminder id set | matches | matches |
| ordering | ✗ differs | **✓ matches** |
| `ShouldPostOn` | ✗ 1 stale (`9ba4c949`) | **✓ none** |
| `CreatedOn` ±1ms | ✗ 3 records | **✓ none** |

#### The one remaining parity gap, exhaustively characterised

Comparing every key of every record, in both directions, on real production data:

| Class | Count | Fields |
|---|---|---|
| Fold **invents** a key absent from the authoritative record | 128 | `GitHubRelayStarted` (22), `GitHubRelayStopped` (23), `clientId` (83) |
| Fold **omits** a key the authoritative record has | **0** | — |
| Both present, **values differ** | **0** | — |

One class, three field names, nothing else. `undefined` vs `false`/`null` is semantically identical,
but the harness requires byte equality, so it blocks a `verified` marker and therefore the gate.

**Fix — omit, don't invent.** The projected read model must not materialise a key nothing ever set.
This is a *read-model* change only: v2 still requires those keys in the **event payload**, where they
stay explicit, so the relay-safety property (`github-comment-relay.js:102` refuses to relay when
`GitHubRelayStopped` is set) is untouched. The two layers must not be conflated.

#### Everything else that is missing, and was not previously written down

1. **Compaction has no operator entry point.** `WriteSnapshotAndCompactAsync` and
   `BuildCompactedEvents` are called by **tests only** — no production caller, no CLI, no npm script.
   Needs `scripts/compact-ledger.js` that reads the ledger and both authoritative stores, folds
   non-strict, and passes `authoritative` through. Without it there is no sanctioned way to compact.
2. **Compaction races a running service.** It rewrites the whole log while the app appends to it.
   The service must be stopped for the duration, or the operation needs a lock. Nothing enforces this
   today, and nothing warns about it.
3. **Compaction is irreversible** — it discards the v1 audit trail permanently. Requires a verified
   backup first and an explicit decision, every time. `docs/p3-rollback-runbook.md` exists but
   predates all of this and does not cover it.
4. **No test covers the `authoritative` compaction option.** It was added without one; the existing
   suite only exercises the fold-seeded path.
5. **Coverage markers are per workspace.** Production has seven workspaces but only `neochrome` has
   any reminders (23) or a ledger. The other six are correctly refused for want of a marker, and
   `readAll` returns `[]` for their absent ledgers. Only one workspace needs verifying.
6. **A clean harness verdict needs the `rebalance` surface**, which only the running web API can
   produce (`missingSurfaces: ['rebalance']`). With the rebalance integration descoped (below) the
   harness must be able to reach `clean` without it, or it can never pass.
7. **`PROJECTION_ERROR_PATH_TEST_ONLY` is registered and unblocked.** It exists so the error-fallback
   path is testable. It is inert unless someone sets that exact env var, but it is a live code path
   in production and should be named rather than forgotten.

#### The post-deployment integration this plan never accounted for

`deploy/reminders-export/` is a **separately installed component** — it lives at
`/root/sleuth-reminders-export/`, outside `/root/sleuth-app/`, so a deploy of the app does not touch
it. A systemd timer runs it every 5 minutes:

```
sleuth-reminders-export.timer  (OnCalendar=*:0/5, Persistent=true)
  └─ publish-reminders-export.mjs
       GET http://127.0.0.1:2020/workspace/<ws>/reminders?format=rebalance&activeOnly=true
       └─ commits the JSON to a private git repo, which rebalance-OS reads
```

This is what those `REBALANCE_EXPORT_SOURCE requested…` log lines every five minutes actually are.

Two problems found:

- **The installed copy has drifted from the repo.** `publish-reminders-export.mjs` and
  `export-payload.js` differ by checksum, and `events-projection.js` and `completions-payload.js`
  exist in the repo but were **never installed**. Nobody has reconciled them; the repo is not a
  description of what is running.
- **It fails whenever the app restarts.** It polls loopback, so a restart inside its 5-minute window
  produces `local API request failed: fetch failed` and a unit failure. Observed at 06:30:04 today,
  caused by a restart of ours. Self-healing on the next tick, but it means every deploy writes a
  failure into the journal and briefly staleness into the export.

#### Rebalance is descoped — deliberately, not removed

Per the operator: the rebalance integration is being decoupled from the `neochrome` workspace and is
not to be dealt with further unless a **security or performance** issue appears. Nothing was torn
down. `REBALANCE_EXPORT_SOURCE` was removed from `.env.runtime` on both hosts, which only changes
*which store the export reads from* — it reads the authoritative JSON, exactly as it already was,
since the gate was refusing anyway. The endpoint, the payload builder, the timer, and the export are
untouched and still running every 5 minutes.

For the record, on the two dimensions that would bring it back into scope:

- **Performance** — leaving the flag off is also the cheaper option. The projection path folds the
  entire ledger on every call; the authoritative path reads one JSON file. At a 5-minute poll the
  difference is small but strictly in favour of off.
- **Security** — the endpoint is bearer-token protected on loopback only, and the transport is a
  private git repo rather than an inbound port. No open port, no tunnel. Nothing found.

The consequence for this plan is that **the cutover is now two flags, not three**:
`REMINDERS_READ_SOURCE` and `COMPLETED_READ_SOURCE`, both inward-facing. The one flag whose failure
mode left the building is out of scope by decision.

#### Ordered plan to a served projection

1. Omit-don't-invent in the fold (3 fields) — the last code change for parity.
2. `scripts/compact-ledger.js`, passing `authoritative`, with a mandatory backup and a refusal to run
   while the service is up.
3. Make a `clean` verdict reachable without the `rebalance` surface.
4. Test for the `authoritative` compaction path.
5. Stop service → back up → compact `neochrome` → restart.
6. `projection-parity-harness --record-coverage` → expect `verified`.
7. Confirm the gate opens and the two flags serve the projection; watch for one full reminder cycle.
8. Reconcile `deploy/reminders-export/` drift, or record deliberately that it is frozen.

### Cross-model consult, 2026-08-09 — the inventory above was NOT complete

Codex and agy reviewed the inventory independently. Both found real defects, and they converge on
the same theme: **the gate proves a moment, and nothing binds that proof to the moment it was taken.**
Each item below was re-verified in the code before being written down — the consult runner flagged
`FIRSTHAND_COUNT=0` for both models, so nothing here is recorded on their say-so alone.

#### Verified and FIXED immediately (a defect introduced by this session's own change)

**`WriteSnapshotAndCompactAsync` would have overwritten the authoritative stores from the fold.**
It calls `WriteDerivedSnapshotAsync` first, which writes `reminderFilePath` and `completionFilePath`
from `ArgOptions.folded`. Adding `authoritative` to `BuildCompactedEvents` alone made one options
object mean "trust the fold" in one function and "trust the store" in the other — so an operator
compacting with an authoritative seed would have had the JSON store clobbered by the short fold
*first*, destroying the very `ShouldPostOn` the seeding exists to preserve.

Fixed: the function now **throws** when `authoritative` is supplied, rather than picking a winner.
Authoritative-seeded compaction must use `BuildCompactedEvents` and write only the event log. Two
tests cover it — one proving the authoritative due date survives compaction, one proving the
contradiction is refused.

#### Verified, still OPEN

| # | Finding | Evidence |
|---|---|---|
| 1 | **A crash mid-append leaves the marker `verified` while the log is short.** `BeginAppend` increments an in-memory counter only; `SettleAppend(false)` is what writes a durable gap. Kill the process between them and the shortfall is real but unrecorded — the very case `ledger-coverage.js`'s own comment claims to handle ("the shortfall is in the file, not merely in this process's memory"). | `src/ledger-coverage.js` — `BeginAppend` is `InFlight.set(...)` and nothing else |
| 2 | **A successful-but-wrong append never invalidates the proof.** `SettleAppend(ok=true)` only decrements the counter. A schema-valid event carrying a wrong value, or a reducer bug shipped after verification, keeps serving under the old `verified` marker. The marker is not bound to a ledger generation. | `src/ledger-coverage.js:IsCleanAsync` tests `Marker.state === 'verified'` and nothing about the ledger's current content |
| 3 | **The harness folds with `strict:false`; the served read path uses `strict:true`.** So the harness can record `verified` for a stream the live projection would then refuse — verification and production disagree about what counts as foldable. | `scripts/projection-parity-harness.js` vs `web-api.js` / `reminders-module.js` read paths |
| 4 | **The harness parses raw JSONL directly instead of going through `event-store.readAll()`**, so it never exercises the corrupt-tail and unknown-type handling that production reads have — including the new `LedgerReadError` / `LedgerCorruptionError` signals. | harness reads the file itself |
| 5 | **No ledger flush on shutdown.** `#AppendLedgerEvent` is fire-and-forget and nothing awaits outstanding appends during `StopAsync`, so a graceful stop does not prove the log caught up. This makes "stop the service before compacting" insufficient on its own. | `src/reminders-module.js` `#AppendLedgerEvent` / `StopAsync` |
| 6 | **Absent vs explicit `false` may be a real distinction, not noise.** Both models pushed back on "omit, don't invent": `Boolean()` coercion in compaction erases the difference between "never relayed" and "relay explicitly stopped". Before implementing the omit fix, confirm no consumer needs to tell those apart — `github-comment-relay.js` refusing to relay when `GitHubRelayStopped` is set is the case to check. | flagged by both models |

#### What this changes

Items 1–5 mean the current gate is a **fail-closed brake, not a proof**: it reliably refuses when it
knows something is wrong, and it does not know about crashes, wrong-but-valid events, or the gap
between how verification folds and how production folds. That is adequate for keeping the flags shut
— which is what it is doing today — and **not** adequate as the sole authorisation to serve.

The cheapest fix that addresses 1, 2 and part of 3 together is to bind the marker to a **ledger
generation**: record event count and last event id at verification, and have `IsCleanAsync` compare
the current ledger against it. Any divergence — crash-lost, failed, or merely new — reads as unclean.
That is strict enough that a continuously-appending workspace would re-close the gate on every
reminder change, so it needs pairing with either scheduled re-verification or continuous shadow
diffing. Sequencing that trade-off is the next design decision, and it belongs before the flip, not
after.

Item 6 must be resolved **before** the omit-don't-invent change, not after: if absence and `false`
are genuinely different, then omitting is the wrong fix and the authoritative records are the thing
that should gain explicit values.

#### Deployed and flipped on both servers — 2026-08-09

All three flags are set to `projection` in `.env.runtime` on dev and production. Both refuse and
serve the authoritative store, which is the whole point: the switch is thrown, and the gate is what
holds it.

| | dev (`neochrome-dev`) | production (`neochrome`) |
|---|---|---|
| service | active, `NRestarts=0` | active, `NRestarts=0` |
| reminders after restart | 7, unchanged | 23, unchanged |
| ledger | 347 lines | 1809 lines |
| gate decision | refuses — "no clean coverage record" | refuses — same |
| new append failures since deploy | 0 | 0 |

Backups taken before each deploy (`/root/backups/sleuth-app-{CODE,DATA}-<stamp>.tar.gz`, both
verified readable), and `.env.runtime.bak-preflip` holds the pre-flip env on each host.

**The dev server changed lineage.** It tracked `NeochromeTeam/sleuth-app` (1.4.244) and had none of
the P3 files; production has run AEGIS code over a private-repo checkout for some time. Dev now
matches production. The deploy was deliberately **additive — no `--delete`** — because a delete pass
wanted to remove 5502 paths including dev's entire `.git` (5311) and its private CI workflows.
Private-repo-only files remain on disk and are inert; `app.js` never requires them.

Two deploy traps worth keeping written down:

- **`--exclude='.git'` must not have a trailing slash.** A git *worktree* has `.git` as a FILE while
  the server has a DIRECTORY, so `.git/` matches only the latter and rsync fails with
  `could not make way for new regular file: .git` (exit 23). The same error hit the earlier
  production deploy.
- **`/etc/systemd/system/sleuth-app.service` is a symlink INTO the repo**, so an rsync of the repo
  rewrites the live unit. Here the old and new files were byte-identical, but that is luck, not
  design — diff the unit against the backup before `daemon-reload`.

Also fixed: `git config --system --add safe.directory /root/sleuth-app` on both hosts. `--global`
had already been set and did nothing, because the systemd service runs with **no `HOME`** and so
never reads `/root/.gitconfig`. The symptom was `fatal: detected dubious ownership` on every
version/changelog lookup.

Unrelated and pre-existing on production: `Notion API connectivity test failed: API token is
invalid`, first seen 2026-07-22 and 6 times before this deploy. Not caused by this change; the token
needs rotating.

### Phase 5 read cutover — result of the 2026-08-08 re-run

p6 re-ran on the corrected lane via `MARATHON-P6-ONLY.yaml` and is **APPROVED, gate passed**
(98 suites / 1561 tests, `tsc` exit 0, `validate:fsm` OK). It converted **two of the three** read
surfaces and correctly **halted on the third**:

| Read surface | Flag | Owner | Result |
|---|---|---|---|
| reminder queue | `REMINDERS_READ_SOURCE` | `src/reminders-module.js` | **converted** |
| `?format=rebalance` export | `REBALANCE_EXPORT_SOURCE` | `src/web-api.js` | **converted** |
| completed store | `COMPLETED_READ_SOURCE` | `src/web-api.js` | **BLOCKED** (shipped live in round 1, then blocked after QA) |

`src/reminders-module.js` now imports `reminders-projection` — the integration three earlier
phases never achieved, because the file was not in their lane.

**Why the completed store halted, verified independently.** `GitHubRelayStarted` and
`GitHubRelayStopped` are persisted `ReminderInfo` fields (`src/reminders-module.js:87-88`) but are
**not** in the event-store's accepted event enum, so a fold silently drops them and the read would be
lossy. The builder refused to ship it and the reviewer approved the halt — the reversibility contract
doing its job, exactly as it did for p5.

**This adds a requirement to the schema proposal.** The event-schema expansion that unblocks Phase 4
must ALSO carry the GitHub-relay state fields, or `COMPLETED_READ_SOURCE` stays blocked even after
Phase 4 lands. That is a new finding from this run, not part of the original Phase 4 blocker list.

> **DONE — schema v2, 2026-08-08.** `gitHubRelayStarted`/`gitHubRelayStopped` are required on
> `ReminderCreated` and `BaselineReminderImported`, and `ThreadRelayStateChanged` carries later
> changes thread-scoped on `OriginalThreadTs ?? OriginalMessageID`. The "converted" marks in the table
> above describe the p6 marathon lane, **not** production: all three flags are in
> `BLOCKED_PROJECTION_FLAGS` and every one of them serves the authoritative JSON store today.

**Why Phases 5 and 6a delivered modules but no integration.** Their marathon lanes excluded the
files they were meant to change — `src/reminders-module.js` and `src/web-api.js` were not in p6's
`artifact:` list, and containment reverts edits outside a lane. The artifact lists are corrected in
[MARATHON.yaml](P3-EVENT-SOURCED-CORE/MARATHON.yaml), **but only p6 may now be re-run** — Phase 6a
(p7) is blocked with Phase 4, not merely awaiting a re-run, because its rollback criterion needs the
log-authoritative boot Phase 4 never delivered. Run p6 via
[MARATHON-P6-ONLY.yaml](P3-EVENT-SOURCED-CORE/MARATHON-P6-ONLY.yaml).

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

## Swarm Preflight Contract

Machine-readable intake contract for `.xyz/utils/swarm-preflight.sh --project-doc`, which turns this
doc into a marathon-ready run packet. It is the **producer** of the packet, never the executor.

**REWRITTEN 2026-08-08 — this is now a p6-ONLY packet.** The original was an eight-phase greenfield
contract written when none of the artifacts existed. It is obsolete twice over:

1. **Its probes now lie.** It declared every artifact `path_absent`, but p1–p4 delivered theirs and
   p6/p7 partially delivered theirs. Preflight would return `4 STALE` (some present) or `7 AMBIGUOUS`
   (mixed) and refuse to start — correct behaviour on a contract that no longer describes reality.
2. **Only p6 is runnable.** p5 (Phase 4) is blocked on event-schema expansion. **p7 is blocked on the
   same thing** — its own exit criterion is "flip `REMINDER_STATE_SOURCE` off *after running on the
   log*, reboot from the derived snapshot", which requires the log-authoritative boot Phase 4 was
   supposed to deliver; `REMINDER_STATE_SOURCE` does not exist in `src/` at all. p8's drill asserts
   the p7 seams, so it waits too. Shipping an eight-phase packet would invite exactly the run that
   already produced two unwired modules.

So the runnable tranche is **p6 alone**, executed via
[`MARATHON-P6-ONLY.yaml`](P3-EVENT-SOURCED-CORE/MARATHON-P6-ONLY.yaml) — a dedicated single-phase
manifest, because `marathon.sh` has **no phase-selection flag** (`--retry` overrides one phase's task
id but still walks the whole chain), so pointing it at the 8-phase `MARATHON.yaml` would schedule the
three deferred phases regardless of what this document says.

**What the prerequisite PR must contain.** These `path_present` probes assert
`src/reminders-projection.js` and `scripts/projection-parity-harness.js`, which are p6's *partial*
output — not part of Phase 3's delivered inventory. So the PR that precedes this run **must merge the
additive p6/p7 artifacts as well as Phase 3**, or preflight stays permanently `6 BLOCKED`. That is
safe and deliberate: those modules are unit-tested, import nothing, and are imported by nothing, so
merging them is inert in production while giving the re-run a base to build on rather than restart
from. p4 is the satisfied prerequisite, asserted by probe rather than re-run.

What the probes are doing:

- **`grep_absent` on the three read flags** — this is how "the fix is still required" is proven now
  that p6's *files* exist but convert nothing. If `REMINDERS_READ_SOURCE` / `COMPLETED_READ_SOURCE`
  appear in `src/reminders-module.js`, or `REBALANCE_EXPORT_SOURCE` in `src/web-api.js`, the cutover
  has landed and preflight exits `4 STALE`. Absent means the work is genuinely outstanding.
- **`path_present` on the delivered inputs** — Phase 3's read-model, p6's own module and parity
  harness, and the Phase 1/2 substrate. Any of them missing means this packet is being run against
  the wrong ref (e.g. before the Phase 3 PR merged), and preflight exits `6 BLOCKED` instead of
  starting a doomed run.
- **No `artifacts_new`** — every path in `artifacts` already exists, so the strict existence check
  applies to all of them, which is what we want for a re-run against real files.

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test",
  "fix_probes": [
    { "type": "grep_absent", "path": "src/reminders-module.js", "pattern": "REMINDERS_READ_SOURCE" },
    { "type": "grep_absent", "path": "src/reminders-module.js", "pattern": "COMPLETED_READ_SOURCE" },
    { "type": "grep_absent", "path": "src/web-api.js", "pattern": "REBALANCE_EXPORT_SOURCE" },
    { "type": "path_present", "path": "src/reminders-projection.js" },
    { "type": "path_present", "path": "scripts/projection-parity-harness.js" },
    { "type": "path_present", "path": "src/entity-read-model.js" },
    { "type": "path_present", "path": "src/event-store.js" },
    { "type": "path_present", "path": "src/summarize-week-projection.js" }
  ],
  "artifacts": [
    "src/reminders-projection.js",
    "scripts/projection-parity-harness.js",
    "tests/projection-parity.test.js",
    "src/reminders-module.js",
    "src/web-api.js",
    "package.json",
    "tests/reminders-integration.test.js",
    "tests/web-api-reminders.test.js",
    "tests/completion-store.test.js"
  ],
  "remediation": {
    "source": "PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE/MARATHON.yaml#p6",
    "criteria": "p6 (plan Phase 5) ONLY. Convert the remaining reads to projections behind default-OFF flags with fallback to the authoritative store: the two JSON stores via RemindersModule.GetAllReminders (src/reminders-module.js:736) and GetCompletedRemindersBetween (:842), and the ?format=rebalance export via the WebAPI read path (src/web-api.js:354, 903-905). Ship the parity harness comparing old JSON/API output against the folded event output, byte-compatible where feasible and semantically diffed where timestamps or ordering legitimately differ. Done when every one of those three views can be produced by a fold behind its flag, the flag unset reproduces today's behaviour byte-for-byte, a projection error falls back to the authoritative store and is logged but never user-visible, and a test flips each switch OFF and asserts correct behaviour. p5, p7 and p8 are OUT OF SCOPE for this packet and are blocked on an event-schema-expansion proposal that has not been written."
  },
  "lanes": {
    "agy_safe": [],
    "orchestrator_only": ["bin/", ".tick/", "relay-automation/relay-turn-lib.sh"]
  }
}
```


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

- [Swarm Preflight Contract](#swarm-preflight-contract)
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

- Use the event ledger as a **non-authoritative semantic substrate** for client ↔ project ↔ task
  association before considering any authority flip. **Sequencing (operator decision 2026-08-07):**
  the Phase 2 prod cutover is no longer a front gate on this phase — it is a post-deployment switch.
  A flag on a remote server governs whether code is *live*, not whether it may be *built*; no
  artifact in this phase reads `SUMMARIZE_WEEK_COMPLETED_SOURCE`. See
  `P3-EVENT-SOURCED-CORE/MARATHON.yaml` § POST-DEPLOYMENT SWITCH.
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
