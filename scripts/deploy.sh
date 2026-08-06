#!/usr/bin/env bash
# Canonical server-side post-deploy hook for DeployHQ (and emergency SSH deploys).
# Does not touch data/runtime/, .env.runtime, or workspace JSON.
set -euo pipefail

APP_DIR="${SLEUTH_APP_DIR:-/root/sleuth-app}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "error: app directory not found: $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/src/app.js" ]]; then
  echo "error: src/app.js missing under $APP_DIR — deploy upload may have failed" >&2
  exit 1
fi

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
