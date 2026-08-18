---
title: "Phase brief p4 — GH-96 diagnostics bypasses"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "GH-96; parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Route the three bypassing error posts through BuildErrorReportAsync.
---

# p4 — GH-96: route the three bypassing error posts through BuildErrorReportAsync

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

Issue: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/96
Capture doc: `PROJECT/2-WORKING/GH-96-DIAGNOSTICS-BYPASSES.md`
Runs after p3, which also edits `src/chat-module.js`. Rebase on p3's result before starting.

## The gap

GH-88's baseline is clean — `BuildErrorReportAsync` is the single formatter and no duplicated
baseline strings survive anywhere in `src/`. Three user-facing error posts simply never call it.

| # | Site | What the user sees today |
|---|---|---|
| 1 | `src/chat-commands/convert-to-list-command.js:62` | `I could not read that text into a list — please try again later.` |
| 2 | `src/chat-module.js:2835-2839` | context-memory download failure |
| 3 | `src/chat-module.js:3170-3174` | `Slack Lists is not configured` |

Site 1 is the sharp one: `convert text into slack list` and the image→list route are two arms of one
capability, converging on one schema and one materialization seam — but only the image arm routes
failures through `#FailOcrAsync` → `BuildErrorReportAsync` (`src/chat-module.js:3128-3133`). The
same capability fails with differently-shaped messages depending on which arm broke.

## What to change

Route all three through `BuildErrorReportAsync`.

- Sites 2 and 3 are inside `chat-module.js`, which already imports it at `src/chat-module.js:21`.
- Site 1 is a different module: import from `src/diagnostics-report.js` directly. Do **not** try to
  reach `#FailOcrAsync` — it is private to `ChatModule` and is not the seam for this.

Site 1 has two branches (permanent `vision_provider_not_configured` / `provider_not_configured` vs
transient). Both get the baseline; the branch-specific sentence stays as the user message and the
baseline is appended — mirror how `#FailOcrAsync` composes at `src/chat-module.js:3082-3093`.

## Do NOT

- Do not widen this to every error string in `src/`. These three sites are the OCR/list capability
  surface GH-88 was scoped to. Other error posts are deliberately out of scope.
- Do not hand-roll baseline lines at any site. Every site calls `BuildErrorReportAsync`.
- Do not change the user-facing sentences themselves — only append the baseline.

## Must not regress

The permanent-vs-transient split at site 1 must survive: the two branches still produce **different**
user sentences. Losing that would tell users to retry something that cannot succeed, which is the
regression GH-63 fixed.

## Tests

New file `tests/convert-to-list-command.test.js` for site 1; extend existing coverage for sites 2
and 3.

Each test must be **mutation-verified**: break the production line it covers and confirm the test
fails. State which line you broke and what the failure looked like.

Cover per site: the post contains `*Diagnostics:*`; it goes to the thread, not the channel. For site
1 additionally: the two branches produce different sentences and both carry the baseline.

## Gate

`npm test` must pass. Phase-scoped check while iterating:
`npx jest convert-to-list attachment-pipeline-entry-point diagnostics-report --forceExit`
