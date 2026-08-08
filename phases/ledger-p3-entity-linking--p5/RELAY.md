# Marathon Phase p5
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P5-TURN builder=codex reviewer=agy round-cap=7 -->

## Phase Brief

# p5 — Phase 4: boot-time rebuild from the log, behind a reversible flag

Release 1.5.0 "Ledger" · P3 Phase 4 · depends on p4

**This is the first phase that moves authority.** The reversibility contract in `MARATHON.yaml` is
binding. If any part of it cannot be satisfied, HALT and escalate rather than ship.

## Goal

On startup, rebuild in-memory reminder/completion state by **folding the event log** instead of
loading the mutable JSON — behind a flag that is OFF by default.

## The switch

Follow the pattern already shipped at `src/reminders-app-mention-handler.js:1250`:

```js
const UseLogAtBoot =
  String(process.env.REMINDER_STATE_SOURCE || '').toLowerCase() === 'projection';
```

- **unset → today's behavior, byte-for-byte.** Not "equivalent"; identical.
- flag on → fold the log to rebuild state
- **any error during the fold falls back to loading the JSON**, logs a warning, and the app starts
  normally. A failed rebuild must never be a failed boot.

## What must NOT change

**Keep writing the JSON.** Phase 4's own spec: *"Keep writing the JSON as a cache (and as a rollback
escape hatch) but stop trusting it."* The JSON staying fresh is the entire reason this phase is
reversible. Removing writes is Phase 6 and is explicitly excluded from this release.

Do not touch the three FSM write chokepoints (`#MakeScheduledReminder`,
`#TryScheduleRemindersAsync`, `#TransitionReminderState`). `npm run validate:fsm` must stay green.

## The exit criterion that matters

From the spec: *"cold start from log-only reproduces exact prior in-memory state on the `neochrome`
workspace; verified across a restart."*

Make that mechanical: a test that boots with the flag OFF, snapshots in-memory state, boots the same
fixture with the flag ON, and asserts **deep equality**. Not "looks right" — equality.

## Baseline-import dependency

Pre-ledger reminders exist only via `BaselineReminderImported` (GH-355). A fold that ignores those
events silently loses every reminder created before 2026-06-17. Test a mixed stream explicitly.

## Done when

- [ ] flag unset → boot path and in-memory state byte-identical to today
- [ ] flag on → deep-equal state vs the JSON path, on a fixture including baseline-imported events
- [ ] a corrupt/truncated log with the flag ON still boots, via fallback, with a logged warning
- [ ] **tested rollback**: a test that boots with the flag ON, flips it OFF, reboots, and asserts
      correct state from JSON — proving the escape hatch works while the flag has been live
- [ ] JSON writes verified still happening with the flag ON (assert the file changes)
- [ ] `npm test`, `npm run build`, `npm run validate:fsm` green

## Rollout note for the turn

State plainly that this ships **one workspace first**, and what the operator flips to roll back.


---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/reminders-module.js,src/completion-store.js,tests/boot-rebuild-from-log.test.js
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): <repo-root>/.xyz/bin/tick
   - <repo-root>/.xyz/bin/tick claim MARATHON-P5-TURN --agent codex --paths "phases/ledger-p3-entity-linking--p5/RELAY.md,src/reminders-module.js,src/completion-store.js,tests/boot-rebuild-from-log.test.js"
   - <repo-root>/.xyz/bin/tick ping MARATHON-P5-TURN --agent codex
   - <repo-root>/.xyz/bin/tick release MARATHON-P5-TURN --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p5/RELAY.md and src/reminders-module.js,src/completion-store.js,tests/boot-rebuild-from-log.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/reminders-module.js,src/completion-store.js,tests/boot-rebuild-from-log.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: <repo-root>/.xyz/bin/tick release MARATHON-P5-TURN --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: <repo-root>/.xyz/bin/tick done MARATHON-P5-TURN --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: <repo-root>/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p5/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
