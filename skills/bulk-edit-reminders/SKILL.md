---
name: bulk-edit-reminders
description: Back up, close (complete or cancel), retitle, reschedule, reassign or create live Sleuth reminders from an agent session, always backing up the workspace's reminders first. Uses the app's own Web API, so the reminders FSM, completion history and Slack List sync all apply; can open the SSH tunnel itself. Trigger on "close these reminders", "complete/cancel these Sleuth reminders", "retitle/reschedule/reassign/link this reminder", "back up the reminders", "bulk edit reminders", "/bulk-edit-reminders".
---

# Bulk-edit Sleuth reminders

Closes or edits a triaged batch of live reminders in one step. The script
(`bulk-edit-reminders.mjs`) always does three things in this order:

1. **Back up** the workspace's raw reminder records (`GET /workspace/:name/reminders`) to
   `~/secrets/sleuth/backups/<workspace>_reminders_<UTC ms>.json` (mode 600, never overwritten). This
   is the pending reminders only, not completion history (that is in the server's nightly ZIP). An
   empty workspace writes `[]`; a failed or malformed read aborts the run. `backup` on its own runs
   just this step.
2. **Resolve** every requested ID against that backup and print what will change. An unknown,
   ambiguous ID, or the same action twice for one ID, aborts the run before anything is sent.
3. **Apply** the batch with `POST /workspace/:name/reminders/bulk`, then print one result per
   item: `completed`, `canceled`, `updated`, `unchanged`, `created`, `not-found` (no longer
   pending), `busy` (being posted right now; retry), `partial` (the reminder changed but some Slack
   Lists did not follow; fix those by hand) or `error`. The server checks the whole batch first and
   changes nothing if any item is malformed.

`complete` uses the same server path as the ✅ reaction: the reminder moves into completion history
and stays on per-user Slack Lists as done. `cancel` uses the same path as deleting a Slack List row:
no completion record, and list rows are removed. Use `complete` unless the reminder should leave no
trace.

## Before running

- **Tunnel / reachability:** the API base URL must reach the app's Web API port. For production
  this is an SSH tunnel to the host's port 2020. `--tunnel` opens it for you: it needs a loopback
  `SLEUTH_WEB_API_BASE_URL` (e.g. `http://127.0.0.1:12020`), refuses if that port is already in use,
  connects with the host/user/password in `~/secrets/sleuth/vultr-sleuth-production.env` (parsed,
  never sourced; the password reaches `sshpass` through `$SSHPASS`, never the command line), and
  closes the tunnel when the run ends. With `--env dev` it uses the `sleuth-oracle-dev` ssh alias. An
  env whose URL already reaches the API directly needs no tunnel, and `--tunnel` refuses there.
- **Credentials:** `~/secrets/sleuth/sleuth-web-api-<production|development>.env` holding
  `SLEUTH_WEB_API_BASE_URL`, `SLEUTH_WEB_API_TOKEN` (the operator bearer or a scoped bot key) and
  optionally `SLEUTH_WORKSPACE_NAME`. Environment variables of the same names override the file.
  The file is parsed, never executed, and its token is never copied into backup or request files.
- **The server must run a build with the bulk endpoint (GH-279; GH-290 for the edit actions).** An
  older server refuses the whole batch after the backup and resolve steps; nothing is changed.

## Bot principals (GH-301)

Bot keys (`slp_…`) use **direct HTTPS only**, without `--tunnel`. Every request sends an explicit
User-Agent and refuses redirects. Each write gets an Idempotency-Key; every edit takes `ifMatch`
from the fresh private backup. Bot requests permit one action per reminder, at most 100 actions,
and a create must be alone. Bots cannot reassign, force titles or supply senderId. The server still
independently enforces workspace/scope/repository authorization and field validation.

Before posting, the CLI saves the exact key/body/destination/principal identity in a mode-600
`*.request.json` beside the backup; it contains no credential and stays unchanged. Responses are saved
to separate, uniquely named mode-600 result files, so a failed result write cannot erase the saved
key/body. For an explicit edit/lifecycle retry use:

```bash
node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs --env-file /path/to/bot.env \
  --replay /path/to/backup.json.request.json
```

Replay takes another backup but keeps the original body, versions and key. It refuses a different
workspace, endpoint or principal. There are **no automatic retries** and no automatic version refresh
after conflict. Completion/cancel replays can refer to an ID no longer pending; after server cache
loss they may report not-found. **All create replays are refused**, including confirmed creates:
a GET showing the original pending cannot prevent completion/cancellation before the replay POST.
Reconcile manually instead of starting another create. This respects the server's pending-only
durable create replay limit without depending on a racy client check. Re-running a normal create command is a new operation with a new key.

Use `node -- <script> …`, especially with `--env-file`; otherwise Node may consume that flag itself
before the script's safe KEY=VALUE parser runs. Keep backup and request files private; they contain
reminder content. No files from a bot invocation should be pasted into public issues.

## Run it

Always dry-run first, show the operator the resolved list, then apply:

```bash
node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs --workspace neochrome \
  --complete 36ee5261,15f6da6a --cancel 3b0b509a --reason "triaged stale" --dry-run
# …review the printed rows with the operator, then the same command without --dry-run.

node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs --workspace neochrome --tunnel \
  --retitle 36ee5261="Review the Q4 pricing deck" --reschedule 36ee5261=2026-11-10T17:00:00Z \
  --reassign 15f6da6a=U0123ABCD --dry-run

node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs --workspace neochrome \
  --create '{"title":"Draft the launch email","dueDate":"2026-11-12T16:00:00Z","channelId":"C0123ABCD","assigneeIds":["U0123ABCD"]}'

node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs backup --workspace neochrome --tunnel
```

| Flag | Meaning |
|---|---|
| `--complete id,…` / `--cancel id,…` | IDs to close: full ReminderIDs or unique prefixes of 8+ characters. Repeatable. |
| `--set-links id='["https://github.com/owner/repo/issues/1"]'` | Replace links; `id=[]` clears them. Bot target repositories must be explicitly granted. |
| `--replay path` | Resend an exact saved bot request (see safeguards above). |
| `--retitle id="Title"` | New task summary. Normalized by the title contract; a title it refuses is rejected unless `--force-title`. |
| `--reschedule id=ISO` | New post time (ISO 8601, e.g. `2026-11-10T17:00:00Z`). |
| `--reassign id=U1,U2` | New owners, primary first. |
| `--create '<json>'` | New reminder: `title`, `dueDate`, `channelId`, and `assigneeIds` and/or `senderId`. |
| `--reason "text"` | Recorded on the server as `api-bulk: <text>` (default `api-bulk: <action>`). |
| `--workspace name` | Default `SLEUTH_WORKSPACE_NAME`. |
| `--env prod\|dev` | Which secrets file to read (default `prod`). `--env-file path` overrides it. |
| `--backup-dir dir` | Default `~/secrets/sleuth/backups`. |
| `--tunnel` | Open (and afterwards close) the SSH tunnel for `--env`. |
| `--dry-run` | Back up and resolve only; send nothing. |

To find IDs, use `skills/talk-to-reminders` (mirror) or the backup file the dry run writes.
Exit code is `0` only when every item succeeded (`completed`, `canceled`, `updated`, `unchanged`,
`created`). Re-running an applied batch is safe: closed reminders are no longer in the live records,
so the run stops at the resolve step ("no match"), and repeated edits answer `unchanged`. Re-running
a normal `--create` creates another reminder; only edit/lifecycle bot retries can use the saved request under the safeguards above. `not-found` only appears when a reminder closes between the
backup and the POST.

## Notes

- Per `AGENTS.md`, never paste a raw reminder ID into Slack; these IDs are for the operator's terminal.
- The server caps a batch at 100 actions and validates the whole batch before writing anything.
- Restoring from a backup is a manual operator step; this skill never writes server files.
