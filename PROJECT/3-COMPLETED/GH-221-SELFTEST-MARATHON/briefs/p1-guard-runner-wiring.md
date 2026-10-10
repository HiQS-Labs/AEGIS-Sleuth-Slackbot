---
title: "Phase brief p1 — GH-221 selftest guard, runner, wiring"
status: Queued — plan Codex-approved, preflighted; not fired
created: 2026-10-09
updated: 2026-10-09
owner: noel
branch: marathon/gh-221-selftest-mode
doc_type: phase-brief
related: "GH-221; parent plan PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md; MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  Build the env-gated SelftestModule, the scenario runner/report formatter, ChatModule.ClearThreadMemoryAsync
  and the app.js wiring, with Jest coverage of the guard and report formatting.
---

# p1 — guard, runner, wiring

## Status

| What was just completed | What's next |
|---|---|
| Brief written; parent plan approved by Codex plan QA round 3 (2026-10-10). | Fire the parent marathon; this phase runs first. |

Read the parent plan `PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md` in full first. Its **Design 1-9**,
**Acceptance** and **Deviations** sections are the contract; this brief only restates what p1 owns.

## Build

1. `src/selftest/selftest-module.js` — `SelftestModule extends BaseModule` (`src/base-module.js`,
   AGENTS.md §0.1.2). Constructor takes `(SlackApp, ...)`, reads `SLEUTH_SELFTEST_CHANNEL` via a
   constructor argument supplied by `app.js` (do not read `process.env` inside the class), registers its
   handler with `RegisterAppMention`. Match `^selftest\s+(\S+)` after stripping `SlackApp.AppMentionString`;
   otherwise return `false`. Wrong channel → one reply "selftest is dev-only", return `true`; if that post
   throws, log and still return `true`. One run at a time (boolean flag); a re-entrant `selftest` returns
   `true` and does nothing. `SetChatModule(ChatModule)` late binding (mirror `SetListsModule` /
   `SetRemindersModule`, `src/app.js:342-343`).
2. `src/selftest/runner.js` — loads every `*.js` in `src/selftest/scenarios/` (an absent folder yields an
   empty list, because p2 creates the files), runs scenarios sequentially, one fresh root message per
   scenario, never throws out, builds the context `{ SlackApp, Channel, ThreadTs, Upload, Say, Mention,
   Expect, Fixture, Skip }` exactly as Design 3-4 describes (including the `files: []` mention rule and the
   `selftest bare baseline` marker for an empty question), shadows/restores `GetConversationMessagesAsync` and
   `GetFileContentAsync` per Design 6, clears each root's thread memory in `finally`, and formats the report
   (`✅/❌/⏭ name — evidence`, summary line, permalink on failure) plus the `[selftest] ... exit_code=0|1`
   journal line. Reuse `FindUploadedShareMessage` and `ResolveUploadedMessageInfoAsync` from
   `scripts/slack-harness-file-upload.js` (already exported at line 707; its CLI is guarded by
   `require.main`, line 700). Verify importing it has no side effects; do not edit that script.
3. `src/chat-module.js` — add a public `ClearThreadMemoryAsync(ArgChannel, ArgThreadTs)` that deletes the
   `${channel}:${thread}` key from `#ThreadContextMemory` and calls `#SaveThreadMemoryAsync`. Additive only.
4. `src/app.js` — construct `SelftestModule` only when `process.env.SLEUTH_SELFTEST_CHANNEL` is non-empty,
   before the ChatModule constructor (~line 330), then `SetChatModule` after Chat exists and before Slack
   starts (~line 360). Nothing else changes.
5. `tests/selftest.test.js` (MockSlackApp; it has no `UploadFileAsync`, assign a `jest.fn`): env unset →
   `app.js` wiring constructs no module (test the small factory/guard you extract, not a full app boot);
   wrong channel → "selftest is dev-only" and nothing else; runner report for ✅/❌/⏭ and for a scenario
   that throws; unknown scenario name replies with the list; cleanup runs on failure. Model on
   `tests/thread-earlier-file-lookback.test.js` and `tests/plugin-loader.test.js`.

## Check

- `npx jest selftest thread-earlier-file-lookback --forceExit` exits 0; then `npm test`.
- `npm run validate:commands`: it is already red on development for unrelated routes (issues #39, #181).
  Record its output before and after your change and confirm it is identical; do not fix it here.

## Do NOT

- Do not add a `command-catalog.json` entry, a help line, or a route to ChatModule's router.
- Do not add dependencies, CI jobs, a scheduler, or a test-framework layer.
- Do not unit-test scenario behavior (p2 creates the scenarios; they are the live test).
- Do not edit `scripts/slack-harness-file-upload.js`, `package.json`, or any doc (p3 owns docs).
- Debug-mantra applies: if something fails, reproduce and trace before changing code.
