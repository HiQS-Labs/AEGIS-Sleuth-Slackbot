---
Goal: Final QA of the GH-290 implementation (reminders edit actions on the bulk Web API + skill wrapper)
Date: 2026-11-05
NEXT: Reviewer
STATUS: Open
---

# Context

You approved the plan in round 3 of `relay-system/2026-10-28/gh290-plan-qa.md`. Now review the **implementation**
on this branch against that plan: `PROJECT/2-WORKING/GH-290-REMINDERS-EDIT-API.md` (read its "Execution notes
(2026-11-05)" for the recorded deviations). Issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/290.

Diff to review: `git diff d8f3b15..HEAD -- src tests skills docs CHANGELOG.md` (base = `origin/development`).
Evidence: `TESTS-RESULTS/2026-11-05+GH-290/verification.md`, `smoke-output.txt`, `gh290-smoke.cjs`.

**Operational envelope:** single-tenant-per-workspace Slack bot. The bearer-token Web API is reached by one
operator through an SSH tunnel, plus a local operator CLI skill. Grade against the approved plan and
commensurate complexity. Do not ask for unrequested machinery (RBAC, idempotency keys, rate limits, audit DBs,
per-bot principals: those belong to the separate issue #301). Read-only probes under `.relay-scratch/` are
fine. Do not run the jest suites here; the receipt has them.

Files:
- `src/web-api.js`: `#HandlePostWorkspaceRemindersBulkAsync`, `#PrepareBulkReminderAction`,
  `#ApplyBulkReminderActionAsync`, `#WithListFailures`
- `src/reminders-module.js`: `UpdateReminderSummaryFromListAsync`, `RescheduleReminderAsync`,
  `ReassignReminderAsync`, `#RecordLedgerGapAsync`, `CreateReminderFromListRowAsync`, and the claim-site check
  in the posting loop (search `RemindersToPost is a snapshot`)
- `src/lists-module.js`: `#AddToUserContextsAsync`, `SyncReminderScheduleAcrossListsAsync`,
  `MoveReminderBetweenUserListsAsync`
- `skills/bulk-edit-reminders/bulk-edit-reminders.mjs` and `SKILL.md`; `docs/web-api.md` bulk section; `CHANGELOG.md` Unreleased
- tests: `tests/web-api-reminders.test.js`, `tests/reminders-integration.test.js` (`GH-290: Web API edit writers`),
  `tests/lists-module.test.js` (`GH-290: owner and schedule changes follow onto the lists`)

Questions:

1. Does each action match the approved plan's table (fields, writer, per-item statuses, whole-batch refusal)?
   Are complete/cancel requests and responses unchanged from GH-279?
2. FSM and posting: does `RescheduleReminderAsync` go only through `#TransitionReminderState`, and is the
   claim-site `State !== Overdue` skip correct for every path into that loop (normal and force mode)? Could it
   skip something it should post?
3. Reassign and lists: does `MoveReminderBetweenUserListsAsync` avoid a shared-row create or delete, update the
   owner cell on surviving rows, and report failures as `partial`? Is the `#AddToUserContextsAsync` lift
   byte-equivalent for `AddReminderToListAsync`?
4. Ledger coverage: is the gap recorded before the in-memory mutation for summary and owner edits, and is a
   marker failure non-blocking? The smoke shows a projection-flag GET and a reload keeping edited values; does
   that settle the plan-QA verification note?
5. Wrapper: are the deviations sound? Prod uses `sshpass -e` with the password parsed from the vultr env file;
   dev URLs are direct, so `--tunnel` refuses non-loopback. Do edits keep argument order, does the per-action
   repeat refusal work, does `backup` accept `[]`, and does the exit code use the new statuses? Is any secret
   exposed (argv, logs, files)?
6. Do the tests substantiate the claims (red controls listed in the receipt), and is the footprint
   commensurate? Is anything required missing, or anything over-built?
7. Is the full-suite result honestly reported? (The one `thread-memory` failure also fails on `development`.)

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the branch can ship as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
