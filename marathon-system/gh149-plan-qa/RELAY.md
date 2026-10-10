---
Goal: Plan QA of GH-149 reminder judgement consolidation (whack-a-mole addendum 2026-10-10)
Date: 2026-10-10
NEXT: codex (Reviewer)
STATUS: Open
---

# Context

Review the plan in `PROJECT/2-WORKING/GH-149-REMINDER-JUDGEMENT.md` (read it in full: Recon, Plan,
Sweep result, Non-goals, Preflight bet, Acceptance, Rating) against the "Additional remediation tasks"
in the 2026-10-10 whack-a-mole addendum comment on GitHub issue #149 (its text is transcribed in the
doc's "Asks / acceptance criteria" section). Nothing is implemented yet; this is the plan gate.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. Tests and
machinery must be commensurate with that; do not demand enterprise fail-safes, multi-tenant
isolation, feature flags for every gate, or new test infrastructure beyond the one corpus test the
addendum asks for.

Files the plan cites (read the cited regions at HEAD to check the line numbers and claims):
- src/reminders-ai-pipeline.js (:95-125 spec, :364-399 analysis, :732-763 direct ask + period-only, :839-852 fallback, :940-995 date roll-forward)
- src/reminders-module.js (:1539, :1587-1589, :1611-1700, :1815-1860, :1996-2010)
- src/reminders-app-mention-handler.js (:700-702, :721, :772-789)
- src/reminder-text-completion.js (:60-150)
- src/quoted-text.js, src/chat-module.js (:1547-1566, :2153), src/ai-decision.js (:191)
- data/static/ai/reminders-instructions.md (:55-80)
- tests/reminder-text-completion.test.js (:40-80), tests/quoted-text-reminders.test.js (:100-130), tests/reminders-ai-pipeline.test.js (:610-670), tests/chat-module.test.js (:60-87), tests/reminders-fsm-invariants.test.js, tests/mocks/mock-workspace-ai.js

Questions (answer each by number):

1. Grounded paths: does every file:line the plan cites exist at HEAD and say what the plan says it says? Name any that do not.
2. Missing requirement: is any task of the #149 addendum (Reproduce, Guard, Fix, Sweep; Verify is operator post-merge) not covered by the plan, or covered only nominally? In particular: is the FSM-invariant guard ("every `REASONS` token has a corpus row") a real guard for "every future exclusion must add a corpus row", or is there an exclusion shape that would slip past it?
3. Extends vs duplicates: does `src/reminder-judgement.js` as specified extend the existing modules (quoted-text, reminder-text-completion, ai-decision, the pipeline's decision spec) or does it duplicate any of them? Is any regex left with two homes after the sweep table is applied?
4. Ordering of gates: the plan makes the implicit order explicit as quote-strip -> opt-out -> completion -> model -> direct-ask fallback -> trigger classification. Does that preserve today's observable behavior for every case the existing suites pin (name any case whose verdict or reason token would change)? Specifically check: (a) applying the opt-out regex deterministically in `auto` mode before the model, (b) running the request guard AFTER `DetectCompletionReply` rather than at its current position, (c) `force` mode skipping both quote-strip and opt-out.
5. Blast radius / rollback / falsifiable checks: is the rollback story (revert rewiring commits, module additive) accurate given the sweep deletes code from four files? Are the acceptance checks falsifiable as written (red control, grep single-home, invariant)?
6. The roll-forward `while` loop at the date stage is kept (the addendum says retire "IsPeriodOnlyTrigger + while-loop"). The plan's reason: it is date extraction (a non-goal) and GH-205 tests pin it. Is that deviation justified, or is there a way to honor the addendum literally without changing `ExtractDateWithGptAsync`'s observable results?
7. Rating grounded: is 80/65/50/35 (priority/severity/appeal/cheapness) supported by the recurrence evidence in the doc, and is PDDA risk 3 / effort 4 / complexity 4 consistent with the blast radius described?

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered for the envelope. Be
concrete and cite file:line. Every `[Blocker]` or `[Should]` must carry `Observed input:`,
`Affected scope:` and `Falsifier:` lines. You may run narrow read-only probes (node -e, grep) with
output under `.relay-scratch/`; do not run `npm test` or jest and grade such claims
`[Unverified — needs clone run]`.

Vocabulary rule: end your block with exactly one of the lines `VERDICT: PASS` or `VERDICT: FAIL`.
On PASS, change `STATUS: Open` at the top of this file to `STATUS: Approved`. On FAIL, leave STATUS
Open and list the findings; the producer will adjudicate each one in the plan doc (Accepted /
Rejected — Out of Scope / Ponytail) and hand back for the next round. Round cap 3.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log
