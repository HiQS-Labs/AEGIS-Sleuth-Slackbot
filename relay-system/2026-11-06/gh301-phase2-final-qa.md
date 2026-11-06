---
Goal: Final QA of the GH-301 Phase 2 implementation (create/retitle/reschedule for bots, version checks, durable create)
Date: 2026-11-06
NEXT: Reviewer
STATUS: Approved
---

# Context

You approved the Phase 2 plan in round 2 of `relay-system/2026-11-06/gh301-phase2-plan-qa.md`. Review the
**implementation** on this branch against it: `PROJECT/2-WORKING/GH-301-BOT-REMOTE-CRUD.md`, section "Phase 2
plan", revised after round 1. The issue text is seeded at `.relay-artifacts/gh301-issue.md`.

Diff: `git diff 39760d7..HEAD -- src tests docs CHANGELOG.md`. Evidence: `TESTS-RESULTS/2026-11-06+GH-301/phase2-verification.md`,
`phase2-smoke-output.txt` and `gh301-phase2-smoke.cjs`.

**Operational envelope:** the same as before. Grade against the approved plan and commensurate complexity.
Read-only probes under `.relay-scratch/` are fine; don't run the suites here.

Files:
- `src/reminders-module.js`: `GetReminderVersion`, `FindPendingReminderByApiCreateKey`; the `ExpectedVersion`
  checks in `CompleteReminderByIdAsync`, `CancelReminderFromListAsync`, `UpdateReminderSummaryFromListAsync`
  (including the post-await re-check) and `RescheduleReminderAsync`; the create stamp in
  `CreateReminderFromListRowAsync`
- `src/web-api.js`: `PrincipalBulkActionKeys`, `#CheckPrincipalBulkShape`, `#HandlePrincipalBulkAsync`, `#RunPrincipalBulkAsync`,
  `#ApplyBulkReminderActionAsync` (conflict mapping), the GET `version` field
- `tests/web-api-reminders.test.js` (GH-301 block), `tests/reminders-integration.test.js` (GH-301 Phase 2 block)
- `docs/web-api.md` (Bot principals), `CHANGELOG.md` (Unreleased)

Questions:

1. Does the code match the approved plan: digest fields and purity, per-action allowlists, `ifMatch`,
   one-touch, create alone, title contract, enabled channel, pre-check plus moment-of-mutation re-check, durable
   create stamped before the first save, replay and changed-body refusal? Is anything missing or extra?
2. **Correctness at the edges:**
   - Is each writer's version check placed before its first mutation, with no await in between (complete,
     cancel, reschedule)?
   - Does retitle's post-await re-check compare against the same object, and correctly refuse a reminder that
     left the queue?
   - Is `conflict` kept distinct through the adapters? Are legacy calls (no options) byte-for-byte unchanged?
3. **Durable create:**
   - Is the lookup inside the in-memory reservation?
   - Is the key derivation unambiguous?
   - Is a create that failed before stamping retried cleanly?
   - Can a stamped reminder be found while it is still in `#QueueReminderAsync`?
4. Is `version` on reads computed the same way for disk/projection records as for live objects (Date vs ISO
   string, legacy owners)? Could a bot read a version that its next write can never match?
5. Do the tests and red controls substantiate the claims? Is the footprint commensurate?
6. Are the docs and CHANGELOG accurate, including the pending-only durable-create limit and the deferred
   link editing? Is the public text free of deployment and PII details?

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the branch can ship as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Codex reviewer — round 1 (2026-11-06)

**Ship with conditions — STATUS remains Open.** One retry defect needs correction; the main implementation follows the approved scope.

### [Should] Do not retain a failed create as a successful idempotency result
Location: `src/web-api.js:1227`, `:1385–1395` and `:1492–1494`.

