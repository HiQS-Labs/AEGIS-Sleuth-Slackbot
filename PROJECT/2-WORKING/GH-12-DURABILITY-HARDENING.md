---
title: "Durability hardening — atomic + fsync'd writes for the authoritative JSON stores"
status: In progress (2-WORKING) — Phase 0 complete, Phase 1 next
created: 2026-08-04
updated: 2026-08-04
owner: noel
branch: claude/GH-12-durability-hardening
doc_type: project
gh_issue: 12
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/12
related: "P3-EVENT-SOURCED-CORE (the structural answer; this hardens the mutable-JSON path that stays load-bearing until P3 lands) — PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md; PROJECT/4-MISC/PHASE-0-SPIKE.md (recorded the no-fsync reality); HONEST.md:77/115/128; README.md:135-141"
context_tags: [durability, persistence, crash-safety, fsync, reliability]
effort: 3
complexity: 3
risk: 3
phases: 6
ratings_provisional: false
non_goals:
  - Not a datastore migration — no SQLite/Postgres swap, the JSON files stay JSON files
  - Not the P3 event-sourced cutover (separate, parked at ROADMAP.md:86)
  - Not load testing (real, untracked, tracked separately)
  - Not changing any public durability claim until the work ships AND is verified
  - Not adding a write-ahead log, journal, or checksum scheme — atomic rename is sufficient here
goal: >
  AEGIS persists authoritative state via plain fs.writeFile — a truncate-then-rewrite with no temp
  file, no atomic rename, and no fsync anywhere in src/. A hard kill mid-write leaves unparseable
  JSON; every loader degrades that to "start empty"; no writer guards on the failed-load flag, so
  the next ordinary write persists the empty set over the survivor data. Close that hole: one shared
  durable-write helper (temp -> fsync -> rename -> fsync dir), adopted in blast-radius order, plus a
  quarantine guard so a corrupt load can never be silently overwritten.
---

# GH-12 — Durability hardening

## Status

| What was just completed | What's next |
|---|---|
| **Phases 0-2 complete.** Phase 1 (helper + crash harness) and Phase 2 (reminder queue) both agy-QA'd; Phase 1 **Approved**. Empirical results so far: hard-kill corruption reproduced at **6/40** on the old path and **0/40** on the new one; the lost-update race reproduced at **3/8** with serialization bypassed and **0/8** with it. | **Phase 3** — completion store: adopt the helper, quarantine guard, load-time sweep. |
| *(historical)* **Phase 0 (discovery) complete**, and **plan QA'd by agy** (relay round 1, `relay-system/2026-08-04/gh12-durability-plan-qa.md`). Agy independently re-verified all five Phase 0 claims with citations and confirmed the tier re-ranking. It returned **Changes requested** with 1 Blocker + 2 Shoulds, all three now folded in below. Issue [#12](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/12) filed; branch `claude/GH-12-durability-hardening` cut. | **Phase 1** — `src/durable-write.js` (unique temp names + sync variant) **and** the crash-injection harness, which must first go red on unmodified `main`. |

### Plan-review dispositions (agy round 1)

| Finding | Disposition |
|---|---|
| **[Blocker]** static `${path}.tmp` corrupts under concurrent saves — `reminders-module.js` has no write serialization | **Implemented + extended.** Unique per-write temp names in Phase 1. Extended because the proposed fix is necessary but *not sufficient*: unique temps prevent corruption but not **lost updates** (A snapshots, B snapshots, B renames, A renames stale on top). Phase 2 also ports `completion-store`'s `#WriteChain` idiom into `reminders-module`. |
| **[Should]** Phase 2's kill-mid-write gate depends on a harness not built until Phase 6 | **Implemented.** Harness moved to Phase 1; Phases 2-3 now gate on it as they land. Phase 6 keeps the full-scale run + doc truthing. |
| **[Should]** `client-mapping.js:362` is `writeFileSync`; helper needs a sync variant | **Implemented.** `WriteFileDurableSync` added to Phase 1, keeping Phase 5 mechanical instead of forcing an async refactor. |

