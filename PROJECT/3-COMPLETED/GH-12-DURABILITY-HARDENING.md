---
title: "Durability hardening — atomic + fsync'd writes for the authoritative JSON stores"
status: Complete (3-COMPLETED) — all 6 phases shipped and agy-QA'd
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
| **All 6 phases complete and agy-QA'd.** One shared helper (`src/durable-write.js`); every authoritative write in `src/` adopted it; save serialization in `reminders-module`; quarantine guards on the reminder queue and completion store. Final crash-injection matrix at **N=100 per write shape** — whole-file async, whole-file sync, and JSONL append — each with a matched `unsafe` control that must reproduce damage before its `durable` pair is trusted. Docs re-truthed to exactly what was measured; the "not load-tested" claim left untouched. | **Nothing in this doc.** Follow-ups are tracked separately: P3 event-sourced cutover, load testing, and the deferred-triage bucket. |
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

### Phase 3 results

**Shipped:** `src/completion-store.js` (durable write, quarantine guard, load-time sweep),
`tests/completion-store-durability.test.js` (10 tests).

`LoadAsync` was restructured to separate two failures the original conflated:

- **Read failure** (`ENOENT`, `EACCES`, …) → degrade to empty, **do not quarantine**. Bytes we could
  not read are not bytes we know to be bad, and renaming a file we merely failed to open would
  destroy a recoverable store.
- **Parse/shape failure** → bytes exist and cannot be trusted → quarantine.

The `#PruneExpired` → persist step still runs on the success path. On the quarantine path
`#Records` is empty, so the prune is a no-op and no empty file is written back over the freed path;
the next real `Record()` creates a fresh one.

`#WriteChain` is untouched — it was already correct for ordering. The durable write adds the
atomicity that serialization alone never provided.

**Post-review revision (agy Phase 3 code QA).** Agy passed criteria 1-5 with citations and raised
one **[Blocker]**: `SweepStaleTempsAsync` is called in `LoadAsync` *before* the store's own error
handling, so if it threw it would stop the store loading entirely rather than degrading to empty.

Verified before fixing — and it was worse than reported. The helper's own docstring claims "Never
throws", and **two** paths escaped it:

| Escape | Cause |
|---|---|
| `path.dirname(undefined)` → `TypeError` | `path.dirname`/`path.basename` ran **outside** the try block |
| A logger whose `warn` throws | `WarnDegraded` is invoked **from inside** catch blocks, so its own throw escaped them |

Fixed in the **helper**, not at the call site as suggested: `reminders-module.js` calls it too, and
a function documented as never-throwing should honour that for every caller rather than making each
one defend itself. Path resolution moved inside the try; `WarnDegraded` now swallows a hostile
logger. A defensive `try/catch` was *also* added at the `completion-store.js` call site, since
housekeeping must never be why a store fails to start.

This is the second time a documented contract in `durable-write.js` turned out to be aspirational
(the first was the over-sweep in Phase 1). Both were found by review, not by the test suite.

### QA gate — Phase 3
- [x] `SweepStaleTempsAsync` genuinely never throws — asserted for `undefined`/`null`/numeric paths
      and for a logger that throws, on both the sweep and write paths
- [x] Corrupt history file quarantined, not silently zeroed — bytes asserted byte-for-byte
- [x] **A later write cannot destroy the quarantined bytes** — the exact GH-12 cascade, asserted
      end to end: corrupt load → `Record()` → the new file has 1 record *and* the original bytes are
      still on disk
- [x] Valid JSON of the wrong shape quarantined; an empty array is **not** (valid state)
- [x] `ENOENT` first run: no quarantine, no error log, saving still works
- [x] An unreadable (`EACCES`) file is **not** quarantined
- [x] `#WriteChain` serialization still holds — 20 concurrent `Record()` calls, all 20 persisted
- [x] The chain still cannot be poisoned by a failed write, and `#PersistAsync` still never rejects
      (asserted with `rename` forced to fail, then a subsequent write succeeding)
- [x] `FlushAsync()` still waits for the real disk write including the `fsync` (fire-and-forget
      `Record()` then flush, as the FSM hook does)
- [x] Stale temps swept on load, store untouched
- [x] `tests/completion-store.test.js` passes **unchanged**; `npm test` green (1507 Jest + 30
      `node --test`); `npm run build` clean
- [x] Zero plain `fs.writeFile` calls remain in `completion-store.js`

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

### Phase 4 results — the measurement

