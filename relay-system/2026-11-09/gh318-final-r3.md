# RELAY · GH318 final review round3
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-09.
-->

NEXT: Producer
STATUS: Approved
ROUND: 3 / 3

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
6. **Commit only the relay file** (`relay(gh318-final-review-round3): <role> r<N>`); no push. **Stop** and report one line.
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

## Round3 review packet
This is the third and final implementation review round under the existing three-round budget. Prior rounds are in gh318-final.md: round1 discarded by containment but exposed padded quotes; round2 accepted Approved. Do not alter or supersede those historical verdicts. Actual Greptile P2 r4515362920 demonstrates the intended two-letter acronym class was incomplete: Review PRs against review the PR was rejected. Producer reproduced6 red tests and fixed only the existing suffix matcher floor for uppercase two-letter acronym + lowercase plural s. ArgAllowPlural and quoted-term provenance still gate it. Current focused254/254 green; all50 captured candidate/context selections unchanged without API calls. No model/prompt/admission/production changes.

Read the entire helper, existing callers/tests, plan, retained prior QA and verification receipt. Read TESTS-RESULTS/2026-11-09+GH-318/short-acronym-review-diff.patch for the incremental diff against previously published bdbc87f. Review-only writes to this thread. No suites, executable fixtures, private data, production/network calls, push, merge or deploy. Pure narrow probes may write scratch only. Do not create node_modules; pure helper/selector works without it.

Questions:
1. Do supported PRs/IDs/DBs now retain grounded selected titles, while invented short acronyms, ordinary short words, Teams, AWS, numbers/dates/quoted and padded quoted acronyms remain checked?
2. Is the matcher reused without changing exported IsTermGrounded call contracts or broadening ordinary-word inflection? Does the ArgAllowPlural=false path remain exact?
3. Are the synthetic red/green and retained50-response checks sufficient for this narrow correction, with final-code full qualification and hosted checks explicitly still pending?
4. Are all prior54 real-model-call metrics still attributed to their actual code revision, rather than claiming a new API run? No general model winner or production change claimed.

Grade against the small intended class, not speculative new architecture or expanded lexicons. Cite concrete failing inputs for Should/Blocker, actual SHA and swept-file declaration. Full local Jest baseline failure remains known; do not expand into fixing unrelated behavior. A code PASS does not mark failed/pending gates green. No attempt-counter reset, new review budget or fourth round is authorized. Return PASS/FAIL/PARKED and attestation via harness.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns. Plain blank separators may be added or removed between sections; preserve every substantive line, indentation, and fenced/literal blank line. A historical FAIL→PASS edit or changed fenced example is forbidden.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 3
VERDICT: PASS
Basis: Ship with conditions. The intended two-letter plural-acronym correction is surgical and supported by source inspection and narrow probes. This approves implementation QA only; final-code full qualification and exact-head hosted checks remain pending.
swept file: yes

Reviewed HEAD: 30dd58eb496010e2dd2d33e2b95628509e24e797 (read directly from worktree HEAD; no git command). Read the entire seeded artifact, helper, selector, title contract, both named test files, relevant reminder-module callers/repair paths, prior final-QA thread, incremental patch and retained verification receipts. No additional actionable pre-existing defect found in the swept helper/selector/contract files. Existing documented lowercase-entity and deterministic-normalization limits remain.

- [Pass] Matcher reuse and scope: src/task-grounding.js:240 selects the shorter floor only for literal uppercase two-letter stems plus lowercase s; :241 and :256 keep both suffix comparisons behind ArgAllowPlural. The exported IsTermGrounded signature remains unchanged. UngroundedTerms and IsBareProperNoun retain quote provenance and proper-name controls. The incremental patch changes no provider, prompt, admission, workspace owner or write path. Keep this bounded implementation.
- [Pass] Selected output and refusal controls: tests/reminder-display-selection.test.js:386 asserts exact Review PRs/IDs/DBs titles with source=title; tests/task-grounding.test.js:289 covers invented acronyms, padded quotes and exact-source positives. Existing controls retain Teams, AWS, figures/dates, nonleading Compile and substring refusals. The 52-check inline Node probe exited 0 with decisive output `{"checks":52,"failures":[]}`; it exercised all three stems through helper and selector, ArgAllowPlural=false positive/negative paths, four quote styles with padding, and adjacent Compile/URL/API/Teams/Gas/AWS/number/date/Acme controls. A second fully reproducible probe follows; exit 0, stdout `[["PR","title",false,false],["ID","title",false,false],["DB","title",false,false]]`.

```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node <<'NODE'
const G=require('./src/task-grounding'), S=require('./src/reminder-display-selection');
const rows=['PR','ID','DB'].map(x=>[x,S.SelectTaskText({reminder_message:'Review '+x+'s'},'review the '+x,true).source,G.IsTermGrounded(x+'s',G.GroundingTokens(x),false),G.IsTitleGrounded('Review " '+x+'s "','review '+x)]);
console.log(JSON.stringify(rows));
process.exitCode=rows.every(r=>r[1]==='title'&&r[2]===false&&r[3]===false)?0:1;
NODE
```

- [Pass] Consumer continuity: src/reminder-display-selection.js:291 rechecks normalized title grounding and :431 checks context with the same helper; src/reminders-module.js:2754/:2797 delegate to those selectors, and :2908/:2931 reuse selection before/after bounded model repair. No parallel matching subsystem or changed call contract is needed.
- [Unverified — no citation] Evidence attribution is truthful: verification.md, “Greptile two-letter acronym correction,” records “6 failed/248 passed” then “254/254,” and “All50 captured candidate/context selections remain identical ... 0 new model calls.” This is adequate focused evidence for this narrow correction, together with the direct probes. aggregate-comparison.json pins the historical 54 comparisons, fallback4→0 and repair6→0 to implementationCommit 835f6ca1105d1e324e1c6c58509aba9c3b1133bd; verification.md explicitly retains that attribution after later fixes. These are retained aggregate receipts, not independently remeasured private provider responses. No general model winner, new API run or production change is claimed.
- [Unverified — needs clone run] Final-code full gates and latest exact-head hosted status remain outstanding. verification.md ends “correction has fresh round3 QA pending and needs final-code qualification.” final-gates.json belongs to fa984388acbe8f1f545ea0d878d4d092152b055c, with final-full-test=1; the older hosted success is explicitly bound to 058e040363eca3304da04b4de9782a860be8f56d. Neither qualifies reviewed 30dd58e. Preserve the known baseline thread-memory failure and pending checks; harness must run qualification in the disposable full clone. No suite, executable fixture, network/private-data access, git command, source/artifact edit or production action was performed this turn.

Relay closed (Approved), no further turn needed. Harness owns the file-scoped commit, attestation and subsequent qualification gates.


### Attestation · relay-drive — 2026-11-09T16:53:42Z
task: GH318-FINAL-R3
reviewer: codex
status: Approved
reviewed-head: 30dd58eb496010e2dd2d33e2b95628509e24e797
added-range: 8256+4588
added-sha256: 3cc4d281678cd814adaab230eaaac03772f474a2cbeaa883a588a329acd3edbd
<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
