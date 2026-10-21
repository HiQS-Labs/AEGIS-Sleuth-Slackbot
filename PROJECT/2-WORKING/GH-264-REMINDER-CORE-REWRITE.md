---
title: "GH-264: compatibility-preserving reminder core rewrite"
status: Working (2-WORKING)
created: 2026-10-20
updated: 2026-10-20
owner: noel
doc_type: project
gh_issue: 264
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/264
branch: codex/AEGIS-Sleuth-Slackbot-gh264-reminder-core-rewrite-2026-10-20
complexity: 4
risk: 3
effort: 4
phases: 5
goal: Replace tangled reminder planning and legacy-content internals behind unchanged contracts, in cherry-pickable commits.
---

# GH-264 — compatible reminder core replacement

## Status

| What was just completed | What's next |
| --- | --- |
| Final Codex QA Approved at fe929bf; build and full gate passed (2,806 Jest +116 Node tests). | Publish reviewed PR against development; await merge decision. |

## Quad Concepts

- One decision owner, one effect owner; preserve externally consumed contracts.
- New internal computation is descriptive, with no durable state authority.
- Tests compare real outcomes and failure/effect ordering, not just renamed symbols.

## Execution record

- User authorized plan QA with CommandCode → GLM 5.3 max, then implementation, with separable commits for combination with GH250. No merge or deployment authorized.
- Base: origin/development at50fa08c; full clone uses canonical remote, installed hooks. Primary checkout's GH264 intake/ledger edits remain preserved untouched.
- Related open #263 is GH250 phase4 plan-only. This issue makes no durable task-schema/reader-authority change and does not cherry-pick that plan/code implicitly. Preserve GH250's normalization contract.
- Ratings65/45/50/35 persisted through canonical CLI: priority65 (explicit operator work, not outage); severity45 (maintenance risk, not a fresh reproduced data-loss incident); appeal50 neutral; cheapness35 (subsystem compatibility work). Recurrence trend unknown: GH243/250/149 are related historical reports, not counted as new incidents. Two14-day windows were not exhaustively audited; no acceleration claim.
- Test scope: extend existing integration/format/display/API suites only where a concrete gap is shown; no new runner/framework/CI lane. Existing full gate once on final reviewed code; pure probe and focused checks during iteration. Runtime/mutation-heavy tests use disposable gate clone.
- Independent source consistency pass on the filed plan found no blocking contradiction. Required model plan QA subsequently passed; receipt below.

## Published plan under review

## Outcome

Replace the most tangled **reminder planning/materialization internals** with a small implementation written from a behavioral specification, while retaining existing API endpoints, function names, import paths, signatures, defaults and observable behavior. Consolidate the legacy reminder-content reader behind existing helper names.

This is a **bounded semi-clean-room rewrite**, not a rewrite of AEGIS: independently express the internal computation from characterized inputs/outputs; reuse proven grounding, ownership, context, title-contract and date helpers; keep current public façades and durable-state owners. Do not copy the current nested gateway into a new class and call that simplification.

**Status:** proposed plan; no implementation or rollout authorized by this issue. User requested this issue after an architecture assessment. Code evidence is pinned to `development` **50fa08c** (2026-10-20); refresh it before execution.

## Coordinate with existing work

- #250 already tracks extraction/display simplification, structured fields, a new extraction core, and parser retirement. Its same-day comments explicitly choose “finish the refactor, don't rewrite,” while allowing a bounded new `ExtractRemindersAsync` implementation. This issue applies that boundary to scheduling orchestration/content access; **do not open a second competing extraction or schema project**. Reconcile task ownership with #250 before starting; cross-link PRs instead of implementing either phase twice.
- #252 has already shipped the title contract: grounding, normalization, validation, fallback and word/character budgets. Reuse it; these are not missing capabilities.
- #79 supplies the policy: delete duplicate intent implementations, retain spend/safety prefilters and deterministic verifiers. Its historical call-cost claims need per-door revalidation, particularly manual force synthesis.
- #261 / open #262 provide an inventory ratchet; reuse it when landed, without another analyzer, runner or CI lane. Do not hold characterization hostage to its merge.
- #149 remains the extraction-variance/ambiguous-reference issue; #260 owns model benchmarking. A rewrite must not claim either solved by reorganizing code.
- Rebase the plan around intervening work, including #258, rather than undoing it.

