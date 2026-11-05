---
Goal: Final QA of the GH-290 implementation (reminders edit actions on the bulk Web API + skill wrapper)
Date: 2026-11-05
NEXT: Reviewer
STATUS: Approved
---

# Context

You approved the plan in round 3 of `relay-system/2026-10-28/gh290-plan-qa.md`. Now review the **implementation**
on this branch against that plan: `PROJECT/2-WORKING/GH-290-REMINDERS-EDIT-API.md` (read its "Execution notes
(2026-11-05)" for the recorded deviations). Issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/290.

Diff to review: `git diff d8f3b15..HEAD -- src tests skills docs CHANGELOG.md` (base = `origin/development`).
Evidence: `TESTS-RESULTS/2026-11-05+GH-290/verification.md`, `smoke-output.txt`, `gh290-smoke.cjs`.

**Operational envelope:** single-tenant-per-workspace Slack bot. The bearer-token Web API is reached by one
operator through an SSH tunnel, plus a local operator CLI skill. Grade against the approved plan and
commensurate complexity. Do not ask for unrequested machinery (RBAC, idempotency keys, rate limits, audit DBs,
per-bot principals: those belong to the separate issue #301). Read-only probes under `.relay-scratch/` are
fine. Do not run the jest suites here; the receipt has them.

Files:
- `src/web-api.js`: `#HandlePostWorkspaceRemindersBulkAsync`, `#PrepareBulkReminderAction`,
  `#ApplyBulkReminderActionAsync`, `#WithListFailures`
- `src/reminders-module.js`: `UpdateReminderSummaryFromListAsync`, `RescheduleReminderAsync`,
  `ReassignReminderAsync`, `#RecordLedgerGapAsync`, `CreateReminderFromListRowAsync`, and the claim-site check
  in the posting loop (search `RemindersToPost is a snapshot`)
- `src/lists-module.js`: `#AddToUserContextsAsync`, `SyncReminderScheduleAcrossListsAsync`,
  `MoveReminderBetweenUserListsAsync`
- `skills/bulk-edit-reminders/bulk-edit-reminders.mjs` and `SKILL.md`; `docs/web-api.md` bulk section; `CHANGELOG.md` Unreleased
- tests: `tests/web-api-reminders.test.js`, `tests/reminders-integration.test.js` (`GH-290: Web API edit writers`),
  `tests/lists-module.test.js` (`GH-290: owner and schedule changes follow onto the lists`)

Questions:

1. Does each action match the approved plan's table (fields, writer, per-item statuses, whole-batch refusal)?
   Are complete/cancel requests and responses unchanged from GH-279?
2. FSM and posting: does `RescheduleReminderAsync` go only through `#TransitionReminderState`, and is the
   claim-site `State !== Overdue` skip correct for every path into that loop (normal and force mode)? Could it
   skip something it should post?
3. Reassign and lists: does `MoveReminderBetweenUserListsAsync` avoid a shared-row create or delete, update the
   owner cell on surviving rows, and report failures as `partial`? Is the `#AddToUserContextsAsync` lift
   byte-equivalent for `AddReminderToListAsync`?
4. Ledger coverage: is the gap recorded before the in-memory mutation for summary and owner edits, and is a
   marker failure non-blocking? The smoke shows a projection-flag GET and a reload keeping edited values; does
   that settle the plan-QA verification note?
5. Wrapper: are the deviations sound? Prod uses `sshpass -e` with the password parsed from the vultr env file;
   dev URLs are direct, so `--tunnel` refuses non-loopback. Do edits keep argument order, does the per-action
   repeat refusal work, does `backup` accept `[]`, and does the exit code use the new statuses? Is any secret
   exposed (argv, logs, files)?
6. Do the tests substantiate the claims (red controls listed in the receipt), and is the footprint
   commensurate? Is anything required missing, or anything over-built?
7. Is the full-suite result honestly reported? (The one `thread-memory` failure also fails on `development`.)

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the branch can ship as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->


## Codex implementation review — 2026-11-05

**Verdict: Open — one Should to fix before shipping.** The module/API reuse and scope are appropriate for the stated operator envelope. No additional authorization subsystem is requested.

### 1. [Should] Keep `--create` fields from overriding the operation and bypassing ID resolution

`skills/bulk-edit-reminders/bulk-edit-reminders.mjs:231` builds the outgoing item as `{...resolvedId, action, ...fields}`. `--create` accepts an arbitrary JSON object (`:45–50`), and `ResolveIds` deliberately skips resolution for creates (`:167`). Consequently a JSON `action` and `reminderId` overwrite the trusted operation: the preview says create, but the POST can cancel an existing reminder without resolving it against the backup. The server accepts extra create-shaped fields on cancel (`src/web-api.js:1070`, `:1127`). This is an accidental-operation defect in the wrapper, not an authorization issue.

Observed input: `--create '{"title":"Draft report","dueDate":"2030-01-01T12:00:00Z","channelId":"C1","senderId":"U1","action":"cancel","reminderId":"not-in-backup"}'`, with a successful backup response `[]`.
Affected scope: the wrapper's create path; preview/operation agreement, ID resolution and same-action repeat refusal can all be bypassed by fields carrying an alternate action. Ordinary create requests are unaffected.
Falsifier: run the wrapper with that input against a disposable mock endpoint. It must either reject before POST or send only a create operation without a supplied existing reminder ID. It must never POST cancel/complete/edit for this input. Whitelist create fields or reject reserved operation fields; merely moving `action` after the spread still leaves an injected `reminderId`.

Non-mutating probe, command below, **exit 0**. It evaluates the actual wrapper source after removing imports and its auto-entrypoint, injecting an in-memory filesystem and mocked HTTP responses; it neither starts app modules nor sends network requests nor writes backups. Decisive output:

```json
{"exit":0,"backupRecords":0,"posted":[{"actions":[{"action":"cancel","title":"Draft report","dueDate":"2030-01-01T12:00:00Z","channelId":"C1","senderId":"U1","reminderId":"not-in-backup"}]}]}
```

```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node --input-type=module <<'JS'
import fs from 'node:fs';
const source=fs.readFileSync('skills/bulk-edit-reminders/bulk-edit-reminders.mjs','utf8').replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'').split('MainAsync().then(Code')[0];
const calls=[];
const mockProcess={argv:['node','wrapper','--create',JSON.stringify({title:'Draft report',dueDate:'2030-01-01T12:00:00Z',channelId:'C1',senderId:'U1',action:'cancel',reminderId:'not-in-backup'})],env:{SLEUTH_WEB_API_BASE_URL:'http://127.0.0.1:1',SLEUTH_WEB_API_TOKEN:'dummy',SLEUTH_WORKSPACE_NAME:'probe'}};
const fakeFs={existsSync:()=>false,mkdirSync:()=>{},writeFileSync:()=>{}};
const fetch=async(url,options)=>{if(options.body) calls.push(JSON.parse(options.body));return {json:async()=>({success:true,data:options.body?{results:[{action:'cancel',reminderId:'not-in-backup',status:'canceled'}],counts:{canceled:1}}:[]})}};
const run=new Function('fs','os','path','process','fetch','console',source+'; return MainAsync();');
const code=await run(fakeFs,{homedir:()=>'/unused'},{join:(...p)=>p.join('/')},mockProcess,fetch,{log:()=>{}});
console.log(JSON.stringify({exit:code,backupRecords:0,posted:calls}));
JS
```

### 2. [Nit] Reconcile the list-test claims with the seeded files

The plan's execution notes say six new Lists tests. The named GH-290 block at `tests/lists-module.test.js:625` contains three (`:651`, `:677`, `:693`): move/shared-owner update, update failure, and scheduling fan-out. It does not contain the claimed retained-owner-row or delete-failure coverage. The receipt's assertion that removing the owner update loop fails two GH-290 tests is not substantiated by this block: the failure-reporting test fails as described, but the successful-move test also explicitly expects an update, so two failures are plausible; retained-row behavior nevertheless remains uncovered. Correct the count and distinguish observed coverage from planned coverage. The current implementation does iterate retained contexts correctly by inspection.

### Remaining questions — source review and supplied evidence

- **API:** `src/web-api.js:1031` prepares the entire batch before the application loop, then applies serially. The four new actions delegate to the planned writers; complete/cancel retain the existing writer calls and response key order. The new reschedule `partial` result additionally makes list-sync failure explicit, consistent with the operator-facing partial contract. Title normalization/force handling and owner requirements follow the plan.
- **FSM/posting:** `src/reminders-module.js:1188` uses Rescheduled → Scheduled transitions, clears holds, refuses Posting before mutation, and saves. Selection at `:4261` requires Overdue in both ordinary and force modes; the synchronous guard at `:4326` therefore does not exclude an otherwise eligible state. It prevents a future-rescheduled snapshot entry being claimed. Snooze checks remain in place.
- **Lists:** `src/lists-module.js:1746` deletes only removed per-user rows, uses the guarded per-user add helper, and updates surviving owner cells without creating/deleting a shared row. Delete/update failures are collected and mapped to partial by `src/web-api.js:1159`. The helper lift retains the existing per-user add guard and shared-row ownership; historical byte equivalence was not independently diffed because this turn forbids git.
- **Projection:** gap recording precedes summary and owner mutation (`src/reminders-module.js:1165`, `:1231`); marker exceptions are logged and non-blocking (`:1255`). The supplied smoke output records projection-flag GET with edited values, a gap marker, and reload persistence. This addresses the previous plan-QA note at the local-smoke evidence level; it does not establish behavior on a live server.
- **Wrapper apart from finding 1:** new edit flags preserve their relative order, repeat checks key by action plus resolved ID, successful `[]` is accepted, and only successful statuses exit 0. Complete/cancel remain grouped before the new edit flags. Password SSH uses `SSHPASS` in the child environment rather than argv; no secret logging/writing was seen in the path inspected. The password-auth and direct-dev-URL deviations are reasonable. Actual SSH authentication and shutdown were not exercised this turn.
- **Verification honesty:** the receipt clearly reports the remaining full-suite failure and the matching development failure, plus local mock-Slack smoke limitations. These are author-supplied results, not fresh reviewer test runs. **[Unverified — needs clone run]** focused/full suites, mutation controls, build and gates; no tests or executable fixture were run here. Real Slack rendering and live dev create/edit/rerun/complete remain explicitly deferred until deployment.

Review containment: only this relay file was edited. No git commands, source changes, test suites or fixture executions were used. The graph query was unavailable under the session approval policy; direct reads of the named artifacts were used instead.


## Producer response — round 1 (commit `41fa78c`)

1. **[Should] `--create` overriding the operation: Accepted, fixed.** `--create` now rejects any key outside
   `title, dueDate, channelId, assigneeIds, senderId`, during argument parsing, before the backup or any POST
   (`skills/bulk-edit-reminders/bulk-edit-reminders.mjs`, `CreateFields` and the `--create` case). Your
   falsifier input now gives `ERROR: --create accepts only title, dueDate, channelId, assigneeIds, senderId
   (got action, reminderId)`, exit 1. That is an allowlist, not a reordering, so an injected `reminderId`
   is refused too.
2. **[Nit] lists-test claims: Accepted, fixed.** The count is corrected in the receipt and the plan. Two
   tests were added for the coverage the plan named: a retained owner's per-user row gets the new primary
   owner (`update F_USER_1` containing `U_NEW`, no delete), and a failed delete from a removed owner's list
   is reported (`remove from U_ASSIGNEE's list`). With the owner-cell loop removed, three of the five GH-290
   lists tests fail, the retained-owner test among them. Focused suites: 146 passed.

Please re-review `41fa78c` (diff `bedd51c..41fa78c`) and set STATUS: Approved if satisfied.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->


## Codex implementation re-review — round 2 — 2026-11-05

**Verdict: Ship — Approved.** Both round-1 findings are resolved in the seeded artifacts. No remaining required changes.

- **Should resolved:** `skills/bulk-edit-reminders/bulk-edit-reminders.mjs:20,54–55` allowlists the five create fields during parsing. This rejects both operation injection and an existing reminder ID before backup or POST. The valid create path remains intact. The narrow source-evaluation probe below independently confirms the original falsifier and separate reserved-field cases.
- **Nit resolved:** `tests/lists-module.test.js:693–728` now asserts a retained owner's row receives the new primary owner without deletion, and a removed-owner delete failure is returned. The GH-290 block contains five tests; the plan execution notes and verification receipt now agree. These are meaningful assertions for the previously missing coverage.
- The supplied receipt reports 146 focused tests passing and three mutation-control failures when the owner-cell loop is removed. **[Unverified — needs clone run]** those suites, mutation controls, build and gates were not rerun here. The previously documented full-suite baseline failure and deferred live checks remain accurately disclosed. Approval is the source-review verdict; the post-turn harness gate remains separate.

### Independent non-mutating probe

Command (exit **0**); evaluates only the actual argument parser, with no network, app startup, backup writes, fixture execution or test suite:

```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node --input-type=module <<'JS'
import fs from 'node:fs';
const source=fs.readFileSync('skills/bulk-edit-reminders/bulk-edit-reminders.mjs','utf8').replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'').split('MainAsync().then(Code')[0];
const run=new Function(source+'; return ParseArgs;')();
const fields={title:'Draft report',dueDate:'2030-01-01T12:00:00Z',channelId:'C1',senderId:'U1'};
for(const injected of [{action:'cancel',reminderId:'not-in-backup'},{reminderId:'not-in-backup'},{action:'complete'},{__proto__:null,reason:'unexpected'}]) {
 try { run(['--create',JSON.stringify({...fields,...injected})]); throw Error('unexpected acceptance'); }
 catch(error) { if(!error.message.startsWith('--create accepts only')) throw error; console.log(error.message); }
}
const result=run(['--create',JSON.stringify({...fields,assigneeIds:['U1']})]);
if(result.edits[0].action!=='create'||result.edits[0].id!==null) throw Error('valid create changed');
console.log('valid five-field create accepted; all four reserved/unknown-field inputs rejected before I/O');
JS
```

Decisive output:

```text
--create accepts only title, dueDate, channelId, assigneeIds, senderId (got action, reminderId)
--create accepts only title, dueDate, channelId, assigneeIds, senderId (got reminderId)
--create accepts only title, dueDate, channelId, assigneeIds, senderId (got action)
--create accepts only title, dueDate, channelId, assigneeIds, senderId (got reason)
valid five-field create accepted; all four reserved/unknown-field inputs rejected before I/O
```

Containment: only this relay file was changed. No git commands, source edits, suites or executable fixtures were run. Review applied the SWE rubric to the bounded producer response; named artifacts were read directly.
