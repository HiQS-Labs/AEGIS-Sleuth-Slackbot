---
issue: "#337"
title: Reminder task-text quality — FYI synthesis + display trimming (EPIC)
desc: Stop dumping long FYI notes verbatim; synthesize the buried task and unify digest display.
status: All 4 phases shipped (Phases 1/2/4 in 1.4.205; Phase 3 in 1.4.209, commit 500470a — found undocumented during a 2026-07-09 marathon preflight sweep). #339 tracks separate, non-blocking follow-ups.
owner: noel
folds: "#193, #3, #29"
related: "#338 (show-me reuses the per-reminder renderer that displays this text)"
surface:
  - src/reminders-module.js          # task-text override + digest compose (L1250-1349)
  - src/reminders-ai-pipeline.js     # IsTextSynthesisEnabled / synthesis (L285-309)
  - data/static/ai/reminders-instructions.md
complexity: 1
risk: 1
effort: 2
phases: 4
---

| Most recently completed phase | What's next |
| --- | --- |
| **Phase 3 — Digest display trimming** (1.4.209, commit 500470a) | _None — all 4 phases shipped. #339 tracks separate non-blocking follow-ups._ |

## Table of contents
- [Problem](#problem)
- [Phase 1 — Unify task-text source](#phase-1)
- [Phase 2 — Two-segment synthesis settings](#phase-2)
- [Phase 3 — Digest display trimming (folds #193 / #3 / #29)](#phase-3)
- [Phase 4 — Telemetry to tune thresholds](#phase-4)

## Problem
A long FYI/status note scheduled a reminder whose task bullet was the **whole message verbatim**, though the `:wrench:` triage path had already extracted the clean task (`"Ask for the error and access logs..."`). The two paths disagree because, with `REMINDER_TEXT_SYNTHESIS` OFF (default), [reminders-module.js:1273-1276](../../src/reminders-module.js#L1273-L1276) overwrites every candidate's task with the full message. Synthesis machinery already exists; this epic decides defaults, adds length-aware settings, and unifies display.

<a id="phase-1"></a>
## Phase 1 — Unify task-text source ✅ (1.4.205)
- [x] Auto-scheduled digest and triage use one shared task-text selection. — `#SelectReminderTaskText` is now the sole chokepoint; the mutating `reminder_message` override was deleted.
- [x] Same message → same task bullet on both paths. — both pass the same normalized original text into the selector.
- [x] Low synthesis confidence → verbatim fallback; never drop a reminder. — over-compression fallback to the quoted actionable span, then to the verbatim original.

**QA**
- [x] Repro message yields identical bullet in digest and triage. — guaranteed by construction (single selector).
- [x] No existing reminder changes when both settings are OFF (byte-for-byte). — verbatim path returns `NormalizeUserMentionsToMrkdwn(normalizedOriginal)`, identical to the prior override; existing verbatim integration tests stay green.

<a id="phase-2"></a>
## Phase 2 — Two-segment synthesis settings ✅ (1.4.205)
Replaced the single flag with two independent on/off settings, split at a sentence count:
- [x] **Normal** (< 4 sentences) synthesis: `REMINDER_TEXT_SYNTHESIS_NORMAL`, default OFF.
- [x] **Longer** (≥ 4 sentences) synthesis: `REMINDER_TEXT_SYNTHESIS_LONG`, default ON.
- [x] Sentence-count splitter (`CountSentences` / `IsTaskSynthesisEnabledForText`, threshold = 4).
- [x] ~~via the complex model~~ → **decision changed:** reuse the analyzer's existing brief (`reminder_message`, default model) instead of a new complex-model call — zero added LLM latency/cost. The over-compression fallback still pulls the quoted actionable span when the brief is too terse. (If higher fidelity is wanted later, swap in a dedicated `SynthesizeActionableSpanAsync` here.)
- [x] Verbatim original preserved in the reminder blockquote regardless of setting (blockquote is built from the raw message, untouched).
- [x] Legacy `REMINDER_TEXT_SYNTHESIS`, if set, overrides both segments (back-compat).

**QA**
- [x] Long FYI + buried commitment → analyzer brief shown; original still in blockquote.
- [x] Short actionable message with Normal=OFF → unchanged, no LLM call (force-schedule gate is per-segment).
- [x] Per-segment force-schedule gate regression tests added (Codex review finding 6): `_LONG` default-ON synthesizes a ≥4-sentence message; `_LONG=off` keeps it verbatim with no LLM call.
- [x] Codex `/relay-xyz` QA review passed routing/ratio/override/fallback logic; two triage-diagnostic divergences deferred → #339 (relay: [relay-system/2026-06-24/gh-337-task-text.md](../../relay-system/2026-06-24/gh-337-task-text.md)).
- [ ] Synthesis never invents a commitment absent from the text — inherits the analyzer's existing fidelity (no new generation step), so covered by existing analyzer behavior; revisit if Phase-3/complex-model synthesis is added.

<a id="phase-3"></a>
## Phase 3 — Digest display trimming (folds #193 / #3 / #29) ✅ (1.4.209, commit 500470a)
- [x] Daily digest shows an excerpt (first 3 sentences) with trailing `…` (#3). — `ExtractQuotedOriginalExcerpt` in `reminders-display-utils.js`.
- [x] Task list text trimmed of redundant prefix/suffix lines (#29). — greeting/signoff edge-line trim, same helper.
- [x] Floor so excerpts never shrink to a useless length (#193). — minimum-useful-length floor so terse messages don't collapse to junk like "Hi. Thanks.".

**QA**
- [x] Excerpt ends with `…` only when truncated. — dedicated Phase-3 test in `tests/reminders-display-utils.test.js` (`ExtractCompactSummary — GH-337 Phase 3 quoted-original excerpt`).
- [x] No reminder renders shorter than the #193 floor. — covered by the same Phase-3 test block; 23/23 green, tsc-clean per commit 500470a.

**Note (2026-07-09):** this phase was fully shipped on 2026-07-03 but never got a `CHANGELOG.md` entry or a ROADMAP/doc update — discovered via a marathon-plan preflight sweep, whose `already-landed` freshness probe (`grep_absent` for the `GH-337 Phase 3` code tag at [reminders-module.js:2136](../../src/reminders-module.js#L2136)) was correct all along. Backfilled the missing `CHANGELOG.md` entry under 1.4.209.

<a id="phase-4"></a>
## Phase 4 — Telemetry to tune thresholds ✅ (1.4.205)
- [x] Log message length + actionable-span ratio alongside existing `task_source`. The `reminder display source:` line now emits `msg_len`, `sentences`, `segment`, `synthesis`, `actionable_span_ratio` (via `RemindersAIPipeline.DescribeSynthesisRouting`).
- [ ] Confirm the 4-sentence split from real data before defaults are locked. — **open**: needs prod log review once 1.4.205 is deployed.

**QA**
- [x] One structured line per scheduled *message*; no raw message text logged (only length + derived ratio). _(Note: emitted per-message, not per-reminder — one message can schedule several reminders under one trigger; per-message keeps the log clean and still carries every routing fact.)_

## Swarm Preflight Contract

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test -- reminders-module",
  "fix_probes": [
    { "type": "grep_absent", "path": "src/reminders-module.js", "pattern": "GH-337 Phase 3" }
  ],
  "artifacts": [
    "src/reminders-module.js",
    "src/reminders-display-utils.js"
  ],
  "remediation": {
    "source": "self#phase-3",
    "criteria": "Phase 3 checklist above: daily digest shows a first-3-sentence excerpt with trailing ellipsis, redundant prefix/suffix trimmed from the task list text, and a floor so excerpts never shrink below the #193 threshold. Tag the landed change with a 'GH-337 Phase 3' code comment (matching this repo's existing phase-tag convention, e.g. the Phase 2 comment at reminders-module.js) so freshness probes can detect it."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```
