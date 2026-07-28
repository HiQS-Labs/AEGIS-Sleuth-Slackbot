# P1: Weekend Snooze Not Suppressing Reminders

Status: Completed

## Table of Contents

- [Root Cause Analysis](#root-cause-analysis)
- [Pipeline Architecture Q&A](#pipeline-architecture-qa)
- [Implementation Plan: Centralized Snooze Guard](#implementation-plan-centralized-snooze-guard)
  - [Summary](#summary)
  - [Pre-implementation: Product decision](#pre-implementation-product-decision)
  - [Implementation steps](#implementation-steps)
  - [AGENTS.md compliance notes](#agentsmd-compliance-notes)

---

## Root Cause Analysis

Great investigation. Here are the top 3 most likely causes, in order of likelihood:

1. The Daily Task Digest bypasses snooze logic entirely
This is almost certainly the culprit. The 8:30 AM PT timing is the smoking gun.

#CheckRemindersAsync() (the regular reminder loop) does check snooze days — it reads this.#SnoozeDays and transitions reminders to a Snoozed state on weekends (reminders-module.js:~2080).
#RunDailyTaskDigestAsync() (reminders-module.js:~1898) is a completely separate code path that posts reminders at its own scheduled time. It calls #BuildReminderMapByUser() which grabs all pending reminders with zero snooze filtering, then posts them regardless of what day it is.
The 8:30 AM PT time matches the digest's configured DAILY_TASK_DIGEST_TIME, not the 9 AM regular reminder cycle — confirming it's the digest, not the regular loop, that's firing.

2. The digest scheduler runs on a day-agnostic schedule
#StartDailyDigestSchedulerAsync() (reminders-module.js:~1777) sets up a timer that fires every day at the configured time. There is no day-of-week gate — it doesn't check whether today is in SNOOZE_DAYS (["Saturday", "Sunday"] from workspace-template.json) before executing. Every previous snooze fix (there have been ~5-6 commits addressing weekend snooze) was applied only to the #CheckRemindersAsync() path, never to the digest scheduler.

3. #BuildReminderMapByUser() doesn't respect IgnoreSnooze flags
Even if a snooze check were added to the digest path, the helper method #BuildReminderMapByUser() (reminders-module.js:~1801) doesn't filter by or pass through the IgnoreSnooze property on individual reminders. So there's no mechanism for the digest to distinguish between reminders that should respect snooze days and those that shouldn't — it would need to be taught this distinction as part of a fix.

In short: The regular reminder loop was fixed for weekend snooze, but the daily digest is a parallel system that was never given the same treatment. The different send time (8:30 vs 9:00) is direct evidence that it's the digest code path producing the weekend notifications.

---

## Pipeline Architecture Q&A

**Q:** Instead of just patching the code, what would it take to have everything run through a single workflow or pipeline? I take it we have multiple pipelines right now? Would you recommend fixing that? no code changes yet.

**A:** Yes, there are currently two independent automatic pipelines (plus one manual trigger):

Pipeline	Timer	Snooze-aware?	Purpose
#CheckRemindersAsync	Every 30 sec (#ReminderTimerID)	✅ Yes	Posts individual reminders when ShouldPostOn is due
#RunDailyTaskDigestAsync	Once/day (#DailyDigestTimerID)	❌ No	Posts morning summary of all pending tasks
#HandleProcessRemindersNowAsync	Manual admin command	⚠️ Intentionally bypassed	Force-runs the regular loop
Should you consolidate them into one pipeline?

Honestly, no — and here's why: these two systems do fundamentally different things.

The regular loop is reactive — it watches individual ShouldPostOn timestamps and fires when a specific reminder is due.
The digest is proactive — it posts a morning roll-up of everything pending, regardless of individual due dates.
Merging them would require the unified system to somehow distinguish "post because it's due" from "post because it's the morning digest window," which is exactly the kind of conflated logic that creates future bugs.

What the architecture actually needs is not consolidation of the two pipelines, but extraction of a shared snooze-day guard — a single method like #IsSnoozedToday() that both pipelines call at their entry point. The regular loop already has this logic inlined; the digest just needs to call the same thing. That's a 3-4 line patch to #RunDailyTaskDigestAsync(), and it's the right scope.

The real lesson from the P1 doc is that every time snooze logic was "fixed," it was only patched in one place. The structural fix is to stop duplicating that logic and centralize it so it can't be missed again — not to collapse two architecturally distinct systems into one.

Want me to implement the shared guard + patch?

---

## Implementation Plan: Centralized Snooze Guard

### Summary

Keep both pipelines separate. Extract a shared snooze guard that is smarter than a bare day-check — it should account for per-reminder `IgnoreSnooze` flags. Apply it to the digest path, and confirm the admin force-run path still works cleanly.

### Pre-implementation: Product decision

Before writing any code, decide what the digest should do on a snoozed day:

- **Option A:** Skip the digest entirely on snooze days (simplest)
- **Option B:** Post a reduced digest containing only `IgnoreSnooze: true` reminders (most flexible)
- **Option C:** Silently skip on snooze days but reschedule to the next non-snooze day (matches how the regular loop handles it)

This decision affects the shape of the guard and the digest logic.

Selected Path/Option: **Option B:** 

### Implementation steps

- [x] **1. Extract `#ShouldSuppressForSnooze(ArgReminder, ArgForceOverride = false)`**
  - Create a new private method in `reminders-module.js`
  - Move the existing inline snooze logic from `#CheckRemindersAsync()` (~line 2080) into this method
  - Logic: return `true` (suppress) if today is in `this.#SnoozeDays` AND `ArgReminder.IgnoreSnooze !== true` AND `ArgForceOverride !== true`
  - Update `#CheckRemindersAsync()` to call this method instead of its inline check

- [x] **2. Add day-level guard `#IsSnoozedToday()`**
  - Simple helper: `return this.#SnoozeDays.has(CurrentDayName)`
  - Used as a fast early-exit before iterating reminders (avoids unnecessary work on snooze days when no reminders have `IgnoreSnooze`)

- [x] **3. Patch `#RunDailyTaskDigestAsync()`**
  - At entry, call `#IsSnoozedToday()`
  - ~~If snoozed and Option A: return early, log that digest was skipped for snooze day~~
  - If snoozed (Option B selected): filter the reminder map through `#ShouldSuppressForSnooze()`, only post reminders that pass. If no reminders pass, skip the digest entirely and log
  - ~~If snoozed and Option C: return early and defer to the next non-snooze day (would require rescheduling the digest timer)~~

- [x] **4. Update `#BuildReminderMapByUser()` or its call site to pass through `IgnoreSnooze`**
  - Ensure the `IgnoreSnooze` property is available on each reminder object in the map so the digest path can filter on it
  - If `IgnoreSnooze` is already present on the reminder objects, confirm it — if not, include it

- [x] **5. Confirm `#HandleProcessRemindersNowAsync` still bypasses snooze**
  - The admin force-run should pass `ArgForceOverride = true` (or continue using `ArgForceProcessAll`) so it is unaffected by the new guard
  - Verify this works after the refactor

- [x] **6. Add logging using existing `CombinedLogger`**
  - Use the existing logger via `this.#SlackApp.Logger.info(...)` (same pattern as the ~27 existing log calls in reminders-module.js)
  - Use a `[snooze-guard]` prefix tag to match the existing convention (`[reminder-state]`, `[DIGEST CALC]`, etc.)
  - Log when the digest is suppressed or filtered due to snooze, including which day and how many reminders were affected
  - No new logging infrastructure needed — this keeps things DRY with `combined-logger.js`

- [ ] **7. Test**
  - Unit test `#ShouldSuppressForSnooze()` with: snooze day + normal reminder (suppress), snooze day + `IgnoreSnooze` reminder (allow), non-snooze day (allow), force override (allow)
  - Integration test: run digest on a simulated Saturday, confirm only `IgnoreSnooze` reminders post (Option B)
  - Integration test: run admin force command on a Saturday, confirm it still works
  - Status: Not automated yet in repo (no unit test harness currently configured); requires manual/integration follow-up.

- [ ] **8. Post-build verification (AGENTS.md Section 8)**
  - Run `npm run build` — type check must pass
  - Run `npm run dev` — runtime smoke test, confirm startup logs are clean
  - Manual Slack check: trigger digest on a test workspace Saturday, confirm correct behavior
  - Status: `npm run build` passed and `npm run dev` startup smoke ran; external Slack/OpenAI connectivity failed in this sandbox environment. Manual Slack verification still pending.

- [x] **9. Version bump, CHANGELOG, and `#lessonslearned` (AGENTS.md Sections 8-9)**
  - Bump version in `package.json` (this is a behavior change — digest no longer fires unconditionally on weekends)
  - Update `CHANGELOG.md` with the fix description
  - Add a `#lessonslearned` entry: snooze logic was patched 5-6 times in only one pipeline; the lesson is to centralize cross-cutting guards so parallel code paths can't drift

### AGENTS.md compliance notes

This plan was reviewed against AGENTS.md v2.0 and DASHBOARD.md. Key alignment points:

| AGENTS.md Section | Status | Notes |
|---|---|---|
| 0.1 Guardrails | Aligned | Surgical edit in `reminders-module.js`, no new modules/files |
| 0.2 Dependency contract | Aligned | No new imports; reuses existing `CombinedLogger` via `this.#SlackApp.Logger` |
| 1 Pre-build | Aligned | Module owner is `reminders-module.js`; tenant scope unchanged |
| 6 Coding conventions | Aligned | Parameters use `Arg` prefix (`ArgReminder`, `ArgForceOverride`); method names are PascalCase |
| 7 Observability | Aligned | Logging uses existing `CombinedLogger` with `[snooze-guard]` prefix tag |
| 8 Post-build | Step 8 | Explicit `npm run build` + `npm run dev` + manual Slack verification |
| 9 Continuous audit | Step 9 | `#lessonslearned` entry in CHANGELOG for the duplicated-snooze-logic lesson |
| 11 Key paths | Aligned | All changes within `src/reminders-module.js` |
| 15 Anti-patterns | Aligned | No new abstractions, frameworks, or architectural drift |
