#!/bin/bash

# Backup Sleuth workspace configuration and runtime data files.

set -euo pipefail

# Directory where this script resides (Sleuth app root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_DATE="$(date '+%Y-%m-%d')"
TIMESTAMP="$(date '+%y-%m-%d-%H%M%S')"

# Backup location - one directory above the app (as documented)
BACKUP_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$BACKUP_ROOT/sleuth-backups/$CURRENT_DATE"
ZIP_FILE="$BACKUP_DIR/sleuth-config-data-$TIMESTAMP.zip"

# Back up the data the running service actually uses (GH-271). Production keeps it outside the
# install dir (SLEUTH_DATA_DIR=/var/lib/aegis-sleuth), so backing up "$SCRIPT_DIR/data/runtime"
# silently zipped a stale copy for weeks. Order: explicit env, the service's own setting, install dir.
# Same precedence as Workspaces.GetRuntimeDirPath(): SLEUTH_DATA_DIR, then AEGIS_DATA_DIR.
DATA_DIR="${SLEUTH_DATA_DIR:-${AEGIS_DATA_DIR:-}}"

# Effective value of one variable in the sleuth-app unit, in systemd's own precedence: EnvironmentFile=
# overrides Environment=, and a later file or drop-in overrides an earlier one. A failed query (no systemd,
# no such unit) must yield nothing, not abort under `set -e`.
UnitVar() {
  local VALUE ENV_FILE FOUND
  VALUE="$(systemctl show sleuth-app -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n -e "s/^$1=//p" | tail -1 || true)"
  for ENV_FILE in $(systemctl show sleuth-app -p EnvironmentFiles --value 2>/dev/null | tr ' ' '\n' | grep '^/' || true); do
    [ -r "$ENV_FILE" ] || continue
    FOUND="$(sed -n -e "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"'"'"'\r' || true)"
    [ -n "$FOUND" ] && VALUE="$FOUND"
  done
  echo "$VALUE"
}
if [ -z "$DATA_DIR" ] && command -v systemctl >/dev/null 2>&1; then
  DATA_DIR="$(UnitVar SLEUTH_DATA_DIR)"
  [ -n "$DATA_DIR" ] || DATA_DIR="$(UnitVar AEGIS_DATA_DIR)"
fi
if [ -z "$DATA_DIR" ]; then
  DATA_DIR="$SCRIPT_DIR/data/runtime"
  echo "Warning: SLEUTH_DATA_DIR/AEGIS_DATA_DIR not found in the environment or the sleuth-app unit; backing up the install dir." >&2
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "Error: runtime data directory not found: $DATA_DIR" >&2
  exit 1
fi
echo "Backing up runtime data from: $DATA_DIR"
cd "$DATA_DIR"

# Enable nullglob to handle missing directories gracefully
shopt -s nullglob

# Back up everything the service keeps under the data dir (workspaces, reminders, events, stats, settings,
# context memory, decisions, client maps, relay state, ...), not a hand-kept list that drifts as features
# add new files. Dotfiles such as the .live-data marker are left out, so a restore never marks a dev box live.
FILES=(*)

# Check if we found any files
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No data files found to back up." >&2
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create the backup
echo "Creating backup of ${#FILES[@]} top-level entries..."
zip -r "$ZIP_FILE" "${FILES[@]}"

# Verify the backup was created
if [ -f "$ZIP_FILE" ]; then
  SIZE=$(du -h "$ZIP_FILE" | cut -f1)
  echo "✓ Backup created successfully"
  echo "  Location: $ZIP_FILE"
  echo "  Size: $SIZE"
  echo "  Files: $(zipinfo -1 "$ZIP_FILE" | grep -vc '/$' || true)"
else
  echo "Error: Failed to create backup" >&2
  exit 1
fi

# Optional: Remove backups older than 30 days
echo ""
echo "Cleaning up old backups..."
OLD_COUNT=$(find "$BACKUP_ROOT/sleuth-backups" -name "sleuth-config-data-*.zip" -mtime +30 -type f 2>/dev/null | wc -l | tr -d " " || echo 0)
find "$BACKUP_ROOT/sleuth-backups" -name "sleuth-config-data-*.zip" -mtime +30 -type f -delete 2>/dev/null || true
if [ "$OLD_COUNT" -gt 0 ]; then
  echo "  Removed $OLD_COUNT backup(s) older than 30 days"
else
  echo "  No old backups to remove"
fi