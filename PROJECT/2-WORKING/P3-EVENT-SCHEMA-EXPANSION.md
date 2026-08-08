---
title: P3 — Event Schema Expansion (make the ledger sufficient to reconstruct state)
created: 2026-08-08
updated: 2026-08-08
branch: development
status: Proposal — blocks Phase 4, Phase 5's flag enablement, Phase 6a, and the reversibility drill
owner: noel
author: Claude (Opus 5, 1M)
doc_type: proposal
complexity: 3
risk: 3
effort: 3
phases: 4
related:
  - PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md — the parent plan this unblocks
  - RELEASES.md -> Release 1.5.0 "Ledger"
  - PROJECT/3-COMPLETED/GH-355-P3-BASELINE-IMPORT.md — the precedent spike
goal: >
  Make the append-only event log carry enough to reconstruct a ReminderInfo byte-for-byte, so the
  read cutovers and boot-time rebuild that are currently blocked can be proven lossless rather than
  assumed.
---

# P3 — Event Schema Expansion

## Status

| What was just completed | What's next |
|---|---|
| **Four separate phases halted on the same root cause.** Phase 4 (boot rebuild) halted because the ledger cannot reconstruct boot state. Phase 5's completed-store cutover halted for missing relay fields. Phase 6a is blocked because its rollback test needs the boot authority Phase 4 never delivered. And after QA, **all three** Phase 5 read flags are blocked in `BLOCKED_PROJECTION_FLAGS` because each fold is known-lossy. The machinery is built and inert; the data is the blocker. | Land this proposal's four phases, then unblock each flag with its own parity run on real workspace data. Nothing here changes user-visible behaviour — it widens what is written to the log. |

## Why this exists, and the process lesson

**A version of this spike was already run, and its success was over-generalized.**
`scripts/summarize-week-shadow-diff.js` folded real prod `neochrome` data for one projection, found
11 mismatches, and GH-355 drove them to 0. From that, the plan concluded *"the substrate is proven"*.

But `summarize-week` needs a thin slice — completion timestamps and assignees. Nobody re-ran the
same diff asking the harder question: **can a full `ReminderInfo` be reconstructed from the log?**
That question is answerable in about a day with tooling that already exists, and answering it would
have surfaced every blocker below before eight marathon phases were planned around the assumption.

**Adopted as a rule for this plan:** a phase that asserts parity must run its own diff against real
data before being scheduled, not inherit a neighbouring phase's result.

## The gaps, measured

Each is verified in source, not inferred.

### 1. `ReminderCreated` omits reconstruction fields

`REQUIRED_PAYLOAD_KEYS.ReminderCreated` (`src/event-store.js:39`) is
`['text', 'assigneeId', 'sourceChannelId', 'targetChannelId', 'source', 'githubUrls']`.

A persisted `ReminderInfo` additionally carries, and the fold cannot restore:

| Field | Consequence if unrestored |
|---|---|
| `CreatedOn` | `Event.ts` is stamped when the *append* runs, not when the reminder was created — substituting it changes raw JSON bytes |
| `OriginalSenderID` | sender attribution lost |
| `OriginalMessageID` | **thread dedupe breaks** — this is the identity GH-27 keys on |
| `OriginalThreadTs` | same; thread identity is `OriginalThreadTs ?? OriginalMessageID` |
| `OriginalChannelName` | display regressions in digests |
| `IgnoreSnooze` | snooze behaviour changes (`src/reminders-module.js:3204-3206`) |

### 2. Relay state is never evented at all

`GitHubRelayStarted` / `GitHubRelayStopped` are persisted `ReminderInfo` fields
(`src/reminders-module.js:87-88`). No event payload carries them, **and** relay stop/start mutates
and saves JSON directly with no lifecycle event (`src/github-comment-relay.js:110-116`, `:170-176`).

This is the sharpest one because it is behavioural, not cosmetic: `github-comment-relay.js:102`
refuses to relay when `GitHubRelayStopped` is set, so a flag-on read from a stream lacking it
**resumes a relay a user deliberately stopped**, and `:143` treats an already-started relay as
first-use, posting a duplicate permalink.

### 3. Most lifecycle transitions are never emitted

