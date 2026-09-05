---
gh_issue: 169
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/169
title: "Seeded property test: MarkdownToMrkdwn + command normalizer, plus a malformed-Slack-event corpus through MockSlackApp"
status: Active (2-WORKING — plan under Codex review)
created: 2026-09-04
updated: 2026-09-05
owner: noelsaw1
branch: feat/gh169-property-fuzz
base_sha: 4a79ed7
doc_type: feedback
effort: 1
complexity: 1
risk: 1
phases: 1
rating: "pri/sev/appeal/effort 40/20/50/90 · calc 200"
related: "GH-163 (renderer under test); GH-168 (alias path the normalizer test guards); XYZ-forge GH-141 / GH-299 (ATE and fuzzing tooling assessed and declined)"
non_goals: "porting XYZ-forge ATE or fuzz-loop; fixing the quadratic link regex; fuzzing LLM JSON responses; new dependencies"
goal: >
  One jest file gives AEGIS a seeded property test over its two pure text functions and a
  malformed-Slack-event corpus through the existing MockSlackApp, with per-draw wall-clock bounds
  as a ReDoS tripwire and one-command seed replay, without a new dependency or a new test harness.
---

# GH-169 — Seeded property test over the two pure text functions, plus a malformed-Slack-event corpus

## Status

| What was just completed | What's next |
|---|---|
| Codex plan review ended at the round cap `Escalated` (r3: 2 Blockers, 1 Should, 3 Passes). Blocker 1 (resolver shape on the general draws) and the Should (`reaction_added` `user` undefined) are implemented in revision 4; r1's 7 and r2's 6 findings were all folded in earlier. Full suite, build and CHANGELOG entry done; branch pushed | **Blocked on one operator decision:** Codex r3 Blocker 2 holds that R7's literal "install a `process.on('unhandledRejection')` listener" is not met by the measured deviation (see "Fire-and-forget rejections under jest"). Owner to either amend R7 to the drain + jest-circus mechanism (recommended; it is what actually observes the rejection in this runner) or name an approved listener mechanism. Then: final QA relay on the committed implementation, PR into `development` |

## Observed problem

AEGIS has 136 jest files that assert plumbing on fixed inputs. Nothing generates inputs, nothing
bounds the wall-clock of the regex-driven text functions, and nothing feeds the handler chain the
shapes Slack actually sends when a payload is partial. The XYZ-forge ATE / fuzz-loop tooling was
assessed for this and declined (CLI-shaped, destructive per-variation repo reset, tests the
harness not the bot). A 13-input pathological probe on 2026-09-04 found zero throws and a 593ms
worst case, so this is a regression net, not a fix.

## Recon (what exists, verified 2026-09-05 on `4a79ed7`)

### Target 1 — `MarkdownToMrkdwn`, `src/markdown-to-mrkdwn.js`

- Pure `string -> string`; returns `''` for a non-string or empty input (L69). Line-oriented: splits on
  `\n`, tracks a fence flag, passes fenced lines through verbatim (L84-92), drops HTML comments and
  rules, converts headings, bullets, and inline emphasis/links (L41-57). Ten regexes total.
- Existing coverage: `tests/markdown-to-mrkdwn.test.js`, 11 tests, all fixed inputs.
- The link regex at L41 is quadratic on unbalanced `[[[[...]]]]`: 593ms at 40k chars. Parked in
  `PARKED/2026-09-04-ate-fuzz-fit-probe.md`; the property test pins the bound, it does not fix it.

### Target 2 — command normalizer and the GH-168 alias resolver, `src/command-intent-resolver.js`

