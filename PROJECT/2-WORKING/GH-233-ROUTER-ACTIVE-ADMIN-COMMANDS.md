---
title: "GH-233: active-mode router takeover must honor the catalog's CanExecuteWithIfl flag"
status: Working (2-WORKING)
created: 2026-10-10
updated: 2026-10-10
owner: noel
branch: fix/gh-233-router-active-deny-list
doc_type: bugfix
gh_issue: 233
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/233
complexity: 2
risk: 2
effort: 1
phases: 1
ratings_provisional: false
non_goals:
  - No change to the confidence floor, the off/shadow/active modes, the router prompt, or literal command routing
  - No new deny-list or allow-list; the existing catalog flag is the policy
  - Routes outside ChatModule's router and model-switching phrasing are untouched (they stay governed by their own CanExecuteWithIfl value)
related:
  - "#222 (acceptance record where the misroute was observed)"
  - "GH-397 (router shadow/active), GH-174 (incumbent literal match defers the model)"
goal: >
  In active mode, a model-resolved command may execute only when its catalog entry has CanExecuteWithIfl true,
  the same contract `rmm ifl` already honors. Admin-gated commands such as show-rebalance-reminders, restart,
  router-mode, code-task and run-daily-digest run only from a literal command.
---

# GH-233 — active-mode router must honor CanExecuteWithIfl

## Status

| What was just completed | What's next |
|---|---|
| Plan Approved (Codex round 2); red control recorded; fix, docs and CHANGELOG 1.4.342 committed; full `npm test` + build green. | Final Codex QA, PR against `development` (no merge in this task). |

## Observed problem (2026-10-10, dev, base 3fd5455)

- Live: in a thread with an uploaded file, "what is the marker in the uploaded file now?" was answered "sorry, only workspace admins or owners can dump the rebalance reminders export." The journal stack ran `#TryRouterActiveTakeoverAsync` (`src/chat-module.js:1003`) then `CommandRouter.RouteAsync` then `HandleShowRebalanceRemindersCommandAsync`. Dev runs `ROUTER_SHADOW_DEFAULT_MODE=active`. The literal route `/^show-rebalance-reminders\b/i` (`src/chat-module.js:505`) cannot match the text and the catalog has no alias for it, so the Flash-Lite router resolved it.
- Cause: `RouterShadowModule.ShouldExecute` (`src/router-shadow-module.js:239-247`) checks only no error, no clarification, a canonical command, and confidence >= the floor (default 0.7). It never consults the catalog. The only protection that held was the handler's own admin check, which refuses non-admins but would run for an admin.
- Existing contract not applied: each catalog entry has `CanExecuteWithIfl` (`data/static/ai/command-catalog.json`, `src/command-catalog.js:13`). `rmm ifl` honors it (`src/chat-commands/rmm-command.js:86-93`, `src/chat-module.js:1192`). It is `false` for `show-rebalance-reminders`, `show-rebalance-reminders-formatted`, `restart`, `router-mode`, `code-task`, `run-daily-digest`, `process-reminders-now`, `github-sync-now`, `send-to-github`, `ask-woo` and others, and `true` for 26 entries (help, commands, run-diagnostics, models, model-switch-*, set/clear-channel-model, dnd, rmm, ask-code, and others).
- Every Resolution that carries a `CanonicalCommand` also carries a non-null `CatalogEntry` (`src/command-intent-resolver.js:676-741`), so the flag is available at the takeover decision.
- Recurrence: one distinct incident (this one). A title/body search of issues created since 2026-09-12 for "router" returns only #233; the same-class trend beyond that is unknown. The router has only recently been armed on dev.

## Deviation from the issue's Scope (accepted)

The issue proposed a hand-maintained deny-list (`restart`, `show-rebalance-reminders`, `show-rebalance-reminders-formatted`, `router-mode`, `code-task`). Recon found the catalog already encodes this per entry, so the plan reuses `CanExecuteWithIfl` instead of adding a second list that would drift. It covers every command the issue named and the other `false` entries. It leaves model switching and `commands`/`run-diagnostics` takeover as they are today (their flag is `true`). Acceptance wording below says "CanExecuteWithIfl false" where the issue said "deny-listed".

## Policy note and user impact

