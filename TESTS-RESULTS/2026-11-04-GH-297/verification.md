# GH-297 verification — 2026-11-04

Code under test: branch `fix/AEGIS-Sleuth-Slackbot-gh297-reminder-age-label-2026-11-04` @ `99a5826`; baseline `origin/development` @ `84ae838`. Local checkout only; nothing ran on a server.

## Focused suites

`npx jest tests/date-utils.test.js tests/reminders-display-utils.test.js tests/show-rebalance-reminders-command.test.js tests/web-api-reminders.test.js` → **4 suites, 122 tests passed**.

## Red control (new tests, previous call sites)

The three `src/` call-site files restored to `84ae838` with the new `DateUtils` helper and tests kept: **3 failed, 119 passed**. The three failures are exactly the defect-specific call-site cases:

- `BuildCompactTextForReminder … labels a reminder created yesterday afternoon (workspace time) as 1 day old (GH-297)`
- `BuildDisplayReminderLines … recomputes ages as calendar days in the export's time zone (GH-297)`
- `GET /workspace/:name/reminders › display.ageDays counts calendar days in the workspace time zone (GH-297)`

The same-day control (`created today`) and the frozen-clock parity test pass on both versions.

## Smoke (real clock, real entry points, stub SlackApp, America/Los_Angeles)

Main path: `BuildCompactTextForReminder` with the two production `CreatedOn` values, a 56-day-old reminder and one created a minute ago. Adjacent path: `BuildDisplayReminderLines` on an export with `display.timeZone`, one without it (older file → UTC fallback), and a rerun on the same input.

Fix:

```text
now 2026-11-04T17:08:57.175Z
MAIN 2026-11-03T23:37:01.631Z -> 1 day old
MAIN 2026-11-03T13:39:22.200Z -> 1 day old
MAIN 2026-09-09T02:57:10.755Z -> 57 days old
MAIN 2026-11-04T17:07:57.176Z -> created today
ADJ export with tz  -> 1 day old
ADJ export no tz    -> 1 day old
ADJ rerun same input-> 1 day old
```

Previous code (`origin/development`), same script:

```text
now 2026-11-04T17:08:57.276Z
MAIN 2026-11-03T23:37:01.631Z -> created today
MAIN 2026-11-03T13:39:22.200Z -> created today
MAIN 2026-09-09T02:57:10.755Z -> 56 days old
MAIN 2026-11-04T17:07:57.278Z -> created today
ADJ export with tz  -> created today
ADJ export no tz    -> created today
ADJ rerun same input-> created today
```

Verdict: **pass**. The old code reproduces the production labels (`created today` for both reminders created the previous PT day); the fix labels them `1 day old` on every path, and a just-created reminder stays `created today`.

## Full gate (`npm run build && npm test`, disposable `-verify` clone @ `99a5826`)

Build passed. Jest: **2931 passed, 2 failed, 4 skipped** (146 of 147 suites; 4 suites red). Every red suite was traced and none touches the changed code:

| Suite | Result on this branch | Same suite on baseline `84ae838` | Cause |
|---|---|---|---|
| `web-api-dashboard`, `web-api-workspace` | failed in `afterAll` (5 s hook timeout) under the parallel run (~400 s per suite) | n/a | load: both pass when rerun with `--runInBand` on this branch |
| `thread-memory` › "stores the row but no embedding when no key/embedder" | fails | **fails identically** | the operator shell exports `GOOGLE_API_KEY`; with it unset the suite passes on this branch (26/26) |
| `command-near-miss-llm` › "resolver never settles -> times out" | 1 of 3 serial runs failed | **1 of 4 serial runs failed** | timing race around `NEAR_MISS_LLM_TIMEOUT_MS` (8000 ms); pre-existing flake |

The four GH-297 suites pass in the full run.

## Repo validators and PDDA

`validate:reminder-render`, `validate:workspace-isolation`, `validate:reminder-pipeline`, `validate:commands`: all ok.

`utils/pdda/pdda.sh run` (observe mode, non-blocking): 50 errors vs 49 on `development`. The only new one is
`pdda-check-roadmap-coverage` for `PROJECT/2-WORKING/GH-297-REMINDER-AGE-LABEL.md`. That check still reads the
frozen legacy `ROADMAP.md`, not `releases.db` (known gap in `ROUTER.md`); the GH-297 row is in the DB
(`roadmap list`: section "In progress", rated 40/30/50/85).
