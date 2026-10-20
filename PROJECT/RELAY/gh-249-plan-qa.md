# RELAY · GH-249 plan QA — hourly read-only git-pulse mirror (prod)
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Approved
ROUND: 2 / 3

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

### Reviewer · Round 1 · codex

Block — plan corrections required; no artifact/source edits made.

swept file: yes

Reviewed the entire GH-249 plan and all eight files in `deploy/reminders-export/`, plus the named architecture, consumer, server-guide and GH-86 references. No additional defects in the plan beyond the findings below. Source inspection, not a production attestation: `temp/SOP.md` is absent in this checkout, so live host/PAT/disk claims were not independently re-probed. Graph Verify orientation: nearest indexed project `aegis-sleuth-slack-bot`, generation `2026-10-13T00:42:44Z`, belongs to another checkout; coverage reports deploy/docs excluded and GH-249 absent. Current seeded source reads therefore supply the evidence.

- **[Should] S1 — Correct the existing-reader claim and document the actual env mapping.** Plan `PROJECT/1-INBOX/GH-249-GIT-PULSE-MIRROR.md:42-44` says readers work unchanged, but `skills/talk-to-reminders/query-reminders.mjs:47` assigns the **literal** string `'$HOME/git-pulse-sync/sync/sleuth'`, and lines 103-107 pass it directly to `path.join`/readFile and exit 2 on absence. JavaScript does not expand `$HOME`. It also reads `SLEUTH_MIRROR_DIR`, not the proposed `SLEUTH_GIT_PULSE_DIR`. Cheapest fix: correct Recon and include an explicit consumer invocation/config mapping `SLEUTH_MIRROR_DIR="${SLEUTH_GIT_PULSE_DIR:-$HOME/git-pulse-sync}/sync/sleuth"`; keep a reader code fix outside this mirror-only task.
  Observed input: consumer line 47 with `SLEUTH_MIRROR_DIR` unset; static probe `python3` extracted that assignment and printed `default_is_absolute=False`, `default_contains_literal_HOME=True` (exit 0).
  Affected scope: this named consumer invoked without its own absolute directory override; the mirror's default directory itself is sensible.
  Falsifier: an explicit absolute `SLEUTH_MIRROR_DIR` pointing at the populated `sync/sleuth` directory must allow the reader to load; a literal `$HOME/...` path must not be described as expansion. Reproduce the real reader invocation in the later smoke/clone run.

- **[Should] S2 — Make the reset smoke fail when reset is removed.** Plan line 114 says “touch a tracked file … confirm it is reset.” Touch changes timestamps, not bytes, so this check can pass even with no reset at all. Replace it with an actual content edit in the dedicated mirror, assert dirty before the run, then assert original bytes and clean status afterward. Also explicitly assert current branch `main` and HEAD equality with `origin/main`, rather than only the abbreviated comparison at lines 110-111; these are acceptance requirements at line 21.
  Observed input: the literal “touch a tracked file” instruction at line 114. Scratch-only probe `python3` wrote `b"tracked-content\n"`, hashed it, applied `os.utime(p, None)`, and hashed again: `touch_content_unchanged=True`, `no_reset_needed_for_byte_comparison=True` (exit 0; file under `.relay-scratch/tmp/touch-control.txt`).
  Affected scope: the planned dirty-file reset verification, not a request to add a cleanup subsystem or new test suite.
  Falsifier: a content-changing edit must remain dirty if reset is deliberately omitted in an isolated clone, and disappear after the real service run. **[Unverified — needs clone run]** for that executable red control; no Git or fixtures were run here.

- **[Should] S3 — Close the credential-verification gaps without leaking through the check itself.** Plan line 115's `grep -r <token> ...` puts the search token in the scanner's argv if followed literally, while lines 115-117 omit any `ps` observation despite the requirement at line 22. “Compared without printing it” does not keep argv private. Specify a scanner that reads the token internally/from protected input, emits only pass/fail, and examines config, remote, journal and sampled Git/helper argv during authentication. Add a missing **derived live `.env.runtime`** red control: line 108 only removes `/etc/default/sleuth-git-pulse-mirror`, a different file. Keep the live app's credentials intact; exercise the missing-runtime-file control in isolation. Record exact commands/status and sanitized outcomes in the planned receipt.
  Observed input: line 115's token-as-pattern command; Verification lines 107-117 contain no `ps` check and only the config-file-absent/empty-PAT cases. Static Python inspection of the Verification section returned `verification_mentions_ps=False` (exit 0).
  Affected scope: the plan's security and credential-loading verification, not an observed production leak or a demand for enterprise hardening.
  Falsifier: a dummy secret deliberately inserted into each inspected surface must make the scanner fail without appearing in its own argv/output; missing derived runtime env must fail before network access, with a named non-secret error. The intact configuration must succeed. **[Unverified — needs clone run]** for executable controls.

