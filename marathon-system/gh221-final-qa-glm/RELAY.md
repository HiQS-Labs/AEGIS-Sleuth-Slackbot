---
Goal: Final QA of the GH-221 selftest marathon output (3 phases, all Codex-approved)
Date: 2026-10-10
NEXT: Reviewer
STATUS: Open
---

# Context

Adjudicate the implementation of GH-221 "Dev-server-only self-QA mode" (AEGIS-Sleuth-Slackbot) against its plan in `PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md` (read the Design section 1-9 and the Acceptance checklist in full). The code was built by agy and reviewed by codex over three marathon phases; this is an independent second-model pass.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. Tests and machinery must be commensurate; do not demand enterprise fail-safes, multi-tenant isolation, or new test infrastructure. Phase transcripts are in `marathon-system/gh221-selftest-2026-10-09--p{1,2,3}/RELAY.md` if you want the prior reviewer's reasoning.

Files to read (the whole diff of this branch vs. its base `c2eacf9`):
- src/app.js (guard + wiring, ~17 lines changed)
- src/chat-module.js (ClearThreadMemoryAsync + any hook, ~14 lines)
- src/selftest/selftest-module.js
- src/selftest/runner.js
- src/selftest/scenarios/lookback-basic.js, lookback-command.js, lookback-bare.js, lookback-skip-bad.js, compass-budget.js
- tests/selftest.test.js
- docs/SSH.md, docs/slack-app-setup.md, docs/deployhq.md, CHANGELOG.md

Questions:

1. Guard correctness (Design 1): with `SLEUTH_SELFTEST_CHANNEL` unset, is the module truly absent (no handler, no route)? From a wrong channel, does the handler reply "selftest is dev-only" and return `true` even if that reply throws? Cite file:line.
2. Re-entrancy (Design 2): is the one-run-at-a-time flag reset on every exit path including a thrown error inside the runner? Is there any path where the flag stays set forever?
3. Isolation per scenario (Design 3, 8): does each scenario get its own fresh root message, is `ClearThreadMemoryAsync` called in `finally` for every scenario root, and are shadowed `GetConversationMessagesAsync` / `GetFileContentAsync` restored in `finally` (Design 6) even on failure?
4. Look-back trigger fidelity (Design 4): does `Mention` pass `files: []` on the simulated event, and does the bare scenario post the neutral marker rather than empty text? Would any of the four lookback scenarios accidentally take the current-event attachment path instead of the GH-219 look-back?
5. Compass split (Design 5): do the lookback scenarios skip when `Compass.GetMapping` is truthy and `compass-budget` skip when it is falsy? Are the counters in `compass-budget` scoped to the scenario root's channel and thread only?
6. Report and journal (Design 7): is there exactly one `[selftest]` info log line carrying `exit_code=0|1`, with 0 only when no ❌? Does the process ever call `process.exit`?
7. Tests: does `tests/selftest.test.js` cover unset-not-registered, wrong-channel-refused, and report formatting with `MockSlackApp`, without unit-testing the live scenarios? Is any test asserting on something the code does not actually do?
8. Scope and docs: is every Acceptance checkbox in the plan satisfied by this diff, and is anything in the diff outside the plan's stated scope? Is anything over-engineered for a dev-only tool (unneeded abstraction, defensive layers, dead code)?

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered. Be concrete and cite file:line. Every `[Blocker]` or `[Should]` must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines. You may run narrow read-only probes (node -e, grep) with output under `.relay-scratch/`; do not run `npm test` or jest in this worktree and grade such claims `[Unverified — needs clone run]`.

Write your verdict below. Change STATUS to Approved if it passes, or leave it Open with the findings if changes are requested.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (commandcode)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log

### Round 1 · Reviewer · commandcode

**Verdict:** Approved

swept file: yes — read whole-file: `src/selftest/selftest-module.js`, `src/selftest/runner.js`, all five `src/selftest/scenarios/*.js`, `tests/selftest.test.js`, `src/base-module.js`. Read in targeted full regions around every integration point: `src/app.js` (wiring + shutdown), `src/chat-module.js` (attachment dispatch, look-back, Compass reads, thread-memory), `src/slack-app.js` (post/upload/simulate signatures, Bolt construction), `tests/mocks/mock-slack-app.js`, `scripts/slack-harness-file-upload.js`, `src/product-compass.js`, `src/context-file-classifier.js`, plus the docs/CHANGELOG diff hunks and the three phase transcripts. Pre-existing defects in touched files are in scope; the one found (relay shutdown indexing) was already fixed and adjudicated in p1. Answers to the eight questions, each verified against code and, where behavioral, against a runtime probe (below).

