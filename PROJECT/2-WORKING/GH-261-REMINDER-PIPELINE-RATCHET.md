---
gh_issue: 261
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/261
title: Reminder-pipeline inventory ratchet
status: Active
created: 2026-10-20
updated: 2026-10-20
owner: Codex
goal: Prevent #250's known reminder text-pipeline complexity signals from growing during its deletion phases.
doc_type: bugfix
effort: 2
complexity: 2
risk: 2
phases: 1
branch: chore/AEGIS-Sleuth-Slackbot-gh261-reminder-pipeline-ratchet-2026-10-20
non_goals: [Implementing #250 deletions, AST-based complexity analysis, new test files]
---

# GH-261 — Reminder-pipeline inventory ratchet

## Status

| What was just completed | What's next |
|---|---|
| Captured #261, registered and rated its roadmap row (70/65/70/80), and measured the current signal locations from `origin/development` (`50fa08c`). | Complete plan QA, then add the narrow guard, baseline, CI hook, contract rule, and smoke receipts. |

## Table of contents

- [Recon and decision](#recon-and-decision)
- [Phase 1 — ratchet](#phase-1--ratchet)
- [Verification](#verification)

## Recon and decision

`src/reminders-ai-pipeline.js` has exactly three reminder-pipeline `*DecisionSpec = Object.freeze(` declarations (dedup, multi-task extraction, analysis) and the three named routing threshold declarations. `src/reminder-display-selection.js` declares the four current selector source values. The raw `Key task` probe has 13 source hits, so the guard must not pretend that every textual mention is a parser: it will count only executable `Key task` literals/regexes after line-comment stripping, excluding the single `NewReminderMessageText + "\n\nKey task(s):"` writer at `src/reminders-module.js:2060`; the baseline records every included location. The two context-header declarations are `CONTEXT_BLOCK_HEADER` and `LIVE_MESSAGE_HEADER` in `src/reminder-context-resolution.js`; the neutralization and display-strip regular expressions are consumers of that already-declared format and are intentionally out of this header-only ratchet.

Existing guard shape is a short Node script in `scripts/`, invoked through `package.json`, optionally covered by an existing validator test file, and called explicitly from CI. `validate:fsm` is the only sibling currently called directly by CI; the workspace-isolation and reminder-render guards are covered through Jest. #261 explicitly requires the new guard next to the former, so this plan adds a CI step and retains `npm test` coverage through an existing validator suite rather than adding a test file.

Outcome sought: make any increase to the explicitly-reviewed #250 inventory visible before it lands. Smallest viable bet: literal, named patterns with one JSON baseline and deliberate `--update-baseline` shrink acknowledgement. Rejected alternative: AST/function-count analysis; it would broaden the ratchet beyond the issue's named failure modes and cost more maintenance without strengthening these red controls. Rollback: remove the one CI step, npm script, script, and baseline together; the runtime reminder path is untouched.

## Phase 1 — ratchet

1. Add `scripts/validate-reminder-pipeline.js`, modeled on the sibling scripts. It scans only `src/**/*.js`, maps every named match to `file:line`, and counts this fixed matcher set: (a) `const <name>DecisionSpec = Object.freeze(` in `reminders-ai-pipeline.js`; (b) executable `Key task` string/regex sites after comment stripping except the one identified writer; (c) the three exact `RemindersAIPipeline` routing-threshold declarations; (d) the four literal members of the selector `source` union in `reminder-display-selection.js`; and (e) the two exact `*_HEADER` declarations above. A new context wire-format helper or normalization regex is deliberately not governed unless it introduces a header declaration; that narrower scope is #261's stated “context header” red control, not a claim to inventory every marker consumer.
2. Add `scripts/reminder-pipeline-baseline.json`, measured from this task's `origin/development` base. Store each count, matcher description, included `file:line` locations, reason, and #79/#250 pointers so an intentional baseline raise is reviewable.
3. Require an exact baseline match by default: growth fails with the matching locations and #79/#250 pointer; shrink fails until `--update-baseline` rewrites only lower counts. Refuse baseline growth during update.
4. Add `validate:reminder-pipeline` to `package.json`; call it next to `validate:fsm` in `.github/workflows/ci.yml`; add the #79-linked constraint to AGENTS.md.
5. Extend an existing validator test file only if needed to exercise helper-level red controls. Do not create a test file. Record the mandated red controls and shrink flow in `TESTS-RESULTS/2026-10-20+GH-261/`.
6. Run the focused validator, relevant existing Jest suite, build, CI-equivalent guards, sanitizer, and PDDA check. Commit, run final relay QA, push, and open a PR targeting `development`.

## Verification

- Baseline passes on the unmodified tree.
- A temporary source copy with a fourth DecisionSpec, an additional executable Key-task parser, and a third `*_HEADER` declaration each fails with `file:line` plus the #79/#250 pointer.
- A temporary source copy with one routing-threshold declaration removed fails as an unrecorded shrink; `--update-baseline` lowers the generated baseline and passes on that copy. The committed baseline remains based on the real tree.
- `npm test`, `npm run build`, `npm run validate:fsm`, `npm run validate:reminder-pipeline`, `./utils/sanitize-scan.sh`, and `utils/pdda/pdda.sh run` are run after the final implementation.
