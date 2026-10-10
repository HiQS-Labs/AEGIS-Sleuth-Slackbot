---
Goal: Final QA of the GH-221 selftest marathon output (3 phases, all Codex-approved)
Date: 2026-10-10
NEXT: Reviewer
STATUS: Open
---

# Context

Adjudicate the implementation of GH-221 "Dev-server-only self-QA mode" (AEGIS-Sleuth-Slackbot) against its plan in `PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md` (read the Design section 1-9 and the Acceptance checklist in full). The code was built by agy and reviewed by codex over three marathon phases; this is an independent second-model pass.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. Tests and machinery must be commensurate; do not demand enterprise fail-safes, multi-tenant isolation, or new test infrastructure. Phase transcripts are in `marathon-system/gh221-selftest-2026-10-09--p{1,2,3}/RELAY.md` if you want the prior reviewer's reasoning.

Files to read (the whole diff of this branch vs. its base `c2eacf9`):
- src/app.js (guard + wiring, ~17 lines changed)
- src/chat-module.js (ClearThreadMemoryAsync + any hook, ~14 lines)
- src/selftest/selftest-module.js
- src/selftest/runner.js
- src/selftest/scenarios/lookback-basic.js, lookback-command.js, lookback-bare.js, lookback-skip-bad.js, compass-budget.js
- tests/selftest.test.js
- docs/SSH.md, docs/slack-app-setup.md, docs/deployhq.md, CHANGELOG.md

Questions:

1. Guard correctness (Design 1): with `SLEUTH_SELFTEST_CHANNEL` unset, is the module truly absent (no handler, no route)? From a wrong channel, does the handler reply "selftest is dev-only" and return `true` even if that reply throws? Cite file:line.
2. Re-entrancy (Design 2): is the one-run-at-a-time flag reset on every exit path including a thrown error inside the runner? Is there any path where the flag stays set forever?
3. Isolation per scenario (Design 3, 8): does each scenario get its own fresh root message, is `ClearThreadMemoryAsync` called in `finally` for every scenario root, and are shadowed `GetConversationMessagesAsync` / `GetFileContentAsync` restored in `finally` (Design 6) even on failure?
4. Look-back trigger fidelity (Design 4): does `Mention` pass `files: []` on the simulated event, and does the bare scenario post the neutral marker rather than empty text? Would any of the four lookback scenarios accidentally take the current-event attachment path instead of the GH-219 look-back?
5. Compass split (Design 5): do the lookback scenarios skip when `Compass.GetMapping` is truthy and `compass-budget` skip when it is falsy? Are the counters in `compass-budget` scoped to the scenario root's channel and thread only?
6. Report and journal (Design 7): is there exactly one `[selftest]` info log line carrying `exit_code=0|1`, with 0 only when no ❌? Does the process ever call `process.exit`?
7. Tests: does `tests/selftest.test.js` cover unset-not-registered, wrong-channel-refused, and report formatting with `MockSlackApp`, without unit-testing the live scenarios? Is any test asserting on something the code does not actually do?
8. Scope and docs: is every Acceptance checkbox in the plan satisfied by this diff, and is anything in the diff outside the plan's stated scope? Is anything over-engineered for a dev-only tool (unneeded abstraction, defensive layers, dead code)?

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered. Be concrete and cite file:line. Every `[Blocker]` or `[Should]` must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines. You may run narrow read-only probes (node -e, grep) with output under `.relay-scratch/`; do not run `npm test` or jest in this worktree and grade such claims `[Unverified — needs clone run]`.

Write your verdict below. Change STATUS to Approved if it passes, or leave it Open with the findings if changes are requested.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (commandcode)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log

