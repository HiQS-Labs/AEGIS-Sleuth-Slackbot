---
gh_issue: 43
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/43
title: "Reminder extraction fidelity — verbatim task text, wrong assignee, no context/task split (GH-337 follow-up)"
status: IN PROGRESS
created: 2026-08-10
updated: 2026-08-10
owner: noel
branch: gh-43-reminder-extraction-fidelity
doc_type: bugfix
effort: 4
complexity: 4
risk: 3
phases: 4
ratings_provisional: true
related: "GH-337 (shipped Phases 1-4; its Phase 4 threshold-tuning item is the direct parent of Defect 1). GH-22 (multiple assignees — Defect 3 must not regress shared assignment)."
companion: "REMINDER-EXTRACTION-BATTERY-CORPUS.md (the scenario battery this plan is measured against)"
goal: >
  Fix the three defects one production reminder exposed at once: the synthesis gate never firing
  so the task bullet is the whole message verbatim, task and context sharing one field, and every
  @-mention becoming an assignee so a first-person commitment is assigned to its audience instead of
  its author. Measured against the GH-44 replay baseline, not asserted.
---

# GH-43 — Reminder extraction fidelity

## Status

| What was just completed | What's next |
| --- | --- |
| Phase 0 closed by GH-44: the replay harness exists, the baseline is committed, and the battery reports the defects RED (S-01, S-05, S-07, S-12). | Phase 1A — deterministic ownership pre-filter (leading address block + first-person actionable language) |

## Problem

One real Slack message produced a reminder that was wrong on three independent axes at once. A
status report addressed to two colleagues, ending in a first-person commitment:

```
@Mickey @noel root cause: The weekly photo-request system could only ever see a small,
fixed batch of photos, and once it emailed about a plant once it never checked it again.
Over time that batch got fully used up, so the system had nothing left to send.
We fixed it so the scan now covers all photos, and plants can be re-requested after
enough time has passed. Emails will resume for every yard after the next deployment
i am going to deploy the changes tomorrow morning
```

Sleuth scheduled a reminder whose task bullet was the **entire message verbatim**, assigned it to
the **two mentioned colleagues** "as shared work", and left the **sender off it entirely** — the one
person who actually committed to a deploy.

### Defect 1 — the synthesis gate never fires

