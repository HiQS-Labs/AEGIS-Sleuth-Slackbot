---
gh_issue: 43
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/43
title: "Reminder extraction fidelity — verbatim task text, wrong assignee, no context/task split (GH-337 follow-up)"
status: COMPLETE
created: 2026-08-10
updated: 2026-08-10
owner: noel
branch: gh-43-reminder-extraction-fidelity
doc_type: bugfix
effort: 4
complexity: 4
risk: 3
phases: 4
ratings_provisional: false
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
| All four phases shipped and **agy branch QA closed `Approved` at r3/3**. The battery went **4 FAIL / 11 PASS on unmodified `development` → 20 PASS**, every mechanism proven load bearing by perturbation. Full suite **1766 jest + 115 node**, tsc clean, all validation gates green. | Open the PR (stacked on `gh-44-decision-capture-debug`); neither branch is pushed yet |

## Branch QA — what the review actually caught

`relay-system/2026-08-10/gh-43-branch-qa.md`, agy reviewing. Two `[Blocker]`s at r1, both valid, both
the **same underlying failure: a harness measuring itself instead of the code.**

| Finding | Verdict | Fix |
|---|---|---|
| "both mechanisms disabled" was claimed in the DoD but **never tested** — each perturbation restored before the next ran, so the combined state never existed | Valid, and **understated**. The true failure set is `S-01, S-07, S-12` **and `S-16`**; my own claim was stale because `S-16` was added after I last measured the combined case | Asserted explicitly |
| The grounding perturbation was **structurally incapable of failing for the right reason** — `decision-replay.js` reimplemented the display rule, so mocking the check only broke the harness's copy. Delete the production check and the test still passes | Valid, and the sharpest finding in the review | Fixed **structurally**: the rule moved to `src/reminder-display-selection.js` and both production and the harness now call it. The test also asserts the harness holds no private copy |

**That refactor immediately exposed a third divergence of the same class** — the best argument for
doing it. Production applies an over-compression fallback the harness never did, and *on the reported
message it fired*: `"deploy the changes"` (3 words) lost to `"i am going to deploy the changes"`,
which is longer only by its first-person preamble. So the battery had been reporting a bullet
production would not render, and this doc's own headline claim about `S-01` was measuring the harness.
The GH-337 heuristic was tightened from `<= 3` to `<= 2` words — a real behavior change to
pre-existing logic, and it had shipped with zero test coverage.

**Two notes on the review itself**, recorded because a QA pass is evidence only to the extent it is
checkable:
- agy's `[Pass]` for DoD #1 cited `tests/reminders-module-gh-43.test.js`, **which does not exist**.
  Under the thread's own GH-173 B3 rule that is `[Unverified — no citation]`; verified independently
  against `tests/reminders-task-context-split.test.js`.
- agy's `[Pass]` for DoD #5 was true of `ReminderCreated` but I had asked the wrong question. **I found
  a real defect there myself while the review ran**: `BaselineReminderImported` has two *other*
  producers (`state-snapshot-writer.js`, `baseline-import.js`) that both dropped `NotifyIDs`. Since
  parity compares the **union of keys**, a reminder carrying `NotifyIDs` would fold to one without it
  and fail parity — and compaction is irreversible, so the field would be lost permanently.

## Result

| Defect from the report | Status | Proof |
|---|---|---|
| 1 — task bullet was the whole 480-char message | **Fixed** (Phase 2) | `S-01` bullet is now `"deploy the changes"`; `S-07`, `S-12` likewise |
| 2 — no separation between task and context | **Fixed** (Phase 3) | `S-01` renders a short task with the background on its own subordinate line |
| 3 — assigned to the two mentioned colleagues, not its author | **Fixed** (Phase 1A) | `S-01` assignees `["U_SENDER"]`, notify `["U_ALPHA","U_BETA"]` |

Everything below is the phase-by-phase record, including the two places the shipped design
deliberately departs from this plan and why.

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

### 1A — deterministic pre-filter (no model change) ✅

- [x] **Leading address block**: when a message opens with one or more consecutive `<@U…>` mentions
      followed by non-mention prose, treat them as audience, not owners.
- [x] **First-person test** on `actionable_language` (not the whole message, so an unrelated
      first-person sentence elsewhere cannot hijack ownership) → assign to sender.