- This **supersedes the 2026-07-16 operator decision** recorded in `src/router-shadow-module.js:11-14` and `src/chat-module.js:953-955` ("FULL takeover — any canonical command, incl. Risk-tagged ones") and the matching promise in `ARCHITECTURE.md:302-304`. It is made at the maintainer's explicit request on 2026-10-10 after the live misroute in #233, and the PR must say so.
- Impact is not admin-only: every catalog entry with `CanExecuteWithIfl` false loses model takeover in active mode, including public ones such as `show-me`, `show-stats`, `ping`, `show-reminders` and `search-reminders`. Those still run from their literal route or deterministic alias (for example `show-me` has aliases in the catalog); they no longer run from a free-text sentence resolved by Flash Lite. Permissions still belong to each handler; incumbent literal and regex-alias matches still win (GH-174).

## Plan (one phase, ordered)

1. `src/router-shadow-module.js`: add `canExecuteWithIfl` (boolean|null) to the `RouterShadowCandidate` typedef and to `ResolveCandidateAsync`'s result, read as `Resolution.CatalogEntry.CanExecuteWithIfl === true` (null when there is no entry); error candidates get null. `ShouldExecute` additionally requires `ArgCandidate.canExecuteWithIfl === true` (fail closed). Update its doc comment.
2. `src/chat-module.js` (`#TryRouterActiveTakeoverAsync`, one line): when there is no incumbent route, the candidate is otherwise executable (confidence >= floor, no error, no clarification) but `canExecuteWithIfl !== true`, log once at info: `router active takeover skipped: '<intentId>' needs a literal command (CanExecuteWithIfl false)`. The corpus record is unchanged and already carries `executed: false` and the candidate (now with the flag).
2b. Correct the promises that become false: the `active` bullet in the `src/router-shadow-module.js` header (lines 11-14), the `ShouldExecute` doc comment, the `src/chat-module.js` comment at 953-955, and one short paragraph in `ARCHITECTURE.md` at ~302-304: takeover requires the catalog flag; false or unknown declines to the incumbent pipeline; permissions stay in the handlers; literal and regex-alias matches still win. No catalog edit, no generated help refresh, no new doc.
3. `tests/router-shadow.test.js` (existing file): in the `ShouldExecute` test add `canExecuteWithIfl: true` to the base candidate and assert: true at exactly the floor (0.7), false for flag `false`, `null` and missing even at confidence 1.0; keep the floor/null-command/clarification/error assertions. In the `ROUTER_ACTIVE_CONFIDENCE_MIN` test add `canExecuteWithIfl: true` to the candidate and assert true at 0.95 and false at 0.9 with the floor at 0.95, so removing the confidence comparison fails.
4. `tests/chat-module.integration.test.js` (existing `router-mode (GH-397)` describe and `ArmModeAsync`): one new test with the real resolver and the real catalog, the AI JSON mocked in the same snake_case shape as the existing positive test. Active mode, a non-admin `U_REGULAR` (not the arming admin), no files attached: the ordinary sentence ("what is the marker in the uploaded file now?") resolved to `show-rebalance-reminders` at 0.98 must NOT produce the "only workspace admins or owners can dump the rebalance reminders export" message, the admin check must not have been called for that mention (spy on `IsAdminOrOwnerAsync` after arming and clear it), the skip log appears exactly once, and the corpus record has `executed: false` with `candidate.canExecuteWithIfl === false`. In the same test a literal `show-rebalance-reminders` mention from the same user must still produce the real refusal (proving the route is reachable and only the model path is closed). The existing `commands` takeover test (flag true) and the GH-174 literal test stay green as controls.
5. `CHANGELOG.md`: two-paragraph entry (next patch above the top entry) stating the policy change and that public commands with a false flag also lose free-text takeover; no `package.json` bump.

## Alternatives rejected

