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

# Embedding provider is chosen in ask_self/ask_self_harness.json, not here. This wrapper stays a
# verbatim, machine-agnostic copy: it bakes in no secrets paths and sets no provider env vars, but
# it does `exec` the entrypoint, so anything you export in your shell reaches it.
#
# Supported providers (GH-127 -- all additive, none replaces another):
#   cloudflare-workers-ai  Cloudflare-hosted BAAI/bge-small-en-v1.5, 384d. THIS REPO'S CURRENT
#                          SETTING (GH-123). Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.
#   gemini                 gemini-embedding-001, 768d. Needs GOOGLE_API_KEY. Still fully supported
#                          -- GH-123 flipped a config field, it removed no code.
#   qwen-local             Same BGE-small, run on-device via sentence-transformers (the name is
#                          historical; it is a generic loader, not Qwen). Needs no credentials, but
#                          is gated: export ASK_SELF_ENABLE_QWEN=1 before running.
#   qwen-mlx               As above, Apple Silicon via mlx-embeddings.
#
# Caution when switching providers: the embed cache and the index drift check both key on
# (model, dim) and ignore the provider, so local BGE and Cloudflare BGE collide -- same model name,
# same 384 dims. Measured cosine similarity between the two is only ~0.95, so a silent cache hit
# can mix embedding spaces. Delete temp/rag/*.sqlite (index AND __embed_cache) when changing
# provider until that is fixed. See GH-127.

cd "$REPO_ROOT"
exec "$PYTHON_BIN" "$ENTRYPOINT" "${BASE_ARGS[@]}" "$@"
