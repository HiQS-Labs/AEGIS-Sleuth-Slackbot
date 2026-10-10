---
title: "GH-221: Dev-server-only self-QA mode (@Sleuth selftest)"
status: Marathon-ready (2-WORKING)
created: 2026-10-10
updated: 2026-10-09
owner: noel
branch: marathon/gh-221-selftest-mode
doc_type: project
gh_issue: 221
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/221
tracking_issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/221
complexity: 3
risk: 1
effort: 3
phases: 3
ratings_provisional: false
non_goals:
  - No production behavior change when SLEUTH_SELFTEST_CHANNEL is unset (nothing registered, nothing reachable)
  - No new CI job, dependency, scheduled run, or command-catalog entry
  - Not a Jest replacement; scenarios are the live test and are not unit-tested
related:
  - "GH-219 / PR #220 (earlier-file look-back), GH-217 / PR #218 (Compass read budget) — first consumers"
  - "src/slack-app.js SimulateAppMentionAsync / ConnectOneShotAsync — the existing one-shot harness this builds on"
  - "scripts/slack-harness-file-upload.js — existing upload→lookup→simulate flow to reuse, not rewrite"
goal: >
  `@Sleuth selftest <scenario|all>` runs named end-to-end scenarios against real Slack objects, only in the
  one channel named by SLEUTH_SELFTEST_CHANNEL, and posts a pass/fail report in-thread plus a journal line.
  With the env var unset the feature does not exist at runtime.
---

# GH-221 — Dev-server-only self-QA mode

## Status

| What was just completed | What's next |
|---|---|
| Captured, recon'd against `origin/development` @ 25a07a3 (post-#220), promoted, contract drafted. Plan QA pending. | Independent plan QA, then Phase 1 (guard + runner + wiring). |

## Why

Every thread-handling feature (GH-62, GH-217, GH-219) ends with a human uploading files and @mentioning the bot on dev while tailing `journalctl`. That is slow and unrepeatable, and it is where the two last #220 review blockers would have surfaced immediately. The pieces exist (`SimulateAppMentionAsync`, bot-token upload/post); what is missing is a guarded way to stitch them into named scenarios.

## Recon map (verified at 25a07a3, 2026-10-09)

- **Dispatch order.** `HandleAppMention` only pushes onto `#AppMentionHandlers` (`src/slack-app.js:540`); first `true` wins. Registration order in `src/app.js` (~308-330): Stats, Lists(none), Reminders, Notion, `PluginLoader.StartAsync` (327-328), then `ChatModule` (330), which is the catch-all and always returns true. AGENTS.md:127 states the plugin-before-Chat rule. A handler registered after Chat never runs.
- **Simulate path.** `SimulateAppMentionAsync` (`slack-app.js:895-908`) runs the same handler list. It does not coerce `text` or fill `files`, and on a handler throw it logs but does not post the GH-113 error report. No `user`/`bot_id` filter in `#OnAppMentionAsync` (1562); use a non-bot `user` (`U_SLEUTH_SELFTEST`) in simulated events.
- **Command catalog.** `scripts/validate-command-catalog.js:79-80` compares only ChatModule and RemindersAppMentionHandler routes with `data/static/ai/command-catalog.json`. A route owned by a separate module is invisible to the validator and to help/rmm, which is right for a dev-only mode. **Do not add a catalog entry.** With the env var unset, `selftest ...` falls through to the chat model as ordinary text (accepted: "unknown command").
- **Look-back (GH-219).** `#FindEarlierThreadFilesAsync` (`chat-module.js` ~2918-2938) has no uploader filter, so bot-uploaded files qualify; oversize (>200 KB) earlier files are skipped silently. `#ThreadContextMemory` is a private Map keyed `${channel}:${thread_ts}`, persisted by `#SaveThreadMemoryAsync`; **nothing deletes entries and there is no public accessor**, so cleanup needs one small public ChatModule method.
- **Download counting.** `GetFileContentAsync` is a prototype method called via `ArgSlackApp.GetFileContentAsync`; shadowing it on the instance for the duration of a scenario counts downloads without a mock (restore in `finally`).
- **Slack API.** `PostMessageTextAsync` returns the message ts; `UploadFileAsync(channel, null|threadTs, localPath, comment, name)` returns `{File, MessageTS|null, ThreadTS, Permalink}` and needs a local temp file; `GetConversationMessagesAsync` returns normalized `files`. `scripts/slack-harness-file-upload.js` already has `FindUploadedShareMessage` and `ResolveUploadedMessageInfoAsync` (5 retries, 1 s) — export and reuse them, do not rewrite. Permalink: `GetPermaLinkAsync` (`slack-app.js:1056`).
- **Mock.** `MockSlackApp` (`tests/mocks/mock-slack-app.js`) has Simulate/Post/GetConversationMessages/GetPermaLink/GetFileContent but **no `UploadFileAsync`**; tests assign a `jest.fn`. Model on `tests/thread-earlier-file-lookback.test.js`, `tests/slack-harness-file-upload.test.js`, `tests/plugin-loader.test.js`.
- **Scopes.** `files:write` (upload) and `files:read` (download) are used by code but absent from `docs/slack-app-setup.md` (manifest 36-52, list 106-120). Dev may already have them; docs are incomplete either way.
- **Why a module, not a plugin.** A plugin starts before ChatModule exists and gets no reference to it, but cleanup needs `ChatModule.ClearThreadMemoryAsync`. A new `SelftestModule` is constructed before ChatModule and late-bound with `SetChatModule(...)`, mirroring `SetListsModule`/`SetRemindersModule` (`app.js:342-343`).