`tests/crash-injection/bench-append.js`, 500 appends per candidate, realistic
`ReminderCompleted` event lines. macOS dev box, so absolute numbers will differ on the Linux
production host — but `fsync` dominates on both, so the *ordering* holds.

| Shape | ms/append | vs baseline |
|---|---|---|
| baseline — `fs.appendFile`, no fsync (the old behaviour) | 0.100 | 1.0x |
| **sync-per-append — open/fsync/close — CHOSEN** | **5.710** | **56.9x** |
| batched — hold a handle, fsync every 20 | 0.300 | 3.0x |
| handle-holding — hold a handle, fsync every append | 5.128 | 51.1x |

**The measurement cut against both positions in the Phase 1 argument.**

Agy was directionally right that fsync-per-append is expensive — **57x** is a large multiplier, and
the earlier "very unlikely to be a bottleneck" framing understated it. But its proposed remedy is
refuted by the fourth row: **holding a handle open is only ~10% faster** (5.128 vs 5.710), because
the cost is `fsync` itself, not `open`/`close`. A stateful per-workspace handle manager would have
bought 10% in exchange for fd-exhaustion risk, reopen-on-rotation handling, and lifecycle state.
Only measuring showed that; either of us could have argued it indefinitely.

And the multiplier multiplies a negligible number. At this ledger's real rate — roughly 100
reminder-lifecycle events/day — sync-per-append adds **~571 ms per day, in total**.

Batched sync is the only shape that genuinely moves the needle (3x vs 57x), but it trades away up
to N events on a crash and adds flush-timing state. Not taken while the simple shape's cost is this
far below the noise floor (`/ponytail`).

**Recorded limit:** 5.7 ms/append caps throughput at roughly 175 events/sec. If the P3 event-sourced
cutover ever makes this ledger authoritative and high-volume, revisit — the decision is correct for
today's load, not for all loads.

**Post-review revision (agy Phase 4 code QA).** All six DoD criteria passed with citations. Agy
endorsed choosing the *slowest* non-baseline shape, and added a useful point on the macOS caveat:
the relative penalty of `open`/`close` versus `fsync` **shrinks further on Linux**, because `fsync`
dominates more there — so the ordering is safe, not merely assumed.

Its sweep of `event-store.js` found three pre-existing issues:

| Finding | Disposition |
|---|---|
| **[Should]** `NormalizeEvent` keeps a shallow reference to the caller's `payload`, and `JSON.stringify` ran *inside* the write chain — so a caller mutating `event.payload` after `append()` writes the mutated value | **Implemented.** Reproduced first: a post-`append()` mutation really did reach disk. **And this phase made it worse** — the chain link went from an unsynced `fs.appendFile` (~0.1 ms) to an fsync'd append (~5.7 ms), widening the window ~57x. That makes it in-scope, not merely nearby. Now serialized synchronously at call time, which is the semantics callers expect and cheaper than deep-cloning. A circular payload resolves `{ok:false}` rather than throwing, preserving the never-reject contract. |
| **[Nit]** `fs.mkdir(RootDir, {recursive:true})` ran on every append | **Implemented.** Memoized per store, resetting on failure so a later append retries instead of caching a rejection. Merely wasteful when an append was one unsynced syscall; not free now that the path is deliberately slower. |
| **[Nit]** `Raw.split('\n')` loads the whole ledger into memory on read | **Declined for this phase.** Agy itself marked it "no action strictly required". It is a read-path scaling concern, not a durability defect, and this issue's scope is durability. Parked for triage rather than folded in silently. |

### QA gate — Phase 4
- [x] Payload is snapshotted at call time, not write time — regression test asserts a post-`append`
      mutation does **not** reach disk
- [x] An unserializable (circular) payload resolves `{ok:false}` instead of throwing
- [x] Candidate shapes benchmarked and the numbers recorded here **before** one was chosen — four
      candidates, not three (a no-fsync baseline was added so the others have a reference)
- [x] Chosen shape is the simplest the measurement justifies, not the most sophisticated
- [x] Append latency recorded honestly, including the unflattering 57x multiplier
- [x] `append` still never rejects — the durable append is wrapped by the same `try/catch` that
      resolves `{ ok:false, error }`
- [x] Torn-final-line tolerance in `readAll` still passes (unchanged; `tests/event-store.test.js` green)
- [x] Per-workspace write-chain isolation preserved (unchanged)
- [x] The stale "No `fsync` in this phase" comment corrected, and it now states what the fsync
      actually buys: **recency, not integrity** — append-only writes were already torn-tail-tolerant
