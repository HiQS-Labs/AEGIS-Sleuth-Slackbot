# RELAY · GH-55 evidence-driven plan amendment QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-12.
-->

NEXT: Reviewer
STATUS: Open
ROUND: 2 / 3

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
6. **Commit only the relay file** (`relay(gh55-recipient-amendment): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md`, especially **Plan amendment after real-model evidence**. This is round 2 of the same three-round plan budget; round 1 passed, then actual model evidence required this bounded amendment. No attempt counters reset.
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-12
- Definition of Done: assess the bounded amendment before it is implemented. Existing two-helper implementation is not yet a completed fix. No provider change, production access or new pipeline layer.

First read ONLY the plan and write **What this proposes**, **How the existing system works, per this document** (2–5 sentences each), **What it's not**, and input-boundary/inference notes BEFORE reading source. Then label the same turn's technical validation **Source-backed assessment**.

Specific questions:
1. Does the real diagnostic receipt demonstrate that the existing verifier rejects `Inform` and that the main scenario still fails despite context arriving? Confirm with pure grounding probe and existing shared writer paths. No suites/provider calls.
2. Is adding only `inform` to the bounded imperative allowlist, with refusal controls, proportional? Preserve quoted/non-leading names, dates/numbers and all entity checks.
3. Is one concise communication/effective-period clarification in existing analyzer and repair prompts sufficient in scope? No admission, schema, provider or scheduling changes. Main title must retain communication action and subject/effective period; tomorrow is scheduling deadline.
4. Is optional `taskStartsWithAny` in the existing replay grader a sound measurement for accepted communication paraphrases? Its unchanged generic fallback and plain `Downgrade` must fail, missing output cannot pass vacuously. No dedicated suite exists for this runner; manual pure-function controls and mutation receipt suffice without a new runner/framework.
5. Is mocked versus actual-model evidence, default test model versus production's mixed models, rating and historical GH55 still-open status honest? Do not demand an unrequested rewrite or wider audit.

Read after comprehension: TESTS-RESULTS/2026-11-12+GH-55/real-replay-diagnostic.log, src/task-grounding.js (whole file), current two helper diffs, current analyzer and repair instructions, utils/reminder-replay.js and existing test seams. Existing receipts describe failures as failures. Proposed amendment files are unchanged at review time.

Write ONLY this relay file; no implementation/plan/test changes, installs, provider calls, new agents, push or production actions. Use narrow read-only probes only under harness scratch rules, not suites. Grade concrete findings with citations, observed input/scope/falsifier for Should/Blocker. Declare swept file yes/no. Exact VERDICT PASS/FAIL/PARKED and Approve only when PASS. Commit only relay file, then stop.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns. Plain blank separators may be added or removed between sections; preserve every substantive line, indentation, and fenced/literal blank line. A historical FAIL→PASS edit or changed fenced example is forbidden.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
