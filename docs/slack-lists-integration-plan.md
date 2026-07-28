# Slack Lists Integration Plan

This document now serves as the current-state roadmap, not the original speculative design.

## Already Landed

### Foundation

- `src/lists-module.js` exists and is wired in from `src/app.js`.
- per-workspace cache is persisted under `data/runtime/workspaces/lists/`.
- reminders JSON remains the source of truth.

### Published API alignment

As of `1.4.107`, the module uses the documented Slack Lists API flow:
- `slackLists.create`
- `slackLists.access.set`
- `slackLists.items.create`
- `slackLists.items.update`
- `slackLists.items.delete`
- `slackLists.items.list`
- `slackLists.items.info`

### Reminder integration

- reminder creation adds a List row
- reminder posting can update row status
- completion/deletion removes the row

## Current Scope Boundary

The integration is intentionally output-only for now.

Not implemented:
- creating reminders from List rows
- editing reminders from List edits
- deleting reminders from List row deletion

If that changes later, it should be treated as a new product decision rather than an incremental cleanup.

## Remaining Roadmap

### 1. Paid-workspace verification

Run a real workspace smoke test with correct scopes and confirm:
- create
- access grant
- add row
- update row
- delete row

### 2. Older-list migration strategy

Define what to do with Lists created before the `1.4.107` schema update.

### 3. Retry/backoff hardening

Wrap Lists calls in a consistent transient-error strategy.

### 4. Optional operator tooling

Possible future additions:
- explicit `show list` command
- explicit `recreate list` admin path
- explicit `resync list from reminders` admin path
