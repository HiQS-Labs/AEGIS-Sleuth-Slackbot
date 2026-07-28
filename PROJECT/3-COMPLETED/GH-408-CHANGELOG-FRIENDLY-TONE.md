---
title: "Friendlier CHANGELOG entries: plain-language TL;DR → less mechanical Slack messages"
status: Completed — Phase 1 (authoring note + exemplar, v1.4.232) + Phase 2 (validate-changelog-tone guard, v1.4.233) both shipped to development
created: 2026-07-16
owner: noel
gh_issue: 408
source: https://github.com/NeochromeTeam/sleuth-app/issues/408
doc_type: feature
complexity: 2
risk: 1
effort: 2
phases: 2
ratings_provisional: true
non_goals:
  - Retroactively rewriting historical CHANGELOG entries (convention applies going forward; 1.4.232 is reformatted only as the exemplar)
  - Changing the `changelog` command's summarization prompt or the startup-message plumbing (a friendlier source is sufficient)
  - Reducing technical depth — the engineering detail stays, just below the human summary
related:
  - "src/chat-commands/changelog-command.js (LLM-summarizes the last 10 version blocks for the `changelog` command)"
  - "src/startup-message.js (gates the changelog excerpt appended to the deploy startup notice)"
  - "GH-391 / GH-387 (convention-drift class — an unenforced convention drifts; Phase 2 is the guard)"
  - "scripts/validate-reminder-render.js (the static-guard + jest tree-is-clean pattern Phase 2 mirrors)"
goal: >
  Make Sleuth's Slack surfaces (the `changelog` command and the deploy startup message) read like a
  human wrote them, by making their single source — CHANGELOG.md — lead every entry with a friendly,
  first-person, plain-language TL;DR of the net effect for a user, with the engineering detail demoted
  into a `**Technical:**` block. Phase 1 ships the convention + exemplar; Phase 2 enforces it.
---

# GH-408 — Friendlier CHANGELOG entries (plain-language TL;DR)

> **1-INBOX capture**, not the active-work doc — no `## Status` table yet. On promotion to
> `PROJECT/2-WORKING/`, add the status table + per-phase QA gates and carry `gh_issue` forward.

## Quad Concepts
- Slack deploy/changelog messages read mechanically → make the *source* CHANGELOG lead with a human TL;DR so both surfaces lift friendlier text.
- A non-engineer can't tell what changed for them → write the TL;DR from a user's POV, in Sleuth's first-person voice.
- Conventions drift without a guard (the #391/#387 class) → Phase 2 enforces the shape with a static validator, not tribal habit.

## Key concepts
- **One source, two Slack surfaces.** Both the `changelog` command
  ([src/chat-commands/changelog-command.js](../../src/chat-commands/changelog-command.js), last-10-block
  LLM summary) and the startup message ([src/startup-message.js](../../src/startup-message.js), changelog
  excerpt) read the raw `CHANGELOG.md`. A friendlier *source* makes both less mechanical with zero code.
- **Lead with the net effect, keep the depth.** Each entry: a first-person, plain-language TL;DR
  (1–2 sentences on what changed *for a user*), then a `**Technical:**` block with the current
  engineering detail unchanged.
- **The note lives above the first `## ` heading.** `ExtractRecentVersionBlocks` ignores everything
  before the first version heading, so a top-of-file authoring note never leaks into the Slack summary.
- **Enforcement is the real fix.** An unenforced style note drifts the same way routing/render
  conventions did (#391, #387). Phase 2 makes the shape a checked contract.

## Idea
Add a top-of-`CHANGELOG.md` authoring note requesting a friendly first-person TL;DR + `**Technical:**`
block per entry (Phase 1), then enforce that shape with a PDDA-gated static guard (Phase 2).

## Why
- **Less mechanical Slack.** The deploy startup post and `changelog` command are the most-seen Sleuth
  outputs by non-engineers; today they surface engineer prose. Leading with a human summary fixes both.
- **Cheapest possible lever.** A source-text convention needs no plumbing change — the existing
  summarizer/excerpt just get better material to work with.
- **Consistent with the guard-a-convention pattern.** BaseModule (1.4.222), the #387 isolation guard,
  and the #391 render guard all pair a convention with an enforcer; this follows the same shape.

## Phase 1 — Convention note + exemplar (ship first)
- [x] Add an authoring note at the **top** of `CHANGELOG.md` (above the first `## `) asking each entry
      to lead with a friendly first-person TL;DR + a `**Technical:**` block.
- [x] Reformat the current top entry (1.4.232) as the reference exemplar (friendly lead → `**Technical:**`).
- [ ] `non_goals`: do not rewrite historical entries; do not touch the summarizer prompt.

### QA checklist — Phase 1
- [x] Note sits before the first `## ` heading (verified it can't reach the Slack extractor).
- [x] 1.4.232 keeps its full technical content; only presentation changed.
- [ ] A human checkpoint remains before Phase 2 enforcement is built.

## Phase 2 — Enforce the shape (sketch / decide)
> Discovery + decision phase: pick the enforcement mechanism, then its findings/decision are written
> back into this doc before its gate can pass.

**Decision to make:** how to enforce "newest version block leads with a non-bullet TL;DR line **and**
contains a `**Technical:**` marker."

- **Option A — PDDA/Sentinel + static guard (recommended).** New `scripts/validate-changelog-tone.js`
  mirroring [scripts/validate-reminder-render.js](../../scripts/validate-reminder-render.js): parse the
  newest `## <version>` block; fail if the first non-blank line is a `- ` bullet (no human lead) or if
  no `**Technical:**` marker is present. Wire a `validate:changelog-tone` npm script and a
  `tests/validate-changelog-tone.test.js` "tree is clean" jest assertion (the same mechanism that runs
  `validate:reminder-render` under `npm test`). Honors a `<!-- TONE-OK: reason -->` pragma for
  intentional exceptions. **Universal** — catches any author, agent, or CI run.
- **Option B — Claude Code hook (nudge, not enforcement).** A PostToolUse/Stop hook that, when
  `CHANGELOG.md` was edited this session, checks the newest block and reminds. **Author-side only**
  (Claude sessions) — a good ergonomic nudge layered *under* Option A, not a substitute (it can't gate
  a human editor, another agent, or CI).
- **Recommendation:** ship **A** as the enforcement (universal, matches the repo's `validate:*`
  pattern), optionally add **B** later as a fast in-session nudge. Only-B would re-create the
  convention-drift gap this issue is meant to close.

### QA checklist — Phase 2
- [ ] Guard fails a bullet-first / no-`Technical:` newest block; passes a compliant one; pragma respected.
- [ ] Enforced under `npm test` via a jest tree-is-clean test (not a lone script nobody runs).
- [ ] Does not flag historical entries (scope = newest block, or entries added since a marker).
- [ ] Decision (A vs A+B) recorded here; `ratings_provisional` cleared.
