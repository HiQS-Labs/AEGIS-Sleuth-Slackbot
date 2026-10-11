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
  curl -s --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $t" http://127.0.0.1:2020/workspace/neochrome/stats \
    | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b);process.exit(j.success===true&&j.data&&j.data.IncomingMessageCount>0?0:1)})'
}
```
and a data inventory used before and after each change (plan QA R3-S3b) — workspace file names plus every `ReminderID` per `*_reminders.json` (each file is the serialized pending queue, an array; `src/reminders-module.js:3933`), sorted, written to a file, compared with `diff`:
```bash
inventory() {  # $1 = data root (live: /var/lib/aegis-sleuth, or an extracted snapshot)
  node -e 'const fs=require("fs"),r=process.argv[1];
    for (const f of fs.readdirSync(r+"/workspaces").filter(n=>/_workspace\.json$/.test(n)).sort()) { JSON.parse(fs.readFileSync(r+"/workspaces/"+f)); console.log("W "+f); }
    for (const f of fs.readdirSync(r+"/reminders").filter(n=>/_reminders\.json$/.test(n)).sort()) { const a=JSON.parse(fs.readFileSync(r+"/reminders/"+f)); if(!Array.isArray(a)) throw new Error(f+" not an array"); for (const x of a) console.log("R "+f+" "+x.ReminderID); }' "$1" | sort
}
```
Two more helpers, each one command per line so `set -e` applies (plan QA R4-S3a: a failure inside an `a && b` list does not trigger `set -e`):
```bash
verify_archive() {  # $1 = archive, $2 = inventory file to write; returns 1 on any failure, in any calling context
  local x; x=$(mktemp -d) || return 1
  tar xzf "$1" -C "$x" || { rm -rf "$x"; return 1; }
  inventory "$x/aegis-sleuth" > "$2" || { rm -rf "$x"; return 1; }
  rm -rf "$x"
  test -s "$2"
}
shutdown_ok() {  # $1 = outgoing PID, $2 = stop start time; proves this shutdown persisted and completed (R4-S3b)
  local log; log=$(journalctl _PID="$1" --since "$2" --no-pager) || return 1
  grep -q 'shutdown complete' <<<"$log" || return 1
  grep -q 'saved [0-9]* reminders to file' <<<"$log" || return 1
  if grep -E '\[ERROR\]' <<<"$log" | grep -qvE 'not_in_channel|Failed to post shutdown notification|tag=shutdown'; then return 1; fi
  return 0
}
```
A reminder ID missing after a change that is not explained by a reminder firing or being completed in the interval (visible in the journal) is a failure. Plus, scoped to the new process only (`journalctl _PID=<MainPID>` or `--since <ActiveEnterTimestamp>`): `workspace modules started: neochrome` (`src/app.js:429`), `neochrome` Slack/AI/Notion connectivity succeeded, and no error line outside the known-noise list. Baseline 2026-10-11: `{"success":true,...,"IncomingMessageCount":29884,...}`; `NRestarts=0`.

## Phase A — Node 22 on the current release (production, about 3 minutes of downtime)

Window: now (Sunday, low traffic), operator-requested 2026-10-11. All commands run as root on the production host. Each block is a fail-fast `bash -euo pipefail` script; the first failure stops it before the service is started (plan QA S2). A failure in A3 or A4 goes to Rollback A.

A0. Baseline (read-only): `node -v`; `systemctl show sleuth-app -p MainPID -p NRestarts -p ActiveEnterTimestamp`; `health`; error lines in the last 24 h.

A1. Rollback kit, no service impact:
```bash
set -euo pipefail; K=/root/node18-rollback; mkdir -p $K
cp /var/cache/apt/archives/nodejs_18.20.6-1nodesource1_amd64.deb $K/
dpkg-deb -f $K/nodejs_18.20.6-1nodesource1_amd64.deb Version Architecture   # must print 18.20.6-1nodesource1 / amd64
ls -1 /etc/apt/preferences.d /etc/apt/sources.list.d > $K/apt-listing-before.txt   # prior presence (production: preferences.d has only nodejs)
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
OLD=$(systemctl show sleuth-app -p MainPID --value); T0=$(date -u '+%F %T')
systemctl stop sleuth-app
shutdown_ok "$OLD" "$T0"
tar czf $K/aegis-sleuth-data-quiescent-A.tgz -C /var/lib aegis-sleuth   # quiescent snapshot (S3)
verify_archive $K/aegis-sleuth-data-quiescent-A.tgz $K/inventory-A-archive.txt
inventory /var/lib/aegis-sleuth > $K/inventory-A.txt
diff $K/inventory-A-archive.txt $K/inventory-A.txt
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
rm -f /etc/apt/sources.list.d/nodesource.* /etc/apt/preferences.d/nodejs /etc/apt/preferences.d/nsolid   # installer-written files (setup_22.x writes both pins)
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

