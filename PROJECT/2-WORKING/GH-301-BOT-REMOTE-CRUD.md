---
gh_issue: 301
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/301
title: "Secure remote reminder CRUD for external bots (HTTPS + MCP, no SSH)"
status: Active (2-WORKING)
created: 2026-11-06
updated: 2026-11-06
owner: noel
goal: "An external bot holding only a revocable, workspace-scoped credential can read reminders and complete or cancel them through the existing Web API, with no SSH, Slack token or filesystem access."
doc_type: feature
branch: feat/AEGIS-Sleuth-Slackbot-gh301-bot-remote-crud-2026-11-06
related: "GH-279 (#280, bulk close), GH-290 (#302, edit actions), GH-215 (Product Compass credentials)"
non_goals:
  - "Phase 2 (create/patch through principals, If-Match versions), Phase 3 (MCP adapter), Phase 4 (pilot)"
  - "TLS termination in front of :2020 (deploy work; Phase 1 refuses principals on plain HTTP instead)"
  - "Replacing the legacy operator bearer or the admin session"
---

# GH-301 · Phase 0–1: bot principals on the Web API

## Status

| What was just completed | What's next |
|---|---|
| Phase 0–1 shipped in #305. Phase 2 plan approved by Codex (round 2) and implemented on the phase2 branch (2026-11-06). | Phase 2 smoke, final QA and PR. Link editing follow-up; Phase 3 (MCP); Phase 4 pilot running on dev. |

## Problem

The only Web API credential is one shared `WEB_API_BEARER_TOKEN` (`src/web-api.js:#AuthorizationMiddleware`).
It opens every non-admin route, including workspace create/delete and every workspace's reminders. An external
bot (Cursor/Grok) cannot be given that token safely, so today it has no safe remote write path. The issue asks
for a revocable, workspace-scoped, read/write-scoped principal, reached over HTTPS, using the same writers.

## Recon (base `65210c1`)

| Seam | Finding |
|---|---|
| Auth | `#AuthorizationMiddleware` (`src/web-api.js` ~L180): `/admin/*` → admin session, everything else → exact match of `Bearer <WEB_API_BEARER_TOKEN>`. Failure is `200 {success:false, data:'Forbidden.'}`. The token comes from `GetWebApiBearerToken` (`src/app.js` ~L95). |
| Read route | `GET /workspace/:name/reminders` → `#HandleGetWorkspaceRemindersAsync` (~L966). Query `format`, `activeOnly`, `state`; projection fallback. No pagination. |
| Write route | `POST /workspace/:name/reminders/bulk` (GH-279/GH-290) → `#PrepareBulkReminderAction` (validate all) → serial `#ApplyBulkReminderActionAsync` → `CompleteReminderByIdAsync` / `CancelReminderFromListAsync` / … Cap 100. |
| Credential prior art | `src/product-compass.js` `ReadCredentialAsync`: per-request read from systemd `CREDENTIALS_DIRECTORY` or macOS Keychain, fail-closed; workspace JSON holds only credential *names*. Adding a credential needs a unit edit and restart; revocation is "on the next request". |
| Data dir | `workspaces.GetRuntimeDirPath()` (`SLEUTH_DATA_DIR`), included whole in the nightly backup (GH-272). |
| Logging | `WebAPI` logs to `console` (journald on servers). |
| Exposure | At planning time neither environment had an HTTPS front end for the Web API; deployment details are kept in private ops notes (not in this public repo). |

## Plan

**Outcome sought:** a bot credential that can only read and close reminders in its own workspace(s), can be
revoked instantly without a deploy, and never travels over plain HTTP to a remote host.
**Smallest viable bet:** one small module that authenticates `Bearer slp_…` tokens against a principals file,
a middleware branch that admits a principal to exactly two routes, and a Phase-1 action allowlist
(`complete`, `cancel`) on the existing bulk route.
**Not built (this PR):** create/patch for principals and If-Match versions (Phase 2), MCP tools (Phase 3), the
pilot (Phase 4), TLS termination (deploy), pagination beyond a simple `limit`/`offset`.
**Alternatives rejected:**
- *A second token in an env var:* not per-workspace, not revocable without a restart.
- *Secrets in systemd-creds/Keychain, as Product Compass does:* Product Compass reads its token per request,
  and revokes at the issuer (Product Compass itself). Here Sleuth *is* the issuer and verifier, and each bot
  needs editable grants (workspaces, scopes, expiry, revoked) beside its secret. Adding a bot through
  `LoadCredentialEncrypted` would also need a unit edit and restart. So a hashed verifier file with its
  grants fits this case better, without a second secret store.
