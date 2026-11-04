---
Goal: Pre-implementation plan QA for GH-297 (reminder age label under-counts by the workspace UTC offset) — confirm the bug is real AND review the plan
Date: 2026-11-04
NEXT: Reviewer
STATUS: Open
---

# Context

Review the plan in `PROJECT/1-INBOX/GH-297-REMINDER-AGE-LABEL.md` (issue https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/297) **before any code is written**.

The operator asked for two things from this review, in this order:

1. **Independently confirm that this is a true bug** — not a misreading of the code, not intended behaviour, and not already fixed on this branch. Do not take the plan's root-cause section on trust: derive it from the source yourself and measure it.
2. Review the plan itself.

**Operational envelope:** a multi-workspace Slack bot; this is a display-label correctness fix in existing date math. Grade against the stated requirement ("a reminder created on the previous local calendar day reads `1 day old`, never `created today`") and commensurate complexity. Do not ask for unrequested machinery (new date libraries, timezone services, configuration knobs, migrations). Tests are allowed in this repo, but only as cases added to existing suites. Non-goals are listed in the plan's frontmatter.

Read the plan in full, then the code it cites:
- `src/date-utils.js` — `GetLocalizedUtcDate` (~L15-42), `GetTimeZoneOffsetInMinutes` (~L53), `GetCurrentDateInTimeZone` (~L79), `GetCalendarWeekRange` (~L96, an existing helper that already converts between localized-UTC and real UTC: compare its convention)
- `src/reminders-display-utils.js` — `FormatReminderAge` (~L232), `BuildCompactReminderLine` (~L250-270), `BuildCompactTextForReminder` (~L304-345, the age at ~L318-324), and `~L446` (another `GetCurrentDateInTimeZone` use; check it is not affected)
- `src/web-api.js` — ~L585-645 (`NowInTimeZone`, `AgeDays`, `display.ageDays`) and ~L660 (`display.timeZone` in the export)
- `src/chat-commands/show-rebalance-reminders-command.js` — `BuildDisplayReminderLines` (~L159-205)
- `tests/date-utils.test.js`, `tests/reminders-display-utils.test.js`, `tests/show-rebalance-reminders-command.test.js`, `tests/web-api-reminders.test.js` (existing homes for the new cases)

Production evidence (read-only, gathered by the producer; you cannot re-query it): on 2026-11-04 the digest ran at `2026-11-04T16:30Z` for a workspace on `America/Los_Angeles` and labelled two reminders `created today` whose `CreatedOn` were `2026-11-03T23:37:01.631Z` and `2026-11-03T13:39:22.200Z`. The second had also been labelled `created today` by the 2026-11-03 16:30Z digest.

Questions:

1. **True-bug confirmation.** Using only the source, explain what `GetCurrentDateInTimeZone('America/Los_Angeles').getTime()` returns relative to `Date.now()`, and therefore what `reminders-display-utils.js:318-324` computes. Measure it with a read-only probe (pure `DateUtils` + arithmetic on the two `CreatedOn` values above at a fixed "now" of `2026-11-04T16:30:00Z`; you may stub `Date` or reimplement the one-line subtraction) and quote the output. Does the current code produce `0` (→ `created today`) for both? Is this a defect rather than intended behaviour (check the JSDoc on `FormatReminderAge` and the GH-250 intent it cites)? Is it present on this branch's HEAD?
2. Is the same frame-mixing defect present at `src/web-api.js:625-627`? Is `show-rebalance-reminders-command.js:186-189` free of the frame bug but still elapsed-hours based, as the plan claims?
3. Is **calendar-day difference in the workspace time zone** the right semantics for a label that reads "created today / 1 day old"? Or is the smaller fix (use real `Date.now()`, keep elapsed 24 h floor) sufficient? Answer against the observed `23:37Z` case.
4. Is the proposed `DateUtils.GetCalendarDaysBetween` correct: localize both instants with the existing `GetLocalizedUtcDate`, take `Date.UTC(y,m,d)` midnights, `Math.round` the difference? Check DST (the 2026-11-01 PT fall-back), positive offsets (`Asia/Kolkata`), and a `CreatedOn` in the future. Is extending `DateUtils` the right owner, or does an existing helper already do this (search for one before agreeing)?
5. Is the rebalance-view fallback to `'UTC'` when `display.timeZone` is missing reasonable and consistent with that file?
6. Are the planned test cases falsifiable with a red control against the current code, scoped to existing suites, and sufficient? Is anything missing (e.g. a consumer that reads `display.ageDays` and would break), or over-built?
7. Is the rating `40/30/50/85` and its rationale grounded?

Flag anything wrong, missing, mis-scoped, or over/under-engineered. Cite file:line. Every [Blocker]/[Should] asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines.

Start your verdict with a one-line `TRUE BUG: yes|no — <reason>` before the plan findings. Write your verdict below and set STATUS to Approved if the bug is confirmed and the plan can proceed as written (Nits allowed); otherwise leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
