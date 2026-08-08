# Marathon Phase p7
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P7-TURN builder=codex reviewer=agy round-cap=7 -->

## Phase Brief

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


---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/completion-store.js,src/reminders-module.js,src/state-snapshot-writer.js,tests/derived-snapshot-writer.test.js
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick claim MARATHON-P7-TURN --agent codex --paths "phases/ledger-p3-entity-linking--p7/RELAY.md,src/completion-store.js,src/reminders-module.js,src/state-snapshot-writer.js,tests/derived-snapshot-writer.test.js"
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick ping MARATHON-P7-TURN --agent codex
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P7-TURN --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p7/RELAY.md and src/completion-store.js,src/reminders-module.js,src/state-snapshot-writer.js,tests/derived-snapshot-writer.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/completion-store.js,src/reminders-module.js,src/state-snapshot-writer.js,tests/derived-snapshot-writer.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P7-TURN --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick done MARATHON-P7-TURN --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p7/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
