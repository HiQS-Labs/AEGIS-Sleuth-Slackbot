#!/bin/bash
# Fetch the caller's active, assigned Sleuth reminders live from the production server
# via SSH, and write the filtered result to temp/my_reminders.json.
#
# Deliberately does NOT read the git-pulse-sync local mirror
# ($HOME/git-pulse-sync/sync/sleuth/reminders-*.json) — this script exists for callers who
# want a live server-side read instead of that ~5-15-min-old snapshot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$SCRIPT_DIR"
# GH-154 codex QA (round 2): REPO_ROOT is only needed to build a DEFAULT --out path. Resolving
# it unconditionally meant a fully-parameterized, non-repo invocation (--out ... plus a literal
# --user SlackID, bypassing users.local.json) could never run even though nothing it touches
# actually needs a git checkout. Resolution is deferred below, after arg parsing, and only
# attempted if --out was not given.

# GH-154 #7: SLEUTH_USERS_FILE lets a caller point at a users.local.json living somewhere
# other than this skill's own directory (e.g. a copied, non-symlinked install).
USERS_FILE="${SLEUTH_USERS_FILE:-$SKILL_DIR/users.local.json}"

WORKSPACE="${SLEUTH_WORKSPACE:-neochrome}"
SSH_HOST="${SLEUTH_SSH_HOST:-64.176.223.93}"
SSH_USER="${SLEUTH_SSH_USER:-root}"
MY_USER="${SLEUTH_MY_SLACK_ID:-}"
OUT_PATH=""
# --env selects password auth from a LOCAL, never-committed secrets file
# ($HOME/secrets/sleuth/vultr-sleuth-<development|production>.env, same convention temp/SOP.md
# already documents for the dev host). Nothing from that file is ever written into this repo or
# copied to the remote host — it's read once, held in memory for this process, and used to
# authenticate. Omit --env to keep the original key-auth (BatchMode) behavior.
SSH_ENV_PROFILE="${SLEUTH_SSH_ENV:-}"
SSH_ENV_FILE="${SLEUTH_SSH_ENV_FILE:-}"
# GH-154 #4: --via api reads the same data through the app's own authenticated Web API
# (GET /workspace/:name/reminders?format=rebalance&activeOnly=true) instead of root SSH +
# /proc + a hand-copy of the app's active-state logic. Recommended when a web-api secrets
# file is available; --via ssh keeps the original path. Default stays ssh for backward
# compatibility with the documented --env workflow.
VIA="${SLEUTH_VIA:-ssh}"
API_PROFILE="${SLEUTH_WEB_API_PROFILE:-production}"
API_ENV_FILE="${SLEUTH_WEB_API_ENV_FILE:-}"
# GH-154 codex QA (round 2): off by default — see the --via api block below for why.
API_ALLOW_DIRECT="${SLEUTH_API_ALLOW_DIRECT:-0}"
OUT_EXPLICIT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --user) MY_USER="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; WORKSPACE_EXPLICIT=1; shift 2 ;;
    --host) SSH_HOST="$2"; shift 2 ;;
    --user-ssh) SSH_USER="$2"; shift 2 ;;
    --out) OUT_PATH="$2"; OUT_EXPLICIT=1; shift 2 ;;
    --env) SSH_ENV_PROFILE="$2"; shift 2 ;;
    --env-file) SSH_ENV_FILE="$2"; shift 2 ;;
    --via) VIA="$2"; shift 2 ;;
    --api-profile) API_PROFILE="$2"; shift 2 ;;
    --api-env-file) API_ENV_FILE="$2"; shift 2 ;;
    --api-allow-direct) API_ALLOW_DIRECT=1; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$VIA" != "ssh" ] && [ "$VIA" != "api" ]; then
  echo "ERROR: --via must be 'ssh' or 'api' (got '$VIA')" >&2
  exit 1
fi

if [ -z "$OUT_EXPLICIT" ]; then
  REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$REPO_ROOT" ]; then
    echo "ERROR: could not resolve repo root from $SCRIPT_DIR (not inside a git repo?) — pass --out <path> to run outside a checkout." >&2
    exit 1
  fi
  OUT_PATH="$REPO_ROOT/temp/my_reminders.json"
