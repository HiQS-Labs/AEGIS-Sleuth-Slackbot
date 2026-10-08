---
gh_issue: 215
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/215
title: Product Compass knowledge facilitator
status: Proposed (1-INBOX — not yet active)
created: 2026-10-08
updated: 2026-10-08
owner: Codex
doc_type: feedback
effort: 3
complexity: 3
risk: 3
phases: 2
---

# Product Compass knowledge facilitator

Users should ask Sleuth questions about Product Compass releases from Slack channels mapped to Product Compass teams, with frontier-model analysis and contextual thread follow-ups.

Required behavior:
- Sleuth is the conversational entry point and MCP client. Product Compass owns document retrieval and permissions.
- Map Slack workspace/channel to a Product Compass team; clarify ambiguous products/releases.
- Compare product releases such as 1.0 and 1.65 using source evidence and citations. Filename/frontmatter release interpretation belongs in Product Compass.
- Include relevant thread messages and previous synthesized answers, retaining source references and retrieving fresh evidence when needed.
- Preserve WorkspaceAI provider/model routing and workspace isolation.
- Keep personal tokens in a credential store, never workspace/config/environment files or chat/logs.
- Bounded tool workflow, timeouts, fail-closed access, explicit approved channel disclosure scope.
- Ponytail: reuse installed MCP SDK and existing command/context paths; no generic connector framework, new CI jobs, or expansive test scaffolding. Add only major pipeline canaries to existing test infrastructure.

Pending operator decisions: channel-wide versus product-restricted/personal disclosure grants; whether Product Compass RAG is being delivered separately through Lovable or included here. Live MCP verification also requires secure credential provisioning; never request tokens in chat.

Delivery: isolated feature branch, grounded plan, Codex plan/final relay QA, existing applicable gates, ready PR into development. No merge/deploy authorized by this task.

## Initial recon (2026-10-08 UTC)

Base: `cd7b46f99b34095373734225d9263bc8d4356738`, branch `feat/product-compass`.
Graph project: `sleuth-product-compass`, generation `2026-10-08T02:29:43Z`, Verify tier with direct source reads. Coverage checked for all seven initial source/config paths; catalog is excluded and was read directly. Dynamic call edges are incomplete: the graph omits the call from thread assembly to Slack's replies helper, confirmed in source.

- `src/chat-module.js:329`: command registrations close over workspace-owned SlackApp. `ask-woo` at line 532 supplies the nearest external-query registration pattern.
- `src/chat-commands/ask-woo-command.js:43`: admin-gated external query; posts response to the channel thread. Its plaintext workspace token configuration is NOT appropriate for the requested PC secret-store requirement.
- `src/chat-module.js:1195`: mentions run command routing before generic chat; thread assembly is only later at line 1311. A new command must explicitly receive conversation context, not assume generic chat has assembled it.
- `src/chat-module.js:2980`: thread assembly includes prior bot/user messages and uploaded context memory. Sole memory ownership stays in ChatModule; do not add another conversation database.
- `src/slack-app.js:850`: replies helper makes ONE conversations.replies request and does not paginate. It cannot substantiate an entire-thread guarantee. Extend this seam with a bounded, explicit completeness contract rather than silently omit later turns.
- `src/chat-module.js:1407`: existing channel-model processing routes through WorkspaceAI, respecting channel overrides. `src/workspace-ai.js:493,640` provides schema/text APIs across providers.
- `src/workspaces.js:479`: existing durable workspace writer should own channel mapping configuration (credential references only). Never introduce a parallel writer.
- `src/admin-auth.js:118`: AES-GCM secret encryption exists, but alone does not establish a secure PC credential enrollment/storage path. Credential-store choice is unresolved.
- `package.json`: MCP SDK already installed. No new agent framework or transport implementation needed.
- Product Compass checkout `2abd00b`: shared MCP definition registers list_teams, list_products, get_release_brief, get_product_arc. No search tool in that registration. Source observation only; no live endpoint verification.
- `src/lib/mcp/token-gateway.server.ts` in PC maps pc_live tokens to owner sessions and requires optional claimed email to match; `supabaseForUser` preserves user-scoped queries. A team-limited channel grant still needs an explicit contract, not an unrestricted admin PAT silently shared with a channel.

## Outcome and smallest viable bet

One concrete Product Compass workflow using existing command routing, WorkspaceAI, Slack context, and installed MCP SDK. Users can resolve product/releases, compare cited evidence, and ask contextual follow-ups. Product Compass remains the evidence/authorization authority. An ordinary HTTP answer proxy was considered but would discard Sleuth's requested reasoning role. A generic connector marketplace/framework is unnecessary for one integration.

No deployment, PC schema change, plaintext token storage, new CI workflow, broad test framework, proactive notifications, autonomous writes, or unrelated refactor in the initial Sleuth scope.

## Acceptance canaries (proposed)

- Mapped-channel request traverses Slack handler -> scoped MCP evidence -> selected WorkspaceAI model -> cited Slack answer; a follow-up includes prior answer and human thread context.
- Wrong workspace/channel/team/product and revoked credentials produce no protected answer; model-selected arguments cannot widen the allowed scope.
- Missing evidence, unavailable/timeout tools, and truncated context are reported explicitly; no unsupported complete-diff claim.

Use existing Jest pipeline with a small canary file or existing suite extension. No new CI jobs. Existing build, command/AI validators, isolation checks and required final gates remain applicable. Real endpoint/model check stays separately marked unverified until credentials and RAG contract exist.

## Risks, containment, and pending decisions

Feature disabled until an explicit configuration/grant exists. Disable/revoke to roll back; no copied corpus in Sleuth. Channel disclosure is the consequential boundary: personal admin read permission does not alone authorize channel-wide publication. Token custody, team enforcement, citation shape, release snapshot semantics, and PC search availability must be settled before a build-ready plan.

Pending questions sent to operator: authorize team-wide channel disclosure (including guests), selected-products disclosure, or personal access? Is Lovable delivering PC RAG or should this task modify both repositories? These are scope/access decisions, not a request to reauthorize normal start-task steps.

## Rating rationale

2026-10-08 UTC: pri/sev/appeal/effort = 65/35/50/40. Requested new capability; no observed data-loss incident. Priority reflects explicit operator request. Appeal neutral. Delivery spans credential custody, channel scoping, contextual tool orchestration and an unconfirmed upstream search contract, so cheapness is moderate-low. Recent issue scan used 2026-09-24–10-07 versus 2026-09-10–23 (and one earlier day for context); returned issues are unrelated to this new feature. No recurrence claim; incident trend unknown. Existing issues/PRs searched for Compass, MCP, connector and knowledge; no matching active intake found. Plan QA and implementation not started.

## Intake verification

Roadmap row/rating read back successfully; generated dashboard check passed. PDDA frontmatter check reports 12 existing findings in unrelated active documents; none name this intake. No runtime changes or implementation tests yet. Primary checkout remains untouched.
