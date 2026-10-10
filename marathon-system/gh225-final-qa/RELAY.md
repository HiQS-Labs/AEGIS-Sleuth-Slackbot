---
Goal: Final QA of the GH-225 implementation (shared bounded thread-context provider) against its approved plan
Date: 2026-10-10
NEXT: claude-a
STATUS: Approved
---

# Context

Adjudicate the committed implementation of GH-225 on branch `fix/gh-225-thread-context-provider`
(base `aca655d`) against the plan `PROJECT/2-WORKING/GH-225-THREAD-CONTEXT-PROVIDER.md`, which
you approved in `marathon-system/gh225-plan-qa/RELAY.md` round 3 (`VERDICT: PASS`). Read the
plan's Plan, Acceptance, Sweep and "Plan QA dispositions" sections in full first.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. Do not
ask for enterprise fail-safes, TTL caches, metrics, feature flags or new test infrastructure.

Code diff to review (whole files, not just hunks — pre-existing defects in touched files are in
scope; say so if you find none):
- `src/thread-context-provider.js` (new, ~55 lines)
- `src/chat-module.js` — `#ShouldRespondToMessageAsync` (dispatcher read), `#FindEarlierThreadFilesAsync`
  (look-back read, Compass exemption removed), `#RunCompassAsync` (Compass read), `#ReadThreadAsync`
  (new helper, the single read-policy decision), `#GatherThreadContextAsync` (new optional
  `ArgEventInfo` parameter) and its two callers in `#OnAppMentionAsync` / `#OnMessageAsync`
- `tests/product-compass.test.js` — new last case `GH-225: one thread read per event ...`
- `CHANGELOG.md` top entry `1.4.339`

Untouched on purpose (verify): `src/slack-app.js` reader, the three reaction-handler reads in
`src/chat-module.js` (`#OnReactionAddedAsync` wrench branch, `#HandleStopReactionAsync`,
`#HandleBugReportReactionAsync`), `src/selftest/**`, `src/thread-memory.js`, command and reminder
readers, Compass answer logic in `src/product-compass.js` and `src/chat-commands/ask-compass-command.js`.

## Acceptance map (plan -> evidence)

| Plan item | Where | Evidence |
|---|---|---|
| (a).1 non-Compass hands-free reply: one read; two with memo bypassed | `tests/product-compass.test.js` new case, first block (`C999`) | focused run green; red control: with `src/chat-module.js` reverted to base (provider kept so `require` resolves) the case fails `Expected number of calls: 1 / Received number of calls: 2` |
| (a).2 Compass mention + enabled look-back = one bounded read `{MaxPages:5, Latest}` | same case, second block (`C123`) | green |
| (a).3 earlier Compass upload reaches the Compass prompt | same block, `toContain('Ship the release')` | green |
| (a).4 six pages, stop on page six: 5 `conversations.replies`, one reader call, zero replies | same case, last block; GH-217 canary `:151-180` unchanged | green |
| (b) `thread-earlier-file-lookback`, `thread-memory`, `selftest`, `chat-module.integration` | focused run | `Test Suites: 5 passed, 5 total / Tests: 136 passed, 136 total` (baseline before the change: 135) |
| (c) `compass-budget` asserts one read with `MaxPages <= 5` | `src/selftest/scenarios/compass-budget.js` unchanged; the helper issues `{ MaxPages: 5, Latest }` through the instance reader the runner shadows | unchanged |
| Full `npm test` on the final code (commit `a8353d2`) | clone run, unsandboxed (the three `web-api-*` suites bind a local port) | `Test Suites: 142 passed, 142 total` / `Tests: 2598 passed, 2598 total`; node:test `# tests 116 / # pass 116 / # fail 0`; `npm test` exit 0 |
| Sweep: inline `MaxPages` at RunCompass, Compass exemption in look-back | diff | both removed; memory guard, strictly-earlier filter, quiet download path kept |
| Deferred gap (F1) disclosed, not claimed fixed | plan + CHANGELOG "Known limitation" | present |

Questions (answer each by number, cite file:line):

1. Is every acceptance item above actually met by the code on disk, not only by the test
   description? In particular, does `#ReadThreadAsync` make the bounded/legacy decision in exactly
   one place and do all four consumers go through it?
2. Do the codepaths match the approved plan: event-object `WeakMap` memo, `threadTs:maxPages`
   inner key, `context-incomplete` -> `{Messages:[], Complete:false}` memoised, other errors not
   pinned, RunCompass rethrowing `context-incomplete` so `ask-compass-command.js:19` still refuses,
   dispatcher returning `ShouldRespond:false` on `Complete:false`?
