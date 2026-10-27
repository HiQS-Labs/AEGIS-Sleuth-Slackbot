---
gh_issue: 279
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/279
title: "Bulk-close Sleuth reminders from an agent session (Web API endpoint + skill)"
status: Working (2-WORKING)
created: 2026-10-27
updated: 2026-10-27
owner: noel
goal: "An agent session can back up, then complete or cancel a batch of live reminders through the app's own writers."
doc_type: feedback
related: "skills/download (#154), skills/talk-to-reminders"
effort: 2
complexity: 2
risk: 2
phases: 1
---

# GH-279 — bulk-close Sleuth reminders from an agent session

## Status

| What was just completed | What's next |
|---|---|
| Intake parked and rated; plan approved by Codex relay round 1 (`relay-system/2026-10-27/gh279-plan-qa.md`, attested at `c5ee212`). Production `neochrome` reminders backed up out-of-repo before any write. | Implement the endpoint, tests, skill and docs; run the gates; smoke test; final Codex QA; open the PR. |

## Problem

A reminder can only be closed in-process: the ✅ reaction, a Slack List checkbox or row delete, or
GitHub auto-complete. The Web API is read-only for reminders. An operator who has triaged a batch of
stale or duplicate reminders must find and react to each Slack message by hand. Editing
`<workspace>_reminders.json` on the host is not an option: the running process owns the in-memory
queue and rewrites that file, and #272 showed the cost of damaging production runtime data.

## Recon (base `a0dddb0`)

