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