## Ground truth / bounded recon

Four read-only lanes examined ingress, state/downstream consumers, API/function contracts, and failure/testing behavior. Graph generation was October13 and stale for changed files: graph results were leads, and material edges were verified in current source. No suites, failure injections, live model runs or production probes were executed for this planning issue.

| Observation | Current evidence / consequence |
|---|---|
| One scheduling gateway already exists | [src/reminders-module.js:1794](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L1794). It owns analysis, force fallback, weak-reply handling, selection/dedupe, reference filtering, grouping, dates, ownership, factory, duplicate checks, queue and feedback. The problem is intertwined policy/effects, not absence of a gateway. |
| Input adapters have real differences | Automatic message entry [src/reminders-module.js:1519](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L1519), mention/context/proposal/task-above calls [src/reminders-app-mention-handler.js:334](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-app-mention-handler.js#L334), [src/reminders-app-mention-handler.js:1092](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-app-mention-handler.js#L1092), [src/reminders-app-mention-handler.js:1242](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-app-mention-handler.js#L1242), alarm callback [src/reminders-reaction-handler.js:205](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-reaction-handler.js#L205). Preserve explicit intent separately from force/default-time/dedup behavior. |
| String rendering is a data contract | `ReminderMessageText` is persisted/exported, then task bullets are parsed by [src/slack-format-utils.js:267](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/slack-format-utils.js#L267) and [src/reminders-display-utils.js:176](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-display-utils.js#L176). Confirmation even retrieves its source link from that body [src/reminders-module.js:2703](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L2703). |
| Durable ownership is already centralized | Factory [src/reminders-module.js:748](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L748), transition [src/reminders-module.js:523](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L523), serialized save [src/reminders-module.js:3975](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L3975), queue [src/reminders-module.js:4427](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L4427). Keep these owners; projection-authority flags remain deliberately blocked [src/reminders-projection.js:115](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-projection.js#L115). |
| Lists are a separate supported writer | [src/reminders-module.js:1127](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L1127), [src/reminders-module.js:1164](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L1164): summary edit and authored-row creation, including `SkipListSync:true`. This is intentional non-AI input, not a redundant extraction pipeline. |
| Full scheduling parity is not covered by decision replay | [scripts/decision-replay.js:141](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/scripts/decision-replay.js#L141) intercepts the first analyzer call; dates/dedup/materialization require existing integration suites. Live quality replay already checks no-copy, count and source-link outcomes [utils/reminder-replay.js:225](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/utils/reminder-replay.js#L225). |

### Compatibility perimeter — freeze before replacement

**HTTP:** retain `GET /workspace/:name/reminders` and `GET /admin/dashboard/reminders?workspace=…` ([src/web-api.js:157](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/web-api.js#L157), [src/web-api.js:959](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/web-api.js#L959), [src/web-api.js:1020](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/web-api.js#L1020)). Preserve bearer/admin authorization; raw default vs `format=rebalance`; `activeOnly=false` default; state filtering including legacy `due` alias; ordering, dates/timezone, scalar/shared assignees, summary/permalink/count fields. Preserve current HTTP200 error envelopes (`success:false`, including `Forbidden.` / `Error: …`). There is no reminder-create HTTP route in the current registration block; do not invent a v2 endpoint.

**Function compatibility:** freeze a manifest of current classes, constructors, methods, getters/statics and CommonJS exports. Keep the existing names and module paths callable with the same positional arguments, optional/default semantics, sync/async behavior, return/property shapes, exceptions and side effects. Old entrypoints may delegate to the replacement; compatibility wrappers must contain no independent reminder policy.

In particular:

```js
#TryScheduleRemindersAsync(
  slackApp, text, channelId, messageId, userId, forceSchedule,
  threadTs = null, liveReplyText = null, usedEnrichedContext = false,
  enrichment = null, explicitSchedule = false
) // Promise<boolean>: event handled, NOT simply numberCreated > 0
```

This private method is not REST API, but its injected callback is an integration contract. The app-mention callback takes `SlackApp` first; the reaction callback closes over the owner and excludes that argument ([src/reminders-module.js:455](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L455), [src/reminders-module.js:1330](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/src/reminders-module.js#L1330)). Keep both shapes. Internally translate once to a named request object; do not ask every caller to learn another long positional signature.

Preserve `RemindersModule` public getters, lifecycle/query/list-edit/create methods, snapshot/digest/check/flush methods and statics. Preserve `RemindersAIPipeline` constructor and `AnalyzeMessageForRemindersAsync`, `ExtractManualReminderTaskAsync`, `ExtractMultiTaskCandidatesAsync`, `ExtractDateWithGptAsync`, `CheckForDuplicateReminderAsync`, `GetReminderTriageAsync`, capture/load/trashed-example methods. Keep exported selector/title/render/format helper names and result facts. Preserve shallow snapshot array/object-reference behavior where it is currently observable.

**Other consumers:** keep MCP tool names/schemas (`query_reminders`, `get_reminder`, `list_completed_reminders`, `reminder_stats`), error wrappers and defaults ([mcp/sleuth-mcp-server.mjs:65](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/mcp/sleuth-mcp-server.mjs#L65)); pending/completed JSON filenames/shape; `ReminderMessageText`/`Key task(s):` envelope; completion/event payloads and optional-field presence; local reminder export and Rebalance display fields. MCP reads durable files directly ([mcp/lib/reminders-store.mjs:1](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/mcp/lib/reminders-store.mjs#L1)). Retaining a class name alone does not protect these consumers.

**Slack/lifecycle:** retain command names/aliases/registration order and handled/fallthrough; source identity, assignee vs notify, client/project identity; one trigger group → one ReminderID → several task bullets → one lifecycle. Keep canonical per-reminder posters and `sleuth-ai-reminder-ids` metadata, DND/snooze, retries/stale handling, list synchronization, shared assignment, and source links. Keep >500 **raw** character automatic ignore, explicit long scheduling and no full-source copy. Preserve current GH250 title budgets and linked/unlinked subtask behavior. Mixed-owner grouping limitations remain documented until separately changed.

### Failure semantics that parity must not hide

- Weak enriched suppression can return `true` without creation; ignored/empty/no-successful-group cases return `false`.
- Force scheduling defaults time both when analysis is empty and when a group's date fails; semantic duplicates may be bypassed, identical message-ID duplicates may not.
- Factory emits Created/Scheduled events **before** semantic dedup and queue persistence. It also generates IDs/time; never invoke it in a pure comparison.
- Queue mutates memory/indexes before awaited save, then synchronizes Lists after save. Save/List rejection can leave state changed. Feedback failure can escape after successful persistence. There is no cross-system transaction today.
- Preserve absent versus null/empty optional fields, Dates before persistence, group/order behavior and event ordering. A final-record-count comparison misses these differences.

Characterize these awkward behaviors. Do not silently “repair” them under a compatibility claim; suspected defects get an explicit separate change/acceptance decision. Compatibility does not require concealing a known failure.

## Proposed shape — the minimum replacement

1. **One cohesive internal planning implementation**, consuming a named request and captured/resolved inputs. Side-effect-free transformations decide candidate eligibility/grouping, selected task/context and ownership using existing helpers. Compute semantic content once and pass it to confirmation/materialization rather than rediscovering it independently.
2. **Existing module remains the effect owner:** existing AI/provider, date/dedup calls and group sequencing; factory, FSM, queue, durable writes, List fanout, reactions and feedback. An internal plan is descriptive data, never another scheduler or store. Avoid computing all groups up front if that changes existing failure/effect order.
3. **One legacy-content interpretation behind current exported helpers**, returning the views each caller currently expects. Existing writers still emit the same record/body format. Do not force summary-only and multi-task consumers to accept a single lossy view.

No new provider client, dependency, DI container, plugin framework, workflow engine, queue, persistent schema, permanent v2 pipeline or compatibility registry. No rewrite of ChatModule, ListsModule, SlackApp or deployment tooling. Do not duplicate existing grounding/title/ownership/date algorithms inside the new core.

## Ordered plan

### Phase 0 — lock the contract and settle overlap
- [ ] Refresh baseline revision, open PRs and #250 ownership; produce source/export/caller/endpoint manifests in the project doc. Record evidence paths and unverified external consumers.
- [ ] Extend existing integration/API/MCP/List suites only where gaps are real. Freeze clock/IDs/provider responses; record the ordered service/effect transcript, returned/rejected outcomes, own-property sets and persisted/posted output.
- [ ] Cover positive creation plus auto/mention/alarm/task-above/proposal/enriched/List-row paths. Include long ignore, empty input, no-time force, multi-trigger partial failure, exact/semantic duplicates, mixed owners, unresolved references, channel/permalink failure, and multi-workspace isolation.
- [ ] Record save failure, Lists failure after save, feedback failure after commit, nonfatal event-write failure, and the next request/retry after each. Baseline defects are named, not silently normalized away.

**Exit:** a reviewer can say exactly which behavior would change, and the current revision produces witnessed baseline evidence. No guessed compatibility promises.

### Phase 1 — write the replacement planning core from the contract
- [ ] Preserve existing named entrypoints as façades and translate their arguments once. Reuse current proven helpers; write straightforward internal computation from Phase0 examples, rather than transplanting the gateway's branch tree.
- [ ] Keep all mutation/creation primitives in `reminders-module.js`; the FSM validator scans that file only ([scripts/validate-fsm-invariants.js:24](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/blob/50fa08c0616af0a79a3431043f68e6ea8db5dd7f/scripts/validate-fsm-invariants.js#L24)). A green validator must not become meaningless because mutation moved elsewhere.
- [ ] Compare pure old/new computation with independent immutable snapshots and the **same captured provider results**. Keep baseline code in the reference checkout/test evidence, not a second live production pipeline.
- [ ] Verify plan output is consumed through the existing group/factory/dedup/queue sequence and reaches confirmations, persisted records and delivery. Name the owner of each decision and effect.

**Exit:** deterministic contract cases match, no duplicated policy/effects, no increase in model/Slack/disk calls for the same path/input. Prompt/provider changes remain outside this parity step.

### Phase 2 — consolidate content access without changing storage
- [ ] Enumerate all in-repo parsers and consumers from #250's consumer inventory; verify each against current source. Route existing helper names through one legacy interpretation, preserving their different outputs.
- [ ] Keep old and new records, authored List rows, completion history and event payload text readable. Preserve List summary edits and source envelopes byte-for-byte where currently stable.
- [ ] Compare raw/rebalance/admin/MCP/export payloads, compact/digest/delivered messages and reaction metadata using legacy fixtures and non-empty multi-task records.

**Exit:** duplicate interpretation is removed; endpoints, persisted shape and consumers remain compatible. **Structured durable fields/backfill and external consumer migrations stay in #250's separately reviewed storage phase.**

### Phase 3 — cut over through the existing names
- [ ] Switch each existing entrypoint to the replacement within its reviewed PR; maintain one authoritative live effect path. Keep any comparison strictly side-effect-free and temporary. Do not call both full gateways “in shadow.”
- [ ] Run existing focused suites, build, AI/FSM/isolation/render validators, full tests in a disposable full clone, and current decision + real-model replay. Reuse #250/#260's corrected ATE workflow only if a model-quality comparison is needed; its disposable reset target must never be an app checkout.
- [ ] Real model checks assess quality/invariants and report variance/cost; exact old/new parity uses recorded inputs/results, not independent stochastic calls. Keep existing failing expectations visible; do not relax #149 to obtain green.
- [ ] Rehearse rollback to the previous binary with new writes still readable. After separately authorized deployment, perform documented read-only production smoke and stability checks; never send duplicate reminders to prove parity.

**Exit:** zero unexplained contract/effect differences, all existing safety gates remain meaningful, rollback verified. Any intentional behavior difference has its own reviewed acceptance and is not mislabeled parity.

### Phase 4 — retire the displaced internals
- [ ] Delete superseded policy branches/parsers and all temporary comparison code; keep only necessary compatibility façades and the legacy reader that durable history still needs.
- [ ] Lower relevant #261 ratchet counters in the same PR when it is present. No new extraction door, header, writer or gate; unchanged counters require explanation where a deletion was expected.
- [ ] Update ARCHITECTURE, function-contract notes and the existing project/ledger records. Document which owner replaced each deleted mechanism and which compatibility facade remains.

**Exit:** fewer independent decision owners and legacy parsers, simpler callers, one live orchestration authority. Splitting the same complexity across more files does not count as completion.

## Falsifiable acceptance / evidence destination

| Claim | Required negative control |
|---|---|
| Behavior is equivalent | An always-ignore implementation must fail positive scheduling fixtures; a no-op writer must fail persisted-record/confirmation/delivery checks. |
| Names and endpoints are compatible | Renaming an export, shifting an optional argument, changing an error envelope/default, or altering absent/null fields must fail the applicable existing contract fixture. |
| No duplicate effects | A comparison path that calls factory/AI/Slack/queue/List/event functions must fail effect-count/order assertions; input mutation must fail an independent-snapshot check. |
| Safety is retained | Bypassing raw501 admission, grounding, message-ID dedup, tenant isolation or snooze must turn the relevant existing suite red; preserve a500-char positive control. |
| Failure parity is real | Fault injection after save and after feedback must expose the characterized state/return/retry outcome, rather than passing because no exception surfaced. |
| Complexity decreased | Review must reject a second active core, duplicated parser policy or a baseline increase concealed as a rename; report before/after decision owners and applicable ratchet signals. |

Write commands, baseline/candidate revisions, outcomes and witnessed red controls to the phase's existing `temp/` evidence directory, summarized in the canonical project doc/PR. These controls are **specified, not executed in this planning task**. Do not add a new test framework, CI lane or telemetry service.

## Triangulate decision

- **Cell:** conservatively irreversible × crossing → full recon/falsification. Published APIs and storage are consumed contracts; no storage/authority move is proposed.
- **Falsified:** “there is no shared scheduling gateway,” “same final count proves parity,” “the title contract still needs building,” and “a storage migration is necessary for the first rewrite.” Multiple model-call doors and intent modes remain real requirements/compatibility seams.
- **Alternatives:** (1) bounded internal replacement with compatibility façades — proposed; (2) continue #250 deletion-only refactoring — cheaper fallback if it produces the same ownership reduction; (3) merely extract the current conditionals into more files — inadequate; (4) whole-bot rewrite/new durable source of truth — disproportionate.
- **Strongest counterargument:** #250 already has a viable deletion plan; rewriting may buy less than finishing it. Phase0 must identify the concrete decisions/duplication that a new core removes. If that cannot be shown, choose the deletion-only route, preserving this issue's compatibility gates.
- **Origin addressed:** policy/effect interleaving and presentation strings used as data. **Fix site:** internal planning boundary and shared legacy interpretation. **Why here:** changing every external caller/storage consumer first broadens the blast radius; changing the renderer alone leaves the orchestration problem intact.

## Unknowns / explicit limits

- Graph is stale; no full-suite baseline, runtime fault injection or new-model quality proof was produced today. Phase0/3 supply that evidence.
- #250 records Rebalance/git-pulse/deployed-skill consumers; those external repositories/machines were not independently audited in this pass. Preserve durable/wire bytes now; revalidate them before any later format change.
- In-flight work may change names, parsers and ratchet inventory. Refresh at execution; do not treat this source-pinned plan as a production-state claim.
- Removing display thresholds/feature-flag semantics cannot simultaneously promise unchanged behavior for every flag combination. Preserve them here; coordinate any intentional retirement separately under #250. Never keep misleading diagnostic facts merely to preserve a field name.

**Sizing:** effort4/5, complexity4/5, risk3/5, five phases including characterization. No implementation, merge, deployment, model benchmark or data migration is part of filing this issue.


## Plan QA disposition and implementation seam

- CommandCode / GLM5.3max PASS, round1, supervisor exit0 and canonical attestation verified. See `PROJECT/RELAY/gh264-plan-qa.md`. No blocking findings. Cosmetic spacing left in the source-pinned issue copy; no semantic replan. Mark statics lacking verified external consumers as preserved compatibility insurance, not candidates for opportunistic deletion.
- Phase0 baseline: six existing integration/event/format/display/projects/clustering suites267 tests passed in disposable full gate clone, with repository-standard `--forceExit`. Initial direct Jest invocation omitted that standard flag and lingered after assertions passed; it was stopped and rerun with the normal exit mode.
- Smallest replacement bet: central pure preparation of candidate/render-identity/reference/group/ownership data shared by scheduling and triage, while existing module keeps per-group I/O ordering. No model/prompt/date algorithm changes. One legacy-content owner in SlackFormatUtils; keep distinct legacy views and exact casing/newline/fallback quirks.
- Separable commits: characterization; planning/triage internals; legacy-content adapters; final verified docs/receipts. They have no dependency on GH250/263 structured storage.


## Implementation and compatibility evidence

The execution authorization supersedes the source-pinned issue's original plan-only wording. The
operator reiterated that completing GH-264 is the primary task; AgentChorus coordination is secondary.
This implementation replaces none of GH-250 phases 3/4/5 wholesale. It provides their shared planning
and legacy-reader seam; intent/synthesis policy changes, structured durable tasks and extraction-door
consolidation remain separate. No merge, deployment or production probe is part of this delivery.

| Phase | Delivered result / evidence |
| --- | --- |
| 0 | Baseline50fa08c; existing six suites267 tests; existing ingress/API/MCP/List/FSM contracts traced in recon. Added six effect/failure characterizations, duplicate event and legacy edge cases; existing suites retain auto/mention/alarm/enrichment/List/long/multi-tenant/snooze coverage. |
| 1 | `PrepareReminderCandidates` owns selection, normalized render identity, unresolved-reference filtering and groups. `PlanTriggerOwnership` resolves each group at its original place in the effect sequence. Scheduling and triage share these functions, without a second gateway. Inputs remain unmodified. |
| 2 | `SlackFormatUtils.ParseLegacyReminderContent` owns section, quote, bullets, lines and source views. Existing format/display/project-title functions remain callable; distinct consumer semantics are preserved. No durable schema/API changes. |
| 3 | Main/adjacent runtime paths exercised through real handlers with fake Slack transport. Six reference/candidate cases compare raw stored bodies, posted text/metadata, property presence, ordered events, effects and retry outcomes. Only generated UUIDs and creation/event clocks normalized. All match. Deterministic replay23/23; real-model replay9/9. Final independent QA and full gate pending below. |
| 4 | Superseded orchestration and parser fragments removed. Private dedup facade and exported project title retained solely for function compatibility; no independent policy. Net production source186 additions/196 deletions (10 fewer lines). No baseline ratchet in50fa08c; no new extraction door/header/writer. |

Separable commits:58e8d92 characterization; f33e1a5 planning;5b4e002 legacy content. Failure semantics
remain deliberately unchanged: save rejection can leave memory changed; List rejection follows disk
commit; feedback rejection can follow persistence; factory events precede semantic duplicate checks.
The existing module retains factory/FSM, dates, semantic dedup, saves, List sync, posting and snooze/DND.

Focused checks: planning five suites120 passed; content six suites293 passed; build passed. AI, FSM,
workspace-isolation and reminder-render validators pass. Legacy parity:167 adversarial inputs ×8
consumer comparisons =1,336 exact matches against reference modules, including export names/arity.
Positive scheduling fails under both witnessed red controls (always-ignore and no-op queue).

Evidence stays in the disposable gate clone's ignored `temp/gh264/`: baseline/focused logs,
`scheduling-parity.json`, `legacy-parity.log`, `red-controls.json`, `decision-replay.log` and
`real-model-replay.log`. Reference implementation and temporary instrumentation are not shipped.
No live Slack messages were sent. Live replay is a quality sample, not exact stochastic parity or a
claim to fix GH-149. External consumer repositories were not run independently; their published
payloads/storage remain unchanged. Public/static methods without verified external callers are
preserved as compatibility insurance. Rollback is code-only: baseline readers consume the same JSON
fields and body bytes; no backfill, authority flag or destructive conversion is introduced.


Final QA round1 returned a cited PASS, but its reviewer prematurely released the turn token and the
supervisor rejected closure (`close-mismatch`, exit4); it is not accepted as final attestation.
Separately, a producer reference probe caught a real compatibility defect: unbound legacy quote and
summary helper references previously worked, but the new `this.ParseLegacyReminderContent` access
threw. Changed parser delegation to the named class, and added one regression to the existing format
suite (also protects the key-task section path). The baseline and candidate failure were witnessed.
Round2 will review that fix and close through the normal supervisor token protocol. No gate bypass.


Final QA round2 identified the detached key-task helper's plain-text fallback still depended on
`this`. This was also true at baseline (not a refactor regression). Disposition: implement the small
compatibility improvement explicitly, rather than claim unchanged exception behavior for this case.
The existing receiver is retained when provided (including subclass/custom formatting); only a
missing receiver falls back to SlackFormatUtils. The detached no-section call now matches the named
call instead of throwing. This is the sole intentional behavior improvement, confined to helper
callability; normal scheduling/storage/wire bytes are unchanged. Regression extended in the same
existing test. Round3 reviews this specific acceptance and final implementation.


## Final verification / PR handoff

- Final code:fe929bfb998f282de7757bf63ae98ee90d43db6c. Codex round3 Approved; supervisor exit0,
  canonical attestation validated. Broad round1 sweep plus bounded re-reviews; disposition and
  portable transcript in `PROJECT/RELAY/gh264-final-qa.md`.
- Exact-code disposable full gate: `npm run build` and `npm test` exit0. Jest145 suites/2,802 tests
  pass initially; the ledger suite skipped because the gate clone lacked ignored .xyz. Restored the
  existing vendored CLI and ran that suite alone:4/4 pass. Combined146 suites/2,806 Jest tests pass,
  plus Node116 pass, zero unresolved failures/skips.
  Before/after repository root/origin/branch/HEAD match and tracked tree stays clean. Known Jest
  config-comment warning remains baseline noise, not a failed test.
- Frozen-clock/UUID/provider six-case differential: raw records, disk, posted messages/reactions,
  effect order and event transcript match50fa08c exactly, without normalization (candidate6c0a4e0).
  Finalfe929bf only adds the explicitly documented detached fallback improvement; normal receiver
  behavior also verified by format tests and independent custom/subclass probes.
- Manual startup: `npm run dev` with empty isolated runtime and temporary local port; missing-workspace
  reminder GET retains HTTP200 `{success:false,data:"Error: Workspace not found."}`. Own process
  group stopped and temporary runtime removed. Main/adjacent scheduling smoke is the real-handler
  success/ignore/duplicate/retry differential and nine real-model scenarios, with fake Slack only.
- Function manifest:144 pre-existing named members and223 positional parameters preserved across
  five touched legacy files; new optional private feedback argument leaves prior call shapes valid.
  Web API/MCP route/tool source files unchanged. This is syntax/shape evidence, complemented by
  behavioral tests, not a claim of universal external-client testing.
- Proposed #262 scanner atde0524c was evaluated read-only against this branch: counts3 extraction
  specs /6 header sites /3 routing thresholds /4 display sources /2 context markers, all unchanged.
  It is not yet in the base and no scanner/baseline was vendored here. Unchanged header-site count
  reflects multiple necessary literal boundaries in the shared reader plus retained general clean
  formatting and raw-source assignee extraction; consolidating display/title/quote interpretation
  does not retire those distinct compatibility operations. No claimed wholesale parser retirement.
- PDDA global checks retain baseline debt:13 frontmatter,9 status-table,5 hardcoded-path findings,
  all on unrelated existing documents; no GH264 document findings. Ledger check clean0 failures,
  six pre-existing migration warnings. Changelog tone and AI/FSM/isolation/render checks pass.
- Production source186 additions/196 deletions (10 fewer lines), including the pure planner.
  Scheduling-module policy duplication is reduced; public/private names and effect authority stay
  intact. GH250 phases3/4/5 remain separate; phase3 is coordinated behind this published seam.

This is PR-ready implementation, not a merge, release or deployment. Keep issue open until landing.
The original source-pinned plan/checklists above remain historical; this execution table records
what was actually verified and the limits of those checks. No new provider, persistent schema,
projection authority, runner, CI lane or production write was introduced.
