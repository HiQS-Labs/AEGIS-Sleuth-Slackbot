---
Goal: Plan QA of GH-225 (shared bounded thread-context provider) before implementation
Date: 2026-10-10
NEXT: claude-a
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

### Round 1 · Producer · claude-a

Plan written at `PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md` (commit 20d08a7 on
`fix/gh-225-thread-context-provider`, base `aca655d`). Recon table lists all seven
`GetConversationMessagesAsync` sites with caller, per-event status, page cap and purpose; the plan
proposes one additive module `src/thread-context-provider.js`, one `#ReadThreadAsync` helper in
`src/chat-module.js`, four call-site edits (`:2722`, `:2940`, `:3087`, `:3104`) and one new jest
case. Questions 1-6 above are the review contract. Releasing the turn token to codex.

handing off to codex — codex, take your turn.


### Round 2 · Reviewer · codex

Plan QA: **Block — revise the completeness contract and the red control before implementation.**
Only this relay file was edited. No git command, test runner, executable fixture, or live Slack
operation was run.

Evidence: Verify-tier review attempted graph discovery first. `list_projects` (both pages,
82 projects) has no index for this worktree. The nearest related index,
`sleuth-product-compass`, generation `2026-10-08T02:29:43Z`, is another checkout;
`search_graph` returned four symbols without pagination, and `check_index_coverage` reported
changed/missing/untracked relevant paths. Its source positions are stale, so all material
citations below come from direct reads of the seeded worktree, not graph completeness claims.
Runtime assertions remain **[Unverified — needs clone run]**; this is a plan review.

#### Findings

**F1 [Blocker] The proposed completeness result cannot enforce the stated non-Compass hands-free invariant.**

Observed input: The plan's goal and Why require no hands-free reply from a partially read thread
(`PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md:7`, `:36-37`), but its helper deliberately
retains an options-free read outside Compass (`:81`, `:94`). The raw reader returns immediately
when options are absent even if Slack supplies a continuation cursor/`has_more`
(`src/slack-app.js:854-864`). A non-Compass thread whose root mentions the bot and whose stop
reaction lies on page 2 can therefore return a successful page 1; the dispatcher initializes
permission from the root and checks only those returned reactions (`src/chat-module.js:2734-2757`).
No `context-incomplete` error reaches the new provider, so `Complete:false` cannot protect it.

Affected scope: Non-Compass channel hands-free messages. The DM fast path at
`src/chat-module.js:2707` is intentional user-initiated behavior, not reaction-authorized
hands-free mode, and should remain explicit in the contract.

Falsifier: In the disposable clone, drive an unmapped channel thread with a bot mention on page 1,
a stop on an unread later page, and a subsequent hands-free question. Assert no reply/model call
when completeness is unavailable. Either apply the bounded policy to this authorization path,
or explicitly constrain the plan's safety claim to Compass and acknowledge this deferred gap;
do not label a legacy successful page as proven complete. This needs no new infrastructure.

**F2 [Should] The proposed hands-free memo red control remains green when the memo is bypassed.**

Observed input: Acceptance (a) predicts two reads for a complete Compass hands-free event when
memoization is bypassed (`PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md:119-124`). However,
`#OnMessageAsync` already passes `ThreadMessages` into attachment lookback
(`src/chat-module.js:2057-2064`) and Compass (`:2084-2085`). Lookback uses the supplied array
before calling any reader (`:2939-2940`), and Compass likewise uses `ArgMessages` (`:3086-3087`).
Removing the Compass exemption does not remove either reuse path. That event reads once on the
base code and still once with the memo bypassed.

Affected scope: Proof that the new memo reduces reads, not the existing six-page safety canary.
The existing canary at `tests/product-compass.test.js:151-180` already measures the latter.

Falsifier: Keep the safety canary, but use a complete non-Compass generic hands-free question
(no attachment, no deterministic early return) as the baseline red: dispatcher reads at `:2722`,
then Gather reads again at `:2093`/`:3104`. The proposed memo must make that one read and bypassing
it must restore two. Alternatively, a Compass app_mention with no attachment and no stored memory
will test the newly enabled lookback plus Compass sharing, but that mutation is a red against the
changed code, not against the base (which skips lookback). Specify which claim the control proves.

**F3 [Should] “Every consumer / per Slack event” overstates the four-site change.**

Observed input: The plan's universal invariant (`:7`, `:36`) inventories only reads directly in
ChatModule. Existing command consumers still read through
`src/thread-memory.js:227-230` (`CaptureThreadAsync`, called by
`src/chat-commands/remember-above-command.js:58`) and
`src/chat-commands/send-to-github-command.js:60`, `:92-104` (resolve then capture). Attachment
lookback precedes command routing (`src/chat-module.js:1225-1232`, `:1264`), so an app_mention
running one of those commands can perform lookback plus independent raw command reads after
this change. Reminder consumers are also unchanged (for example
`src/reminder-context-resolution.js:239`).

Affected scope: The claimed event-wide budget and recon boundary. This does not justify expanding
this small task into reminder or command refactors.

Falsifier: Name the invariant as sharing among the four automatic chat/Compass consumers and
list command capture/reminder readers as deliberately unchanged. A static reader inventory must
then agree with that boundary; do not claim one read for all Slack events or all consumers.

#### Answers to the six review questions