`#EmitTransitionEvent` (`src/reminders-module.js:489-511`) maps only `Scheduled`, `Completed`,
`Snoozed`, `Cancelled`. Its own comment names the rest as deliberately unemitted: `due`, `overdue`,
`posting`, `posted`, `rescheduled`, `failed`, `dead-letter`.

Consequence: a fold cannot reproduce in-memory state for active reminders even when every creation
event is present, because the states they passed through left no trace.

### 4. Rescheduling silently resets `IgnoreSnooze`

The live queue sets `IgnoreSnooze = false` before scheduling (`src/reminders-module.js:3455-3458`),
but `ReminderScheduled` persists only `dueAt` / `via` (`:489-505`). The fold keeps the stale value
and the rebalance export publishes it **to an external consumer** (`src/web-api.js:459-466`).

### 5. `ReminderCompleted` cannot reproduce a completion record

It carries `by`, `method`, `summary`, `completedAt`. The authoritative `CompletionRecord` also needs
`sourceChannelID`, `dueDate`, `clientId` — and critically, its `completedMs` is stamped with
`Date.now()` (`src/reminders-module.js:569-576`) while the event carries a **separately sampled**
ISO instant (`:496-502`). Two different clock reads; they can never be byte-identical.

### 6. `readAll()` cannot signal a read failure

`src/event-store.js:223-254` collapses every read error — missing file, torn line, permission — to
`[]`. A caller cannot distinguish "no events" from "could not read events", so the reversibility
contract's required warn-and-fall-back **cannot fire**. An empty read currently looks like a valid
empty workspace.

### 7. Appends are best-effort, so a ledger can be valid but short

`#EmitLifecycleEvent` is fire-and-forget and tolerates `{ ok: false }`
(`src/reminders-module.js:516-555`). A torn append leaves a stream that passes every field check
while missing an event. Strict parity cannot detect a *lost* event among valid ones — a lone
creation passes while its absent paired `ReminderScheduled` leaves `ShouldPostOn` null.

## What this proposal does NOT do

- **It does not flip any flag.** Every projection flag stays in `BLOCKED_PROJECTION_FLAGS` until its
  own parity run passes on real data. This proposal makes that run *possible*, not automatic.
- **It does not change user-visible behaviour.** It widens what is written to the log and adds a
  read-error signal. The authoritative JSON path is untouched.
- **It does not attempt Phase 4, 6a, or the drill.** Those resume after this lands and their parity
  is proven.

## Cross-model review, 2026-08-08

Consulted Codex and agy. **agy timed out at the 300s cap, so this is a single-model review — the
harness stamped it `SINGLE-MODEL — NOT RECONCILED` and none of it is cross-verified.** A second pass
with agy is queued.

Codex's verdict was *"the right append-only approach, but this proposal is not ready as described."*
Seven findings, all source-grounded. Two I verified myself before accepting:

- **`hasOwnProperty` is not presence.** `event-store.js:68` checks
  `Object.prototype.hasOwnProperty.call(Payload, Key)`, which is **true for a property whose value is
  `undefined`** — and `JSON.stringify` then drops it. An event can pass validation and be written with
  the key absent from the serialized line. The whole "required key" guarantee this proposal leans on
  has a hole in it. **Verified by reading the validator.**
- **The baseline importer cannot enrich the records that need it.** `BuildSeededReminderIdSet`
  (`scripts/baseline-import.js:192`) collects every ID that already has a `ReminderCreated` or
  `BaselineReminderImported` event and skips it — so it can never upgrade existing v1 history.
  **Verified by reading the function.**

The plan below is the revised one. What changed and why is recorded inline.

## Phases

### Phase A — Schema v2: widen payloads AND complete emission coverage, together

**Merged from the original A and B on Codex's recommendation.** Shipping widened payloads without the
missing transitions produces a schema that *looks* sufficient while a fold still silently retains
`scheduled` for a reminder that actually went `overdue`. Half a schema is worse than a uniform gap,
because it invites a premature parity claim.

- [ ] **Version on READ, not just append.** Today `NormalizeEvent` accepts any numeric `v` and
      `readAll()` never revalidates, so a `v:2` label would guarantee nothing. Define a closed
      `(version, type) -> schema` registry; write `v:2` explicitly from every producer; treat a
      missing version as v1 **only**; make an unknown or invalid version a projection-read **error
      that triggers fallback**, never a silently skipped record.
