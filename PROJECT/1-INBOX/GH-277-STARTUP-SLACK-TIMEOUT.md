---
title: "GH-277: bound each workspace's Slack startup so one stalled connection cannot hang every workspace"
status: Inbox (1-INBOX)
created: 2026-10-23
updated: 2026-10-23
owner: noel
branch: fix/AEGIS-Sleuth-Slackbot-gh277-startup-hang-2026-10-23
doc_type: project
gh_issue: 277
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/277
rated: 85/85/50/70
phases: 1
non_goals:
  - No background reconnect or retry scheduler for a skipped workspace (a restart recovers it)
  - No change to runtime Socket Mode error handling: a runtime exit stays an exit, which systemd's Restart=on-failure already recovers
  - No systemd watchdog / sd_notify integration, no new health endpoint
  - No timeout on non-Slack startup steps (disk loads, AI connectivity test already bounded by its provider)
related:
  - "#272 (same incident window; identifying details in the private tracker)"
goal: >
  A Slack connection that does not complete for one workspace must fail that workspace's startup after a
  bounded wait, so the existing per-workspace catch skips it and every other workspace starts.
---

# GH-277 — bound each workspace's Slack startup

## Status

| What was just completed | What's next |
|---|---|
| Issue filed; recon traced the hang to an unbounded `await this.#SlackBoltApp.start()`; plan drafted. | Codex plan QA, then implement. |

## Observed problem

