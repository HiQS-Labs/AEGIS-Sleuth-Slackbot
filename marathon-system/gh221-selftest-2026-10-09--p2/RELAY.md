# Marathon Phase p2
STATUS: Open
NEXT: agy (Builder)

<!-- marathon-drive: task=MARATHON-P2-TURN builder=agy reviewer=codex round-cap=7 -->

## Phase Brief

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


---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
APPEND-ONLY FILE (GH-529 attestation): add your block at the END and never delete, reorder, or rewrite any existing content — the terminal attestation refuses the approval if any byte above your block changed, even a tidy-up.
1. Implement the brief by creating/editing the artifact file(s): src/selftest/scenarios/lookback-basic.js,src/selftest/scenarios/lookback-command.js,src/selftest/scenarios/lookback-bare.js,src/selftest/scenarios/lookback-skip-bad.js,src/selftest/scenarios/compass-budget.js,tests/selftest.test.js
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick claim MARATHON-P2-TURN --agent agy --paths "marathon-system/gh221-selftest-2026-10-09--p2/RELAY.md,src/selftest/scenarios/lookback-basic.js,src/selftest/scenarios/lookback-command.js,src/selftest/scenarios/lookback-bare.js,src/selftest/scenarios/lookback-skip-bad.js,src/selftest/scenarios/compass-budget.js,tests/selftest.test.js"
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick ping MARATHON-P2-TURN --agent agy
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick release MARATHON-P2-TURN --agent agy --to codex
4. Edit ONLY these paths: marathon-system/gh221-selftest-2026-10-09--p2/RELAY.md and src/selftest/scenarios/lookback-basic.js,src/selftest/scenarios/lookback-command.js,src/selftest/scenarios/lookback-bare.js,src/selftest/scenarios/lookback-skip-bad.js,src/selftest/scenarios/compass-budget.js,tests/selftest.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/selftest/scenarios/lookback-basic.js,src/selftest/scenarios/lookback-command.js,src/selftest/scenarios/lookback-bare.js,src/selftest/scenarios/lookback-skip-bad.js,src/selftest/scenarios/compass-budget.js,tests/selftest.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
APPEND-ONLY FILE (GH-529 attestation): add your block at the END and never delete, reorder, or rewrite any existing content — the terminal attestation refuses the approval if any byte above your block changed, even a tidy-up.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick release MARATHON-P2-TURN --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick done MARATHON-P2-TURN --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick
   Edit ONLY marathon-system/gh221-selftest-2026-10-09--p2/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
4b. TO VERIFY A FINDING, WRITE PROBE FILES OUTSIDE THE REPO — under $TMPDIR, never inside the
   working tree. Creating even one scratch file in the repo is an off-lane write: containment
   reverts it and FAILS YOUR WHOLE TURN, discarding the review you just did (GH-441). Observed
   2026-08-08: a reviewer found a real latent crash, wrote two probe files in-tree to demonstrate
   it, and lost the turn for doing so — the finding survived only because RELAY.md happens to be
   on your allowlist. `cp` what you need to "$TMPDIR/probe.$$/" and work there instead. Verifying
   is wanted; verifying in-tree is what costs you the turn.
4c. A finding that asks for a behaviour change is a generalization unless you can paste the concrete
   input — a row, a value, a `file:line` — that fails under the current code (GH-681). Every
   `[Blocker]` or `[Should]` requesting a behaviour change MUST carry `Observed input:`,
   `Affected scope:` and `Falsifier:` lines; a `[Blocker]` must cite an observed failure. The Builder
   may disposition a request lacking these as `Declined — unproven generalization`.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to agy —
   agy, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
