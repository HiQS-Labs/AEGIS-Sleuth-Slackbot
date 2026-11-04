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

## Codex review — 2026-11-04

TRUE BUG: yes — current source mixes localized-UTC now with real creation instants, and elapsed-day flooring also mislabels yesterday's reminders.

**Changes requested to the verification plan; implementation design accepted. STATUS remains Open.**

`src/date-utils.js:79-80` delegates to `GetLocalizedUtcDate`; lines 24-43 format local wall-clock fields then reconstruct them with Date.UTC. The resulting epoch is real now plus the zone offset, with milliseconds discarded. `src/reminders-display-utils.js:318-324` and `src/web-api.js:625-627` subtract real creation timestamps from this shifted epoch. Both expressions remain in the seeded checkout; no git command was run.

Read-only command: `node` with the following stdin, exit **0** (only pure DateUtils loaded):

```js
const D = require('./src/date-utils');
const now = new Date('2026-11-04T16:30:00Z');
const local = D.GetLocalizedUtcDate('America/Los_Angeles', now);
console.log(now.toISOString(), local.toISOString(), (local-now)/3600000);
for (const c of ['2026-11-03T23:37:01.631Z','2026-11-03T13:39:22.200Z'])
  console.log(c, Math.floor((local-new Date(c))/86400000),
    Math.floor((now-new Date(c))/86400000));
```

Decisive output (current floor, real elapsed floor):

```text
2026-11-04T16:30:00.000Z 2026-11-04T08:30:00.000Z -8
2026-11-03T23:37:01.631Z 0 0
2026-11-03T13:39:22.200Z 0 1
```

Both current results mean “created today”. `FormatReminderAge` JSDoc (`src/reminders-display-utils.js:225-235`) identifies creation age as metadata distinct from due date under GH-250. “Whole days” alone could mean elapsed time, but “created today” plus the explicit requirement settles calendar semantics. Real-now-only subtraction still fails the first incident. The rebalance renderer (`src/chat-commands/show-rebalance-reminders-command.js:165,186-189`) uses real NowMs: no frame bug, but the calendar-label error remains.

The proposed DateUtils helper is the appropriate owner. Graph discovery was attempted but denied with “MCP tool call requires approval, but approval policy is never”; direct source search found no existing day-difference helper. `GetCalendarWeekRange` (`src/date-utils.js:96-115`) explicitly separates localized boundaries from real epochs; its range contract is not a day ordinal. Use **getUTCFullYear/getUTCMonth/getUTCDate** on localized dates.

I measured the proposed helper arithmetic in the same exit-0 Node probe:

```js
function days(tz, from, to) {
  const midnight = value => {
    const d = D.GetLocalizedUtcDate(tz, new Date(value));
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return Math.round((midnight(to)-midnight(from))/86400000);
}
```

Output: incident cases **1, 1**; PT 08:01Z and 07:59Z against fixed now **0, 1**; Kolkata Nov 4 17:00Z → 19:00Z **1**; PT Oct 31 19:00Z → Nov 2 19:00Z **2** across fall-back; future Nov 5 16:30Z → fixed now **-1**. Civil-date ordinals avoid DST duration errors. The formatter maps negative values to “created today”; export ageDays remains signed, consistent with its existing possible negatives.

`NowInTimeZone` (`src/web-api.js:589`) has no other use in that method. Due bucketing (`src/reminders-display-utils.js:446-474`) compares localized due dates with localized boundaries and is outside this age defect. UTC fallback for old exports is reasonable and consistent with this file's configuration fallback. Preserve invalid-createdOn fallbacks. Source search for ageDays found the API producer, this renderer (which uses baked age only when createdOn is invalid), and tests; no additional in-repo consumer needing migration was found. External mirror/dashboard consumers were not independently verified; the numeric field shape stays unchanged.

### Required plan correction

[Should] Make the existing compact-render check deterministic under calendar semantics and explicitly cover the API producer. Locations: plan lines 68-78; `tests/reminders-display-utils.test.js:268-283`; `tests/web-api-reminders.test.js:220`.

Observed input: the existing UTC compact-render test sets CreatedOn to now minus **73 hours** and always expects “3 days old”. At UTC 00:30, that creation date is four calendar dates earlier: the fix makes this test clock-dependent. The API test only checks that ageDays is a number; helper and rebalance tests can pass with the API swap omitted.

Affected scope: compact-render test stability and export age correctness. Extend existing suites only.

Falsifier: freeze the compact-render clock (e.g. noon UTC with explicit expected civil dates), and specify one fixed-clock API assertion using the PT incident input → ageDays 1. Leaving `src/web-api.js:626` unchanged must fail that assertion. Retain the planned live-render smoke or equivalent existing-suite assertion to verify adoption there. Record these adjustments explicitly in the plan.

### Nits and limits

- Include the existing `tests/date-utils.test.js` in the focused test command. Full npm test covers it eventually.
- Red control means the defect-specific assertions fail; same-day controls should pass. A missing-helper error alone does not prove call-site adoption.
- Future-date formatter behavior can be included cheaply in existing cases; no new machinery is warranted.
- Rating 40/30/50/85 is proportionate for a bounded display defect and small implementation. “Every reminder list for every workspace not on UTC” overstates universality: many individual labels remain correct, and the calendar error can occur in UTC too. The producer's recurrence search and subjective appeal were not independently revalidated.
- **[Unverified — needs clone run]** No test suite, executable fixture, validate.sh, app startup, or PDDA executable was run here. Pure date arithmetic was measured; integration tests and final gates remain for the disposable clone/harness.


### Producer · Round 2 (claude-a)

- **TRUE BUG: yes — accepted.** Your probe matches the production observation (0/0 now; 1/1 with the helper).
- **R1 [Should] — Accepted.** Plan step 5 now: freeze the clock in the existing parity test
  (`tests/reminders-display-utils.test.js:262-283`) at noon UTC with an explicit 3-civil-day-old
  `CreatedOn`; add a fixed-clock PT call-site case (incident input → `· 1 day old`); add a fixed-clock
  API assertion in `tests/web-api-reminders.test.js` (incident input → `display.ageDays === 1`) that
  must fail with `src/web-api.js:626` unchanged.
- **Nits — Accepted.** `tests/date-utils.test.js` added to the focused command; red control redefined
  as defect-specific assertions failing while same-day controls pass; helper uses
  `getUTCFullYear/getUTCMonth/getUTCDate` on localized dates; invalid-`createdOn` fallbacks preserved;
  rating rationale wording narrowed (score unchanged).
- Future `CreatedOn`: helper returns a signed value; formatter keeps mapping `<= 0` to `created today`.

Please re-review the revised plan (`PROJECT/1-INBOX/GH-297-REMINDER-AGE-LABEL.md`, step 5 and Rating). Set STATUS to Approved if R1 is resolved.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
