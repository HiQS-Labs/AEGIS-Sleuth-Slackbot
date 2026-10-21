# GH-249 install + smoke on production. Usage: bash smoke.sh <owner/name>   (run from the copied dir)
set -u
REPO="$1"; SRC="$(pwd)"; DIR=/root/git-pulse-sync; SVC=sleuth-git-pulse-mirror
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
expect_fail() { local name="$1"; shift; if out=$("$@" 2>&1); then bad "$name (exited 0)"; else ok "$name -> $(echo "$out" | tail -1)"; fi; }

echo "== static"
bash -n sync-git-pulse-mirror.sh install.sh && ok "bash -n"
systemd-analyze verify "$SRC/$SVC.service" "$SRC/$SVC.timer" 2>&1 | grep -v 'ExecStart.*No such file' || true
[ -e "$DIR" ] && { echo "ABORT: $DIR already exists"; exit 1; }

echo "== red controls (pre-install, no network reached)"
T=$(mktemp); echo 'SLEUTH_RAG_GITHUB_PAT=' > "$T"
expect_fail "missing runtime env" env SLEUTH_GIT_PULSE_REPO="$REPO" SLEUTH_GIT_PULSE_DIR=/tmp/gh249-red SLEUTH_ENV_FILE=/nonexistent bash sync-git-pulse-mirror.sh
expect_fail "empty PAT" env SLEUTH_GIT_PULSE_REPO="$REPO" SLEUTH_GIT_PULSE_DIR=/tmp/gh249-red SLEUTH_ENV_FILE="$T" bash sync-git-pulse-mirror.sh
expect_fail "missing repo var" env -u SLEUTH_GIT_PULSE_REPO bash sync-git-pulse-mirror.sh
rm -f "$T"; [ -e /tmp/gh249-red ] && bad "red controls created a dir" || ok "red controls touched nothing"

echo "== install (main path)"
bash install.sh "$REPO" | sed -E 's#(SLEUTH_GIT_PULSE_REPO=).*#\1<redacted>#'
cd /
SLEUTH_RAG_GITHUB_PAT="$(sed -n 's/^SLEUTH_RAG_GITHUB_PAT=//p' "$(systemctl show sleuth-app -p WorkingDirectory --value)/.env.runtime" | tail -1 | tr -d '\r')"; export SLEUTH_RAG_GITHUB_PAT
H=$(git -C "$DIR" rev-parse HEAD)
R=$(git -c credential.helper= -c 'credential.helper=!f() { echo username=x-access-token; echo "password=${SLEUTH_RAG_GITHUB_PAT}"; }; f' -C "$DIR" ls-remote origin refs/heads/main | cut -f1)
[ ${#R} -eq 40 ] || bad "authenticated ls-remote returned no SHA"
[ "$H" = "$R" ] && ok "HEAD == remote main (${H:0:12})" || bad "HEAD $H != remote $R"
[ "$(git -C "$DIR" symbolic-ref --short HEAD)" = main ] && ok "on main" || bad "not on main"
[ -z "$(git -C "$DIR" status --porcelain)" ] && ok "clean" || bad "dirty"
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$DIR/sync/sleuth/reminders-neochrome.json" && ok "reminders JSON parses"
[ "$(systemctl is-enabled $SVC.timer)" = enabled ] && ok "timer enabled"
systemctl list-timers $SVC.timer --no-pager | sed -n 2p
systemctl show $SVC.service -p Result -p ExecMainStatus --value | tr '\n' ' '; echo
stat -c 'FETCH_HEAD/clone age: %y' "$DIR/.git/FETCH_HEAD" 2>/dev/null || stat -c 'clone at: %y' "$DIR/.git/HEAD"

echo "== consumer (real reader)"
APP=$(systemctl show sleuth-app -p WorkingDirectory --value)
if [ -f "$APP/skills/talk-to-reminders/query-reminders.mjs" ]; then
  SLEUTH_MIRROR_DIR=$DIR/sync/sleuth node "$APP/skills/talk-to-reminders/query-reminders.mjs" --json --limit 1 >/tmp/gh249-q.json 2>/tmp/gh249-q.err \
    && ok "query-reminders exit 0 ($(wc -c </tmp/gh249-q.json) bytes)" || bad "query-reminders: $(tail -1 /tmp/gh249-q.err)"
  rm -f /tmp/gh249-q.json /tmp/gh249-q.err
else echo "SKIP reader not in live tree $APP"; fi

echo "== adjacent: idempotent rerun"
sums() { sha256sum /etc/systemd/system/$SVC.service /etc/systemd/system/$SVC.timer /etc/default/$SVC /root/sleuth-git-pulse-mirror/sync-git-pulse-mirror.sh | cut -d' ' -f1 | tr '\n' ' '; }
A=$(sums); (cd "$SRC" && bash install.sh >/dev/null); B=$(sums)
[ "$A" = "$B" ] && ok "rerun install (no arg) left units/config/script byte-identical" || bad "rerun changed files"
[ "$(git -C "$DIR" rev-parse HEAD)" = "$H" ] && ok "rerun sync: HEAD unchanged" || echo "INFO HEAD moved (upstream commit landed)"

echo "== adjacent: reset control"
F=$DIR/README.md; [ -f "$F" ] || F=$(git -C "$DIR" ls-files | head -1 | sed "s#^#$DIR/#")
S0=$(sha256sum "$F" | cut -d' ' -f1); echo "gh249-dirty" >> "$F"
[ -n "$(git -C "$DIR" status --porcelain)" ] && ok "dirty before" || bad "edit not dirty"
systemctl start $SVC.service
[ -z "$(git -C "$DIR" status --porcelain)" ] && ok "clean after run" || bad "still dirty"
[ "$(sha256sum "$F" | cut -d' ' -f1)" = "$S0" ] && ok "original bytes restored" || bad "bytes differ"

echo "== red control: missing /etc/default config"
mv /etc/default/$SVC /etc/default/$SVC.gh249bak
systemctl start $SVC.service 2>/dev/null && bad "service ran without config" || ok "service fails without config ($(systemctl show $SVC.service -p Result --value))"
mv /etc/default/$SVC.gh249bak /etc/default/$SVC
systemctl reset-failed $SVC.service; systemctl start $SVC.service && ok "service recovers with config restored"
