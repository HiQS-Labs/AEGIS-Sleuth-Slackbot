---
Goal: Plan QA of GH-225 (shared bounded thread-context provider) before implementation
Date: 2026-10-10
NEXT: codex
STATUS: Open
---

# Context

Review the plan in `PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md` (read it in full: Why,
Recon table, Plan, Acceptance, Sweep, Rating) against the code at base `aca655d` in this
worktree. The GitHub issue is #225 (HiQS-Labs/AEGIS-Sleuth-Slackbot); related: #215 #217 #219
#221 #222. Nothing has been implemented yet; you are reviewing the plan only.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. The
change must stay commensurate with that: one small additive module, one private helper in
`src/chat-module.js`, four call-site edits, one new jest case. Do not ask for enterprise
fail-safes, TTL caches, metrics, feature flags or new test infrastructure.

Files to read:
- `PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md` (the plan)
- `src/slack-app.js:845-867` (`GetConversationMessagesAsync`, `context-incomplete`)
- `src/chat-module.js` at `:1815`, `:2313`, `:2357` (reaction reads), `:2701-2765`
  (`#ShouldRespondToMessageAsync`), `:2852-2880` (`#HandleAttachmentAsync`), `:2932-2956`
  (`#FindEarlierThreadFilesAsync`), `:3082-3130` (`#RunCompassAsync`, `#GatherThreadContextAsync`),
  `:1334` and `:2093` (GatherThreadContext callers)
- `src/chat-commands/ask-compass-command.js:19` (`context-incomplete` -> refusal)
- `src/selftest/runner.js:90-104` and `src/selftest/scenarios/compass-budget.js`
- `tests/product-compass.test.js` (existing canaries that must stay green), `tests/mocks/mock-slack-app.js:459`

Questions (answer each by number, cite file:line):

1. Grounded paths: is every call site and line number in the plan's Recon table correct at
   `aca655d`? Is the "reads per event today" list correct, in particular the two-read cases for
   non-Compass `app_mention` and non-Compass hands-free messages?
2. Missing requirement: does the plan miss any consumer of a thread read, or any path where a
   hands-free reply could still be authorized from a partially read thread after the change?
   Is leaving the three reaction sites on the raw reader justified?
3. Extends existing writer: the provider wraps the existing `SlackApp.GetConversationMessagesAsync`
   and the selftest shadow/jest mocks keep counting real reads. Does the memo key
   `channel:threadTs:upToTs:maxPages` with a per-`SlackApp` `WeakMap` and a small insertion-order
   cap satisfy "memoised per event" without introducing a second caching subsystem or a staleness
   risk? Is there a simpler shape?
4. Behavior change: removing the Compass early-return in `#FindEarlierThreadFilesAsync`
   (`:2934-2936`) means an earlier text upload in a Compass thread becomes context memory. Is
   that acceptable given `tests/product-compass.test.js` already feeds same-event uploads into
   Compass, or should the exemption stay for a product reason the plan does not see?
5. Blast radius, rollback, falsifiable checks: are acceptance items (a)-(c) falsifiable as
   written, and is the red control (bypass the memo -> the complete-thread hands-free case issues
   two reads) a real red, i.e. does it fail against the pre-change code path? Is "revert one
   commit" an honest rollback?
6. Rating grounded: is `rated 70/55/50/65` (priority/severity/appeal/cheapness) consistent with
   the recurrence evidence in the plan (one feat-to-fix bounceback, 3 feats + 1 fix on the seam
   in 21 days, whack-a-mole class score 4)?

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered. Be concrete. Every
`[Blocker]` or `[Should]` must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines.
You may run narrow read-only probes (grep, node -e) with output under `.relay-scratch/`; do not
run `npm test` or jest in this worktree.

End your turn with a single line reading exactly `VERDICT: PASS` or `VERDICT: FAIL`. On PASS set
`STATUS: Approved` in the header; on FAIL leave `STATUS: Open` and list the findings.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log
