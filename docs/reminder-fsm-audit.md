# Reminder Scheduling Audit: FSM, Weekend Snooze, DRY and SOLID

## Recommendation on FSM

Use an FSM for the **scheduled reminder lifecycle**, not for the entire application.

A lightweight FSM makes reminder behavior explicit and testable while avoiding over-engineering global app flows.

### Implemented reminder states (v1.4.58+)

The FSM is now the primary controller of the reminder lifecycle. States are defined in `RemindersModule.ReminderState` and transitions are enforced exclusively through `#TransitionReminderState()`.

| State | Meaning |
|---|---|
| `scheduled` | Persisted, waiting for `ShouldPostOn` to arrive |
| `overdue` | Time has passed; holding for post decision (new — replaces transient `due` as primary gating state) |
| `snoozed` | Deferred because today is in `SNOOZE_DAYS` |
| `posting` | Slack send(s) in progress |
| `posted` | At least one send succeeded; rescheduling imminent |
| `rescheduled` | Next-day due date computed |
| `failed` | All send attempts failed; will retry on next mark pass |
| `completed` | Terminal — white_check_mark reaction; reminder deleted |
| `canceled` | Terminal — wastebasket reaction; reminder deleted |
| `dead-letter` | Terminal — bot not a channel member; reminder deleted |

**Removed:** `draft` (was proposed, never implemented — not needed since reminders are only queued after AI extraction succeeds).
**Legacy:** `due` is kept in `ReminderState` for backward compatibility; reminders persisted in `due` state are promoted to `overdue` on load.

### Two-pass check cycle

`#CheckRemindersAsync` now runs two sequential passes every 30 seconds:

**Pass 1 — Mark pass** (state-driven, no Slack I/O):
- `scheduled` where `now >= ShouldPostOn` → `overdue` (reason: `time-reached`)
- `failed` where `now >= ShouldPostOn` → `overdue` (reason: `retry`; always post-eligible)

**Pass 2 — Post pass** (Slack I/O):
- `overdue` where overdue by ≤ 24 hours → apply snooze check, then post
- `overdue` where overdue by > 24 hours → left in `overdue` (shows in "show my reminders" past buckets without flooding Slack)
- `overdue` retry-eligible (from `failed`) → always post regardless of age threshold

**Auto-post threshold:** 24 hours. Reminders that become overdue while the app is down for more than a day accumulate in `overdue` and appear in the "Last 7 Days" / "Older" buckets of `show my reminders` instead of flooding Slack on restart.

### Valid FSM transitions

```
scheduled  →  overdue              (mark pass: time-reached)
scheduled  →  overdue              (mark pass: force-process-all)
failed     →  overdue              (mark pass: retry)
overdue    →  snoozed              (post pass: snooze-day)
overdue    →  posting              (post pass: post attempt)
snoozed    →  scheduled            (after advancing ShouldPostOn past snooze days)
posting    →  posted               (post pass: at least one channel succeeded)
posting    →  failed               (post pass: all channels failed — will retry)
posting    →  dead-letter          (terminal: bot not a channel member)
posted     →  rescheduled          (next-day due date computed)
rescheduled→  scheduled            (waiting for next mark pass)
scheduled  →  completed            (terminal: white_check_mark reaction)
scheduled  →  canceled             (terminal: wastebasket reaction)
overdue    →  completed            (terminal: white_check_mark reaction while overdue)
overdue    →  canceled             (terminal: wastebasket reaction while overdue)
```

## Weekend snooze status

**Fixed in v1.4.x.** Newly created reminders now initialize with `IgnoreSnooze: false`, so they correctly obey weekend snooze policy on first run. `IgnoreSnooze: true` is reserved for explicit override scenarios (e.g., manual force-send command).

## Top 10 refactor opportunities

1. **Split `RemindersModule` into cohesive services (SRP)**
   - It currently owns parsing, deduping, queue persistence, schedule loop, posting, and Slack reaction handling.
   - Extract: `ReminderScheduler`, `ReminderRepository`, `ReminderPoster`, `ReminderPolicy`.