fi

# Resolve password-auth inputs from the local secrets file, if requested. We deliberately do
# NOT `source` this file (it's a credentials file, not code we should execute) — pull out only
# the three keys we need with `sed`, so a syntax error or stray line in it can't run as shell.
SSH_PASS=""
if [ "$VIA" = "ssh" ] && { [ -n "$SSH_ENV_PROFILE" ] || [ -n "$SSH_ENV_FILE" ]; }; then
  case "$SSH_ENV_PROFILE" in
    prod|production|"") VAR_PREFIX="SLEUTH_PROD"; DEFAULT_ENV_FILE="$HOME/secrets/sleuth/vultr-sleuth-production.env" ;;
    dev|development) VAR_PREFIX="SLEUTH_DEV"; DEFAULT_ENV_FILE="$HOME/secrets/sleuth/vultr-sleuth-development.env" ;;
    *) echo "ERROR: --env must be 'prod' or 'dev' (got '$SSH_ENV_PROFILE')" >&2; exit 1 ;;
  esac
  SSH_ENV_FILE="${SSH_ENV_FILE:-$DEFAULT_ENV_FILE}"
  if [ ! -f "$SSH_ENV_FILE" ]; then
    echo "ERROR: SSH env file not found: $SSH_ENV_FILE (this is a client-machine-local secret, never part of the repo)" >&2
    exit 1
  fi
  ENV_HOST="$(sed -n "s/^${VAR_PREFIX}_HOST=//p" "$SSH_ENV_FILE" | tail -1)"
  ENV_USER="$(sed -n "s/^${VAR_PREFIX}_USER=//p" "$SSH_ENV_FILE" | tail -1)"
  SSH_PASS="$(sed -n "s/^${VAR_PREFIX}_PASS=//p" "$SSH_ENV_FILE" | tail -1)"
  [ -n "$ENV_HOST" ] && SSH_HOST="$ENV_HOST"
  [ -n "$ENV_USER" ] && SSH_USER="$ENV_USER"
  if [ -z "$SSH_PASS" ]; then
    echo "ERROR: could not find ${VAR_PREFIX}_PASS in $SSH_ENV_FILE" >&2
    exit 1
  fi
  command -v sshpass >/dev/null 2>&1 || { echo "ERROR: sshpass not installed (brew install sshpass) — required for --env password auth" >&2; exit 1; }
fi

if [ -z "$MY_USER" ]; then
  echo "ERROR: no user given. Pass --user <name|SlackID> or set SLEUTH_MY_SLACK_ID." >&2
  echo "Registered names in $USERS_FILE:" >&2
  [ -f "$USERS_FILE" ] && python3 -c "import json,sys; print(list(json.load(open(sys.argv[1])).keys()))" "$USERS_FILE" >&2 || echo "  (no users.local.json yet)" >&2
  exit 1
fi

# Resolve a registered name to a Slack ID; pass a literal Slack ID straight through.
# Slack user IDs start with U (regular), W (Enterprise Grid), or B (bot).
SLACK_ID="$MY_USER"
if [[ ! "$MY_USER" =~ ^[UWB][A-Z0-9]{6,}$ ]]; then
  if [ ! -f "$USERS_FILE" ]; then
    echo "ERROR: '$MY_USER' is not a Slack ID and $USERS_FILE does not exist yet." >&2
    echo "Create it with: {\"$MY_USER\": \"U0XXXXXXXXX\"}" >&2
    exit 1
  fi
  SLACK_ID="$(python3 -c "
import json, sys
name, path = sys.argv[1], sys.argv[2]
m = json.load(open(path))
if name not in m:
    sys.exit(1)
print(m[name])
" "$MY_USER" "$USERS_FILE")" || {
    echo "ERROR: '$MY_USER' not found in $USERS_FILE. Registered names:" >&2
    python3 -c "import json,sys; print(list(json.load(open(sys.argv[1])).keys()))" "$USERS_FILE" >&2
    exit 1
  }