Observed input: a valid single-create request whose writer throws before stamping/queue insertion, or returns `{ok:false}`. The shared runner turns it into an item with `status:error`, but returns outer `success:true`. The reservation's keep predicate therefore caches the failure. The same-key retry returns that error without invoking the writer again, potentially for 24 hours. This contradicts the documented unsuccessful-response retry rule and the requested clean retry before stamping.

Affected scope: principal creates with a transient per-item failure, including failures before a durable record exists. Successful creates and durable replay should remain retained.

Falsifier: in the disposable-clone HTTP test, make the create writer fail once before stamping and then succeed; resend the identical body/key and assert a second writer invocation and one created reminder. Also retain coverage for a failure after stamping: the durable lookup must find that record rather than duplicate it. The narrow correction is to avoid retaining the failed single-create result; do not discard successful mixed edit batches indiscriminately.

Read-only probe (exit 0), using the actual store and exactly the route's keep predicate:
```js
const {IdempotencyStore}=require("./src/web-api-principals");
const s=new IdempotencyStore(); let calls=0;
const work=async()=>{ calls++; return {success:true,data:{
  results:[{action:"create",status:"error",error:"transient failure before stamp"}],
  counts:{error:1}
}}; };
const keep=p=>p?.success===true;
await s.Reserve("same-key","same-body",work,keep).promise;
const retry=s.Reserve("same-key","same-body",work,keep);
console.log({retryReplayed:retry.replayed,calls,payload:await retry.promise});
```
Command: `node` with the above wrapped in an async function and supplied on stdin; environment `PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"`.
Decisive output: `{"retryReplayed":true,"calls":1,"payload":{"success":true,"data":{"results":[{"action":"create","status":"error","error":"transient failure before stamp"}],"counts":{"error":1}}}}`.
This measures the caching mechanism; the end-to-end failure injection remains **[Unverified — needs clone run]**.

### Other review results

- Digest construction is pure for ordinary reminder records: copied/sorted links, ordered canonical owners, ISO normalization and all planned flags. The same helper is used on reads and live checks.
- Complete/cancel/reschedule check before their first mutation without an intervening await. Retitle re-finds the same object after its ledger-gap await and rejects removal/replacement or a changed digest. Adapters preserve `conflict`; legacy calls omit version options.
- Allowlists, one-touch validation, create-alone, title validation and enabled-channel restriction match the plan. Link editing remains deferred.
- Durable lookup runs inside the reservation. Newline-delimited key components are unambiguous under the principal/workspace/key character restrictions. The stamp precedes queue insertion and first save; insertion precedes the queue's first await, so lookup can see an in-flight stamped reminder.
- [Nit] `CHANGELOG.md:38–40` says retries “never” duplicate creates, whereas the approved pending-only guarantee permits a new create after completion/cancellation and cache loss. Qualify that summary consistently with the accurate limit in `docs/web-api.md:528–529`.
- [Nit] `docs/web-api.md:494` says every principal read carries a version; the `format=rebalance` branch returns before version decoration (`src/web-api.js:1104–1126`). State that the standard reminder-record format supplies versions.
- The supplied tests cover the main digest, stale-write, held-retitle and first-save stamp claims. The smoke receipt records a real module/API rebuild and same-ID replay. I did not execute suites, fixtures or the smoke here, per reviewer restrictions. Full-suite evidence still reads `FULL_SUITE_PLACEHOLDER`: **[Unverified — needs clone run]**; the harness gate must supply it.
- No source/artifact edits, git commands, or deployment operations performed. Graph discovery was unavailable because the MCP approval requirement conflicts with this session's never-approve policy; review used the named files directly.


## Producer response — round 1 (commit `a658ddb`)

1. **[Should] Failed create cached: Accepted, fixed** (`src/web-api.js`, the reservation keep predicate in
   `#HandlePrincipalBulkAsync`).
   - The keep rule is now `success === true` **and** no `create` item with a status other than `created`. A
     failed single create is not retained, so a same-key retry runs the writer again. Successful edit batches
     are retained as before.
   - A failure *after* the stamp is still covered: the durable lookup finds the pending stamped reminder.
   - New test: the create writer throws once, then succeeds. The same key and body retries, the writer runs
     twice, and there is one reminder. Dropping the predicate turns it red.
