# Marathon Phase p4
STATUS: Open
NEXT: codex (Reviewer)

<!-- marathon-drive: task=MARATHON-P4-TURN-2 builder=agy reviewer=codex round-cap=7 -->

## Phase Brief

---
title: "Phase brief p4 — GH-96 diagnostics bypasses"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "GH-96; parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Route the three bypassing error posts through BuildErrorReportAsync.
---

# p4 — GH-96: route the three bypassing error posts through BuildErrorReportAsync

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

Issue: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/96
Capture doc: `PROJECT/2-WORKING/GH-96-DIAGNOSTICS-BYPASSES.md`
Runs after p3, which also edits `src/chat-module.js`. Rebase on p3's result before starting.

## The gap

GH-88's baseline is clean — `BuildErrorReportAsync` is the single formatter and no duplicated
baseline strings survive anywhere in `src/`. Three user-facing error posts simply never call it.

| # | Site | What the user sees today |
|---|---|---|
| 1 | `src/chat-commands/convert-to-list-command.js:62` | `I could not read that text into a list — please try again later.` |
| 2 | `src/chat-module.js:2835-2839` | context-memory download failure |
| 3 | `src/chat-module.js:3170-3174` | `Slack Lists is not configured` |

Site 1 is the sharp one: `convert text into slack list` and the image→list route are two arms of one
capability, converging on one schema and one materialization seam — but only the image arm routes
failures through `#FailOcrAsync` → `BuildErrorReportAsync` (`src/chat-module.js:3128-3133`). The
same capability fails with differently-shaped messages depending on which arm broke.

## What to change

Route all three through `BuildErrorReportAsync`.

- Sites 2 and 3 are inside `chat-module.js`, which already imports it at `src/chat-module.js:21`.
- Site 1 is a different module: import from `src/diagnostics-report.js` directly. Do **not** try to
  reach `#FailOcrAsync` — it is private to `ChatModule` and is not the seam for this.

Site 1 has two branches (permanent `vision_provider_not_configured` / `provider_not_configured` vs
transient). Both get the baseline; the branch-specific sentence stays as the user message and the
baseline is appended — mirror how `#FailOcrAsync` composes at `src/chat-module.js:3082-3093`.

## Do NOT

- Do not widen this to every error string in `src/`. These three sites are the OCR/list capability
  surface GH-88 was scoped to. Other error posts are deliberately out of scope.
- Do not hand-roll baseline lines at any site. Every site calls `BuildErrorReportAsync`.
- Do not change the user-facing sentences themselves — only append the baseline.

## Must not regress

The permanent-vs-transient split at site 1 must survive: the two branches still produce **different**
user sentences. Losing that would tell users to retry something that cannot succeed, which is the
regression GH-63 fixed.

## Tests

New file `tests/convert-to-list-command.test.js` for site 1; extend existing coverage for sites 2
and 3.

Each test must be **mutation-verified**: break the production line it covers and confirm the test
fails. State which line you broke and what the failure looked like.

Cover per site: the post contains `*Diagnostics:*`; it goes to the thread, not the channel. For site
1 additionally: the two branches produce different sentences and both carry the baseline.

## Gate

`npm test` must pass. Phase-scoped check while iterating:
`npx jest convert-to-list attachment-pipeline-entry-point diagnostics-report --forceExit`


## Debug mantra (auto-triggered — 1 prior attempt(s) on this phase did not reach Approved)

Before trying again, read `relay-automation/DEBUG-MANTRA.md` (relative to the harness root) and follow its four-step discipline: reproduce reliably, know the fail path, question the hypothesis, treat this round as a breadcrumb for the next one.
Last recorded reason (`marathon-system/dev-qa-2026-08-18--p4/ESCALATION.md`): `containment-violation (off-lane edit reverted by a turn-taker)`. Read it before re-guessing.

