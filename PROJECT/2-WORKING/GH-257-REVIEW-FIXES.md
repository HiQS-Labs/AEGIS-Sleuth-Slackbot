---
title: GH-257 — Issue stream review follow-up
status: In Progress
created: 2026-10-20
updated: 2026-10-20
owner: Codex
goal: Fix validated promotion review defects with synthetic verification and independent QA.
gh_issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/257
effort: 3
complexity: 3
risk: 2
phases: 1
---

## Status

| What was just completed | What's next |
|---|---|
| Independent plan QA approved round 3; scoped implementation and focused synthetic tests | Finish regression evidence, independent final QA and draft PR |

## Scope and recon

Source: PR #256 issuecomment-6305958196; inline discussions r4332194038/4042/4047/4050/4055/4057/4065/4070/4075.
`development` is the canonical integration base (ROUTER/AGENTS); main d8c4a91 has identical content after promotion. No newer open PR or issue covers the work at intake. Fresh isolated full clone; no changes to previous task checkouts. Runtime scope is the existing per-workspace stream module, planner and existing suites. No deploy, production/server access, monitoring changes, Slack posts, stream test posts or credentials changes.

Measured source trace: app shutdown awaits stream StopAsync before exiting; StopAsync currently only clears a timer. RunOnceAsync -> RunCycleAsync fetches both endpoints with one Cursor; PaginateSinceAsync caps at five full pages without completion metadata; NextCursor takes maximum across endpoints. Planner uses the issue map for both parent identity and event dedup, but PruneState deletes it by age. Reply writes use config.ChannelID despite persisted Thread.ChannelID. SaveState catches durable-write errors; callers cannot detect failure. Dynamic allowlist successful empties fall back to persisted nonempty cache. DND is checked only before fetching, not before each post. These observations validate six P1 claims and DND at the code level, not a production incident. Reported production uses static repos, so the dynamic-list finding is not evidence of live exposure.

Quoted-name truncation r4332194065 is present (FitTitleToBudget quote loop omits single quotes). Deferred to the separate PR #252 takeover work, candidate 0bc0468; do not copy/cherry-pick or change title code here. Mirror receipt/dashboard paths must be checked against current file location and fixed through the canonical ledger/dashboard generator where needed.

RAG query attempted but synthesis unavailable (no Gemini key); direct architecture/changelog/project/source reading used. temp/SOP.md read from primary checkout; no live claims inferred from stale notes. New test files/suites/gates are not proposed; extend existing stream suites only. No individual new-test approval is assumed.

## Smallest viable bet

Outcome: prevent skipped unread ranges and routine duplicate/orphan delivery after cleanup, config changes, persistence failure and graceful shutdown. Extend existing state writer and module lifecycle, not a new queue/journal/reconciliation service. Keep the five-page fetch bound and 40-post budget.

1. Report endpoint completion in GithubListResult. Keep shared cursor for backwards compatibility but bound NextCursor by the last fetched updated timestamp minus existing overlap for EACH incomplete endpoint. When the issues traversal is incomplete and a fetched comment or PR references an unmapped/unplanned parent, hold the shared cursor and warn: absence cannot yet mean intentional no-backlog exclusion. Add a small pure planner predicate using existing issue/reference parsing, no queue or extra API. For cross-repo references to a seeded allowlisted repo, hold the source cursor until its target parent is mapped or the target has completed a successful parent scan at/after the PR update (optional ParentScanAt timestamp in existing repo state, backwards compatible). A successful complete issue scan records its request-start time only after all planned actions delivered. Continue to subsequent repos when only a dependency holds, so the target can be evaluated; source replay then delivers once on the next cycle. A target seeded after the PR or outside the allowlist is intentionally skipped; a complete target scan with no eligible parent resolves old/ignored targets without indefinite holds. Incomplete target scans may conservatively hold/warn and require operator catch-up. This conservative hold can require operator-directed catch-up. A complete endpoint cannot pull the shared cursor past unread results on the other. Include PRs/ignored items in watermark calculation. Keep conservative overlap on equal timestamps; if the cap contains no safe cursor progress, hold and warn rather than lose data. Known tradeoff: a burst exceeding 500 records inside the overlap can stall this bounded poller and needs operator-directed catch-up; do not silently discard it or add an unrequested paging infrastructure.
2. Retain thread identity AND event keys across age cleanup (otherwise overlap/replayed PR refs can duplicate replies). Keep repo allowlist pruning; no additional archival/tombstone subsystem. State grows with delivered threads/events; that is the existing delivery record's actual retention requirement. Revert code only preserves additive state compatibility.
3. Resolve reply ChannelID and ThreadTs from the same saved thread; new parents use configured channel. Recheck DND for actual destination immediately before EVERY Slack write. Hold repo cursor for undelivered actions, including shutdown cancellation.
4. Propagate state save failures and abort further delivery. Retry saving current in-memory state at cycle entry before fetching/posting more; pending successful posts cannot be forgotten during a surviving process. On shutdown await active cycle, retry pending save before return, prevent new cycle scheduling/writes while stopping. A process crash between Slack acceptance and durable state save CAN duplicate: no exactly-once promise or external API transaction invented.
5. Dynamic allowlist fails closed: successful empty/stale-only snapshots mean empty, transport failure holds the cycle without pruning/reseeding state. Eliminate cached authorization reuse rather than invent cache expiry metadata. Static configured lists remain on existing path. Per-file transport errors must hold the cycle rather than publish a partial authorization set.
6. Correct currently broken mirror links using existing ledger generator, add changelog and receipts. Keep separate title work deferred. No version bump.