- [x] Sender fallback fires when the filtered mention set is empty.

Shipped as [reminder-ownership.js](../../src/reminder-ownership.js). Ownership is read from the
**grammatical subject of the commitment**, which was the signal missing all along — never the mention
list. `"we"` is deliberately excluded as ambiguous between the speaker and the team.

### 1B — analyzer ownership field ✅

- [x] Add to the reminder schema, per candidate: `owner` (`speaker` | `mentioned` | `unclear`) and
      `owner_mentions`.
- [x] Add the corresponding rules to `reminders-instructions.md`, which had none.
- [x] Wire into the write path with the intersection guard.
- [x] Reconcile with `ExtractMultiTaskCandidatesAsync`'s ownership rule.

> **PRECEDENCE IS INVERTED FROM THE SKETCH ABOVE, deliberately.** The original plan made the analyzer
> the source of truth and demoted the mention regex to a guardrail. That was written before 1A
> existed. 1A turned out to resolve both battery ownership scenarios correctly at **zero model cost**,
> so making a model call authoritative *over* a proven deterministic signal would trade a free correct
> answer for a paid uncertain one — and would put GH-22 shared assignment at the mercy of a prompt.
>
> Shipped order: a **strong grammatical signal wins outright** (explicit first- or second-person); the
> analyzer is consulted **only where grammar is ambiguous**, which is the case 1A genuinely could not
> reach (`S-19`: an address block with no grammatical subject at all). 1A behavior is byte-identical.
>
> **The intersection guard from the plan is preserved and load bearing**: `owner_mentions` is
> intersected with the mentions actually present in the source, so the model may only narrow.

**Reconciling the two paths surfaced a real hole.** `ExtractMultiTaskCandidatesAsync`'s prompt has
always said *"Never invent users"* and **nothing enforced it** — the model's `assigneeID` was taken
verbatim. A prompt instruction is not a guarantee. Both paths now share
`ConstrainAssigneeToParticipants`, which allows only thread authors, `<@U…>`-mentioned users, and an
operator-configured default.

### QA

- [x] `S-01` assigns to the sender alone. Failed on baseline, passes after.
- [x] `S-06` (explicit "can you both…") still assigns to both — **GH-22 shared assignment did not
      regress**, and `tests/reminders-multiple-assignees.test.js` passes unmodified.
- [x] `S-03` (no mentions, first-person) unchanged from baseline.
- [x] `S-05` (mention as subject, not assignee) assigns to the sender.
- [x] **The model cannot add a user that was not `<@…>`-mentioned in the source.** Two adversarial
      scenarios, one per path: `S-17` (thread path, `assigneeID: "U_GHOST"` → discarded to `null`)
      and `S-18` (single-message path, `owner_mentions: ["U_GHOST","U_ALPHA"]` → narrowed to
      `["U_ALPHA"]`). Falsified by perturbation: making the guard fail open turns `S-17` red with
      `INVENTED USER U_GHOST`.

### A harness bug this phase exposed

Building the adversarial gate turned up a defect in the GH-44 replay harness itself: it handed the
scenario's `recordedResponse` to the pipeline **by reference**, and the pipeline legitimately writes
back to it (`ExtractMultiTaskCandidatesAsync` overwrites a rejected `assigneeID` in place). So the
first run scrubbed `U_GHOST` out of the require-cached fixture, and every later run in that process
replayed a response the file never contained — a deliberately broken guard then had nothing left to
leak. The existing determinism test could not see it, because the corruption is **idempotent**: run 2
and run 3 agree with each other, just not with the fixture. Responses are deep-cloned per call now,
with a regression test that asserts the fixture is untouched.

<a id="phase-2"></a>
## Phase 2 — Synthesis routing gate ✅

- [x] Route on the already-computed `actionableSpanRatio` + message length rather than sentence
      count: long message with a small actionable span → synthesize, regardless of sentence count.
      Thresholds derived from the committed baseline (see below), not guessed.
- [x] Treat a hard newline as a sentence boundary in `CountSentences` — chat writers routinely drop
      terminal periods, which is what let this message count 3.
