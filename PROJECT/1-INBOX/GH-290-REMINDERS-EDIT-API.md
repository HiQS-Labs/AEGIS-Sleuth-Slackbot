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
| Due date | `ShouldPostOn` (`Date`). Lists `due_date` column is a rich-text cell (`#BuildUpdateCells` `src/lists-module.js:1798`), formatted at add time. No existing reschedule writer (P2-RESCHEDULE-REMINDER retired 2026-07-17, not built). |
| Assignees | `AssigneeIDs` authoritative, `AssigneeID` mirror; `#NormalizeReminderAssignees` `:898`; per-sender/assignee indexes rebuilt by `#BuildReminderIndexes` `:4508`. Per-user Slack Lists are keyed by assignee, so a reassign must move the row: `ListsModule.HandleReminderRemovedAsync` then `AddReminderToListAsync` (both public, existing). |
| Title contract | `src/reminder-title-contract.js` exports `NormalizeReminderTitle`, `ValidateReminderTitle`, `FitTitleToBudget` (GH-250). |
| Backup/resolve | `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`: env-file parse, `GET` raw records → `~/secrets/sleuth/backups/<ws>_reminders_<ms>.json` (mode 600), ID prefix resolve, dry-run. |
| Tunnel | No script opens one. Docs: `ssh -L 12020:localhost:2020 root@<host>`; secrets `~/secrets/sleuth/sleuth-web-api-<env>.env` (`SLEUTH_WEB_API_BASE_URL` points at the tunnel). Host/user in `~/secrets/sleuth/vultr-sleuth-production.env`. Dev: `ssh sleuth-oracle-dev`. |
| Tests | `tests/web-api-reminders.test.js` starts a real `WebAPI` with a mock `SlackApp` map — extend it. |

Untraced: Slack List cell formats beyond `summary`/`due_date` (assignee column write); exact
`due_date` cell text format at add time (will reuse the add-time formatter, located during build).

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

Validation stays whole-batch-before-any-write. New `action` values and their fields:

| action | fields | calls |
|---|---|---|
| `retitle` | `reminderId`, `title` (string) | title → `NormalizeReminderTitle` + `ValidateReminderTitle` (reject on blocking reasons; `force: true` skips validation, normalize still runs) → `UpdateReminderSummaryFromApiAsync` (below) |
| `reschedule` | `reminderId`, `dueDate` (ISO string, parseable, future not required) | `RescheduleReminderAsync` (new) |
| `reassign` | `reminderId`, `assigneeIds` (non-empty array of `U…` ids) | `ReassignReminderAsync` (new) |
| `create` | `title`, `dueDate`, `channelId`, optional `assigneeIds`, `senderId` | `CreateReminderFromListRowAsync` with a new `{ SkipListSync: false }` option |

Result statuses gain `updated`, `created` (with `reminderId`), `unchanged`, `invalid` (title refused,
with reasons). `create` items carry no `reminderId` in the request.

### RemindersModule (`src/reminders-module.js`) — extend, don't duplicate

1. Generalize `UpdateReminderSummaryFromListAsync(id, mrkdwn, reason, options={})`: add
   `options.SyncLists` (default false keeps today's list caller unchanged); when true, after save,
   call `this.#ListsModule?.SyncReminderSummaryAcrossListsAsync(id, mrkdwn, null)` when lists are
   available. No new method; the API calls it with `{SyncLists:true}`.
2. `RescheduleReminderAsync(id, date, reason)`: find pending, set `ShouldPostOn`, save, update the
   list `due_date` cell via `UpdateReminderInListAsync`-equivalent per context (reuse the add-time
   date formatter). Returns `false` when not pending.
3. `ReassignReminderAsync(id, ids, reason)`: find pending, set `AssigneeIDs`, `#NormalizeReminderAssignees`,
   `#BuildReminderIndexes`, save; lists: `HandleReminderRemovedAsync(id,'reassigned')` then
   `AddReminderToListAsync(reminder)`. Returns `false` when not pending.
4. `CreateReminderFromListRowAsync(rowData, options={})`: add `options.SkipListSync` (default `true`
   = today's behaviour for the list caller); API passes `false`.

None of 1–4 changes lifecycle state, so none calls `#TransitionReminderState`. The existing summary
edit appends no ledger event; reschedule and reassign keep that parity (noted as a limitation).

### Skill — extend `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`

- New flags: `--retitle id="Title"` (repeatable), `--reschedule id=ISO`, `--reassign id=U1,U2`,
  `--create '{"title":…,"dueDate":…,"channelId":…}'` (JSON per item), `--force-title`.
- `backup` subcommand (`node bulk-edit-reminders.mjs backup --workspace neochrome`): runs only the
  existing backup step; also writes completions if the GET returns them (it doesn't today — keep
  raw records only, note it).
- `--tunnel prod|dev`: spawn `ssh -N -L <localport>:127.0.0.1:2020 <target>` with
  `ExitOnForwardFailure=yes`, wait for the local port, run, kill on exit/signal. prod target from
  `~/secrets/sleuth/vultr-sleuth-production.env` (host/user; key auth via the agent's ssh config,
  no password handling); dev target `sleuth-oracle-dev`. Local port taken from
  `SLEUTH_WEB_API_BASE_URL` so it matches the secrets file.
- Fix stale `temp/SOP.md` pointers in this skill and `skills/download/SKILL.md`.

### Tests (extend existing files only)

- `tests/web-api-reminders.test.js`: one case per new action against the mock module (call shape +
  status); whole-batch rejection when one `retitle` title is invalid (red control: nothing called);
  `create` without `reminderId` accepted, with missing `channelId` rejected; old complete/cancel
  cases unchanged.
- Reminders module: existing reminders-module test file gets cases for `SyncLists`, reschedule,
  reassign (index rebuilt: `GetRemindersTargetingUserID`-visible change), and create with list sync on.
- Red controls: removing the whole-batch validation for `retitle` fails the batch-rejection test;
  dropping `SyncLists` fan-out fails the summary test.

### Smoke (dev only, GH-1088 style)

On dev (Oracle) through `--tunnel dev`: `backup`; dry-run of a mixed batch; apply a retitle and a
reschedule on one test reminder created via `create` in the dev test channel, then complete it.
Adjacent path: rerun the same batch (expect `unchanged`/`not-found`, nothing written). Receipt under
`TESTS-RESULTS/2026-10-28+GH-290/`. Never on production.

### Docs

`docs/web-api.md` bulk section; `skills/bulk-edit-reminders/SKILL.md`; `CHANGELOG.md` Unreleased;
ARCHITECTURE note only if the bulk section exists there.

## Rating

rated 55/40/50/45 (2026-10-28) — see issue #290. Recurrence: one ad-hoc backup incident 2026-10-27;
otherwise unknown trend.
