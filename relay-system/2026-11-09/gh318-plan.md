# RELAY · GH318 plan QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-09.
-->

NEXT: Producer
STATUS: Approved
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
6. **Commit only the relay file** (`relay(gh318-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: **PROJECT/2-WORKING/GH-318-TITLE-GROUNDING.md** (committed plan; read in full, do NOT edit).
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-09
- Definition of Done: The proposed two-rule change preserves useful grounded titles while retaining factual-entity controls; existing tests can demonstrate the selected user-visible title and negative controls; scope stays surgical and the evaluation/verification plan is falsifiable.

## Plan-review brief
This is PLAN QA only, before implementation. Operational envelope: a small shared pure-function edit in this Node.js backend. No new subsystem, speculative architecture or enterprise machinery. Do not implement, run app/API benchmarks, access private Slack data, or run tests in this review worktree. Examples are synthetic; the producer will run the frozen private real-source evaluation later.

Read the actual committed plan above in full, then read the full relevant helper and its existing consumers/tests, not just this summary. Required source: `src/task-grounding.js`, `src/reminder-display-selection.js`, `src/reminder-title-contract.js`. Required coverage: `tests/task-grounding.test.js`, `tests/reminder-display-selection.test.js`, `tests/reminder-title-contract.test.js`; inspect existing analyzed-context coverage and reminder module call sites as needed. Follow ROUTER.md / AGENTS.md and read the architecture title-contract section. Cite actual file:line spans. Record the exact input HEAD reviewed.

Questions:
1. Does adding only leading `compile` to ImperativeVerbs fix the opening-verb defect while retaining nonleading Compile and invented first-noun checks?
2. Does the proposed ASCII uppercase acronym + lowercase plural s exception reuse whole-token singular/plural matching, preserve Teams/quoted/identifier/number/date controls, and cover both title and context-line consumers safely?
3. Do the proposed existing selector/contract regressions verify the final selected useful title and adjacent invented-entity refusal, rather than raw model output alone? What existing test seam should be used?
4. Is the plan surgical and DRY with no parallel mechanism or prompt/FSM/persistence/API change? Are rollback and exact-revision verification sufficient for this scope?
5. Does the frozen nine-case/six-setting evaluation distinguish raw, selected and saved outputs, preserve input equality and historical clock/settings, retain exclusions/unknowns and stop on provider/isolation errors without resetting bounds? Judge the stated protocol; private data is not available or needed for this plan review.

Output one graded review block in this thread only, with verdict PASS/FAIL/PARKED, Basis, swept file declaration, concrete citations and protocol-required Observed input/Affected scope/Falsifier for behaviour-change requests. Pre-existing relevant defects found while sweeping should be identified explicitly. Do not edit the plan or production source.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Runner evidence · 2026-11-09 · launch halted

Independent review did not run. No reviewer verdict or code findings were produced.

- Input HEAD at invocation: `b07bec66daa71fd1e0572e3b2e6a1fa4ff8582f5` (review-brief-only commit above original inputs `e6e50feb4e3a1f4f2c69fb5fc5d3cdc684f6ec03`; plan/source unchanged).
- Locator `bash ${HOME}/.codex/skills/relay-xyz/find-harness.sh --check` exited 0, resolved this task clone's `.xyz`, current harness `57ba82912d894a0b978093c70911a7c59b8bf1a3`, Codex CLI available.
- Command, from task root (machine paths redacted as ${TASK_ROOT} / ${HOME}; exact command and output retained in runner tool transcript):

```bash
ALLOW_PATHS='' CODEX_AGENT=codex RELAY_PEER=producer .xyz/relay-automation/relay-drive.sh --relay-file relay-system/2026-11-09/gh318-plan.md --relay-task GH318-PLAN --agent-cmd '${TASK_ROOT}/.xyz/relay-automation/codex-turn.sh' --reviewer codex --round-cap 3 --review-once
```

Actual exit status: **4**, before worker invocation. Decisive stderr:

```text
relay-drive: NOTE — TICK_REPO_ROOT unset; self-resolved to ${TASK_ROOT} (#129)
relay-drive: GH318-PLAN not found in the resolved tick log
  TICK_REPO_ROOT: ${TASK_ROOT}
  searched:       ${TASK_ROOT}/.tick/events/
```

No review receipt/transcript exists from this invocation because `codex-turn.sh` was not invoked. Exact reviewed HEAD: **none**. This thread is the retained runner evidence, not an independent-review receipt. Read-only follow-up found neither task-root `.tick/events/` nor `.xyz/.tick/events/`; locator `--env` resolves TICK_REPO_ROOT to the same task root.

Next action for parent: seed the missing GH318-PLAN token through the shipped tick CLI using the skill's task.created/claim/release-to-codex protocol in the resolved task root, then perform a new authorized launch. No retry/reset, alternate reviewer, harness edit, production edit, test, benchmark, push or PR was performed here. Handing off to producer to disposition this launch failure; NEXT remains Reviewer because plan QA is pending.

### Reviewer · Round 1

VERDICT: PASS
Basis: Approve the implementation plan. The two bounded classification changes fit the observed fail path, reuse the canonical matcher, and specify selected-output red/green checks and factual negative controls. This is plan approval, not implementation or private-evaluation verification.
swept file: yes

Input HEAD reviewed: `84feb73b9b9c7beaa03462f448b93bbf56b01552` (read directly from the worktree Git metadata HEAD; no git command run). Read the complete plan, all three required helpers and all three required test files, plus the analyzed-source regression suite and relevant reminder-module delegates. Graph discovery was attempted but unavailable because the tool required approval under a never-approval policy; direct source inspection was used.

- [Pass] **Opening verb is bounded.** `src/task-grounding.js:80–102` lacks `compile`; `:304–324` checks identifier/temporal terms before exempting only a recognized opening verb at `:321`. Adding just `compile` fixes that token without exempting nonleading `Compile` or opening `Acme`. Existing first-noun witnesses are `tests/task-grounding.test.js:35–44`; the plan explicitly retains both controls (`PROJECT/2-WORKING/GH-318-TITLE-GROUNDING.md:36`). Implement at that existing set, with separate Compile-only and plural-only red cases so either change cannot mask the other.
- [Pass] **Plural acronym rule has the correct existing home.** `UngroundedTerms` withholds plural matching through `!IsBareProperNoun` (`src/task-grounding.js:336–354`); the matcher already compares whole consecutive token runs and singularized tokens (`:223–256`). An anchored ASCII uppercase stem of at least two letters plus lowercase `s` (for example `/^[A-Z]{2,}s$/`) can narrowly change classification without skipping extraction or matching. Keep `Teams`, `AWS` versus `aw`, invented acronyms and substring lookalikes refused; the existing safety witnesses are `tests/task-grounding.test.js:229–250`. Quotes, numbers and temporal terms must still enter the matcher (`src/task-grounding.js:275–294`, `:310–313`); the plan explicitly calls for these negative controls, rather than an acronym bypass (`plan:26,36`). No new matcher is needed.
- [Pass] **Existing selected-output seam is sufficient.** Extend the `SelectTaskText` grounding tests at `tests/reminder-display-selection.test.js:240–274`: with the plan's nonempty source, synthesis true and a genuine source span, assert exact text `Compile a list of publicly indexable reference URLs`, `source: 'title'`, empty ungrounded terms and no repair; pair it with a title adding absent `Acme` and assert that entity is absent from the selected output and grounding records refusal. The contract suite already calls the real selector and asserts final text/source (`tests/reminder-title-contract.test.js:251–281`), so use that seam rather than a raw model-output assertion. Production delegates there (`src/reminders-module.js:2754–2758`), and the selector rechecks normalized text (`src/reminder-display-selection.js:279–323`). These are concrete ways to satisfy the existing plan steps 1–2, not additional scope.
- [Pass] **Both consumers and context preservation are accounted for.** Context grounding calls the same helper before redundancy filtering (`src/reminder-display-selection.js:417–448`); existing context positive/negative seams are `tests/reminder-display-selection.test.js:277–321` and `tests/gh68-grounding-uses-analyzed-source.test.js:108–122`. Exercise a distinct context line naming grounded `URLs` versus invented `APIs` so redundancy cannot make the positive pass vacuously. Analyzed-source positive and omitted-source negative controls already exist in `tests/gh68-grounding-uses-analyzed-source.test.js:35–65`. The plan explicitly includes focused analyzed-context coverage and preservation of shared context controls (`plan:29,37`).
- [Pass] **Scope, rollback and evaluation protocol are proportionate.** The plan restricts production edits to the shared pure helper and excludes prompt/FSM/persistence/API changes (`plan:26`); code/test revert needs no migration (`plan:42`). Its final-code checks and independent QA (`plan:39`) must record the exact tested implementation revision in the promised results receipt, not claim the base revision is tested candidate evidence. The frozen nine-case/six-setting protocol separates raw/selected/saved, preserves source hashes, historical clock/settings/native effort, exclusions and unknowns, and stops on provider/isolation errors without resetting the $5/200-attempt/30-minute bounds (`plan:38`). Retained original responses provide the stated additional deterministic attribution check. Private data was neither accessed nor required for judging that protocol.
- [Pass] **Whole-file sweep:** no additional relevant pre-existing defect found requiring expansion of this plan. The deliberately uncaught lowercase invented-word limitation is already explicit in `src/task-grounding.js:19–31` and `tests/task-grounding.test.js:114–123`; it is not silently solved by these two changes. The title-contract's bounded normalization/validation/fallback behavior remains owned by its existing functions (`src/reminder-title-contract.js:235–324,394–416,485–529`).
- [Unverified — needs clone run] No tests, fixtures, app modules, provider calls or candidate implementation were executed here. Proposed red/green behavior, final build/full test gate, and frozen private evaluation remain implementation-time obligations (`plan:36–39`); this PASS makes no claim they have already passed.

Relay closed (Approved), no further turn needed. Token handoff: `done GH318-PLAN --agent codex` through the absolute env-pinned tick.


### Attestation · relay-drive — 2026-11-09T16:15:10Z
task: GH318-PLAN
reviewer: codex
status: Approved
reviewed-head: 84feb73b9b9c7beaa03462f448b93bbf56b01552
added-range: 9979+5764
added-sha256: 88805973eeab9df72023594329ee9b13910a3ea63c06c522ad0aa3158e51aa41
<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
