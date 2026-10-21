# GH-249 leak check — runs on the server. Never prints the token; the pattern reaches grep via a pipe.
set -u
DIR=/root/git-pulse-sync
ENV_FILE="$(systemctl show sleuth-app -p WorkingDirectory --value)/.env.runtime"
PAT="$(sed -n 's/^SLEUTH_RAG_GITHUB_PAT=//p' "$ENV_FILE" | tail -1 | tr -d '\r')"
[ -n "$PAT" ] || { echo "no PAT"; exit 1; }
has_token() { grep -qF -f <(printf '%s\n' "$PAT"); }
check() { if has_token; then echo "FAIL $1"; else echo "PASS $1"; fi; }

T=$(mktemp); printf 'x %s y\n' "$PAT" > "$T"; check "positive-control(expect FAIL)" < "$T"; rm -f "$T"
check ".git/config" < "$DIR/.git/config"
git -C "$DIR" remote -v | check "remote -v"
journalctl -u sleuth-git-pulse-mirror.service --no-pager -o cat | check "journal"

# Sample every process's argv while a forced fetch runs.
S=$(mktemp)
systemctl start sleuth-git-pulse-mirror.service --no-block
for _ in $(seq 1 100); do ps -eo args >> "$S"; sleep 0.1; done
check "ps argv during fetch ($(grep -c 'git' "$S") git lines sampled)" < "$S"
rm -f "$S"