- *A new `/v1` router:* a second request path beside the existing routes. Additive checks on the two existing
  routes are enough.

**Rollback:** the feature flag `WEB_API_BOT_PRINCIPALS` is off by default. Off means principal tokens are
refused exactly as today (`Forbidden.`). Or revert the PR. Nothing in the stored reminder format changes.

### 1. Principals file and module: `src/web-api-principals.js` (new, small)

- File: `<data dir>/web-api-principals.json` (mode 600). It lives in the data dir, so the nightly backup
  includes it. An array of principal records:
  `{ "id": "cursor-grok", "sha256": "<hex of sha256(token)>", "workspaces": ["neochrome"], "scopes": ["reminders:read","reminders:write"], "expiresAt": "2027-01-01T00:00:00Z", "revoked": false }`.
  `expiresAt` and `revoked` are optional.
- **Only a hash is stored.** The token is `slp_<id>_<secret>`:
  - `id` matches `^[a-z0-9-]{1,32}$`, so it contains no underscore;
  - `secret` is 43 base64url chars (32 random bytes);
  - the whole token must match `^slp_([a-z0-9-]{1,32})_([A-Za-z0-9_-]{43})$`, so it parses unambiguously.
  
  The SHA-256 of the whole token is safe at rest because the token is high-entropy, not a password. The bot
  keeps the token in its own secret storage.
- **Entry validation (fail closed).** On each read the whole file is validated. Any invalid entry makes that
  entry unusable, and an unparseable file means no principals, plus one WARN log per read naming the entry's
  array **index** and the failed rule, never its unvalidated `id` and never a secret. Rules:
  - ids are unique and match the grammar;
  - `sha256` is exactly 64 lowercase hex characters, and is decoded only after that check;
  - `workspaces` is a non-empty array of names;
  - `scopes` is a non-empty subset of `reminders:read` and `reminders:write`;
  - `expiresAt`, if present, parses as a date;
  - `revoked`, if present, is a boolean.
  
  The digest comparison checks both lengths are 32 bytes before `timingSafeEqual`, and any exception means
  "deny".
- `AuthenticatePrincipalAsync(token)` re-reads the file on **every** request; it is small. That makes edits
  take effect at once: set `revoked: true`, remove the entry, or let it expire. Steps:
  1. Parse `id` from the token and find the entry.
  2. Compare with `crypto.timingSafeEqual` on the two SHA-256 digests.
  3. Reject `revoked`, a past `expiresAt`, and malformed entries.
  
  It returns `{ ok: true, principal }` or `{ ok: false, code }`. Codes: `unknown`, `revoked`, `expired`,
  `invalid`, `unavailable` (missing or unreadable file).
- Failures fail closed. A missing file means no principals.
- A tiny CLI, `scripts/web-api-principal.js new <id> --workspace W --scopes read,write [--expires ISO]`,
  prints the token once and the JSON entry to paste. It writes nothing itself, so the operator stays the
  only writer of the file.

### 2. Middleware branch: `src/web-api.js` `#AuthorizationMiddleware`

The legacy bearer is checked first, so operator tools are unchanged. A `Bearer slp_…` token is checked only
when `process.env.WEB_API_BOT_PRINCIPALS === '1'`. The checks:

- **Transport:** a principal is admitted only if the socket itself is TLS (`req.socket.encrypted`) or the TCP
  peer is loopback. Loopback means `req.socket.remoteAddress` exactly matches `127.0.0.1`, any other
  `127.x.y.z`, `::1`, or `::ffff:127.x.y.z`, checked with `net.isIP` plus an exact pattern, not a string
  prefix.
  - `trust proxy` stays **off**, and `X-Forwarded-*` headers are never read for this decision. A remote
    spoofed `X-Forwarded-Proto: https` therefore changes nothing.
  - Anything else gets code `insecure-transport` before the token is looked up.
  - A loopback peer does not prove the hop before it was HTTPS. The docs state the reverse proxy's obligation
    to accept only HTTPS, and say bot configs must use `https://` URLs, because a server refusal cannot
    un-send a cleartext token.
