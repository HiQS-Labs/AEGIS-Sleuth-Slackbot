#!/bin/bash
# Read a Slack thread (or a single message) from a permalink, using the running Sleuth bot's own
# token ON THE SERVER. The token is never copied off the host: a small read-only Node script is
# piped over SSH stdin, reads the workspace file the live process uses, calls Slack, and prints
# the messages. Only conversations.replies and users.info are ever called.
#
# Usage:
#   skills/read-slack/read-slack.sh '<slack permalink>' (--env-file <path> | --host <host>) \
#       [--user-ssh root] [--sudo] [--workspace <name>] [--json]
set -euo pipefail

URL=""
# No hardcoded host or secrets path: this is a public repo. The host comes from --host /
# SLEUTH_SSH_HOST, or from an operator-held env file (--env-file / SLEUTH_SSH_ENV_FILE) carrying
# SLEUTH_<PROFILE>_HOST/_USER/_PASS — the same file format skills/download/ reads.
SSH_HOST="${SLEUTH_SSH_HOST:-}"
SSH_USER="${SLEUTH_SSH_USER:-root}"
SSH_ENV_FILE="${SLEUTH_SSH_ENV_FILE:-}"
# --sudo for a non-root login (e.g. a dev host reached as an unprivileged user): the live
# process's environ and the data dir are root-only.
USE_SUDO=0
WORKSPACE="${SLEUTH_WORKSPACE:-}"
OUTPUT="text"

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) SSH_ENV_FILE="$2"; shift 2 ;;
    --sudo) USE_SUDO=1; shift ;;
    --host) SSH_HOST="$2"; shift 2 ;;
    --user-ssh) SSH_USER="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --json) OUTPUT="json"; shift ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    -*) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
    *) URL="$1"; shift ;;
  esac
done

[ -n "$URL" ] || { echo "ERROR: pass a Slack permalink (https://<team>.slack.com/archives/<channel>/p<ts>...)" >&2; exit 1; }

