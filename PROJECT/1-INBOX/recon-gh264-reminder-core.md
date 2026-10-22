---
gh_issue: 264
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/264
title: "Recon: compatibility-preserving reminder core replacement"
status: Proposed (1-INBOX — not yet active)
created: 2026-10-20
doc_type: analysis
roadmap_exempt: true
---

# Recon Map — compatibility-preserving reminder core replacement

Commit: 50fa08c0616af0a79a3431043f68e6ea8db5dd7f. Clean working tree at investigation start, 2026-10-20 PDT.
Mode: graph leads + current source reads. Verify tier. Graph generation2026-10-13T00:42:44Z fast; changed-file metadata means graph line numbers are not current-source evidence. Main lane A plus parallel read-only B(state), C(contracts), D(failures/tests). No production access, runtime mutations, full suites or live model runs.

## Subject and change class
Bounded replacement of reminder scheduling planning/materialization internals behind current names, plus consolidation of legacy content parsing. Cross-module replacement, conservatively irreversible x crossing because published/storage contracts are consumed. No new durable authority: pending JSON stays canonical, event mirror/projections stay non-authoritative. No schema migration in this issue.

## Seams and call paths
| Seam | Confirmed current location | Escape / consequence |
|---|---|---|
| Automatic messages | src/reminders-module.js:1519-1595 | Completion check precedes channel gate; shorthand and vague-context interception precede temporal prefilter; then gateway |
| Mentions / context | src/reminders-app-mention-handler.js:334,741,757,1092,1242 | Auto assignments, enriched references, confirmed proposals, task-above feed same callback with different intent/defaults/source identity |
| Alarm reactions | src/reminders-reaction-handler.js:148-210; reminders-module.js:1330 | Reaction callback excludes SlackApp arg and closes over workspace; app-mention callback455 includes SlackApp; do not homogenize caller signatures |
| Scheduling | src/reminders-module.js:1794-2271 | Analyze, force fallback, weak-reply handling, title selection/dedupe, pointer filter, groups, dates, ownership, factory, dedup, queue, feedback |
| AI | src/reminders-ai-pipeline.js:367,385,786,815,924,1005 | Analyzer, manual title, multi-task proposal have different schemas/results; date and duplicate are additional calls. WorkspaceAI remains provider owner |
| Factory/events | src/reminders-module.js:748-831 | UUID/time/state + client identity + Created/Scheduled events happen before dedup; pure comparison must never call this |
| Queue/persistence | src/reminders-module.js:4427-4458,3975-4005 | Memory/index push -> serialized durable save -> Lists fanout; later rejection can leave committed state |
| Legacy content | src/slack-format-utils.js:267,302; reminders-display-utils.js:176,196; reminders-module.js:2703 | Task bullets and source link parsed back from ReminderMessageText; Lists edits must preserve envelope |
| Authored list rows | src/reminders-module.js:1127-1202; lists-module.js:2710 | Supported non-AI writer, SkipListSync:true; edits round-trip; not a duplicate extraction door to delete |
| Delivery | src/reminders-module.js:4102,4117,4248; reminders-display-utils.js:302,353,386-432 | Snooze/DND/FSM; task-group lifecycle; canonical per-record metadata/reactions; linked bodies cap extras, unlinked retain all |
| HTTP | src/web-api.js:146-164,959-1048 | Reminder routes are GETs; raw/rebalance/admin errors and schemas consumed externally |
| MCP | mcp/sleuth-mcp-server.mjs:65-125; mcp/lib/reminders-store.mjs:1-36 | Reads JSON directly; module facade alone cannot preserve changed storage |
| Event counter-view | src/reminders-projection.js:115-135,385,684; deploy/reminders-export/events-projection.js | Authority flags deliberately blocked; do not revive them; raw text copied into events and old history |

## Public function contract inventory
Freeze exports/import paths, constructor and module getter/static surfaces, optional/default arguments, property presence, asyncness and failure behavior before implementation. Main class methods verified by lane C: GetAllReminders924 (array copy, object references retained), GetWorkspaceSnapshot962, GetCompletedRemindersBetween1030 (inclusive start/exclusive end), ReadAllEventsAsync1041, CompleteReminderByIdAsync1062, CompleteReminderFromListAsync1084, CancelReminderFromListAsync1105, UpdateReminderSummaryFromListAsync1127, CreateReminderFromListRowAsync1164, SetListsModule1208, SetGitHubSyncModule1224, StartAsync1233, ShowRemindersForUserDeterministicAsync1419, RunDailyDigestNowAsync1438, CheckRemindersNowAsync1448, GetPendingReminders1456, StopAsync1464, AreRemindersEnabledForChannel1490, GetDndSettings1498, IsDndActiveForChannel1507, HasAnyDndActive1515, FlushRemindersAsync3927. Getters DataLoaded/DataLoadError/WorkspaceAI/SlackApp900-918, ListsModule1216. Statics GetAssigneeIDs843, IsAssignedTo874, DescribeTitleContract2740, BuildGitHubMonitoringFeedback2755, ParseDeadlineConventionNextMs3333, ComputeProactiveSignalsFromData3440, RenderProactiveSection3563.
RemindersAIPipeline constructor and SetDecisionCapture/LoadInstructionsAndSchemaAsync/AnalyzeMessageForRemindersAsync/ExtractManualReminderTaskAsync/GetReminderTriageAsync/ExtractDateWithGptAsync/CheckForDuplicateReminderAsync/ExtractMultiTaskCandidatesAsync/AnalyzeTrashedExamplesAsync stay stable, as do CommonJS exports of title contract, display selection, display utils and slack-format-utils.