- **Route allowlist, strict canonical paths:** Express matches routes case-insensitively and with optional
  trailing slashes, so the middleware does its own exact match against the raw `req.path`:
  - `GET  ^/workspace/([A-Za-z0-9_-]{1,64})/reminders$` needs `reminders:read`;
  - `POST ^/workspace/([A-Za-z0-9_-]{1,64})/reminders/bulk$` needs `reminders:write`.
  
  The method must match exactly; **HEAD is refused** for principals. Case variants, trailing slashes,
  percent-encoding (`%2F`, `%2E`) and every other route get code `forbidden`. That covers `/workspaces`,
  workspace create/delete, stats, settings and `/admin/*`.
- **Workspace:** the captured name must be in `principal.workspaces`, otherwise `forbidden-workspace`. This is
  cross-workspace denial. The middleware stores the captured name as `ArgReq.Principal.Workspace`. Both
  handlers refuse (`forbidden-workspace`) unless `ArgReq.params.name === ArgReq.Principal.Workspace`, so the
  workspace checked is exactly the workspace used.
- The principal is attached to the request (`ArgReq.Principal = { Id, Scopes, Workspace }`) for the handlers.
- **Denial audit:** each refused principal request logs one JSON line:
  `[web-api] principal-denied {"code":…,"id":…|null,"method":…,"route":"reminders"|"bulk"|"other"}`.
  It never contains the token or the raw path.
- Failure keeps the existing envelope and adds a stable `code`: `200 {success:false, data:'Forbidden.', code}`.
  Legacy responses are unchanged.

### 3. Handlers (existing, small additive checks)