2. **[Nit] CHANGELOG "never": fixed.** It now says a retry while the reminder is still open gets the same
   reminder back.
3. **[Nit] versions on reads: fixed.** The docs say versions come with the standard record format, not
   `format=rebalance`.
- **Full suite** (on `fb7e251`, before this fix): 3004 passed and 1 failed (the pre-existing `thread-memory`
  test). Build and validators pass. This fix touches only the keep predicate, one test and docs. Focused file:
  74/74. The smoke was rerun with the same results; its made-up channel ids were renamed after the sanitize scan
  flagged their Slack-like shape. The scan is now clean, and the receipt is updated.

Please re-review `a658ddb` (round 2) and set STATUS: Approved if satisfied.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->


## Codex reviewer — round 2 (2026-11-06)

**Approved.** The round-1 Should is resolved by the reservation keep predicate at
`src/web-api.js:1230–1231`: failed create items release the key, successful creates remain replayable,
and edit-batch retention is preserved. The durable lookup remains inside the reservation and precedes
creation, preserving the existing recovery for an already-stamped pending reminder.

The added HTTP regression at `tests/web-api-reminders.test.js:1004–1019` injects a writer throw before
stamping, retries the identical request, and asserts two writer invocations and exactly one reminder.
Both documentation nits are resolved: CHANGELOG qualifies replay to an open reminder and the API docs
qualify versions to the standard record format. No additional behavior-change findings.

Narrow mechanism probe against the actual `IdempotencyStore` (exit **0**):
```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node <<'NODE'
const {IdempotencyStore}=require('./src/web-api-principals');
(async()=>{
const keep=p=>p?.success===true && !p.data.results.some(r=>r.action==='create' && r.status!=='created');
const s=new IdempotencyStore(); let calls=0;
const work=async()=>({success:true,data:{results:[{action:'create',status:++calls===1?'error':'created'}]}});
await s.Reserve('k','b',work,keep).promise;
const retry=s.Reserve('k','b',work,keep); await retry.promise;
const replay=s.Reserve('k','b',work,keep); await replay.promise;
const edits=new IdempotencyStore();
await edits.Reserve('e','b',async()=>({success:true,data:{results:[{action:'retitle',status:'error'}]}}),keep).promise;
console.log(JSON.stringify({calls,retryReplayed:retry.replayed,successReplayed:replay.replayed,changedBodyConflict:s.Reserve('k','changed',work,keep).conflict,editBatchRetained:edits.Size===1}));
})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```
Decisive output:
```json
{"calls":2,"retryReplayed":false,"successReplayed":true,"changedBodyConflict":true,"editBatchRetained":true}
```

Verification boundary: the supplied receipt now reports 74/74 focused HTTP tests, the real-module smoke,
and a full-suite result of 3004 passed / 1 failed, attributed by the producer to the pre-existing
thread-memory test on development. Those suite results and the baseline attribution are
**[Unverified — needs clone run]** by this reviewer. No suites or executable fixtures were run here;
the harness gate remains responsible for clone verification. Approval covers the reviewed implementation,
not a claim of a green full suite or a completed pilot.

Only this relay file was edited; no artifact/source edits or git commands were performed.

### Attestation · relay-drive — 2026-11-06T19:04:18Z
task: RELAY-gh301-phase2-final-qa
reviewer: codex
status: Approved
reviewed-head: 1627ac66d0a47615b645a3ee6197da81584d3434
added-range: 9843+2705
added-sha256: 9fe95497e5d67ed174d530ebafefce6f147afe344c65a53438310d9438811896


## Producer — post-approval delta (commit `7ffc4fe`), round 3 of 3

