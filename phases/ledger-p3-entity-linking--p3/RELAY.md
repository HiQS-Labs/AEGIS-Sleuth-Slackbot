# Marathon Phase p3
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P3-TURN builder=codex reviewer=agy round-cap=5 -->

## Phase Brief

# p3 — Clustering into canonical entities and alias table

Release 1.5.0 "Ledger" · P3 Phase 3, step 3 of 4 · depends on p2

## Goal

Cluster p2's scored pairwise edges into **canonical client/project identities** with an alias table,
exposed as a workspace-scoped read-model.

## The rule that matters

**Cluster after pairwise linkage — never let one early guess become the canonical id.** The plan
calls this out specifically. Build all candidate edges first, then resolve clusters from the full
edge set. Do not assign a canonical id on first sight of a name and attach later matches to it;
that is order-dependent and produces different answers for the same history.

## Scope

`src/entity-read-model.js`:

- fold p2's edges into clusters above a configurable confidence threshold
- assign each cluster a stable canonical id derived from cluster *content*, not from insertion order
  or a counter — the same history must always yield the same ids
- emit an alias table (surface form → canonical id) with confidence retained
- keep per-cluster provenance: which edges, which events

Threshold lives in one named constant with a comment explaining the chosen value. It will move; make
that cheap.

## Failure modes to test explicitly

- **False merge** — two genuinely different clients sharing a word ("Acme Corp" / "Acme Industries")
  must not collapse. Include a fixture.
- **False split** — one client under two surface forms ("WP DB Toolkit" / "wp-db-toolkit") must
  collapse. Include a fixture.
- **Order independence** — shuffling the input edge order must produce identical clusters and
  identical canonical ids. This is the test that catches the "first guess wins" bug.

## Hard constraints

- Pure, deterministic, strictly additive. No write-path change, no authority change.
- Nothing in reminder scheduling may import this module.

## Done when

- `tests/entity-read-model.test.js` covers false-merge, false-split, order-independence, empty
  input, and a single-item cluster.
- `npm test` green; `npm run build` clean.

## Out of scope

Diagnostics/review tooling (p4), human override lane (p4), wiring any feature to consume this.
Consumers (`summarize-week` grouping, `search reminders`, HiQS exports, P2-TASK-BUCKETING) come
after Phase 3 and only if the checkpoint re-decision approves continuing.


---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/entity-read-model.js,tests/entity-read-model.test.js
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): <repo-root>/.xyz/bin/tick
   - <repo-root>/.xyz/bin/tick claim MARATHON-P3-TURN --agent codex --paths "phases/ledger-p3-entity-linking--p3/RELAY.md,src/entity-read-model.js,tests/entity-read-model.test.js"
   - <repo-root>/.xyz/bin/tick ping MARATHON-P3-TURN --agent codex
   - <repo-root>/.xyz/bin/tick release MARATHON-P3-TURN --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p3/RELAY.md and src/entity-read-model.js,tests/entity-read-model.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/entity-read-model.js,tests/entity-read-model.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: <repo-root>/.xyz/bin/tick release MARATHON-P3-TURN --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: <repo-root>/.xyz/bin/tick done MARATHON-P3-TURN --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: <repo-root>/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p3/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
