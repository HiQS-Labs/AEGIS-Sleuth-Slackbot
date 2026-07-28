---
name: talk-to-reminders
description: Answer natural-language questions about the team's Sleuth reminders (open tasks + recent completions) from the local published mirror — zero network, no Slack round-trip. Trigger when the user asks "what's open for <client>", "what did <person> do last week", "what Client A tasks are there", or otherwise wants to query/talk to the reminder list locally.
---

# Talk to Reminders

Query the Sleuth reminder list locally and synthesize the answer. A deterministic Node script
(`query-reminders.mjs`) decides *which* reminders match — the same query core the Slack
`ask-reminders` command uses (`src/reminder-query-engine.js`). You turn the user's question into
flags, run the script, and write the human answer **from the cited rows it returns**. Never invent a
reminder, id, name, or date that isn't in the script's output.

## When to use

- "What's open for Client A?" / "What tasks does the team have for <client>?"
- "What did <person> work on last week?" / "…in the last 14 days?"
- "Anything about the plugin upgrades?" (keyword/topic)
- Any "talk to / query the reminders" ask that should be answered locally and fast.

## How to run it

Run the script from this skill directory (it imports the query core by relative path):

```bash
node "$CLAUDE_PLUGIN_ROOT/query-reminders.mjs" [flags]
```

If `$CLAUDE_PLUGIN_ROOT` isn't set, use the skill's own directory. Flags (combine freely — the script
ANDs them):

| Flag | Meaning |
|---|---|
| `--client <slug>` | Client slug, e.g. `client-a`. Exact match on the stamped `clientId`. |
| `--user <SlackID>` | Assignee by Slack id (`U…`). Deterministic. |
| `--user-name <substr>` | Assignee by display-name substring (use when the user names a person, not an id). Active reminders only. |
| `--keywords "a,b"` | Topic filter — ALL terms must appear in the text (case-insensitive). |
| `--since "last week"` | Time window: `last week`, `this week`, `today`, `yesterday`, `last N days` — resolved in the workspace timezone. |
| `--days N` | Time window = the last N days (alternative to `--since`). |
| `--include-completed` | Fold in recent completion history (`completions-<ws>.json`). Needed for any "what did X **do**/finish" or past-tense question. |
| `--workspace <name>` | Default `neochrome`. |
| `--tz <IANA>` | Default `America/Los_Angeles`. |
| `--limit N` | Cap rows (default 50). |
| `--json` | Machine-only output (you normally don't need this; the default output already ends with a `---JSON---` block). |

**Mapping questions → flags:**
- Past-tense / "last week" / "did / finished / completed" → **always add `--include-completed`** (open queue alone won't have finished tasks) plus the time window.
- "open / pending / still need to" → omit `--include-completed` (active queue only).
- A person's name → `--user-name <name>`; a Slack id → `--user`.
- A client name → `--client <slug>` (lowercase; Client A → `client-a`).

## Examples

```bash
# "What Client A client tasks are open across all users?"
node "$CLAUDE_PLUGIN_ROOT/query-reminders.mjs" --client client-a

# "What did Mike work on last week regarding the plugin upgrades?"
node "$CLAUDE_PLUGIN_ROOT/query-reminders.mjs" --user-name mike --since "last week" --keywords "plugin,upgrade" --include-completed
```

## Synthesizing the answer

1. Read the script's rows (the pretty list + the trailing `---JSON---` block for exact ids).
2. Answer the question directly and briefly. Group by client or person when that's the axis asked.
3. **Cite** each task by its summary and `id:` (and permalink when present). Only claim what's in the
   rows — if the set is empty, say so plainly ("No matching tasks") rather than guessing.
4. If the question was time-scoped or past-tense but you forgot `--include-completed` and got an empty
   set, re-run with it before concluding there's nothing.

## Notes / limits

- **Source is a published mirror**, refreshed periodically by the Sleuth server — not live Slack. It's
  minutes-stale, not real-time. Mention that only if the user needs to-the-second accuracy.
- **History depth** is bounded (completions file window, ~90 days). Older tasks won't appear.
- **Client stamping** is best-effort; a task in a non-client channel has `clientId: null` and won't
  match `--client`. Fall back to `--keywords` for those.
- Set `SLEUTH_MIRROR_DIR` if the mirror lives somewhere other than the default
  `$HOME/git-pulse-sync/sync/sleuth`.
