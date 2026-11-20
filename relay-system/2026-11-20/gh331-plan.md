# RELAY · GH-331/332 plan QA — GitHub auto-complete crash + closed-issue review skill
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
6. **Commit only the relay file** (`relay(gh331-plan): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/1-INBOX/GH-331-GITHUB-AUTOCOMPLETE-CRASH.md` (the plan). Source for the technical pass: `src/github-sync-module.js`, `src/github-comment-relay.js`, `src/reminders-module.js`, `src/app.js`, `tests/github-sync-module.test.js`, `skills/bulk-edit-reminders/SKILL.md`, `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`, `tests/bulk-edit-reminders.test.js`. Issues: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/331 and https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/332
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-20
- Definition of Done: plan QA before any code is written.

**Step 1 — paraphrase first (GH-1414).** Read ONLY the plan file first. Before opening any source file, write in your block: **What this proposes** (2–5 sentences), **How the existing system works, per this document** (2–5 sentences), and **What it's not** (short). Ground exclusions in the plan's sections; label inference. State your input boundary (plan only).

**Step 2 — source-backed assessment.** Then read the source paths above and answer:
1. Is the root-cause claim (circular require: reminders-module → github-comment-relay → github-sync-module → partial `{}`; app.js loads reminders-module first; tests load the sync module first) correct? Cite lines.
2. Is a call-time `require('./reminders-module')` at the single runtime site the smallest correct fix? Any other runtime use of the `RemindersModule` binding in `github-sync-module.js` that would also break?
3. Does the planned red test (isolateModules, reminders-module required first, RunNowAsync over one closed link) fail on the unchanged code for the intended reason and pass after the fix? What prevents an unfixed build from passing it?
4. Skill: does the finder plan avoid a second writer (all writes stay in bulk-edit-reminders)? Is "lookup failure → unknown, never closed" enforced and tested? Is the REST `repos/<o>/<r>/issues/<n>` call right for both issues and PRs (merged state)?
5. Are the ratings and recurrence claims grounded? Anything over- or under-built for the stated envelope?

Operational envelope: existing Node Slack app plus a local operator skill (single operator, private local files). Grade commensurate complexity and this repo's threat model; do not ask for daemons, new services or enterprise machinery.

Required output: graded findings with `file:line`; literal `swept file: yes|no`; exact `VERDICT: PASS|FAIL|PARKED`; `STATUS: Approved` only for PASS. Behaviour-change Blocker/Should requests need `Observed input:`, `Affected scope:`, `Falsifier:`. Do not edit any file except this relay file; scratch probes only under `.relay-scratch/` or `$TMPDIR`; do not run full suites.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