1. **Guard — correct.** Unset/empty `SLEUTH_SELFTEST_CHANNEL` → `SelftestModule.Create` returns null (`src/selftest/selftest-module.js:32-35`); the only handler registration is in the constructor (`:24` → `BaseModule.RegisterAppMention`, `src/base-module.js:159-161`), so unset = no module, no handler, and the `SetChatModule` wiring is null-guarded (`src/app.js:358-360`). No route exists anywhere: no `Router.Register` in the selftest files, `grep -c selftest data/static/ai/command-catalog.json` → 0 (exit 1), and the only file referencing selftest outside `src/selftest/` is `src/app.js`. Wrong channel: refusal post wrapped in try/catch with `Logger.error`, then unconditional `return true` (`selftest-module.js:57-68`) — a failed refusal never falls through to Chat. Probe-verified.
2. **Re-entrancy — correct.** `#IsRunning = true` at `selftest-module.js:74`; the `finally` at `:81-83` resets it unconditionally, including when `Runner.RunScenariosAsync` throws (caught at `:79-81`). The runner itself catches per-scenario errors (`runner.js:192-201`) and wraps its own posts (`:241-247`); the only unwrapped statement is the final `Logger.info` (`:252`), whose throw propagates to the module catch and still hits the finally. No stuck-flag path found: all awaits are bounded (upload lookup is 5×1 s, `scripts/slack-harness-file-upload.js:420-455`). Probe-verified: a run whose final log call throws still returns `true`, logs `selftest runner failed:`, and an immediate second run is accepted.
3. **Isolation — correct.** Fresh root per scenario (`runner.js:79-87`, top-level post, mention-free text); run report threads to the invoking mention only (`:242`). `ClearThreadMemoryAsync` runs in the per-scenario `finally` (`:211-215`) and a cleanup failure flips ✅/⏭ to ❌ (`:216-225`); the key it deletes (`${channel}:${thread_ts}`, `src/chat-module.js:2818-2822`) is byte-identical to the keys the chat module writes (`:1903`, `:2934`, `:3042`). Both shadows are restored as the first statements of the same `finally` (`runner.js:202-205`), and there is no await between shadow install (`:98-111`) and the `try` (`:113`), so no half-shadowed window exists.
4. **Look-back fidelity — correct.** `Mention` passes `files: []` on the simulated event (`runner.js:157`); `ResolveAttachmentIntent` returns `Kind: 'none'` for an empty array (`src/context-file-classifier.js:213-215`), so `#HandleAttachmentAsync` takes the GH-219 earlier-file branch (`src/chat-module.js:2863-2880`) — the current-event attachment path is unreachable for all four lookback scenarios. The bare scenario posts the neutral marker `selftest bare baseline` (`runner.js:144`) while the simulated text is the mention string alone (`:147`), exercising the bare branch (`Handled: EarlierResult.FileWasStored && !ArgText`, `chat-module.js:2880`). The question is posted as a real message first (`runner.js:145`) and the look-back filter is strictly-earlier (`chat-module.js:2942`), so the upload qualifies and the question does not. Setup posts carry no mention, and Bolt's default `ignoreSelf` (no override in the `new App({...})` at `src/slack-app.js:1745`) keeps the bot's own posts from self-triggering; `SimulateAppMentionAsync` bypasses Bolt (`:895-908`).
5. **Compass split — correct.** The four lookback scenarios skip on truthy `GetMapping` (`lookback-basic.js:10`, `lookback-command.js:10`, `lookback-bare.js:10`, `lookback-skip-bad.js:10`); `compass-budget` skips on falsy (`compass-budget.js:8`). Counters count only calls with `Channel === ChannelId && Ts === RootTs` (`runner.js:98-104`), downloads only fixture URLs (`:106-111`, populated at `:132-135`), and the scenario's own assertion reads bypass the counter by calling the captured original (`:174-177`), so `compass-budget`'s `calls.length === 1` / `MaxPages <= 5` measures only production reads — which the Compass path issues as `{ MaxPages: 5, Latest }` (`chat-module.js:3087`; the second MaxPages site at `:2724` is the message-event path the scenario root avoids). Probe-verified ⏭ on an unmapped stub workspace.
6. **Report and journal — correct.** Exactly one `Logger.info` per run carries the whole report with every line prefixed `[selftest] ` plus `[selftest] exit_code=N` (`runner.js:249-252`); the three early-return paths log the same shape with `exit_code=1` (`:32`, `:52`, `:67`). `ExitCode = FailCount > 0 ? 1 : 0` (`:236`), report-delivery failure forces 1 (`:246`) — 0 only when no ❌. No `process.exit` anywhere in `src/selftest` (grep clean); `src/app.js`'s pre-existing exits (`:480`, `:547`, `:551`) are untouched by this diff. Probe-verified: one `[selftest]` log per completed run, `exit_code=1` with failures, no `exit_code=0`.
7. **Tests — sound.** `tests/selftest.test.js:35-38` unset → factory null (module never constructed ⇒ no handler); `:40-51` wrong-channel refusal via `MockSlackApp.SimulateAppMentionAsync`; `:78-99` report formatting for ✅/❌/⏭/throw with permalinks, summary and cleanup counts; `:101-154` cleanup-on-failure, readdir-error → `exit_code=1`, cleanup-failure flip to ❌, report-post-failure receipt; `:157-177` loader contract (≤40 lines, `{Name, Run}`, unique) per Phase 2; `:179-208` runs the five real scenario files against the mock asserting only report shape + `compass-budget` ⏭ — exactly the Phase 2 acceptance, scenario semantics deliberately unasserted (non-goal respected). Every assertion string cross-checks against the runner's format strings; the six-line expectation holds because `ParseChannels(undefined)` returns `{}` (`src/product-compass.js:19`) so the mock workspace is unmapped, and `UploadFileAsync` as a bare `jest.fn()` returns `undefined`, making `ResolveUploadedMessageInfoAsync` throw immediately (`slack-harness-file-upload.js:426`) — fast ❌, no retry sleeps. No test asserts behavior the code does not have.
8. **Scope and docs — clean.** All eight Acceptance checkboxes are satisfied by this diff (unset-absent, five scenarios + report, wrong-channel refusal, standalone scenario files with folder-only addition, jest guard/format coverage, SSH.md self-QA entry, CHANGELOG two-paragraph entry, slack-app-setup.md `files:read`/`files:write`). The one out-of-plan hunk is the app.js relay-shutdown reorder (`src/app.js:506-513`, flat loops replacing per-workspace-indexed `SnapshotRelayModules[n]?.StopAsync()`): a pre-existing defect in a touched file (flat arrays indexed per workspace left later workspaces' relays unstopped), fixed under the in-file sweep rule and adjudicated Approved in p1 (`marathon-system/gh221-selftest-2026-10-09--p1/RELAY.md:263-267, 317, 329`) — not new drift. The plan's accepted deviations (route in a BaseModule handler, `exit_code` as a journal value, Mention pre-posting the question) are implemented as written. Nothing over-engineered for a dev-only tool; nothing missing.

**Nits (non-blocking, no action requested):**
- `Fixture.FetchedPagesCount` is exposed but consumed by no scenario (`runner.js:93,100,172`; repo grep shows no other reference) — redundant with `GetConversationMessagesCalls`.
- `lookback-bare.js:20`'s second `Expect` is implied by `:19` (`later.length === 1 && loaded.length === 1` already excludes any other post).
- `compass-budget.js:28-31` detects duplicate excerpts by substring position, which is stricter than pairwise equality — two distinct overlapping excerpts would false-❌. Fail-closed, so acceptable for a QA gate.
- Conversational leftover comments in `tests/selftest.test.js:186-188, 203-205` (style: repo comments end with a period) and the cryptic `const p` at `runner.js:3`.
- `CHANGELOG.md` heading `1.4.338 - 2026-10-09` sits directly above `1.4.337 - 2026-10-10` — version order is right, dates inverted; cosmetic (tone guard passed it in p3).

**Probes** (all under `.relay-scratch/`, `PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"`):
1. Require side-effects: `node -e "require('./src/selftest/runner'); require('./src/selftest/selftest-module'); console.log('require-clean...')"` — exit 0, output `require-clean: no side effects, exit 0` (Phase 1's "requiring the harness script has no side effects" holds; its CLI is `require.main`-guarded at `slack-harness-file-upload.js:700`).
2. Behavior probe (`node` heredoc driving the real module + real runner against a stub SlackApp whose refusal post and final info-log throw on cue): exit 0, 20/20 assertions — decisive lines: `ok - Create(undefined) returns null`, `ok - no handler registered when factory returns null`, `ok - wrong-channel returns true even when refusal post throws`, `ok - handler returns true when runner throws internally`, `ok - second run accepted (IsRunning flag was reset by finally)`, `ok - exactly one [selftest] info log for the completed run`, `ok - journal line carries exit_code=1 when failures present`, `ok - compass-budget skips on unmapped channel`, `ok - final report posted in-thread of the invoking mention`, `ok - re-entrant mention ignored while a run is in flight`, `PROBE-PASS`. (A first probe run had 3 failures that were bugs in my probe's expectations — compass-budget ⏭s rather than ❌ing, and the earlier throwing run had also posted roots/report — re-run with corrected expectations passed 20/20; product behavior was identical in both runs.)

**[Unverified — needs clone run]:** `npm test`, `npm run build`, `npm run validate:commands` / `validate:workspace-isolation` / `validate:fsm` / `validate:reminder-render`, and the changelog tone guard were not executed in this worktree under turn restrictions; they are attested green by the p1-p3 phase gates and run by the harness clone gate after this turn. Live scenario outcomes (real Slack, mapped + unmapped channels) remain operator post-deploy acceptance per the plan's Live verification section. No git commands beyond read-only `diff`/`log`/`status` queries; no source or artifact files touched; only this RELAY.md edited.

relay closed, no further turn needed.


### System · relay-drive — 2026-10-10T05:29:47Z
terminal STATUS Approved written by FAILED reviewer turn (commandcode; shim returned non-zero) — reverted
