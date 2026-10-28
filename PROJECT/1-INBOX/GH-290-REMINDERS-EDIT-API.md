---
gh_issue: 290
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/290
title: "Reminders end-to-end tool: tunnel + backup wrapper, and Web API edits beyond closing"
status: Proposed (1-INBOX — not yet active)
created: 2026-10-28
doc_type: feature
related: "GH-279 (#280, bulk close), skills/download (#154), skills/talk-to-reminders, GH-250 (titles)"
---

# GH-290 — reminders end-to-end: tunnel + backup wrapper, and edits beyond closing

## Status

| What was just completed | What's next |
|---|---|
| Captured, rated, recon done, plan drafted (base `84ae838`). | Codex plan QA, then implement. |

## Problem

GH-279 gave agents a safe bulk **close** (complete/cancel) through the Web API. Everything around it
is still ad hoc: agents improvise the SSH tunnel; a full backup only exists as a side effect of a
bulk-close run (2026-10-27 an agent hand-rolled `*_raw_*.json`, `*_active_*.json` and a `.tgz`); and
any other edit — title, due date, assignees, a new reminder — has no supported path at all, which
leaves hand-editing live JSON on the server, the class of mistake behind #271/#272.

## Answer to "didn't we re-synthesize titles recently?"

Partly. GH-250 phases 1–3 (PRs #252, #266, #268) standardized how titles are **made** for new
reminders (`src/reminder-title-contract.js`: normalize, validate, fit; model title repair;
always-synthesize default). Nothing re-titled the reminders that already existed, and phase 4
(#263, store task structure) is a plan only. This task reuses the title contract for API retitles.
AI re-synthesis of existing titles is a non-goal here (possible follow-up).

## Recon (base `84ae838`)

| Seam | Finding |
|---|---|
| Bulk endpoint | `POST /workspace/:name/reminders/bulk` — `src/web-api.js:1014` `#HandlePostWorkspaceRemindersBulkAsync`. Validates the whole batch first (≤100, `MaxBulkReminderActions`), runs items serially, returns `{results, counts}`. Calls `CompleteReminderByIdAsync` / `CancelReminderFromListAsync`. |
| Retitle writer (exists) | `RemindersModule.UpdateReminderSummaryFromListAsync(id, mrkdwn, reason)` `src/reminders-module.js:1141`: finds pending reminder, `SlackFormatUtils.ReplaceReminderSummary`, `#SaveRemindersAsync`. Lists-originated, so it does **not** fan out; its caller (`src/lists-module.js:2625-2631`) then calls `SyncReminderSummaryAcrossListsAsync(id, mrkdwn, sourceCtx)` (`:1685`), which with `sourceCtx=null` updates **every** list row. |
| Create writer (exists) | `CreateReminderFromListRowAsync({summary, dueDate, assigneeID, targetChannelID, originalSenderID})` `:1178`: validates, `#MakeScheduledReminder` factory (the only sanctioned constructor, `:746`), `#QueueReminderAsync(info, {SkipListSync:true})`. API create needs list sync **on**. |
| Due date | `ShouldPostOn` (`Date`). Lists show it in the `created_on` column (`FormatTimestampForDisplay`, `src/lists-module.js:1362`); `due_date` is the \"by …\" phrase extracted from the text (`:1346`). Proven reschedule pattern: retry path `src/reminders-module.js:4359-4373` (set date, reset `IgnoreSnooze`/`DndHeld`, FSM →Rescheduled→Scheduled, which emits `ReminderScheduled`). P2-RESCHEDULE-REMINDER was retired unbuilt. |
| Assignees | `AssigneeIDs` authoritative, `AssigneeID` mirror; `#NormalizeReminderAssignees` `:898`; per-sender/assignee indexes rebuilt by `#BuildReminderIndexes` `:4508`. Per-user Slack Lists are keyed by assignee, so a reassign must move the row: `ListsModule.HandleReminderRemovedAsync` then `AddReminderToListAsync` (both public, existing). |
| Title contract | `src/reminder-title-contract.js` exports `NormalizeReminderTitle`, `ValidateReminderTitle`, `FitTitleToBudget` (GH-250). |
| Backup/resolve | `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`: env-file parse, `GET` raw records → `~/secrets/sleuth/backups/<ws>_reminders_<ms>.json` (mode 600), ID prefix resolve, dry-run. |
| Tunnel | No script opens one. Docs: `ssh -L 12020:localhost:2020 root@<host>`; secrets `~/secrets/sleuth/sleuth-web-api-<env>.env` (`SLEUTH_WEB_API_BASE_URL` points at the tunnel). Host/user in `~/secrets/sleuth/vultr-sleuth-production.env`. Dev: `ssh sleuth-oracle-dev`. |
| Tests | `tests/web-api-reminders.test.js` starts a real `WebAPI` with a mock `SlackApp` map — extend it. |

Projection: edits with no ledger event (summary, assignees) must call the existing
`#LedgerCoverage.RecordGapAsync` (`src/ledger-coverage.js:265`) so a verified projection is not served stale.
Untraced: real Slack List rendering of the updated cells (covered only by the dev smoke).

## Plan

**Outcome sought:** an agent backs up, then retitles, reschedules, reassigns, creates or closes live
reminders from one command, through the app's own writers, with the tunnel handled for it.
**Smallest viable bet:** extend the existing bulk endpoint with four more action types, each calling
one RemindersModule method (two already exist); extend the existing `.mjs` with the new flags, a
`backup` subcommand and an optional `--tunnel`.
**Not built:** new routes per action, Slack chat commands, AI re-synthesis of existing titles,
restore, multi-host tunnelling beyond prod/dev.
**Alternatives rejected:** (a) one REST route per edit (`PATCH /reminders/:id`, `POST /reminders`) —
a second validation/serial/result path beside the bulk one, and the skill would need N calls;
(b) a new shell wrapper script beside the `.mjs` — two entry points and two env parsers;
(c) editing JSON over SSH — races the live process, bypasses FSM and list sync.
**Rollback:** revert the PR. All changes are additive: old `complete`/`cancel` requests behave
byte-identically; no stored format changes.

### API — extend `POST /workspace/:name/reminders/bulk` (`src/web-api.js`)

One route, one response contract. **Whole-batch refusal** (HTTP 200, `success:false`, nothing
written) for any shape error: unknown action, missing/mistyped field, unparseable `dueDate`,
`assigneeIds` not a non-empty array of `U…`/`W…` ids, `create` without `channelId` or without any
owner (`assigneeIds` or `senderId`), a `retitle` whose normalized title is empty, or a `retitle`
refused by the title contract without `force`. Per-item statuses are reserved for runtime outcomes.

| action | fields | calls | per-item status |
|---|---|---|---|
| `complete` / `cancel` | unchanged | unchanged | unchanged |
| `retitle` | `reminderId`, `title`, optional `force` | `NormalizeReminderTitle` → `ValidateReminderTitle` (blocking = its returned reasons that `SubjectBlockingReasons`/the selector already treat as refusals; `force` skips validation only, never an empty normalized title) → `UpdateReminderSummaryFromListAsync(id, title, reason, {SyncLists:true})` | `updated` · `unchanged` · `not-found` · `error` |
| `reschedule` | `reminderId`, `dueDate` (ISO) | `RescheduleReminderAsync` (new) | `updated` · `unchanged` · `not-found` · `busy` (posting) · `error` |
| `reassign` | `reminderId`, `assigneeIds` | `ReassignReminderAsync` (new) | `updated` · `unchanged` · `partial` (lists move failed, with detail) · `not-found` · `error` |
| `create` | `title`, `dueDate`, `channelId`, `assigneeIds?`, `senderId?` (≥1 owner) | `CreateReminderFromListRowAsync(row, {SkipListSync:false})` | `created` + `reminderId` · `error` |

Items in one batch run serially in request order, so `retitle` then `reschedule` of one id is two
ordered actions in one call.

### RemindersModule (`src/reminders-module.js`) — extend, don't duplicate

1. **Summary edit** — `UpdateReminderSummaryFromListAsync(id, mrkdwn, reason, options={})` keeps its
   boolean return for the list callers (byte-identical) and gains two options: `SyncLists` (after save,
   `this.#ListsModule?.SyncReminderSummaryAcrossListsAsync(id, mrkdwn, null)`) and `ReturnStatus`
   (return `'updated'|'unchanged'|'not-found'` instead of a boolean, so the API can report
   `unchanged` from the existing no-change early return at `:1154`). Every real change, for all
   callers, also calls `this.#LedgerCoverage?.RecordGapAsync(ws, 'summary-edit')`: no ledger event
   carries summaries, so this stops a verified projection serving the old text (and closes the same
   latent gap on the existing Slack List edit path).
2. **Reschedule** — `RescheduleReminderAsync(id, date, reason)`, mirroring the proven retry
   reschedule at `:4359-4373`: refuse `posting` (→ `busy`); same instant → `unchanged`; else set
   `ShouldPostOn`, `IgnoreSnooze=false`, `DndHeld=false`, then `#TransitionReminderState(→Rescheduled,
   reason)` and `(→Scheduled, reason)` — the Scheduled transition emits `ReminderScheduled{dueAt}`, so
   the ledger/projection stay in step with no gap marker needed. Save, then update the Lists cell that
   carries `ShouldPostOn` — `created_on`, formatted with the add-time formatter
   `SlackFormatUtils.FormatTimestampForDisplay` (`src/lists-module.js:1362-1364`) — via a new
   `ListsModule.SyncReminderScheduleAcrossListsAsync(id, date)` that mirrors
   `SyncReminderSummaryAcrossListsAsync` (same `#ContextsContainingReminder` loop, `{created_on}` update).
   The `due_date` column is the "by …" phrase from the text and is left alone (no prose rewriting).
   Valid only from `scheduled`, `overdue`, `due`, `failed`, `snoozed`, `posted`; this fixes the
   blocker: an overdue reminder moved forward is `scheduled` again and the mark pass (`:4130`) waits.
3. **Reassign** — `ReassignReminderAsync(id, ids, reason)`: normalize the new set; same set →
   `unchanged`; else set `AssigneeIDs`, `#NormalizeReminderAssignees`, `#BuildReminderIndexes`, save,
   `RecordGapAsync(ws,'reassign')` (no assignee event exists), then
   `ListsModule.MoveReminderBetweenUserListsAsync(reminder, removedIds, addedIds)` (new, small): for
   each removed owner's per-user context, the existing `#DeleteReminderFromContextAsync`; for each added
   owner, the existing guarded per-user `#CreateListItemAsync` path (the same `!ItemCache.has` guard as
   `AddReminderToListAsync:1264`). **The shared list is not touched** (not keyed by owner), so no
   duplicate shared row. Returns `{ok, failures[]}`; any failure → item status `partial` with detail.
   Lifted from `AddReminderToListAsync`: its per-user loop becomes a private
   `#AddToUserContextsAsync(reminder, ids)` used by both, so the guard lives once.
4. **Create** — `CreateReminderFromListRowAsync(row, options={})`: accept optional `assigneeIDs`
   (array) beside `assigneeID`; owners = de-duplicated `assigneeIDs` ∪ `assigneeID`, else sender;
   `options.SkipListSync` defaults `true` (list caller unchanged), API passes `false`; when called with
   `options.RequireOwner`, a row with no owner and no sender returns `{ok:false}` instead of falling back
   to the channel id (the API sets it; the list caller keeps its fallback).

### Skill — extend `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`

- New flags: `--retitle id="Title"` (repeatable), `--force-title`, `--reschedule id=ISO`,
  `--reassign id=U1,U2`, `--create '<json>'` (repeatable). IDs resolve through the existing prefix
  resolver; the existing "repeated id" refusal is narrowed to repeats **within one action type**, so
  retitle + reschedule of one id is allowed (ordered as given).
- `backup` subcommand: only the existing backup step. **Scope stated:** the raw pending-reminder
  array from `GET /workspace/:name/reminders`, not completion history or the service data dir
  (that is the server's nightly ZIP). A successful empty array is a valid backup (`[]` written);
  a failed/malformed read still aborts. Mutating runs still back up first; `create`-only runs accept `[]`.
- `--tunnel`: opens a tunnel for the profile chosen by the existing `--env` (prod → host/user from
  `~/secrets/sleuth/vultr-sleuth-production.env`, key auth via ssh config; dev → `sleuth-oracle-dev`).
  Refuses unless `SLEUTH_WEB_API_BASE_URL` is a loopback URL; refuses if its port already accepts a
  connection (an existing tunnel is not reused silently); spawns
  `ssh -N -o ExitOnForwardFailure=yes -o BatchMode=yes -L <port>:127.0.0.1:2020 <target>`, waits up to
  ~10 s for the port **while the child is alive** (child exit = failure), runs, and kills only that child
  on exit/SIGINT/SIGTERM.
- Fix stale `temp/SOP.md` pointers here and in `skills/download/SKILL.md`.

### Tests (extend existing files only; commensurate)

- `tests/web-api-reminders.test.js` (mocked module): routing + field passing per new action;
  whole-batch refusal cases (bad title without force, missing owner on create, bad date) with
  "nothing called" assertions (red control: drop the pre-validation → fails); ordered retitle+reschedule.
- RemindersModule tests (existing file covering the module with a temp data dir): reschedule of an
  **overdue** reminder forward ends `scheduled`, emits `ReminderScheduled`, and a check cycle at
  "now" posts nothing (red control: skip the transitions → posts); `posting` → `busy`; reassign
  rebuilds indexes and calls the lists mover with the right removed/added sets; summary edit with
  `SyncLists` fans out and records the coverage gap; create with two owners keeps both after
  save/reload; `RequireOwner` with no owner → error.
- Lists tests (existing file): mover deletes from removed owners only, never creates a shared row,
  and reports a failed delete (red control: unguarded add → duplicate).
- Wrapper: tunnel/flag parsing checked manually in the smoke (occupied port refusal, non-loopback
  refusal, `--env dev --tunnel` targets dev); no new suite.

### Smoke (dev only)

Through `--env dev --tunnel`: `backup`; dry-run of a mixed batch; `create` one test reminder in the dev
test channel; then one call with retitle + reschedule + reassign on it; then complete it. Adjacent
path: rerun the non-create edit batch → `unchanged`; occupied-port refusal. Receipt under
`TESTS-RESULTS/2026-10-28+GH-290/`. Never on production. Rollback note: reverting the PR rolls back
code only; records already edited/created stay; restoring them is the manual operator step from the
pre-edit backup.

### Docs

`docs/web-api.md` bulk section; `skills/bulk-edit-reminders/SKILL.md`; `CHANGELOG.md` Unreleased;
ARCHITECTURE note only if the bulk section exists there.

## Rating

rated 55/40/50/45 (2026-10-28, author estimate on the 1–100 PRS axes; plan QA noted it is not independently measured) — priority 55 (operator tooling, unblocks safe prod edits), severity 40 (workaround is hand-editing live data, the #271/#272 class), appeal 50 neutral, effort 45 (four actions + wrapper; grew after plan QA). See issue #290. Recurrence: one ad-hoc backup incident 2026-10-27;
otherwise unknown trend.