- [x] **Do not feed the ratio from the force-schedule path.** `DescribeSynthesisRouting` takes a
      `SyntheticActionableSpan` option; the force-schedule call site sets it, so the ratio is still
      reported but `spanRatioUsable: false` and routing falls back to the sentence count.
- [x] Close GH-337's open Phase 4 item — see "Disposition of GH-337 Phase 4" below.

### Thresholds, and how they were derived

Both constants live in [reminders-ai-pipeline.js](../../src/reminders-ai-pipeline.js) with this
reasoning inlined, so it is visible at the point of change rather than only here.

| Constant | Value | Derivation |
|---|---|---|
| `BURIED_TASK_MIN_LENGTH` | 150 | Battery messages that MUST synthesize start at **189** (`S-12`); the longest that must stay verbatim is **94** (`S-13`). Gap `[95, 188]` contains no scenario. 150 is near its middle. |
| `BURIED_TASK_MAX_SPAN_RATIO` | 0.35 | **Constrained only from below.** Every must-synthesize row sits ≤ 0.13 (`S-09` 0.13, `S-12` 0.08, `S-01` 0.07, `S-07` 0.05). The battery contains **no long message that must stay verbatim**, so nothing pins the ceiling from above. 0.35 is a deliberately conservative choice, not a fitted one. |

Length is load bearing independently of ratio: `S-05` has a low 0.16 ratio but is only 80 chars, and
a short message with a short task is not a buried task.

### Both mechanisms are independently load bearing

Proven by perturbation, not assertion — encoded as a permanent test in
[decision-replay.test.js](../../tests/decision-replay.test.js) so it cannot rot:

| Perturbation | Battery result |
|---|---|
| none (shipped code) | 16 PASS / 0 FAIL |
| ratio gate disabled | **S-07, S-12 FAIL** |
| newline rule reverted to punctuation-only | **S-16 FAIL** |
| both disabled (= pre-Phase-2 code) | **S-01, S-07, S-12 FAIL** — the original three defects, reproduced exactly |

The first perturbation run showed the newline rule failing *nothing*, because the ratio gate already
covered `S-01`. That was a **gap in the battery, not a redundant mechanism**: when the analyzer
returns no quoted span the ratio is 0 and unusable by design, leaving sentence count as the only
router. Scenario **`S-16`** was added to cover exactly that path, which is what makes the newline
rule falsifiable.

### Whole-corpus diff vs. the pre-Phase-2 baseline

Every `CHANGED` row, justified. No row changed that should not have.

| Rows | What changed | Verdict |
|---|---|---|
| `S-01`, `S-07`, `S-12` | `displayedTasks` whole-message → analyzer brief; `segment` normal→long; `synthesisOn` false→true | **Intended** — the three target defects |
| `S-09` | `routedBy` reports `buried_task_ratio` | **Label only.** Already `long` via sentence count (5); now also qualifies on ratio (0.13). `segment` and `synthesisOn` unchanged |
| all 12 others | only the two new reporting fields `messageLength` and `routedBy` appeared | **No behavior change** |
| `S-16` | NEW | added this phase (see above) |

**No scenario outside the three targets changed its `displayedTasks`, and no ownership field moved
anywhere.** `S-01`'s bullet went from 480 characters to `"deploy the changes"`.

### Disposition of GH-337 Phase 4

GH-337's open item was *"confirm the 4-sentence split from real data."* It is now **restated, not
merely closed**: the sentence threshold is no longer the only router, so its exact value matters far
less — a message that the threshold misses can still be caught by ratio, and vice versa. What
replaced the open question is the ratio ceiling, which is genuinely under-determined by the battery
and is tracked as an open item below. The `reminder display source:` log line now also emits
`ratio_usable=` and `routed_by=`, so prod telemetry can answer which rule is actually carrying
traffic.

### QA

- [x] `S-07` (the reported case) synthesizes. Failed on baseline, passes after.
- [x] `S-08` (short clean actionable message) stays verbatim. The force-schedule LLM-call gate is
      unchanged and still consults the routing decision before spending a call.
- [x] `S-09` (long, properly punctuated) still synthesizes — `synthesisOn` unchanged at `true`.
- [x] `S-10` (long note, no task) still recommends `ignore` — the gate did not manufacture work.
- [x] `S-11` quoted-task-name rule still honored verbatim (75 chars → below the length floor).
- [x] Whole-corpus diff vs. baseline: every `CHANGED` row individually justified, above.

