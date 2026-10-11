---
Goal: Final QA of GH-149 reminder judgement consolidation (implementation vs accepted plan)
Date: 2026-10-10
NEXT: claude (Producer)
STATUS: Approved
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

## Round 1 — codex (Reviewer), 2026-10-10

Basis: Read the accepted Plan, Sweep result, Acceptance and Operator acceptance block, seeded source and corpus, and compared all eight named existing source/test files with base 71def6d. Base contents were read directly from local object storage with Python/zlib, without a git command; comparison exited 0, showed the planned rewiring/deletions, and printed PROMPT UNCHANGED: True. Verify tier by direct source: list_projects pagination exhausted all 82 projects with no applicable GH-149 clone/worktree index, so no current graph generation or coverage attestation is available. No index/source mutation was performed. Reported suite results remain producer evidence.

1. Addendum tasks: Reproduce is substantive: all four shipped issue classes appear in the corpus and run through the judgement; #205 also exercises real date extraction (tests/reminder-judgement-corpus.test.js:35, :69-72). Guard is substantive within its accepted deterministic-exclusion boundary: unique ids, exact source-plus-flags definitions, positive rows, reverse membership and primary reason coverage (tests/reminders-fsm-invariants.test.js:424-446). Fix and Sweep are substantive: the new owner contains the gates/model call and old definitions are deleted. Verify remains the operator-owned post-merge observation. Prompt semantic quality is outside the stubbed corpus, as the plan explicitly states.

2. Paths/order match: completion reads raw text before scheduling logic (src/reminder-judgement.js:183-193). The injected guard remains after question checks and before negation/future (src/reminder-text-completion.js:125-129). EXCLUSIONS runs only for auto entries (:197-201), and quoted_only retains the condition that stripping changed the text (:199). Force passes whole text (:196); fallback strips its own input (:131, :221). Scheduling early exits return model-shaped Analysis (:207), and the pipeline returns that Analysis (src/reminders-ai-pipeline.js:366-375). Completion, discovery, force-mode, handler and chat call sites match the accepted table. Both force fallback sites consume the constant and retain surrounding control flow.

3. Ownership: no second owner/mirror implementation found in the bounded src sweep. Request, period-only, opt-out, direct-ask and negation definitions live in src/reminder-judgement.js:32-66. Only that file imports quoted-text; quoted span regexes remain in quoted-text as planned. EXCLUSIONS is actually iterated. Diagnostic prose containing tomorrow morning is not another trigger definition.

4. Pinned behavior: base comparison preserves regex definitions and fallback result fields. Auto opt-out is the stated exception, pinned with a would-schedule stub and ModelCalled false. Strict completion probes preserve done-with-quoted-negation -> ignore/negated_or_partial, quoted done -> complete/strict_phrase, and done-plus-remind-me / snooze-this -> ignore/contains_request. UTC arithmetic is equivalent at exact-day boundaries: after the retained first +1 day, Math.ceil adds only the further days needed, so equality stops both implementations; unchanged too-soon handling follows (src/reminders-ai-pipeline.js:878-895).

5. Tests: all six removed #201 strings exist in the corpus with their original mention-mode non-completion verdict. Period-only/quote tests retain assertions with the new owner/mode; no pinned assertion was loosened in the compared files. Date warning and future-date assertions measure actual date-stage output. Guard compares Pattern.toString(), including flags. [Unverified — needs clone run] Full npm test, red controls A/B/C1-C3, build, tone, sanitization and other executable gates were not run here; the reported 143-suite/2615-test result is producer evidence, and the harness gate must run afterward. The unchecked sanitization acceptance item remains a pre-push requirement.

6. Scope: named existing-file comparisons show planned edits only. Chat changes are its import and IsReminderActionIntent; thread-read code is unchanged. Reminder prompt is byte-identical to base. No new flag is introduced. One owner, one corpus, one corpus suite and a guard in an existing suite fit the accepted envelope.

[Nit] The accepted corpus seed paragraph promises a calendar-event non-opt-out row, but data/static/ai/reminder-judgement-corpus.json:8 onward has none. The existing assertion at tests/chat-module.test.js:86 still pins the case, and the transferred regex is unchanged. This is a small corpus/documentation mismatch, not a behavior blocker; add the row or narrow the seed paragraph in a subsequent producer edit.

Probe evidence (scratch discarded after turn):
- Command: node with inline calls to JudgeReminderTextAsync(Text, {Mode:'strict'}) for ['done "not done"', '"done"', 'done, remind me tomorrow', 'snooze this'], followed by definition comparisons and a corpus Text filter for /calendar event/. Exit 0. Output respectively: ignore/negated_or_partial; complete/strict_phrase; ignore/contains_request; ignore/contains_request; definitions match: true; calendar corpus rows: 0.
- Command: rg -n 'calendar event' tests/chat-module.test.js. Exit 0. Decisive output: line 86 asserts IsReminderActionIntent("don't set a calendar event; set a reminder") is true.
- Command: node inline UTC arithmetic probe with Now=Date.UTC(2026,9,10,12), Day=86400000, ages [1,Day-1,Day,Day+1,2*Day-1,2*Day,2*Day+1,73*3600000,400*Day]; apply +1 UTC day, then old while-loop versus new Math.ceil step, throwing on inequality. Exit 0. Output: UTC roll-forward parity: 9 ages; exact 1/2/400-day boundaries included. This measures arithmetic, not the entire date suite.
- Command: rg -n for the four helper function definitions, REQUEST_PATTERN declaration, quoted-text require and FORCE_FALLBACK_TRIGGER declaration under src. Exit 0. All seven hits are in src/reminder-judgement.js (:22, :26, :40, :103, :111, :119, :130).

No Blocker or Should findings. Approval is the implementation review outcome, not certification of unrun gates or post-merge operator verification.

VERDICT: PASS

### Attestation · relay-drive — 2026-10-10T16:22:52Z
task: RELAY-gh149-final-qa
reviewer: codex
status: Approved
reviewed-head: 327f02638a3bf5830417203cc4cf090dac81473b
added-range: 5179+6085
added-sha256: fc4c9a351adf57dc48c5fe973d0c5ff876a3fb9e61974a84425b9de1e72beec3
