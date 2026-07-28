---
title: "DM support gates — chat + reminders both silently no-op on a direct message"
status: Active (2-WORKING) — Phases 1-3 built, awaiting commit/deploy decision
created: 2026-07-17
updated: 2026-07-17
owner: noel
branch: development
doc_type: bugfix
gh_issue: 412
source: https://github.com/NeochromeTeam/sleuth-app/issues/412
related: "App Home Messages Tab enablement (Slack admin config, already correct — see README.md:280-421)"
effort: 2
complexity: 2
risk: 3
phases: 3
goal: >
  Make a plain 1:1 DM to Sleuth actually work end-to-end: scheduling triggers get scheduled and
  everything else gets a conversational reply, without requiring an explicit @-mention or an
  existing thread — while leaving every non-DM (channel, group DM) code path byte-for-byte
  unchanged.
---

# GH-412 — DM support gates

## Status

| What was just completed | What's next |
|---|---|
| All 3 phases built, `/consult`-QA'd (agy + Codex), and both confirmed blockers fixed — DM threaded follow-ups and DM messages with mentions now correctly get replies. 1495/1495 tests green (8 new). | Not yet committed/pushed or deployed — operator decision needed on when to ship this to `development` (see Progress log). |

## Context

Surfaced while enabling the App Home Messages Tab so users can DM Sleuth 1:1. Scopes/events are
already correct (`im:history`, `im:read`, `mpim:read`, `message.im` — README.md:280-421) and the
generic `message` handler in `slack-app.js` already fires for DM events. But a DM to Sleuth today
does **nothing at all** — no reply, no error, no reminder — because of two independent downstream
gates, plus a plumbing gap that blocks fixing either one cheaply:

- **`MessageEventInfo` does not carry `channel_type`.** Slack's raw Bolt event includes it
  (`'channel' | 'group' | 'im' | 'mpim' | 'app_home'`), but `slack-app.js#OnMessageAsync`
  (`src/slack-app.js:1518-1526`) hand-builds a stripped-down `MessageEventInfo` object that omits
  it, and the typedef itself (`src/slack-app.js:70-79`) doesn't declare the field. Nothing
  downstream can currently tell a DM apart from a channel message without an extra Slack API call.
  No existing "is this a DM" helper exists anywhere in `src/` (confirmed via full grep for
  `channel_type`, `'im'`, `startsWith('D')`, `IsDirectMessage`, `IsDM`, `conversations.info`).
- **Reminders pipeline** (`reminders-module.js#OnMessageAsync`, gate at `src/reminders-module.js:1132`)
  requires `RemindersChannelSettings#AreRemindersEnabledForChannel(channel)` — a `Set.has()` that
  defaults empty (`reminders-channel-settings.js:95`). A DM channel ID is never in that set, so the
  message is silently dropped (at most a 🔍 discovery-hint reaction).
- **Chat pipeline** (`chat-module.js#ShouldRespondToMessageAsync`, gate at `src/chat-module.js:2553`)
  unconditionally requires `ArgEventInfo.thread_ts` to be truthy. A DM's first message is always a
  top-level, non-threaded message, so `ShouldRespond` is always `false`.

The only path that works in a DM today is an explicit `@Sleuth ...` mention (routes through
`app_mention`, unaffected by either gate) — not the "just type in the DM" UX a personal-channel
experience implies.

**Handler ordering matters for the fix.** Per workspace, `RemindersModule` registers its message
handler before `ChatModule` (`src/app.js:308` vs `316`, explicit comment at `app.js:305-307`), and
`#MessageHandlers` (`slack-app.js:1538-1544`) stops at the first handler that returns truthy. So:
a DM scheduling trigger should be caught and scheduled by reminders (returns `true`, chat never
gets a turn — no double-response); anything else should fall through to chat for a conversational
reply. Both gates need the DM bypass for that fall-through to work as intended.

**Multi-tenant confirmed.** `app.js:281` instantiates a fresh `SlackApp`/`ChatModule`/
`RemindersModule`/`RemindersChannelSettings` per workspace (`app.js:294,308,316-322`) — state is
isolated per tenant, but the *code path* is shared, so this bug (and the fix) applies identically
across every workspace. A related-but-distinct prior cross-tenant leak (#384,
`catalog-regex-aliases.js:66,93`) is the cautionary precedent: the fix below must read only from
the per-call `ArgEventInfo` (never module-level/shared state) to avoid repeating that mistake.

## Not in scope

- Slack app configuration itself (scopes, events, Messages Tab toggle) — already correct, verified
  this session.
- Group DMs (`channel_type === 'mpim'`) — out of scope; only true 1:1 DMs (`'im'`) get the bypass.
  Existing gated behavior for channels and group DMs is untouched.

## Phase 1 — Plumb `channel_type` through the shared message pipeline

