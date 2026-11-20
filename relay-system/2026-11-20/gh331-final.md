# RELAY · GH-331/332 final QA — auto-complete crash fix + retire-closed-issue-reminders skill
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-11-20.
-->

NEXT: Producer
STATUS: Approved
ROUND: 3 / 3

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
6. **Commit only the relay file** (`relay(gh331-final): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: the task branch diff against `6325509d1421e5ac21af69aee3762564be6763ae` (`git diff 6325509..HEAD`). Product: `src/github-sync-module.js`, `skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs`, `skills/retire-closed-issue-reminders/SKILL.md`. Tests: `tests/github-sync-module.test.js`, `tests/retire-closed-issue-reminders.test.js`. Plan: `PROJECT/2-WORKING/GH-331-GITHUB-AUTOCOMPLETE-CRASH.md` (plan QA: `relay-system/2026-11-20/gh331-plan.md`). Evidence: `TESTS-RESULTS/2026-11-20+GH-331/verification.md`, `TESTS-RESULTS/2026-11-20+GH-331/gh331-production-order-probe.js`. Also `CHANGELOG.md` (1.4.354).
- Reviewer: codex   ·   Producer: producer
- Started: 2026-11-20
- Definition of Done: final QA for a development PR covering two tracked issues.

Per-issue acceptance map (from the approved plan):
- **#331** (https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/331): poll cycle no longer throws `GetReminderVersion is not a function` in production load order; the new test fails on the unchanged code for that reason and passes after; completion rule, version guard and notifications unchanged.
- **#332** (https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/332): read-only finder (no Sleuth writes, `gh api` REST only) classifies all-closed/mixed/unknown/open/none; a failed lookup is `unknown`, never closed (tested, with a recorded mutation control); review file mode 600; empty and malformed input handled; SKILL.md workflow retires only through `bulk-edit-reminders --complete` after review, with dry-run and before/after verification.

Questions:
1. Does the code match the plan? Any duplicate subsystem or second writer?
2. #331: is the call-time require correct and sufficient? Does the new test construct the sync class inside `isolateModules` and avoid mocking the reminders export, so it cannot pass on unfixed code?
3. #332: any input where a reminder is shown as `all-closed` while one of its links is unreadable, or where a link is missed (e.g. a `pull/` URL, a repo name with dots, duplicates across `GitHubUrls` and text)? Is the output safe for private data (mode 600, nothing written outside the backup's folder, no Sleuth call)?
4. Do the receipts substantiate the claims (red/green, probe on fixed vs unfixed, smoke aggregates against the manual run)? The full gate is recorded in `TESTS-RESULTS/2026-11-20+GH-331/full-gate.log`.
5. Are the persisted ratings (80/70/50/90, 45/20/50/75) still consistent with the evidence?
6. Pre-existing defects in the touched functions, in scope.

Operational envelope: existing Node Slack app plus a local single-operator skill with private local files. Grade commensurate complexity and this repo's threat model; do not ask for daemons, services or enterprise machinery.

Required output: graded findings with `file:line`; literal `swept file: yes|no`; exact `VERDICT: PASS|FAIL|PARKED`; `STATUS: Approved` only for PASS. Behaviour-change Blocker/Should requests need `Observed input:`, `Affected scope:`, `Falsifier:`. Edit only this relay file; scratch probes only under `.relay-scratch/` or `$TMPDIR`; do not run full suites.

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

VERDICT: FAIL
Basis: #331 is sound on source inspection and the supplied receipts; #332 has one measured private-file creation gap to fix before approval. Swept the full product files and both test files, including pre-existing sync behavior; no additional actionable pre-existing defect found. No suite or executable fixture was run, and no git command was used.

- [Should] S1 — create the review file with private permissions **before writing its contents** (`skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs:78-79`). `writeFileSync` currently uses default creation permissions; the subsequent chmod only protects the finished file. With ordinary umask 022, private reminder text is written into a 0644 file until chmod succeeds. Small fix: pass `{ mode: 0o600 }` for creation; retain permission tightening for an existing output before overwriting it. No new subsystem needed.
  Observed input: a fresh backup containing `[]`, new output path, process umask `022`; the real finder created output mode `644` before its chmod, then `600` afterward. Real candidate content uses the same unconditional write.
  Affected scope: fresh review outputs under permissive umasks, and existing permissive review outputs on rerun. No classification or retirement behavior change requested.
  Falsifier: intercept `fs.chmodSync` to inspect the file mode immediately before the final chmod; with umask 022 and a fresh output it must already be 600. An existing 0644 output must be tightened before sensitive replacement content is written. If these hold, this finding is resolved.
  Probe command (exit 0; scratch-only, no network):
  ```bash
  export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
  mkdir -p "$TMPDIR"
  node --input-type=module - <<'NODE'
  import fs from 'node:fs';
  import path from 'node:path';
  const dir=fs.mkdtempSync(path.join(process.env.TMPDIR,'mode-probe-'));
  const backup=path.join(dir,'backup.json');
  fs.writeFileSync(backup,'[]',{mode:0o600});
  process.umask(0o022);
  const chmod=fs.chmodSync;
  fs.chmodSync=(p,m)=>{console.log('before chmod mode='+ (fs.statSync(p).mode & 0o777).toString(8)); return chmod(p,m);};
  process.argv=['node','finder',backup];
  await import(path.resolve('skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs'));
  console.log('final mode='+ (fs.statSync(backup+'.closed-issues.json').mode & 0o777).toString(8));
  NODE
  ```
  Decisive output: `before chmod mode=644`, `final mode=600`.
- [Pass] #331: call-time resolution at `src/github-sync-module.js:258-261` avoids retaining the partial export; the expected version is still captured before fetch and passed into completion at lines 282-285, and notifications follow successful completion at lines 288-297. The isolated registry loads reminders first and constructs the isolated sync class (`tests/github-sync-module.test.js:695-720`), with no reminders export mock. Supplied `red.log` records the exact `TypeError: RemindersModule.GetReminderVersion is not a function`; supplied `green.log` records `1 passed`. No fix requested.
- [Pass] #332 classification/source inspection: `LINK_PATTERN` includes `pull` and dotted repo slugs; `ExtractRefs` unions tagged URLs and text and deduplicates refs. `Classify` checks unknown before closed (`skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs:10-44`). The sole subprocess is `gh api`, with no Sleuth writer. The workflow explicitly says unknown means “never retire on this run” and uses `--complete … --dry-run` followed by before/after backup comparison (`skills/retire-closed-issue-reminders/SKILL.md`, steps 2–5). No change requested beyond S1.
- [Pass] Recorded evidence is internally consistent: `TESTS-RESULTS/2026-11-20+GH-331/verification.md` gives 31→30 reminders, 2→1 mixed, and one reviewed retirement; the mutation log records `all-closed=3 … unknown=0` when failures are incorrectly treated as closed. `full-gate.log` reports `148 passed`, `3097 passed`, `npm test exit=0`, and `build exit=0`. These are producer receipts, not independently rerun tests; unchanged/fixed probe comparison and private smoke aggregates remain attributed to the producer. The post-turn harness must establish current clone-gate status.
- [Pass] Scope and ratings: the plan's “80/70/50/90” and “45/20/50/75” remain proportionate to the bounded crash fix and local operator workflow (`PROJECT/2-WORKING/GH-331-GITHUB-AUTOCOMPLETE-CRASH.md`, Rating rationale). No second reminder writer or parallel completion subsystem was introduced. No rating change requested.

Handing off to Producer — fix/disposition S1, record the relevant receipt, then reopen for Reviewer.

### Producer · Round 1 → 2

- **S1 — Implemented.** `skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs`: an existing review file is `chmod 0600` before writing, and the write passes `{ mode: 0o600 }` so a new file is created private; the after-the-fact chmod was removed. No classification or retirement change.
  Receipt `TESTS-RESULTS/2026-11-20+GH-331/gh332-s1-mode-probe.log` (your falsifier, intercepting the content write under umask 022): fixed code `fresh … =600`, `existing644 … =600` at content-write time; pre-fix code (`21a6c9b`) `644` at content-write time for both, `600` only afterwards. Finder tests: 2 passed.
- All [Unverified — no citation] items acknowledged; no other change.


### Reviewer · Round 2

swept file: yes

VERDICT: PASS
Basis: S1 is resolved on source inspection and an independent scratch-only probe. Re-read the full three product files and both test files, including pre-existing sync behavior; no additional actionable pre-existing defect found within this review. Round 1 acceptance findings stand. No git, suite, executable fixture, server operation or Sleuth write was run; the post-turn harness establishes the current clone gate.

- [Pass] S1 resolved: the existing-file chmod precedes replacement and new creation passes mode 0600 (`skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs:79-80`). Independent probe below exited 0 with decisive output `fresh after write=600`, `existing644 before replacement=600`, `existing644 after write=600`. It imports the real finder twice over an empty backup under umask 022, intercepts the content write, and makes no network call. No further fix requested.
  Command:
  ```bash
  export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
  mkdir -p "$TMPDIR"
  node --input-type=module - <<'NODE'
  import fs from 'node:fs';
  import path from 'node:path';
  const Dir=fs.mkdtempSync(path.join(process.env.TMPDIR,'s1-review-'));
  const OriginalWrite=fs.writeFileSync;
  const Backup=path.join(Dir,'backup.json');
  OriginalWrite(Backup,'[]',{mode:0o600});
  process.umask(0o022);
  const Output=Backup+'.closed-issues.json';
  let Label='fresh';
  fs.writeFileSync=(p,...args)=>{
    if(p===Output && fs.existsSync(p)) console.log(Label+' before replacement='+ (fs.statSync(p).mode&0o777).toString(8));
    const r=OriginalWrite(p,...args);
    if(p===Output) console.log(Label+' after write='+ (fs.statSync(p).mode&0o777).toString(8));
    return r;
  };
  process.argv=['node','finder',Backup];
  const Module=path.resolve('skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs');
  await import(Module+'?fresh');
  fs.chmodSync(Output,0o644);
  Label='existing644';
  await import(Module+'?existing');
  NODE
  ```
- [Pass] The crash fix still resolves `require('./reminders-module').GetReminderVersion(CurrentReminder)` before fetching and passes `{ ExpectedVersion }` into completion (`src/github-sync-module.js:258-285`); the production-order test uses the isolated class without a reminders-export mock (`tests/github-sync-module.test.js:695-720`). No requested completion/notification rule change, new writer, or rating change. Test execution remains attributed to the recorded producer receipts, not independently rerun here.

Relay closed (Approved), no further turn needed.


### Attestation · relay-drive — 2026-11-20T17:11:51Z
task: GH331-FINAL
reviewer: codex
status: Approved
reviewed-head: 81b119c1f87eba45bb72c6c6ebb9db567185fceb
added-range: 13660+2613
added-sha256: 1ed6af6720327c064649d41b8fbc67e4fd2c8a11129391c6eb31f5e91cabd707
### Producer · Round 2 → 3 (post-approval change)

After Approved, PR #333's bots (Greptile, CodeRabbit) reported the same defect: `LINK_PATTERN` was case-sensitive, so a closed `github.com/o/r/issues/1` beside an open `GitHub.com/o/r/issues/3` classified as `all-closed` and dropped the open link.
- **Implemented:** `gi` flag (matching `src/github-url-utils.js:16`); new test `a link written with a capitalised host still counts, so the reminder is mixed, not all-closed` — red on the approved finder (`TESTS-RESULTS/2026-11-20+GH-331/gh332-case-red.log`: `reminders=1 links=1 all-closed=1`), green now (3 passed).
- **Implemented:** finder/test identifiers renamed per `docs/coding-conventions.md`; no behaviour change. Probe receipt left as it ran.
- Smoke rerun on the same private backups: identical aggregates. Full gate rerun pending on this head.

Please review only this delta (`git diff 7089733..HEAD -- skills tests`) and re-approve or not.

### Reviewer · Round 3

swept file: yes

VERDICT: PASS
Basis: Ship. The post-approval case fix addresses the recorded missed-open-link input, and identifier changes preserve the finder logic on source inspection. Swept the complete finder, skill workflow and finder tests, and re-read sync implementation and regression coverage; no additional actionable pre-existing defect found. Prior acceptance findings stand. No git command, suite, executable fixture, network call or Sleuth write was run. Current-head full-gate execution remains unverified here and belongs to the post-turn disposable-clone harness.

- [Pass] Case fix: `LINK_PATTERN` now has `gi` (`skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs:12`). The new regression supplies the closed lowercase-host link plus open capitalised-host link and expects both in a mixed row (`tests/retire-closed-issue-reminders.test.js:81-86`). The recorded red receipt explicitly shows `reminders=1 links=1 all-closed=1 mixed=0` (`TESTS-RESULTS/2026-11-20+GH-331/gh332-case-red.log`). Independent source-extraction probe below exits 0 and yields both refs with class mixed. No fix requested.
- [Pass] Rename sweep: source still unions tagged URLs and text, deduplicates refs, calls only `gh api`, gives unknown precedence, and writes the review beside the backup privately (`skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs:20-43`, `:64-82`). The workflow still requires review, dry-run completion through bulk-edit-reminders and backup comparison (SKILL.md steps 3–5). No second writer or changed completion policy found; no rating adjustment warranted.
- [Pass] #331 remains intact: call-time require and pre-fetch version capture precede guarded completion and notification (`src/github-sync-module.js:258-297`); the regression creates the isolated sync class after requiring reminders first, without mocking that export (`tests/github-sync-module.test.js:695-720`). This turn does not claim an independently executed regression or full-gate pass.

Probe command (exit 0; extracts actual source functions into a VM, no executable fixture or subprocess):
```bash
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('skills/retire-closed-issue-reminders/find-closed-issue-reminders.mjs','utf8');
const logic=source.slice(source.indexOf('const LINK_PATTERN'),source.indexOf('const BackupPath'));
const context=vm.createContext({});
vm.runInContext(logic+';globalThis.probe={ExtractRefs,classify};',context);
const {ExtractRefs,classify}=context.probe;
const refs=ExtractRefs({GitHubUrls:['https://github.com/o/r/issues/1'],ReminderMessageText:'https://GitHub.com/o/r/issues/3'});
const result=classify(refs.map(ref=>ref==='o/r/1'?'closed':'open'));
console.log(JSON.stringify({refs,class:result}));
if(refs.length!==2||result!=='mixed') process.exit(1);
const dotted=ExtractRefs({GitHubUrls:['https://github.com/o/r.dot/pull/2'],ReminderMessageText:'https://GitHub.com/o/r.dot/pull/2'});
console.log(JSON.stringify({dotted,failedLookup:classify(['closed','unknown'])}));
if(dotted.length!==1||classify(['closed','unknown'])!=='unknown') process.exit(1);
NODE
```
Decisive output:
```json
{"refs":["o/r/1","o/r/3"],"class":"mixed"}
{"dotted":["o/r.dot/2"],"failedLookup":"unknown"}
```

Relay closed (Approved), no further turn needed.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
