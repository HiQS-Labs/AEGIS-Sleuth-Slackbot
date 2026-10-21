---
gh_issue: 249
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/249
title: "Prod: hourly read-only mirror of the private git-pulse export repo for Sleuth scripts"
status: Complete
created: 2026-10-20
updated: 2026-10-21
owner: noel
goal: "Hourly, read-only, token-safe clone of the private git-pulse repo on production for Sleuth scripts"
doc_type: feature
branch: feat/AEGIS-Sleuth-Slackbot-gh249-git-pulse-mirror-2026-10-20
rated: 60/20/50/85
related: "GH-248 (first consumer: HiQS activity → Slack threads); GH-100 (mirror staleness); GH-101 (export unit env path)"
---

# GH-249 — Hourly read-only git-pulse mirror on production

## Status

| What was just completed | What's next |
|---|---|
| Live on production; smoke, red controls and leak check pass (receipt below). Plan QA approved r2; final Codex QA approved r2 at `c7cab3c` (`PROJECT/RELAY/gh-249-final-qa.md`). PR opened against `development`. | Await merge of the PR (it only versions the files; prod already runs them). GH-248 can read the mirror now. |

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
  documents `$HOME/git-pulse-sync`, so the mirror defaults to `/root/git-pulse-sync` (root's `$HOME`)
  for the same layout. **Correction (plan QA S1):** `skills/talk-to-reminders/query-reminders.mjs:47`
  defaults to the *literal* string `'$HOME/git-pulse-sync/sync/sleuth'`, which JS never expands, and it
  reads `SLEUTH_MIRROR_DIR`, not `SLEUTH_GIT_PULSE_DIR`. So existing readers do **not** work unchanged.
  A server-side consumer sets
  `SLEUTH_MIRROR_DIR="${SLEUTH_GIT_PULSE_DIR:-/root/git-pulse-sync}/sync/sleuth"` explicitly. The
  README documents that mapping; fixing the reader's literal default is out of scope here.

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
     (GH-86/GH-101 rule) and **reject an empty result** before joining `.env.runtime`. A
     `SLEUTH_ENV_FILE` override exists only for the red control. Read **only** `SLEUTH_RAG_GITHUB_PAT`
     with a literal `sed` (no `source`, which avoids the metacharacter gotcha in the server guide).
     Supported spelling is the plain `KEY=value` the live file uses: the last match wins, CR is
     stripped, and quotes are not interpreted. Fail with a named, non-secret error if the file or value
     is missing, before any network access.
   - Auth: the PAT is exported to git's environment only, and the helper is a top-level `git -c`
     placed before the subcommand (not clone's persistent `-c`), so it is never written to config:
     `credential.helper=!f() { echo username=x-access-token; echo "password=${SLEUTH_RAG_GITHUB_PAT}"; }; f`.
     The helper text names the variable, never the value. `echo` is a shell builtin, so the value
     appears in no process argv. The URL is credential-free (`https://github.com/<repo>.git`), and
     there is no `set -x`.
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
   consumer contract (path, `SLEUTH_GIT_PULSE_DIR`, the `SLEUTH_MIRROR_DIR` mapping from S1,
   read-only), freshness, rollback. Freshness has two parts, and the README keeps them separate:
   `.git/FETCH_HEAD` mtime = when the mirror last fetched; a payload's own stamp (e.g.
   `exportGeneratedAt`) = how fresh the upstream data is. Upstream staleness is GH-100.
6. Doc pointers: `ARCHITECTURE.md` "Local Reminder Export Mirror" gains a short "Server-side
   mirror" note. `docs/server-installation-guide.md` gets a one-paragraph pointer. Add a `CHANGELOG.md`
   entry.
7. Install on production and smoke (below). Record the receipt in `PROJECT/2-WORKING/GH-249-*`.

## Verification (bounded; no new test suites)

Shell and systemd deploy files, mirroring the precedent, which has no tests. Checks:

- Static: `bash -n` + `shellcheck` on both scripts; `systemd-analyze verify` on the units (on the server).
- Red controls (each must exit non-zero with the named, non-secret error; the live app env is never
  touched):
  - `/etc/default/sleuth-git-pulse-mirror` moved aside → `systemctl start` fails (proves there is no `-`).
  - **Derived runtime env missing:** manual run with `SLEUTH_ENV_FILE=/nonexistent` → fails before any
    network access.
  - **Empty PAT:** manual run with `SLEUTH_ENV_FILE` pointing at a temp file holding `SLEUTH_RAG_GITHUB_PAT=` → fails.
- **Smoke, main path:** fresh install on prod → first clone. Assert the full 40-character
  `git rev-parse HEAD` equals the full SHA from `git ls-remote origin refs/heads/main`. Assert
  `git symbolic-ref --short HEAD` = `main` and `git status --porcelain` is empty. Assert
  `sync/sleuth/reminders-neochrome.json` parses as JSON. Assert `systemctl is-enabled` on the timer
  = `enabled`, and `list-timers` shows the next elapse within one hour plus the 5 min randomized delay
  (plan QA r2 nit). Run the real consumer:
  `SLEUTH_MIRROR_DIR=/root/git-pulse-sync/sync/sleuth node skills/talk-to-reminders/query-reminders.mjs --json --limit 1`
  must exit 0 and load from the mirror (S1).
- **Smoke, adjacent path:** re-run `install.sh` with no argument (idempotent: `sha256sum` of the units
  and the config is unchanged), then `systemctl start` again → exit 0 with an unchanged HEAD.
  **Reset control (S2):** append a line to a tracked file in the mirror, assert `git status
  --porcelain` is non-empty, run the service, then assert porcelain is empty and the file's sha256
  matches its pre-edit value.
- **Leak check (S3), no token in any argv, the check's own included:** a small script reads the PAT
  itself from the env file (via `sed`, inside the script) and searches with `grep -qF -f <(printf
  '%s\n' "$PAT")`, so the pattern travels through a pipe, not argv. It searches `.git/config`,
  `git remote -v` output, `journalctl -u sleuth-git-pulse-mirror`, and `ps -eo args` sampled every
  0.1 s during a forced fetch, and prints only `PASS`/`FAIL` per surface. Positive control: the same
  scanner run against a temp file containing the token must print `FAIL`.
- Gate: `utils/pdda/pdda.sh run` (docs/governance); the repo's Jest suite is unaffected because no
  `src/` or test paths change, so it is run only if the pre-push hook routes it.

## Rating (2026-10-20)

`rated 60/20/50/85` — **pri 60:** operator-requested today, and it unblocks GH-248. **sev 20:**
an enabler, not a defect; nothing is broken without it. **appeal 50:** neutral (no user score
given). **effort 85:** small, mirrors an existing pattern, and all prerequisites (git, PAT access,
disk) were probed on the box 2026-10-20; the deployment receipt will confirm them. Recurrence: not
applicable (new capability). Uncertainty: low, and resolved by the smoke receipt.

## Production install + smoke receipt (2026-10-20, ~23:38–23:42 UTC)

Installed on the **production** server from a copy of `deploy/git-pulse-mirror/` at `a6d6223`
(copied to a temp dir on the box; production's app tree was not `git pull`ed to an unmerged branch).
Scripts used: [`GH-249-smoke/smoke.sh`](GH-249-smoke/smoke.sh) (the repo name is passed as an
argument, never stored) and [`GH-249-smoke/leak-check.sh`](GH-249-smoke/leak-check.sh). Output
verbatim except for the redacted host:

| Check | Result |
|---|---|
| `bash -n`, `shellcheck -S warning` (local; the only lower-severity hit is info SC2016 at `sync-git-pulse-mirror.sh:33`, the intentionally single-quoted helper that defers expansion), `systemd-analyze verify` | pass (verify's only unit complaint was the not-yet-installed ExecStart path) |
| Red: `SLEUTH_ENV_FILE=/nonexistent` | `FAIL` as required → `env file not readable: /nonexistent`; no dir created, no network |
| Red: empty `SLEUTH_RAG_GITHUB_PAT=` | `FAIL` as required → `SLEUTH_RAG_GITHUB_PAT missing from <tmp>` |
| Red: repo var unset | `FAIL` as required → `SLEUTH_GIT_PULSE_REPO: set SLEUTH_GIT_PULSE_REPO (owner/name) in /etc/default/…` |
| Red: `/etc/default/sleuth-git-pulse-mirror` moved aside | unit fails (`Result=resources`); recovers once restored |
| Main: first clone | `HEAD == remote main (dc205fe0d9c9)`, the full SHA from an **authenticated** `ls-remote refs/heads/main`; on `main`; clean |
| Main: data | `sync/sleuth/reminders-neochrome.json` parses as JSON; mirror is 30 MB |
| Main: timer | `is-enabled` = enabled; next elapse `00:04:12` (25 min, within 1 h + 5 min jitter); service `Result=success`, exit 0 |
| Main: real consumer | `SLEUTH_MIRROR_DIR=/root/git-pulse-sync/sync/sleuth node <live tree>/skills/talk-to-reminders/query-reminders.mjs --json --limit 1` → exit 0, 1483 bytes |
| Adjacent: `install.sh` rerun with no argument | units, config and installed script byte-identical (sha256); HEAD unchanged |
| Adjacent: reset control | appended a line to a tracked file → porcelain dirty → service run → clean, original sha256 restored |
| Leak: positive control | scanner reports `FAIL` on a temp file containing the token (scanner works) |
| Leak: `.git/config`, `remote -v`, journal | `PASS` (token absent) |
| Leak: `ps -eo args` sampled every 0.1 s during a forced fetch | `PASS`, 113 git process lines sampled |
| Status line | `git-pulse mirror /root/git-pulse-sync at dc205fe0d 2026-10-20T16:27:37-07:00` |

Found during the smoke and fixed in this branch: `install.sh` printed systemd's "Consumed … CPU"
line instead of the sync status line. It now greps the script's own `^git-pulse mirror ` line. The
fixed installer was re-run on prod; installed artifacts stayed byte-identical (the installed sync
script's sha256 matches the repo copy).

**Final QA r1 follow-up (2026-10-20):** `install.sh` now runs `chmod 600` on the config on every
successful path (umask only covers creation; codex's scratch probe showed an existing 644 file
stays 644 when rewritten). Re-verified on prod with the fixed installer: config seeded at 644, then
the no-arg path → `644->600`, contents unchanged; the arg path → `644->600`, contents unchanged; an
already-600 rerun → `600->600`; all rc=0, service `Result=success`, mirror clean.
**Scope of the leak evidence:** the scan is observational. The positive control proves the matcher
works; surfaces were collected without error in this run; the 0.1 s `ps` sampling saw 113 git
process lines but cannot rule out a shorter-lived argv. The primary guarantee is structural: the
helper text holds the variable name, `echo` is a builtin, and the URL is credential-free.
