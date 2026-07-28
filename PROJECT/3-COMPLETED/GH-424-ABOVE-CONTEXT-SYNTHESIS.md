---
title: "\"above\" thread-reference not resolving into the reminder title"
status: Completed — all phases shipped (v1.4.239, v1.4.240, v1.4.241)
created: 2026-07-21
updated: 2026-07-21
owner: noel
branch: gh424-above-context-synthesis
doc_type: project
gh_issue: 424
source: https://github.com/NeochromeTeam/sleuth-app/issues/424
related: "AGENTS.md #0.1 canonical command-route pattern; scripts/first-time-user-battery.js (harness precedent); relay-xyz skill (headless review)"
effort: 2
complexity: 2
risk: 2
phases: 3
---

# GH-424 — "above" thread-reference not resolving into the reminder title

Captured retroactively (PDDA doc written after both phases shipped, per operator direction — see
Progress log).

## Why

A Slack thread reply like `@Alex Rivera please help follow on above with WP Engine support
chat by 11 AM PT` should resolve "above" against the earlier thread messages and synthesize a real
task title. Instead the literal word "above" was left in the reminder text — Sleuth never actually
looked at the preceding thread content.

## Phase 1 — widen the enumerated verb list (shipped v1.4.239)

`TASK_ABOVE_SHORTHAND_PATTERN` in `src/reminders-app-mention-handler.js` only matched the verb
phrase `follow up on` before `above`, not the shorter `follow on` from the actual report. When the
regex failed to match, the message fell through `TryHandleTaskAboveShorthandAsync` and
`TryEnrichVagueCompletionFromAboveAsync` (neither applies to the literal word "above") straight to
the plain auto-schedule path, which has no preceding thread context to resolve "above" against.

- [x] Widened the verb alternation to `follow\s+(?:up\s+)?on`.
- [x] 2 regression tests in `tests/reminders-app-mention-handler.test.js`.

**This phase was insufficient** — confirmed live the same day when a *different* phrasing
("please see above and meet at the park at 2 PM tomorrow") reproduced the identical symptom. The
enumerated-verb approach is structurally a whack-a-mole: every new phrasing needs its own regex
entry, and there is no way to enumerate all of them in advance.

## Phase 2 — verb-agnostic trigger + a working test harness (shipped v1.4.240)

Replaced the enumerated-verb approach with a generic trigger: any thread reply containing the
**standalone word "above"** plus an existing scheduling-trigger check now resolves via the same
context-prepending mechanism already built for vague pronoun references ("it"/"this"/"that").
"above" needs no preposition/verb guard — unlike those pronouns, it is essentially never used
except to point at earlier thread content.

- [x] Added `ABOVE_REFERENCE_PATTERN` (`/\babove\b/i`) as a third trigger inside
      `TryEnrichVagueCompletionFromAboveAsync`, alongside `VAGUE_COMPLETION_IN_THREAD_PATTERN` and
      `VAGUE_REFERENCE_IN_THREAD_PATTERN`.
- [x] `TASK_ABOVE_SHORTHAND_PATTERN` (still verb-enumerated) keeps first crack — it has extra
      behavior (explicit trailing-mention targeting, default-to-tomorrow-8am when no schedule is
      given) worth preserving for its exact-match case. The new pattern is the fallback for
      everything else.
- [x] 6 new regression tests (`tests/reminders-app-mention-handler.test.js`), covering "see
      above", "check above", "per above", "as noted above", plus edge cases (no scheduling
      trigger present, no preceding human message).

### A working test harness (the actual ask behind this phase)

The operator asked to interactively test fixes like this without relying on manual Slack
round-trips. The obvious approach — extend `scripts/slack-harness-post.js` to post a message and
poll for Sleuth's reply — **does not work**: that script posts through the live bot token, and
Slack Bolt's default `ignoreSelf: true` middleware silently drops any event authored by the bot's
own user ID before any handler (including `RemindersModule#OnMessageAsync`) ever sees it.

Built `scripts/reminder-thread-battery.js` instead, modeled on the existing
`scripts/first-time-user-battery.js` precedent: drives the real `RemindersModule`/`WorkspaceAI`
through `MockSlackApp.SimulateMessageAsync` — no Slack transport, so no `ignoreSelf` problem, and
instant (no polling). Runs against a throwaway `<workspace>-test-harness` workspace name so its
disk-backed reminder persistence never touches the real workspace's runtime files.