PR #306's CI and bot reviewers (Greptile, CodeRabbit) found the following after your round-2 approval. All are
accepted. Please confirm the delta `abc1c63..7ffc4fe`.
1. **CI flake (test only):** the durable-create test restarted the API on the same port, and a pooled keep-alive
   socket failed. It now uses a second `WebAPI` instance on another port.
2. **Replay before persistence:** a create whose first save threw remains stamped in memory, and a replay could
   acknowledge it unsaved. `#RunPrincipalBulkAsync` now awaits `RemindersModule.SaveRemindersNowAsync()`
   (new: `#SaveRemindersAsync` through the serialized chain, rethrowing) before returning `created`/
   `replayed`. A failure returns `save-failed` and is not kept.
3. **Versions sampled late:** the retitle, reschedule and create writers accept `OnVersion` and call it right
   after the synchronous mutation, before any await. The API returns that produced version, so a human edit
   during the writer's later save or Lists awaits is never covered by it. `partial` now carries its version;
   `unchanged` echoes the sent version.
4. **Tests:** a produced version with a concurrent edit that then conflicts; a partial version; a missing reminder
   beside a valid one; a failed replay save that is not cached. Red controls for 2 and 3 are confirmed. The smoke  [Unverified — no citation]
   harness follows the conventions.

Focused: web-api 76/76 (twice), integration GH-301 block 5/5, build clean, sanitize clean.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->


## Codex reviewer — post-approval delta, round 3 (2026-11-06)

**Ship — Approved.** Reviewed the supplied post-approval changes in the current seeded files against the
approved Phase 2 plan and issue artifact. No new Blocker or Should findings.

- Persistence: `src/web-api.js:1273–1285` checks the stamped fingerprint before replay, awaits
  `SaveRemindersNowAsync()`, and returns outer `success:false/code:save-failed` on rejection. The reservation
  keep predicate therefore discards that failure. `src/reminders-module.js:882–883` delegates to the existing
  serialized save chain (`:4158–4162`), which recovers from a prior rejection and propagates the new failure.
  Fresh creates still await the queue's durable save (`:4635`) before success; no second storage path was added.
- Versions: retitle (`src/reminders-module.js:1236`) and reschedule (`:1276`) capture their produced digest
  synchronously after mutation and before save/List awaits. Create captures before entering the synchronous
  queue insertion (`:1399–1400`). The API threads the callback into those writers and uses the captured value
  for created/updated/partial results (`src/web-api.js:1302–1308`), while unchanged echoes the checked input.
  This avoids acknowledging a later human edit as the bot's own produced version.
- Tests inspected: the fresh-API durable replay case uses another port and cleans it up in finally
  (`tests/web-api-reminders.test.js:1008–1025`); its failed-save retry asserts refusal followed by same-ID
  replay with one create. The produced-version case asserts a subsequent conflict, and the partial/missing
  case checks both response contracts (`:1045–1065`). The adapter tests use mocked writers; callback
  placement in the real writers was reviewed directly rather than inferred from those mocks.
- Scope remains the approved create/retitle/reschedule delta. Existing writer ownership, FSM transitions,
  and scheduling/snooze paths are retained. No new automatic channel-post path is introduced.

Verification boundary: the receipt reports 76/76 focused HTTP tests twice, 5/5 integration cases, build,
sanitize, and two red controls. These execution claims are **[Unverified — needs clone run]** by this reviewer.
No suites, executable fixtures, smoke harness, or runtime module probes were executed here. The earlier
full-suite failure remains a reported limitation; this approval does not assert a green full suite or pilot.
The harness gate must perform the permitted disposable-clone verification.

Graph discovery was attempted but returned “MCP tool call requires approval, but approval policy is never”;
review fell back to the explicitly named source, tests, plan and evidence files. Only this relay file was
edited. No artifact/source edits or git commands were performed.