Correction (2026-09-05, after a live probe): the first draft of this section described alias
substitution inside `ApplyNormalizationRules`. That is the pre-GH-168 code. On `4a79ed7`
(`faed729`, merged in PR #170) `ApplyNormalizationRules` (L151) only runs `NormalizeFreeformText`
and always returns `Notes: []`; its JSDoc (L140-146) says why. Probe:
`NormalizeDirectCommandTextAsync("use gpt 5 please")` returns the text unchanged with zero notes.
Aliases are now resolved as **whole values** at the executor handlers by `ResolveModelAlias`
(L209) via the exported `ResolveModelAliasAsync` (L236), called from
`src/chat-commands/model-switch-command.js` L58/L90 and `set-channel-model-command.js` L36.

- **Entry A — `NormalizeDirectCommandTextAsync(ArgCommandText)`** (L357 area): awaits
  `LoadCommandIntentAssetsAsync` (L90), which reads `command-catalog.json` and
  `command-normalization.json` under `data/static/ai/` once and caches them; no network. Runs
  `NormalizeFreeformText`, then the argument-invariant commands, then the six
  `DirectCommandPatterns` with `new RegExp(Pattern, 'i')`. Returns `{ NormalizedText, Notes }`.
  Property scope: never throws, shape holds, `Notes` is always `[]` on this build, per-call bound.
- **Entry B — `ResolveModelAliasAsync(ArgValue)`** (L236): hermetic (same asset load).
  `ResolveModelAlias` sanitizes (`NormalizeFreeformText` + `SanitizeSingleQuotedValue`), looks the
  whole lower-cased value up in a first-row-wins `Map` built from `ModelAliases` (53 rows, 53
  unique keys, verified), then tries stripping one vendor prefix from `VendorPrefixProviders`
  (`open ai` / `anthropic` / `google`) and accepts only when the pin's provider matches, else
  returns the value unchanged with `Note: null`. Returns `{ ModelId, Note }`.
  Existing coverage: `tests/command-intent-resolver.test.js` L179-230 (fixed cases: exact rows,
  vendor prefix accept/refuse, empty input, table exposure). The property test adds the
  table-driven and random-junk sides those fixed cases do not: every row, case and whitespace
  variants, and letter-free junk.
- Only `ResolveRmmIntentAsync` (L517 area) touches `WorkspaceAI`. The test never calls it.
- Nothing is exported for this; both entries are already public.

### Target 3 — the handler chain through `MockSlackApp`, `tests/mocks/mock-slack-app.js`

- Four entry points: `SimulateAppMentionAsync` (L600), `SimulateMessageAsync` (L617),
  `SimulateActionAsync` (L638), `SimulateReactionAddedAsync` (L658). All go through
  `#DispatchHandlersAsync` (L680), which **catches** a handler throw and logs
  `Error in <event> handler:` to `MockLogger.ErrorMessages`, then returns.
- Production mirrors this: `src/slack-app.js` L1524-1530 (reaction), L1561-1570 (app_mention, plus
  the GH-113 unified error report so the user sees something), L1643-1648 (message). So a handler
  throw never rejects the dispatch promise in either environment; it is a **logged error and a
  dropped event** (silent to the user on `message` and `reaction_added`).
- Therefore the observable invariant is three-part: (1) `Simulate*` resolves; (2) no
  `Error in ... handler:` entry was appended to `SlackApp.Logger.ErrorMessages`; (3) no
  `unhandledRejection` fired. Asserting (1) alone would never fail.
- What production guarantees before dispatch (so the corpus only carries reachable shapes):
  - `message` (L1596-1642): `text` is always a string (non-string dropped at L1600); `files` is
    always an array; `thread_ts` is `null` when absent; `user`, `subtype`, `channel_type` pass
    through raw and may be `undefined`.
  - `app_mention` (L1541-1548): `text`, `user`, `channel`, `ts`, `thread_ts` pass through raw;
    `files` normalized to an array.
  - `reaction_added` (L1505-1511): `user`, `reaction`, `item.channel`, `item.ts` raw.
- Mock gap: `SimulateMessageAsync` and `SimulateAppMentionAsync` default `channel`, `text`, `ts`
  and `user` with `||`, so an explicit `''`, `null` or `undefined` is replaced by the default.
  Production delivers `text: ''` (a string) and `user: undefined` (bot-authored messages), and the
  issue's corpus also names absent `channel`/`ts`/`text`. Codex r1 (Blocker 1): `??` would still
  swallow `null` and `undefined`, so the change is a module-level `FieldOrDefault(ArgInfo, ArgKey,
  ArgDefault)` that defaults **only when the key is absent** (`Object.hasOwn`), applied at the eight
  `channel`/`text`/`ts`/`user` sites of the two simulators. Behavior for every caller that omits a
  key is unchanged; a caller that passes an explicitly `undefined` variable now delivers
  `undefined`, which is what production would do. The full `npm test` run is the check for that.
- Handlers registered on these events: `ChatModule` registers all four kinds (L295-300, L740);
  `RemindersModule` registers `message` (L480, GitHub comment relay) and its own reminder
  handlers. `new RemindersModule(SlackApp)` constructs without starting timers
  (`scripts/first-time-user-battery.js` L69-70 and `tests/reminders-integration.test.js` L130
  already do this); `new ChatModule(SlackApp, EmptyWorkspaceStats, Reminders, null, null)` mirrors
  the battery. `WorkspaceAI` is replaced with `jest.mock('../src/workspace-ai')` +
  `ConfigureMockWorkspaceAI` (`tests/mocks/mock-workspace-ai.js`), so no LLM call is possible.
- `tests/runtime-setup.js` isolates `SLEUTH_DATA_DIR` per jest worker (GH-60), so module
  construction writes nowhere shared.

### Existing subsystem and canonical writer being extended

The jest suite under `tests/` (`package.json` `jest.testMatch` anchored to `<rootDir>/tests/**/*.test.js`)
and its shared mock `tests/mocks/mock-slack-app.js`. No new runner, no new mock, no new writer.
`scripts/decision-replay.js` stays the oracle for AI-decision behavior and is not touched.

## Per-issue requirements (GH-169 acceptance map)

| # | Requirement (issue) | Where it is met | Check |
|---|---|---|---|
| R1 | `MarkdownToMrkdwn` never throws, returns a string, fenced content untouched | `tests/property-fuzz.test.js` block 1 | 200 draws at 4k + 5 at 40k; a fenced block inserted into every draw is found verbatim in the output |
| R2 | Per-draw wall-clock bound `<50ms` at 4k, `<5000ms` at 40k (the issue suggested 1000ms; raised after measuring 1638ms under the full parallel suite, see Risks) | block 1, each draw, plus four fixed 40k inputs that hit the L41 link regex on every run | `TimedUnder` throws with the seed in the message when a draw exceeds its bound; a negative-control test proves the helper fails at bound `0` |
| R3 | Normalizer never throws / never `undefined`; `NormalizedText` string, `Notes` string[] | block 2a | 200 general 2k draws through `NormalizeDirectCommandTextAsync`, and on each of the same draws `ResolveModelAliasAsync` is called under its bound and checked for `{ ModelId: string, Note: string\|null }` (Codex r3, Blocker 1; identity stays with the letter-free loop because a general draw may contain an alias) |
| R4 | Junk that is not an alias resolves to itself | block 2b | letter-free draws (no alias contains zero letters) through `ResolveModelAliasAsync`: `Note === null` and `ModelId` **equals** `ExpectedUntouched(input)`, a test-local restatement of the sanitizer, so a resolver that returned `''` for everything fails (Codex r2, Blocker 1); the appended-junk refusal asserts the same identity |
| R5 | Every configured alias resolves to its pin | block 2b | for each of the 53 `ModelAliases` rows: `Match`, `Match.toUpperCase()`, `Match` with doubled inner spaces, and `'Match'` in single quotes all yield `ModelId === Replace` and a non-null `Note`; issue text "every alias embedded whole in random text" is re-read as whole-value per GH-168's field-only contract, and a value with random junk appended must NOT resolve (refusal, not a guess) |
| R6 | `<100ms` per call (issue suggested 20ms; raised after a 25.7ms one-off with assets warmed, see Risks) | block 2a/2b, each draw | as R2, for both entries |
| R7 | Corpus through all four `Simulate*` hooks: never reject, never unhandled throw, `unhandledRejection` armed | block 3 | three-part invariant with a `setImmediate` drain before the assertion. **Deviation, measured:** the issue's `process.on('unhandledRejection')` listener cannot work under jest — see "Fire-and-forget rejections under jest" below — so the third part is enforced by jest-circus's own handler, which the drain makes fire inside the test; no listener is installed |
| R8 | Seeded `mulberry32`; `PROPERTY_SEED` honored and printed; families: metacharacters, whitespace/newline runs, zero-width, bidi override, lone surrogates, astral + ZWJ emoji, unbalanced delimiters | top of the file | seed appears in every `test()` name; `PROPERTY_SEED=<n>` reproduces the draw byte-for-byte (verified once in the PR evidence) |
| R9 | No new dependency; green under `npm test` | `package.json` unchanged | `git diff --stat` shows no `package*.json` change |

## Smallest affected surface

- **New:** `tests/property-fuzz.test.js` (one file, three `describe` blocks, a 10-line generator).
- **Changed:** `tests/mocks/mock-slack-app.js`: one module-level helper `FieldOrDefault` (absent-key
  default via `Object.hasOwn`) at the eight `channel`/`text`/`ts`/`user` sites in
  `SimulateAppMentionAsync` and `SimulateMessageAsync` and at the `user` site in
  `SimulateReactionAddedAsync`; and, per Codex r2 Blocker 2, the two simulators now deliver absent
  `thread_ts`/`files` exactly as `src/slack-app.js` does (`message`: `thread_ts` `null`, `files`
  always an array; `app_mention`: `files` `[]`, `thread_ts` raw). A fidelity test in the new file
  captures the delivered events and asserts those values. Nothing else in the mock moves.
- **Unchanged:** every `src/` file, `package.json`, `package-lock.json`, jest config.

## Corpus (block 3), restricted to production-reachable shapes

Each shape runs through every hook it applies to, with `ChatModule` and `RemindersModule` both
registered and `WorkspaceAI` mocked (`recommendation: 'ignore'` so the reminder path stays quiet).

- `message` / `app_mention` string `text`: `''`, whitespace-only, 40 000 chars, NUL, lone high and
  lone low surrogate, RTL override, ZWJ family emoji, a single astral emoji, a zero-width run,
  unbalanced brackets, the app mention string with nothing after it, an `app_mention` whose text
  does not contain the mention string at all.
- Missing fields (Codex r1, Blocker 1): `message` with `user` `undefined` (bot-authored; reachable,
  `src/slack-app.js:1631` passes it raw) and `null`; `channel`/`ts`/`text` `undefined` and `text`
  `null` on `message` (mock-reachable only: Slack always supplies `channel`/`ts`, and :1600 drops a
  non-string `text` before dispatch). `app_mention` with `user`/`channel`/`ts` `undefined`
  (mock-reachable only).
- Subtypes, labelled per `src/slack-app.js:1592-1648` (Codex r1, Should 3): `file_share` reaches the
  handlers in production; `bot_message`, `message_changed`, `message_deleted` are dropped before
  dispatch and are mock-reachable only.
- `thread_ts`: equal to `ts`; present with no parent in the mock's message store.
- `files`: `[]`, `[{}]`, one entry whose `mimetype` contradicts `filetype`.
- `channel_type`: `im`, `mpim`, `group`, `'not-a-type'`.
- `reaction_added`: unknown `reaction` name, `item.ts` that no message has, `user` `null` and
  `user` `undefined` (production forwards the field raw, `src/slack-app.js:1505-1511`; Codex r3
  Should), a `wrench` triage reaction on a missing message.
- `block_actions`: `ChatModule.ChatGoogleSearchActionId` with `value` `''`, 40 000 chars, NUL plus a
  lone surrogate. A `null` value is normalized to `''` by the mock exactly as production does
  (`src/slack-app.js:1668-1675`), so it is not a separate row (Codex r1, Should 3).

**Fire-and-forget rejections under jest (measured 2026-09-05, jest 30.3.0).** Two throwaway
probes, run and deleted in the task clone:

1. A `process.on('unhandledRejection')` listener registered inside a test, followed by an
   un-awaited `Promise.reject` and a `setImmediate` drain: `listenerCount` 1, listener never
   called (`seen: []`), and jest-circus reported the rejection as that test's failure. The
   test-context `process` is jest's proxy; the real process's handler is jest's own.
2. The same body under `test.failing`: jest reported *"Failing test passed even though it was
   supposed to fail"* and, separately, the rejection — `test.failing` inverts the body's own
   errors, not the attributed rejection.

Consequences: the listener in the issue text is dead code in this runner and is not installed;
the observable that does work is "keep the rejection inside the test's lifetime" (the drain), and
jest fails the test. A permanent green control for that branch is impossible without disabling
jest's handler, so Codex r2 Should 3 is met for the handler-throw branch (permanent control in the
file) and **recorded, not controlled** for the fire-and-forget branch: a run-once control on
2026-09-05 (handler returns `true` after an un-awaited `Promise.reject`) failed the test with
`control: fire-and-forget rejection` attributed at the handler line, which is the required
behavior.