1. **Mostly grounded, with citation and qualification fixes.** All seven raw read expressions
are at the listed lines. The wrench handler is named `#OnReactionAddedAsync` (`:1799`). The
Compass exemption is `src/chat-module.js:2937`; `:2934` is the existing-memory guard and
`:2935-2936` its explanatory comment. Correct every deletion reference so the memory guard
survives. The two-read non-Compass cases are correct for generic answering paths: mention
lookback (`:2940`) then Gather (`:1334`/`:3104`), and hands-free dispatcher (`:2722`) then Gather
(`:2093`/`:3104`). A mention with existing memory, a command/deterministic early return, a bare
mention handled by file loading, or a DM need not follow that count. The Compass app_mention
statement also needs “thread reply reaching Compass”; root mentions can read zero. The plan's
“mocked, deterministic” attribution to `tests/product-compass.test.js` is too broad: that suite
asserts Compass counts (`:73`, `:83`, `:165-178`), not the non-Compass two-read claims. Those
are source-derived here, pending clone measurement.

2. **The critical missed safety path is F1; other consumers are F3.** Keeping the three reaction
sites raw is justified within this task: mutually exclusive reaction dispatch (`:1801-1808`),
one direct thread consumer each, and normalized reactions retain only `item.ts`, not a reaction
event timestamp (`src/slack-app.js:31-36`, `:1527-1534`). The stop handler's raw read determines
whether to post a confirmation (`src/chat-module.js:2313-2323`); it does not authorize subsequent
hands-free replies. No additional reaction caching is needed.

3. **Wrapping the existing reader preserves instrumentation; the memo shape is serviceable but
its lifetime claim is too strong.** The runner counts calls through the instance method
(`src/selftest/runner.js:98-104`), so calling that method at read time preserves its shadow.
The generic mock (`tests/mocks/mock-slack-app.js:459-460`) does not simulate pagination; the
Compass canary explicitly binds the real reader (`tests/product-compass.test.js:163`). Separate
SlackApp keys isolate workspaces. Distinct message timestamps separate ordinary events, but
`ts` is a message identity, not a delivery identity: repeated deliveries can share a key and
reactions can change without changing message `ts`. Thus the retained capped map is cross-delivery
reuse, despite the non-goal at plan `:110-111`. A simpler optional shape is a ChatModule-owned
`WeakMap` keyed by the inbound event object, carrying its shared promise; thread/channel policy
stays in the one helper. It needs no insertion cap or TTL. Whichever shape is selected, document
its actual lifetime and ensure both Gather callers supply the same event identity/key. No new
cache infrastructure is warranted.

4. **Earlier Compass uploads are acceptable on the available product evidence.** The first
canary sends a same-event upload and asserts its contents reach Compass
(`tests/product-compass.test.js:65-72`), and Gather already prepends memory
(`src/chat-module.js:3121-3130`). The exemption's comment mentions both budget and Compass's
own document context (`:2935-2936`), but there is no demonstrated product prohibition on uploaded
context. Preserve the existing-memory guard (`:2934`), strictly earlier filter (`:2943`), and
quiet download behavior (`:2861-2870`). The changed earlier-upload behavior should be observed in
the same narrow Compass acceptance fixture rather than assumed from an unrelated green suite.

5. **Counts/refusals are falsifiable; the stated memo red is not (F2).** Acceptance (b) names
existing suites and (c) an exact call/option assertion
(`src/selftest/scenarios/compass-budget.js:12-13`). Require their actual run results in the
implementation clone; an unchanged assertion alone is not execution evidence. “Revert one
commit” is honest for the additive code and four call sites, but earlier-file hydration writes
existing persisted memory (`src/chat-module.js:3043`), and prior posted answers survive a revert.
State this small existing-state consequence; no migration/rollback framework is needed.

6. **70/55/50/65 is a reasonable judgment for this bounded structural task.** The shipped
Compass feature, its fix, earlier-upload feature and selftest are recorded in the top four
CHANGELOG blocks (`CHANGELOG.md:28` onward). One bounceback and a class score of 4 support one
task, not an umbrella program. Exact commit ancestry, the whack-a-mole score and ledger rating
were not independently queried here; treat those historical values as supplied evidence, not
newly verified results. Cheapness depends on fixing the scope and proof issues without adding  [Unverified — no citation]
extra machinery.

#### Reproducible static probe

Command (output written only under scratch):
`rg -n 'ThreadMessages // GH-219|ArgEventInfo.text, ThreadMessages|const Messages = ArgThreadMessages|legacy single read otherwise|MaxPages \? |Red control|Compass.GetMapping.*return \[\]|if\(!ArgOptions' src/chat-module.js src/slack-app.js PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md > .relay-scratch/gh225-static-probe.txt`

Exit status: **0**. Decisive output:

```text
src/slack-app.js:863:      if(!ArgOptions || (!Cursor && !Result.has_more)) return Messages;
src/chat-module.js:2063:        ThreadMessages // GH-219: reuse the thread already read above instead of a second fetch.
src/chat-module.js:2085:        await this.#RunCompassAsync(ArgSlackApp, ArgEventInfo, ArgEventInfo.text, ThreadMessages);
src/chat-module.js:2937:    if(Compass.GetMapping(ArgSlackApp.WorkspaceInfo, ArgEventInfo.channel)) return [];
src/chat-module.js:2939:      const Messages = ArgThreadMessages
PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md:94:decision (`MaxPages: 5` when `Compass.GetMapping(...)` is truthy, legacy single read otherwise):
```

Handing off to claude-a for plan revision. STATUS remains Open.

VERDICT: FAIL
