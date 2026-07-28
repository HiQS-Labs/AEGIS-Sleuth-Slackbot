---
title: Canvas Weekly Summary — the one thing worth taking from the Slack MCP shipment
date: 2026-06-12
branch: development
status: proposal — decision gate not yet approved
owner: noel
author: Claude (Opus 4.8, 1M)
model: additive feature behind a per-workspace flag (strangler, add-before-remove)
phases: 4
related:
  - PROJECT/1-INBOX/MCP/SLACK-OFFICIAL-MCP-PERPLEXITY.md
  - PROJECT/1-INBOX/MCP/SLACK-OFFICIAL-MCP-GEMINI.md
  - PROJECT/1-INBOX/P3-EVENT-SOURCED-CORE.md
  - PROJECT/RELAY/summarize-week-completion-review.md
summary: >-
  The two Slack-MCP analyses in this folder both conclude MCP is a complement,
  not a replacement: it has no inbound events, so it cannot touch Sleuth's
  app_mention → reminder → schedule → post core, and its one "win" (read Slack
  history for summaries) is a dependency Sleuth deliberately removed in v1.4.189
  and is removing further in P3. Sifting the shipment leaves exactly one
  capability worth pursuing — Slack Canvas — and it does NOT require MCP. This
  proposes rendering summarize-week as a persistent, formatted Canvas via the
  Web API (canvases.* / canvases:write), replacing the current chunked
  plain-text thread spam, added behind a per-workspace flag with the existing
  chat message kept until the Canvas path is proven. Becoming an MCP *client* of
  Slack's server is explicitly recommended against; exposing Sleuth's own log
  AS an MCP server is parked with P3 Phase 6.
---

# Canvas Weekly Summary

| Most recently completed phase | What's next |
|---|---|
| **None — proposal authored 2026-06-12.** Extracted from the two Slack-MCP analyses ([Perplexity](SLACK-OFFICIAL-MCP-PERPLEXITY.md), [Gemini](SLACK-OFFICIAL-MCP-GEMINI.md)) commissioned against Sleuth's three workflows. Both verdicts: MCP replaces none of our core. The only net-new capability in the shipment that helps us is Slack Canvas — and it needs the Web API, not MCP. | **Phase 0 — Decision gate & scope/plan check.** Approve or kill. Confirm `canvases:write`/`canvases:read` can be added to app `A07JBP3KX45` and that Canvas is available on each live workspace's plan. Decide standalone-vs-channel canvas. No production code until the gate passes. |

## Table of Contents