Production, 2026-10-22 16:09 UTC: after two crash-restarts on Slack `invalid_auth` / `fatal_error`, the third start reached the
first workspace, logged `registered 11 catalog regex aliases` (`ChatModule.StartAsync`, `src/chat-module.js:786`), then a 503,
`Slack API connectivity test succeeded` (`src/slack-app.js:1772`, after the web client's own retry), then two more 503s, and
**nothing for 14 hours**. Every later workspace stayed down; `systemctl` reported `active`.

## Recon (base `c53412b`)

- **Startup loop:** `src/app.js:298-443`, sequential. Per workspace, after module construction:
  `ChatModule.StartAsync` → `SlackAppInstance.StartAsync` (`:369`) → `RemindersModule.StartAsync` → Lists → Notion → CodeTaskRelay,
  all inside `try { … } catch(error) { logger.error('failed to start workspace …, skipping:') … continue; }` (`:358-389`).
  So a **rejection** already skips one workspace and continues; a **promise that never settles** blocks the loop forever.
- **Slack start:** `SlackApp.StartAsync` → `#InitializeClientAsync(ArgStats, true)` (`src/slack-app.js:468-470`, `:1732-1798`):
  `new App({ socketMode: true, … })`, `await client.auth.test()` (bounded only by `@slack/web-api` 7.17.0's default retry policy),
  handler registration, then **`await this.#SlackBoltApp.start()` (`:1797`) with no bound**. The production log places the hang
  here: auth.test succeeded at 16:09:18, the next two 503s are Socket Mode's `apps.connections.open` attempts, and `start()`
  never resolved or rejected. Bolt 4.6.0 / socket-mode 2.0.5 internals were not traced further; the fix does not depend on why
  the library promise stays pending.
- **Restart policy:** `sleuth-app.service:104-105` `Restart = on-failure`, `RestartSec = 1`: a process exit is already recovered
  (that is how 16:08:53 and 16:09:08 came back). A hang is not.
- **Other callers of `#InitializeClientAsync`:** `ConnectOneShotAsync` (`:478`, operator tooling, `ArgStartSocketMode=false`)
  never calls `start()`, so it is unaffected.
- **Tests:** Bolt is mocked with `jest.mock('@slack/bolt', …)` exposing `start`/`stop`/`client.auth.test`
  (`tests/slack-app-observability.test.js:6-31`); no test covers `src/app.js`'s loop.
- **Untraced:** whether other startup awaits (Reminders/Lists/Notion network calls) can also hang; named as a risk, not fixed here.

## Preflight bet check

- **Outcome:** a stalled Slack connection costs at most one workspace and a bounded delay, never the whole bot, and is visible.
- **Smallest bet:** time-box `start()` (and the auth check, same seam) inside `SlackApp`; on timeout, stop the half-started app
  and throw. The existing loop catch does the rest.
- **Alternatives rejected:** (a) parallel workspace startup: larger change to ordering assumptions in `app.js`, and a hung
  workspace would still be silently down; (b) systemd watchdog: needs sd_notify plumbing and still restarts everything;
  (c) background reconnect for skipped workspaces: real value, but a new scheduler (non-goal; revisit if a skip happens again).
- **Rollback:** revert the commit; or set `SLACK_START_TIMEOUT_MS=0` to disable the bound without a redeploy.

## Plan

1. `src/slack-app.js`: add a small module-level `WithTimeoutAsync(promise, ms, label)` helper (rejects with a labelled error
   after `ms`; `ms <= 0` → no bound; clears its timer either way). Read `SLACK_START_TIMEOUT_MS` (default **60000**, integer,
   invalid → default) once per start.
   - Wrap `client.auth.test()` and `this.#SlackBoltApp.start()` in it.
   - On a `start()` timeout: log ERROR naming the workspace and the timeout, best-effort `await this.#SlackBoltApp.stop()`
     (ignore its error), reset `#SlackBoltApp = null` / `#SlackBoltAppStarted = false` so `StopAsync` is a no-op, then throw.
   - A late resolution/rejection of the abandoned `start()` promise must not become an unhandled rejection (attach a no-op catch).
2. `src/app.js`: no change to the loop (its catch already logs `failed to start workspace X, skipping:` and continues).
3. `AGENTS.md` §12: document `SLACK_START_TIMEOUT_MS` (default, `0` disables, why).
4. `CHANGELOG.md`: Unreleased entry.

## Acceptance checks

- **Unit (existing Bolt mock pattern, new test file `tests/slack-app-start-timeout.test.js`):**
  - `start()` that never resolves + `SLACK_START_TIMEOUT_MS=50` → `StartAsync` rejects with a timeout error naming the
    workspace; `stop()` was called; ERROR logged. Red control: fails on the base commit (hangs → jest test timeout).
  - `auth.test()` that never resolves → same rejection path.
  - `start()` resolving normally → `StartAsync` resolves (no regression); timer cleared (no open handle).
  - `SLACK_START_TIMEOUT_MS=0` → no bound applied.
- **Loop behaviour (focused test over the existing catch):** a minimal check that a rejected workspace start is skipped and a
  second workspace still starts is **not** added: `app.js` has no test harness and building one exceeds this change. Covered by
  the smoke instead.
- **Smoke (manual, recorded under `TESTS-RESULTS/2026-10-23+GH-277/`):** main path: run the real `SlackApp.StartAsync` with a
  Bolt stub whose `start()` never settles → rejects at the bound; adjacent path: a normal `start()` → resolves, and a second
  `StartAsync` after `StopAsync` works.
- Full suite, build, validators, sanitize scan on the final commit.

## Risks

- **Default too short** for a slow-but-healthy connect: 60 s is ~20× the observed healthy start (≈1–3 s per workspace).
  Tunable by env without a redeploy.
- **Skipped workspace stays down until the next restart.** Visible via the ERROR line; background reconnect is a named non-goal.
- **Library state after `stop()` on a half-started Socket Mode client** is not fully known; `stop()` errors are swallowed and the
  instance is discarded.

## Rating rationale (2026-10-23)

`rated 85/85/50/70`. Severity 85: a full-bot outage (all workspaces, no mentions, no digest) for 14 hours, silently; recoverable
by restart, no data loss. Priority 85: severity-led; production already hit it once. Appeal 50: neutral (no user score).
Effort 70: one seam, one helper, existing mock pattern. Recurrence: 1 incident in the last 14 days (2026-10-22), none known in the
prior 14 (journal coverage only from 2026-10-11); trend unknown.
