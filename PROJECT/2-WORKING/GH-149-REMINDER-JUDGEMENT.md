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
| Implementation, full gate and final Codex QA (PASS, round 1, attested) done | PR into development; merge is the operator's |

Scope: the "Additional remediation tasks" in the 2026-10-10 whack-a-mole addendum on #149 only. The
umbrella's original replay-nondeterminism, echo-threshold and reaction-lookback items are NOT in scope
and stay open on the issue. PR #227 (`fix/gh-225-thread-context-provider`) owns the thread-read sites
in `src/chat-module.js` around :2722/:2940/:3087/:3104; this task does not touch those regions.

## Quad Concepts

- Pain: reminder intent is judged in five layers across four modules, so each false-positive fix
  ships as a new regex in whichever layer was nearest -> Fix: one module (`src/reminder-judgement.js`)
  owns the ordered gates and the model call; the call sites route through it.
- Pain: no single test can exercise the four shipped false-positive classes because they live in four
  modules -> Fix: one seeded corpus (`data/static/ai/reminder-judgement-corpus.json`) run through the
  one entry point with the model stubbed.
- Pain: a future exclusion can be added without a regression row -> Fix: an FSM invariant that every
  reason token the module can emit has a corpus row.

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

Completion judgement sits beside these (corrected after plan-QA round 1): the **strict**-mode gate is
`src/reminders-module.js:1539` inside `#OnMessageAsync` (:1522), before the channel-enabled gate; the
**mention**-mode gate is `src/reminders-app-mention-handler.js:700-702` (`OnAppMentionAsync`), wired
through the dependency at `reminders-module.js:449-450`. :1587-1589 is the scheduling call, not a
completion gate. Both gates call `#TryCompleteRemindersFromReplyAsync` (:1611), which calls
`ReminderTextCompletion.DetectCompletionReply` at :1615 on the RAW reply text and
`ResolveThreadReminderIDsAsync` with the `IsOwner` closure at :1620-1625. A positive verdict
transitions and deletes the reminder (:1654-1659), so a false completion loses work. `REQUEST_PATTERN`
is `src/reminder-text-completion.js:86-87`, applied at :129 after the question checks and before the
negation / future checks; the six #201 rows that pin it are `tests/reminder-text-completion.test.js:62-67`.

`src/chat-module.js:1547-1566` `IsReminderActionIntent` decides whether an app mention with
"reminder" + a creation verb gets the "creation is not supported here" explanation posted by its
caller at :2152-2158 (it is a chat-side intent check, not a scheduling pre-filter); the
`IsCreationOptOut` regex at :1564 is the d07d643 patch and runs on text already lower-cased with
curly quotes/apostrophes normalized (:1550-1555).

Force-schedule (`:alarm_clock:`) path: `src/reminders-module.js:1815-1818` passes
`{ KeepQuotedText: Boolean(ArgForceSchedule) }`; the whole-message synthetic "tomorrow morning"
fallback is :1823-1860; the per-group fallback (3c267cd) is :1996-2010.

### One false positive traced end to end (#211, quoted text, pre-cf9fe6d)

Slack `message` event `He said "deploy tomorrow"` in an enabled channel → `#OnMessageAsync`
(reminders-module :1539) strict completion: not a completion phrase → channel enabled → text present →
not a thread, so no shorthand/enrichment → :1579 `HasSchedulingTrigger` matches `tomorrow` →
`#TryScheduleRemindersAsync` :1815 → pipeline `AnalyzeMessageForRemindersAsync` → model returns
`schedule` with trigger `tomorrow` → `ExtractDateWithGptAsync` → reminder created and the
confirmation posted in-thread. cf9fe6d stopped it by stripping the quote at two of the three layers
(gate and analysis); the fix had to be threaded by hand into each.

### Existing suites that pin the behavior

