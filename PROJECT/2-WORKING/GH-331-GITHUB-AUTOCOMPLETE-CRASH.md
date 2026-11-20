---
title: Restore GitHub auto-complete and add a closed-issue reminder review skill
gh_issue: 331
related_issues: [332]
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/331
status: In Progress
created: 2026-11-20
updated: 2026-11-20
owner: Claude
goal: Reminders whose linked GitHub issues/PRs are all closed are completed by the server again, and the mixed/unknown cases the server skips can be reviewed and retired with an existing-writer skill.
doc_type: bugfix
effort: 2
complexity: 2
risk: 2
phases: 1
---

# GH-331 / GH-332 — GitHub auto-complete crash and closed-issue review skill

## Status

| What was just completed | What's next |
|---|---|
| Plan QA PASS/Approved (Codex, round 1, `relay-system/2026-11-20/gh331-plan.md`); nits folded in | Implement #331 red/fix, then #332 finder, test and SKILL.md |

## Issues

| Issue | Scope | Acceptance check | Rating | State |
|---|---|---|---|---|
| [#331](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/331) | Fix `GetReminderVersion is not a function` in the poll cycle | New test in production load order fails before, passes after; existing sync suite green | 80/70/50/90 | planned |
| [#332](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/332) | `skills/retire-closed-issue-reminders` (read-only finder + workflow) | Finder test over a fake `gh`: all-closed/mixed/open/unknown/none classes, lookup failure never counts as closed, private output mode 600, empty and malformed input | 45/20/50/75 | planned |

Both ship in one PR: one outcome (closed-issue reminders get retired), no shared code.

## Requirements and smallest viable bet

**#331.** Production logs (2026-11-13 to 2026-11-20) show 335 identical errors, one per 30-minute cycle: `TypeError: RemindersModule.GetReminderVersion is not a function` at `src/github-sync-module.js:258` (inside `#PollGitHubStatusesAsync`, called from the scheduled `ProcessPollAsync`). The cycle throws on the first eligible reminder, so `EvaluateAutoComplete` never completes anything. Smallest fix: read the version through a call-time `require('./reminders-module')` at that one site, with a comment naming the cycle. Non-goals: no change to the auto-complete rule, the version check, notification wording, heartbeat, polling interval, or to `reminders-module`/`github-comment-relay` load structure.

**#332.** Operator asked for a repeatable skill on top of `bulk-edit-reminders`. Once #331 lands, the server handles reminders whose `GitHubUrls` are all closed. The skill covers the rest: links found only in the reminder text, mixed closed/open links, and links whose state cannot be read. Smallest bet: `skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs` (read-only: backup file in, classification out) plus a SKILL.md workflow that reuses `bulk-edit-reminders` for backup, dry-run, `--complete` and the verification backup. Non-goals: no Sleuth API client, no writes, no scheduling/daemon, no model calls inside the script (reviewing candidates is an agent step in SKILL.md), no change to `bulk-edit-reminders`.

## Recon and evidence

Base `6325509` (origin/development; `main` is `410627b`, same `src/`).

- Cycle: `src/reminders-module.js:32` requires `./github-comment-relay`; `src/github-comment-relay.js:3` requires `./github-sync-module`; `src/github-sync-module.js:2` requires `./reminders-module`, which at that point is the partial export `{}` (its `module.exports = RemindersModule` is at the end of the file). `src/app.js:17` loads `reminders-module` before `github-sync-module` (line 20), so production always takes the cycle path.
- `4a85035` (GH-301, 2026-11-07) added `RemindersModule.GetReminderVersion(CurrentReminder)` at line 258, the binding's first runtime use. Every other use in the file is a JSDoc type. `GetReminderVersion` is a static on the class (`src/reminders-module.js:848`).
- `tests/github-sync-module.test.js:3` requires `github-sync-module` first, so the suite loads `reminders-module` in full and never sees `{}`. That is why CI stayed green.
- `CompleteReminderByIdAsync(id, reason, { ExpectedVersion })` already guards stale completion; unchanged.
- Skill reuse: `skills/bulk-edit-reminders/bulk-edit-reminders.mjs` owns backup (`backup`, private mode-600 file under `~/secrets/sleuth/backups/`), `--complete`/`--reason`, `--dry-run`, `--tunnel`. The backup record carries `ReminderID`, `ReminderMessageText`, `GitHubUrls`. The 2026-11-20 manual run (31 reminders, 15 links, 2 closed, 0 all-closed, 2 mixed, 1 retired after review) is the workflow this encodes.
- Prior art: no issue or PR covers either item.
- Evidence attribution: the production log counts, the 2026-11-20 manual run and its backups are the producer's read-only observations; raw logs and backups stay private (operator machine, `~/secrets/sleuth/backups/`, not in this repo). Plan QA did not re-read them.

## Rating rationale (2026-11-20)

- **#331 80/70/50/90.** Severity 70: a shipped feature silently disabled in production for 13 days, with work accumulating (stale reminders), recoverable by hand, no data loss. Priority 80: active defect, every cycle, operator time spent retiring by hand. Appeal 50 neutral. Effort 90: one-line fix plus one test. Recurrence: one continuous defect since the 2026-11-07 deploy (335 errors/7 days), not separate incidents.
- **#332 45/20/50/75.** Severity 20: convenience/repeatability. Priority 45: operator-requested now. Appeal 50 neutral. Effort 75: small script, test and doc.

## Plan and falsifiable acceptance

1. **#331 red.** Add a test to `tests/github-sync-module.test.js` that, inside `jest.isolateModules`, requires `../src/reminders-module` first, then `../src/github-sync-module`, and runs `RunNowAsync()` over one reminder whose single link the stubbed fetch reports closed. Expect `CompleteReminderByIdAsync` called once with `{ ExpectedVersion }` and `Result.ok` true. Red on unchanged code: the cycle throws (`GetReminderVersion is not a function`) and nothing is completed.
2. **#331 fix.** At `src/github-sync-module.js:258` use `require('./reminders-module').GetReminderVersion(CurrentReminder)` with a short comment on the cycle. Focused suites: `github-sync-module`, `github-comment-relay`, `reminders-module`.
3. **#332 finder.** `find-closed-issue-reminders.mjs <backup.json>`: collect links from `GitHubUrls` and `github.com/<o>/<r>/(issues|pull)/<n>` in `ReminderMessageText` (deduplicated, source noted); look each unique ref up once with `gh api repos/<o>/<r>/issues/<n>` (REST); classify each reminder `all-closed` (every link closed or merged), `mixed`, `open`, `unknown` (any lookup failed; never treated as closed), `none`. Print a summary and per-reminder rows; write `<backup>.closed-issues.json` (mode 600) holding the all-closed, mixed and unknown reminders with their text and link states for review. Exit 0 on success; exit 2 on usage, unreadable or non-array backup. No network except `gh`.
4. **#332 test.** `tests/retire-closed-issue-reminders.test.js` runs the script in a child process with a fake `gh` on `PATH` (fixture per URL; one URL fails). Assert the five classes, that the failing lookup yields `unknown` not `all-closed`, output mode 600, `[]` input → zero rows exit 0, malformed input → exit 2. Red control: the test fails if lookup failure were counted as closed (asserted directly).
5. **#332 SKILL.md.** Workflow: back up with `bulk-edit-reminders` → run the finder → review every all-closed/mixed/unknown candidate by reading the linked issues (optionally three independent reviewers, then the operator's agent double-checks each retirement) → `bulk-edit-reminders --complete … --reason … --dry-run` → apply → fresh backup whose diff against the pre-write backup shows exactly the retired IDs removed (the backup is pending-only) and every other pending ID unchanged. Note what the server now does on its own after #331, and keep files private.
6. CHANGELOG entry; full gate once on the final commit; smoke: finder on the real 2026-11-20 backup (read-only `gh` calls) plus an empty-backup run; the #331 fix exercised through the new test plus a production-order load probe that requires `reminders-module` then calls the sync module's version path without starting the app. Final Codex relay QA; PR into development.

## Alternatives and rollback

- #331: breaking the cycle by moving `GitHubSyncModule` out of `github-comment-relay` or restructuring `reminders-module` imports was rejected as larger and riskier for the same effect. Using `CurrentRemindersModule.constructor.GetReminderVersion` was rejected: it depends on every caller passing a real class instance (the test harness is a plain object). Rollback: revert the line; the cycle goes back to failing as it does today.
- #332: a server-side change to auto-complete mixed reminders was rejected; a closed link next to an open one does not show the task is done (2026-11-20: one mixed reminder retired, one kept). A skill with its own Sleuth API calls was rejected as a second writer. Rollback: delete the skill folder; nothing else depends on it.
