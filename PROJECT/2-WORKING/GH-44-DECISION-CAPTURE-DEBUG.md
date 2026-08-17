---
title: "Unified AI decision capture, replay + debugging subsystem"
status: IN PROGRESS
created: 2026-08-10
updated: 2026-08-10
owner: noel
gh_issue: 44
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/44
branch: gh-44-decision-capture-debug
doc_type: feature
effort: 4
complexity: 3
risk: 2
phases: 6
related: "GH-397 (router shadow corpus — this generalizes it, does not replace it). GH-43 (reminder extraction fidelity — first consumer; its Phase 0 is re-scoped onto this). GH-392 (Needle spike — replays the same corpus offline)."
goal: >
  Turn the three partial implementations of AI-decision capture and debugging into one first-class
  subsystem: every registered decision spec gets corpus capture, offline replay, before/after
  diffing, and an in-Slack "explain this decision" surface, with zero behavior change to any
  decision's prompt, schema, or model.
---

# GH-44 — Unified AI decision capture, replay + debugging

## Status

| What was just completed | What's next |
| --- | --- |
| **All 6 phases shipped in 1.4.272.** agy relay closed `Approved` at r3/3 after 4 valid blockers. 1678 jest + 114 node tests green, tsc clean, 4 validators pass. | _None for GH-44._ GH-43 now consumes this: `npm run decision:replay` reports its 4 known defects RED against the committed baseline. |