- **Bulk:** when `ArgReq.Principal` is set, `#PrepareBulkReminderAction` adds three rules. Any violation refuses
  the whole batch, as today:
  - only `complete`/`cancel` are allowed (Phase 1);
  - **unknown fields are rejected:** the request body may hold only `actions`, and each action only `action`,
    `reminderId` and `reason`. `reason` is accepted for compatibility but ignored. Any other key, anywhere in
    the batch, refuses the whole batch with code `unknown-field` before any write (issue requirement 6);
  - `reminderId` must match the reminder-ID format `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
  - a client `reason` is ignored. The server supplies `api-bot:<principal id>:<action>` instead, and the id
    grammar makes that safe for the writers' existing log lines (`src/reminders-module.js` complete/cancel logs).
  
  Legacy bearer requests keep today's behaviour.
- **Idempotency, reserved before any write:** a principal's write must send `Idempotency-Key` matching
  `^[A-Za-z0-9._:-]{1,128}$`, else code `idempotency-key-required`. Mechanics:
  - One `Map`, keyed by `JSON.stringify([principalId, workspace, key])`. Each entry holds
    `{ Fingerprint, Promise, DoneAt }`, where `Fingerprint` is the sha256 of `JSON.stringify(req.body)`.
  - The entry is created **synchronously**, before the handler's first `await`. A concurrent request with the
    same key and the same fingerprint awaits the same promise and returns the identical response.
  - A different fingerprint gets `idempotency-key-reused` at once, even while the first request is running.
  - If the work throws, the entry is deleted, so a retry can run. A completed response that holds per-item
    `error` results is still cached as the response.
  - Completed entries expire after 24 h. A 1000-entry cap evicts the oldest *completed* entries only; an
    in-flight entry is never evicted. When the cap bites, replay retention is shorter than 24 h, and the docs
    say so.
  - A replay is served only after the middleware has re-authenticated the principal and re-checked scope and
    workspace on that request, so revoking a principal also stops replays.
  - After a restart the map is empty. A replayed complete then reports `not-found`, which is still no
    double-complete, because complete/cancel are already idempotent in the writers. This argument is not
    carried forward to Phase-2 `create`.
- **Audit:** one structured line per principal write outcome:
  `[web-api] principal-write {"id":…,"workspace":…,"keySha256":"<first 16 hex>","replayed":bool,"actions":{"complete":n,"cancel":n},"ids":["<each full validated UUID>"],"counts":{…}}`.
  It is produced with `JSON.stringify`, so no field can inject a line. It never contains the token, the raw
  key, the reason or reminder text.
- **Read:** for a principal, the GET also accepts `limit` (1–500) and `offset` (≥0) on the reminder list. They
  apply *after* `activeOnly`/`state` filtering. Bounds outside those ranges are a validation error. With
  `format=raw` (or no format) the response stays an array, and `total` is sent in an `X-Total-Count` header.
  With `format=rebalance` paging is refused (`pagination-unsupported`), because that export is one document. A
  legacy GET is unchanged.

### 4. Docs

`docs/web-api.md`: a new "Bot principals (GH-301)" section covering:
- the flag;
- the file format and how to create, revoke and expire a principal (CLI);
- the transport rule (TLS proxy or loopback), the route and scope table, and the error codes;
- idempotency behaviour, and that reminder text is untrusted input for any agent.

Also the CHANGELOG Unreleased entry.

### Tests (extend existing files only; commensurate)

Add to `tests/web-api-reminders.test.js`, which starts a real `WebAPI`. The principals file goes in the test data dir.
- Flag off: an `slp_` token gets `Forbidden.` (red control: drop the flag check → passes auth).
- Valid principal: GET own workspace succeeds; POST complete succeeds and calls the writer once.
- Cross-workspace: a principal for A gets `forbidden-workspace` on B's GET and POST, and no writer is called.
- Expired, revoked, unknown id and wrong secret are all denied. Revoking takes effect on the next request with
  no restart: edit the file between two calls.
- Scope: a read-only principal POSTing gets `forbidden`; a principal on `/workspaces` or `DELETE /workspace/:name`
  gets `forbidden`.
- Phase-1 allowlist: a mixed batch `[complete r1, retitle r2]` is refused whole, and **no** writer is called.
- Idempotency: the same key and body twice gives one writer call and an identical response.
  - **Overlap test:** hold the writer pending, send a second same-key same-body request, release, then assert
    one writer call and identical responses. A changed body sent during the overlap gets
    `idempotency-key-reused` with no extra writer call.
  - A missing key is refused, and a revoked principal's replay is denied.
  - Red control: remove the synchronous reservation, and the overlap test goes red.
- Logging, as separate cases:
  - **(a) Successful write:** a valid UUID and a valid key, with a `reason` holding a newline and a
    secret-looking string. The writer receives the server reason. Captured `console` output holds exactly one
    parseable `principal-write` JSON line, with no raw reason or key and no token.
  - **(b) Refused id:** a non-UUID id like `x\nFAKE=1` is refused whole, and no writer is called.
  - **(c) Key shape:** a key like `audit result=completed` (a space) is refused as `idempotency-key-required`.
    A valid key never appears raw in the logs.
- Unknown fields: a two-action batch whose second action carries `hardDelete: true` is refused whole with
  `unknown-field`, and no writer is called. Red control: drop the field check and the assertion goes red.
- Principals file: duplicate ids, invalid hex, a 63-char digest, an unknown scope and a bad `expiresAt` each
  make that entry unusable, and the token is denied. A non-JSON file denies everyone.
- Transport and path table (one `test.each`). Every refused row asserts denial and no writer call; the
  loopback rows assert success:
  - a remote peer address (mocked `socket.remoteAddress`) over plain HTTP, both with and without
    `X-Forwarded-Proto: https`, gets `insecure-transport`;
  - `::1` and `::ffff:127.0.0.1` are accepted;
  - `HEAD` on the GET route, `/Workspace/…` case, a trailing slash, `%2F` in the name, `/workspaces`,
    `DELETE /workspace/:name` and `/admin/dashboard/reminders` all get `forbidden`.
  - Red controls: drop the peer check and the remote case goes red; drop the handler workspace binding and a
    forged-param case goes red.
- Pagination: `limit`/`offset` after `activeOnly` filtering; out-of-range bounds refused; `rebalance` with
  `limit` refused.
- Unknown workspace and a workspace that is not running keep the existing GH-279 behaviour.
- Legacy bearer: the existing suites pass unchanged, which proves no regression.

Pure unit checks of `AuthenticatePrincipalAsync` (malformed file, timing-safe compare path) can live in the same
file; no new test file.

### Smoke

Run the real `WebAPI` with the real `RemindersModule` locally (the GH-290 smoke harness pattern), flag on and
one principal:
- **main path:** GET, then complete with an `Idempotency-Key`, then replay the same request;
- **adjacent path:** revoke the principal in the file, then the next call is denied; a second workspace is
  denied.

Receipt under `TESTS-RESULTS/2026-11-06+GH-301/`, naming the throwaway `SLEUTH_DATA_DIR` it used.
- The smoke runs **only** in an isolated local checkout with temporary data, never on a deployed server, prod
  or dev (AGENTS.md: server checks are read-only).
- A later bot pilot on dev (Phase 4) is a separate operator-authorized step behind a TLS proxy. It is not
  part of this PR's verification.

## Phase 2 plan: create and edit through bot keys, with version checks (2026-11-06)

Phase 0–1 shipped in #305 (`39760d7`). This section is the plan for the next PR, on branch
`feat/AEGIS-Sleuth-Slackbot-gh301-bot-remote-crud-2026-11-06-phase2`.

### Recon (base `39760d7`)

| Seam | Finding |
|---|---|
| Edit writers (GH-290) | `UpdateReminderSummaryFromListAsync(…, {SyncLists, ReturnStatus})` (retitle), `RescheduleReminderAsync` (reschedule), `CreateReminderFromListRowAsync(row, {SkipListSync:false, RequireOwner:true})` (create). Reached through the bulk route's `#ApplyBulkReminderActionAsync`. Principals are limited to complete/cancel by `PrincipalBulkActions` and `#CheckPrincipalBulkShape` (`src/web-api.js`). |
| Links | `ReminderInfo.GitHubUrls` (`src/reminders-module.js:114`) is set only at extraction (`:2225`). There is no edit writer. Consumers: `github-sync-module.js` reads linked issue/PR state and completes the reminder when it closes; `github-comment-relay.js` posts Slack thread replies as **public GitHub comments**, gated by `GitHubRelayStopped`/`GitHubRelayStarted` (`:176`, `:248`, `:336`, `:372`). URL shape: `ExtractGitHubUrls` (`src/github-url-utils.js:12–16`). |
| Channels | `RemindersModule.AreRemindersEnabledForChannel(id)` (`src/reminders-module.js:1624`). A created reminder posts in its channel when it falls due. |
| Idempotency | Phase 1's `IdempotencyStore` is in memory. A restart forgets keys, which is safe for complete/cancel but not for create (a duplicate reminder). |
| Versions | No stored revision field. The reminder fields a bot can change are `ReminderMessageText`, `ShouldPostOn`, `GitHubUrls` and `State` (plus `AssigneeIDs` from a create). |

