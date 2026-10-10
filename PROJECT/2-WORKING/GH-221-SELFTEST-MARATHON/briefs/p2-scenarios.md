---
title: "Phase brief p2 — GH-221 the five scenarios"
status: Queued — plan Codex-approved, preflighted; not fired
created: 2026-10-09
updated: 2026-10-09
owner: noel
branch: marathon/gh-221-selftest-mode
doc_type: phase-brief
related: "GH-221; parent plan PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md; depends on p1"
roadmap_exempt: true
goal: >
  Add the five scenario files against the p1 runner contract and a loader test that enforces their shape.
---

# p2 — scenarios

## Status

| What was just completed | What's next |
|---|---|
| Brief written; parent plan approved by Codex plan QA round 3 (2026-10-10). | Runs after p1 is approved and its gate is green. |

Read the parent plan in full, then the p1 runner you are building on (`src/selftest/runner.js`). Use the
context shape p1 defined; do not change the runner here unless a scenario cannot be written against it, in
which case stop and say why in your handoff (the runner is p1's artifact, not yours).

## Build

Five files under `src/selftest/scenarios/`, each exporting `{ Name, Run }`, each at most 40 lines:

| file | what it proves | key assertions |
|---|---|---|
| `lookback-basic.js` | GH-219: a question grounded in an earlier-uploaded `.json` | answer quotes the fixture's unique canary token; no "I've loaded" post; exactly one download of the fixture URL |
| `lookback-command.js` | Codex P1 on #220: a command after hydration still routes | upload, then `show-channel-model` → model status reply, not AI chat |
| `lookback-bare.js` | GH-219: bare mention loads the earlier file | `Mention('')` (runner posts the `selftest bare baseline` marker) → exactly one "I've loaded" post, no AI answer |
| `lookback-skip-bad.js` | GH-219 non-blocking rule | upload a text file > 200 KB, mention with a question → no "too large" post, normal answer |
| `compass-budget.js` | GH-217: Compass read budget | exactly one in-scope reply read with `MaxPages <= 5`, a successful cited answer, no excerpt twice; the fixed release question is named in the file header |

Skips: the four `lookback-*` scenarios `Skip('channel is Compass-mapped')` when
`Compass.GetMapping(WorkspaceInfo, channel)` is truthy; `compass-budget` skips when it is not (Design 5).
Fixtures are generated in the scenario (a temp file from a string) with a unique canary token; the canary
must never appear in question text.

Add to `tests/selftest.test.js` one loader test: every file in the folder exports `{ Name, Run }`, names are
unique, each file is at most 40 lines. Also one test that runs all five against a MockSlackApp stub context
and gets a five-line report with `compass-budget` ⏭ (unmapped mock). Scenario behavior itself is not
unit-tested; it is proved live on dev after deploy.

## Check

`npx jest selftest thread-earlier-file-lookback --forceExit` exits 0; then `npm test`.

## Do NOT

- Do not edit the runner, the module, `src/app.js` or `src/chat-module.js` (p1 owns them).
- Do not mock around a scenario to make it pass; a scenario that cannot run against the runner contract is a
  handoff finding, not something to paper over.
- No dependencies, no helper framework beyond what the runner exposes.
