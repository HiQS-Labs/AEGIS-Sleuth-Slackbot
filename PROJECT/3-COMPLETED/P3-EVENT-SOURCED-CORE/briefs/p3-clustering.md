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
