# GH-258 — Reminder titles: name the topic for person objects and drop schedule wording

- Issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/258
- Branch: `feat/AEGIS-Sleuth-Slackbot-gh258-reminder-title-topic-2026-10-20` off `origin/development` 50fa08c
- Rating: rated 55/30/45/75 (value/risk/effort/confidence), provisional until the clone run — prompt + remove-only text rule on the GH-250 contract plus one bounded context addition; user-visible on every reminder title.

## Status

| Step | State |
|---|---|
| Capture + plan | done |
| Plan QA (Codex relay) | Approved r5 (`PROJECT/RELAY/gh-258-plan-qa.md`, attest 3dfaa68) |
| Implementation | in progress |
| Tests / replay | pending |
| Final QA + PR | pending |

## Observed problem

A read-only re-extraction of open production reminders through the GH-250 path (#252) produced:

- `Reply to <person>` from "And please reply to <person> before our 1:45 call. Thanks!" — the
  topic exists in the thread, but the TITLE CONTRACT
  (`data/static/ai/reminders-instructions.md:90-96`) treats a person as a concrete object, so the
  model is never asked what the reply is about.
- Titles keeping schedule wording (`… tomorrow`, `… over the weekend`). The renderer already shows
  `· due <date>` (`src/reminders-display-utils.js` `BuildCompactReminderLine`), so it is said twice.
  The current golden tests even pin it (`tests/reminder-title-contract.test.js:21-40`, e.g.
  `Deploy the changes tomorrow morning`).
- `Check again on this tomorrow, pleae` — `COURTESY_WORD_PATTERN`
  (`src/reminder-title-contract.js:79`) matches only exact `please|pls|plz|kindly`.

## Requirements

1. Prompt (`reminders-instructions.md`, TITLE CONTRACT): when the title's object is a person (reply
   to / ask / email / call / ping / follow up with / tell / remind), append `re: <topic>` using
   words from the message or the earlier thread context; never invent a topic; omit `re:` when no
   topic exists. Add the deadline rule the manual prompt already has
   (`manual-reminder-task-instructions.md:18`): a due-date phrase (`tomorrow`, `by Friday`, `this
   morning`) goes in `scheduling_trigger`, not the title — but a duration or condition (`until
   Friday`, `until after the deploy`, `over the weekend`) is part of the task and stays. The manual
   prompt gets the `re: <topic>` line, and its existing blanket
   scheduling rule (`manual-reminder-task-instructions.md:18`) is reworded to the same
   due-date-vs-duration distinction (R1 r2).
2. Contract (`src/reminder-title-contract.js`, `NormalizeReminderTitle`), remove-only, step slug
   `schedule`, two positions (R2):
   - **Leading** due-date phrase stripped BEFORE the request-framing pass (step 4), so
     `Tomorrow I'll deploy the hotfix` -> `Deploy the hotfix` and `Tomorrow, can you review the
     logs?` -> `Review the logs`.
   - **Trailing** due-date phrase stripped AFTER framing: one or more of `today`, `tonight`,
     `tomorrow [morning|afternoon|evening|night]`, `this morning|afternoon|evening|week`,
     `[this|next|coming] <weekday> [part of day]`, `next week|month`, `EOD`, `EOW`,
     `end of (the) day|week`, clock times (`2pm`, `10:30 am`), `ASAP`.
   - **Admission rule (R1 r4, conservative; the duration veto wins):** if the title contains any
     duration/condition introducer anywhere (`until till thru through for over during within since
     from between after`), NO schedule phrase is stripped from it at either end, with or without a
     lead-in — ambiguous titles are kept whole. Only in a title with no introducer is a match
     stripped (with or without a deadline lead-in `by|before|on|at|due|no later than`). So
     `Keep staging online until at least Friday`, `… until the handoff at 2pm`, `… until the meeting
     on Friday`, `… through Friday` and `… over the weekend` survive intact; `Deploy the hotfix by
     Friday` -> `Deploy the hotfix`; `Deploy the release Friday` -> `Deploy the release`.
   - Revert the strip if it leaves fewer than 2 words.
   - Quoted spans stay protected (step 0 already masks them).
