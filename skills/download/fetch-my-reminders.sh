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
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: could not resolve repo root from $SCRIPT_DIR (not inside a git repo?)" >&2
  exit 1
fi

USERS_FILE="$SKILL_DIR/users.local.json"

WORKSPACE="${SLEUTH_WORKSPACE:-neochrome}"
SSH_HOST="${SLEUTH_SSH_HOST:-64.176.223.93}"
SSH_USER="${SLEUTH_SSH_USER:-root}"
MY_USER="${SLEUTH_MY_SLACK_ID:-}"
OUT_PATH="$REPO_ROOT/temp/my_reminders.json"
# --env selects password auth from a LOCAL, never-committed secrets file
# ($HOME/secrets/sleuth/vultr-sleuth-<development|production>.env, same convention temp/SOP.md
# already documents for the dev host). Nothing from that file is ever written into this repo or
# copied to the remote host — it's read once, held in memory for this process, and used to
# authenticate. Omit --env to keep the original key-auth (BatchMode) behavior.
SSH_ENV_PROFILE="${SLEUTH_SSH_ENV:-}"
SSH_ENV_FILE="${SLEUTH_SSH_ENV_FILE:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --user) MY_USER="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --host) SSH_HOST="$2"; shift 2 ;;
    --user-ssh) SSH_USER="$2"; shift 2 ;;
    --out) OUT_PATH="$2"; shift 2 ;;
    --env) SSH_ENV_PROFILE="$2"; shift 2 ;;
    --env-file) SSH_ENV_FILE="$2"; shift 2 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Resolve password-auth inputs from the local secrets file, if requested. We deliberately do
# NOT `source` this file (it's a credentials file, not code we should execute) — pull out only
# the three keys we need with `sed`, so a syntax error or stray line in it can't run as shell.
SSH_PASS=""
if [ -n "$SSH_ENV_PROFILE" ] || [ -n "$SSH_ENV_FILE" ]; then
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
  WORKDIR="$(systemctl show sleuth-app -p WorkingDirectory --value)"
  DATA_DIR="$WORKDIR/data/runtime"
fi
cat "$DATA_DIR/reminders/${WORKSPACE}_reminders.json"
REMOTE_SCRIPT

if [ -n "$SSH_PASS" ]; then
  # -e reads the password from $SSHPASS rather than argv, so it never shows up in `ps`.
  RAW_JSON="$(SSHPASS="$SSH_PASS" sshpass -e ssh -q -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST" bash -s -- "$WORKSPACE" < "$REMOTE_SCRIPT_FILE")"
else
  RAW_JSON="$(ssh -q -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$SSH_HOST" bash -s -- "$WORKSPACE" < "$REMOTE_SCRIPT_FILE")"
fi

mkdir -p "$(dirname "$OUT_PATH")"

# RAW_JSON can exceed the OS argv size limit (ARG_MAX / E2BIG on Linux), so it goes in over
# stdin, not as a command-line argument.
printf '%s' "$RAW_JSON" | python3 -c "
import json, sys
from datetime import datetime, timezone

slack_id, workspace, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(sys.stdin)

# The on-server file has been observed both as a bare list and as an
# {reminders: [...]} envelope (matching the git-pulse-sync export shape) — handle both.
if isinstance(data, dict) and 'reminders' in data:
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

mine = []
for r in reminders:
    state = normalize_state(field(r, 'State', 'state'))
    if state not in ACTIVE_STATES:
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
