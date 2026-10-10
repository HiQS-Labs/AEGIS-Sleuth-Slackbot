---
gh_issue: 149
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/149
title: "GH-149: One owner for reminder intent judgement (whack-a-mole addendum 2026-10-10)"
status: working
created: 2026-10-10
updated: 2026-10-10
owner: noel
doc_type: bugfix
effort: 4
complexity: 4
risk: 3
phases: 1
ratings_provisional: false
branch: fix/gh-149-reminder-judgement
goal: "Reminder intent judgement has one code owner and one seeded corpus, so the next false-positive class gets a corpus row and one code site instead of a fifth regex."
---

# GH-149 — reminder judgement consolidation

## Status

| What was just completed | What's next |
|---|---|
| Intake, rating, recon and plan written on base `aca655df` | Codex plan QA relay (`marathon-system/gh149-plan-qa/RELAY.md`), then implementation |

Scope: the "Additional remediation tasks" in the 2026-10-10 whack-a-mole addendum on #149 only. The
umbrella's original replay-nondeterminism, echo-threshold and reaction-lookback items are NOT in scope
and stay open on the issue. PR #227 (`fix/gh-225-thread-context-provider`) owns the thread-read sites
in `src/chat-module.js` around :2722/:2940/:3087/:3104; this task does not touch those regions.

## Asks / acceptance criteria (from the addendum)

