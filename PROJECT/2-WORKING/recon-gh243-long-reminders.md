---
title: "Recon: GH-243 long reminder messages"
created: 2026-10-12
updated: 2026-10-12
status: Reference
owner: noel
goal: Record the bounded current-state trace for GH-243.
roadmap_exempt: true
---
# Recon Map — long reminder messages

## Status

| What was just completed | What's next |
| --- | --- |
| Bounded recon reconciled from source and graph leads. | Implement/review through the canonical GH-243 project plan. |
Commit: 40a911aeea55d1a00e70747fc61d9a574b88c61f · Mode: graph+source · Lanes: parent A, read-only agents B/C and D.
Graph project aegis-sleuth-slack-bot generation 2026-10-13T00:42:44Z; source paths no recorded gaps.
Tests, data/static and docs excluded by fast indexing; direct reads used. Coverage is best-effort.

## Subject and change class
Slack-message reminder admission and display, crossing persisted presentation/consumer contracts.
No new persistence schema, queue, provider or authority. Existing judgement remains the admission owner.

## Seams
| Seam | Location | Crosses / breaks if |
| --- | --- | --- |
| Auto vs force judgement | src/reminder-judgement.js:203–279; src/reminders-ai-pipeline.js:368 | Auto and triage must agree; explicit scheduling must remain available. |
| Post-model override | src/reminder-judgement.js:247–265 | Model ignore becomes schedule; entire enriched source manufactured as title/span. |
| Force fallback | src/reminders-module.js:1830–1860 | Reuses manual title extraction, currently falls to whole source on failure or flags off. |
| Shared selection | src/reminder-display-selection.js:48–103,188 | Grounding, overcompression, flags and absent title can each return an unbounded span/original. |
| Persisted body | src/reminders-module.js:2038,2778–2830 | Full blockquote persists even with concise title. |
| Ownership | src/reminders-module.js:2063,2726 | Scrapes the quote; deleting quote without using original source changes assignees. |
| Confirmation | src/reminders-module.js:2629–2694 | No explicit source link; selector can emit multiline blob. |
| Explicit task-above | src/reminders-app-mention-handler.js:1241 | Passes force=false, short live command + long analyzed source. |
| Explicit confirmed proposals | src/reminders-app-mention-handler.js:1092 | Passes force=false, candidate title and original source timestamp. |
| Scheduled/list display | src/reminders-module.js:4187; src/reminders-display-utils.js:284 | Canonical compact renderer already limits tasks and source-links records; reactions use metadata. |

## Call paths and state
Slack automatic messages/enrichment, alarm-clock reactions and task-above/confirmed proposals -> injected
TryScheduleRemindersAsync -> judgement -> date/dedup -> composer + selector -> MakeScheduledReminder ->
QueueReminderAsync -> workspace JSON/event ledger. Composer has one scheduler caller. Queue has this
caller and separate list-row creation (src/reminders-module.js:1197).
Direct list-row summaries have no original Slack-message source; excluded from this Slack-message project.
OriginalChannelID, OriginalMessageID and OriginalThreadTs already carry source identity; no new fields needed.
Legacy records remain readable and are not rewritten.

## Failure and operations
Verified production 2026-10-12 23:24:49 UTC: deterministic fallback activated; msg_len=2178,
sentences=21, synthesis=on, routed_by=enriched_context, actionable_span_ratio=1. Confirmation length 2523.
Production judgement and selector hashes matched parent checkout. No tenant transcript saved here.
Parent probe reproduced incidental past-tense today becoming trigger and full message becoming fallback text.
Tests currently deliberately assert fallback scheduling, long flag-off verbatim and full long quotes.
Existing real-model replay grades first bullet lines only, so whole-body copy/link assertions need extension.
Snooze/FSM/tenant/reaction contracts unchanged. Rollback code deployment; no data migration.
Slack permalink failures return null; preserve channel reference and bounded title, never restore a long quote.

## Unknowns
| Unknown | Why it matters | Settle with |
| --- | --- | --- |
| Real-model summarization quality on long lists | Unit tests stub model | Existing utils/reminder-replay.js with anonymized long alarm/list case. |
| Permalink unavailable/deleted source | Cannot promise working access without Slack | Null-permalink integration check; show channel reference instead of blob. |
| Historical long records | Existing records may still have source quotes | Explicitly deferred; no rewrite or migration in this project. |

## Current-state radius
Slack-message creation/triage/ownership/confirmation, workspace reminder body, event projection/rebalance readers,
canonical delivered digests and per-reminder reactions. External consumers retain stored body shape.
