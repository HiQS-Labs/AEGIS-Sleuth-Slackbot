# p6 — Phase 5: migrate remaining projections, with a parity harness

Release 1.5.0 "Ledger" · P3 Phase 5 · depends on **p4** (re-pointed 2026-08-08; was p5)

> **Why not p5.** p5 (Phase 4, boot-time rebuild) HALTED — the event schema cannot reconstruct boot
> state — and is deferred behind its own schema-expansion proposal. Depending on it made this lane
> permanently unopenable. Depending on p4 is correct, not a workaround: this phase converts reads to
> projections *behind flags with fallback to the authoritative store*, the same strangler pattern
> Phase 2 shipped for `summarize-week` with no boot-rebuild. Nothing here needs the log authoritative
> at boot.

Authority-moving phase. The reversibility contract in `MARATHON.yaml` is binding.

## Goal

Convert the remaining reads to folds over the log: `_reminders.json`, `_completed.json`, and the
`?format=rebalance` export consumed by `deploy/reminders-export/publish-reminders-export.mjs`.

## Parity harness FIRST — this is not optional

The spec requires a parity harness **before** cutover: compare old JSON/API output against the
folded output, byte-compatible where feasible, semantically diffed where timestamps or ordering
legitimately differ.

Build `scripts/projection-parity-harness.js` before flipping anything. This is the same discipline
that made Phase 2 safe: its shadow-diff found a real pre-ledger gap (11 mismatches) that no amount
of code review had surfaced, and GH-355 closed it to 0. Skipping the harness here removes the only
mechanism that has actually caught this class of bug in this codebase.

The rebalance export has an **external consumer** (HiQS). Its output must be byte-compatible —
shadow-diff the rebalance JSON before cutover, not after.

## Switches

One flag per read surface, not one global flag. Each defaults OFF, each independently reversible:

- `REMINDERS_READ_SOURCE=projection`
- `COMPLETED_READ_SOURCE=projection`
- `REBALANCE_EXPORT_SOURCE=projection`

Per-surface flags mean a parity failure on the export does not force rolling back reminders reads.
A single global flag would couple three independent risks into one switch.

Every path keeps the `try/catch` → authoritative-store fallback.

## What must NOT change

JSON writes continue. Phase 6 (removing them) is excluded from this release — see `MARATHON.yaml`.

## Entity-linking fold-in

Where it *materially* improves output, reuse the Phase 3 canonical client/project identity rather
than repeating one-off inference per read surface. If it does not clearly improve a surface, leave
that surface alone — this phase's job is parity, not enrichment.

## Done when

- [ ] parity harness exists and runs against a real fixture, reporting byte-diffs and semantic diffs
      separately
- [ ] rebalance export proven **byte-compatible** with today's output
- [ ] each of the three flags: unset → today's output byte-for-byte; on → parity-clean
- [ ] **tested rollback** per flag: flip on, flip off, assert output returns to the JSON-sourced
      result — three separate tests, since the flags are independent
- [ ] an induced projection error falls back to the authoritative store and logs
- [ ] `npm test`, `npm run build`, `npm run validate:fsm` green

## Escalate rather than force

If any surface cannot reach parity, HALT and report the diff. Shipping a read surface that is
"close enough" silently changes what users and the HiQS export see.
