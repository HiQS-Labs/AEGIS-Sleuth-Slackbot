#!/usr/bin/env bash
# Canonical server-side post-deploy hook for DeployHQ (and emergency SSH deploys).
# Does not touch data/runtime/, .env.runtime, or workspace JSON.
set -euo pipefail

# Derive APP_DIR from the running systemd unit WorkingDirectory, falling back to $SLEUTH_APP_DIR.
SYSTEMD_APP_DIR=""
if command -v systemctl >/dev/null 2>&1; then
  SYSTEMD_APP_DIR="$(systemctl show sleuth-app -p WorkingDirectory --value 2>/dev/null || true)"
fi

APP_DIR="${SYSTEMD_APP_DIR:-${SLEUTH_APP_DIR:-}}"

if [[ -z "$APP_DIR" ]]; then
  echo "error: app directory could not be resolved from systemd (sleuth-app WorkingDirectory) or SLEUTH_APP_DIR" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "error: app directory not found: $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/src/app.js" ]]; then
  echo "error: src/app.js missing under $APP_DIR — deploy upload may have failed" >&2
  exit 1
fi

echo "[deploy] target app directory: $APP_DIR"

# GH-111: say what is deployed and how far it is from origin/main, BEFORE touching the service.
#
# Production could not answer "am I running current main?" at all. Its fetch refspec had been
# narrowed to `development` -- a branch that host is not even on -- and `main` had no upstream, so
# `git status` printed a clean tree whether the host was current or fifty commits behind. Combined
# with a manual production deploy trigger (docs/deployhq.md:53), `main` could sit undeployed
# indefinitely with every check an operator would run reporting success.
#
# Resolved against FETCH_HEAD rather than origin/main on purpose: that works on a host whose
# refspec has NOT been repaired, so this line is useful everywhere rather than only where someone
# already fixed the config.
#
# Informational ONLY. Every failure path returns 0 -- a deploy must never abort because it could
# not reach the network, or because the tree is a DeployHQ artifact upload rather than a checkout.
ReportDeployDrift() {
  command -v git >/dev/null 2>&1 || { echo "[deploy] drift: skipped (git not available)"; return 0; }

  # Must be the repo ROOT, not merely somewhere inside one. `rev-parse --git-dir` walks UP, so a
  # deployed tree that happens to sit within an unrelated checkout would otherwise report that
  # outer repo's drift — a confidently wrong answer, which is worse than no answer. Caught by
  # `skips cleanly ... not a git checkout`, whose mock app dir lives inside this very repository.
  local RepoTopLevel
  RepoTopLevel="$(git -C "$APP_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$RepoTopLevel" || ! "$RepoTopLevel" -ef "$APP_DIR" ]]; then
    echo "[deploy] drift: skipped ($APP_DIR is not a git checkout)"
    return 0
  fi

  local DeployedBranch DeployedSha RemoteSha BehindCount FetchCmd
  DeployedBranch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  DeployedSha="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "[deploy] deployed: $DeployedSha (branch $DeployedBranch)"

  # Never let a credential prompt or an unreachable remote hang the deploy.
  FetchCmd=(git -C "$APP_DIR" fetch --quiet origin main)
  command -v timeout >/dev/null 2>&1 && FetchCmd=(timeout 30 "${FetchCmd[@]}")
  GIT_TERMINAL_PROMPT=0 "${FetchCmd[@]}" 2>/dev/null || {
    echo "[deploy] drift: unknown (could not fetch origin main)"; return 0; }

  RemoteSha="$(git -C "$APP_DIR" rev-parse --short FETCH_HEAD 2>/dev/null || echo unknown)"
  BehindCount="$(git -C "$APP_DIR" rev-list --count HEAD..FETCH_HEAD 2>/dev/null || echo unknown)"
  echo "[deploy] origin/main: $RemoteSha"

  if [[ "$BehindCount" == "0" ]]; then
    echo "[deploy] drift: none — deployed tree already matches origin/main"
  else
    echo "[deploy] drift: $BehindCount commit(s) behind origin/main"
  fi
}
ReportDeployDrift

echo "[deploy] stopping sleuth-app"
systemctl stop sleuth-app || true

echo "[deploy] installing production dependencies in $APP_DIR"
cd "$APP_DIR"
npm ci --omit=dev

echo "[deploy] reloading systemd and starting sleuth-app"
systemctl daemon-reload
systemctl start sleuth-app
systemctl status sleuth-app --no-pager

echo "[deploy] done"
