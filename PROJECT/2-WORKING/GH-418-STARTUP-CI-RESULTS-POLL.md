---
title: "Startup GH Actions follow-up should report real test results, not 'in_progress'"
status: Marathon-ready (2-WORKING)
created: 2026-07-17
updated: 2026-07-17
owner: noel
branch: development
doc_type: bugfix
gh_issue: 418
source: https://github.com/NeochromeTeam/sleuth-app/issues/418
related: "GH-408 (friendly CHANGELOG tone) — same boot-message surface; startup-message changelog-leak fix (v1.4.238) prompted this follow-up"
effort: 2
complexity: 2
risk: 1
phases: 1
goal: >
  The startup GitHub Actions follow-up (src/github-actions-startup-summary.js) fires a single
  check 4 seconds after boot, long before CI/deploy finish, so it always reports "in_progress"
  instead of the real pass/fail outcome. Replace the fixed-delay single check with a bounded poll
  so the boot message reports the actual completed result.
---

# GH-418 — startup CI-results poll

## Status

| What was just completed | What's next |
|---|---|
| Not started. Filed 2026-07-17 after operator observed the v1.4.238 boot message report `Run Tests in_progress (#665, ae2bfab, 5s)` instead of a completed result. | Build the bounded-poll change below; not yet started. |

## Context

`src/app.js` (`PostStartupNotificationAsync`) calls `ScheduleStartupGitHubActionsSummaryFollowUp`
(`src/github-actions-startup-summary.js`) with `DelayMs: STARTUP_GITHUB_ACTIONS_DELAY_MS` — currently
`FOLLOW_UP_DELAY_MS = 4000` (4 seconds). That single check almost always lands while the `Run Tests` /
`Deploy to Production` GitHub Actions workflows are still `in_progress` (they typically take ~1-2
minutes end to end per `.github/workflows/ci.yml`'s own comments and its 10-minute safety-net
timeout), so the follow-up Slack message reports a mid-run snapshot rather than the real outcome.

The feature is fully opt-in and already gated: `HasStartupGitHubActionsConfig` requires
`GITHUB_PAT` + `GITHUB_ACTIONS_REPO` on the workspace, and the whole follow-up is itself subordinate
to `STARTUP_MESSAGE_INCLUDE_CHANGELOG` (`ShouldIncludeStartupChangelog` in `src/startup-message.js`).
Failure is already best-effort (a caught/logged warning, never blocks boot).

## Scope for the fix

- In `src/github-actions-startup-summary.js`, replace the one-shot `setTimeout` +
  `PostStartupGitHubActionsSummaryFollowUpAsync` call with a bounded poll: check at the first delay;
  if `BuildRunStatusLabel` still resolves to a non-`completed` status, wait and re-check (e.g. every
  30-60s) up to a total max wait (~5 minutes — comfortably inside `ci.yml`'s 10-minute job timeout).
  Post whatever the final state is on completion, or the last-seen state if the max wait elapses
  (never silently drop the message — an honest "still running after 5 min" beats silence).
- Keep the existing architecture: a separate follow-up Slack message via `PostMessageTextAsync`
  (`PostStartupGitHubActionsSummaryFollowUpAsync`), not an in-place `chat.update` edit of the original
  boot post. Lower risk, reuses the already-tested code path, and Slack already visually groups the
  two consecutive bot messages under one avatar/timestamp (confirmed live in the v1.4.238 boot
  message screenshot), so the visible effect reads the same as "updating" the boot message.
- Update `FOLLOW_UP_DELAY_MS`/timeout defaults and add a `MAX_POLL_WAIT_MS` constant (plus a
  poll-interval constant) alongside the existing `DEFAULT_TIMEOUT_MS` — `MAX_POLL_WAIT_MS` is the
  fix-probe marker below, so the exact name matters; rename it there too if you rename it in code.

### QA gate
- [ ] A run that's still `in_progress` at the first check gets re-checked and eventually reports the
      real completed conclusion (success/failure), not `in_progress`.
- [ ] A run that never completes within the max wait reports the last-seen state once, then stops
      polling (no unbounded timers).
- [ ] Existing `tests/github-actions-startup-summary.test.js` behavior (config gating, timeout
      handling, Slack formatting) still passes unchanged.
- [ ] `npm test` green.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest github-actions-startup-summary --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/github-actions-startup-summary.js", "pattern": "MAX_POLL_WAIT_MS" }
  ],
  "artifacts":   [
    "src/github-actions-startup-summary.js",
    "tests/github-actions-startup-summary.test.js",
    "src/app.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-418 — bounded poll replacing the single fixed-delay CI-status check" },
  "lanes":       { "agy_safe": [ "src/github-actions-startup-summary.js", "tests/github-actions-startup-summary.test.js" ], "orchestrator_only": [ "src/app.js" ] }
}
```

## Progress log
- 2026-07-17: filed as GH-418 during operator QA of the startup-message changelog-leak fix
  (v1.4.238); promoted straight to `2-WORKING` with a preflight contract since it's a small,
  single-phase, low-risk change, and added to `PROJECT/2-WORKING/MARATHON-PLAN-2026-07-17.md`.
  First contract draft used the wrong probe type (`path_absent` on an already-existing file →
  false STALE verdict); corrected to `grep_absent` on a new `MAX_POLL_WAIT_MS` marker constant.
  `.xyz/utils/swarm-preflight.sh --gh-issue 418 --dry-run` now verdicts **ready (exit 0)**.
