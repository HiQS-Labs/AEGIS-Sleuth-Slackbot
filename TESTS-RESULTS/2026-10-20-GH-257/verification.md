# GH-257 verification receipt

Integration base: development `50fa08c0616af0a79a3431043f68e6ea8db5dd7f`.
Mac Studio, Node 22.22.3. All stream checks use synthetic GitHub/Slack services and temporary local state. No app startup, production access, deployment, monitoring/config mutation or live messages.

- Original focused baseline: 2 suites / 21 tests PASS.
- Extended existing suites against original source: 17 FAIL / 24 PASS (41 total), including both pagination directions, actual default-client five-page cap, missing parent/PR replay, channel and DND, dynamic-list invalidation, save failures, shutdown, cross-repo ordering and retained thread identity. Captured before implementation; full post-extension mutation receipt follows.
- Current focused suites: 2 / 43 PASS, including dense overlap hold and blocked-save shutdown. Main path RunOnceAsync and adjacent restart/DND/config/shutdown paths all use mocks.
- Build: PASS after checker caught and corrected the durable-write logger options/type shape.
- Existing FSM, workspace isolation, reminder render and changelog tone validators: PASS.
- Independent plan review: FAIL r1 (unseen-parent dependency), FAIL r2 (cross-repo ordering), PASS r3; all concrete findings dispositioned in plan and approved review receipt. Harness attested plan HEAD `7dea9c6268662dca2c3a461bbf89a315f6e103a8`. First run containment detected concurrent producer test edits, backed up/reverted them; restored and committed before re-review. Subsequent runs had clean containment. No harness edits or bypass.

Full disposable-clone qualification, final code QA, exact-head CI and final statuses are pending at this checkpoint. Do not read passing focused suites as evidence those later gates ran.

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