<a id="phase-3"></a>
## Phase 3 — Task/context split ✅

Largest blast radius — touches the display contract and the persisted reminder shape. Sequenced last
deliberately.

- [x] Model the task and `context` (one line of why) as distinct fields rather than one bullet string.
- [x] Render `context` subordinately, never inline in the bullet. The verbatim original stays in the
      blockquote, unchanged.
- [x] Narrow the verbatim guarantee under a **grounding constraint**, enforced in code.
- [x] `AssigneeIDs` vs `NotifyIDs` — **decided: split them, and persist `NotifyIDs`.** Pulled forward
      from "open question" at the user's direction.
- [x] Event-schema impact assessed before writing code — see below.

### What "task" and "context" became

`reminder_message` was already the task title, so the field added is **`context`** — one line of *why*,
with an explicit prompt rule that it must not restate the task. Renaming `reminder_message` → `task`
was considered and rejected: it is a large mechanical rename across prompts, schema, captures, and
many tests, for no user-visible benefit, and it would have made every recorded response in the battery
un-replayable.

Rendering is an indented italic line beneath the bullet, not a Slack context *block* — reminders are
posted as mrkdwn text, not Block Kit, so a block was never available on this path. The italic
subordinate line is the mrkdwn equivalent. Three things suppress it, each for its own reason:
synthesis being off (the bullet is already the whole message), the context failing the grounding
check, and the context merely restating the task.

### The grounding constraint

[task-grounding.js](../../src/task-grounding.js). `actionable_language` stays byte-exact as the audit
span. The **display title and context may be rewritten**, but only within the vocabulary of the
source: quoted strings, standalone numbers, identifier-shaped tokens (`billing-sync`, `deploy.sh`,
`PayloadV2`), and proper nouns other than the leading imperative verb must all appear in the message.
Comparison is on bare lowercase alphanumerics, so `billing-sync` matches `billing sync` — re-hyphenating
a name the author wrote with a space is a formatting choice, not an invention.

Validated against **every one of the 20 battery scenarios' recorded titles: zero false positives**,
while still extracting the real entities (`billing-sync`, `connection-pool`, `Development`,
`Production`, and the quoted project name). A title that fails falls back to the quoted span — a
clumsier reminder beats a confidently wrong one.

### `AssigneeIDs` vs `NotifyIDs` — the decision

**Split them.** `NotifyIDs` is now persisted on `ReminderInfo` and carried on `ReminderCreated`.

| Concern | Resolution |
|---|---|
| Semantics | Addressees who did **not** take the work. Disjoint from `AssigneeIDs` by construction. |
| Authority | **Non-authoritative.** Nothing keys off it — not assignment, not completion, not any lifecycle decision. |
| Rendering | Named in the confirmation as recipients: *"@a, @b were also mentioned and will be kept in the loop."* |
| "as shared work" | Already fixed as a side effect — that phrasing only fires at 2+ assignees, and a self-commitment now has one. |

**Event-schema impact.** `REQUIRED_PAYLOAD_KEYS` is a *required*, not exhaustive, list, so an added
`notifyIds` key needs no schema version bump. Two parity hazards were found and handled before they
could bite:

1. The projection rehydrates via `WhenRecorded`, so **absent stays absent** — emitting `NotifyIDs: []`
   for every pre-Phase-3 stream would add a key the authoritative JSON lacks and fail parity on
   historical reminders.
2. The emit side is conditional for the same reason. The list-row creation path
   (`#CreateReminderFromListRow`) never sets `NotifyIDs`, so its JSON record has no such key;
   unconditionally emitting `notifyIds: []` would make the fold produce a reminder carrying a key the
   store does not have.

No coordination with `P3-EVENT-SCHEMA-EXPANSION` was needed: the change is additive, non-authoritative,
and read by no projection consumer.

**Rollback story.** Reverting this phase leaves `NotifyIDs` as an ignored key on already-persisted
records and in already-appended events. Nothing reads it, so no code path changes behavior; the
reminders themselves are unaffected because assignment never depended on it. The field is inert data,
not state — which is exactly why it was made non-authoritative rather than wired into rendering
decisions. Already-scheduled reminders keep their `AssigneeIDs`, which are unchanged by a revert of
this phase (they are Phase 1A/1B's output, not Phase 3's).

