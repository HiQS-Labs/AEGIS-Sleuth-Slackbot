# Marathon Phase p3
STATUS: Open
NEXT: codex (Reviewer)

<!-- marathon-drive: task=MARATHON-P3-TURN builder=agy reviewer=codex round-cap=5 -->

## Phase Brief

---
title: "Phase brief p3 — GH-221 docs, scopes, changelog"
status: Queued — plan Codex-approved, preflighted; not fired
created: 2026-10-09
updated: 2026-10-09
owner: noel
branch: marathon/gh-221-selftest-mode
doc_type: phase-brief
related: "GH-221; parent plan PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md; depends on p2"
roadmap_exempt: true
goal: >
  Document the selftest command, add the missing Slack scopes, and write the changelog entry.
---

# p3 — docs and changelog

## Status

| What was just completed | What's next |
|---|---|
| Brief written; parent plan approved by Codex plan QA round 3 (2026-10-10). | Runs after p2 is approved. |

Describe what p1/p2 actually built; read their merged files first and do not document anything that is not
there.

## Build

1. `docs/SSH.md` under `## Common Operations` (line ~66): add `### Post-deploy self-QA` in the existing style
   (a `###` heading plus one `bash` block with an `ssh sleuth-development '...'` one-liner), four lines: set
   `SLEUTH_SELFTEST_CHANNEL` in the dev unit and restart, `@Sleuth selftest all` in that channel, then the
   journal grep `journalctl -u sleuth-app -n 200 | grep '\[selftest\]'`. Mention that the Compass scenario
   needs a Compass-mapped channel and the four look-back scenarios an unmapped one, so full coverage is two runs.
2. `docs/slack-app-setup.md`: add `files:read` and `files:write` to the manifest (lines ~36-52) and the scope
   list (~106-120). If the dev app lacks them it needs a reinstall — say so in one sentence.
3. `docs/deployhq.md`: one line under the Slack smoke step (line ~102) pointing to the self-QA entry.
4. `CHANGELOG.md`: a new top entry in the file's HOW TO WRITE format (lines 22-34): `## <ver> - <date>`, a
   first-person plain-language TL;DR, then a `**Technical:**` paragraph starting with the GH id and listing
   files, the env var and tests. Take the next patch version after the current top entry. Do not bump
   `package.json` (the version lags the changelog until release). Run `node scripts/validate-changelog-tone.js`.

## Check

`node scripts/validate-changelog-tone.js` exits 0; `npm test` exits 0.

## Do NOT

- Do not touch source or tests, the plan doc, or `package.json`.
- Do not state that the live scenarios passed; they are verified on dev after deploy by the operator.
- Do not put the dev QA channel id or any secret in any doc (it lives in the gitignored `temp/SOP.md`).


---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
APPEND-ONLY FILE (GH-529 attestation): add your block at the END and never delete, reorder, or rewrite any existing content — the terminal attestation refuses the approval if any byte above your block changed, even a tidy-up.
1. Implement the brief by creating/editing the artifact file(s): docs/SSH.md,docs/slack-app-setup.md,docs/deployhq.md,CHANGELOG.md
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick claim MARATHON-P3-TURN --agent agy --paths "marathon-system/gh221-selftest-2026-10-09--p3/RELAY.md,docs/SSH.md,docs/slack-app-setup.md,docs/deployhq.md,CHANGELOG.md"
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick ping MARATHON-P3-TURN --agent agy
   - /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick release MARATHON-P3-TURN --agent agy --to codex
4. Edit ONLY these paths: marathon-system/gh221-selftest-2026-10-09--p3/RELAY.md and docs/SSH.md,docs/slack-app-setup.md,docs/deployhq.md,CHANGELOG.md. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: docs/SSH.md,docs/slack-app-setup.md,docs/deployhq.md,CHANGELOG.md. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
APPEND-ONLY FILE (GH-529 attestation): add your block at the END and never delete, reorder, or rewrite any existing content — the terminal attestation refuses the approval if any byte above your block changed, even a tidy-up.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick release MARATHON-P3-TURN --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick done MARATHON-P3-TURN --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/marathon-clones/marathon-gh-221-selftest-mode/.xyz/bin/tick
   Edit ONLY marathon-system/gh221-selftest-2026-10-09--p3/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
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

### Round 1 · Builder · agy
I have implemented Phase p3:
- Added `### Post-deploy self-QA` to `docs/SSH.md` per instructions with the channel setup and journal grep command.
- Updated `docs/slack-app-setup.md` to add `files:read` and `files:write` to both the JSON manifest and the manual scopes list, and noted the reinstall requirement.
- Added a pointer to the self-QA entry in `docs/deployhq.md` at the Slack smoke test step.
- Added a new top entry to `CHANGELOG.md` following the specified format and updated the version to `1.4.338`.
- Ran `scripts/validate-changelog-tone.js` to confirm the tone is clean.
