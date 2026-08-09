---
title: "Prevent incidental thread replies from duplicating an existing reminder"
status: Completed (3-COMPLETED) — shipped to development via PR #28 (squash 5a148c7); issue #27 closed
created: 2026-08-07
updated: 2026-08-07
owner: noel
branch: fix/gh-27-thread-reminder-dedupe
doc_type: bugfix
gh_issue: 27
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/27
related: "GH-424 thread-context synthesis; GH-12 durable reminder persistence"
context_tags: [reminders, thread-replies, deduplication, production-regression]
effort: 2
complexity: 3
risk: 2
phases: 2
goal: >
  Prevent an incidental temporal phrase in a thread reply from creating a second reminder for the
  same thread task, while retaining legitimate, distinct follow-up reminders.
---

# GH-27 — Thread-reply reminder deduplication

## Status

| What was just completed | What's next |
|---|---|
| Shipped. Scoped same-thread semantic deduplication plus production-shaped unit/integration regressions landed on `development` as squash commit `5a148c7` (PR #28, CI green); issue #27 closed. Review also caught that reviving the dormant semantic path let an AI verdict override force-scheduling — closed by tagging each dedup exit with `matched_by` and gating the force branch on `'message_id'`, with two regression tests. Full suite green: 1,518 Jest + 33 Node, typecheck clean. | None — work is delivered and the issue is closed. |

## Table of contents

- [Production evidence and root cause](#production-evidence-and-root-cause)
- [Scope and decision](#scope-and-decision)
- [Phase 1 — Repair same-thread duplicate detection](#phase-1--repair-same-thread-duplicate-detection)
- [Phase 2 — Regression verification and handoff](#phase-2--regression-verification-and-handoff)
- [Progress log](#progress-log)

## Production evidence and root cause

The `neochrome` queue contains two active records for “Post some screenshots” in the same Slack
thread:

| Created (PDT) | Source message | Thread root | Due (PDT) | Reminder ID |
|---|---|---|---|---|
| 11:02 | `1786125725.780189` | none (root) | 2:02 | `1e9e0cdc-c788-490d-abba-31f72732480d` |
| 11:27 | `1786127250.350799` | `1786125725.780189` | 2:27 | `bd3709ee-2385-40a2-97d2-901d05177bb5` |

The second reply used “today” incidentally. That passes the broad temporal gate in
`src/reminders-app-mention-handler.js`, so `RemindersModule#OnMessageAsync` sends the reply into
the normal AI scheduler. The second record has a fresh `OriginalMessageID`, so
`RemindersAIPipeline#CheckForDuplicateReminderAsync` does not see the fast exact-ID duplicate.
It then returns `schedule` immediately, leaving the intended semantic comparison unreachable.

## Scope and decision

Keep the inexpensive exact-message-ID rejection. For a different message ID, derive each
reminder's thread identity as `OriginalThreadTs ?? OriginalMessageID`. Only when an existing open
reminder shares that identity will the existing semantic deduplication prompt run. It receives the
same-thread candidates and must distinguish the same task from an explicitly distinct follow-up.

This is intentionally scoped: unrelated threads retain the current zero-extra-AI-call path, and a
thread can still schedule multiple genuinely different tasks. No FSM write path, delivery retry,
or persistence shape changes.

## Phase 1 — Repair same-thread duplicate detection

- [x] Add a small deterministic thread-identity helper to `src/reminders-ai-pipeline.js`.
- [x] Preserve the exact `OriginalMessageID` fast rejection.
- [x] Replace the erroneous early `schedule` return with a same-thread candidate filter; return
      immediately only when no matching thread candidate exists.
- [x] Invoke the existing semantic deduplication request for matching-thread candidates, with
      explicit prompt context that `schedule` is valid only for a distinct task.
- [x] Preserve the force-schedule escape hatch: semantic duplicate judgments are bypassed, while
      the exact `OriginalMessageID` guard remains enforced.
- [x] Add unit coverage for root/reply identity matching, same-thread semantic rejection, and a
      distinct task in the same thread being allowed.

### QA gate — Phase 1

- [x] The production-shaped root/reply pair calls semantic deduplication and rejects the second
      “Post some screenshots” reminder.
- [x] A distinct reminder from a later reply in the same thread is allowed.
- [x] Reminders from different threads with different message IDs do not trigger an extra AI call.
- [x] Exact same-message-ID behavior remains unchanged.
- [x] Force scheduling bypasses only semantic duplicate judgments, never exact-message duplicates.

## Phase 2 — Regression verification and handoff

- [x] Add an integration-level thread-reply regression through `MockSlackApp`, asserting the later
      reply leaves one persisted reminder and posts no second scheduling confirmation.
- [x] Verify vague-reference/enriched-thread scheduling still allows a distinct follow-up task.
- [x] Run the repository suite and PDDA checks; typecheck, focused tests, FSM/workspace-isolation/
      reminder-render guards, and prompt validation have passed.
- [x] Update this document's status/progress and `CHANGELOG.md`; do not modify `package.json`.

### QA gate — Phase 2

- [x] The production failure mode cannot create a second reminder or confirmation.
- [x] Existing legitimate thread follow-ups retain their scheduling behavior.
- [x] `npm run build && npm test` passes.
- [x] `utils/pdda/pdda.sh` targeted checks report no GH-27 document errors.

## Progress log

- 2026-08-07: GH-27 created from production evidence after a root message at 11:02 and a reply at
  11:27 scheduled the same task for 2:02 and 2:27 respectively.
- 2026-08-07: Created this isolated worktree from `origin/development`; confirmed that the
  exact-ID fast path masks semantic deduplication for every different message ID.
- 2026-08-07: Implemented `OriginalThreadTs ?? OriginalMessageID` identity matching. Exact-message
  rejection remains deterministic; only matching-thread candidates enter the semantic prompt.
  Added unit coverage for duplicate, distinct follow-up, unrelated-thread, and exact-ID cases plus
  a production-shaped MockSlackApp regression using the observed root/reply timestamps.
- 2026-08-07: Passed `npm run build`, `npx jest --runInBand --forceExit
  tests/reminders-ai-pipeline.test.js tests/reminders-integration.test.js` (100 tests),
  `npm run validate:ai`, and the FSM/workspace-isolation/reminder-render guards.
- 2026-08-07: Passed `npm test` (1,518 Jest + 33 Node tests). PDDA's working-document checks
  report zero errors for this document and its roadmap pointer. The aggregate PDDA run continues
  to report a pre-existing malformed `RELEASES.md` block and unavailable cached issue states; those
  files are outside GH-27's scope.
- 2026-08-07: Review follow-up found that the restored semantic path could otherwise veto an
  explicit force-schedule action. Added a `matched_by` result discriminator: force scheduling
  bypasses `semantic` judgments but retains the legacy `message_id` rejection. The integration
  suite now drives both force-schedule outcomes through the alarm-clock reaction path.
- 2026-08-07: Delivered. PR #28 merged into `development` as squash commit `5a148c7` with CI
  `test` green. Re-verified post-merge on the branch worktree: `npm run build` clean and the full
  suite green at 1,518 Jest + 33 Node. Note for future runs — a sandboxed `npm test` reports 19
  false failures (`listen EPERM ... 0.0.0.0`) in the web-api suites; those are socket-bind
  restrictions, not defects. Issue #27 closed. Document moved to `PROJECT/3-COMPLETED/`.
