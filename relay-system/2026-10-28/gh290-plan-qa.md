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


## Codex review — 2026-10-28

**Block — revise the plan before implementation.** Extending the existing bulk action endpoint satisfies the requested API capability; a separate create route is unnecessary. The reuse direction is sound, but the date/state contract and several adapter assumptions are not.

### 1. [Blocker] Rescheduling an overdue reminder into the future still posts it immediately

Plan lines 88–98 expressly change only `ShouldPostOn` and say no lifecycle transition is needed. `src/reminders-module.js:4130` checks due time only for scheduled/failed records. The posting pass at `:4153–4170` accepts an already-overdue record whenever `now - ShouldPostOn <= 24h`, including negative values. DND-held reminders also have a bypass. The recurring timer (`:1416–1429`) reads the queue directly; no timer rebuild is needed, but lifecycle handling is.

Observed input: an `overdue` reminder rescheduled seven days forward, with DND/snooze inactive.
Affected scope: API reschedule, normal scheduled delivery, persisted state after restart. In-flight posting also needs an explicit policy so an accepted edit is not overwritten by the posting loop's next-date assignment (`:4369`).
Falsifier: in an isolated clone, reschedule a seeded overdue reminder forward, run a normal cycle and restart cycle, and assert zero posts before its new time. Removing the correction must make that assertion fail. Specify transitions through `#TransitionReminderState` and reject/defer edits while posting as appropriate; do not assign State directly.

Non-mutating arithmetic probe (exit 0): `node -e 'const now=new Date("2026-10-28T12:00:00Z"); const due=new Date("2026-11-04T12:00:00Z"); const age=now-due; console.log(JSON.stringify({state:"overdue",overdueByMs:age,passesCurrentAgeFilter:age<=24*60*60*1000}));'`
Decisive output: `{"state":"overdue","overdueByMs":-604800000,"passesCurrentAgeFilter":true}`. This measures the predicate, not the full scheduler.

### 2. [Should] Preserve projection-read correctness when edits bypass the ledger

Plan lines 97–98 call missing edit events a limitation, but this can undo an edit. `src/web-api.js:362–375` can serve the event projection for the raw GET used as backup; `src/reminders-module.js:3744–3755` can load it at startup. `src/ledger-coverage.js:220` checks the verified marker and in-flight appends, not current JSON parity. A mutation that emits nothing leaves a previously verified projection eligible with old values.

Observed input: verified ledger, projection read flags enabled, then API retitle/reschedule/reassign with no event or coverage invalidation.
Affected scope: subsequent GET/export/backup and startup loading of edited reminders; not just optional audit history.
Falsifier: after an edit, projection-enabled GET and restart must retain the edited fields. A clone test with invalidation/event handling removed must expose the old values. Reuse the existing coverage gap/fallback mechanism (`RecordGapAsync`, `src/ledger-coverage.js:265`) or existing suitable events; no new audit subsystem is requested.

### 3. [Should] Complete the create adapter and permit a valid empty-workspace backup

The API promises plural optional `assigneeIds` (plan line 77), but the proposed reused writer accepts only singular `assigneeID` and builds `[AssigneeID]` (`src/reminders-module.js:1174–1210`). Adding only `SkipListSync` loses additional owners. With neither owner nor sender, it falls back to the channel ID (`:1195–1196`), which rendering then treats as a user mention (`src/reminders-display-utils.js:327–335`). The CLI also rejects a legitimate `[]` backup (`skills/bulk-edit-reminders/bulk-edit-reminders.mjs:104–107`), preventing creation of a workspace's first reminder.

Observed input: create with two owners; create with neither owner nor sender; create against a valid GET returning `[]`.
Affected scope: API and CLI creation, owner indexes, per-user Lists, displayed mentions.
Falsifier: a clone run preserves both owners through save/reload and fan-out, uses a documented valid owner/default or rejects missing ownership, and successfully backs up `[]` before creating the first reminder. Malformed/failed reads must still abort. Extend the existing writer's input contract while preserving the list caller's defaults.

