---
Goal: Pre-implementation plan QA for GH-290 (reminders end-to-end tool + Web API edits beyond closing)
Date: 2026-10-28
NEXT: Reviewer
STATUS: Open
---

# Context

Review the plan in `PROJECT/1-INBOX/GH-290-REMINDERS-EDIT-API.md` (issue https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/290) **before any code is written**.

Operator requirements, verbatim intent: (1) one end-to-end tool, smallest version = a wrapper that opens and closes the SSH tunnel, runs a full backup on its own, and calls the existing bulk path; (2) edits beyond closing, via new API endpoints; check prior art and reuse existing server code to reduce drift; keep it DRY — adapt, reuse and extend existing code. The operator also asked whether recent work re-synthesized reminder titles; the plan answers that (GH-250 applies to new reminders only) and reuses the title contract.

**Operational envelope:** a single-tenant-per-workspace Slack bot with an existing bearer-token Web API reached by one operator over an SSH tunnel, plus a local operator CLI skill. Grade against the stated requirements and commensurate complexity. Do not ask for unrequested enterprise machinery (RBAC, rate limits, audit DBs, idempotency keys, distributed locks, journaled undo). Non-goals are listed in the plan.

Design choice to challenge: the plan reads "new API endpoints" as **new action types on the existing `POST /workspace/:name/reminders/bulk`** rather than new routes, to keep one validation/serial/result path. Say whether that satisfies the requirement or whether a separate route is warranted (e.g. for `create`).

Read the plan in full, then the code it cites:
- `src/web-api.js` routes ~141-165, `#HandlePostWorkspaceRemindersBulkAsync` (~1014), `MaxBulkReminderActions`
- `src/reminders-module.js`: `UpdateReminderSummaryFromListAsync` (~1141), `CreateReminderFromListRowAsync` (~1178), `#MakeScheduledReminder` (~753), `#NormalizeReminderAssignees` (~898), `#QueueReminderAsync` (~4423), `#DeleteRemindersAsync` (~4456), `#BuildReminderIndexes` (~4508), `#SaveRemindersAsync` (~3971)
- `src/lists-module.js`: `AddReminderToListAsync` (~1242), `UpdateReminderInListAsync` (~1525), `SyncReminderSummaryAcrossListsAsync` (~1685), `HandleReminderRemovedAsync` (~1745), `#BuildUpdateCells` (~1760), the list-originated summary edit caller (~2615-2735)
- `src/reminder-title-contract.js` (exports)
- `skills/bulk-edit-reminders/bulk-edit-reminders.mjs` and `SKILL.md`; `skills/download/SKILL.md`
- `tests/web-api-reminders.test.js`

Questions:

1. Are the recon claims grounded (file:line)? In particular: does `SyncReminderSummaryAcrossListsAsync(id, mrkdwn, null)` update every list row, and is reusing `UpdateReminderSummaryFromListAsync` with a `SyncLists` option a sound reuse, or does the list-originated path carry side effects (echo suppression, log tags) wrong for an API caller?
2. Reschedule: is setting `ShouldPostOn` + save + a `due_date` cell update enough? Does anything else key off `ShouldPostOn` (scheduler timers, indexes, digest buckets, snooze logic) that would make an in-place change wrong or stale until restart?
3. Reassign: is "set AssigneeIDs → normalize → rebuild indexes → save → lists remove + add" correct and complete, given per-user Lists keyed by assignee? Would `AddReminderToListAsync` create duplicates on the shared list (it may already have the row)?
4. Create: is `CreateReminderFromListRowAsync` with `SkipListSync:false` an acceptable API create path (no source message, `OriginalMessageID: ''`)? Will a reminder with an empty `OriginalMessageID` post and render correctly?
5. Retitle via the title contract: is rejecting on `ValidateReminderTitle` blocking reasons (with a `force` escape) appropriate for an operator edit, or over-strict?
6. Wrapper: is extending the existing `.mjs` with `backup` and `--tunnel prod|dev` (spawned `ssh -N -L`, key auth, killed on exit) the right minimal shape? Anything unsafe?
7. Are acceptance checks falsifiable with red controls, and is the test footprint commensurate? Anything required missing, or over-built?
8. Is the rating 55/40/50/45 grounded?

Flag anything wrong, missing, mis-scoped, or over/under-engineered. Cite file:line. Every [Blocker]/[Should] asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines.

Write your verdict below and set STATUS to Approved if the plan can proceed as written (Nits allowed), otherwise leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
