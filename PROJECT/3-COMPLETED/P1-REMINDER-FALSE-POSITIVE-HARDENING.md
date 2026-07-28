---
author: Codex
created: 2026-06-08
updated: 2026-06-08
status: Complete — Phase 6 landed (bare `asap` hardening); remediation done. Remaining action is passive production observation only, unless new logs show a remaining false-positive cluster.
goal: Diagnose the June 8 neochrome false-positive reminder and lay out remediation options before changing reminder-classification behavior.
title: P1 — Reminder False Positive Hardening
branch: development
owner: noel
related: ARCHITECTURE.md, AGENTS.md
---

# P1 — Reminder False Positive Hardening

## Status

| What was just completed | What's next |
|---|---|
| **Phase 6 complete:** bare `asap` now requires stronger surrounding reminder-intent language before it trips the shared temporal gate. Plan complete. | **Production observation only** — no further heuristic change planned unless new logs show a remaining false-positive cluster. |

## Table of Contents

- [Summary](#summary)
- [Diagnosis](#diagnosis)
- [Root Cause](#root-cause)
- [Architectural Notes](#architectural-notes)
- [Implementation Locus](#implementation-locus)
- [Phase 1 — Prompt Hardening](#phase-1--prompt-hardening)
- [Phase 2 — Post-Enrichment Safety Check](#phase-2--post-enrichment-safety-check)
- [Phase 3 — Display/Source-Text Fix](#phase-3--displaysource-text-fix)
- [Phase 4 — Observability](#phase-4--observability)
- [Phase 5 — Narrow Syntactic Guard Fallback](#phase-5--narrow-syntactic-guard-fallback)
- [Phase 6 — Revisit `asap` Gate Only If Needed](#phase-6--revisit-asap-gate-only-if-needed)
- [Acceptance Criteria](#acceptance-criteria)
- [Validation Plan](#validation-plan)
- [Open Questions](#open-questions)

## Summary

On **Monday, June 8, 2026**, Sleuth created a false-positive reminder in production for the
neochrome workspace after a thread reply from Alex Rivera:

> Ok, I'll keep that in mind when I get to that plugin. I'm assuming the goal is to be able to reactivate that plugin asap.

The reminder was later deleted with `:wastebasket:`. The actual user-facing failure was not the
trash path. It was that Sleuth:

- **jumped in with reminder scheduling when it should have stayed quiet**, and
- **combined several thread messages into one reminder body**, which made the output feel arbitrary
  and hard to explain.

The key findings are:

- The **training bucket path worked**. That matters only as background. Production did append the
  example to `data/runtime/reminders/neochrome_trashed_examples.jsonl` at
  `2026-06-08T20:13:21.590Z`.
- The **real bug is in the scheduling path**. The message matched both:
  - the vague-thread enrichment path (`get to that`), and
  - the temporal prefilter (`asap`).
- Sleuth then prepended earlier thread messages before reminder analysis, so the AI saw a richer
  multi-message task context than the live reply actually contained.
- With `REMINDER_TEXT_SYNTHESIS` off, the posted reminder preserved that enriched multi-message
  text, which turned a questionable schedule decision into a visibly nonsensical reminder body.

This doc is a plan only. No code changes yet.

## Diagnosis

### What happened

The false positive came from a thread-reply pipeline that currently behaves like this:

1. A thread reply enters `RemindersModule.#OnMessageAsync`.
2. If it is a thread reply, Sleuth tries shorthand handlers first, then
   `TryEnrichVagueCompletionFromAboveAsync` in `reminders-app-mention-handler.js`.
3. That enrichment path activates when:
   - the reply contains a vague pronoun-style completion/reference, and
   - the reply contains any temporal trigger from the shared regex.
4. If both match, Sleuth prepends up to 3 earlier human thread messages and sends the combined text
   to reminder analysis.
5. The AI sees a richer, more explicit task context than the final reply alone contained, and can
   decide to schedule based on that expanded text.
6. Because text synthesis is off, the displayed reminder can inherit the expanded multi-message text
   rather than just the live reply.

### Why this specific message matched

- `get to that` matches the existing vague completion pattern.
- `asap` matches the existing scheduling-trigger regex.
- The message is acknowledgment / understanding language, not a clear commitment with a concrete
  schedule, but the current structural gate does not distinguish those cases.

### What did not fail

- The `:wastebasket:` reaction path did save the example before deleting the reminder.
- The weekly report cursor has not yet advanced to cover the newest entries, so this false positive
  should still appear in the next weekly false-positive reminder report rather than being lost.

### Two distinct failures

This incident should be treated as **two related bugs**, not one:

1. **Scheduling bug** — Sleuth decided this weak acknowledgment / hypothetical reply deserved a
   reminder.
2. **Display/source-text bug** — once enrichment happened, the reminder body displayed a merged
   multi-message blob instead of something anchored to the actual reply.

## Root Cause

The core problem is:

**Sleuth currently lets acknowledgment-style thread replies inherit earlier thread tasks, then lets
the final scheduling decision and displayed reminder text operate on that enriched multi-message
input without enough protection against weak or hypothetical live-reply intent.**

That creates two failure modes:

- the AI can schedule a reminder for a reply that should have been ignored, and
- the visible reminder text can look detached from the actual triggering reply.

The problematic live-reply shapes here are soft acknowledgments like:

- `I'll keep that in mind.`
- `when I get to that`
- `I'm assuming the goal is...`
- `reactivate that plugin asap`

Those should not become strong task commitments merely because earlier thread messages contain real
tasks.

## Architectural Notes

This repo's reminder pipeline is intentionally **recall-biased** at the cheap deterministic layer.
The shared temporal regex and thread-enrichment entry conditions are designed to let borderline
candidates through so the LLM can make the final judgment. That means this incident should be read
as:

- a **decision-layer failure** first, because the LLM ultimately said `schedule`, and
- a **display/source-text failure** second, because enriched context leaked directly into the
  reminder body.

That architecture argues against using a broad structural blocklist as the primary fix. Structural
gating is still available, but only as a **narrow syntactic guard** for obviously hypothetical /
subordinate forms if the decision-layer and post-check fixes are not sufficient.

## Implementation Locus

For anyone implementing the eventual fix, the important distinction is:

- `RemindersModule.#OnMessageAsync` is the caller and entrypoint for the thread-reply path.
- `TryEnrichVagueCompletionFromAboveAsync` is implemented in
  `src/reminders-app-mention-handler.js` and is the main structural site for enrichment behavior.
- The schedule / ignore decision still resolves through the normal AI scheduling path after that.

So the likely edit surfaces are:

- `src/reminders-app-mention-handler.js` for enrichment and any narrow structural guard,
- `data/static/ai/reminders-instructions.md` for decision-layer prompt hardening,
- `src/reminders-module.js` for any post-enrichment safety check and any display/source-text fix.

## Phase 1 — Prompt Hardening

Formerly: Option C.

Purpose: harden the AI decision layer so acknowledgment / hypothetical thread replies resolve to
`ignore` even when earlier thread context contains actionable tasks.

Why this phase is first:

- Most consistent with the repo's intentionally recall-biased architecture.
- Fixes the layer that actually said `schedule`.
- Lowest blast radius relative to the shared regex paths.

Observable checklist:

- [x] Add explicit prompt guidance that weak acknowledgment / alignment language in thread replies should be ignored even when prior thread context contains real tasks.
- [x] Add concrete negative examples close to the real incident:
  - `I'll keep that in mind`
  - `when I get to that`
  - `I'm assuming the goal is...`
  - `reactivate that plugin asap`
- [x] Preserve positive examples for real vague commitments:
  - `I'll handle it tomorrow morning`
  - `I'll do it by 4 PM`
  - `Can you review it by EOD?`
- [x] Document in the prompt that earlier thread context is supportive context, not automatic proof that the live reply is schedulable.
- [x] Verify prompt/schema alignment if any reminder schema-facing examples change.

## Phase 2 — Post-Enrichment Safety Check

Formerly: Option D.

Purpose: add a deterministic backstop after enrichment so weak live replies do not schedule even if
the enriched AI result says `schedule`.

Why this phase is second:

- Keeps the current recall-biased enrichment path intact.
- Defends against thread-context overreach at the final decision boundary.
- More precise than tightening shared cheap gates first.

Observable checklist:

- [x] Define the reply-intent signals that count as weak acknowledgment / hypothetical language.
- [x] Ensure the post-check examines the actual live reply, not just the prepended enriched context.
- [x] Make the post-check skip scheduling when the live reply lacks a strong commitment even if the enriched AI output says `schedule`.
- [x] Keep true commitments schedulable:
  - `I'll handle it tomorrow morning`
  - `I'll take care of that tonight`
  - `Please review it by EOD`
- [x] Record in comments/logging that this is a final safety backstop against enriched-context overreach.

## Phase 3 — Display/Source-Text Fix

Formerly: Option E.

Purpose: stop enriched multi-message context from becoming the visible reminder body when synthesis
is off.

Why this phase is separate:

- This is a distinct user-facing bug from the schedule/ignore mistake.
- Even a correctly scheduled enriched reminder should not display a confusing multi-message blob.

Observable checklist:

- [x] Separate classification context from displayed reminder source text.
- [x] Ensure enriched context can still inform scheduling analysis without automatically becoming the displayed task text.
- [x] Preserve a user-visible reminder body anchored to the live reply or a controlled display source.
- [x] Verify behavior when `REMINDER_TEXT_SYNTHESIS` is off.
- [x] Verify behavior when `REMINDER_TEXT_SYNTHESIS` is on.

## Phase 4 — Observability

Formerly: Option F.

Purpose: make future false positives explainable from logs without reconstructing behavior from
production artifacts.

Observable checklist:

- [x] Log which structural path fired.
- [x] Log whether enrichment ran.
- [x] Log the matched temporal trigger.
- [x] Log whether the post-check classified the live reply as weak acknowledgment / hypothetical language.
- [x] Log whether the displayed reminder text came from the live reply, synthesized text, or enriched context.

## Phase 5 — Narrow Syntactic Guard Fallback

Formerly: Option A.

Purpose: only if Phases 1 and 2 do not sufficiently reduce false positives, add a narrow structural
guard on obviously hypothetical / subordinate thread-reply forms.

Important constraint:

- This phase is **not** a phrase blacklist.
- It is **not** the first-line fix.
- It should be limited to narrow syntactic forms such as subordinate / non-committal shapes like
  `when I get to that`.

Observable checklist:

- [x] Identify a small set of structural forms that are clearly hypothetical / subordinate.
- [x] Ensure these guards do not block legitimate vague commitments such as `I'll handle it tomorrow morning`.
- [x] Keep the guard local to the enrichment path rather than changing shared reminder entry behavior.
- [x] Add targeted tests proving the guard reduces false positives without broad recall loss.

## Phase 6 — Revisit `asap` Gate Only If Needed

Formerly: Option B.

Purpose: change the shared temporal regex only if the narrower fixes above leave a remaining cluster
of `asap`-driven false positives.

Why last:

- Highest blast radius.
- Shared by multiple reminder-entry paths.
- Most likely to trade false positives for false negatives globally.

Observable checklist:

- [x] Measure whether false positives still cluster around `asap` after Phases 1 through 5.
- [x] If yes, evaluate whether `asap` should require stronger surrounding language.
- [x] Confirm any regex change does not break legitimate direct asks using `asap`.

## Acceptance Criteria

Observable success criteria:

1. Messages like `I'll keep that in mind when I get to that plugin ... asap` do **not** schedule a
   reminder, even inside a task-heavy thread.
2. Real vague commitments such as `I'll handle it tomorrow morning` still schedule correctly.
3. Explicit direct asks such as `Can you review it by EOD?` still schedule correctly.
4. When enrichment is used for analysis, the displayed reminder body does **not** default to a
   confusing multi-message mashup.
5. The `:wastebasket:` false-positive training flow continues to append examples exactly as it does now.
6. Logs make it clear whether enrichment fired, why it fired, and what source text was used for display.

## Validation Plan

Before shipping any fix:

1. Add focused unit tests for the enrichment path, AI hardening expectations, and post-check behavior.
2. Add regression cases for:
   - [ ] acknowledgment + `asap` in thread reply → ignore
   - [ ] real vague commitment + explicit future time → schedule
   - [ ] enriched reminder analysis path does not force multi-message display text by default
   - [ ] top-level explicit ask + `asap` → expected behavior unchanged unless intentionally changed
3. Run `npm run build`.
4. Run the relevant reminder tests.
5. If prompt files change, run `npm run validate:ai`.
6. Manual Slack smoke test in a non-production workspace using thread replies close to the real incident.

## Open Questions

Feedback needed before implementation:

1. Should `asap` remain valid anywhere in auto-scheduling, or should it require stronger surrounding language?
2. For the first pass, do you want to treat this primarily as a **decision-layer bug**, a **display-text bug**, or do both together?
3. Do you want a narrow syntactic guard for subordinate / hypothetical replies like `when I get to that`, or should the first implementation avoid structural gating changes entirely?
4. Should observability changes ship with the first fix, or do you want behavior-only changes first?
