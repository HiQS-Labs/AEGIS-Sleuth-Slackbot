---
title: "Phase brief p5 — CHANGELOG backfill and record"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "none (housekeeping); parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Backfill the missing GH-91 entry and record GH-94/95/96 plus the p2 seam coverage.
---

# p5 — CHANGELOG: backfill GH-91 and record this marathon's work

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

No GitHub issue: AGENTS.md §8 housekeeping.
Runs last so it can describe finished work. Rebase on p4's result before starting.

## Two jobs

### 1. Backfill the missing GH-91 entry

`development` shipped GH-91 (the command-router fallthrough for an explicit command carrying an
image) with **no CHANGELOG entry at all**. Version 1.4.303 covers GH-73 through GH-76 only. A
routed-command-plus-attachment is a behavior change, so AGENTS.md §8 requires one.

GH-92 was docs-only (`RELEASES.md`) and needs no entry.

### 2. Record GH-94, GH-95, GH-96 and the p2 seam coverage

One new version block covering this marathon's four phases.

## Format — follow the note at the top of CHANGELOG.md

Lead with a friendly, plain-language TL;DR in the bot's own first-person voice: one or two sentences
a non-engineer would understand, about what changed **for a user**. Then a `**Technical:**` block
with the engineering detail (files, issue numbers, tests).

For these fixes the user-visible story is: reminders phrased with a fuzzy time no longer land on the
wrong day; commands sent with an image attached now work the same as without one; and when something
fails you now get the diagnostic details in every case, not just some.

## Version number

Read the current `package.json` version and the newest CHANGELOG heading before choosing. Take the
next patch number after the newest **CHANGELOG** heading — which is ahead of `package.json` on
purpose. **Do not bump `package.json`.** Per AGENTS.md §8/§11 the version is set at release, and a
feature branch that bumps it creates a conflict for the next one.

If your chosen heading already exists, renumber per the AGENTS.md §11 collision rule rather than
merging into the existing block.

## Do NOT

- Do not touch `package.json`.
- Do not edit or renumber existing CHANGELOG entries other than as §11 requires.
- Do not edit any file under `src/` or `tests/`.

## Gate

`npm test` must pass — the repo has CHANGELOG-shape checks in the suite.
