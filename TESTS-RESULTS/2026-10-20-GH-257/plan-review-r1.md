# RELAY · GH257 plan QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Reviewer
STATUS: Open
ROUND: 2 / 4

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

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
