---
gh_issue: 301
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/301
title: "Secure remote reminder CRUD for external bots (HTTPS + MCP, no SSH)"
status: Inbox
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
| Recon and plan for Phase 0–1 (2026-11-06). | Codex plan QA, then implement. Phases 2–4 are later PRs. |

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
| Exposure | Prod: Web API on loopback, reached by SSH tunnel. Dev: `:2020` open to the internet over **plain HTTP** (SOP §1b). Neither terminates TLS today. |

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
- *Secrets in systemd-creds, as Product Compass does:* adding a bot then needs a unit edit and restart, and
  revocation needs a restart too. The issue requires "revoke without redeploy".
- *A new `/v1` router:* a second request path beside the existing routes. Additive checks on the two existing
  routes are enough.

**Rollback:** the feature flag `WEB_API_BOT_PRINCIPALS` is off by default. Off means principal tokens are
refused exactly as today (`Forbidden.`). Or revert the PR. Nothing in the stored reminder format changes.

### 1. Principals file and module: `src/web-api-principals.js` (new, small)

- File: `<data dir>/web-api-principals.json` (mode 600). It lives in the data dir, so the nightly backup
  includes it. An array of principal records:
  `{ "id": "cursor-grok", "sha256": "<hex of sha256(token)>", "workspaces": ["neochrome"], "scopes": ["reminders:read","reminders:write"], "expiresAt": "2027-01-01T00:00:00Z", "revoked": false }`.
  `expiresAt` and `revoked` are optional.
- **Only a hash is stored.** The token is `slp_<id>_<43 chars base64url of 32 random bytes>`. Its SHA-256
  is safe at rest because the token is high-entropy, not a password. The bot keeps the token in its own
  secret storage.
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

- **Transport:** refused unless the request is loopback (`req.socket.remoteAddress`) or `req.secure`.
  `X-Forwarded-Proto: https` counts only when the TCP peer is loopback, which means a local TLS proxy.
  Plain HTTP from a remote host is refused with code `insecure-transport`, before the token is even
  looked up.
- **Route allowlist:** a principal reaches only `GET /workspace/:name/reminders` (needs `reminders:read`) and
  `POST /workspace/:name/reminders/bulk` (needs `reminders:write`). Every other route is refused with code
  `forbidden`. That includes `/workspaces`, workspace create/delete, stats, settings and admin.
- **Workspace:** `:name` must be in `principal.workspaces`, otherwise `forbidden-workspace`. This is
  cross-workspace denial.
- The principal is attached to the request (`ArgReq.Principal = { id, workspaces, scopes }`) for the handlers.
- Failure keeps the existing envelope and adds a stable `code`: `200 {success:false, data:'Forbidden.', code}`.
  Legacy responses are unchanged.

### 3. Handlers (existing, small additive checks)

- **Bulk:** when `ArgReq.Principal` is set, `#PrepareBulkReminderAction` also refuses any action other than
  `complete`/`cancel` (Phase 1). It refuses the whole batch, as today.
- **Idempotency:** a principal's write must send `Idempotency-Key` (1–128 chars), else validation error code
  `idempotency-key-required`. Results are cached in memory, keyed by `principalId + workspace + key`, with a
  24 h TTL and a 1000-entry cap (oldest evicted).
  - A replay with the **same body** returns the cached response and does not call any writer.
  - The same key with a **different body** gets code `idempotency-key-reused`.
  - After a restart the cache is empty. A replayed complete then reports `not-found`, which is still no
    double-complete, because complete/cancel are already idempotent in the writers.
- **Audit:** every principal write logs one line per batch:
  `[web-api] principal=<id> workspace=<w> key=<idempotency key> actions=<complete:2,cancel:1> ids=<first 8 chars of each id> result=<counts>`.
  It never logs the token, titles or other free text.
- **Read:** for a principal, the GET also accepts `limit` (1–500) and `offset` (≥0) on the reminder list. The
  response gains `total` only when `limit` is used. A legacy GET is unchanged.

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
- Phase-1 allowlist: a principal `retitle` refuses the whole batch.
- Idempotency: the same key and body twice gives one writer call and an identical response; the same key with a
  different body gets `idempotency-key-reused`; a missing key is refused.
- Transport: a non-loopback request without TLS gets `insecure-transport`. Simulated by mocking the socket address.
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

Receipt under `TESTS-RESULTS/2026-11-06+GH-301/`. Not on production. On dev only after deploy, and only behind
the transport rule: a dev bot test needs a TLS proxy, or must run on the box over loopback.

## Rating

rated 45/35/50/40 (2026-11-06, author estimate on the 1–100 PRS axes):
- **Priority 45:** the operator scheduled it next, after GH-290. It unblocks an external bot.
- **Severity 35:** a capability gap, not a defect. The workaround is SSH plus the operator token, and the
  #271/#272 history shows the risk of hand access.
- **Appeal 50:** neutral.
- **Effort 40:** Phase 0–1 is moderate, and the issue has four phases.

Recurrence: not a defect class; unknown trend.

## Requirement map (issue #301 → this PR)

| Req | Covered here | Later |
|---|---|---|
| 1 no SSH/cookies/tokens/fs for clients | principal token only | — |
| 2 HTTPS, fail-closed, flag | flag off by default; plain HTTP refused for remote hosts | TLS terminator (deploy) |
| 3 shared command service | handlers reuse the existing bulk prepare/apply path; no second writer | Phase 3 MCP calls the same routes |
| 4 MCP adapter | — | Phase 3 |
| 5 workspace + read/write scopes, revoke/expiry | yes | assignee ownership (optional) |
| 6 allowlisted patches | complete/cancel only for principals | Phase 2 |
| 7 optimistic concurrency | — | Phase 2 (with patches) |
| 8 idempotency | `Idempotency-Key`, in-memory 24 h | — |
| 9 audit | one redacted line per batch | — |
| 10 Slack side effects | unchanged writers; no new posts | — |
| 11 flag + revoke/rollback | yes | pilot (Phase 4) |
