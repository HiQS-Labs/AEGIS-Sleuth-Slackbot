# Slack Lists Implementation Notes

## Current Status

Slack Lists integration is implemented and wired into the main runtime, with the published API contract fixes landed in `1.4.107`.

Core implementation files:
- `src/lists-module.js`
- `src/app.js`
- `src/reminders-module.js`
- `src/reminders-reaction-handler.js`

## Runtime Behavior

Per workspace startup:
1. `app.js` creates `ListsModule`.
2. `app.js` wires `RemindersModule` and `ListsModule` together.
3. `RemindersModule` starts before `ListsModule`.
4. `ListsModule` checks availability, loads cache, verifies or creates the cached List, then starts polling.

Reminder lifecycle integration:
- New reminder queued: add row to Slack List.
- Reminder posts successfully: update row status to `posted`.
- ✅ completion reaction: mark row `completed`, then normal reminder deletion removes the row.
- Reminder deletion/cancel path: delete row from Slack List.
- Per-user row title edits: update the persisted AEGIS reminder summary, then mirror the new title to the other list contexts tracking that reminder.

## Architectural Contract

Slack Lists is intentionally JSON-backed, but no longer output-only.

- JSON reminder files remain the source of truth.
- Slack Lists is a synchronized workspace view over that store.
- Direct edits inside durable per-user Lists are used for a bounded set of reminder mutations:
  - row completion -> complete reminder
  - row deletion -> cancel reminder
  - hand-authored row create -> create reminder (when minimum fields are valid)
  - row title edit -> update reminder summary
- Polling exists to keep cache state current and to detect/edit those inbound user actions safely.

## API Choices

As of `1.4.107`, the module uses the documented Slack Lists calls:

- `slackLists.create`
- `slackLists.access.set`
- `slackLists.items.create`
- `slackLists.items.update`
- `slackLists.items.delete`
- `slackLists.items.list`
- `slackLists.items.info`

Important implementation details:
- List access is granted with `slackLists.access.set`, not `files.share`.
- Shared lists grant the reminder channel `read`; per-user lists grant the target user `write` and the invocation channel an optional `read` share.
- Item updates are sent as `cells` with `row_id` and `column_id`.
- Item deletes use `{ list_id, id }`.
- Cached-list existence is verified with `slackLists.items.list`, not an undocumented `slackLists.info`.
- Item readback consumes `record` from `slackLists.items.info`.

## Persistence

Lists cache is stored per workspace at:

- `data/runtime/workspaces/lists/<WORKSPACE_NAME>_lists_cache.json`

Persisted fields:
- `listId`
- `itemCache`
- `lastSync`
- `listSchema`

## Known Caveats

### Paid plan and scopes

- Lists only works on paid Slack workspaces.
- The app also needs `lists:read` and `lists:write`.

### Existing pre-1.4.107 Lists

Older Lists may have been created without the current `status` and `completed` columns. The module will still operate, but those specific row updates depend on the columns existing in the cached schema.

If a workspace needs the new columns and its List predates `1.4.107`, the operator may need to recreate the List or intentionally reset the cached List ID after confirming that is acceptable.

### Rate limiting

The implementation logs Slack API failures clearly, but it still uses a conservative pacing strategy rather than a generalized retry/backoff wrapper for every Lists call.
