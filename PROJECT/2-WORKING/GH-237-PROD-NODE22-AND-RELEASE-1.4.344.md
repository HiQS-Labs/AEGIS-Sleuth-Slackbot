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
- `sleuth-app` is the only Node service (no pm2, no Node cron). ExecStart `/usr/bin/node --no-warnings /root/sleuth-app-v3/src/app.js`; WorkingDirectory `/root/sleuth-app-v3`; four drop-ins; active since 2026-09-29 21:42 UTC. Runtime data `/var/lib/aegis-sleuth` (7.2 MB). Web API on `127.0.0.1:2020`; the authenticated `GET /workspace/neochrome/stats` returns `success: true` with live counts.
- Deployed release 1.4.328 (`main` = 4f0ca42, PR #193). `development` (dd3d6c1) is 50 commits ahead: 1.4.329-1.4.344, 34 files under `src/`/package files changed.
- Native add-on: `better-sqlite3` (built for Node 18's ABI); it must be rebuilt for Node 22 before the service starts on it. `@newrelic/native-metrics` and the optional `@newrelic/fn-inspect` use prebuilds with a compile fallback; `sqlite-vec` loads a platform library into `better-sqlite3` (`package-lock.json:1270`, `:7148`).
- Production `.env.runtime` sets `ROUTER_SHADOW_DEFAULT_MODE=active` for `ROUTER_SHADOW_WORKSPACES=neochrome`, so the GH-233 misroute can occur on production today; 1.4.344 carries the fix and its trade-off (22 non-admin commands lose model-resolved free-text takeover; literal commands and aliases unchanged).
- Startup baseline (2026-09-29 restart): known noise per SOP §2 (`not_in_channel` shutdown notice, OCUX/uclauxiii AI 401, one Notion token invalid, Lists `missing_scope`); `neochrome` passes Slack, AI and Notion checks. Journal error lines in the last 24 h: 2.
- Development already runs Node 22.23.x with this code (dev deploys of 1.4.329-1.4.344 since 2026-09-16), which is the evidence that the code runs on Node 22.
- DeployHQ: project `aegis-sleuth-slackbot`; SSH command "Pre-deploy: stop service before file swap" (`before_changes`, position 1, `halt_on_error: false`) on both servers; Production is manual deploy only. `dhq ssh-commands create/update` and `dhq deploy -s Production -r <rev> --wait` exist (dhq 0.21.0).

## Why this order

Phase A changes only the runtime, on the release production already runs. If it breaks, the cause is the runtime, and rollback is local. Phase C then changes only the code, through the normal pipeline, on a runtime that is already proven. Doing both in one deploy would make any failure ambiguous.

## Health check used throughout (replaces the status-only curl; plan QA S1)

`/health` is not a route: the unauthenticated request returns HTTP 200 with `{"success":false,"data":"Forbidden."}` (`src/web-api.js:139`, `:198`). The health check is instead, run on the host:
```bash
health() {  # exit 0 only when the running process answers with real data for neochrome
  local t; t=$(grep -E '^WEB_API_BEARER_TOKEN=' /root/sleuth-app-v3/.env.runtime | cut -d= -f2-)
  curl -s -H "Authorization: Bearer $t" http://127.0.0.1:2020/workspace/neochrome/stats \
    | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b);process.exit(j.success===true&&j.data&&j.data.IncomingMessageCount>0?0:1)})'
}
```
plus, scoped to the new process only (`journalctl _PID=<MainPID>` or `--since <ActiveEnterTimestamp>`): `workspace modules started: neochrome` (`src/app.js:429`), `neochrome` Slack/AI/Notion connectivity succeeded, and no error line outside the known-noise list. Baseline 2026-10-11: `{"success":true,...,"IncomingMessageCount":29884,...}`; `NRestarts=0`.

## Phase A — Node 22 on the current release (production, about 3 minutes of downtime)

Window: now (Sunday, low traffic), operator-requested 2026-10-11. All commands run as root on the production host. Each block is a fail-fast `bash -euo pipefail` script; the first failure stops it before the service is started (plan QA S2). A failure in A3 or A4 goes to Rollback A.

A0. Baseline (read-only): `node -v`; `systemctl show sleuth-app -p MainPID -p NRestarts -p ActiveEnterTimestamp`; `health`; error lines in the last 24 h.

A1. Rollback kit, no service impact:
```bash
set -euo pipefail; K=/root/node18-rollback; mkdir -p $K
cp /var/cache/apt/archives/nodejs_18.20.6-1nodesource1_amd64.deb $K/
dpkg-deb -f $K/nodejs_18.20.6-1nodesource1_amd64.deb Version Architecture   # must print 18.20.6-1nodesource1 / amd64
tar czf $K/apt-node18.tgz -C / etc/apt/sources.list.d etc/apt/preferences.d usr/share/keyrings/nodesource.gpg
tar czf $K/node_modules-node18.tgz -C /root/sleuth-app-v3 node_modules
tar tzf $K/apt-node18.tgz >/dev/null && tar tzf $K/node_modules-node18.tgz >/dev/null
curl -fsSL https://deb.nodesource.com/setup_22.x -o $K/setup_22.x && sha256sum $K/setup_22.x
```
The saved installer is read before A2 runs it; whatever it changes under `/etc/apt` and the keyrings is covered by `apt-node18.tgz` (plan QA S5).

A2. Point apt at Node 22 (no service impact): `bash /root/node18-rollback/setup_22.x`, then `apt-cache policy nodejs` must show a 22.x candidate from deb.nodesource.com.

A3. Swap the runtime (downtime starts; one fail-fast script):
```bash
set -euo pipefail; K=/root/node18-rollback; D=/var/lib/aegis-sleuth
systemctl stop sleuth-app
tar czf $K/aegis-sleuth-data-quiescent-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /var/lib aegis-sleuth   # quiescent snapshot (S3)
apt-get install -y nodejs
/usr/bin/node -v | grep -q '^v22\.'
cd /root/sleuth-app-v3 && npm ci --omit=dev
node -e "const db=require('better-sqlite3')(':memory:'); require('sqlite-vec').load(db); console.log(db.prepare('select 1 as x').get().x, db.prepare('select vec_version() v').get().v)"
systemctl start sleuth-app
```
`npm ci --omit=dev` is what `scripts/deploy.sh:87` runs on every deploy. `better-sqlite3` 12.9.0 has a published Node 22 (ABI 127) linux-x64 prebuild, with compilation as fallback (`g++`, `make`, `python3` present). The probe exercises the same `sqlite-vec.load` the RAG index uses (`src/rag/index.js:108`).

A4. Verify at start and again after 10 minutes: `systemctl is-active` = active; MainPID's command is `/usr/bin/node`, `/usr/bin/node -v` = v22.x; `NRestarts` equal to the value right after start; `health` exits 0; journal checks above, scoped to the new PID.

Rollback A (A3 or A4 failed), one fail-fast script:
```bash
set -euo pipefail; K=/root/node18-rollback
systemctl stop sleuth-app || true
rm -f /etc/apt/sources.list.d/nodesource.* /etc/apt/preferences.d/nodejs
tar xzf $K/apt-node18.tgz -C /
apt-get update
apt-get install -y --allow-downgrades $K/nodejs_18.20.6-1nodesource1_amd64.deb
/usr/bin/node -v | grep -q '^v18\.20\.6'
rm -rf /root/sleuth-app-v3/node_modules && tar xzf $K/node_modules-node18.tgz -C /root/sleuth-app-v3
systemctl start sleuth-app
```
Then run A4 on Node 18 (`apt-cache policy nodejs` shows the 18.x source again) before declaring recovery, and stop the task (B and C do not run). Data is not restored in Rollback A: the release and data format are unchanged by A.

## Phase B — DeployHQ Node guard (both servers)

B1. Create the guard as its own SSH command, before the stop, halting on failure. `dhq ssh-commands create` (0.21.0) has no timing/halt/server flags, so use the raw API with the field names the existing command shows (`cback`, `halt_on_error`, `servers`), attached to Development-Oracle (1662264) and Production (1659102); the disabled old Development (1659099) is left out:
```bash
dhq api POST /projects/aegis-sleuth-slackbot/commands --body '{"command":{
  "description":"Pre-deploy: refuse a server below Node 20 (GH-237, nodemailer 10)",
  "command":"node -e '\''process.exit(Number(process.versions.node.split(\".\")[0]) >= 20 ? 0 : 1)'\'' || { echo \"Node $(node -v) is below 20; upgrade Node before deploying\"; exit 1; }",
  "cback":"before_changes","halt_on_error":true,"servers":[1662264,1659102]}}'
```
then set it ahead of the stop command (guard position 1, stop position 2) with `dhq api PUT /projects/aegis-sleuth-slackbot/commands/<id>`. The API response is read back before relying on it (plan QA confirmed the JSON decodes to the intended shell command).

B2. Verify: `dhq ssh-commands list` shows the guard first, `halt_on_error: true`, both servers attached (an empty `servers[]` runs nowhere, SOP §2). Red control: the guard expression with version string `18.20.6` exits 1 and with `22.23.2` exits 0. Live proof: the Phase C production deploy log shows the guard step ran and passed.

Rollback B: `dhq ssh-commands delete <id>`.

## Phase C — release 1.4.344 to production

C0. Pre-checks (read-only, done 2026-10-11): `PRODUCT_COMPASS_CHANNELS` is absent from all five active production workspace files (OCUX, Turn7, abk-alumni-network, neochrome, uclauxiii), so no Compass workflow is mapped (plan QA S6); `SLEUTH_SELFTEST_CHANNEL` is unset, so selftest never registers (`src/app.js:331`).

C1. Release commit on `development`, same as earlier releases (`release: 1.4.328`, 91ba595): `npm version 1.4.344 --no-git-tag-version` (package.json + lockfile root), commit `release: 1.4.344`, push. Development auto-deploys (version string only).

C2. Release PR `development` -> `main` titled `Release 1.4.344: ...`, #193 format. User-visible changes, all on by default (plan QA S7): multi-task delivery (1.4.329); excitement is not a commitment (1.4.330); "this week" past-time handling (1.4.331); quoted text excluded from reminders by default, so a quoted task loses its quoted part, rollback switch `REMINDER_IGNORE_QUOTED_TEXT=off` (1.4.332); owner-scoped completion by thread reply, "done" completes the reminder (1.4.333-1.4.334); earlier-file reading in a thread (1.4.337); single thread read per event (1.4.339); one reminder judgement path, and an explicit "don't set a reminder" skips the model (1.4.340); router active takeover requires `CanExecuteWithIfl`, so 22 non-admin commands such as `show-me`, `show-stats`, `show-reminders` and `ping` need their usual wording (1.4.342); nodemailer 10 and Node >= 20 (1.4.344). Inert on production: selftest and Compass (C0). Wait for the required `test` check, then `gh pr merge --merge` (as #193).

C3. Snapshot data right before the deploy (`tar czf $K/aegis-sleuth-data-pre-1.4.344-<ts>.tgz -C /var/lib aegis-sleuth`; not quiescent, the A3 snapshot is the quiescent one). Deploy: `dhq deploy -p aegis-sleuth-slackbot -s Production -b main -r <main merge SHA> --wait`. Verify the step list includes the build commands (SOP §3.4) and the guard step. Immediately record the rollback delta with `dhq deploy -p aegis-sleuth-slackbot -s Production -b main --start-revision <main merge SHA> -r 4f0ca42 --dry-run` (plan QA S4): it must list `src/chat-module.js` and `package.json` among the changes.

C4. Verify at start and after 15 minutes: `/root/sleuth-app-v3/CHANGELOG.md` top entry `1.4.344`; sha256 of `src/app.js`, `src/chat-module.js`, `src/router-shadow-module.js`, `package.json` equal to `main`; `node_modules/nodemailer/package.json` version 10.0.9; service active on Node 22, `NRestarts` unchanged since start; `health` exits 0 with `IncomingMessageCount` at or above the A4 value; journal checks scoped to the new PID; router mode `active` for `neochrome` in the startup log.

Rollback C (code), one sequence:
1. `dhq deploy -p aegis-sleuth-slackbot -s Production -b main --start-revision <main merge SHA> -r 4f0ca42 --wait` — an explicit reverse range, so it works even when the failed deploy left 4f0ca42 as the last successful revision. Its `npm ci` reinstalls the 1.4.328 lockfile on Node 22, already proven in A. Verify with C4's hash check against 4f0ca42.
2. If DeployHQ cannot run it, fall back to `--full -r 4f0ca42`, then remove files added after 4f0ca42 (`git diff --name-only --diff-filter=A 4f0ca42 <merge SHA>`), since a full upload does not delete them.

Data recovery (only if a data problem is found; not part of a normal rollback because the release changes no data format):
```bash
set -euo pipefail; K=/root/node18-rollback; T=$(date -u +%Y%m%dT%H%M%SZ)
systemctl stop sleuth-app
mv /var/lib/aegis-sleuth /var/lib/aegis-sleuth.failed-$T          # keep the current state, including later work
mkdir /var/lib/aegis-sleuth && tar xzf $K/<chosen snapshot>.tgz -C /var/lib     # -p keeps ownership as root
systemctl start sleuth-app
```
Restoring a snapshot loses reminders created or completed after it; the `.failed-$T` copy keeps them for manual reconciliation, and the operator chooses before a restore.
## Alternatives rejected

- Upgrade Node inside the release deploy (one step): a failure could not be told apart from a code regression, and rollback would need two changes at once.
- nvm or a tarball install: a second installer on a host that already uses NodeSource apt; ExecStart points at `/usr/bin/node`.
- `engine-strict=true` in `.npmrc` as the guard: DeployHQ stops the service before `deploy.sh` runs `npm ci`, so a strict failure would leave production down (decided in #204).
- Node 20 instead of 22: development and CI run 22; 20 fails `npm run test:node` on the build image (`.deploybuild.yaml`).

## Task rating (2026-10-11)

Rated 75/60/50/70 (priority/severity/appeal/effort-cheapness). Severity 60: production cannot take the security fix in #204 (2 high, 3 medium nodemailer advisories) or the GH-233 router fix while it runs Node 18, and the router misroute can happen on production now; no outage or data loss observed. Priority 75: operator asked for the upgrade and release now. Appeal 50 neutral. Effort 70: a few well-known commands with a short downtime, but on a live host. Recurrence: not a defect class; n/a.

## Acceptance

- [ ] Production `/usr/bin/node -v` is v22.x; `sleuth-app` runs on it; `better-sqlite3` and `sqlite-vec` load (A3 probe); `health` exits 0; `neochrome` startup checks pass; no new error class after 10 minutes.
- [ ] DeployHQ guard exists on both servers, first in order, `halt_on_error: true`; red control (18.20.6 -> exit 1, 22.23.2 -> exit 0); the production deploy log shows it ran.
- [ ] Release PR merged into `main`; production deploy completed with build gates; production serves 1.4.344 (CHANGELOG and file hashes match `main`), nodemailer 10.0.9, healthy after 15 minutes, router still active for `neochrome`.
- [ ] temp/SOP.md updated (Node on host: 22.x; guard command recorded; prod revision).

## Progress log
- 2026-10-11: #237 filed after #204 merged; clone off origin/development dd3d6c1; captured, rated 75/60/50/70, promoted; read-only production recon; runbook drafted. Operator requested the upgrade, then promotion, deploy monitoring and a production check, in this session. Plan QA next.
- 2026-10-11: Codex plan QA round 1 FAIL (S1 health check, S2 fail-fast, S3 quiescent data snapshot and recovery, S4 reverse-range rollback, S5 NodeSource apt config rollback, S6 Compass presence from workspace files, S7 full user-visible release summary; Nit native inventory). All accepted and folded in; C0 Compass/selftest presence check run read-only (absent in all five workspaces); authenticated stats endpoint confirmed (`success: true`). Round 2 next.
