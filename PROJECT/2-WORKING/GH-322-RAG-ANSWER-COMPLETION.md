---
title: Refuse incomplete code RAG answers
gh_issue: 322
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/322
status: In Progress
created: 2026-11-09
updated: 2026-11-09
owner: Codex
goal: Return completed source-backed code answers and expose safe provider usage for measurement.
doc_type: bugfix
effort: 1
complexity: 1
risk: 2
phases: 1
roadmap_exempt: true
---

# GH-322 — RAG answer completion

## Status

| What was just completed | What's next |
|---|---|
| Plan QA approved; implementation,3 focused regressions,build and main/adjacent smokes complete | Final independent code QA and exact-head hosted CI; dev audit remains separate |

## Observed problem and recon
Base7e9e58f. Slack ask-self handler delegates to src/rag/index.js askSelf/queryRagAsync/synthesize; synthesize requests2500 output tokens and returns the first nonempty text without inspecting finishReason. Existing generic handler error path can reject failed synthesis. Native reproduction on a public-code event-routing question: HTTP200,modelgemini-3.1-pro-preview,50430prompt/2397thought/99visible tokens,finishReasonMAX_TOKENS,one non-thought text part529characters. This is truncated output,not a discarded final part. Independent retrieval/index quality is a separate audit concern. No reminder mutation or data corruption observed.

## Requirements, smallest bet and non-goals
Extend synthesize only:8192 output cap; requireSTOP completion; preserve existing empty-answer rejection; log only modelVersion,finishReason and usageMetadata through existing console output. No new service/provider/client/helper,model switch,prompt/retrieval/FSM changes or production rollout. Existing workspace gate/Slack formatter/catch remain. Raising the cap addresses the observed thinking-heavy truncation; the guard prevents incomplete drafts from being presented as completed answers; metadata supports request-cost reconciliation. These effects must be measured separately.

## Rating rationale
Rated75/55/50/85: user-selected audit critical path,moderate recoverable loss of answer usefulness,no data-loss incident,appeal neutral,small existing-function repair. Recent14day versus prior14day incident trend unknown; this pilot has one distinct reproduced cap/acceptance failure,not ten independent incidents. Task rating is in the existing RELEASES writer; PDDA effort/risk are separate.

## Ordered plan and falsifiable checks
1. Independent plan QA before runtime edits. Read entire existing function/handler,grade bounded cap/guard/safe logging and existingqueryseams. No speculative multipart or provider refactor.
2. Focused Jest coverage through existing queryRagAsync/_resetForTesting seams: completedSTOP answer,nonemptyMAX_TOKENS rejected,emptySTOP rejected. Witness baseline nonemptyMAX accepted red. No additional framework/fuzzer. Fix the existing function and run focused suite/build; record manual main/adjacent smoke in TESTS-RESULTS/2026-11-09+GH-322.
3. Final independent code QA,required source gates and exact-head hosted checks. Preserve known local full-suite baseline failure explicitly. No feature version bump. Ready PR into development; merge separate.
4. Authorized bounded development-only audit may qualify a temporary source branch through normal deployment with verified full backups,repeat same frozenquestions/index/prompt/model settings,retain exact source/provider evidence and restore prior development branch. No server test harness or production changes. Actual authorization and operational receipts remain private; this plan grants no additional deployment authority. Record deployment persistence gaps and real failures,not just HTTP/transport passes.

## Scope, risks and rollback
One existing query module plusfocused tests andgovernance. Larger output allowance raises per-call cost and latency; reserve bounded input/output includingthinking before paid calls and keep the audit's existing hard budget/deadline. NonSTOP is now a clean generic lookup failure rather than a partial answer. Revert source commit to restore prior cap/acceptance; no DBschema/index migration. Existing model alias maymove; record resolved model/version. Current index excludesRAGsource; stale-corpus answer errors remain distinct from completion handling.

## Lessons Learned (For Future Agents)
NO_ENTRY pending measured repair result. A successful provider HTTP response is not necessarily a completed code answer.
