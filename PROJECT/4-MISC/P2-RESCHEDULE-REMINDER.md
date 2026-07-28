---
title: Reschedule a Reminder via Natural Language
status: RETIRED 2026-07-17 — no activity since 2026-06-13, operator call during a PDDA doc-hygiene sweep. Not built; retire rather than build if this need resurfaces (re-file as a new issue).
priority: P2
owner: Robin Lee
created: 2026-06-13
updated: 2026-07-17
effort: Low–Medium (~1–2 days)
risk: Low–Medium (additive command; touches the reminder FSM write-path)
tags: [reminders, nlp, slack-commands, fsm]
---

# Reschedule a Reminder via Natural Language

Let a user change an existing reminder's fire **time and/or date** by replying in the
reminder's Slack thread, e.g. `@Sleuth reschedule to 10:45 AM`,
`@Sleuth reschedule to tomorrow 3pm`, `@Sleuth reschedule to next Monday 9am`.

## Status

| Most recently completed phase | What's next |
|---|---|
| _None — plan created_ | **Phase 1 — Controlled reschedule core** |

## Table of Contents

- [Effort & Risk](#effort--risk)
- [Design decisions](#design-decisions)
- [What already exists (reused, not rebuilt)](#what-already-exists-reused-not-rebuilt)
- [Phase 1 — Controlled reschedule core](#phase-1--controlled-reschedule-core)
- [Phase 2 — Thread-reply command + targeting + confirmation](#phase-2--thread-reply-command--targeting--confirmation)
- [Phase 3 — Command discovery wiring (help / rmm)](#phase-3--command-discovery-wiring-help--rmm)
- [Phase 4 — Edge cases, tests, deploy & verify](#phase-4--edge-cases-tests-deploy--verify)
- [Anti-goals](#anti-goals)

## Effort & Risk

**Effort: Low–Medium (~1–2 days).** Every hard part already exists and is reused verbatim:
NL date parsing, reminder targeting via message metadata, the time-mutation pattern, and the
4-touchpoint command-wiring convention. Net-new code is one controlled `RescheduleReminderAsync`
method, one app-mention command handler, the catalog/intent wiring, and tests.

**Risk: Low–Medium.** It is additive (a new command) and reuses proven infrastructure, but it
**writes to the reminder FSM** ([src/reminders-module.js](../../src/reminders-module.js)), so it
must obey the write-path contract (mutate `ShouldPostOn` → `#TransitionReminderState` →
`#SaveRemindersAsync`) and respect the 30s posting-loop cycle. The real risk surface is
edge-state handling (rescheduling a reminder that's mid-post, already completed/canceled, or a
message carrying multiple reminder IDs) and NL mis-parse — all contained in Phase 4.

## Design decisions

- **Targeting = thread reply (decided).** The user replies in the reminder message's thread:
  `@Sleuth reschedule to <time>`. The handler reads the **parent (root) message's existing
  `event_type: "sleuth-ai-reminder-ids"` metadata** to resolve the `ReminderID`(s) — the exact
  mechanism the ✅/🗑 reaction handlers already use ([src/reminders-reaction-handler.js:117–131](../../src/reminders-reaction-handler.js)).
  No IDs to type; the unstable A–I letters are never used as identifiers.
- **Trigger surface = app-mention reply.** Routed in `RemindersAppMentionHandler`, so it cannot
  be mistaken for a new auto-scheduled reminder and runs before auto-scheduling.
- **Permissions:** reminder **creator** (`OriginalSenderID`) OR **assignee** (`AssigneeID`) OR
  workspace **admin/owner** (`IsAdminOrOwnerAsync`). Mirrors the existing enable/disable gate.
- **Time semantics:** reuse `ExtractDateWithGptAsync` as-is — time-only ("10:45 AM") assumes
  today and rolls forward if already past; relative ("tomorrow 3pm", "next Monday") and explicit
  dates supported; all timezone-aware via `MAIN_TIMEZONE`.

## What already exists (reused, not rebuilt)

| Need | Existing asset | Location |
|---|---|---|
| Parse NL → fire datetime | `ExtractDateWithGptAsync(phrase)` → `{success, date, wasAdjustedForward}` | [src/reminders-ai-pipeline.js:384](../../src/reminders-ai-pipeline.js) |
| Identify the reminder | `event_type: "sleuth-ai-reminder-ids"` msg metadata → `event_payload.ReminderIDs` | [src/reminders-reaction-handler.js:117](../../src/reminders-reaction-handler.js) |
| Read a message's metadata | `SlackApp.GetMessageMetadataAsync(channel, ts)` | src/slack-app.js |
| Mutate fire time safely | inline pattern: set `ShouldPostOn` → `#TransitionReminderState` → save | [src/reminders-module.js:2431–2445](../../src/reminders-module.js) |
| Persist | `#SaveRemindersAsync()` over `#PendingRemindersQueue` | [src/reminders-module.js:2100](../../src/reminders-module.js) |
| Confirmation reply w/ metadata | `PostMessageTextAsync(ch, ts, text, metadata, {Tag})` | [src/reminders-module.js:1233](../../src/reminders-module.js) |
| Command wiring convention | route → catalog → intent-resolver → HELP regen | ARCHITECTURE.md "Command Catalog" |

---

## Phase 1 — Controlled reschedule core

**Goal:** A single FSM-safe method that changes a reminder's `ShouldPostOn` from a NL phrase, with no Slack/command surface yet (pure, unit-testable).

- [ ] Add `async RescheduleReminderAsync(ArgReminderID, ArgTriggerPhrase, ArgReason)` to `RemindersModule`.
- [ ] Resolve the reminder from `#PendingRemindersQueue` by `ArgReminderID`; return a typed "not found" result if absent.
- [ ] Call `#AIPipeline.ExtractDateWithGptAsync(ArgTriggerPhrase)`; on `success === false` return a typed "unparseable" result (no mutation).
- [ ] Reject reschedule when the reminder is in a terminal/in-flight state (`Completed`, `Canceled`, `DeadLetter`, `Posting`) → typed "not-reschedulable" result.
- [ ] Mutate `Reminder.ShouldPostOn = result.date` and set `Reminder.IgnoreSnooze = false`.
- [ ] If state ≠ `Scheduled`, call `#TransitionReminderState(Reminder, Scheduled, 'user-reschedule')` (never assign `.State` directly).
- [ ] Call `#SaveRemindersAsync()`; log old→new `ShouldPostOn` with the reminder ID.
- [ ] Return `{ success, reminder, newDate, wasAdjustedForward }` for the caller to render.

### QA checklist — Phase 1

- [ ] Unit: valid phrase on a `Scheduled` reminder → `ShouldPostOn` updated, persisted to `<ws>_reminders.json`, `[reminder-state]` log emitted → returns success.
- [ ] Unit: unknown `ReminderID` → no mutation, no save → typed not-found.
- [ ] Unit: unparseable phrase ("banana") → no mutation → typed unparseable.
- [ ] Unit: `Completed`/`Canceled`/`Posting` reminder → no mutation → typed not-reschedulable.
- [ ] DRY/SOLID: time-of-day mutation reuses the existing `ShouldPostOn`+transition pattern; no new state added to the FSM; no `reminder.State =` outside `#TransitionReminderState`.
- [ ] Observability: every reschedule logs `ReminderID old→new` at INFO (matches `[reminder-state]` audit style).
- [ ] Race: a reschedule landing between two 30s check cycles does not double-post or skip (mutation only affects the next cycle's filtered snapshot).
- [ ] Conventions: `Arg`-prefixed params, PascalCase method, private-field access only inside the class.

---

## Phase 2 — Thread-reply command + targeting + confirmation

**Goal:** `@Sleuth reschedule to <time>` replied in a reminder's thread resolves the reminder, enforces permissions, calls Phase 1, and confirms in-thread.

- [ ] Register a route in `RemindersAppMentionHandler.#RegisterCommandRoutes`, e.g. `Pattern: /\breschedule\b[\s,:]*(?:to\s+)?(.+)/is`, `Route: 'reschedule-reminder'`.
- [ ] In the handler, take the reply's `thread_ts` (the reminder message root) and call `GetMessageMetadataAsync(channel, thread_ts)`.
- [ ] Reject with a friendly message if the parent has no `sleuth-ai-reminder-ids` metadata ("reply this under a reminder message to reschedule it").
- [ ] Parse `event_payload.ReminderIDs`; if exactly one → use it; defer multi-ID handling to Phase 4.
- [ ] Permission gate: allow if `user === OriginalSenderID || user === AssigneeID || IsAdminOrOwnerAsync(user)`; else post the standard denial and stop.
- [ ] Extract the time phrase from capture group 1 and call `RescheduleReminderAsync(id, phrase, 'thread-reply')`.
- [ ] Post an in-thread confirmation with `sleuth-ai-reminder-ids` metadata + `{ Tag: 'reminder-reschedule' }`, rendering the new time in `MAIN_TIMEZONE` (e.g. "✅ Rescheduled to Fri Jun 13, 10:45 AM PT").
- [ ] If `wasAdjustedForward`, note it ("that time already passed today, set for tomorrow").
- [ ] On unparseable/not-found/not-reschedulable, post the matching friendly error.

### QA checklist — Phase 2

- [ ] E2E (mock Slack): reply `@Sleuth reschedule to 10:45 AM` under a reminder → `ShouldPostOn` updated → confirmation posted in the same thread.
- [ ] Reply under a NON-reminder message → friendly "not a reminder" reply, no mutation.
- [ ] Non-creator / non-assignee / non-admin → denial message, no mutation.
- [ ] Confirmation message carries the reminder's `ReminderID` in metadata (so ✅/🗑 still work on it).
- [ ] Relative & explicit phrases ("tomorrow 3pm", "next Monday 9am", "Jun 20 8am") → correct UTC `ShouldPostOn`, displayed in workspace TZ.
- [ ] DRY: targeting reuses `GetMessageMetadataAsync` + the metadata contract (no new identifier scheme); confirmation reuses `PostMessageTextAsync` metadata path.
- [ ] Altitude: handler stays thin — parsing/mutation live in Phase 1's method, not duplicated in the handler.

---

## Phase 3 — Command discovery wiring (help / rmm)

**Goal:** The command is discoverable via `help`, `commands`, and `rmm` ("read my mind") — the 4 documented touchpoints stay balanced so `validate:commands` passes.

- [ ] Confirm the route is registered (Phase 2) — touchpoint (a).
- [ ] Add a `command-catalog.json` entry: `Id: "reschedule-reminder"`, `Permission`, `Risk: "low"`, `CanExecuteWithIfl: false`, `Description`, `SyntaxExamples`, `Aliases` ("reschedule", "change reminder time", "move reminder to"), `IntentPhrases`, `ArgumentHints` (the new time), `DisambiguationNotes`, `RegisteredRoutes: ["reschedule-reminder"]`, help/commands ordering + `HelpSection: "Reminders"`.
- [ ] Add `reschedule-reminder` cases to `BuildCanonicalCommand` and `BuildSyntaxTemplate` in [src/command-intent-resolver.js](../../src/command-intent-resolver.js).
- [ ] Regenerate help: `node scripts/generate-help.js`.
- [ ] Run `npm run validate:commands` — route↔catalog↔HELP invariant clean.

### QA checklist — Phase 3

- [ ] `@Sleuth help` lists Reschedule under Reminders; `@Sleuth commands` shows it.
- [ ] `rmm` on "move my reminder to 10:45" resolves to `reschedule-reminder`.
- [ ] `npm run validate:commands` passes (no orphan route, no orphan catalog entry, HELP.md matches generated output).
- [ ] No code-only alias added that's invisible to the catalog (discovery metadata lives in JSON, not code).

---

## Phase 4 — Edge cases, tests, deploy & verify

**Goal:** Harden the awkward states, lock behavior with tests, ship to dev, verify on a real reminder.

- [ ] Multi-ID parent (a scheduling-feedback message carries several `ReminderIDs`): decide + implement — either reschedule all with an explicit "rescheduled N reminders" confirmation, or ask the user to reply under the specific item. (Default: reschedule all, list them.)
- [ ] Past-time clarity: surface `wasAdjustedForward` in the confirmation so "10:45 AM" at 2 PM clearly means tomorrow.
- [ ] Snooze interaction: a reschedule onto a snooze day still respects the snooze guard on the next cycle (no double-handling); `IgnoreSnooze` reset is correct.
- [ ] Concurrency: reschedule fired in the same 30s window the reminder is being posted → no crash, no duplicate; verify against the filtered-snapshot behavior.
- [ ] Full Jest run green: `npm run build` + `npm test` (run jest under the Node that built `better-sqlite3`).
- [ ] `npm run validate:ai` if any prompt/schema asset touched (none expected).
- [ ] Deploy to **development**; in a dev channel, reply `@Sleuth reschedule to <2 min from now>` under a real reminder → it re-posts at the new time.
- [ ] Confirm the rescheduled reminder still completes/cancels via ✅/🗑 (metadata intact).

### QA checklist — Phase 4

- [ ] Tests cover: success, not-found, unparseable, terminal-state, permission-denied, multi-ID, past-time-rollover.
- [ ] Manual dev verification reproduces a real reschedule end-to-end (posts at the new time).
- [ ] No regression in auto-scheduling, the daily digest, or reaction lifecycle (run the reminder test suite).
- [ ] Observability: a reschedule is fully reconstructable from logs (who, which reminder, old→new).
- [ ] **Deploy needed:** yes — development first; prod only after sign-off.
- [ ] CHANGELOG entry added describing the new command + the FSM write-path it uses.

---

## Anti-goals

- **No recurring-cadence editor.** This changes one reminder's next fire time; it does not add
  "every weekday at 9am" rules. (The existing next-day auto-reschedule behavior is unchanged.)
- **No bulk reschedule UI / no web-admin surface.** Thread-reply only.
- **No new identifier scheme** (no typed IDs, no stable letter labels) — targeting is by replying
  under the message, via existing metadata.
- **No change to the 30s posting loop or the daily digest.**
