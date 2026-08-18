---
title: "Phase brief p1 — GH-94 jitter ordering"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "GH-94; parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Move ApplyPresentationJitter after the past-date rollover and the too-soon push.
---

# p1 — GH-94: apply presentation jitter AFTER the past-date rollover

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

Issue: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/94
Capture doc: `PROJECT/2-WORKING/GH-94-JITTER-ORDERING.md`

## The defect

`RemindersAIPipeline` calls `ApplyPresentationJitter` at `src/reminders-ai-pipeline.js:908`, then
applies the past-date rollover at `:919`.

`ApplyPresentationJitter`'s invariant 1 (`:753`) only guards anchors that are **already at or after
`now`**:

```js
if(ArgAnchorDate.getTime() >= ArgCurrentUtcDate.getTime() && JitteredDate.getTime() < ArgCurrentUtcDate.getTime())
```

A **past** anchor never enters that branch, so it is jittered freely — and the jittered value then
decides the `< now` branch at `:919`, which adds 24 hours.

Trigger `this afternoon`, anchor 14:00 local, message posted 14:30 local:

| jitter draw | jittered anchor | `< now`? | result |
|---|---|---|---|
| `+45` | 14:45 | no | fires **today** 14:45 |
| `-30` | 13:30 | yes | `+24h` → fires **tomorrow** 13:30 |

Same input; `Math.random()` picks the calendar day.

## What to change

Move the `ApplyPresentationJitter` call so it runs **after** the past-rollover block (`:919-933`)
and **after** the too-soon push (`:936-942`). Final order: anchor → rollover → too-soon → jitter.

Once jitter runs last, it only ever perturbs a date already known to be in the future, and invariant
1's existing `>= now` guard becomes load-bearing instead of vacuous.

Leave `ApplyPresentationJitter` itself alone unless a test proves it wrong — the function is
internally correct. This is a caller-ordering fix.

## Do NOT

- Do not clamp invariant 1 symmetrically for past anchors instead. That leaves the jitter-then-decide
  coupling in place, so the next change to the rollover logic re-opens the bug. It was considered
  and rejected in the issue.
- Do not change which triggers are fuzzy, or the ±45 minute window.
- Do not touch `ShouldKeepSameDayWhenPast` at `:915`.

## Must not regress

`wasAdjustedForward` is returned to the caller and must remain true **only** when the rollover
actually fired — not when jitter happened to move the date.

## Tests

Add to `tests/reminders-ai-pipeline.test.js`:

1. **The failing-today test.** An anchor within 45 minutes of a mocked `now`, with `Math.random()`
   stubbed to both extremes (`0` → −45 min, `0.999…` → +45 min). Assert the same **local calendar
   day** in both draws. Confirm this test fails against the current ordering before you fix it — if
   it passes on unmodified code it is not testing the defect.
2. **Extend the existing GH-87 property test.** Today every anchor it generates is local hour 08–22
   with `CurrentUtc` five minutes *before* the anchor, so the past-anchor path never executes. Add a
   past-anchor case and a 00:15-local anchor.
3. `wasAdjustedForward` still true only on rollover.

## Gate

`npm test` must pass. Phase-scoped check while iterating:
`npx jest reminders-ai-pipeline --forceExit`
