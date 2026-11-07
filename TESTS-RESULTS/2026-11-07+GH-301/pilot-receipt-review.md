# GH-301 external-bot HTTPS pilot receipt review

Reviewed 2026-11-07. Source: two operator-provided private receipt sets, examined as one continued pilot, not two independent complete runs. No live writes or test replay were performed for this review.

The review compared request actions, response envelopes, per-item results, readbacks and baseline/final snapshots. It did not rely only on the bot's summary. A private manifest records the source file paths and SHA-256 hashes. No endpoint, principal, channel/user/reminder IDs, credentials, raw text or private file paths are copied here.

| Check | Result |
|---|---|
| read versions | PASS |
| create readback | PASS |
| create replay same response | PASS |
| create replay single row | PASS |
| retitle readback | PASS |
| retitle version changed | PASS |
| stale refused without mutation | PASS |
| reschedule readback | PASS |
| complete result | PASS |
| complete replay same response | PASS |
| cancel result | PASS |
| cleanup test ids absent | PASS |
| preexisting reminders unchanged | PASS |
| writes only own test ids | PASS |

**Outcome:** the exercised development HTTPS API pilot passed. Create and completion replays returned identical payloads; one pending reminder existed after create replay. The stale-version request was refused and its readback matched the preceding successful edit. Both pilot reminders were absent from final active reminders, and every pre-existing record/version was exactly unchanged. All mutation IDs belonged to the two newly created test reminders.

**Limits:** this is receipt verification, not a new end-to-end run. It does not prove delivery of PR #307, the absence of every Slack side effect, revoke/expiry behavior in these particular runs, repository-link edits, MCP functionality or production readiness. Raw receipts remain private. MCP is deferred by operator decision; see the canonical project document for active work.