- [x] Add `channel_type` to the `MessageEventInfo` typedef (`src/slack-app.js:70-79`).
- [x] Populate it in `#OnMessageAsync`'s event construction (`src/slack-app.js:1518-1526`):
      `channel_type: 'channel_type' in ArgMessage ? ArgMessage.channel_type : undefined`.
- [x] Also threaded through the `MockSlackApp#SimulateMessageAsync` test harness
      (`tests/mocks/mock-slack-app.js`) so tests can exercise DM behavior realistically.

### QA gate — Phase 1
- [x] A raw event with `channel_type: 'im'` produces a `MessageEventInfo` whose `channel_type` is
      `'im'` (exercised indirectly via Phase 2/3 tests, which depend on this plumbing).
- [x] A raw event with no `channel_type` (or a non-DM value) round-trips unchanged; full suite
      (1492/1492) confirms no regression.

## Phase 2 — DM bypass for the reminders pipeline

- [x] In `reminders-module.js#OnMessageAsync` (`src/reminders-module.js:1132`), bypass
      `AreRemindersEnabledForChannel` when `ArgEventInfo.channel_type === 'im'` — a personal DM has
      no multi-user "channel" to opt in, so scheduling triggers should work by default, same as an
      explicit `@Sleuth` mention already does today.
- [x] Non-DM channels: gate behavior is completely unchanged (group DMs, `'mpim'`, explicitly
      excluded — verified by test).

### QA gate — Phase 2
- [x] A DM message with a scheduling trigger schedules a reminder, even though
      `EnableRemindersForChannelAsync` was never called for that channel ID.
      (`tests/reminders-integration.test.js` — "GH-412: DM channel_type bypasses the enabled-channels gate")
- [x] A non-DM channel with reminders disabled still gets the discovery-hint reaction path,
      unchanged (existing `reminders-integration.test.js` discovery-hint suite still green; new
      group-DM (`mpim`) test confirms the bypass does NOT apply there).

## Phase 3 — DM bypass for the chat pipeline

- [x] In `chat-module.js#ShouldRespondToMessageAsync` (`src/chat-module.js:2545-2550`),
      `ArgEventInfo.channel_type === 'im'` is now checked **first, before** the `<@` mention check
      and the `thread_ts` branch — `return { ShouldRespond: true, IsStopping: false }`
      unconditionally for any message in a true 1:1 DM. **Revised post-consult** (see below); the
      original build only bypassed the top-level/no-mention case, which was incomplete.
- [x] Non-DM channels and group DMs (`'mpim'`): the `<@` mention check and in-thread
      bell/no_bell/octagonal_sign hands-free logic are completely untouched — the DM check is a
      pure early-return that never reaches them.

### QA gate — Phase 3
- [x] A DM top-level message (no thread, no mention, no scheduling trigger) gets a chat reply.
      (`tests/chat-module.integration.test.js` — "GH-412: DM top-level messages get a chat reply")
- [x] A non-DM top-level message is unaffected — still no auto-reply without a mention or thread
      (regression test in the same describe block).
- [x] A group DM (`channel_type: 'mpim'`) top-level message is NOT bypassed (explicit test added,
      matching the reminders-side scope decision).
- [x] A **threaded follow-up reply in a DM** gets a reply (previously broken — see Consult QA
      below). Test: "a threaded follow-up reply in a 1:1 DM still gets a reply (GH-412 follow-up fix)".
- [x] A **DM message containing a `<@user>` mention** gets a reply (previously broken — see Consult
      QA below). Test: "a DM message that mentions another user still gets a reply (GH-412 follow-up fix)".
- [x] A group-DM (`mpim`) message containing a mention is still dropped — confirms the mention
      check is untouched for non-1:1-DM channels. Test: "a group DM (mpim) message mentioning
      another user is still dropped (mention check unaffected)".
- [x] End-to-end ordering: reminders registers before chat (`app.js:308` vs `316`), so a DM
      scheduling-trigger message is scheduled by reminders and returns `true` before chat ever gets
      a turn — no double-response (verified by the Phase 2 DM test, which asserts exactly one sent
      message: the scheduling confirmation).

## Consult QA (agy + Codex, 2026-07-17)