- **[Pass] Pattern reuse and scope are proportionate.** The proposed installer/service/timer layout and outside-app script directory (plan lines 63-96) match `deploy/reminders-export/install.sh:27-40` and its `Type=oneshot` service at line 8. A separate pull script is appropriate: the precedent publisher uses the contents API (`publish-reminders-export.mjs:53-84`), not a reusable clone/fetch implementation. No framework extraction, app change, lock layer or new suite is warranted for this envelope.
- **[Pass] Repo-side grounding for GH-101 and GH-86.** The problematic `EnvironmentFile=-/root/sleuth-app/.env.runtime` is present at `deploy/reminders-export/sleuth-reminders-export.service:11`; derivation from systemd is prescribed at `PROJECT/1-INBOX/GH-86-RUNTIME-STATE-LOCATION.md:71-79`. Literal reading avoids the sourcing issue described in `docs/server-installation-guide.md:264-269`. This supports the design, not the unobserved deployed-state assertions.
- **[Nit] Pin small implementation details rather than infer them from the auth ellipsis.** Plan lines 70-78 should say to reject an empty WorkingDirectory before joining `.env.runtime`, define supported PAT assignment spelling (plain literal versus quoted/CRLF), export the PAT for the helper, use a credential-free HTTPS URL, disable xtrace, and put `-c` before the `clone` subcommand (not clone's persistent `-c` option). These are implementation review points, not evidence of a current leak. No actual helper or script exists in this artifact to certify.
- **[Nit] Verification/receipt clarity.** Add timer enabled/next-hourly-elapse evidence (plan line 85) and distinguish `.git/FETCH_HEAD` mtime as last fetch freshness from upstream export-data freshness (line 95). Rating `60/20/50/85` has a coherent rationale at lines 122-127, but effort's live-prerequisite evidence remains the producer's assertion here; soften “Uncertainty: none material” until the cited deployment receipt exists.

Root cause: the plan treats a documented path and nominal smoke commands as stronger evidence than their actual source/inputs support; Fix site: Recon, consumer instructions and Verification in GH-249; Why not upstream/downstream: these corrections make this plan falsifiable without expanding its mirror-only implementation scope.

VERDICT: FAIL
Basis: S1-S3 remain open; architecture and scope are sound, but consumer compatibility and required verification are not yet adequately specified. No observed runtime Blocker is claimed.

Handing off to Producer claude-a — correct/disposition S1-S3 in the plan and log the next round; go to the Producer window and say 'take your turn'.

### Producer · Round 2 · claude-a

Dispositions (plan edited in place: `PROJECT/1-INBOX/GH-249-GIT-PULSE-MIRROR.md`):

- **S1 — Implemented.** The Recon claim is corrected: the literal `'$HOME/...'` default at `query-reminders.mjs:47` is not expanded, and the reader uses `SLEUTH_MIRROR_DIR`. The plan now prescribes the explicit mapping `SLEUTH_MIRROR_DIR="${SLEUTH_GIT_PULSE_DIR:-/root/git-pulse-sync}/sync/sleuth"`, documented in the README. The main-path smoke now runs the real reader (`node skills/talk-to-reminders/query-reminders.mjs --json --limit 1` with that env), which must exit 0. The reader-default fix stays out of scope (mirror-only).
- **S2 — Implemented.** "touch" is replaced by an appended line: assert dirty, run the service, assert clean, and assert the sha256 matches the pre-edit value. The smoke also asserts the full 40-char HEAD equals the `ls-remote refs/heads/main` SHA, `symbolic-ref` = `main`, and empty porcelain.
- **S3 — Implemented.** The leak scanner reads the PAT itself inside the script and passes it to `grep -F -f <(printf …)` through a pipe, never argv. It covers `.git/config`, `remote -v`, the journal, and `ps -eo args` sampled at 0.1 s during a forced fetch, printing PASS/FAIL only, with a positive control (a temp file holding the token must FAIL). Added the derived-runtime-env-missing red control (`SLEUTH_ENV_FILE=/nonexistent`) and an empty-PAT control via a temp env file; the live app env is untouched.
- **Nit 1 — Implemented.** The plan now pins: reject an empty WorkingDirectory; plain `KEY=value`, last match wins, CR stripped, no quote interpretation; PAT exported; top-level `git -c` before the subcommand; credential-free URL; no xtrace; `echo` builtin, so no argv exposure.
- **Nit 2 — Implemented.** Added timer `is-enabled` and next-elapse evidence. The README separates `.git/FETCH_HEAD` (mirror fetch freshness) from payload stamps (upstream freshness, GH-100). The rating's uncertainty wording is softened until the receipt exists.

Handing off to Reviewer codex — re-review the revised plan.

### Reviewer · Round 2 · codex

Ship — plan approved; implementation and deployment verification remain future work.

swept file: yes

Read the entire revised 150-line plan, all eight files under `deploy/reminders-export/`, and the named architecture, consumer, server-guide and GH-86 references. No additional Blocker/Should defects found in the plan, including its unchanged sections. Graph tools are unavailable in this turn, so current seeded source reads provide the evidence; no graph generation or coverage result is claimed. `temp/SOP.md` is absent, so the producer's live-host/prerequisite statements remain attributed assertions rather than independently verified deployment facts. No Git, suites, executable fixtures or production operations were run.

- **[Pass] S1 closed at plan level.** `PROJECT/1-INBOX/GH-249-GIT-PULSE-MIRROR.md:44-49` correctly identifies the literal `$HOME` default and the distinct consumer variable; lines 127-129 require the real reader invocation with an absolute override. This matches `skills/talk-to-reminders/query-reminders.mjs:47,103-107`. The reader fix stays outside the mirror task.
- **[Pass] S2 closed at plan level.** Plan lines 123-134 now require a full upstream SHA comparison, branch `main`, clean porcelain, installer rerun, and a content-changing append with dirty-before/clean-after and original-byte hash assertions. Removing reset can no longer satisfy the specified tracked-file control merely because touch left bytes unchanged. **[Unverified — needs clone run]** for executed reset/idempotency controls and runtime behavior.
- **[Pass] S3 closed at plan level.** Plan lines 117-122 cover missing service config, missing runtime env and empty PAT without editing the live app env. Lines 135-140 feed the scanner pattern through process substitution, cover config/remote/journal/sampled argv, and require a positive control. Narrow scratch probe command: `bash -c 'PAT=relay_dummy_secret; printf "%s\n" "$PAT" > "$TMPDIR/scanner-positive.txt"; printf "%s\n" safe > "$TMPDIR/scanner-negative.txt"; if grep -qF -f <(printf "%s\n" "$PAT") "$TMPDIR/scanner-positive.txt"; then echo positive_control=FAIL_detected; else exit 1; fi; if grep -qF -f <(printf "%s\n" "$PAT") "$TMPDIR/scanner-negative.txt"; then exit 1; else echo negative_control=PASS; fi'`, with `TMPDIR="$PWD/.relay-scratch/tmp"`; exit 0, decisive output `positive_control=FAIL_detected` and `negative_control=PASS`. This measures scanner matching only. **[Unverified — needs clone run]** for actual authentication surfaces; periodic argv sampling is observational evidence, not proof that no shorter-lived process can leak.
- **[Pass] Scope and implementation contract remain proportionate.** Plan lines 75-101 specify live-tree derivation, empty-directory rejection, literal PAT parsing, nonpersistent top-level Git config, credential-free HTTPS, no xtrace, and systemd serialization. Layout follows `deploy/reminders-export/install.sh:27-40` and `sleuth-reminders-export.service:8`; the new unit avoids that service's optional hardcoded env file at line 11. Server-only repo configuration at plan lines 97-99 keeps the private name out of committed artifacts. No shared framework, lock layer or new suite is needed. Rating rationale at lines 146-150 is reasonable for the stated envelope, subject to the future receipt.
- **[Nit] Allow the configured jitter in the timer smoke.** Plan line 127 says the next elapse is “within the hour,” while lines 95-96 add up to five minutes of randomized delay. Compare against the hourly boundary plus that delay (and ordinary timer accuracy), rather than rejecting a valid next elapse just over 60 minutes away. This is a smoke wording correction, not a reason to change the timer design.

Root cause: prior consumer assumptions and weak smoke instructions; Fix site: the revised plan's Recon and Verification; Why not upstream/downstream: the explicit mapping and falsifiable controls resolve plan readiness without expanding the mirror task.

VERDICT: PASS
Basis: S1-S3 are addressed, no Blocker/Should remains, and the plan meets the stated scope with bounded verification. Approval certifies plan readiness, not an implemented script or deployed service.

Relay closed (Approved), no further turn needed. Producer claude-a receives the approved plan for implementation through the normal harness gates.


### Attestation · relay-drive — 2026-10-20T23:36:07Z
task: RELAY-gh-249-plan-qa
reviewer: codex
status: Approved
reviewed-head: eda57b409369aaef2eaaafe570b9ca237049fc58
added-range: 18182+4384
added-sha256: a856b39b086eb0a954e37c93c14f88d21d627f7776cc7132bf75c23449474110
<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
