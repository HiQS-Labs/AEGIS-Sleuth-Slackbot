# GH-301 handoff follow-up verification

Base: development `b2ef33d`; candidate: local branch `fix/gh301-client-audit-followups-2026-11-06`.

## Audit reproduction and cause

- Extended the existing refused-write audit test to exercise `version-conflict` and `channel-not-enabled` through the real local HTTP handler. Before the fix, the test failed: expected one denial record, received zero. Initial attempt could not load Express; installed lockfile dependencies with `npm ci --no-audit --no-fund`, then reproduced the assertion failure.
- Root cause: `#HandlePrincipalBulkAsync` used the success audit path unconditionally after awaiting its reservation; fix site: that handler, before success logging; no writer, auth or response changes are needed.
- Fix: request-level `success:false` uses the existing denial logger, with its response code or the existing `invalid-request` fallback, and returns the original response. Per-item outcomes in successful envelopes retain their existing write audit.

## Verification

- `PATH=/opt/homebrew/bin:$PATH node node_modules/jest/bin/jest.js --runInBand --forceExit tests/web-api-reminders.test.js`: **76 passed**, Node 26.13.0. Extended existing tests also cover missing/stopped workspaces and a create-replay save failure, plus absence of a success audit for refused requests.
- `PATH=/opt/homebrew/bin:$PATH npm run build`: **passed**.
- `git diff --check`: **passed**.
- `utils/pdda/pdda.sh status-table`: 11 findings in unrelated unchanged docs; no GH-301 finding. Observe mode exits zero, so this is not a clean whole-repo PDDA result.
- No server actions, pilot mutations or production promotion.

## Remaining

Deferred links; MCP client shape; principal-aware bulk skill; external pilot sign-off. The pending-only create replay limit remains documented and unchanged.

## Lists reproduction and fix

- Extended the existing row create/update/delete contract test to assert a faithful readback does not warn, both with a source-message timestamp and with `OriginalMessageID` empty. Both cases failed before the fix with `Scheduled time: expected 1778778000000, got 0`.
- Root cause: the comparator expected a numeric scheduled timestamp absent by design from the current display-text schema; fix site: the parsed readback and comparator; why not the writer: it already writes the correct formatted `created_on` cell.
- Disproof of source-message hypothesis: both cases fail identically before the fix; mocked readback preserves the exact written fields. No live Slack response was captured, so no claim is made about all possible remote readback variations.
- The validator now passes the parsed display cell; the comparator uses the same `FormatTimestampForDisplay` as the writer. Missing and changed readbacks still warn. No attempt to infer year/timezone/seconds from the lossy display string.
- `PATH=/opt/homebrew/bin:$PATH node node_modules/jest/bin/jest.js --runInBand --forceExit tests/lists-module.test.js tests/slack-format-utils.test.js tests/web-api-reminders.test.js`: **188 passed**.
- `PATH=/opt/homebrew/bin:$PATH npm run build`: **passed**.
- Initial full `npm test`: 2986 passed, 23 failed in thread-memory/chat diagnostics; SQLite native binary was installed for Node 18 (ABI 108), but runtime was Node 26 (ABI 147). Rebuilding that local dependency under the chosen runtime; this is environment failure evidence, not a product regression result.

## Full verification after correcting local runtime

- Rebuilt only `better-sqlite3` under Node 26.13.0; rebuild succeeded. No lockfile change.
- Re-ran `npm test`: **3008 passed, 1 failed**, 146 suites passed and 1 failed. The sole failure is `thread-memory store > SaveThreadMemoryAsync stores the row but no embedding when no key/embedder` (`Embedded` expected false, received true), matching the outgoing handoff's known failure. It has not been independently reproduced on a fresh baseline by this agent. The full suite is **not green**.
- Because `npm test` stops before the Node tests when Jest fails, ran `npm run test:node` separately: **116 passed, 0 failed**.
- Self-review: no auth, reminder mutation, persistence, version, idempotency, or Slack API payload change. The new `scheduledDisplay` is only the parsed display cell used for comparison; exact timestamps remain authoritative in reminders. The audit branch returns the same payload before the success log, so it records exactly one denial and no misleading write.

## Independent baseline confirmation (2026-11-07)

- Fetched `origin/development`: `b2ef33da34d972976861b2512038cf6ff9cfed07`. Exported that exact commit with `git archive` into a fresh temporary directory, with no candidate source files. Reused the same installed dependencies/runtime via a node_modules symlink; tests used isolated temporary runtime data.
- Command in each tree: `node node_modules/jest/bin/jest.js --runInBand --forceExit tests/thread-memory.test.js -t 'SaveThreadMemoryAsync stores the row but no embedding'` (baseline invocation also explicitly sets its rootDir/config to the exported tree). Node 26.13.0.
- Baseline: **1 failed, 25 skipped**; `Embedded` expected false, received true at `tests/thread-memory.test.js:140`.
- Candidate `cfc3623`: **same failure and assertion**, 1 failed, 25 skipped. This independently confirms the known failure exists on the PR base, rather than relying on the outgoing handoff. It remains unfixed and out of scope.
- Review found no new mutation/auth/storage path; the three changes are bounded to client documentation, audit classification and roundtrip comparison.

- Review rerun (2026-11-07): focused Lists/formatting/Web API suites **188 passed**; build passed; diff whitespace check passed. PDDA status-table still reports the same 11 unrelated-document findings, with none in GH-301. No source changes since `cfc3623`; follow-up commit adds baseline evidence and current task direction only.