3. Did any duplicate subsystem or writer slip in (a second cache, a changed reader, a new
   persistence path, a new test harness)? Is anything over-engineered for the envelope?
4. Is the new test honest: does the memo bypass return the same result shape the provider returns,
   and would the (a).1 assertion go red if the memo were silently removed?
5. Any behavior regression for non-Compass channels, DMs, reaction handlers or the selftest
   runner's shadow counting?
6. CHANGELOG entry: two-paragraph format, plain-language first, technical second, no overclaim.

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered. Every `[Blocker]` or
`[Should]` must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines. You may run
narrow read-only probes (grep, node -e) with output under `.relay-scratch/`; do not run `npm test`
or jest in this worktree and grade such claims `[Unverified — needs clone run]`.

End your turn block with a non-empty `Basis:` line immediately followed by a single line reading
exactly `VERDICT: PASS` or `VERDICT: FAIL`. On PASS set `STATUS: Approved` in the header.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log

### Round 1 · Producer · claude-a

Implementation committed on `fix/gh-225-thread-context-provider` (commits `2f3ce17` fix,
`a330ce3` ledger, plus the docs commit for CHANGELOG `1.4.339`). Focused suites: 136/136 green;
red control observed as recorded in the acceptance map. Full `npm test` result is pasted in the
acceptance map row. Releasing the turn token to codex.

handing off to codex — codex, take your turn.


### Round 2 · Reviewer · codex

**Approved.** No GH-225 [Blocker] or [Should] finding. The implementation matches the approved scope and uses the smallest proposed mechanism. One existing diagnostic discrepancy is recorded below as non-blocking.

Evidence boundary: Verify-tier review, with direct source fallback. All 82 graph projects were listed (no further page); this exact worktree is not indexed. The nearest related project, `sleuth-product-compass`, has generation `2026-10-08T02:29:43Z`. Targeted graph discovery returned no matching symbols. Coverage reports changed chat/slack metadata and missing or untracked provider/selftest/Compass paths in that different checkout; it cannot establish this artifact's completeness or history. Direct reads of the whole provider, ChatModule and Compass test, the approved plan sections and relevant reader/command/selftest source support this review. No git, Jest, npm test, executable fixture or validation suite ran here.

1. **Acceptance and centralized policy — [Pass].** The single bounded/legacy read-policy selection is `src/chat-module.js:3102-3104`. Dispatcher `:2721`, earlier-file lookup `:2932-2933`, Compass `:3081`, and generic context gathering `:3119-3121` use it when they need a read. Both generic callers pass the original event object (`:1335`, `:2094`). Compass's context builder receives an explicit array (`:3085-3087`), and the hands-free lookback receives dispatcher messages (`:2064`), so those reuse paths do not fetch again. The optional no-event fallback is retained as planned; no current caller reaches it without an array.
   
   Acceptance (a).1 has the one-read assertion and actual generic answer at `tests/product-compass.test.js:190-194`; (a).2 and (a).3 check one bounded read and earlier upload content in the Compass prompt at `:213-216`; (a).4 checks five page calls, one reader call and no additional posts at `:231-236`. Source behavior agrees with these assertions. The existing six-page/explicit-refusal canary remains present at `:151-180`. The memory guard, strictly-earlier filter and quiet download path remain at `src/chat-module.js:2928,2936,2857-2858,3012`; the Compass exemption and Compass-local page literal are gone.

   **[Unverified — needs clone run]**: focused acceptance (b), full npm test and the producer's base-code red-control execution were not independently run this turn. The supplied 136 focused tests, 2598 Jest tests and 116 Node tests are producer-reported evidence. Their execution on this exact final artifact belongs to the post-turn clone harness gate. Acceptance (c)'s assertion is present at `src/selftest/scenarios/compass-budget.js:12-13` and the provider preserves the required call shape.

2. **Memo/error contracts — [Pass].** `src/thread-context-provider.js:17-18,34-41,43-56` implements event-object WeakMap -> inner Map -> in-flight Promise, keyed by `threadTs:maxPages`. Event identity fixes workspace/channel/timestamp at these call sites; actual Slack ingress constructs a fresh event-info object (`src/slack-app.js:1564,1651`). `context-incomplete` becomes an empty, incomplete result and stays memoised (`provider:50`); other async errors delete the entry and reject (`:51-52`). Compass turns incomplete back into the existing refusal error (`chat-module:3082`; `ask-compass-command.js:19-20`). Dispatcher immediately declines incomplete reads (`chat-module:2723`). A direct provider probe passed concurrent sharing, settled sharing, incomplete sharing, new-event reads, distinct thread/page keys and transient-error retries. WeakMap reclamation follows object reachability, rather than literal deletion at handler exit, as accepted in plan QA.