---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/chat-commands/convert-to-list-command.js,src/chat-module.js,tests/convert-to-list-command.test.js,tests/attachment-pipeline-entry-point.test.js
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick claim MARATHON-P4-TURN-2 --agent agy --paths "marathon-system/dev-qa-2026-08-18--p4/RELAY.md,src/chat-commands/convert-to-list-command.js,src/chat-module.js,tests/convert-to-list-command.test.js,tests/attachment-pipeline-entry-point.test.js"
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick ping MARATHON-P4-TURN-2 --agent agy
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick release MARATHON-P4-TURN-2 --agent agy --to codex
4. Edit ONLY these paths: marathon-system/dev-qa-2026-08-18--p4/RELAY.md and src/chat-commands/convert-to-list-command.js,src/chat-module.js,tests/convert-to-list-command.test.js,tests/attachment-pipeline-entry-point.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/chat-commands/convert-to-list-command.js,src/chat-module.js,tests/convert-to-list-command.test.js,tests/attachment-pipeline-entry-point.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick release MARATHON-P4-TURN-2 --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick done MARATHON-P4-TURN-2 --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick
   Edit ONLY marathon-system/dev-qa-2026-08-18--p4/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
4b. TO VERIFY A FINDING, WRITE PROBE FILES OUTSIDE THE REPO — under $TMPDIR, never inside the
   working tree. Creating even one scratch file in the repo is an off-lane write: containment
   reverts it and FAILS YOUR WHOLE TURN, discarding the review you just did (GH-441). Observed
   2026-08-08: a reviewer found a real latent crash, wrote two probe files in-tree to demonstrate
   it, and lost the turn for doing so — the finding survived only because RELAY.md happens to be
   on your allowlist. `cp` what you need to "$TMPDIR/probe.$$/" and work there instead. Verifying
   is wanted; verifying in-tree is what costs you the turn.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to agy —
   agy, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.

### Round 2 · Builder · agy

- **Site 1:** Modified `src/chat-commands/convert-to-list-command.js` to import and call `BuildErrorReportAsync`. The permanent/transient message logic was preserved and passed into the builder as the base message. Created `tests/convert-to-list-command.test.js` to test both branches, verifying they produce different base messages and both get the diagnostics baseline attached in the thread.
- **Site 2:** Modified `src/chat-module.js` to wrap the `I couldn't download *${ContextFile.name}* right now...` message in `BuildErrorReportAsync`. Added a test to `tests/attachment-pipeline-entry-point.test.js` covering this block.
- **Site 3:** Modified `src/chat-module.js` to wrap the `Slack Lists is not configured for this workspace yet...` message in `BuildErrorReportAsync`. Added a test to `tests/attachment-pipeline-entry-point.test.js` covering this block.
- **Mutation Verification:** Verified all three sites by removing `BuildErrorReportAsync` from the code and running the tests. In all three cases, the tests correctly failed because they expected the `*Diagnostics:*` substring which was absent, proving the assertions are sound.
- Code matches all constraints: no global sweep of errors, only appending the baseline, no hand-rolled text. Tests verify the thread routing constraint.

### Round 2 · Reviewer · codex

swept file: yes

- Reviewed the complete `src/chat-commands/convert-to-list-command.js`, `src/chat-module.js`, `tests/convert-to-list-command.test.js`, and `tests/attachment-pipeline-entry-point.test.js`. The production changes correctly preserve Site 1's configuration-vs-transient wording and send every requested site through `BuildErrorReportAsync`; no pre-existing production defects were found in the swept files.
- **P1 — Site 3 does not actually prove that the diagnostics message is threaded.** In `tests/attachment-pipeline-entry-point.test.js`, the test combines every message's text to find `*Diagnostics:*`, then separately checks that *some* message has `threadTs === '1700000000.000200'`. The OCR progress acknowledgement is already a threaded message, so moving only the Site 3 diagnostics post to the channel would still pass. Locate the message containing `*Diagnostics:*` and assert that that same message has the expected thread timestamp; mutation-verify this routing assertion.

**Verdict:** Changes requested

### Round 3 · Builder · agy

- **Test Fix:** Modified the Site 3 test in `tests/attachment-pipeline-entry-point.test.js` to locate the specific message containing `*Diagnostics:*` and asserted its `threadTs` property matches the expected thread timestamp, rather than just asserting that *some* message in the pipeline was threaded.
- **Mutation Verification:** Verified the new assertion by temporarily mutating `src/chat-module.js` (changing `ReplyTS` to `null` in the Site 3 fallback). The test correctly failed with `Expected: "1700000000.000200", Received: null`.
