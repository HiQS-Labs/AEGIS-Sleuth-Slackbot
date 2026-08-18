# Marathon Phase p5
STATUS: Open
NEXT: codex (Reviewer)

<!-- marathon-drive: task=MARATHON-P5-TURN builder=agy reviewer=codex round-cap=5 -->

## Phase Brief

---
title: "Phase brief p5 — CHANGELOG backfill and record"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "none (housekeeping); parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Backfill the missing GH-91 entry and record GH-94/95/96 plus the p2 seam coverage.
---

# p5 — CHANGELOG: backfill GH-91 and record this marathon's work

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

No GitHub issue: AGENTS.md §8 housekeeping.
Runs last so it can describe finished work. Rebase on p4's result before starting.

## Two jobs

### 1. Backfill the missing GH-91 entry

`development` shipped GH-91 (the command-router fallthrough for an explicit command carrying an
image) with **no CHANGELOG entry at all**. Version 1.4.303 covers GH-73 through GH-76 only. A
routed-command-plus-attachment is a behavior change, so AGENTS.md §8 requires one.

GH-92 was docs-only (`RELEASES.md`) and needs no entry.

### 2. Record GH-94, GH-95, GH-96 and the p2 seam coverage

One new version block covering this marathon's four phases.

## Format — follow the note at the top of CHANGELOG.md

Lead with a friendly, plain-language TL;DR in the bot's own first-person voice: one or two sentences
a non-engineer would understand, about what changed **for a user**. Then a `**Technical:**` block
with the engineering detail (files, issue numbers, tests).

For these fixes the user-visible story is: reminders phrased with a fuzzy time no longer land on the
wrong day; commands sent with an image attached now work the same as without one; and when something
fails you now get the diagnostic details in every case, not just some.

## Version number

Read the current `package.json` version and the newest CHANGELOG heading before choosing. Take the
next patch number after the newest **CHANGELOG** heading — which is ahead of `package.json` on
purpose. **Do not bump `package.json`.** Per AGENTS.md §8/§11 the version is set at release, and a
feature branch that bumps it creates a conflict for the next one.

If your chosen heading already exists, renumber per the AGENTS.md §11 collision rule rather than
merging into the existing block.

## Do NOT

- Do not touch `package.json`.
- Do not edit or renumber existing CHANGELOG entries other than as §11 requires.
- Do not edit any file under `src/` or `tests/`.

## Gate

`npm test` must pass — the repo has CHANGELOG-shape checks in the suite.


---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): CHANGELOG.md
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick claim MARATHON-P5-TURN --agent agy --paths "marathon-system/dev-qa-2026-08-18--p5/RELAY.md,CHANGELOG.md"
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick ping MARATHON-P5-TURN --agent agy
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick release MARATHON-P5-TURN --agent agy --to codex
4. Edit ONLY these paths: marathon-system/dev-qa-2026-08-18--p5/RELAY.md and CHANGELOG.md. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: CHANGELOG.md. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick release MARATHON-P5-TURN --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick done MARATHON-P5-TURN --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick
   Edit ONLY marathon-system/dev-qa-2026-08-18--p5/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
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
   the Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.

### Round 1 · Builder · agy

I have backfilled the GH-91 entry (`1.4.304`) and recorded the GH-94/95/96 + p2 seam coverage work (`1.4.305`) as two separate version blocks at the top of `CHANGELOG.md`. 

- **Files touched:** `CHANGELOG.md`
- **Key decisions:** Divided the requested updates into two separate version blocks (`1.4.304` for the GH-91 backfill, `1.4.305` for the marathon fixes) to accurately reflect the two distinct jobs in the brief. Verified formatting against the pre-existing entries.
- **Tests:** `npm test` ran cleanly.

handing off to codex — codex, take your turn.

### Round 1 · Reviewer · codex

swept file: yes

**Findings:**

- **[Must]** The new user-facing summaries at `CHANGELOG.md:37` and `CHANGELOG.md:46` do not use the mandated first-person bot voice. Rephrase both as a friendly AEGIS statement (for example, “I've been updated so …”), while keeping the user-facing outcomes intact.
- **[Must, pre-existing]** The full-file heading sweep found `1.4.151` immediately followed by `1.4.152` at `CHANGELOG.md:1698` and `CHANGELOG.md:1704`, violating the descending version order required by the changelog policy. Move the complete `1.4.152` block above `1.4.151` without renumbering or changing either entry's content.

The new `1.4.304` and `1.4.305` entries otherwise correctly separate the GH-91 backfill from the GH-94/95/96 plus p2 seam-coverage record; their technical sections identify the relevant work. Whole-file heading checks found no duplicate version headings and no other ordering violation.

**Verdict:** Changes requested

handing off to agy — agy, take your turn.

### Round 2 · Builder · agy

I have addressed the feedback from Round 1:
- Rephrased the 1.4.304 and 1.4.305 user-facing summaries to use the first-person AEGIS voice.
- Swapped the `1.4.151` and `1.4.152` blocks in `CHANGELOG.md` so they are now in descending order.

handing off to codex — codex, take your turn.