- A hand-written deny-list (the issue's first idea): a second source of truth that drifts from the catalog and `rmm ifl`.
- Gate on catalog `Permission === 'admin'`: it would also block `models`, `set-channel-model` and `model-switch-*`, which the catalog marks executable by a model today, and it would be a policy change rather than a bug fix.
- Allow-list of safe commands: silently disables takeover for anything not listed.
- Fixing it in the resolver: the router and `rmm ifl` both rely on the resolver returning its best reading; the execute decision is the right place.

## Verification and red control

- Debugging protocol: `/debug-mantra` governs execution (reproduce, trace the fail path, falsify, cross-reference) if any check behaves unexpectedly.
- Red control (required): write steps 3-4 first and run `npx jest tests/router-shadow.test.js tests/chat-module.integration.test.js` against the UNFIXED source. The new integration test must fail with the "only workspace admins or owners can dump the rebalance reminders export" message present (the observed symptom), and the new `ShouldExecute` assertions must fail. Record both failures, then apply steps 1-2 and see them pass. If the integration test cannot be made to fail on the unfixed code, the test is vacuous and is reworked before the fix.
- Focused: the same two suites after the fix; then full `npm test` and `npm run build` once each on the final commit, un-sandboxed, exit codes recorded.
- Live (post-merge, the maintainer runs `/merge-cleanup`): an agent-driven check on dev that a literal admin command still works and that the rebalance misroute no longer happens is not reproducible on demand (trigger unknown); the evidence is the unit and integration tests plus the skip log line.

## Blast radius and rollback

Two source files (plus comment corrections in them), `ARCHITECTURE.md` (one paragraph), two existing test files, one changelog entry. Effect: in active mode, model-resolved commands whose catalog flag is `false` (or unknown) fall through to the normal pipeline (generic chat) instead of executing; users run those with the literal command, exactly as when the router is off or in shadow mode. Production behavior is unchanged where the router is off. Rollback: revert the commit; no migration, no data change.

## Task rating (2026-10-10)

Rated 65/55/50/85 (priority/severity/appeal/effort-cheapness). Severity 55: a model misread can run an admin-gated command (a data dump or, for the other `false` entries, a state change) for an admin, but the handler's admin check bounds it, it needs a coincident model misread, and no data loss or crash has been observed. Priority 65: the maintainer asked for it as a hotfix. Appeal 50 neutral. Effort 85: one flag read, one log line, two small test edits. Recurrence: one incident, trend unknown (see above).

## Acceptance

- [ ] Jest (existing `tests/router-shadow.test.js` and the existing `router-mode (GH-397)` integration describe): in `active` mode a candidate whose catalog entry has `CanExecuteWithIfl` false (or unknown) is not executed and no handler runs, even at confidence 1.0; a candidate with the flag true at the floor still executes; a literal `show-rebalance-reminders` mention still runs.
- [ ] The skip is logged once and the corpus record shows `executed: false`.
- [ ] The documented takeover promises (`ARCHITECTURE.md`, the two code comments) match the new behavior.
- [ ] The new integration test fails on the unfixed source (red control recorded) and passes after the fix.
- [ ] Full `npm test` and `npm run build` pass.
- [ ] CHANGELOG entry in the usual two-paragraph format.

## Progress log
- 2026-10-10: #233 filed; /express refused (no `validate.sh` TESTS registry or `githooks/install.sh` in this repo), so the normal start-task lane; clone off origin/development 3fd5455; captured, rated and promoted; plan drafted. Plan QA pending.
- 2026-10-10: Codex plan QA round 1 FAIL (S1 docs/promises and public-command impact, S2 acceptance-to-assertion mapping and tuned-floor fixture; Nit file count and debug-mantra) all accepted and folded in; the 2026-07-16 operator decision is now recorded as superseded. Round 2 pending.
- 2026-10-10: Codex plan QA round 2 Approved.
- 2026-10-10: Red control at commit 1e7ec40, rebased to ded6095 (tests only, source unfixed): `npx jest tests/router-shadow.test.js tests/chat-module.integration.test.js` failed — the three new `ShouldExecute`/flag assertions in `tests/router-shadow.test.js`, and the new integration test, which received "only workspace admins or owners can dump the rebalance reminders export" (the live symptom). After steps 1-2: both suites pass, 108 tests.
- 2026-10-11: CHANGELOG 1.4.342 written; `node scripts/validate-changelog-tone.js` clean. Catalog count re-checked: 36 entries false, 26 true; 22 of the false entries are non-admin (incl. `show-me`, `show-stats`, `show-reminders`, `search-reminders`, `ping`), named in the entry.
- 2026-10-11: Rebased onto origin/development 7cf93f0; ledger dump conflict resolved by union of `releases.sql` then `releases check --rebuild` (generation 70 -> 71, `merge-rebuild` receipt, GH-233 row and 65/55/50/85 rating intact), preview regenerated. Gates on the rebased fix commit, un-sandboxed: `npm test` exit 0 (Jest 142 suites passed, 1 skipped; 2614 tests passed, 4 skipped; `node --test` 116 passed); `npm run build` exit 0. Final Codex QA next.
- 2026-10-11: Final Codex QA (relay-system/2026-10-11/gh233-final-qa.md, task RELAY-GH233-FINAL-R1, reviewed head 7e56690) round 1 PASS, Approved, no [Blocker]/[Should]. Its one note (red-control hash differs between plan and Setup: 1e7ec40 was rewritten to ded6095 by the rebase) fixed in the CHANGELOG and this log, text-only. Next: push and PR; no merge in this task.
