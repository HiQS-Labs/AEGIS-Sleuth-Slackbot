---
title: "Richer reminder Q&A — time / user / client / topic queries (Slack + local skill), workspace-agnostic"
status: Active (2-WORKING) — Phases 1-3 shipped (1.4.213/1.4.214); one QA-gate item remains buildable (ambiguous client first-match test)
created: 2026-07-15
updated: 2026-07-16
owner: noel
branch: development
doc_type: project
gh_issue: 367
source: https://github.com/NeochromeTeam/sleuth-app/issues/367
related: "#361 (ask-reminders, client stamping — shipped), P3 event-sourced core"
effort: 3
complexity: 3
risk: 3
phases: 3
---

# GH-367 — Richer reminder Q&A

Extends `ask-reminders` (#361 Phase B, which answers over the live **active** queue) into richer
queries across **time**, **user**, **client**, and **topic**. Plan **refined by a Codex + agy
`/consult` plan-QA** (2026-07-15, transcripts `relay-system/2026-07-15/gh367-plan-qa-001018/`),
adjudicated against AGENTS.md — see the issue comment for the full reconciliation.

## Motivating queries
1. "What task did @user have **last week** regarding the **Client A plugin upgrades**?" — time + user + client + topic.
2. "What **Client A** client tasks are there **across all users**?" — client + cross-user aggregation.

## Design decisions (locked by the consult)
- **History source = `CompletionStore`, NOT the P3 event ledger** (ledger is non-authoritative/OFF-by-default). #367 does not depend on the P3 cutover.
- **Transport-neutral deterministic core.** A pure filter narrows candidates by time/user/client/keyword **before** any LLM call. Current `ask-reminders` is a Slack-specific prompt composer, not a reusable core — do not extend it in place; build the core beside it and have Slack call it.
- **LLM ranks/phrases only** the narrowed, cited set (via `WorkspaceAI`); it never decides membership. **Short-circuit** to a canned "no matching tasks" on an empty set (never hand the LLM empty context).
- **Channel-privacy scoping is a v1 MUST** (multi-tenant contract, AGENTS.md): exclude private-channel / DM-sourced reminders from workspace-wide Q&A; scope to public channels + the channel the query runs in.
- **"topic" is a deterministic keyword filter**, not a correctness gate. Semantic ranking is LLM-side, best-effort.
- **Bounds:** "last week" resolved in **workspace timezone** (match `summarize-week`); history bounded by CompletionStore's 1-yr retention; **"since the deploy" is cut** (no anchor exists). Project queries **degrade to client-level** until #361 project stamping lands (`ResolveClientIdentity` returns `projectId: null` today).
- **Workspace-agnostic:** defaults live at the edge (default `neochrome`), the core is parameterized; reuse existing `/workspace/:name/reminders` + `reminders-<workspace>.json` shapes.

## Phase 1 — Deterministic query core (Slack v1)
- [x] **P1.1 — `src/reminder-query-engine.js` (pure, transport-neutral).** `FilterCandidates(candidates, query)` over a normalized candidate shape. Filters: **channel-privacy scope** → time window → user (**assignee-only in v1**) → clientId → keywords (ALL must appear). Returns `{ matched, matchedCount, total }`, cited by id. Plus `ResolveTimeWindow(phrase, nowMs, timezone)` for "last week"/"today"/"yesterday"/"last N days" in workspace tz. **No LLM, no I/O.** 14 unit tests. **DONE** — then `/ponytail`-trimmed (cut dead `publicOnly`, speculative `userRole` sender/any, unused `filtersApplied`).
- [x] **P1.2 — `clientId` stamped on `CompletionRecord`** — **already done**: `reminders-module.js#RecordCompletion` (L531-539) records `clientId`, `assigneeID`, `sourceChannelID`, `completedMs`. No build lane needed; P1.3's test asserts a completed reminder carries `clientId` as a regression guard. *(Sender-filtering / `originalSenderID` DEFERRED — v1 user filter is assignee-only.)*
- [x] **P1.3 — candidate assembler.** `src/reminder-candidates.js` `AssembleCandidates` normalizes active queue + `GetCompletedRemindersBetween(window)` into the candidate shape (completed-wins de-dupe, injected `isChannelPrivate`). Built via the xyz marathon (codex builder). 5 tests.
- [x] **P1.4 — Slack wiring.** `ask-reminders` parses the query (assignee mentions, client, time window) → assembles candidates → `FilterCandidates` (channel-privacy → time → user → client) → short-circuits "no matching tasks" on empty (no LLM) → hands the narrowed cited set to `WorkspaceAI`. Added `SlackApp.IsChannelPrivateAsync` (fail-closed). Shipped 1.4.213. Topic left to the model (no v1 keyword gate).

### QA gate — Phase 1
- [x] Time/user/client/keyword filters each select the right subset deterministically (query-engine unit tests, no AI mocks). *(tested)*
- [x] **Private-channel / DM reminders never appear** in a public-channel workspace query. *(tested)*
- [x] Empty candidate set → canned "no matching tasks", **no LLM call**. *(tested)*
- [x] Ambiguous client first-match (order-dependent single-file mapping) is covered by a test.
      *(tests/client-mapping.test.js — two overlapping-pattern clients resolve to whichever is
      listed first; reversing config order flips the winner, proving order-dependence rather than
      pattern specificity.)*
- [x] "Last week" boundary is correct in the workspace timezone. *(tested — asserts `2026-07-06T07:00:00Z`)*
- [ ] Both motivating queries return correct, cited results in Slack. *(deferred to live verification)*
- [x] Full `npm test` green (79 suites / 1324 jest + 30 node).

## Phase 2 — Export enrichment (bridge to the local skill) — SHIPPED 1.4.214
- [x] **P2a — `clientId` on the rebalance export record.** `#BuildRebalanceReminderRecord` (`src/web-api.js`) surfaces `clientId`, preferring the stamped value and **falling back to `ResolveClientIdentity` at export time** (new `#ResolveExportClientId`) so pre-stamping reminders still carry a client. Null (present) when unmatched; never throws.
- [x] **P2b — bounded `completions-<workspace>.json`.** Pure `deploy/reminders-export/completions-payload.js` (`BuildCompletionsContent`, window via `SLEUTH_COMPLETIONS_WINDOW_DAYS`, default 90d, hourly heartbeat). `publish-reminders-export.mjs` refactored to a `publishFile()` helper, publishes both files (active first; completions failure never sinks the active mirror), reads the completed file from disk. 8 tests.

### QA gate — Phase 2
- [x] Export carries `clientId` (always present, null when unmatched — tested). *(tested)*
- [x] Completions file is bounded (window-filtered), workspace-scoped, byte-idempotent within the hour. *(tested)*
- [x] No private-channel leakage: the published files are the same private mirror consumed today; no new surface widens visibility.

## Phase 3 — Local Claude Code skill — SHIPPED 1.4.214
- [x] **v1 = active reminders (+ optional completions).** `skills/talk-to-reminders/` (`SKILL.md` + `query-reminders.mjs`, symlinked into `~/.claude/skills`) reads the mirror(s) and runs the **same `src/reminder-query-engine.js` core**. Active-only needs zero Phase 2; `--include-completed` folds in history when the completions file is present.
- [x] Deterministic membership by `--client`/`--user`/`--user-name`/`--keywords`/`--since|--days`; model synthesizes, never invents rows.
- [x] Workspace-parameterized (default neochrome), zero-network, no init step (<1 s — it's a plain node script over local JSON).

### QA gate — Phase 3
- [x] Answers the queries locally (smoke-tested against the live mirror: keyword/user/time filters discriminate correctly — nonsense→0, `bigquery`→2, etc.).
- [x] `<1 min` init — none; the script reads local JSON and runs in <1 s.
- [x] Privacy: admin-local full-workspace visibility by design; channel-privacy scoping stays the Slack surface's job (ponytail-noted in the script).
- [ ] **Deploy note:** `--client` filtering in the local skill is inert until the Sleuth server republishes the enriched export (P2a). Until then, client queries fall back to `--keywords`.

## Deferred / out of scope (recorded)
- **Per-workspace client-mapping migration** (agy's [Should]) — real multi-tenant debt, but scope creep here (one workspace, no collision today). Keep the core parameterized. **Filed: #369.**
- **P3 event-ledger as the query substrate** — stays deferred; not a #367 dependency.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest client-mapping --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "tests/client-mapping.test.js", "pattern": "ambiguous" }
  ],
  "artifacts":   [
    "src/client-mapping.js",
    "tests/client-mapping.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-367 Phase 1 QA-gate item — ambiguous client first-match (order-dependent single-file mapping) covered by a test" },
  "lanes":       { "agy_safe": [ "tests/client-mapping.test.js" ], "orchestrator_only": [] }
}
```

> Note: rescoped 2026-07-16, corrected 2026-07-17 — Phases 1-3 (P1.1-P1.4, P2a/b, Phase 3) are all
> shipped; the original contract's `target.ref` pointed at the now-merged/deleted
> `feat/gh-367-richer-reminder-queries` branch (preflight came back `BLOCKED: ref does not resolve`).
> The only remaining **buildable** item is the unchecked Phase 1 QA-gate line ("ambiguous client
> first-match... covered by a test") — this is `ResolveClientIdentity`'s order-dependent
> first-match-wins iteration over `LoadClientMappingsSync()` in **`src/client-mapping.js`** (an
> earlier pass of this contract incorrectly pointed at `reminder-query-engine.js`, which only filters
> by an *already-resolved* `clientId` and has no ambiguity of its own — corrected here). The other two
> open items ("both motivating queries return correct results in Slack" and the local-skill
> `--client` deploy note) are live-verification / external-redeploy items, not code a marathon lane
> can build — they stay unchecked and out of this contract's scope. Because this now targets
> `client-mapping.js` rather than `reminder-query-engine.js`, it does **not** collide with GH-393 —
> both could run in the same wave.

## Progress log
- 2026-07-15: filed #367; ran Codex+agy `/consult` plan-QA, adjudicated to AGENTS.md; PR #368 (GH-366) merged to development; cut `feat/gh-367-richer-reminder-queries`. Starting P1.1.
- 2026-07-15: Phase 1 (Slack v1) shipped 1.4.213 via PR #370 → development (query core + assembler + ask-reminders wiring, privacy fail-closed).
- 2026-07-15: Phase 2 (export enrichment: clientId + bounded completions) + Phase 3 (local `talk-to-reminders` skill) shipped 1.4.214 on `feat/gh-367-phase2-3-export-and-skill`. Full suite 79/1324+30 green. Remaining: server export republish to activate local `--client`; optional ambiguous-client-mapping test + live Slack verification of both motivating queries.
- 2026-07-17: closed the last buildable QA-gate item — added 2 regression tests to
  `tests/client-mapping.test.js` proving `ResolveClientIdentity`'s first-match-wins ambiguity is
  order-dependent (not name-specificity-dependent). `npx jest client-mapping` → 202/202 green.
  Remaining open items (live Slack verification, server-export-republish deploy note) are
  non-code and stay out of scope. Branch `marathon/gh-367-richer-reminder-queries-2026-07-17`.