- [x] `npm test` green (1513 Jest + 30 `node --test`); `npm run build` clean

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

### Phase 5 results

**13 state writes hardened** across 12 files. The list was re-derived by scanning `src/` rather than
trusting this doc's original table, which had drifted (it missed `code-task-relay-module.js`,
`snapshot-relay-module.js`, and `show-me-projects-command.js`).

| File | What a truncated file would cost |
|---|---|
| `workspaces.js:464` | workspace registry |
| `settings-module.js:88` | per-workspace settings |
| `reminders-channel-settings.js:81` | enabled channels |
| `channel-model-settings.js:115` | per-channel model choice |
| `learned-convention-suppression-store.js:188` | suppression state |
| `stats-module.js:203` | usage stats |
| `chat-module.js:2332` | bug-report entries |
| `chat-module.js:2538` | thread context memory |
| `code-task-relay-module.js:372` | seen-set → **re-processes every previously handled file** |
| `snapshot-relay-module.js:363` | seen-set → **re-relays every previously handled snapshot** |
| `lists-module.js:2022` | lists cache (also folded the ad-hoc temp+rename, below) |
| `client-mapping.js:362` | client overlay — **sync** |
| `show-me-projects-command.js:60` | project map — **sync** |

**`client-mapping.js` decision (deferred here since Phase 1):** kept **synchronous**, using
`WriteFileDurableSync`. `WriteClientOverlaySync` is `...Sync` by name and contract and its callers
are synchronous; converting it would ripple an async refactor through them for no durability gain.
This is exactly the call site the agy Phase 1 `[Should]` predicted would need the sync variant.
`show-me-projects-command.js` got the same treatment for the same reason.

**The ad-hoc temp+rename is gone.** `lists-module.js` held the codebase's only one, and it had three
defects the shared helper fixes: no `fsync`, a fixed `.tmp` name that two concurrent saves would
collide on, and a leaked temp on failure.

**Left alone deliberately** — 8 remaining `writeFile`/`writeFileSync` calls, none of them state:
4 disk **health probes** (`writeFile(TestPath, 'test')` in `app.js`, `diagnostics.js`,
`reminders-module.js`, `stats-module.js`), 2 `os.tmpdir()` **upload temps** unlinked after use
(`snapshot-relay-module.js`, `show-rebalance-reminders-command.js`), the helper's own fd write, and
`app.js:489`'s nodemon restart trigger (a dev-only signal file whose mtime is the payload).

### QA gate — Phase 5
- [x] Exactly one durable-write path remains in `src/` — **no ad-hoc temp+rename survives**
      (`rg 'fs\.rename\('` returns only the helper itself and the two quarantine renames)
- [x] `rg 'fs\.writeFile\('` returns only health probes, upload temps, and the helper — no state
- [x] `client-mapping.js`'s sync-vs-async decision recorded above with its reasoning
- [x] Full `npm test` green (1513 Jest + 33 `node --test`), `npm run build` clean,
      `npm run validate:fsm` clean
- [x] Crash-injection re-run after the sweep: **corrupt=0/30**
- [~] **No behaviour change on any happy path — QUALIFIED.** One existing test needed updating:
      `client-mapping.test.js` mocks `fs` with only `readFileSync`/`mkdirSync`/`writeFileSync`, so
      the durable sync sequence could not run against it. The mock was completed and the assertion
      **strengthened** — it now proves the atomic rename lands on the real overlay path, which is a
      better test than the original write-path check. Flagged rather than counted as unchanged.

### Phase 5 code-review dispositions (agy, `relay-system/2026-08-04/gh12-p5-code-qa.md`)

Verdict **FAIL**, 2 Blockers. Agy passed DoD 1, 3, 4, 5 and 7 with citations, including an explicit
confirmation that `app.js:489` — the classification I flagged as least certain — is correctly left
alone.

