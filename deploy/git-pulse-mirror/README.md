# git-pulse mirror (read-only clone on the Sleuth server)

Keeps a local, read-only clone of the **private** git-pulse repo on the server, refreshed hourly,
so server-side scripts can read its files directly — no per-file API calls, no new credentials
(GH-249). The first consumer is the HiQS activity → Slack connector (GH-248).

This is the **read** side. The **write** side is unchanged: `deploy/reminders-export/` keeps
pushing `sync/sleuth/reminders-<ws>.json` into the same repo through the GitHub contents API, and
the mirror picks those commits up on its next pull.

## Data flow

```
sleuth-git-pulse-mirror.timer  (hourly, up to 5 min after the hour)
        └─ sleuth-git-pulse-mirror.service (oneshot)
              └─ sync-git-pulse-mirror.sh
                    first run:  git clone  https://github.com/<repo>.git  →  $SLEUTH_GIT_PULSE_DIR
                    later runs: git fetch origin <branch> && git reset --hard FETCH_HEAD
```

**Read-only by design.** Every run hard-resets to the remote branch, so edits to tracked files
are discarded within the hour (untracked files are left alone). Never write, commit or push
from it.

## Config

`/etc/default/sleuth-git-pulse-mirror` (written by `install.sh`, mode 600, server-only):

| Var | Default |
|---|---|
| `SLEUTH_GIT_PULSE_REPO` | required, `owner/name` — **never commit it here; this repo is public** |
| `SLEUTH_GIT_PULSE_DIR` | `/root/git-pulse-sync` |
| `SLEUTH_GIT_PULSE_BRANCH` | `main` |

## Credentials (reused — nothing new)

`SLEUTH_RAG_GITHUB_PAT` (classic PAT, `repo` scope — already read/write on the git-pulse repo for
the export publisher). The script finds the live app tree with
`systemctl show sleuth-app -p WorkingDirectory` and reads **only** that one line from its
`.env.runtime` (plain `KEY=value`; the file is not sourced). Git receives the token through an
inline, per-invocation credential helper, so it is never written to `.git/config`, the remote
URL, or any process's arguments.

## Install / update (on the server)

```bash
# first install — from the live app tree, after `git pull`:
bash deploy/git-pulse-mirror/install.sh <owner/name>
# later updates (keeps the existing config):
bash deploy/git-pulse-mirror/install.sh
```

Installs the script to `/root/sleuth-git-pulse-mirror/` (outside the app tree, so app pulls
can't conflict), the units to `/etc/systemd/system/`, enables the timer and runs one sync.

## Operate

```bash
systemctl start sleuth-git-pulse-mirror.service             # sync now
systemctl list-timers sleuth-git-pulse-mirror.timer         # next/last run
journalctl -u sleuth-git-pulse-mirror.service -n 20         # logs (one status line per run)
systemctl disable --now sleuth-git-pulse-mirror.timer       # stop syncing
```

Start manual runs through `systemctl start`, not by running the script directly — systemd never
runs the oneshot twice at once, which is the only concurrency guard this needs.

## For scripts that read the mirror

- **Path:** `${SLEUTH_GIT_PULSE_DIR:-/root/git-pulse-sync}` — same layout as the operator Macs'
  `$HOME/git-pulse-sync` (e.g. `sync/sleuth/reminders-<ws>.json`).
- **Existing reminder reader:** `skills/talk-to-reminders/query-reminders.mjs` takes
  `SLEUTH_MIRROR_DIR` and its built-in default is a literal `'$HOME/…'` string that is not
  expanded, so set it explicitly on the server:
  `SLEUTH_MIRROR_DIR=/root/git-pulse-sync/sync/sleuth node skills/talk-to-reminders/query-reminders.mjs`
- **Freshness — two different clocks:**
  - *Mirror fetch:* mtime of `$SLEUTH_GIT_PULSE_DIR/.git/FETCH_HEAD` = last successful fetch
    (`stat -c %Y`). Older than ~2 h means the timer or the token has stopped working.
  - *Upstream data:* a payload's own stamp (e.g. `exportGeneratedAt` in the reminders export) =
    how fresh the data its producer pushed is. A fresh fetch of a stale file is still stale data
    (consumer-side staleness check: GH-100).

## Rollback

```bash
systemctl disable --now sleuth-git-pulse-mirror.timer
rm /etc/systemd/system/sleuth-git-pulse-mirror.{service,timer} /etc/default/sleuth-git-pulse-mirror
systemctl daemon-reload
rm -r /root/sleuth-git-pulse-mirror /root/git-pulse-sync
```
