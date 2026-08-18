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
