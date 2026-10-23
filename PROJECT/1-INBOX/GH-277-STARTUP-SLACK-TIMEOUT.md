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

- **Startup loop:** `src/app.js:298-453`, sequential. Per workspace, after module construction:
  `ChatModule.StartAsync` → `SlackAppInstance.StartAsync` (`:369`) → `RemindersModule.StartAsync` → Lists → Notion → CodeTaskRelay,
  all inside `try { … } catch(error) { logger.error('failed to start workspace …, skipping:') … continue; }` (`:358-451`).
  So a **rejection** already skips one workspace and continues; a **promise that never settles** blocks the loop forever.
- **Slack start:** `SlackApp.StartAsync` → `#InitializeClientAsync(ArgStats, true)` (`src/slack-app.js:468-470`, `:1732-1798`):
  `new App({ socketMode: true, … })`, `await client.auth.test()` (bounded only by `@slack/web-api` 7.17.0's default retry policy),
  handler registration, then **`await this.#SlackBoltApp.start()` (`:1797`) with no bound**. The production log places the stall
  here: auth.test succeeded at 16:09:18, the next two 503s are Socket Mode's `apps.connections.open` attempts. Socket Mode's own
  WebClient retries up to 100 times with factor 1.3 (`node_modules/@slack/socket-mode/dist/src/SocketModeClient.js:103-107`) and
  the HTTP request timeout defaults to 0 (`node_modules/@slack/web-api/dist/WebClient.js:128,157`), so there is no useful wall-clock
  bound; retry count is not a deadline. The logs show a stalled start, not proof that the promise is pending forever; the fix
  does not depend on which.
- **Restart policy:** `sleuth-app.service:104-105` `Restart = on-failure`, `RestartSec = 1`: a process exit is already recovered
  (that is how 16:08:53 and 16:09:08 came back). A hang is not.
- **Line refs:** the startup loop is `src/app.js:298-453`; the per-workspace try is `:358-451`, its catch `:445-451`.
- **Other callers of `#InitializeClientAsync`:** `ConnectOneShotAsync` (`:478`, operator tooling, `ArgStartSocketMode=false`)
  never calls `start()` but shares the auth step, which this change bounds too (intentional).
- **Failed-workspace cleanup (pre-existing gap):** the catch at `src/app.js:445-451` stops only Chat and Slack, yet Stats
  (`:315`, repeating save timer) and PluginLoader (`:331`) have already started; shutdown arrays get them only on success
  (`:427-434`).
- **Bolt constructor auth:** without `deferInitialization`, `new App` starts an `auth.test` with no rejection handler
  (`node_modules/@slack/bolt/dist/App.js:190,801,822-837`).
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

## Plan (revised after plan QA round 1)

1. `src/slack-app.js`, all inside `#InitializeClientAsync` (`:1732-1798`):
   - Construct Bolt with `deferInitialization: true` (supported option, `node_modules/@slack/bolt/dist/App.js:81,182-188`), so
     the constructor no longer fires an unowned `auth.test` (`App.js:190,801,822-837`). Then `await app.init()` (`App.js:207-238`),
     which performs that auth check itself, with token verification kept on.
   - A small module-level `WithTimeoutAsync(promise, ms, label)` helper: rejects with a labelled `Error` after `ms`, clears its
     timer when the promise settles first; `ms === null` means no bound.
   - `SLACK_START_TIMEOUT_MS` contract, read once per start: unset or blank → **60000**; exactly `0` → no bound; a positive
     integer ≤ 2147483647 → that value; anything else (negative, fractional, non-numeric, too large) → 60000 with one WARN.
   - Bound, each separately: `app.init()`, the explicit `client.auth.test()` (`:1756`), and, for the event loop only,
     `app.start()` (`:1797`). Sequential bounds can total ≈3× the value per workspace (documented).
   - **Timeout cleanup with late ownership (F1):** on a `start()` timeout, log ERROR naming the workspace, **first** retire the
     instance (`this.#SlackBoltApp = null`, `#SlackBoltAppStarted = false`, keeping a local reference `BoltApp`), then
     best-effort `stop()` now, **and** attach `startPromise.then(() => BoltApp.stop()).catch((error) => log WARN)`, a single
     trailing catch that owns both a late start rejection and a late `stop()` rejection (F1a). A start that completes after the
     timeout is therefore stopped as soon as it connects (socket-mode's `disconnect()` cannot cancel a pending URL request,
     `SocketModeClient.js:138-184`).
   - **Ingress fence (F1b):** the three Bolt registrations (`event('reaction_added')`, `event('app_mention')`, `message(...)`, and
     each `action(...)`, `src/slack-app.js:1781-1795`) are registered through a guard that returns immediately unless the
     callback's own Bolt instance is still `this.#SlackBoltApp` (identity check, so a retired instance or a wrapper reused for a
     new start can never reach handlers or the cleared stats). No new registry.
   - A timed-out `init()`/`auth.test()` gets the same late `.catch(() => {})` so its eventual rejection is never unhandled.
   - `ConnectOneShotAsync` (`:478`) shares `init()` + `auth.test`; bounding them there is intentional (operator tooling must not
     hang either).
