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
| Recon traced both targets and the mock/production dispatch chains; intake parked and rated (40/20/50/90); plan written on `feat/gh169-property-fuzz` @ `4a79ed7` | Codex relay plan review, then implement `tests/property-fuzz.test.js` and the two-token `MockSlackApp` change, run the gates, final relay QA, PR into `development` |

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

### Target 2 — command normalizer, `src/command-intent-resolver.js`

- Public entry `NormalizeDirectCommandTextAsync(ArgCommandText)` (L357). It awaits
  `LoadCommandIntentAssetsAsync` (L90) which reads `data/static/ai/command-catalog.json` and
  `data/static/ai/command-normalization.json` from disk once and caches them; no network. Then
  `ApplyNormalizationRules` (L144) runs `NormalizeFreeformText` and, per `ModelAliases` entry (53
  entries today), builds a whole-phrase regex via `BuildWholePhraseRegex` (L123, `\b` + escaped
  segments + `\s+`, flags `ig`) and `.replace()`s it, pushing a `Match -> Replace` note on change.
  Then the six `DirectCommandPatterns` are tried with `new RegExp(Pattern, 'i')` (L373).
- `ApplyNormalizationRules` is not exported (exports at L709). The test drives the exported entry;
  no export change.
- Only `ResolveRmmIntentAsync` (L517) touches `WorkspaceAI`. The test never calls it.
- Alias caveat that shapes one property: several aliases are substrings of others
  (`gpt` vs `gpt 5`, `claude` vs `claude opus 5`); the rules apply in file order, so the
  "every alias yields exactly one note" property must be stated per *canonical* alias embedded
  alone, and the assertion is "at least one note whose `Replace` matches, and the `Replace` value
  is present in `NormalizedText`", not "exactly one note".

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
- Mock gap: `SimulateMessageAsync` and `SimulateAppMentionAsync` default `text` and `user` with
  `||`, so an explicit `''` or `null` is replaced by the default. Production delivers `text: ''`
  (a string) and `user: undefined` (bot-authored messages). No existing caller passes `''` or
  `null` for those fields (grep below), so switching those four defaults to `??` is
  behavior-preserving for every current test and lets the corpus deliver the two reachable shapes.
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
| R2 | Per-draw wall-clock bound `<50ms` at 4k, `<1000ms` at 40k | block 1, each draw | `expect(elapsedMs).toBeLessThan(bound)` per draw, seed in the failure message |
| R3 | Normalizer never throws / never `undefined`; `NormalizedText` string, `Notes` string[] | block 2 | 200 draws through `NormalizeDirectCommandTextAsync` |
| R4 | No alias phrase means zero notes | block 2 | generator with the alias words excluded; `Notes.length === 0` |
| R5 | Each configured alias embedded whole in random text yields a matching note and its `Replace` value | block 2 | loop over `ModelAliases` from the JSON asset; see caveat above for the exact assertion |
| R6 | `<20ms` per normalizer call | block 2, each draw | as R2 |
| R7 | Corpus through all four `Simulate*` hooks: never reject, never unhandled throw, `unhandledRejection` armed | block 3 | three-part invariant above; listener installed in `beforeAll`, removed in `afterAll` |
| R8 | Seeded `mulberry32`; `PROPERTY_SEED` honored and printed; families: metacharacters, whitespace/newline runs, zero-width, bidi override, lone surrogates, astral + ZWJ emoji, unbalanced delimiters | top of the file | seed appears in every `test()` name; `PROPERTY_SEED=<n>` reproduces the draw byte-for-byte (verified once in the PR evidence) |
| R9 | No new dependency; green under `npm test` | `package.json` unchanged | `git diff --stat` shows no `package*.json` change |

## Smallest affected surface

- **New:** `tests/property-fuzz.test.js` (one file, three `describe` blocks, a 10-line generator).
- **Changed:** `tests/mocks/mock-slack-app.js` L603, L605, L620, L623: `||` to `??` on the `text`
  and `user` defaults of the two message-shaped simulators. Nothing else in the mock moves.
- **Unchanged:** every `src/` file, `package.json`, `package-lock.json`, jest config.

## Corpus (block 3), restricted to production-reachable shapes

Each shape runs through every hook it applies to, with `ChatModule` and `RemindersModule` both
registered and `WorkspaceAI` mocked (`recommendation: 'ignore'` so the reminder path stays quiet).

