# RELAY · GH-55 recipient-reference plan QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-12.
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
4. **Append ONE block** at the very bottom, directly **above** the marker line. Never edit earlier turns. Plain blank separators may be added or removed between sections; preserve every substantive line, indentation, and fenced/literal blank line. A historical FAIL→PASS edit or changed fenced example is forbidden.
   Reviewer headings may be `### Reviewer · Round N`, `### Round N · Reviewer · <agent>`, `### Reviewer (<agent>)` (optionally followed by `— rN`), or `### Reviewer — Round N` (optionally followed by `(<agent>)`); follow the heading with a non-empty review body.
5. **Update the header:** flip `NEXT`; set `STATUS` (`Approved` closes — Reviewer only; else `Open`);
   the Producer bumps `ROUND` when opening a new cycle. If the max `ROUND` ends without `Approved`,
   set `STATUS: Escalated`.
6. **Commit only the relay file** (`relay(gh55-recipient-plan): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md`, specifically the 2026-11-12 follow-up. Historical sections are context, not claimed newly delivered.
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-12
- Definition of Done: the follow-up plan addresses the observed recipient/context and affirmative-normalization gaps using existing owners, with falsifiable main and adjacent paths, proportional regressions, unchanged date/owner/write contracts, rollback and private/public separation.

### Required review order and questions

First read only the plan document. Before reading source or supplementary requirements, append 2–5 sentences under **What this proposes** and **How the existing system works, per this document**, plus **What it's not**. Record the input boundary as plan-only, label inference/missing boundaries. Then perform a separately labeled source-backed assessment in this same turn.

Operational envelope: bounded improvement to an existing Node/Slack reminder pipeline. No production writes, server harnesses, model/provider changes, new inference subsystem or enterprise machinery. Challenge extra complexity. The request is better titles from adjacent contextual commitments, with tomorrow as notification deadline and the effective month retained. New regression cases in existing Jest suites are allowed in this repo. Do not edit runtime code, plan, tests or ledger; write only this relay file. Do not run suites or install dependencies in the review worktree. Narrow read-only pure-helper probes are allowed under the harness scratch rules. No subagents, provider calls, push, merge or deployment.

1. Does the production telemetry plus baseline receipt support both root causes? Confirm exact callers and guards in the current source.
2. Is adding object-position `them` with a this/that-only temporal exclusion sufficient and bounded? Does conditional affirmative stripping preserve names and expose the existing person-pointer refusal/one-repair path?
3. Does the plan preserve live ownership, tomorrow extraction, effective-month content, grounding, person-versus-thing distinction, thread limits/kill switches and common persistence/rendering?
4. What prevents unchanged code from being declared delivered? Assess red baseline, mutation controls, both rendered/stored outputs, and separation of mocked plumbing from actual-model quality. Is test scope commensurate?
5. Are rating 75/55/50/80, unknown incident trend, legacy gid limitation and historical GH55 milestone honest? Is any requirement missing or scope unjustifiably widened?

Source-backed reads: src/reminder-context-resolution.js, src/reminders-app-mention-handler.js enrichment method, src/reminder-title-contract.js, src/reminder-display-selection.js, src/reminders-module.js scheduler/repair, existing referenced test seams. Baseline receipt: TESTS-RESULTS/2026-11-12+GH-55/baseline-probe.json. Grade concrete findings with citations and falsifiers; preserve original severity. Declare swept file yes/no. Set exact VERDICT PASS/FAIL/PARKED; only PASS may set STATUS Approved. Commit relay file only and stop.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns. Plain blank separators may be added or removed between sections; preserve every substantive line, indentation, and fenced/literal blank line. A historical FAIL→PASS edit or changed fenced example is forbidden.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
