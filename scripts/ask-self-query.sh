#!/usr/bin/env bash
# Canonical ask-self query wrapper — copy verbatim into an integrated repo's
# scripts/ directory. Ask grounded, citation-backed questions about THIS repo.
#
#   ./scripts/ask-self-query.sh "how does X work?" [extra flags]
#
# ask-self stays external (not vendored). This wrapper SELF-LOCATES the external
# checkout — no per-machine absolute path is baked in. Resolution order:
#   1. $ASK_SELF_PATH if set (explicit override always wins)
#   2. a sibling ../ask-self checkout next to this repo
#   3. common locations under $HOME
#   4. an `ask-self` on $PATH
# Override for a non-standard layout:
#   ASK_SELF_PATH=/path/to/ask-self ./scripts/ask-self-query.sh "..."
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
ENTRYPOINT="$ASK_SELF_PATH/ask_self_query.py"

if [ ! -d "$ASK_SELF_PATH" ]; then
  echo "ask-self: ASK_SELF_PATH does not exist: $ASK_SELF_PATH" >&2
  exit 1
fi
if [ ! -f "$ENTRYPOINT" ]; then
  echo "ask-self: query entry point missing: $ENTRYPOINT" >&2
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

# Embedding providers: see the table in ask-self-ingest.sh. CLOUDFLARE_ACCOUNT_ID and
# CLOUDFLARE_API_TOKEN must already be exported before running this script -- needed at query time
# too, since queries embed the question text with the same provider the index was built with.
#
# SYNTHESIS is configured separately, via a "synthesis" block in ask_self_harness.json. Omit the
# block to use the default (gemini, needs GOOGLE_API_KEY). Supported: gemini (default),
# cloudflare-workers-ai, ollama, openai_compatible. Setting synthesis.provider to
# cloudflare-workers-ai gives a fully Gemini-free pipeline when paired with a Cloudflare or local
# embedding provider -- verified working with GOOGLE_API_KEY unset. See GH-127.
#
# Cross-provider note: querying an index with a different provider than built it does work (same
# model, same 384 dims), but the two BGE implementations agree only to ~0.95 cosine, so rankings
# shift. Prefer matching the query provider to the ingest provider.

cd "$REPO_ROOT"
exec "$PYTHON_BIN" "$ENTRYPOINT" \
  --harness-config "$HARNESS_CONFIG" \
  "$@"
