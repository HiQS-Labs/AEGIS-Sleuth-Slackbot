# GH-257 verification receipt

Integration base: development `50fa08c0616af0a79a3431043f68e6ea8db5dd7f`.
Mac Studio, Node 22.22.3. All stream checks use synthetic GitHub/Slack services and temporary local state. No app startup, production access, deployment, monitoring/config mutation or live messages.

- Original focused baseline: 2 suites / 21 tests PASS.
- Extended existing suites against original source: 17 FAIL / 24 PASS (41 total), including both pagination directions, actual default-client five-page cap, missing parent/PR replay, channel and DND, dynamic-list invalidation, save failures, shutdown, cross-repo ordering and retained thread identity. Captured before implementation; full post-extension mutation receipt follows.
- Current focused suites: 2 / 43 PASS, including dense overlap hold and blocked-save shutdown. Main path RunOnceAsync and adjacent restart/DND/config/shutdown paths all use mocks.
- Build: PASS after checker caught and corrected the durable-write logger options/type shape.
- Existing FSM, workspace isolation, reminder render and changelog tone validators: PASS.
- Independent plan review: FAIL r1 (unseen-parent dependency), FAIL r2 (cross-repo ordering), PASS r3; all concrete findings dispositioned in plan and approved review receipt. Harness attested plan HEAD `7dea9c6268662dca2c3a461bbf89a315f6e103a8`. First run containment detected concurrent producer test edits, backed up/reverted them; restored and committed before re-review. Subsequent runs had clean containment. No harness edits or bypass.

- Independent final code QA: PASS, attested for `c19b227a9c0535f2a8afa78190a6125455e70a19`; no findings. Full report preserved in final-review-approved.md. Source and tests remain identical after this review; subsequent changes are documentation/receipts only.
- Disposable-clone mutation control: original source at exact base with candidate tests yields 20 FAIL / 23 PASS (43 total), exit 1 with the same `--forceExit` option used by npm test. An initial run finished assertions but needed its exact local Jest process terminated because a failed legacy assertion skipped timer cleanup; that terminated run is not the qualifying exit evidence. The repeat completed normally with assertion exit 1. Candidate source restored in finally; focused 43/43 PASS; git diff clean.
- PDDA observe-mode run exited 0 but reported 42 errors. Exact-base deterministic comparison measured 41 pre-existing errors (13 frontmatter, 9 status-table, 5 hardcoded paths, 14 legacy-roadmap coverage). The one new legacy-coverage mismatch is explicitly exempted in the plan because ROUTER documents the frozen Markdown checker; canonical DB registration/rating and generated dashboard remain. This is not a clean full-tree PDDA verdict.

## Final local qualification

Disposable full clone HEAD before/after: `c19b227a9c0535f2a8afa78190a6125455e70a19`; clean status after run. Production source/tests unchanged since independent final QA.

| Existing command | Result |
|---|---|
| npm test | PASS: Jest 145 suites / 2,807 tests passed; 1 suite / 4 tests skipped by existing setup. Node runner 116 passed, 0 failed. |
| npm run build | PASS |
| npm run validate:fsm | PASS |
| utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt | PASS: 773 tracked files, 32 rules, no findings |
| Focused original-source mutation | Expected FAIL: 20 failed / 23 passed, exit 1; candidate restored with clean diff |
| Focused candidate stream suites | PASS: 43 / 43 |
| Task-frontmatter/status/legacy-coverage checks after documented exemption | No new findings: 13/9/14 errors respectively, matching base; unchanged path errors 5. Full baseline remains 41 errors in observe mode. |

The full qualifying gate ran once after code approval. No tests, scanners or review failures were bypassed. Exact new-head hosted CI is pending publication; consult the PR checks for its current status.

## Review dispositions

| PR #256 inline thread | Disposition |
|---|---|
| r4332194038 unread changes | Fixed with incomplete-endpoint watermark, parent-dependency hold and cross-repo parent evaluation. Dense cap/overlap and unresolved capped dependencies safely hold/warn; separately authorized catch-up remains a limitation. |
| r4332194042 old issues/new threads | Fixed: retain thread identities AND dedup keys across age cleanup; repo cursor pruning retained. State grows with delivery history. |
| r4332194047 replies lose parent | Fixed: reply channel and timestamp both come from saved parent; new parents use configured destination. |
| r4332194050 removed repos | Fixed for dynamic discovery: successful empty/stale list revokes; fetch errors hold without cache authorization or pruning. Static-list reported production usage means no live incident inferred. |
| r4332194055 forgotten posts | Fixed surviving-process behavior: save failure stops delivery; flush pending state before more posts. Crash between Slack acceptance and durable save can still duplicate. |
| r4332194057 shutdown | Fixed: await active cycle/save; prevent new cycles/writes after stop starts. |
| r4332194065 single quotes | Confirmed; deferred to separate unpublished #252 takeover candidate 0bc0468. No code copied, title files unchanged. |
| r4332194070 mid-cycle DND | Fixed: immediately check workspace and actual destination channel before every write; retain cursor on undelivered actions. |
| r4332194075 mirror links | Current completed file exists. Canonical ledger regeneration corrected dashboard; changelog receipt path fixed. |

No old review thread is resolved by this follow-up. No exactly-once claim: acknowledged external-post/local-save window remains. An indefinite storage failure during shutdown is reported as a failed save, not a successful durable delivery guarantee.