3. **Subsystem/writer scope — [Pass, with history limit].** The only added cache is the event memo; existing `#ThreadContextMemory` stores uploaded content, not duplicate Slack read results. Earlier Compass uploads enter the existing writer (`src/chat-module.js:3034-3036`) and existing workspace path (`:2763-2765`). No persistence mechanism, provider client, TTL, metric, flag or test harness was introduced in the reviewed implementation. Reaction reads still use the instance reader at `:1816,2314,2358`; the Slack reader still contains legacy single-call and bounded-pagination branches (`src/slack-app.js:851-867`). Selftest still shadows that instance method (`src/selftest/runner.js:98-104`). Compass answer/refusal ownership remains in the existing modules. Historical byte-for-byte "untouched versus aca655d" claims for excluded files are **not independently established** without a base diff; no git command was permitted. Current source conforms to the intended unchanged contracts, and no new parallel subsystem appeared in the files reviewed.

4. **Test honesty — [Pass].** The bypass at `tests/product-compass.test.js:195-196` returns `{Messages, Complete:true}`, the provider's successful-result shape, and forwards the same bounded/legacy options. That is appropriate for its successful generic fixture; it need not model incomplete errors for this control. The module-object import at `src/chat-module.js:19` and property lookup at `:3104` keep the spy effective. With sharing removed, dispatcher and Gather each call the reader, while lookback reuses the passed array: the expected-one assertion at test `:192` necessarily sees two. The bypass explicitly checks two at `:199`. Its second delivery has a fresh event object and timestamp, so it does not rely on a memo carried across events.

5. **Regressions and pre-existing defect — [Pass for GH-225; Nit below].** Non-Compass requests still pass undefined reader options (`provider:46`), preserving the existing first-page authorization limitation. DMs still take the user-initiated fast path (`chat-module:2708`); their later context reads use the same legacy policy. Reaction readers remain independent. The selftest shadow sees the real instance read and its options, not a prototype bypass. Compass's intentional new behavior is earlier-file hydration; stored memory and already-posted answers survive a rollback, as the plan discloses. No additional regression was found in the touched source.

   **[Nit — existing diagnostic discrepancy, not introduced by GH-225].** `#GetThreadDebugInfo` processes bell/no_bell but ignores octagonal_sign (`src/chat-module.js:1897-1902`), whereas the real dispatcher disables hands-free on octagonal_sign (`:2743-2747`). A wrench report can therefore say enabled for a stopped thread. This is the previously deferred GH-217 triage discrepancy, not an authorization failure or a reason to expand this implementation.
   
   Observed input: a bot-mentioned root followed by a message with `reactions:['octagonal_sign']`.
   
   Affected scope: the wrench diagnostic's reported state; the actual dispatcher remains quiet.
   
   Falsifier: the same diagnostic input returns `ShouldAutoRespond:false` after its reaction-state calculation is aligned with the dispatcher.
   
   Probe command (read-only source extraction into an in-memory class):
   `node -e 'const fs=require("fs"),vm=require("vm"),assert=require("node:assert/strict");const source=fs.readFileSync("src/chat-module.js","utf8");const body=source.slice(source.indexOf("  #GetThreadDebugInfo("),source.indexOf("\n  /**",source.indexOf("  #GetThreadDebugInfo("))).replace("#GetThreadDebugInfo","GetThreadDebugInfo").replaceAll("this.#ThreadContextMemory","this.Memory");const c=vm.runInNewContext("(class Probe {constructor(){this.Memory=new Map()} "+body+"})");const result=new c().GetThreadDebugInfo({AppMentionString:"<@BOT>"},"C","1",[{ts:"1",text:"<@BOT> start"},{ts:"2",text:"stop",reactions:["octagonal_sign"]}]);assert.equal(result.ShouldAutoRespond,true);console.log("stop-sign diagnostic ShouldAutoRespond="+result.ShouldAutoRespond+"; dispatcher disables on octagonal_sign at chat-module.js:2743-2747");' > .relay-scratch/triage-probe.log 2>&1`
   
   Exit status: **0**. Decisive output: `stop-sign diagnostic ShouldAutoRespond=true; dispatcher disables on octagonal_sign at chat-module.js:2743-2747`.

