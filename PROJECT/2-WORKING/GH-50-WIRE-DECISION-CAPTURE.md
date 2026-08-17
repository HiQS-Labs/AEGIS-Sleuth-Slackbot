---
title: "Decision corpus is never recorded in production: SetDecisionCapture has no caller outside tests"
status: Active (2-WORKING) — wired and verified on gh-50-wire-decision-capture; PR open
created: 2026-08-11
updated: 2026-08-11
owner: noel
goal: "Make the GH-44 decision corpus reachable in a deployed environment, off by default, so extraction and synthesis work can be measured against real traffic instead of hand-written fixtures."
branch: gh-50-wire-decision-capture
doc_type: bugfix
gh_issue: 50
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/50
related: "Consumes the store built in GH-44; mirrors the GH-397 router-shadow wiring. Blocks GH-51, which needs input→output pairs to diagnose the zero-actionable-span population."
context_tags: [ai-decision, corpus, observability, privacy, multi-tenant]
---

# GH-50 — arm the decision corpus in production

## Status

| What was just completed | What's next |
|---|---|
| Capture wired at pipeline construction behind `DECISION_CAPTURE_ENABLED`, with an optional `DECISION_CAPTURE_WORKSPACES` allowlist. 9 new arming tests, all three mutations caught. Full gate green: 1858 jest / 116 node / build 0. | PR into `development`. Arming on production is a **separate operator decision** — it is deliberately not part of this change, and depends on the retention policy below. |

## Why this exists

GH-44 built the capture path end to end — `DecideAsync` → `EmitCaptureAsync` → `decision-corpus-store`
— and then never connected it to anything. `SetDecisionCapture` had **zero callers outside tests**:

```
src/reminders-ai-pipeline.js:306   SetDecisionCapture(ArgCapture) {   <- the setter
tests/reminders-decision-capture.test.js:61,104,118,159            <- the only callers
```

`Capture` defaults to absent and `EmitCaptureAsync` returns immediately when it is, so the corpus
wrote nothing in any deployed environment. It was dead code that looked like a feature.

This surfaced while diagnosing a real production mis-render. The only post-hoc evidence available
was a single journald line:

```
reminder display source: msg_len=487 sentences=3 segment=normal synthesis=off actionable_span_ratio=0.07
```

Enough to identify *which rule* misfired, but deliberately lossy — no raw text, no candidate list,
no model output, no prompt/schema version. It cannot answer "what did the model actually return,
and was the prompt at fault?"

## Quad Concepts

- **A capture path with no caller is not observability.** It passes its own tests and records
  nothing. The tests proved the mechanism, never that anything used it.
- **Default off is a privacy property, not a preference.** A record carries the raw message text and
  the full model response. That is tenant data, so arming it is an operator decision with a
  retention obligation — never a default that ships quietly.
- **Two gates, not one.** The master flag and the workspace allowlist stay separate so an operator
  can arm the fleet and still scope collection to a single tenant.
- **Reuse the existing capture convention.** GH-397 already settled this shape for router-shadow.
  A second parallel convention would be the thing GH-397 explicitly named as a non-goal.

## What shipped

- `RemindersAIPipeline.IsDecisionCaptureEnabled()` — reads `DECISION_CAPTURE_ENABLED`, **default off**.
- `RemindersAIPipeline.IsDecisionCaptureWorkspaceAllowed()` — optional `DECISION_CAPTURE_WORKSPACES`
  comma-separated allowlist; unset means all. Exact match, mirroring `ROUTER_SHADOW_WORKSPACES`.
- `RemindersAIPipeline.IsDecisionCaptureArmedFor()` — both gates, deliberately separate.
- `reminders-module.js` arms the pipeline at construction when armed, writing to
  `data/runtime/decisions/<workspace>_decisions.jsonl`.
- `.env.example` documents both flags and the tenant-data warning.

`Workspace` is passed explicitly rather than resolved from module state: every workspace shares this
process, so a global would cross-file one tenant's decisions into another's corpus
(AGENTS.md section 0.1).

The corpus root sits **outside** `data/runtime/events/` on purpose — that directory is the P3
authoritative ledger, and this corpus is disposable, non-authoritative, and replayed offline. It
must never be folded into a projection.

## Verification

- **9 new arming tests** in `tests/decision-capture-arming.test.js`, covering default-off, blank and
  whitespace values, unrecognized tokens failing closed, every documented truthy token, allowlist
  inclusion/exclusion, whitespace tolerance, exact-match (so `acme` does not admit `acme-staging`),
  and that the allowlist **alone** cannot arm capture.
- **Mutation-tested — all three caught:** default off→on (3 failures), exact match→substring
  (1 failure), dropping the master-flag gate from `IsDecisionCaptureArmedFor` (2 failures).
- **Wiring smoke-tested** against the real store: armed → corpus dir created → per-workspace file
  written → a second workspace lands in its **own** file (tenant isolation).
- **`data/runtime/` is git-ignored** (`.gitignore:10`), verified with `git check-ignore`, so corpus
  records cannot be committed.
- **Full gate:** 1858 jest tests (1849 + 9), 116 node tests, 0 failures, `npm run build` exit 0.
  `validate:ai`, `:fsm`, `:workspace-isolation`, `:reminder-render` PASS. `validate:commands` fails
  **identically on `development`** — pre-existing, confirmed by checkout comparison, not this change.

## Out of scope — and what must happen before arming

**Retention is not solved here and this must not be armed on production until it is.** Records carry
raw tenant message text with no rotation, no size cap, and no expiry; the store appends forever. The
flag exists so collection can be turned on deliberately for a bounded window, but the durable policy
(retention period, rotation, deletion path, tenant disclosure) is a separate decision and a
prerequisite. Recommend a follow-up issue owned by whoever owns the privacy posture, before the flag
is set anywhere real.

Also out of scope: a replay/analysis tool over the corpus, and any change to what the specs capture
(`DebugFacts` is unchanged).
