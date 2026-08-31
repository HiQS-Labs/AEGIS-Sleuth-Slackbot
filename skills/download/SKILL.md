---
name: download
description: Fetch the caller's own active, assigned Sleuth reminders live from the production server via SSH (not the git-pulse-sync mirror) and write them to temp/my_reminders.json. Trigger on "download my reminders", "fetch my active reminders from the server", "/download".
---

# Download My Reminders (live, via SSH)

Reads the workspace's reminders JSON straight out of the production `sleuth-app` process's
own environment (`SLEUTH_DATA_DIR` via `/proc/$PID/environ`) over SSH, filters to reminders
that are `isActive` **and** assigned to the caller, and writes the result locally. Use
`skills/talk-to-reminders/` instead for general "what's open" questions — this skill exists
specifically for a live, assigned-to-me, server-side pull.

## One-time setup (per teammate)

1. Symlink this skill into your personal Claude skills dir, same as `talk-to-reminders`:
   ```bash
   ln -s "$(pwd)/skills/download" ~/.claude/skills/download
   ```
2. Copy `users.local.json.example` → `users.local.json` in this folder and map your name to
   your Slack user ID (never commit this file — it's gitignored):
   ```json
   { "yourname": "U0XXXXXXXXX" }
   ```
3. Make sure you can SSH to prod — either the shared SSH key (`scripts/ssh-setup.sh`) or the
   password file at `~/secrets/sleuth/vultr-sleuth-production.env` (ask a teammate if you
   don't have it; see `temp/SOP.md`).

## Run it

```bash
skills/download/fetch-my-reminders.sh --user <yourname> --env prod
```

- Omit `--env` to use SSH key auth instead of the password file. The production host has no
  built-in default (never committed to this public repo) — `--env prod` fills it in from the
  secrets file; with key auth instead, pass `--host <ip>` or set `SLEUTH_SSH_HOST` (see
  `temp/SOP.md` or ask a teammate for the value).
- `--workspace <name>` (default `neochrome`), `--user-ssh`, `--out` are all overridable; see
  the flags at the top of `fetch-my-reminders.sh`.
- **`--via api`** (GH-154) fetches through the app's own authenticated Web API instead of
  root SSH — no `/proc` read, no hand-copied active-state logic:
  ```bash
  skills/download/fetch-my-reminders.sh --user <yourname> --via api
  ```
  Needs `~/secrets/sleuth/sleuth-web-api-production.env` (`SLEUTH_WEB_API_BASE_URL`,
  `SLEUTH_WEB_API_TOKEN`, `SLEUTH_WORKSPACE_NAME` — ask a teammate if you don't have it).
  `--api-profile dev` / `--api-env-file <path>` override the profile/location, same pattern
  as `--env`/`--env-file` for SSH. Still defaults to `--via ssh` for backward compatibility.
  - That secrets file is normally set up for an SSH tunnel (`SLEUTH_WEB_API_BASE_URL=http://
    127.0.0.1:<port>`). Without a tunnel open, `--via api` **errors** rather than silently
    querying the public host in plaintext. Either open the tunnel (`ssh -L
    12020:localhost:2020 root@<prod-host>` — see `temp/SOP.md` for the host, or ask a
    teammate) or pass `--api-allow-direct` to query the host directly over plain HTTP — the
    bearer token then travels unencrypted on the network, so only do this on a connection you
    trust.

## Output

`temp/my_reminders.json`: `{ workspaceName, assigneeId, fetchedAt, count, reminders: [...] }`.
Internal `reminderId` values are for your own reference only — per `AGENTS.md`, never surface
a raw `id:<uuid>` to a Slack user.

## Notes

- Password auth (`--env`) reads `~/secrets/sleuth/vultr-sleuth-<env>.env` directly (never
  `source`d, never written into the repo or copied to the host) and passes it to `sshpass -e`
  so it never appears in `ps` output.
- `SLEUTH_DATA_DIR` is resolved from the *live* running process, not a hardcoded path or a
  possibly-stale `.env` file — matches `temp/SOP.md`'s "trust only the live process" rule.
  If that read fails, the script errors out rather than silently falling back to a directory
  that doesn't hold the data (GH-154 #5).
- `--via api` re-uses the same server-side `isActive` computation the app itself uses
  (`src/web-api.js` `#IsReminderStateActive`), instead of a hand-copy that can drift out of
  sync (GH-152 was exactly that copy going wrong).