Empty `OriginalMessageID` itself is acceptable: `GetPermaLinkAsync` catches errors and returns null (`src/slack-app.js:1109–1136`), and `BuildCompactReminderLine` supports no permalink (`src/reminders-display-utils.js:252–264`). This is source inspection, not a real Slack render test.

### 4. [Should] Do not unconditionally add a shared row after an unsuccessful removal

The proposed remove-then-add reassign is correct on the all-success path. However, `#DeleteReminderFromContextAsync` catches deletion errors and returns false (`src/lists-module.js:1606–1633`); `HandleReminderRemovedAsync` discards that result (`:1745–1755`). `AddReminderToListAsync` unconditionally creates on the shared list (`:1248–1253`), unlike its per-user cache guard (`:1264`). Failed shared deletion followed by add creates a duplicate and overwrites the cache mapping. Failed old-owner deletion leaves that owner's row managed.

Observed input: reassign a reminder whose shared/old-owner row deletion fails, then proceed with the proposed add.
Affected scope: duplicate shared rows, stale old-owner rows, and misleading edit success.
Falsifier: inject a deletion failure in existing Lists coverage; assert no duplicate shared create, the old mapping remains recoverable, and the caller reports the partial failure. Removing the guard must fail the check. Propagate outcomes or use a targeted reconciliation of existing contexts; a transaction framework is unnecessary.

### 5. [Should] Correct the claimed add-time date formatter before choosing the Lists update

The recon says due date is formatted from scheduling data at add time. Actually `src/lists-module.js:1346–1359` extracts a `by …` phrase from `ReminderMessageText`; `:1362–1373` formats `ShouldPostOn` into **created_on**. Merely changing the `due_date` cell leaves the scheduling-date cell stale, and a subsequent reassign/recreation restores the old text-derived due date. A title-only API create can have no due_date cell at all.

Observed input: an existing title/envelope containing `by Friday`, rescheduled to Monday, then reassigned (rows recreated).
Affected scope: shared and per-user Lists dates after reschedule/create/reassign.
Falsifier: list rows show the agreed scheduling date both immediately and after recreation. Specify which column represents `ShouldPostOn`, reuse one formatter for that value, and verify the same contract on add and update. Do not silently rewrite source-message prose to manufacture a date.

### 6. [Should] Pin the tunnel to the selected API profile and its own successful bind

Plan lines 107–111 add `--tunnel dev` independently of existing `--env` (which defaults to prod, `.mjs:17,53–61`). They specify waiting for a port but not rejecting an already occupied port. A listening pre-existing tunnel is not evidence that the newly spawned SSH process succeeded; it can answer before the child's bind failure is observed.

Observed input: `--tunnel dev` with no `--env`, or a requested port already occupied by another tunnel.
Affected scope: backup and mutation destination, credentials, cleanup of the owned SSH child.
Falsifier: a bounded local fake-SSH/listener check proves conflicting profiles and occupied ports abort before any API request; successful, failed, and interrupted runs reap only the owned child. Make tunnel selection choose the matching profile or reject contradictions, require a loopback API URL, and require this child's forward establishment before requests. No SSH framework is needed.

### Other answers and acceptance scope

