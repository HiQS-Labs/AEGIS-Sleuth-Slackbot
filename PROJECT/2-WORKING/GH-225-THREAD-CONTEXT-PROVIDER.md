---
title: "GH-225: Shared bounded thread-context provider for Compass, earlier-file lookback and selftest"
status: working
created: 2026-10-10
updated: 2026-10-10
owner: claude-a
goal: "One bounded thread read per Slack event, shared by every consumer, so no hands-free reply can be authorized by a partially read thread."
gh_issue: 225
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/225
branch: fix/gh-225-thread-context-provider
doc_type: bugfix
risk: 2
effort: 3
complexity: 3
phases: 1
ratings_provisional: false
related: "GH-215 GH-217 GH-219 GH-221 GH-222; radar #224 target RADAR-product-compass-context"
---

# Shared bounded thread-context provider

## Status

| What was just completed | What's next |
|---|---|
| Intake parked and rated; recon and plan written; promoted to 2-WORKING | Codex plan QA relay (`marathon-system/gh225-plan-qa/RELAY.md`), then implementation |

## Why

Radar #224 target `RADAR-product-compass-context`. The thread-read seam in `src/chat-module.js` was
touched by three feats and one fix in 21 days (72d60c9 feat Compass 10-07, 34ea31b fix GH-217 10-09,
25a07a3 feat GH-219 10-10, aca655d feat GH-221 10-09), with one feat-to-fix bounceback
(72d60c9 -> 34ea31b). Each new consumer decided its own read policy inline: Compass added a
`{MaxPages: 5, Latest}` cap in two places, GH-219's earlier-file lookback added a per-feature
"skip Compass channels" exemption instead of sharing the read, GH-221's selftest asserts the budget
from the outside. The invariant to restore is **exactly one bounded thread read per event**, and
**no hands-free reply unless the whole reaction state of the thread was read**.

## Recon (base aca655d)

`SlackApp.GetConversationMessagesAsync(channel, threadTs, options?)` (`src/slack-app.js:851-867`):
without options it is one `conversations.replies` call with Slack's default page (legacy, unbounded
by us); with `{MaxPages, Latest}` it pages up to `MaxPages` with `limit:100` and throws
`{code:'context-incomplete'}` when the thread is longer. The selftest runner shadows this method
(`src/selftest/runner.js:90-104`) and counts calls per scenario root; `compass-budget.js:12-14`
asserts one call with `MaxPages <= 5`. `ask-compass-command.js:19` turns a `context-incomplete`
error into the "start a new thread" refusal.

Call sites in `src/chat-module.js` at aca655d (line numbers re-verified):

| Site | Caller | Per event? | Page cap | What the read is used for |
|---|---|---|---|---|
| `:1815` | `#OnReactionAdded` wrench | one read per `reaction_added` | none | parent message text for `:wrench:` triage |
| `:2313` | `#HandleStopReactionAsync` | one read per `reaction_added` | none | is the thread hands-free (root mentions the bot) |
| `:2357` | `#HandleBugReportReactionAsync` | one read per `reaction_added` | none | find the reacted message to file a bug |
| `:2722` | `#ShouldRespondToMessageAsync` (hands-free dispatcher) | per `message` in a thread | `MaxPages:5, Latest:ts` only when Compass-mapped | mention + bell/no_bell/stop reaction state; result handed down as `ThreadMessages` |
| `:2940` | `#FindEarlierThreadFilesAsync` (GH-219 lookback) | per `message`/`app_mention` with no attachment, unless `ArgThreadMessages` was passed | none | files on earlier messages; **returns early for Compass channels (`:2934-2936`)** |
| `:3087` | `#RunCompassAsync` | per Compass `app_mention` (hands-free path passes `ThreadMessages`) | `MaxPages:5, Latest:ts` (duplicate of `:2724`) | thread text for the Compass question |
| `:3104` | `#GatherThreadContextAsync` | per `app_mention` in a thread (`:1334`) and per non-Compass hands-free message (`:2093`) when no messages are passed | none | thread transcript + context memory for the chat model |

Reads per event today (mocked, deterministic; see `tests/product-compass.test.js`):

- Hands-free `message` in a Compass thread: 1 (`:2722`), reused by `:3087`; lookback skipped by the
  Compass exemption. Oversized thread: 1, then `ShouldRespond:false` (GH-217).
- `app_mention` in a Compass thread: 1 (`:3087`); lookback skipped by the exemption. Oversized: 1,
  refusal.
- `app_mention` in a non-Compass thread with no attachment: 2 (`:2940` lookback, then `:3104`).
- Hands-free `message` in a non-Compass thread with no attachment: 2 (`:2722`, then `:3104` at
  `:2093`, which does not receive `ThreadMessages`); lookback reuses `ThreadMessages`.

The three reaction sites run once per `reaction_added` event with a single consumer each and no
event timestamp to key on; they are not the per-event duplication the issue describes and are
left alone (justified below).

