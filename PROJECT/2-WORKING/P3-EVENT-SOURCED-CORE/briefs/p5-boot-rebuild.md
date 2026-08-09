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
