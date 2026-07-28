#!/bin/bash

# Backup Sleuth workspace configuration and reminder JSON files.

set -euo pipefail

# Directory where this script resides (Sleuth app root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_DATE="$(date '+%Y-%m-%d')"
BACKUP_DIR="$SCRIPT_DIR/$CURRENT_DATE-backup"
TIMESTAMP="$(date '+%y-%d-%m-%H%M%S')"
ZIP_FILE="$BACKUP_DIR/sleuth-config-data-$TIMESTAMP.zip"

cd "$SCRIPT_DIR"

shopt -s nullglob
FILES=()

if [ -d "data/runtime/workspaces" ]; then
  FILES+=(data/runtime/workspaces/*.json)
fi
if [ -d "data/runtime/reminders" ]; then
  FILES+=(data/runtime/reminders/*.json)
fi

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No workspace or reminder files found to back up." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
zip -r "$ZIP_FILE" "${FILES[@]}"

echo "Backup created at $ZIP_FILE"
