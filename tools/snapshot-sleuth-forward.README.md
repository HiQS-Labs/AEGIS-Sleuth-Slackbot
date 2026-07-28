# snapshot-sleuth-forward — Operator Notes (Phase 1)

Forwarding script for the Snapshot → Slack Relay feature (P2).
Lives at: `tools/snapshot-sleuth-forward.js`

---

## 1. Hook JSON to add to `~/.claude/settings.json`

Add the block below inside `hooks.PostToolUse` (create the key if absent).
The hook fires after Claude Code's `Write` tool writes any file; the script
ignores anything that isn't `snapshot.md`, so the hook can be left broad.

> **Note:** The `Edit` tool can also touch `snapshot.md` (e.g. when the
> snapshot skill prepends a new entry to an existing file). Add an identical
> matcher for `Edit` if you want those writes covered too.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/Documents/GH\\ Repos/sleuth-app/tools/snapshot-sleuth-forward.js"
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/Documents/GH\\ Repos/sleuth-app/tools/snapshot-sleuth-forward.js"
          }
        ]
      }
    ]
  }
}
```

The hook feeds its JSON (which includes `tool_input.file_path`) to the script
via **stdin** automatically — no extra wiring needed.

---

## 2. Where to set `snapshot_sleuth`

The hook process is launched by the Claude Code daemon, **not** your
interactive shell session. A one-off `export snapshot_sleuth=true` in a
terminal tab will NOT reach the hook.

### Option A — shell profile (recommended for personal machines)

Add to `~/.zshrc` (or `~/.bash_profile`):

```sh
export snapshot_sleuth=true
```

Then restart your terminal (or `source ~/.zshrc`). The hook inherits
the variable because Claude Code's daemon reads your login environment.

### Option B — `settings.json` `env` block (more explicit, per-machine)

```json
{
  "env": {
    "snapshot_sleuth": "true",
    "SNAPSHOT_SLEUTH_DROP_DIR": "~/git-pulse-sync"
  }
}
```

This block is merged into every hook process's environment by Claude Code,
making it the most reliable delivery mechanism regardless of shell profile
quirks.

**Do NOT set `snapshot_sleuth=true` in a project `.env` or committed config**
— that would opt in every environment that pulls the repo.

---

## 3. Dry-run command (Phase 1 verification)

Build a fake `snapshot.md` with two entries, then pipe a fake hook JSON
pointing at it into the script:

```sh
# Step 1 — create a temp snapshot.md with two entries
TMPDIR_TEST="$(mktemp -d)"
cat > "${TMPDIR_TEST}/snapshot.md" << 'SNAP'
# 📸 Snapshot — 2026-06-17T20:30Z — sleuth-app

**Session:** feat/snapshot-slack-relay | 2026-06-17 20:30 UTC
**Last response (verbatim):**
This is the NEWEST entry content.

---

# 📸 Snapshot — 2026-06-17T18:00Z — sleuth-app

**Session:** feat/snapshot-slack-relay | 2026-06-17 18:00 UTC
**Last response (verbatim):**
This is the OLDER entry and should NOT appear in the forwarded payload.

SNAP

# Step 2 — dry-run with gate ON
echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"${TMPDIR_TEST}/snapshot.md\"}}" \
  | snapshot_sleuth=true snapshot_sleuth_dryrun=true \
    node $HOME/Documents/GH\ Repos/sleuth-app/tools/snapshot-sleuth-forward.js
```

Expected output:
- Contains the metadata header (forwarded-at, device, source repo).
- Contains the verbatim text of the NEWEST entry ("This is the NEWEST entry content.").
- Does NOT contain "OLDER entry".

---

## 4. Gate-OFF verification

```sh
echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"${TMPDIR_TEST}/snapshot.md\"}}" \
  | node $HOME/Documents/GH\ Repos/sleuth-app/tools/snapshot-sleuth-forward.js
# Expected: no output, exits 0 immediately.
```

---

## 5. Drop repo — reuse the private `git-pulse-sync` repo (the hook does NO git)

We reuse the existing **private, solo-access** sync repo `~/git-pulse-sync`
(remote: the repo named by `SLEUTH_EXPORT_REPO`). The hook is a **pure file
producer** — it does no git at all. The existing **git-pulse sync** stages,
commits, and pushes the `snapshots/` dir on its next scheduled run.

- Set `SNAPSHOT_SLEUTH_DROP_DIR=~/git-pulse-sync` in your hook env (see §2).
- The script writes `~/git-pulse-sync/snapshots/<utc>__<host>__<sha8>.md` via a
  **temp file + atomic rename** (so the pulse tool can never stage a half-written
  file — which, since the server dedupes by filename, would never be re-posted),
  then exits. No add/commit/pull/push, **no PAT**.
- **Required on the pulse-tool side:** `snapshots/` must be in the pulse tool's
  `stage_paths` (one `append_stage_path "snapshots"`, guarded by `[ -d snapshots ]`)
  — otherwise dropped files never sync. Delivery latency = the pulse cadence (minutes).

If `SNAPSHOT_SLEUTH_DROP_DIR` is unset, the script defaults to `~/.sleuth-snapshot-drop`
and self-skips (logs a WARN) when that dir is absent — so dry-run / gate-OFF still work anywhere.

---

## 6. Log location

Always **outside** the drop repo — so a reused repo never gets a stray log committed:

```sh
tail -f ~/.claude/snapshot-sleuth-forward.log
```
