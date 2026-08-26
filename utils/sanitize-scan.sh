#!/usr/bin/env bash
#
# sanitize-scan.sh — deterministic sensitive-data scanner for the public-release sanitization pass.
#
#   Tracks: PROJECT/1-INBOX/GH-423-PUBLIC-REPO-CUTOVER.md (Phase 5 secret gate)
#
# WHY THIS EXISTS, AND WHY IT LOOKS PARANOID
# ------------------------------------------
# On this machine `git grep` is intercepted by a shell shim (RTK) and SILENTLY RETURNS ZERO
# RESULTS: it exits 0 and prints nothing. A first sanitization pass using `git grep` reported the
# repo had no IP addresses in it. `/usr/bin/grep` over the identical file set found three live
# production IPs across nine files.
#
# A scanner that reports "clean" when it is broken is worse than no scanner, because it converts
# an unknown risk into a false assurance. So:
#
#   1. Every match is done with an ABSOLUTE path to grep. Never `grep`, `rg`, or `git grep`.
#   2. A canary self-test runs BEFORE any scanning. If grep cannot find a string that is
#      definitely present, the script ABORTS LOUDLY rather than reporting a clean tree.
#   3. The file list comes from `git ls-files -z` + `xargs -0`, so filenames with spaces
#      (this repo lives under "GH Repos") are handled correctly.
#
# SPLIT RULES DESIGN
# ------------------
# Shape rules (token formats, private keys, generic IPs) are generic and ship publicly.
# The literal denylist — real client names, real production IPs, real Slack channel IDs — is
# ITSELF SENSITIVE and must never ship. It lives in a private rules file passed via --rules.
# Without --rules this still catches every credential-shaped leak; with it, name leaks too.
#
# USAGE
#   ./utils/sanitize-scan.sh                        # tracked files, shape rules only
#   ./utils/sanitize-scan.sh --rules <file>         # + private literal denylist
#   ./utils/sanitize-scan.sh --all                  # whole working tree, not just tracked
#   ./utils/sanitize-scan.sh --json                 # machine-readable, for CI
#   ./utils/sanitize-scan.sh --allowlist <file>     # known-good placeholders to ignore
#   ./utils/sanitize-scan.sh --quiet                # findings only, no progress
#
# EXIT CODES
#   0  clean — no findings
#   1  findings present
#   2  scanner is broken (canary failed, bad args, not a git repo) — NEVER read as clean
#
set -uo pipefail

readonly GREP=/usr/bin/grep
readonly SED=/usr/bin/sed
readonly VERSION="1.0.0"

# Resolve the repo root from the script's own location, not $PWD, so the scanner works from any
# CWD and from a differently-named clone. (This is the exact bug /shakedown hunts for.)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

MODE_ALL=0
MODE_JSON=0
MODE_QUIET=0
RULES_FILE=""
ALLOWLIST_FILE=""

die() { printf '\033[31mFATAL:\033[0m %s\n' "$*" >&2; exit 2; }
note() { [ "$MODE_QUIET" -eq 1 ] || [ "$MODE_JSON" -eq 1 ] || printf '  %s\n' "$*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --all)       MODE_ALL=1; shift ;;
    --json)      MODE_JSON=1; shift ;;
    --quiet)     MODE_QUIET=1; shift ;;
    --rules)     RULES_FILE="${2:-}"; [ -n "$RULES_FILE" ] || die "--rules needs a file"; shift 2 ;;
    --allowlist) ALLOWLIST_FILE="${2:-}"; [ -n "$ALLOWLIST_FILE" ] || die "--allowlist needs a file"; shift 2 ;;
    -h|--help)   $SED -n '3,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)           die "unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight — establish the tools actually work before trusting any result
# ---------------------------------------------------------------------------
[ -x "$GREP" ] || die "$GREP is not executable. Refusing to fall back to \`grep\` (it is shimmed on this machine)."
[ -x "$SED" ]  || die "$SED is not executable."
# .git is a DIRECTORY in a normal clone but a FILE in a linked worktree (git worktree add), so
# -d answers no for a valid checkout. rev-parse --git-dir resolves for a main checkout, a linked
# worktree, and a submodule; the fail-closed die is unchanged.
git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "${REPO_ROOT} is not a git repository."
cd "$REPO_ROOT" || die "cannot cd to ${REPO_ROOT}"

