---
title: "Phase brief p2 — GH-76/GH-88 merge seam coverage"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "none (test-only); parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Add tests/ocr-failure-diagnostics.test.js so an OCR failure post is pinned to carry the diagnostics baseline.
---

# p2 — cover the GH-76 / GH-88 merge seam

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

No GitHub issue: this is test-only work on already-shipped code, added at the operator's direction
after the 2026-08-18 QA review.

## Why this exists

GH-76 (deduplicate the OCR failure posts) and GH-88 (unified diagnostics baseline) were authored in
parallel by different people and reconciled by hand at merge. The reconciliation is **correct** —
all nine `#FailOcrAsync` call sites route through one `BuildErrorReportAsync` at
`src/chat-module.js:3133` — but nothing tests it.

`*Diagnostics:*` is asserted in `tests/chat-module-bug-reaction.test.js`,
`tests/diagnostics-report.test.js`, and `tests/send-to-github-command.test.js`. It is **never**
asserted on an OCR failure post. Revert `#FailOcrAsync` to a bare `PostMessageTextAsync` today and
the entire suite stays green.

That is the one combination the review called highest-risk, with zero coverage.

## What to build

A **new** file `tests/ocr-failure-diagnostics.test.js`. Do not extend
`tests/attachment-pipeline-entry-point.test.js` — phase p3 edits that file and a shared write-set
would collide.

Cover:

1. An OCR failure post contains `*Diagnostics:*`.
2. It goes to the **thread** (`ReplyTS`, computed once at `src/chat-module.js:2998`), not the channel.
3. The permanent-vs-transient split at `src/chat-module.js:3082-3093` survives: a
   `vision_provider_not_configured` failure and a transient failure produce **different** user
   sentences, and both carry the baseline.
4. At least two more of the nine call sites (`:3002`, `:3010`, `:3018`, `:3023`, `:3054`, `:3061`,
   `:3082`, `:3099`, `:3109`) — pick the download-failure and empty-file cases.

## The bar

Each test must be **mutation-verified**: before committing, break the production line it claims to
cover and confirm the test fails. A test that passes against a broken `#FailOcrAsync` is decoration.
State in your handoff which line you broke for each test and what the failure looked like.

## Do NOT

- Do not modify any file under `src/`. This phase is tests only.
- Do not stub `BuildErrorReportAsync` itself — that is the thing under test. Stub the Slack client
  and the vision provider.

## Gate

`npm test` must pass. Phase-scoped check while iterating:
`npx jest ocr-failure-diagnostics --forceExit`
