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