- `message` / `app_mention` `text`: `''`, whitespace-only, 40 000 chars, NUL, lone surrogate,
  RTL override, ZWJ sequence, a single 4-byte emoji, the app mention string with nothing after it,
  an `app_mention` whose text does not contain the mention string at all.
- `message` `user`: `undefined` (bot-authored); `subtype`: `bot_message`, `file_share`,
  `message_changed` (reachable through the mock; production drops subtype messages earlier, so
  these document the handler's own tolerance and are labelled as such).
- `thread_ts`: equal to `ts`; present with no parent in the mock's message store.
- `files`: `[]`, `[{}]`, one entry whose `mimetype` contradicts `filetype`.
- `channel_type`: `im`, `mpim`, `group`, `'not-a-type'`.
- `reaction_added`: unknown `reaction` name, `item.ts` that no message has, `user` `undefined`.
- `block_actions`: `ChatModule.ChatGoogleSearchActionId` with `value` `''`, `null`, 40 000 chars.

Any shape that fails is triaged in the same branch: a guard of a few lines inside the two modules
already under test is in scope; anything larger is filed as its own issue and the shape is kept in
the corpus under jest's `test.failing` (jest 30.3.0) so it flips green when fixed and the suite
stays green meanwhile.

## Non-goals

- Porting or wiring XYZ-forge ATE, `fuzz-loop.sh`, or `fuzz_inputs.py`.
- Fixing the quadratic link regex (parked; sub-second; input is bot-generated digest text).
- Fuzzing LLM JSON response parsing; fuzzing `lists-module.js` / `reminders-ai-pipeline.js` internals.
- Exporting `ApplyNormalizationRules`; a `fast-check` or any other dependency; a new mock or runner.

## Dependencies, risks, rollback

- **Dependencies:** none unmerged. Base `4a79ed7` already includes PR #170 (GH-88/168 plans and
  the executor-side alias resolution), so the normalizer under test is the current one.
- **Risk — flaky wall-clock bounds on a loaded CI runner.** Mitigation: bounds are 10x the measured
  worst case at 4k (`<50ms` vs ~1ms measured) and ~2x at 40k (`<1000ms` vs 593ms); the 40k draws are
  five, not two hundred. If CI proves noisy the 40k bound is the only knob, and it is one constant.
- **Risk — the `??` change alters an existing test.** Mitigation: grep shows no caller passes `''`
  or `null` for `text`/`user`; full `npm test` is the check.
- **Risk — a corpus shape exposes a real handler throw.** That is the point; triage rule above.
- **Rollback:** revert the one new file and the four-token mock change. No data, config, or
  runtime path is touched.

## Implementation order (with verification inline)

1. Write `tests/property-fuzz.test.js`: `mulberry32`, `PROPERTY_SEED` handling, weighted family
   generator, block 1 (R1, R2), block 2 (R3-R6), block 3 (R7). Verify: `npx jest tests/property-fuzz.test.js`
   green; run twice with the printed seed and `diff` the two outputs of a debug dump of the first
   ten draws to prove R8 replay.
2. Change the four `||` defaults to `??` in `tests/mocks/mock-slack-app.js`. Verify: the corpus
   `''`-text and `undefined`-user shapes now reach the handlers (assert on the mock logger's
   `InfoMessages` carrying the empty text once, as a one-time check in the PR evidence, not as a
   permanent assertion).
3. Red controls, run once each and pasted into the PR: (a) set the 4k bound to `0` and confirm block 1
   fails with the seed in the message, restore; (b) register a throwing `HandleMessage` handler on
   the mock inside a scratch test and confirm block 3's three-part invariant fails on the
   `Error in message handler:` log entry, delete the scratch test.
4. Gates, un-sandboxed (GH-164: sandboxed jest retargets HEAD): `npm test`, `npm run build`,
   `bash utils/pdda/pdda.sh run` (error count must not exceed the 29 pre-existing on the clean
   clone), `utils/sanitize-scan.sh` via the pre-commit hook.
5. Append the CHANGELOG entry under the unreleased heading; do not bump `package.json` `version`.
6. Update this doc's status table and the acceptance map with results; final Codex relay QA; PR
   into `development`.

## Grep evidence for the `??` change

`rg -n "Simulate(Message|AppMention)Async\(\{[^}]*(text|user):\s*(''|\"\"|null)" tests scripts`
returned no matches on `4a79ed7`.