**Triage rule for a failing shape (Codex r1, Blocker 3):** a shape that leaves an
`Error in <event> handler:` entry blocks this PR until it is fixed, or it is removed from the corpus
as out-of-contract with the reason recorded here and a follow-up issue filed. No `test.failing`.

**Applied once already.** The first run of the corpus caught `app_mention` with `text` `undefined`
or `null`: `src/chat-command-router.js:111` calls `.match` on it, and every `app_mention` handler
assumes a string, while `src/slack-app.js:1543` passes `ArgEvent.text` raw (the `message` path
guards at :1600). Slack's `app_mention` contract always carries `text`, so the two rows are
out-of-contract and were removed; the assumption is filed as GH-172
(https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/172), linked from the test comment and
the PR, with the one-line dispatch guard that would let the rows return.

## Non-goals

- Porting or wiring XYZ-forge ATE, `fuzz-loop.sh`, or `fuzz_inputs.py`.
- Fixing the quadratic link regex (parked; sub-second; input is bot-generated digest text).
- Fuzzing LLM JSON response parsing; fuzzing `lists-module.js` / `reminders-ai-pipeline.js` internals.
- Exporting `ApplyNormalizationRules`; a `fast-check` or any other dependency; a new mock or runner.

## Dependencies, risks, rollback

