# Recon Map — GH-301 scoped link editing

Base: `891f741`. Mode: graph + confirmed source reads. Lanes A/B/C read-only agents; lane D in parent. No live GitHub writes or server probes.

## Subject and change class

Extend the existing reminder bulk route with replacement of GitHub links. Cross-module authorization and state-consumer change; reuse existing writers, save chain and version tokens.

## Seams

| Seam | Location at base | Contract / failure |
|---|---|---|
| Principal grants | src/web-api-principals.js:53–63,108–123 | No repo grants exist; malformed grant config must fail closed. Re-read each request. |
| Auth request | src/web-api.js:261–285 | Preserve workspace/read-write checks; copy validated repo grants. |
| Prepare/reserve/apply | src/web-api.js:1192–1231,1269–1317,1383–1411 | Validate all fields and repo grants before reservation, including replays. Existing serial apply and versions. |
| Writer precedent | src/reminders-module.js:1201–1241 | Ledger gap before await, re-find/version recheck, mutation/OnVersion then serialized durable save. |
| Projection | src/reminders-projection.js:326–327 | Empty projected links can be hydrated from creation; links edits must mark coverage gapped. |
| Startup | src/reminders-module.js:4045–4049 | Explicit [] survives; null/non-array re-extracts links from original text. |
| Sync consumer | src/github-sync-module.js:247–294,395–406 | Snapshot fetched across awaits can complete a reminder after links change. Existing completion writer accepts ExpectedVersion; require literal true before notices. |
| Relay consumer | src/github-comment-relay.js:150–156,283–306,334–390,473–504 | AI reads mutable URLs; late target collection can redirect old decisions. Snapshot before AI; check current pending identity/URL and current thread stop immediately before dispatch. |
| Thread flags | src/github-comment-relay.js:173–198,411–426 | Stop is thread-wide; link edits must not set it. Started event must preserve concurrent stop after awaits. |
| URL parsing | src/github-url-utils.js:12–36; src/github-sync-module.js:548–565 | Existing extraction/parsing is not strict full-input authorization. Add bounded exact canonical HTTPS validation beside shared URL helpers. |
| Persistence | src/reminders-module.js:4158–4188 | Existing save chain snapshots and crash-atomic writes; failures reject, later saves recover. |

## Call paths and state

HTTP auth → prepare/authorize whole batch → idempotency reservation → version precheck → shared serial apply → owning RemindersModule setter → ledger gap → post-await version check → replace GitHubUrls with array → capture version → durable save. No direct State write, new storage, or module singleton.

GetAllReminders returns live object references (reminders-module.js:984–990,4700–4715). Links affect sync, relay, grouping/search/ranking and URL-derived matching. Sender/owner indexes and creation-time project/client identity stamps are unchanged. No dedicated Slack List link column exists; no new list/chat fanout is introduced by the setter.

## Downstream and recovery

- Nonempty current arrays enter the next existing sync poll; [] is excluded. Capture the version before remote status fetch; conflict leaves pending state for next cycle. Strict true completion gates counts and notices.
- Relay future messages can score newly attached links. An already-running message only targets links originally scored and still present on an originally eligible live reminder; an eligible sibling can still authorize a shared URL. Final check has no await before fetch. Already-dispatched comments cannot be retracted.
- Preserve current thread stop state on the started ledger event after save/reaction awaits. Link edits never change thread stop flags.
- Arrays/[] already supported by rollback base; new optional principal repo grants do not affect old action paths. Last safe rollback point: before enabling set-links use. Reverting removes the edit action while retaining stored arrays.

## Existing verification

Extend web-api-reminders tests for allowlist/version/replay; reminders-integration for persisted [] and post-gap race; github-sync for held status-fetch edits and strict-success notification gate; github-comment-relay for AI/dispatch races, sibling behavior and stop state. Tests/runtime-setup.js gives each Jest process isolated runtime data. CI runs Node22 build, tests, FSM and pipeline guards. Local runtime uses Node26; a known thread-memory assertion fails independently on base.

## Unknowns and boundaries

Concrete production repository grants are operator config, not inferred from display/client repo patterns. No grants will be installed by this code change. Presentation consumers were bounded to existing live reads; no historical reminder rewrite. No external consumer or live-provider response has been exhaustively audited. No guarantee against already-dispatched GitHub writes is possible.
