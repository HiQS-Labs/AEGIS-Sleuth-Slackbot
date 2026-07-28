# Slack Lists User Guide

## What This Feature Is

AEGIS can maintain a Slack List as a workspace dashboard of active reminders.

The List is a secondary view over AEGIS's reminder system:
- reminders still live primarily in AEGIS's JSON runtime files
- the Slack List is there to make them easier to browse inside Slack

## Requirements

- paid Slack workspace
- app installed with `lists:read` and `lists:write`

If Lists is unavailable, AEGIS continues working normally without the List.

## What List You Will See

AEGIS creates one List per workspace named:

- `AEGIS To-do's`
- or `AEGIS To-do's (<environment>)` when the app is running with an environment suffix

## Current Columns

Each row includes:

- `Task`: primary reminder summary
- `Status`: `pending`, `posted`, or `completed`
- `Completed`: checkbox used by AEGIS when marking a reminder complete
- `Assignee`: extracted or stored assignee
- `Due Date`: human-readable due text pulled from the reminder message when available
- `Created On`: formatted reminder schedule timestamp
- `Source`: origin Slack channel
- `Message`: permalink to the source message
- `Requester`: original sender
- `Reminder ID`: internal AEGIS reminder ID

## How It Updates

- New reminder created in AEGIS: new List row is added.
- Reminder posts successfully: row status is updated to `posted`.
- Reminder completed with ✅ reaction: AEGIS marks the row completed and then removes it when the reminder is deleted from the active queue.
- Reminder canceled/deleted: the row is removed.

## Important Behavior Note

The Slack List is currently output-only from AEGIS's perspective.

That means:
- you can view, sort, and filter it in Slack
- direct manual edits in the List are not treated as authoritative reminder changes
- adding or deleting rows manually in Slack Lists does not create or remove AEGIS reminders

## Troubleshooting

### I do not see a List

Check:
- workspace is on a paid Slack plan
- app has `lists:read` and `lists:write`
- app was reinstalled after adding scopes

### My List exists but status/completed columns do not behave as expected

If the List was created before `1.4.107`, it may be using the older schema. In that case the workspace may need an intentional List recreation or cache reset to pick up the new columns.
