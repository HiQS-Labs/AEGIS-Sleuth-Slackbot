# DeployHQ setup for AEGIS

**Canonical deploy path** for development and production servers. This repo does **not** use
GitHub Actions for CI or deploy — quality gates run in DeployHQ’s build pipeline, and code reaches
the servers via DeployHQ SSH upload + [`scripts/deploy.sh`](../scripts/deploy.sh).

> **First-time local run?** Follow the README install path on your laptop first.
> This document assumes the app already runs (or will run) at `/root/sleuth-app` on Linux hosts.

Related:

- Server bootstrap: [`server-installation-guide.md`](server-installation-guide.md)
- SSH aliases / logs: [`SSH.md`](SSH.md)
- Branch → host map: [`config/servers.json`](../config/servers.json)

---

## What DeployHQ does

```
push to development or main
        ↓
DeployHQ build (.deploybuild.yaml)
  npm ci → npm run build → npm test → sanitize-scan
        ↓
Upload (respects .deployignore) → /root/sleuth-app
        ↓
SSH: bash /root/sleuth-app/scripts/deploy.sh
  stop → npm ci --omit=dev → start sleuth-app
```

**Do not** enable DeployHQ zero-downtime / release-directory strategies. [`sleuth-app.service`](../sleuth-app.service)
hard-codes `WorkingDirectory=/root/sleuth-app`. Use **Basic** (in-place) deploy only.

---

## A. Create the DeployHQ project (one-time)

1. Log into your DeployHQ account → **New project**.
2. Connect the GitHub repository: `hiqs-suite/aegis-sleuth-slack-bot` (OAuth or deploy key; read access is enough).
3. Enable the **Build pipeline**. DeployHQ reads [`.deploybuild.yaml`](../.deploybuild.yaml) from the repo root automatically (Node 20, `npm ci`, typecheck, tests, secret scan).
4. Confirm [`.deployignore`](../.deployignore) is applied: open a deployment report → **Generate Manifest** and check that `data/runtime/**`, `node_modules/**`, `tests/**`, and `.env*` are excluded.

---

## B. Add development and production servers

Mirror [`config/servers.json`](../config/servers.json):

| Server name in DeployHQ | Host | Deploy path | Branch | Auto-deploy |
|---|---|---|---|---|
| **Development** | your dev IP / `sleuth-development` | `/root/sleuth-app` | `development` | **On push** (recommended) |
| **Production** | your prod IP / `sleuth-production` | `/root/sleuth-app` | `main` | **Manual** (recommended) |

### Settings for each server

| Setting | Value |
|---|---|
| Protocol | SSH |
| User | `root` |
| Path | `/root/sleuth-app` |
| Deployment strategy | **Basic** (in-place) — not zero-downtime |
| Authentication | DeployHQ SSH public key → append to the server’s `~/.ssh/authorized_keys` |

### SSH commands (both servers)

**Pre-deploy:**

```bash
systemctl stop sleuth-app || true
```

**Post-deploy:**

```bash
bash /root/sleuth-app/scripts/deploy.sh
```

`scripts/deploy.sh` stops the service (if still up), runs `npm ci --omit=dev` on the server (native modules), reloads systemd, and starts `sleuth-app`. It never touches `data/runtime/` or `.env.runtime`.

---

## C. First deploy to existing servers

Your hosts already run the app at `/root/sleuth-app` (no GitHub Actions runners required).

1. **Install the DeployHQ public key** on each server:
   ```bash
   # on the server — paste DeployHQ's public key
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-rsa AAAA... deployhq' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
2. In DeployHQ, use **Test server connection** until it succeeds.
3. Run **Deploy from scratch** (or the equivalent full deploy) for **Development** first.
4. After the deploy finishes, on the server:
   ```bash
   systemctl status sleuth-app --no-pager
   ls data/runtime/workspaces/   # should still list your workspace files
   test -f .env.runtime && echo "runtime env present" || echo "no .env.runtime (ok if unused)"
   ```
5. Smoke-test in Slack: `@YourBot help`.
6. Repeat for **Production** when ready (prefer a **manual** deploy the first time).

### What must survive a deploy

| Path | Why |
|---|---|
| `data/runtime/` | Workspaces, reminders, settings — excluded via `.deployignore` |
| `/root/sleuth-app/.env.runtime` | `WEB_API_BEARER_TOKEN` / port overrides — not in the repo |
| Slack / AI secrets | Live in workspace JSON under `data/runtime/`, not in DeployHQ |

---

## D. Day-to-day deploys

| Environment | Typical flow |
|---|---|
| **Development** | Merge/push to `development` → DeployHQ auto-builds and deploys |
| **Production** | Merge to `main` → open DeployHQ → deploy to Production manually |

Watch the DeployHQ build log: all four steps (`npm ci`, `build`, `test`, `sanitize-scan`) must be green before upload.

---

## E. Rollback

### Prefer DeployHQ rollback

Use DeployHQ’s **rollback to previous deployment** for the affected server, then confirm:

```bash
systemctl status sleuth-app --no-pager
journalctl -u sleuth-app -n 50 --no-pager
```

### Emergency fallback (DeployHQ unavailable)

Only if you must recover by hand — DeployHQ remains the normal path:

```bash
systemctl stop sleuth-app
cd /root/sleuth-app
git fetch origin && git checkout <known-good-sha>
npm ci --omit=dev
systemctl start sleuth-app
systemctl status sleuth-app --no-pager
```

Or re-run the canonical post-deploy script after restoring files:

```bash
bash /root/sleuth-app/scripts/deploy.sh
```

---

## F. Verification checklist

Use this after wiring DeployHQ (dev first, then prod):

| Check | How |
|---|---|
| Build gate | Deploy **Development**; build log shows `npm test` + sanitize-scan green |
| Service up | `systemctl status sleuth-app` → active |
| Data preserved | `data/runtime/` file list unchanged across the deploy |
| Slack smoke | `@YourBot help` replies |
| Prod safety | Production stays **manual** unless you intentionally enable auto-deploy |
| No GitHub Actions | Repo has no `.github/workflows/` deploy/CI workflows |

---

## G. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails on `npm test` | Failing tests on the branch | Fix locally with `npm test`, push again |
| Upload overwrote reminders | `.deployignore` not applied | Confirm `data/runtime` rules; restore from backup |
| `better-sqlite3` / native module errors | Skipped server `npm ci` | Ensure post-deploy runs `scripts/deploy.sh` |
| Service path wrong after deploy | Zero-downtime / release dirs enabled | Switch server to **Basic** in-place path `/root/sleuth-app` |
| SSH auth fails | DeployHQ key missing on host | Add public key to `authorized_keys` |

---

## Repo files DeployHQ reads

| File | Role |
|---|---|
| [`.deploybuild.yaml`](../.deploybuild.yaml) | Build pipeline (CI replacement) |
| [`.deployignore`](../.deployignore) | Upload exclusions |
| [`scripts/deploy.sh`](../scripts/deploy.sh) | Server-side stop / install / start |
| [`sleuth-app.service`](../sleuth-app.service) | systemd unit at fixed `/root/sleuth-app` |
