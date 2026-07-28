# P1 — Test Harness

**Status:** ✅ Implemented and expanded (v1.4.35)
**Last Updated:** 2026-03-19

---

## What exists now

| Tool | What it tests |
|---|---|
| `npm test` | Pure-logic unit tests plus Slack wrapper integration coverage via Jest (97 tests) |
| `npm run build` | TypeScript type correctness |
| `npm run validate:ai` | AI prompt/schema file integrity |
| `@Sleuth AI test random reminder` | Reminder display formatting, live in Slack |
| `@Sleuth AI test github sync` | GitHub PAT connectivity, live in Slack |
| `@Sleuth AI run-tests` | Admin-only full Jest suite trigger, live in Slack |
| Manual Slack workspace | End-to-end event flows |

---

## Test suite — `tests/`

### `tests/date-utils.test.js`
Covers the timezone and date math in `src/date-utils.js`:
- `GetLocalizedUtcDate` — correct wall-clock conversion for named timezones (New York, Los Angeles, UTC, half-hour offsets like Asia/Kolkata), including date-boundary crossing
- `GetTimeZoneOffsetInMinutes` — UTC = 0, positive/negative offsets, DST-aware range check for America/New_York
- `GetCurrentDateInTimeZone` — returns a valid `Date` within a 2-second window of now

### `tests/slack-format-utils.test.js`
Covers all static methods in `src/slack-format-utils.js`:
- `BuildReminderSnippet` — link stripping (`<url|display>` → display text), bare URL stripping, blockquote marker removal, whitespace collapse, truncation at default 120 chars and custom length, null/empty handling
- `MrkdwnToRichText` — user mentions, `<url|text>` links, bare URLs, channel references, plain-text segments, empty string
- `RichTextToPlainText` — string passthrough, user/link/channel elements, recursive `rich_text_section`, null guard
- `ExtractUserMentions` — single/multiple/deduplicated mentions, no-mention and null cases
- `ExtractCleanSummary` — mention bracket stripping, link expansion, blockquote line removal, truncation, null fallback
- `ExtractKeyTasks` — key-task section extraction, fallback to `ExtractCleanSummary`, null guard
- `ExtractAssignee` — first human user from quoted section, bot-ID filtering, null cases
- `ExtractDueDate` — "by Wednesday / tomorrow at 5 PM / Friday EOD" patterns, no-match and null cases

### `tests/github-sync-module.test.js`
Covers pure-logic static methods extracted from `src/github-sync-module.js`:
- `ParseGitHubUrl` — issue URLs, PR URLs, trailing slash, non-github.com domains, non-issue paths (actions, repo root), malformed strings, null/undefined input
- `EvaluateAutoComplete` — single closed issue completes, multiple closed issues, any open issue blocks completion, PR URLs always block completion, API error blocks completion, rate-limit sets `stopCycle: true`, empty URL list
- `TestGitHubUrlAsync` (mocked fetch) — open issue response, closed issue response with auto-complete note, 403 forbidden, 404 not found, response missing state field, no PAT configured (no fetch called)

---

## Key design decision — logic extraction

`#BuildReminderSnippet` was originally a private method on `GitHubSyncModule`. To make it testable without instantiating the full module (which has Slack/OpenAI dependencies), the sanitization logic was extracted into `SlackFormatUtils.BuildReminderSnippet` (public static). `GitHubSyncModule` now delegates to it. This is the pattern to follow for any future logic that needs test coverage.

---

## Running the tests

```sh
npm test            # run all tests once
npm run test:watch  # watch mode (re-runs on file save)
```

`nodemon.json` ignores `tests/` so editing or running tests does not trigger a dev-server restart.

---

## Layer 2 — Mock SlackApp harness

**Status:** ✅ Implemented and expanded (v1.4.35 — 97 tests)

Layer 2 now exists as a lightweight `MockSlackApp` in `tests/mocks/mock-slack-app.js`. It mirrors the Sleuth `SlackApp` wrapper contract closely enough to test real module registration, dispatch chaining, and Slack output capture without a live Slack connection.

