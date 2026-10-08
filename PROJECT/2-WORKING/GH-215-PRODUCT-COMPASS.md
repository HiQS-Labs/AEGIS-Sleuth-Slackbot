---
gh_issue: 215
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/215
title: Product Compass knowledge facilitator
status: In progress
created: 2026-10-08
updated: 2026-10-08
owner: Codex
doc_type: project
goal: Cited Product Compass release answers and contextual follow-ups through Sleuth
reversibility: Easy — disabled without channel mappings
effort: 3
complexity: 3
risk: 3
phases: 2
---

# Product Compass knowledge facilitator

## Status

| What was just completed | What's next |
|---|---|
| Recon and operator access/scope decisions recorded | Codex plan QA |

## Table of contents

- [Phase 1: Integration](#phase-1-integration)
- [Phase 2: Verification and handoff](#phase-2-verification-and-handoff)

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

Operator decisions: channel membership (including contributors without PC accounts) authorizes access to the mapped PC team. Mapping is the admin grant. Lovable owns PC RAG; this task changes Sleuth only. Live MCP verification also requires secure credential provisioning; never request tokens in chat.

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

Resolved by operator: mapped channel membership is sufficient; no per-user PC sign-in. Lovable implements PC RAG. Latest evidence within each named product release is the default, with no historical-upload or immutable-snapshot promise. Search result completeness must never be conflated with exhaustive release scope.

## Rating rationale

2026-10-08 UTC: pri/sev/appeal/effort = 65/35/50/40. Requested new capability; no observed data-loss incident. Priority reflects explicit operator request. Appeal neutral. Delivery spans credential custody, channel scoping, contextual tool orchestration and an unconfirmed upstream search contract, so cheapness is moderate-low. Recent issue scan used 2026-09-24–10-07 versus 2026-09-10–23 (and one earlier day for context); returned issues are unrelated to this new feature. No recurrence claim; incident trend unknown. Existing issues/PRs searched for Compass, MCP, connector and knowledge; no matching active intake found. Plan QA and implementation not started.

## Intake verification

Roadmap row/rating read back successfully; generated dashboard check passed. PDDA frontmatter check reports 12 existing findings in unrelated active documents; none name this intake. No runtime changes or implementation tests yet. Primary checkout remains untouched.

## Phase 1: Integration

Smallest viable implementation: two concrete files (`src/product-compass.js` for config, credential read, bounded MCP and AI workflow; `src/chat-commands/ask-compass-command.js` for Slack IO), plus existing ChatModule/SlackApp/workspace/catalog edits. No new module lifecycle or generalized connector abstraction. Existing installed MCP SDK handles Streamable HTTP.

- [ ] Add optional workspace `PRODUCT_COMPASS_CHANNELS` JSON string, keyed by channel ID; each entry contains TeamId and CredentialName. Existing workspace CRUD/SaveWorkspaceInfoAsync remains the configuration writer. Configuration by an administrator is the explicit mapping/grant; all members of that channel may query. No PC personal login per contributor. Missing mapping fails closed.
- [ ] Read PAT using native credential stores: systemd's CREDENTIALS_DIRECTORY (provision encrypted credentials using systemd-creds) on Linux, macOS Keychain for local runs. Store references only in workspace config. Names constrained, no arbitrary paths/commands, no token-bearing logs. Read on every request; no credential cache. Fixed Product Compass HTTPS origin/endpoint for this first integration, deny redirects to avoid forwarding credentials to another origin. No OAuth/browser fallback.
- [ ] Register `ask-compass` in ChatModule and catalog. In mapped channels, ordinary mention fallback and existing hands-free reply flow run the same PC handler before generic chat. Existing explicit commands retain precedence. Pass workspace-owned WorkspaceAI and channel model override; no provider clients or global state.
- [ ] Reuse ChatModule thread assembly including prior assistant responses and attached context files. Extend SlackApp's replies helper with opt-in bounded pagination (5 pages of 100); unchanged default for other callers. If incomplete or context exceeds 60k characters, fail clearly and request a narrower/new thread rather than silently lose context. Always include current event explicitly, and disregard later messages beyond its timestamp. No new conversation persistence or summarizer. Long-thread summarization is deferred; complete bounded context plus explicit refusal is honest and smaller.
- [ ] Connect MCP per request, list tools, fetch list_products for the mapped TeamId. Never expose list_teams or arbitrary tools to the model. Validate product/release IDs against this scoped catalog before any selected fetch. Use DecideAsync with a static schema/prompt for at most 4 evidence calls and one final answer. One session per request; always close in finally. Bound catalog, tool response, question and prompt sizes; MCP call/connect timeouts; no automatic retry loops. Apply the existing provider request limits; an overall workflow deadline prevents further calls after expiration.
- [ ] PC search contract: `search_documents` tool accepts query and team_id; optional product_id/release_id only if advertised and validate against scoped catalog. If a requested filter cannot be expressed, decline it; no unfiltered fallback. Treat returned passages as data, not instructions. Use source IDs, titles, release/version and links provided by PC; distinguish inference from source facts. Existing get_product_arc/get_release_brief remain usable while RAG is absent, but say when document search is unavailable. Validate tool input schema compatibility at discovery; no guessed aliases or arbitrary pass-through.
- [ ] Return a grounded frontier-model analysis with source references. Enforce source URLs/IDs against evidence when rendering citations; do not let model-authored references become fabricated sources. Absent evidence yields clarification/no-evidence reply. A retrieved subset cannot prove a feature was removed. Include model selection guidance in operator docs; do not hardcode a new frontier model/default.

### Phase 1 QA

- [ ] Plan relay Approved before implementation. Use debug-mantra for concrete failures.
- [ ] One scoped canary suite, approximately three pipeline scenarios (table cases within them where necessary): actual Slack ingress + context/model/tool loop; access and invalid scope fail-closed; unavailable/timeout/malformed/oversized evidence. Reuse Jest and mock SlackApp, plus an in-process SDK MCP test server only if needed to prove transport/header behavior. No new CI jobs, dependencies, runners, fuzzers or per-helper test proliferation.
- [ ] Canary red controls: remove scope guard -> unauthorized case fails; remove thread context -> follow-up case fails; remove tool limit -> bounded-failure case fails.

## Phase 2: Verification and handoff

- [ ] Run focused canaries and existing affected thread/workspace/catalog tests during iteration; build and validate AI/catalog/help/isolation for final diff. Add behavior CHANGELOG entry without package version bump. Final existing qualifying tests once after final review, not on each doc edit. No reminder quality replay unless reminder paths/assets are changed.
- [ ] Final Codex relay QA with explicit no-overbuild envelope; three-round cap. Capture actual verdict, commands and limitations. Preserve reviewer/author separation.
- [ ] Push branch and open PR into development; never merge/deploy in this task. Report upstream PC RAG/live auth as unverified until a real integration smoke is possible, do not label mocked tests live end-to-end proof.

### Phase 2 QA

- [ ] Verify PR head/base and required check outcomes. Production activation remains disabled until admin maps a channel and provisions credentials.
- [ ] Manual integration acceptance once Lovable has deployed: tools/list shows search schema, correct scoped search/citations, two-release comparison plus a follow-up; revoke token and observe denial. Requires secure token provisioning, no token in chat/config/env.

## Containment and remaining unknowns

Sleuth's authorization is the workspace/channel grant plus PC's token-owner RLS. Because one PAT may reach several teams, server-side tool filters and Sleuth ID guards must constrain the mapped team. Search tool team_id behavior is an upstream PC contract and must be live-verified before activation. No automatic mapping or production secret enrollment in this PR.

Blast radius: opt-in mapped channels, Slack replies helper's optional pagination, workspace validation and shared catalog registration. Existing unmapped paths unchanged. Disable by removing mapping; revoke credential to stop upstream access. Log only workspace/channel, step/tool name, duration and stable failure category, not raw upstream errors or evidence. Unauthorized disclosure is the tripwire to revoke immediately. Code rollback easy; an already published Slack answer cannot be undisclosed.

Unverified: Lovable's eventual search schema and citation envelope, PC live filtering/index status, usable production credential-store provisioning, frontier model live quality. The implementation will negotiate only the narrow supported search shape and fail safely on incompatible schemas. A real smoke remains a deployment prerequisite, not a claim from mocked canaries.