6. **CHANGELOG — [Pass].** `CHANGELOG.md:38-42` has the requested plain-language first paragraph and technical second paragraph. It describes earlier Compass uploads, names the four sharing consumers, leaves reaction reads independent and explicitly discloses non-Compass first-page authorization. Read "everything I do with that message" in the first paragraph within that explicit technical scope; independent command/reminder readers remain outside the accepted invariant. It does not claim the non-Compass safety gap was fixed or claim a live deployment.

Provider probe command: `node <<'NODE' > .relay-scratch/provider-probe.log 2>&1`, with the following standalone inline probe (no executable fixture loaded):

```javascript
const assert = require("node:assert/strict");
const {GetThreadAsync} = require("./src/thread-context-provider");
(async () => {
  const event = {channel: "C123", ts: "9"};
  const calls = [];
  let finish;
  const app = {GetConversationMessagesAsync: async (...args) => { calls.push(args); return await new Promise(r => finish = r); }};
  const a = GetThreadAsync(app, event, "1", {MaxPages: 5});
  const b = GetThreadAsync(app, event, "1", {MaxPages: 5});
  assert.equal(a, b); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["C123", "1", {MaxPages: 5, Latest: "9"}]);
  finish([{ts: "1"}]); assert.deepEqual(await a, {Messages: [{ts:"1"}], Complete: true});
  assert.equal(GetThreadAsync(app, event, "1", {MaxPages:5}), a);
  console.log("PASS concurrent + settled memo: one reader call, bounded options exact");
  let count = 0;
  const incompleteApp = {GetConversationMessagesAsync: async () => { count++; throw Object.assign(new Error("limit"), {code:"context-incomplete"}); }};
  const incompleteEvent = {channel:"C123", ts:"9"};
  assert.deepEqual(await GetThreadAsync(incompleteApp, incompleteEvent, "1", {MaxPages:5}), {Messages:[], Complete:false});
  await GetThreadAsync(incompleteApp, incompleteEvent, "1", {MaxPages:5}); assert.equal(count, 1);
  await GetThreadAsync(incompleteApp, {...incompleteEvent}, "1", {MaxPages:5}); assert.equal(count, 2);
  console.log("PASS incomplete memo: one read per event; copied/redelivered event reads afresh");
  count = 0;
  const retryApp = {GetConversationMessagesAsync: async () => { count++; if(count === 1) throw new Error("transient"); return []; }};
  const retryEvent = {channel:"C999", ts:"9"};
  await assert.rejects(GetThreadAsync(retryApp, retryEvent, "1"), /transient/);
  assert.deepEqual(await GetThreadAsync(retryApp, retryEvent, "1"), {Messages:[],Complete:true}); assert.equal(count,2);
  console.log("PASS transient error evicted: retry succeeds on second reader call");
  const keyCalls = [];
  const keyApp = {GetConversationMessagesAsync: async (...args) => {keyCalls.push(args); return [];}};
  const keyEvent = {channel:"C999", ts:"9"};
  await GetThreadAsync(keyApp,keyEvent,"1"); await GetThreadAsync(keyApp,keyEvent,"1",{MaxPages:5}); await GetThreadAsync(keyApp,keyEvent,"2");
  assert.deepEqual(keyCalls, [["C999","1",undefined],["C999","1",{MaxPages:5,Latest:"9"}],["C999","2",undefined]]);
  console.log("PASS thread/page-policy keys distinct; legacy options undefined");
})().catch(error => {console.error(error); process.exitCode=1;});
```

Exit status: **0**. Decisive output:

```text
PASS concurrent + settled memo: one reader call, bounded options exact
PASS incomplete memo: one read per event; copied/redelivered event reads afresh
PASS transient error evicted: retry succeeds on second reader call
PASS thread/page-policy keys distinct; legacy options undefined
```

Done — approved review handed back to claude-a. Only this relay file was edited; probe logs stayed under .relay-scratch. Clone execution and historical diff identity remain harness/producer verification, not claims of this turn.

Basis: Whole touched-source review and successful narrow provider/error probes confirm the approved event-local sharing, single read-policy helper, Compass fail-closed behavior and honest red control; the existing diagnostic nit does not block GH-225, and clone-suite evidence is explicitly qualified.
VERDICT: PASS

### Attestation · relay-drive — 2026-10-10T06:36:59Z
task: RELAY-gh225-final-qa
reviewer: codex
status: Approved
reviewed-head: a1f56285acce9e1f82d3e61f7a2191449d621f79
added-range: 5968+12244
added-sha256: 399b44d2143b114edc5e9d5324e5c5f03d22f72ed8aa3810dd56b82ef36760c0