fi

if [ "$VIA" = "api" ]; then
  # GH-154 #4: the app already serves exactly this read, with isActive computed correctly
  # server-side (src/web-api.js #BuildRebalanceReminderRecord) — no root SSH, no /proc, no
  # hand-copied state logic to keep in sync (that copy being wrong was GH-152).
  API_ENV_FILE="${API_ENV_FILE:-$HOME/secrets/sleuth/sleuth-web-api-${API_PROFILE}.env}"
  if [ ! -f "$API_ENV_FILE" ]; then
    echo "ERROR: web API env file not found: $API_ENV_FILE (client-machine-local secret, never part of the repo)" >&2
    exit 1
  fi
  API_BASE_URL="$(sed -n 's/^SLEUTH_WEB_API_BASE_URL=//p' "$API_ENV_FILE" | tail -1)"
  API_TOKEN="$(sed -n 's/^SLEUTH_WEB_API_TOKEN=//p' "$API_ENV_FILE" | tail -1)"
  API_WORKSPACE="$(sed -n 's/^SLEUTH_WORKSPACE_NAME=//p' "$API_ENV_FILE" | tail -1)"
  if [ -z "$API_BASE_URL" ] || [ -z "$API_TOKEN" ]; then
    echo "ERROR: SLEUTH_WEB_API_BASE_URL / SLEUTH_WEB_API_TOKEN missing from $API_ENV_FILE" >&2
    exit 1
  fi
  command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not installed — required for --via api" >&2; exit 1; }
  # A 127.0.0.1 base URL means the secrets file was set up for an SSH tunnel. The same token
  # also authenticates directly against the public host — but doing that automatically would
  # silently swap "bearer token stays inside an encrypted tunnel" for "bearer token transits
  # the public network in cleartext HTTP" (the app has no HTTPS listener on this port). That's
  # a real security downgrade, so it requires explicit opt-in (--api-allow-direct), not a
  # silent fallback (caught in codex QA on PR #155).
  case "$API_BASE_URL" in
    http://127.0.0.1:*|http://localhost:*)
      if [ "$API_ALLOW_DIRECT" = "1" ]; then
        echo "WARNING: $API_ENV_FILE is configured for an SSH tunnel; --api-allow-direct is set, so querying ${SSH_HOST}:2020 directly over plain HTTP instead. The bearer token will be visible to anyone on the network path." >&2
        API_BASE_URL="http://${SSH_HOST}:2020"
      else
        echo "ERROR: $API_ENV_FILE is configured for an SSH tunnel (127.0.0.1) that isn't open on this session." >&2
        echo "  Either open it (e.g. ssh -L 12020:localhost:2020 $SSH_USER@$SSH_HOST) or re-run with" >&2
        echo "  --api-allow-direct to query ${SSH_HOST}:2020 directly over plain HTTP (bearer token then" >&2
        echo "  travels in cleartext over the network)." >&2
        exit 1
      fi
      ;;
  esac
  [ -z "${WORKSPACE_EXPLICIT:-}" ] && [ -n "$API_WORKSPACE" ] && WORKSPACE="$API_WORKSPACE"
  echo "Fetching '$WORKSPACE' reminders from the web API ($API_BASE_URL) for $SLACK_ID..." >&2
  # The bearer token goes in via -K (a config file), not -H on the command line — a -H
  # argument is visible to every local user via `ps`; -K's file content is not.
  API_CURL_CFG="$(mktemp "${TMPDIR:-/tmp}/sleuth-web-api-curl.XXXXXX.cfg")"
  trap 'rm -f "$API_CURL_CFG"' EXIT
  chmod 600 "$API_CURL_CFG"
  printf 'header = "Authorization: Bearer %s"\n' "$API_TOKEN" > "$API_CURL_CFG"
  # Same class of bug the SSH path had with --workspace, different boundary: an unescaped
  # workspace name lets '#' truncate the URL (silently dropping our own ?activeOnly=true and
  # sending whatever precedes it instead) or '../' attempt path traversal onto another route
  # under the same bearer token. Percent-encode it before it enters the URL — found in this
  # self-review after the SSH fix made the missing symmetric fix here obvious.
  WORKSPACE_URLENC="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$WORKSPACE")"
  RAW_JSON="$(curl -sf --connect-timeout 10 -K "$API_CURL_CFG" \
    "${API_BASE_URL%/}/workspace/${WORKSPACE_URLENC}/reminders?format=rebalance&activeOnly=true")" || {
    echo "ERROR: web API request failed (host unreachable, bad token, or workspace '$WORKSPACE' not found)" >&2
    exit 1
  }
  rm -f "$API_CURL_CFG"