`tests/reminders-ai-pipeline.test.js` (period-only :610-666, fallback, jitter),
`tests/reminders-module.test.js`, `tests/reminders-app-mention-handler.test.js`,
`tests/reminder-text-completion.test.js` (request rows :62-67), `tests/quoted-text-reminders.test.js`
(`KeepQuotedText` :111-113, `DetectDirectAskWithTimeTrigger` :127-128),
`tests/reminders-fsm-invariants.test.js`, `tests/reminders-integration.test.js`,
`tests/chat-module.test.js` (`IsReminderActionIntent` :60-87). The LLM is stubbed at the
`WorkspaceAI.ProcessMessageWithJsonResponseAsync` boundary: most suites via
`jest.mock('../src/workspace-ai')` + `tests/mocks/mock-workspace-ai.js`, `quoted-text-reminders.test.js:95-97`
with an inline stub object. The corpus test uses the same boundary.

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
  Reason}|null }`. Contract (plan-QA round 1): in the scheduling modes `Analysis` is ALWAYS a valid
  model-shaped `GptReminderResponse` — an early exit returns the same ignore-shaped object the
  pipeline returns today at :370-371 — so `#TryScheduleRemindersAsync` keeps dereferencing
  `.recommendation`/`.reminders` unchanged; in the completion modes `Analysis` is `null` and
  `Completion` is set.
- `EXCLUSIONS`: a frozen, ordered table `[{ Id, Reason, Modes, Pattern }]` of the deterministic
  pre-model exclusions (`Id` unique; `Pattern` the one `RegExp` the entry tests with; see Guard).
  `JudgeReminderTextAsync` iterates this table (it is the implementation, not a mirror of it), so an
  exclusion that is not in the table cannot run. Seeded with `quoted_only` (`auto`) and `opt_out`
  (`auto`). Corpus rows name the deciding entry in `Expect.Exclusion`.