[`IsTaskSynthesisEnabledForText`](../../src/reminders-ai-pipeline.js#L389) routes by sentence count.
[`CountSentences`](../../src/reminders-ai-pipeline.js#L374) matches `[.!?]` followed by
whitespace/end, so this message counts **3** — its last two lines carry no terminal punctuation.
`LONG_MESSAGE_SENTENCE_THRESHOLD = 4`, so it routes to the **normal** segment where
`REMINDER_TEXT_SYNTHESIS_NORMAL` defaults **off**, and
[`#SelectReminderTaskText`](../../src/reminders-module.js#L1963) takes the verbatim branch.

[`DescribeSynthesisRouting`](../../src/reminders-ai-pipeline.js#L406) already computes
`actionableSpanRatio` (≈0.07 here) and its own comment calls the low-ratio case *"a small buried
task in a big note — the case synthesis targets."* It is logged, then ignored by the router. This is
GH-337's open Phase 4 item ("confirm the 4-sentence split from real data") coming due.

### Defect 2 — no separation between task and context

The bullet is one string, so the root-cause paragraph and the commitment fuse into one line. The
full original is already preserved in the reminder's blockquote, so the bullet is free to be short —
but there is no field for a one-line context, and no `task` distinct from the source span. The
multi-task path models this (`title`); the single-message path never got it.

The prompts also currently forbid the synthesis being asked for:
[reminders-instructions.md:80](../../data/static/ai/reminders-instructions.md#L80) defines
`actionable_language` as a verbatim quotation, and `ExtractMultiTaskCandidatesAsync`'s system prompt
says *"Extract ONLY text that appears verbatim… Never invent or paraphrase."* That guarantee is
right for the **evidence span** and wrong for the **display title**.

### Defect 3 — mentioned ≠ assigned (most severe)

The analyzer has no concept of ownership at all; `reminders-instructions.md` never mentions
assignees. Ownership is decided afterward by regex at
[reminders-module.js:1713](../../src/reminders-module.js#L1713):

```js
const ExtractedAssigneeIDs = this.#ExtractAssigneeIDsFromReminderText(NewReminderMessageText);
const AssigneeIDs = ExtractedAssigneeIDs.length > 0 ? ExtractedAssigneeIDs : [ArgUserID];
```

[`#ExtractAssigneeIDsFromReminderText`](../../src/reminders-module.js#L2090) scrapes every `<@U…>`
in the quoted original with no position or grammatical-role awareness. A leading address block makes
the list non-empty, so the sender fallback never fires.

The other path already gets this right —
[reminders-ai-pipeline.js:750](../../src/reminders-ai-pipeline.js#L750): *"use DefaultAssigneeID if
provided, otherwise the user from the source message. Never invent users."* Two code paths, two
contradictory ownership models; the one that ran here is the wrong one. Six of the seven
`actionable language` examples at
[reminders-instructions.md:13-19](../../data/static/ai/reminders-instructions.md#L13) are
first-person commitments, and every one is misassigned whenever the message also @-mentions anybody.

## Why Phase 0 exists

All three fixes change *judgment* behavior, not just plumbing — how a message is routed, who owns it,
how much of it is shown. Assertions about "better" are worthless without a measured before/after, and
the before cannot be re-run once the code changes. So the first phase builds the instrument and
captures the baseline, and no fix lands until the instrument has been proven able to fail.

The battery corpus lives in its companion doc,
[REMINDER-EXTRACTION-BATTERY-CORPUS.md](REMINDER-EXTRACTION-BATTERY-CORPUS.md).

> **RE-SCOPED 2026-08-10 — Phase 0 no longer builds its own harness.**
> A review of the repo found that ~70% of this machinery already existed, built three times for
> three pipelines: [ai-decision.js](../../src/ai-decision.js) (the decision abstraction),
> [router-shadow-store.js](../../src/router-shadow-store.js) (corpus capture + offline replay,
> shipped and active in prod under GH-397), and the `:wrench:` triage (debugging). GH-397 had
> already locked *"build ONE capture harness"* and named a second parallel shadow path as an
> explicit non-goal — which is what this phase would have been.
>
> That consolidation is now [GH-44](../2-WORKING/GH-44-DECISION-CAPTURE-DEBUG.md), which lands
> first. **Phase 0 becomes a consumer of it**, not a builder: the 15 scenarios below stay valid
> as content, the baseline capture and the instrument-must-fail gate stay as requirements, but the
> harness itself is `scripts/decision-replay.js` from GH-44 rather than anything built here.
>
> Questions Q1–Q5 below are answered by GH-44's design and are retained only as the record of why.
> The one that still belongs to this issue is **Q3** — which layer each defect lives in — because
> that determines how much of this battery can gate CI.

## Table of contents
- [Phase 0 — Spike: battery corpus + before/after harness](#phase-0)
- [Phase 1 — Assignee ownership](#phase-1)
- [Phase 2 — Synthesis routing gate](#phase-2)
- [Phase 3 — Task/context split](#phase-3)

<a id="phase-0"></a>
## Phase 0 — Spike: battery corpus + before/after harness

A time-boxed spike. Output is a decision record plus a working harness — **no production code
changes in this phase.**

### Questions the spike must answer

1. **What is "before"?** Today's behavior cannot be re-run after the code changes, so the baseline
   must be captured and committed from unmodified `development` HEAD first. Decide the snapshot's
   canonical shape — at minimum, per scenario: `recommendation`, displayed task text, `AssigneeIDs`,
   `scheduling_trigger`, and the `DescribeSynthesisRouting` facts (`segment`, `synthesisOn`,
   `actionableSpanRatio`, `sentenceCount`).
2. **Can a mocked model measure any of this?** [`ConfigureMockWorkspaceAI`](../../tests/mocks/mock-workspace-ai.js)
   returns one canned analyzer response regardless of input — a corpus run through it replays the
   canned answer and proves nothing. Decide between:
   - **deterministic mode** — per-scenario recorded analyzer responses, replayed. Fast, free,
     CI-safe. Exercises the routing gate, the assignee regex, and the display selector.
   - **live mode** — real model calls, opt-in via env, never in CI. Only needed to evaluate *prompt*
     changes (Phase 1's `owner` field, Phase 3's title/context split).
3. **Which layer does each defect actually live in?** Working hypothesis: all three sit in the
   deterministic layer (the gate, the regex, the selector), so deterministic mode catches all three
   at zero LLM cost and live mode is only needed for Phases 1B/3. Confirm or refute — this decides
   how much of the battery can gate CI.
4. **Reuse or build?** [`scripts/reminder-thread-battery.js`](../../scripts/reminder-thread-battery.js)
   is an existing scenario runner with a mocked WorkspaceAI, and
   [`scripts/projection-parity-harness.js`](../../scripts/projection-parity-harness.js) is an
   existing before/after diff reporter. Prefer extending them over a third harness; say so
   explicitly either way.
5. **What format does the corpus ship in?** The companion doc is currently prose + tables because
   nothing parses it yet. Phase 0 decides whether the harness reads that file directly or whether it
   generates a fixture — and if a fixture, the doc must become a pointer, not a second copy
   (PDDA: one canonical place per fact).

### Deliverables

- [ ] Decision record answering Q1–Q5, appended to this phase.
- [ ] Harness runnable as an npm script (proposed: `npm run battery:extraction`), reporting one row
      per scenario: `PASS` / `FAIL` / `CHANGED-vs-baseline`.
- [ ] Baseline snapshot captured from unmodified `development` HEAD and committed.
- [ ] Corpus in whatever machine-readable form Q5 settles on.

### QA — the instrument gate

- [ ] **The harness must fail before it may be trusted.** Run the corpus against unmodified
      `development` and confirm it reports RED on at least the three known defects: scenario `S-01`
      shows the whole message as the task bullet, `S-01` assigns to the mentioned users instead of
      the sender, and `S-01` has no context field. A green run here means the instrument is broken,
      not that the code is fine.
- [ ] Every scenario's baseline row is *captured*, never hand-authored — no expected-value guessed
      from reading source. (The corpus doc ships with baselines marked `TBD — Phase 0` for exactly
      this reason; only `S-01` is pre-filled, because it was observed in production.)
- [ ] Re-running the harness twice on the same commit produces byte-identical output (no clock, no
      `Math.random`, no live model in the default mode).
- [ ] Deterministic mode makes zero network calls — assert on the mock, don't assume.

<a id="phase-1"></a>
## Phase 1 — Assignee ownership

Split into a cheap deterministic step and a model-backed step, so the common case is fixed without
waiting on a prompt/schema change.

### 1A — deterministic pre-filter (no model change)

- [ ] **Leading address block**: when a message opens with one or more consecutive `<@U…>` mentions
      followed by non-mention prose, treat them as audience, not owners.
- [ ] **First-person test** on `actionable_language` (not the whole message, so an unrelated
      first-person sentence elsewhere cannot hijack ownership) → assign to sender.
- [ ] Sender fallback fires when the filtered mention set is empty.

### 1B — analyzer ownership field

- [ ] Add to the reminder schema, per candidate: `owner` (`speaker` | `mentioned` | `unclear`) and
      `owner_mentions` (populated only when `owner === "mentioned"`, scoped to the clause carrying
      the commitment).
- [ ] Add the corresponding rules to `reminders-instructions.md`, which currently has none.
- [ ] At [reminders-module.js:1714](../../src/reminders-module.js#L1714), regex becomes the
      guardrail rather than the source: `speaker` → `[sender]`; `mentioned` →
      `owner_mentions ∩ regexResults`; `unclear` → today's behavior. **The intersection is load
      bearing** — it preserves "never invent users" by letting the model only ever narrow the set.
- [ ] Reconcile with `ExtractMultiTaskCandidatesAsync`'s existing ownership rule so the two paths
      stop disagreeing.

### QA

- [ ] `S-01` assigns to the sender alone. Fails on baseline, passes after.
- [ ] `S-06` (explicit "can you both…") still assigns to both — **GH-22 shared assignment must not
      regress.**
- [ ] `S-03` (no mentions, first-person) unchanged from baseline.
- [ ] `S-05` (mention as subject, not assignee) assigns to the sender.
- [ ] The model cannot add a user that was not `<@…>`-mentioned in the source — assert on a
      deliberately adversarial recorded response, not just on well-behaved ones.

<a id="phase-2"></a>
## Phase 2 — Synthesis routing gate

- [ ] Route on the already-computed `actionableSpanRatio` + message length rather than sentence
      count: long message with a small actionable span → synthesize, regardless of sentence count.
      Thresholds to be set from the Phase 0 baseline and any available prod telemetry, not guessed.
- [ ] Treat a hard newline as a sentence boundary in `CountSentences` — chat writers routinely drop
      terminal periods, which is what let this message count 3.
- [ ] **Do not feed the ratio from the force-schedule path.**
      [reminders-module.js:1573](../../src/reminders-module.js#L1573) sets `actionable_language` to
      the entire message, pinning the ratio at 1.0 and defeating the gate. Source it from the
      analyzer's span or the regex trigger match.
- [ ] Close GH-337's open Phase 4 item, or restate it if the ratio gate makes the sentence threshold
      moot.

### QA

- [ ] `S-07` (the reported case) synthesizes. Fails on baseline, passes after.
- [ ] `S-08` (short clean actionable message) stays verbatim **and makes no LLM call** — assert the
      call count, since the per-segment force-schedule gate exists precisely to avoid that spend.
- [ ] `S-09` (long, properly punctuated) still synthesizes — no regression in the case that already
      works today.
- [ ] `S-10` (long note, no task) still recommends `ignore` — the gate must not manufacture work.
- [ ] `S-11` quoted-task-name rule still honored verbatim.
- [ ] Whole-corpus diff vs. baseline: every `CHANGED` row is individually justified in this phase's
      notes. An unexplained change is a finding, not noise.

<a id="phase-3"></a>
## Phase 3 — Task/context split

Largest blast radius — touches the display contract and the persisted reminder shape. Sequenced last
deliberately.

- [ ] Model `task` (imperative, short) and `context` (one line of why) as distinct fields rather than
      one bullet string.
- [ ] Render `context` subordinately (Slack context block), never inline in the bullet. The verbatim
      original stays in the blockquote, unchanged.
- [ ] Narrow the verbatim guarantee: keep `actionable_language` byte-exact as the audit span; allow
      the **display title** to be rewritten under a grounding constraint — every entity, product
      name, and number in the title must appear in the source. Enforce that in code, not only in the
      prompt.
- [ ] Consider `AssigneeIDs` vs `NotifyIDs` so a self-commitment stops borrowing GH-22's "as shared
      work" phrasing and FYI recipients have somewhere legitimate to live. **Open question — decide
      in this phase, do not assume.**
- [ ] Assess the event-schema impact before writing code; coordinate with `P3-EVENT-SCHEMA-EXPANSION`
      in `2-WORKING` if the persisted shape changes.

### QA

- [ ] `S-12` renders a short task with context in a separate block and the full original in the
      blockquote.
- [ ] Grounding check rejects a title containing an entity absent from the source.
- [ ] `S-13` (multi-step commitment) is not over-compressed to the last verb — the existing
      `reminders-instructions.md:85` rule still holds.
- [ ] Existing reminder rendering tests (`validate:reminder-render`,
      `tests/reminders-display-utils.test.js`) stay green, or every intentional change is enumerated.
- [ ] Rollback story stated explicitly: what happens to reminders persisted under the new shape if
      this phase is reverted.

## Open items

| Item | Recommendation | Next step | Owner |
|---|---|---|---|
| Triage ratings are provisional (`ratings_provisional: true`) | Confirm or adjust `effort 4 / complexity 4 / risk 3` before this doc is auto-selectable by the marathon layer | Review at promotion to `2-WORKING` | noel |
| Ratio + length thresholds for Phase 2 | Do not guess — derive from the Phase 0 baseline plus prod `reminder display source:` telemetry from 1.4.205+ | Pull the log sample during Phase 0 | Phase 0 spike |
| `AssigneeIDs` vs `NotifyIDs` split | Worth doing, but it changes persisted shape — decide inside Phase 3 rather than assuming it now | Design note in Phase 3 before code | Phase 3 |
| Live-mode corpus runs cost real tokens | Keep live mode opt-in and out of CI; deterministic mode gates | Settled by Phase 0 Q2 | Phase 0 spike |
