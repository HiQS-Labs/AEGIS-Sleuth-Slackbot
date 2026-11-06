# GH-301 Phase 2 verification — 2026-11-06

Code under test: branch `feat/AEGIS-Sleuth-Slackbot-gh301-bot-remote-crud-2026-11-06-phase2`, base `development`
@ `39760d7`, with the plan approved by Codex in round 2 (`relay-system/2026-11-06/gh301-phase2-plan-qa.md`).
Everything ran locally; nothing ran on a server.

## Tests

- `tests/web-api-reminders.test.js`: **73 passed**. The Phase 1 bot tests were updated to send `ifMatch`. New
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

FULL_SUITE_PLACEHOLDER

## Not verified here

- A real external bot, and the dev pilot with Phase 2 actions (dev still runs Phase 1 until this merges and
  deploys).
- Editing GitHub links (deferred).
