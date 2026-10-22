---
gh_issue: 264
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/264
title: "Reminder core: bounded semi-clean-room rewrite with API and function compatibility"
status: Proposed (1-INBOX — not yet active)
created: 2026-10-20
doc_type: feedback
effort: 4
complexity: 4
risk: 3
phases: 5
related: "GH-250, GH-79, GH-261, GH-149, GH-260"
---

# GH-264 — Reminder core replacement behind existing contracts

User requested a semi-clean-room rewrite plan for the messiest reminder internals, preserving API endpoints and function-name compatibility. The source-pinned plan, discussion and detailed acceptance matrix are in [GH-264](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/264). No implementation has started.

Grounded by four read-only recon lanes at `50fa08c0616af0a79a3431043f68e6ea8db5dd7f`; see [the recon map](recon-gh264-reminder-core.md). The graph was stale for changed files; current source was verified directly. No full suite, production probe or model experiment was performed for this plan.

## Boundary

Replace internal scheduling planning/materialization computation behind the current gateway and named methods. Consolidate legacy reminder-content interpretation behind existing exported helpers. Reuse grounding, ownership, context, title-contract and date helpers. Keep existing factory/FSM/queue/durable-save owners and side-effect ordering.

Preserve endpoint paths/auth/query/default/error envelopes; import/export/function/class/constructor names and signatures; sync/async/default/return/error semantics; callback call shapes; legacy JSON/body/metadata/history; List edits and authored rows; source identity/shared assignees; long-message safety; snooze/DND/tenant isolation and terminal/retry behavior.

An in-memory plan is sufficient initially. No durable schema migration, provider/client/dependency, second live scheduler, projection-authority change, Chat/Lists rewrite, production deployment or external consumer migration is in this intake.

## Ordered phases

0. Characterize contracts, source/caller inventory, ordered effect/failure/retry baseline, and overlap with GH-250.
1. Author the internal planning implementation from behavioral fixtures, preserving existing entrypoints as thin policy-free façades and current mutation ownership.
2. Consolidate legacy content parsing behind current names without changing durable format or consumer outputs.
3. Cut over through existing names; compare frozen provider results for exact parity and real-model replay for quality. Verify rollback. Live comparison never executes effects twice.
4. Delete displaced internal policy/parsers/comparison scaffolding, lower relevant GH-261 counters when available, and document the surviving compatibility boundary.

## Acceptance highlights

- Positive scheduling, nonempty multi-task, endpoint/default/error and optional-field fixtures prevent vacuous parity.
- Preserve handled-vs-created booleans, force-vs-explicit distinctions, exact-message duplicate handling and one-trigger-group lifecycle cardinality.
- Compare calls/order, queue/indexes, persisted records, Lists, events, Slack bodies/metadata and return/rejection behavior; final counts alone are insufficient.
- Characterize factory events before dedup; queue mutation before save; List failure after persistence; feedback rejection after commit; subsequent request/retry behavior. Do not hide bug fixes inside equivalence.
- Existing integration/API/MCP/List/title/decision/replay/structural checks supply coverage; witnessed red controls and revision-bound results are required during implementation, not claimed today.
- Fewer independent decision owners and duplicate parsers; moving the same branches into more files does not satisfy completion.

## Coordination and open questions

GH-250 already contains the title-contract implementation and staged extraction/storage simplification plan. This issue is the compatible internal replacement workstream, not a competing extraction project. Phase0 must reconcile ownership and choose the simpler deletion-only GH-250 route if a fresh core adds no demonstrated value. Schema/feature-flag retirement needs separate acceptance; external consumer formats remain unchanged here.

External/deployed-machine consumer audit, current runtime failure behavior and live-model variance remain unverified in this planning pass. Refresh baseline and in-flight PRs before execution.