3. Courtesy: widen `COURTESY_WORD_PATTERN` and the validator's `courtesy` check to common
   misspellings (`pleae`, `plese`, `plase`, `pelase`, `plaese`, `pleaes`, `pleasee`, `plz+`, `pls+`).
4. Tests (existing suites only): update the pinned schedule-bearing expectations
   (`tests/reminder-title-contract.test.js:21-37`); add cases: `Deploy the hotfix by Friday` ->
   `Deploy the hotfix`; `Keep staging online until Friday` and `Hold the release until after
   today's deploy` unchanged; `Let rate limiting run over the weekend` unchanged; `Ship it after
   Friday` unchanged (duration veto); the two leading cases above through the real selector
   with an empty model candidate; `pleae` removed.
   Schedule: `Keep staging online through Friday`, `Keep staging online until this Friday` and
   `Keep staging online until at least Friday` and `Keep staging online until the handoff at 2pm`
   unchanged. Golden: add a person-topic sample grounded by existing analyzed context and an
   invented entity topic rejected by grounding. Re-record the replay baseline only for intended diffs.
5. CHANGELOG entry.

## Deferred

The thread-topic header/context-root work formerly proposed as Requirement 4 is deferred to #250
phase 5. It alters context assembly and fallback selection, exceeds this title-normalization slice,
and is not implemented or tested in this PR.

## Non-goals

- Re-applying titles to existing reminders (separate dry-run-first batch script).
- Changing which model the workspace uses.
- Client/channel prefix (render-time `ApplyClientPrefix`, operator config only).
- Any structured-output/schema change; `re:` is plain title text.

## Preflight bet

- Outcome: a reminder line says what to do and about what, once, with the date only in the date slot.
- Smallest bet: one prompt rule + one remove-only normalizer step + a regex widening.
- Rejected alternative: a post-hoc LLM rewrite of titles — adds a model call and can invent terms,
  breaking the GH-43/68 grounding guarantee.
- Rollback: revert the commit; no data or schema change. Existing stored titles are untouched.

## Risks

- Over-stripping a phrase that is part of the object (`Plan the Friday standup`). Mitigated: only
  trailing/leading positions, whole-title duration veto, golden set.
- `re:` lengthens titles past budget — `FitTitleToBudget` already shortens at clause boundaries;
  prompt asks for a short topic (2–5 words).
- Model ignores the new prompt line — measured by the real-model check with a red control.
- Existing context can lack a topic; the prompt must omit `re:` rather than invent one. The deferred
  #250 phase-5 context-root proposal is the follow-up for thread-openers outside the current
  lookback window.

## Verification

- Focused while iterating: `npx jest tests/reminder-title-contract.test.js tests/reminder-display-selection*.test.js`.
- `npm run decision:replay` (baseline diff reviewed) and `npm run validate:ai` (both edited prompt assets).
- Final gate once: `npm test`, `npm run build`, `npm run validate:fsm`, sanitize-scan (CI parity).
- **Real-model checks (R3)** — a throwaway driver (not committed) running the real
  `ResolveContextAsync` on a stub thread + real `RemindersAIPipeline` + selector on the dev server's
  real model, for BOTH prompt assets (automatic + manual), using only existing context behavior:
  - Topic present: existing analyzed context names `vendor security review`, then live `And please
    reply to Dana before our call. Thanks!` -> one task, title contains `Dana` and `vendor security review`.
  - Topic absent: same live reply with no topic-bearing existing context -> title has no `re:`.
  - Prompt red control: identical enriched input, ONLY the new `re:` instruction removed, per
    asset; record whether the topic disappears. If it does not, report the prompt line as
    insensitive in the receipt rather than claiming it.
- Smoke: one existing-context topic sample and one no-topic sample on the dev server only. Receipts
  under `TESTS-RESULTS/2026-10-20+GH-258/`.

## Merge evidence

- PR #266 merged 2026-10-22 — linked issue still OPEN; doc stays active by design (GH-202: promotion requires the issue to be closed).
