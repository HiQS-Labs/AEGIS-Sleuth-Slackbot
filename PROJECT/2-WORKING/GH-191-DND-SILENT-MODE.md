---
gh_issue: 191
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/191
title: "DND/silent mode turns off reminder notifications at channel and workspace level"
status: In progress (2-WORKING)
created: 2026-09-10
doc_type: feature
rated: 75/45/80/75
---

# GH-191 — DND / Silent Mode for Reminders

## Context & Requirements
- Channel-level and workspace-level toggle for DND / Silent mode.
- Silences reminder notifications (overdue reminder delivery and morning reminder digest).
- Main defined channel posts a DND notice in lieu of the morning reminders when DND is enabled on any channel or workspace:
  "Note: AEGIS Sleuth Reminders are DND on this group or channel. Use [command] to turn them on."
- Supports single-channel setups where the main reminder channel is the only channel and has DND toggled on.
- Fully integrated with the `rmm` / `rmm ifl` command family.
- Re-uses existing patterns (DRY, /ponytail lens, no extraneous subsystems).
