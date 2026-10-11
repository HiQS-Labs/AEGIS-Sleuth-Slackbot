---
title: "GH-237: production Node 18 -> 22, DeployHQ Node guard, then release 1.4.344 to production"
status: Active (2-WORKING)
created: 2026-10-11
updated: 2026-10-11
owner: noel
branch: chore/gh-237-prod-node22
doc_type: feedback
gh_issue: 237
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/237
complexity: 2
risk: 3
effort: 2
phases: 3
ratings_provisional: false
non_goals:
  - No code change; the repo already requires Node >= 20 (PR #204, CHANGELOG 1.4.344)
  - No move to nvm, Docker or another installer; production keeps the NodeSource apt package it already uses
  - No smoke-test messages in production Slack channels (temp SOP §1); production checks are read-only
  - No fix for the legacy /root/sleuth-app directory or its stale nightly backup cron (parked separately)
related:
  - "#204 (nodemailer 10, Node >= 20 baseline), #235/#236 (GH-233 router fix), #193 (previous release PR format)"
  - "docs/deployhq.md (pre-deploy Node guard), scripts/deploy.sh (server npm ci), temp/SOP.md §1-§3 (gitignored host facts)"
goal: >
  Production runs Node 22 like development, DeployHQ refuses to deploy to any server below Node 20,
  and production serves release 1.4.344 with a healthy service and no new error class.
---

# GH-237 — production Node 22, DeployHQ guard, release 1.4.344

## Status

| What was just completed | What's next |
|---|---|
| Issue filed, clone off origin/development dd3d6c1, captured, rated 75/60/50/70, read-only production recon, runbook drafted. | Codex plan QA, then Phase A (Node) -> B (guard) -> C (release) in that order, each verified before the next. |

## Observed state (2026-10-11, read-only)

- Production host (Vultr, Debian 12 x86_64, 954 MB RAM, 13 GB free): `node` v18.20.6 at `/usr/bin/node` from the NodeSource apt repo (`/etc/apt/sources.list.d/nodesource.list` = `node_18.x`); npm 10.8.2; `g++`, `make`, `python3` present.
- `sleuth-app` is the only Node service (no pm2, no Node cron). ExecStart `/usr/bin/node --no-warnings /root/sleuth-app-v3/src/app.js`; WorkingDirectory `/root/sleuth-app-v3`; four drop-ins; active since 2026-09-29 21:42 UTC. Runtime data `/var/lib/aegis-sleuth` (7.2 MB). Web API `127.0.0.1:2020/health` returns 200.
- Deployed release 1.4.328 (`main` = 4f0ca42, PR #193). `development` (dd3d6c1) is 50 commits ahead: 1.4.329-1.4.344, 34 files under `src/`/package files changed.
- Native add-on: `better-sqlite3` (built for Node 18's ABI); it must be rebuilt for Node 22 before the service starts on it. `@newrelic/native-metrics` ships prebuilds only.
- Production `.env.runtime` sets `ROUTER_SHADOW_DEFAULT_MODE=active` for `ROUTER_SHADOW_WORKSPACES=neochrome`, so the GH-233 misroute can occur on production today; 1.4.344 carries the fix and its trade-off (22 non-admin commands lose model-resolved free-text takeover; literal commands and aliases unchanged).
- Startup baseline (2026-09-29 restart): known noise per SOP §2 (`not_in_channel` shutdown notice, OCUX/uclauxiii AI 401, one Notion token invalid, Lists `missing_scope`); `neochrome` passes Slack, AI and Notion checks. Journal error lines in the last 24 h: 2.
- Development already runs Node 22.23.x with this code (dev deploys of 1.4.329-1.4.344 since 2026-09-16), which is the evidence that the code runs on Node 22.
- DeployHQ: project `aegis-sleuth-slackbot`; SSH command "Pre-deploy: stop service before file swap" (`before_changes`, position 1, `halt_on_error: false`) on both servers; Production is manual deploy only. `dhq ssh-commands create/update` and `dhq deploy -s Production -r <rev> --wait` exist (dhq 0.21.0).

## Why this order

Phase A changes only the runtime, on the release production already runs. If it breaks, the cause is the runtime, and rollback is local. Phase C then changes only the code, through the normal pipeline, on a runtime that is already proven. Doing both in one deploy would make any failure ambiguous.

## Phase A — Node 22 on the current release (production, about 3 minutes of downtime)

Window: now (Sunday, low traffic), operator-requested 2026-10-11. All commands run as root on the production host.

A0. Baseline (read-only): `node -v`, `systemctl show sleuth-app -p ActiveState -p ActiveEnterTimestamp`, `journalctl -u sleuth-app --since "24 hours ago" | grep -ci error`, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:2020/health`.

A1. Rollback kit (no service impact):
```bash
mkdir -p /root/node18-rollback && cd /root/node18-rollback
apt-get download nodejs=18.20.6-1nodesource1 || cp /var/cache/apt/archives/nodejs_18.20.6*_amd64.deb . 2>/dev/null
cp /etc/apt/sources.list.d/nodesource.list nodesource.list.node18
tar czf node_modules-node18.tgz -C /root/sleuth-app-v3 node_modules
tar czf aegis-sleuth-data-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /var/lib aegis-sleuth
ls -la /root/node18-rollback
```
Gate: a `nodejs_18.20.6*.deb` exists (else stop: no runtime rollback), and both tarballs are non-empty.

A2. Point apt at Node 22 (no service impact; the same script `scripts/server-install.sh` uses):
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-cache policy nodejs | head -3   # candidate must be 22.x
```

A3. Swap the runtime and rebuild dependencies (downtime starts):
```bash
systemctl stop sleuth-app
apt-get install -y nodejs
node -v                                   # must print v22.x
cd /root/sleuth-app-v3 && npm ci --omit=dev
node -e "require('/root/sleuth-app-v3/node_modules/better-sqlite3')(':memory:').prepare('select 1 as x').get()" && echo sqlite-ok
systemctl start sleuth-app
```
`npm ci --omit=dev` is exactly what `scripts/deploy.sh` runs on every deploy, so it reinstalls the same lockfile for the new ABI.

A4. Verify (read-only), at start and again after 10 minutes: `systemctl is-active sleuth-app` = active and `NRestarts` unchanged; `ps -o args= -p $(systemctl show sleuth-app -p MainPID --value)` shows `/usr/bin/node`; `/usr/bin/node -v` = v22.x; health endpoint 200; the startup lines for `neochrome` show Slack, AI and Notion connectivity succeeded; no error line outside the known-noise list.

Rollback A (if A3 or A4 fails):
```bash
systemctl stop sleuth-app
cp /root/node18-rollback/nodesource.list.node18 /etc/apt/sources.list.d/nodesource.list
apt-get install -y --allow-downgrades /root/node18-rollback/nodejs_18.20.6*_amd64.deb
rm -rf /root/sleuth-app-v3/node_modules && tar xzf /root/node18-rollback/node_modules-node18.tgz -C /root/sleuth-app-v3
node -v && systemctl start sleuth-app
```
Then stop the whole task and report (Phases B and C do not run).

## Phase B — DeployHQ Node guard (both servers)

B1. Create the guard as its own SSH command, before the stop, halting on failure. `dhq ssh-commands create` (0.21.0) has no timing/halt/server flags, so use the raw API with the same field names the existing command shows in `dhq ssh-commands list` (`cback`, `halt_on_error`, `servers`), attached to the active servers Development-Oracle (1662264) and Production (1659102); the disabled old Development (1659099) is left out:
```bash
dhq api POST /projects/aegis-sleuth-slackbot/commands --body '{"command":{
  "description":"Pre-deploy: refuse a server below Node 20 (GH-237, nodemailer 10)",
  "command":"node -e '\''process.exit(Number(process.versions.node.split(\".\")[0]) >= 20 ? 0 : 1)'\'' || { echo \"Node $(node -v) is below 20; upgrade Node before deploying\"; exit 1; }",
  "cback":"before_changes","halt_on_error":true,"servers":[1662264,1659102]}}'
```
then set it ahead of the stop command (guard position 1, stop position 2) with `dhq api PUT /projects/aegis-sleuth-slackbot/commands/<id>` (`position`). The exact body is checked against the API's response before relying on it.

B2. Verify: `dhq ssh-commands list` shows the guard first, `halt_on_error: true`, both servers attached (an empty `servers[]` runs nowhere, SOP §2). Red control: the guard expression with version string `18.20.6` exits 1 and with `22.23.2` exits 0 (`node -e` on any host). Live proof: the Phase C production deploy log shows the guard step ran and passed.

Rollback B: `dhq ssh-commands delete <id>`.

## Phase C — release 1.4.344 to production

C1. Release commit on `development`, same as earlier releases (`release: 1.4.328`, 91ba595): `package.json` `version` 1.4.328 -> 1.4.344, `package-lock.json` root version to match (`npm version 1.4.344 --no-git-tag-version`), commit `release: 1.4.344`, push. This also auto-deploys development (version string only).

C2. Release PR `development` -> `main` titled `Release 1.4.344: ...`, body in the #193 format: what ships (1.4.329-1.4.344), the behavior changes production users will see (GH-233 router takeover now requires `CanExecuteWithIfl`, so 22 non-admin commands such as `show-me`, `show-stats`, `show-reminders` and `ping` need their usual wording; GH-149 reminder judgement, explicit "don't set a reminder" skips the model; GH-225 single thread read), what is inert on production (selftest needs `SLEUTH_SELFTEST_CHANNEL`, Compass needs `PRODUCT_COMPASS_CHANNELS`; neither is set there), and the Node >= 20 requirement satisfied by Phase A. Wait for the required `test` check, then merge with a merge commit (`gh pr merge --merge`, as #193).

C3. Deploy: `dhq deploy -p aegis-sleuth-slackbot -s Production -r <main merge SHA> --wait`. Verify the deployment's step list includes the build commands (SOP §3.4: a cached build skips gates) and the guard step.

C4. Verify production (read-only), at start and after 15 minutes: `/root/sleuth-app-v3/CHANGELOG.md` top entry `1.4.344`; sha256 of `src/app.js`, `src/chat-module.js`, `src/router-shadow-module.js`, `package.json` equal to `main`; `node_modules/nodemailer` 10.0.9; service active on Node 22 with `NRestarts` unchanged; health 200; `neochrome` Slack, AI and Notion checks succeed; error lines limited to the known-noise list; router mode still `active` for `neochrome` in the startup log; `/var/lib/aegis-sleuth` entry count unchanged.

Rollback C: `dhq deploy -p aegis-sleuth-slackbot -s Production -r 4f0ca42 --wait` (previous `main`), which re-runs `npm ci` for that lockfile on Node 22 (verified in Phase A); restore `/var/lib/aegis-sleuth` from the A1 tarball only if a data problem is found.

## Alternatives rejected

- Upgrade Node inside the release deploy (one step): a failure could not be told apart from a code regression, and rollback would need two changes at once.
- nvm or a tarball install: a second installer on a host that already uses NodeSource apt; ExecStart points at `/usr/bin/node`.
- `engine-strict=true` in `.npmrc` as the guard: DeployHQ stops the service before `deploy.sh` runs `npm ci`, so a strict failure would leave production down (decided in #204).
- Node 20 instead of 22: development and CI run 22; 20 fails `npm run test:node` on the build image (`.deploybuild.yaml`).

## Task rating (2026-10-11)

Rated 75/60/50/70 (priority/severity/appeal/effort-cheapness). Severity 60: production cannot take the security fix in #204 (2 high, 3 medium nodemailer advisories) or the GH-233 router fix while it runs Node 18, and the router misroute can happen on production now; no outage or data loss observed. Priority 75: operator asked for the upgrade and release now. Appeal 50 neutral. Effort 70: a few well-known commands with a short downtime, but on a live host. Recurrence: not a defect class; n/a.

## Acceptance

- [ ] Production `/usr/bin/node -v` is v22.x; `sleuth-app` runs on it; `better-sqlite3` loads (A3 probe); health 200; `neochrome` startup checks pass; no new error class after 10 minutes.
- [ ] DeployHQ guard exists on both servers, first in order, `halt_on_error: true`; red control (18.20.6 -> exit 1, 22.23.2 -> exit 0); the production deploy log shows it ran.
- [ ] Release PR merged into `main`; production deploy completed with build gates; production serves 1.4.344 (CHANGELOG and file hashes match `main`), nodemailer 10.0.9, healthy after 15 minutes, router still active for `neochrome`.
- [ ] temp/SOP.md updated (Node on host: 22.x; guard command recorded; prod revision).

## Progress log
- 2026-10-11: #237 filed after #204 merged; clone off origin/development dd3d6c1; captured, rated 75/60/50/70, promoted; read-only production recon; runbook drafted. Operator requested the upgrade, then promotion, deploy monitoring and a production check, in this session. Plan QA next.