C3. Before deploying (plan QA R2-S4), preview the rollback with the explicit reverse range: `dhq deploy -p aegis-sleuth-slackbot -s Production -b main --start-revision <main merge SHA> -r 4f0ca42 --dry-run`. Gate: the preview lists `src/chat-module.js` and `package.json`, and the added-file list (`git diff --name-only --diff-filter=A 4f0ca42 <merge SHA>`) is saved to the plan in every case, since Rollback C always applies it. If the preview cannot be produced, stop before deploying.

Then the quiescent pre-release snapshot and deploy (plan QA R2-S3, R3-S3a). On the host, one fail-fast block:
```bash
set -euo pipefail; K=/root/node18-rollback; . $K/gh237-lib.sh; S=$K/aegis-sleuth-data-quiescent-C.tgz
rm -f $K/inventory-C.txt $K/inventory-C-live.txt   # never reuse an earlier inventory
OLD=$(systemctl show sleuth-app -p MainPID --value); T0=$(date -u '+%F %T')
systemctl stop sleuth-app
shutdown_ok "$OLD" "$T0"
tar czf $S -C /var/lib aegis-sleuth
verify_archive $S $K/inventory-C.txt
inventory /var/lib/aegis-sleuth > $K/inventory-C-live.txt
diff $K/inventory-C.txt $K/inventory-C-live.txt   # archive equals live data
```
If any line fails: `systemctl start sleuth-app`, confirm `health`, and stop the task (no files have changed). Only when it succeeds, from the laptop: `dhq deploy -p aegis-sleuth-slackbot -s Production -b main -r <main merge SHA> --wait` (the guard runs, the pre-upload stop is a no-op, `deploy.sh` starts the service). The build-gate time (about 5 minutes on 2026-08-27) is added to the downtime, accepted for a Sunday release; if the deployment has not started uploading within 5 minutes, cancel it, `systemctl start sleuth-app`, and stop the task. Verify the step list includes the build commands (SOP §3.4) and the guard step.

C4. Verify at start and after 15 minutes: `/root/sleuth-app-v3/CHANGELOG.md` top entry `1.4.344`; sha256 of `src/app.js`, `src/chat-module.js`, `src/router-shadow-module.js`, `package.json` equal to `main`; `node_modules/nodemailer/package.json` version 10.0.9; service active on Node 22, `NRestarts` unchanged since start; `health` exits 0 with `IncomingMessageCount` at or above the A4 value; journal checks scoped to the new PID; router mode `active` for `neochrome` in the startup log; `inventory /var/lib/aegis-sleuth | diff - /root/node18-rollback/inventory-C.txt` shows no missing workspace and no missing `ReminderID` except ones the journal shows fired or completed since the deploy.

Rollback C (code), one sequence:
1. `dhq deploy -p aegis-sleuth-slackbot -s Production -b main --start-revision <main merge SHA> -r 4f0ca42 --wait` — an explicit reverse range, so it works even when the failed deploy left 4f0ca42 as the last successful revision. Its `npm ci` reinstalls the 1.4.328 lockfile on Node 22, already proven in A. Then, whether or not DeployHQ reported deletions (plan QA R4-S4): `systemctl stop sleuth-app`, delete every path on the saved added-file list that still exists under `/root/sleuth-app-v3`, `systemctl start sleuth-app`. Verify with C4's hash check against 4f0ca42, a check that none of the listed files remain, and the full C4 health checks (service, `health`, journal, inventory).
2. There is no `--full` fallback: C3 refuses to deploy unless the reverse-range preview was produced first (plan QA R3-S4). If the reverse deploy itself fails, `systemctl stop sleuth-app`, upload the 4f0ca42 tree by hand from a clean checkout (`git archive 4f0ca42 | ssh root@<prod> 'tar x -C /root/sleuth-app-v3'`), delete the saved added-file list, run `scripts/deploy.sh` (which reinstalls and starts), then the C4 checks.

