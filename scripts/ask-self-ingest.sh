#!/usr/bin/env bash
# Canonical ask-self ingest wrapper — copy verbatim into an integrated repo's
# scripts/ directory. (Re)build THIS repo's RAG index.
#
#   ./scripts/ask-self-ingest.sh [--mode all|code|docs] [extra flags]
#
# Self-locates the external ask-self checkout (same resolution order as
# ask-self-query.sh) — no per-machine absolute path is baked in. Override:
#   ASK_SELF_PATH=/path/to/ask-self ./scripts/ask-self-ingest.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Resolve the ask-self checkout (no hardcoded absolute path) ---------------
if [ -z "${ASK_SELF_PATH:-}" ]; then
  for _candidate in \
    "$REPO_ROOT/../ask-self" \
    "$HOME/Documents/GitHub-Repos/ask-self" \
    "$HOME/Documents/GitHub/ask-self" \
    "$HOME/ask-self"; do
    if [ -f "$_candidate/ask_self_query.py" ]; then
      ASK_SELF_PATH="$(cd "$_candidate" && pwd)"
      break
    fi
  done
fi
if [ -z "${ASK_SELF_PATH:-}" ] && command -v ask-self >/dev/null 2>&1; then
  _bin="$(command -v ask-self)"
  _root="$(cd "$(dirname "$_bin")/.." && pwd)"
  if [ -f "$_root/ask_self_query.py" ]; then
    ASK_SELF_PATH="$_root"
  fi
fi
if [ -z "${ASK_SELF_PATH:-}" ]; then
  echo "ask-self: could not locate your ask-self checkout." >&2
  echo "  Set ASK_SELF_PATH, e.g.: export ASK_SELF_PATH=\"\$HOME/Documents/GitHub-Repos/ask-self\"" >&2
  exit 1
fi
# -----------------------------------------------------------------------------

HARNESS_CONFIG="$REPO_ROOT/ask_self/ask_self_harness.json"
ENTRYPOINT="$ASK_SELF_PATH/ask_self_ingest.py"

if [ ! -d "$ASK_SELF_PATH" ]; then
  echo "ask-self: ASK_SELF_PATH does not exist: $ASK_SELF_PATH" >&2
  exit 1
fi
if [ ! -f "$ENTRYPOINT" ]; then
  echo "ask-self: ingest entry point missing: $ENTRYPOINT" >&2
  exit 1
fi
if [ ! -f "$HARNESS_CONFIG" ]; then
  echo "ask-self: local harness missing: $HARNESS_CONFIG" >&2
  exit 1
fi

if [ -n "${ASK_SELF_PYTHON:-}" ]; then
  PYTHON_BIN="$ASK_SELF_PYTHON"
elif [ -x "$ASK_SELF_PATH/.venv/bin/python" ]; then
  PYTHON_BIN="$ASK_SELF_PATH/.venv/bin/python"
else
  PYTHON_BIN="python3"
fi

# Default to a full code+docs ingest unless the caller picked a --mode.
BASE_ARGS=(--harness-config "$HARNESS_CONFIG")
if [[ " $* " != *" --mode "* ]]; then
  BASE_ARGS+=(--mode all)
fi

# GH-123: this repo's harness uses embedding.provider="cloudflare-workers-ai" (Cloudflare
# Workers AI-hosted BAAI/bge-small-en-v1.5). Requires CLOUDFLARE_ACCOUNT_ID and
# CLOUDFLARE_API_TOKEN already exported in the environment before running this script -- neither
# is resolved here, since this wrapper is meant to stay a verbatim, machine-agnostic copy (no
# baked-in secrets-file paths). See GH-119 for the prior local-BGE provider ("qwen-local") this
# replaced, and GH-121 for the Cloudflare cost research that motivated the move.

cd "$REPO_ROOT"
exec "$PYTHON_BIN" "$ENTRYPOINT" "${BASE_ARGS[@]}" "$@"
