---
title: Keep the client name outside the hyperlinked reminder title in list lines
gh_issue: 328
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/328
status: In Progress
created: 2026-11-13
updated: 2026-11-13
owner: Claude
goal: Reminder list lines show the inferred client name as plain text before the linked task title, not inside the link.
doc_type: bugfix
effort: 1
complexity: 1
risk: 1
phases: 1
---

# GH-328 — Client name outside the reminder link

## Status

| What was just completed | What's next |
|---|---|
| Implemented (b12b3b4); red/green, smoke and full gate recorded; final Codex QA PASS/Approved (`relay-system/2026-11-13/gh328-final.md`) | PR into development; promote to main with the next release |

## Requirements and smallest viable bet
Observed in production on 2026-11-13: a client-mapped reminder renders as `C.) <permalink|Client A - Automate new meeting summaries …> · @owner · …`. The operator wants the client/project name out of the hyperlink. Smallest bet: keep the GH-395 client label visible, rendered as plain text before the link: `C.) Client A - <permalink|Automate …>`.

Non-goals: no change to client resolution (`ResolveClientNameForReminder`), to `ApplyClientPrefix`, to stored reminder text, to the confirmation bullets or the extra Key-task bullets (neither is linked), or to the published rebalance export (it never adds a prefix). A title whose own stored text already begins with the client name stays as written, inside the link.

## Recon and evidence
Base `f1edf49`. `BuildCompactTextForReminder` (`src/reminders-display-utils.js`) calls `ApplyClientPrefix(ExtractCompactSummary(...), ResolveClientNameForReminder(...))`, then passes the prefixed string as `Summary` to `BuildCompactReminderLine`, which wraps the whole summary as `<permalink|summary>` (or appends `↗︎` when the summary carries Slack tokens). `BuildCompactReminderLine` is also called by `show-rebalance-reminders-command.js` with export summaries built from `ExtractCompactSummary` alone (`src/web-api.js`), so that path has no prefix and is unaffected. Read-only production check: the reported reminder's stored Key task has no client prefix; none of the stored Key tasks in that workspace begins with a `Name - ` prefix. The prefix is purely render-time. Prior art: no open or closed issue/PR covers this; GH-395 introduced the prefix.

## Rating rationale (2026-11-13)
PRS rated 45/20/50/90. Severity 20: cosmetic, no data or work lost; it affects every client-mapped line on every list surface. Priority 45: operator-requested now. Appeal 50: neutral (no operator value given). Effort 90: one pure-function edit plus existing-suite cases. Recurrence: one report; the shape has existed since GH-395, trend unknown. No operator override.

## Plan and falsifiable acceptance
1. Add `ClientName` (optional) to `BuildCompactReminderLine`'s parts; when set, render `${ClientName} - ` before the summary link. In `BuildCompactTextForReminder`, resolve the client name once, pass the bare summary as `Summary`, and pass `ClientName` only when `ApplyClientPrefix` would actually have added it (so an already-prefixed stored title is not doubled). Reuse the same `ClientName` for the extra Key-task bullets.
2. Tests in the existing `tests/reminders-display-utils.test.js`: (a) `BuildCompactReminderLine` with `ClientName` puts the name before `<permalink|…>` and not inside it; (b) without `ClientName` the canonical line is byte-identical to today's; (c) Slack-token summary keeps the `↗︎` form with the name in front. Red control: assertion (a) fails on the unchanged builder (name ignored). Check that an existing `BuildCompactTextForReminder` caller test still passes.
3. Smoke: drive `BuildCompactTextForReminder` with a mapped client (main path) and with a stored title already starting with the client name (adjacent path); record under `TESTS-RESULTS/2026-11-13+GH-328/`.
4. Full gate once on the final commit (Jest + Node, build, validators, sanitize-scan); CHANGELOG entry; final independent Codex relay QA; PR into development.

Plan QA skipped: the change is obvious, local, reversible and pure; the one design choice (keep the name visible, outside the link) follows the operator's wording. Final QA still applies.

## Alternatives and rollback
Dropping the client label entirely was rejected: GH-395 added it on purpose and the request is about the link, not the label. Stripping the prefix inside `BuildCompactReminderLine` by pattern was rejected: the builder would have to guess which leading words are a client. Rollback: revert the commit; render-only, no data or migration.
