---
gh_issue: 191
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/191
title: "DND/silent mode turns off reminder notifications at channel and workspace level"
status: In progress (2-WORKING)
created: 2026-09-10
doc_type: feature
rated: 75/45/80/75
---

# GH-191 — DND / Silent Mode for Reminders

## Context & Requirements
- Channel-level and workspace-level toggle for DND / Silent mode.
- Silences reminder notifications (overdue reminder delivery and morning reminder digest).
- Main defined channel posts a DND notice in lieu of the morning reminders when DND is enabled on any channel or workspace:
  "Note: AEGIS Sleuth Reminders are DND on this group or channel. Use [command] to turn them on."
- Supports single-channel setups where the main reminder channel is the only channel and has DND toggled on.
- Fully integrated with the `rmm` / `rmm ifl` command family.
- Re-uses existing patterns (DRY, /ponytail lens, no extraneous subsystems).

## Implementation Details
- `src/reminders-dnd-settings.js`: Persistent JSON storage (`data/runtime/reminders/${WorkspaceName}_dnd.json`) managing workspace boolean flag and set of silenced channel IDs with atomic write serialization.
- `src/chat-commands/dnd-command.js`: Command handler for `dnd status`, `dnd [on|off]`, `dnd workspace [on|off]` with authorization checking (channel creator or workspace admin for channel toggles, workspace admin for workspace toggles).
- `src/chat-module.js`: Registered `dnd` route closing over `this.#SlackApp` (tenant-isolated).
- `src/command-intent-resolver.js`: Canonical command builder for `dnd` intents (`CanExecuteWithIfl: true`).
- `data/static/ai/command-catalog.json` & `data/static/HELP.md`: Added `dnd` command entry, aliases, and intent phrases.
- `src/reminders-module.js`:
  - Instantiates and initializes `RemindersDndSettings` per workspace.
  - `#CheckRemindersAsync`: Due reminders are held in `Overdue` state during DND without premature advancement or forbidden state mutations (clean FSM). Delivery suppresses messages to channels in DND.
  - `#RunDailyTaskDigestAsync`: If workspace or any channel has DND active, posts a notice on the configured `ReminderChannelID` explaining which scopes are muted and how to turn them back on in lieu of morning reminders.

## Verification
- Unit & integration test suites:
  - `tests/reminders-dnd-settings.test.js`: 6/6 tests passing
  - `tests/dnd-command.test.js`: 7/7 tests passing
  - `tests/reminders-dnd-integration.test.js`: 4/4 tests passing
  - `tests/command-intent-resolver.test.js`: 48/48 tests passing
  - `tests/reminders-*.test.js`: 378/378 tests passing
- Static guards:
  - `npm run build`: pass (0 TypeScript errors)
  - `npm run validate:workspace-isolation`: clean
  - `npm run validate:fsm`: clean
  - `npm run validate:reminder-render`: clean
  - `npm run validate:changelog-tone`: clean
  - `npm run validate:ai`: clean

