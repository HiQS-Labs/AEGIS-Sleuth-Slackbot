#!/usr/bin/env bash
# dashboard-staleness-guard.sh — refuse a push whose range writes the roadmap ledger but not the
# dashboard. Ported verbatim from XYZ-forge's GH-243 (the enforcement half of GH-169 item 3);
# unmodified because it was already written repo-agnostic (repo root is an argument, no hardcoded
# paths).
#
# WHY: since this repo's ROADMAP_SOURCE=releases flip, ROADMAP-DASHBOARD.md is the ONLY
# human-readable view of the roadmap ledger — the DB is what every tool trusts, and nothing else
# re-renders the view. A ledger write (releases.sql / releases.db) that ships without a dashboard
# regeneration publishes a view that silently disagrees with the data under it.
#
# WHERE IT RUNS: called by .githooks/pre-push with "<local_sha> <remote_sha>" ref pairs.
#
# SCOPE: applies only when this repo declares ROADMAP_SOURCE=releases in .pdda-mode. A new branch
# (all-zero remote sha) has no computable range and falls through untouched — this guard only ever
# ADDS a refusal, never substitutes for any other gate.
#
# Usage: dashboard-staleness-guard.sh <repo_root> <local_sha> <remote_sha> [<local_sha> <remote_sha>...]
# Exit:  0 ok (guard passed or not applicable) · 1 refuse the push · 2 usage.
set -uo pipefail

REPO="${1:-}"; shift || true
[ -n "$REPO" ] && [ -d "$REPO" ] || { echo "dashboard-staleness-guard: usage: <repo_root> <local_sha> <remote_sha>..." >&2; exit 2; }

grep -q "ROADMAP_SOURCE=releases" "$REPO/.pdda-mode" 2>/dev/null || exit 0

touched_ledger=0
touched_dashboard=0
while [ "$#" -ge 2 ]; do
  local_sha="$1"; remote_sha="$2"; shift 2
  case "$remote_sha" in
    ''|0000000000000000000000000000000000000000) continue ;;   # new branch: no range to inspect
  esac
  git -C "$REPO" cat-file -e "${remote_sha}^{commit}" 2>/dev/null || continue
  while IFS= read -r path; do
    case "$path" in
      releases.sql|releases.db) touched_ledger=1 ;;
      ROADMAP-DASHBOARD.md)     touched_dashboard=1 ;;
    esac
  done < <(git -C "$REPO" diff --no-renames --name-only "$remote_sha" "$local_sha" 2>/dev/null)
done

if [ "$touched_ledger" -eq 1 ] && [ "$touched_dashboard" -eq 0 ]; then
  cat >&2 <<'EOF'
dashboard-staleness-guard: REFUSING the push — this range writes the roadmap ledger
(releases.sql / releases.db) without regenerating ROADMAP-DASHBOARD.md, so the human-readable
view would ship stale against the data under it.

Fix (one command, then commit the result into the same push):
    bash utils/roadmap-dashboard.sh && git add ROADMAP-DASHBOARD.md && git commit -m "docs: regenerate roadmap dashboard"

Bypass (deliberately loud, e.g. a WIP branch): git push --no-verify
EOF
  exit 1
fi
exit 0
