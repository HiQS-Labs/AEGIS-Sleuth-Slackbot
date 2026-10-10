---
title: "GH-225: Shared bounded thread-context provider for Compass, earlier-file lookback and selftest"
status: Complete
created: 2026-10-10
updated: 2026-10-10
owner: claude-a
goal: "One thread read per chat event shared by the four automatic chat/Compass consumers (dispatcher, earlier-file look-back, Compass, chat context), bounded wherever a hands-free reply is authorized from Compass thread state."
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
| Final QA approved in round 1 (Codex, attested, `marathon-system/gh225-final-qa/RELAY.md`); full `npm test` green (142 suites / 2598 tests, node:test 116/0) | Push and PR against `development`; operator lands it (merge not part of this task) |

## Why

Radar #224 target `RADAR-product-compass-context`. The thread-read seam in `src/chat-module.js` was
touched by three feats and one fix in 21 days (72d60c9 feat Compass 10-07, 34ea31b fix GH-217 10-09,
25a07a3 feat GH-219 10-10, aca655d feat GH-221 10-09), with one feat-to-fix bounceback
(72d60c9 -> 34ea31b). Each new consumer decided its own read policy inline: Compass added a
`{MaxPages: 5, Latest}` cap in two places, GH-219's earlier-file lookback added a per-feature
"skip Compass channels" exemption instead of sharing the read, GH-221's selftest asserts the budget
from the outside. The invariant to restore, scoped to the four automatic chat/Compass consumers in
`src/chat-module.js` (hands-free dispatcher, earlier-file look-back, Compass, chat context): **one
thread read per chat event shared by all of them**, and for Compass-mapped channels **no hands-free
reply unless the whole reaction state of the thread was read**. Command readers
(`src/thread-memory.js:227-230` via `remember-above-command.js:58`,
`send-to-github-command.js:60,92-104`) and reminder readers (`src/reminder-context-resolution.js:239`)
are deliberately unchanged; they are explicit user commands or reminder work, not automatic replies.

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
| `:1815` | `#OnReactionAddedAsync` wrench branch | one read per `reaction_added` | none | parent message text for `:wrench:` triage |
| `:2313` | `#HandleStopReactionAsync` | one read per `reaction_added` | none | is the thread hands-free (root mentions the bot) |
| `:2357` | `#HandleBugReportReactionAsync` | one read per `reaction_added` | none | find the reacted message to file a bug |
| `:2722` | `#ShouldRespondToMessageAsync` (hands-free dispatcher) | per `message` in a thread | `MaxPages:5, Latest:ts` only when Compass-mapped | mention + bell/no_bell/stop reaction state; result handed down as `ThreadMessages` |
| `:2940` | `#FindEarlierThreadFilesAsync` (GH-219 lookback) | per `message`/`app_mention` with no attachment, unless `ArgThreadMessages` was passed | none | files on earlier messages; existing-memory guard at `:2934` (kept); **returns early for Compass channels at `:2937`** (comment `:2935-2936`) |
| `:3087` | `#RunCompassAsync` | per Compass `app_mention` (hands-free path passes `ThreadMessages`) | `MaxPages:5, Latest:ts` (duplicate of `:2724`) | thread text for the Compass question |
| `:3104` | `#GatherThreadContextAsync` | per `app_mention` in a thread (`:1334`) and per non-Compass hands-free message (`:2093`) when no messages are passed | none | thread transcript + context memory for the chat model |

Reads per event today on the generic answering paths (source-derived; the Compass counts are
asserted by `tests/product-compass.test.js:73,83,165-178`, the non-Compass counts are not yet
asserted anywhere and acceptance (a) below adds that measurement):

- Hands-free `message` in a Compass thread reply: 1 (`:2722`), reused by `:3087` via
  `ThreadMessages`; lookback also receives `ThreadMessages` and is additionally skipped by the
  exemption. Oversized thread: 1, then `ShouldRespond:false` (GH-217).
- `app_mention` in a Compass thread reply: 1 (`:3087`); lookback skipped by the exemption
  (a root mention reads 0). Oversized: 1, refusal.
- `app_mention` in a non-Compass thread reply with no attachment and no stored memory: 2 (`:2940`
  lookback, then `:3104` via `:1334`).