- [Context](#context)
- [Why This Is the Only Takeaway](#why-this-is-the-only-takeaway)
- [The Core Idea](#the-core-idea)
- [Why](#why)
- [Explicitly Decoupled From MCP](#explicitly-decoupled-from-mcp)
- [Pros & Cons](#pros--cons)
- [How — Phased](#how--phased)
  - [Phase 0: Decision Gate & Scope/Plan Check](#phase-0-decision-gate--scopeplan-check)
  - [Phase 1: Canvas Renderer + Dual Output](#phase-1-canvas-renderer--dual-output)
  - [Phase 2: Living Channel Canvas](#phase-2-living-channel-canvas)
  - [Phase 3 (Optional): Retire the Thread Spam](#phase-3-optional-retire-the-thread-spam)
- [Risks & Mitigations](#risks--mitigations)
- [Open Questions](#open-questions)
- [Relationship to P3](#relationship-to-p3)
- [What We Are NOT Doing](#what-we-are-not-doing)
- [Appendix A: Canvas Render Sketch](#appendix-a-canvas-render-sketch)
- [Appendix B: Compatibility Contract Impact](#appendix-b-compatibility-contract-impact)

## Context

On 2026-02-17 Slack shipped a hosted **MCP server** (`https://mcp.slack.com/mcp`) and a
Real-time Search API. The two analyses in this folder were written against Sleuth's exact
three workflows — listen for `@app_mention`, post scheduled reminders, read completion
history for weekly summaries — and both reach the same verdict, which raises confidence in
it:

- MCP is **pull-only, request/response, no inbound events** (no Socket Mode, no webhooks).
  It therefore **cannot touch** Sleuth's trigger path; Bolt/Socket Mode stays.
- MCP's headline "win" is reading Slack message history back out as hydrated markdown for
  summarization. **Sleuth deliberately went the other way:** v1.4.189 made `summarize-week`
  read the Sleuth-owned [CompletionStore](../../../src/completion-store.js), not Slack, and
  [P3](../P3-EVENT-SOURCED-CORE.md) pushes further toward owning the data. Adopting MCP there
  would re-introduce the very dependency we are removing.
- Becoming an MCP **client** also drags in per-user OAuth token storage/refresh across every
  tenant, per-workspace admin approval, and plan-gated semantic search — real cost, replacing
  nothing.

Sifting all of that out leaves **one** capability the shipment advertised that we'd actually
want: **Slack Canvas**. Critically, Canvas is a plain Web API surface
(`canvases:write` / `canvases.*`). MCP merely put it on our radar; it is not required to use it.

## Why This Is the Only Takeaway

Current behavior, grounded in code: `summarize-week` posts its result via
`this.#SlackBoltApp.client.chat.postMessage()` (helper `PostMessageTextAsync`) in
[reminders-app-mention-handler.js:900-948](../../../src/reminders-app-mention-handler.js#L900-L948).
The summary is **plain text chunked at ~3500 chars** into **multiple threaded replies** to the
invoking channel, because a busy week blows past Slack's 4000-char message limit.

That is the pain: the weekly recap lands as **ephemeral, fragmented thread spam** that scrolls
away and can't be edited in place next week. A **Canvas** is the natural fit — one persistent,
formatted, re-editable document. The completion data is already structured
(`CompletionRecord[]` from `GetCompletedBetween`), so rendering it to Canvas markdown is a pure
function over data we already hold. No canvas code exists in the repo today.

## The Core Idea

Render the weekly summary as a **Slack Canvas** instead of (eventually, in addition to) a
chunked chat thread.

- A pure renderer: `CompletionRecord[] + openReminders + week window → canvas markdown`
  (headers, grouped checklists by assignee/channel, the open-reminders list).
- Write it with the Web API: `canvases.create` / `canvases.edit` (or
  `conversations.canvases.create` for the channel-tab variant). *(Verify exact method
  signatures against docs.slack.dev / node-slack-sdk at implementation — see
  [Open Questions](#open-questions).)*
- Post a **short thread pointer** ("📋 Week summary → <canvas link>") instead of N chunked
  messages.

## Why

- **Flexible.** The renderer is a pure fold over completion data — the same shape P3 turns into
  a projection. A richer summary (streaks, per-client rollups) is a change to one function, not
  the posting plumbing.
- **Adaptable.** A **living** channel canvas can be updated in place each week (prepend the new
  week), giving a single durable recap doc per channel instead of a growing pile of threads.
- **Pivotable-adjacent.** A formatted artifact (not chat text) is the right substrate if the
  recap later becomes a shareable digest, an export, or a non-Slack surface.

And concretely: it deletes the chunking/limit gymnastics in the current output path and turns a
fragmented thread into one clean document.

## Explicitly Decoupled From MCP

This is the point of putting the proposal here rather than chasing the MCP server:

| | This proposal (Canvas via Web API) | If we used the MCP server instead |
|---|---|---|
| Auth | Existing **bot token** (`xoxb`), already in place | New **per-user OAuth** tokens, stored/refreshed per tenant |
| Install | One scope added; standard reinstall/consent | Published app + **admin approval per workspace** |
| Plan gating | Canvas plan availability only (verify) | Semantic search gated behind Business+/Enterprise |
| New infra | None — same `#SlackBoltApp.client` call pattern | An MCP client embedded in the service |
| Replaces core? | No — additive to one output path | No — and re-introduces Slack as source of truth |

The Canvas capability is real and useful; the MCP wrapper around it is not something we need.

## Pros & Cons

**Pros**
- Kills the ~3500-char chunking and multi-message thread spam in the current recap.
- Persistent, formatted, re-editable artifact; "living doc" option per channel.
- Pure renderer over `CompletionRecord[]` — slots cleanly into P3 as a projection later.
- Uses the existing bot token and client pattern; no new auth, no MCP, no new service.
- Strangler-safe: ships behind a per-workspace flag with the chat message retained.

**Cons / costs (honest)**
- Adds OAuth scopes (`canvases:write`, `canvases:read`) → **re-consent/reinstall in every live
  workspace** (multi-tenant operator cost; see [Appendix B](#appendix-b-compatibility-contract-impact)).
- **Canvas plan availability is not confirmed** per workspace — must verify at the gate, exactly
  the kind of unverified plan claim flagged in the Gemini analysis.
- Canvas edit API (sections/operations) is fiddlier than `chat.postMessage`; the living-canvas
  update path (Phase 2) carries the real implementation risk.
- A net-new user-facing output surface — changes where people look for the recap.

## How — Phased

Principle: **add before you remove.** Every phase before 3 keeps the existing chat output intact;
any phase reverts by deleting the new code or flipping the flag off.

### Phase 0: Decision Gate & Scope/Plan Check

- Approve or kill (consider `/take-a-step-back` + `/record-decision` on the outcome).
- Confirm `canvases:write` / `canvases:read` can be added to app `A07JBP3KX45` and enumerate the
  reinstall/re-consent step for each live workspace.
- **Verify Canvas is available on each live workspace's Slack plan** (standalone vs. channel
  canvas may differ by plan).
- Decide the shape: **standalone canvas per week** (simplest) vs. **one living channel canvas**
  updated weekly (best UX, more API surface).
- **Exit criteria:** scope path + plan availability + canvas shape decided; no production code touched.

### Phase 1: Canvas Renderer + Dual Output

- Add a pure `renderWeekSummaryCanvasMarkdown(completedRows, openReminders, week)` function —
  no Slack calls, unit-testable against `CompletionRecord[]`.
- Behind a **per-workspace flag** (default off): on `summarize-week`, additionally
  `canvases.create` the rendered doc and post a one-line thread pointer to it. **Keep the
  existing chunked chat message** posting unchanged.
- **Exit criteria:** on the `neochrome` workspace with the flag on, the Canvas content matches
  the chat summary for a real week; flag off = byte-identical current behavior.

### Phase 2: Living Channel Canvas

- For flagged workspaces, create the channel canvas once (`conversations.canvases.create`) and
  **update it in place** each week (`canvases.edit`, prepend latest week) instead of a fresh doc.
- Thread output becomes only the short pointer; the document is the recap.
- **Exit criteria:** repeated weekly runs update one canvas correctly (no duplicates, correct
  ordering) across at least two consecutive weeks.

### Phase 3 (Optional): Retire the Thread Spam

- Once the Canvas path is proven on real workspaces, drop the chunked plain-text posting, leaving
  only the pointer line. Keep the chat fallback for one release as a rollback escape hatch.
- **Exit criteria:** Canvas is the recap of record; full test suite + `validate:fsm` green;
  rollback flag still restores chat output for one release.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Canvas not on a workspace's plan | Verify at Phase 0; flag is per-workspace, so unsupported tenants keep chat output |
| New scope forces reinstall everywhere | Sequence the re-consent; flag stays off until a workspace is reinstalled |
| Canvas edit/section API trickier than expected | Phase 1 uses create-only (low risk); defer in-place editing to Phase 2 behind its own gate |
| Output regression / users lose the recap | Dual-output through Phases 1–2; chat path retained until Phase 3 + one-release rollback |
| Renderer drift vs. chat summary | Phase 1 shadow-compares Canvas content against the chat summary for a real week before cutover |

## Open Questions

1. **Standalone vs. channel canvas** as the default shape? (Leaning channel canvas for the
   living-doc UX, accepting the heavier edit API.)
2. **Exact Web API method names/signatures** — confirm `canvases.create` / `canvases.edit` /
   `conversations.canvases.create` and the `document_content` markdown shape against
   docs.slack.dev and the installed node-slack-sdk version. *(Treat the names here as indicative.)*
3. **One canvas per channel, per workspace, or per user?** (Channel-scoped matches where
   `summarize-week` already posts.)
4. **Canvas access/visibility** — who can see/edit it; does it inherit channel membership?
5. **Does this wait for [P3](../P3-EVENT-SOURCED-CORE.md)?** It doesn't have to — the renderer is
   the same pure fold either way (see below).

## Relationship to P3

This is **complementary and order-independent** with the [event-sourced core](../P3-EVENT-SOURCED-CORE.md):

- The Canvas renderer is a **pure function over completion data** — exactly P3's projection shape.
  Built now against `CompletionStore`, it becomes a projection over the event log in P3 Phase 4
  with no rewrite.
- It does **not** add a durable write path to defend (the thing P3 is removing); it only changes
  an **output** surface. So it's safe to ship before, during, or after P3.
- It reinforces P3's "Slack is one adapter" thesis without depending on it.

## What We Are NOT Doing

- **Not** becoming an MCP client of Slack's server (per-user OAuth, admin approval, plan-gated
  search, replaces nothing — see the two analyses).
- **Not** using MCP to read Slack history for the summary — Sleuth owns completion data and is
  moving further that direction in P3.
- **Parked, not pursued:** exposing *Sleuth's own commitment log* **as** an MCP server so external
  agents (Claude, Cursor) can query "what did I commit to this week." That is the genuinely
  interesting MCP play, and it belongs with **P3 Phase 6** (LLM-as-runtime / hexagonal adapter),
  not here.

## Appendix A: Canvas Render Sketch

Pure function — no Slack calls — over the existing `CompletionRecord[]` shape:

```js
// completedRows: CompletionRecord[]  ({reminderId, summary, assigneeID, sourceChannelID, dueDate, completedMs})
// openReminders: current active reminders for the week window
// week: { startMs, endMs, label }  e.g. "Mon 8 – Mon 15"
function renderWeekSummaryCanvasMarkdown(completedRows, openReminders, week) {
  // # Week summary (<week.label>)
  // ## ✅ Completed (<n>)
  //   - [x] <summary> — @<assignee> · #<channel> · <completedMs as date>
  // ## ⏳ Still open (<m>)
  //   - [ ] <text> — due <dueDate>
  // returns a markdown string for canvases.create / canvases.edit document_content
}
```

Posting (indicative — confirm signatures at implementation):

```js
const md = renderWeekSummaryCanvasMarkdown(CompletedRows, OpenReminders, Week);
const res = await this.#SlackBoltApp.client.canvases.create({
  title: `Week summary — ${Week.label}`,
  document_content: { type: "markdown", markdown: md },
});
// then post a one-line pointer to res.canvas_id in the thread
```

## Appendix B: Compatibility Contract Impact

Per [AGENTS.md](../../../AGENTS.md) contract tiers:

- **Moderate — Operator/install contract:** adds `canvases:write` / `canvases:read` to app
  `A07JBP3KX45`, requiring **reinstall/re-consent in every live workspace**. Sequence it; gate the
  feature per workspace so un-reinstalled tenants are unaffected.
- **Moderate — User-facing behavior contract:** changes where the weekly recap lands. Mitigated by
  dual-output (Phases 1–2) and a one-release rollback (Phase 3).
- **Low — Build contract:** no FSM interaction; the renderer is a pure output function and does not
  touch [validate-fsm-invariants.js](../../../scripts/validate-fsm-invariants.js).

Phases 0–1 are additive and low-risk. Phase 2 (in-place canvas editing) carries the implementation
risk. Phase 3 is the only removal and keeps a one-release rollback window.
