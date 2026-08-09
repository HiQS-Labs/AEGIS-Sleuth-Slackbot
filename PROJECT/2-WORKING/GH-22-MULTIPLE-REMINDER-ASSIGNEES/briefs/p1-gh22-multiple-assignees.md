# p1 — GH-22: multiple assignees for one reminder

Release 1.4.270 "Roundup" · issue [#22] · plan:
`PROJECT/2-WORKING/GH-22-MULTIPLE-REMINDER-ASSIGNEES.md` (read it in full first — it is the
authority, this brief is the execution frame)

## The defect

A reminder naming two people is persisted and indexed for the **first mention only**, while its
confirmation message claims it was scheduled for **both**. The second person's `show-me` therefore
silently omits it. The user is told something happened that did not.

This is the only user-visible defect in the release. It goes first so that if the marathon halts
early, the thing users actually feel is already fixed.

## Shape of the fix

Per the plan doc: one **shared** reminder carrying additive `AssigneeIDs`, with legacy `AssigneeID`
retained for compatibility, membership-aware views/exports, and per-user Slack List fan-out.

Read the plan doc for the full design. Do not redesign it here.

## The constraint that dominates this phase

**`AssigneeID` is persisted on disk in every existing workspace's reminder store.** This is a
disk-format change on live data, so:

- `AssigneeIDs` is **additive**. Never remove or stop writing `AssigneeID`.
- A reminder written by the old code must load correctly under the new code — `AssigneeID` alone
  implies `AssigneeIDs: [AssigneeID]`.
- A reminder written by the new code must not crash the old code — keep `AssigneeID` populated with
  the first assignee.
- `AGENTS.md` §10 requires compatibility/backfill logic for disk-persisted data changes. This is
  exactly that case.

## Do not change the SINGLE-assignee confirmation copy

Observed on the 2026-08-07 run: the builder rewrote the confirmation to
`"... has been scheduled as shared work for <@U>."` for **every** reminder, including
single-assignee ones, and `tests/reminders-integration.test.js` failed because it still asserts the
existing wording.

That test is **correct and must not be edited to match the new string.** GH-22 asks for multi-assignee
support; it does not ask to reword the single-assignee case, and "as shared work" reads wrong for one
person. If a reminder has exactly one assignee, its confirmation must be byte-identical to today's.

New wording is allowed **only** on the multi-assignee path, and only where a test asserts it
deliberately. If you believe the single-assignee copy must change, HALT and say so rather than
editing the existing assertion — that is a product decision, not a test fix.

## The FSM constraint

Reminder state changes go through the three named write chokepoints
(`#MakeScheduledReminder`, `#TryScheduleRemindersAsync`, `#TransitionReminderState`) and are
mechanically checked by `scripts/validate-fsm-invariants.js`. Do not add a fourth write path.
Run `npm run validate:fsm` as well as the suite.

## Event-log consequence

`ReminderCreated` events carry assignee identity, and the P3 projection folds them. If the event
payload gains `AssigneeIDs`, old events still have only `AssigneeID` — the fold must handle both, or
historical summarize-week output changes silently. Check `src/summarize-week-projection.js` before
declaring done.

## Done when

- `tests/reminders-multiple-assignees.test.js` covers: two-assignee create; **both** users'
  `show-me` returning it; the confirmation text matching what was actually persisted; a legacy
  single-`AssigneeID` reminder loading correctly; per-user Slack List fan-out; and completion by one
  assignee behaving per the plan doc.
- A regression test that **fails against current code** for the original symptom — the second user's
  `show-me` omitting the reminder. If it passes before the fix, it is not testing the bug.
- `npm test` green (baseline 1513/93), `npm run build` clean, `npm run validate:fsm` clean.

## Out of scope

Anything in GH-25 or GH-26 — those are p2 and p3. No refactor of the reminder module beyond what
multiple assignees requires.
