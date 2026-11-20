# RELAY · GH-331/332 plan QA — GitHub auto-complete crash + closed-issue review skill
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-20.
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
6. **Commit only the relay file** (`relay(gh331-plan): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/1-INBOX/GH-331-GITHUB-AUTOCOMPLETE-CRASH.md` (the plan). Source for the technical pass: `src/github-sync-module.js`, `src/github-comment-relay.js`, `src/reminders-module.js`, `src/app.js`, `tests/github-sync-module.test.js`, `skills/bulk-edit-reminders/SKILL.md`, `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`, `tests/bulk-edit-reminders.test.js`. Issues: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/331 and https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/332
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-20
- Definition of Done: plan QA before any code is written.

**Step 1 — paraphrase first (GH-1414).** Read ONLY the plan file first. Before opening any source file, write in your block: **What this proposes** (2–5 sentences), **How the existing system works, per this document** (2–5 sentences), and **What it's not** (short). Ground exclusions in the plan's sections; label inference. State your input boundary (plan only).

**Step 2 — source-backed assessment.** Then read the source paths above and answer:
1. Is the root-cause claim (circular require: reminders-module → github-comment-relay → github-sync-module → partial `{}`; app.js loads reminders-module first; tests load the sync module first) correct? Cite lines.
2. Is a call-time `require('./reminders-module')` at the single runtime site the smallest correct fix? Any other runtime use of the `RemindersModule` binding in `github-sync-module.js` that would also break?
3. Does the planned red test (isolateModules, reminders-module required first, RunNowAsync over one closed link) fail on the unchanged code for the intended reason and pass after the fix? What prevents an unfixed build from passing it?
4. Skill: does the finder plan avoid a second writer (all writes stay in bulk-edit-reminders)? Is "lookup failure → unknown, never closed" enforced and tested? Is the REST `repos/<o>/<r>/issues/<n>` call right for both issues and PRs (merged state)?
5. Are the ratings and recurrence claims grounded? Anything over- or under-built for the stated envelope?

Operational envelope: existing Node Slack app plus a local operator skill (single operator, private local files). Grade commensurate complexity and this repo's threat model; do not ask for daemons, new services or enterprise machinery.

Required output: graded findings with `file:line`; literal `swept file: yes|no`; exact `VERDICT: PASS|FAIL|PARKED`; `STATUS: Approved` only for PASS. Behaviour-change Blocker/Should requests need `Observed input:`, `Affected scope:`, `Falsifier:`. Do not edit any file except this relay file; scratch probes only under `.relay-scratch/` or `$TMPDIR`; do not run full suites.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1

**What this proposes.** Restore GitHub auto-completion with a call-time import and a regression test that reproduces application load order. Add a local read-only finder and a skill workflow that retires reviewed candidates through the existing bulk editor.

**How the existing system works, per this document.** The application loads reminders first, entering a circular require that leaves the sync module holding an incomplete export. The current sync tests load in the reverse order. The server completes reminders with entirely closed GitHub links, while bulk-edit-reminders supplies the existing backup and completion writer.

**What it's not.** Per “Requirements and smallest viable bet” and “Alternatives and rollback,” this changes neither the server's completion rule nor its polling behavior, introduces no second API writer or daemon, and does not restructure module ownership.

Input boundary for the paraphrase above: plan only; no source files opened.

swept file: yes

Sweep boundary: the entire 69-line plan, including requirements, historical claims, acceptance, alternatives and rollback; source-backed assessment of the named integration paths. This is plan approval, not final implementation QA. No additional blocking pre-existing defect found in the plan.

- [Pass] **Root cause and minimal repair.** `src/reminders-module.js:32` → `src/github-comment-relay.js:3` → `src/github-sync-module.js:3` closes the cycle before the reminders class export (`src/reminders-module.js:4792`). `src/app.js:17` precedes its explicit sync import at line 20; `tests/github-sync-module.test.js:3` starts with sync instead. The only runtime dereference of the imported class in sync is `GetReminderVersion` at line 258; the similarly named object key at line 226 is not a class read. The call-time require in plan line 60 obtains the final cached export without changing the version algorithm (`src/reminders-module.js:848`) or completion guard argument (`src/github-sync-module.js:283`). Keep the proposed fix.
  Static probe: `python3` stripped comments from `src/github-sync-module.js` and printed lines matching `(?<![\w.])RemindersModule\b`; exit 0; decisive output: `3: const RemindersModule = require('./reminders-module');`, `226: RemindersModule: CurrentRemindersModule,`, `258: const ExpectedVersion = RemindersModule.GetReminderVersion(CurrentReminder);`. This is source inspection, not a runtime reproduction.
- [Pass] **Regression design is non-vacuous.** Plan line 59 requires an isolated registry, reminders-first loading, one closed-linked reminder, a completion call with ExpectedVersion, and `Result.ok === true`. On the traced unfixed path, line 258 fails before fetch/completion, the workspace catch at `src/github-sync-module.js:310` marks HadError, and `RunNowAsync` returns false at line 102. Therefore the two positive assertions reject the broken import order. During implementation construct the sync instance from the class obtained INSIDE isolateModules, supply DataLoaded/PAT, start it before RunNowAsync, and stop it in finally, following `tests/github-sync-module.test.js:687` onward. Do not substitute the file-level sync import or mock the reminders export.
- [Unverified — needs clone run] **Red/green execution remains an implementation gate.** There is no new regression test or fixed source yet. The above is a source-backed prediction; witness the intended TypeError on baseline and a passing completion after repair in the disposable clone. No suites or module-starting fixtures were run here, per the turn boundary.
- [Pass] **Single writer and conservative lookup policy are specified.** Plan lines 39 and 61–63 keep the finder off the Sleuth API and delegate completion to bulk-edit-reminders. The existing CLI backs up pending records with exclusive mode-600 creation (`skills/bulk-edit-reminders/bulk-edit-reminders.mjs:252` onward), resolves before writing, exits at dry-run before POST, and uses the bulk endpoint at line 306. Plan lines 61–62 explicitly say “unknown (any lookup failed; never treated as closed)” and require a failing-lookup assertion. These are adequate plan contracts; enforcement and test results remain to be inspected after implementation.
- [Pass] **Issues REST endpoint is sufficient for the proposed binary classification.** Plan line 61 needs open versus closed, not a distinct merged class. GitHub documents that issues endpoints return PRs too, identified by `pull_request`: [GitHub REST issues documentation](https://docs.github.com/en/rest/issues/issues#get-an-issue). A merged PR is closed for this decision. Do not expect a top-level `merged_at` from the issues response; a separate merged label would need additional PR data, but this plan does not require one. Include an ordinary closed PR and a merged-PR-shaped closed issue response in the fake-gh cases when implementing.
- [Nit] **Verification wording.** Plan line 63 says “fresh backup diff showing only the retired IDs left.” The backup is pending-only (`skills/bulk-edit-reminders/SKILL.md:15`), so clarify that retired IDs are absent afterward and appear only as removals in the before/after diff; remaining pending IDs should survive. This is wording clarification, not a new completion behavior.
- [Nit] **Keep historical evidence attribution explicit.** Plan lines 37, 49–55 report 335 errors, the manual review counts, deployment date and no prior issue/PR. Those logs, backup and issue-search receipts are not attached to the seeded plan; they were not independently re-read here. The recurrence interpretation (one continuous failure rather than 335 incidents) and ratings are proportionate if the producer's evidence holds. Add a private evidence pointer or retain attribution rather than presenting this review as independently certifying those counts. No deployment-state claim is made by this review.

VERDICT: PASS

Basis: the complete plan identifies a specific circular-import failure, proposes the smallest runtime repair, defines a regression that cannot pass merely by doing no work, and preserves the existing completion writer and conservative unknown policy. The nits do not block plan approval. Runtime red/green, finder safety enforcement and final gates belong to implementation QA. Optional three-reviewer candidate analysis is unnecessary for this single-operator workflow; ordinary per-candidate review is sufficient under the plan's optional wording.

Relay closed (Approved), no further turn needed. Producer may proceed with implementation and the clone-based gates.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
