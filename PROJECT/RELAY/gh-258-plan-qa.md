# RELAY · GH-258 plan QA — reminder title topic + schedule-wording strip
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Reviewer
STATUS: Open
ROUND: 1 / 3

## ▶ TAKE YOUR TURN — read this first (works for ANY agent: Claude, Codex, agy)
1. **Read this whole file** (header, Setup, Ground rules, every block in the Log).
2. **Check it's your turn:** `NEXT` (top) names the role to act. Confirm you are bound to it and the
   last Log block isn't already yours. If not → STOP and reply "wrong window — nudge the <other> window."
3. **Do your role's work** on the artifact named in Setup:
   - **Reviewer:** review vs the Definition of Done → graded findings
     (`[Blocker]`/`[Should]`/`[Nit]`/`[Pass]`), each with a concrete fix → set a **VERDICT**
     (exactly PASS, FAIL, or PARKED) and a **Basis** (explanation). **Review the whole file, not just the diff** (GH-268):
     a beta test had this loop reach `Approved` in two rounds while an independent audit of the same
     branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the
     change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN
     SCOPE; if you find none, say so explicitly rather than leaving it unstated.
     **Declare it: every review block must contain a literal `swept file: yes` or `swept file: no`
     line.** Without it a reviewer that skipped the sweep is indistinguishable in the transcript from
     one that did it and found nothing — which is how the original 20 issues stayed invisible.
     Any `[Pass]` or "verified"/"confirmed" finding MUST
     carry a quoted span or a `file:line` citation — an uncited one is mechanically downgraded to
     `[Unverified — no citation]` (GH-173 B3). Do **not** edit the artifact; only append findings here.
     **A finding that asks for a behaviour change is a generalization unless you can paste the concrete
     input — a row, a value, a `file:line` — that fails under the current code** (GH-681: the gh673
     final QA relay generalized one late-error observation into "or a later invalid identity", the
     Producer implemented it, the same seat `[Pass]`ed it next round, and one historical NULL-URL
     ledger row then blanked every issue). Every `[Blocker]` or `[Should]` requesting a behaviour
     change MUST carry three lines: `Observed input:` (the failing input you saw), `Affected scope:`
     (the input predicate the change would govern), `Falsifier:` (the fixture or data that would show
     the change unnecessary or wrong, and its expected result).
     A `[Blocker]` must cite an observed failure. This is a protocol rule, not a mechanical check —
     the Producer may disposition a request lacking these as `Declined — unproven generalization`.
   - **Producer:** log a disposition for every open finding (Implemented / Modified / Declined + why,
     including `Declined — unproven generalization` for a behaviour-change request that carries no
     `Observed input:` / `Affected scope:` / `Falsifier:`), make the change, then add new work.
4. **Append ONE block** at the very bottom, directly **above** the marker line. Never edit earlier turns.
   Reviewer headings may be `### Reviewer · Round N`, `### Round N · Reviewer · <agent>`, `### Reviewer (<agent>)` (optionally followed by `— rN`), or `### Reviewer — Round N` (optionally followed by `(<agent>)`); follow the heading with a non-empty review body.
5. **Update the header:** flip `NEXT`; set `STATUS` (`Approved` closes — Reviewer only; else `Open`);
   the Producer bumps `ROUND` when opening a new cycle. If the max `ROUND` ends without `Approved`,
   set `STATUS: Escalated`.
6. **Commit only the relay file** (`relay(gh-258-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/2-WORKING/GH-258-REMINDER-TITLE-TOPIC.md` (the plan). Source paths
  it relies on, read them: `src/reminder-title-contract.js` (whole file; `NormalizeReminderTitle`,
  `COURTESY_WORD_PATTERN`, `NON_CONTENT_WORDS`), `src/reminder-display-selection.js`
  (`SelectTaskTextRaw`, grounding order), `data/static/ai/reminders-instructions.md` (TITLE CONTRACT,
  lines ~89-140), `data/static/ai/manual-reminder-task-instructions.md`,
  `tests/reminder-title-contract.test.js`, `tests/fixtures/reminder-title-golden.json`,
  `scripts/decision-replay.js` (`ReminderTitleContractViolations`), and
  `src/reminders-display-utils.js` (`BuildCompactReminderLine`, where `· due <date>` is rendered).
  Issue text: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/258 (transcribed in the plan).
- **Operational envelope:** a Slack bot's per-reminder title text. The change is one prompt rule, one
  remove-only normalizer step and a regex widening on the GH-250 contract. Grade against the stated
  requirements and commensurate complexity, NOT enterprise threat models. Challenge any machinery the
  plan adds that the requirements don't need as hard as anything it misses. Existing suites only
  (jest + decision replay); no new suites.
- Questions:
  1. Are the plan's claims grounded (pinned schedule-wording expectations, exact-only courtesy match,
     person-as-object passing the contract, due date already rendered)? Cite file:line for disputes.
  2. Does the schedule strip stay remove-only and keep the GH-43/68 grounding guarantee? Can it eat
     part of an object or a condition (`until after today's deploy`, `Plan the Friday standup`,
     quoted names)? Is the revert guard (min 2 words / dangling connector) sufficient and minimal?
  3. Does stripping `tomorrow`/weekday words interact badly with `NON_CONTENT_WORDS`,
     `HasConcreteObject`, the pointer check, or `BuildFallbackTitle`?
  4. Is the `re: <topic>` prompt rule precise enough to prevent invented topics, and consistent with
     the grounding verifier (`re:` terms must appear in the analyzed source incl. thread context)?
  5. Are the acceptance checks falsifiable (each new rule has a case that fails without it; the
     condition-kept and no-invented-topic paths are covered)? Is the rating 55/25/40/80 grounded?
- Output: graded findings with file:line citations, then VERDICT. Approve if no Blocker/Should remains.
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: the plan meets every GH-258 acceptance item, is grounded in the real paths,
  extends the GH-250 contract and prompt without a parallel path, keeps transforms remove-only, and
  has falsifiable verification with no unrequested machinery.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