- Sync helpers for the callers that need one judgement before the full one runs: `OwnWords(text)`
  (quote-strip honoring the kill switch), `IsCreationOptOut(text)` (applies chat-module's lower-case /
  curly-quote / apostrophe normalization itself, so chat and the pipeline agree),
  `IsPeriodOnlyTrigger(trigger)`, `DetectDirectAskWithTimeTrigger(text)` (keeps its own quote-strip,
  unchanged helper behavior), `HasRequestLanguage(text)`, `REASONS` (frozen list of every reason
  token the module can emit), `FORCE_FALLBACK_TRIGGER = 'tomorrow morning'` (the one home of
  3c267cd's literal; the result does not carry it — one consumed contract, the exported constant).

Gate order inside `JudgeReminderTextAsync`:

1. completion modes (`mention`/`strict`) take the RAW reply text, exactly as today — no quote-strip,
   no opt-out (plan-QA F3: quote-stripping a completion reply would flip `done "not done"` and
   `"done"`; that is a behavior change nobody asked for). `DetectCompletionReply(text, Mode,
   { RequestGuard: HasRequestLanguage })`: the detector accepts an injected request guard and applies
   it at the same position as today (after the question checks, before negation/future), so every
   reason token is byte-identical, including `contains_request` for `done, remind me tomorrow` and
   for `snooze this` in strict mode. The regex itself lives only in `reminder-judgement.js`. Return
   `complete` / `completion:<reason>` or `ignore` / `not_completion:<reason>`.
2. scheduling modes, `auto` only: `EXCLUSIONS` in order — `quoted_only` (own words empty → the
   today's ignore-shaped result, no model call) and `opt_out` (`ignore`, no model call). **Stated
   exception to equivalence:** today `auto` calls the model first and relies on the prompt's :72
   bullet for opt-out; after this change an explicit opt-out never reaches the model, so the model
   call/capture count for that phrasing drops from one to zero and a model `schedule` can no longer
   win. The corpus pins it with a would-schedule stub and `ModelCalled: false`. `force` skips both
   (the `KeepQuotedText` test at `quoted-text-reminders.test.js:111-113`; the human asserted it is a
   task).
3. scheduling modes: `DecideAsync(WorkspaceAI, DecisionSpec, ownWords, {Capture, Logger})` on own
   words (`auto`) or the whole message (`force`) — unchanged spec, prompt and validator.
4. model `ignore` → direct-ask fallback (`DetectDirectAskWithTimeTrigger`, which keeps its own
   quote-strip and negation regex in both modes, exactly as the helper behaves today at :733) →
   `schedule` / `direct_ask_fallback`, else `ignore` / `model_ignore`.
5. `Triggers` = each candidate's `scheduling_trigger` classified by `IsPeriodOnlyTrigger`.

### Corpus: `data/static/ai/reminder-judgement-corpus.json`

Rows `{ Id, Issue, Text, Mode, Model, Expect, Date? }` where `Model` is what the stubbed analyzer
returns (`null` = the model must not be called) and `Expect` holds `Verdict`, `Reason` (one token
that must be present), optional `ModelCalled`, `PeriodOnly` (per trigger), `OwnWords`. The optional
`Date` block (plan-QA F2) is `{ AnchorAgeHours, WasAdjustedForward }` (implementation note: the
anchor is built from one pinned `Now` read at the start of the row, the same way the GH-205 tests do,
instead of two literal ISO strings that would go stale): for such rows the corpus test also runs the real
`ExtractDateWithGptAsync` on the row's first trigger with the date extractor stubbed to `Anchor`, and
asserts `wasAdjustedForward` and that the result is not in the past — so the #205 row reproduces
"schedule with no past-time warning" end to end, and perturbing `reminders-ai-pipeline.js:969` fails
it. Date extraction itself stays outside the judgement owner.

Seeded with the four shipped cases plus the rows the sweep retires from unit tests: the six #201
request rows from `reminder-text-completion.test.js:62-67` (each in the mode that pins it), the
opt-out row (would-schedule stub, `ModelCalled: false`) and the `don't forget` non-opt-out row (the
`calendar event` case stays pinned at `tests/chat-module.test.js:86`; final-QA nit), the negated direct ask, and the force-mode quoted case.

`tests/reminder-judgement-corpus.test.js`: `test.each` over the rows, one entry point
(`JudgeReminderTextAsync`) with `WorkspaceAI.ProcessMessageWithJsonResponseAsync` stubbed per row from
`Model`. A row's expectation changing fails the test by construction.

Guard (in `tests/reminders-fsm-invariants.test.js`, existing suite; plan-QA F1 / F1-R2 — the guard
is bound to each exclusion's DEFINITION, not to its reason token):

- `EXCLUSIONS` entries are `{ Id, Reason, Modes, Pattern }` where `Id` is unique (asserted) and
  `Pattern` is the `RegExp` the entry tests with (`Test` is derived from it, so there is one
  definition per entry);
- the corpus file carries `Definitions: { [Id]: Pattern.toString() }` (source AND flags — plan-QA
  F1-R3: `.source` drops flags, so a flag-only widening such as adding `m` would slip). The invariant
  asserts, for every entry: the corpus `Definitions[Id]` exists and equals the live
  `Pattern.toString()`; and at least one
  corpus row has `Expect.Exclusion === Id` and a `Text` that `Pattern` matches (a real positive
  example). The reverse holds too: every `Definitions` key is a live entry;
- every `REASONS` token has at least one corpus row, and every corpus reason is a known token
  (`REASONS` is the table's reasons plus the fixed post-model tokens).

So: widening an entry's regex changes `Pattern.source` → the recorded definition no longer matches →
the invariant fails until the corpus is edited (and the review of that corpus edit sees whether a row
came with it). A second entry reusing a reason needs its own `Id`, its own definition and its own
matching row. A new entry without a row fails. Prompt-only exclusions are explicitly outside this
guard: the model is stubbed, so prompt semantics are not something the corpus test can verify — the
prompt's examples remain its own regression surface (stated scope boundary of the Guard task, not an
exemption from it). Negative controls C1-C3 are in the acceptance list.

### Call-site rewiring (one site per commit)

| Site | Change |
|---|---|
| `src/reminders-ai-pipeline.js:364-399` | `AnalyzeMessageForRemindersAsync(text, { Mode })` becomes a thin call to `JudgeReminderTextAsync` passing `this.#WorkspaceAI`, `ReminderAnalysisDecisionSpec`, capture and logger; returns `Judgement.Analysis`. `KeepQuotedText` option removed. `#BuildDeterministicFallbackReminder`, `DetectDirectAskWithTimeTrigger`, `IsPeriodOnlyTrigger` deleted from the pipeline. |
| `src/reminders-ai-pipeline.js:962-969` | `ReminderJudgement.IsPeriodOnlyTrigger(trigger)`; the `while` loop is replaced by one arithmetic step: after the existing +1 UTC day, if period-only and still past, add `Math.ceil((Now - Extracted) / 86400000)` further UTC days (plan-QA F4; same result as the loop, UTC has no DST). Observable results and `wasAdjustedForward` unchanged; GH-205 tests :610-666 kept as the oracle. |
| `src/reminders-module.js:1615` | `#TryCompleteRemindersFromReplyAsync` asks `JudgeReminderTextAsync(text, { Mode })` and proceeds only on `Verdict === 'complete'`; log line keeps `reason=` from `Completion.Reason`. The gates at :1539 (strict) and handler :700-702 (mention) keep their position. `reminders-module` no longer imports `DetectCompletionReply` (it keeps `ResolveThreadReminderIDsAsync`). |
| `src/reminders-module.js:1696` | discovery hint → `ReminderJudgement.DetectDirectAskWithTimeTrigger`. |
| `src/reminders-module.js:1815-1818` | `{ Mode: ArgForceSchedule ? 'force' : 'auto' }`. |
| `src/reminders-module.js:1850, 2007` | the `'tomorrow morning'` literal comes from `ReminderJudgement.FORCE_FALLBACK_TRIGGER`; the per-group retry at :2005-2007 itself stays. |
| `src/reminders-app-mention-handler.js:783` | `ReminderJudgement.OwnWords(text)` instead of a direct `IgnoreQuotedText` import. `SCHEDULING_TRIGGER_PATTERN` and the gate itself stay in the handler (many consumers; moving it is a rewrite). |
| `src/chat-module.js:1564` | `ReminderJudgement.IsCreationOptOut(NormalizedText)` (idempotent on already-normalized text). |
| `src/reminder-text-completion.js:86-87,129` | `REQUEST_PATTERN` removed; `DetectCompletionReply(text, mode, { RequestGuard })` applies the injected guard at the same position (:129). No other line of the detector changes. |

Tests re-pointed, not loosened: `reminders-ai-pipeline.test.js:662-665` →
`ReminderJudgement.IsPeriodOnlyTrigger`; `quoted-text-reminders.test.js:111-113` → `{ Mode: 'force' }`
and :127-128 → `ReminderJudgement.DetectDirectAskWithTimeTrigger`; all six request rows at
`reminder-text-completion.test.js:62-67` move to the corpus (they are the #201 class and the detector
no longer carries the guard on its own). Five existing source files change plus the new owner.

### Sweep result (each former regex has exactly one home)

- `IsCreationOptOut` regex: chat-module → reminder-judgement.
- `IsPeriodOnlyTrigger` regex: pipeline → reminder-judgement. The `while` loop at the date stage is
  retired for an arithmetic step with identical results (F4); the date stage consumes the judgement
  classifier instead of a pipeline-local regex.
- `IgnoreQuotedText`: three production call sites → one (`reminder-judgement` is the only `src`
  importer of `quoted-text`; the span regexes stay in `quoted-text.js`, their home); `KeepQuotedText`
  option → `Mode: 'force'`.
- `REQUEST_PATTERN`: reminder-text-completion → reminder-judgement (injected into the detector).
- Direct-ask + negation regex: pipeline → reminder-judgement.
- 3c267cd per-group fallback: kept at :2005-2007; its literal is the exported constant.

Single-home grep (acceptance): scope `src/`, exact patterns — `IsCreationOptOut`,
`IsPeriodOnlyTrigger`, `REQUEST_PATTERN|HasRequestLanguage`, `DetectDirectAskWithTimeTrigger`,
`require('./quoted-text')`, `'tomorrow morning'` — each defined in exactly one `src` file.

### Non-goals

No change to the prompt (`reminders-instructions.md`) — the examples stay; the corpus holds the
cases. No new LLM calls, no change to `ExtractDateWithGptAsync`'s contract, no change to
`SCHEDULING_TRIGGER_PATTERN`, no touching #149's original replay-nondeterminism / echo-threshold /
reaction-lookback tasks, no changes to thread-read code (#225 owns it), no new env flags.

### Preflight bet

- Outcome: every future false-positive class gets one corpus row and one code site, not a fifth regex.
- Smallest bet: consolidation + corpus. Not a rewrite of trigger detection or the prompt.
- Rejected alternative: another pre-filter in front of the model — that is the defect.
- Rollback: revert ALL the branch's rewiring commits (each includes its deletions and its test
  re-points), which restores the deleted code; the module, corpus and corpus test can then be kept
  or reverted independently (the FSM invariant imports the module, so "inert" means no production
  caller, not no importer). Undo class easy, no migration, no state.
- Blast radius: every reminder scheduling and text-completion path. Covered by the eight suites above
  plus the corpus; behavior is intended byte-identical for every pinned case.

### Operational envelope

A single Slack bot on one dev server, driven by one operator. Complexity commensurate: one module,
one JSON file, one test file, no framework, no enterprise fail-safes.

## Acceptance

- [x] Corpus test green with every row; red control A (flip one row's expected verdict) fails.
- [x] Red control B (F2): perturb `reminders-ai-pipeline.js` so a period-only trigger sets
      `wasAdjustedForward`; the #205 corpus row fails.
- [x] Red control C1 (F1): add an `EXCLUSIONS` entry with no corpus row; the FSM invariant fails.
- [x] Red control C2 (F1-R2/F1-R3): widen the `opt_out` pattern with an extra alternative, and
      separately add only a flag (`m`) to the `quoted_only` pattern, corpus untouched; the FSM
      invariant fails both times (definition mismatch).
- [x] Red control C3 (F1-R2): add a second entry with reason `opt_out` and a new `Id`, corpus
      untouched; the FSM invariant fails (no definition / no row for the new `Id`).
- [x] Every existing reminders suite green; full `npm test` green on the final commit (143 suites, 2615 tests, rc 0).
- [x] Single-home grep over `src/` for the six patterns above: one defining file each.
- [x] FSM invariant: every `EXCLUSIONS` entry and every `REASONS` token has a matching corpus row.
- [x] The date-stage `while` is gone and GH-205 tests :610-666 pass unchanged.
- [x] CHANGELOG entry in the two-paragraph format; `node scripts/validate-changelog-tone.js` exits 0.
- [x] `utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt` clean before every push.

## Rating and recurrence

2026-10-10 UTC RELEASES assessment: rated 80/65/50/35 (priority/severity/appeal/cheapness), no
override; row `rmi-01M4J8VBD1FK26YPZSFBFNT9GJ`, read back from the ledger. Recurrence is the
evidence: six member issues (#197 #201 #205 #211 #114 #149) and two repeat fixes on
`src/reminders-ai-pipeline.js` and `src/reminders-module.js` inside 14 days (commits 6e90bd8,
cf9fe6d, ebbcd47, 6584d6f), each symptom fix costing a cycle and not holding (churn score 19, radar
run 20261010T060531Z). Severity 65: scheduling false positives post reminders nobody asked for; a
completion false positive is worse — it transitions and deletes a reminder (`reminders-module.js:1654-1659`)
— which is why the completion gate is moved byte-identically. Cheapness 35: five existing source
files plus tests are touched, with the behavior pinned by eight existing suites. PDDA triage risk 3
(Costly), effort 4, complexity 4 — not express-eligible.

## Verification and QA

Plan QA (`marathon-system/gh149-plan-qa/RELAY.md`), round 1 (codex): VERDICT FAIL, four `[Should]`
findings plus path corrections. Adjudication:

| Finding | Decision | Change |
|---|---|---|
| Path corrections (1539 is strict/`#OnMessageAsync`; mention gate is handler :700-702; detection :1615; `IsReminderActionIntent` posts an explanation, not routing; six request rows :62-67; inline stub at quoted-text :95-97) | Accepted | Recon rewritten. |
| F1 token coverage is not exclusion coverage | Accepted, with the claim narrowed | `EXCLUSIONS` table is the implementation; invariant requires a matching positive row per entry; prompt-only and regex-widening are stated as outside the guard; red control C added. |
| F2 corpus cannot reproduce #205's warning | Accepted | `Date` block on the row; corpus test runs the real date stage with a stubbed past anchor; red control B added. |
| Contract: early exits must return ignore-shaped `Analysis`; fallback literal has two contracts | Accepted | `Analysis` always model-shaped in scheduling modes, `null` in completion modes; the literal is the exported constant only. |
| F3 completion rewiring not behavior-preserving (quote-strip, guard precedence, sixth row) | Accepted | Completion modes use raw text; guard injected into `DetectCompletionReply` at its current position; all six rows migrate. |
| 4(a) auto-mode opt-out is new behavior | Accepted | Stated as the one exception to equivalence; pinned by a would-schedule stub with `ModelCalled: false`; chat normalization reused. |
| 4(c) force and the direct-ask helper's quote-strip | Accepted | Helper keeps its own quote-strip in both modes; stated. |
| 5 rollback wording; grep scope | Accepted | Rollback = revert all rewiring commits; grep scoped to `src/` with named patterns. |
| F4 keep the `while` loop | Accepted | Arithmetic roll-forward with identical results; GH-205 tests are the oracle. |
| 7 "nothing is lost"; module count | Accepted | Corrected above. |

Nothing was rejected; no finding asked for machinery beyond the envelope.

Round 2 (codex): VERDICT FAIL, one `[Should]` (F1-R2) plus two stale references.

| Finding | Decision | Change |
|---|---|---|
| F1-R2 guard not bound to definitions; same-reason entry and regex widening slip through | Accepted | Entries carry a unique `Id` and one `Pattern`; the corpus records `Definitions[Id] = Pattern.source` and the invariant requires equality plus a matching positive row per `Id`; red controls C2/C3 added. Prompt-only exclusions stated as the guard's boundary, not an exemption. |
| Stale refs plan :112 (:1587 → :1539) and :123 (:61-66 → :62-67) | Accepted | Fixed. |
| Single-home grep must count definitions, not textual mentions; `Now` must be pinned in the date rows | Accepted | Already the stated scope; the corpus test pins `Now` with a fixed clock. |

Round 3 (codex, final round of the authorized cap): VERDICT FAIL on one residual `[Should]`.

| Finding | Decision | Change |
|---|---|---|
| F1-R3 `Pattern.source` drops flags, so a flag-only widening slips the guard | Accepted | Definitions record and compare `Pattern.toString()`; red control C2 extended with the flag-only case. |
| Doc shape: export bullet still showed the old entry shape; `Expect.Exclusion` not listed in the row overview | Accepted | Fixed. |

Outcome: the plan did not reach `STATUS: Approved` inside the 3-round cap (rounds 1-3 all FAIL, with
every finding accepted and the last one a two-token change). Per the operator rule (cap reached →
ask, do not start round 4) implementation was NOT started: no `--accepted-start`, no source changes.
Operator decision needed: accept the adjudicated plan as reviewed, or authorize one more round.

### Operator acceptance

2026-10-10 UTC: the operator accepted the adjudicated plan as reviewed (option a), after the 3-round
plan-QA cap, with every finding from rounds 1-3 Accepted and folded in (R3's sole residual, the
`Pattern.toString()` comparison, included). No fourth round. The relay thread's STATUS stays
`Escalated`; it was not rewritten to Approved and no reviewer attestation exists for this plan.
Implementation proceeds on this basis.

Ledger deviation: `roadmap update --accepted-start` was refused (`status-label-unsupported: schema009
required`); per the #225 precedent the row was moved with the legacy `--section "In progress"
--status-marker 🚧` instead.

Implementation evidence (2026-10-10 UTC): red controls run with temporary edits, each restored —
A flipped verdict, B `wasAdjustedForward = true` at the date stage, C1/C3 new same-reason entry,
C2 widened `opt_out` alternative, C2 flag-only `m` on `quoted_only`: each `1 failed`; restored tree
41/41. Focused suites green between every rewiring commit. One parity detail kept from today's code:
`quoted_only` fires only when quote-stripping removed something (an empty message without quotes
still reaches the model).

Final QA (`marathon-system/gh149-final-qa/RELAY.md`): round 1 codex `VERDICT: PASS`, STATUS Approved,
relay-drive attestation on reviewed head `327f026`. No Blocker/Should. One Nit (calendar-event row
promised by the seed paragraph but absent) — Accepted as a doc correction: the paragraph is narrowed;
the case remains pinned by `tests/chat-module.test.js:86` and the moved regex is unchanged.
