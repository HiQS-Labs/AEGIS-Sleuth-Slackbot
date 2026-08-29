---
title: "Add `download` skill: fetch my active Sleuth reminders live via SSH"
status: Shipped
created: 2026-08-29
updated: 2026-08-29
owner: noel
branch: development
doc_type: project
gh_issue: 152
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/152
related: "skills/talk-to-reminders (the mirror-based sibling this complements)"
effort: 1
complexity: 1
risk: 1
phases: 1
---

# GH-152 — `download` skill: fetch my active Sleuth reminders live via SSH

New skill (`skills/download/`) that SSHes into the production host and reads the workspace's
reminders JSON straight out of the running `sleuth-app` process's own `SLEUTH_DATA_DIR`
(resolved via `/proc/$PID/environ`, per `temp/SOP.md`'s "trust only the live process" rule —
not `git-pulse-sync`'s ~5-15-min-stale mirror). Filters to `isActive` reminders assigned to
the caller's Slack ID and writes `temp/my_reminders.json`.

Supports SSH key auth (default) or a client-side-only password fallback (`--env prod|dev`,
reading `~/secrets/sleuth/vultr-sleuth-<env>.env` — never committed, never copied to the
host, password kept out of `ps` via `sshpass -e`). Per-teammate Slack-ID mapping lives in a
gitignored `users.local.json` next to the skill.

## Phase 1 — build + ship
- [x] `skills/download/fetch-my-reminders.sh` — SSH fetch, remote-side `SLEUTH_DATA_DIR`
      resolution, Python filter/write.
- [x] `skills/download/SKILL.md` — usage + one-time teammate setup.
- [x] `skills/download/users.local.json.example` — template, gitignored real file.
- [x] `.gitignore`: `skills/*/users.local.json`.
- [x] Adversarial QA via `agy` CLI — fixed two blocking bugs: JSON-over-argv `E2BIG` risk
      (moved to stdin) and an `AttributeError` crash on a malformed server response (now a
      clear error message).
- [x] Live-tested against production: confirmed `SLEUTH_DATA_DIR=/var/lib/aegis-sleuth`,
      36 total / 0 active reminders at test time — plumbing verified end-to-end.
- [x] Side fix: `temp/SOP.md` corrected — production has password auth
      (`vultr-sleuth-production.env`) in addition to the documented SSH key.

### QA gate
- [x] `bash -n` syntax-clean.
- [x] Both blocking bugs reproduced pre-fix and verified fixed post-fix (oversized-payload
      stdin test, malformed-shape error-path test).
- [x] Live SSH round-trip against production succeeded.

## Progress log
- 2026-08-29: built as `.claude/skills/my-sleuth-reminders/` (personal, gitignored), QA'd via
  `agy` CLI, copied into the git-tracked `skills/download/` for the team, filed as #152
  retroactively, registered here + in the RELEASES ledger (release "Roundup").
