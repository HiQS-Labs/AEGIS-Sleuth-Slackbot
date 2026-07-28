---
author: Claude (Opus 4.8)
created: 2026-06-03
updated: 2026-06-03
status: SPIKE COMPLETE + show-me-projects Phase 1 shipped (v1.4.161); deferred·vision — remaining phases fold into P3 as a projection.
goal: Determine whether Sleuth's main LLM can infer reminders into client buckets and informal project groupings, and design a `show-me-projects @user` command that chains project bucketing with the existing show-me prioritization.
title: P2 — Task Bucketing (Client + Project Inference)
branch: development
owner: noel
complexity: 3
risk: 2
effort: 3
related: PROJECT/3-COMPLETED/SHOW-ME.md
---

# P2 — Task Bucketing (Client + Project Inference)

## Status

| What was just completed | What's next |
|---|---|
| **Spike complete + `show-me-projects` Phase 1 shipped (v1.4.161).** Both feasible: production's main LLM reliably buckets reminders into clients and coherent informal projects using only signals already stored on each reminder; read-time `show-me-projects @user` MVP shipped (no schema change, complex-model grouping, deterministic urgency ranking, shared read path with `show-me`). | Deferred·vision — live Slack smoke test; optionally expand `client-channel-mapping.json` beyond Client A; remaining phases become a projection under [P3 event-sourced core](P3-EVENT-SOURCED-CORE.md) (persisted `Client`/`Project` only if grouping is needed outside this command). |

## Table of Contents

