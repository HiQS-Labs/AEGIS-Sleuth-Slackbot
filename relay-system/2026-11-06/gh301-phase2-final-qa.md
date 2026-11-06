---
Goal: Final QA of the GH-301 Phase 2 implementation (create/retitle/reschedule for bots, version checks, durable create)
Date: 2026-11-06
NEXT: Producer
STATUS: Open
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
