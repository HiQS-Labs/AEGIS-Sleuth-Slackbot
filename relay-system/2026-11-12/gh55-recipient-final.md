# RELAY · GH-55 final scoped recipient fix QA
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
6. **Commit only the relay file** (`relay(gh55-recipient-final): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact: final task diff against integration base `7e9e58f1ec79abe92453fa96724734745e9fb4ac`; canonical plan `PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md` (latest retained implementation section supersedes proposed prompt amendment).
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-12
- Definition of Done: bounded recipient-context/title improvement reviewed for a development PR; not production delivery or full GH55 closure. Full repository gate runs once AFTER this review, so it is explicitly pending, never claimed passed.

Operational envelope: existing Node/Slack pipeline; three existing product helpers changed (them context admission + temporal-demonstrative specificity; conditional affirmative framing; one leading Inform exemption). Optional real replay grading field plus existing suite cases/fixtures. No prompt, provider, server, schema, persisted-writer or new pipeline-stage change. Proposed prompt wording was measured, showed no observed benefit in small Luna ablation, then removed. Preserve evidence limits; grade commensurate complexity, not speculative rewrite requirements.

Read `TESTS-RESULTS/2026-11-12+GH-55/verification.md`, canonical plan, diff against base, and WHOLE changed product helper files. Source-backed reads also include utils/reminder-replay.js and changed tests; trace existing scheduler/repair as needed. The same-provider local model replay used genuine WorkspaceAI/provider calls with a TEMPORARY existing-setter override selecting Luna in the throwaway test workspace. Dates stayed gpt-4o, not production-observed Sonnet. Runtime prompt SHA equals integration base. No mock model responses in that replay. Exact original private incident/Slack transport/production date-provider coverage are not claimed.

Questions:
1. Are the observed failure origins actually addressed without a parallel subsystem or unrelated change? Sweep each changed file; flag relevant pre-existing defects with concrete input/falsifier, avoid hypothetical widening.
2. Do date/owner/FSM/source, bounded context/kill switches, person-versus-thing safety, quoted names and grounding still hold? Affirmative removal only when existing framing recognizes the remainder. Inform is exempt only as leading verb, not quoted/body/date/entity bypass.
3. What stops unchanged code being declared delivered? Cite observed pre-fix/mutation failures and whether targeted checks measure actual output. Main/adjacent synthetic integration verifies both confirmation and persisted wording/owner/date/state/provenance. All 532 focused checks pass; 12 new Jest cases are in existing suites. Existing real default-model failure is NOT a green result.
4. Does the retained local Luna 3/3 output demonstrate bounded useful communication subject/effective month with tomorrow deadline and safe missing-context fallback? Recipient may remain `them` where identity is implicit; do not claim exact expected wording or universal resolution. Older default gpt-4o-mini can still omit effective month. Assess scoped readiness given these honest limitations; leave broader GH55 and historical rollout open.
5. Is optional anchored taskStartsWithAny proportional, and are grader positive/fallback/wrong-action/empty controls valid? No new runner/framework. Tests/probes are not statistical model ranking.
6. Are changelog, plan, persisted 75/55/50/80 rating, privacy and final qualification-pending state truthful? No package version bump. Review prior plan QA receipts; final review is independent, not self-attested.

Write ONLY this relay file. No source/plan/test/ledger edits, installs, suites, API/model calls, production, subagents, push or merge. Narrow read-only pure probes allowed in harness scratch only. Quote decisive evidence/citations; Should/Blocker requests need observed input, affected scope and falsifier. Declare swept file yes/no, exact VERDICT PASS/FAIL/PARKED, and Approved only for PASS. Commit only relay file, stop and hand off.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns. Plain blank separators may be added or removed between sections; preserve every substantive line, indentation, and fenced/literal blank line. A historical FAIL→PASS edit or changed fenced example is forbidden.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