Ran `/consult` against the as-built Phases 1-3 before committing. Both advisors independently
found the same two real bugs in the original `chat-module.js` implementation (verified directly
against the code, not just taken on the advisors' word):

1. **[Blocker, fixed]** The original bypass (`return { ShouldRespond: ArgEventInfo.channel_type
   === 'im', IsStopping: false }`) only fired inside the `!thread_ts` branch — i.e. only for a
   DM's first, non-threaded message. Sleuth's own reply is posted threaded to that message
   (`chat-module.js:1975`), so once the user replied *in that thread*, `thread_ts` was now set and
   execution fell into the pre-existing hands-free logic, which requires `ThreadStartsWithMention`
   or a `:bell:` reaction — neither ever true for a DM that never had an `@Sleuth` mention. Net
   effect: a DM conversation got exactly one reply, then silently stopped. **Fixed** by moving the
   `channel_type === 'im'` check to the very top of the function, before both the mention check and
   the thread branch, so it applies unconditionally to every message in a true 1:1 DM.
2. **[Blocker, fixed]** The pre-existing `if(ArgEventInfo.text.includes('<@')) return {
   ShouldRespond: false }` check ran *before* the DM bypass, so any DM that happened to mention
   another user (e.g. "draft something for `<@U123>`") was silently dropped. **Fixed** by the same
   reordering above — the DM check now runs first and short-circuits before the mention check is
   ever reached.

Both fixes are one function, no new state, no change to non-DM behavior (group DMs and channels
still hit the mention/thread checks exactly as before). 3 new regression tests added; full suite
1495/1495 green.

**Not fixed / deliberately deferred (adjudicated, non-blocking):**
- Agy flagged the no-opt-in DM reminders default (any user in any workspace can now schedule via
  DM immediately) as worth an admin-facing kill switch; Codex called the default itself defensible
  and only suggested a kill switch as a future nice-to-have if false positives become a real
  problem. **Adjudicated: ship without one now, track separately** — filed as a follow-up issue
  (see below) rather than blocking this fix on a feature that may never be needed.
- Codex noted `MockSlackApp.SimulateMessageAsync` (the standard test harness for every module test
  in this repo, not something introduced by this PR) bypasses the real event-construction code in
  `src/slack-app.js:1518-1528`, so that exact seam has no direct test coverage anywhere in the
  codebase. Pre-existing test-architecture gap, not a GH-412 regression — not actioned here.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest chat-module reminders-module --forceExit",
  "fix_probes":  [
    { "type": "path_absent", "path": "src/slack-app.js" }
  ],
  "artifacts":   [
    "src/slack-app.js",
    "src/reminders-module.js",
    "src/chat-module.js",
    "tests/chat-module.test.js",
    "tests/reminders-module.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-412 Phases 1-3 — DM channel_type plumbing + dual gate bypass" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

## Progress log
- 2026-07-17: issue filed (#412) during Messages Tab enablement work; root-caused both gates.
  Traced the `channel_type` plumbing gap, handler-ordering interaction, and multi-tenant blast
  radius; promoted straight to `2-WORKING` and registered with PDDA. Phase 1 not started.
- 2026-07-17: all 3 phases built (`src/slack-app.js`, `src/reminders-module.js`,
  `src/chat-module.js`, `tests/mocks/mock-slack-app.js`). Added 5 new tests across
  `tests/reminders-integration.test.js` and `tests/chat-module.integration.test.js` covering the
  DM-schedules / DM-chats / non-DM-unaffected / group-DM-not-bypassed cases. Full suite green
  (1492/1492).
- 2026-07-17: ran `/consult` (agy + Codex) before committing. Both independently found the same two
  real bugs in the chat-module fix (threaded DM follow-ups silently ignored; DM messages with a
  `<@mention>` silently dropped) — see "Consult QA" above. Fixed both by reordering the DM check to
  run first, unconditionally, in `#ShouldRespondToMessageAsync`. Added 3 more regression tests.
  Full suite green (1495/1495). Filed follow-up **GH-413** (admin-facing DM reminders kill switch)
  per Agy's non-blocking recommendation, adjudicated against Codex's "defensible as-is" read.
  **Still not yet committed** — working tree has uncommitted changes on `development`, awaiting an
  explicit commit/push decision before this reaches the shared branch.

## Lessons Learned (For Future Agents)
- The blocking gap wasn't the two gates themselves — it was that `MessageEventInfo`
  (`slack-app.js`) silently drops Slack's own `channel_type` field when building the event object
  passed to every handler. Any future "detect DM/group-DM/channel" need should read
  `ArgEventInfo.channel_type`, not re-derive it from a channel-ID prefix heuristic (`D`/`G`/`C`) —
  that convention exists but is undocumented by Slack and was deliberately avoided here.
  - **Update 2026-07-17 (post-implementation correction):** the `MockSlackApp.SimulateMessageAsync`
    test harness (`tests/mocks/mock-slack-app.js`) did **not** forward `channel_type` before this
    fix, silently dropping it exactly like the real `slack-app.js` bug this issue was about — any
    test written against the old harness that tried to pass `channel_type` would have silently no-op'd.
    Fixed as part of Phase 1; check this harness first if a future DM-related test mysteriously
    doesn't see the field it was given.
- Both gates were fixed with a single-line equality check (`ArgEventInfo.channel_type === 'im'`)
  read only from the per-call event — no module-level or shared state touched. This matters
  because the same class is instantiated once per Slack workspace (`app.js:281`); a fix that
  accidentally read/wrote shared state would leak across tenants (the exact class of bug #384 was).
- Handler registration order (reminders before chat, `app.js:308` vs `316`) does the "don't
  double-respond" work for free once both gates are DM-aware — no explicit coordination code was
  needed between the two modules.