### Plan (revised after Codex plan QA round 1)

**Outcome sought:** a bot can create a reminder and fix its title and due time without overwriting a change it
has not seen, without duplicate creates, and without new public side effects.
**Smallest viable bet:** open `retitle`, `reschedule` and `create` to principals on the same bulk route. Every
principal edit, `complete`/`cancel` included, carries a version computed from stored fields, and the writers
re-check it at the moment of mutation.
**Not built (this PR):**
- **`set-links`: deferred to its own follow-up.** Plan QA round 1 showed that editing `GitHubUrls` reaches into
  `github-sync-module.js` and `github-comment-relay.js`:
  - an in-flight sync poll can complete a reminder from a link that was just removed, then post Slack notices
    (`:247–281`, `:395–406`, `:659–679`);
  - the relay stop is thread-wide and doesn't stop a post already in flight (`:147–156`, `:336–364`).
  
  Doing it safely needs guards inside those modules, beyond an edit API. Requirement 6's link patch is therefore
  **not** delivered here; the follow-up owns it.
- `reassign` for bots (not in the issue's patch allowlist), hard delete, a stored revision counter, per-principal
  channel lists, MCP (Phase 3), and TLS and pilot (Phase 4).

**Alternatives rejected:**
- *A stored `Revision` integer:* every writer path would have to bump it, and a missed path lets a stale write
  through. A digest of the fields themselves cannot miss a writer.
- *A separate PATCH route:* a second validation, serial and result path, already rejected in GH-290.
- *A process-wide lock for conflicts:* the writers re-check at the point of mutation instead, which is enough
  for one process.

**Rollback:** revert the PR. Phase 1 behaviour stays. Two optional fields are stored only on bot-created
reminders (`ApiCreateKey`, `ApiCreateFingerprint`); older code ignores them.

#### 1. Versions (requirement 7)

- **`RemindersModule.GetReminderVersion(reminder)`** (new, static, pure, never mutates its input) returns the
  first 16 hex characters of the sha256 of a JSON array of:
  - `ReminderMessageText`, or `''`;
  - `ShouldPostOn`, normalized to ISO (a `Date` and its ISO string give the same digest);
  - assignee IDs **in order**, from the existing `RemindersModule.GetAssigneeIDs` (so a legacy single `AssigneeID`
    and `AssigneeIDs` hash the same, and reordering owners changes the version);
  - a **copied, sorted** `GitHubUrls`, or `[]`;
  - `State`, defaulting to `scheduled`;
  - `IgnoreSnooze === true`, `DndHeld === true` and `GitHubRelayStopped === true`, as booleans.
- **Read:** for principals only, each record in `GET …/reminders` gains `version`. Legacy responses are unchanged.
- **Write:** every principal action except `create` must carry `ifMatch` (16 hex), else `if-match-required`. A
  principal batch may touch each `reminderId` once (`duplicate-reminder`).
- **Before any write:** all `ifMatch` values are checked against live reminders, and any mismatch refuses the
  whole batch with `version-conflict`, listing the current versions.
- **At the moment of mutation:** the affected writers (`UpdateReminderSummaryFromListAsync`,
  `RescheduleReminderAsync`, `CompleteReminderByIdAsync`, `CancelReminderFromListAsync`) gain an optional
  `ExpectedVersion`. When it is given, the writer re-finds the reminder in the pending queue **after** its last
  await and immediately before the synchronous mutation. If the reminder is gone or its version differs, it
  returns `conflict` and changes nothing. Existing callers pass nothing and behave exactly as today.
- An item that hits `conflict` mid-batch leaves earlier items applied. The response says which items applied.
  Each successful item returns its new `version`.

#### 2. Actions opened to principals

| action | fields (anything else → `unknown-field`) | writer | notes |
|---|---|---|---|
| `retitle` | `action`, `reminderId`, `ifMatch`, `title` | existing + `ExpectedVersion` | title contract applies; no `force` for bots |
| `reschedule` | `action`, `reminderId`, `ifMatch`, `dueDate` | existing + `ExpectedVersion` | `busy` while posting, as today |
| `complete` / `cancel` | `action`, `reminderId`, `ifMatch` | existing + `ExpectedVersion` | `ifMatch` is new for bots; legacy callers unaffected |
| `create` | `action`, `title`, `dueDate`, `channelId`, `assigneeIds` (1–10) | existing + create key | **only action in its request** (`create-must-be-alone`) |

`reason` stays accepted and ignored. The server reason is `api-bot:<id>:<action>`.

#### 3. `create` for principals

- **Channel:** `channelId` must have auto-scheduling enabled (`AreRemindersEnabledForChannel`,
  `src/reminders-module.js:1624`), else `channel-not-enabled`.
- **Owners:** `assigneeIds` is required (1–10). `senderId` is not accepted from bots; the existing writer then
  uses the first assignee as sender.
- **Durable idempotency, stamped before the first save:**
  - `CreateReminderFromListRowAsync` gains optional `ApiCreateKey` and `ApiCreateFingerprint`, stamped on the
    reminder object **before** `#QueueReminderAsync`, so the first persisted copy already carries them.
  - Key: hex sha256 of `principalId \n workspace \n Idempotency-Key`. Fingerprint: the same request-body hash
    Phase 1 already computes.
  - Before creating, the API searches **pending** reminders for that key:
    - same fingerprint → `created` with that id and `replayed: true`, no write;
    - different fingerprint → `idempotency-key-reused`.
  - This survives a restart or cache eviction, because the reminders file is the store. It doesn't cover a retry
    that arrives after the first reminder was already completed; the docs say so.
  - Because a create is always alone in its request, a replay has exactly one item and no mixed-batch case.
- The title contract applies, with no `force`.

#### 4. Tests (existing files only) and smoke

In `tests/web-api-reminders.test.js` (GH-301 block, mock module):
- `version` for principals only;
- `if-match-required`, `duplicate-reminder`;
- whole-batch `version-conflict`, with current versions and no writes;
- new version returned, and the old one then conflicts;
- `create-must-be-alone`; `channel-not-enabled`; `senderId` and `force` → `unknown-field`;
- a contract-refused title is refused.

In `tests/reminders-integration.test.js` (real `RemindersModule`, temp data dir):
- **Digest:** owner reordering, `IgnoreSnooze`/`DndHeld`/`GitHubRelayStopped` changes and a title change each
  change the version; a Date and its ISO string, and legacy and current owner forms, hash the same; the input
  arrays are not mutated.
- **Writer race:** start a retitle with `ExpectedVersion`, hold its ledger-gap await, retitle the same reminder
  through the list path (and in a second case complete it), then release. The held call returns `conflict`, and
  the newer text, or the completion, stands. Red control: drop the post-await re-check.
- **Durable create:**
  1. create with a key through the real module;
  2. read the reminders file and assert the key and fingerprint are on disk;
  3. stop, start a **new** `RemindersModule` from disk, and a new `WebAPI` with a fresh `IdempotencyStore`;
  4. retry with the same body → same id, one reminder;
  5. retry with a changed body → `idempotency-key-reused`.
  
  Red control: drop the stamp or the lookup.

Smoke: the same isolated local harness.
- **Main path:** a bot creates, retitles with `ifMatch`, then reschedules.
- **Adjacent path:** a stale `ifMatch` gets `version-conflict`; the create is replayed after rebuilding the module
  and API, and returns the same id; then complete.

### Requirement map additions

| Req | Phase 2 |
|---|---|
| 6 allowlisted patches | title, due, create; lifecycle from Phase 1; unknown fields rejected. **Links deferred** to a follow-up (sync/relay guards). |
| 7 optimistic concurrency | `version` on read, `ifMatch` on every principal mutation, conflict before writes and again at the moment of mutation |
| 8 idempotency | create made durable (key + fingerprint stamped before first save); edits keep in-memory replay + version checks |
| 10 side effects | create only in enabled channels; no link edits, so no new GitHub relay or sync paths |

## Rating

rated 45/35/50/40 (2026-11-06, author estimate on the 1–100 PRS axes):
- **Priority 45:** the operator scheduled it next, after GH-290. It unblocks an external bot.
- **Severity 35:** a capability gap, not a defect. The workaround is SSH plus the operator token, and the
  #271/#272 history shows the risk of hand access.
- **Appeal 50:** neutral.
- **Effort 40:** on the cheapness scale, where higher means cheaper. Phase 0–1 is a moderate change: one small
  module plus middleware and handler checks, with tests in an existing file.

Recurrence: not a defect class; unknown trend.

## Requirement map (issue #301 → this PR)

| Req | Covered here | Later |
|---|---|---|
| 1 no SSH/cookies/tokens/fs for clients | principal token only | — |
| 2 HTTPS, fail-closed, flag | flag off by default; principals need socket TLS or an exact loopback peer (proxy) | TLS terminator (deploy) |
| 3 shared command service | handlers reuse the existing bulk prepare/apply path; no second writer | Phase 3 MCP calls the same routes |
| 4 MCP adapter | — | Phase 3 |
| 5 workspace + read/write scopes, revoke/expiry | yes | assignee ownership (optional) |
| 6 allowlisted patches | complete/cancel only for principals | Phase 2 |
| 7 optimistic concurrency | — | Phase 2 (with patches) |
| 8 idempotency | `Idempotency-Key`, in-memory 24 h | — |
| 9 audit | one redacted line per batch | — |
| 10 Slack side effects | unchanged writers; no new posts | — |
| 11 flag + revoke/rollback | yes | pilot (Phase 4) |