else
  echo "Fetching live '$WORKSPACE' reminders from $SSH_USER@$SSH_HOST for $SLACK_ID..." >&2

  # Write the remote-side logic to a local scratch file once (quoted heredoc — no local
  # expansion), then pipe it over stdin to whichever ssh invocation we use below. Nothing here
  # touches the remote host's filesystem; the remote shell just reads this off its own stdin.
  REMOTE_SCRIPT_FILE="$(mktemp "${TMPDIR:-/tmp}/sleuth-remote-reminders.XXXXXX.sh")"
  trap 'rm -f "$REMOTE_SCRIPT_FILE"' EXIT
  cat > "$REMOTE_SCRIPT_FILE" <<'REMOTE_SCRIPT'
set -euo pipefail
WORKSPACE="$1"
PID="$(systemctl show sleuth-app -p MainPID --value)"
DATA_DIR=""
if [ -n "$PID" ] && [ "$PID" != "0" ] && [ -r "/proc/$PID/environ" ]; then
  DATA_DIR="$(tr '\0' '\n' < "/proc/$PID/environ" | sed -n 's/^SLEUTH_DATA_DIR=//p')"
fi
if [ -z "$DATA_DIR" ]; then
  # GH-154 #5: there is no reliable fallback location — the deploy SOP places runtime data
  # at /var/lib/aegis-sleuth, outside either application checkout, so guessing
  # <WorkingDirectory>/data/runtime used to silently read the wrong (or no) file. Fail loudly
  # instead, naming the host/PID so the real cause (root can't read /proc, or SLEUTH_DATA_DIR
  # isn't set on the unit) is obvious rather than masked by a wrong-but-present path.
  # $(hostname), not the caller's $SSH_HOST — this heredoc runs on the REMOTE shell, where
  # SSH_HOST was never set; under `set -u` a reference to it would abort with "unbound
  # variable" before this message ever printed (caught in agy QA on PR #155).
  echo "ERROR: could not read SLEUTH_DATA_DIR from /proc/$PID/environ on $(hostname) — refusing to guess a data directory. Check that this SSH session can read /proc/$PID/environ (root) and that the sleuth-app unit has SLEUTH_DATA_DIR set." >&2
  exit 1
fi
cat "$DATA_DIR/reminders/${WORKSPACE}_reminders.json"
REMOTE_SCRIPT

  # ssh does NOT preserve local argv quoting for the remote command: everything after the
  # destination is joined with spaces into ONE string and handed to the remote shell, so a
  # locally-quoted "$WORKSPACE" can still be re-split/interpreted remotely if it contains
  # shell metacharacters. --workspace is user-supplied, so shell-escape it with `%q` before
  # it crosses that boundary — the remote `bash -s -- "$1"` then receives the original value
  # back as inert data, not executable syntax (caught in codex QA on PR #155).
  printf -v WORKSPACE_Q '%q' "$WORKSPACE"

  if [ -n "$SSH_PASS" ]; then
    # -e reads the password from $SSHPASS rather than argv, so it never shows up in `ps`.
    RAW_JSON="$(SSHPASS="$SSH_PASS" sshpass -e ssh -q -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST" bash -s -- "$WORKSPACE_Q" < "$REMOTE_SCRIPT_FILE")"
  else
    RAW_JSON="$(ssh -q -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST" bash -s -- "$WORKSPACE_Q" < "$REMOTE_SCRIPT_FILE")"
  fi