## State and downstream N+1 checks
- One trigger group -> one ReminderID -> many task bullets -> shared assignment/lifecycle. Mixed-owner collapse is currently documented, not silently repaired by a parity rewrite.
- Queue save before Lists; Lists creates shared + registered owner rows(lists1242-1268); summary edit reconciles through UpdateReminderSummaryFromListAsync, then save. No new parallel writer.
- Delivery uses compact canonical poster; one completion reaction consumes record identity, not individual bullet identity. Target and distinct original channels may both receive delivery. Per-record permalink lookups are existing behavior, not a new optimization target.
- Completion and projection consumers accept legacy body strings; event Created+Scheduled is audit-only and currently emitted before queue acceptance. Mirror errors are nonfatal(680-706).
- Gateway true means consumed, including weak-reply suppression without creation1879; false ignore/no group1982,2270; feedback rejection after durable queue can escape2262.
- Save failure leaves memory/index changes; Lists failure after save can suppress confirmation. Retry is constrained by message-ID dedup2182, not transactional rollback. Serialized save chain recovers after failed previous save3974.
- Modes are constraints/hints: explicit intent bypasses long-message auto exclusion; force additionally defaults time and bypasses semantic duplicate, but never exact message-ID duplicate. They are not interchangeable generators.
- Rollback: preserve legacy JSON/body/schema/flags and existing lifecycle primitives; revert implementation commit without data backfill. Do not write twice or execute both full gateways for shadowing.

## Verification and falsification ledger
1. Code size is a lead, not proof of redundancy. Scheduling combines distinct responsibilities; helpers already own title, grounding, ownership, context and AI calls. Reuse them.
2. Hypothesis 'several independent schedulers': rejected. There is one FSM gateway, but several extraction contracts and distinct adapters. A second live scheduler would increase complexity.
3. Hypothesis 'a schema migration is required': not established. Existing fields can be materialized from an internal plan without altering files/HTTP/MCP. Migration deferred.
4. Hypothesis 'same function names / same final records proves parity': rejected by handled-boolean, pre-dedup event timing, post-save Lists failure and post-commit feedback failure.
5. Hypothesis 'always synthesize has zero added calls everywhere': overbroad. Manual force path conditionally calls ExtractManualReminderTaskAsync(1848); automatic analyzer display selection is different. Model budget must be measured per door, not inherited from old GH79 claims.
6. GH250 title contract is already shipped in1.4.346; do not claim absent. GH250 same-day comments already contain phases3-6/new ExtractRemindersAsync and a consumer inventory. New issue coordinates bounded replacement, not competing implementation work.
7. scripts/decision-replay.js141-145 stubs first analyzer call only; useful but not orchestration parity. Live replay already has record/count/no-copy/source-link assertions(utils225-242). FSM validator scans module only; keep mutation primitives there.
8. ask-self orientation attempted but unavailable without configured Gemini synthesis key; no secret provisioning. Graph and direct source used instead.

## Unknowns
| Unknown | Why it matters | Settlement |
|---|---|---|
| Post-50fa08c/in-flight changes(#258/#262,#250phase3+) | Baseline may change | Refresh git/PR state and source manifest at implementation phase0 |
| Cross-repo/deployed-machine consumers | Prior GH250 inventory is supplied, not independently re-read here | Revalidate GH250 consumer paths in rebalanceOS/git-pulse/deployed skills before any future wire/storage change; current issue preserves bytes |
| Current full-suite baseline and failure injection behavior at runtime | Source trace is not witnessed parity | Existing suites in disposable full clone plus effect-recording/fault controls before cutover |
| Current model variance/cost across doors | Deterministic replay cannot assess unseen extraction | Existing real-model replay/#260/ATE with anonymized samples; separate quality acceptance |

## Radius
Slack handlers, reminder orchestration + AI helpers, durable queue/indexes, Lists round-trip, canonical rendering/delivery/reactions, completion/event mirror, HTTP/admin/MCP/local export consumers. Production deployment and cross-repo rewrites are outside this planning task.