- [Spike Setup](#spike-setup)
- [Results](#results)
- [Key Findings](#key-findings)
- [Data Sufficiency](#data-sufficiency)
- [Proposed Feature: show-me-projects @user](#proposed-feature-show-me-projects-user)
- [Implementation Options](#implementation-options)
- [Open Questions](#open-questions)

## Spike Setup

Read-only test run **on the production server** (`/root/sleuth-app`), reusing the app's own
`WorkspaceAI` provider stack so it exercised the exact provider/model production runs. Input:
the **25 real reminders** in the `neochrome` workspace
(`data/runtime/reminders/neochrome_reminders.json`).

For each reminder the spike built a compact "task card" from existing fields only:
`OriginalChannelName`, parsed `GitHubUrls` (repo owner/name + issue #), and the cleaned
`ReminderMessageText` (the quoted source message + the `Key task(s):` bullets). It then asked
the model — via `ProcessMessageWithJsonResponseAsync` with a strict schema — to produce
(a) **client buckets** and (b) **project groups**, each with a confidence and the signals used.
Ran across three models for comparison. No writes, no Slack posts; ~4 LLM calls billed to the
workspace keys.

## Results

| | gemini-3.5-flash *(prod default)* | gpt-4o-mini | gpt-4o |
|---|---|---|---|
| Client buckets | 4 clean buckets | coarse | **5 buckets, best** |
| Client accuracy (human-judged) | ~23/25 | ~20/25 | ~23/25 |
| Project groups (multi-task) | 7 (6 real clusters) | 3 (over-lumped) | **11 (7 real clusters)** |
| Latency (single batched call) | 32s | 7s | 10s |

All models cleanly separated the active clients: **Client A**, **Client A–Client B** (sub-account),
**Client D**, **Neochrome (internal)**, and **Sleuth (internal)**.

## Key Findings

1. **Client bucketing is essentially production-ready.** Channel name + GitHub repo owner
   (`ClientA/...`) + product domains (`ClientA.com`, `NN Photo App`, `Client B`) give strong,
   near-deterministic signal.

2. **The LLM beats a naive channel-map by reading task content.** Two tasks posted in the internal
   `1-neochrome-team-tech` channel were actually Client A work — "add the Shipping Tracker plugin
   **on Client A**" and "upsell into the **universal theme** PR" (ClientA's repo). `gemini-3.5-flash`
   routed both to Client A correctly; a static channel-map (and `gpt-4o`, which anchored on channel)
   would mis-file them as internal. → favor a **hybrid**: deterministic channel/repo map as a prior,
   LLM content-read to override.

3. **Project clusters are real, not hallucinated.** `gemini-3.5-flash` and `gpt-4o` *independently*
   grouped the same shipping tasks `[3,7,14]` and the same Client B pipeline tasks `[11,17]` —
   convergent clustering across different model families is strong evidence the signal is genuine.
   `gpt-4o` gave the best granularity (shipping / PR-reviews-&-deploys / testing-&-fixes /
   budget-&-plugins / Client B pipeline / Sleuth product dev). `gpt-4o-mini` over-lumped everything
   into one "Client A DevOps" bucket → **project grouping needs a capable model, not the cheapest.**

4. **`data/static/client-channel-mapping.json` only defines Client A** despite 4+ active clients —
   worth expanding (Client B, Client D, Neochrome-internal, Sleuth) regardless of what's built.

## Data Sufficiency

No new ingestion needed. The stored reminder payload already carries enough to infer both
dimensions: the quoted source message, the `Key task(s):` summary, and `GitHubUrls[]`. The original
Slack threads do **not** need to be re-fetched.

## Proposed Feature: show-me-projects @user

**Request:** chain project bucketing with the existing `show-me` command so a single command uses
both **prioritization** (show-me) and **project grouping** together — `@Sleuth show-me-projects @user`.

**Feasibility: high.** It is `show-me` with two changes — the prompt asks the model to *group then
rank within each group*, and the output is rendered from a structured (JSON) response for reliable
nested layout. It reuses the entire existing `show-me` data path verbatim:

- Same user resolution from `<@UID>` mention.
- Same read: `RemindersModule.GetAllReminders().filter(AssigneeID === target && ACTIVE_REMINDER_STATES)`
  (`src/chat-commands/show-me-command.js:173`).
- Same optional GitHub enrichment / `[Active PR]` annotation.
- Same `WorkspaceAI` routing — no ad-hoc provider clients.
- Same verbatim-title guard (the `CRITICAL: use the exact task title` rule from `SYSTEM_INSTRUCTIONS`)
  to prevent the title drift fixed in v1.4.159.

**Proposed output** (project-grouped, each project tagged with its client, projects ordered by their
most-urgent member, tasks ranked within a project by the show-me priority ladder):

```
Projects for @user — 8 open reminders across 3 projects

*Client A · Shipping & Tracking*  ⚠️ 1 overdue
  1. [overdue] Add the new Shipping Tracker plugin on Client A — blocking, past due
  2. [due] Wire Shipstation order lookups — due today, [Active PR]

*Client A–Client B · Data Pipeline*
  1. [due] Review WP → Buffer → BigQuery setup (GH #3)

*Neochrome (internal) · Maintenance*
  1. [scheduled] Database restore drill — no deadline pressure
```

**Recommended construction** — one structured call (lowest latency, fewest failure points, JSON →
reliable rendering):

- New handler `src/chat-commands/show-me-projects-command.js` mirroring `show-me-command.js`.
- Reuse the show-me reminder-gathering + GitHub-enrichment block (factor the shared piece into a
  small helper, or replicate the 3-line filter for a Phase-1).
- One `ProcessMessageWithJsonResponseAsync` call returning
  `{ projects: [{ projectName, client, confidence, items: [{ taskTitle, state, rank, reason }] }], ungrouped: [...] }`.
- Deterministic renderer turns that into the layout above (no free-text parsing).
- Register `show-me-projects @user` + self/third-person aliases in `#RegisterCommandRoutes()`
  (`src/chat-module.js`), exactly as the show-me alias families are registered.

## Implementation Options

- **MVP (recommended, no schema change):** read-time grouping only — the `show-me-projects` command
  clusters on demand. Zero changes to the reminder FSM or persistence. Lowest risk.
- **Persisted (~1–2 days, per ask_self):** add `Client`/`Project` fields — requires updating the
  `#MakeScheduledReminder` factory, `data/static/ai/reminders-schema.json`, the extraction prompt,
  and a read-time backfill for legacy records. Only worth it if grouping is needed outside this
  command (e.g. digests, web API, search facets).

## Open Questions

- Group by **project only** (client as a sub-label, as drawn above) or two-level **Client → Project**?
  Flat-project-with-client-tag reads better in a Slack message.
- Model choice for grouping: prod default `gemini-3.5-flash` works but is slow (~32s) and conservative
  on thin text; `gpt-4o` is faster here (~10s) and groups more finely. Pin grouping to the complex
  model regardless of the workspace default?
- Expand `client-channel-mapping.json` to seed the deterministic client prior before shipping.