**Current coverage includes (v1.4.35):**
- handler-chain semantics (`true` stops dispatch; thrown errors are logged and do not abort the chain)
- `RemindersModule` — `show reminders` empty state, `show my reminders` empty state
- `RemindersModule` — non-creator rejection for `enable reminders` and `disable reminders`
- `RemindersModule` — channel-creator happy path for `enable reminders` and `disable reminders` with persisted enabled-channels file updates
- `RemindersModule` — `test random reminder` with empty queue
- `RemindersModule` — non-admin rejection for `github sync now`; admin `github sync now` with no module attached
- `RemindersModule` — `white_check_mark` and `wastebasket` reaction flows using real reminder metadata
- `ChatModule` — admin `commands` posts the command reference
- `ChatModule` — non-admin rejection for `commands`, `run-tests`, and `run-diagnostics`
- `ChatModule` — admin `run-diagnostics` posts a result message

**Not covered yet:**
- AI-backed reminder creation paths
- `alarm_clock` reaction flow (requires thread-message setup plus reminder-creation stubbing)
- multi-module startup orchestration close to `src/app.js`

### High-Level Implementation Plan

1.  **Define the Interface:** Identify the exact subset of the Sleuth `SlackApp` wrapper that our modules use. Modules do not talk directly to the Bolt App instance; they interact with the internal wrapper. The interface must include:
    *   Registration methods: `HandleAppMention`, `HandleMessage`, `HandleReactionAdded`
    *   Action methods: `PostMessageTextAsync`, `UpdateMessageAsync`, `AddReactionAsync`
    *   Context properties/helpers: `Logger`, `WorkspaceInfo`, `AppMentionString`, `Stats`
2.  **Create `MockSlackApp` Class:** Build a mock class in `tests/mocks/mock-slack-app.js` that implements these Sleuth-level methods. 
    *   Registration methods should store the provided handler callbacks in local arrays (e.g., `this.appMentionHandlers = []`).
    *   Action methods (`PostMessageTextAsync`) should push the outcome to an internal `sentMessages` array for assertion.
3.  **Provide Event Simulators (Replicate Dispatcher Logic):** Add helper methods to the mock to trigger registered handlers. Crucially, these simulators must replicate the real dispatcher logic:
    *   `mockApp.SimulateAppMentionAsync(event)` -> Iterates over the registered app-mention handlers. Awaits each handler and stops the chain immediately if a handler returns `true`. It must also catch and log exceptions to match production routing behavior.
4.  **Integration Test Setup (`tests/reminders-integration.test.js`):**
    *   Instantiate `MockSlackApp` providing necessary dependencies (realistic `WorkspaceInfo`, `logger`, `stats` stub).
    *   Pass it into `const module = new RemindersModule(mockApp)`.
    *   Initialize the module with `await module.StartAsync()` only when the target flow actually requires runtime-loaded state or `WorkspaceAI`.
    *   Call `await mockApp.SimulateAppMentionAsync({ user: "U123", text: "test reminder" })`.
    *   Assert that `mockApp.sentMessages` contains the expected plain text confirmation dispatched via `PostMessageTextAsync`.

**Expand Layer 2 when any of these happen:**

1. **A bug slips through `npm test` and only appears in Slack** — e.g., a command regex matches the wrong input, or a handler posts to the wrong channel. That's a signal the bug lives in the dispatch/wiring layer, which pure-logic tests cannot reach.

2. **You add a new command and want to verify the full `@Sleuth AI <command>` flow without typing it in Slack** — e.g., confirming `@Sleuth AI restart` is correctly gated to admins, or that `@Sleuth AI commands` returns all expected sections.

3. **A regression in reminder creation or snooze suppression** — e.g., a reminder fires into the wrong channel, or `#ShouldSuppressForSnooze` passes when it should block. These require `RemindersModule` + `SlackApp` interaction to reproduce and can't be isolated in a utility test.

4. **The test suite covers all pure-logic paths but you still feel uncertain before deploys** — that's the sign remaining risk has moved into the module interaction layer, not utility functions.

