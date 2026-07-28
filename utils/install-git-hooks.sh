#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

cd "${REPO_ROOT}"

CURRENT_HOOKS=$(git config --local core.hooksPath || true)
if [[ "${CURRENT_HOOKS}" == ".githooks" ]]; then
  echo "Git hooks already configured (core.hooksPath is .githooks)."
else
  git config --local core.hooksPath .githooks
  echo "Git hooks configured successfully (core.hooksPath set to .githooks)."
fi
