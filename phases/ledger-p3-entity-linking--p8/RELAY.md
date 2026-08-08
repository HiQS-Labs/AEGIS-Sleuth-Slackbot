# Marathon Phase p8
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P8-TURN builder=codex reviewer=agy round-cap=5 -->

## Phase Brief

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


---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): tests/p3-reversibility-drill.test.js,docs/p3-rollback-runbook.md,package.json
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick claim MARATHON-P8-TURN --agent codex --paths "phases/ledger-p3-entity-linking--p8/RELAY.md,tests/p3-reversibility-drill.test.js,docs/p3-rollback-runbook.md,package.json"
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick ping MARATHON-P8-TURN --agent codex
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P8-TURN --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p8/RELAY.md and tests/p3-reversibility-drill.test.js,docs/p3-rollback-runbook.md,package.json. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: tests/p3-reversibility-drill.test.js,docs/p3-rollback-runbook.md,package.json. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P8-TURN --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick done MARATHON-P8-TURN --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p8/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
