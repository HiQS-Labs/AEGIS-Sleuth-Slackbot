#!/bin/bash
# Keep a read-only local mirror of the private git-pulse repo current (GH-249).
# Driven hourly by sleuth-git-pulse-mirror.timer; see README.md beside this file.
#
# The mirror is never committed to: every run hard-resets to the remote branch, so local edits are
# discarded. The GitHub token is read from the live app tree's .env.runtime and handed to git via an
# inline credential helper — it never lands in .git/config, the remote URL, or a process argument.

set -euo pipefail

REPO="${SLEUTH_GIT_PULSE_REPO:?set SLEUTH_GIT_PULSE_REPO (owner/name) in /etc/default/sleuth-git-pulse-mirror}"
DIR="${SLEUTH_GIT_PULSE_DIR:-$HOME/git-pulse-sync}"
BRANCH="${SLEUTH_GIT_PULSE_BRANCH:-main}"

# Derive the live install tree from systemd rather than hardcoding it (GH-86 / GH-101).
# SLEUTH_ENV_FILE overrides it (used by the red-control checks in the README).
ENV_FILE="${SLEUTH_ENV_FILE:-}"
if [ -z "$ENV_FILE" ]; then
  APP_DIR="$(systemctl show sleuth-app -p WorkingDirectory --value)"
  [ -n "$APP_DIR" ] || { echo "cannot resolve sleuth-app WorkingDirectory" >&2; exit 1; }
  ENV_FILE="$APP_DIR/.env.runtime"
fi
[ -r "$ENV_FILE" ] || { echo "env file not readable: $ENV_FILE" >&2; exit 1; }

# Read the one value literally (plain KEY=value, last wins) — sourcing would expand $ in other values.
SLEUTH_RAG_GITHUB_PAT="$(sed -n 's/^SLEUTH_RAG_GITHUB_PAT=//p' "$ENV_FILE" | tail -1 | tr -d '\r')"
[ -n "$SLEUTH_RAG_GITHUB_PAT" ] || { echo "SLEUTH_RAG_GITHUB_PAT missing from $ENV_FILE" >&2; exit 1; }
export SLEUTH_RAG_GITHUB_PAT GIT_TERMINAL_PROMPT=0

# Helper text names the variable, not its value; `git -c` is per-invocation and never persisted.
git_auth() {
  git -c credential.helper= \
      -c 'credential.helper=!f() { echo username=x-access-token; echo "password=${SLEUTH_RAG_GITHUB_PAT}"; }; f' "$@"
}

if [ ! -d "$DIR/.git" ]; then
  git_auth clone --quiet --single-branch --branch "$BRANCH" "https://github.com/$REPO.git" "$DIR"
else
  git_auth -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" reset --quiet --hard FETCH_HEAD
fi

echo "git-pulse mirror $DIR at $(git -C "$DIR" log -1 --format='%h %cI')"
