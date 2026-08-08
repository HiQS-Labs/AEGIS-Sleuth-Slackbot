---
title: "Support multiple assignees for one reminder"
status: Active (2-WORKING) — implementation complete, all gates green; awaiting PR merge into development
created: 2026-08-07
updated: 2026-08-08
owner: noel
branch: development
doc_type: feature
gh_issue: 22
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/22
related: "GH-338 show-me reactable output; GH-391 canonical reminder renderer; GH-12 durable reminder persistence"
context_tags: [reminders, assignments, persistence, show-me, slack-lists]
non_goals: "Per-assignee completion state, separate reminders per assignee, and new natural-language assignment grammar."
effort: 3
complexity: 4
risk: 3
phases: 4
goal: >
  Make one reminder safely visible and actionable for every explicitly assigned Slack user, while
  preserving legacy single-assignee data, existing lifecycle semantics, tenant isolation, and
  external read compatibility.
---

# GH-22 — Multiple reminder assignees

## Status

| What was just completed | What's next |
|---|---|
| **Implementation complete; all three gates green.** The marathon's p1 lane built the additive `AssigneeIDs` contract (authoritative array + legacy `AssigneeID` mirror + load-time normalization via `#NormalizeReminderAssignees`), multi-mention scheduling, per-assignee display, and per-user Slack List fan-out — but escalated on `timeout-gate-failed` before the reviewer's requested changes were made, leaving the actual reported bug unfixed. Finished by hand 2026-08-08: (1) `src/chat-commands/show-me-context.js` still filtered with the singular `AssigneeID === userId` compare, which only ever matched the FIRST assignee — that IS the reported symptom, and it was outside the marathon's declared artifact paths, so no lane could touch it. It now resolves membership through the canonical `RemindersModule.IsAssignedTo` helper (deferred require — a top-level import would close a `reminders-module → connection-surfacing → reminder-clustering → show-me-projects-command` cycle). (2) The two tests the reviewer asked for: a second-assignee `show-me` regression and a completion-clears-every-view test, **both verified to FAIL against the pre-fix code** before being accepted. (3) The single-assignee confirmation copy was restored — the builder had reworded *every* reminder to "scheduled as shared work for", which the brief explicitly forbids; "as shared work" is now multi-assignee-only. (4) Four `tsc` errors in the new code fixed. Gates: `npm test` 94/94 suites · 1524/1524 Jest · 33/33 Node; `npm run validate:fsm` OK (no fourth write path); `npm run build` exit 0. Event-log compatibility verified: `FoldReminders` reads only singular `assigneeId`, which is still emitted alongside the additive `assigneeIds`, so historical `summarize-week` output is unchanged. | Land PR into `development` and close issue #22. Per-assignee completion state remains an explicit non-goal — one reminder, one lifecycle. |

## Quad Concepts

- One message can name several people → persist one shared reminder with every human assignee.
- Legacy `AssigneeID` data must remain readable → add an additive authoritative `AssigneeIDs` array and normalize on load.
- A task must appear in every assignee's work view → index and filter by membership, then fan it out to registered per-user lists.
- One task must retain one lifecycle → completion/cancel/reactions act on the shared reminder and clear every view.

## Table of contents

