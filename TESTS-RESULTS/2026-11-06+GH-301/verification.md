# GH-301 Phase 1 verification — 2026-11-06

Code under test: branch `feat/AEGIS-Sleuth-Slackbot-gh301-bot-remote-crud-2026-11-06`, cut from `origin/development`
@ `65210c1`. Everything ran on a local checkout; nothing ran on a server.

## Focused suite

`npx jest tests/web-api-reminders.test.js` → **58 passed**: the 28 existing tests, unchanged, plus 30 new ones in
`Bot principals (GH-301 Phase 1)`. `npm run build` is clean.

## Red controls (by hand; source restored from the commit after each)

| Guard removed | Test that goes red |
|---|---|
| `WEB_API_BOT_PRINCIPALS` flag check | flag off: a principal token is refused |
| peer check (TLS or loopback) | plain HTTP from a remote peer is refused, even with `X-Forwarded-Proto` |
| synchronous idempotency reservation (deferred by 50 ms) | replay test **and** overlap test (2 failed) |
| per-action field allowlist | unknown field on the second action is refused whole |
| middleware workspace check | cross-workspace access is denied |

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
  `token: Principals.MakeToken(...)`, a runtime-generated test token, in the test file. The test now assigns the
  token to a variable first. Rescan: **CLEAN**.

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