| Finding | Disposition |
|---|---|
| **[Blocker]** DoD 6 — two `fs.appendFile` state writes missed: `reminders-module.js:3002` (trashed examples) and `router-shadow-store.js:53`, whose method is *named* `AppendDurable` while using a bare append | **Implemented, and split — it was worse than reported.** The trashed-examples miss is real and now uses `AppendFileDurableAsync`: an example is unreconstructable user feedback, and `#RunWeeklyTrashedExamplesReportAsync` advances a **durable cursor past it**, so a lost line is skipped forever rather than retried. Its docstring also claimed "append… is atomic and a partial write cannot corrupt earlier entries" — half true, and the confident half was wrong. `router-shadow-store.js` is the opposite call: its module contract declares the corpus disposable telemetry written on the routing hot path, where `fsync` would cap it at ~175 records/sec to buy recency for data that is explicitly replayable-or-droppable. Adding `fsync` there would be a real regression. The **defect agy correctly identified is the false promise in the name**, so the function was renamed `AppendBestEffort` and documented with why it is deliberately unsynced. Fixing a misleading contract by making the code slower to match the name is the wrong direction. |
| **[Blocker]** DoD 2 — "its callers are synchronous" is factually incorrect; `WriteClientOverlaySync` and `SaveProjectMap` are both called from `async` functions, so both should be converted to `WriteFileDurableAsync` | **Declined, with the factual correction conceded.** Agy is right that my stated reason was wrong: the *enclosing* functions are `async`. But the conclusion does not follow. These are exported functions whose contract is synchronous, and **8 call sites depend on that** — `client-mapping.test.js:461` asserts a synchronous `.toThrow()`, which a converted function would turn into an unhandled rejection that never fails the test; six `SaveProjectMap(...)` calls across two test files are unawaited and would silently race; and `show-me-projects-command.js:448` sits inside a `try/catch` that would **stop catching write failures** the moment the call became a floating promise. That last one is precisely the caller-contract break DoD 4 asks about — converting would introduce the bug agy was checking for. The benefit is ~5.7 ms of event loop on two rare admin commands (`/refresh-clients`, `/show-me-projects`). Renaming two exported functions and touching five files for that is an API change outside a mechanical sweep. `WriteFileDurableSync` exists for exactly this case — it was added in Phase 1 on agy's own earlier `[Should]`. |

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

### Phase 6 results

**Scope correction.** The plan said "every store hardened in Phases 2-5." Running one synthetic
writer six times under six filenames would have been theater — every store funnels through the same
helper, so store *identity* is not the variable. What actually differs is **write shape**, and the
three shapes fail differently. The harness was extended to cover all three, each with its own
matched `unsafe` control:

| Shape | Covers | Control | Hardened |
|---|---|---|---|
| whole-file async | most stores | `unsafe` | `durable` |
| whole-file **sync** | `client-mapping.js`, `show-me-projects-command.js` | `unsafe-sync` | `durable-sync` |
| **JSONL append** | `event-store.js`, trashed-examples corpus | `unsafe-append` | `durable-append` |

The sync shape had **never been crash-tested** before this phase.

**Final matrix — `--matrix --iterations 100`, OVERALL PASS:**

| Mode | corrupt | intact | torn-tail | leftover temps |
|---|---|---|---|---|
| `unsafe` | **23** | 77 | 0 | 0 |
| `durable` | **0** | 100 | 0 | 40 |
| `unsafe-sync` | **3** | 97 | 0 | 0 |
| `durable-sync` | **0** | 100 | 0 | 27 |
| `unsafe-append` | 0 | 89 | 11 | 0 |
| `durable-append` | 0 | 93 | 7 | 0 |

Three things in that table are worth reading carefully rather than skimming as a win:

- **`unsafe-sync` corrupts only 3/100**, an order of magnitude below the async path, because
  `writeFileSync` issues far fewer interruptible syscalls. The sync stores were genuinely
  lower-risk — but not zero-risk, which is why they were hardened rather than waived.
- **The append rows show no improvement, and that is the honest result.** Both paths score
  `corrupt=0` and both leave torn tails (11 vs 7 — noise, not a delta). Append-only confines damage
  to the record being written *by construction*, with or without `fsync`; there is no truncate
  window to close. What `fsync` buys an append is recency, and process-kill testing cannot see it.
  The append pair therefore asserts only that the durable path does not *regress* tail-confinement.
- **40 and 27 leftover temp files.** A kill during a durable write strands its temp. Harmless to
  readers — the store is only ever replaced by `rename` — but this is the empirical justification
  for `SweepStaleTempsAsync` existing at all, which until now was a precaution rather than a
  measured need.

**Two harness faults were caught during this phase, in opposite directions.** The append control
first came back clean 100/100 and the harness correctly refused to certify its own clean durable
run; the fix was a 25× larger batch (an append needs a *bigger* payload than a whole-file write to
tear — see Lesson 6). Then `durable-append` reported **35/100 corrupt**, which would have implicated
the shipped helper — and was an artifact of letting the log accumulate across iterations, so a torn
tail became an interior line. Both are written up in Lessons 1 and 7. Neither resulted in a source
change, because in both cases the instrument was at fault.