## Plan (smallest change)

Add `src/thread-context-provider.js` exporting
`GetThreadAsync(ArgSlackApp, ArgChannel, ArgThreadTs, { UpToTs, MaxPages })` returning
`{ Messages, Complete }`:

- Calls `ArgSlackApp.GetConversationMessagesAsync(channel, threadTs, MaxPages ? { MaxPages, Latest: UpToTs } : undefined)`
  so the existing reader, the selftest shadow and the jest mocks keep counting real reads and the
  bounded call shape `{ MaxPages: 5, Latest: ts }` is unchanged.
- Memoises the in-flight promise per `WeakMap<SlackApp, Map>` under the key
  `channel:threadTs:upToTs:maxPages` (one key per event, since `UpToTs` is the event `ts`), with a
  small insertion-order cap so finished events age out. Different events never share a key, so
  there is no staleness; the cap is only a memory bound.
- `context-incomplete` resolves to `{ Messages: [], Complete: false }` (memoised too, so an
  oversized thread costs one bounded read per event across every consumer). Any other error
  rejects as today.

Route through it in `src/chat-module.js` via one private helper
`#ReadThreadAsync(ArgSlackApp, ArgEventInfo, ArgThreadTs)` that owns the single read-policy
decision (`MaxPages: 5` when `Compass.GetMapping(...)` is truthy, legacy single read otherwise):

- `:2722` dispatcher: `Complete:false` -> `ShouldRespond:false` (same as GH-217).
- `:3087` RunCompass: `Complete:false` -> throw `{code:'context-incomplete'}` so
  `ask-compass-command.js:19` keeps refusing; drop the inline `MaxPages` literal.
- `:3104` GatherThreadContext: gains an optional event `ts` from `:1334` and `:2093` and reads via the
  helper (memo hit when the lookback or dispatcher already read).
- `:2940` lookback: reads via the helper (memo hit on the hands-free path; `Complete:false` -> `[]`).
  Remove the Compass early-return at `:2934-2936`: its stated reason was the read budget, which the
  memo now enforces by construction. Behavior change: a text file uploaded earlier in a Compass
  thread is now hydrated as context memory like in any other channel (Compass already consumes
  context memory from same-event uploads, `tests/product-compass.test.js` first canary).

Reaction sites (`:1815`, `:2313`, `:2357`) stay on the raw reader: one read per reaction event,
single consumer, no `UpToTs` to key on. Wrapping them would add a key for no shared read.

Non-goals: no change to Compass answer logic or prompts; no cache beyond the per-event memo (no
TTL, no cross-event reuse); no reminder changes; no new test infrastructure; no change to
`SlackApp.GetConversationMessagesAsync`.

Operational envelope: a single Slack bot process on one dev server; complexity must stay
commensurate (one ~40-line module, one helper, four call-site edits).

## Acceptance (falsifiable)

- (a) `tests/product-compass.test.js`: hands-free message in a Compass thread, 6 pages with a stop
  reaction on page 6 -> 0 replies, exactly one `GetConversationMessagesAsync` call and 5
  `conversations.replies` pages across the whole event (dispatcher + lookback + Compass); the
  complete-thread hands-free case stays at one read per event **with the Compass lookback
  exemption removed**. Red control: with the memo bypassed (`DisableMemo`/direct reader) the
  complete-thread case issues two reads and the assertion fails.
- (b) `tests/thread-earlier-file-lookback.test.js`, `tests/thread-memory.test.js`,
  `tests/selftest.test.js`, `tests/chat-module.integration.test.js` stay green.
- (c) `src/selftest/scenarios/compass-budget.js` still asserts one read with `MaxPages <= 5`
  (unchanged scenario; the provider's call shape satisfies it).
- Full `npm test` green on the final commit.

Sweep: remove the inline `MaxPages` duplication at `:3087` and the Compass early-return at
`:2934-2936` (both made redundant by the provider). Rollback: revert one commit; the provider is
additive and the raw reader is untouched.

## Rating and recurrence

2026-10-10 UTC RELEASES assessment: `rated 70/55/50/65` (priority/severity/appeal/cheapness), no
override. Priority 70: radar #224 names this seam as the active regression cluster and three open
features (#219, #221, #222) sit on it. Severity 55: today's behavior is correct only by a
per-feature exemption; the failure mode is a duplicated Slack read or a hands-free reply from a
partially read thread, not data loss. Appeal 50: invisible to users when it works. Cheapness 65:
one additive module plus four call-site edits inside one file, existing mocks and canaries cover
it. Recurrence evidence: one feat-to-fix bounceback (72d60c9 -> 34ea31b) and the seam touched by
3 feats + 1 fix in 21 days; whack-a-mole 20261010T060531Z scored the class 4, below the umbrella
floor, so this is one structural task. Ledger read-back establishes the stored rating.
