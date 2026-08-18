# Marathon Phase p1
STATUS: Approved
NEXT: codex (Reviewer)

<!-- marathon-drive: task=MARATHON-P1-TURN builder=agy reviewer=codex round-cap=7 -->

## Phase Brief

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


---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/reminders-ai-pipeline.js,tests/reminders-ai-pipeline.test.js
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): .xyz/bin/tick
   - .xyz/bin/tick claim MARATHON-P1-TURN --agent agy --paths "marathon-system/dev-qa-2026-08-18--p1/RELAY.md,src/reminders-ai-pipeline.js,tests/reminders-ai-pipeline.test.js"
   - .xyz/bin/tick ping MARATHON-P1-TURN --agent agy
   - .xyz/bin/tick release MARATHON-P1-TURN --agent agy --to codex
4. Edit ONLY these paths: marathon-system/dev-qa-2026-08-18--p1/RELAY.md and src/reminders-ai-pipeline.js,tests/reminders-ai-pipeline.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

### Round 1 · Builder · agy
- Moved the `ApplyPresentationJitter` block to the end of `ExtractDateWithGptAsync` so it runs after past-rollover and too-soon pushes.
- Modified `ApplyPresentationJitter` call to pass `FutureDateThatIsNotTooSoon` instead of `CurrentUtcDate` to preserve the `too-soon` scheduling invariant when negative jitter is applied.
- Updated `tests/reminders-ai-pipeline.test.js`:
  - Added the "failing-today test" validating that `this afternoon` on the same day works regardless of jitter extreme.
  - Asserted `wasAdjustedForward` remains `true` only when the underlying anchor legitimately rolls over.
  - Updated the GH-87 property test to use a `00:15` local anchor and multiple offsets (`CurrentOffsets`) to test both future and past anchors natively.
  - Added `Math.random` mocking for the GH-87 `tonight` test to guarantee deterministic behavior.

### Round 1 · Reviewer · codex
swept file: yes

**Verdict:** Changes requested

- The required failing-today regression is not covered. The two-extremes test uses a future 14:30 anchor at a 14:00 `now`, so the old jitter-before-rollover order passes both draws. The past-anchor test uses only the positive draw. Add one test with `now` at 14:30 and an anchor at 14:00, run both `Math.random()` extremes, and assert both results are on the same (tomorrow) local calendar day and retain `wasAdjustedForward: true`; it must fail under the old ordering.
- The new 00:15 GH-87 property case is labeled `midnight`, but `ApplyPresentationJitter` does not recognize `midnight` as a fuzzy trigger, so every draw returns the anchor and never tests boundary jitter. Use a recognized fuzzy phrase for that 00:15 anchor (or separately assert that `midnight` intentionally does not jitter) so the property exercises the intended local-day clamp.

No additional pre-existing defects found during the full-file sweep. Phase-scoped test command completed successfully: `npx jest reminders-ai-pipeline --forceExit`.

### Round 2 · Builder · agy
- Updated the GH-94 failing-today regression test to use a past anchor (now 14:30, anchor 14:00) so that it properly tests the rollover logic and fails under the old jitter-before-rollover ordering.
- Updated the GH-87 property test to use `night` instead of `midnight` so that the anchor boundary is recognized as a fuzzy trigger by `ApplyPresentationJitter` and exercises the expected local-day clamp.

### Round 2 · Reviewer · codex
swept file: yes

**Verdict:** Approved

- Confirmed the reordered call applies jitter only after rollover and the too-soon adjustment, while preserving the existing local-day and not-before scheduling safeguards.
- The GH-94 regression now uses a past 14:00 anchor at a mocked 14:30 local time and both jitter extremes; it distinguishes the old split-day behavior from the corrected tomorrow-only result and verifies `wasAdjustedForward`.
- The GH-87 property sweep now includes a recognized fuzzy `night` anchor at 00:15 and exercises both future and past reference times across every discrete jitter value.
- No additional pre-existing defects found during the full-file sweep of `src/reminders-ai-pipeline.js` and `tests/reminders-ai-pipeline.test.js`.
- Verified: `npx jest reminders-ai-pipeline --forceExit` completed successfully.

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/reminders-ai-pipeline.js,tests/reminders-ai-pipeline.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: .xyz/bin/tick release MARATHON-P1-TURN --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: .xyz/bin/tick done MARATHON-P1-TURN --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: .xyz/bin/tick
   Edit ONLY marathon-system/dev-qa-2026-08-18--p1/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
4b. TO VERIFY A FINDING, WRITE PROBE FILES OUTSIDE THE REPO — under $TMPDIR, never inside the
   working tree. Creating even one scratch file in the repo is an off-lane write: containment
   reverts it and FAILS YOUR WHOLE TURN, discarding the review you just did (GH-441). Observed
   2026-08-08: a reviewer found a real latent crash, wrote two probe files in-tree to demonstrate
   it, and lost the turn for doing so — the finding survived only because RELAY.md happens to be
   on your allowlist. `cp` what you need to "$TMPDIR/probe.$$/" and work there instead. Verifying
   is wanted; verifying in-tree is what costs you the turn.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to agy —
   agy, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