- [Context and confirmed mechanics](#context-and-confirmed-mechanics)
- [Delivery contract](#delivery-contract)
- [Not in scope](#not-in-scope)
- [Phase 1 — Establish the compatible multi-assignee contract](#phase-1--establish-the-compatible-multi-assignee-contract)
- [Phase 2 — Create and persist shared reminders correctly](#phase-2--create-and-persist-shared-reminders-correctly)
- [Phase 3 — Make every read and list surface membership-aware](#phase-3--make-every-read-and-list-surface-membership-aware)
- [Phase 4 — Verify compatibility and deploy safely](#phase-4--verify-compatibility-and-deploy-safely)
- [Verification matrix](#verification-matrix)
- [Rollback and migration posture](#rollback-and-migration-posture)
- [Progress log](#progress-log)

## Context and confirmed mechanics

The reported Slack message named `@jsumuano` and `@Matthew Taylor`, but `show-me @Matthew Taylor`
reported exactly three open reminders and omitted the new task. This is deterministic, not an AI
ranking omission:

- `src/reminders-module.js:1495-1511` extracts one `AssigneeID`; the extractor at
  `src/reminders-module.js:1815-1879` deliberately returns the **first** human mention.
- The confirmation at `src/reminders-module.js:1768-1781` lists every mentioned user, so it says a
  task was scheduled “for” multiple users even though the stored record has one assignee.
- `src/chat-commands/show-me-context.js:128-132` admits only reminders whose `AssigneeID` equals
  the requested person. The screenshot's “Reviewing 3 open reminders” confirms this filter ran
  before ranking; the task was not merely fourth place.
- `RemindersModule` maintains `#RemindersByAssignee` for user-targeted commands and digests
  (`src/reminders-module.js:1230-1259`, `3368-3460`). Both its live queue and its load-time rebuild
  currently index one key.
- Slack Lists has the same one-user assumption: `src/lists-module.js:1239-1268` mirrors a reminder
  to the shared list and one registered assignee list. Its per-list `ItemCache` is already keyed by
  reminder ID, so a single reminder can safely have one row in each separate user context once the
  fan-out is explicit.
- The public/export consumers currently expose a singular assignee:
  `src/web-api.js:441`, `src/reminder-query-engine.js:183`,
  `deploy/reminders-export/events-projection.js`, `deploy/reminders-export/completions-payload.js`,
  and `mcp/lib/reminders-store.mjs`. The change must be additive at these boundaries.

## Delivery contract

The implementation will use one shared `ReminderInfo` record, not cloned reminders.

1. Add `AssigneeIDs: string[]` as the authoritative ordered, de-duplicated set of human Slack user
   IDs. Exclude the bot ID; use `[OriginalSenderID]` only when no eligible human mention was found,
   preserving today's fallback behavior.
2. Retain `AssigneeID` as a deprecated compatibility mirror equal to `AssigneeIDs[0]`. Existing
   callers, runtime JSON, exports, and a rolled-back older binary therefore continue to receive the
   current first-assignee value instead of failing on a schema change.
3. Centralize normalization and membership in small helpers in `src/reminders-module.js` (the owner
   of the persisted `ReminderInfo` contract): normalize new and legacy records, derive the
   assignee set, and test whether a user is assigned. Do not make every consumer independently
   interpret two fields.
4. On load, a legacy record with only `AssigneeID` normalizes to `AssigneeIDs: [AssigneeID]`; a
   record with neither retains the current sender fallback. If an old record has both fields but
   disagrees, the normalized non-empty array wins and the compatibility mirror is repaired. The
   ordinary durable save writes the upgraded shape.
5. “Shared” means one lifecycle: a completion, cancellation, snooze, retry, or reaction applies to
   the one reminder and is reflected in every assignee's `show-me` and Slack List view. Per-person
   completion state is deliberately not introduced.
6. New API, MCP, export, and event payload fields are additive `assigneeIds`; existing singular
   `assigneeId` stays populated from the compatibility mirror until a separately approved API
   versioning decision removes it.

## Not in scope

- Separate copies of one task, independent due dates, or per-assignee completion/cancellation.
- Reinterpreting arbitrary FYI mentions. This work preserves the scheduler's existing explicit
  Slack-mention assignment convention; improving intent detection needs separate product evidence.
- Changing reminder scheduling, deduplication, snooze, AI-provider, or workspace-isolation
  contracts except where membership data must pass through them.
- A database migration. The current workspace-scoped JSON store remains authoritative.

## Phase 1 — Establish the compatible multi-assignee contract

- [ ] Extend the `ReminderInfo` JSDoc in `src/reminders-module.js` with `AssigneeIDs`, documenting
      its authority and `AssigneeID` as the legacy compatibility mirror.
- [ ] Add focused, local helpers in `RemindersModule` to normalize a reminder's assignee set and
      check membership. Keep them deterministic, null-safe, de-duplicating, and bot-aware.
- [ ] Update `#LoadRemindersAsync` to normalize every legacy/current record before rebuilding
      indexes; record an update only when persisted values change, then reuse the existing durable
      save chain.
- [ ] Update `#BuildReminderIndexes` and `#QueueReminderAsync` to put one shared reminder into the
      assignee index under every normalized assignee exactly once.
- [ ] Retain the sender index and all FSM creation/transition gateways unchanged. No inline
      `ReminderInfo` object may bypass `#MakeScheduledReminder`.

### QA gate — Phase 1

- [ ] Legacy JSON with only `AssigneeID` reloads as one normalized assignee and keeps the same
      visible behavior.
- [ ] A multi-assignee record reloads with stable order, no duplicate index entries, and its first
      ID mirrored to `AssigneeID`.
- [ ] Missing/invalid/only-bot assignment data falls back safely to the original sender and never
      creates a bot-assignee index entry.
- [ ] `npm run build`, `npm run validate:fsm`, and the focused reminders-module/durability tests
      pass.

## Phase 2 — Create and persist shared reminders correctly

- [ ] Replace the first-mention-only extraction in `#ExtractAssigneeFromReminderText` with an
      ordered, de-duplicated human-assignee extraction. Keep its source text boundary (quoted
      original message before `Key task(s):`) so synthesized task text cannot change assignment.
- [ ] In `#TryScheduleRemindersAsync`, derive the full assignee set once, pass both compatible
      fields through `#MakeScheduledReminder`, and persist one shared record per trigger group.
- [ ] Update `#ComposeFeedbackMessageText` to render the normalized assignee set and say that the
      reminder is shared/assigned to those users. It must never claim that every arbitrary mention
      is a separate task or independent reminder.
- [ ] Audit the list-row creation path (`CreateReminderFromListRowAsync`) and imports so their
      single `assigneeID` input produces a one-element `AssigneeIDs` set; do not silently broaden
      a manually authored one-person row.
- [ ] Update lifecycle-event emission and event schema validation additively with `assigneeIds`,
      retaining `assigneeId` for compatibility. Ensure each event still represents one reminder,
      not one event per assignee.

### QA gate — Phase 2

- [ ] Scheduling a message with two human mentions creates exactly one reminder with both IDs,
      exactly one confirmation, and no bot/duplicate ID.
- [ ] The confirmation names both assignees and accurately describes one shared task.
- [ ] A one-person task and a task with no explicit assignee retain their current sender fallback.
- [ ] Forced scheduling, AI deduplication, original-message metadata, snooze initialization, and
      FSM state creation remain unchanged.
- [ ] `npm run build`, `npm run validate:fsm`, `npm run validate:workspace-isolation`, and focused
      reminder integration/event-emission tests pass.

## Phase 3 — Make every read and list surface membership-aware

- [ ] Update `show-me` and `show-me-projects` shared filtering to use the canonical membership
      helper rather than direct `AssigneeID === userId` comparison; both assignees must see the
      same reminder ID and lifecycle state.
- [ ] Update `RemindersAppMentionHandler` dependencies, targeted/involving reminder views, daily
      digest candidate construction, and reminder-display tagging to use normalized membership.
      Where output has room for only one assignee, retain the compatibility mirror; where the UI
      is describing owners, render the full set.
- [ ] Fan one reminder out from `ListsModule` to every registered assignee context while retaining
      one row in the shared list. Verify cache keys, completion/cancellation cleanup, and list-row
      adoption work across all mirrored rows without duplicating the shared reminder.
- [ ] Extend `src/reminder-query-engine.js`, `src/web-api.js`,
      `deploy/reminders-export/`, and `mcp/lib/reminders-store.mjs` additively: membership queries
      use `assigneeIds`; old clients continue to receive `assigneeId`.
- [ ] Update `docs/web-api.md` and the relevant reminder/export architecture inventory with the
      additive field contract and legacy behavior. Do not alter unrelated API payloads.

### QA gate — Phase 3

- [ ] `show-me @A` and `show-me @B` each include the same shared reminder; unrelated `@C` does
      not. The active-state filter still excludes completed/canceled items.
- [ ] User-targeted reminder commands, search/involvement views, digest construction, and
      `show-me-projects` have regression coverage for shared and legacy records.
- [ ] A registered List for each assignee receives one row for the shared reminder; completing or
      canceling it removes/updates every corresponding row exactly once.
- [ ] Web API, local MCP read path, and reminder export expose the array without removing or
      changing the existing singular field; their tests pass.
- [ ] `npm run build`, targeted show-me/lists/web-API/MCP tests, `npm run validate:reminder-render`,
      and `npm run validate:commands` pass.

## Phase 4 — Verify compatibility and deploy safely

- [ ] Run the full verification suite and inspect the JSON serialization of representative legacy,
      single-assignee, and two-assignee records.
- [ ] In a test Slack workspace, create a task mentioning two people; run `show-me` for each,
      check the shared and per-user Lists, then complete the task from one rendered reminder and
      confirm it clears from both views.
- [ ] Perform the same single-user scheduling and completion flow to prove no regression.
- [ ] Review logs for workspace name, reminder ID, normalized assignee count, and lifecycle errors;
      do not log raw reminder text beyond existing logging policy.
- [ ] Update `CHANGELOG.md` with the user-visible behavior, compatibility posture, and tests. Do
      not change `package.json` version in this feature work.

### QA gate — Phase 4

- [ ] `npm run build && npm test` passes, including FSM/workspace-isolation/reminder-render guards.
- [ ] `npm run validate:ai` is not required unless AI assets change; record its result if the
      implementation changes any prompt/schema.
- [ ] Manual two-assignee and single-assignee Slack smoke tests pass in an isolated workspace.
- [ ] Updated docs pass `utils/pdda/pdda.sh run`; the GitHub issue and this plan have current status.

## Verification matrix

| Scenario | Expected result | Primary coverage |
|---|---|---|
| Legacy record with `AssigneeID` only | Loads as `[AssigneeID]`; old views unchanged | reminders module/durability tests |
| One explicit assignee | One shared record and one visible owner | reminder integration + show-me tests |
| Two explicit assignees | One reminder ID; both users see it | reminder integration + show-me tests |
| Duplicate mention / bot mention | Each human appears once; bot never assigned | reminders module tests |
| No eligible mention | Sender fallback remains visible | reminders integration tests |
| Complete/cancel from any rendered view | One lifecycle change clears every owner/list view | reaction + lists tests |
| Registered per-user Lists | Shared list has one row; each assignee list has one row | lists-module tests |
| Web/API/MCP/export consumer | Adds `assigneeIds`, retains stable `assigneeId` | web API, MCP, export tests |
| Old-binary rollback | Reads compatibility `AssigneeID`; ignores added array safely | serialization inspection + rollback review |

## Rollback and migration posture

No one-off migration command is needed. Existing startup normalization already performs compatible
backfills and persists through the durable reminder write path. The new field is additive, and its
legacy compatibility mirror remains populated. An older deployed binary ignores `AssigneeIDs` and
continues to operate on `AssigneeID`; it will temporarily show a shared reminder only to its first
assignee, but it will neither lose the other IDs nor corrupt the record. Rollback is therefore
costly only in user experience, not a persistence one-way door.

Before deploy, retain the normal workspace JSON backup. If a live defect requires rollback, deploy
the previous binary without rewriting the reminders file; investigate and forward-fix from the
preserved additive data rather than deleting the new field.

## Progress log

- 2026-08-07: Reported production-like symptom: a task mentioning `@jsumuano` and `@Matthew
  Taylor` did not appear in Matthew's `show-me` result. Confirmed the first-mention-only assignment
  and all-mentions confirmation mismatch, then opened GH-22.
- 2026-08-07: Promoted GH-22 directly to `2-WORKING` at the user's request for a full execution
  plan. Recorded an additive shared-reminder design to protect existing JSON, export, API, MCP,
  Lists, and rollback consumers before implementation begins.

## Acceptance

The first four are copied verbatim from issue #22; the rest are additions declared below.

- [ ] A reminder mentioning two intended assignees appears in both users' `show-me` results.
- [ ] A single-assignee and legacy reminder retain their existing behavior.
- [ ] Tests cover multi-assignee creation, `show-me` filtering, persistence reload, and confirmation text.
- [ ] `npm run build` and relevant reminder/show-me tests pass.
- [ ] The confirmation message names exactly the users actually scheduled.
- [ ] A reminder written by the new code remains readable by code that knows only `AssigneeID`.
- [ ] Per-user Slack List fan-out reflects every assignee.
- [ ] A regression test exists that fails against pre-fix code for the original symptom.
- [ ] `npm test` and `npm run validate:fsm` are green.

## Acceptance — deviations from the issue

- [added] The confirmation message names exactly the users actually scheduled. — reason: the reported symptom is a mismatch between the confirmation and what was persisted; without this the bug can be "fixed" while the misleading message survives.
- [added] A reminder written by the new code remains readable by code that knows only `AssigneeID`. — reason: `AssigneeID` is on disk in every live workspace, so the change must be backward and forward compatible to permit rollback.
- [added] Per-user Slack List fan-out reflects every assignee. — reason: named in the plan doc's design and in the issue's goals, but absent from its acceptance list.
- [added] A regression test exists that fails against pre-fix code for the original symptom. — reason: the issue asks for test coverage but not for a test that demonstrably reproduces the bug; a test written after the fix can pass without ever having exercised it.
- [added] `npm test` and `npm run validate:fsm` are green. — reason: the issue names only `npm run build` and the reminder tests, but reminder writes go through FSM chokepoints checked by `scripts/validate-fsm-invariants.js`, so the FSM gate is load-bearing here.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npm test",
  "fix_probes":  [ { "type": "path_absent", "path": "tests/reminders-multiple-assignees.test.js" } ],
  "artifacts":   [
    "src/reminders-module.js",
    "src/reminders-display-utils.js",
    "src/lists-module.js"
  ]
}
```

`ref` is `development`, not `main` — `development` is the primary branch (see `CONTRIBUTING.md` ->
"Branches"). `gate` is `npm test` because this repo has no root-level `validate.sh`, which is the
harness default.

`artifacts[]` lists only files that **already exist** at `target.ref`; preflight verifies each one is
present and fails the candidate otherwise. The new regression test is therefore *not* an artifact —
it is the `fix_probe`. `path_absent` on `tests/reminders-multiple-assignees.test.js` flips exactly
when the fix ships with its regression test, and not before.