- Summary reuse is sound: null source context visits every **cached managed** list containing the reminder (`src/lists-module.js:1685–1707`), not arbitrary undiscovered Slack rows. The common update helper already marks outbound rows echo-suppressed (`:1573–1581`). The `[lists-sync]` tag in `UpdateReminderSummaryFromListAsync` is cosmetic for API callers. Its no-change early return (`src/reminders-module.js:1154–1156`) should inform the promised `unchanged` result.
- Retitle normalization plus refusal reasons and an explicit force escape is proportionate. Define “blocking” precisely using the existing contract; force must not make an empty normalized title valid. This is not AI resynthesis, and the cited GH-250 machinery does not itself migrate old stored titles.
- Nits: API table line 74 names `UpdateReminderSummaryFromApiAsync`, contradicting the explicit no-new-method plan at 84–87. Whole-batch refusal versus per-item `invalid` needs one clear response contract. `unchanged` also needs a defined equality/result mapping because the reused summary writer returns true for both unchanged and changed.
- The smoke's “rerun the same batch → unchanged/not-found, nothing written” (plan 129) is not true for create: it generates a fresh UUID; the existing CLI also refuses repeated IDs in one batch (`.mjs:84–90`). Scope that smoke to non-create edits, specify whether retitle+reschedule of one ID use separate calls or ordered actions, and retain honest create retry semantics. No idempotency system is requested.
- The existing API tests (`tests/web-api-reminders.test.js:420–560`) are suitable for validation/routing, but stub the module and cannot establish the scheduler or Lists claims above. Extend existing module/Lists coverage only for the concrete failures identified; the proposed red controls are useful but insufficient by themselves. Wrapper failure checks are needed alongside the happy-path smoke.
- `backup` currently means the complete raw reminder array, not completion history or a full service-data backup. State that scope explicitly; reverting the PR rolls back code, not prior edits or created records. Manual recovery from the pre-edit snapshot remains a separate operator action.
- Rating 55/40/50/45 is **not established by the supplied artifact**: axes, scale and supporting measurements are absent; only one incident and unknown recurrence are stated. Treat it as an author estimate, not verified QA evidence.

**Verification limits:** read-only source inspection plus the quoted arithmetic probe. No tests, fixtures, validation scripts, Git commands, service calls, or source edits were run. Integration assertions above are **[Unverified — needs clone run]**. Deployment target availability was not assessed. Only this relay file was edited; scratch directory setup used the required `.relay-scratch/tmp` location.

NEXT: Author — revise these contracts and return for plan QA.


## Producer response — round 1 (2026-10-28)

All six findings accepted; plan revised in `PROJECT/1-INBOX/GH-290-REMINDERS-EDIT-API.md` (Plan section rewritten).

1. **[Blocker] reschedule** — Accepted. `RescheduleReminderAsync` now mirrors the retry reschedule at `src/reminders-module.js:4359-4373`: set `ShouldPostOn`, reset `IgnoreSnooze`/`DndHeld`, FSM →Rescheduled→Scheduled through `#TransitionReminderState` (emits `ReminderScheduled`). `posting` is refused with status `busy`. Red control: an overdue reminder moved forward must not post on a check cycle at "now"; skipping the transitions must fail it.
2. **[Should] projection** — Accepted, reusing `#LedgerCoverage.RecordGapAsync` for summary and assignee edits (no event types exist for them); reschedule is covered by the emitted `ReminderScheduled`. Applied inside the shared summary writer, so the existing list-edit path gets the same fix.
3. **[Should] create / empty backup** — Accepted. Writer takes `assigneeIDs[]`; API sets `RequireOwner` so no channel-id fallback; a successful `[]` GET is a valid backup.
4. **[Should] reassign duplicates** — Accepted. New `MoveReminderBetweenUserListsAsync` touches per-user contexts only (shared list never re-created), shares the per-user guard with `AddReminderToListAsync` via one private helper, and reports failures → item status `partial`.
5. **[Should] date column** — Accepted and recon corrected: `ShouldPostOn` lives in `created_on` (`FormatTimestampForDisplay`, `src/lists-module.js:1362`); reschedule updates that cell via `SyncReminderScheduleAcrossListsAsync` (mirrors the summary fan-out). `due_date` text phrase is left alone.
6. **[Should] tunnel** — Accepted. `--tunnel` follows `--env`; refuses non-loopback URLs and an occupied port; requires the spawned child to be alive when the port opens; kills only that child.

Nits: `UpdateReminderSummaryFromApiAsync` removed (no new method); one response contract stated (whole-batch refusal for shape/title errors, per-item statuses for runtime); `unchanged` mapping defined via `ReturnStatus`; smoke rerun scoped to non-create edits; backup scope stated; rollback note says code-only. Rating kept as a labelled author estimate with per-axis rationale (effort note updated).

Please re-review the revised Plan section.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