| Seam | Finding |
|---|---|
| Canonical writers | `RemindersModule.CompleteReminderByIdAsync` (`src/reminders-module.js:1076`, the ✅ path, used by github-sync) and `CancelReminderFromListAsync` (`:1119`, used by lists-sync). Both find the reminder in `#PendingRemindersQueue`, run `#TransitionReminderState` (FSM chokepoint), then `#DeleteRemindersAsync(ids, 'completed'|'canceled')`. Each returns `false` when the ID is not pending. |
| Live module from the Web API | `WebAPI` already receives `SlackAppsByWorkspace` (`src/web-api.js:128`, used at `:988`, `:1040`); `SlackApp.RemindersModule` getter (`src/slack-app.js:331`). |
| Auth | Non-`/admin` routes use the legacy bearer token (`#AuthorizationMiddleware`). |
| Existing read for backup | `GET /workspace/:name/reminders` (no `format`) returns the raw on-disk records. |
| Tests | `tests/web-api-reminders.test.js` already starts a real `WebAPI` with an injectable mock `SlackApp` map. |
| Concurrency | `#DeleteRemindersAsync` rewrites the reminders file, so the batch must apply items serially. |
| Prior art | `skills/download` (SSH + hand-copied state logic; #154 recommends the Web API instead), `skills/talk-to-reminders` (Node `.mjs` skill pattern). |

Untraced: the Slack-side effects of `#DeleteRemindersAsync` beyond what its comments state (list row
updates). They are the same effects the ✅ reaction and list deletion already have in production.

## Plan

**Outcome sought:** close a triaged batch of live reminders from an agent session, safely and in one step.
**Smallest viable bet:** one additive endpoint calling the two existing writers, plus one skill script.
**Alternatives rejected:** (a) editing the JSON over SSH, which races the live process and bypasses
the FSM; (b) the operator reacting ✅ to each reminder, the status quo this issue removes;
(c) one endpoint per ID, where a batch would need N calls and one failure could hide the others.
**Rollback:** revert the PR; the endpoint is additive and stores nothing new.

1. `src/web-api.js`: register `POST /workspace/:name/reminders/bulk` (bearer auth via the existing
   middleware). Validate `actions` as a non-empty array of at most 100 items, each with a string
   `reminderId` and `action ∈ {complete, cancel}`, with an optional string `reason`. The request is
   rejected whole if any item is invalid, before any write. Resolve
   `SlackAppsByWorkspace.get(name)?.RemindersModule` and error if the workspace isn't running.
   For each item, **serially**, call `CompleteReminderByIdAsync` or `CancelReminderFromListAsync`
   with reason `api-bulk: <reason>`, and record `completed | canceled | not-found | error`
   per item. Respond `{ success: true, data: { results, counts } }`, keeping the
   `success/data` envelope.
   *Verify:* new cases in `tests/web-api-reminders.test.js` (below).
2. `skills/bulk-edit-reminders/` with `SKILL.md` and `bulk-edit-reminders.mjs` (Node, no
   dependencies, `fetch`). It reads `SLEUTH_WEB_API_BASE_URL`/`SLEUTH_WEB_API_TOKEN` from the
   environment or `~/secrets/sleuth/sleuth-web-api-<env>.env` (parsed, never executed). Flags:
   `--workspace`, `--complete id,…`, `--cancel id,…`, `--reason`, `--dry-run`, `--backup-dir`
   (default `~/secrets/sleuth/backups`). Order: **backup** (GET raw records, write
   `<ws>_reminders_<ts>.json` mode 600, and abort unless `success` is true and the list is non-empty)
   → **resolve** each ID (full UUID, or an 8+ character prefix that must match exactly one record) and
   print the matched summaries, aborting on any unresolved ID → stop here on `--dry-run` → **POST**
   the batch, print per-item results, and exit non-zero if any item was not closed.
   *Verify:* smoke run (below).
3. `docs/web-api.md`: document the endpoint. `CHANGELOG.md`: add an entry (no version bump, per GH-17).
   *Verify:* `utils/pdda/pdda.sh run`.

**Non-goals:** editing other fields (text, due date, assignee); FSM or `#DeleteRemindersAsync`
changes; fixing `skills/download` (#154); setting up the SSH tunnel inside the skill (it is a
documented prerequisite, matching the existing `127.0.0.1:12020` base URL convention).

## Acceptance checks

- Endpoint tests in `tests/web-api-reminders.test.js`: request without a bearer token → Forbidden;
  unknown workspace → error; empty `actions`, more than 100 items, or a bad `action` → error with **no**
  writer called; a mix of a found ID and an unknown ID → per-item `completed` and `not-found`;
  `cancel` routes to `CancelReminderFromListAsync`; items run in order (the mock records call order).
  **Red control:** each new test is checked by reintroducing its defect (for example, swapping the
  writers or dropping validation) and confirming it fails.
- `npm run build`, `npm test`, `npm run validate:fsm` pass.
- Smoke (local, isolated data directory): the main path runs the skill against a locally running
  WebAPI-backed instance or the test harness with one real ID; the adjacent path re-runs the same
  batch (already closed → `not-found`, non-zero exit), and `--dry-run` writes the backup and nothing else.
- After deploy (operator, outside this PR): close the 7 triaged Neochrome reminders.

## Plan QA dispositions (round 1, Approved)

- Nit: log tags `[github-sync]`/`[lists-sync]` don't fit an API caller. **Disposition: Rejected (Out of Scope / Ponytail).** The `api-bulk:` reason already identifies API-originated closes, and a generic writer just to relabel logs is needless scope.
- Nit: tests should assert the exact `api-bulk:` reason passed to each writer. **Disposition: Accepted.**

## Rating (2026-10-27)

`rated 55/35/50/70` (pri/sev/appeal/effort), written with `releases_app.py roadmap rate` (ledger row
`rmi-01M5Z2SVMGNEZPKP53MDA7H8VQ`).
- sev 35: no data loss or crash. The cost is stale and duplicate reminders in digests and manual cleanup.
- pri 55: the operator has a batch of reminders waiting to close and asked for this now.
- appeal 50: neutral (no user score given).
- effort 70: one additive endpoint and a skill reusing existing writers. Needs a deploy before first use.
- Recurrence: unknown trend. No same-class incidents found in 2026-09-29..10-13 or 10-13..10-27;
  related #154.
