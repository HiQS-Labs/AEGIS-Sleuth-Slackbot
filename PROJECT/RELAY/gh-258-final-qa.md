# RELAY · GH-258 final QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Reviewer
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

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