### QA gate — Phase 6
- [x] Harness's corruption baseline re-confirmed still red — **23/100** (whole-file async),
      **3/100** (whole-file sync), **11/100** (append) on the unmodified paths. A harness that
      silently stopped triggering the bug proves nothing, and this one is wired to fail the run
      rather than report a clean pass when its control goes quiet — which it did, and caught
- [x] N≥100 kill iterations per **write shape** (6 modes × 100 = 600 kills), zero unparseable
      authoritative files on every hardened path
- [x] Doc claims match exactly what was tested — the claim landed in **Say with care** as "survives
      a hard kill without corrupting its stores", explicitly **not** "crash-proof"/"zero data loss",
      and `HONEST.md` now records that `SIGKILL` cannot demonstrate power-loss durability at all
- [x] "Not load-tested" claim left intact — verbatim in `README.md`, and named in `HONEST.md` as
      part of what remains on the roadmap
- [x] `## Lessons Learned (For Future Agents)` appended (10 sections) before this doc moves to
      `3-COMPLETED`

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

---

## Lessons Learned (For Future Agents)

### 1. A gate that cannot fail proves nothing — build the negative control first

The single highest-value decision in this project was writing the crash harness with an `unsafe`
mode *before* trusting its `durable` mode. Every "0 corrupt" result is meaningless unless the same
harness produces a non-zero result against the code you claim to have fixed.

This paid off twice, and the second time is the instructive one. In Phase 6 the `unsafe-append`
control came back **clean 100/100** — and the harness refused to certify the (also clean) durable
append run, reporting `OVERALL FAIL`. Had the append pair been written without its control, the run
would have printed a satisfying `0 corrupt` and I would have shipped a claim backed by nothing.

**Do this:** for any safety property, write the test that must go red first, watch it go red, and
only then implement. If your negative control ever goes green, that is a harness failure, not a
success — treat it as such loudly.

### 2. Atomicity, ordering, and durability are three different properties

They are routinely collapsed into "crash-safe," and each needs its own mechanism and its own
evidence:

| Property | Mechanism | What breaks without it |
|---|---|---|
| Atomicity | temp → `rename` | A reader sees a truncated/torn file |
| Ordering | a per-store write chain | **Lost update** — a stale snapshot renames on top of a newer one |
| Durability | `fsync` (file + parent dir) | An acknowledged write is not on the platter after power loss |

The ordering one nearly escaped. `rename(2)` is atomic but orders nothing: A snapshots, B snapshots,
B renames, A renames its *stale* snapshot on top — B's change is gone, sitting behind perfectly
valid JSON. Proven by bypassing the write chain: **3 of 8** completed reminders vanished from disk.
Note that the corruption harness cannot see this failure at all; it needs its own experiment.

**The fix can be worse than the bug.** A shared temp filename would have converted a rare hard-kill
loss into *routine* corruption under ordinary concurrency. Unique per-write temp names, always.

### 3. Names and docstrings drift into promises the code does not keep

Four instances, all caught by review or by writing a test that tried to falsify the claim — **none**
caught by the pre-existing suite:

- `SweepStaleTempsAsync` documented "Never throws" and had **two** live throw paths.
- `router-shadow-store.js` named its function `AppendDurable`; it never called `fsync`.
- The trashed-examples docstring claimed "append… is atomic and a partial write cannot corrupt
  earlier entries" — half right, and the confident half was the wrong half.
- `durable-write.js` shipped two aspirational contracts of its own.

**Do this:** when a comment states a guarantee ("never throws", "atomic", "durable"), treat it as an
unproven assertion and write the test that tries to break it. A guarantee nobody has tried to
falsify is a wish.

### 4. Measure the remedy; do not accept the plausible one

Reviewers proposed holding a file handle open to avoid per-append `open`/`close` overhead. It sounds
obviously right. Benchmarked across four shapes, it was **~10% faster** than the simple version —
nowhere near enough to justify fd-exhaustion risk, rotation handling, and lifecycle state. Rejected
on the number, not the intuition.

The same measurement made the *accepted* cost legible: `fsync`-per-append is **57× slower** in
relative terms and **571 ms/day** in absolute terms at this call rate. A ratio alone would have
argued for a complex batching scheme; the absolute figure showed there was nothing to optimize.

**Do this:** report both the ratio and the absolute. One of them is almost always doing the
misleading.

