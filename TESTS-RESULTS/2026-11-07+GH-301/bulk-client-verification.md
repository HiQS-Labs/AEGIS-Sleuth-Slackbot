# Bulk client principal compatibility

Base: `6593629890d625b5d52056d2cd4a39a7706b0781` (PR #308 merged after current-head CI passed). Candidate branch `fix/gh301-bulk-bot-client-2026-11-07`.

## Bounded recon and contract

The existing CLI/SKILL were read in full; graph lookup confirmed MainAsync → ResolveConfig/CallApiAsync/ResolveIds within this one entrypoint. String search found no existing CLI tests. The existing HTTP-server suite verifies server behavior but cannot catch CLI flags, prepared-request persistence, bot HTTPS refusal or replay-body reconstruction. One new test file uses the existing Jest runner and real child process, intercepting only HTTP; no new framework, server writer or gate.

Principal requests now use direct HTTPS, explicit User-Agent, redirect refusal, backed-up ifMatch and a random write key. The exact destination/principal/workspace/key/body is saved privately before POST and can be explicitly replayed unchanged. No automatic retries or version refresh. Bot duplicate reminder targets/reassign/force/senderId are refused before POST; create is alone. Legacy operator multi-edit requests remain supported. --set-links uses the existing server action.

Replay is bound to configured endpoint/workspace/principal; it cannot redirect the credential to a request-file-selected host. All create replays are refused: a pending GET cannot guard the later POST against concurrent completion/cancellation after the server forgets its in-memory key. Manual reconciliation is required because server create replay durability is pending-only. Completion/edit replay keeps the original version and can report conflict/not-found after cache loss without overwriting newer state.

## Observed verification

- `node node_modules/jest/bin/jest.js --runInBand --forceExit tests/bulk-edit-reminders.test.js tests/web-api-reminders.test.js`: **97 passed**; CLI suite has **9** checks. Same actual CLI with source from prior base: **8 failed, 1 passed** (legacy behavior), then candidate restored and green. Tests cover headers/versions, private receipts, exact replay after fresh backup changes, unsafe invocation refusal, unknown create outcome, completed-create refusal, endpoint binding and legacy behavior.
- `npm run build`: passed; `node --check` on CLI passed.
- Full `npm test`: **3039 passed, 1 same baseline-confirmed thread-memory failure**. Full local suite remains not green.
- Real principal HTTPS `backup` succeeded with the existing dev credential; read-only request, private backup, no live mutations. No host/token/record details copied here.
- Experiment discovered Node consumes --env-file before the script unless launched with `node -- <script>`; fixtures and documented invocations use the separator. This keeps the KEY=VALUE parser in control rather than native Node env-file loading.

## Safety and limits

Credentials are never stored in prepared requests. Backups/requests use mode600 under the private directory; requests retain reminder content and must stay private. HTTP redirects and bot SSH tunnels are refused. Requests are not automatically retried; request/result receipt writes can fail and the CLI reports failure rather than claiming an ambiguous operation succeeded. MCP remains deferred. Operational HTTPS migration/port closure is next, not proven by this local client change.

Current CLI source SHA-256: `a851ca0cadb4993c16710793b7ef99aa57c77b653dee96707573aaf505d14ef4`.


## PR #309 review corrections

Two review findings were verified. The client no longer posts any create replay, even when the
original ID appears pending: that GET cannot prevent a concurrent close after the server loses its
in-memory replay entry. Prepared request bytes remain immutable; response receipts use separate
exclusive files. An interrupted/full-disk response write cannot erase the original key/body.

Updated regression tests fail twice on the reviewed implementation (8 passed), then pass on the
correction. Current focused CLI/API suites: **98 passed** (10 CLI checks); build passed. A simulated
result-save failure leaves the prepared request intact and an exact edit retry succeeds. The full
3039/1 result above belongs to the preceding implementation; no full-suite rerun is claimed here.
