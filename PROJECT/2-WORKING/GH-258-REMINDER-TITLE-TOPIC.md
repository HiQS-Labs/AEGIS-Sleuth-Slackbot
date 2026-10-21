# GH-258 — Reminder titles: name the topic for person objects and drop schedule wording

- Issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/258
- Branch: `feat/AEGIS-Sleuth-Slackbot-gh258-reminder-title-topic-2026-10-20` off `origin/development` 50fa08c
- Rating: rated 55/25/40/80 (value/risk/effort/confidence) — small prompt + remove-only text rule on the GH-250 contract; user-visible on every reminder title.

## Status

| Step | State |
|---|---|
| Capture + plan | done |
| Plan QA (Codex relay) | pending |
| Implementation | pending |
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

1. Prompt: when the title's object is a person (reply to / ask / email / call / ping / follow up
   with / tell / remind), append `re: <topic>` using words from the message or the earlier thread
   context; never invent a topic; omit `re:` when no topic exists. Schedule wording (days, times,
   `tomorrow`, `by Friday`) never goes in `reminder_message`; it belongs in `scheduling_trigger`.
   Same lines in `manual-reminder-task-instructions.md` where it states the contract.
2. Contract (`src/reminder-title-contract.js`, `NormalizeReminderTitle`): new remove-only step
   `schedule` after request framing: strip one or more trailing schedule phrases (optional lead-in
   `by|before|on|at|until|for|due|no later than|over|this|next`) and a leading one. Revert the strip
   if it leaves fewer than 2 words or a dangling connector (`after`, `until`, `since`, `from`, `of`,
   `than`, `and`, `or`, `the`, `to`), so conditions like `until after today's deploy` survive.
   Quoted spans stay protected (already handled by step 0).
3. Courtesy: widen to common misspellings (`pleae`, `plese`, `plase`, `pelase`, `plaese`, `pleaes`,
   `pleasee`, `plz+`, `pls+`).
4. Tests: update the pinned expectations that kept schedule wording; add cases for each new rule
   incl. the condition-kept and dangling-connector reverts; extend the golden fixture with the
   person-topic and schedule samples (selector path, grounding unchanged); re-record the replay
   baseline only for intended diffs.
5. CHANGELOG entry.

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
  trailing/leading positions, connector-revert guard, golden set.
- `re:` lengthens titles past budget — `FitTitleToBudget` already shortens at clause boundaries;
  prompt asks for a short topic (2–5 words).
- Model ignores the new prompt line — measured in the A/B preview; deterministic parts still apply.

## Verification

- Focused: `npx jest tests/reminder-title-contract.test.js tests/reminder-display-selection*.test.js`.
- `npm run decision:replay` (baseline diff reviewed).
- Final gate once: `npm test`, `npm run build`, `npm run validate:fsm`, sanitize-scan (CI parity).
- Smoke: read-only prod preview script on the open reminders (main path) + a thread-reply sample
  with no topic (adjacent path: no invented `re:`); receipts under `TESTS-RESULTS/2026-10-20+GH-258/`.