- [ ] **Replace key-presence with real decoding.** `hasOwnProperty` admits `undefined`, and nothing
      enforces type, nullability, finite numbers, or valid timestamps. v2 payloads must be decoded and
      normalized before serialization — especially `completedMs`, the booleans, and lifecycle
      timestamps.
- [ ] Extend `ReminderCreated` v2 with `createdOn`, `originalSenderId`, `originalMessageId`,
      `originalThreadTs`, `originalChannelName`, `ignoreSnooze`.
- [ ] Extend `ReminderCompleted` v2 with `sourceChannelId`, `dueDate`, `clientId`, and `completedMs`.
      **Sample `Date.now()` once inside `#TransitionReminderState`** and pass the same value to both
      `#RecordCompletion` and the event; derive `completedAt` from it. Codex confirmed this does not
      breach the FSM contract — `validate-fsm-invariants.js` governs direct state assignment and
      construction bypasses, not timestamp provenance.
- [ ] **Emit every persisted transition**, or a general state-transition event. Production persists at
      least `overdue` when no posting occurs (`src/reminders-module.js:3229`), so omitting it is not
      theoretical.
- [ ] **Relay state as its own event, with fan-out modelled explicitly.** One Slack thread can affect
      several reminders, so this is either one event per affected reminder or a relay-keyed event
      whose fold fans out deterministically. Putting initial booleans on `ReminderCreated` is *not*
      sufficient, because the state changes later. Emit from `github-comment-relay.js` instead of
      mutating JSON silently.
- [ ] Carry the `IgnoreSnooze` reset in the reschedule path.

**Exit criteria:** every new event is v2 and decodes; every historical v1 event still reads under its
original schema; a test asserts a v1 event without v2 keys is accepted, a v2 event without them is
rejected, and a payload key present-but-`undefined` is rejected.

### Phase B — Backfill by appending, never by rewriting

- [ ] Append an explicit **v2 "current state imported" snapshot** for every record whose existing v1
      history cannot prove parity. This preserves append-only auditability; rewriting JSONL history
      does not.
- [ ] **Teach the baseline importer an enrich mode.** As written it skips any ID that already has a
      creation or import event, so it is structurally unable to upgrade exactly the records that need
      it (`scripts/baseline-import.js:192`).

**Exit criteria:** a workspace with only v1 history reaches full parity after the backfill, proven by
diff rather than asserted.

### Phase C — Generation-aware parity gate (separate release)

**Codex was explicit that a periodic checkpoint with a staleness bound is NOT sufficient**, and it is
right: appends are fire-and-forget, so a ledger can go short *immediately* after a checkpoint passes.

- [ ] Cache a full semantic parity result keyed by a **per-workspace authoritative mutation
      generation**: mark dirty before every JSON mutation; clear only once the relevant ledger
      append(s) *and* the JSON save are known complete; serve the projection **only while clean**,
      otherwise recompute or fall back.
- [ ] Compare active reminders **and** completions, every field each surface consumes — not ID sets.
- [ ] Give `readAll()` an error signal so a truncated or unreadable log is distinguishable from an
      empty one. Existing callers keep today's tolerant behaviour.

**Exit criteria:** a torn append makes the next read fall back with a logged warning; a dropped paired
event is detected; a mutation between checkpoint and read cannot serve stale projection data.

### Phase D — Prove on real data, then unblock one flag at a time

- [ ] Run the full-state diff — the spike that should have opened this plan — against real
      `neochrome` data: fold every reminder, diff every field against the JSON store.
- [ ] Unblock flags **individually**, each with its own recorded passing parity run.
- [ ] Only then do Phase 4, Phase 6a, and the reversibility drill return.

**Exit criteria:** zero field diffs on real data, or a documented and accepted divergence per field
(the ±1ms `completedMs` precedent).

## Sequencing

**A + B are one release. C is a separate release.** D gates everything downstream.

I originally wrote that "Phase A alone stops the log accruing more unreconstructible history" and
proposed landing it first. **Codex rejected that and I accept the correction:** widened payloads
without complete emission coverage still produce unreconstructible history, just less obviously — and
a half-widened schema is more dangerous than a uniform gap because it invites a premature parity
claim.

## Progress log

- **2026-08-08** — Proposal written after three marathon phases and three QA rounds converged on one
  root cause. Gaps 1-6 verified in source; gap 7 identified by Codex QA round 2.
