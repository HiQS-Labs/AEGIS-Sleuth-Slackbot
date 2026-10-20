# RELAY · GH-249 final QA — git-pulse mirror implementation + prod receipt
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
6. **Commit only the relay file** (`relay(gh-249-final-qa-git-pulse-mirror-implementation-prod-receipt): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: the completed GH-249 diff from base commit 0f15b89 (origin development at task start) to HEAD, i.e. git diff 0f15b89..HEAD. Files:
  `deploy/git-pulse-mirror/` (all 5 files — the implementation), `ARCHITECTURE.md` (Server-side mirror paragraph),
  `docs/server-installation-guide.md` (new optional section), `CHANGELOG.md` (top entry),
  `PROJECT/2-WORKING/GH-249-GIT-PULSE-MIRROR.md` (approved plan + **production smoke receipt** at the bottom),
  `PROJECT/2-WORKING/GH-249-smoke/{smoke.sh,leak-check.sh}` (the exact scripts that produced the receipt).
  Ledger files (`releases.db/.sql`, `RELEASES-PREVIEW.html`, `ROADMAP-DASHBOARD.md`) are generated by the CLI — skip them.
  Plan QA record: `PROJECT/RELAY/gh-249-plan-qa.md` (approved r2). Precedent: `deploy/reminders-export/`.
- **Operational envelope:** one production Debian 12 box, root-run systemd units, single operator, one private
  ~30 MB repo pulled hourly, read-only. Commensurate complexity: ~45-line script + 2 units + installer + docs.
  Grade against GH-249's acceptance criteria (plan "Ask") — not enterprise threat models. No new test suites
  (deploy shell precedent has none); the production receipt is the verification evidence.
- Questions:
  1. Does `sync-git-pulse-mirror.sh` implement exactly what the approved plan specifies (live-tree derivation with
     empty rejection, literal PAT read, top-level `git -c` helper, credential-free URL, clone vs fetch+reset)? Any
     divergence from the plan, any bug (quoting, `set -e` interactions, `$HOME` unset under systemd — note the config
     file sets an absolute `SLEUTH_GIT_PULSE_DIR`)?
  2. Token safety: any path where the PAT could reach `.git/config`, the URL, argv, or the journal (e.g. git error
     messages, `${VAR:?}` messages)? Does the receipt's leak check substantiate the claim?
  3. `install.sh`: idempotent as claimed? Safe on first install vs. update (no-arg) vs. missing config? Is mode 600 on
     `/etc/default/…` actually achieved by `umask 077` on a pre-existing file?
  4. Units: does `EnvironmentFile` without `-` + `Type=oneshot` + `TimeoutStartSec` + the timer settings match the plan
     and the receipt (next elapse, `Result=resources` on missing config)?
  5. Does each GH-249 acceptance criterion have matching evidence in the receipt? Name any that does not.
  6. Is the private repo name, host, IP or any secret path committed anywhere in the diff (public repo)?
  7. Did a duplicate subsystem or a parallel writer slip in versus `deploy/reminders-export/`? Is anything over-built?
  8. Does the persisted rating `60/20/50/85` (plan frontmatter / ledger) still match the evidence?
- Output: graded findings with file:line citations, then VERDICT. Approve if no Blocker/Should remains.
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: implementation matches the approved plan; every GH-249 acceptance criterion is substantiated by the production receipt; no secret or private identifier committed; no unrequested machinery.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
