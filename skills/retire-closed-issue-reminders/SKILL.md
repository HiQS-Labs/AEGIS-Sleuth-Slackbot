---
name: retire-closed-issue-reminders
description: Find live Sleuth reminders whose linked GitHub issues or PRs are closed, review each one against the linked issues, and retire (complete) only the ones whose task is actually done, through bulk-edit-reminders. Read-only finder plus a reviewed workflow; it never writes to Sleuth itself. Trigger on "retire reminders whose GitHub issues are closed", "check active reminders against GitHub", "clean up reminders for closed issues", "/retire-closed-issue-reminders".
---

# Retire reminders whose GitHub issues are closed

Sleuth already completes a reminder on its own once **every** GitHub link the server tagged on it
(`GitHubUrls`) is closed: `GitHubSyncModule` polls every 30 minutes (restored in GH-331). This
skill covers what that rule leaves behind:

- links that appear only in the reminder text, not in `GitHubUrls`;
- **mixed** reminders, with a closed link next to open ones;
- links whose state could not be read (`unknown`).

A closed link does not prove the reminder's task is done. On 2026-11-20 two mixed reminders were
found: one was finished (its issue closed with the result), the other was not (the merged PR was
the upgrade; the test it asked for had not happened). So every candidate is reviewed before
anything is retired.

All writes go through [`bulk-edit-reminders`](../bulk-edit-reminders/SKILL.md). Read its "Before
running" section first (tunnel, credentials, bot keys).

## 1. Back up and download

```bash
node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs backup --workspace neochrome --env prod --tunnel
```

This writes the pending reminders to a private, mode-600 file under `~/secrets/sleuth/backups/`.
That file is the input for step 2 and the "before" copy for step 5. Repeat per workspace if more
than one has reminders.

## 2. Find candidates

```bash
node skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs ~/secrets/sleuth/backups/<file>.json
```

It looks up each unique link once with `gh api repos/<owner>/<repo>/issues/<n>` (REST; PRs answer
there too) and prints one line per reminder that has links:

| Class | Meaning | Next |
|---|---|---|
| `all-closed` | every link closed or merged | review; likely retire |
| `mixed` | some closed, some open | review; retire only if the task depended on the closed one |
| `unknown` | a lookup failed (404, no access, rate limit) | never retire on this run; fix access and rerun |
| `open` | no link closed | leave |

Reminders with no GitHub link are counted as `none` and not listed. The `all-closed`, `mixed` and
`unknown` rows, with their text and link states, are saved next to the backup as
`<backup>.closed-issues.json` (mode 600) for review. The script needs `gh` logged in; it makes no
other network call and changes nothing.

## 3. Review every candidate

For each `all-closed` and `mixed` reminder:

1. Read its **Key task** line, not just the quoted message. The task, not every issue mentioned in
   the source, decides.
2. Read each linked issue or PR (`gh issue view N -R owner/repo --json title,state,stateReason,body,comments`
   or `gh pr view …`): the closing comment, the PR's unchecked boxes, any reopen.
3. Decide **retire** (the task is done), **keep** (some of it is still open), or **unsure**
   (keep). If the source thread is needed, use [`read-slack`](../read-slack/SKILL.md).

With several candidates, independent reviewers (for example three subagents given the review file)
can each judge them first; the agent driving the run then double-checks every retirement itself
before step 4. Write down each decision and its evidence.

## 4. Retire, dry-run first

```bash
node -- skills/bulk-edit-reminders/bulk-edit-reminders.mjs --workspace neochrome --env prod --tunnel \
  --complete <id>,<id> --reason "linked GitHub issue <owner/repo#n> closed: <one-line evidence>" --dry-run
# check the printed rows, then the same command without --dry-run
```

Use `--complete` (it keeps the completion record), not `--cancel`. `bulk-edit-reminders` takes its
own fresh backup before sending.

## 5. Verify

Take another backup and compare it with the pre-write backup from step 4. The retired IDs must be
absent, and every other pending reminder unchanged. The backup holds pending reminders only, so a
retired reminder shows up only as a removal.

## Privacy

Backups, the review file and reminder text contain client and team information. Keep them in
`~/secrets/sleuth/`; never paste them into this public repo or its issues. Delete review folders
when the run is finished.
