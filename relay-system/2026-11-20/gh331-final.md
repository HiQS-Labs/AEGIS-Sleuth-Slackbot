# RELAY · GH-331/332 final QA — auto-complete crash fix + retire-closed-issue-reminders skill
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-20.
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
6. **Commit only the relay file** (`relay(gh331-final): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: the task branch diff against `6325509d1421e5ac21af69aee3762564be6763ae` (`git diff 6325509..HEAD`). Product: `src/github-sync-module.js`, `skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs`, `skills/retire-closed-issue-reminders/SKILL.md`. Tests: `tests/github-sync-module.test.js`, `tests/retire-closed-issue-reminders.test.js`. Plan: `PROJECT/2-WORKING/GH-331-GITHUB-AUTOCOMPLETE-CRASH.md` (plan QA: `relay-system/2026-11-20/gh331-plan.md`). Evidence: `TESTS-RESULTS/2026-11-20+GH-331/verification.md`, `TESTS-RESULTS/2026-11-20+GH-331/gh331-production-order-probe.js`. Also `CHANGELOG.md` (1.4.354).
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-20
- Definition of Done: final QA for a development PR covering two tracked issues.

Per-issue acceptance map (from the approved plan):
- **#331** (https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/331): poll cycle no longer throws `GetReminderVersion is not a function` in production load order; the new test fails on the unchanged code for that reason and passes after; completion rule, version guard and notifications unchanged.
- **#332** (https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/332): read-only finder (no Sleuth writes, `gh api` REST only) classifies all-closed/mixed/unknown/open/none; a failed lookup is `unknown`, never closed (tested, with a recorded mutation control); review file mode 600; empty and malformed input handled; SKILL.md workflow retires only through `bulk-edit-reminders --complete` after review, with dry-run and before/after verification.

Questions:
1. Does the code match the plan? Any duplicate subsystem or second writer?
2. #331: is the call-time require correct and sufficient? Does the new test construct the sync class inside `isolateModules` and avoid mocking the reminders export, so it cannot pass on unfixed code?
3. #332: any input where a reminder is shown as `all-closed` while one of its links is unreadable, or where a link is missed (e.g. a `pull/` URL, a repo name with dots, duplicates across `GitHubUrls` and text)? Is the output safe for private data (mode 600, nothing written outside the backup's folder, no Sleuth call)?
4. Do the receipts substantiate the claims (red/green, probe on fixed vs unfixed, smoke aggregates against the manual run)? The full gate is recorded in `TESTS-RESULTS/2026-11-20+GH-331/full-gate.log`.
5. Are the persisted ratings (80/70/50/90, 45/20/50/75) still consistent with the evidence?
6. Pre-existing defects in the touched functions, in scope.

Operational envelope: existing Node Slack app plus a local single-operator skill with private local files. Grade commensurate complexity and this repo's threat model; do not ask for daemons, services or enterprise machinery.

Required output: graded findings with `file:line`; literal `swept file: yes|no`; exact `VERDICT: PASS|FAIL|PARKED`; `STATUS: Approved` only for PASS. Behaviour-change Blocker/Should requests need `Observed input:`, `Affected scope:`, `Falsifier:`. Edit only this relay file; scratch probes only under `.relay-scratch/` or `$TMPDIR`; do not run full suites.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