### QA

- [x] `S-12` renders a short task, context on its own subordinate line, and the full original in the
      blockquote — asserted end to end in
      [reminders-task-context-split.test.js](../../tests/reminders-task-context-split.test.js).
- [x] **Grounding check rejects a title containing an entity absent from the source.** `S-20` is
      adversarial: the title names `Snowflake` and `4x`, neither in the message. Both rejected; the
      bullet falls back to `"i will push that fix"`. Falsified by perturbation — making the check
      pass everything turns `S-20` red with `UNGROUNDED TERM "Snowflake"`.
- [x] `S-13` (multi-step commitment) is not over-compressed — still `PASS`, and its
      `taskTextContains: ["review","push"]` expectation holds.
- [x] Existing reminder rendering stays green: `validate:reminder-render` clean,
      `tests/reminders-display-utils.test.js` unmodified and passing, full suite 1750 pass / 0 fail.
- [x] Rollback story stated explicitly, above.

### Whole-corpus diff vs. the pre-Phase-3 baseline

The only change to any existing row is the **new `displayedContext` field appearing**, populated only
where a context was recorded (`S-01`, `S-12`) and empty everywhere else. **No `displayedTasks`, no
`ownership`, and no `routing` value moved on any scenario.** `S-20` is new.

## Open items

Every row carries a recommendation, a next step, and an owner.

| Item | Recommendation | Next step | Owner |
|---|---|---|---|
| **`BURIED_TASK_MAX_SPAN_RATIO` (0.35) is under-determined.** The battery constrains it only from below — it contains no long message that must stay verbatim, so nothing pins the ceiling from above. | **Leave at 0.35 and confirm from prod, do not re-guess.** The value is conservative; the risk it carries is synthesizing a long message that should have stayed verbatim, which is visible and recoverable, not silent. | Sample `reminder display source:` for two weeks post-deploy and look for `routed_by=buried_task_ratio` on messages users then edited or trashed. Add any such message to the battery as the missing counter-example, then tighten. | noel |
| **Phases 1B and 3 changed prompts and the schema; the battery replays *recorded* responses and cannot evaluate a prompt change.** Deterministic mode proves the code honors `owner` / `owner_mentions` / `context`; it cannot prove the model *produces* good ones. | **Run one live-mode pass before enabling in a busy workspace.** This is the known limit of deterministic replay (Phase 0 Q2), not a gap introduced here. | Run the battery against the live model with `S-01`, `S-04`, `S-12`, `S-19` and hand-check `owner` and `context`. Keep live mode opt-in and out of CI. | noel |
| **`validate:commands` fails on `ask-self` missing from `command-catalog.json`.** Pre-existing — reproduced on unmodified `development`, unrelated to GH-43. | **Fix separately; do not fold into this PR.** Bundling an unrelated catalog fix here would obscure this branch's blast radius. | File its own issue and add the `ask-self` route to `data/static/ai/command-catalog.json`. | noel |
| **`NotifyIDs` is persisted but drives no behavior** — it is named in the confirmation and nothing else. Nobody is actually notified when the reminder fires. | **Correct as shipped; decide separately whether firing should CC them.** Persisting the fact first is what makes that decision possible later without another migration. | If wanted, a follow-up issue on the reminder posting path. The field is non-authoritative, so this is additive. | noel |
| Triage ratings are provisional (`ratings_provisional: true`) | `effort 4 / complexity 4 / risk 3` held up — four phases, two prompt/schema changes, one persisted-shape change. **Clear the provisional flag.** | Done in this close-out. | noel |

### Closed during execution

| Item | Resolution |
|---|---|
| Ratio + length thresholds for Phase 2 | Derived from the committed baseline, with the derivation inlined at the constants. See Phase 2. |
| `AssigneeIDs` vs `NotifyIDs` split | **Decided: split, and persist.** Pulled forward from Phase 3's open question at the user's direction. See Phase 3. |
| Live-mode corpus runs cost real tokens | Settled: deterministic mode gates, live mode stays opt-in and out of CI. Carried forward above as the one live check worth doing before rollout. |
