# Marathon Phase p4
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P4-TURN-2 builder=codex reviewer=agy round-cap=5 -->

## Phase Brief

# p4 — Diagnostics, low-confidence queue, human override lane

Release 1.5.0 "Ledger" · P3 Phase 3, step 4 of 4 · depends on p3

## Goal

Make the read-model **debuggable and correctable**, and produce the evidence the Phase 4-6
checkpoint decision will be judged on.

This phase is the reason Phase 3 can be evaluated at all. Without it, the re-decision has opinions
instead of data.

## Scope

`scripts/entity-linking-diagnostics.js` — a read-only CLI, no writes to any authoritative store:

- **Shadow-diff output.** Compare the derived client/project associations against today's
  `src/client-mapping.js` overlay, and report agreements, disagreements, and gaps. This mirrors how
  Phase 2 was validated (`scripts/summarize-week-shadow-diff.js`) and is the same evidence shape
  that took the Phase 2 prod diff from 11 mismatches to 0.
- **False-merge / false-split examples.** Surface the highest-confidence disagreements, since those
  are the ones that would do damage if promoted.
- **Low-confidence queue.** List links below threshold, ordered by how close they are to it.
- **Comparison traces.** For any single task, print which signals fired with what weight — the
  "why did it decide that" view.

## Human override lane

Support a curated overrides file (explicit merge/split/alias) that takes precedence over derived
output and is **replayable over the historical event stream**. Overrides are data, not code, and
applying them must not mutate the log.

## Hard constraints

- Read-only. This script must never write to `data/runtime/**` or any authoritative store.
- Deterministic output for a fixed input, so diffs between runs mean something.
- Additive; no write-path or authority change.

## Done when

- `tests/entity-linking-diagnostics.test.js` covers: a clean shadow-diff, a diff with known
  disagreements, an override that forces a merge, an override that forces a split, and an empty log.
- A test asserts the script performs no writes outside its own output path.
- `npm test` green; `npm run build` clean.

## Deliverable beyond code — the checkpoint input

Write a short findings section into `PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md` reporting what the
shadow-diff actually showed against real data: agreement rate, the disagreement classes found, and
whether entity linking is carrying its weight.

**Do not recommend proceeding to Phase 4.** Reaching this checkpoint with evidence *is* the
deliverable for release 1.5.0. Phases 4-6 return as a fresh proposal, per the Codex direction review
(2026-06-16), or not at all.


## Debug mantra (auto-triggered — 1 prior attempt(s) on this phase did not reach Approved)

Before trying again, read /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/relay-automation/DEBUG-MANTRA.md and follow its four-step discipline: reproduce reliably, know the fail path, question the hypothesis, treat this round as a breadcrumb for the next one.
Last recorded reason (/Users/noelsaw/wt/ledger-p3-entity-linking/phases/ledger-p3-entity-linking--p4/ESCALATION.md): `containment-violation (off-lane edit reverted by a turn-taker)`. Read it before re-guessing.

---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): scripts/entity-linking-diagnostics.js,tests/entity-linking-diagnostics.test.js
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick claim MARATHON-P4-TURN-2 --agent codex --paths "phases/ledger-p3-entity-linking--p4/RELAY.md,scripts/entity-linking-diagnostics.js,tests/entity-linking-diagnostics.test.js"
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick ping MARATHON-P4-TURN-2 --agent codex
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P4-TURN-2 --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p4/RELAY.md and scripts/entity-linking-diagnostics.js,tests/entity-linking-diagnostics.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: scripts/entity-linking-diagnostics.js,tests/entity-linking-diagnostics.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P4-TURN-2 --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick done MARATHON-P4-TURN-2 --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p4/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
