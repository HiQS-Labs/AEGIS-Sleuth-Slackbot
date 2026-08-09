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
