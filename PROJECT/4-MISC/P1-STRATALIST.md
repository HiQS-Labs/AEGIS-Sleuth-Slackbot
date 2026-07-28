# Project Plan: Stratalist Integration

## Goal
Ship Stratalist support in maintainable phases, starting with read-only list viewing and reusing the same deterministic fetch/validation contract for later reminder import.

Current first milestone:
- `@Sleuth AI view stratalist <list-slug-or-url>`

Deferred follow-on milestone:
- `@Sleuth AI import https://stratalist.net/go/jinhui2026 assign @jinhui`

## Confirmed External Contract

Live Stratalist endpoint:
- `GET https://stratalist.net/api/public/share/:slug`

Confirmed live examples:
- `https://stratalist.net/api/public/share/jinhui2026`
- `https://stratalist.net/api/public/share/tdbhIvYYUWhE`

Current payload assumptions:
- public lists return `200` JSON
- missing lists return `404` JSON
- non-public lists return `403` JSON
- items include stable item IDs
- items include `completed` and `trashed`
- items may include `dueAt`
- date-only items should eventually be treated as `10:00 AM` in Sleuth workspace local time
- fully undated items require explicit fallback behavior to import

## v1 Product Contract

### Supported command shape
- `@Sleuth AI import <stratalist-url>`
- `@Sleuth AI import <stratalist-url> assign @user`
- `@Sleuth AI import <stratalist-url> assign me`
- `@Sleuth AI import <stratalist-url> undated tomorrow`
- `@Sleuth AI import <stratalist-url> assign @user undated next monday 10am`

### Import rules
- import only non-completed, non-trashed items
- default assignee is the sender when `assign ...` is omitted
- `assign me` resolves to the requesting Slack user
- explicit `assign @user` applies to every imported reminder in that command
- set `AssigneeID` directly on imported reminders
- do not rely on the normal reminder-message assignee extraction path for imports
- if Stratalist provides a real timestamp, use it directly
- if Stratalist provides a date-only value, schedule at `10:00 AM` in workspace `MAIN_TIMEZONE`
- if an item has no due date, skip it unless the command includes an `undated ...` fallback

### v1 non-goals
- no live sync back to Stratalist
- no periodic re-import
- no DOM scraping of Stratalist share pages
- no import-on-paste without an explicit `import` command
- no retroactive update/delete linkage between Stratalist and existing Sleuth reminders

## Architecture Placement

Ownership in Sleuth should be:
- `RemindersAppMentionHandler` owns the explicit Slack import command route
- `RemindersModule` owns reminder creation, persistence, and `AssigneeID` assignment
- new Stratalist fetch/parse helper should stay deterministic and non-AI
- `WorkspaceAI` should not be involved in the basic import path

Recommended file/module split:
- `src/reminders-app-mention-handler.js`
  - parse `import ... assign ... undated ...`
  - invoke import service
- `src/reminders-module.js`
  - add a deterministic import entrypoint for creating reminders from structured external items
- `src/stratalist-import.js`
  - parse Stratalist URLs
  - fetch `/api/public/share/:slug`
  - validate payload shape
  - normalize due-date behavior
  - return structured import candidates + skip reasons

## Spike 0: Harness Contract Probe

Do this before wiring the feature into production reminder flow.

Goal:
- prove the Stratalist payload contract
- prove command parsing
- prove due-date and assignee normalization
- expose duplicate/import edge cases early

### Checklist
- [x] Capture fixture JSON from the two known live sample endpoints and save them as local test fixtures
- [x] Build a pure parser/normalizer prototype that does not touch Slack routing or reminder persistence yet
- [x] Drive the prototype through focused Jest coverage and a one-shot probe script
- [x] Verify command parsing for:
  - `import <url>`
  - `import <url> assign me`
  - `import <url> assign <@USER>`
  - `import <url> undated tomorrow`
  - `import <url> assign <@USER> undated next monday 10am`
- [x] Verify import normalization for:
  - completed items skipped
  - trashed items skipped
  - date-only items mapped to `10:00 AM` local
  - real timestamps passed through unchanged
  - undated items skipped without fallback
  - undated items normalized when fallback exists
  - assignee set directly from command input
- [x] Decide and test the duplicate key strategy before touching persistence
- [x] Document Stratalist payload quirks discovered in this spike back into this plan

