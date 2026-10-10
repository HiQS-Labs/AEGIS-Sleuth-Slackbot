---
Goal: Final QA of the GH-225 implementation (shared bounded thread-context provider) against its approved plan
Date: 2026-10-10
NEXT: codex
STATUS: Open
---

# Context

Adjudicate the committed implementation of GH-225 on branch `fix/gh-225-thread-context-provider`
(base `aca655d`) against the plan `PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md`, which
you approved in `marathon-system/gh225-plan-qa/RELAY.md` round 3 (`VERDICT: PASS`). Read the
plan's Plan, Acceptance, Sweep and "Plan QA dispositions" sections in full first.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. Do not
ask for enterprise fail-safes, TTL caches, metrics, feature flags or new test infrastructure.

Code diff to review (whole files, not just hunks — pre-existing defects in touched files are in
scope; say so if you find none):
- `src/thread-context-provider.js` (new, ~55 lines)
- `src/chat-module.js` — `#ShouldRespondToMessageAsync` (dispatcher read), `#FindEarlierThreadFilesAsync`
  (look-back read, Compass exemption removed), `#RunCompassAsync` (Compass read), `#ReadThreadAsync`
  (new helper, the single read-policy decision), `#GatherThreadContextAsync` (new optional
  `ArgEventInfo` parameter) and its two callers in `#OnAppMentionAsync` / `#OnMessageAsync`
- `tests/product-compass.test.js` — new last case `GH-225: one thread read per event ...`
- `CHANGELOG.md` top entry `1.4.339`

Untouched on purpose (verify): `src/slack-app.js` reader, the three reaction-handler reads in
`src/chat-module.js` (`#OnReactionAddedAsync` wrench branch, `#HandleStopReactionAsync`,
`#HandleBugReportReactionAsync`), `src/selftest/**`, `src/thread-memory.js`, command and reminder
readers, Compass answer logic in `src/product-compass.js` and `src/chat-commands/ask-compass-command.js`.

## Acceptance map (plan -> evidence)

| Plan item | Where | Evidence |
|---|---|---|
| (a).1 non-Compass hands-free reply: one read; two with memo bypassed | `tests/product-compass.test.js` new case, first block (`C999`) | focused run green; red control: with `src/chat-module.js` reverted to base (provider kept so `require` resolves) the case fails `Expected number of calls: 1 / Received number of calls: 2` |
| (a).2 Compass mention + enabled look-back = one bounded read `{MaxPages:5, Latest}` | same case, second block (`C123`) | green |
| (a).3 earlier Compass upload reaches the Compass prompt | same block, `toContain('Ship the release')` | green |
| (a).4 six pages, stop on page six: 5 `conversations.replies`, one reader call, zero replies | same case, last block; GH-217 canary `:151-180` unchanged | green |
| (b) `thread-earlier-file-lookback`, `thread-memory`, `selftest`, `chat-module.integration` | focused run | `Test Suites: 5 passed, 5 total / Tests: 136 passed, 136 total` (baseline before the change: 135) |
| (c) `compass-budget` asserts one read with `MaxPages <= 5` | `src/selftest/scenarios/compass-budget.js` unchanged; the helper issues `{ MaxPages: 5, Latest }` through the instance reader the runner shadows | unchanged |
| Full `npm test` on the final code (commit `a8353d2`) | clone run, unsandboxed (the three `web-api-*` suites bind a local port) | `Test Suites: 142 passed, 142 total` / `Tests: 2598 passed, 2598 total`; node:test `# tests 116 / # pass 116 / # fail 0`; `npm test` exit 0 |
| Sweep: inline `MaxPages` at RunCompass, Compass exemption in look-back | diff | both removed; memory guard, strictly-earlier filter, quiet download path kept |
| Deferred gap (F1) disclosed, not claimed fixed | plan + CHANGELOG "Known limitation" | present |

Questions (answer each by number, cite file:line):

1. Is every acceptance item above actually met by the code on disk, not only by the test
   description? In particular, does `#ReadThreadAsync` make the bounded/legacy decision in exactly
   one place and do all four consumers go through it?
2. Do the codepaths match the approved plan: event-object `WeakMap` memo, `threadTs:maxPages`
   inner key, `context-incomplete` -> `{Messages:[], Complete:false}` memoised, other errors not
   pinned, RunCompass rethrowing `context-incomplete` so `ask-compass-command.js:19` still refuses,
   dispatcher returning `ShouldRespond:false` on `Complete:false`?
3. Did any duplicate subsystem or writer slip in (a second cache, a changed reader, a new
   persistence path, a new test harness)? Is anything over-engineered for the envelope?
4. Is the new test honest: does the memo bypass return the same result shape the provider returns,
   and would the (a).1 assertion go red if the memo were silently removed?
5. Any behavior regression for non-Compass channels, DMs, reaction handlers or the selftest
   runner's shadow counting?
6. CHANGELOG entry: two-paragraph format, plain-language first, technical second, no overclaim.

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered. Every `[Blocker]` or
`[Should]` must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines. You may run
narrow read-only probes (grep, node -e) with output under `.relay-scratch/`; do not run `npm test`
or jest in this worktree and grade such claims `[Unverified — needs clone run]`.

End your turn block with a non-empty `Basis:` line immediately followed by a single line reading
exactly `VERDICT: PASS` or `VERDICT: FAIL`. On PASS set `STATUS: Approved` in the header.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log

### Round 1 · Producer · claude-a

Implementation committed on `fix/gh-225-thread-context-provider` (commits `2f3ce17` fix,
`a330ce3` ledger, plus the docs commit for CHANGELOG `1.4.339`). Focused suites: 136/136 green;
red control observed as recorded in the acceptance map. Full `npm test` result is pasted in the
acceptance map row. Releasing the turn token to codex.

handing off to codex — codex, take your turn.
