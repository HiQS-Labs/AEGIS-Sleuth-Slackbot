# p8 — Reversibility drill: prove every switch flips back

Release 1.5.0 "Ledger" · final phase · depends on p7

## Why this phase exists

The whole release was authorised on one condition: *the switches are easily reversible*. Every
earlier phase **claims** its switch is reversible. This phase is where that claim gets tested as a
system, under conditions closer to production than a unit test.

A rollback path that has never been exercised is not a rollback. It is an assumption with good
intentions.

## Scope

`tests/p3-reversibility-drill.test.js` — an end-to-end drill across every P3 flag now in play:

- `SUMMARIZE_WEEK_COMPLETED_SOURCE` (Phase 2, already live)
- `REMINDER_STATE_SOURCE` (p5)
- `REMINDERS_READ_SOURCE`, `COMPLETED_READ_SOURCE`, `REBALANCE_EXPORT_SOURCE` (p6)

For each flag, and then for all of them together:

1. capture baseline behavior with everything OFF
2. turn it ON, perform real work — create, complete, and cancel reminders
3. turn it OFF again
4. assert behavior returns to baseline **and no writes performed during step 2 were lost**

Step 4 is the point of the drill. Data written while the log was authoritative must still be present
after rolling back to the JSON path. If it is not, the switch is not reversible and the release's
premise is wrong — say so loudly rather than adjusting the test.

## The p7 case this drill exists to catch

After p7 (Phase 6a) the mutable write path is **gone** — the on-disk JSON is now a *derived*
snapshot. So the rollback story changed shape: rolling back no longer means "read the file the old
writer maintained", it means "read the file the snapshot writer produced".

Drill that specifically:

- run with the log authoritative, do real work, let at least one snapshot be written
- flip everything OFF and reboot **from the derived snapshot alone**
- assert no work from the log-authoritative period is missing

If this fails, Phase 6a is not reversible in practice however clean its unit tests were — say so and
stop. This is the single most important assertion in the release, because after p7 there is no other
writer maintaining that file.

Also drill a **stale snapshot**: roll back to a snapshot written *before* the most recent events and
report exactly what is lost. The answer feeds the Phase 6b decision — if the gap is material, 6b
needs a stronger story than "keep read for one release".

## Also test the ugly cases

- flag ON with a **truncated or corrupt** log → falls back, boots, does not lose state
- a **truncated or corrupt snapshot** → the app still boots by replaying the log
- flag flipped mid-process (not just between boots), if any surface reads it per-request
- a workspace where the flag is ON while another has it OFF — staged rollout means both exist at
  once and must not interfere

## Deliverable beyond tests

`docs/p3-rollback-runbook.md` — a short operator-facing page:

- every flag, what it does, its default
- the exact command to roll each one back
- what to check after rolling back to confirm it worked
- which failures mean "roll back now" versus "investigate first"

Written so an operator at 2am who did not build this can act on it.

## Done when

- [ ] every flag has a pass/fail drill result recorded in the turn — not a summary, per-flag
- [ ] no-data-loss assertion passes for every flag individually and for all-on → all-off
- [ ] corrupt-log fallback verified
- [ ] mixed-workspace (one ON, one OFF) verified non-interfering
- [ ] `docs/p3-rollback-runbook.md` exists and names every flag currently in the codebase
- [ ] `npm test`, `npm run build`, `npm run validate:fsm` green

## If a switch does not flip back

Do not fix it quietly and move on. Report which flag failed, what was lost, and stop. The operator
authorised Phases 3-5 specifically on the basis that this drill would pass; a failure here is
information they need, not an obstacle to route around.
