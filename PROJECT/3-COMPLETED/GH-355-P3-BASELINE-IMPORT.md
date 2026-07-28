---
gh_issue: 355
source: https://github.com/NeochromeTeam/sleuth-app/issues/355
title: P3 Phase 2 — baseline-import for pre-ledger reminders (fixes null assignee/sourceChannel in summarize-week projection)
status: Shipped 1.4.211 (b3075d7) — build + prod-validated; the flag flip (step 3 of the cutover sequence) remains a separate human-gated decision, not part of this lane's scope
created: 2026-07-04
updated: 2026-07-06
doc_type: project
effort: 2
complexity: 2
risk: 2
phases: 1
related:
  - PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md
---

# P3 Phase 2 — Baseline-Import for Pre-Ledger Reminders

## Ask

Unblock the P3 Phase 2 (`summarize-week` projection) cutover. The read-path cutover flag
(`SUMMARIZE_WEEK_COMPLETED_SOURCE=projection`, shipped default-OFF in 1.4.197/1.4.198) can't flip
because the shadow-diff isn't clean — and the reason is a known, Phase-0-anticipated gap, not a
projection bug: **reminders created before the event ledger was born have no `ReminderCreated`
event, so the fold can't recover their denormalized creation-time fields.**

## Swarm Preflight Contract

Single-phase, additive, reversible lane. Write-set is disjoint from the reminder-display collision
cluster (`reminders-display-utils.js` / `reminders-module.js` — GH-338/GH-337), so this runs as its
own independent lane with no serialization constraint against the active waves. The read-path cutover
(`SUMMARIZE_WEEK_COMPLETED_SOURCE=projection`) is explicitly **out of the write-set** — that flag flip
stays a human-gated decision after a clean shadow-diff, not part of this lane.

