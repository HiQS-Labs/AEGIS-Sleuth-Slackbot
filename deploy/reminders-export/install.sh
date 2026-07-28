#!/bin/bash
# Install (or update) the Sleuth reminders-export publisher on the Sleuth server.
# Idempotent — safe to re-run after a box rebuild or a script change.
#
# Run from this directory on the server (e.g. after `git pull` in /root/sleuth-app):
#   bash deploy/reminders-export/install.sh
#
# Credentials are reused from /root/sleuth-app/.env.runtime (WEB_API_BEARER_TOKEN +
# SLEUTH_RAG_GITHUB_PAT) — this script does not touch secrets.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${SLEUTH_APP_DIR:-/root/sleuth-app}"
INSTALL_DIR="${SLEUTH_EXPORT_DIR:-/root/sleuth-reminders-export}"
UNIT_DIR="/etc/systemd/system"

echo "Installing Sleuth reminders-export publisher..."
echo "  from: $SRC_DIR"
echo "  app:  $APP_DIR  (EnvironmentFile = $APP_DIR/.env.runtime)"

if [ ! -f "$APP_DIR/.env.runtime" ]; then
    echo "WARN: $APP_DIR/.env.runtime not found — the timer needs WEB_API_BEARER_TOKEN" >&2
    echo "      and SLEUTH_RAG_GITHUB_PAT there to read the API and push the export." >&2
fi

# 1. Script (kept OUTSIDE the app's git tree so app `git pull`s can't conflict).
mkdir -p "$INSTALL_DIR"
install -m 644 "$SRC_DIR/publish-reminders-export.mjs" "$INSTALL_DIR/"
install -m 644 "$SRC_DIR/export-payload.js"             "$INSTALL_DIR/"
echo "  installed script + export-payload.js → $INSTALL_DIR"

# 2. systemd units.
install -m 644 "$SRC_DIR/sleuth-reminders-export.service" "$UNIT_DIR/"
install -m 644 "$SRC_DIR/sleuth-reminders-export.timer"   "$UNIT_DIR/"
echo "  installed .service + .timer → $UNIT_DIR"

# 3. Enable.
systemctl daemon-reload
systemctl enable --now sleuth-reminders-export.timer
echo "  timer enabled."

echo
echo "Done. Verify:"
echo "  systemctl list-timers sleuth-reminders-export.timer"
echo "  ( set -a; . $APP_DIR/.env.runtime; set +a; node $INSTALL_DIR/publish-reminders-export.mjs )"
echo "  journalctl -u sleuth-reminders-export.service -n 20 --no-pager"
