---
name: bulk-edit-reminders
description: Close (complete or cancel) a batch of live Sleuth reminders from an agent session, after first backing up the workspace's reminders. Uses the app's own Web API, so the reminders FSM, completion history and Slack List sync all apply. Trigger on "close these reminders", "complete/cancel these Sleuth reminders", "bulk edit reminders", "/bulk-edit-reminders".
---

# Bulk-edit (close) Sleuth reminders

Closes a triaged batch of live reminders in one step. The script
(`bulk-edit-reminders.mjs`) always does three things in this order:

1. **Back up** the workspace's raw reminder records (`GET /workspace/:name/reminders`) to
   `~/secrets/sleuth/backups/<workspace>_reminders_<UTC>.json` (mode 600). An empty or failed read
   aborts the run.
2. **Resolve** every requested ID against that backup and print what will change. An unknown,
   ambiguous or repeated ID aborts the run before anything is sent.
3. **Apply** the batch with `POST /workspace/:name/reminders/bulk`, then print one result per
   reminder: `completed`, `canceled`, `not-found` (no longer pending) or `error`.

`complete` uses the same server path as the ✅ reaction: the reminder moves into completion history
and stays on per-user Slack Lists as done. `cancel` uses the same path as deleting a Slack List row:
no completion record, and list rows are removed. Use `complete` unless the reminder should leave no
trace.

## Before running

- **Tunnel / reachability:** the API base URL must reach the app's Web API port. For production
  this is normally an SSH tunnel to the host's port 2020 (see `temp/SOP.md`); the script does not
  open one.
- **Credentials:** `~/secrets/sleuth/sleuth-web-api-<production|development>.env` holding
  `SLEUTH_WEB_API_BASE_URL`, `SLEUTH_WEB_API_TOKEN` (the server's `WEB_API_BEARER_TOKEN`) and
  optionally `SLEUTH_WORKSPACE_NAME`. Environment variables of the same names override the file.
  The file is parsed, never executed, and nothing from it is written anywhere.
- **The server must run a build with the bulk endpoint (GH-279).** An older server answers the
  POST with an error after the backup and resolve steps; nothing is changed.

## Run it

Always dry-run first, show the operator the resolved list, then apply:

```bash
node skills/bulk-edit-reminders/bulk-edit-reminders.mjs --workspace neochrome \
  --complete 36ee5261,15f6da6a --cancel 3b0b509a --reason "triaged stale" --dry-run
# …review the printed rows with the operator, then the same command without --dry-run.
```

| Flag | Meaning |
|---|---|
| `--complete id,…` / `--cancel id,…` | IDs to close: full ReminderIDs or unique prefixes of 8+ characters. Repeatable. |
| `--reason "text"` | Recorded on the server as `api-bulk: <text>` (default `api-bulk: <action>`). |
| `--workspace name` | Default `SLEUTH_WORKSPACE_NAME`. |
| `--env prod\|dev` | Which secrets file to read (default `prod`). `--env-file path` overrides it. |
| `--backup-dir dir` | Default `~/secrets/sleuth/backups`. |
| `--dry-run` | Back up and resolve only; send nothing. |

To find IDs, use `skills/talk-to-reminders` (mirror) or the backup file the dry run writes.
Exit code is `0` only when every reminder was closed. Re-running an applied batch is safe: already
closed reminders report `not-found` and nothing else changes.

## Notes

- Per `AGENTS.md`, never paste a raw reminder ID into Slack; these IDs are for the operator's terminal.
- The server caps a batch at 100 actions and validates the whole batch before writing anything.
- Restoring from a backup is a manual operator step; this skill never writes server files.