- [x] `scripts/reminder-thread-battery.js` — CLI, takes `--workspace` (real workspace to borrow
      model/API config from) + `--scenario` (a JSON file of ordered thread turns), replays the
      scenario turn-by-turn, prints Sleuth's reply and any scheduled reminder(s) after each turn.
- [x] `tests/reminder-thread-battery.test.js` — 13 tests (later 15, see Phase 2b) covering the
      harness's own plumbing (arg parsing, scenario validation, cleanup) plus one full end-to-end
      proof (mocked `WorkspaceAI`, real `RemindersModule`) that a "see above" scenario reaches the
      AI with the enriched thread context, not just the bare triggering turn.

Using the new harness immediately proved its worth: it surfaced the Phase-1-insufficiency finding
above before the operator had to test it live in Slack again.

## Phase 2b — headless Codex review of Phase 2, and what it caught (shipped v1.4.241)

Drove a headless Codex review of the Phase 2 diff via the `relay-xyz` skill (round-cap 1,
`--review-once`) rather than a manual read-through. Real findings, each confirmed by direct
reproduction before fixing:

- [x] **[Blocker]** `scripts/reminder-thread-battery.js`'s only documented invocation is plain
      `node`, but `MockSlackApp`'s constructor calls `jest.fn()` unconditionally — under real
      `node` (no `global.jest`) this threw `jest is not defined` immediately. The harness would
      have crashed the instant anyone actually ran it the way its own header comment tells them
      to. Fixed by installing the same minimal jest shim `scripts/first-time-user-battery.js`
      already uses; verified via a real child-process repro (`tests/reminder-thread-battery.test.js`)
      that fails on the pre-fix code and passes after.
- [x] **[Should]** a turn whose `SimulateMessageAsync` call threw was caught, logged, and
      swallowed — `MainAsync` still exited `0`, so a broken pipeline read as green to any calling
      script/CI. Fixed: turn errors now accumulate and `RunScenarioAsync` throws after cleanup if
      any occurred.
- [x] **[Should]** the throwaway `<workspace>-test-harness` name was fixed (collision risk
      across concurrent invocations) and cleanup missed a fifth persistence file —
      `RemindersModule`'s `EventStore` also appends `data/runtime/events/<workspace>_events.jsonl`.
      Fixed: workspace name is now pid-suffixed, cleanup runs before *and* after each invocation,
      and the event ledger is included.
- [x] **[Should]** this doc and the CHANGELOG overstated the Phase 2 test count (said 22; actual
      was 6 handler + 13 battery = 19, now 21 after the 2 tests this phase added). Corrected here
      and in `CHANGELOG.md`/`ROADMAP.md`.
- [x] **[Pass]** the production matcher change itself (`\babove\b`, gated by `thread_ts` + an
      existing temporal trigger + preceding human context) needed no changes.

### The relay harness's own bug, worth recording separately

Both drive attempts produced a full, legitimate review in the Codex transcript log — but neither
one's `tick release`/commit actually landed in the real repo. The token stayed
`open, handoff-to: codex` and the tracked relay file stayed blank throughout. Root cause: the
driven turn's own `tick release` call resolved `TICK_REPO_ROOT` to
`<repo>/.xyz` (the vendored harness's own directory), not `<repo>` (the real repo root
`find-harness.sh --env` exports) — so the turn's token state lived in a different namespace than
the one being watched. Recovered by reading the raw Codex transcript log directly instead of
re-running a third time (burns real API cost for a probably-identical result). Filed via
`/file-xyz-bug` rather than spending further budget reverse-engineering the vendored scripts here.

## Lessons Learned (For Future Agents)

- **Enumerated-verb regexes for "does this reference earlier context" are a trap.** The first
  instinct (widen the verb list) treats the symptom; the actual bug is architectural — verb
  enumeration can never be complete. When a trigger word/phrase is *itself* unambiguous (like
  "above"), match on that word directly rather than gating on a verb list in front of it. This
  repo already had the right pattern for pronouns (`VAGUE_REFERENCE_IN_THREAD_PATTERN`); the fix
  was recognizing "above" deserved the same treatment, not a bigger verb list.
