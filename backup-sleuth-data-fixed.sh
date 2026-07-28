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

# Change to script directory for consistent relative paths
cd "$SCRIPT_DIR"

# Check if data directory exists
if [ ! -d "data/runtime" ]; then
  echo "Error: data/runtime directory not found. Are you in the Sleuth app root?" >&2
  exit 1
fi

# Enable nullglob to handle missing directories gracefully
shopt -s nullglob

# Collect all files to backup
FILES=()

# Workspace configurations
if [ -d "data/runtime/workspaces" ]; then
  FILES+=(data/runtime/workspaces/*.json)
fi

# Reminder files (including enabled channels and counters)
if [ -d "data/runtime/reminders" ]; then
  FILES+=(data/runtime/reminders/*.json)
fi

# Stats files
if [ -d "data/runtime/stats" ]; then
  FILES+=(data/runtime/stats/*.json)
fi

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