---
title: "Span-ratio rounding hides the most deeply buried tasks; the wider zero-span population is a separate cause"
status: Active (2-WORKING) — rounding defect fixed on gh-51-span-ratio-precision; PR open. Issue #51 stays OPEN for the empty-span majority.
created: 2026-08-11
updated: 2026-08-11
owner: noel
goal: "Make the buried-task gate decide on the measurement rather than on its rounded report, and establish with evidence how much of the production zero-span population that actually explains."
branch: gh-51-span-ratio-precision
doc_type: bugfix
gh_issue: 51
release: 1.4.280 ("Grounding")
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/51
related: "Blocked on GH-50 for the remaining ~127 cases — diagnosing an empty actionable_language needs input→output pairs. Fixes a defect in the GH-43 buried-task gate."
context_tags: [synthesis-routing, extraction-fidelity, telemetry, precision]
---

# GH-51 — decide on the raw span ratio, not its rounded report

## Status

| What was just completed | What's next |
|---|---|
| Rounding defect found, proven, fixed, and mutation-tested. 3 new regression tests; 1852 jest / 116 node / build 0. Quantified against 30 days of production telemetry. | **Issue #51 stays open.** The fix explains ~1 of the 128 zero-span messages; the other ~127 are a genuinely empty `actionable_language` and need the GH-50 corpus to diagnose. |

## The defect

`DescribeSynthesisRouting` rounded the actionable-span ratio *before* the gate read it:

```js
const ActionableSpanRatio = Math.min(1, Number((LongestSpan / Original.length).toFixed(2)));
const SpanRatioUsable = !ArgOptions?.SyntheticActionableSpan && ActionableSpanRatio > 0;
```

`toFixed(2)` collapses any span under **0.5%** of the message to exactly `0`. The usability gate then
read that `0` as *"no span was quoted at all"* and refused to claim a buried task.

So a 35-character commitment quoted verbatim out of a 7,000-character status note — the most deeply
buried task there is, and precisely the case the gate exists to catch — was classified as having no
evidence of a buried task. **The gate failed hardest exactly where it mattered most.**

Proven before fixing:

```
message length : 7026     quoted span : 35 chars
true ratio     : 0.004981
reported ratio : 0            <- toFixed(2)
spanRatioUsable: false        <- gate read the rounded value
routedBy       : sentence_count
```

## Quad Concepts

- **Round for humans, decide on the measurement.** A display precision became a control-flow input.
  The reported value stays 2dp for telemetry readability; every decision now uses the raw ratio.
- **"Was anything quoted" is a question about the span, not about its ratio.** Asking `LongestSpan > 0`
  cannot be defeated by precision, whereas asking `ratio > 0` always could.
- **A threshold should mean what it says.** Comparing the rounded value silently admitted up to
  0.3549… against a 0.35 ceiling.
- **Measure the fix's reach before claiming it.** The obvious story — "this explains the 60% zero-span
  population" — is false, and the telemetry says so.

## What shipped

`src/reminders-ai-pipeline.js`, `DescribeSynthesisRouting` only:

- `RawSpanRatio` (unrounded) is computed once and drives both decisions.
- `ActionableSpanRatio` remains the 2dp **reported** value, so the telemetry format is unchanged.
- `SpanRatioUsable` now asks `LongestSpan > 0` — the measurement, not the report.
- The `BURIED_TASK_MAX_SPAN_RATIO` ceiling is compared against `RawSpanRatio`.

No prompt, schema, model, or telemetry-format change. `ratio_usable=` already existed in the log line;
this makes that field truthful rather than adding a new one.

## Verification

- **Reproduced first** with the probe above; `spanRatioUsable` flips `false → true` and `routedBy`
  flips `sentence_count → buried_task_ratio` after the fix.
- **3 new regression tests** in `tests/reminders-ai-pipeline.test.js`: the sub-0.5% span still routing
  by the ratio gate; reported-0-from-a-tiny-span staying distinguishable from reported-0-from-no-span
  via `spanRatioUsable`; and the ceiling being compared on the raw value (raw 0.354 must not be
  admitted merely because it rounds to 0.35).
- **Mutation-tested, both caught:** restoring the rounded usability gate (2 failures), restoring the
  rounded threshold comparison (1 failure).
- **Full gate:** 109 suites, **1852 jest** (1849 + 3), 116 node, 0 failures, `tsc` exit 0. The GH-43
  decision-replay battery is among the passing suites, so the measured extraction baseline is
  undisturbed.

## How much this actually explains — and what remains

Measured against 30 days of production telemetry (216 scheduled messages, 128 with `ratio=0`):

| Subset of the `ratio=0` population | Count |
|---|---|
| Total | **128** |
| `msg_len ≥ 3000` | 5 |
| `msg_len ≥ 5000` | 1 |
| `msg_len ≥ 8000` | 0 |
| Median `msg_len` | **241** |

Rounding can only zero out a span when `span / len < 0.005`, which for a typical 25–45 character task
span needs a message over ~5,000–9,000 characters. **At most 1 of the 128 fits.** The median
zero-ratio message is 241 characters, where a 25-character span reports 0.10 and never rounds away.

**So this fix is a real defect fix and NOT the explanation for #51's headline.** The remaining ~127
are the analyzer returning an **empty** `actionable_language`. The schema already requires the field
(`strict: true`, `required` includes it), so the model is satisfying presence with `""` — and OpenAI
strict mode does not support `minLength`, so the schema cannot forbid it.

**Recommended next step, owner: noel.** Do not guess at the prompt. Arm the GH-50 corpus on one
workspace for a bounded window (after its retention prerequisite is settled), then read the actual
input→output pairs for zero-span cases. Only then decide between a prompt change, a code-level
validation, or accepting that some messages genuinely have no quotable span. Issue #51 stays open and
carries this note.

## Out of scope

The empty-span majority, per above. No prompt or schema edits here — changing
`reminders-instructions.md` on a hypothesis, with no corpus to measure against, is exactly the guess
this project's replay battery exists to prevent.
