# RELAY · GH-249 plan QA — hourly read-only git-pulse mirror (prod)
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
6. **Commit only the relay file** (`relay(gh-249-plan-qa-hourly-read-only-git-pulse-mirror-prod): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/1-INBOX/GH-249-GIT-PULSE-MIRROR.md` (the plan). Source paths it
  relies on, read them: `deploy/reminders-export/` (all files — the precedent being extended),
  `ARCHITECTURE.md` section "Local Reminder Export Mirror", `skills/talk-to-reminders/query-reminders.mjs`
  (~line 47, existing consumer path default), `docs/server-installation-guide.md` ("Password
  Metacharacter Gotcha"), `PROJECT/1-INBOX/GH-86-RUNTIME-STATE-LOCATION.md` (live-tree derivation rule).
  Issue text: GH-249 is transcribed in the plan's "Ask"; GH-101 (export unit hardcodes the dead
  `/root/sleuth-app/.env.runtime` with a `-` prefix) and GH-248 (first consumer) are summarized there.
- **Operational envelope:** one production Debian 12 box, root-run systemd units, single operator,
  one private ~15 MB git repo pulled hourly, read-only. Grade against that and the stated
  requirements — NOT enterprise multi-tenant threat models. Commensurate complexity: this is a
  ~25-line shell script + 2 units + an installer + docs. Challenge any machinery the plan adds that
  the requirements don't need, as hard as anything it is missing. No new test suites (deploy shell
  precedent has none); verification is static checks + a prod smoke.
- Questions:
  1. Is every claim in "Recon" grounded in the cited paths (precedent layout, GH-101 defect, consumer
     default `$HOME/git-pulse-sync`)? Cite file:line for any you dispute.
  2. Does the plan genuinely extend the `deploy/reminders-export/` pattern rather than build a
     parallel subsystem? Is anything duplicated that should be shared?
  3. Token handling: does the inline `git -c credential.helper='!f(){ …$SLEUTH_RAG_GITHUB_PAT… }; f'`
     keep the token out of `.git/config`, the remote URL, argv/`ps`, and the journal? Any leak path missed
     (e.g. `git clone` persisting `-c`, error messages echoing URLs, `set -x`)?
  4. Live-tree derivation: is reading only `SLEUTH_RAG_GITHUB_PAT` via literal `sed` from
     `$(systemctl show sleuth-app -p WorkingDirectory --value)/.env.runtime` correct and robust enough
     (quoted values? CRLF? empty WorkingDirectory)? Keep answers commensurate.
  5. Read-only contract: is `fetch origin <branch>` + `reset --hard FETCH_HEAD` correct for a mirror
     the server never commits to? Is dropping `flock` justified given systemd oneshot semantics?
  6. Is keeping the private repo name out of the committed files (required: public repo) fully
     achieved by `/etc/default/sleuth-git-pulse-mirror` written by `install.sh <owner/name>`?
  7. Are the verification steps falsifiable — do the red controls (missing env file, empty PAT) and the
     smoke (fresh clone, idempotent rerun, dirty-file reset, leak check) actually detect the failures
     they claim to? Anything required by the acceptance criteria left unverified?
  8. Is the rating `60/20/50/85` grounded per the rationale given?
- Output: graded findings with file:line citations, then VERDICT. Approve if no Blocker/Should remains.
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: the plan satisfies every GH-249 acceptance criterion (listed in the plan's "Ask"),
  is grounded in the real paths, extends the existing pattern without a parallel subsystem, avoids the
  GH-101 defects, keeps secrets and the private repo name out of this public repo, and has falsifiable
  verification — with no unrequested machinery.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
