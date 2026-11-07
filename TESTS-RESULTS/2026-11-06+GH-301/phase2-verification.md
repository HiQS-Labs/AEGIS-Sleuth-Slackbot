# GH-301 Phase 2 verification — 2026-11-06

Code under test: branch `feat/AEGIS-Sleuth-Slackbot-gh301-bot-remote-crud-2026-11-06-phase2`, base `development`
@ `39760d7`, with the plan approved by Codex in round 2 (`relay-system/2026-11-06/gh301-phase2-plan-qa.md`).
Everything ran locally; nothing ran on a server.

## Tests

- `tests/web-api-reminders.test.js`: **74 passed** (73 before final-QA round 1, plus the failed-create retry case). The Phase 1 bot tests were updated to send `ifMatch`. New
  Phase 2 cases cover:
  - `version` on principal reads only;
  - `if-match-required`, `duplicate-reminder`, and `force` → `unknown-field`;
  - whole-batch `version-conflict` with current versions and no writes;
  - the version passed to the writers, and the new version returned;
  - the create refusals: alone, `senderId`, assignees, title contract, enabled channel;
  - a durable create replay after a fresh `WebAPI` (empty in-memory store), and a different body under the same
    key refused.
- `tests/reminders-integration.test.js` (real `RemindersModule`), GH-301 Phase 2 block: **5 passed**.
  - the digest tracks owner order, the snooze, DND and relay flags, and the text; Date and string forms, and
    legacy and current owners, hash the same; the input is not mutated;
  - a version-checked retitle held at its ledger-gap write, interleaved with a list-path retitle or a
    completion, returns `conflict` and changes nothing;
  - stale `ExpectedVersion` on complete, cancel and reschedule refuses before any change;
  - a bot create's key and fingerprint are in the first persisted copy on disk.
- `npm run build` is clean; `validate:fsm` OK.

## Red controls (by hand; source restored after each)

| Guard removed | Test that goes red |
|---|---|
| retitle's post-await version re-check | both "waits across …" race cases |
| `ApiCreateKey` stamp before the first save | "a bot create carries its key and fingerprint…" |
| web-api version pre-check | "a stale ifMatch refuses the whole batch…" and "retitle and reschedule pass the version…" |
| durable create lookup | "a create is stamped with its key; a retry after the in-memory cache is gone finds it" |

## Smoke (`gh301-phase2-smoke.cjs`, output in `phase2-smoke-output.txt`)

The real `WebAPI` and `RemindersModule` ran in an empty throwaway `SLEUTH_DATA_DIR` with one channel that has
auto-scheduling enabled, driven over HTTP by a bot principal.
- **Main path:** create → retitle with `ifMatch` → reschedule with the current version → complete; 0 left pending.
- **Adjacent paths:**
  - the pre-retitle version gets `version-conflict`;
  - **after rebuilding module and API from disk**, the create replay returns the same id with `replayed: true`;
  - the same key with a different body gets `idempotency-key-reused`;
  - a channel without auto-scheduling gets `channel-not-enabled`.
- No Slack posts.

## Full suite

- Full `npm test` on `fb7e251`: **3004 passed, 1 failed**. The failure is the pre-existing `thread-memory` test,
  which also fails on `development`; this branch does not touch it. Build and every `validate:*` exit 0.
- `utils/sanitize-scan.sh`: the first run flagged the smoke harness's made-up channel id (`C0SMOKE…`, which is
  shaped like a Slack id). The harness now uses `smoke-channel-on`/`-off`. Rescan: **CLEAN**.

## Final QA round 1 fix

Codex found that a `create` whose writer failed still returned an outer `success: true`, so the idempotency store
cached the failure and a same-key retry replayed the error. The keep rule now also requires every `create` item to
be `created`. A failure after the stamp is still found by the durable lookup, so a retry cannot duplicate it.
- New test: the writer throws once and then succeeds; the same key retries, the writer runs twice, and there is
  one reminder.
- Red control: drop the rule and the test goes red.

The docs and CHANGELOG were also qualified: durable create replay covers pending reminders only, and versions come
with the standard record format. The smoke was rerun with the renamed channels; same results.

Full gate rerun on the approved commit `8d114cc`: `npm test` gave 3005 passed and 1 failed (the same pre-existing
`thread-memory` test). Build, every `validate:*` and the sanitize scan exit 0.

## Not verified here

- A real external bot, and the dev pilot with Phase 2 actions (dev still runs Phase 1 until this merges and
  deploys).
- Editing GitHub links (deferred).

## PR #306 review fixes (after final QA approval; Codex re-check round 3)

CI (GitHub Actions) and the bot reviewers (Greptile, CodeRabbit) found the following. All are fixed here.
- **CI flake:** the durable-create test restarted the API on the same port, and a pooled keep-alive socket to
  the stopped server failed (`other side closed`). The test now uses a second API instance on its own port.
- **Replay persisted before success:** a create whose first save failed stays in memory, stamped. The durable
  replay now calls `SaveRemindersNowAsync` before reporting `created`; if that save fails, the response is
  `save-failed` and is not cached.
- **Mutation-time versions:** the retitle, reschedule and create writers report, through `OnVersion`, the
  version their change produced **at the moment of mutation**. The API returns that one, not a live version
  sampled after the writers' later awaits, which could cover a concurrent human edit. `partial` items now carry
  their version too.
- **Tests:**
  - a version captured at mutation while a concurrent edit lands, after which the bot's next edit conflicts;
  - a partial reschedule returning its version;
  - a missing reminder returning `not-found` beside a valid item;
  - a replay save failure that is not cached, followed by a successful replay.
  
  Web API file: **76/76** (twice); integration GH-301 block: 5/5.
- **Red controls:** dropping the replay save, and replacing the mutation-time version with the live one, each
  turn their test red.
- The smoke harness follows the naming and format conventions.
