---
Goal: Final QA of the GH-301 Phase 2 implementation (create/retitle/reschedule for bots, version checks, durable create)
Date: 2026-11-06
NEXT: Reviewer
STATUS: Open
---

# Context

You approved the Phase 2 plan in round 2 of `relay-system/2026-11-06/gh301-phase2-plan-qa.md`. Review the
**implementation** on this branch against it: `PROJECT/2-WORKING/GH-301-BOT-REMOTE-CRUD.md`, section "Phase 2
plan", revised after round 1. The issue text is seeded at `.relay-artifacts/gh301-issue.md`.

Diff: `git diff 39760d7..HEAD -- src tests docs CHANGELOG.md`. Evidence: `TESTS-RESULTS/2026-11-06+GH-301/phase2-verification.md`,
`phase2-smoke-output.txt` and `gh301-phase2-smoke.cjs`.

**Operational envelope:** the same as before. Grade against the approved plan and commensurate complexity.
Read-only probes under `.relay-scratch/` are fine; don't run the suites here.

Files:
- `src/reminders-module.js`: `GetReminderVersion`, `FindPendingReminderByApiCreateKey`; the `ExpectedVersion`
  checks in `CompleteReminderByIdAsync`, `CancelReminderFromListAsync`, `UpdateReminderSummaryFromListAsync`
  (including the post-await re-check) and `RescheduleReminderAsync`; the create stamp in
  `CreateReminderFromListRowAsync`
- `src/web-api.js`: `PrincipalBulkActionKeys`, `#CheckPrincipalBulkShape`, `#HandlePrincipalBulkAsync`, `#RunPrincipalBulkAsync`,
  `#ApplyBulkReminderActionAsync` (conflict mapping), the GET `version` field
- `tests/web-api-reminders.test.js` (GH-301 block), `tests/reminders-integration.test.js` (GH-301 Phase 2 block)
- `docs/web-api.md` (Bot principals), `CHANGELOG.md` (Unreleased)

Questions:

1. Does the code match the approved plan: digest fields and purity, per-action allowlists, `ifMatch`,
   one-touch, create alone, title contract, enabled channel, pre-check plus moment-of-mutation re-check, durable
   create stamped before the first save, replay and changed-body refusal? Is anything missing or extra?
2. **Correctness at the edges:**
   - Is each writer's version check placed before its first mutation, with no await in between (complete,
     cancel, reschedule)?
   - Does retitle's post-await re-check compare against the same object, and correctly refuse a reminder that
     left the queue?
   - Is `conflict` kept distinct through the adapters? Are legacy calls (no options) byte-for-byte unchanged?
3. **Durable create:**
   - Is the lookup inside the in-memory reservation?
   - Is the key derivation unambiguous?
   - Is a create that failed before stamping retried cleanly?
   - Can a stamped reminder be found while it is still in `#QueueReminderAsync`?
4. Is `version` on reads computed the same way for disk/projection records as for live objects (Date vs ISO
   string, legacy owners)? Could a bot read a version that its next write can never match?
5. Do the tests and red controls substantiate the claims? Is the footprint commensurate?
6. Are the docs and CHANGELOG accurate, including the pending-only durable-create limit and the deferred
   link editing? Is the public text free of deployment and PII details?

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the branch can ship as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
