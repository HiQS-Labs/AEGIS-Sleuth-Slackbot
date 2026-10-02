---
gh_issue: 205
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/205
title: "\"This week\" with no clock time schedules tomorrow 8 AM and falsely warns \"the requested time was in the past\""
status: Proposed (1-INBOX — not yet active)
created: 2026-10-02
doc_type: bugfix
related: "GH-87 / GH-94 (same past-handler; jitter + same-day intent), 1.4.150 (:alarm_clock: synthetic-fallback warning suppression)"
---

# GH-205 — A period phrase is not a requested time

## Observed (prod, 2026-09-30 11:00 PDT)

"…This week's checkpoints are in #N: complete …" → the analyzer extracted the trigger `This week`. The
date extractor had no rule for it and resolved it to **BASE DATE at 8 AM** (its own rationale: *"not
explicitly covered by any specific rule … use the current date … and apply the default time of 8
AM"*). That was 3 hours in the past, so the past-handler rolled it forward 24 hours and the confirmation
said *"The requested time was in the past"*. Nobody had requested a time.

## Recon (base `0d82359`)

- `data/static/ai/date-extraction-instructions.md:26`: the 8 AM missing-time default is written for
  explicit dates (`18 Nov 2024`). Lines 56-67 cover `today`, `tomorrow`, `next week`, `next month`,
  `few weeks`, but have **no `this week` / `end of week` rule**.
- `src/reminders-ai-pipeline.js:924-940` (`ExtractDateWithGptAsync`): past → same-day for
  `ShouldKeepSameDayWhenPast`; otherwise +24 h and `wasAdjustedForward = true`.
- `src/reminders-ai-pipeline.js:749-757` (`ApplyPresentationJitter`): already computes
  `HasExplicitClockTime` inline. This is the existing "did the user write a clock time" rule.
- `wasAdjustedForward` consumers: `src/reminders-module.js:1920` (log), `:2090` (feeds
  `AdjustedReminders` → the warning at `:2559-2562`, already suppressed for the synthetic
  `:alarm_clock:` fallback), and `:2389` (`:wrench:` triage tag). There is no other writer.
- **Pinned behavior that must not change:** `tests/reminders-ai-pipeline.test.js` asserts
  `wasAdjustedForward === true` for past `yesterday` (≈L583) and past `afternoon` (≈L734, L762, GH-94),
  and `false` for `this morning` / `tonight`. A rule of "warn only on an explicit clock time or date",
  as the issue's Phase 1 is worded, would flip the `afternoon` cases. That changes fuzzy time-of-day
  behavior nobody asked to change. The fix therefore targets **period-only** triggers.

## Plan

1. **Prompt fix, at the source.** In `date-extraction-instructions.md`, next to `next week`:
   - `this week`, `end of (the) week`, `EOW`, `by end of week`: if the BASE DATE is Monday–Thursday,
     use **8 AM on the next day**; if it is Friday, Saturday, or Sunday, use **3 hours after the BASE
     DATE** (same as `today`).
   - Add a sentence to the line 26 default: the 8 AM default applies only when the phrase names a
     specific date; never resolve a phrase to the BASE DATE's own 8 AM when that is earlier than
     the BASE DATE.
2. **Deterministic backstop in `ExtractDateWithGptAsync`.** Extract the inline `HasExplicitClockTime`
   into a static helper `RemindersAIPipeline.HasExplicitClockTime(trigger)`, and use it in
   `ApplyPresentationJitter` as before (pure move, no behavior change). Add
   `IsPeriodOnlyTrigger(trigger)`, true when the trigger names `week|month|sprint|quarter|eow|eom` and
   has **no** explicit clock time and **no** day word (`today|tonight|tomorrow|yesterday|` weekday
   names). For a past period-only anchor, keep the existing +24 h roll-forward but leave
   `wasAdjustedForward = false`: the user never named the time that turned out to be past. This
   covers model variance and other period phrases without touching time-of-day or date triggers.
3. **Tests (extend the existing suite; no new files).** In `tests/reminders-ai-pipeline.test.js`
   → `ExtractDateWithGptAsync`:
   - past anchor + `This week` → rolled to the next day, `wasAdjustedForward === false`;
   - **red control:** past anchor + `this week at 9 AM` → `wasAdjustedForward === true` (an explicit
     clock time still warns);
   - instruction-content assertion that the date-extraction prompt carries the `this week` rule
     and the 8 AM guard (GH-197 precedent).
   - The existing `yesterday` / `afternoon` / `this morning` / `tonight` assertions stay unedited.
     They pin the behavior that must not change.
4. `CHANGELOG.md` entry (no `package.json` bump; the version lags the changelog until release).

## Acceptance

- [ ] `This week` resolving to a past anchor → scheduled the next day, **no** past-time warning (test).
- [ ] `this week at 9 AM` past → warning still fires (red control, test).
- [ ] Existing past `yesterday` / `afternoon` → still `wasAdjustedForward === true` (unedited tests pass).
- [ ] The `:alarm_clock:` suppression test (`tests/reminders-integration.test.js` ≈L690) still passes.
- [ ] `npm run validate:ai` prints `OK:` for `date-extraction-instructions.md`.
- [ ] Full `npm test` green on the final commit.

## Non-goals

- Changing whether the analyzer treats `this week` as a trigger (`reminders-instructions.md:48` already
  scopes it to forward-looking language, and this message was forward-looking).
- Changing time-of-day (`afternoon`, `evening`) or date (`yesterday`) warning behavior.
- Live LLM replay scenarios (`utils/replay-scenarios.json`). The prompt rule is verified by its
  content assertion plus a post-deploy prod check, not by a networked test.
- The Lists round-trip warning (GH-206).

## Risks / rollback

- The prompt change alters scheduling for `this week` phrases. This is intended, and it only affects
  phrases with no rule today. Rollback: revert the commit; no data or schema is touched.
- The `IsPeriodOnlyTrigger` keyword list is narrow by design. A missed phrase falls back to today's
  behavior (a false warning), never to a wrong schedule.

## Rating (2026-10-02)

`rated 40/30/50/75`. Severity 30: a user-facing false claim plus a reminder at an arbitrary next-morning
time; no data loss, and the reminder still fires. Priority 40: it recurs for every period phrase sent
after 8 AM and is visible to everyone in the thread. Appeal 50 (neutral, no operator preference
given). Effort 75: one prompt rule, one helper extraction, one condition, and tests in an existing
suite. Recurrence: in the last 14 days (2026-09-18 → 10-02) this is the only issue in this class (#205);
none in the prior 14 days. The same past-handler produced GH-87 / GH-94 in August. The trend is
unknown beyond that, since false warnings are rarely reported.