fi

mkdir -p "$(dirname "$OUT_PATH")"

# RAW_JSON can exceed the OS argv size limit (ARG_MAX / E2BIG on Linux), so it goes in over
# stdin, not as a command-line argument.
printf '%s' "$RAW_JSON" | python3 -c "
import json, sys
from datetime import datetime, timezone

slack_id, workspace, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(sys.stdin)

# Three shapes seen in practice: a bare list (raw on-disk file), a {reminders: [...]}
# envelope (git-pulse-sync export), or {success, data: {reminders: [...]}} (the web API,
# --via api) — handle all three.
if isinstance(data, dict) and isinstance(data.get('data'), dict) and 'reminders' in data['data']:
    reminders = data['data']['reminders']
elif isinstance(data, dict) and 'reminders' in data:
    reminders = data['reminders']
elif isinstance(data, list):
    reminders = data
else:
    print(f'ERROR: unexpected reminders JSON shape from server: {type(data).__name__} without a \'reminders\' list', file=sys.stderr)
    sys.exit(1)

# The RAW on-disk record uses PascalCase (AssigneeID, State, ReminderID, ...) and has NO
# isActive field at all — that is only computed by the export path (src/web-api.js
# #BuildRebalanceReminderRecord / #GetReminderState / #IsReminderStateActive), which this
# SSH read bypasses entirely. Replicate that logic exactly rather than guessing camelCase
# field names, and accept camelCase too in case a future export-shaped source is ever piped
# through this same script.
ACTIVE_STATES = {'scheduled', 'overdue', 'snoozed', 'posting', 'posted', 'rescheduled', 'failed'}
VALID_STATES = ACTIVE_STATES | {'completed', 'canceled', 'dead-letter'}

def field(r, *names):
    for n in names:
        if n in r:
            return r[n]
    return None

def normalize_state(raw):
    if not isinstance(raw, str):
        return 'scheduled'
    s = raw.strip().lower()
    if s == 'due':
        return 'overdue'
    return s if s in VALID_STATES else 'scheduled'

def is_active(r):
    # GH-154 agy QA: when the record already carries a real isActive (the --via api /
    # web-api-export shape), trust it — it's the server's own #IsReminderStateActive
    # verdict. Re-deriving it here from ACTIVE_STATES would silently drift from the server
    # if that set ever changes, defeating the whole point of --via api (GH-152 was exactly
    # this kind of drift). Only synthesize it from State when isActive is genuinely absent
    # (the raw on-disk PascalCase shape --via ssh reads).
    state = normalize_state(field(r, 'State', 'state'))
    raw_active = field(r, 'isActive')
    if isinstance(raw_active, bool):
        return raw_active, state
    return state in ACTIVE_STATES, state

mine = []
for r in reminders:
    active, state = is_active(r)
    if not active:
        continue
    ids = set(field(r, 'AssigneeIDs', 'assigneeIds') or [])
    aid = field(r, 'AssigneeID', 'assigneeId')
    if isinstance(aid, str) and aid:
        ids.add(aid)
    if slack_id not in ids:
        continue
    mine.append({
        'reminderId': field(r, 'ReminderID', 'reminderId'),
        'state': state,
        'reminderMessageText': field(r, 'ReminderMessageText', 'reminderMessageText'),
        'dueDate': field(r, 'ShouldPostOn', 'shouldPostOn', 'dueDate'),
        'originalChannelName': field(r, 'OriginalChannelName', 'originalChannelName'),
        'githubUrls': field(r, 'GitHubUrls', 'githubUrls'),
    })

out = {
    'workspaceName': workspace,
    'assigneeId': slack_id,
    'fetchedAt': datetime.now(timezone.utc).isoformat(),
    'count': len(mine),
    'reminders': mine,
}
with open(out_path, 'w') as f:
    json.dump(out, f, indent=2)
print(f'Wrote {len(mine)} active reminder(s) for {slack_id} to {out_path}', file=sys.stderr)
" "$SLACK_ID" "$WORKSPACE" "$OUT_PATH"
