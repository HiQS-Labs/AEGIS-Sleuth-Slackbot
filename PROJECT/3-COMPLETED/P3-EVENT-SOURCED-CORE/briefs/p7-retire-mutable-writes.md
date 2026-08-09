# p7 — Phase 6a: retire the mutable write path, keep a derived snapshot

Release 1.5.0 "Ledger" · P3 Phase 6a · depends on p6

The reversibility contract in `MARATHON.yaml` is binding. This phase deletes real machinery, so read
the split rationale at the top of that file before starting.

## The idea in one line

Stop writing JSON *mutably*. Keep producing it *derivatively*. The old machinery goes; the fallback
file stays fresh.

## What is removed

- the bespoke durability queue
- the `FlushAsync` shutdown coupling it required
- `CompletionStore` as a mutable store — it collapses into a projection

## What replaces it

`src/state-snapshot-writer.js`: after a fold, write the resulting state to the **same on-disk shape**
the legacy loader already reads, using `durable-write.js` (GH-12: temp → fsync → rename → fsync dir).

Two properties make this the whole point of the phase:

1. **Legacy-loadable.** A snapshot must be loadable by the pre-P3 read path with no conversion. That
   is what keeps rollback a flag flip instead of a migration.
2. **Derived, not mutated.** It is a dump of folded state, not an in-place edit. No queue, no
   shutdown coupling, no partial-write window beyond what `durable-write.js` already guarantees.

Also add the snapshotting/compaction from the Phase 6 spec: event-count-based snapshots by default
for predictable replay bounds, plus a truncated log so replay stays bounded.

## What is explicitly NOT removed

**The legacy read path stays.** Removing it is Phase 6b, a separate later release. Keeping the reader
plus a fresh snapshot is exactly what makes this phase reversible.

Do not touch the three FSM write chokepoints. `npm run validate:fsm` must stay green.

## The test that decides whether this phase is honest

Write state with the new derived writer, then load it with the **legacy loader** and assert deep
equality against the folded state. If the legacy loader cannot read what the derived writer produces,
the rollback path is broken and this phase must HALT — regardless of how clean the rest looks.

## Done when

- [ ] durability queue and `FlushAsync` coupling deleted; nothing references them
- [ ] `CompletionStore` is a projection; its old mutable write path is gone
- [ ] snapshot written via `durable-write.js`, in a legacy-loadable shape
- [ ] **legacy loader reads a derived snapshot to deep-equal state** (the decisive test above)
- [ ] event-count snapshotting + log truncation, with a test bounding replay work
- [ ] a crash mid-snapshot leaves either the previous good snapshot or a complete new one — never a
      truncated file (reuse the GH-12 crash-injection harness; its `unsafe` control must still
      reproduce damage, or the run self-fails)
- [ ] **tested rollback**: flip `REMINDER_STATE_SOURCE` off after running on the log, reboot from the
      derived snapshot, assert no data written during the log-authoritative period is lost
- [ ] `npm test`, `npm run build`, `npm run validate:fsm` green

## Report honestly

State in the turn how large a snapshot is, how long a cold replay takes at the current log size, and
whether truncation actually bounds it. Phase 6b's future case rests on those numbers — if replay is
already slow, say so rather than letting it be discovered later.