2. `src/app.js` catch (`:445-451`) **(F2):** add best-effort `StopAsync()` for the already-started `PluginLoaderInstance` and
   `StatsModuleInstance` (started at `:315`, `:331`; Stats owns a repeating save timer, `src/stats-module.js:172-181`), in reverse
   start order after Chat and Slack. Existing owners' stop methods only; no new lifecycle code.
3. `AGENTS.md` §12: document `SLACK_START_TIMEOUT_MS` (contract above, why, ≈3× per-workspace total).
4. `CHANGELOG.md`: Unreleased entry.

## Acceptance checks

- **Unit (existing Bolt mock pattern, `tests/slack-app-observability.test.js:6-31`; new file
  `tests/slack-app-start-timeout.test.js`), with the timeout set small:**
  - `start()` never settles → `StartAsync` rejects naming the workspace; `stop()` called; ERROR logged. **Red control:** on the
    base commit the same test never settles (jest test timeout).
  - `start()` settles **after** the timeout → `stop()` called again once it resolves (late ownership); and with that late
    `stop()` rejecting → WARN logged, no unhandled rejection (F1a).
  - After a timeout, invoking the retired instance's captured message / app_mention / reaction / action callbacks (payload
    `{ message: { text: 'hello', channel: 'C_FAKE', user: 'U_FAKE', ts: '1.0' } }`) reaches no handler, touches no cleared
    state, and does not throw, including after the same wrapper is started again (F1b).
  - The updated Bolt mock exposes `init()`.
  - `init()` never settles, and explicit `auth.test()` never settles → each rejects through the same path; a later rejection of
    the abandoned promise produces no unhandled rejection.
  - Bolt constructed with `deferInitialization: true` and `init()` awaited.
  - `start()` resolves normally → `StartAsync` resolves; no timer left pending.
  - Env contract: unset → 60000; `0` → no bound; `-5`, `1.5`, `abc`, `9999999999` → 60000 + WARN.
- **Smoke on the real orchestration path (F4; disposable clone, recorded under `TESTS-RESULTS/2026-10-23+GH-277/`):** run
  `node src/app.js` with a temp `SLEUTH_DATA_DIR` holding two fake workspaces (A, B) and a `node -r` preload that stubs
  `@slack/bolt` so A's `start()` never settles and B's resolves, and stubs the AI connectivity probe
  (`WorkspaceAI.prototype.TestConnectivityAsync` → ok; the real one calls OpenAI, `src/app.js:352`), with the fixture's optional
  integrations left unconfigured and the web API on a free port, so nothing leaves the machine. Expect: A logs the timeout and
  `failed to start workspace A, skipping`, A's Stats timer and PluginLoader stopped, B logs `workspace modules started: B`.
  **Red control:** the same run on the base commit never reaches B. Adjacent path: both workspaces healthy → both start.
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
