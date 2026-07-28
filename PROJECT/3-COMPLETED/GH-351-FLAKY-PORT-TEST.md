---
gh_issue: 351
source: https://github.com/NeochromeTeam/sleuth-app/issues/351
title: Flaky test — web-api-workspace.test.js fails with EADDRINUSE :::19877 (fixed port)
status: Completed — shipped 1.4.211 (commit 578b3e7, via marathon automation 2026-07-06); found undocumented during the 2026-07-09 marathon preflight sweep, ledger/CHANGELOG backfilled; issue #351 closed via PR #359
created: 2026-07-05
updated: 2026-07-09
owner: noel
doc_type: project
effort: 1
complexity: 1
risk: 1
phases: 1
goal: >-
  Stop tests/web-api-workspace.test.js from intermittently failing with EADDRINUSE by binding
  an ephemeral OS-assigned port instead of a hardcoded one.
---

# GH-351 — Flaky Fixed-Port Test

## Status

| What was just completed | What's next |
|---|---|
| Shipped 1.4.211 (commit `578b3e7`, 2026-07-06) — ephemeral port bound, full suite verified green (1200/1200). Found undocumented during the 2026-07-09 marathon preflight sweep; ledger/CHANGELOG backfilled. | _None — issue closed._ |

## Ask

`tests/web-api-workspace.test.js` starts a real Express server on a **hardcoded port**
(`const TestPort = 19877;` at [tests/web-api-workspace.test.js:9](../../tests/web-api-workspace.test.js#L9),
bound via `API.StartAsync()` at L51). When a prior run hasn't released the port, jest parallel workers
collide, or a stray process holds it, `listen()` throws `EADDRINUSE :::19877` and three cases fail —
though nothing about the code under test changed. Observed live during a full-suite run 2026-07-04.

## Approach

Bind an **ephemeral OS-assigned port** instead of a fixed one, and have the test use the *actual*
bound port for its HTTP requests:

1. Construct `WebAPI` with port `0` in the test (the OS assigns a free port on `listen`).
2. Expose the real listening port after bind — `WebAPI.StartAsync` reads `server.address().port` and
   the existing `PortNumber` getter ([src/web-api.js:1182](../../src/web-api.js#L1182)) returns the
   bound port rather than the requested `0`. The test reads `API.PortNumber` for its request base URL.
   - If touching `src/web-api.js` is undesired, the fallback is a per-worker unique port derived from
     `process.env.JEST_WORKER_ID` — test-only, no src change. Builder picks whichever is cleaner; the
     ephemeral-`0` path is preferred (robust against *all three* collision causes, not just parallel
     workers).

Test-only behavioral surface; no product code path changes meaning. Independent zone — collision-free
against every active lane (touches only the web-api test + optionally the web-api server bootstrap).

## Swarm Preflight Contract

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test",
  "fix_probes": [
    { "type": "grep_present", "path": "tests/web-api-workspace.test.js", "pattern": "19877" }
  ],
  "artifacts": [
    "tests/web-api-workspace.test.js",
    "src/web-api.js"
  ],
  "remediation": {
    "source": "self#approach",
    "criteria": "Remove the hardcoded 19877 port from tests/web-api-workspace.test.js. Bind an ephemeral port (construct WebAPI with port 0; expose the OS-assigned port via server.address().port so PortNumber returns the bound port) OR derive a per-jest-worker unique port from process.env.JEST_WORKER_ID. The suite must pass reliably under repeated and parallel runs with no EADDRINUSE. DONE when: `npm test` is green and the literal 19877 no longer appears in the test."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```

## Acceptance criteria

- [x] `tests/web-api-workspace.test.js` no longer contains the literal `19877`. — `TestPort = 0`.
- [x] Server binds an ephemeral/unique port; the test issues requests against the actually-bound port. — `ActualPort = API.PortNumber` read after start, per [tests/web-api-workspace.test.js:52](../../tests/web-api-workspace.test.js#L52).
- [x] `npm test` green across repeated and parallel runs — no `EADDRINUSE`. — full suite verified green (1200/1200) 2026-07-09.
- [x] No change to product behavior; `WebAPI` still honors an explicit port when one is passed. — `PortNumber` getter change is additive (reads real bound port; explicit non-zero ports unaffected).

## Explicit non-goals

- Not a broader test-harness refactor — scope is this one fixed-port flake.
- Not auditing other tests for fixed ports (track separately if a pattern emerges).
