# p1 — Normalized projection inputs for entity linking

Release 1.5.0 "Ledger" · P3 Phase 3, step 1 of 4 · plan: `PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md`

## Goal

Produce the normalized per-event fields entity linking needs, as a **pure fold over the existing
event log**. Nothing else in this phase.

## Why this first

Every later step (candidate generation, scoring, clustering) reads these fields. Building them first
means the rest is pure logic over a stable shape rather than repeated ad-hoc text munging.

## Scope

Create `src/entity-projection-inputs.js` exposing a pure function that folds reminder events into a
per-workspace array of normalized records carrying at least:

- cleaned reminder text (mentions resolved/stripped, punctuation normalized, case-folded)
- assignee id(s) and original sender id
- source channel and target channel
- creation and completion timestamps
- any GitHub/repo identifier already present in the event payload
- the source event id and type, for provenance

Read from the existing ledger via `src/event-store.js`. Reuse `SlackFormatUtils` for mention
handling rather than re-deriving the mention grammar — `AGENTS.md` records that regex being
independently re-derived in three files as a past defect.

## Hard constraints

- **Strictly additive.** No change to any reminder write path, no new authority boundary, and no
  dependency from reminder scheduling onto this module.
- **Pure fold.** Same events in → same records out. No clock reads, no network, no randomness.
  This is what lets the model be rerun over history safely.
- Handle `BaselineReminderImported` events (from GH-355) alongside native `ReminderCreated` —
  pre-ledger reminders arrive only through that event, and dropping them silently reintroduces the
  null-assignee gap the baseline import was written to close.

## Done when

- `tests/entity-projection-inputs.test.js` covers: a native event stream, a baseline-imported
  stream, a mixed stream, an empty stream, and an event missing optional fields.
- A determinism test asserts two folds over the same input are byte-identical.
- `npm test` green; `npm run build` clean (this repo typechecks JS via JSDoc, `checkJs: true`).

## Out of scope

Scoring, clustering, confidence, LLM inference, any read-path wiring. Those are p2-p4.