### Guardrails
- freeze live Stratalist responses into fixtures before relying on them in tests
- do not make the spike depend only on live network calls
- keep the spike deterministic and non-AI
- do not wire production reminder creation until the fixture-driven spike passes

### Exit criteria
- sample payloads are frozen into fixtures
- parser/normalizer behavior is locked by tests
- import command grammar is stable enough to implement
- any gotchas are documented before Phase 0/1 production work begins

### Spike output
- Fixtures:
  - `tests/fixtures/stratalist/jinhui2026.public-share.json`
  - `tests/fixtures/stratalist/tdbhIvYYUWhE.public-share.json`
- Parser/normalizer module:
  - `src/stratalist-import.js`
- Probe script:
  - `npm run stratalist:spike -- --command "import https://stratalist.net/go/jinhui2026 assign me undated tomorrow" --fixture-file tests/fixtures/stratalist/jinhui2026.public-share.json`
- Focused tests:
  - `tests/stratalist-import.test.js`

### Spike decisions
- Duplicate key strategy: `stratalist:<list-slug>:<item-id>`
- Accepted URL inputs in the spike:
  - `https://stratalist.net/go/:slug`
  - `https://stratalist.net/api/public/share/:slug`
- Current spike grammar:
  - `import <url> [assign me|<@USER>] [undated <phrase>]`
  - if both optional clauses are present, `assign ...` must come before `undated ...`

### Gotchas discovered
- Current live sample payloads are still fully undated. After filtering out completed items, the `jinhui2026` fixture produces zero directly schedulable reminders unless an explicit `undated ...` fallback is supplied.
- At least one live item contains time-like text in the item body but still has `dueAt: null`. Example: `Lovable Event - Friday at 4 PM ...` in `tdbhIvYYUWhE`. Import must trust structured due metadata, not infer dates from raw item text during the deterministic pass.
- Current live payloads use `timezone: null`, so the Sleuth workspace timezone must remain the source of truth for date-only conversion until Stratalist emits an actual list timezone.

## Phase 0: Contract Freeze

### Checklist
- [ ] Confirm final command syntax and precedence for `assign ...` and `undated ...`
- [ ] Confirm whether v1 should accept only `stratalist.net/go/:slug` URLs or also raw API URLs
- [ ] Confirm the exact date-only payload shape Stratalist will send long-term
- [ ] Confirm whether the import feedback should be posted as one summary or one message per imported reminder
- [ ] Confirm whether duplicate detection should be bypassed, reused, or enhanced for imported reminders

### Exit criteria
- command grammar is fixed
- import behavior for undated items is fixed
- Stratalist JSON contract is stable enough to code against

## Phase 1: Deterministic Fetch + Normalize

Build a deterministic importer with no Slack coupling.

### Checklist
- [ ] Add URL parser for `https://stratalist.net/go/:slug`
- [ ] Resolve `:slug` into `https://stratalist.net/api/public/share/:slug`
- [ ] Fetch JSON with clear handling for `403`, `404`, invalid JSON, and malformed payloads
- [ ] Validate required fields: list slug/title plus item `id`, `text`, `completed`, `trashed`
- [ ] Normalize items into an internal import shape:
  - `SourceListSlug`
  - `SourceItemId`
  - `Text`
  - `Completed`
  - `Trashed`
  - `DueDateKind` = `timestamp` | `date-only` | `undated`
  - `DueAt`
- [ ] Filter out completed and trashed items before reminder creation
- [ ] For real timestamps, preserve the timestamp
- [ ] For date-only items, convert to `10:00 AM` in workspace `MAIN_TIMEZONE`
- [ ] For undated items, mark as skipped unless an explicit fallback was provided
- [ ] Return a structured result with:
  - imported candidates
  - skipped completed items
  - skipped trashed items
  - skipped undated items
  - fetch/contract errors

### Exit criteria
- importer can parse and normalize both live sample lists
- importer returns deterministic results with no AI calls

## Phase 2: Slack Command Route

Add the explicit reminder import command.

### Checklist
- [ ] Add deterministic app-mention route in `RemindersAppMentionHandler`
- [ ] Parse:
  - `import <url>`
  - optional `assign <@USER>` or `assign me`
  - optional `undated <phrase>`
- [ ] Reject unsupported syntax with a short usage message
- [ ] Normalize `assign me` to requesting Slack user ID
- [ ] Require a real Slack mention for `assign @user` at the Slack event level when possible
- [ ] Post a clear summary after import:
  - imported count
  - skipped completed count
  - skipped trashed count
  - skipped undated count
  - failed count
