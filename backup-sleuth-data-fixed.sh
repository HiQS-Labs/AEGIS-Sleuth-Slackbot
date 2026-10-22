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
DATA_DIR="${SLEUTH_DATA_DIR:-}"
if [ -z "$DATA_DIR" ] && command -v systemctl >/dev/null 2>&1; then
  DATA_DIR="$(systemctl show sleuth-app -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^SLEUTH_DATA_DIR=//p' | tail -1)"
fi
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data/runtime}"

if [ ! -d "$DATA_DIR" ]; then
  echo "Error: runtime data directory not found: $DATA_DIR" >&2
  exit 1
fi
echo "Backing up runtime data from: $DATA_DIR"
cd "$DATA_DIR"

# Enable nullglob to handle missing directories gracefully
shopt -s nullglob

# Collect all files to backup: workspace configs; reminders, counters, enabled channels and
# completion history; stats; and the event ledger (JSONL).
FILES=(workspaces/*.json reminders/*.json stats/*.json events/*.jsonl)

# Check if we found any files
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No data files found to back up." >&2
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create the backup
echo "Creating backup of ${#FILES[@]} files..."
zip -r "$ZIP_FILE" "${FILES[@]}"

# Verify the backup was created
if [ -f "$ZIP_FILE" ]; then
  SIZE=$(du -h "$ZIP_FILE" | cut -f1)
  echo "✓ Backup created successfully"
  echo "  Location: $ZIP_FILE"
  echo "  Size: $SIZE"
  echo "  Files: ${#FILES[@]}"
else
  echo "Error: Failed to create backup" >&2
  exit 1
fi

# Optional: Remove backups older than 30 days
echo ""
echo "Cleaning up old backups..."
find "$BACKUP_ROOT/sleuth-backups" -name "sleuth-config-data-*.zip" -mtime +30 -type f -delete 2>/dev/null || true
OLD_COUNT=$(find "$BACKUP_ROOT/sleuth-backups" -name "sleuth-config-data-*.zip" -mtime +30 -type f 2>/dev/null | wc -l || echo 0)
if [ "$OLD_COUNT" -gt 0 ]; then
  echo "  Removed $OLD_COUNT backup(s) older than 30 days"
else
  echo "  No old backups to remove"
fi