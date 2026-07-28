---
title: P3 Phase 2 — Cloud task brief (summarize-week projection + shadow-diff)
created: 2026-06-16
updated: 2026-06-16
owner: noel
status: SHIPPED 2026-06-16/17 (1.4.197/1.4.198) — all three deliverables built + the read-path staged behind SUMMARIZE_WEEK_COMPLETED_SOURCE=projection (default OFF). Remaining work is the human-gated shadow-diff-then-cutover decision (see ROADMAP Now/Next), not a build task — this brief is historical, not an open dispatch.
goal: >
  (Historical) gave a Cloud/local build session a self-contained brief to build the
  non-authoritative summarize-week event-log projection + shadow-diff harness (P3 Phase 2).
  Superseded by the shipped result — kept for provenance.
related:
  - PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md
roadmap_exempt: true
---

# P3 Phase 2 — Cloud task brief (summarize-week projection + shadow-diff)

> **Already shipped (2026-06-16/17, 1.4.197/1.4.198) — do not re-dispatch this brief.** All three
> deliverables below exist ([src/summarize-week-projection.js](../../src/summarize-week-projection.js),
> [scripts/summarize-week-shadow-diff.js](../../scripts/summarize-week-shadow-diff.js),
> [tests/summarize-week-projection.test.js](../../tests/summarize-week-projection.test.js)) and the
> read-path is staged behind `SUMMARIZE_WEEK_COMPLETED_SOURCE=projection` (default OFF, byte-for-byte
> unchanged behavior — see [CHANGELOG.md](../../CHANGELOG.md) `1.4.197`/`1.4.198`). This doc is kept
> for provenance; the live tracking doc is [P3-EVENT-SOURCED-CORE.md](P3-EVENT-SOURCED-CORE.md). The
> actual remaining step — run the shadow-diff against a real calendar week, then a supervised cutover
> decision — is **not a swarm build lane**; it is tracked on `P3-EVENT-SOURCED-CORE.md` and in
> `ROADMAP.md`'s Now/Next row.

## Status

| What was just completed | What's next |
|---|---|
| All three deliverables shipped (1.4.197, 2026-06-16) and the read-path staged behind a default-OFF flag (1.4.198, 2026-06-17); full suite green. | Nothing here — see [P3-EVENT-SOURCED-CORE.md](P3-EVENT-SOURCED-CORE.md) for the live shadow-diff-then-cutover next step. |

