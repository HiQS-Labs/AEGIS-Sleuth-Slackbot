---
Goal: Final QA of GH-149 reminder judgement consolidation (implementation vs accepted plan)
Date: 2026-10-10
NEXT: codex (Reviewer)
STATUS: Open
---

# Context

Review the implementation on branch `fix/gh-149-reminder-judgement` against its plan
`PROJECT/2-WORKING/GH-149-REMINDER-JUDGEMENT.md` (read Plan, Sweep result, Acceptance, and the
"Operator acceptance" block). The plan-QA relay (`marathon-system/gh149-plan-qa/RELAY.md`) ran 3/3
rounds with every finding Accepted; the operator accepted the plan after the cap, so that thread stays
`Escalated`. This is the implementation gate.

Operational envelope: a single Slack bot on one dev server, one operator. No enterprise fail-safes,
no new test infrastructure beyond the corpus test.

Diff to read: `git diff 71def6d..HEAD -- src tests data CHANGELOG.md` (base of implementation is
`71def6d`; branch base on development is `aca655df`).
- src/reminder-judgement.js (new owner)
- src/reminders-ai-pipeline.js (analysis delegation; date stage)
- src/reminders-module.js (completion gate :1615; discovery hint; force mode; fallback constant)
- src/reminders-app-mention-handler.js (:3, :783), src/reminder-text-completion.js (RequestGuard), src/chat-module.js (import + IsReminderActionIntent only)
- data/static/ai/reminder-judgement-corpus.json, tests/reminder-judgement-corpus.test.js, tests/reminders-fsm-invariants.test.js (new describe at the end)
- re-pointed tests: tests/reminders-ai-pipeline.test.js, tests/quoted-text-reminders.test.js, tests/reminder-text-completion.test.js
- CHANGELOG.md (1.4.339)

## Acceptance map (plan → evidence)

| Plan acceptance | Evidence |
|---|---|
| Corpus green; red control A fails | corpus suite green; A = flip one row's verdict → `1 failed, 40 passed` |
| Red control B (#205 warning) | `wasAdjustedForward = true` at the date stage → `1 failed` |
| Red controls C1/C3, C2 alt, C2 flag-only | each → `1 failed`; restored → `41 passed, 41 total` |
| Full gate on final code | `npm test` rc 0: `Test Suites: 143 passed, 143 total`, `Tests: 2615 passed, 2615 total`, node tests ok |
| Single home (src/ defining files) | see sweep list |
| Loop retired, GH-205 tests unchanged | `while(IsPeriodOnly` → 0 files; GH-205 block passes |
| CHANGELOG + tone | `node scripts/validate-changelog-tone.js` → clean |

## Sweep list (before → after, defining files in src/)

| Pattern | Before | After |
|---|---|---|
| opt-out regex (d07d643) | src/chat-module.js | src/reminder-judgement.js |
| period-only regex + while loop (6e90bd8) | src/reminders-ai-pipeline.js (regex + loop) | src/reminder-judgement.js (regex); loop → one `Math.ceil` step |
| `require('./quoted-text')` (cf9fe6d) | pipeline (2 call sites), handler | src/reminder-judgement.js only; `KeepQuotedText` → `Mode: 'force'` |
| `REQUEST_PATTERN` (6584d6f) | src/reminder-text-completion.js | src/reminder-judgement.js, injected as RequestGuard |
| direct-ask + negation regex | src/reminders-ai-pipeline.js | src/reminder-judgement.js |
| `'tomorrow morning'` literal (3c267cd kept) | src/reminders-module.js ×2 | `FORCE_FALLBACK_TRIGGER` in src/reminder-judgement.js; retry at module ~:2005 unchanged |

## Questions (answer each by number)

1. Addendum tasks: is each of Reproduce, Guard, Fix, Sweep met by this diff (Verify is operator post-merge)? Name any that is only nominal.
2. Codepaths match the plan: do the rewired call sites and the gate order inside `JudgeReminderTextAsync` match the accepted plan (completion on raw text with the guard at its old position; `EXCLUSIONS` only in `auto`; `force` sends the whole message; fallback keeps its own quote-strip; `Analysis` always model-shaped in scheduling modes)? Note the one implementation detail the plan doc records: `quoted_only` fires only when quote-stripping removed something.
3. Duplicate subsystem: did any second owner, mirror table, or duplicated regex slip in? Is any swept pattern still defined in two `src` files?
4. Behavior preserved for pinned cases: for the cases the existing suites pin (and the six migrated #201 rows), is any verdict or reason token changed, other than the stated auto-mode opt-out exception? Is the date-stage arithmetic identical to the loop at exact-day boundaries?
5. Tests: does any test assert something the code does not do, or was any pinned assertion loosened rather than re-pointed?
6. Scope: anything outside the plan (prompt edits, thread-read code in chat-module, new flags)?

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered. Cite file:line. Every
`[Blocker]` or `[Should]` carries `Observed input:`, `Affected scope:` and `Falsifier:` lines. You
may run narrow read-only probes (node -e, grep) with output under `.relay-scratch/`; do not run
`npm test` or jest and grade such claims `[Unverified — needs clone run]`.

Vocabulary rule: your block MUST contain a non-empty `Basis:` line and end with exactly one of
`VERDICT: PASS` or `VERDICT: FAIL`. On PASS change `STATUS: Open` above to `STATUS: Approved`. Round cap 3.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log
