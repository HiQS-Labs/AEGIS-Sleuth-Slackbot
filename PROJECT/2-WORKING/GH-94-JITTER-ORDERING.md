---
title: "Jitter runs before the past-date rollover, so a past anchor lands on a random calendar day"
status: Marathon-ready (2-WORKING)
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: bugfix
gh_issue: 94
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/94
related: "GH-87 (hardened ApplyPresentationJitter's own invariants — this is the residual caller-ordering defect those invariants cannot see)"
effort: 2
complexity: 3
risk: 2
phases: 1
goal: >
  ApplyPresentationJitter runs at src/reminders-ai-pipeline.js:908, before the past-date rollover at
  :919. Its invariant 1 only guards anchors already at or after "now", so a PAST anchor is jittered
  freely and the jittered value then decides the +24h branch. An anchor within 45 minutes of now
  fires today or tomorrow depending on Math.random(). Move the jitter to run last, after the
  rollover and the too-soon push, so it can only perturb an already-settled date.
---

# GH-94 — jitter ordering vs the past-date rollover

## Status

| What was just completed | What's next |
|---|---|
| Issue filed and capture doc written; preflight verdicts **ready** (exit 0), marathon dry-run clean (2026-08-18). | Fire phase p1 of `MARATHON-2026-08-18-DEV-QA/MARATHON.yaml`. |

## Symptom

Trigger `this afternoon`. The model anchors 14:00 local. The message is posted at 14:30 local.

| jitter draw | jittered anchor | `< now`? | result |
|---|---|---|---|
| `+45` | 14:45 | no | fires **today** 14:45 |
| `-30` | 13:30 | yes | `+24h` → fires **tomorrow** 13:30 |

Identical input. `Math.random()` at `src/reminders-ai-pipeline.js:750` picks the calendar day.

## Why GH-87's invariants do not catch it

`ApplyPresentationJitter` guards the future→past direction only:

```js
// src/reminders-ai-pipeline.js:753
if(ArgAnchorDate.getTime() >= ArgCurrentUtcDate.getTime() && JitteredDate.getTime() < ArgCurrentUtcDate.getTime())
```

A past anchor never enters that branch. The function is internally correct; the defect is that its
output is consumed by a rollover decision eleven lines later. No test inside the function's own
contract can observe this.

## Scope

Requires the anchor to land within ±45 minutes of `now`, and only affects triggers **not** matched by
`ShouldKeepSameDayWhenPast` at `src/reminders-ai-pipeline.js:915` — those clamp to `now` rather than
rolling forward.

| trigger | exposed? |
|---|---|
| `morning`, `afternoon`, `noon`, `late afternoon` | yes |
| `this morning`, `tonight`, `later tonight`, `night`, `evening` | no — clamped to now |

## Fix

Move the `ApplyPresentationJitter` call from `:908` to after the too-soon push at `:938`, so the
order becomes: anchor → past-rollover → too-soon → jitter. Jitter then perturbs a date that is
already known to be in the future, and invariant 1's existing `>= now` guard becomes sufficient
rather than vacuous.

Rejected alternative: clamping invariant 1 symmetrically for past anchors. It leaves the
jitter-then-decide coupling in place, so the next change to the rollover logic re-opens the bug.

Watch: `wasAdjustedForward` is returned to the caller and must still reflect the rollover, not the
jitter. Moving the jitter after the rollover does not change that, but the test must pin it.

## Acceptance

- [ ] `ApplyPresentationJitter` is called **after** the past-date rollover and the too-soon push in `src/reminders-ai-pipeline.js` — final order: anchor → rollover → too-soon → jitter.
- [ ] A test exists that **fails against the current ordering**: an anchor within 45 minutes of a mocked `now`, with `Math.random()` stubbed to both extremes (`0` → −45 min, `~1` → +45 min), asserting the same local calendar day in both draws.
- [ ] The existing GH-87 property test still passes and is extended with a past anchor and a 00:15-local anchor — today every anchor it generates is local hour 08–22 with `CurrentUtc` five minutes before the anchor, so the past-anchor path never executes.
- [ ] `wasAdjustedForward` is true only when the rollover fired, never merely because jitter moved the date.
- [ ] `npm test` passes.


## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npm test",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/reminders-ai-pipeline.js", "pattern": "jitter is applied last" }
  ],
  "artifacts":   [
    "src/reminders-ai-pipeline.js",
    "tests/reminders-ai-pipeline.test.js"
  ],
  "remediation": { "source": "self#fix", "criteria": "GH-94 — jitter applied after the past-rollover and too-soon adjustments, pinned by a seeded two-extreme same-day test" },
  "lanes":       { "agy_safe": [ "src/reminders-ai-pipeline.js", "tests/reminders-ai-pipeline.test.js" ], "orchestrator_only": [] }
}
```

## Provenance

Found by an independent GLM 5.3 QA review of `development` at `11d9e4e`
(`relay-system/2026-08-18/consult-dev-qa-081115/glm-5.3.md`); the ordering confirmed by hand against
`src/reminders-ai-pipeline.js:908` and `:919` during adjudication.