- Hands-free `message` in a non-Compass thread reply with no attachment: 2 (`:2722`, then `:3104`
  via `:2093`, which does not receive `ThreadMessages`); lookback reuses `ThreadMessages`.
- Not counted: DMs (`:2707` always respond, user-initiated), mentions with existing memory,
  command or deterministic early returns, bare mentions answered by the file-loaded confirmation.

The three reaction sites run once per `reaction_added` event with a single consumer each and no
event timestamp to key on; they are not the per-event duplication the issue describes and are
left alone (justified below).

## Plan (smallest change)

Add `src/thread-context-provider.js` exporting
`GetThreadAsync(ArgSlackApp, ArgEvent, ArgThreadTs, { MaxPages })` returning
`{ Messages, Complete }`:

- Calls `ArgSlackApp.GetConversationMessagesAsync(channel, threadTs, MaxPages ? { MaxPages, Latest: ArgEvent.ts } : undefined)`
  so the existing reader, the selftest shadow and the jest mocks keep counting real reads and the
  bounded call shape `{ MaxPages: 5, Latest: ts }` is unchanged.
- Memoises the in-flight promise in a `WeakMap` keyed by the **inbound event object** (one Bolt
  delivery = one object), holding a small `Map` keyed `threadTs:maxPages`. Lifetime is exactly the
  event's handling: no cap, no TTL, no cross-delivery reuse (a redelivered event is a new object
  and reads afresh), nothing to evict. This is the reviewer's simpler shape and replaces the
  issue's literal `channel:thread:ts` string key, which would have outlived the delivery.
- `context-incomplete` resolves to `{ Messages: [], Complete: false }` (memoised too, so an
  oversized thread costs one bounded read per event across every consumer). Any other error
  rejects as today and is not pinned, so a later consumer may retry.

Route through it in `src/chat-module.js` via one private helper
`#ReadThreadAsync(ArgSlackApp, ArgEventInfo, ArgThreadTs)` that owns the single read-policy
decision (`MaxPages: 5` when `Compass.GetMapping(...)` is truthy, legacy single read otherwise):

- `:2722` dispatcher: `Complete:false` -> `ShouldRespond:false` (same as GH-217).
- `:3087` RunCompass: `Complete:false` -> throw `{code:'context-incomplete'}` so
  `ask-compass-command.js:19` keeps refusing; drop the inline `MaxPages` literal.
- `:3104` GatherThreadContext: gains an optional event parameter from `:1334` and `:2093` (both
  pass the same `ArgEventInfo` object the dispatcher/lookback used) and reads via the helper
  (memo hit when the lookback or dispatcher already read). Without an event (no caller today) it
  falls back to the raw reader.
- `:2940` lookback: reads via the helper (memo hit on the hands-free path; `Complete:false` -> `[]`).
  Remove only the Compass early-return at `:2937` (and its comment `:2935-2936`); the
  existing-memory guard at `:2934`, the strictly-earlier filter and the quiet download path stay.
  Its stated reason was the read budget, which the memo now enforces by construction. Behavior
  change: a text file uploaded earlier in a Compass thread is now hydrated as context memory like
  in any other channel (Compass already consumes context memory from same-event uploads,
  `tests/product-compass.test.js:65-72`); acceptance (a) observes this in the Compass fixture.

Deferred gap (F1, out of scope): a non-Compass hands-free read stays the legacy options-free
call, which returns Slack's default first page (documented default `limit` 1000 for
`conversations.replies`) and does not signal a continuation. A stop reaction beyond that page is
not seen, exactly as today. Applying the Compass policy (`MaxPages:5` x `limit:100` = 500
messages) there would *shrink* the window non-Compass hands-free already reads and change its
behavior for every workspace; GH-225 does not change non-Compass authorization. Recorded as a
known limitation, not claimed as fixed.

Reaction sites (`:1815`, `:2313`, `:2357`) stay on the raw reader: one read per reaction event,
single consumer, no `UpToTs` to key on. Wrapping them would add a key for no shared read.

Non-goals: no change to Compass answer logic or prompts; no cache beyond the per-event memo (no
TTL, no cross-event reuse); no reminder changes; no new test infrastructure; no change to
`SlackApp.GetConversationMessagesAsync`.