# Canary self-test: prove grep finds a string we KNOW is present. This is the guard against the
# silent-zero-results failure that motivated the whole script.
# Scratch dir. Honour $TMPDIR, and fall back through progressively less exotic locations —
# sandboxed shells and hardened CI images routinely deny the system default.
canary_dir=""
for base in "${TMPDIR:-}" /tmp/claude /private/tmp /tmp "${REPO_ROOT}/.sanitize-tmp"; do
  [ -n "$base" ] || continue
  mkdir -p "$base" 2>/dev/null || continue
  candidate="${base%/}/sanitize-scan.$$"
  if mkdir -p "$candidate" 2>/dev/null && [ -w "$candidate" ]; then
    canary_dir="$candidate"; break
  fi
done
[ -n "$canary_dir" ] || die "cannot create a writable scratch dir (tried \$TMPDIR, /tmp/claude, /private/tmp, /tmp, repo-local)"
trap 'rm -rf "$canary_dir"' EXIT
printf 'SLEUTH_CANARY_a1b2c3 and an ip 203.0.113.99\n' > "${canary_dir}/canary.txt"

canary_hits=$($GREP -c "SLEUTH_CANARY_a1b2c3" "${canary_dir}/canary.txt" 2>/dev/null || echo 0)
[ "$canary_hits" = "1" ] || die "CANARY FAILED: ${GREP} did not match a known-present literal. Results cannot be trusted."