### 5. Re-derive the work list from the code, never from your own plan

Phase 5's target list came from a table written during Phase 0 discovery. Re-scanning `src/` before
starting found it had drifted and was **missing three files** — two of which had user-visible
truncation costs (re-processing every previously handled file, re-relaying every prior snapshot).
The reviewer then found two more that the *scan* missed, because the scan looked for `writeFile` and
these were `appendFile`.

**Do this:** re-derive before executing, and make the search term a superset of what you expect
(`writeFile|appendFile|writeFileSync|createWriteStream`), because you will search for the shape of
the bug you already know about.

### 6. Empirical results are often counter-intuitive — let them retune the experiment

Reproducing damage on the **append** path required a payload **25× larger** than the whole-file path
(50k records vs 2k), which is backwards from the obvious expectation. The reason is mechanical: a
whole-file `fs.writeFile` truncates first, so a kill anywhere in the rewrite window leaves a short
file, while an append has no truncate window and `SIGKILL` cannot split a single `write(2)` — the
kernel completes it. Damage needs a payload large enough that Node's write loop issues several
syscalls. Push further (200k records) and damage vanishes again, because kills start landing in
`JSON.stringify` before any write begins.

**Do this:** when a control comes back clean, the interesting question is *why*, and the answer is
often a property of the system worth documenting. Do not just crank the knob until it goes red.

### 7. A failing gate is a hypothesis, not a verdict — suspect the instrument too

Minutes after the clean-control failure in lesson 1, the same append pair swung the other way:
`durable-append` reported **35/100 corrupt**, i.e. damage to already-written records — which would
have been a serious regression in the shipped helper.

It was the harness. The append modes let the log accumulate across iterations, so a torn *tail* left
by iteration N became an *interior* line once iteration N+1 appended past it, and the inspector
scored it as damage to history. The tell was that the supposedly-broken path (22/100) and the
supposedly-fixed path (35/100) were failing at the *same kind of rate* — a real fix-versus-bug
comparison does not look like that. Resetting the log per iteration and widening the kill window so
whole batches complete gave the true answer: **corrupt=0 on both paths**, with the control still
landing kills (torn-tail 3/40 unsafe, 2/40 durable).

Had I trusted the red result, I would have "fixed" a helper that was already correct. Had I trusted
the *first* clean result, I would have certified a claim on no evidence. Both directions were wrong,
and in both cases the instrument was the thing at fault.

**Do this:** when a result would change your conclusion, reproduce it against a control you already
understand before acting on it. If the broken and fixed paths fail similarly, you are measuring your
harness.

### 8. Scope claims to the experiment that was actually run

`SIGKILL` does not discard the OS page cache — the kernel still owns the dirty pages. So this work
proves **crash atomicity** (a reader never observes a torn store) and does **not** prove survival of
power loss, which is the other half of what `fsync` buys. The public claim was written to that
boundary: *"survives a hard kill without corrupting its stores"*, filed under **Say with care**, and
explicitly **not** upgraded to "crash-proof" or "zero data loss." The "not load-tested" caveat was
left exactly as it was, because nothing here touched it.

**Do this:** write down what your test *cannot* see, in the same place you record what it proved.

### 9. Flag modified tests; never let a green suite hide one

Two existing tests were changed. Both are called out explicitly rather than folded into a "suite
still passes" line — `client-mapping.test.js` had an incomplete `fs` mock that made the durable sync
path unrunnable, and the fix was paired with a *strengthened* assertion (it now proves the atomic
rename lands on the real overlay path). The Phase 5 gate is recorded as `[~] QUALIFIED`, not `[x]`.

**Do this:** "I changed a test to make it pass" is a sentence that must appear in your own report
before a reviewer has to find it. If the change weakened the test, that is a finding against you; if
it strengthened it, say why.

### 10. Process notes that cost real time

- **Do not edit files while a relay/review turn is in flight.** A containment sweep reverted
  `src/durable-write.js` as an off-allowlist edit and it had to be rewritten from context.
- **Distrust a wrapper's exit code you did not read yourself.** A trailing `echo` overwrote `$?` and
  masked a failing relay as success for a full round.
- **A reviewer can be right about the defect and wrong about the fix.** Phase 3's blocker was real
  but the suggested fix was at the call site; the correct fix was in the shared helper, because a
  second caller had the same bug. Phase 5's `[Blocker]` on sync-vs-async was factually right that my
  stated reason was wrong, and still wrong in its conclusion. Verify the finding, then decide the
  remedy yourself.
