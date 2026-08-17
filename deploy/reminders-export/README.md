# Sleuth reminders export (push to git-pulse repo)

Publishes the active reminders for a workspace, in `?format=rebalance` JSON, to a
**private** git repo on a timer — so downstream consumers (rebalance-OS) read a
plain authenticated file instead of reaching into this server. **No inbound
access, no open API port, no SSH tunnel.** This replaces the old
`127.0.0.1:12020` SSH-tunnel approach.

## Data flow

```
sleuth-reminders-export.timer  (every 5 min, wall clock)
        └─ sleuth-reminders-export.service (oneshot)
              └─ node publish-reminders-export.mjs
                    1. GET  http://[redacted]/workspace/<ws>/reminders?format=rebalance&activeOnly=true   (loopback)
                    2. PUT  github.com/<repo>/contents/sync/sleuth/reminders-<ws>.json                          (contents API)
```

Idempotent: the published file omits the volatile `fetchedAt`, so a run only
creates a commit when the reminder data actually changed.

## Credentials (reused — nothing new)

Both are already in `[redacted]`, loaded by the service via
`EnvironmentFile`:

- `WEB_API_BEARER_TOKEN` — read the local Sleuth API
- `SLEUTH_RAG_GITHUB_PAT` — push the file (classic PAT, `repo` scope; already has
  write to the export repo)

## Config (env, all optional — defaults shown)

| Var | Default |
|---|---|
| `SLEUTH_EXPORT_WORKSPACE` | `[redacted]` |
| `SLEUTH_EXPORT_REPO` | `your-org/your-export-repo` (required — no default) |
| `SLEUTH_EXPORT_PATH` | `sync/sleuth/reminders-<workspace>.json` |
| `SLEUTH_EXPORT_BRANCH` | `main` |
| `SLEUTH_EXPORT_ACTIVE_ONLY` | `true` |
| `WEB_API_PORT` | `2020` |

## Install / update (on the server)

One command (idempotent — safe after a box rebuild or script change):

```bash
bash deploy/reminders-export/install.sh
```

It installs `publish-reminders-export.mjs` + `export-payload.js` to
`/root/sleuth-reminders-export/`, the `.service`/`.timer` to
`/etc/systemd/system/`, then `daemon-reload` + `enable --now`. Manual equivalent:

```bash
mkdir -p /root/sleuth-reminders-export
install -m 644 publish-reminders-export.mjs export-payload.js /root/sleuth-reminders-export/
install -m 644 sleuth-reminders-export.service sleuth-reminders-export.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now sleuth-reminders-export.timer
```

## Operate

```bash
# Run once now:
set -a; . [redacted]; set +a
node /root/sleuth-reminders-export/publish-reminders-export.mjs

systemctl list-timers sleuth-reminders-export.timer        # next/last run
journalctl -u sleuth-reminders-export.service -n 20        # logs
systemctl disable --now sleuth-reminders-export.timer      # stop publishing
```