**Short version:** when you find yourself manually running the same Slack flows more than 2–3 times to verify a single change, Layer 2 is worth building.

---

## GitHub sync — test coverage

`src/github-sync-module.js` is covered in `tests/github-sync-module.test.js` (21 tests, added v1.4.30).

**Coverage added:**
- `ParseGitHubUrl` static — URL regex (issues, PRs, bad input)
- `EvaluateAutoComplete` static — full decision matrix (closed/open/PR/error/rate-limit/empty)
- `TestGitHubUrlAsync` — HTTP response handling via mocked `fetch` (open, closed, 403, 404, missing state, no PAT)

**Still not covered (lower priority):**
- Dedup detection across poll cycles (requires module state + multiple call simulation)
- PAT expiry / 401 path within the main sync loop (integration-level concern)

---

## Layer 2.5 — Slack-triggered Jest suite

**Status:** ✅ Implemented (v1.4.31)

### Goal

Add an admin-only Slack command that runs the full local Jest suite from the Sleuth chat interface and posts the final result back into Slack when the run completes.

### Command

```text
@Sleuth AI run-tests
```

### Current v1 UX

When the command is accepted, Sleuth posts exactly one immediate acknowledgement:

```text
Jest test suite running. Results will be posted here when the suite completes.
```

No incremental streaming is used in v1. Sleuth waits for Jest to finish, then posts one final success/failure summary in the same Slack thread.

### Why this scope is recommended first

- Lower effort than streaming test output or posting per-file progress.
- Lower operational risk because the Slack command surface stays narrow.
- Easier to reason about in production: one command, one running process, one final result.
- Fits the current repo structure because `npm test` already exists as the canonical Jest entrypoint.

### Effort and risk

| Version | Effort | Risk | Notes |
|---|---|---|---|
| Minimal v1 (`run-tests` with final summary only) | Low-Medium | Low | No streaming, no arbitrary args, no artifact handling |
| Expanded version (stream output into Slack) | Medium | Medium | More Slack formatting, truncation, and process-management complexity |

### Recommended implementation shape

1. Add an admin-only app mention command in `src/chat-module.js` using the same command-dispatch pattern as `run-diagnostics` and `restart`.
2. Spawn the fixed command `npm test` from the app process using Node child-process APIs.
3. Immediately post the acknowledgement message to Slack.
4. Capture stdout/stderr while Jest runs.
5. When Jest exits, post one final Slack message with:
   - pass/fail status
   - exit code
   - elapsed duration
   - short summary or trimmed failure output

### Required guardrails

- Admin-only access.
- Single-flight lock so only one Jest run can execute at a time.
- Fixed command only; do not allow Slack users to pass arbitrary shell arguments.
- Timeout protection in case the suite hangs.
- Output truncation so Slack replies stay readable and within platform limits.
- Clear logs with workspace name and requesting user ID.
- Persist captured Jest stdout/stderr to the app logs for post-run inspection.

### Suggested final-result format

**On success:**

```text
Jest suite passed.
Tests: 93 passed, 0 failed.
Duration: 2m 41s.
```

**On failure:**

```text
Jest suite failed.
Tests: 72 passed, 3 failed.
Duration: 2m 58s.
Top failures:
- github-sync-module.test.js: blocks auto-complete when any issue remains open
- chat-module.test.js: rejects non-admin run-tests command
```

### Explicit v1 non-goals

- No live streaming of Jest output into Slack.
- No per-test progress updates.
- No support for custom Jest flags from Slack.
- No coverage report upload.
- No restart or deploy actions based on test results.

### Architecture note

This command would be an operator convenience layer, not a replacement for local terminal-based testing. It should remain a thin wrapper around the existing `npm test` workflow, not a second test runner with separate behavior.

---

## Layer 3 — Future: HTTP-driven agent testing

The Web API on port 2020 is a real HTTP surface. An AI agent or script could drive `GET /workspace/:name`, `POST /workspace`, etc. Injecting Slack events programmatically would require a `/simulate-event` endpoint or switching from Socket Mode to HTTP mode — neither is a current priority.
