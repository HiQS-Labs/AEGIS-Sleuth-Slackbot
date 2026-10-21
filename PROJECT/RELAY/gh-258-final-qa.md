# RELAY · GH-258 final QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Open
ROUND: 2 / 5

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
6. **Commit only the relay file** (`relay(gh-258-final-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: **.relay-artifacts/gh258-final-diff.XXXXXX.md** — the read-only path that
  `relay-drive.sh --artifact-file /tmp/gh258-final-diff.XXXXXX.md` seeds into the isolated worktree (read it there; do NOT edit it).
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: _<fill in the acceptance criteria the Reviewer grades against>_

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1 · codex

swept file: yes

VERDICT: FAIL
Basis: The title-contract implementation is narrowly scoped and the duration veto is correctly placed before both schedule transforms, but the trailing matcher misses two explicit deadline forms and can leave a dangling deadline introducer. I reviewed the complete 946-line seeded artifact, including every changed source, prompt, test, receipt, and generated-ledger hunk. No additional pre-existing defects were found in the touched implementation file.

Evidence scope: artifact-only Verify review. No source-tree files, git commands, suites, executable fixtures, model calls, or service probes ran. The narrow regex probe below reads only the seeded artifact and evaluates its added literal; it writes no files.

- [Should] **The trailing schedule pattern does not implement all specified deadline phrases.** The plan requires `end of (the) day|week` and permits the lead-in `no later than` (`.relay-artifacts/gh258-final-diff.XXXXXX.md:86-94`), but the implemented `SCHEDULE_TRAILING_PATTERN` contains neither `end of...` nor `no later than` (`.relay-artifacts/gh258-final-diff.XXXXXX.md:691`). Consequently `Deploy the release end of day` is untouched, while the bare weekday arm removes only `Friday` from `Deploy the release no later than Friday`, leaving `Deploy the release no later than`. Add the two explicit end-of-day/week alternatives and make `no later than` one optional lead-in (before the bare weekday alternative); add contract cases for both damaged examples. Keep the current duration veto unchanged.
  Observed input: `Deploy the release end of day` and `Deploy the release no later than Friday`.
  Affected scope: trailing standalone due-date wording with the expressly listed long-form end-of-period or multiword deadline lead-in, in titles with no duration/condition introducer.
  Falsifier: `NormalizeReminderTitle` returns `Deploy the release` for both inputs, while `Keep staging online until the handoff at 2pm` remains unchanged under the existing duration veto.
  Probe: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; node -e 'const fs=require("fs"); const t=fs.readFileSync(".relay-artifacts/gh258-final-diff.XXXXXX.md","utf8"); const m=t.match(/^\\+const SCHEDULE_TRAILING_PATTERN = (\\/.*\\/i);$/m); const rx=eval(m[1]); const xs=["Deploy the release end of day","Deploy the release end of the week","Deploy the release by EOD","Deploy the release no later than Friday"]; console.log(JSON.stringify(xs.map(input=>({input,match:input.match(rx)?.[0]??null,output:input.replace(rx,"").trim()}))));'` (exit 0). Decisive output: `[{"input":"Deploy the release end of day","match":null,"output":"Deploy the release end of day"},{"input":"Deploy the release end of the week","match":null,"output":"Deploy the release end of the week"},{"input":"Deploy the release by EOD","match":" by EOD","output":"Deploy the release"},{"input":"Deploy the release no later than Friday","match":" Friday","output":"Deploy the release no later than"}]`.

Handing off to Producer (claude-a): fix the explicit trailing forms and add the bounded contract coverage, then request the next review round.

### Producer · Round 1 · claude-a

- Implemented: extended `SCHEDULE_TRAILING_PATTERN` with `end of (the) day|week` and the optional
  `no later than` lead-in; the duration/condition veto is unchanged.
- Added bounded contract cases for the two observed inputs. Focused title/selector/grounding suites:
  144 passing assertions; decision replay 23/23, AI validation, and build pass.
- Sanitizer disposition: the full scan reports 68 findings identically on the #261 baseline; this is
  pre-existing repository history, so no unrelated remediation was made.

Handing off to Reviewer (codex): recheck the bounded matcher correction and the producer evidence.

### Reviewer · Round 2 · codex

swept file: yes

VERDICT: FAIL
Basis: The Round 1 deadline matcher repair is correct and preserves the duration veto, but the implementation omits the plan's required person-topic golden coverage. I swept the complete 1,066-line seeded artifact, including every changed source, prompt, fixture, test, receipt, document, relay, and ledger hunk. No other pre-existing defect is observable in the seeded artifact's touched implementation hunks.

Evidence scope: artifact-only Verify review. No source-tree files, git commands, suites, executable fixtures, model calls, or service probes ran. The narrow non-mutating probe below reads only the seeded artifact and evaluates the added regex literal; it writes no files.

- [Pass] **The Round 1 trailing-form correction now matches both requested forms without bypassing the duration veto.** `SCHEDULE_TRAILING_PATTERN` includes `end of (?:the )?(?:day|week)` and `no later than` at `.relay-artifacts/gh258-final-diff.XXXXXX.md:809`; `StripScheduleWording` returns unchanged text when `DURATION_CONDITION_PATTERN` matches at lines 810–817. The added contract cases cover the end-of-period and multiword-lead-in examples at lines 1028–1029.
  Probe: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; node -e 'const fs=require("fs"); const t=fs.readFileSync(".relay-artifacts/gh258-final-diff.XXXXXX.md","utf8"); const m=t.match(/^\\+const SCHEDULE_TRAILING_PATTERN = (\\/.*\\/i);$/m); const rx=eval(m[1]); const duration=/\\b(?:until|till|thru|through|for|over|during|within|since|from|between|after)\\b/i; const xs=["Deploy the release end of day","Deploy the release end of the week","Deploy the release no later than Friday","Keep staging online until the handoff at 2pm"]; console.log(JSON.stringify(xs.map(input=>({input,match:input.match(rx)?.[0]??null,duration:duration.test(input),output:duration.test(input)?input:input.replace(rx,"").trim()}))));'` (exit 0). Decisive output: `end of day`, `end of the week`, and `no later than Friday` each reduce to `Deploy the release`; the nested-duration input has `duration:true` and remains `Keep staging online until the handoff at 2pm`.

- [Should] **The promised person-topic grounding acceptance case was not added.** The implementation plan requires a golden person-topic sample grounded by existing analyzed context and an invented-entity topic rejected by grounding (`.relay-artifacts/gh258-final-diff.XXXXXX.md:97-98`), while the product requirement adds `re: <topic>` from earlier context (`:61-69`). The changed golden hunk contains only schedule expectation edits (`:897-972`) and the changed contract cases contain no `re:` title or topic-bearing context (`:1010-1066`). The receipt's generic statement that synthetic cases “passed through” (`:671-677`) does not record an input, selected title, or grounding result. Add the two bounded existing-fixture cases specified by the plan: a topic-bearing analyzed context that accepts a grounded `Reply to Dana re: vendor security review`, and an otherwise identical candidate containing an absent entity/topic that grounding rejects. Record their exact input/output in the receipt if retaining the dev-model claim.
  Observed input: the plan's required topic-present context `vendor security review` plus `And please reply to Dana before our call. Thanks!`; neither that concrete sample nor any `re:` candidate appears in the changed golden or title-contract test hunks.
  Affected scope: person-object titles synthesized from existing analyzed context, including grounding acceptance and rejection of the appended topic.
  Falsifier: the existing golden/selector fixture accepts `Reply to Dana re: vendor security review` only when its analyzed source supplies both `Dana` and `vendor security review`, and rejects a candidate whose entity/topic is absent; no new suite or prompt-only assertion is needed.
  Probe: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; node -e 'const fs=require("fs"); const t=fs.readFileSync(".relay-artifacts/gh258-final-diff.XXXXXX.md","utf8"); console.log(JSON.stringify({personTopicGoldenAdded:/^\\+.*(?:vendor security review|Reply to Dana re:|re: <topic>)/m.test(t.slice(t.indexOf("diff --git a/tests/fixtures/reminder-title-golden.json"))),personTopicContractCaseAdded:/^\\+.*(?:Reply to Dana re:|vendor security review)/m.test(t.slice(t.indexOf("diff --git a/tests/reminder-title-contract.test.js")))}));'` (exit 0). Decisive output: `{"personTopicGoldenAdded":false,"personTopicContractCaseAdded":false}`.

Handing off to Producer (claude-a) — go to the Producer window and say 'take your turn'. Add the bounded person-topic grounding coverage and receipt evidence, then request Round 3 review.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
