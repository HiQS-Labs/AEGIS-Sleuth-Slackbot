# RELAY · GH257 plan QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Approved
ROUND: 3 / 4

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
6. **Commit only the relay file** (`relay(gh257-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: **PROJECT/1-INBOX/GH-257-REVIEW-FIXES.md**, with source and existing tests named there.
- Reviewer: codex   ·   Producer: codex-producer
- Started: 2026-10-20
- Definition of Done: Read PROJECT/1-INBOX/GH-257-REVIEW-FIXES.md and the source/tests it names; answer its explicit review questions. Review only, no artifact edits or tests in this worktree. Scope is synthetic/local, no external communications or live services. Grade commensurate complexity, verify citations. Do not require speculative infrastructure.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1

Block — plan correction required before implementation.

swept file: yes
VERDICT: FAIL
Basis: Read all of PROJECT/1-INBOX/GH-257-REVIEW-FIXES.md, src/github-issue-stream-module.js, src/github-issue-stream-planner.js, and both existing stream test files. The shared watermark protects unread endpoint ranges but does not protect fetched replies whose parent has not yet been fetched. One concrete pre-existing loss path remains outside the proposed fix. No additional observed blocker from the whole-file sweep; existing persistence/lifecycle/retention defects are already addressed by the plan.

Evidence limits: Setup's .relay-artifacts/GH-257-REVIEW-FIXES.md and its directory are absent. Used the exact PROJECT/1-INBOX path also named in the Definition of Done; no seeded-copy identity claim. Graph list_projects found no project for this relay checkout; nearest repository index aegis-sleuth-slack-bot generation 2026-10-13T00:42:44Z returned zero stream symbols and coverage freshness not_tracked for both source/test pairs. Direct full-file reads supplied evidence instead. No network, live services, git, suites, or executable fixtures run.

- [Blocker] **R1 — A fetched comment can be discarded before the capped issues endpoint exposes its parent.** Plan line 36 bounds only by endpoint timestamps; planner src/github-issue-stream-planner.js:245-246 and :259-264 drops a comment when neither a persisted nor planned parent exists. Module :501-549 still regards this as fully delivered and advances. This defeats the no-loss outcome at plan :34 and acceptance (a) at :49 even with widely spaced timestamps.
  Observed input: Repo a/b seeded/cursor 2026-10-20T10:00:00.000Z, empty Issues map; first 500 issues were created before seeding, updated every 10 seconds from 11:00 through 12:23:10; issue #501 was created at 10:10 and updated at 13:00, beyond the cap. Complete comments response contains comment id 9 for #501, created/updated 10:20. Planner emits zero actions; proposed capped watermark is 12:22:10. Next cycle omits comment 9, although #501 can subsequently produce a parent. This is not the documented >500-in-one-overlap stall.
  Affected scope: Incomplete issues traversal plus fetched comments referencing an as-yet-unmapped issue beyond that traversal. The same dependency risk applies to a fetched PR reference whose target parent has not yet entered the state.
  Falsifier: Extend the existing mocked integration suite with exactly this multi-cycle shape and since-filtered responses. It must either deliver comment 9 once after the original parent is known, or explicitly hold/warn without advancing past it; parent-only output after advancing is red. Control: a complete issues response with a genuinely pre-seed unmapped issue should retain the intentional no-backlog skip. Record red evidence in the existing task receipts in the disposable clone.
  Concrete fix: Amend step 1 and acceptance (a) to account for unresolved parent dependencies, not only unread timestamps. The smallest acceptable bounded policy can conservatively hold/warn on this incomplete-traversal case and document its catch-up requirement; do not require a new queue or paging service. If choosing continued automatic progress instead, specify how the existing module preserves this comment until the parent is available.
  Root cause: Planner equates absent parent with an intentionally out-of-scope reply before traversal has established that fact; Fix site: planner/module delivery-completeness and cursor policy; Why not downstream: cursor advancement removes the only source replay opportunity.

  Read-only probe command (exit 0; output redirected beneath scratch):
  ```sh
  export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
  mkdir -p "$TMPDIR"
  node <<'JS' > "$TMPDIR/watermark.txt"
  const {PlanRepoActions,EmptyState}=require('./src/github-issue-stream-planner');
  const s=EmptyState(), t=h=>'2026-10-20T'+h+':00.000Z';
  s.Repos['a/b']={Cursor:t('10:00'),SeededAt:t('10:00')};
  const items=Array.from({length:500},(_,i)=>({number:i+1,title:'Old',state:'open',html_url:'',created_at:'2026-10-19T00:00:00.000Z',updated_at:new Date(Date.parse(t('11:00'))+i*10000).toISOString()}));
  const c={id:9,body:'Hi',html_url:'',issue_url:'https://api.github.com/repos/a/b/issues/501',created_at:t('10:20'),updated_at:t('10:20')};
  const safe=new Date(Date.parse(items[499].updated_at)-60000).toISOString();
  console.log(JSON.stringify({fetched:items.length,actions:PlanRepoActions(s,'a/b',items,[c]).length,safe,commentLost:c.updated_at<safe}));
  JS
  cat "$TMPDIR/watermark.txt"
  ```
  Decisive output: `{"fetched":500,"actions":0,"safe":"2026-10-20T12:22:10.000Z","commentLost":true}`. This measures the current pure planner plus the plan's specified watermark calculation, not an implemented future integration.

- [Pass] **Other proposed ownership and failure boundaries fit the current module.** Step 3's saved destination matches IssueThread.ChannelID/ThreadTs at planner :39-42 and corrects module :508-518; checking DND immediately at each write addresses module :434 versus :516. Step 4's save propagation/entry retry and awaited stopping address module :408-414, :527-539, :748-757 without requiring an external transaction. The plan explicitly says "A process crash between Slack acceptance and durable state save CAN duplicate" (line 39), a necessary practical limit. These are design approvals, not runtime verification.
- [Pass] **Retention and dynamic allowlist proposals have concrete source support and proportional existing-suite homes.** Planner :391-402 deletes delivery identity by age; module :627-638 reuses cache after successful empties and errors, and :670-675 swallows per-file transport failures. Plan steps 2/5 address those origins. Replace the now-obsolete assertions in tests/github-issue-stream-planner.test.js:315-347 and tests/github-issue-stream-module.test.js:287-321 when extending the existing suites. No additional suite, gate, or infrastructure is warranted.
- [Nit] **R2 — Correct relay Setup's artifact path or restore seeding before the next round.** Probe `cat .relay-artifacts/GH-257-REVIEW-FIXES.md` exited 1: "No such file or directory"; `cat PROJECT/1-INBOX/GH-257-REVIEW-FIXES.md` exited 0 and supplied this review. Use one accurately named review input.
- [Nit] **R3 — Tighten persistence acceptance wording.** Plan :49(e) says "retain pending state for recovery/restart"; qualify restart as after a successful recovery/shutdown save, consistent with the acknowledged crash window at :39. Require a surviving-process retry and a successful-save restart case, rather than implying unsaved memory survives exit.
- [Unverified — needs clone run] Focused suites, red controls, build, validators, full suite and PDDA remain producer/harness work. Acceptance cases (b)-(h) are falsifiable and proportional as planned, subject to R3's wording; acceptance (a) needs R1. Production, branch-head and external-review assertions in the evidence ledger were not re-queried under this local-only review scope.

Handing off to codex-producer — disposition R1-R3 and revise the plan before requesting the next reviewer turn.

### Producer · Round 2

R1 implemented in revised plan: incomplete issues plus unresolved parent dependencies holds/warns rather than advancing. Pure planner predicate; no queue or added API. R2 corrected Setup path. R3 qualifies restart after successful recovery/shutdown save. Red suite extensions restored from containment backups; they are committed before this review and no producer writes will run concurrently. Please review the revised plan, especially R1 hold policy; no production implementation yet.

### Reviewer · Round 2

Block — one remaining parent-dependency case needs a plan disposition.

swept file: yes
VERDICT: FAIL
Basis: Read the complete plan, module (779 lines), planner (436 lines), planner suite (351 lines), and module suite (551 lines), including restored red controls. R1's same-repo incomplete-traversal hold is a sound bounded correction; R2 and R3 are resolved. The whole-file sweep found the concrete pre-existing cross-repo dependency loss below. No additional observed defect requiring expansion of the proposed retention, persistence, destination, DND or shutdown work.

Evidence limits: No graph tools are exposed in this turn's tool inventory; project/generation and coverage could not be queried, so source reads supply evidence. No git, network, live services, test suite, executable fixture, validator or PDDA run. Probe used only pure planner functions and in-memory synthetic state; scratch output is disposable and is quoted below. External branch/PR/production claims in the plan remain outside this local review's evidence.

- [Pass] **R1-R3 dispositions accepted at design level.** Plan :36 now says "When the issues traversal is incomplete and a fetched comment or PR references an unmapped/unplanned parent, hold the shared cursor and warn" and explicitly admits operator catch-up. This preserves replay for round 1's observed input rather than falsely promising bounded automatic catch-up. Setup now names PROJECT/1-INBOX/GH-257-REVIEW-FIXES.md. Plan :49(e) explicitly puts restart "after a successful recovery/shutdown save", consistent with :39's crash limitation.
- [Should] **R4 — Account for cross-repo PR references before declaring no-loss sufficiency.** Plan :36 conditions its dependency hold on incomplete issues traversal, but planner :274-281 also supports cross-repo targets; module :443-549 plans and advances each source repo before visiting the next. A complete source response does not establish that the referenced target parent is intentionally excluded. The existing cross-repo test (tests/github-issue-stream-planner.test.js:155-185) supplies an already-mapped target, so it misses first-delivery ordering.
  Observed input: Allowlist order a/source, b/target; both seeded/cursor at 2026-10-20T10:00:00.000Z; empty Issues. Complete a/source issues response contains PR #9 at 10:20, title `Fix b/target#1`, plus a pre-seed unrelated issue updated at 12:00. Complete b/target response contains issue #1 created/updated at 10:10. Source planner emits nothing and its cursor becomes 11:59; target then gets its parent. Next source fetch excludes the 10:20 PR forever unless it changes again. Same input with the target already mapped emits `pr-open:a/source#9`.
  Affected scope: A fetched referencing PR whose target is an eligible new issue in another allowlisted repo but has not entered state when the source repo is planned. No page cap or dense timestamp burst is necessary.
  Falsifier: Extend the existing mocked multi-cycle module coverage with this allowlist order and since-filtered responses; expect the PR reply exactly once after its target parent is posted, or a documented hold/warn preserving source replay. Reverse repo order must also deliver once. A reference to a never-streamed/non-allowlisted repo must retain intentional skipping rather than causing an unbounded new hold.
  Concrete fix: Amend step 1 and acceptance (a) to disposition this target-repo dependency explicitly. Preserve source replay until eligible target evaluation resolves it, within the current bounded cycle/state design. No new queue, service, API or suite is requested. If choosing a conservative hold instead of automatic progress, scope and document it as explicitly as the same-repo hold.
  Root cause: Parent absence is treated as exclusion before the target repo is evaluated; Fix site: existing module/planner dependency and cursor decision; Why not downstream: advancing the source cursor removes the PR before Slack can ever receive its reply.

  Read-only probe command (exit 0):
  ```sh
  export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
  mkdir -p "$TMPDIR"
  node <<'JS' > "$TMPDIR/cross-repo.txt"
  const {PlanRepoActions,NextCursor,EmptyState}=require('./src/github-issue-stream-planner');
  const s=EmptyState(), seed='2026-10-20T10:00:00.000Z';
  for(const r of ['a/source','b/target'])s.Repos[r]={Cursor:seed,SeededAt:seed};
  const pr={number:9,title:'Fix b/target#1',body:'',state:'open',html_url:'https://github.com/a/source/pull/9',created_at:'2026-10-20T10:20:00.000Z',updated_at:'2026-10-20T10:20:00.000Z',pull_request:{}};
  const later={number:8,title:'Old unrelated issue',state:'open',html_url:'',created_at:'2026-10-19T00:00:00.000Z',updated_at:'2026-10-20T12:00:00.000Z'};
  const parent={number:1,title:'Target',state:'open',html_url:'https://github.com/b/target/issues/1',created_at:'2026-10-20T10:10:00.000Z',updated_at:'2026-10-20T10:10:00.000Z'};
  const source=[pr,later];
  const before=PlanRepoActions(s,'a/source',source,[]);
  s.Repos['a/source'].Cursor=NextCursor(source,[],seed);
  const targets=PlanRepoActions(s,'b/target',[parent],[]);
  s.Issues['b/target#1']={ChannelID:'C1',ThreadTs:'1',PostedKeys:['parent:b/target#1'],Closed:false,LastActivityAt:parent.created_at};
  const filtered=source.filter(x=>x.updated_at>=s.Repos['a/source'].Cursor);
  const after=PlanRepoActions(s,'a/source',filtered,[]);
  const control=PlanRepoActions(s,'a/source',source,[]);
  console.log(JSON.stringify({completeEndpoints:true,sourceBefore:before.map(x=>x.EventKey),target:targets.map(x=>x.EventKey),sourceCursor:s.Repos['a/source'].Cursor,nextSource:after.map(x=>x.EventKey),controlParentAlreadyKnown:control.map(x=>x.EventKey)}));
  JS
  cat "$TMPDIR/cross-repo.txt"
  ```
  Decisive output: `{"completeEndpoints":true,"sourceBefore":[],"target":["parent:b/target#1"],"sourceCursor":"2026-10-20T11:59:00.000Z","nextSource":[],"controlParentAlreadyKnown":["pr-open:a/source#9"]}`. This models the current sequential module order with pure planner calls; it is not a future-implementation integration result.
- [Nit] **R5 — Make the restored R1 fixture faithful before citing its red control.** tests/github-issue-stream-module.test.js:400 generates issue numbers 10 through 509, including target #501 as a pre-seed issue; :410 later changes #501 into a newly created issue. The PR variant also appends a 12:10 item after 12:20 items (:401-403), contrary to the client's ascending-update request (module :149). Exclude #501 from the initial 500 and order returned records by updated_at, preserving the absent-parent case without impossible identity changes. This is fixture fidelity feedback, not a new runtime behavior request.
- [Pass] **Other design answers remain proportionate.** Plan :37 retains both identity and dedup keys, matching planner :391-402's deletion origin; :38 binds channel and thread together and rechecks DND at writes, addressing module :508-518 and :434; :39 propagates saves and awaits stopping, addressing :408-414 and :748-757; :40 closes empty/cache and per-file error paths at module :627-638 and :670-675. These fit existing ownership and require no new subsystem. They are design approvals, not implemented correctness claims.
- [Unverified — needs clone run] Acceptance (b)-(h) and amended (a) have falsifiable observable outcomes, but restored suites have not run here. The original cache-success expectation at tests/github-issue-stream-module.test.js:287-321 still needs replacement as part of implementation; current red tests are not a passing baseline. Require the planned disposable-clone red/green receipts and final QA before claiming runtime success.

Handing off to codex-producer — disposition R4-R5, revise the plan and faithful existing-suite controls, then request the next reviewer turn.

### Producer · Round 3

R4 accepted: amended step 1 with optional ParentScanAt in existing repo state, seeded/allowlisted-target predicate, source replay held until target evaluated, continue target repos during dependency-only hold, and no indefinite hold for evaluated exclusions. R5 fixed target ID collision and ascending fixture order. Please review this final plan round against these explicit requirements; no production code yet.

### Reviewer · Round 3

Ship — plan approved for implementation and disposable-clone verification.

swept file: yes
VERDICT: PASS
Basis: Read the complete plan, both complete source files and both complete existing stream suites. R4 now distinguishes an unevaluated target from an evaluated exclusion without adding a queue or API; R5's initial capped fixture no longer collides with #501 and places the PR before later updates. R1-R3 remain resolved. No additional observed blocking defect from the whole-file sweep, including pre-existing code; the known source defects remain the implementation targets, not passing runtime behavior.

Evidence limits: Verify-tier graph discovery checked all 84 projects (both pages); this checkout is not indexed. Nearest repository project aegis-sleuth-slack-bot has generation 2026-10-13T00:42:44Z, zero matching stream symbols, and freshness not_tracked for all four source/test paths. Full local source reads supplied evidence. No git, external communications, live services, executable fixtures, test suites, validators or PDDA run. No new runtime probe was needed; prior-round probe results were read, not rerun. External branch/PR/deployment assertions in the plan were not independently verified.

- [Pass] **R4 resolved at design level.** PROJECT/1-INBOX/GH-257-REVIEW-FIXES.md:36 requires holding the source until a mapped parent or successful target parent scan at/after the PR update, records request-start time only after complete scanning and delivery, and says “Continue to subsequent repos when only a dependency holds”. This closes the observed source-before-target ordering hole at src/github-issue-stream-module.js:443 and src/github-issue-stream-planner.js:274-281 while letting target scans resolve intentionally excluded parents. The optional timestamp fits the existing per-repo state (planner :51); absent legacy timestamps conservatively require evaluation. Plan :63 explicitly commits to both repo orders and pre-seed/non-allowlisted controls.
- [Pass] **R5's reported initial-fixture corrections are present.** tests/github-issue-stream-module.test.js:400 uses issue numbers N + 1000; :403 puts Pr before the 12:20 old items. Target #501 remains absent in that capped response, and appears at :410. This is source inspection only; no red-control result is claimed.
- [Pass] **The bounded no-loss design now includes the necessary dependency conditions.** Plan :36 combines incomplete-endpoint watermarks, same-repo missing-parent hold, cross-repo evaluation and explicit cap/overlap stalls. These are sufficient design responses to the concrete loss inputs from rounds 1-2. Operator catch-up remains an admitted limit; continued automatic progress is not promised for held dependencies/dense boundaries. No speculative paging service is warranted.
- [Pass] **Recovery and delivery boundaries remain sound plan requirements.** Plan :37 retains identity and keys against planner :391-402's deletion path; :38 binds destination channel/thread and checks actual-destination DND before writes against module :508-518; :39 propagates saves, flushes before more delivery, awaits the active cycle and prevents stopping-time writes against module :408-414 and :748-757. Its explicit “A process crash between Slack acceptance and durable state save CAN duplicate” correctly bounds the promise. Plan :40 addresses successful-empty and transport-failure authorization paths at module :627-638 and :670-675 within the existing owner.
- [Unverified — needs clone run] Plan :47-49 and :63 supply falsifiable, proportionate verification requirements in the existing suites. Cross-repo order/exclusion controls, dense-boundary holds, blocked-save shutdown, and the remaining acceptance cases still require the producer's implementation and disposable-clone red/green receipts. Replace the obsolete cache-success assertion at tests/github-issue-stream-module.test.js:287-321 during implementation. Approval is of the plan, not a claim that the currently unfixed source or restored red tests pass. Final implementation QA and harness gates remain required.

Relay closed (Approved), no further plan-review turn needed. Codex-producer proceeds with implementation and the specified clone verification; token completed with done.


### Attestation · relay-drive — 2026-10-21T02:43:46Z
task: GH257-PLAN-QA
reviewer: codex
status: Approved
reviewed-head: 7dea9c6268662dca2c3a461bbf89a315f6e103a8
added-range: 21534+4287
added-sha256: 3c401bb0759ce99fff027e04af2fef34659232550e78ab232537e3da6e89be0b
<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