- **Reproduce:** table-driven `tests/reminder-judgement-corpus.test.js` fed by
  `data/static/ai/reminder-judgement-corpus.json` holding the four shipped cases (#197 ignore,
  #205 schedule with no past-time warning, #211 ignore, #201 not-complete) asserted through one entry
  point with the LLM stubbed.
- **Guard:** every future exclusion must add a corpus row; covered in the existing
  `tests/reminders-fsm-invariants.test.js` (no new suites beyond the corpus test).
- **Fix:** introduce `src/reminder-judgement.js` exporting `JudgeReminderText(text, {mode, ...})` →
  `{ Verdict: schedule|ignore|complete, Reasons[], OwnWords, Triggers[] }` owning quote-strip,
  opt-out/negation, period-only classification, direct-ask fallback and completion detection, with
  `DecideAsync` inside it. Route the existing call sites through it.
- **Sweep:** retire `IsCreationOptOut` (d07d643), `IsPeriodOnlyTrigger` + while-loop (6e90bd8), the
  three `IgnoreQuotedText` call sites and the `KeepQuotedText` option (cf9fe6d), the `REQUEST_PATTERN`
  guard (6584d6f); keep 3c267cd's per-group fallback inside the judgement result.
- **Verify (post-merge, operator):** radar re-score of the cluster signature drops under 5 on two
  consecutive runs; no new reminder false-positive issue for 14 days.

## Recon (HEAD = `aca655dfcc006e55fbedf7435923ebf5c75f8b92`, line numbers re-verified)

The five places that currently decide "is this text a commitment with a time", in the order a
Slack `message` event meets them:

1. **Regex pre-gate** — `src/reminders-app-mention-handler.js:772-789`. `#HasSchedulingTrigger` →
   `#GetSchedulingTriggerMatch`, which calls `IgnoreQuotedText` at :783 before matching
   `SCHEDULING_TRIGGER_PATTERN`. Consumed by `src/reminders-module.js:1579` (auto path gate) and by
   `OnAppMentionAsync` at :721. The completion gate the addendum cites as :691-699 is the
   `#TryCompleteRemindersFromReplyAsync` call at :700-702 (mention mode).
2. **Quote-strip** — `src/quoted-text.js` (`StripQuotedText`, `IgnoreQuotedText`, kill switch
   `REMINDER_IGNORE_QUOTED_TEXT`). Three call sites: handler :783, pipeline :367
   (`AnalyzeMessageForRemindersAsync`, skipped when `KeepQuotedText`), pipeline :733
   (`DetectDirectAskWithTimeTrigger`).
3. **Prompt exclusion list** — `data/static/ai/reminders-instructions.md:62-72` (work summaries,
   meetings, past tense, handoffs, weak acknowledgment, first-person anticipation, opt-out). Fed to
   the model through `ReminderAnalysisDecisionSpec` (`src/reminders-ai-pipeline.js:95-125`) and
   `DecideAsync` (`src/ai-decision.js:191`).
4. **Post-LLM override** — `src/reminders-ai-pipeline.js:364-399`: quote-strip, then `DecideAsync`
   at :381, then if the model said `ignore` the deterministic direct-ask fallback
   (`#BuildDeterministicFallbackReminder` :839-852 → `DetectDirectAskWithTimeTrigger` :732-750, which
   also owns a negation regex). `DetectDirectAskWithTimeTrigger` is also the disabled-channel
   discovery hint at `src/reminders-module.js:1696`.
5. **Date-stage regex** — `IsPeriodOnlyTrigger` :760-763 and the roll-forward loop :963-968 inside
   `ExtractDateWithGptAsync`; sets `wasAdjustedForward` which `reminders-module.js:2024,2194,2493`
   turn into the "requested time was in the past" warning.

Completion judgement sits beside these: `src/reminders-module.js:1539` (`OnAppMentionAsync`,
mention mode) and :1579 — re-verified at :1587-1589 (`#OnMessageAsync`, strict mode, before the
channel-enabled gate) both call `#TryCompleteRemindersFromReplyAsync` (:1611), which calls
`ReminderTextCompletion.DetectCompletionReply` (:1620) and `ResolveThreadReminderIDsAsync` with the
`IsOwner` closure (:1625-1630). `REQUEST_PATTERN` is `src/reminder-text-completion.js:86-87`, applied
at :129 between the question and negation checks.

`src/chat-module.js:1547-1566` `IsReminderActionIntent` decides whether an app mention with
"reminder" + a creation verb is routed to the reminders module instead of chat; the `IsCreationOptOut`
regex at :1564 is the d07d643 patch. Called at :2153.

Force-schedule (`:alarm_clock:`) path: `src/reminders-module.js:1815-1818` passes
`{ KeepQuotedText: Boolean(ArgForceSchedule) }`; the whole-message synthetic "tomorrow morning"
fallback is :1823-1860; the per-group fallback (3c267cd) is :1996-2010.

### One false positive traced end to end (#211, quoted text, pre-cf9fe6d)

Slack `message` event `He said "deploy tomorrow"` in an enabled channel → `#OnMessageAsync`
(reminders-module :1587) strict completion: not a completion phrase → channel enabled → text present →
not a thread, so no shorthand/enrichment → :1579 `HasSchedulingTrigger` matches `tomorrow` →
`#TryScheduleRemindersAsync` :1815 → pipeline `AnalyzeMessageForRemindersAsync` → model returns
`schedule` with trigger `tomorrow` → `ExtractDateWithGptAsync` → reminder created and the
confirmation posted in-thread. cf9fe6d stopped it by stripping the quote at two of the three layers
(gate and analysis); the fix had to be threaded by hand into each.

### Existing suites that pin the behavior

`tests/reminders-ai-pipeline.test.js` (period-only :610-666, fallback, jitter),
`tests/reminders-module.test.js`, `tests/reminders-app-mention-handler.test.js`,
`tests/reminder-text-completion.test.js` (request rows :61-66), `tests/quoted-text-reminders.test.js`
(`KeepQuotedText` :111-113, `DetectDirectAskWithTimeTrigger` :127-128),
`tests/reminders-fsm-invariants.test.js`, `tests/reminders-integration.test.js`,
`tests/chat-module.test.js` (`IsReminderActionIntent` :60-87). LLM is stubbed everywhere via
`jest.mock('../src/workspace-ai')` + `tests/mocks/mock-workspace-ai.js`.

## Plan

### Module: `src/reminder-judgement.js`

One owner for "is this text a commitment the speaker owns, with a time the speaker named, or a
completion of one". Exports:

- `JudgeReminderTextAsync(ArgText, ArgOptions)` with `ArgOptions = { Mode, WorkspaceAI, DecisionSpec,
  Capture, Logger }`; `Mode` ∈ `'auto' | 'force' | 'mention' | 'strict'`. `auto`/`force` are the
  scheduling modes (the model is consulted); `mention`/`strict` are the completion modes (no model
  call, same `DetectCompletionReply` modes as today). Returns
  `{ Verdict: 'schedule'|'ignore'|'complete', Reasons: string[], OwnWords: string, Triggers:
  {Phrase, PeriodOnly}[], Analysis: GptReminderResponse|null, Completion: {IsCompletion,
  Reason}|null, FallbackTrigger: string|null }`. `Analysis` is the model-shaped result the scheduling
  stage already consumes, so `#TryScheduleRemindersAsync` keeps reading `recommendation`/`reminders`.
- Sync helpers for the three callers that need one judgement before the full one runs:
  `OwnWords(text)` (quote-strip honoring the kill switch), `IsCreationOptOut(normalizedText)`,
  `IsPeriodOnlyTrigger(trigger)`, `DetectDirectAskWithTimeTrigger(text)`, `HasRequestLanguage(text)`,
  `REASONS` (the frozen list of reason tokens the module can emit), `FORCE_FALLBACK_TRIGGER`.

Gate order inside `JudgeReminderTextAsync` (the implicit method-body order today, made explicit):

1. quote-strip → `OwnWords` (skipped in `force`, which is the `KeepQuotedText` case). Empty own words
   → `ignore` / `quoted_only`, no model call.
2. opt-out → `ignore` / `opt_out` in `auto` (regex moved from chat-module; the prompt already says
   ignore for this phrasing, so this is the deterministic version of a rule the model is already
   given). Skipped in `force`: the human asserted it is a task.
3. completion modes only: `DetectCompletionReply(ownWords, Mode)`; a positive hit is then checked
   against `HasRequestLanguage` (the `REQUEST_PATTERN` moved here) and downgraded to `ignore` /
   `contains_request`. Return `complete` / `completion:<reason>` or `ignore` / `not_completion:<reason>`.
   Running the request guard after `DetectCompletionReply` keeps every other reason token exactly
   as today.
4. scheduling modes: `DecideAsync(WorkspaceAI, DecisionSpec, ownWords, {Capture, Logger})` —
   unchanged spec, prompt and validator.
5. model `ignore` → direct-ask fallback (`DetectDirectAskWithTimeTrigger`, with its negation regex)
   → `schedule` / `direct_ask_fallback`, else `ignore` / `model_ignore`.
6. `Triggers` = each candidate's `scheduling_trigger` classified by `IsPeriodOnlyTrigger`;
   `FallbackTrigger = 'tomorrow morning'` in `force` mode (3c267cd's per-group fallback literal now
   comes from the judgement result).

### Corpus: `data/static/ai/reminder-judgement-corpus.json`

Rows `{ Id, Issue, Text, Mode, Model, Expect }` where `Model` is what the stubbed analyzer returns
(`null` = the model must not be called) and `Expect` holds `Verdict`, `Reason` (one token that must be
present), optional `ModelCalled`, `PeriodOnly` (per trigger), `OwnWords`. Seeded with the four
shipped cases plus the rows the sweep retires from unit tests: the five #201 request rows from
`reminder-text-completion.test.js:61-66`, the opt-out and `don't forget` rows, the negated direct ask,
and the force-mode quoted case.

`tests/reminder-judgement-corpus.test.js`: `test.each` over the rows, one entry point
(`JudgeReminderTextAsync`) with `WorkspaceAI.ProcessMessageWithJsonResponseAsync` stubbed per row from
`Model`. A row's expectation changing fails the test by construction.

Guard (in `tests/reminders-fsm-invariants.test.js`, existing suite): every token in
`ReminderJudgement.REASONS` appears in at least one corpus row's `Expect.Reason`, and every corpus
reason is a known token. Adding an exclusion without a row fails the invariant.

### Call-site rewiring (one site per commit)

| Site | Change |
|---|---|
| `src/reminders-ai-pipeline.js:364-399` | `AnalyzeMessageForRemindersAsync(text, { Mode })` becomes a thin call to `JudgeReminderTextAsync` passing `this.#WorkspaceAI`, `ReminderAnalysisDecisionSpec`, capture and logger; returns `Judgement.Analysis`. `KeepQuotedText` option removed. `#BuildDeterministicFallbackReminder`, `DetectDirectAskWithTimeTrigger`, `IsPeriodOnlyTrigger` deleted from the pipeline. |
| `src/reminders-ai-pipeline.js:966` | `ReminderJudgement.IsPeriodOnlyTrigger(trigger)`. |
| `src/reminders-module.js:1620` | `#TryCompleteRemindersFromReplyAsync` asks `JudgeReminderTextAsync(text, { Mode })` and proceeds only on `Verdict === 'complete'`; log line keeps `reason=`. Gates at :1539 / :1587 keep their position. |
| `src/reminders-module.js:1696` | discovery hint → `ReminderJudgement.DetectDirectAskWithTimeTrigger`. |
| `src/reminders-module.js:1815-1818` | `{ Mode: ArgForceSchedule ? 'force' : 'auto' }`. |
| `src/reminders-module.js:1850, 2007` | the `'tomorrow morning'` literal comes from `ReminderJudgement.FORCE_FALLBACK_TRIGGER`. |
| `src/reminders-app-mention-handler.js:783` | `ReminderJudgement.OwnWords(text)` instead of a direct `IgnoreQuotedText` import. `SCHEDULING_TRIGGER_PATTERN` and the gate itself stay in the handler (many consumers; moving it is a rewrite). |
| `src/chat-module.js:1564` | `ReminderJudgement.IsCreationOptOut(NormalizedText)`. |
| `src/reminder-text-completion.js:86-87,129` | `REQUEST_PATTERN` and its check removed; `DetectCompletionReply` otherwise byte-identical. |

Tests re-pointed, not loosened: `reminders-ai-pipeline.test.js:662-665` →
`ReminderJudgement.IsPeriodOnlyTrigger`; `quoted-text-reminders.test.js:111-113` → `{ Mode: 'force' }`
and :127-128 → `ReminderJudgement.DetectDirectAskWithTimeTrigger`; the five request rows at
`reminder-text-completion.test.js:61-66` move to the corpus (they are the #201 class).

### Sweep result (each former regex has exactly one home)

- `IsCreationOptOut` regex: chat-module → reminder-judgement.
- `IsPeriodOnlyTrigger` regex: pipeline → reminder-judgement. The roll-forward loop at the date
  stage stays: it is date extraction (a stated non-goal) and GH-205 tests pin it; it now consumes the
  judgement classifier instead of a pipeline-local regex.
- `IgnoreQuotedText`: three call sites → one (`reminder-judgement` is the only importer of
  `quoted-text`); `KeepQuotedText` option → `Mode: 'force'`.
- `REQUEST_PATTERN`: reminder-text-completion → reminder-judgement.
- Direct-ask + negation regex: pipeline → reminder-judgement.
- 3c267cd per-group fallback: kept; the literal is owned by the judgement result.

### Non-goals

No change to the prompt (`reminders-instructions.md`) — the examples stay; the corpus holds the
cases. No new LLM calls, no change to `ExtractDateWithGptAsync`'s contract, no change to
`SCHEDULING_TRIGGER_PATTERN`, no touching #149's original replay-nondeterminism / echo-threshold /
reaction-lookback tasks, no changes to thread-read code (#225 owns it), no new env flags.

### Preflight bet

- Outcome: every future false-positive class gets one corpus row and one code site, not a fifth regex.
- Smallest bet: consolidation + corpus. Not a rewrite of trigger detection or the prompt.
- Rejected alternative: another pre-filter in front of the model — that is the defect.
- Rollback: revert the rewiring commits; the module, corpus and test are additive and inert when
  nothing calls them. Undo class easy, no migration, no state.
- Blast radius: every reminder scheduling and text-completion path. Covered by the eight suites above
  plus the corpus; behavior is intended byte-identical for every pinned case.

### Operational envelope

A single Slack bot on one dev server, driven by one operator. Complexity commensurate: one module,
one JSON file, one test file, no framework, no enterprise fail-safes.

## Acceptance

- [ ] Corpus test green with every row; a red control (flip one row's expected verdict) fails.
- [ ] Every existing reminders suite green; full `npm test` green on the final commit.
- [ ] `git grep` shows each swept regex has exactly one home (`src/reminder-judgement.js`).
- [ ] FSM invariant: every `REASONS` token has a corpus row.
- [ ] CHANGELOG entry in the two-paragraph format; `node scripts/validate-changelog-tone.js` exits 0.
- [ ] `utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt` clean before every push.

## Rating and recurrence

2026-10-10 UTC RELEASES assessment: rated 80/65/50/35 (priority/severity/appeal/cheapness), no
override; row `rmi-01M4J8VBD1FK26YPZSFBFNT9GJ`, read back from the ledger. Recurrence is the
evidence: six member issues (#197 #201 #205 #211 #114 #149) and two repeat fixes on
`src/reminders-ai-pipeline.js` and `src/reminders-module.js` inside 14 days (commits 6e90bd8,
cf9fe6d, ebbcd47, 6584d6f), each symptom fix costing a cycle and not holding (churn score 19, radar
run 20261010T060531Z). Severity 65: false positives post reminders nobody asked for, but nothing is
lost. Cheapness 35: four modules plus tests are touched, with the behavior pinned by eight existing
suites. PDDA triage risk 3 (Costly), effort 4, complexity 4 — not express-eligible.

## Verification and QA

Plan QA: pending (`marathon-system/gh149-plan-qa/RELAY.md`).
