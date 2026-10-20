# RELAY · GH-249 final QA — git-pulse mirror implementation + prod receipt
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

### Reviewer · Round 1 · codex

Block — one bounded installer correction required.

swept file: yes

Read all five implementation files, both smoke scripts, the full GH-249 plan/receipt and prior plan-QA record, the full architecture and server guide, and the scoped top CHANGELOG entry. No additional Blocker/Should defects found, including in unchanged portions of those reviewed files. Generated ledger files excluded as instructed. Graph Verify orientation found only another checkout (`aegis-sleuth-slack-bot`, generation `2026-10-13T00:42:44Z`); coverage excludes deploy/docs/changelog and lacks the new GH-249 files. Current seeded source reads are the evidence. `temp/SOP.md` is absent: all production outcomes below are attributed to the supplied receipt, not independently asserted live state. No Git, suites, executable fixtures or production operations ran; only shell syntax checks and a scratch-only permission primitive probe. Only this relay file was edited.

- **[Should] S1 — Enforce the promised config mode on existing files.** `deploy/git-pulse-mirror/install.sh:19-26` sets `umask 077` only when an argument is supplied and truncates the existing config with `>`; neither truncation nor the no-argument path changes its mode. This violates the mode-600 contract in the plan at `PROJECT/2-WORKING/GH-249-GIT-PULSE-MIRROR.md:107-109` and README line 26, potentially making the private repo name readable to other local users. Cheapest correction: explicitly `chmod 600 "$CONFIG"` on both successful config paths, before enabling/running the service. Keep no-arg config contents unchanged; no new suite needed.
  Observed input: a pre-existing mode-644 config rewritten with the installer's exact `printf`/redirection primitive stays 644. Command (with `TMPDIR="$PWD/.relay-scratch/tmp"`): `bash -c 'CONFIG="$TMPDIR/mode-existing"; printf old > "$CONFIG"; chmod 644 "$CONFIG"; umask 077; printf "SLEUTH_GIT_PULSE_REPO=%s\nSLEUTH_GIT_PULSE_DIR=%s\n" example/mirror /root/git-pulse-sync > "$CONFIG"; ls -l "$CONFIG"'`. Exit 0; decisive output `-rw-r--r--@ ... 79 ... .relay-scratch/tmp/mode-existing`. A separate new-file control printed `new_config_mode=0o600`, versus `existing_config_mode=0o644` for overwrite.
  Affected scope: existing config files with permissions other than 600, on argument-supplied reinstalls and no-argument updates; fresh files already get 600.
  Falsifier: in the producer's disposable clone, seed a 644 config, perform each installer path, and require mode 600 afterward, with no-arg contents unchanged; a fresh install and an already-600 rerun must still succeed. If overwrite alone changes the original 644 file to 600, the hypothesis is disproved. Full installer exercise: **[Unverified — needs clone run]**.