Launch-ready brief for a **Claude Code Cloud** session. Paste the "Task prompt" block below
into the Cloud session. This is the committed Phase 2 scope per the
[direction review](P3-EVENT-SOURCED-CORE.md#direction-review-codex-2026-06-16) — additive,
verifiable, reversible. **It does NOT include the user-facing cutover** (supervised, human-gated)
and it does NOT touch the authority flips (Phase 3/5), which are behind the
[stop-and-re-decide gate](P3-EVENT-SOURCED-CORE.md#direction-review-codex-2026-06-16).

## Why this is Cloud-safe
A pure fold + a diff harness + tests. No authority change (the live path stays on
`CompletionStore`). Nothing it produces can alter user-facing behavior. The only thing it can't do
from Cloud is see local gitignored data — handled below.

## Target contract (what the fold must reproduce)
The live `summarize-week` (`#HandleSummarizeWeekAsync`,
[src/reminders-app-mention-handler.js:900-947](../../src/reminders-app-mention-handler.js#L900-L947))
renders two lists for the current Sun–Sat calendar week (workspace `MAIN_TIMEZONE`,
range from `DateUtils.GetCalendarWeekRange`):
1. **Completed this week** — from `GetCompletedRemindersBetween(StartMs, EndMs)` →
   `CompletionStore` rows `{ reminderId, summary, assigneeID, sourceChannelID, dueDate, completedMs }`,
   oldest-first, where `completedMs ∈ [StartMs, EndMs)`.
2. **Still open** — the live pending-reminders queue (`GetPendingRemindersQueue()`).

The Phase 2 fold must produce the SAME two lists **from the event log** instead:
- completed = fold → `ReminderCompleted` events whose `payload.completedAt ∈ [weekStart, weekEnd)`,
  mapped to the row shape above (`by`→assigneeID, `summary`, `completedAt`→completedMs).
- open = fold → reminders with `ReminderCreated`/`ReminderScheduled` and no terminal
  `ReminderCompleted`/`ReminderCancelled`, matching what the live queue would show.

Event shape contract: [xyz-tick/CONTRACT.md](../../xyz-tick/CONTRACT.md). Existing fold style to
mirror: [deploy/reminders-export/events-projection.js](../../deploy/reminders-export/events-projection.js).

## Data feeding (Cloud has NO access to local `data/runtime/`)
The Cloud sandbox is a separate machine seeded from the GitHub repo; `data/runtime/` is gitignored
([.gitignore:10](../../.gitignore#L10)) so it is NOT in the clone. Feed a real-data snapshot via a
channel the session has creds for — the published-data repo `export-repo` (updated every
5 min, cloneable), or a read-only `scp` from the dev server into `data/runtime/` **inside the
sandbox**. For unit tests, use **synthetic fixture `.jsonl`** — no real data needed; real data is
only for the shadow-diff demonstration. **Never commit workspace data.**

---

## Task prompt (paste into the Cloud session)

> Build P3 Phase 2: a NON-authoritative `summarize-week` projection + a shadow-diff harness for the
> Sleuth repo. This is additive and reversible — DO NOT change any user-facing behavior, DO NOT
> wire it into the live message path, DO NOT touch the authority flips (Phase 3/5). Read
> `PROJECT/2-WORKING/P3-PHASE-2-CLOUD-TASK.md` and `PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md`
> first.
>
> Deliverables (all additive, new files where possible):
> 1. **`src/summarize-week-projection.js`** — pure `summarizeWeekFromEvents(events, { weekStartMs, weekEndMs })`
>    returning `{ completed: Row[], open: Reminder[] }` matching the live shape in the brief's
>    "Target contract". No I/O, no Slack/GitHub, deterministic. CommonJS to match the repo.
> 2. **A shadow-diff harness** — `scripts/summarize-week-shadow-diff.js` (dev CLI) + a test, that
>    for a given workspace + week computes BOTH the current `CompletionStore`-based completed list
>    and the projection's completed list, and reports any mismatch (missing / extra / differing
>    rows by `reminderId`) as structured JSON. This is the thesis test made runnable.
> 3. **`tests/summarize-week-projection.test.js`** — `node:test` + `node:assert` (the repo's
>    Phase-1 event tests use node:test; match that). Cover: completed-in-window selection
>    (inclusive start / exclusive end), open-set derivation (created/scheduled minus
>    completed/cancelled), determinism, and the harness producing a clean diff on matching inputs +
>    a flagged diff on a planted mismatch. Use synthetic fixture events.
>
> Constraints: stay additive; do not modify `src/reminders-module.js`,
> `src/reminders-app-mention-handler.js`, or any existing tracked behavior. Acceptance:
> `node --test tests/summarize-week-projection.test.js` green; `node scripts/summarize-week-shadow-diff.js`
> runs and prints a structured diff over a fixture; `npm run validate:fsm` green; `tsc` clean.
> Report what you built with file:line citations and the acceptance output.

---

## Acceptance (definition of done for the Cloud pass)
- The fold + harness + tests exist and are green; harness emits a structured diff report.
- `validate:fsm` green, `tsc` clean. Additive only — no existing tracked behavior changed.

## Out of scope for Cloud (stays supervised / local)
- The user-facing **cutover** (switching `summarize-week` to read the projection) — only after the
  shadow-diff matches across a **real calendar week**. Bring results local for that decision.
- Anything authoritative (Phase 3 boot-rebuild, Phase 5 retire-writes) — behind the stop gate.
