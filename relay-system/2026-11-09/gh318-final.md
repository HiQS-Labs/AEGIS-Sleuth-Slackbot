# RELAY · GH318 final QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-09.
-->

NEXT: Producer
STATUS: Approved
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
6. **Commit only the relay file** (`relay(gh318-final-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: **.relay-artifacts/GH-318-TITLE-GROUNDING.md** — the read-only path that
  `relay-drive.sh --artifact-file PROJECT/2-WORKING/GH-318-TITLE-GROUNDING.md` seeds into the isolated worktree (read it there; do NOT edit it).
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-09
- Definition of Done: _<fill in the acceptance criteria the Reviewer grades against>_

## Final review brief
Review the whole changed helper and its consumers, actual branch diff from origin/development, tests/task-grounding.test.js, tests/reminder-display-selection.test.js, plan and TESTS-RESULTS/2026-11-09+GH-318 receipts. This is final implementation QA for a small pure-function change, not a request for architecture expansion. Writes only this relay thread. No suite execution in reviewer worktree; read retained evidence and use narrow non-mutating probes only if necessary. No private Slack data access. State exact reviewed HEAD.

Questions:
1. Do the Compile opening and unquoted uppercase-acronym plural rules keep whole-token grounding while preserving quoted terms, Teams, invented names/identifiers/figures/dates and nonleading Compile?
2. Does the shared quoted-span regex retain quote provenance without introducing mutable cross-workspace state or divergent parsing? Is the implementation surgical and canonical?
3. Do synthetic red/green coverage and direct main/adjacent smoke substantiate the user-visible selected output?
4. Does sanitized branch-repeat evidence correctly distinguish retained-output0/6→6/6 from fresh54 comparisons (fallback4→0, repairs6→0), all54 request hashes/readback checks, with remaining admission variability and historical limitations?
5. Are gate claims truthful? Full local Jest is NOT green: existing thread-memory failure independently reproduced on baseline6c5576e; build/focused239/239/decision23/23/Node116/116 passed. PDDA observe mode is NOT clean docs. Do not expand into unrelated baseline repairs; assess code correctness separately from readiness, which remains contingent on hosted required checks.
6. Are public artifacts synthetic/aggregate only, with no private source examples, credential values or production writes? Is rollback simply reverting the helper change?

Give PASS/FAIL/PARKED with concrete file:line findings and swept-file declaration per protocol. Missing or failed tests must remain truthful; a PASS for implementation does not convert failed local qualification into green. No push, merge, deploy or production edits.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns. Plain blank separators may be added or removed between sections; preserve every substantive line, indentation, and fenced/literal blank line. A historical FAIL→PASS edit or changed fenced example is forbidden.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Producer · Round 2 preparation
The previous worker produced a concrete Should finding but containment exited6 and discarded its review-file edits; there is no accepted verdict/attestation. Retained transcript: relay-system/logs/2026-11-09/codex-turn-GH318-FINAL-50090.log. Disposition: Implemented. Raw quoted captures retained padding while ExtractGroundedTerms trims terms. QuotedTerms now trims identically. New straight/curly/single quote controls fail before and pass after; exact-source quoted and unquoted positives remain.

Containment preparation: remove this workflow's untracked node_modules symlink before the next review. Seed --artifact-file explicitly and supply the committed branch diff as read-only evidence. No harness edits or attempt-counter reset. Plan/final caps remain3 rounds. Code changed only by quote-capture trimming since the prior54-model-call run; fixed captured-response comparison will bind those results to corrected code without relabeling the original tested revision.

### Reviewer · Round 2
VERDICT: PASS
Basis: Ship with conditions. The bounded helper change is correct on the reviewed code and retained evidence; approval is implementation QA, not a declaration of green qualification or PR readiness. Final-code clone/hosted required gates remain outstanding.
swept file: yes

Reviewed HEAD: 75b5bb7fabffbb913bde338312f4cfe109820ddd (read directly from the isolated worktree's HEAD file; no git command). Read the entire seeded artifact, entire task-grounding.js, display-selection.js, title-contract.js and both named test files, plus relevant reminder-module consumer/repair paths and all six retained receipts. Reviewed the supplied origin/development comparison in TESTS-RESULTS/2026-11-09+GH-318/review-diff.patch; no independent git diff was run under this turn's prohibition. No additional actionable pre-existing defect found in the swept helper/selector/contract files; existing documented limits remain.

- [Pass] Surgical classification: src/task-grounding.js:85 adds only the bounded opening verb; :315 retains the opening-position check; :362 permits plural tolerance only for unquoted ASCII uppercase acronyms ending in lowercase s. :240 retains whole-source-token comparison. Teams, absent entities/identifiers/figures/dates and nonleading Compile still take existing checks. No new runtime owner, provider, workspace state or write path. Rollback is reverting this helper change (artifact, “no data migration or live write”).
- [Pass] Quote provenance correction: src/task-grounding.js:259, :283, :287 and :338 reuse one pattern; captured terms now trim exactly like extracted terms at :274. matchAll uses a cloned regex iterator, while replace resets the global regex cursor; no tenant data is retained. Four padded straight/curly single/double-quote cases reject URL→quoted URLs, but accept exact-source URLs (tests/task-grounding.test.js:281). Narrow non-mutating probe: command was an inline `node` script requiring `./src/task-grounding`, iterating 100 times over 15 [title,source,expected] rows: Compile reference URLs/reference URL list/true; Review APIs/the API/true; Review URLs/furl/false; Update Teams/team/false; Review Compile/reference list/false; Compile Acme URLs/reference URL/false; Compile 23 URLs Monday/reference URL/false; plus each of `" URLs "`, `“ URLs ”`, `' URLs '`, `‘ URLs ’` after Compile against reference URL/false and reference URLs/true. It counted any IsTitleGrounded mismatch and set exitCode accordingly. Exit 0; decisive stdout: `{"cases":15,"iterations":100,"failures":0}`. Environment: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; mkdir -p "$TMPDIR"`. No suite or executable fixture ran.
- [Pass] Consumer/output coverage: src/reminder-display-selection.js:291 rechecks normalized output; :431 applies the same helper to context. src/reminders-module.js:2754 and :2797 delegate to these selectors; :2908 and :2931 use the selector before/after bounded repair. tests/reminder-display-selection.test.js:346 covers retained title and absent Acme/context controls, with padded-quote rejection at :376. Retained smoke.jsonl reports exact useful title with source=title and adjacent Acme source=fallback/refused=[Acme]. verification.md:6 records five red witnesses; :25 attributes corrected focused247/247 to bb7b1f1, rather than relabeling older runs.
- [Pass] Evidence claims stay separated: verification.md:15 and aggregate-comparison.json report fixed-output0/6→6/6 separately from fresh54 fallback4→0/repair6→0, request matches54/54 and disk readback54/54. verification.md:25 reports 50 unchanged corrected-code selections with zero additional calls. These are retained aggregate receipts, not independently inspected private provider inputs. The stated admission variability, excluded historical case and absent live ingress/Lists/delivery coverage remain material limits; no model winner inferred.
- [Unverified — needs clone run] Final qualification remains conditional. verification.md:11 records build/focused239/decision23/Node116 success on835f6ca and full Jest failure3080 passed/1 failed, independently reproduced at baseline6c5576e. :13 explicitly describes PDDA observe findings, not clean docs; :22 and :25 leave hosted/final-code full gates pending. This PASS does not override those failed/pending checks. Run required gates in the disposable clone through the harness; do not repair unrelated baseline behavior in this change.
- [Unverified — no citation] Reviewed public payloads contain synthetic examples/aggregate receipts only: artifact “All real evaluation data stays private,” aggregate-comparison.json limitations and smoke.jsonl's synthetic Compile/Acme pair. No credential values or private source transcripts encountered; no private Slack access, production writes, push, merge or deploy performed.

Relay closed (Approved), no further turn needed. Harness owns the file-scoped commit and subsequent qualification gates.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
