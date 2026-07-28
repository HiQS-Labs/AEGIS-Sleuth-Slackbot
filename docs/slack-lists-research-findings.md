# Slack Lists Research Findings

Date checked: 2026-05-13

## Executive Summary

Slack Lists is a real, published Slack Web API surface and is viable for AEGIS's reminder dashboard use case.

The important distinction is that viability depends on matching the exact published request/response shapes. The earlier repo notes were too optimistic on that point. As of `1.4.107`, AEGIS now aligns its core create/access/update/delete calls with the published Lists contract.

## Published API Facts

- Lists are available only on paid Slack workspaces.
- Bot or user tokens need `lists:read` and `lists:write` depending on the method.
- The published method family currently includes:
  - `slackLists.create`
  - `slackLists.update`
  - `slackLists.access.set`
  - `slackLists.access.delete`
  - `slackLists.items.create`
  - `slackLists.items.update`
  - `slackLists.items.delete`
  - `slackLists.items.deleteMultiple`
  - `slackLists.items.list`
  - `slackLists.items.info`
  - `slackLists.download.start`
  - `slackLists.download.get`

## Contract Details That Matter For AEGIS

### List creation

- `slackLists.create` accepts `name`, optional `description_blocks`, optional `schema`, optional `copy_from_list_id`, optional `include_copied_list_records`, and optional `todo_mode`.
- Channel visibility is not a `channel_id` argument on create. Channel or user access is managed separately via `slackLists.access.set`.

### Item creation

- `slackLists.items.create` uses `initial_fields`.
- Each field entry references a `column_id` and a typed payload such as `rich_text`, `select`, `checkbox`, `user`, `channel`, `link`, `message`, `date`, or `number`.
- Text columns must still be sent as `rich_text` blocks, not plain `text`.

### Item updates

- `slackLists.items.update` updates `cells`, not an `item` object.
- Each cell update requires `row_id`, `column_id`, and a type-specific payload.

### Item deletion

- `slackLists.items.delete` expects `{ list_id, id }`.

### Item reads

- `slackLists.items.list` returns row arrays under `items`.
- `slackLists.items.info` returns the row under `record` and list metadata under `list`.

## Current AEGIS Design

AEGIS uses Slack Lists as a secondary workspace view over reminder data, not as the primary store.

- Primary store: workspace-scoped JSON reminder files under `data/runtime/`.
- Secondary view: one per-workspace Slack List managed by `src/lists-module.js`.
- Source of truth: reminders JSON, not manual List edits.

That means:
- reminders created in AEGIS are added to the List.
- reminder posting can update List status.
- reminder deletion removes the List row.
- direct edits in Slack Lists are currently ignored by design.

## Current AEGIS Schema

As of `1.4.107`, AEGIS creates Lists with these custom columns:

- `summary` (`text`, primary)
- `status` (`select`)
- `completed` (`checkbox`)
- `assignee` (`user`)
- `due_date` (`text`)
- `created_on` (`text`)
- `source_channel` (`channel`)
- `original_message` (`link`)
- `requester` (`user`)
- `reminder_id` (`text`)

## Remaining Research / Validation Gaps

- The repo does not contain a checked-in Slack app manifest, so scope configuration cannot be verified locally from source.
- Live verification on a real paid workspace is still required for end-to-end confidence, especially around access visibility and operational rate limits.
- Older Lists created before the `1.4.107` schema change may not have the new `status` and `completed` columns. That is a migration concern, not an API-doc question.

## Sources

- https://docs.slack.dev/changelog/2025/09/02/list-api/
- https://docs.slack.dev/surfaces/lists/
- https://docs.slack.dev/reference/methods/slackLists.create/
- https://docs.slack.dev/reference/methods/slackLists.access.set/
- https://docs.slack.dev/reference/methods/slackLists.items.create/
- https://docs.slack.dev/reference/methods/slackLists.items.update/
- https://docs.slack.dev/reference/methods/slackLists.items.delete/
- https://docs.slack.dev/reference/methods/slackLists.items.info/
- https://docs.slack.dev/reference/methods/slackLists.items.list/
- https://docs.slack.dev/reference/scopes/lists.read/
- https://docs.slack.dev/reference/scopes/lists.write/
