#!/bin/bash
# Install (or update) the read-only git-pulse mirror on the Sleuth server (GH-249).
# Idempotent — safe to re-run after a box rebuild or a script change.
#
# First install (run from this directory on the server, after `git pull` in the live app tree):
#   bash deploy/git-pulse-mirror/install.sh <owner/name-of-private-git-pulse-repo>
# Later updates can omit the argument; the existing /etc/default/sleuth-git-pulse-mirror is kept.
#
# The repo name lives only in that server-side file — never commit it here (this repo is public).
# Credentials are reused from the live app tree's .env.runtime (SLEUTH_RAG_GITHUB_PAT).

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/root/sleuth-git-pulse-mirror"
CONFIG="/etc/default/sleuth-git-pulse-mirror"
UNIT_DIR="/etc/systemd/system"

if [ -n "${1:-}" ]; then
    umask 077
    printf 'SLEUTH_GIT_PULSE_REPO=%s\nSLEUTH_GIT_PULSE_DIR=%s\n' "$1" "${SLEUTH_GIT_PULSE_DIR:-/root/git-pulse-sync}" > "$CONFIG"
    echo "  wrote $CONFIG"
elif [ ! -f "$CONFIG" ]; then
    echo "usage: $0 <owner/name>   (no $CONFIG yet)" >&2
    exit 2
fi
chmod 600 "$CONFIG"   # umask only covers creation; enforce on rewrite and reuse too

mkdir -p "$INSTALL_DIR"
install -m 755 "$SRC_DIR/sync-git-pulse-mirror.sh" "$INSTALL_DIR/"
install -m 644 "$SRC_DIR/sleuth-git-pulse-mirror.service" "$SRC_DIR/sleuth-git-pulse-mirror.timer" "$UNIT_DIR/"
echo "  installed script → $INSTALL_DIR, units → $UNIT_DIR"

systemctl daemon-reload
systemctl enable --now sleuth-git-pulse-mirror.timer
systemctl start sleuth-git-pulse-mirror.service
journalctl -u sleuth-git-pulse-mirror.service -n 20 --no-pager -o cat | grep '^git-pulse mirror ' | tail -1

echo
echo "Done. Verify:"
echo "  systemctl list-timers sleuth-git-pulse-mirror.timer"
echo "  journalctl -u sleuth-git-pulse-mirror.service -n 20 --no-pager"