Operational envelope: a single Slack bot process on one dev server; complexity must stay
commensurate (one ~40-line module, one helper, four call-site edits).

## Acceptance (falsifiable)

- (a) One new case in `tests/product-compass.test.js` (same workspace fixture; `C123` is
  Compass-mapped, any other channel is not):
  1. Red control that is red against base: hands-free generic message in a **non-Compass** thread
     reply, no attachment, no stored memory -> exactly one `GetConversationMessagesAsync` call
     (base code: two, `:2722` then `:3104`). Then the same event with the provider memo bypassed
     (`jest.spyOn(provider,'GetThreadAsync')` delegating straight to the reader) -> two calls.
     This proves the memo, not an exemption, holds the invariant.
  2. Compass `app_mention` thread reply with no attachment and no stored memory -> one bounded
     read shared by the now-enabled lookback and Compass (changed-code assertion; base skips the
     lookback).
  3. Compass thread reply whose earlier message carries a text upload -> that content reaches the
     Compass prompt (observes the behavior change from removing `:2937`).
  4. Hands-free Compass message in a 6-page thread with a stop reaction on page 6 -> 0 replies,
     one `GetConversationMessagesAsync` call, 5 `conversations.replies` pages (the GH-217 safety
     canary at `:151-180` stays as is; this restates it against the provider).
- (b) `tests/thread-earlier-file-lookback.test.js`, `tests/thread-memory.test.js`,
  `tests/selftest.test.js`, `tests/chat-module.integration.test.js` stay green.
- (c) `src/selftest/scenarios/compass-budget.js` still asserts one read with `MaxPages <= 5`
  (unchanged scenario; the provider's call shape satisfies it).
- Full `npm test` green on the final commit.

Sweep: remove the inline `MaxPages` duplication at `:3087` and the Compass early-return at
`:2937` (both made redundant by the provider). Rollback: revert one commit; the provider is
additive and the raw reader is untouched. Existing-state consequence of a revert: context memory
hydrated from an earlier Compass upload while the change was live stays in the persisted
thread-memory store (`:3043`) and already-posted answers remain; neither needs migration.

## Plan QA dispositions (round 1, Codex, `VERDICT: FAIL`)

| Finding | Disposition | What changed |
|---|---|---|
| F1 [Blocker] non-Compass legacy read cannot prove completeness | Rejected — Out of Scope (reviewer's second option) | Safety claim constrained to Compass in goal/Why; deferred gap recorded with the 1000-vs-500 window argument; DM fast path named explicitly |
| F2 [Should] memo red control green on base | Accepted | Acceptance (a).1 now uses the non-Compass generic hands-free case (2 reads on base, 1 after, 2 with memo bypassed); (a).2 is a changed-code assertion and labelled so |
| F3 [Should] "every consumer / per Slack event" overstated | Accepted | Invariant reworded to the four automatic chat/Compass consumers; command and reminder readers listed as unchanged |
| Q1 line refs (`:2937` exemption, `:2934` guard, handler name, read-count attribution) | Accepted | Recon table and sweep corrected; "mocked, deterministic" claim narrowed to what the suite asserts |
| Q3 memo lifetime / `ts` is not a delivery identity | Accepted | Memo keyed by the inbound event object in a `WeakMap`; no cap, no TTL; both Gather callers pass the same event |
| Q4 earlier Compass uploads | Accepted | Behavior change kept; observed in acceptance (a).3; memory guard and filters preserved |
| Q5 revert consequence | Accepted | Persisted-memory note added above |
| Q6 rating | No change | Rating stands; historical inputs remain as supplied evidence |

## Final QA dispositions (round 1, Codex, `VERDICT: PASS`)

| Finding | Disposition | What changed |
|---|---|---|
| Nit: `#GetThreadDebugInfo` (wrench diagnostic) processes bell/no_bell but ignores `octagonal_sign`, unlike the dispatcher | Rejected — Out of Scope (pre-existing GH-217 triage discrepancy, diagnostic only, dispatcher stays quiet) | Filed as a separate GitHub issue; nothing changed in this branch |
| Historical "untouched vs aca655d" claims not independently diffed by the reviewer | Accepted as evidence boundary | `git diff aca655d --stat` in the PR body shows only the four intended files changed under `src/`, `tests/`, `CHANGELOG.md` |

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
