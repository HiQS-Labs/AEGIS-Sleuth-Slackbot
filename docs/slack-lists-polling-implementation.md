# Slack Lists Polling Implementation

## Overview

`src/lists-module.js` polls Slack Lists every 5 minutes to keep AEGIS's local List cache current.

This polling layer is not a bidirectional reminder-sync engine. Reminders JSON remains the source of truth.

## What Polling Does

- calls `slackLists.items.list` for the configured List
- compares current rows with the in-memory cache
- records added, updated, and deleted row IDs
- refreshes `#ListItemsCache`
- updates `lastSync`

## What Polling Does Not Do

Current behavior intentionally does **not**:
- create reminders from manually added List rows
- update reminders from manual List edits
- delete reminders because a row was manually deleted

Manual List edits are ignored because AEGIS's reminder files are authoritative.

The one exception is cache hygiene:
- if a row disappears from Slack Lists, AEGIS removes the corresponding `ReminderID -> ListRowID` cache mapping so future writes can recover cleanly.

## Key Methods

- `#StartPolling()`
- `#StopPolling()`
- `#PollListForChangesAsync()`
- `#DetectChanges(ArgCurrentItems)`
- `#HandleAddedListItemAsync(ArgItem)`
- `#HandleUpdatedListItemAsync(ArgOldItem, ArgNewItem)`
- `#HandleDeletedListItemAsync(ArgItem)`

## Cache Layers

### Persistent cache

`#ItemCache`
- maps `ReminderID -> ListRowID`
- persisted to disk in `data/runtime/workspaces/lists/<WORKSPACE_NAME>_lists_cache.json`

### In-memory poll cache

`#ListItemsCache`
- maps `ListRowID -> full row payload`
- used only for change detection between poll cycles

## Why Polling Still Exists If Lists Is Output-Only

It still solves useful operational problems:
- detects externally deleted List rows and clears stale cache mappings
- keeps the module's view of the List fresh after restart
- provides a place to add future opt-in bidirectional behavior without changing the List fetch path again
