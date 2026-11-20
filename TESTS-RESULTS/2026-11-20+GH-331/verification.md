# GH-331 / GH-332 verification

Base `6325509` (origin/development). Branch head at time of record `eddcd1c`.

## GH-331 — poll cycle crash

- **Red** ([red.log](red.log)): new test `GH-331: completes in the production load order` on unchanged code fails; logged error `[github-sync] workspace TestWorkspace heartbeat cycle error: TypeError: RemindersModule.GetReminderVersion is not a function` (the production error).
- **Green** ([green.log](green.log)): same test passes after the fix; focused suites `github-sync-module`, `github-comment-relay`, `reminders-module`: 137 passed.
- **Smoke (manual check)** — [gh331-production-order-probe.js](gh331-production-order-probe.js): plain Node, `require('reminders-module')` then `require('github-sync-module')` (app.js order), one `RunNowAsync` over one reminder whose link a stubbed fetch reports closed; app not started.

| Code | Output | Verdict |
|---|---|---|
| this branch | `ok=true completed=1 cycleErrors=0` | pass |
| origin/development (unfixed) | `ok=false completed=0 cycleErrors=1`, error `RemindersModule.GetReminderVersion is not a function` | reproduces production |

Production confirmation (pending deploy): `[github-sync] … GetReminderVersion is not a function` should stop appearing in `journalctl -u sleuth-app`.

## GH-332 — retire-closed-issue-reminders finder

- Tests ([tests/retire-closed-issue-reminders.test.js](../../tests/retire-closed-issue-reminders.test.js)): 2 passed — five classes with a fake `gh`, merged and closed-unmerged PRs, one lookup per unique link, failed lookup → `unknown`, review file mode 600, empty backup, non-array and missing argument exit 2.
- **Red control** ([gh332-mutation-unknown-as-closed.log](gh332-mutation-unknown-as-closed.log)): mutating `Classify` to count a failed lookup as closed fails the test (`all-closed=3 … unknown=0`); restored.
- **Smoke (manual check)** on real private backups (copies under `~/secrets/sleuth/`, not committed; live read-only `gh` REST calls). Aggregate lines only; per-reminder rows contain client text and stay private.

| Path | Input | Summary line | Verdict |
|---|---|---|---|
| main | neochrome backup before the 2026-11-20 manual retire (31) | `reminders=31 links=15 all-closed=0 mixed=2 unknown=0 open=8 none=21`, mixed = `da08a515`, `8b40ea21` | matches the manual run exactly |
| adjacent: rerun after retire | neochrome backup after retiring `da08a515` (30) | `reminders=30 links=12 all-closed=0 mixed=1 unknown=0 open=8 none=21`, mixed = `8b40ea21` | pass |
| adjacent: empty workspace | backup with `[]` | `reminders=0 links=0 all-closed=0 mixed=0 unknown=0 open=0 none=0` | pass |

All three review files were created mode `-rw-------`.

## PR #333 review follow-up (Greptile + CodeRabbit)

- Link pattern made case-insensitive (`gi`, as in `src/github-url-utils.js`); new test `a link written with a capitalised host still counts` fails on the previous finder ([gh332-case-red.log](gh332-case-red.log): `all-closed=1 … links=1`) and passes now (3 passed).
- Finder and test identifiers renamed to `docs/coding-conventions.md` (single-word lowercase, `Arg` parameters); no behaviour change. The probe receipt keeps the names it ran with.
- Smoke rerun on the same private backups: identical summary lines (31/15/0/2, 0, 30/12/0/1).