- **Dependencies:** none unmerged. Base `4a79ed7` already includes PR #170 (GH-88/168 plans and
  the executor-side alias resolution), so the normalizer under test is the current one.
- **Risk — flaky wall-clock bounds on a loaded runner.** Observed, not hypothetical: inside the full
  parallel `npm test` on 2026-09-05 the fixed "40k nested brackets" case took 1638ms against the
  issue's suggested 1000ms (593ms isolated). The 40k bound is therefore `5000ms`: it absorbs
  worker contention while a real catastrophic-backtracking regression, which grows superlinearly
  with input, still trips it. 4k stays `50ms` (~1ms measured, 50x margin). The resolver bound is
  `100ms`, not the issue's suggested `20ms`: with assets warmed, one draw measured 25.7ms on a
  single isolated run (seed 99991, draw 112) and under 1ms on two re-runs of the same seed, so
  20ms sits inside scheduler noise. All three live in one place at the top of the test file.
- **Risk — the absent-key default alters an existing test.** A caller that passes an explicitly
  `undefined` variable for `channel`/`text`/`ts`/`user` now delivers `undefined` instead of the
  default. Full `npm test` is the check; a broken caller is fixed at the call site, not by
  weakening the helper.
- **Risk — a corpus shape exposes a real handler throw.** That is the point; triage rule above.
- **Rollback:** revert the one new file and the mock helper with its eight call sites. No data,
  config, or runtime path is touched.

