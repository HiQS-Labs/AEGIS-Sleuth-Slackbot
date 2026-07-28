---
title: "Connect the dots — persist client/project identity + operator defaults, and \"talk with my reminders\""
status: Complete (3-COMPLETED) — shipped 2026-07-13 via marathon lanes p1/p2/p4 (smart-sleuth-360-361-362); e2e lane p6 green
created: 2026-07-10
updated: 2026-07-10
owner: noel
branch: main
doc_type: project
gh_issue: 361
source: https://github.com/NeochromeTeam/sleuth-app/issues/361
related: "#360, #362, #328"
consult: relay-system/2026-07-10/smart-plan-360-361-131306/ (Codex gpt-5.4 + agy, reconciled)
goal: >
  Stop the "compute → render → discard" pattern. Stamp client/project identity at reminder
  creation, store org conventions as operator-edited config, and answer free-form questions
  over live authoritative reminder data — wiring each new artifact into a surface users
  already touch, so the intelligence is felt, not filed.
effort: 3
complexity: 3
risk: 2
phases: 3
---

# Connect the dots — persist identity + operator defaults, and "talk with my reminders"

## Status

| What was just completed | What's next |
|---|---|
| Issue [#361](https://github.com/NeochromeTeam/sleuth-app/issues/361) filed; cross-model consult (Codex + agy, [relay-system/2026-07-10/smart-plan-360-361-131306](../../relay-system/2026-07-10/smart-plan-360-361-131306)) adjudicated and folded in; promoted to 2-WORKING with a swarm-preflight contract + acceptance criteria. | Fire marathon lane **p1 — Phase A (identity stamping + operator defaults)** via `swarm-preflight → marathon.sh --plan`. Awaiting operator go. See [marathon-plans/smart-sleuth-360-361-362/](../../marathon-plans/smart-sleuth-360-361-362/). |

## Table of contents

- [Phase A — Identity stamping + per-client operator defaults](#phase-a--identity-stamping--per-client-operator-defaults)
- [Phase B — "Talk with my reminders" (ask-reminders) over live authoritative data](#phase-b--talk-with-my-reminders-ask-reminders-over-live-authoritative-data)
- [Phase C — Durable client/project map, deterministic-first](#phase-c--durable-clientproject-map-deterministic-first)

## The complaint this issue answers

Sleuth doesn't feel "smart," and the reason is visible in the code: the pattern everywhere is
**compute → render to Slack → discard**.

- `show-me-projects` runs an LLM to build a client/project map every call — and throws the result away.
- `connection-surfacing` finds related-work relationships on every creation — and throws them away.
- Task history sits in authoritative stores (in-memory queue + completion-store) and the advisory
  ledger — and no conversational surface reads any of it.

The plumbing is built. This issue makes Sleuth **stamp** identity at creation, **store** org
conventions as config, **answer questions** from its own live data — and critically, **wire every
new artifact into a surface users already touch**, so the intelligence is felt, not filed.

## Consult verdict folded in (Codex + agy, adjudicated)

- **Data source (agy Blocker, upheld):** per-client history reads the **authoritative stores** — open
  reminders from the in-memory queue (`GetAllReminders`), completions from
  [completion-store.js](../../src/completion-store.js) (already powers summarize-week). The ledger fold
  ([events-projection.js](../../deploy/reminders-export/events-projection.js)) is **not** a v1 data
  source — it stays shadow-validated enrichment per #328, since appends are fire-and-forget/lossy and
  folded state can silently drift.
- **Old Phase C cut (both advisors, upheld):** write-time debounced LLM summary synthesis
  (dirty-marking, coalescing, refresh-on-create) is over-engineered and is **deleted from this plan**.
  agy's math: the ask-self-style 80k-char budget fits ~300 full reminders — direct injection of live
  data covers v1. Lazy *on-read* cached synthesis is the documented fallback **only if** prompts
  outgrow the budget.
- **Project-map authority (Codex Blocker, upheld):** never seed a durable project table straight from
  a transient one-user LLM grouping — that fossilizes a model guess. Deterministic-first contract in
  Phase C.
- **Org conventions are config, not inference (Codex, upheld):** assignee routing and deploy windows
  are operator facts. They live in an operator-edited per-client defaults block, not synthesized
  summaries.
- **Visibility rule (Codex Blocker, upheld):** every phase must land its output in an existing hot
  surface (creation footnote, show-me family, ask-reminders) — otherwise "compute → discard" just
  becomes "compute → persist → invisible."

## Phase A — Identity stamping + per-client operator defaults

Make client/project identity **stored, not re-derived** — on both the live object and the event.

- Add stable `ClientID` to [client-channel-mapping.json](../../data/static/client-channel-mapping.json)
  entries (table already exists).
- **Per-client operator defaults block** in the same file: `{DefaultAssigneeID, DeadlineConvention}`
  (e.g. Client A → Mike, "Sunday 21:00 PT deploy"). Operator-edited config — the cheapest real win for
  #360's assignee/deadline defaults; no pipeline required.
- Resolver in `client-mapping.js`: reminder → `{ClientID, ProjectID}` (channel/repo pattern match,
  existing logic).
- Stamp `clientId`/`projectId` on the **live `ReminderInfo`** in `#MakeScheduledReminder`
  **and** into the `ReminderCreated` payload. Hot paths read memory, not the ledger. **Additive:**
  [NormalizeEvent](../../src/event-store.js#L48) only validates required keys — extra payload keys
  pass through, zero event-store changes.
- Historical/unstamped reminders resolve via the same resolver at read time (no backfill).
- **Visible immediately:** creation footnote ([connection-surfacing.js](../../src/connection-surfacing.js))
  shows the resolved client label alongside related open work.

### QA gate — Phase A
- [x] New Client A-channel reminder carries `clientId` on the live object and in its `ReminderCreated` event.
- [x] Creation reply visibly names the client; unstamped old reminders still resolve at read time.
- [x] `data/static/client-channel-mapping.json` parses; missing defaults degrade gracefully (blank, not error).

## Phase B — "Talk with my reminders" (ask-reminders) over live authoritative data

The first broadly-felt smart surface, and cheap because it needs no summary pipeline.

- New `ask-reminders` command (catalog entry + NL aliases): free-form questions over task state and
  history — "what's open for Client A?", "what did Mike complete last week?", "which projects have gone
  quiet?".
- **Direct context injection, no embeddings, no pre-synthesis (v1):** compose the prompt from live
  open reminders (in-memory queue) + completion-store history + Phase A stamps + operator defaults,
  within an ask-self-style context budget ([src/rag/index.js](../../src/rag/index.js) runs 80k chars).
  Ledger fold may *enrich* (cancelled/snoozed detail) but never contradicts the authoritative stores.
- Complex model; answers must cite task ids/clients from the injected data — never invent tasks.
- **Escape hatch (documented, not built):** if injected context outgrows the budget, add lazy on-read
  cached synthesis per client — not write-time triggers.

### QA gate — Phase B
- [x] "What's open for Client A?" answers from live + completion data and cites real task ids.
- [x] Answers reflect a completion recorded seconds ago (authoritative in-memory read — a folded-ledger
      source could not guarantee this).
- [x] Question about a client with no data → honest "nothing recorded," not hallucination.
- [x] Budget guard: a workspace whose injected context would exceed 80k chars truncates deterministically
      (oldest-first) and says so, never silently drops.

## Phase C — Durable client/project map, deterministic-first

- Persist a client/project map at `data/runtime/client-project-map/<workspace>.json` — but authority
  order is: **deterministic match first**
  ([reminder-clustering.js](../../src/reminder-clustering.js) shared-repo/channel/client), **LLM
  proposes only for unmatched tasks** (show-me-projects `GROUPING_SCHEMA` pattern), **operator
  confirms/edits** (file is operator-owned, like client-mapping). Model output never silently becomes
  identity.
- `show-me-projects` reads the persisted map for known tasks and only invokes the LLM for the unmatched
  remainder — faster and cheaper than today's full-regroup-every-call.
- Shared prompt-context helper injects the map into opted-in LLM calls (#360 extraction,
  ask-reminders). Artifact carries `generatedAt`; advisory context, never task state; fail open when
  missing/corrupt.

### QA gate — Phase C
- [x] A task matching a known project via shared repo gets its ProjectID with **no LLM call**.
- [x] LLM-proposed mappings are marked `proposed` until operator-confirmed; second show-me-projects
      call reuses confirmed mappings.
- [x] Corrupt/missing map file → show-me-projects falls back to today's full-regroup path (fail open).

## Cut (was Phase C): write-time rolling summary synthesis

Deleted per consult. No dirty-marking, no debounce machinery, no refresh-on-creation LLM triggers. The
need it served is met by Phase B's direct injection; if scale ever demands pre-synthesis, it returns
as lazy on-read caching, tracked in a fresh issue with evidence.

## Acceptance criteria

- [x] Reminders created in a client channel are stamped `clientId`/`projectId` on the live object and
      the `ReminderCreated` event; unstamped historicals resolve at read time.
- [x] `client-channel-mapping.json` carries `ClientID` + a `{DefaultAssigneeID, DeadlineConvention}`
      defaults block per client, operator-edited, parsed defensively.
- [x] Creation footnote names the resolved client.
- [x] `ask-reminders` answers free-form questions from live queue + completion-store, cites real task
      ids, and never invents tasks; honest empty answer when no data.
- [x] Durable client/project map is deterministic-first; LLM only proposes for unmatched tasks;
      operator confirms; show-me-projects reuses confirmed mappings and fails open on a bad file.
- [x] Full test suite green (`npm test`).

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "main" },
  "gate":        "npx jest client-mapping reminders-module connection-surfacing reminder-clustering show-me-projects --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "data/static/client-channel-mapping.json", "pattern": "ClientID" },
    { "type": "grep_absent", "path": "data/static/client-channel-mapping.json", "pattern": "DefaultAssigneeID" }
  ],
  "artifacts":   [
    "data/static/client-channel-mapping.json",
    "src/client-mapping.js",
    "src/reminders-module.js",
    "src/connection-surfacing.js",
    "src/reminder-clustering.js",
    "src/chat-commands/show-me-projects-command.js",
    "tests/client-mapping.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "Phases A–C of GH-361" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [ "data/runtime/" ] }
}
```

## Sequencing

**A → B → (#360 Phase 1) → C.** Each independently shippable; every phase lands output in a
user-visible surface the day it ships. #360 consumes A's operator defaults + B's live-data injection
(no longer blocked on any summary pipeline). Ledger-authority questions stay in #328. This doc is
marathon lane **p1 (Phase A), p2 (Phase B), p4 (Phase C)** in
[marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml](../../marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml).
