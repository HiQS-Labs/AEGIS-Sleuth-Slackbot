---
gh_issue: 413
source: https://github.com/NeochromeTeam/sleuth-app/issues/413
title: "Admin-facing kill switch for DM reminders auto-scheduling (GH-412 follow-up)"
status: Proposed (1-INBOX — not yet active)
created: 2026-07-17
doc_type: bugfix
related: "GH-412 (DM support gates) — this is a deliberate, deferred follow-up, not a blocker"
---

# GH-413 — DM reminders kill switch

## Context

Follow-up from [GH-412](GH-412-DM-SUPPORT-GATES.md) (DM support gates, in `2-WORKING`). That fix
makes Sleuth auto-schedule reminders from a plain 1:1 DM (`channel_type === 'im'`) with **no
opt-in required** — every user in every workspace can schedule via DM immediately once GH-412
ships, same as an explicit `@Sleuth` mention already could.

This was a deliberate, adjudicated design call during GH-412's `/consult` QA pass (agy + Codex,
2026-07-17): agy flagged the no-opt-in default as removing workspace-admin control over the
reminders feature; Codex called the default itself defensible (a DM is inherently 1:1 and
user-initiated, unlike a shared channel an admin manages on others' behalf) and only suggested a
kill switch as a future nice-to-have if false positives become a real problem. Adjudicated call:
ship GH-412 without one now, track this separately — not block a bug fix on a feature that may
never be needed.

## The risk this covers

Offhand DM chatter that happens to match a scheduling-trigger heuristic (e.g. casually mentioning
"tomorrow" in a DM to Sleuth) could get auto-scheduled with no admin-configurable way to disable
that behavior workspace-wide — unlike channel-based reminders, which require explicit
`enable reminders` first (`src/reminders-channel-settings.js`).

## Scope for a fix (not yet designed)

- A per-workspace admin setting/command (mirroring the existing channel enable/disable flow in
  `reminders-channel-settings.js`) that turns off DM auto-scheduling specifically, independent of
  the DM chat-reply behavior.
- Decide default-on-with-opt-out vs. inert-until-enabled — leaning opt-out per the adjudicated
  call above, revisit once real usage data exists.

## Trigger to revisit

Re-evaluate only once there's evidence of real false-positive DM scheduling (an admin/user
complaint, or a pattern in reminder logs) — not a hypothetical concern alone.
