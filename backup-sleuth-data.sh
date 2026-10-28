#!/bin/bash

# Documented backup entry point. The real logic lives in backup-sleuth-data-fixed.sh, which backs up
# the data directory the service actually uses (SLEUTH_DATA_DIR) and includes events/*.jsonl.
# This file used to zip only the install-relative data/runtime tree and skipped the event ledger.

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-sleuth-data-fixed.sh" "$@"
