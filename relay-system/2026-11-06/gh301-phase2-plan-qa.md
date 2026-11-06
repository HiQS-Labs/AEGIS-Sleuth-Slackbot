---
Goal: Pre-implementation plan QA for GH-301 Phase 2 (create and edit through bot keys, with version checks)
Date: 2026-11-06
NEXT: Reviewer
STATUS: Open
---

# Context

Phase 0–1 shipped in #305; you approved its plan and code. Review the **Phase 2** section of
`PROJECT/2-WORKING/GH-301-BOT-REMOTE-CRUD.md` ("Phase 2 plan…") before any code is written. The issue text is
seeded at `.relay-artifacts/gh301-issue.md`; the relevant requirements are 6 (allowlisted patches), 7 (optimistic
concurrency), 8 (idempotency) and 10 (side effects).

**Operational envelope:** unchanged from Phase 1. One or two operator-owned bots, a single-tenant Slack bot, an
Express API. Grade against the issue and commensurate complexity. Do not ask for a database, an OAuth server,
a distributed lock or a generic patch framework.

Design choices to challenge:
- **A computed version digest** over stored fields, instead of a stored revision counter.
- **One touch per reminder per batch**, plus check-all-then-recheck-before-each-write, with the remaining
  in-writer await window accepted and documented.
- **Bot-set links force `GitHubRelayStopped = true`**, so a bot edit can never start public GitHub comments.
- **Create restricted to auto-scheduling-enabled channels**, with durable create idempotency through an
  additive `ApiCreateKey` field (pending reminders only).

Read the Phase 2 section, then the code it cites:
- `src/web-api.js`: `PrincipalBulkActions`, `#CheckPrincipalBulkShape`, `#HandlePrincipalBulkAsync`,
  `#RunBulkAsync`, `#ApplyBulkReminderActionAsync`, `#PrepareBulkReminderAction`, `#HandleGetWorkspaceRemindersAsync`
- `src/reminders-module.js`: `UpdateReminderSummaryFromListAsync`, `RescheduleReminderAsync`,
  `CreateReminderFromListRowAsync`, `#RecordLedgerGapAsync`, `AreRemindersEnabledForChannel` (~1624),
  `GitHubUrls` uses (~114, ~2153–2300)
- `src/github-comment-relay.js` (`GitHubRelayStopped`/`GitHubRelayStarted`), `src/github-sync-module.js`,
  `src/github-url-utils.js`
- `src/web-api-principals.js` (`IdempotencyStore`)

Questions:

1. Are the recon claims grounded (file:line)? In particular, is the claim about what reading and writing
   `GitHubUrls` triggers (sync, relay) right? Is `GitHubRelayStopped` the right switch, and does setting it have
   effects beyond the relay?
2. Is the version digest sound? Check the fields chosen, whether it misses something a concurrent writer can
   change that matters to a bot edit (for example list-originated title edits, snooze, posting state), and its
   determinism (sorting, Date serialization).
3. Is the conflict design sound and commensurate: check-all then recheck before each write, per-item `conflict`
   after a partial batch, and the documented in-writer window? Is anything simpler enough, or is a real hole
   left?
4. `set-links`: is the new writer minimal and correct (validation, ledger gap, no list fan-out)? Should a bot be
   able to *clear* links, and what happens to github-sync state for removed URLs?
5. `create`: is the enabled-channel rule right? Is `ApiCreateKey` durable idempotency correct and minimal (key
   derivation, pending-only scope, one create per batch)? Does `senderId` exclusion break anything in
   `CreateReminderFromListRowAsync`?
6. Are the tests and red controls falsifiable and commensurate (existing files only)? Is anything required
   missing, or anything over-built?

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the plan can proceed as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