## Implementation order (with verification inline)

1. Write `tests/property-fuzz.test.js`: `mulberry32`, `PROPERTY_SEED` handling, weighted family
   generator, block 1 (R1, R2, plus four deterministic 40k ReDoS inputs that hit the L41 link
   regex on every run — Codex r1, Should 1), block 2 (R3-R6, with `LoadCommandIntentAssetsAsync`
   warmed in `beforeAll` so the per-draw bound measures regex work, not the first disk read —
   Codex r1, Should 2 — plus a warm smoke test that both public entries return their stated shapes;
   it does not claim to prove first-load behavior, Codex r2, Should 2), block 3 (R7, with a
   `setImmediate` drain between dispatch and assertion so a fire-and-forget rejection inside a
   handler is observed — Codex r1, Blocker 2). Verify: `npx jest tests/property-fuzz.test.js`
   green on three seeds; the same seed twice produces identical draws (R8).
2. Add `FieldOrDefault` to `tests/mocks/mock-slack-app.js` and use it at the eight
   `channel`/`text`/`ts`/`user` sites. Verify: the missing-field corpus rows reach the handlers
   (the first run proved it by catching the `app_mention` non-string text throw), and the full
   `npm test` stays green.
3. Red controls (Codex r2, Should 3): permanent in the file — (a) the bound helper at bound `0`
   must throw naming the seed; (b) a bare mock with a throwing `HandleMessage` handler must make
   the invariant fail on the `Error in message handler:` entry. Run once and recorded above —
   (c) a handler that returns normally but leaves an un-awaited rejecting promise fails the test
   through jest's own handler once the drain surfaces it; no green form of (c) exists under jest.
   None is a corpus shape and none uses `test.failing`.
