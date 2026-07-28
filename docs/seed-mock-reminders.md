# Recipe: Seed Mock Reminder Data

**Purpose:** Generate realistic, schema-valid reminder fixtures for local dev/digest testing without needing real Slack messages.  
**Approach:** Hybrid — deterministic structure + date math (script), AI-assisted task title pool (agent fills in Step 2).  
**Last updated:** 2026-03-27

---

## What You Need Before Running

| Item | Where to get it |
|---|---|
| Slack `LIVE_TOKEN` (for first-run user lookup) | Workspace JSON under `data/runtime/workspaces/` |
| Test channel Slack ID | Already known: `C000EXAMPLE6` (`2-sleuth-ai-noel`) |
| App stopped or restarted after inject | File is read only at startup |

---

## Gap Analysis (things easy to miss)

- **`CONFIG.USERS` are Slack login names / lookup keys, not raw `U…` IDs** — The script resolves each string through a user ID lookup table (LUT) built from `users.list` on first run and cached at `temp/userIDs.json`. Use values that match `name` or normalized `real_name` (see the script comments). Edit `CONFIG.USERS` before running; no need to paste `U…` IDs by hand unless you change the script.
- **Append vs Replace** — `CONFIG.APPEND: false` replaces all reminders. Set `true` to add alongside existing ones.
- **Time of day** — "due today" means today at 9:00 AM workspace time. Adjust `HOUR_OF_DAY` in config if needed.
- **ReminderMessageText format** — mocks use a simplified but fully schema-valid format. No real Slack permalink is generated (the field is synthetic).
- **Bucket counts must sum to TASK_COUNT** — the script validates this and exits with a clear error if not.
- **Restart required** — reminders are loaded from disk only at startup. Run `@Sleuth AI restart` or restart the process after injecting.

---

## Step 1 — Confirm user names for `CONFIG.USERS`

Optional: list workspace members to pick strings that match the LUT (Slack `name` / `real_name`). Open Slack → profile → `…` → `Copy member ID` if you prefer to hardcode IDs in a forked script.

From a terminal with `LIVE_TOKEN` set:

```bash
# Usage: replace USERNAME with the display name to search
LIVE_TOKEN=$(node -e "const w=require('./data/runtime/workspaces/Neochrome_workspace.json'); console.log(w.LIVE_TOKEN)")
curl -s -H "Authorization: Bearer $LIVE_TOKEN" \
  "https://slack.com/api/users.list" | \
  node -e "
    const d=[];process.stdin.on('data',c=>d.push(c));
    process.stdin.on('end',()=>{
      const r=JSON.parse(d.join(''));
      (r.members||[]).filter(m=>!m.deleted&&!m.is_bot)
        .forEach(m=>console.log(m.id, m.name, m.real_name||''));
    });
  "
```

Put matching `name` strings (or the script’s supported aliases) into `CONFIG.USERS` in [`recipes/seed-mock-reminders.js`](../recipes/seed-mock-reminders.js).

---

## Step 2 — AI Agent: Validate / Extend Task Title Pool

The script ships with 16 default titles. If `TASK_COUNT > 16`, add more. Ask the agent:

> "Add N more typical design/dev agency task titles to the `TASK_TITLES` array in this script. Keep them realistic and varied — design, frontend, backend, client comms, QA, and project management."

---

## Step 3 — Run the Generator

From the repo root:

```bash
node recipes/seed-mock-reminders.js
```

The script prints a summary table on success:

```
✅ Wrote 12 reminder(s) → data/runtime/reminders/Neochrome_reminders.json
   New: 12  |  Preserved: 0

   [01] U032TCHJ8   Mar 26   • Finalize homepage wireframes for client review
   [02] UXXXXXXXX   Mar 26   • QA test checkout flow on iOS and Android
   ...

⚡ Restart the app to load the new data: @Sleuth AI restart
```

---

## Step 4 — AI Agent: Validate the Output JSON

After the script runs, ask the agent to validate the output file:

> "Read `data/runtime/reminders/Neochrome_reminders.json` and confirm: all records have ReminderID (UUID), CreatedOn and ShouldPostOn as ISO strings, TargetChannelID matches `C000EXAMPLE6`, State is `scheduled`, and the due date distribution matches `CONFIG.DUE_DATES` in the recipe (e.g. tomorrow, a few days ago, ~14 days ago). Report any anomalies."

The agent can also verify digest bucketing:

> "Using `BucketRemindersByDueDate` in `src/reminders-display-utils.js` (sections: *Due Today*, *Due after today*, *Due within last 7 days*, *Due older than 7 days*), simulate which bucket each reminder in the file would fall into for today's date in `America/Los_Angeles`. List any surprises."

---

## Step 5 — Restart and Test

```bash
# In Slack, send to the reminder channel:
@Sleuth AI restart

# Then trigger the daily digest manually to see the bucketed output:
@Sleuth AI run daily digest
```

Or from terminal if running locally:

```bash
# Ctrl+C to stop, then:
npm run dev
```

---

## Step 6 — Reset (Remove Mock Data)

To restore to a clean state after testing:

```bash
# Clear all reminders (keeps the file, empties the array)
echo "[]" > data/runtime/reminders/Neochrome_reminders.json

# Then restart
# @Sleuth AI restart
```

Or to restore from a backup (if you ran the script with `APPEND: true` and want to roll back):

```bash
# The backup-sleuth-data.sh script handles this — restore from your latest backup.
./backup-sleuth-data.sh
```

---

## Quick Reference — Config Knobs

| Config key | Default | Effect |
|---|---|---|
| `TASK_COUNT` | `9` (see script) | Total reminders to generate |
| `APPEND` | `false` | `true` adds to existing reminders instead of replacing |
| `HOUR_OF_DAY` | `9` | Hour (24h, workspace TZ) for all due dates |
| `DUE_DATES[].count` | `3` each | How many reminders per date bucket (must sum to `TASK_COUNT`) |
| `USERS` | 3 name strings | Resolved via LUT to Slack user IDs; round-robin or random per script |
| `TASK_TITLES` | 16 defaults | AI-extensible pool; must have ≥ `TASK_COUNT` entries |

