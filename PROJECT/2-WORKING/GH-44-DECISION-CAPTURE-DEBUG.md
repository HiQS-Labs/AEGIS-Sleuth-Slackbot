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
effort: 3
complexity: 3
risk: 2
phases: 5
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
| Plan authored; branch `gh-44-decision-capture-debug` cut. No code written yet. | Phase 1 — generalize the corpus store, after the agy relay QA pass on this plan |

## Table of contents
- [Problem](#problem)
- [Design](#design)
- [Phase 1 — Generalize the corpus store](#phase-1)
- [Phase 2 — Capture inside DecideAsync](#phase-2)
- [Phase 3 — Migrate reminder analysis onto AiDecisionSpec](#phase-3)
- [Phase 4 — Generic explain-this-decision surface](#phase-4)
- [Phase 5 — Replay + before/after diff harness](#phase-5)
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

<a id="phase-1"></a>
## Phase 1 — Generalize the corpus store

- [ ] New `src/decision-corpus-store.js`: `createDecisionCorpusStore({ rootDir, stream })` writing
      `<workspace>_<stream>.jsonl`. Carries over every property of the shadow store verbatim —
      per-workspace write chains, memoized `mkdir -p`, synchronous serialization before the chain,
      system-stamped `ts`/`workspace` winning key collisions, best-effort append that never rejects,
      deliberately not fsync'd.
- [ ] `src/router-shadow-store.js` becomes a thin back-compat wrapper delegating to it with
      `stream: 'router-shadow'`.

**Back-compat is the whole point of this phase:** the prod corpus filename
`<workspace>_router-shadow.jsonl` is unchanged, `ShadowFilePath` is still exported, and
`tests/router-shadow.test.js` passes untouched. If that suite needs edits, the generalization is
wrong.

**QA**
- [ ] `tests/router-shadow.test.js` passes with **zero modifications**.
- [ ] Round-trip: a record written through `createRouterShadowStore` lands at the byte-identical
      path it landed at before.
- [ ] Path traversal still blocked — a workspace of `../../etc` cannot escape `rootDir`.
- [ ] An unserializable (circular) record resolves `{ ok: false }` rather than throwing.
- [ ] Two streams in the same `rootDir` do not interleave or share a write chain.

<a id="phase-2"></a>
## Phase 2 — Capture inside DecideAsync

- [ ] Extend `AiDecisionSpec` with three optional fields: `PromptVersion`, `SchemaVersion`, and
      `DebugFacts` (a pure `(input, output) => object` extractor). All optional — existing specs keep
      working unchanged.
- [ ] Add optional `ModelName` so a spec can pin a non-default model (needed before any future
      migration of `ExtractMultiTaskCandidatesAsync`, which uses `ComplexModelName`).
- [ ] Add `AiDecisionOptions.Capture = { Store, Workspace, Mode }`. **Absent ⇒ no capture.**
- [ ] Emit one record per decision: `{ decision, promptVersion, schemaVersion, input, output,
      debugFacts, outcome, durationMs }` where `outcome ∈ ok | invalid | error`.
- [ ] Capture the `invalid` and `error` outcomes too — a decision that failed validation is the most
      interesting record in the corpus, and the one a replay most needs.

**QA**
- [ ] No `Capture` option ⇒ zero store calls. Assert on the store mock, do not assume.
- [ ] A store that throws does not change `DecideAsync`'s return value or its throw behavior.
- [ ] A `DebugFacts` extractor that throws is swallowed; the record still lands without the facts.
- [ ] Both existing consumers (relay relevance, reminder dedup) behave identically with capture off
      and with capture on.
- [ ] `outcome: 'error'` records the error message, never the stack.

<a id="phase-3"></a>
## Phase 3 — Migrate reminder analysis onto AiDecisionSpec

The third consumer, and the one GH-43 needs. Sequenced after Phases 1–2 so the record shape is
validated against a genuinely different pipeline before any broad migration.

- [ ] Define `ReminderAnalysisDecisionSpec` (`reminders-instructions.md` +
      `reminders-schema.json`, required `recommendation` / `rationale` / `reminders`).
- [ ] `AnalyzeMessageForRemindersAsync` calls `DecideAsync`. It passes no model name today, so it maps
      cleanly onto the default.
- [ ] **Keep the existing type sanity checks.** `HasRequiredFields` tests presence, not type — it
      would accept `recommendation: 123`. The three `typeof` throws stay, after the call.
- [ ] `DebugFacts` for this spec returns the synthesis routing facts already computed by
      `DescribeSynthesisRouting` (`segment`, `synthesisOn`, `actionableSpanRatio`, `sentenceCount`)
      plus candidate count.
- [ ] No prompt, schema, or model change. Behavior must be byte-identical.

**QA**
- [ ] `tests/reminders-ai-pipeline.test.js` and `tests/reminders-integration.test.js` pass unmodified.
- [ ] A malformed response still throws the same error the manual checks threw before.
- [ ] The deterministic direct-ask fallback still fires when the model recommends `ignore`.
- [ ] Empty `reminders: []` is accepted (it is a value, not an absence) and still yields `ignore`
      downstream — the one place `HasRequiredFields` semantics could have silently changed behavior.

<a id="phase-4"></a>
## Phase 4 — Generic explain-this-decision surface

- [ ] New `src/decision-explain.js`: renders a decision's spec-declared debug facts into Slack lines,
      independent of which decision it is.
- [ ] `:wrench:` reminder triage renders through it, and gains the routing facts + a candidate-level
      ownership trace that previously existed only in server logs.
- [ ] Truncation and sanitization go through the existing `SlackFormatUtils` primitives — no new
      rendering path (GH-391 keeps one render primitive).

**QA**
- [ ] Existing `:wrench:` output keeps its current lines; new facts are additive.
- [ ] A decision with no `DebugFacts` renders without an empty section.
- [ ] Long values truncate rather than blowing the Slack message limit.
- [ ] No raw corpus record is ever posted to Slack — only the declared facts.

<a id="phase-5"></a>
## Phase 5 — Replay + before/after diff harness

- [ ] `scripts/decision-replay.js` + `npm run decision:replay`. Reads a scenario file, runs each
      scenario through the deterministic layers with recorded model responses, and diffs against a
      committed baseline.
- [ ] Reuses the canonicalize/serialize/compare shape from `projection-parity-harness.js` rather than
      inventing a third comparison.
- [ ] Reports one row per scenario: `PASS` / `FAIL` / `CHANGED-vs-baseline`, exit non-zero on
      unexplained change.
- [ ] `--update-baseline` writes the baseline; it is never written implicitly by a normal run.
- [ ] GH-43's 15-scenario battery is the first input.

**QA**
- [ ] **The harness must be able to fail.** Running the GH-43 battery against current `development`
      reports RED on the three known defects. A green run means the instrument is broken.
- [ ] Two runs on the same commit produce byte-identical output — no clock, no `Math.random`, no
      live model in the default mode.
- [ ] Deterministic mode makes zero network calls. Assert on the mock.
- [ ] A scenario with no recorded response is reported as skipped, not silently passed.

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
| Remaining ~5 raw `ProcessMessageWithJsonResponseAsync` call sites | Leave them. The shape is proven on three consumers; migrating the rest is a separate, evidence-driven call, not a completeness exercise | Revisit only when one of them needs capture | noel |
| Corpus retention / rotation | Not addressed here; the shadow corpus has the same gap today | File separately if disk becomes a concern | noel |
| Ratings confirmed (not provisional) | `effort 3 / complexity 3 / risk 2` — additive work behind an off-by-default switch | — | noel |
