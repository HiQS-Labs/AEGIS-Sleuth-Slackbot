---
gh_issue: 149
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/149
title: "GH-149: One owner for reminder intent judgement (whack-a-mole addendum 2026-10-10)"
status: Proposed (1-INBOX — not yet active)
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

Scope: the "Additional remediation tasks" in the 2026-10-10 whack-a-mole addendum on #149 only. The
umbrella's original replay-nondeterminism, echo-threshold and reaction-lookback items are NOT in scope
and stay open on the issue.

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

## Rating and recurrence

2026-10-10 UTC RELEASES assessment: rated 80/65/50/35 (priority/severity/appeal/cheapness), no
override. Recurrence is the evidence: six member issues (#197 #201 #205 #211 #114 #149) and two
repeat fixes on `src/reminders-ai-pipeline.js` and `src/reminders-module.js` inside 14 days
(commits 6e90bd8, cf9fe6d, ebbcd47, 6584d6f), each symptom fix costing a cycle and not holding
(churn score 19, radar run 20261010T060531Z). Severity 65: false positives post reminders nobody
asked for, but nothing is lost. Cheapness 35: four modules plus the prompt are touched, with the
behavior pinned by eight existing suites. PDDA triage risk 3 (Costly), effort 4, complexity 4 — not
express-eligible.
