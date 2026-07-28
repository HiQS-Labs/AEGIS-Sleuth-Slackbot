---
Author: Codex
Date: 2026-06-01
Status: PHASE 3 COMPLETE
Goal: Convert the show-me spike into a phased project plan for a reminder-first Slack command that recommends what a tagged user should work on today.
title: P1 — Sleuth Show-Me Tasks
branch: development
owner: noel
model: reminder-first
phases: 4
summary: >-
  Build `@Sleuth show-me @user` in phases. Phase 1 ships now using existing
  reminder and GitHub-link signals. Later phases add Slack-user-to-GitHub-user
  mapping, GitHub activity enrichment, and a stronger synthesis layer.
---

# P1 — Sleuth Show-Me Tasks

| Most recently completed phase | What's next |
|---|---|
| Phase 3 complete: stronger synthesis prompt (explicit overlap priority rule + wording guidance), `[Active PR]` annotation cross-referencing open PRs against reminder `GitHubUrls`, 65 tests. Shipped as v1.4.154. Pending live smoke test covering a mapped and unmapped user. | Live smoke test on dev server, then PR + merge to main and production deploy. |

## Table of Contents

- [Overview](#overview)
- [Command Shape](#command-shape)
- [Current Signal Inventory](#current-signal-inventory)
- [Phase 0: Feasibility Spike](#phase-0-feasibility-spike)
- [Phase 1: Reminder-First MVP](#phase-1-reminder-first-mvp)
- [Phase 2: GitHub Activity Enrichment](#phase-2-github-activity-enrichment)
- [Phase 3: Full Synthesis and Hardening](#phase-3-full-synthesis-and-hardening)
- [Out of Scope for Phase 1](#out-of-scope-for-phase-1)

## Overview

This project adds a new Slack command that tells a tagged user what they should work on today.

The key implementation constraint is architectural, not conceptual:

- The command should enter through the existing chat command pipeline.
- Reminder reads should reuse existing reminder query helpers and persistence.
- AI ranking should go through `WorkspaceAI` only.
- Phase 1 should avoid any new GitHub-user mapping or repo-activity plumbing.

Recommendation: ship the reminder-first MVP first. Sleuth already knows who owns which reminders, which reminders are overdue or due soon, and which reminders are linked to GitHub issues or PRs. That is enough to produce a credible top-3 priority list now.

## Command Shape

Primary command:

`@Sleuth show-me what tasks @user should work on today`

Shorthand:

`@Sleuth show-me @user`

Self-referential aliases (resolves to the caller, no mention needed):

- `@Sleuth what are my tasks?`
- `@Sleuth what's my tasks`
- `@Sleuth show me my tasks`
- `@Sleuth what should I work on today`
- `@Sleuth what should I do today`
- `@Sleuth what should I focus on today`

Third-person aliases (natural-language alternative to `show-me @user`):

- `@Sleuth what are @user tasks`
- `@Sleuth what are @user's tasks`
- `@Sleuth show me @user's tasks`
- `@Sleuth what should @user work on today`
- `@Sleuth what should @user do today`
- `@Sleuth what should @user focus on today`

All aliases route to the same handler (`src/chat-commands/show-me-command.js`) with no handler changes.

Expected Phase 1 behavior:

- Resolve the tagged Slack user (or the caller for self-referential aliases).
- Pull that user's current reminder workload.
- Rank the top 3 items using reminder urgency and GitHub linkage.
- Post a short explanation for why each item was ranked.

## Current Signal Inventory

### Existing high-quality signals

| Signal | Source | Quality |
|---|---|---|
| All reminders assigned to a user | `#GetRemindersTargetingUserID(slackUserId)` | High |
| All reminders a user is involved in | `#GetRemindersInvolvingUserID(slackUserId)` | High |
| Reminder urgency/state | `overdue > due > scheduled > snoozed` | High |
| GitHub issue/PR linked to reminder | `ReminderInfo.GitHubUrls[]` | High |
| GitHub sync status on linked items | `GitHubSyncModule` live polling | High |

### Missing signals

| Signal | Gap |
|---|---|
| Commits pushed last week | Requires `GITHUB_USER_MAP` plus GitHub API activity fetch |
| PRs opened or reviewed last week | Requires `GITHUB_USER_MAP` plus GitHub API activity fetch |
| Current review assignments | Requires `GITHUB_USER_MAP` plus GitHub API activity fetch |

Current state of the missing plumbing:

- `GITHUB_USER_MAP` is designed in `PROJECT/4-MISC/P2-GITHUB-DIGEST.md`.
- `GITHUB_USER_MAP` is not implemented in `src/workspaces.js`.
- The workspace template does not expose it yet.
- No existing runtime path consumes it today.

## Phase 0: Feasibility Spike

**Goal:** prove whether Sleuth already has enough signal to ship a useful show-me command.
**Exit criteria:** Phase 1 is clearly bounded and does not depend on GitHub activity ingestion.

- [x] Confirmed there is already a user-scoped reminder read path with high-quality ownership data.
- [x] Confirmed reminder state provides a useful urgency ladder: overdue, due, scheduled, snoozed.
- [x] Confirmed reminders already carry GitHub linkage through `ReminderInfo.GitHubUrls[]`.
- [x] Confirmed linked GitHub items already benefit from existing sync status.
- [x] Confirmed GitHub activity signals are not yet available and require new workspace config plus new fetch logic.
- [x] Recorded the delivery decision: Phase 1 ships without GitHub activity enrichment.

## Phase 1: Reminder-First MVP

**Goal:** ship a real `show-me` command using only existing reminder data and AI ranking.
**Exit criteria:** in Slack, `@Sleuth show-me @user` returns the top 3 current priorities for that user with short reasons.

- [x] Add a new chat command route for both `show-me @user` and `show-me what tasks @user should work on today` — registered in `#RegisterCommandRoutes()` in `src/chat-module.js`; handler lives in `src/chat-commands/show-me-command.js`.
- [x] Resolve the tagged Slack user ID from the Slack `<@UID>` mention format; reply deterministically if the mention is missing or malformed.
- [x] Read reminders via `RemindersModule.GetAllReminders()` filtered to `AssigneeID === targetUserId` and an active-states set (`scheduled`, `due`, `overdue`, `snoozed`). `AssigneeID` defaults to the original sender at creation time, so this covers both self-assigned and explicitly delegated reminders without the noise of the broader `InvolvingUserID` bucket.
- [x] Filter to active states only; handle the empty-result case with a deterministic Slack reply before calling the AI.
- [x] Build a ranking prompt that prefers `overdue > GitHub-linked + due > due today > scheduled soon > snoozed`.
- [x] Route through `WorkspaceAI.ProcessMessageWithTextResponseAsync`; no ad hoc provider clients.
- [x] Return up to 3 ranked priorities with a one-sentence explanation per item; fewer when fewer reminders exist.
- [x] No access control gate — any workspace member can query any user. Not exposing credentials. ACL can be revisited if real user feedback surfaces a need.
- [x] Add automated coverage for command parsing, empty results, and mixed reminder states — 51 tests in `tests/show-me-command.test.js`.
- [x] Add self-referential `what are my tasks?` alias family — registered in `#RegisterCommandRoutes()` as a separate route; synthesises `<@{caller.user}>` and delegates to the same handler. Covered by 14 new tests.
- [x] Add third-person `what are @user's tasks` alias family — registered as a separate route with a three-alternation pattern capturing the mention across `what are / show me / what should` phrases. Covered by 14 new tests.
- [x] Smoke-test the command in a Slack workspace with at least one overdue reminder and one GitHub-linked reminder.

## Phase 2: GitHub Activity Enrichment

**Goal:** add actual GitHub work signals so Sleuth can compare what a user has been doing versus what they still owe.
**Exit criteria:** given a Slack user ID, Sleuth can fetch recent GitHub activity and merge it with current reminders.

- [x] Add `GITHUB_USER_MAP` to `src/workspaces.js` typedefs and validation.
- [x] Add `GITHUB_USER_MAP` to `config/workspace-template.json`.
- [x] Document the new workspace field in `docs/web-api.md` if it is exposed through workspace CRUD.
- [x] Reuse the existing GitHub auth path rather than introducing a second GitHub token field.
- [x] Implement `FetchUserGitHubActivityAsync(slackUserId, days = 7)`.
- [x] Fetch recent commits for the mapped GitHub user in watched repos.
- [x] Fetch open PRs authored by the mapped GitHub user.
- [x] Fetch PRs currently awaiting that user's review.
- [x] Cross-reference GitHub activity results with reminders already linked through `GitHubUrls[]`.
- [x] Add automated coverage for missing user maps, unmapped Slack users, and mixed repo activity.

## Phase 3: Full Synthesis and Hardening

**Goal:** synthesize reminders plus GitHub activity into a better "work on this today" recommendation.
**Exit criteria:** the command explains the top priorities using both urgency and recent GitHub behavior, with graceful fallback when GitHub enrichment is unavailable.

- [x] Extend the prompt to ask: "Given this user's GitHub activity last week and their current open reminders, which 3 items should they tackle first today and why?"
- [x] Ensure the command falls back cleanly to Phase 1 behavior when `GITHUB_USER_MAP` is missing or activity fetches fail.
- [x] Prefer unfinished, high-urgency overlaps such as "open PR plus overdue linked reminder."
- [x] Add Slack-response wording that distinguishes reminder-only reasoning from reminder-plus-GitHub reasoning.
- [x] Add regression coverage for the fallback path and the combined-signal ranking path.
- [ ] Run a live Slack smoke test covering both a mapped and unmapped user.

## Out of Scope for Phase 1

- Commits pushed last week.
- PRs opened last week.
- PRs reviewed last week.
- Review-assignment awareness.
- New workspace GitHub identity mapping fields.
- Any GitHub API dependency for the first shipping version.