## Design (smallest thing that satisfies the issue)

1. **Guard in `app.js`:** construct `SelftestModule` only when `process.env.SLEUTH_SELFTEST_CHANNEL` is non-empty (before the ChatModule constructor so its handler registers first); `SetChatModule(ChatModuleInstance)` after Chat is built. Unset → no module, no handler, `grep selftest` of registered routes is empty. Wrong channel → one reply "selftest is dev-only" and `return true`.
2. **Handler** matches `^selftest\s+(\S+)` after stripping the bot mention; anything else returns `false`. One run at a time (re-entrancy flag); a nested `selftest` is ignored.
3. **Runner** (`src/selftest/runner.js`, pure and unit-testable): loads every `*.js` in `src/selftest/scenarios/` (so adding a scenario touches only that folder), runs sequentially in a fresh thread rooted by a bot post in the QA channel, never throws out (a scenario error is a ❌), and formats the report. Scenario context: `{ SlackApp, Channel, ThreadTs, Upload, Say, Mention, Expect, Fixture, Skip }`. `Mention` dispatches `SimulateAppMentionAsync` with `user: 'U_SLEUTH_SELFTEST'`, `thread_ts`, the real file objects read back from the thread. `Expect` reads the thread back via `GetConversationMessagesAsync`.
4. **Report:** final thread post with one line per scenario `✅/❌/⏭ name — evidence` plus a summary; failures include the assertion and permalink. The same text is logged at info with an `[selftest]` prefix so `journalctl -u sleuth-app | grep '\[selftest\]'` shows it.
5. **Cleanup:** `finally` per run calls `ChatModule.ClearThreadMemoryAsync(channel, threadTs)` (new public method: delete key, save) and restores any shadowed SlackApp method.
6. **Scenarios** (each its own file, ≤ 40 lines): `lookback-basic`, `lookback-command`, `lookback-bare`, `lookback-skip-bad`, `compass-budget`. "Grounded in file" is asserted by a unique canary token inside the fixture that the model must quote. `compass-budget` skips unless `Compass.GetMapping(WorkspaceInfo, channel)` exists; it measures `GetConversationMessagesAsync` **invocations** around the Mention (snapshot-before/after, excluding the runner's own read-back) and requires ≤ 1 — GH-217's contract is one bounded read of ≤ 5 pages, so ≤ 1 invocation implies ≤ 5 `conversations.replies` calls. Duplicate-passage check: the answer's citation block contains no passage text twice.

## Acceptance

- [ ] With `SLEUTH_SELFTEST_CHANNEL` unset, `@Sleuth selftest all` is an unknown command and `grep selftest` of the registered routes is empty.
- [ ] With it set to the dev QA channel, `@Sleuth selftest all` opens a thread, runs the five scenarios, and posts the report. `compass-budget` reports `skipped` when the channel has no Compass mapping.
- [ ] Running it from any other channel replies "selftest is dev-only" and does nothing.
- [ ] Each scenario is a standalone file under `src/selftest/scenarios/` and adding a new one needs no change outside that folder.
- [ ] Jest covers the guard (unset → not registered, wrong channel → refused) and the runner's report formatting using `MockSlackApp`. The scenarios themselves are not unit-tested; they are the live test.
- [ ] `docs/SSH.md` "Common Operations" gets a four-line "Post-deploy self-QA" entry showing the command and the journal grep.
- [ ] CHANGELOG entry in the usual two-paragraph format.
- [ ] `docs/slack-app-setup.md` lists the `files:read` and `files:write` bot scopes.

## Acceptance — deviations from the issue

- [added] `docs/slack-app-setup.md` lists the `files:read` and `files:write` bot scopes. — reason: the selftest uploads files as the bot and the docs omit both scopes already required by shipped code.

## Phases

### Phase 0 (done in this plan) — unknowns resolved
Recon above. Residual unknown carried into Phase 1: whether Bolt's default self-event handling affects the bot's own *uploads* (it does not affect Simulate, which bypasses Bolt). Not blocking.

### Phase 1 — guard, runner, wiring, ChatModule cleanup (lane: orchestrator, touches `src/app.js` + `src/chat-module.js`)
- New `src/selftest/selftest-module.js`, `src/selftest/runner.js`; export the two upload-lookup helpers from `scripts/slack-harness-file-upload.js` only if they can be required without side effects, otherwise copy the 10-line retry loop with a source comment (decide at build time; record which).
- `ChatModule.ClearThreadMemoryAsync(ArgChannel, ArgThreadTs)` (additive, no behavior change).
- `src/app.js` wiring as in Design 1.
- `tests/selftest.test.js` (MockSlackApp): guard unset → handler not registered / module not constructed; wrong channel → "selftest is dev-only" and nothing else; runner report formatting for ✅/❌/⏭ and a scenario that throws; unknown scenario name replies with the list; cleanup runs on failure.
- Acceptance: `npx jest selftest thread-earlier-file-lookback --forceExit` green; `npm run validate:commands` result identical to development baseline (it is already red on #181/#39 for unrelated routes — record before/after, do not fix).

### Phase 2 — five scenarios (lane: agy_safe, new files only; depends on Phase 1)
- `src/selftest/scenarios/{lookback-basic,lookback-command,lookback-bare,lookback-skip-bad,compass-budget}.js`.
- Loader test: every file in the folder exports `{ Name, Run }`, names are unique, and each file is ≤ 40 lines (a test that fails the build when a scenario outgrows the contract). Scenario *behavior* is not unit-tested (issue non-goal); it is proved live on dev.
- Acceptance: loader test green; `@Sleuth selftest all` against a MockSlackApp stub completes and produces a five-line report with `compass-budget` ⏭.

### Phase 3 — docs, scopes, changelog, full gate (lane: orchestrator)
- `docs/SSH.md` `## Common Operations`: `### Post-deploy self-QA` — command plus journal grep, four lines, matching the existing `###` + one `bash` block style.
- `docs/slack-app-setup.md`: add `files:read` and `files:write` to manifest and scope list.
- `docs/deployhq.md`: one added line under Slack smoke pointing at selftest.
- `CHANGELOG.md`: two-paragraph entry (first-person TL;DR + `**Technical:**`), checked by `scripts/validate-changelog-tone.js`. Do not bump `package.json` (version lags the changelog until release).
- Acceptance: full `npm test` and build pass un-sandboxed; changelog tone check passes; PDDA frontmatter has no finding on this doc.

## Blast radius and rollback

Production-reachable surface: one `if(env)` block in `app.js` and one additive ChatModule method. Costly? No — easy undo: revert the commit. Dev-only effect when armed: the bot posts files and messages in one named channel and holds one extra in-memory handler. Danger to watch: a mis-set env var pointing at a real channel posts fixtures there; mitigated by the single-channel guard and by documenting the dev channel id only in `temp/SOP.md`, not in the repo.

## Live verification (outside the marathon)

Scenarios prove themselves only on a deployed dev build. After the PR merges and DeployHQ deploys development, the operator sets `SLEUTH_SELFTEST_CHANNEL` in the dev unit, restarts, and runs `@Sleuth selftest all`. This is deliberately **not** a marathon gate (no deploy from the marathon) and is recorded as a post-merge step in the PR body.

## Acceptance & Quality Checklist

### Wave 1
- [ ] Wave 1 Proof of Done Test Suite Green (`npx jest selftest thread-earlier-file-lookback --forceExit` exit 0, then full `npm test`)
- [ ] Wave 1 Post-Build Codex QA Relay executed (receipt recorded under `relay-system/<YYYY-MM-DD>/<label>.codex.md`)
- [ ] Wave 1 CodeRabbit / Peer Review findings adjudicated

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest selftest thread-earlier-file-lookback --forceExit",
  "fix_probes":  [
    { "type": "path_absent", "path": "src/selftest/selftest-module.js" },
    { "type": "path_absent", "path": "src/selftest/runner.js" },
    { "type": "path_absent", "path": "src/selftest/scenarios/lookback-basic.js" },
    { "type": "path_absent", "path": "src/selftest/scenarios/lookback-command.js" },
    { "type": "path_absent", "path": "src/selftest/scenarios/lookback-bare.js" },
    { "type": "path_absent", "path": "src/selftest/scenarios/lookback-skip-bad.js" },
    { "type": "path_absent", "path": "src/selftest/scenarios/compass-budget.js" },
    { "type": "path_absent", "path": "tests/selftest.test.js" }
  ],
  "artifacts":   [
    "src/selftest/selftest-module.js",
    "src/selftest/runner.js",
    "src/selftest/scenarios/lookback-basic.js",
    "src/selftest/scenarios/lookback-command.js",
    "src/selftest/scenarios/lookback-bare.js",
    "src/selftest/scenarios/lookback-skip-bad.js",
    "src/selftest/scenarios/compass-budget.js",
    "tests/selftest.test.js",
    "src/app.js",
    "src/chat-module.js",
    "docs/SSH.md",
    "docs/slack-app-setup.md",
    "docs/deployhq.md",
    "CHANGELOG.md"
  ],
  "artifacts_new": [
    "src/selftest/selftest-module.js",
    "src/selftest/runner.js",
    "src/selftest/scenarios/lookback-basic.js",
    "src/selftest/scenarios/lookback-command.js",
    "src/selftest/scenarios/lookback-bare.js",
    "src/selftest/scenarios/lookback-skip-bad.js",
    "src/selftest/scenarios/compass-budget.js",
    "tests/selftest.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-221 — dev-only selftest module, runner, five scenarios, docs; absent when SLEUTH_SELFTEST_CHANNEL is unset" },
  "lanes":       {
    "agy_safe": [
      "src/selftest/scenarios/lookback-basic.js",
      "src/selftest/scenarios/lookback-command.js",
      "src/selftest/scenarios/lookback-bare.js",
      "src/selftest/scenarios/lookback-skip-bad.js",
      "src/selftest/scenarios/compass-budget.js"
    ],
    "orchestrator_only": [
      "src/selftest/selftest-module.js",
      "src/selftest/runner.js",
      "tests/selftest.test.js",
      "src/app.js",
      "src/chat-module.js",
      "docs/SSH.md",
      "docs/slack-app-setup.md",
      "docs/deployhq.md",
      "CHANGELOG.md"
    ]
  }
}
```

## Progress log
- 2026-10-09: captured (hq writer, ledger row parked), recon'd at 25a07a3 by a read-only subagent; claims spot-checked against `src/app.js`, `scripts/validate-command-catalog.js` and a repo-wide grep for any thread-memory delete API (none). Promoted to `2-WORKING` with provisional ratings replaced by an honest rating. Tracking issue is #221 itself (single-member arc).