The two new files (`scripts/baseline-import.js`, `tests/baseline-import.test.js`) are seeded as
committed **`GH-355-STUB`** placeholders so the write-set is precise and all artifacts exist at the
ref (swarm-preflight GH-39/A2 requires this) without coarsening to whole-directory artifacts — which
would falsely collide with GH-338's `tests/` file and force serialization. The lane replaces the
stubs and removes the `GH-355-STUB` marker; that marker is the `fix_probes` freshness signal
(present ⇒ not yet built).

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test",
  "fix_probes": [
    { "type": "grep_present", "path": "scripts/baseline-import.js", "pattern": "GH-355-STUB" }
  ],
  "artifacts": [
    "scripts/baseline-import.js",
    "deploy/reminders-export/events-projection.js",
    "tests/baseline-import.test.js",
    "tests/events-projection.test.js"
  ],
  "remediation": {
    "source": "self#approach",
    "criteria": "Build scripts/baseline-import.js: a one-shot, idempotent import that scans BOTH data/runtime/reminders/<ws>_reminders.json (active) AND <ws>_completed.json (completed) and, for every reminder lacking a ReminderCreated or existing BaselineReminderImported event in <ws>_events.jsonl, appends a BaselineReminderImported event seeding assigneeId/sourceChannelId/targetChannelId/text/dueAt/state plus Phase-4 fields (originalSenderId/originalMessageId/originalThreadTs/originalChannelName/ignoreSnooze), with the event ts = the reminder's original CreatedOn (not runtime clock). Also fix the BaselineReminderImported case in events-projection.js (L153-161) to map payload.githubUrls (currently omitted vs the ReminderCreated case at L122). DONE when: npm test green, and re-running scripts/summarize-week-shadow-diff.js on a post-floor neochrome week returns clean apart from the documented +/-1ms completedMs divergence. OUT OF SCOPE: flipping SUMMARIZE_WEEK_COMPLETED_SOURCE (human-gated), any authority flip (Phase 4/6), recovering pre-ledger completion history."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```

## Evidence — shadow-diff run 2026-07-04 (prod `neochrome`)

Ran `scripts/summarize-week-shadow-diff.js` against real prod data for two clean post-floor weeks
(Sun Jun 21→28 and Jun 28→Jul 5). Completion **counts matched exactly** (26/26, 24/24 — no
missing/extra completions, so no data loss), but `match: false` on both. Every diff falls into one
of two fully-explained categories:

1. **`completedMs` off by ±1ms** — the script-documented expected divergence (store stamps
   `Date.now()` at the FSM site; event `completedAt` is set instants earlier). Rendered at **day**
   granularity → user-invisible.
2. **`assigneeID` + `sourceChannelID` = `null` in the projection** — **pre-ledger reminders**:
   created before the ledger floor (2026-06-17 15:04 UTC → no `ReminderCreated` event) but completed
   inside a post-floor week. The fold derives assignee/sourceChannel only from the `ReminderCreated`
   payload → null.

**Verified 100%:** all 15 null-field mismatches lack a `ReminderCreated` event; all 6
completedMs-only rows have one.

**Key correction to the earlier window-floor guidance:** the correctness boundary is the reminder's
**CREATION** time being post-floor, not its completion time. A post-floor completion window does not
guarantee clean parity while long-lived reminders predate the ledger. As of 2026-07-04, **21 of 60
ledger completions (35%) are pre-ledger**, still completing as recently as Jul 2 — has NOT aged out.

**User-visible impact of flipping today:** summarize-week renders `summary` + `assigneeID` (as a
` — <@user>` suffix) + `completedMs` (day). `sourceChannelID`/`dueDate` are never rendered. So the
only visible regression is the **`— @assignee` mention dropping off ~35% of completed lines** —
cosmetic but real.

## Approach

Emit **`BaselineReminderImported`** events (already sketched in the P3 plan's Appendix A) that seed
the projection-critical denormalized fields for reminders that predate the ledger. The fold already
treats a baseline event as a stream-seeding event equivalent to `ReminderCreated`
([events-projection.js:153-161](../../deploy/reminders-export/events-projection.js) — the case
exists), so the main new code is the **import script** that emits the events, plus a small fold fix
(see Blocker B below).

**Source BOTH stores, not just active reminders** *(Agy review Blocker A — the load-bearing
correction)*. The pre-ledger reminders that fail the shadow-diff are **completions** — once
completed they leave `<workspace>_reminders.json` and live in `<workspace>_completed.json`. Sourcing
only from `_reminders.json` (active) would miss exactly the reminders causing the mismatch. So the
import must scan:
- `data/runtime/reminders/<workspace>_reminders.json` — still-active pre-ledger reminders, and
- `data/runtime/reminders/<workspace>_completed.json` — completed pre-ledger reminders (these carry
  `assigneeID`/`sourceChannelID` already — that is the source of the shadow-diff `stored` values).

For any reminder in either store that lacks a `ReminderCreated` (or existing
`BaselineReminderImported`) event in the ledger, emit a baseline event seeding its denormalized
fields.

Single phase, additive, reversible (delete the baseline events / revert the fold change). No
authority change — the read-path stays on `CompletionStore` until the separate, human-gated cutover.

## Acceptance criteria

The build is DONE (a swarm builder can satisfy all of these against **unit-test fixtures** — no prod
data needed; the operator-validation block below is separate and NOT a builder task):

- [x] `scripts/baseline-import.js` is a one-shot, **idempotent** import that scans **both**
  `data/runtime/reminders/<ws>_reminders.json` **and** `<ws>_completed.json` and emits a
  `BaselineReminderImported` event for every reminder that lacks a `ReminderCreated` (or existing
  `BaselineReminderImported`) event in `<ws>_events.jsonl` *(Agy Blocker A)*. Remove the `GH-355-STUB`
  marker (freshness probe flips to landed).
- [x] Baseline events carry every projection-critical field (`assigneeId`, `sourceChannelId`,
  `targetChannelId`, text/summary, `dueAt`/`shouldPostOn`, state) **plus** the Phase-4-rebuild fields
  `originalSenderId` / `originalMessageId` / `originalThreadTs` / `originalChannelName` / `ignoreSnooze`
  as optional props *(Agy Should D)*.
- [x] Each baseline event's `ts` = the reminder's original `CreatedOn` ISO timestamp, **not** the
  import script's runtime clock (preserve per-workspace `ts` monotonicity) *(Agy Should C)*.
- [x] Fix the fold's `githubUrls` gap *(Agy Blocker B)*: the `BaselineReminderImported` case in
  [events-projection.js:153-161](../../deploy/reminders-export/events-projection.js) maps text /
  assignee / channels / dueAt / state but **not** `githubUrls` (unlike the `ReminderCreated` case at
  line 122). Add
  `ArgRecord.githubUrls = Array.isArray(Payload.githubUrls) ? Payload.githubUrls.slice() : ArgRecord.githubUrls;`.
- [x] `summarizeWeekFromEvents` / `FoldReminders` already treat `BaselineReminderImported` as
  stream-seeding (case exists) — **verify, don't rebuild**.
- [x] Import is safe to re-run (no duplicate baseline events for an already-seeded reminder).
- [x] `tests/baseline-import.test.js` covers the import over fixtures (both stores; dedup vs existing
  events; idempotency; `ts`=CreatedOn; Phase-4 fields present), and `tests/events-projection.test.js`
  covers the baseline `githubUrls` mapping. `npm test` green.

**Operator validation — DONE (per CHANGELOG.md 1.4.211, 2026-07-06):** ran against real prod
`neochrome` data; `scripts/summarize-week-shadow-diff.js` on two post-floor weeks went from 11
null-field mismatches to **0** (only the documented ±1ms `completedMs` divergence remains). Cutover
sequence steps 1 (build) and 2 (clean shadow-diff) are both done. Step 3 — flipping
`SUMMARIZE_WEEK_COMPLETED_SOURCE=projection` — remains a separate, human-gated decision, still open.

## Review feedback (Agy relay, 2026-07-04)

Reviewed via `/relay-xyz` headless Agy turn — thread:
`.xyz/relay-system/2026-07-04/gh-355-baseline-import-plan-review.md`. **Verdict: FAIL (changes
requested)** — all four findings folded into the Approach + acceptance criteria above:
- **[Blocker A]** backfill must also cover completed legacy reminders (source `_completed.json`, not
  just `_reminders.json`). *Load-bearing — the mismatching reminders are completions.*
- **[Blocker B]** `events-projection.js` `BaselineReminderImported` case omits `githubUrls` mapping.
  *Verified against code.*
- **[Should C]** baseline `ts` = original `CreatedOn`, not import runtime clock (monotonicity).
- **[Should D]** future-proof payload with Phase-4-rebuild fields now.

## Explicit non-goals

- **Not** the read-path cutover itself (flipping `SUMMARIZE_WEEK_COMPLETED_SOURCE=projection`) —
  that stays the human-gated decision this unblocks.
- **Not** recovering historical *completions* that predate the ledger — only active reminders get a
  synthetic starting point; pre-log completion history stays partial by design.
- **Not** any authority flip (Phase 4/6) — those stay behind the stop-and-re-decide gate.

## References

- Plan: [PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md](../2-WORKING/P3-EVENT-SOURCED-CORE.md) —
  Phase 0 baseline strategy, Appendix A schema, Phase 2 exit criteria.
- Harness: [scripts/summarize-week-shadow-diff.js](../../scripts/summarize-week-shadow-diff.js);
  fold: [src/summarize-week-projection.js](../../src/summarize-week-projection.js) /
  [deploy/reminders-export/events-projection.js](../../deploy/reminders-export/events-projection.js).
