---
gh_issue: 249
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/249
title: "Prod: hourly read-only mirror of the private git-pulse export repo for Sleuth scripts"
status: Proposed (1-INBOX — not yet active)
created: 2026-10-20
doc_type: feature
rated: 60/20/50/85
related: "GH-248 (first consumer: HiQS activity → Slack threads); GH-100 (mirror staleness); GH-101 (export unit env path)"
---

# GH-249 — Hourly read-only git-pulse mirror on production

## Ask

Keep a local, read-only, regularly refreshed clone of the private git-pulse export repo on the
**production** server at a stable path, so AEGIS Sleuth scripts (first: GH-248's Slack-thread
connector) can read it. Operator decisions (2026-10-20, recorded on the issue): **production**, not
Oracle dev; **mirror only** — the GH-248 connector stays a separate task.

Acceptance (from the issue): timer fires hourly; mirror clean on `main` and equal to `origin/main`
after a forced run; no token in `.git/config`, the remote URL, `ps` or the journal; `install.sh`
idempotent; consumer docs give path, env var and freshness check; nothing identifying the host, IP,
private repo name or secrets path is committed.

## Recon (base `0f15b89`, 2026-10-20)

- **Precedent:** `deploy/reminders-export/` — versioned `.service` + `.timer` + idempotent
  `install.sh`, script installed outside the app tree (`/root/sleuth-reminders-export/`).
- **Its known defect (GH-101), which this must not copy:** the unit hardcodes
  `EnvironmentFile=-/root/sleuth-app/.env.runtime`, the pre-GH-86 tree, and the `-` hides a
  missing file. Live probe confirms it: `sleuth-app` runs from `/root/sleuth-app-v3`, while the
  export unit still reads `/root/sleuth-app/.env.runtime`. GH-86's rule is to derive the live tree
  from `systemctl show sleuth-app -p WorkingDirectory`.
- **Credential:** `SLEUTH_RAG_GITHUB_PAT` is in the live `.env.runtime`. Probe: `git ls-remote`
  through a credential helper against the private repo returns rc=0, so read access is confirmed.
  The repo is private, `main`, about 15 MB.
- **Repo name is not in the env file.** The deployed out-of-repo publisher hardcodes it as its
  default. The in-repo copy defaults to `''` because this repo is public. So the repo name must
  come from server-side config, never from a committed file.