## Table of contents

- [Phase 0 — Discovery & audit](#phase-0--discovery--audit) *(complete — findings inline)*
- [Phase 1 — The shared durable-write helper + the crash-injection harness](#phase-1--the-shared-durable-write-helper--the-crash-injection-harness)
- [Phase 2 — Tier 1: the reminder queue](#phase-2--tier-1-the-reminder-queue)
- [Phase 3 — Tier 2: the completion store](#phase-3--tier-2-the-completion-store)
- [Phase 4 — Tier 3: the event ledger](#phase-4--tier-3-the-event-ledger)
- [Phase 5 — Sweep the remaining authoritative writers](#phase-5--sweep-the-remaining-authoritative-writers)
- [Phase 6 — Full-system verification & honest doc update](#phase-6--full-system-verification--honest-doc-update)

## Context

`HONEST.md` has carried this as a known caveat for a while:

> **No `fsync` anywhere.** Both the completion store and the event ledger use plain
> `fs.writeFile`/`appendFile`. Durable against a graceful deploy/restart (the stated goal), **not**
> against a hard kill mid-write. — [`HONEST.md:77`](../../HONEST.md#L77)

and grades "Crash-proof / zero-data-loss durability" as **Don't say yet**
([`HONEST.md:115`](../../HONEST.md#L115)), with the fix as roadmap intent at
[`HONEST.md:128`](../../HONEST.md#L128). The README states the same caveat publicly
([`README.md:135-141`](../../README.md#L135-L141)).

This doc closes it. The framing correction from Phase 0 is that `HONEST.md:128` names the wrong two
subsystems: it says "the authoritative and ledger writes", but the **reminder queue** — the actual
product data — has the same defect and the biggest blast radius, while the **ledger is the safest**
of the three.

---

## Phase 0 — Discovery & audit

**Complete.** Findings written back into this doc per
[`PROJECT/PDDA.md`](../PDDA.md) → *Discovery & spike phases*.

### Method

`rg` over `src/` for `writeFile|appendFile|fsync|fdatasync|rename`; then read the three store
implementations and their load paths end to end.

### Finding 1 — no `fsync` exists, and only one atomic rename does

Zero `fsync`/`fdatasync` **call sites** in `src/`. The one textual hit is a comment at
[`event-store.js:14`](../../src/event-store.js#L14) acknowledging their absence. Exactly one file
does temp-write + rename — [`lists-module.js:2022-2023`](../../src/lists-module.js#L2022-L2023) —
and it is a **cache**, not authoritative (and still unsynced, and leaks its `.tmp` on failure).

There is **no shared durable-write helper**; `src/utils/` does not exist. So there is nothing to
reuse and one small helper is both the DRY answer and the minimal one.

### Finding 2 — Tier 1: the reminder queue (highest blast radius)

[`reminders-module.js:2846-2864`](../../src/reminders-module.js#L2846-L2864) `#SaveRemindersAsync()`
writes the whole pending queue with a bare `fs.writeFile`. **10 call sites.**

The failure is a closed loop:

1. Hard kill mid-write → truncated JSON.
2. Next boot, [`#LoadReminders`](../../src/reminders-module.js#L2828-L2839) catches the parse throw,
   logs `failed to read reminders file`, sets `#PendingRemindersQueue = []`, `#DataLoaded = false`.
3. **`#DataLoaded` does not guard saves** — assigned at lines 334/2811/2822/2837, read only by the
   public getter at [line 626](../../src/reminders-module.js#L626). `#SaveRemindersAsync` never
   consults it. The first of the 10 save paths to fire writes `[]` over the file.

Every pending reminder in that workspace is gone; the only trace is one `warn` line.

### Finding 3 — Tier 2: the completion store (365-day retention)

[`completion-store.js:194-200`](../../src/completion-store.js#L194-L200) `#PersistAsync` — same
full-file-rewrite shape. [`LoadAsync:57-62`](../../src/completion-store.js#L57-L62) degrades a parse
failure to `#Records = []`; the next `Record()` persists that near-empty set.

`#WriteChain` ([line 35](../../src/completion-store.js#L35)) serializes concurrent writes correctly —
but that is a **concurrency** guarantee, not a **crash-atomicity** one. It does not help here.

### Finding 4 — Tier 3: the event ledger (lowest risk — ranked last deliberately)

[`event-store.js:114-123`](../../src/event-store.js#L114-L123) uses `fs.appendFile`, and
[`readAll:184-191`](../../src/event-store.js#L184-L191) **already tolerates a torn final line**. A
hard kill costs at most the last event, with no corruption cascade, and the store is explicitly
non-authoritative. `fsync` here buys *recency*, not *integrity*.

### Finding 5 — the backup is manual

`backup-sleuth-data.sh` zips workspace config + reminder JSON, but **no cron, systemd timer, or
scheduler in the tree invokes it**. It is an operator-run snapshot, not a safety net.

### Finding 6 — platform semantics

Production is Linux/systemd (`sleuth-app.service:73` → `/usr/bin/node /root/sleuth-app/src/app.js`),
so POSIX `fsync` semantics apply and directory `fsync` is meaningful. Node `>=18.20.4`
(`package.json:6-8`) has `FileHandle.sync()`. On macOS dev machines `fsync()` does not force a
platform flush (that needs `F_FULLFSYNC`, which Node does not expose) — a dev-only caveat worth a
code comment, not a blocker.

### QA gate — Phase 0
- [x] Every claim grounded in a real file:line, not inferred
- [x] The `#DataLoaded`-does-not-guard-saves cascade verified by reading all 5 assignment sites
- [x] Tiers ranked by actual blast radius, correcting `HONEST.md:128` rather than copying it
- [x] Checked for an existing helper to reuse before proposing a new one (`/ponytail`) — none exists

---

## Phase 1 — The shared durable-write helper + the crash-injection harness

**Pure addition. No existing caller changes. Zero blast radius.**

> **Revised after the agy plan review (relay round 1).** Three changes: unique temp filenames
> (Blocker), a sync variant (Should), and the crash-injection harness pulled forward from Phase 6
> (Should) so Phases 2-3 have a real gate instead of a manual one.

New `src/durable-write.js`:

- `WriteFileDurableAsync(ArgFilePath, ArgContents)` — write a temp file via `fs.open`/`write`/
  `sync`/`close`, then `fs.rename` onto the target, then `fsync` the **parent directory** so the
  rename itself is durable. Clean up the temp on any failure (the gap in `lists-module`'s version).
- **The temp filename MUST be unique per write** — `${path}.${process.pid}.${Counter}.${rand}.tmp`.
  A static `${path}.tmp` is actively dangerous here: `reminders-module.js` has **no** write
  serialization (verified — no `#WriteChain` equivalent, and
  [line 417](../../src/reminders-module.js#L417) fires `#SaveRemindersAsync()` **without awaiting**),
  so two concurrent saves would interleave into the same temp file and then rename the corrupted
  result over good data. That would make this change *worse than the bug it fixes*: a rare
  hard-kill loss becomes routine corruption under normal concurrency.
- `WriteFileDurableSync(ArgFilePath, ArgContents)` — same temp → `fsyncSync` → `renameSync` → dir
  `fsyncSync` sequence, for `client-mapping.js:362` in Phase 5, which is sync today. Providing the
  variant keeps Phase 5 mechanical instead of forcing an async refactor of that call path.
- **No append primitive ships in this phase.** *(Changed after the agy Phase 1 code review.)* An
  earlier draft included `AppendFileDurableAsync`. Nothing in Phases 2, 3, or 5 appends, and Phase 4
  must *measure* the fsync-per-append cost before choosing between sync-per-append, batched sync,
  and a handle-holding writer — so publishing the API here would fix its shape before the
  measurement that determines it. Phase 4 adds it.
- Directory `fsync` must tolerate `EPERM`/`EISDIR`/`ENOSYS` (non-POSIX filesystems) by degrading to
  a warning, never throwing — a durability *improvement* must never become a new crash source.

Tests in `tests/durable-write.test.js` (Jest — matches `tests/completion-store.test.js`; the
`node --test` style in `tests/event-store.test.js` is the exception, not the house default):
round-trip, overwrite-existing, temp cleaned up on write failure, target left **untouched** when the
temp write fails, **N concurrent writers to one path never corrupt it and never collide on a temp
name**, directory-fsync failure degrades rather than throws, sync variant matches async semantics.

### The crash-injection harness (pulled forward from Phase 6)

`tests/crash-injection/` — `SIGKILL`s a child mid-write in a loop, then asserts the target file is
always fully parseable and equals either the pre- or post-state.

**It must first be pointed at unmodified `main` and reproduce the corruption.** A harness that
cannot produce a red on the known-broken code proves nothing when it goes green on the fix. Record
the reproduction rate in this doc.

Building it here rather than in Phase 6 means Phases 2 and 3 get a real, repeatable gate at the
moment they land, instead of a manual spot-check deferred to the end.

### Phase 1 results

**Shipped:** `src/durable-write.js`, `tests/durable-write.test.js` (17 tests),
`tests/crash-injection/{run.js,crash-writer.js}`. No existing caller touched.

**The durability hole is now empirically proven, not merely argued.** The harness `SIGKILL`s a child
mid-write (untrappable, so no shutdown hook can mask it) and inspects the store:

| Mode | Result |
|---|---|
| `unsafe` — today's `fs.writeFile` path | **corrupt=6 / 40** (15% of hard kills left an unparseable store) |
| `durable` — `WriteFileDurableAsync` | **corrupt=0 / 40** (38 intact, 2 not-yet-written) |

That 6/40 is the number that makes the harness trustworthy: it goes red on the broken path, so its
green on the fixed path means something.

**Post-review revision (agy Phase 1 code QA, `relay-system/2026-08-04/gh12-p1-code-qa.md`).** Agy
passed 5 of 7 criteria with citations and returned two findings:

| Finding | Disposition |
|---|---|
| **[Should]** `SweepStaleTempsAsync` over-sweeps — a bare `startsWith(basename + '.')` also matches a store whose name *extends* ours, so sweeping `store.json` would eat `store.json.bak`'s temps | **Implemented.** Real bug, and my own sibling test could never have caught it (it used `theirs.json`, which shares no prefix). Now anchors the remainder against `TEMP_SUFFIX_PATTERN` (`<pid>.<counter>.<8 hex>.tmp`). Proven behavioural: old logic sweeps the neighbour temp, new logic does not. Three regression tests added, incl. "never deletes the store itself". |
| **[Blocker]** `AppendFileDurableAsync` opens/fsyncs/closes per call — "massive performance bottleneck… extreme I/O contention". Fix: drop it from Phase 1 | **Implemented, reason corrected.** Dropped. But the stated rationale does not hold at this system's real volume (a handful of lifecycle events/day on a deployment `HONEST.md` calls light-load); calling it a bottleneck is an unmeasured claim in the opposite direction, and Phase 4 exists precisely to measure it. The defensible reason is narrower: nothing in Phases 2/3/5 appends, so shipping the API now fixes its shape before the measurement that determines it. |

**Gap the harness found in this phase's own work:** the durable run reported `leftover-temps=14`.
`SIGKILL` cannot be trapped, so a crash always strands its temp. Harmless to readers — the store is
only ever replaced by an atomic rename — but unbounded over a deployment's life. Closed by adding
`SweepStaleTempsAsync`, age-gated at 1h rather than pid-gated: a temp younger than the cutoff may
belong to a live write in another process, and deleting that would reintroduce the exact corruption
this module exists to prevent. Stores call it on load (Phases 2-3).

### QA gate — Phase 1
- [x] Helper never leaves a temp file behind, on success or failure *(asserted on both paths)*
- [x] A failed write leaves the **previous** file contents fully intact (the core property)
- [x] **Concurrent writers to the same path never share a temp name** (the Blocker) — asserted
      directly by spying on `fs.open` across 50 concurrent writes, plus 1000-call uniqueness on
      `BuildTempPath`, rather than inferred from a clean run
- [x] Directory-fsync unsupported → warns, does not throw
- [x] Sync and async variants produce byte-identical results and the same durability sequence
- [x] **Harness reproduces corruption on unmodified `main`** — 6/40, red before trusted green
- [x] No existing caller touched in this phase
- [x] JSDoc + `Arg`-prefixed params match house style (`AGENTS.md`)
- [x] `npm test` + `npm run build` green — full suite exits 0 (Jest + `node --test` 30/30), `tsc`
      reports no type errors. *(Note: `node_modules` was absent in this clone — pre-existing and
      unrelated to this work; `npm install` added 603 packages before the gate could run.)*

---

## Phase 2 — Tier 1: the reminder queue

Highest value. **Three** changes, all in `src/reminders-module.js`:

1. **Adopt the helper** in `#SaveRemindersAsync` ([line 2857](../../src/reminders-module.js#L2857)).
2. **Serialize saves behind a write chain.** *(Added after the agy review — follows from its Blocker,
   but is not fixed by that Blocker's own remedy.)* Unique temp filenames stop two concurrent saves
   from **corrupting** each other, but they do **not** stop a **lost update**: writer A snapshots the
   queue, writer B snapshots it, B renames, then A renames its now-stale snapshot on top — and B's
   change is silently gone. Atomic rename makes each write all-or-nothing; it does not order them.

   `completion-store.js` already solves this with `#WriteChain`
   ([line 35](../../src/completion-store.js#L35)). `reminders-module.js` has **no equivalent** —
   verified — and [line 417](../../src/reminders-module.js#L417) fires `#SaveRemindersAsync()`
   **without `await`**, so overlap is reachable in normal operation, not just in theory. Port the
   same chain idiom here.

3. **Quarantine guard.** Distinguish *file absent* from *file present but unparseable*:
   - `ENOENT` (first run) → must still save normally, or a fresh install could never persist.
   - Parse failure → rename the corrupt file to `${path}.corrupt-<ISO timestamp>` **before** the
     first save is allowed, so the bytes survive for recovery and the operator gets a loud error.

   Blocking saves outright is the wrong fix — it would brick the product on a corrupt file.
   Quarantine keeps the system running *and* keeps the data.

### Phase 2 results

**Shipped:** `src/reminders-module.js` (durable write + `#SaveChain` serialization + quarantine
guard + load-time temp sweep + `FlushRemindersAsync`), `tests/reminders-durability.test.js` (6 tests).

**The lost-update race is real, and the test proves it.** Rather than trust a passing suite, the
concurrency gate was validated by temporarily bypassing `#SaveChain` and re-running: with the chain
removed, **3 of 8 concurrently-completed reminders survived on disk** (`rem-5`, `rem-6`, `rem-7`) —
a stale snapshot renamed on top of newer state, leaving a perfectly valid JSON file. With the chain
restored, 0 lost. That is the failure agy called "strictly necessary" to prevent, reproduced.

Both the snapshot and the write happen *inside* the chain. Snapshotting outside it would reintroduce
the same race, since a caller could serialize the queue, wait its turn, then persist a view another
save had already superseded.

**Regression found and fixed during this phase.** Two existing fake-timer tests in
`reminders-integration.test.js` began failing. Diagnosed by isolation rather than assumption:
chain + plain `fs.writeFile` → 63/63 pass; chain + `WriteFileDurableAsync` → 2 fail. So the chain was
not the cause — a durable write is ~8 syscalls where the old one was 1, and no longer completes
inside a single `advanceTimersByTimeAsync` flush. Those tests assert on *persisted* state, so they
were relying on an assumption that a save lands within a timer flush.

Fixed by adding `FlushRemindersAsync()` — mirroring `CompletionStore.FlushAsync`, which exists in
this codebase for exactly this reason — and awaiting it in the tests' `ReadPersistedAsync` helper.
`StopAsync` now drains it too, closing a real gap: a save queued during shutdown could previously be
dropped.

**Post-review revision (agy Phase 2 code QA).** Agy passed DoD 1-6 with citations, and specifically
resolved the open question above: production reads the reminders file **only on boot** and uses
in-memory state thereafter ([`reminders-module.js:2770`](../../src/reminders-module.js#L2770)), so
the durable write introduces **no window where production observes stale disk state** — awaiting the
flush is strictly a test requirement, not a papered-over regression.

Its one `[Should]` found two further truncatable writes in the same file, both already scheduled for
Phase 5: the reminder counter and the false-positive report cursor. Pulled forward into this phase
rather than deferred — a file that is hardened *except* for two writes is harder to reason about
than one that is finished, and each was a one-line change. Neither is cosmetic:

- **Reminder counter** — a truncated file fails to parse on boot and resets the daily-digest cursor,
  re-sending a digest that already went out.
- **False-positive cursor** — a truncated file resets `lineCount` to 0, re-reporting every
  historical example in the next weekly digest.

`reminders-module.js` now contains exactly one `fs.writeFile`: the disk **health probe** at
[line 973](../../src/reminders-module.js#L973), which writes a literal `'test'` and is correctly
not a state write.

### QA gate — Phase 2
- [x] Corrupt reminders file → quarantined to `.corrupt-<ts>`, original bytes recoverable
      *(asserted byte-for-byte against the pre-corruption content)*
- [x] Valid JSON of the wrong shape quarantined too; **an empty array is NOT** — a legitimately
      empty queue is a valid state, and quarantining it would churn a file on every idle boot
- [x] First-run (`ENOENT`) still saves normally — no regression for fresh installs
- [x] **Concurrent saves do not lose an update** — and the gate was proven capable of failing
      (3/8 lost with the chain bypassed)
- [x] Kill-mid-write leaves either the complete old queue or the complete new one — crash-injection
      harness against a reminder-shaped payload: **corrupt=0/30**
- [x] All `#SaveRemindersAsync` call sites still behave identically on the happy path, including the
      non-awaited `GitHubCommentRelay` callback
- [x] Stale temps stranded by an earlier hard kill are swept on load, store untouched
- [x] `npm run validate:fsm` clean (the FSM chokepoint is untouched)
- [x] `npm test` green — 1497 Jest + 30 `node --test`; `npm run build` clean
- [~] **Existing tests pass unchanged — QUALIFIED, not met.** `reminders-integration.test.js` was
      modified: `ReadPersistedAsync` now takes the module and awaits `FlushRemindersAsync()` first
      (3 call sites). This is a genuine contract change, not a workaround to make a red suite green —
      a durable write cannot be assumed to land within a timer flush — but the original gate said
      *unchanged*, and it is not. Flagged rather than quietly re-scoped.

---

## Phase 3 — Tier 2: the completion store

Same two changes in `src/completion-store.js`: adopt the helper in `#PersistAsync`
([line 196](../../src/completion-store.js#L196)), and quarantine a corrupt history file in
`LoadAsync` instead of silently starting empty.

`#WriteChain` stays exactly as is — it is correct for what it does, and the helper composes inside
it without touching the chaining logic.

### QA gate — Phase 3
- [ ] Corrupt history file quarantined, not silently zeroed
- [ ] `#WriteChain` serialization still holds — concurrent `Record()` calls cannot interleave
- [ ] The chain still cannot be poisoned by a failed write (`#PersistAsync` still never rejects)
- [ ] `FlushAsync()` still waits for the real disk write, now including the `fsync`
- [ ] `tests/completion-store.test.js` passes unchanged; `npm test` green

---

## Phase 4 — Tier 3: the event ledger

**Measure first, then choose the primitive's shape, then add it.** Phase 1 deliberately ships no
append helper (agy Phase 1 review): nothing before this phase appends, so publishing the API earlier
would have fixed its shape before this measurement.

1. Benchmark three candidates against the real ledger write path — sync-per-append, batched sync
   (sync every N appends or every N ms), and a handle-holding writer that keeps one open descriptor
   per workspace. Record the numbers in this doc, including the unflattering ones.
2. Weigh them against actual load, not an imagined one: `HONEST.md` describes a light-load, single
   deployment, and the ledger sees a handful of reminder-lifecycle events per day. A handle-holding
   writer trades fd exhaustion risk and reopen-on-rotation complexity for throughput this system may
   not need. Pick the simplest shape the measurement justifies (`/ponytail`).
3. Add the chosen primitive to `src/durable-write.js`, adopt it in
   [`event-store.js`](../../src/event-store.js#L114-L123) `AppendDurable`, and update the now-stale
   comment at [line 14](../../src/event-store.js#L14) documenting the absence of `fsync`.

**Explicit cost note:** an `fsync` per append is a real per-event latency cost. The ledger is
non-authoritative and best-effort by contract, so if the cost measures badly this phase may
legitimately land as "batched or deferred sync" rather than sync-per-append. Measure before
committing to sync-per-append; record the number in this doc either way.

The `append` contract must not change: still **never rejects**, still resolves `{ok:false,error}`,
so a caller's reminder transition is never blocked.

### QA gate — Phase 4
- [ ] Three candidate shapes benchmarked and the numbers recorded here before one is chosen
- [ ] Chosen shape is the simplest the measurement justifies, not the most sophisticated
- [ ] `append` still never rejects, under fsync failure too
- [ ] Torn-final-line tolerance in `readAll` still passes
- [ ] Per-workspace write-chain isolation preserved
- [ ] Append latency measured and recorded in this doc (honest number, even if unflattering)
- [ ] The `no fsync in this phase` comment at line 14 updated to match reality
- [ ] `tests/event-store.test.js` + `npm run test:node` green

---

## Phase 5 — Sweep the remaining authoritative writers

Adopt the helper across the rest of the mutable-JSON writers, and fold `lists-module`'s ad-hoc
temp+rename into it so there is exactly one durable-write path in the codebase:

| File | Line | Data |
|---|---|---|
| [`workspaces.js`](../../src/workspaces.js#L464) | 464 | workspace registry |
| [`settings-module.js`](../../src/settings-module.js#L88) | 88 | per-workspace settings |
| ~~`reminders-module.js`~~ | ~~3348~~ | ~~reminder counter~~ — **done in Phase 2** (agy review: leaving truncatable writes in a file otherwise hardened is incoherent) |
| ~~`reminders-module.js`~~ | ~~2155~~ | ~~false-positive report cursor~~ — **done in Phase 2**, same reason |
| [`reminders-channel-settings.js`](../../src/reminders-channel-settings.js#L81) | 81 | enabled channels |
| [`channel-model-settings.js`](../../src/channel-model-settings.js#L115) | 115 | per-channel model |
| [`admin-auth.js`](../../src/admin-auth.js#L388) | 388 | admin config |
| [`learned-convention-suppression-store.js`](../../src/learned-convention-suppression-store.js#L188) | 188 | suppression state |
| [`stats-module.js`](../../src/stats-module.js#L203) | 203 | stats |
| [`chat-module.js`](../../src/chat-module.js#L2332) | 2332, 2538 | chat history / thread context |
| [`lists-module.js`](../../src/lists-module.js#L2022) | 2022-2023 | cache — replace ad-hoc temp+rename |
| [`client-mapping.js`](../../src/client-mapping.js#L362) | 362 | **sync** `writeFileSync` — needs a sync variant or an async conversion |

`client-mapping.js` is the one that needs a decision rather than a mechanical swap; handle it last
and note the choice here.

### QA gate — Phase 5
- [ ] Exactly one durable-write path remains in `src/` — no ad-hoc temp+rename survives
- [ ] `rg 'fs\.writeFile\(' src/` returns only diagnostics/health-probe writes, not state writes
- [ ] `client-mapping.js`'s sync-vs-async decision recorded in this doc with its reasoning
- [ ] Full `npm test` + `npm run build` green
- [ ] No behavior change on any happy path — this phase is mechanical by design

---

## Phase 6 — Full-system verification & honest doc update

**The phase that earns the claim.** Everything before this is per-phase evidence; this is the
whole-system run.

> The harness itself moved to **Phase 1** on the agy review's [Should] finding, so Phases 2-3 could
> gate on it as they landed rather than deferring verification to the end. What remains here is the
> full-scale run and the doc truthing that depends on it.

1. Run the Phase 1 crash-injection harness at full scale (N≥100 iterations) against **every** store
   hardened in Phases 2-5, not just the two it gated during development. Record the numbers here.
2. **Only after that passes**, update the honest-positioning docs:
   - [`HONEST.md:77`](../../HONEST.md#L77) — the "No fsync anywhere" caveat
   - [`HONEST.md:115`](../../HONEST.md#L115) — move "Crash-proof / zero-data-loss durability" out of
     **Don't say yet** *only as far as the evidence supports* — likely to **Say with care**, scoped
     to "survives hard kill without corrupting the authoritative stores", **not** an unqualified
     zero-data-loss claim (an unsynced-window event can still be lost; atomicity ≠ zero loss)
   - [`HONEST.md:128`](../../HONEST.md#L128) — durability-hardening roadmap line → shipped
   - [`README.md:135-141`](../../README.md#L135-L141) — the public structural caveat
   - `CHANGELOG.md` entry
3. Leave the "not load-tested" claim **untouched** — this work does nothing for it.

### QA gate — Phase 6
- [ ] Harness's `main`-reproduces-corruption baseline (established in Phase 1) re-confirmed still red
      on unmodified `main` — a harness that silently stopped triggering the bug proves nothing
- [ ] N≥100 kill iterations per hardened store, zero unparseable files
- [ ] Doc claims match exactly what was tested — no claim upgraded beyond its evidence
- [ ] "Not load-tested" claim left intact
- [ ] `## Lessons Learned (For Future Agents)` appended before this doc moves to `3-COMPLETED`

---

## Risks

| Risk | Mitigation |
|---|---|
| `fsync` latency on the hot reminder-save path | Measure in Phase 2; the queue saves are not in a tight loop, but record the number |
| Directory `fsync` unsupported on some FS | Degrade to warning, never throw (Phase 1 gate) |
| Quarantine logic misfires and hides a live file | `ENOENT` explicitly excluded; quarantine renames, never deletes |
| A durability change becomes a new crash source | Every adopter keeps its existing never-throw/never-reject contract |
| **The fix is worse than the bug** — a shared temp path turns a rare hard-kill loss into routine corruption under concurrency (agy Blocker) | Unique per-write temp names (Phase 1) **plus** save serialization in `reminders-module` (Phase 2); both have explicit QA gates |
| Lost update: two concurrent full-file writers rename out of order, stale snapshot wins | Write chain in Phase 2 — atomic rename orders nothing by itself |
| Harness gives false confidence by never triggering the bug | Must go **red on unmodified `main`** before it is trusted (Phase 1 gate), re-confirmed in Phase 6 |
| Scope creep into P3 event-sourcing | Explicit non-goal; this hardens the path P3 will eventually replace |
