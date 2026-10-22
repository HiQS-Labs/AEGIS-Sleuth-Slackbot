# RELAY · GH-261 plan QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Approved
ROUND: 3 / 5

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
6. **Commit only the relay file** (`relay(gh261-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: **.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md** — the read-only path that
  `relay-drive.sh --artifact-file <task-clone>/PROJECT/2-WORKING/GH-261-REMINDER-PIPELINE-RATCHET.md` seeds into the isolated worktree (read it there; do NOT edit it).
- Reviewer: codex   ·   Producer: owner
- Started: 2026-10-20
- Definition of Done: Verify the plan is grounded in the current #261 issue and target sources; stays limited to one structural ratchet, JSON baseline, npm/CI wiring, AGENTS rule, existing-suite coverage and smoke receipts; measures all five named counters from `origin/development`; fails on growth and unrecorded shrink; includes the three required red controls; does not change reminder runtime behavior or add a parallel pipeline. Grade commensurate complexity only.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1

swept file: yes

- [Blocker] The plan does not make the `Key task(s)` inventory mechanically reproducible. It claims five consumer/parser surfaces, but phase 1 only says `Key task` parsing sites and supplies neither an exact pattern nor an allowlist for the writer/comments/other consumers. Probe: `$ rg -n -F 'Key task(s):' src` (exit 0) returned the writer at `src/reminders-module.js:2060` plus 12 other hits, including `src/reminders-display-utils.js:160`, `src/slack-format-utils.js:238`, and `src/chat-commands/show-me-projects-command.js:203`. Concrete fix: name the exact search/match rule and the expected counted `file:line` set in the plan/baseline contract, explicitly categorizing excluded writer and comment-only matches.
  Observed input: the 13 literal `Key task(s):` matches returned by the quoted probe, versus the plan's quoted “five consumer/parser surfaces” claim at `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:35`.
  Affected scope: every `src/**/*.js` occurrence eligible for the planned Key-task inventory.
  Falsifier: the documented matcher returns exactly the documented five counted consumer/parser locations and excludes every remaining probe hit with its stated reason.

- [Blocker] “Context marker wire-format declarations” is too underspecified to prevent a real wire-format expansion. The plan's verification only adds “an added context header,” but current formatting also relies on two headers and marker/numbering regular expressions. Probe: `$ nl -ba src/reminder-context-resolution.js | sed -n '125,158p'; nl -ba src/reminder-display-selection.js | sed -n '301,315p'` (exit 0) shows headers at `reminder-context-resolution.js:132-133`, normalization at `:156-158`, and display stripping/numbering rules at `reminder-display-selection.js:302,314`. Concrete fix: enumerate which literals/regex declarations and counts form this ratchet, then add a red case for each governed category (or explicitly explain why it is excluded).
  Observed input: `CONTEXT_BLOCK_HEADER`, `LIVE_MESSAGE_HEADER`, `MarkerShape`, `MarkerLine`, and the numbering-strip regex in the cited source lines.
  Affected scope: context block construction, marker neutralization, and display-side marker/number removal.
  Falsifier: a proposed extra marker/numbering format outside the documented governed set is intentionally allowed and the plan states why it cannot affect the wire protocol.

- [Should] Fill the relay's Definition of Done placeholder so a later reviewer has the agreed pass criteria, rather than inferring them from the plan. Observed input: `Definition of Done: _<fill in the acceptance criteria the Reviewer grades against>_` at `PROJECT/RELAY/gh261-plan-qa.md:59`.

- [Pass] The plan correctly keeps the guard non-runtime and includes explicit growth/shrink handling and post-change verification; see `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:39,43-55`.

VERDICT: FAIL

Basis: the intended ratchet can be implemented, but its two highest-risk inventories lack defined match sets and therefore cannot reliably distinguish an intentional source change from a missed pattern or an accidental baseline choice. No other pre-existing defect was found in the reviewed artifact.

Handing off to Producer — go to the Producer window and say “take your turn”.

### Producer · Round 1

- Implemented: fixed matcher boundaries in the plan: executable `Key task` literals/regexes after comment stripping, excluding the named sole writer, with every included location recorded in the baseline.
- Implemented: narrowed and enumerated the context counter to `CONTEXT_BLOCK_HEADER` and `LIVE_MESSAGE_HEADER`; marker neutralization and stripping are explicitly excluded as consumers rather than undisclosed omissions.
- Implemented: filled the relay Definition of Done with the agreed requirements and non-runtime boundary.

Handing off to Reviewer — re-review the revised plan and approve only if its fixed matcher set, baseline evidence, red controls, rollback, and no-runtime-change boundary are adequate.

### Reviewer · Round 2

swept file: yes

- [Blocker] The proposed Key-task matcher still has no executable match rule: it says only “string/regex sites after comment stripping,” while the recon says specifically “after line-comment stripping.” That does not exclude block/JSDoc comments, so the counter cannot be reproduced without an implementer choosing an unstated parser/regex boundary. Probe: `$ rg -n -e 'DecisionSpec\\s*=\\s*Object\\.freeze' -e 'Key task' -e 'Threshold|threshold' -e 'source\\s*[:=]' -e 'CONTEXT_BLOCK_HEADER|LIVE_MESSAGE_HEADER' src/reminders-ai-pipeline.js src/reminder-display-selection.js src/reminder-context-resolution.js src/reminders-module.js src/reminders-display-utils.js src/slack-format-utils.js src/chat-commands/show-me-projects-command.js` (exit 0) returned non-executable Key-task occurrences at `src/reminders-display-utils.js:160`, `src/slack-format-utils.js:260`, and `src/chat-commands/show-me-projects-command.js:203`, alongside executable sites such as `src/slack-format-utils.js:273` and `src/chat-commands/show-me-projects-command.js:211`. Concrete fix: specify one lexical rule that recognizes JavaScript string/regex tokens (or explicitly strips both line and block comments while preserving literals), and record its expected included `file:line` output in the baseline contract.
  Observed input: the quoted probe's block/JSDoc comment matches at `reminders-display-utils.js:160`, `slack-format-utils.js:260`, and `show-me-projects-command.js:203`, versus the plan's “line-comment stripping” at `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:24` and “string/regex sites” at `:35`.
  Affected scope: every `src/**/*.js` Key-task occurrence evaluated by the planned inventory.
  Falsifier: the documented lexical matcher excludes those three comment locations while including the actual parser sites at `slack-format-utils.js:273` and `show-me-projects-command.js:211`.

- [Pass] The revised plan now limits the context count to the two declared headers and explicitly excludes marker consumers; `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:25,35`.
- [Pass] The three required red controls and the guarded shrink/update flow are explicitly present; `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:37-38,49-51`.

VERDICT: FAIL

Basis: the plan is otherwise bounded to a non-runtime ratchet with a baseline and red controls, but the remaining ambiguous Key-task lexical boundary defeats the stated reproducibility goal. No other pre-existing defect was found in the reviewed artifact.

Handing off to Producer — go to the Producer window and say “take your turn”.

### Producer · Round 2

- Implemented: replaced the ambiguous Key-task lexical description with six named executable parser/rewriter sites, each to be pinned by an operation plus literal/regex matcher and stored `file:line` location in the baseline.
- Implemented: documented all exclusions: the single writer, the bullet-based reader without a Key-task token, and every prose/JSDoc comment.

Handing off to Reviewer — re-review the exact six-site Key-task boundary and the earlier matcher, baseline, red-control, and non-runtime constraints.

### Reviewer · Round 3

swept file: yes

- [Pass] The Key-task counter is now reproducible without comment parsing: the artifact limits it to six named parser/rewriter sites and requires an operation plus literal/regex token and baseline `file:line`; `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:24-25,35`. Probe: `$ rg -n -C 2 -e 'Key task' -e 'DecisionSpec\\s*=\\s*Object\\.freeze' -e 'CONTEXT_BLOCK_HEADER|LIVE_MESSAGE_HEADER' src/slack-format-utils.js src/chat-commands/show-me-projects-command.js src/reminders-module.js src/reminders-ai-pipeline.js src/reminder-context-resolution.js` (exit 0) confirmed the six executable locations at `src/slack-format-utils.js:239,273,320,410`, `src/chat-commands/show-me-projects-command.js:211`, and `src/reminders-module.js:2787`, while the excluded prose occurrences remain distinct.
- [Pass] The plan covers all five bounded counters, preserves exact-baseline growth and shrink behavior, and specifies the three red controls; `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:35-38,43-51`.
- [Pass] The implementation remains a structural, non-runtime guard with limited script/baseline/npm/CI/AGENTS/test-receipt scope and an explicit rollback; `.relay-artifacts/GH-261-REMINDER-PIPELINE-RATCHET.md:29-30,39-45`.

VERDICT: PASS

Basis: The fixed inventories, baseline protocol, red controls, and non-runtime boundary satisfy the Definition of Done. No pre-existing defect was found in the reviewed artifact.

relay closed (Approved), no further turn needed.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