Simpler alternatives rejected: raising/removing cap removes bounded polling; retaining the old maximum cursor loses unread events; disabling the stream does not fix the asked behavior; cache TTL adds machinery and still permits removed repos during TTL. All changes revert in one branch; legacy SchemaVersion 1 files remain readable.

## Verification and review questions

Use ONLY mocked fetch/Slack, temporary local state and fixed clocks. Existing tests will be extended and mutation-verified against original source (record red results). Run focused stream suites, build, relevant validators, full Jest/node suite and PDDA. No startup smoke of app.js because it can connect to real workspaces; use RunOnceAsync main path and restart/held path through mocked integration suite.

Acceptance: (a) >500 issues with newer comments AND reverse direction never advances cursor beyond unread boundary; bounded fetch count, continued next-cycle progress; dense-boundary case explicitly holds/warns; (b) pruned old issue reopen/comment uses original parent with no replayed keys; (c) changed configured channel replies to stored channel and obeys its DND; (d) successful empty/stale-only allowlist stops fetches, transport failure holds and restart never trusts old cache; (e) pre/post-write save failures stop additional posts and retain pending state for surviving-process recovery, then prove restart after a successful recovery/shutdown save; (f) StopAsync remains pending during blocked in-flight Slack acceptance/save, no new cycle after stop, persisted keys prevent restart repeats; (g) DND activated between posts holds remaining actions/cursor and clearing resumes; (h) mirror links resolve, title overlap disposition explicit.

Reviewer: read whole module/planner and existing tests plus this plan. Are the shared safe watermark and documented dense-burst hold sufficient for bounded no-loss behavior? Are persistence recovery, destination identity, DND and shutdown gates correct without a new subsystem? Are the verification cases falsifiable and proportional? Flag only concrete scoped defects with file:line, Observed input, Affected scope, Falsifier. No changes outside the review thread; no network/production/live APIs, tests in reviewer worktree or speculative infrastructure. Require actual review evidence before implementation.

## Evidence ledger

- GitHub current PR list: promotion #256 latest; no open follow-up. Tracking issue #257 created.
- Branch heads: development 50fa08c0616af0a79a3431043f68e6ea8db5dd7f; main d8c4a91af4eeb5cad87112e02907b82081f83ec9; compare files empty.
- Root cause: incomplete source traversal masquerades as complete, identity/delivery state deleted or save errors hidden, lifecycle/config boundaries not tied to writes; Fix site: existing fetch metadata, planner retention, module delivery/state/lifecycle; Why not downstream: Slack cannot transact atomically with local JSON.

## Plan QA dispositions

Round 1 independent Codex review ran and returned FAIL with a reproducible unseen-parent loss case. R1 accepted: hold/warn on unresolved parent dependencies during incomplete issue traversal, with a since-filtered multi-cycle red control. R2 accepted: Setup now names the tracked plan directly. R3 accepted: restart guarantee explicitly follows a successful save. Harness exit 6 came from producer test edits during the review; it backed up and reverted those edits, which were restored. Do not mutate the working tree while subsequent reviews run. No harness modification or containment bypass.

Round 2 dispositions: R4 accepted, one optional ParentScanAt field disambiguates unvisited target repositories from evaluated exclusions; no queues/API. Cover both repo orders with since-filtered mocked responses and pre-seed/non-allowlisted targets. R5 accepted: initial 500 records exclude #501 and preserve ascending update order. Only three plan rounds are configured; no force/cap bypass.

Round 3 plan QA: PASS, attested at 7dea9c6268662dca2c3a461bbf89a315f6e103a8. Implementation follows the approved source/state boundaries. Dense-boundary and blocked-save shutdown cases were added to the existing module suite.
