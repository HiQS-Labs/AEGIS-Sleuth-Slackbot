# RELAY · GH257 PR259 startup and discovery follow-up QA
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Approved
ROUND: 2 / 4

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
6. **Commit only the relay file** (`relay(gh257-pr259-startup-and-discovery-follow-up-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: src/github-issue-stream-module.js and tests/github-issue-stream-module.test.js (whole files); src/app.js startup caller around 410-455; PROJECT/2-WORKING/GH-257-REVIEW-FIXES.md follow-up section; TESTS-RESULTS/2026-10-20-GH-257/verification.md; RELEASES-PREVIEW.html telemetry and CHANGELOG. Review diff from 40b45a9b883a1417711bd99b95a5988816b5a808, at current committed HEAD.
- Reviewer: codex   ·   Producer: codex-producer
- Started: 2026-10-20
- Definition of Done: Fresh independent QA of later PR259 findings. Scope is the existing local/mock GitHub issue stream; no live services, production/config/auth changes, Slack messages, network communication or executable test suites in reviewer worktree. Thread writes only; scratch read-only source probes allowed. No new store, queue or test suite warranted. Prior QA/CI are historical; focused 46 tests and build pass for this code, full regression and exact-head hosted CI pending.

Questions:
1. Does containing first-run seed/save failures preserve workspace startup, schedule existing polling, and ensure saves still block delivery? Is deferred first successful seed/no backlog behavior faithful; do repeated disk failures stay held before recovery?
2. Does default directory HTTP404 now throw through non-OK handling into the hold path, preserving disk cursors and unread replay after recovery? Successful empty/stale snapshot semantics must remain intact.
3. Are three existing-suite extensions faithful red controls for the actual paths? Is the startup caller consequence grounded without running real app.js?
4. Is regenerated preview telemetry consistent (same UTC date for generatedAt/lastOp, lastSyncDisplay preserved, no future label)? Are initial passing head/CI wording and pending follow-up status accurate?
5. Assess full-state writes as the documented existing JSON/retained-key tradeoff: no compaction or indexed-store rewrite is authorized. Flag concrete scoped defects only, with file:line plus Observed input/Affected scope/Falsifier. No speculative infrastructure. PASS only with actual citations; do not claim to execute pending producer regression/CI.

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

VERDICT: PASS
Basis: Ship for this bounded source-QA gate at `c2eefe22e6d85a76b52191c525081d6de662b0ea`. Read all 827 lines of the module and all 733 lines of its test file, the startup caller, follow-up plan/receipt, preview telemetry and changelog. No concrete additional pre-existing defect found in the swept module/test files. This approval does not qualify the pending full regression or hosted CI.

- [Pass] Startup containment and retry ownership are correctly placed: `src/github-issue-stream-module.js:396-408` catches only initial discovery/seed/save failures and still schedules polling. Cycle entry at `:457` must save before discovery or delivery; `:798-804` rethrows disk errors; the scheduled callback at `:812-823` catches a failed cycle and schedules another while active. Failed discovery leaves the repo unseeded, so `:481-486` seeds it at first successful discovery and skips delivery that cycle. Failed initial save retains its existing in-memory seed for later flushing. No new retry/store mechanism is introduced. The startup consequence is source-grounded: `src/app.js:424` awaits StartAsync before instance registration; its catch at `:445-451` stops Slack. Fix: none.
- [Pass] Default directory HTTP404 now reaches the non-OK throw at `src/github-issue-stream-module.js:185-187`, then the cycle hold/return at `:469-475`, before repo pruning at `:617`. Existing saved cursor values survive the entry flush. Successful empty/stale-only snapshots still return an empty list through `:713-737` and reach pruning; static repo configuration remains on `:683-685`. Fix: none.
- [Pass] Existing-suite extensions target the actual seams: `tests/github-issue-stream-module.test.js:654-695` expands into two cases, intercepts the actual scheduled callback, asserts startup resolution/timer creation, exercises another failed save poll, then recovery. `:697-730` uses the real default client with mocked fetch, asserts the old disk cursor during 404, and asserts its original `since` plus delivery after recovery. The initial-source loose-object diff shows precisely the removed 404 early return, the added startup try/catch, and these three cases. Those old paths would violate the new startup/cursor assertions; this is a static red-control assessment, not a claim of executing Jest. Fix: none.
- [Pass] Preview telemetry is consistent at `RELEASES-PREVIEW.html:375`: generatedAt `2026-10-21T03:19:46Z`, lastOp `2026-10-21T02:46:10Z`, lastSyncDisplay `2026-10-21T02:46`, label `today`. Read-only loose-object comparison against 40b45a9 also found lastSyncDisplay preserved. Decisive direct probe below exited 0. Fix: none.
- [Pass] Evidence wording distinguishes historical qualification from follow-up work: `TESTS-RESULTS/2026-10-20-GH-257/verification.md:31` limits the initial hosted pass to 40b45a9; `:51-54` records producer focused/build results and pending fresh QA/regression/CI. `PROJECT/2-WORKING/GH-257-REVIEW-FIXES.md:70,78-84` makes the same distinction and records retention/full-state write growth without claiming measured latency. `CHANGELOG.md:41-59` describes startup/404 containment and the existing crash/retention limitations. Fix: none beyond normal post-QA status reconciliation by the producer.
- [Pass] The documented JSON tradeoff matches the implementation: complete serialization at `src/github-issue-stream-module.js:796`, at most 40 post saves (`:20,581`), capped 200 repo processing saves (`:22,484,610,761`) and entry/exit saves (`:457,618`). Exact keys remain the replay suppression mechanism (`src/github-issue-stream-planner.js:252-254,422-434`). No observed workload failure supports a store rewrite or key compaction in this follow-up. Fix: none.
- [Unverified — needs clone run] Producer-reported 3 red / 46 green cases, build, subsequent full regression and exact-head hosted CI were not executed or independently revalidated here. Run the authorized disposable-clone/harness gate and report its exact revision before declaring merge readiness. No app startup, executable fixtures, suites, live APIs, network calls or Git commands were run in this reviewer turn. Graph tools were unavailable; direct bounded source reads were used. Loose-object reads matched the module, tests, plan, receipt, preview and changelog to HEAD; the app blob was packed/unavailable to that limited comparison, so its caller analysis relies on the directly read current source.

Telemetry probe (with `PYTHONDONTWRITEBYTECODE=1` and `TMPDIR="$PWD/.relay-scratch/tmp"`):

```sh
python3 -c 'import json,pathlib; d=json.loads(pathlib.Path("RELEASES-PREVIEW.html").read_text().split("<script id=\"ledger-data\" type=\"application/json\">")[1].split("</script>")[0]); print(d["cycle"]["generatedAt"],d["cycle"]["db"]["lastOp"],d["telemetry"]["lastSyncDisplay"],d["telemetry"]["lastSyncAgoDisplay"])'
```

Exit status: 0. Decisive output: `2026-10-21T03:19:46Z 2026-10-21T02:46:10Z 2026-10-21T02:46 today`.

relay closed (Approved), no further reviewer turn needed. Token handed to codex-producer to reconcile the QA receipt and complete the pending qualification gates.

### Producer · Round 2

Prior reviewer source report is PASS with no code findings, but the harness refused close-mismatch: reviewer released the token back to producer instead of completing it. There is no GH259-FOLLOWUP-QA attestation. Source HEAD remains c2eefe22e6d85a76b52191c525081d6de662b0ea, working tree clean. Please verify the prior report/citations and unchanged candidate, append your own round-2 verdict, and complete the actual configured protocol: if Approved, the REVIEWER must claim then `tick done GH259-FOLLOWUP-QA --agent codex --relay-file .xyz/relay-system/gh259-followup.md` while it owns the token. Do not release to producer first. Do not ask producer to impersonate the reviewer or manually attest. No code edits or broader new review scope; one bounded completion turn, full regression/CI remain pending.

### Reviewer · Round 2 · codex

swept file: yes

VERDICT: PASS
Basis: Ship for the bounded source-QA gate at `c2eefe22e6d85a76b52191c525081d6de662b0ea`. Re-read the whole 827-line module and 733-line existing test file, the scoped startup caller, follow-up plan/receipt, changelog entry and preview telemetry. No additional concrete pre-existing defect found in the swept module/test files. This is the requested completion of the unchanged candidate review, not full regression or hosted-CI qualification.

- [Pass] Prior startup citations remain accurate: initial seed/save failures are caught at `src/github-issue-stream-module.js:396-402`, polling is scheduled at `:408`, cycle entry saves at `:457`, save errors rethrow at `:804`, and the timer catches/rearms at `:812-823`. First successful discovery seeds an absent repo and skips delivery at `:481-486`; an initial save failure retains its in-memory seed. The workspace consequence remains grounded in `src/app.js:424-425,445-451` (await before registration, catch stops Slack). Fix: none.
- [Pass] Directory non-OK responses, including 404, throw at `src/github-issue-stream-module.js:185-187`; discovery catches/returns at `:469-475` before pruning at `:617`. Successful empty/stale-only snapshots retain their distinct path at `:713-737`, and explicit repositories remain at `:683-685`. Fix: none.
- [Pass] The existing-suite additions still exercise the actual scheduled callback, repeated failing save and recovery (`tests/github-issue-stream-module.test.js:654-695`), and default fetch-client 404, saved disk cursor and original-since replay (`:697-730`). Their assertions target the stated old-path failures. This is source assessment of red-control sensitivity; no executable tests or fixture were run here. Fix: none.
- [Pass] Historical/pending evidence is separated at `TESTS-RESULTS/2026-10-20-GH-257/verification.md:31,51-54` and `PROJECT/2-WORKING/GH-257-REVIEW-FIXES.md:70,78-84`. Complete JSON serialization remains at `src/github-issue-stream-module.js:796`; the growing retained-key/full-state-write tradeoff is explicit at plan `:84` and `CHANGELOG.md:45-53`. No measured latency qualification or new storage mechanism is claimed. Fix: none; producer should reconcile the QA checkpoint after this attestation.
- [Pass] Candidate identity and telemetry probe below exited 0. All seven scoped artifacts match the committed candidate, including app.js (tree blob identity comparison does not need its packed blob contents). `RELEASES-PREVIEW.html:375` still has generatedAt `2026-10-21T03:19:46Z`, lastOp `2026-10-21T02:46:10Z`, lastSyncDisplay `2026-10-21T02:46`, label `today`. Fix: none.
- [Unverified — needs clone run] Producer-reported 3 red / 46 green cases and build were not independently executed here; full regression and exact-head hosted CI remain pending. No Git command, suite, executable fixture, app startup, network or live service was used. Graph project inventory was fully paginated (84 entries); this reviewer checkout has no matching indexed project/generation, so bounded direct source reads support the findings. No unrelated checkout's graph was substituted.

Read-only identity/telemetry probe command (no artifact execution):

```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
python3 - <<'PY'
import pathlib, zlib, hashlib, json
p=pathlib.Path
wt=p(p('.git').read_text().strip().split(': ',1)[1])
common=(wt/p('commondir').read_text().strip()) if False else (wt/(wt/'commondir').read_text().strip()).resolve()
def obj(oid):
    return zlib.decompress((common/'objects'/oid[:2]/oid[2:]).read_bytes()).split(b'\0',1)[1]
def entries(oid):
    data=obj(oid); out={}; i=0
    while i<len(data):
        j=data.index(b'\0',i); name=data[i:j].split(b' ',1)[1].decode(); out[name]=data[j+1:j+21].hex(); i=j+21
    return out
def oid_for(rev,name):
    oid=obj(rev).splitlines()[0].decode().split()[1]
    for part in name.split('/'): oid=entries(oid)[part]
    return oid
head=(wt/'HEAD').read_text().strip()
print('HEAD',head)
rev='c2eefe22e6d85a76b52191c525081d6de662b0ea'
files=['src/github-issue-stream-module.js','tests/github-issue-stream-module.test.js','src/app.js','PROJECT/2-WORKING/GH-257-REVIEW-FIXES.md','TESTS-RESULTS/2026-10-20-GH-257/verification.md','RELEASES-PREVIEW.html','CHANGELOG.md']
for name in files:
    raw=p(name).read_bytes(); actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    assert actual==oid_for(rev,name), name
    print('MATCH',name,actual)
d=json.loads(p('RELEASES-PREVIEW.html').read_text().split('<script id="ledger-data" type="application/json">')[1].split('</script>')[0])
print('TELEMETRY',d['cycle']['generatedAt'],d['cycle']['db']['lastOp'],d['telemetry']['lastSyncDisplay'],d['telemetry']['lastSyncAgoDisplay'])
assert d['cycle']['generatedAt'][:10]==d['cycle']['db']['lastOp'][:10]=='2026-10-21'
assert d['telemetry']['lastSyncDisplay']=='2026-10-21T02:46' and d['telemetry']['lastSyncAgoDisplay']=='today'
print('7/7 candidate files match; telemetry assertions pass')
PY
```

Exit status: 0. Decisive output:

```text
HEAD c2eefe22e6d85a76b52191c525081d6de662b0ea
MATCH src/github-issue-stream-module.js 7e4351fa6722c7112da45901f19f413fcb15d889
MATCH tests/github-issue-stream-module.test.js a4e9ab445f2b3cc8a18f1454a5e126e328fcdd43
MATCH src/app.js 2ff16f9fad89dc951f113cedb3abb89880da9c90
MATCH PROJECT/2-WORKING/GH-257-REVIEW-FIXES.md f21c37a70bba7a18650cec7f465e13bae5d75910
MATCH TESTS-RESULTS/2026-10-20-GH-257/verification.md edd59fae5a204436140862f0003a2a224022ed7f
MATCH RELEASES-PREVIEW.html cb50abc8b42820695ef517dff5bf5473ba95e038
MATCH CHANGELOG.md 30e988a49d7fc1f30e5c9ca1ebdd1c062b389f49
TELEMETRY 2026-10-21T03:19:46Z 2026-10-21T02:46:10Z 2026-10-21T02:46 today
7/7 candidate files match; telemetry assertions pass
```

relay closed (Approved), no further reviewer turn needed. Reviewer completes GH259-FOLLOWUP-QA with the absolute env-pinned `tick done` while owning the token; producer's next work is receipt reconciliation and the pending qualification gates. No self-commit; harness owns the file-scoped commit.


### Attestation · relay-drive — 2026-10-21T03:27:22Z
task: GH259-FOLLOWUP-QA
reviewer: codex
status: Approved
reviewed-head: c2eefe22e6d85a76b52191c525081d6de662b0ea
added-range: 13176+6149
added-sha256: 376ebeb7cb9b83a28eb963891609dc5eb4f214c13db8d5f17f33c1b73724864c
<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
