# Scoped link-edit verification

Base: `891f7412710de093fb34731f3fb33c29d3d49a57` (PR #307 merged after current-head CI success). Candidate branch: `feat/gh301-scoped-links-2026-11-07`.

## Contract and recon

[Recon map](../../docs/recon-gh301-links.md) records confirmed entry/state/consumer seams and unknowns. Shared bulk `set-links` replaces up to 20 strict canonical HTTPS GitHub issue/PR URLs. Principal exact repository grants default to none; target authorization runs before reservation/replay. [] removal is permitted with write scope and persists. Existing owning writer/version/save paths are reused. No live repo grants or GitHub/Slack API writes were performed.

## Observed checks

- Focused existing API, reminder integration, GitHub sync and relay suites: **304 passed** (4 suites), Node 26.13.0. Command: `node node_modules/jest/bin/jest.js --runInBand --forceExit tests/web-api-reminders.test.js tests/github-sync-module.test.js tests/github-comment-relay.test.js tests/reminders-integration.test.js`.
- Build: `npm run build` **passed**.
- Existing `validate:fsm`, `validate:workspace-isolation`, `validate:reminder-render`, `validate:reminder-pipeline`: **passed**.
- Separate `npm run test:node`: **116 passed**.
- Full `npm test`: **3028 passed, 1 failed**, same no-key thread-memory assertion independently reproduced on the prior base in followup-verification.md. It remains outside this change; full local suite is not green.

## Falsification and experiment ledger

1. Initial focused run exposed two fixture defects: new mocked writer was installed in the legacy fixture rather than principal fixture; clear race expected null although startup backfill had normalized to []. Corrected fixtures, not production behavior. This observation confirms that explicit [] is the loaded clear representation.
2. New regressions cover whole-batch invalid URL refusal; default grant denial; canonicalization/deduplication; writer-produced versions; cached replay; grant removal before replay; explicit clear; invalid repo configuration; durable clear across restart; post-ledger-await version conflict.
3. To falsify consumer guards, temporarily restored only original sync/relay source from base, ran the new focused race tests, then restored candidate source in a finally block. **Five tests failed:** AI-time replacement, identity-time clear, removal after first dispatch, stop during dispatched post, and stale sync completion. These are observed red controls, not planned assertions.
4. Candidate sources restored: focused **304 passed**. Existing sibling/relay/FSM coverage remains passing; explicit sibling test confirms clearing one does not stop another originally eligible reminder with the same link.

Root cause addressed: async consumers acted on mutable/stale link snapshots; fix sites: pre-AI snapshots/final live dispatch checks and version-checked completion gateway. Authorization is checked at the request boundary, and the writer is the single persistence owner. Already-dispatched public posts remain irreversible.

## Limits and rollback

No live deployment smoke, no production repository grants installed, and no actual public GitHub comments. Link edits preserve thread-stop flags and creation-time identity. New links become candidates for future messages, never old relevance decisions. Stored arrays/[] are compatible with rollback base; reverting removes the action while preserving readable data. MCP remains deferred; create retry retention is unchanged.

## PR #308 review corrections (2026-11-07)

- Verified four inline findings against source and coding conventions. Two safety findings reproduced with new regressions on head `4a85035`: a stopped reminder hidden by [] allowed a sibling to relay after link rotation; an unchanged retry resolved while both its first save and retry save should fail. Both tests failed before the fixes (the retry explicitly resolved instead of rejecting).
- Separate all pending thread members from linked targets. Stop checks and state propagation now include members with empty links; AI/URL target selection still uses linked reminders. Stops remain thread-wide and cannot be hidden by link edits.
- Before acknowledging unchanged links, await the existing serialized save. A repeated save failure still rejects; after recovery, [] is persisted before success. No rollback overwrites a concurrent edit.
- Renamed new callbacks with Arg prefixes and moved return descriptions into main JSDoc comments as required by docs/coding-conventions.md.
- Corrected candidate: **306 focused tests pass**, build and FSM/isolation/render/pipeline guards pass. Full Jest: **3030 pass, 1 same baseline-known thread-memory failure**. No live writes/deployment.