- **[Pass] Sync implementation follows the approved contract.** `sync-git-pulse-mirror.sh:11-28` has required repo, lazy HOME fallback (the installer writes an absolute directory at line 21), empty WorkingDirectory rejection, readable-file and nonempty-token guards, literal last-match parsing and CR removal. Lines 31-40 put credential configuration before the Git subcommand, clear inherited helpers, keep the URL credential-free, and implement clone versus fetch/reset. There is no value expansion into helper argv or persistent clone configuration in those lines. No PAT-bearing error message is constructed in lines 11, 20, 23 or 27. This is source inspection, not certification of every possible external Git environment.
- **[Pass] Units and evidence cover the acceptance checklist at the stated level.** Service lines 7-12 use oneshot, mandatory EnvironmentFile and 300-second timeout; timer lines 7-10 specify boot, hourly, five-minute delay and persistence. The receipt at `PROJECT/2-WORKING/GH-249-GIT-PULSE-MIRROR.md:173-187` records red controls, clean main/full authenticated SHA comparison, valid JSON, enabled timer/next elapse, real reader, byte-identical no-arg rerun, tracked-content reset, positive leak control and scanned surfaces. These correspond to `smoke.sh:23-32,35-61` and `leak-check.sh:5-19`. No issue acceptance criterion lacks a corresponding receipt entry or source/doc evidence; the additional promised existing-file mode guarantee lacks evidence and fails S1. Syntax-only command `bash -n deploy/git-pulse-mirror/install.sh deploy/git-pulse-mirror/sync-git-pulse-mirror.sh PROJECT/2-WORKING/GH-249-smoke/smoke.sh PROJECT/2-WORKING/GH-249-smoke/leak-check.sh` exited 0. Runtime reruns remain **[Unverified — needs clone run]** in this reviewer turn.
- **[Pass] Scope, privacy and rating are proportionate in the supplied artifacts.** The new files contain placeholders rather than a private repo name, host/IP or operator credential-file path; config is server-only (`install.sh:16,21`). Consumer path, explicit override and separate freshness clocks are documented at README lines 69-80, architecture line 243 and server-guide lines 185-190. The precedent publishes through the contents API (`deploy/reminders-export/publish-reminders-export.mjs:53-84`); the new puller reads, so it is not a competing publisher or parallel app subsystem. No shared framework or lock layer is warranted. Rating `60/20/50/85` remains reasonable under the rationale at plan lines 157-161 and the supplied receipt; generated ledger rows were not independently audited.
- **[Nit] Qualify the leak scanner's evidence.** `leak-check.sh:8,12-19` maps any non-match/error to PASS, does not check collection success, and counts lines containing `git` rather than proving a specific authentication process was observed. The positive control validates matching, but not successful collection of every surface; 0.1-second sampling cannot exclude shorter-lived argv. The receipt is useful observational evidence, not exhaustive proof. For future runs, distinguish collection/grep errors from clean scans and record that the intended fetch was observed; do not add a scanner subsystem or suite for this.
- **[Nit] Tighten two README claims without adding cleanup machinery.** Lines 21-22 say “anything written” is discarded, but `reset --hard` at sync-script line 40 generally preserves unrelated untracked files; say tracked edits instead. Line 14's “±5 min” should be “up to 5 min after” the hourly boundary, matching timer line 9.
- **[Nit] Pre-existing architecture inventory drift surfaced by the full sweep.** `ARCHITECTURE.md:236-237` describes `activeOnly:true` and no completed history, while the current publisher defaults `ACTIVE_ONLY` to `false` and publishes a bounded completions export (`deploy/reminders-export/publish-reminders-export.mjs:28-38` and its final publish block). Reconcile that older inventory separately against the actual export contract; the new mirror does not create this discrepancy, and no live export configuration is inferred here.

Root cause: the installer treats a creation-only umask as an ongoing file-permission guarantee; Fix site: the installer after config creation/reuse; Why not upstream/downstream: the installer owns this server-only config and can establish its promised mode directly.

VERDICT: FAIL
Basis: S1 remains open. Core sync, scope and the acceptance-to-receipt mapping are sound; approval awaits the small permission correction and bounded clone evidence.

Handing off to Producer claude-a — disposition S1 and the nits, apply the bounded correction and provide clone evidence; go to the Producer window and say 'take your turn'.

### Producer · Round 2 · claude-a

- **S1 — Implemented.** `deploy/git-pulse-mirror/install.sh`: `chmod 600 "$CONFIG"` after the config if/elif, covering both the rewrite (arg) and reuse (no-arg) paths. Falsifier run on production with the fixed installer: seed 644 → no-arg `644->600`, contents sha unchanged; seed 644 → arg `644->600`, unchanged; already-600 rerun `600->600`; all rc=0; service `Result=success`; mirror porcelain empty. Recorded in the plan doc's receipt ("Final QA r1 follow-up").
- **Nit (leak scanner) — Modified.** The receipt now states the evidence's scope: observational, the positive control proves the matcher, `ps` sampling can't exclude shorter-lived argv, and the primary guarantee is structural (helper holds the variable name, builtin `echo`, credential-free URL). No scanner changes (no new machinery).
- **Nit (README) — Implemented.** "edits to tracked files are discarded (untracked files are left alone)"; timer "up to 5 min after the hour".
- **Nit (ARCHITECTURE inventory drift) — Declined here, parked.** Pre-existing, not caused by GH-249. Filed in the local (gitignored) `PARKED/` ledger as P-001.

Handing off to Reviewer codex — re-review S1 and the touched files.

### Reviewer · Round 2 · codex

Ship — S1 closed; no Blocker/Should remains.

swept file: yes

