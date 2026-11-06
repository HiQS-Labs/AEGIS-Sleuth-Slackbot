---
Goal: Pre-implementation plan QA for GH-301 Phase 0–1 (bot principals on the Web API)
Date: 2026-11-06
NEXT: Reviewer
STATUS: Open
---

# Context

Review the plan in `PROJECT/1-INBOX/GH-301-BOT-REMOTE-CRUD.md` **before any code is written**. Issue (the full
four-phase ask, with normative requirements 1–11): https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/301.
This PR covers **Phase 0–1 only**: principal auth, scopes and workspace binding, read, and complete/cancel,
plus idempotency and audit. Phases 2–4 (create/patch with If-Match, MCP adapter, pilot) are later PRs; the
plan's requirement map says where each requirement lands.

**Operational envelope:** a single-tenant-per-workspace Slack bot. It exposes an Express Web API (`src/web-api.js`)
used today by one operator through an SSH tunnel with a shared bearer token. The new users are one or two
external bots (Cursor/Grok) for the operator's own workspace. Grade against the issue's requirements for this
phase and commensurate complexity. Do not ask for an OAuth server, RBAC framework, distributed idempotency
store, audit DB or rate limiter.

Design choices to challenge:
- **SHA-256 hash in a data-dir principals file, re-read on each request.** The issue suggests reusing
  Product Compass's systemd-creds/Keychain pattern. The plan argues that pattern can't revoke without a
  restart. Is the deviation sound?
- **Transport rule:** principals are refused on plain HTTP unless the peer is loopback or a loopback TLS proxy
  sets `X-Forwarded-Proto`.
- **In-memory idempotency cache.**

Read the plan, then the code it cites:
- `src/web-api.js`: constructor route table (~L140–170), `#AuthorizationMiddleware` (~L180), `#HandleGetWorkspaceRemindersAsync` (~L966),
  `#HandlePostWorkspaceRemindersBulkAsync`, `#PrepareBulkReminderAction`, `#ApplyBulkReminderActionAsync`
- `src/app.js` `GetWebApiBearerToken` (~L95)
- `src/product-compass.js` `ReadCredentialAsync`
- `src/workspaces.js` `GetRuntimeDirPath`
- `docs/web-api.md` (bulk section, Product Compass credentials section)
- `tests/web-api-reminders.test.js` (how the real WebAPI is started in tests)

Questions:

1. Are the recon claims grounded (file:line)? Is anything in the auth path or route table missed? Could a
   principal reach another route, for example through Express path normalization, trailing slashes, case,
   URL-encoded workspace names or `HEAD`?
2. Is the token/hash design sound for this envelope? Check the parse of `slp_<id>_<secret>`, `timingSafeEqual`
   on digests, fail-closed on a missing or malformed file, per-request re-read for instant revoke.
3. Is the transport rule correct and safe? Can `X-Forwarded-Proto` be spoofed by a remote peer under the plan's
   rule? Is `req.socket.remoteAddress` loopback detection right for IPv4/IPv6-mapped addresses?
4. Is restricting principals to `complete`/`cancel` on the existing bulk path (whole-batch refusal) the right
   Phase-1 shape, with no second writer path?
5. Idempotency: are the key scope, same-body replay, different-body conflict and restart behaviour adequate for
   requirement 8? Is anything simpler enough?
6. Audit line: does it satisfy requirement 9 without logging untrusted free text or secrets?
7. Are the tests falsifiable with red controls, and is the footprint commensurate (existing file only)? Is
   anything required missing, or anything over-built? Is the CLI helper warranted?
8. Is the rating 45/35/50/40 grounded?

Flag anything wrong, missing, mis-scoped, or over/under-engineered, with file:line. Every [Blocker]/[Should]
asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines; a
[Blocker] must cite an observed failure.

Write your verdict below. Set STATUS to Approved if the plan can proceed as written (Nits allowed); otherwise
leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
