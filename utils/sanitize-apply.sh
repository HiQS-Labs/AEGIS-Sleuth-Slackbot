#!/usr/bin/env bash
#
# sanitize-apply.sh — apply an ordered replacement table across the tracked tree.
#
# The execution half of utils/sanitize-scan.sh. The scanner FINDS sensitive strings; this applies
# the agreed replacement for each. Same split design, for the same reason: the engine is generic
# and ships publicly, while the replacement table pairs real identifiers with their public
# stand-ins — which makes the TABLE the de-anonymization key, so it stays private and is passed in.
#
# WHY ORDER MATTERS (and why this is not a loop over unordered rules)
# ------------------------------------------------------------------
# Rules apply sequentially, top to bottom, because real-world identifiers nest. Given a name
# "Foo" and a related org "FooCorp", replacing the short form first turns "FooCorp" into the
# mangled "ReplacementCorp". The table must therefore be ordered longest-match-first, and this
# script preserves that order exactly — it never sorts, dedupes, or parallelizes the rules.
#
# (Illustrative names only. This script is itself a tracked file, so any REAL identifier written
# in these comments would be rewritten by the script's own pass — which is exactly how an earlier
# version ended up asserting that "Client D" is a substring of "Client D".)
#
# SAFETY
#   - Refuses to run on a dirty tree unless --force. Every edit is then a reviewable `git diff`,
#     and `git checkout -- .` is a complete undo. That is the entire safety model — there is no
#     backup copy, because git already is one.
#   - Skips binary files (they cannot be sed-ed safely) and reports them; the scanner audits them.
#   - --dry-run reports per-rule hit counts and changes nothing.
#
# USAGE
#   ./utils/sanitize-apply.sh --table <file> --dry-run     # report only (do this first)
#   ./utils/sanitize-apply.sh --table <file>               # apply
#   ./utils/sanitize-apply.sh --table <file> --force       # apply over a dirty tree
#
# EXIT
#   0 applied (or dry-run completed) · 1 nothing to do · 2 broken invocation / unsafe state
#
set -uo pipefail

readonly GREP=/usr/bin/grep
readonly SED=/usr/bin/sed

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

TABLE=""
DRY=0
FORCE=0

die() { printf '\033[31mFATAL:\033[0m %s\n' "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --table)   TABLE="${2:-}"; [ -n "$TABLE" ] || die "--table needs a file"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --force)   FORCE=1; shift ;;
    -h|--help) $SED -n '3,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)         die "unknown argument: $1" ;;
  esac
done

[ -n "$TABLE" ]  || die "--table is required (the replacement table is private and never defaulted)"
[ -f "$TABLE" ]  || die "table not found: $TABLE"
[ -x "$GREP" ]   || die "$GREP missing — refusing to fall back to a shimmed \`grep\`"
[ -x "$SED" ]    || die "$SED missing"
cd "$REPO_ROOT"  || die "cannot cd to $REPO_ROOT"
[ -d .git ]      || die "$REPO_ROOT is not a git repository"

# A dirty tree destroys the undo story: `git checkout -- .` would also discard unrelated work.
if [ "$DRY" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    die "working tree is dirty. Commit or stash first so this pass is a reviewable diff (or --force)."
  fi
fi

# Ordered rule load. Blank lines and #-comments dropped; ORDER PRESERVED — never sorted.
rules=()
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  printf '%s' "$line" | $GREP -q "$(printf '\t')" || continue
  rules+=("$line")
done < "$TABLE"

rule_count=${#rules[@]}
[ "$rule_count" -gt 0 ] || die "no usable rules in $TABLE"

# NOT `mapfile` — that is bash 4+, and macOS still ships bash 3.2 as /bin/bash. A public repo
# cannot assume a homebrew bash is first on PATH.
files=()
while IFS= read -r f; do
  [ -n "$f" ] && files+=("$f")
done < <(git ls-files)
[ "${#files[@]}" -gt 0 ] || die "no tracked files"

printf '\n\033[1msanitize-apply\033[0m — %s rules over %s tracked files' "$rule_count" "${#files[@]}"
[ "$DRY" -eq 1 ] && printf '  \033[33m(DRY RUN)\033[0m'
printf '\n\n'
printf '  NOTE: counts below are measured against the CURRENT tree, so nested rules overlap\n'
printf '        (a long form is also counted by the later short-form rule that it contains).\n'
printf '        Application is sequential and longest-first, so the result is still correct.\n\n'

# A naive rules x files nested loop is ~100 x 450 = 45,000 grep/sed invocations and takes minutes.
# Instead: count with ONE grep per rule across the whole file list, and apply with ONE combined
# sed script per file. Two orders of magnitude fewer processes, identical semantics — sed applies
# the script's commands in order per line, which is exactly the ordering guarantee we need.
scratch="${TMPDIR:-/tmp}/sanitize-apply.$$"
mkdir -p "$scratch" || die "cannot create scratch dir"
# NO `trap ... EXIT` here, deliberately. An EXIT trap fires when a command-substitution SUBSHELL
# exits, not just the parent — so `hits=$(xargs ... )` below silently deleted the scratch dir
# mid-run, and the final sed then had no file list and no script to work from. It reported
# "945 replacements" and changed nothing. Cleanup is explicit, at the end.

# Text-only file list, NUL-delimited so paths with spaces survive ("GH Repos").
list="${scratch}/files.z"
: > "$list"
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  $GREP -Iq . "$f" 2>/dev/null || continue            # skip binaries
  printf '%s\0' "$f" >> "$list"
done

total_hits=0
sedscript="${scratch}/apply.sed"
: > "$sedscript"

for rule in "${rules[@]}"; do
  from="${rule%%$'\t'*}"
  to="${rule#*$'\t'}"
  [ -n "$from" ] || continue

  hits=$(xargs -0 "$GREP" -o -hE -- "$from" < "$list" 2>/dev/null | wc -l | tr -d ' ')
  hits=${hits:-0}

  # Order preserved: appended in table order, and sed runs its script in order.
  printf 's|%s|%s|g\n' "$from" "$to" >> "$sedscript"

  if [ "$hits" -gt 0 ]; then
    printf '  %-52s %5s  ->  %s\n' "$(printf '%.52s' "$from")" "$hits" "$(printf '%.28s' "$to")"
    total_hits=$((total_hits + hits))
  fi
done

if [ "$DRY" -eq 0 ] && [ "$total_hits" -gt 0 ]; then
  # Assert the inputs still exist. Reporting a replacement count while writing nothing is the
  # single most dangerous way this script can fail — it reads as success.
  [ -s "$list" ]      || die "internal: file list vanished before apply (nothing was written)"
  [ -s "$sedscript" ] || die "internal: sed script vanished before apply (nothing was written)"

  xargs -0 "$SED" -i '' -E -f "$sedscript" < "$list" \
    || die "sed failed during apply — inspect \`git diff\` and \`git checkout -- .\` to undo"

  applied=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  [ "${applied:-0}" -gt 0 ] \
    || die "reported ${total_hits} replacements but changed 0 files — refusing to claim success"
fi

printf '\n  total replacements: \033[1m%s\033[0m\n' "$total_hits"
if [ "$DRY" -eq 1 ]; then
  printf '  dry run — nothing written. Re-run without --dry-run to apply.\n\n'
else
  printf '  files touched: %s\n' "$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
  printf '  review with: git diff   ·   undo with: git checkout -- .\n\n'
fi

rm -rf "$scratch"

[ "$total_hits" -gt 0 ] && exit 0 || exit 1