Read all five implementation files, both smoke scripts, the complete plan/receipt and plan-QA record, the full architecture and server guide, and the scoped GH-249 CHANGELOG entry. No additional Blocker/Should defects found, including in unchanged portions of those files. The pre-existing architecture inventory nit from round 1 remains a separate follow-up; the producer's claimed local parking entry was not independently checked. Generated ledgers excluded as instructed. Graph Verify orientation and coverage again point to another checkout, generation `2026-10-13T00:42:44Z`; deploy/docs/changelog are excluded and GH-249 paths absent, so current seeded source reads supply the evidence. `temp/SOP.md` is absent: production results below are attributed to the supplied receipt, not an independent live-state assertion. No Git, suites, executable fixtures or production operations ran; only non-executing static checks. Only this relay file was edited.

- **[Pass] S1 closed at the owning boundary.** `deploy/git-pulse-mirror/install.sh:19-27` now executes `chmod 600 "$CONFIG"` after both successful configuration paths, before installation and service startup at lines 29-36. The no-argument path does not rewrite contents; missing config still exits 2 at lines 23-25. With `set -e` at line 12, failed chmod prevents service startup. The supplied follow-up receipt at `PROJECT/2-WORKING/GH-249-GIT-PULSE-MIRROR.md:194-198` records both 644→600 paths with unchanged contents, an already-600 rerun, all rc=0, service success and a clean mirror. This directly addresses S1's original failing input. An independent full installer rerun here is **[Unverified — needs clone run]**; the recorded production exercise is accepted as the bounded runtime evidence required by Setup.
- **[Pass] README and leak-evidence dispositions accepted.** README lines 14 and 21-23 now say “up to 5 min after the hour” and tracked edits, explicitly preserving untracked files. Plan/receipt lines 199-202 qualify sampling and distinguish structural credential handling from observational scans. Sync-script lines 25-33 and 37-40 still read/export the literal token, keep the helper's variable expansion deferred, clear inherited helpers, and use credential-free clone/fetch authentication without persistent config. No new scanner or cleanup machinery was added.
- **[Pass] Acceptance mapping and proportionality remain sound.** Plan/receipt lines 173-187 cover missing-input controls, authenticated main SHA equality, branch/clean state, data parsing, enabled timer/next elapse, the real reader, rerun stability, tracked-content reset, and token scans with a positive control. Service lines 7-12 and timer lines 7-10 match the plan. Consumer path, override and separate freshness clocks remain at README lines 69-80, architecture line 243 and server-guide lines 185-190. The supplied implementation uses placeholders and server-only repo configuration (`install.sh:16,21`), with no private repo identifier or credential value found in the scoped artifacts. Rating `60/20/50/85` remains consistent with the bounded task and rationale at plan lines 157-161; generated ledger persistence was not independently audited. No acceptance criterion lacks a corresponding source/doc or receipt entry; the receipt's leak observations retain the limitations above.
- **[Nit] Static-check receipt needs one qualification.** Plan/receipt line 173 says shellcheck passed, but reviewer command `shellcheck deploy/git-pulse-mirror/install.sh deploy/git-pulse-mirror/sync-git-pulse-mirror.sh` exited 1 with only `sync-git-pulse-mirror.sh line 33: SC2016 (info): Expressions don't expand in single quotes`. The quoting is intentional: the credential helper must expand the variable later, inside its shell. Command `shellcheck --exclude=SC2016 deploy/git-pulse-mirror/install.sh deploy/git-pulse-mirror/sync-git-pulse-mirror.sh` exited 0, no output. Qualify the recorded shellcheck invocation when next updating the receipt; preserve the single quotes. Command `bash -n deploy/git-pulse-mirror/install.sh deploy/git-pulse-mirror/sync-git-pulse-mirror.sh PROJECT/2-WORKING/GH-249-smoke/smoke.sh PROJECT/2-WORKING/GH-249-smoke/leak-check.sh` exited 0, no output. All commands used `PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"`; no probe artifacts were generated.

Root cause: creation-only umask did not enforce permissions on an existing config; Fix site: unconditional installer chmod after config creation/reuse; Why not upstream/downstream: the installer owns this file and now enforces its contract before service activation.

VERDICT: PASS
Basis: S1 is addressed in source and the supplied targeted runtime receipt; no Blocker/Should remains. Approval covers the seeded artifacts and recorded evidence, with independent runtime/gate execution left to the harness as instructed.

Relay closed (Approved), no further review turn needed. Producer claude-a receives the completed review for the harness gate and normal delivery.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
