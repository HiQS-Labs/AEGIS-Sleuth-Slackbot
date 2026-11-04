---
gh_issue: 297
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/297
title: "Reminder age label under-counts by the workspace UTC offset"
status: Proposed (1-INBOX — plan drafted, awaiting plan QA)
created: 2026-11-04
updated: 2026-11-04
owner: noelsaw1
goal: "Every reminder list labels a reminder created on the previous local calendar day as `1 day old`, never `created today`."
doc_type: bugfix
branch: fix/AEGIS-Sleuth-Slackbot-gh297-reminder-age-label-2026-11-04
non_goals:
  - "Changing the label wording or the line layout (GH-250 contract)"
  - "Reworking GetLocalizedUtcDate / the localized-UTC convention used by scheduling"
  - "The digest showing only the first task of a multi-task reminder"
---

# GH-297 · Reminder age label under-counts by the workspace UTC offset

## Status

| What was just completed | What's next |
|---|---|
| Recon at `development` 84ae838; production evidence read (read-only); plan drafted | Codex plan QA, which must also confirm the bug is real |

## Observed problem

On 2026-11-04 the 08:30 PT digest labelled two reminders `created today`. One was created at 15:37 PT
the day before, the other at 05:39 PT the day before (about 27 h earlier). The second one had also
been labelled `created today` on the 11-03 digest. Production data: `CreatedOn` values
`2026-11-03T23:37:01Z` and `2026-11-03T13:39:22Z`. The digest ran at `2026-11-04T16:30Z`.

## Root cause

`DateUtils.GetCurrentDateInTimeZone(tz)` (`src/date-utils.js:79`) returns a **localized-UTC** Date:
its UTC fields hold the local wall clock (for PT at 16:30Z it reports 08:30 "Z"). `CreatedOn` is a real
UTC instant. Two age sites subtract one from the other:

| Site | Expression | Defect |
|---|---|---|
| `src/reminders-display-utils.js:318-324` (`BuildCompactTextForReminder`: digest, `show reminders`, buckets, ask-reminders) | `floor((LocalizedNow - CreatedOn) / 24h)` | mixes frames (−8 h in PT, +5.5 h in IST) **and** counts elapsed 24 h blocks |
| `src/web-api.js:589,625-627` (`display.ageDays` in the reminders export, also the git-pulse-sync mirror) | `floor((NowInTimeZone - CreatedMs) / 24h)` | same |
| `src/chat-commands/show-rebalance-reminders-command.js:186-189` (re-renders the export) | `floor((Date.now() - CreatedMs) / 24h)` | frames correct; still elapsed 24 h blocks |

Worked numbers for the 11-04 digest: `16:30Z − 8 h − 13:39Z(prev day)` = 18.85 h → `0` → `created today`.
Even with the frame fixed, an elapsed-hours floor gives 15:37 PT yesterday → 08:30 PT today = 16.9 h →
`created today`. The label speaks in calendar terms ("today"), so the age must be a **calendar-day
difference in the workspace time zone**.

## Plan (smallest surface)

Extend the existing `DateUtils` (canonical date helper) with one function; no new module.

1. `src/date-utils.js`: add `static GetCalendarDaysBetween(ArgTimeZone, ArgFromUtcDate, ArgToUtcDate)`.
   Localize both instants with the existing `GetLocalizedUtcDate`, take each one's
   `Date.UTC(y, m, d)` midnight, return `Math.round((To − From) / 86400000)`. Localized-UTC has no
   DST, so midnights are exactly 24 h apart and `round` is exact. Clamp at `0` is left to the caller's
   existing `!(n > 0)` → `created today` rule (a future `CreatedOn` stays `created today`).
2. `src/reminders-display-utils.js:318-324`: replace the subtraction with
   `DateUtils.GetCalendarDaysBetween(tz, ArgReminder.CreatedOn, new Date())`. Remove the now-unused
   `CurrentDate` local.
3. `src/web-api.js:625-627`: same helper with `ArgTimeZone`, `new Date(CreatedMs)` and a real now
   (`new Date()`). `NowInTimeZone` stays only if it has other uses there (check; delete if not).
4. `src/chat-commands/show-rebalance-reminders-command.js:186-189`: same helper with
   `ArgParsed.display.timeZone` (already in the export, `src/web-api.js:661`) and `new Date(NowMs)`.
   If the export has no `display.timeZone` (older file), fall back to `'UTC'` — matches the existing
   UTC fallback in the same file (`FormatDualStamp`).
5. Tests: extend the existing suites only (no new files):
   - `tests/date-utils*.test.js` if present, else `tests/reminders-display-utils.test.js`: PT,
     now `2026-11-04T16:30Z` — created `2026-11-03T23:37Z` → 1; `2026-11-03T13:39Z` → 1;
     `2026-11-04T08:01Z` (00:01 PT today) → 0; `2026-11-04T07:59Z` (23:59 PT yesterday) → 1;
     `Asia/Kolkata` case `2026-11-04T19:00Z` vs `2026-11-04T17:00Z` → 1 (crosses local midnight);
     DST span `America/Los_Angeles` `2026-10-31T19:00Z` → `2026-11-02T19:00Z` → 2.
   - `tests/show-rebalance-reminders-command.test.js`: one case with `display.timeZone`
     `America/Los_Angeles` where `createdOn` is the previous local day but < 24 h ago → `1 day old`.
   - Red control: run the new cases against the current code; they must fail.
6. Verify: `npx jest tests/reminders-display-utils.test.js tests/show-rebalance-reminders-command.test.js tests/web-api-reminders.test.js`
   while iterating; full `npm run build && npm test` once on the final commit; `utils/pdda/pdda.sh run`.
7. Smoke (dev checkout, never prod): main path — call `BuildCompactReminderLine` via
   `BuildCompactTextForReminder` with a stub `SlackApp` and the two production `CreatedOn` values at a
   fixed clock; adjacent path — render the rebalance view from an export JSON missing
   `display.timeZone`. Receipt under `TESTS-RESULTS/2026-11-04+GH-297/`.

## Non-goals

See frontmatter. Ages in quiet/stale-reminder thresholds (`reminders-module.js` 30/14-day windows)
use their own elapsed-time math and are out of scope; they are thresholds, not "today" labels.

## Preflight bet check

- **Outcome sought:** a reader can trust "created today / N days old" on every list.
- **Smallest bet:** one helper on `DateUtils`, three call-site swaps, cases added to existing suites.
- **Alternative rejected:** only replacing the localized now with `Date.now()` — fixes the frame bug
  but still prints `created today` for a reminder made yesterday afternoon, the case that caused
  the confusion.
- **Rollback:** revert the single commit; no data or schema touched (`display.ageDays` is a derived,
  per-request field).

## Risks

- `display.ageDays` in the export changes value for some reminders (now correct). Consumer: the
  rebalance view recomputes it anyway; the git-pulse-sync mirror is read-only display.
- Positive-offset zones previously over-counted; they will now show smaller, correct ages.

## Rating (2026-11-04)

`rated 40/30/50/85`. Severity 30: wrong metadata on every reminder list for every workspace not on
UTC; no data loss; it contributed to one user-visible confusion (a teammate concluded a reminder
was missing). Priority 40: the operator asked for the fix now; low consequence otherwise. Appeal 50
(neutral, no operator value). Effort 85: three call sites plus one helper. Recurrence: no
same-class age/label issue in the last 28 days (issue search 2026-10-07..11-04); one incident;
trend unknown.