- [ ] Include enough detail for operators to tell what happened without reading logs

### Exit criteria
- command is routable and deterministic
- bad syntax fails cleanly
- successful import gives a clear summary

## Phase 3: Reminder Creation Path

Create reminders from structured imported items without passing through the normal AI analyzer.

### Checklist
- [ ] Add deterministic reminder creation helper in `RemindersModule`
- [ ] Create reminders directly from normalized Stratalist items
- [ ] Set `AssigneeID` directly from the parsed command option or sender fallback
- [ ] Use imported item text as the task body without AI rewriting
- [ ] Preserve the source URL and source item ID in a structured way for future dedupe/debugging
- [ ] Keep reminder state initialization aligned with current FSM rules
- [ ] Ensure imported reminders still flow through normal persistence and list-sync paths
- [ ] Ensure imported reminders still respect snooze rules when eventually posted

### Exit criteria
- imported items create normal pending reminders
- imported reminders behave like native reminders once queued

## Phase 4: Duplicate and Re-Import Guardrails

Prevent noisy duplicate imports.

### Checklist
- [ ] Decide on duplicate key strategy:
  - Stratalist slug + item ID
  - or source URL + item ID
- [ ] Store import provenance on each reminder in a backward-compatible way
- [ ] On repeat import of the same Stratalist item:
  - skip if an equivalent pending reminder already exists
  - do not create duplicates from repeated command use
- [ ] Keep current duplicate detection behavior for non-import reminder flows unchanged
- [ ] Add read-time backfill if any reminder JSON schema changes

### Exit criteria
- re-importing the same list does not flood duplicate reminders

## Phase 5: User Feedback and Help

Make the feature discoverable without making it noisy.

### Checklist
- [ ] Add a concise help/catalog entry for the import command
- [ ] Add one short generated help line with the canonical syntax
- [ ] Add admin command reference entry if appropriate
- [ ] Keep help copy short and command-first
- [ ] Update `CHANGELOG.md`
- [ ] Bump `package.json` version when behavior ships

### Exit criteria
- feature is documented through the existing generated-help path

## Phase 6: Tests

### Unit tests
- [ ] Stratalist URL parsing
- [ ] API URL derivation from share URL
- [ ] payload validation
- [ ] date-only conversion to `10:00 AM` local
- [ ] undated fallback parsing
- [ ] assignee parsing: omitted, `assign me`, `assign <@USER>`
- [ ] duplicate prevention for repeated import

### Integration tests
- [ ] app mention route handles valid import command
- [ ] app mention route rejects malformed command
- [ ] completed and trashed items are skipped
- [ ] undated items are skipped when no fallback is provided
- [ ] undated items import when fallback is provided
- [ ] imported reminders get `AssigneeID` directly from command input
- [ ] imported reminders are persisted and indexed like native reminders

### Smoke checks
- [ ] run against saved fixtures for both live sample lists
- [ ] verify `npm run build`
- [ ] verify full Jest suite

## Suggested Implementation Order

1. Build `src/stratalist-import.js` with fixture-driven tests.
2. Add deterministic import creation helper in `RemindersModule`.
3. Add the `import ... assign ... undated ...` route in `RemindersAppMentionHandler`.
4. Add provenance + dedupe handling.
5. Add generated help/catalog docs.
6. Run full verification and version/changelog updates.

## Open Questions

- Should `assign @user` be required to use a real Slack mention only, or should fallback `@username` text be accepted in a limited way?
- Should v1 support importing raw API URLs as well as share URLs?
- Should undated fallback accept only natural language date phrases, or also fixed keywords like `tomorrow`, `next week`, and `monday 10am`?
- Should imported reminders quote/link back to the Stratalist share URL in reminder text, or should provenance stay internal-only for v1?
- Should repeated import of the same item silently skip duplicates, or report them explicitly in the summary?

## Acceptance Bar

The feature is ready for v1 when:
- a user can run `@Sleuth AI import <stratalist-url>`
- optional `assign ...` works deterministically
- optional `undated ...` works deterministically
- imported reminders are created without AI parsing
- completed/trashed items are skipped
- undated items are skipped unless fallback is provided
- repeated imports do not create duplicate pending reminders
- help, tests, build, changelog, and versioning are all updated