- **Host:** Debian 12 x86_64, git 2.39.5, 13 GB free; no existing `/root/git-pulse*`.
- **Consumer path convention already exists:** `ARCHITECTURE.md` → "Local Reminder Export Mirror"
  and `skills/talk-to-reminders/query-reminders.mjs:47` both use `$HOME/git-pulse-sync`. Mirroring
  to `/root/git-pulse-sync` (root's `$HOME`) means existing readers work on the server unchanged.

## Preflight bet check

- **Outcome sought:** server-side scripts can read any git-pulse file locally without
  per-file API calls or new credentials.
- **Smallest viable bet:** one ~25-line sync script, one oneshot service, one hourly timer, one
  idempotent installer, one README, and two doc pointers. Not built: posting, staleness alerting
  (GH-100), changes to the export publisher (GH-101), write-back, or the dev or Oracle servers.
- **Alternative rejected:** have each consumer fetch files through the contents API, as the
  publisher does. That adds per-consumer HTTP and auth code and rate-limit exposure; a clone gives
  every script plain file reads. Polling GitHub directly (GH-248's open question) is a GH-248 design
  choice and doesn't remove the need for a Git Pulse read path.
- **Rollback:** `systemctl disable --now sleuth-git-pulse-mirror.timer`, remove the two units,
  `/etc/default/sleuth-git-pulse-mirror`, `/root/sleuth-git-pulse-mirror/` and the mirror directory.
  The app is untouched, so reverting the PR removes the files.

## Plan

Extends the `deploy/reminders-export/` pattern (same layout and installer shape); no new
subsystem, and no app code changes.

1. `deploy/git-pulse-mirror/sync-git-pulse-mirror.sh`
   - Config from env: `SLEUTH_GIT_PULSE_REPO` (required, `owner/name`, no default — public repo),
     `SLEUTH_GIT_PULSE_DIR` (default `$HOME/git-pulse-sync`), `SLEUTH_GIT_PULSE_BRANCH` (default
     `main`).
   - Token: derive the live tree via `systemctl show sleuth-app -p WorkingDirectory --value`
     (GH-86/GH-101 rule), read **only** `SLEUTH_RAG_GITHUB_PAT` from its `.env.runtime` with a
     literal `sed` (no `source`, which avoids the metacharacter gotcha in the server guide), and fail
     loudly if missing.
   - Auth: an inline `git -c credential.helper='!f(){ … $SLEUTH_RAG_GITHUB_PAT … }; f'`. The helper
     text names the variable, never the value, and `git -c` does not persist, so the token never
     reaches `.git/config`, the remote URL or argv.
   - Clone if `.git` is missing, else `fetch origin <branch>` + `reset --hard FETCH_HEAD`, which
     enforces read-only: local edits are discarded. Print one status line (short SHA + commit time).
   - Concurrency: none added. systemd never runs a oneshot twice at once, and the README says to
     trigger manual runs via `systemctl start`.
2. `deploy/git-pulse-mirror/sleuth-git-pulse-mirror.service`: `Type=oneshot`,
   `EnvironmentFile=/etc/default/sleuth-git-pulse-mirror` (**no `-`**, so a missing file fails
   loudly), `After/Wants=network-online.target`, `TimeoutStartSec=300`.
3. `deploy/git-pulse-mirror/sleuth-git-pulse-mirror.timer`: `OnCalendar=hourly`,
   `RandomizedDelaySec=5min`, `Persistent=true`, `OnBootSec=3min`.
4. `deploy/git-pulse-mirror/install.sh <owner/name>`: writes `/etc/default/sleuth-git-pulse-mirror`
   (repo + absolute dir, mode 600) when an argument is given; with no argument it reuses the existing
   file, and fails if there is none. Installs the script to `/root/sleuth-git-pulse-mirror/`, the
   units to `/etc/systemd/system/`, runs `daemon-reload` + `enable --now` on the timer, then runs the
   service once (first clone) and prints status. Safe to re-run.
5. `deploy/git-pulse-mirror/README.md`: data flow, config, credentials (reused), install, operate,
   consumer contract (path, `SLEUTH_GIT_PULSE_DIR`, freshness = mtime of `.git/FETCH_HEAD`,
   read-only), rollback.
6. Doc pointers: `ARCHITECTURE.md` "Local Reminder Export Mirror" gains a short "Server-side
   mirror" note. `docs/server-installation-guide.md` gets a one-paragraph pointer. Add a `CHANGELOG.md`
   entry.
7. Install on production and smoke (below). Record the receipt in `PROJECT/2-WORKING/GH-249-*`.

## Verification (bounded; no new test suites)

Shell and systemd deploy files, mirroring the precedent, which has no tests. Checks:

- Static: `bash -n` + `shellcheck` on both scripts; `systemd-analyze verify` on the units (on the server).
- Red control: run the service with `/etc/default/sleuth-git-pulse-mirror` absent → the unit fails
  (proves the missing `-`); run with an empty PAT → non-zero with a named error.
- **Smoke, main path:** fresh install on prod → first clone; `git -C /root/git-pulse-sync rev-parse
  HEAD` == `git ls-remote origin main`; `sync/sleuth/reminders-neochrome.json` is readable.
- **Smoke, adjacent path:** re-run `install.sh` (idempotent, no diff in units or config) and
  `systemctl start` again → fast no-op. Then touch a tracked file in the mirror, rerun, and
  confirm it is reset (read-only contract).
- Leak check: `grep -r <token> /root/git-pulse-sync/.git/config`, `git remote -v`, and
  `journalctl -u sleuth-git-pulse-mirror` all show no token (compared without printing it).
- Gate: `utils/pdda/pdda.sh run` (docs/governance); the repo's Jest suite is unaffected because no
  `src/` or test paths change, so it is run only if the pre-push hook routes it.

## Rating (2026-10-20)

`rated 60/20/50/85` — **pri 60:** operator-requested today, and it unblocks GH-248. **sev 20:**
an enabler, not a defect; nothing is broken without it. **appeal 50:** neutral (no user score
given). **effort 85:** small, mirrors an existing pattern, and all prerequisites (git, PAT access,
disk) are verified on the box. Recurrence: not applicable (new capability). Uncertainty: none
material.
