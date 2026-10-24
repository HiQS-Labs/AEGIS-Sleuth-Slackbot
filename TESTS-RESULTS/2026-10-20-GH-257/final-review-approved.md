# RELAY · GH257 final code QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Approved
ROUND: 1 / 4

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
6. **Commit only the relay file** (`relay(gh257-final-code-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: src/github-issue-stream-module.js, src/github-issue-stream-planner.js, both existing tests/github-issue-stream-*.test.js, ARCHITECTURE.md, CHANGELOG.md, PROJECT/2-WORKING/GH-257-REVIEW-FIXES.md and TESTS-RESULTS/2026-10-20-GH-257/verification.md. HEAD c19b227; integration base 50fa08c. Read entire touched runtime files and diff from base.
- Reviewer: codex   ·   Producer: codex-producer
- Started: 2026-10-20
- Definition of Done: Independent final code review against the approved plan and PR256 scoped findings. Synthetic/local operational envelope only. No production/live APIs, network communications, test suites or executable fixtures in review worktree. Review is limited to thread writes; use non-mutating source probes under scratch if needed. Keep machinery proportional; no speculative infrastructure or new test suites. Focused 43 tests/build/relevant validators PASS; full disposable qualification and exact-head hosted CI remain pending and will run after code approval, so do not claim them complete.

Questions:
1. Do incomplete endpoint watermarks prevent skip, including ignored/PR items and equal timestamps, with documented dense cap holds?
2. Does HasUnmappedParents preserve unseen-parent and cross-repo reference replay, continue target evaluation, and intentionally exclude old/ignored/unwatched targets without indefinite new holds?
3. Do saved channel/thread identity, per-write actual-channel DND, retained PostedKeys and successful save ordering prevent routine duplicate/orphan delivery?
4. Does shutdown await the active post AND state save, prevent new writes/cycles, and retry pending state? Are persistence errors propagated and pending state flushed before more delivery?
5. Are backward-compatible SchemaVersion1 reads, one optional ParentScanAt field, external API crash-window limits, retained-state growth and catch-up limits accurately documented?
6. Are the existing-suite regressions faithful and load-bearing? The separate title finding is deferred to #252 takeover; no title code touched. Do not resolve old review threads. Flag only concrete relevant defects with file:line, Observed input, Affected scope and Falsifier. Missing full gate/CI is pending evidence, not a source defect. Mark PASS only if scoped code is acceptable, with actual citations.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1

VERDICT: PASS
Basis: Ship within the stated synthetic/local envelope. No concrete relevant source defect found, including in the pre-existing portions of the two runtime files and existing suites. Full disposable qualification and exact-head hosted CI remain pending; this is code approval, not release qualification.
swept file: yes

Read both complete runtime files, both complete existing stream suites, approved plan, verification receipt, architecture section and changelog changes. Compared the named runtime/tests/docs against integration base `50fa08c` with a read-only Python object reader and `difflib.unified_diff` (exit 0; no Git executable invoked). Graph project inventory has no index for this worktree; the nearest AEGIS index generation is `2026-10-13T00:42:44Z`, and coverage reports all four code/test paths `freshness: not_tracked`. Direct current-source reads are the review evidence.

- [Pass] Bounded watermark and dense hold: `src/github-issue-stream-module.js:126` initializes incomplete traversal and only marks a short page complete; `src/github-issue-stream-planner.js:393` includes every issue/PR/comment timestamp before applying both incomplete-endpoint bounds. `src/github-issue-stream-module.js:603` warns on no progress. Narrow non-mutating probe, command below, exit 0; decisive output: `{"issues":"2026-10-20T12:04:00.000Z","comments":"2026-10-20T12:04:00.000Z","dense":"2026-10-20T12:00:00.000Z"}`. No correction requested.

  ```sh
  export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
  node <<'JS'
  const p=require('./src/github-issue-stream-planner');
  const prev='2026-10-20T12:00:00.000Z', early={updated_at:'2026-10-20T12:05:00.000Z'}, late={updated_at:'2026-10-20T18:00:00.000Z'};
  console.log(JSON.stringify({issues:p.NextCursor([early],[late],prev,{Issues:false}),comments:p.NextCursor([late],[early],prev,{Comments:false}),dense:p.NextCursor([{updated_at:'2026-10-20T12:00:30.000Z'}],[late],prev,{Issues:false})}));
  JS
  ```

- [Pass] Parent dependencies preserve replay and allow target evaluation: `src/github-issue-stream-planner.js:355` distinguishes fetched exclusions from absent parents, checks allowlist/seed/scan timestamps for cross-repo targets, and holds unknown eligibility. `src/github-issue-stream-module.js:593` records a completed successful evaluation; its dependency-only hold falls through to the next repo rather than taking the delivery-failure break at line 607. Existing since-filtered scenarios exercise missing comment/PR parents and both repo orders (`tests/github-issue-stream-module.test.js:405`, `:558`); intentional outside/old/seeded-later exclusions are asserted at `:583`. No correction requested.
- [Pass] Delivery identity and persistence ordering: replies take both saved fields at `src/github-issue-stream-module.js:552`; DND checks the actual destination at `:555`. Accepted posts update memory and await save at `:576`; failures rethrow at `:583`/`:800`, and the next cycle saves before fetch/delivery at `:453`. `src/github-issue-stream-planner.js:422` prunes repo cursors without deleting thread identities or event keys. Existing regressions cover destination DND, mid-batch DND, save failure/recovery/restart and aged replay (`tests/github-issue-stream-module.test.js:446`, `:462`, `:497`, `:606`). No correction requested.
- [Pass] Shutdown awaits the cycle, including its awaited save, and retries failed persistence (`src/github-issue-stream-module.js:426`). The stopping guard at `:412` and per-action guard at `:547` prevent further delivery; inactive state prevents rescheduling at `:817`. Existing blocked-acceptance and blocked-save cases explicitly assert stop remains pending (`tests/github-issue-stream-module.test.js:533`, `:633`). No correction requested.
- [Pass] Compatibility and limits are accurate: the loader still accepts SchemaVersion 1 (`src/github-issue-stream-module.js:770`), with only optional `ParentScanAt` added to repo state (`src/github-issue-stream-planner.js:51`). `ARCHITECTURE.md:86` and `:87` document retained-state growth, external-post/local-save crash window, bounded holds and separately authorized catch-up. `CHANGELOG.md:55` keeps title work deferred to #252; the base comparison contains no title-code change. The corrected mirror target exists (`test -f PROJECT/3-COMPLETED/GH-249-GIT-PULSE-MIRROR.md`, exit 0). No correction requested.
- [Unverified — needs clone run] Test execution, final mutation sensitivity, full qualification and exact-head CI were not run in this review worktree. The focused 43-test/build/validator results are producer receipts (`TESTS-RESULTS/2026-10-20-GH-257/verification.md:7` through `:13`), not independent execution here. Existing assertions are relevant and observable; the later harness must supply the remaining execution evidence. This is pending evidence, not a source finding or request for new machinery.

Relay closed (Approved), no further review turn needed. Producer resumes the already-planned disposable qualification and exact-head CI; no old review threads are resolved by this approval.


### Attestation · relay-drive — 2026-10-21T02:51:56Z
task: GH257-FINAL-QA
reviewer: codex
status: Approved
reviewed-head: c19b227a9c0535f2a8afa78190a6125455e70a19
added-range: 7300+5121
added-sha256: 3301ff9903482e87869305916827de236abc4f6cea0abc2b0956e5837d2b6723
<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
