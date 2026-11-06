---
Goal: Pre-implementation plan QA for GH-301 Phase 2 (create and edit through bot keys, with version checks)
Date: 2026-11-06
NEXT: Producer
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


## Codex review — 2026-11-06

**Verdict: Ship with conditions; STATUS remains Open.** The shared bulk path, computed digest, enabled-channel rule, first-assignee sender fallback, and existing-file test approach are proportionate. Resolve the following plan gaps before implementation. These are [Should] findings against a proposed design, not claims of reproduced Phase-2 runtime failures.

### [Should] Preserve create identity and request binding through the first durable save

Location: `PROJECT/2-WORKING/GH-301-BOT-REMOTE-CRUD.md:340–347`; `src/reminders-module.js:1252–1325`; `src/web-api.js:1200–1206`; `src/web-api-principals.js:186–211`.

Observed input: create with key K and body A, lose the response, rebuild the API, then submit K with body B. The proposed durable lookup stores only K and returns the existing id, whereas the current in-memory store refuses a changed fingerprint. Also, the existing create writer builds and queues/saves the reminder before returning; it has no option carrying ApiCreateKey. Adding the key after that return leaves a crash window with an unmarked persisted reminder.

Affected scope: restart/eviction retries, especially mixed create/edit batches. Pending-only dedup is an explicitly bounded policy and can stay, but the current text does not define changed-body reuse or which other batch items run on a durable replay.

Correction: pass the key and a request fingerprint into the existing create writer and stamp them before queueing/first persistence. On durable lookup, reject changed-body reuse. Define mixed-batch retry results explicitly (or restrict principal create to a sole-action request as the smallest contract). No database or new idempotency subsystem is needed.

Falsifier: in the existing clone-run suite, rebuild both API and real RemindersModule from disk; identical retry returns the same id, changed body returns key-reused, and the first persisted create already carries its key/fingerprint. A mixed batch retry must have a specified, asserted result. Merely replacing IdempotencyStore while retaining the reminder object does not prove durability.

### [Should] Make the digest reflect ordered ownership and fields overwritten by edits

Location: plan `:289–290`; `src/reminders-module.js:109–116`, `:1181–1203`, `:1224–1242`, `:842–875`.

Observed input: ownership changes from [U1,U2] to [U2,U1] without changing the set; sorting produces the same digest even though the authoritative array is ordered and the primary compatibility owner changes. A relay stop/start toggle is also omitted even though set-links overwrites GitHubRelayStopped; reschedule resets IgnoreSnooze and DndHeld, also omitted.

Affected scope: stale principal edits after owner-order or scheduling/relay-control changes. ReminderMessageText already covers list-originated title edits; State covers a posting-state change, so those parts are sound.

Correction: preserve normalized assignee order (using the existing legacy-owner fallback), include the scheduling/relay flags that these actions overwrite, and define stable defaults plus Date/string ISO normalization for disk reads versus live objects. Sort copied URL arrays, never the live arrays in place.

Falsifier: digest tests show owner reordering and relevant flag changes invalidate a token; equivalent Date/string values and legacy/current owner forms hash identically; hashing does not mutate reminder arrays.

### [Should] Close the pre-mutation await gap locally instead of treating it as milliseconds

Location: plan `:299–305`; `src/reminders-module.js:1163–1168`, `:1239–1242`.

Observed input: bot retitle passes its check and waits on RecordLedgerGapAsync; another principal request (different key), Slack List edit, or completion changes/removes that reminder before the first retitle resumes. The existing writer then mutates its previously captured object without checking again. One-touch-per-batch does not serialize separate requests, and filesystem awaits have no millisecond upper bound.

Affected scope: overlapping API and Slack mutations; requirement 7's no silent overwrite promise. Check-all plus per-item conflict after earlier successes is otherwise a reasonable batch contract.

Correction: carry an optional expected version into affected writers and recheck version and queue membership after the gap await, immediately before synchronous mutation. Keep existing callers unchanged. This needs no process-wide lock. Return conflict when that final check fails.

Falsifier: hold the ledger-gap promise in the existing suite, change or remove the reminder through a second writer, then release it; the stale request reports conflict without replacing the newer text or syncing a removed reminder to Lists. Dropping the final check makes this case fail.

### [Should] Specify link clearing against in-flight GitHub sync

Location: plan `:322–331`; `src/github-sync-module.js:247–281`, `:395–406`; `src/reminders-module.js:3966–3969`.

Observed input: sync captures URL A and awaits its status; set-links replaces A with [] or B; the old poll resumes with A closed and calls CompleteReminderByIdAsync solely by reminder id. It does not compare the current URLs with the checked URLs.

Affected scope: a successful link clear/replacement can still be followed by completion based on a removed link. There is no durable per-URL sync registry to clean up; the problem is the in-flight snapshot.

Correction: explicitly retain clearing as [] (not null, which startup backfill repopulates from text), and have sync discard decisions whose checked URL snapshot no longer matches the current reminder immediately before completion. Document existing auto-complete Slack channel/thread notifications (`src/github-sync-module.js:659–679`) as set-links downstream effects.

Falsifier: hold A's status response, clear/replace links, release a closed response, and assert the reminder stays pending with no completion notification. Restart after [] must not restore old links from the title.

### [Should] Reconcile the relay-stop and unchanged contracts, and document thread scope

Location: plan `:325–330`; `src/github-comment-relay.js:147–156`, `:336–364`.

Observed input: set-links supplies the existing URL set while GitHubRelayStopped is false. The planned early unchanged return conflicts with the promise to always stop relay on a bot link edit. Separately, a stopped linked reminder causes the relay to return for the entire matching thread, including sibling reminders. A handler already awaiting relevance/user/permalink lookup has passed the stop check and can continue posting.

Affected scope: same-set calls, sibling reminder relays, and in-flight public comments. GitHubRelayStopped is the correct existing switch and does not disable GitHub status sync, but the scope and timing are broader/weaker than the plan states.

Correction: treat a false-to-true stop flag as an update even when URLs match. Document the existing whole-thread effect and avoid an absolute guarantee about already-running posts, or add a final stop/current-link check at the public-post boundary. Identify the actual operator re-enable mechanism rather than asserting an unspecified usual way.

Falsifier: same-set bot call with relay active persists the stop; repeat returns unchanged. A two-reminder thread demonstrates the documented stop scope. If preventing in-flight posts is promised, pause the handler after its initial check and assert a subsequent bot edit prevents the GitHub POST.

### Evidence and limits

Read the seeded issue and Phase-2 plan, canonical architecture/changelog, and cited writer, HTTP, principal, URL, sync and relay sources. Graph discovery was attempted but returned `MCP tool call requires approval, but approval policy is never`; direct targeted source reads were used. No executable fixtures, tests, validators, app startup, or git commands ran. All source-read commands exited 0. Runtime claims above are static fail-path analysis; the proposed falsifiers are **[Unverified — needs clone run]**. Existing red controls are useful; add the focused interleaving/durable-reload cases to the same existing suites rather than creating new machinery. URL validation should define whole-input acceptance/normalization: ExtractGitHubUrls extracts substrings and strips suffixes, and is not itself a strict URL validator.