# Parse the permalink: team subdomain, channel, message ts, optional thread_ts.
if [[ ! "$URL" =~ ^https://([a-z0-9-]+)\.slack\.com/archives/([A-Z0-9]+)/p([0-9]{10})([0-9]{6}) ]]; then
  echo "ERROR: not a Slack message permalink: $URL" >&2; exit 1
fi
TEAM="${BASH_REMATCH[1]}"
CHANNEL="${BASH_REMATCH[2]}"
MESSAGE_TS="${BASH_REMATCH[3]}.${BASH_REMATCH[4]}"
THREAD_TS=""
if [[ "$URL" =~ [\?\&]thread_ts=([0-9]+\.[0-9]+) ]]; then THREAD_TS="${BASH_REMATCH[1]}"; fi
# A reply's permalink carries thread_ts; read the whole thread. A parent's permalink does not;
# conversations.replies on its own ts returns the thread (or just the message if it has none).
ROOT_TS="${THREAD_TS:-$MESSAGE_TS}"
# The workspace file is named after the Sleuth workspace, which matches the Slack subdomain for
# every install so far. --workspace overrides when it does not.
WORKSPACE="${WORKSPACE:-$TEAM}"
# It is interpolated into the remote command line, so hold it to a plain name.
[[ "$WORKSPACE" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "ERROR: invalid workspace name: $WORKSPACE" >&2; exit 1; }

SSH_PASS=""
if [ -n "$SSH_ENV_FILE" ]; then
  [ -r "$SSH_ENV_FILE" ] || { echo "ERROR: cannot read $SSH_ENV_FILE" >&2; exit 1; }
  # Read values without sourcing the file, so nothing in it can execute. The profile segment
  # (PROD, DEV, ...) is whatever the file uses; the first _HOST/_USER/_PASS line wins.
  ReadVar() { sed -n -E "s/^SLEUTH_[A-Z]+_$1=//p" "$SSH_ENV_FILE" | head -1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
  [ -n "$SSH_HOST" ] || SSH_HOST="$(ReadVar HOST)"
  FILE_USER="$(ReadVar USER)"; [ -n "$FILE_USER" ] && SSH_USER="$FILE_USER"
  SSH_PASS="$(ReadVar PASS)"
  command -v sshpass >/dev/null 2>&1 || { echo "ERROR: sshpass not installed (brew install hudochenkov/sshpass/sshpass)" >&2; exit 1; }
fi
[ -n "$SSH_HOST" ] || { echo "ERROR: no host. Pass --env-file <path> or --host <host> (see temp/SOP.md)." >&2; exit 1; }

REMOTE_SCRIPT_FILE="$(mktemp "${TMPDIR:-/tmp}/sleuth-read-slack.XXXXXX.js")"
trap 'rm -f "$REMOTE_SCRIPT_FILE"' EXIT
cat > "$REMOTE_SCRIPT_FILE" <<'REMOTE_SCRIPT'
// Runs on the Sleuth host under its own Node. Read-only: two Slack methods, nothing written.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const [Workspace, Channel, RootTs, Output] = process.argv.slice(2);

function DataDir() {
  const Pid = execSync('systemctl show sleuth-app -p MainPID --value').toString().trim();
  const Env = fs.readFileSync(`/proc/${Pid}/environ`).toString().split('\0');
  const Hit = Env.find(L => L.startsWith('SLEUTH_DATA_DIR='));
  if(!Hit) throw new Error('SLEUTH_DATA_DIR not set on the live sleuth-app process');
  return Hit.slice('SLEUTH_DATA_DIR='.length);
}

async function Slack(Token, Method, Params) {
  if(!['conversations.replies', 'users.info'].includes(Method)) throw new Error(`method not allowed: ${Method}`);
  const Res = await fetch(`https://slack.com/api/${Method}?${new URLSearchParams(Params)}`, {
    headers: { Authorization: `Bearer ${Token}` }
  });
  const Body = await Res.json();
  if(!Body.ok) throw new Error(`${Method}: ${Body.error}`);
  return Body;
}

(async () => {
  const WsDir = path.join(DataDir(), 'workspaces');
  const WsFile = path.join(WsDir, `${Workspace}_workspace.json`);
  if(!fs.existsSync(WsFile)) {
    const Names = fs.readdirSync(WsDir).filter(F => F.endsWith('_workspace.json')).map(F => F.replace(/_workspace\.json$/, ''));
    throw new Error(`no workspace "${Workspace}". Available: ${Names.join(', ')} (use --workspace)`);
  }
  const Info = JSON.parse(fs.readFileSync(WsFile, 'utf8'));
  const Token = Info.LIVE_TOKEN;
  const Tz = Info.MAIN_TIMEZONE || 'UTC';

  const Messages = [];
  let Cursor;
  do {
    const Page = await Slack(Token, 'conversations.replies', { channel: Channel, ts: RootTs, limit: '200', ...(Cursor ? { cursor: Cursor } : {}) });
    Messages.push(...Page.messages);
    Cursor = Page.response_metadata?.next_cursor;
  } while(Cursor);

  const Names = {};
  for(const Id of new Set(Messages.map(M => M.user).filter(Boolean))) {
    try {
      const U = (await Slack(Token, 'users.info', { user: Id })).user;
      Names[Id] = U.profile?.display_name || U.real_name || U.name || Id;
    } catch { Names[Id] = Id; }
  }
  const Who = M => M.user ? Names[M.user] : (M.bot_profile?.name || M.username || 'bot');
  const Text = T => (T || '').replace(/<@([UW][A-Z0-9]+)>/g, (_, Id) => `@${Names[Id] || Id}`);

  if(Output === 'json') {
    console.log(JSON.stringify({ workspace: Workspace, channel: Channel, timezone: Tz, users: Names, messages: Messages }, null, 2));
    return;
  }
  const Fmt = new Intl.DateTimeFormat('en-US', { timeZone: Tz, dateStyle: 'medium', timeStyle: 'short' });
  for(const M of Messages) {
    console.log(`--- ${Fmt.format(new Date(parseFloat(M.ts) * 1000))} ${Tz} · ${Who(M)} · ts=${M.ts}`);
    console.log(Text(M.text));
    if(M.files?.length) console.log(`[files: ${M.files.map(F => F.name).join(', ')}]`);
    console.log('');
  }
})().catch(E => { console.error(`ERROR: ${E.message}`); process.exit(1); });
REMOTE_SCRIPT

REMOTE_CMD="node - '$WORKSPACE' '$CHANNEL' '$ROOT_TS' '$OUTPUT'"
[ "$USE_SUDO" = 1 ] && REMOTE_CMD="sudo -n $REMOTE_CMD"
if [ -n "$SSH_PASS" ]; then
  # -e reads the password from $SSHPASS, so it never shows up in `ps`.
  SSHPASS="$SSH_PASS" sshpass -e ssh -q -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST" "$REMOTE_CMD" < "$REMOTE_SCRIPT_FILE"
else
  ssh -q -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST" "$REMOTE_CMD" < "$REMOTE_SCRIPT_FILE"
fi