- **`scripts/slack-harness-post.js` cannot exercise `RemindersModule#OnMessageAsync` at all**,
  because it posts through the bot's own token and Slack Bolt's `ignoreSelf: true` default drops
  the event before any handler sees it. Any future "post and see what Sleuth does" harness for
  message-event (not app_mention) behavior needs the `MockSlackApp.SimulateMessageAsync` +
  real-module pattern in `scripts/reminder-thread-battery.js`, not a real-Slack round trip.
- **`RemindersModule.StartAsync` unconditionally schedules two `setTimeout`-based background
  jobs** (daily digest, weekly false-positive report) with no config opt-out, and their wall-clock
  delay computation floors to ~1s in `Math.max(delay, 1000)`. `StopAsync()` clears the daily-digest
  timer but — a latent, still-open gap — **never clears the weekly-report timer at all**. Any test
  that constructs+starts+stops a real `RemindersModule` (this harness's tests,
  `tests/reminders-integration.test.js`) is exposed to an intermittent race where a stray fired
  timer callback runs after the test completes and corrupts shared state in whatever *other* test
  happens to be sharing that jest worker process at the time. This surfaced as unrelated,
  differently-shaped failures across runs (`web-api-reminders.test.js`'s `clientId` assertion,
  `chat-module.integration.test.js`'s deterministic-count tests) — genuinely confusing until
  traced back to timer scheduling rather than either test's own logic. Fixed locally for this
  harness's tests with `jest.useFakeTimers()`/`useRealTimers()` around the `RunScenarioAsync`
  describe block rather than touching the production scheduler. The missing
  `clearTimeout(#WeeklyReportTimerID)` in `StopAsync()` is still open — worth a follow-up if
  `reminders-integration.test.js`-style tests start showing similar intermittent cross-file
  flakiness.
- **`tests/web-api-workspace.test.js` can intermittently fail with `fetch failed`** under rapid
  repeated full-suite runs in this sandboxed dev environment — a pre-existing, previously
  documented (session memory) port/sandbox gotcha, confirmed unrelated to this change (reproduced
  on a run where none of this issue's files were even touched).
- **A test harness that jest always exercises through jest can hide bugs that only exist outside
  jest.** `MockSlackApp` needing a `global.jest` shim was invisible across every jest-run test of
  `reminder-thread-battery.js` because jest defines `global.jest` for you — the crash only exists
  in the script's *actual* documented invocation (plain `node`), which nothing had run until an
  external review flagged it. When a script's contract is "run me outside the test runner," at
  least one test needs to actually do that (a real `child_process` invocation), not just import
  and call its functions from within jest.
- **The vendored `.xyz` relay harness in this repo has a real bug**: a driven turn's own `tick
  release` resolves `TICK_REPO_ROOT` to `.xyz/` instead of the real repo root `find-harness.sh
  --env` exports, so turn-token state during a drive lives in a different namespace than what's
  being watched from outside. Both review attempts produced genuine, useful review content that
  never actually committed. Filed via `/file-xyz-bug` rather than fixed here (out of this repo's
  scope) — see that filing for the tracking issue.

## Progress log

- 2026-07-21: reported live via Slack (issue body); Phase 1 (verb-widening) diagnosed and shipped
  same session, v1.4.239, committed directly to `development` and deployed to the dev server for
  live verification.
- 2026-07-21: live dev-server test with a different phrasing reproduced the same symptom,
  disproving Phase 1's sufficiency. Operator redirected to the correct architectural fix (verb-
  agnostic trigger) plus a proper interactive test harness. Both built same session on a new
  branch (`gh424-above-context-synthesis`, cut from `development`), v1.4.240.
- 2026-07-21: drove a headless Codex review of the Phase 2 diff via `relay-xyz` (after fixing two
  harness prerequisites it flagged: a `RELAY-SYSTEM`/`relay-system` case-collision merged via
  `git mv`, and a stale vendored `.xyz` synced via `xyz-sync --update`). Review surfaced a real
  crash-under-plain-`node` blocker plus 2 hygiene gaps in the just-shipped harness; all fixed same
  session, v1.4.241. The relay harness's own commit-integration bug (above) was filed separately
  rather than blocking on it. This doc written retroactively per operator direction after all
  phases were code-complete and tested.
