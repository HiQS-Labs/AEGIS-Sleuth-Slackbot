# RELAY · GH-250 phase 4 plan QA — store task structure next to legacy text
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
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
6. **Commit only the relay file** (`relay(gh-250-phase4-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md` (the plan). Source paths
  it relies on, read them: `src/reminders-module.js` (ReminderInfo typedef ~:93-123,
  `UpdateReminderSummaryFromListAsync` ~:1127-1153, `CreateReminderFromListRowAsync` ~:1162-1200,
  `#MakeScheduledReminder` + `ReminderCreated` payload ~:748-830, the Key-task compose ~:2040-2140),
  `src/reminders-projection.js` (fold ~:300-400), `src/reminders-display-utils.js`
  (`ExtractKeyTaskSummaries`, `ExtractCompactSummary`, `BuildCompactTextForReminder`),
  `src/slack-format-utils.js` (`ExtractKeyTasks` ~:267, `ReplaceReminderSummary` ~:302),
  `src/lists-module.js` (~:1339, ~:2620-2740), `src/web-api.js` (~:497, ~:597, ~:1085-1137),
  `src/event-store.js` (REQUIRED_PAYLOAD_KEYS), `scripts/projection-parity-harness.js`.
  Issue text and the consumer inventory: #250 comments, especially
  https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/250#issuecomment-6308099892 .
- **Operational envelope:** a single-process multi-workspace Slack bot persisting reminders to a JSON
  file per workspace, with a non-authoritative event ledger and a projection-parity harness. Grade
  against the stated requirements and commensurate complexity, not enterprise migration frameworks.
  Existing suites only; no new test files.
- Questions:
  1. Are the creation/edit sites and the reader list complete? Name any writer of the task text or
     any reader that breaks without the `Key task(s):` block that the plan misses (file:line).
  2. Does the ledger change keep projection parity (absent stays absent; older readers ignore it)?
  3. Is rollback safe at every point (older binary reading new records/events; ReminderMessageText
     unchanged)? Is "last safe rollback point: any" true?
  4. Can `Tasks` and `ReminderMessageText` drift? Is requirement 3 sufficient, and is the List-row
     path (bare summary, no marker) handled correctly by both the accessor and `ReplaceReminderSummary`?
  5. Is the `?format=rebalance` change additive for rebalanceOS consumers?
  6. Is anything over-built (a second source of truth, a migration, a view object) or missing?
- Output: graded findings with file:line citations, then VERDICT. Approve if no Blocker/Should remains.
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: the plan dual-writes one optional `Tasks` field at every creation and edit site,
  keeps `ReminderMessageText` byte-identical, keeps projection parity and rollback safety, moves the
  breaking readers onto one accessor with a legacy fallback, keeps the rebalance export contract, and
  verifies each with existing suites and a dev smoke — with no unrequested machinery.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