## Table of contents
- [Problem](#problem)
- [Design](#design)
- [Phase 1 — Generalize the corpus store](#phase-1)
- [Phase 2 — Capture inside DecideAsync](#phase-2)
- [Phase 3 — Migrate reminder analysis onto AiDecisionSpec](#phase-3)
- [Phase 4 — Migrate the thread multi-task extractor](#phase-4)
- [Phase 5 — Generic explain-this-decision surface](#phase-5)
- [Phase 6 — Replay + before/after diff harness (thread-aware)](#phase-6)
- [Privacy boundary](#privacy)
- [Open items](#open-items)

## Problem

Sleuth makes AI decisions in ~8 places. Roughly 70% of a shared system for capturing and debugging
them has been built **three separate times**, for three different pipelines, and never connected:

| Capability | Where | State |
|---|---|---|
| Decision abstraction (`AiDecisionSpec`) | [ai-decision.js](../../src/ai-decision.js) | Real, **2 consumers** |
| Corpus capture + shadow compare | [router-shadow-module.js](../../src/router-shadow-module.js), [router-shadow-store.js](../../src/router-shadow-store.js) | **Shipped, active in prod** (GH-397) |
| Trigger debugging (`:wrench:`) | [reminders-module.js:1904](../../src/reminders-module.js#L1904) | Shipped, reminders-only |
| Scenario batteries | `scripts/reminder-thread-battery.js`, `scripts/first-time-user-battery.js` | Two harnesses, no shared format |
| Before/after diff | [projection-parity-harness.js](../../scripts/projection-parity-harness.js) | Projections only |

`DecideAsync` has exactly two consumers — [github-comment-relay.js:284](../../src/github-comment-relay.js#L284)
and [reminders-ai-pipeline.js:704](../../src/reminders-ai-pipeline.js#L704) (dedup only). Reminder
analysis, manual-task extraction, date extraction, code-task synthesis, command-intent resolution,
and both show-me commands call `ProcessMessageWithJsonResponseAsync` raw, so **there is no chokepoint
to instrument.** Meanwhile the shadow corpus is generic in spirit but hard-coded to routing.

GH-397 already locked the governing principle — *"The corpus is the asset, the model is the
variable… Build ONE capture harness"* — and named *"building a second, parallel shadow path"* as an
explicit non-goal. This plan honors that by generalizing what exists.

## Design

The whole subsystem is four small pieces plus a harness:

```
AiDecisionSpec (extended)  ──▶  DecideAsync  ──▶  decision-corpus-store
   name, assets,                  (chokepoint)         <ws>_<stream>.jsonl
   required fields,                    │
   prompt/schema version,              ├──▶  decision-explain  ──▶  :wrench: in Slack
   debug-fact extractor                │
                                       └──▶  scripts/decision-replay.js  ──▶  PASS/FAIL/CHANGED
```

Two invariants hold throughout: **capture is off unless explicitly configured**, and **nothing in
this subsystem may throw into a hot path** — it inherits the never-rejects contract the shadow store
already carries.

**Every phase's QA list must contain at least one gate that is RED on today's code.** A list made
entirely of "the existing tests still pass" proves the code was not broken, never that the work was
done — agy caught exactly that in Phases 3 and 4 (relay r2). Where a phase has such a gate, it is
called out inline so a later reader can tell the proof-of-work check from the regression guards.

<a id="phase-1"></a>
## Phase 1 — Generalize the corpus store ✅ (1.4.272)

- [x] New `src/decision-corpus-store.js`: `createDecisionCorpusStore({ rootDir, stream })` writing
      `<workspace>_<stream>.jsonl`. Carries over every property of the shadow store verbatim —
      per-workspace write chains, memoized `mkdir -p`, synchronous serialization before the chain,
      system-stamped `ts`/`workspace` winning key collisions, best-effort append that never rejects,
      deliberately not fsync'd.
- [x] `src/router-shadow-store.js` becomes a thin back-compat wrapper delegating to it with
      `stream: 'router-shadow'`.

**Back-compat is the whole point of this phase:** the prod corpus filename
`<workspace>_router-shadow.jsonl` is unchanged, `ShadowFilePath` is still exported, and
`tests/router-shadow.test.js` passes untouched. If that suite needs edits, the generalization is
wrong.

**QA**
- [x] `tests/router-shadow.test.js` passes with **zero modifications**.
- [x] Round-trip: a record written through `createRouterShadowStore` lands at the byte-identical
      path it landed at before.
- [x] Path traversal still blocked — a workspace of `../../etc` cannot escape `rootDir`.
- [x] An unserializable (circular) record resolves `{ ok: false }` rather than throwing.
- [x] Two streams in the same `rootDir` do not interleave or share a write chain.

<a id="phase-2"></a>
## Phase 2 — Capture inside DecideAsync ✅ (1.4.272)

- [x] Extend `AiDecisionSpec` with four optional fields: `PromptVersion`, `SchemaVersion`,
      `DebugFacts` (a pure `(input, output) => object` extractor), and `Validate` (a caller-supplied
      validator run inside `DecideAsync`, after `HasRequiredFields`, whose throw propagates
      unchanged). All optional — existing specs keep working unchanged.
- [x] `Validate` exists because `HasRequiredFields` checks presence, not type, and its failure throws
      one generic message. A caller with its own specific errors (Phase 3) can move them inside the
      chokepoint instead of losing them — the throw stays byte-identical **and** the corpus gets to
      classify the record `invalid` rather than recording a false `ok`. (agy relay r1 `[Blocker]`.)
- [x] Add optional `ModelName` so a spec can pin a non-default model (needed before any future
      migration of `ExtractMultiTaskCandidatesAsync`, which uses `ComplexModelName`).
- [x] Add `AiDecisionOptions.Capture = { Store, Workspace, Mode }`. **Absent ⇒ no capture.**
- [x] Emit one record per decision: `{ decision, promptVersion, schemaVersion, input, output,
      debugFacts, outcome, durationMs }` where `outcome ∈ ok | invalid | error`.
- [x] Capture the `invalid` and `error` outcomes too — a decision that failed validation is the most
      interesting record in the corpus, and the one a replay most needs.

**QA**
- [x] No `Capture` option ⇒ zero store calls. Assert on the store mock, do not assume.
- [x] A store that throws does not change `DecideAsync`'s return value or its throw behavior.
- [x] A `DebugFacts` extractor that throws is swallowed; the record still lands without the facts.
- [x] Both existing consumers (relay relevance, reminder dedup) behave identically with capture off
      and with capture on.
- [x] `outcome: 'error'` records the error message, never the stack.

<a id="phase-3"></a>
## Phase 3 — Migrate reminder analysis onto AiDecisionSpec ✅ (1.4.272)

The third consumer, and the one GH-43 needs. Sequenced after Phases 1–2 so the record shape is
validated against a genuinely different pipeline before any broad migration.

- [x] Define `ReminderAnalysisDecisionSpec` (`reminders-instructions.md` + `reminders-schema.json`)
      with **`RequiredFields: []`** and the three existing sanity checks moved into `Validate`.
- [x] **`RequiredFields` must stay empty here — this is a correctness constraint, not a style choice.**
      Populating it with `recommendation` / `rationale` / `reminders` makes `HasRequiredFields` fail
      first and throw `DecideAsync`'s generic *"Invalid reminder-analysis response from the AI model."*
      before the specific checks ever run. Three tests assert the exact legacy strings —
      [reminders-ai-pipeline.test.js:48](../../tests/reminders-ai-pipeline.test.js#L48),
      [:59](../../tests/reminders-ai-pipeline.test.js#L59),
      [:71](../../tests/reminders-ai-pipeline.test.js#L71) — and all three would go red.
      (Found by agy relay r1 `[Blocker]`; fix improved to use `Validate` so the corpus still sees
      `outcome: 'invalid'`, which agy's `RequiredFields: []`-only option would have silently lost.)
- [x] `Validate` throws the three original messages verbatim, including the type checks
      `HasRequiredFields` cannot express (it would accept `recommendation: 123`).
- [x] `AnalyzeMessageForRemindersAsync` calls `DecideAsync`. It passes no model name today, so it maps
      cleanly onto the default.
- [x] `DebugFacts` for this spec returns the synthesis routing facts already computed by
      `DescribeSynthesisRouting` (`segment`, `synthesisOn`, `actionableSpanRatio`, `sentenceCount`)
      plus candidate count.
- [x] No prompt, schema, or model change. Behavior must be byte-identical.

**QA**
- [x] `tests/reminders-ai-pipeline.test.js` and `tests/reminders-integration.test.js` pass unmodified.
- [x] The three legacy error strings are thrown byte-identically — assert on the messages, not merely
      that something threw.
- [x] A wrong-typed field (`recommendation: 123`) still throws, proving `Validate` covers what
      `HasRequiredFields` cannot.
- [x] **Proof the migration actually happened** (agy relay r2 `[Blocker]`): with capture enabled, one
      analysis emits exactly one record whose `decision === 'reminder-analysis'` and whose
      `debugFacts` carries `segment` / `synthesisOn` / `actionableSpanRatio`. This is the only Phase 3
      gate that is red on today's code — every other gate here passes before the migration, which is
      what made this list unfalsifiable as first written.
- [x] The deterministic direct-ask fallback still fires when the model recommends `ignore`.
- [x] Empty `reminders: []` is accepted (it is a value, not an absence) and still yields `ignore`
      downstream — the one place `HasRequiredFields` semantics could have silently changed behavior.

<a id="phase-4"></a>
## Phase 4 — Migrate the thread multi-task extractor ✅ (1.4.272)

The single-message path (Phase 3) answers *"is this one message a task?"*. The **thread** path answers
*"given a whole conversation, which of it is actually actionable, and whose?"* — which is the harder
and more valuable question, and the one a multi-faceted message like GH-43's opening case really needs.

[`ExtractMultiTaskCandidatesAsync`](../../src/reminders-ai-pipeline.js#L722) already does this in
production — numbered transcript, per-candidate `sourceMessageNumbers` / `sourceTs`, confidence,
low-confidence flagging, and dedup against live open reminders. It is called from
[reminders-app-mention-handler.js:880](../../src/reminders-app-mention-handler.js#L880).

- [x] **Extract its inline prompt + schema into asset files.** Today the system prompt is a template
      literal at [reminders-ai-pipeline.js:745](../../src/reminders-ai-pipeline.js#L745) and
      `MULTI_TASK_SCHEMA` is an inline object at [:775](../../src/reminders-ai-pipeline.js#L775).
      `AiDecisionSpec` requires `InstructionsFile` + `SchemaFile`, so this migration is **blocked on
      promoting them to `data/static/ai/multi-task-extraction-{instructions.md,schema.json}`**. This
      is a real prerequisite, not a formality — but it is also a win on its own: an inline prompt is
      invisible to `scripts/validate-ai-prompts.js`, so this prompt has never been validated.
- [x] Register the new pair in `validate-ai-prompts.js`'s `EXPECTED_PAIRS`. Note this interacts with
      open issue [#41](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/41)
      (`validate:ai` silently skips assets missing from that map) — adding an entry is exactly the
      case #41 is about.
- [x] Use the `ModelName` spec field from Phase 2 — this path pins `ComplexModelName`, which is the
      reason that field exists.
- [x] Keep the transcript-building and post-processing (default-assignee fill) at the call site; only
      the model call moves into `DecideAsync`.
- [x] `DebugFacts`: candidate count, confidence distribution, how many carried a `flag`, and how many
      matched an open reminder.

**QA**
- [x] The extracted prompt asset is **byte-identical** to the inline literal it replaces — diff it,
      do not eyeball it. A reworded prompt makes every later before/after comparison meaningless.
- [x] `tests/reminders-app-mention-handler.test.js` passes unmodified (it asserts call counts and
      argument shape at [:1426](../../tests/reminders-app-mention-handler.test.js#L1426) and
      [:1501](../../tests/reminders-app-mention-handler.test.js#L1501)).
- [x] **`validate:ai` coverage must be asserted, not inferred** (agy relay r2 `[Blocker]`). "The script
      exits 0" proves nothing: [validate-ai-prompts.js:45](../../scripts/validate-ai-prompts.js#L45)
      iterates `Object.entries(EXPECTED_PAIRS)` only, so an asset on disk but missing from that map is
      never checked and the run still passes — open issue
      [#41](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/41) exactly. The gate is
      therefore: stdout contains `OK:   multi-task-extraction-instructions.md` **and**
      `OK:   multi-task-extraction-schema.json` (the `Pass()` format at
      [:40](../../scripts/validate-ai-prompts.js#L40)).
- [x] `ComplexModelName` is still the model actually used — assert the argument, do not assume.
- [x] A thread whose candidates are all low-confidence still returns them flagged, never dropped.
- [x] **Proof the migration actually happened** (agy relay r2 `[Blocker]`): with capture enabled, one
      thread extraction emits exactly one record whose `decision === 'multi-task-extraction'`, whose
      `debugFacts` carries the candidate count and confidence distribution, and whose
      `promptVersion` / `schemaVersion` are stamped. Red on today's code; the rest of this list is not.

<a id="phase-5"></a>
## Phase 5 — Generic explain-this-decision surface ✅ (1.4.272)

- [x] New `src/decision-explain.js`: renders a decision's spec-declared debug facts into Slack lines,
      independent of which decision it is.
- [x] `:wrench:` reminder triage renders through it, and gains the routing facts + a candidate-level
      ownership trace that previously existed only in server logs.
- [x] Truncation and sanitization go through the existing `SlackFormatUtils` primitives — no new
      rendering path (GH-391 keeps one render primitive).

**QA**
- [x] Existing `:wrench:` output keeps its current lines; new facts are additive.
- [x] A decision with no `DebugFacts` renders without an empty section.
- [x] Long values truncate rather than blowing the Slack message limit.
- [x] No raw corpus record is ever posted to Slack — only the declared facts.

<a id="phase-6"></a>
## Phase 6 — Replay + before/after diff harness (thread-aware) ✅ (1.4.272)

- [x] `scripts/decision-replay.js` + `npm run decision:replay`. Reads a scenario file, runs each
      scenario through the deterministic layers with recorded model responses, and diffs against a
      committed baseline.
- [x] **Scenarios are threads, not single strings.** Reuse the shape
      `scripts/reminder-thread-battery.js` already validates —
      `{ channel, channelType, turns: [{ user, text }] }` — so the repo has **one** scenario format,
      not two. A single-message scenario is just a one-turn thread; nothing special-cases it.
- [x] Support loading **several scenarios from one file** (a `scenarios: []` array of thread objects)
      so a whole battery runs in one invocation and reports a table, rather than one run per case.
- [x] Each scenario declares which decision it exercises (`reminder-analysis` for single-message,
      `multi-task-extraction` for thread-level), so both Phase 3's and Phase 4's specs are replayable
      through the same harness.
- [x] Reuses the canonicalize/serialize/compare shape from `projection-parity-harness.js` rather than
      inventing a third comparison.
- [x] Reports one row per scenario: `PASS` / `FAIL` / `CHANGED-vs-baseline`, exit non-zero on
      unexplained change.
- [x] `--update-baseline` writes the baseline; it is never written implicitly by a normal run.
- [x] `--from-corpus <ws>` replays real captured records instead of authored scenarios — the payoff
      of Phase 2's capture, and what makes production traffic a regression suite.
- [x] GH-43's 15-scenario battery is the first authored input; its thread cases (S-02, S-04) exercise
      the multi-turn path.

**QA**
- [x] **The harness must be able to fail.** Running the GH-43 battery against current `development`
      reports RED on the three known defects. A green run means the instrument is broken.
- [x] Two runs on the same commit produce byte-identical output — no clock, no `Math.random`, no
      live model in the default mode.
- [x] Deterministic mode makes zero network calls. Assert on the mock.
- [x] A scenario with no recorded response is reported as skipped, not silently passed.
- [x] A multi-turn scenario reaches the thread extractor with **all** its turns in order — assert the
      transcript the model receives, since a harness that silently truncates to the last message would
      still look green while testing nothing about threads.
- [x] Loading a file of N scenarios produces N rows; a malformed scenario fails that row only, and
      does not abort the batch.

<a id="privacy"></a>
## Privacy boundary

The corpus records **raw message text**, matching the existing router-shadow precedent (`rawText`) —
replay is impossible without the input. This is deliberately different from the GH-337 Phase 4
telemetry line, which logs only a length and a ratio and no message text at all. Those two surfaces
keep their separate stances:

- **Logs** — no raw text. Unchanged by this work.
- **Corpus** — raw text, off by default, written outside `data/runtime/events/`, never folded into a
  projection, never reaching the `?format=rebalance` export. Same boundary GH-397 set.

<a id="open-items"></a>
## Open items

| Item | Recommendation | Next step | Owner |
|---|---|---|---|
| Remaining ~3 raw `ProcessMessageWithJsonResponseAsync` call sites (manual-task, date-extraction, code-task-synthesis, show-me) | Leave them. The shape is proven on four consumers after Phase 4; migrating the rest is a separate, evidence-driven call, not a completeness exercise | Revisit only when one of them needs capture | noel |
| Thread-level extraction was originally out of scope | **Corrected 2026-08-10 (operator).** Phase 4 was added because the thread path — "given a whole conversation, which of it is actually actionable" — is the more valuable question, and it was sitting in the deferred bucket | Done: Phase 4 + thread-aware Phase 6 scenarios | — |
| Corpus retention / rotation | Not addressed here; the shadow corpus has the same gap today | File separately if disk becomes a concern | noel |
| Ratings confirmed (not provisional) | `effort 3 / complexity 3 / risk 2` — additive work behind an off-by-default switch | — | noel |
