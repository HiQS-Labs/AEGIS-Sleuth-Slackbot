# RELAY · GH-258 final QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Reviewer
STATUS: Open
ROUND: 5 / 5

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

### Producer · Round 2 · claude-a

- Implemented: added golden G-43, which accepts a person-topic title only when analyzed context
  supplies its topic, plus a selector negative control using a distinct absent named topic.
- Verification: title-contract suite 109 passing assertions; decision replay 23/23 and build pass.

Handing off to Reviewer (codex): verify the bounded topic-grounding pair and close if no findings remain.

### Reviewer · Round 3 · codex

swept file: yes

VERDICT: FAIL
Basis: The bounded person-topic grounding pair is now present, but the schedule transform runs before terminal punctuation removal, so a normal punctuated trailing deadline cannot match and remains in the displayed title. I swept the complete seeded artifact, including all changed implementation, prompt, fixture, test, receipt, and ledger hunks. No additional pre-existing defect is observable in the touched implementation hunk.

Evidence scope: artifact-only Verify review. No source-tree files, git commands, suites, executable fixtures, model calls, or service probes ran. The narrow regex probe below reads only the seeded artifact and evaluates its added literal; it writes no files.

- [Should] **A trailing due-date phrase followed by terminal punctuation is never stripped.** `StripScheduleWording` applies `SCHEDULE_TRAILING_PATTERN` before terminal punctuation removal (`.relay-artifacts/gh258-final-diff.XXXXXX.md:839,865-868`), and the pattern is end-anchored immediately after the phrase (`:839`). Thus `Deploy the hotfix by Friday.` and `Review the release EOD!` do not match; the later punctuation-only pass cannot retry the schedule transform. The unchanged expected result for punctuated `I'll deploy the changes tomorrow.` at `:1075` also pins this broken behavior. Strip terminal punctuation before the trailing schedule pass (or let the schedule matcher consume it), then retain the existing duration veto and two-word rollback. Add a bounded punctuated deadline case.
  Observed input: `Deploy the hotfix by Friday.`, `I will deploy the hotfix tomorrow.`, and `Review the release EOD!`.
  Affected scope: title candidates with an otherwise-supported trailing due-date phrase followed only by terminal punctuation, and no duration/condition introducer.
  Falsifier: `NormalizeReminderTitle` returns `Deploy the hotfix`, `Deploy the hotfix`, and `Review the release` respectively, while `Keep staging online until Friday.` remains unchanged apart from terminal punctuation under the duration veto.
  Probe: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; node -e 'const fs=require("fs"); const t=fs.readFileSync(".relay-artifacts/gh258-final-diff.XXXXXX.md","utf8"); const m=t.match(/^\\+const SCHEDULE_TRAILING_PATTERN = (\\/.*\\/i);$/m); const rx=eval(m[1]); const xs=["Deploy the hotfix by Friday.","I will deploy the hotfix tomorrow.","Review the release EOD!"]; console.log(JSON.stringify(xs.map(input=>({input,match:input.match(rx)?.[0]??null,afterSchedule:input.replace(rx,"").trim(),afterTerminal:input.replace(rx,"").trim().replace(/[\\s.!,;:\\-–—]+$/,"").trim()}))));'` (exit 0). Decisive output: `[{"input":"Deploy the hotfix by Friday.","match":null,"afterSchedule":"Deploy the hotfix by Friday.","afterTerminal":"Deploy the hotfix by Friday"},{"input":"I will deploy the hotfix tomorrow.","match":null,"afterSchedule":"I will deploy the hotfix tomorrow.","afterTerminal":"I will deploy the hotfix tomorrow"},{"input":"Review the release EOD!","match":null,"afterSchedule":"Review the release EOD!","afterTerminal":"Review the release EOD"}]`.

Handing off to Producer (claude-a) — go to the Producer window and say 'take your turn'. Fix the punctuation ordering or match boundary, add the bounded coverage, then request Round 4 review.

### Producer · Round 3 · claude-a

- Implemented: the trailing schedule matcher now consumes only terminal punctuation following a
  supported deadline, so it can remove punctuated due phrases before the existing terminal cleanup.
- Updated the four intended schedule expectations exposed by this correction after reading each row.
  Focused title-contract suite: 110 passing assertions; build passes.

Handing off to Reviewer (codex): recheck the punctuation boundary and approve if no in-scope finding remains.

### Reviewer · Round 4 · codex

swept file: yes

VERDICT: FAIL
Basis: The Round 3 punctuation correction works, but two bounded schedule-matcher defects remain: a leading date can match inside a longer word, and the planned weekday-plus-part-of-day form is incomplete. Reviewed the seeded artifact, the complete current `src/reminder-title-contract.js`, and the changed prompt, fixture, test, receipt and ledger material. No additional pre-existing implementation defect requiring a Blocker/Should was found. Because Setup still has a placeholder Definition of Done, this review uses the artifact's Requirements and the prior findings as acceptance criteria.

Evidence scope: direct-source Verify fallback; graph project/status/coverage tools are not callable in this turn, so no graph completeness claim. No git commands, suites, executable fixtures, model calls or service probes ran. Full-suite and real-model results remain **[Unverified — needs clone run]**; the receipt's insensitive prompt control is not causal evidence. The probe below reads only added regex literals from the seeded artifact and measures their matching/deletion, not the whole selector.

- [Pass] **Round 3 punctuation repair is present.** The trailing matcher now ends in `[\s.!,;:\-–—]*$` (`.relay-artifacts/gh258-final-diff.XXXXXX.md:865`), and the punctuated contract case is added at `:1126`. Probe exit 0: `Deploy the hotfix by Friday.` becomes `Deploy the hotfix`, and `Review the release EOD!` becomes `Review the release`. `Keep staging online until Friday.` has `veto:true` and is untouched by schedule deletion. Retain the veto and two-word rollback.

- [Should] **Require a complete leading schedule token before deleting it.** The leading regex has no word boundary and permits zero separator characters after the date (`.relay-artifacts/gh258-final-diff.XXXXXX.md:864`). It therefore matches `Tomorrow` inside `Tomorrowland release checklist`, producing `land release checklist`; the two-word guard admits this three-word result. Capitalization cannot restore the damaged name. Require a token/separator boundary after the entire leading schedule expression and add a bounded existing-suite preservation case. Keep the valid `Tomorrow, review the logs` control working.
  Observed input: `Tomorrowland release checklist`; `leading:"Tomorrow"`, `veto:false`, `afterSchedule:"land release checklist"` (probe exit 0).
  Affected scope: leading non-date words whose prefixes coincide with a supported schedule alternative, including unquoted names/identifiers; do not broaden schedule parsing.
  Falsifier: the normalizer preserves `Tomorrowland release checklist` exactly while `Tomorrow, review the logs` still becomes `Review the logs`.

- [Should] **Consume the supported weekday's part of day as one phrase at both ends.** Requirement 2 expressly lists `[this|next|coming] <weekday> [part of day]` (`.relay-artifacts/gh258-final-diff.XXXXXX.md:78`), but neither weekday arm includes the optional part of day (`:864-865`). `Next Friday morning I will deploy the hotfix` loses only `Next Friday `, leaving `morning I will deploy the hotfix`, so the start-anchored framing pass cannot reach `I will` (`:883-891`). The trailing counterpart is untouched. Extend the existing weekday alternatives with the bounded optional part-of-day suffix, and pin these two shapes in the existing suite; retain the duration veto.
  Observed input: `Next Friday morning I will deploy the hotfix` and `Deploy the hotfix next Friday morning`; probe exit 0 reports leading match `Next Friday ` for the first and no trailing match for the second.
  Affected scope: the explicitly planned weekday-plus-part-of-day schedule phrases at title boundaries, in titles without a duration/condition introducer.
  Falsifier: both inputs normalize to `Deploy the hotfix`; `Keep staging online until next Friday morning` remains intact under the duration veto.

Probe command (exit 0; no probe files written):
```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node <<'NODE'
const fs=require('fs');
const t=fs.readFileSync('.relay-artifacts/gh258-final-diff.XXXXXX.md','utf8');
const names=['SCHEDULE_LEADING_PATTERN','SCHEDULE_TRAILING_PATTERN','DURATION_CONDITION_PATTERN'];
const r=Object.fromEntries(names.map(n=>[n,eval(t.match(new RegExp('^\\+const '+n+' = (/.*/i);$','m'))[1])]));
for(const input of ['Tomorrowland release checklist','Tomorrow, review the logs','Next Friday morning I will deploy the hotfix','Deploy the hotfix next Friday morning','Deploy the hotfix by Friday.','Review the release EOD!','Keep staging online until Friday.']) {
 const veto=r.DURATION_CONDITION_PATTERN.test(input);
 console.log(JSON.stringify({input,veto,leading:input.match(r.SCHEDULE_LEADING_PATTERN)?.[0]??null,trailing:input.match(r.SCHEDULE_TRAILING_PATTERN)?.[0]??null,afterSchedule:veto?input:input.replace(r.SCHEDULE_LEADING_PATTERN,'').replace(r.SCHEDULE_TRAILING_PATTERN,'').trim()}));
}
NODE
```
Decisive output is quoted in each finding above. These match-level results do not claim suite execution.

Root cause: the shared schedule expressions omit a token boundary and a specified weekday suffix; Fix site: the existing leading/trailing regexes and bounded cases in the existing title-contract suite; Why not upstream/downstream: the normalizer owns deletion, and later framing/validation cannot reconstruct lost name characters or rerun framing after an unconsumed `morning`.

Handing off to Producer (claude-a) — go to the Producer window and say 'take your turn'. Address the two bounded matcher findings, then request Round 5 review. Only this relay file was edited; the harness owns its commit.

### Producer · Round 4 · claude-a

- Implemented: leading schedule removal now requires a token boundary, and both weekday arms accept
  an optional part-of-day suffix.
- Added preservation and leading/trailing weekday-plus-part-of-day cases. Focused title-contract
  suite: 113 passing assertions; build passes.

Handing off to Reviewer (codex): final permitted QA review; approve only if no in-scope finding remains.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
