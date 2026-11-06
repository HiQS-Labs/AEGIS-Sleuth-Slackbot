# GH-301 Phase 1 verification — 2026-11-06

Code under test: branch `feat/AEGIS-Sleuth-Slackbot-gh301-bot-remote-crud-2026-11-06`, cut from `origin/development`
@ `65210c1`. Everything ran on a local checkout; nothing ran on a server.

## Focused suite

`npx jest tests/web-api-reminders.test.js` → **60 passed**: the 28 existing tests, unchanged, plus 32 new ones in
`Bot principals (GH-301 Phase 1)`. `npm run build` is clean.

## Red controls (by hand; source restored from the commit after each)

| Guard removed | Test that goes red |
|---|---|
| `WEB_API_BOT_PRINCIPALS` flag check | flag off: a principal token is refused |
| peer check (TLS or loopback) | plain HTTP from a remote peer is refused, even with `X-Forwarded-Proto` |
| synchronous idempotency reservation (deferred by 50 ms) | replay test **and** overlap test (2 failed) |
| per-action field allowlist | unknown field on the second action is refused whole |
| middleware workspace check | cross-workspace access is denied |
| capacity eviction before the key lookup (pre-fix order, final QA r1) | at the cap, a held key still replays or conflicts |
| denial audit on batch-validation refusals (final QA r1) | every refused principal write logs exactly one redacted denial record |

The handler-level `params.name === Principal.Workspace` check is defence in depth. The strict path regex
captures a name that equals Express's decoded `params.name`, so no request reaches that check alone and no
red control can isolate it.

## Full suite and gates

- Full `npm test`: **2984 passed, 1 failed** (2985 total; 30 more than the 2955 at GH-290's final run). The one
  failure is `thread-memory store › SaveThreadMemoryAsync stores the row but no embedding when no key/embedder`.
  It fails the same way on `development` @ `d8f3b15` (a disposable verify clone, 2026-11-05, GH-290 receipt),
  and this branch does not touch thread memory.
- `npm run build`, `validate:fsm`, `validate:reminder-pipeline`, `validate:commands`,
  `validate:workspace-isolation` and `validate:changelog-tone` all exit 0.
- `utils/sanitize-scan.sh`: the first run found 1 `generic-assigned-secret` false positive. It matched
  an inline call that generated a test token inside a request-options object. The test now assigns the
  token to a variable first. Rescan: **CLEAN**.

## Final QA round 1 fixes

Codex (final QA round 1) found two Shoulds:
- `IdempotencyStore.Reserve` ran capacity eviction before the key lookup, so at the cap a retry of the oldest key
  ran again and a changed body didn't conflict. Fixed: expire, then look up, then make room only for a new key.
- Batch-validation refusals and key conflicts were not audited. Fixed: each now logs one `principal-denied` record.

The docs were also corrected: shared validation errors carry no `code`; a missing file means `unknown`; admin
refusals stay with the admin session. The file passes 60/60 after the fixes. The full gate was rerun on the approved commit `735d5e8`:
`npm test` gave 2986 passed and 1 failed (the same pre-existing `thread-memory` test); build, every
`validate:*` and the sanitize scan exit 0.

## PR #305 bot-review fixes (after final QA approval)

Greptile on #305 raised four points, all accepted:
- **Smoke credential overwrite:** the smoke now refuses any `SLEUTH_DATA_DIR` that is missing or not empty, and
  calls `workspaces.AssertNotLiveRuntimeDir`. Checked: a non-empty dir and a `.live-data` dir are both refused
  with the usage line.
- **CLI:** workspace names are checked against the server's rule (`WorkspaceNamePattern`, now exported) before a
  token is printed. Checked: `team.one` is refused with exit 2; `team_one` is accepted.
- **Audit:** every principal GET refusal now logs `principal-denied`, with `invalid-request` when no specific code
  applies. New test: `?activeOnly=maybe` gives exactly one record.
- **Naming:** the smoke harness follows the naming conventions (`CallAsync`, `Arg*` parameters, `error`).

After the fixes, the focused file passes 61/61, the build is clean, and the smoke was rerun in a fresh empty dir
with the same results. The branch was also brought up to date with `development` after #304 merged: the ledger
was taken from `development`, the GH-301 row was re-added through the CLI, and the dashboard was regenerated.

## Smoke (`gh301-smoke.cjs`, output in `smoke-output.txt`)

The real `WebAPI` and a real `RemindersModule` (test `MockSlackApp`) ran in a **throwaway `SLEUTH_DATA_DIR`**
under the session scratch dir, with `WEB_API_BOT_PRINCIPALS=1` and one principal. The principals file was
mode 600. Requests went over HTTP on loopback, as a bot behind a local TLS proxy would send them.

- **Main path:** `GET` its own workspace with `limit` → success; `complete` with `Idempotency-Key` →
  `completed`, and 0 reminders left pending in the store.
- **Adjacent paths:**
  - replaying the same request returns the identical cached response with no second write;
  - the same key with a different body gets `idempotency-key-reused`;
  - the other workspace gets `forbidden-workspace`, and `/workspaces` gets `forbidden`;
  - after `revoked: true` is set in the file, with no restart, the next call gets `revoked`.
- No Slack messages were posted.

## Not verified here

- TLS termination: neither server has a TLS proxy in front of `:2020`. Remote bot use is blocked by design
  until one exists. The socket-TLS branch (`req.socket.encrypted`) is not exercised, because the server is
  plain HTTP.
- Any deployed run. A bot pilot on dev is Phase 4 and needs operator authorization.
- Phases 2–4 (create/patch with If-Match, MCP adapter, pilot).
