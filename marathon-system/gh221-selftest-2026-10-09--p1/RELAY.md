# Marathon Phase p1
STATUS: Open
NEXT: agy (Builder)

<!-- marathon-drive: task=MARATHON-P1-TURN builder=agy reviewer=codex round-cap=7 -->

## Phase Brief

---
title: "Phase brief p1 — GH-221 selftest guard, runner, wiring"
status: Queued — plan Codex-approved, preflighted; not fired
created: 2026-10-09
updated: 2026-10-09
owner: noel
branch: marathon/gh-221-selftest-mode
doc_type: phase-brief
related: "GH-221; parent plan PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md; MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Build the env-gated SelftestModule, the scenario runner/report formatter, ChatModule.ClearThreadMemoryAsync
  and the app.js wiring, with Jest coverage of the guard and report formatting.
---

# p1 — guard, runner, wiring

## Status

| What was just completed | What's next |
|---|---|
| Brief written; parent plan approved by Codex plan QA round 3 (2026-10-10). | Fire the parent marathon; this phase runs first. |

Read the parent plan `PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md` in full first. Its **Design 1-9**,
**Acceptance** and **Deviations** sections are the contract; this brief only restates what p1 owns.

## Build

1. `src/selftest/selftest-module.js` — `SelftestModule extends BaseModule` (`src/base-module.js`,
   AGENTS.md §0.1.2). Constructor takes `(SlackApp, ...)`, reads `SLEUTH_SELFTEST_CHANNEL` via a
   constructor argument supplied by `app.js` (do not read `process.env` inside the class), registers its
   handler with `RegisterAppMention`. Match `^selftest\s+(\S+)` after stripping `SlackApp.AppMentionString`;
   otherwise return `false`. Wrong channel → one reply "selftest is dev-only", return `true`; if that post
   throws, log and still return `true`. One run at a time (boolean flag); a re-entrant `selftest` returns
   `true` and does nothing. `SetChatModule(ChatModule)` late binding (mirror `SetListsModule` /
   `SetRemindersModule`, `src/app.js:342-343`).
2. `src/selftest/runner.js` — loads every `*.js` in `src/selftest/scenarios/` (an absent folder yields an
   empty list, because p2 creates the files), runs scenarios sequentially, one fresh root message per
   scenario, never throws out, builds the context `{ SlackApp, Channel, ThreadTs, Upload, Say, Mention,
   Expect, Fixture, Skip }` exactly as Design 3-4 describes (including the `files: []` mention rule and the
   `selftest bare baseline` marker for an empty question), shadows/restores `GetConversationMessagesAsync` and
   `GetFileContentAsync` per Design 6, clears each root's thread memory in `finally`, and formats the report
   (`✅/❌/⏭ name — evidence`, summary line, permalink on failure) plus the `[selftest] ... exit_code=0|1`
   journal line. Reuse `FindUploadedShareMessage` and `ResolveUploadedMessageInfoAsync` from
   `scripts/slack-harness-file-upload.js` (already exported at line 707; its CLI is guarded by
   `require.main`, line 700). Verify importing it has no side effects; do not edit that script.
3. `src/chat-module.js` — add a public `ClearThreadMemoryAsync(ArgChannel, ArgThreadTs)` that deletes the
   `${channel}:${thread}` key from `#ThreadContextMemory` and calls `#SaveThreadMemoryAsync`. Additive only.
4. `src/app.js` — construct `SelftestModule` only when `process.env.SLEUTH_SELFTEST_CHANNEL` is non-empty,
   before the ChatModule constructor (~line 330), then `SetChatModule` after Chat exists and before Slack
   starts (~line 360). Nothing else changes.
5. `tests/selftest.test.js` (MockSlackApp; it has no `UploadFileAsync`, assign a `jest.fn`): env unset →
   `app.js` wiring constructs no module (test the small factory/guard you extract, not a full app boot);
   wrong channel → "selftest is dev-only" and nothing else; runner report for ✅/❌/⏭ and for a scenario
   that throws; unknown scenario name replies with the list; cleanup runs on failure. Model on
   `tests/thread-earlier-file-lookback.test.js` and `tests/plugin-loader.test.js`.

## Check

- `npx jest selftest thread-earlier-file-lookback --forceExit` exits 0; then `npm test`.
- `npm run validate:commands`: it is already red on development for unrelated routes (issues #39, #181).
  Record its output before and after your change and confirm it is identical; do not fix it here.

## Do NOT

- Do not add a `command-catalog.json` entry, a help line, or a route to ChatModule's router.
- Do not add dependencies, CI jobs, a scheduler, or a test-framework layer.
- Do not unit-test scenario behavior (p2 creates the scenarios; they are the live test).
- Do not edit `scripts/slack-harness-file-upload.js`, `package.json`, or any doc (p3 owns docs).
- Debug-mantra applies: if something fails, reproduce and trace before changing code.


---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
APPEND-ONLY FILE (GH-529 attestation): add your block at the END and never delete, reorder, or rewrite any existing content — the terminal attestation refuses the approval if any byte above your block changed, even a tidy-up.
1. Implement the brief by creating/editing the artifact file(s): src/selftest/selftest-module.js,src/selftest/runner.js,tests/selftest.test.js,src/app.js,src/chat-module.js
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick claim MARATHON-P1-TURN --agent agy --paths "marathon-system/gh221-selftest-2026-10-09--p1/RELAY.md,src/selftest/selftest-module.js,src/selftest/runner.js,tests/selftest.test.js,src/app.js,src/chat-module.js"
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick ping MARATHON-P1-TURN --agent agy
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick release MARATHON-P1-TURN --agent agy --to codex
4. Edit ONLY these paths: marathon-system/gh221-selftest-2026-10-09--p1/RELAY.md and src/selftest/selftest-module.js,src/selftest/runner.js,tests/selftest.test.js,src/app.js,src/chat-module.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/selftest/selftest-module.js,src/selftest/runner.js,tests/selftest.test.js,src/app.js,src/chat-module.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
APPEND-ONLY FILE (GH-529 attestation): add your block at the END and never delete, reorder, or rewrite any existing content — the terminal attestation refuses the approval if any byte above your block changed, even a tidy-up.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick release MARATHON-P1-TURN --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick done MARATHON-P1-TURN --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick
   Edit ONLY marathon-system/gh221-selftest-2026-10-09--p1/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
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
