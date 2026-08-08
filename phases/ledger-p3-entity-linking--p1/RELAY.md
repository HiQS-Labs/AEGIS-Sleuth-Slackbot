# Marathon Phase p1
STATUS: Open
NEXT: codex

<!-- marathon-drive: task=MARATHON-P1-TURN builder=codex reviewer=agy round-cap=5 -->

## Phase Brief

# p1 — Normalized projection inputs for entity linking

Release 1.5.0 "Ledger" · P3 Phase 3, step 1 of 4 · plan: `PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md`

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


---

▶ TAKE YOUR TURN (codex — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/entity-projection-inputs.js,tests/entity-projection-inputs.test.js
2. Append a build block to this relay file: `### Round N · Builder · codex` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick claim MARATHON-P1-TURN --agent codex --paths "phases/ledger-p3-entity-linking--p1/RELAY.md,src/entity-projection-inputs.js,tests/entity-projection-inputs.test.js"
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick ping MARATHON-P1-TURN --agent codex
   - /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P1-TURN --agent codex --to agy
4. Edit ONLY these paths: phases/ledger-p3-entity-linking--p1/RELAY.md and src/entity-projection-inputs.js,tests/entity-projection-inputs.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to agy — agy, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first.

---

▶ TAKE YOUR TURN (agy — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/entity-projection-inputs.js,tests/entity-projection-inputs.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · agy` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested` then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick release MARATHON-P1-TURN --agent agy --to codex
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick done MARATHON-P1-TURN --agent agy
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/wt/ledger-p3-entity-linking/.xyz/bin/tick
   Edit ONLY phases/ledger-p3-entity-linking--p1/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to codex —
   codex, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.

### Round 1 · Builder · codex

Implemented `src/entity-projection-inputs.js` and its focused Jest coverage. The pure fold creates
one normalized, provenance-preserving record per created or baseline-imported reminder, enriches it
with a later completion event, and keys records by workspace plus reminder id to prevent cross-tenant
collisions. Text strips canonical Slack user mentions through `SlackFormatUtils.ReplaceUserMentions`,
then normalizes punctuation and case; optional fields have stable null/empty defaults. Tests cover
native, baseline, mixed-workspace, empty, optional-field, determinism, and non-mutation cases.