2. **Introduce explicit reminder state transitions (FSM)**
   - Current flow uses booleans and date mutation (`IgnoreSnooze`, `ShouldPostOn`) spread through one processing loop.
   - Replace with a transition table to remove hidden coupling and reduce regressions.

3. **Fix snooze default policy for new reminders**
   - New reminders default to `IgnoreSnooze: true`, conflicting with global weekend snooze expectation.
   - Invert default and add an explicit policy/flag for intentional bypass.

4. **Extract duplicated channel-posting logic in reminder dispatch (DRY)**
   - Posting to target and original channels repeats try/catch/member-check logic.
   - Create one helper that returns structured result (`posted`, `not_member`, `failed`).

5. **Centralize API response handling in `WebAPI` (DRY)**
   - Repeated `try/catch + status(200) + { success, data }` across handlers.
   - Add response helper wrappers to reduce boilerplate and inconsistency.

6. **Replace hardcoded runtime configuration values with injected config**
   - Web API bearer token and port wiring are hardcoded at app startup.
   - Move to env/config provider to satisfy DIP and improve deploy safety.

7. **Extract reusable Slack notification broadcaster (DRY + SRP)**
   - Startup and shutdown notifications duplicate channel-resolve and post patterns.
   - One broadcaster service can handle common message fan-out behavior.

8. **Separate infrastructure concerns from domain logic in `DateUtils`**
   - Utility emits direct `console.log` debug output.
   - Inject logger or return diagnostics to avoid noisy side effects.

9. **Timezone-aware counter reset strategy object**
   - Reminder counter reset still uses fixed UTC hour with TODOs.
   - Encapsulate reset-time policy by workspace timezone and remove hardcoded 15:00 UTC logic.

10. **Reduce tight coupling between modules created in `app.js`**
    - Bootstrapping directly wires many concrete modules and ordering constraints.
    - Add composition root helpers/factories and module interfaces to improve OCP/DIP.

## Startup regression test coverage (v1.4.59+)

The `startup with stale reminders` describe block in `tests/reminders-integration.test.js` exercises the FSM's two-pass check cycle under simulated app-restart conditions. Tests seed overdue reminders to disk, load them via `StartAsync`, and trigger `process reminders now` (which calls `#CheckRemindersAsync(true)`).

| Test | What it guards |
|---|---|
| Single stale reminder posts once and reschedules to tomorrow | Cascade loop regression (v1.4.57 fix): ensures rescheduling jumps to tomorrow-from-now, not +1-from-stored-date |
| Multiple stale reminders each post once | Flood prevention: N overdue reminders produce exactly N posts, not N×cycles |
| IgnoreSnooze reset to false after posting | Snooze policy preservation: after posting, reminder re-enters normal snooze checking |
| Legacy reminder without State field | Backward compat: missing State backfills to `scheduled` and processes normally |
| Legacy `due` state promotes to `overdue` | Backward compat: persisted `due` state (pre-v1.4.58) loads and posts correctly |

**When to add tests here:** Any change to `#CheckRemindersAsync`, `#LoadRemindersAsync`, rescheduling logic, or FSM transition rules should include a corresponding startup regression test.

## Remaining refactor opportunities (not yet implemented)

3. **Extract duplicated channel-posting logic in reminder dispatch (DRY)** — Posting to target and original channels repeats try/catch/member-check logic. Create one helper returning a structured result (`posted`, `not_member`, `failed`).
4. **Centralize API response handling in `WebAPI` (DRY)** — Repeated `try/catch + status(200) + { success, data }` across handlers.
5. **Replace hardcoded runtime configuration values with injected config** — Web API bearer token and port wiring.
6. **Extract reusable Slack notification broadcaster** — Startup and shutdown notifications duplicate channel-resolve and post patterns.
7. **Separate infrastructure concerns from domain logic in `DateUtils`** — Utility emits direct `console.log` debug output.
8. **Timezone-aware counter reset strategy object** — Reminder counter reset still uses fixed UTC hour with TODOs.
9. **Reduce tight coupling between modules created in `app.js`** — Bootstrapping directly wires many concrete modules and ordering constraints.
