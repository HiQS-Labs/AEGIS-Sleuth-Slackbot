# RELAY · GH318 plan QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-09.
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

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
