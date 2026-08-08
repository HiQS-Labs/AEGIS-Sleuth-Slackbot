# Marathon Phase p2
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P2-TURN builder=codex reviewer=agy round-cap=5 -->

## Phase Brief

# p2 — Candidate generation and multi-signal scoring

Release 1.5.0 "Ledger" · P3 Phase 3, step 2 of 4 · depends on p1

## Goal

Turn the normalized records from p1 into **scored candidate edges** (`task -> project`,
`project -> client`, `task -> client`), each carrying confidence and provenance.

## Design — borrowed from Splink as an architecture, not a dependency

Do **not** add Splink or any entity-resolution package. The plan names it as a reference
architecture. Take four ideas:

1. **Blocking / candidate generation.** Never compare every task to every client/project. Generate
   candidates from cheap signals only: exact/normalized alias hit, channel mapping, GitHub repo
   mapping, shared participants, time-local co-occurrence.
2. **Multi-signal comparison, not one fuzzy score.** Score each candidate from several *separately
   explainable* signals — normalized string match, repo match, channel match, sender/assignee
   overlap, historical co-occurrence, prior accepted alias. Keep the per-signal contributions.
3. **Weighted confidence, not binary truth.** Persist the confidence *and the individual evidence*
   so thresholds can move later without rewriting history.
4. **Provenance on every link.** Which events and which signals produced it.

Deterministic rules first. **No LLM in this phase** — LLM-assisted inference is explicitly the
second tier in the plan, and adding it here makes the phase untestable and non-deterministic.

## Existing sources to reuse, not reinvent

`src/client-mapping.js` already holds the operator-managed clients overlay and repo-pattern rules.
Read it as a deterministic signal source. Do **not** modify it in this phase — it stays a mutable
store until (and unless) the Phase 4-6 re-decision happens.

## Hard constraints

- Pure and deterministic: same inputs → identical scored edges, including ordering.
- Strictly additive; no write-path or authority change.
- Every emitted edge carries `confidence` (0-1) and `provenance` (source event ids + which signals
  fired with what weight). An edge without provenance is a defect, not a shortcut.

## Done when

- `tests/entity-linking.test.js` covers each signal in isolation, a multi-signal agreement case, a
  multi-signal *disagreement* case, and a no-candidate case.
- A test asserts blocking actually prunes: a fixture with N tasks × M projects must generate far
  fewer than N×M candidates, and the test states the expected bound.
- Determinism test: two runs byte-identical.
- `npm test` green; `npm run build` clean.

## Out of scope

Clustering into canonical ids (p3), diagnostics tooling (p4), any LLM tier, any read-path wiring.

### Round 1 · Builder · codex

Implemented `src/entity-linking.js` and `tests/entity-linking.test.js`. The new pure candidate
engine accepts p1 tasks, project candidates, and `client-mapping.js`-shaped client records; it uses
indexed alias/repo/channel/participant/day keys to block pairs, emits deterministic typed edges, and
retains weighted per-signal evidence with source event ids. Tests cover every signal independently,
agreement and disagreement, client-mapping compatibility, no candidates, a 20×20 blocking bound,
and byte-identical output. No runtime path or authority was changed.

Validation: `node --check` passed for both new files and direct Node fixtures covered disagreement,
project-to-client provenance, and the 20×20 blocking bound. Jest could not run in this worktree
because `node_modules` is absent (the harness remains responsible for the normal targeted test).


---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/entity-linking.js,tests/entity-linking.test.js
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick claim MARATHON-P2-TURN --agent codex --paths "phases/ledger-p3-entity-linking--p2/RELAY.md,src/entity-linking.js,tests/entity-linking.test.js"
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick ping MARATHON-P2-TURN --agent codex
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P2-TURN --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p2/RELAY.md and src/entity-linking.js,tests/entity-linking.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/entity-linking.js,tests/entity-linking.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P2-TURN --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick done MARATHON-P2-TURN --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p2/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