Data recovery (only if a data problem is found; not part of a normal rollback because the release changes no data format):
```bash
set -euo pipefail; K=/root/node18-rollback; T=$(date -u +%Y%m%dT%H%M%SZ); S=$K/<chosen snapshot>.tgz
rm -f $K/inventory-restore.txt
verify_archive $S $K/inventory-restore.txt   # validate before touching live data
systemctl stop sleuth-app
mv /var/lib/aegis-sleuth /var/lib/aegis-sleuth.failed-$T          # keep the current state, including later work
tar xzpf $S -C /var/lib     # recreates /var/lib/aegis-sleuth with the snapshot's ownership
inventory /var/lib/aegis-sleuth > $K/inventory-restored-live.txt
diff $K/inventory-restore.txt $K/inventory-restored-live.txt
systemctl start sleuth-app   # then run the C4 health checks
```
Snapshots are quiescent (A3 and C3, both taken with the service stopped). Restoring one loses reminders created or completed after it; the `.failed-$T` copy keeps them for manual reconciliation, and the operator chooses before a restore.
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
- 2026-10-11: Codex plan QA round 2 FAIL (R2-S3 quiescent, validated release snapshot and JSON acceptance; R2-S4 reverse-range preview before the deploy and health checks after a rollback; Nit installer `nsolid` pin; optional curl timeouts). All accepted and folded in. Round 3 (last) next.
- 2026-10-11: Codex plan QA round 3 FAIL (R3-S3a C3 snapshot block not executable/halting; R3-S3b compare reminder records, not file counts; R3-S4 `--full` fallback deleted files after start). All accepted: full fail-fast C3 block with shutdown evidence and archive-equals-live check; `inventory()` of workspace names and `ReminderID`s used at A3, C3, C4 and in recovery; `--full` fallback removed (the pre-deploy reverse preview gate makes it unnecessary; a manual stopped-service fallback replaces it). Phases A and B had no open findings in round 3. The start-task review cap (3 rounds) is reached; operator decision needed for a 4th round.
- 2026-10-11: Phase A executed 17:44-17:47 UTC (operator chose: 4th review round in parallel, run A and B now). A1 kit verified (deb 18.20.6 amd64; archives readable; setup_22.x sha256 575583bb…, writes only the backed-up keyring/sources/pins). A3: stop 17:45:10, quiescent snapshot inventory 47 lines (5 workspaces, 42 reminders) equal to live, Node v22.23.3, `npm ci --omit=dev` ok, sqlite 1 / sqlite-vec v0.1.9, start 17:45:57 (47 s downtime). Outgoing PID 1927135 logged `saved 42 reminders to file` and `shutdown complete`; only error the known `not_in_channel`. A4: active, NRestarts 0, `/usr/bin/node` v22.23.3, health ok, all workspaces started, `neochrome` Slack/AI/Notion ok, router `active`, errors = 3 known-noise connectivity lines, inventory unchanged.
- 2026-10-11: Phase B executed: DeployHQ SSH command 465398ef (before_changes, position 1 ahead of stop, halt_on_error true, timeout 300, timing all, servers 1662264 + 1659102). Red control: version 18.20.6 -> exit 1, 22.23.2 -> exit 0; the stored command exits 0 on production (Node 22.23.3) and development.
- 2026-10-11: Codex plan QA round 4 FAIL, STATUS Escalated (cap): R4-S3a `&&` lists escape `set -e`; R4-S3b shutdown evidence must be PID-bound and error-free (A3 included); R4-S4 apply the added-file deletion list even after a successful reverse deploy. All accepted and folded in (`verify_archive`, `shutdown_ok`, one command per line, deletion list always applied). A3's actual run already satisfied R4-S3b (evidence above). Phase C awaits operator decision.
- 2026-10-11: Helper red controls on production (read-only): `shutdown_ok` passes for the A3 outgoing PID and fails for an unknown PID; `verify_archive` fails for a missing archive and reproduces inventory-A from the A snapshot. The first version passed the unknown-PID control because bash ignores `set -e` inside a function called from `if`; every check now returns explicitly.
