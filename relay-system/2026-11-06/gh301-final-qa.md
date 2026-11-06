---
Goal: Final QA of the GH-301 Phase 0–1 implementation (bot principals on the Web API)
Date: 2026-11-06
NEXT: Reviewer
STATUS: Open
---

# Context

You approved the plan in round 3 of `relay-system/2026-11-06/gh301-plan-qa.md`. Now review the **implementation**
on this branch against that plan, `PROJECT/2-WORKING/GH-301-BOT-REMOTE-CRUD.md`. The issue text is seeded at
`.relay-artifacts/gh301-issue.md`.

Diff: `git diff 65210c1..HEAD -- src scripts tests docs CHANGELOG.md`, with base `origin/development`.
Evidence: `TESTS-RESULTS/2026-11-06+GH-301/verification.md`, `smoke-output.txt` and `gh301-smoke.cjs`.

**Operational envelope:** the same as the plan QA. One or two operator-owned bots, a single-tenant Slack bot,
and an Express API. Grade against the approved plan and commensurate complexity. Read-only probes under
`.relay-scratch/` are fine; don't run the jest suites here, the receipt has them.

Files:
- `src/web-api-principals.js` (new): token grammar, `LoadPrincipalsAsync` validation,
  `AuthenticatePrincipalAsync`, `IsLoopbackAddress`, `MatchPrincipalRoute`, `IdempotencyStore`
- `src/web-api.js`:
  - `#AuthorizationMiddleware` and its principal branch, `#AuthorizePrincipalAsync`, `#DenyPrincipal`,
    `#PrincipalOf`;
  - `#HandleGetWorkspaceRemindersAsync`, with workspace binding and `#ParsePrincipalPage`;
  - `#HandlePostWorkspaceRemindersBulkAsync`, `#HandlePrincipalBulkAsync`, `#CheckPrincipalBulkShape`,
    `#PrepareBulkRequest`, `#RunBulkAsync`
- `scripts/web-api-principal.js`; `docs/web-api.md` → "Bot principals (GH-301)"; `CHANGELOG.md` Unreleased
- `tests/web-api-reminders.test.js` → `Bot principals (GH-301 Phase 1)`

Questions:

1. Does the code match the approved plan for each item: token and file validation, transport, the exact route
   allowlist, workspace and scope checks, Phase-1 action and field allowlists, the server-owned reason,
   idempotency, audit and paging? Is anything planned missing, or anything unplanned added?
2. **Legacy unchanged?** The bulk handler was refactored into `#PrepareBulkRequest` and `#RunBulkAsync`. Are
   legacy requests and responses (messages, envelope, ordering, validation-before-workspace-lookup)
   byte-identical? Is the legacy GET unchanged?
3. **Idempotency correctness:**
   - Is the reservation truly synchronous before the handler's first `await`?
   - Is it correct that only `success:true` payloads are kept?
   - Do eviction and in-flight protection and conflict-during-flight work?
   - Is a replay served only after re-authentication? The middleware runs before the handler on every request.
4. **Security edges:**
   - Can a principal reach any other route?
   - Can its token or untrusted text reach a log?
   - Do `IsLoopbackAddress` and the `encrypted` check behave as documented?
   - Does any error path leak a code or detail to legacy callers?
5. Do the tests and the receipt's red controls substantiate the claims? Is the footprint commensurate, with
   only the existing test file? Is the full-suite failure honestly attributed?
6. Are the docs and CHANGELOG accurate, including the stated limits: no TLS proxy yet, and the in-memory
   idempotency limits?

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the branch can ship as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->


## Codex reviewer verdict — 2026-11-06

**Return for changes. STATUS: Open.** Two Should findings; no Blocker claimed.
Reviewed the seeded issue, approved Phase 0–1 plan, named implementation, tests, docs and verification/smoke receipts. Only this relay file was edited.

### 1. [Should] Check an existing idempotency key before capacity eviction

`src/web-api-principals.js:183–185,206–214`: `Reserve` performs capacity eviction before looking up the requested key. At exactly the cap, merely retrying the oldest completed key deletes it and executes work again; changing its fingerprint also bypasses the expected conflict. Capacity pressure should evict completed entries when admitting a **new** key, after expiration cleanup and existing-key lookup. This does not require expanding the accepted TTL/restart/eviction guarantees.

Observed input: fill the default store with 1000 completed keys, then reserve `k0` with a changed body, without introducing any new key or advancing time.
Affected scope: principal bulk retries at cache capacity; same-body replay can become a second writer invocation and a different response, and changed-body reuse can execute instead of conflicting. Existing writers still prevent double completion; this is not a claim of duplicate persisted completion.
Falsifier: after filling the store, same-key/same-body returns the original result without work, same-key/different-body conflicts, and a genuinely new key still evicts a completed entry while preserving in-flight entries.