canary_re=$($GREP -cE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b" "${canary_dir}/canary.txt" 2>/dev/null || echo 0)
[ "$canary_re" = "1" ] || die "CANARY FAILED: ${GREP} -E did not match a known-present regex. Results cannot be trusted."

# Canary the actual pipeline shape too (git ls-files -z | xargs -0 grep), since that is what runs.
pipe_check=$(printf 'x\n' | xargs -0 echo 2>/dev/null && echo ok)
[ -n "$pipe_check" ] || die "CANARY FAILED: xargs -0 is not usable."

note "canary ok (grep literal + regex + xargs -0)"

# ---------------------------------------------------------------------------
# Build the file list
# ---------------------------------------------------------------------------
filelist="${canary_dir}/files.z"
if [ "$MODE_ALL" -eq 1 ]; then
  find . -type f \
    -not -path './.git/*' -not -path './node_modules/*' -not -path './temp/*' \
    -not -path './scratch/*' -not -path './.xyz/*' -print0 > "$filelist" 2>/dev/null
else
  git ls-files -z > "$filelist" 2>/dev/null || die "git ls-files failed"
fi

file_count=$(tr -cd '\0' < "$filelist" | wc -c | tr -d ' ')
[ "$file_count" -gt 0 ] || die "file list is empty — refusing to report a clean tree from zero files."
note "scanning ${file_count} files ($([ "$MODE_ALL" -eq 1 ] && echo 'working tree' || echo 'tracked'))"

# Sanity floor: this repo has ~550 tracked files. A collapse to a handful means the list is wrong.
if [ "$MODE_ALL" -eq 0 ] && [ "$file_count" -lt 50 ]; then
  die "only ${file_count} tracked files found — suspiciously low. Refusing to report clean."
fi

# ---------------------------------------------------------------------------
# Paths whose matches are noise by construction. Defined HERE, before first use.
# ---------------------------------------------------------------------------
# NOTE: lockfiles are deliberately NOT skipped. They are a primary leak vector — private registry
# URLs, internal scoped package names, and occasionally credentials embedded in `resolved` URLs.
# They are noisy, but lockfile noise is triaged once; a leaked private registry is permanent.
#
# The allowlist file is skipped for a structural reason, not convenience: it is a list of the very
# patterns being searched for, so it matches itself by construction and would report a permanent,
# unfixable finding. Its contents are reviewed as part of reviewing the allowlist.
skip_paths='^node_modules/|^\.git/|^utils/sanitize-allowlist\.txt$'

# ---------------------------------------------------------------------------
# Binary audit — the scanner's structural blind spot
# ---------------------------------------------------------------------------
# Every rule below runs through `grep -I`, which treats binary files as NON-MATCHING. A binary
# therefore cannot ever produce a finding, no matter what it contains — and this repo shipped a
# 5.3 MB SQLite RAG index that was a searchable embedding of the entire codebase. "No findings"
# on a binary means "not examined", never "clean", so we enumerate them for human review instead
# of letting silence imply safety.
#
# PORTABILITY (found 2026-07-27, by the first real CI run on Linux): detection MUST NOT use
# `grep -IL ''`. GNU grep lists a binary as non-matching, so `-L` reports it; BSD grep on macOS
# does not. The result was a platform-dependent gate — macOS printed "0 binary files" and exited
# 0 while Linux found 1 and exited 1, on the same tree. That is exactly the false green this audit
# exists to prevent, hiding inside the audit itself. Detect NUL bytes directly with perl instead:
# same answer on every platform, and it is the actual definition grep is approximating.
binaries="${canary_dir}/binaries.txt"
: > "$binaries"
while IFS= read -r -d '' bf; do
  [ -s "$bf" ] || continue
  printf '%s\n' "$bf"
done < "$filelist" \
  | $GREP -vE "^($skip_paths)" 2>/dev/null \
  | while IFS= read -r bf; do
      if perl -0777 -ne 'exit(/\x00/ ? 0 : 1)' "$bf" 2>/dev/null; then printf '%s\n' "$bf"; fi
    done > "$binaries"

# A source file may legitimately contain NUL — e.g. as a composite-key separator that cannot
# collide with either component. Such files are unscannable by grep and so MUST be reviewed by
# hand and recorded here, with the reviewer and date. An empty/missing file means "none reviewed",
# which correctly keeps the gate closed.
reviewed="${REPO_ROOT}/utils/sanitize-reviewed-binaries.txt"
if [ -f "$reviewed" ]; then
  $GREP -vE '^\s*(#|$)' "$reviewed" 2>/dev/null | sort -u > "${canary_dir}/reviewed.txt" || : > "${canary_dir}/reviewed.txt"
  sort -u "$binaries" > "${canary_dir}/bin-sorted.txt"
  comm -23 "${canary_dir}/bin-sorted.txt" "${canary_dir}/reviewed.txt" > "${canary_dir}/bin-unreviewed.txt"
  reviewed_count=$(comm -12 "${canary_dir}/bin-sorted.txt" "${canary_dir}/reviewed.txt" | wc -l | tr -d ' ')
  mv "${canary_dir}/bin-unreviewed.txt" "$binaries"
  [ "$reviewed_count" -gt 0 ] && note "binary files accepted by hand review: ${reviewed_count} (see utils/sanitize-reviewed-binaries.txt)"
fi

binary_count=$(wc -l < "$binaries" | tr -d ' ')
note "binary/unreadable files needing manual review: ${binary_count}"

# ---------------------------------------------------------------------------
# Rules. Format: CLASS<TAB>SEVERITY<TAB>ERE
# ---------------------------------------------------------------------------
rules="${canary_dir}/rules.tsv"
{
  # --- credential shapes (high confidence, near-zero false positives) ---
  printf 'slack-bot-token\tCRITICAL\txoxb-[0-9]{8,}-[0-9]{8,}-[A-Za-z0-9]{16,}\n'
  printf 'slack-app-token\tCRITICAL\txapp-[0-9]-[A-Z0-9]{8,}-[0-9]{8,}-[a-f0-9]{32,}\n'
  printf 'slack-user-token\tCRITICAL\txoxp-[0-9]{8,}-[0-9]{8,}\n'
  # Requires a 24+ char unbroken alphanumeric run. Hyphenated slugs that merely start with "sk-"
  # (e.g. a branch name like sk-reminders-to-the-primitive-shipped) have no such run and are
  # correctly ignored; real OpenAI keys always do.
  printf 'openai-key\tCRITICAL\tsk-([A-Za-z0-9_-]*-)?[A-Za-z0-9_]{24,}\n'
  printf 'github-pat\tCRITICAL\t(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\n'
  printf 'github-fine-grained-pat\tCRITICAL\tgithub_pat_[A-Za-z0-9_]{30,}\n'
  printf 'google-api-key\tCRITICAL\tAIza[0-9A-Za-z_-]{35}\n'
  printf 'aws-access-key\tCRITICAL\t(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\n'
  # --- added after a real miss (2026-07-26) ---
  # A New Relic license key sat hardcoded as a fallback in newrelic.js and this scanner did not
  # see it, because no rule described its shape. That is the standing lesson of a denylist: it
  # only finds what someone thought to describe. Every provider added here came from that miss.
  printf 'newrelic-license-key\tCRITICAL\t[0-9a-f]{32}[A-Z]{4}NRAL\n'
  printf 'newrelic-user-key\tCRITICAL\tNRAK-[A-Z0-9]{27}\n'
  printf 'anthropic-key\tCRITICAL\tsk-ant-[A-Za-z0-9_-]{20,}\n'
  printf 'stripe-key\tCRITICAL\t(sk|rk|pk)_(live|test)_[A-Za-z0-9]{20,}\n'
  printf 'sendgrid-key\tCRITICAL\tSG\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\n'
  printf 'twilio-sid\tHIGH\tAC[a-f0-9]{32}\n'
  printf 'npm-token\tCRITICAL\tnpm_[A-Za-z0-9]{36}\n'
  printf 'slack-webhook-url\tCRITICAL\thooks\\.slack\\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+\n'
  printf 'jwt\tHIGH\teyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\n'
  printf 'basic-auth-url\tCRITICAL\t[a-z][a-z0-9+.-]*://[^/:@[:space:]]+:[^/@[:space:]]+@[A-Za-z0-9.-]+\n'
  printf 'private-key-block\tCRITICAL\t-----BEGIN [A-Z ]*PRIVATE KEY-----\n'
  printf 'ssh-public-key\tHIGH\tssh-(rsa|ed25519|dss) AAAA[0-9A-Za-z+/]{20,}\n'
  printf 'signing-secret\tCRITICAL\t(SIGNING_SECRET|signing_secret)"?[:= ]+"?[a-f0-9]{32}\n'
  printf 'bearer-literal\tHIGH\t[Bb]earer (test|admin|secret|password)\n'
  # Broad character class + a 16-char floor: short DB passwords and ones containing punctuation
  # were invisible to the original [A-Za-z0-9/+_-]{24,} form.
  printf 'generic-assigned-secret\tMEDIUM\t(password|passwd|pwd|secret|api_key|apikey|token|auth)"?[:= ]+"?[A-Za-z0-9/+_!@#$%%^&*.,?~-]{16,}"?\n'

  # --- infrastructure ---
  # Public-IP heuristic: excludes 10./127./192.168./172.16-31./0./255. and TEST-NET-3 203.0.113.
  printf 'public-ip\tHIGH\t\\b(([0-9]{1,3}\\.){3}[0-9]{1,3})\\b\n'
  printf 'internal-hostname\tMEDIUM\t\\b[a-z0-9-]+\\.(local|internal|lan|home|corp)\\b\n'
  printf 'absolute-local-path\tMEDIUM\t/Users/[a-z0-9._-]+/\n'
  printf 'absolute-home-path\tLOW\t/home/[a-z0-9._-]+/\n'

  # --- identity ---
  # C0 = public channel, G0 = private group, D0 = DM. Private/DM ids are MORE sensitive than
  # public ones, and the original C0-only form missed both entirely.
  printf 'slack-channel-id\tHIGH\t\\b[CGD]0[A-Z0-9]{8,11}\\b\n'
  printf 'slack-user-id\tHIGH\t\\bU0[A-Z0-9]{8,11}\\b\n'
  printf 'slack-team-id\tMEDIUM\t\\bT0[A-Z0-9]{8,11}\\b\n'
  printf 'slack-list-id\tMEDIUM\t\\bF0[A-Z0-9]{8,11}\\b\n'
  printf 'email\tMEDIUM\t[A-Za-z0-9._%%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\n'
} > "$rules"

# Merge the private literal denylist (real names/IPs/IDs) if supplied.
if [ -n "$RULES_FILE" ]; then
  [ -f "$RULES_FILE" ] || die "rules file not found: $RULES_FILE"
  # Strip comments and blank lines; expect the same CLASS<TAB>SEVERITY<TAB>ERE format.
  $GREP -vE '^\s*(#|$)' "$RULES_FILE" >> "$rules" 2>/dev/null
  note "merged private rules from ${RULES_FILE}"
else
  note "no --rules given: shape rules only (client-name leaks will NOT be detected)"
fi

rule_count=$(wc -l < "$rules" | tr -d ' ')
note "active rules: ${rule_count}"

# ---------------------------------------------------------------------------
# Allowlist — known-good placeholders that must not raise findings
# ---------------------------------------------------------------------------
# ⚠️ EVERY PATTERN HERE MUST DESCRIBE THE **ENTIRE** MATCHED TOKEN, because the filter below
# anchors with ^(...)$. That anchoring is a security fix, not a style choice: with substring
# matching, an allowlist entry of `xxx+` silently DROPPED the real finding
# `xoxb-1234567890-9876543210-xxxSECRETxxx` — a live token containing "xxx". Reproduced 2026-07-26.
# A too-narrow entry here costs a false positive (noise, safe). A too-broad one costs a leak.
allow="${canary_dir}/allow.txt"
{
  # -- placeholder emails (full address, not just the domain) --
  printf '[A-Za-z0-9._%%+-]+@(example|test|invalid)\\.(com|org|net|test)\n'
  printf '[A-Za-z0-9._%%+-]+@(yourcompany|acme|domain|yourdomain)\\.(com|test|local)\n'
  printf '(your|my|some)[.-]?(email|name|token|user)@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\n'
  # -- obvious placeholder credentials --
  printf '(xoxb|xoxp|xapp|sk|sk-proj|ghp|github_pat)-?[_-]?YOUR[A-Za-z0-9_-]*\n'
  printf '[A-Za-z0-9_-]*(YOUR|PLACEHOLDER|REDACTED|EXAMPLE|CHANGEME|FIXME)[A-Za-z0-9_-]*\n'
  printf '[A-Za-z0-9_-]*(your|placeholder|redacted|example|changeme)[a-z0-9_-]*\n'
  printf 'x{3,}\n'                                 # a token that is ONLY x's, e.g. "xxxx"
  printf '[A-Za-z0-9_-]*x{6,}[A-Za-z0-9_-]*\n'     # long x-runs = a masked placeholder
  # -- non-routable / reserved IPs (RFC 5737 doc ranges + RFC 1918 private + loopback) --
  printf '127\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\n'
  printf '0\\.0\\.0\\.0\n'
  printf '255\\.255\\.255\\.(255|0)\n'
  printf '203\\.0\\.113\\.[0-9]{1,3}\n'            # TEST-NET-3 — our redaction target
  printf '198\\.51\\.100\\.[0-9]{1,3}\n'           # TEST-NET-2
  printf '192\\.0\\.2\\.[0-9]{1,3}\n'              # TEST-NET-1
  printf '10\\.([0-9]{1,3}\\.){2}[0-9]{1,3}\n'
  printf '192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}\n'
  printf '172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]{1,3}\\.[0-9]{1,3}\n'
  printf '169\\.254\\.[0-9]{1,3}\\.[0-9]{1,3}\n'   # link-local
  printf '(0|[0-9]{1,3})\\.0\\.0\\.(0|1)\n'
  # -- placeholder Slack identifiers --
  printf '[CGDUFT]0*(EXAMPLE|XXXXX)[A-Z0-9]*\n'
  printf 'Col0*(EXAMPLE|XXXXX)[A-Z0-9]*\n'
  printf 'U0(ALICE|BOB|1234567890|123456789)[A-Z0-9]*\n'
  printf '[CGDUFT]0{6,}[0-9]*\n'                   # all-zero ids
} > "$allow"
if [ -n "$ALLOWLIST_FILE" ]; then
  [ -f "$ALLOWLIST_FILE" ] || die "allowlist not found: $ALLOWLIST_FILE"
  $GREP -vE '^\s*(#|$)' "$ALLOWLIST_FILE" >> "$allow" 2>/dev/null
fi

# (skip_paths is defined earlier, above the binary audit that first uses it.)

# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------
raw="${canary_dir}/raw.txt"
: > "$raw"

while IFS=$'\t' read -r class severity pattern; do
  [ -n "${class:-}" ] || continue
  # -I skips binaries, -n line numbers, -o just the match, -H force filename, -E for ERE.
  # grep emits "file:line:match"; the match itself may contain colons, so rejoin from field 3 on.
  xargs -0 "$GREP" -I -n -o -E -H -e "$pattern" < "$filelist" 2>/dev/null \
    | awk -F: -v cls="$class" -v sev="$severity" -v skip="$skip_paths" '
        BEGIN { OFS = "\t" }
        NF >= 3 {
          file = $1; line = $2
          m = $3; for (i = 4; i <= NF; i++) m = m ":" $i
          if (file ~ skip) next
          print cls, sev, file, line, m
        }' >> "$raw"
done < "$rules"

# Drop allowlisted matches. Two properties matter here, both of them security-relevant:
#
#   1. The allowlist is tested against the MATCHED TEXT ONLY (field 5), never the whole line —
#      otherwise a file path containing "example" would suppress every real finding inside it.
#   2. The match is ANCHORED with ^(...)$ — the allowlist entry must describe the WHOLE token.
#      Unanchored, an entry like `xxx+` drops any real secret that merely CONTAINS "xxx".
#      Verified: `xoxb-1234567890-9876543210-xxxSECRETxxx` was silently swallowed before this fix.
findings="${canary_dir}/findings.txt"
if [ -s "$raw" ]; then
  awk -F'\t' '
    NR == FNR { pat[++n] = $0; next }
    {
      for (i = 1; i <= n; i++) if ($5 ~ ("^(" pat[i] ")$")) next
      print
    }' "$allow" "$raw" > "$findings" 2>/dev/null || : > "$findings"
else
  : > "$findings"
fi

total=$(wc -l < "$findings" | tr -d ' ')

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [ "$MODE_JSON" -eq 1 ]; then
  awk -F'\t' -v ver="$VERSION" -v fc="$file_count" -v rc="$rule_count" -v tot="$total" '
    { cnt[$1]++; sev[$1] = $2 }
    END {
      printf "{\"version\":\"%s\",\"files_scanned\":%s,\"rules\":%s,\"findings\":%s,\"by_class\":{", ver, fc, rc, tot
      first = 1
      for (c in cnt) {
        if (!first) printf ","
        first = 0
        printf "\"%s\":{\"count\":%d,\"severity\":\"%s\"}", c, cnt[c], sev[c]
      }
      printf "}}\n"
    }' "$findings"
else
  printf '\n\033[1msanitize-scan v%s\033[0m — %s files, %s rules\n' "$VERSION" "$file_count" "$rule_count"
  if [ "$total" -eq 0 ]; then
    printf '\033[32m✓ CLEAN\033[0m — no findings\n\n'
  else
    printf '\033[31m✗ %s findings\033[0m\n\n' "$total"
    printf '  %-30s %-9s %s\n' "CLASS" "SEVERITY" "COUNT"
    printf '  %-30s %-9s %s\n' "------------------------------" "---------" "-----"
    awk -F'\t' '
      { cnt[$1]++; sev[$1] = $2 }
      END {
        order["CRITICAL"] = 1; order["HIGH"] = 2; order["MEDIUM"] = 3; order["LOW"] = 4
        for (c in cnt) printf "%d\t%s\t%s\t%d\n", order[sev[c]] ? order[sev[c]] : 9, sev[c], c, cnt[c]
      }' "$findings" | sort -t"$(printf '\t')" -k1,1n -k4,4nr \
      | awk -F'\t' '{ printf "  %-30s %-9s %s\n", $3, $2, $4 }'

    printf '\n  \033[1mTop files:\033[0m\n'
    awk -F'\t' '{ cnt[$3]++ } END { for (f in cnt) printf "%d\t%s\n", cnt[f], f }' "$findings" \
      | sort -rn | head -15 | awk -F'\t' '{ printf "  %5s  %s\n", $1, $2 }'

    cp "$findings" "${REPO_ROOT}/.sanitize-findings.tsv" 2>/dev/null || true
    printf '\n  Full detail: %s\n\n' "${REPO_ROOT}/.sanitize-findings.tsv"
  fi

  # Binaries are reported separately and ALWAYS, including on an otherwise-clean run — they are
  # unexamined, not cleared, and a "✓ CLEAN" line above them would be actively misleading.
  if [ "$binary_count" -gt 0 ]; then
    printf '  \033[33m⚠ %s binary file(s) — NOT scanned (grep -I skips them). Review by hand:\033[0m\n' "$binary_count"
    while IFS= read -r bf; do
      printf '     %8s  %s\n' "$(wc -c < "$bf" 2>/dev/null | tr -d ' ')" "$bf"
    done < "$binaries"
    printf '\n'
  fi
fi

# Exit 1 if there are textual findings OR unreviewed binaries. A binary in the tree is an
# open question, and the gate should not go green on an open question.
if [ "$total" -eq 0 ] && [ "$binary_count" -eq 0 ]; then exit 0; else exit 1; fi
