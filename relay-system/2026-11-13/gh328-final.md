# RELAY · GH-328 final QA — client name outside reminder link
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-13.
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
6. **Commit only the relay file** (`relay(gh328-final): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: the task branch diff against integration base `f1edf4947c857a276ee927a86f87b8f70ff8a12d` (`git diff f1edf49..HEAD`). Product: `src/reminders-display-utils.js` (`BuildCompactReminderLine`, `BuildCompactTextForReminder`). Tests: `tests/reminders-display-utils.test.js`. Plan: `PROJECT/2-WORKING/GH-328-CLIENT-PREFIX-OUTSIDE-LINK.md`. Evidence: `TESTS-RESULTS/2026-11-13+GH-328/verification.md`, `TESTS-RESULTS/2026-11-13+GH-328/smoke.js`, `TESTS-RESULTS/2026-11-13+GH-328/smoke-output.txt`. Also `CHANGELOG.md` (1.4.353 entry) and the ledger/dashboard rows for GH-328. Issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/328
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-13
- Definition of Done: final QA for a development PR. Requirement (operator, from a production screenshot): reminder list lines rendered as `C.) <permalink|Client A - Task> · …`; the client/project name must not be part of the hyperlinked task. Chosen reading: keep the GH-395 client label visible, as plain text before the link: `C.) Client A - <permalink|Task> · …`.

Operational envelope: existing Node/Slack render path; one pure line builder gains an optional `ClientName` part and its one live caller passes the label there instead of folding it into the summary. No change to client resolution, `ApplyClientPrefix`, stored text, confirmation bullets, extra Key-task bullets or the rebalance export (`src/web-api.js` builds export summaries without a client prefix; `src/chat-commands/show-rebalance-reminders-command.js` calls the builder without `ClientName`). Grade commensurate complexity; do not ask for new subsystems. Plan QA was skipped as a simple change (reason recorded in the plan). The full repository gate runs locally once on the final commit and is recorded in `TESTS-RESULTS/2026-11-13+GH-328/full-gate.log` when present; treat it as pending if absent.

Questions:
1. Does the diff produce `Label.) Client - <permalink|task>` for a mapped client and leave the unmapped line byte-identical? Cite code and tests.
2. Is the decision to pass `ClientName` only when `ApplyClientPrefix` would have added it correct for a stored title already led by the client name (no doubling, left as written)? Any input where the label is now lost or doubled?
3. The Slack-token branch (`summary ↗︎`): is the client label placement right there?
4. What prevents the unchanged code from passing? Inspect the recorded red result and the new assertions; is any assertion unable to fail for the intended reason?
5. Any other caller of `BuildCompactReminderLine` or consumer of the old prefixed `summary` variable that this changes unintentionally (multi-task bullets, annotations)?
6. Pre-existing defects in the touched functions, in scope.

Required output: graded findings with `file:line`; literal `swept file: yes|no`; exact `VERDICT: PASS|FAIL|PARKED`; `STATUS: Approved` only for PASS. Behaviour-change Blocker/Should requests need `Observed input:`, `Affected scope:`, `Falsifier:`. Do not edit product files; scratch probes only under `.relay-scratch/` or `$TMPDIR`; do not run full suites.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
