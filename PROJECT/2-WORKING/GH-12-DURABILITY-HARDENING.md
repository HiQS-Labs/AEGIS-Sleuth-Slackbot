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
| **Phase 0 (discovery) complete** — audited every write call site in `src/`. Confirmed zero `fsync`/`fdatasync` in the tree, confirmed `#DataLoaded` does not guard saves, and re-ranked the three tiers against `HONEST.md:128` (which under-scopes Tier 1 and over-scopes Tier 3). Findings recorded below. Issue [#12](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/12) filed; branch `claude/GH-12-durability-hardening` cut. | **Phase 1** — add `src/durable-write.js` + unit tests. Pure addition, no callers changed, zero blast radius. |

## Table of contents

- [Phase 0 — Discovery & audit](#phase-0--discovery--audit) *(complete — findings inline)*
- [Phase 1 — The shared durable-write helper](#phase-1--the-shared-durable-write-helper)
- [Phase 2 — Tier 1: the reminder queue](#phase-2--tier-1-the-reminder-queue)
- [Phase 3 — Tier 2: the completion store](#phase-3--tier-2-the-completion-store)
- [Phase 4 — Tier 3: the event ledger](#phase-4--tier-3-the-event-ledger)
- [Phase 5 — Sweep the remaining authoritative writers](#phase-5--sweep-the-remaining-authoritative-writers)
- [Phase 6 — Crash-injection verification & honest doc update](#phase-6--crash-injection-verification--honest-doc-update)

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

## Phase 1 — The shared durable-write helper

**Pure addition. No existing caller changes. Zero blast radius.**

New `src/durable-write.js`:

- `WriteFileDurableAsync(ArgFilePath, ArgContents)` — write `${path}.tmp` via `fs.open`/`write`/
  `sync`/`close`, then `fs.rename` onto the target, then `fsync` the **parent directory** so the
  rename itself is durable. Clean up the `.tmp` on any failure (the gap in `lists-module`'s version).
- `AppendFileDurableAsync(ArgFilePath, ArgLine)` — `fs.open(path,'a')` → `write` → `sync` → `close`,
  for the ledger in Phase 4.
- Directory `fsync` must tolerate `EPERM`/`EISDIR`/`ENOSYS` (non-POSIX filesystems) by degrading to
  a warning, never throwing — a durability *improvement* must never become a new crash source.

Tests in `tests/durable-write.test.js`: round-trip, overwrite-existing, `.tmp` cleaned up on write
failure, target left **untouched** when the temp write fails, concurrent writers don't interleave,
directory-fsync failure degrades rather than throws.

### QA gate — Phase 1
- [ ] Helper never leaves a `.tmp` behind, on success or failure
- [ ] A failed write leaves the **previous** file contents fully intact (the core property)
- [ ] Directory-fsync unsupported → warns, does not throw
- [ ] No existing caller touched in this phase; `npm test` green
- [ ] JSDoc + `Arg`-prefixed params match house style (`AGENTS.md`)

---

## Phase 2 — Tier 1: the reminder queue

Highest value. Two changes, both in `src/reminders-module.js`:

1. **Adopt the helper** in `#SaveRemindersAsync` ([line 2857](../../src/reminders-module.js#L2857)).
2. **Quarantine guard.** Distinguish *file absent* from *file present but unparseable*:
   - `ENOENT` (first run) → must still save normally, or a fresh install could never persist.
   - Parse failure → rename the corrupt file to `${path}.corrupt-<ISO timestamp>` **before** the
     first save is allowed, so the bytes survive for recovery and the operator gets a loud error.

   Blocking saves outright is the wrong fix — it would brick the product on a corrupt file.
   Quarantine keeps the system running *and* keeps the data.

### QA gate — Phase 2
- [ ] Corrupt reminders file → quarantined to `.corrupt-<ts>`, original bytes recoverable
- [ ] First-run (`ENOENT`) still saves normally — no regression for fresh installs
- [ ] Kill-mid-write leaves either the complete old queue or the complete new one, never a truncation
- [ ] All 10 `#SaveRemindersAsync` call sites still behave identically on the happy path
- [ ] Existing `tests/reminders-*.test.js` pass unchanged; `npm test` green
- [ ] `npm run validate:fsm` still clean (the FSM chokepoint is untouched)

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

Adopt `AppendFileDurableAsync` in [`event-store.js`](../../src/event-store.js#L114-L123)
`AppendDurable`, and update the now-stale comment at
[line 14](../../src/event-store.js#L14) that documents the absence of `fsync`.

**Explicit cost note:** an `fsync` per append is a real per-event latency cost. The ledger is
non-authoritative and best-effort by contract, so if the cost measures badly this phase may
legitimately land as "batched or deferred sync" rather than sync-per-append. Measure before
committing to sync-per-append; record the number in this doc either way.

The `append` contract must not change: still **never rejects**, still resolves `{ok:false,error}`,
so a caller's reminder transition is never blocked.

### QA gate — Phase 4
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
| [`reminders-module.js`](../../src/reminders-module.js#L3348) | 3348 | reminder counter |
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

## Phase 6 — Crash-injection verification & honest doc update

**The phase that earns the claim.** Everything before this is untested assertion.

1. A crash-injection harness that `SIGKILL`s a child process mid-write, in a loop, then asserts the
   target file is always fully parseable and equals either the pre- or post-state — never a
   truncation. Run it against the reminder queue and the completion store.
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
- [ ] Crash-injection harness actually kills mid-write (verify it reproduces corruption on `main` first — a harness that never triggers the bug proves nothing)
- [ ] N≥100 kill iterations, zero unparseable files
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
| Scope creep into P3 event-sourcing | Explicit non-goal; this hardens the path P3 will eventually replace |