Read-only probe command (exit **0**, no files generated):
```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
node <<'NODE'
const {IdempotencyStore}=require('./src/web-api-principals');
(async()=>{
 const s=new IdempotencyStore(); let writes=0;
 for(let i=0;i<1000;i++) await s.Reserve('k'+i,'body',async()=>({success:true,n:++writes}),()=>true).promise;
 const r=s.Reserve('k0','changed-body',async()=>({success:true,n:++writes}),()=>true);
 console.log(JSON.stringify({sizeBeforeAwait:s.Size,conflict:r.conflict,replayed:r.replayed,result:await r.promise,writes}));
})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```
Decisive output:
```json
{"sizeBeforeAwait":1000,"conflict":false,"replayed":false,"result":{"success":true,"n":1001},"writes":1001}
```
A separate `Cap:1` probe with the same body also exited 0 and printed `replay {"success":true,"n":2} replayed false calls 2` immediately after the first completion.

### 2. [Should] Audit principal batch refusals as promised

`src/web-api.js:1180–1182,1193–1195`: validation failures and idempotency conflicts return directly without either `principal-denied` or `principal-write`. The approved plan requires a denial audit for each refused principal request; `docs/web-api.md` likewise says each refusal logs a line. Successful authentication emits no log, so these branches are silent. Add a bounded structured denial record containing only validated actor information and fixed code/method/route fields. Do not log the response message, raw unknown field, body, key or reason.

Observed input: an authenticated, scoped principal POST with no Idempotency-Key; alternatively a valid key plus an unknown action field, or a conflicting held fingerprint.
Affected scope: refused bot writes, including attempted disallowed fields and conflicting retries; successful-write audit remains present.
Falsifier: capture console output for each refusal and assert exactly one parseable redacted denial record, zero writer calls for validation failures, and no token/raw key/free text. Legacy responses must remain unchanged.

Evidence: `nl -ba src/web-api.js | sed -n '1166,1212p'` exited **0**. Decisive lines 1181–1182 and 1194–1195 contain only response + return; the sole `principal-write` emission is below the awaited reservation at line 1201. This finding is static control-flow evidence, not a claimed HTTP execution.

### Other conclusions and verification limits

- Token grammar, digest validation and timing-safe comparison, duplicate-id rejection, per-request revoke/expiry checks, strict route/scope/workspace binding, server-owned reasons and full-batch field/action validation follow the intended design. Socket checks ignore forwarding headers. In-flight reservation is synchronous; cached replays pass middleware authentication again.
- Keeping only top-level `success:true` results is appropriate here: pre-workspace failures can retry, while per-item errors still live inside a successful batch envelope and are retained. The cache cap finding above is separate.
- No additional provider, persistence path or command framework was introduced. Phase 2 patches/versioning, MCP and TLS deployment remain explicitly deferred. The footprint fits the stated operator-owned-bot envelope.
- Legacy paths preserve the visible response construction and validation-before-workspace lookup. Exact byte-for-byte comparison with base `65210c1` is **unverified** because this turn prohibits git. No base diff or revision identity is claimed.
- Receipts report 58 focused passes, build/structural gates, red controls and isolated real-writer smoke. The full-suite failure is explicitly disclosed with a claimed prior development reproduction, rather than presented as green. These execution claims and the baseline attribution are **[Unverified — needs clone run]** here; no suites, executable fixtures, smoke harnesses or validation scripts were run.
- Existing tests cover the main auth, overlap, redaction and paging paths, but contain no capacity-eviction check or refusal-audit assertions for the findings above. The transport test mocks `IsLoopbackAddress` false; direct unit rows cover address classification, while actual socket TLS remains unexercised as disclosed.
- Minor documentation mismatches: ordinary shared validation errors (e.g. empty actions) lack the generally promised stable `code`; missing/unreadable principal files normally map to `unknown`, not `unavailable`, because the loader returns an empty map. Admin-session refusal also bypasses the principal denial record. These do not demonstrate an authorization bypass.

Graph discovery was attempted and returned `MCP tool call requires approval, but approval policy is never`; explicit named-file reads were used. No git commands, server access, source/artifact edits or tracked-file creation occurred. NEXT is claude for the producer response.


## Producer response — round 1 (commit `16001ca`)

1. **[Should] Cap eviction before lookup: Accepted, fixed** (`src/web-api-principals.js` `Reserve`).
   - The order is now: `#Expire` (TTL), then look up the key (replay or conflict), then `#MakeRoom`, only when
     admitting a **new** key. `#MakeRoom` still evicts completed entries only.
   - New test: at the cap, the same body replays without work and a changed body conflicts. An in-flight entry
     survives a new key's eviction, which removes the oldest completed entry.
   - Red control: the pre-fix order turns it red.
2. **[Should] Refusal audit: Accepted, fixed** (`src/web-api.js`).
   - New `#LogPrincipalDenied` has fixed fields only: `code`, `id`, `method`, `route`. `#DenyPrincipal` uses it.
     It is also called for principal batch-validation refusals, key conflicts and principal GET validation errors.
   - New test: a missing key, an unknown field carrying a secret-looking value, and a key conflict each log
     exactly one parseable record, with no raw field, value, key or token.
   - Red control: dropping the validation-refusal log turns it red.
- **Doc mismatches: Accepted, fixed** in `docs/web-api.md`:
  - shared validation errors carry no `code`, as for the operator token;
  - a missing file means `unknown`, and `unavailable` only for an unexpected error;
  - `/admin/*` refusals stay with the admin session and leave no principal record.
- The file passes 60/60. The receipt is updated. The full suite was not rerun for this two-file change.

Please re-review `16001ca` and set STATUS: Approved if satisfied.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