4. Test budgets (Codex r2, Blocker 3): the 4k and 40k draw tests and each deterministic 40k case
   carry an explicit jest timeout of draws × bound + 5s, so a slow draw fails through `TimedUnder`
   with the seed rather than through jest's default 5s budget. Generated 40k inputs are sized
   after the sentinel block so they are at most 40 000 code units, and the unclosed-links fixed
   case repeats 3333 times (39 996) rather than 4000 (Codex r2, Should 1).
5. Gates, un-sandboxed (GH-164: sandboxed jest retargets HEAD): `npm test`, `npm run build`,
   `bash utils/pdda/pdda.sh run` (error count must not exceed the 29 pre-existing on the clean
   clone plus this doc's own `roadmap-coverage` line, which the check raises because it reads the
   frozen `ROADMAP.md` while the pointer lives in `releases.db` — the same gap as eight other
   active docs), `utils/sanitize-scan.sh` via the pre-commit hook.
6. Add the CHANGELOG entry as a new `## 1.4.323` heading with the TL;DR + `**Technical:**` shape
   `validate:changelog-tone` enforces; do not bump `package.json` `version`.
7. Update this doc's status table and the acceptance map with results; final Codex relay QA; PR
   into `development`.

## Rating rationale (2026-09-05)

- **Severity 20.** No observed consequence. A 13-input pathological probe on 2026-09-04 found zero
  throws and a worst case of 593ms on 40k unbalanced brackets, on a renderer whose input is
  bot-generated digest text. This is a regression net, not a fix. The one throw the corpus later
  caught is out of Slack's contract (see the corpus section) and is filed separately.
- **Priority 40.** Above the severity-led 20 because the operator queued it for execution now and
  it doubles as the GH-168 alias-path regression net. Nothing is blocked on it.
- **Appeal 50.** Neutral; the operator stated no desirability preference.
- **Effort 90 (cheapness).** One test file and a small mock helper, no dependency, about an hour.
- **Recurrence.** Issues created 2026-08-22..2026-09-05: 23 total, 1 crash/parse-class and that one
  is GH-169 itself. Prior window 2026-08-08..2026-08-21: 63 total, 1 crash/parse-class. No
  same-class incident in either window. Title search only; comments and reopenings not inspected,
  so the trend is "no evidence of recurrence", not "proven zero".

## Evidence for the mock change

`rg -n "Simulate(Message|AppMention)Async\(\{[^}]*(text|user):\s*(''|\"\"|null)" tests scripts`
returned no matches on `4a79ed7` (no caller passes an explicit empty or null literal). Callers that
pass a variable are covered by the full `npm test` run recorded in the PR.
