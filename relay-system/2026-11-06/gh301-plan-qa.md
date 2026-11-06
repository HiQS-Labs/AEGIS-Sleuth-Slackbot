---
Goal: Pre-implementation plan QA for GH-301 Phase 0–1 (bot principals on the Web API)
Date: 2026-11-06
NEXT: Producer
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


## Codex reviewer verdict — 2026-11-06

**Ship with conditions; STATUS remains Open.** The Phase 0–1 shape is appropriate, but the following
[Should] items need explicit acceptance contracts before implementation. No observed implementation
failure is claimed: this is a plan review and the proposed code does not exist yet.

### Required plan corrections

1. **[Should] Reserve idempotency keys while requests are in flight.**
   `PROJECT/1-INBOX/GH-301-BOT-REMOTE-CRUD.md:109–115,143–144` specifies cached results and sequential
   replay only. `src/web-api.js:1033–1046` awaits workspace lookup and writers; serial items within one
   request do not serialize concurrent HTTP requests. Two requests can both miss a results-only cache,
   run writers, and return different responses. Specify one in-memory entry containing a body fingerprint
   and an in-flight promise, reserved synchronously before the first write-related await. Same-body
   requests await it; different bodies conflict even during execution. Authenticate/recheck workspace
   and scopes before serving any replay, so revocation cannot be bypassed by a cache hit. Use an
   unambiguous tuple key rather than unspecified string concatenation. Define body equality (e.g.
   JSON.stringify of the parsed body is sufficient if documented), completed-entry eviction and failure
   cleanup; do not evict active reservations and permit duplicate execution.
   **Observed input:** two overlapping POSTs with the same principal/workspace/key/body, and an overlapping
   POST with that key and a changed body.
   **Affected scope:** principal bulk writes and requirement 8, including the promised identical response.
   **Falsifier:** in the existing test file, hold the writer pending, launch the second request before
   releasing it, and assert one writer call and identical responses; changed-body overlap must conflict
   before another writer call. Removing the reservation must make this check fail.
   **[Unverified — needs clone run]** No concurrent API execution was performed here.

2. **[Should] Close the untrusted-text logging path, including downstream writers.**
   Plan `:109,116–118` permits any 1–128-character key and prints it verbatim, while truncating a supplied
   reminder ID does not sanitize it. Existing preparation accepts any nonempty ID and any string reason
   (`src/web-api.js:1075–1081`), then forwards the reason (`:1041,1046`). Writers log those values
   (`src/reminders-module.js:1079,1087,1122,1129`). A new clean audit line alone therefore does not meet
   the stated “never logs ... other free text” contract for principals. Use escaped structured audit
   fields or a key digest and safe ID representation; for principal requests supply a server-generated
   bounded reason to the existing writer rather than passing arbitrary reason text. Keep legacy
   operator semantics unchanged. Specify whether denied/replayed requests produce audit outcomes.
   **Observed input:** a valid principal submits key `audit result=completed`, ID `x\nFAKE=1` in JSON,
   or a valid reminder ID with a reason containing secrets/newlines.
   **Affected scope:** principal audit and existing reminder logs/FSM reason provenance, requirement 9.
   **Falsifier:** capture logs for these requests and assert one parseable audit record per defined
   outcome, no injected line or raw reason, and no secret/token; include a successful write so the
   downstream logger is exercised.
   Narrow primitive probe (not an API test): `node - <<'JS'` with
   `console.log('audit result=completed'.length <= 128);`
   `console.log(JSON.stringify('x\nFAKE=1'.slice(0,8)));` then `JS`.
   Exit **0**; decisive output: `true` and `"x\nFAKE=1"`. Length/truncation alone retain untrusted content.
   **[Unverified — needs clone run]** End-to-end log capture remains implementation verification.

3. **[Should] Specify and test the authorization normalization and transport boundary.**
   Plan `:92–100,135–149` names the right restrictions but does not define matching/decoding or loopback
   predicates. Auth runs as global middleware before route params exist (`src/web-api.js:127–130,180–181`);
   handlers subsequently use decoded `params.name` (`:968,1025`). Require the workspace checked by auth
   to be exactly the workspace used by the handler. Strictly refusing noncanonical path variants is
   acceptable; do not require a new router. State the HEAD policy explicitly (Express GET routes also
   serve HEAD), and cover encoded workspace names/separators, trailing slash/case variants and admin
   denial. For transport, keep trust proxy disabled and use actual socket TLS plus the socket peer;
   do not let a future broad trust-proxy setting turn remote X-Forwarded-Proto into authorization.
   Enumerate actual loopback forms, including `::1` and `::ffff:127.0.0.1`, using address parsing or
   exact checks rather than string prefixes. A loopback peer alone does not prove TLS upstream: document
   the proxy's obligation to enforce HTTPS and overwrite forwarding headers. Server refusal cannot
   undo a credential already sent in cleartext; docs/examples must instruct bots to use HTTPS URLs.
   **Observed input:** remote plain-HTTP request with `X-Forwarded-Proto: https`; mapped-IPv4 loopback;
   HEAD and encoded/case/trailing-slash forms of both allowed routes and an administrative route.
   **Affected scope:** workspace/route confinement and transport authentication for principals.
   **Falsifier:** extend the existing file with a compact table asserting remote spoof denial, accepted
   loopback forms and the chosen path policy; assert every accepted workspace matches the handler's
   target and forbidden variants never invoke a writer. Removing peer validation or workspace binding
   must turn the corresponding denial assertion red.
   **[Unverified — needs clone run]** No Express route or socket fixture was executed in this checkout.

### Other review conclusions

- SHA-256 of a cryptographically random 32-byte secret, full-token digest comparison and per-request
  reads are sound for this envelope. The small CLI earns its place by generating entropy and a correct
  hash without writing configuration. Define an unambiguous bounded ID/token grammar (base64url secrets
  themselves contain underscores), unique IDs, strict 64-hex digests and typed expiry/revocation/scope/
  workspace validation as part of the already-promised malformed-entry refusal. Decode only after hex
  validation and check digest lengths before timingSafeEqual; never expose an exception as success.
  Primitive probe: `node` evaluating `Buffer.from('zz'.repeat(32),'hex')` then comparing with a SHA-256
  digest using `crypto.timingSafeEqual`. Exit **0** with caught error; output: decoded bytes **0**,
  `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`. This demonstrates why the malformed-file check must exercise
  invalid digest content, not merely invalid JSON. API fail-closed behavior is **unverified—needs clone run**.
- **[Nit] Correct the credential comparison at plan :57–58.** Product Compass reads every request
  (`src/product-compass.js:34–47`); Keychain replacement/removal does not inherently need restart.
  Its token is also revocable at the issuer, documented at `docs/web-api.md:610,620`. Systemd-loaded
  credential provisioning does require service lifecycle work. A hashed local verifier file remains
  reasonable because this API is the issuer/verifier and needs editable per-principal grants; justify
  it on that distinction rather than a blanket claim that native storage cannot revoke live.
- Reusing bulk prepare/apply and refusing a whole mixed complete/retitle batch before writes is the
  right Phase-1 boundary. Add a mixed-batch assertion, since a lone retitle refusal cannot prove zero
  earlier writes. In-memory TTL/cap and documented restart loss are proportionate for complete/cancel;
  do not carry that durability argument forward to create. Clarify that cap eviction also shortens
  replay retention below 24 h. No database, OAuth subsystem or new suite is warranted.
- Read reconstruction and runtime directory claims match `src/web-api.js:966–1007` and
  `src/workspaces.js:64–72`; legacy auth and app token resolution match `src/web-api.js:180–214` and
  `src/app.js:95–113`. The existing test file constructs a real WebAPI with mock workspace modules
  (`tests/web-api-reminders.test.js:17–23,54–58`); it proves HTTP boundaries, while the planned local
  real-module smoke supplies writer integration evidence. Pagination needs assertions for filter-before-
  slice, invalid bounds and raw/rebalance shapes within that same file. Red controls are currently
  explicit only for the flag; add the targeted controls above rather than another harness.
- Rating **45/35/50/40** is a reasonable author estimate for this scoped capability, not a measured
  score. Confirm the fourth field follows the repo's effort-cheapness convention; four phases do not
  by themselves establish the effort of this PR.

### Evidence limits and handoff

Only this relay file was edited. No git commands, tests, executable fixtures, validation scripts,
server connections or source modifications were performed. Graph discovery was attempted but returned
`MCP tool call requires approval, but approval policy is never`, so cited source was read directly.
The live issue could not be retrieved: `gh issue view 301 --repo HiQS-Labs/AEGIS-Sleuth-Slackbot --json body`
exited **1**, `error connecting to api.github.com`; web open also failed with cache miss. Therefore
normative requirements 1–11 were checked only against the seeded requirement map, not independently
against the live issue text. Producer should retain/verify that text before claiming full conformance.

Return to Producer to revise the plan; then request another reviewer turn.


## Producer response — round 1 (plan commit `467d8e1`)

All three Shoulds and both Nits are **Accepted**. Plan sections 1–3, Tests and Rating are revised.

1. **Idempotency reservation (accepted).**
   - One `Map` keyed by `JSON.stringify([principalId, workspace, key])`, with entries `{Fingerprint, Promise, DoneAt}`.
     `Fingerprint` is the sha256 of `JSON.stringify(req.body)`.
   - The entry is reserved synchronously, before the first `await`. Same body: await the same promise and get the
     identical response. Different body: `idempotency-key-reused` at once, even mid-flight. A throw deletes the
     entry.
   - TTL and cap evict completed entries only; an in-flight entry is never evicted. Docs say the cap can shorten
     retention.
   - A replay is served only after the middleware has re-authenticated on that request.
   - Overlap test with a held writer, plus a red control.
2. **Untrusted text (accepted).**
   - Principal `reminderId` must match the UUID format.
   - A client `reason` is ignored for principals; the server reason is `api-bot:<id>:<action>`, where the id
     grammar is `[a-z0-9-]{1,32}`. So the writers' existing log lines only ever see safe values.
   - Audit and denial lines are single `JSON.stringify` records: key digest only, validated id prefixes, no
     reason, no token.
   - Legacy behaviour is unchanged. A log-capture test uses your inputs.
3. **Path and transport (accepted).**
   - The middleware does its own exact match on raw `req.path`: `^/workspace/([A-Za-z0-9_-]{1,64})/reminders$`
     (GET) and `…/reminders/bulk$` (POST). HEAD, case variants, trailing slashes and percent-encoding are
     refused.
   - Both handlers require `params.name === Principal.Workspace`.
   - Transport is `socket.encrypted` or an exact loopback peer (`127.x`, `::1`, `::ffff:127.x`), using
     `net.isIP` plus an exact pattern.
   - `trust proxy` stays off, and `X-Forwarded-*` is never read for this, so I dropped that exception
     entirely. Docs state the proxy's HTTPS obligation, and that bots must use `https://` URLs.
   - Table test, with red controls.
- **Nits (accepted).**
  - The Product Compass comparison is re-justified on the issuer/verifier distinction.
  - Token grammar: `^slp_([a-z0-9-]{1,32})_([A-Za-z0-9_-]{43})$`.
  - Strict entry validation: unique ids, a 64-hex digest checked before decode, 32-byte length checks before
    `timingSafeEqual`, typed fields, and any exception means deny.
  - Mixed-batch no-write test.
  - Pagination: filter first, then slice. Raw stays an array, with `X-Total-Count`. Rebalance plus paging is
    refused.
  - Effort 40 is confirmed on the cheapness scale.
- **Live issue text:** now seeded read-only at `.relay-artifacts/gh301-issue.md`. Please check requirements
  1–11 against it.

Please re-review `467d8e1` and set STATUS: Approved if satisfied.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->


## Codex reviewer verdict — round 2, 2026-11-06

**Ship with conditions; STATUS remains Open.** The round-1 Shoulds are resolved at plan level:
reservation precedes awaits, replay reauthenticates, writer reasons are server-owned, and canonical
path/workspace and socket-peer checks are explicit. The credential-store deviation is now justified
on the issuer/verifier distinction. No implementation failure is claimed.

I read the seeded issue `.relay-artifacts/gh301-issue.md`, including normative requirements 1–11.
Requirements 1, 2, 3, 5, 8, 10 and 11 have proportionate Phase-1 delivery paths. Requirement 4 and
create/patch portions of 6 are explicitly deferred. Requirement 7 says all mutating calls in its
normative wording, while the issue's Phase-2 sketch and this relay explicitly defer If-Match to
patches: approval here concerns that declared Phase-1 subset, not full requirement-7 conformance.
Requirement 9 has a structured audit design, with the identification caveat below. The 24-hour
cache is bounded replay retention, not durable same-result replay across restart or eviction.

### Remaining corrections

1. **[Should] Specify principal request-field rejection, not just an action-name allowlist.**
   Plan `PROJECT/1-INBOX/GH-301-BOT-REMOTE-CRUD.md:142–149,197` adds three rules but no field
   allowlist. The seeded issue's requirement 6 explicitly says “Reject unknown fields.” Existing
   `src/web-api.js:1070–1081` constructs a prepared subset and silently ignores unrelated properties;
   extending it with only the three planned checks preserves that behavior for principals.
   Define allowed envelope/action keys for principal requests (including the deliberately ignored
   `reason`, if retained) and reject other keys across the whole batch before writes. Legacy stays
   unchanged. This is a small validation addition in the existing preparation path.
   **Observed input:** a valid principal sends an otherwise valid complete action with an extra
   `hardDelete: true` or misspelled field; the plan's three rules do not reject it.
   **Affected scope:** principal complete/cancel validation and requirement 6, not Phase-2 patches.
   **Falsifier:** add an extra field to the second action of a valid two-action batch and assert
   whole-batch refusal with zero writer calls; removing the field check must fail that assertion.
   **[Unverified — needs clone run]** Source/contract comparison only; no API fixture executed.

2. **[Should] Keep the module-starting smoke on an isolated local checkout.**
   Plan `:228–235` first specifies local execution, then permits running the dev bot test “on the box
   over loopback.” AGENTS.md's non-negotiable server rule explicitly covers deployed prod **and dev**:
   checks are read-only, and module-starting harnesses/tests must run on a development checkout.
   Remove the on-box harness option and distinguish any later authorized pilot from this PR's smoke.
   TLS or loopback does not isolate the service data directory.
   **Observed input:** an implementer follows `:235` by starting the real-module smoke on deployed dev.
   **Affected scope:** smoke execution safety; no claim about current deployment state is made.
   **Falsifier:** the revised instructions must place the smoke in an isolated local checkout with
   temporary data and offer no deployed-server execution alternative; its receipt should identify
   that isolated data directory. This is a documentation check, not a new test.

### Nits and implementation cautions

- Plan `:204–209` should describe separate logging cases: the invalid key/UUID case cannot also
  exercise a successful writer. Use a valid key and UUID with the malicious reason for downstream
  logging coverage. At `:210–213`, accepted loopback rows need success assertions rather than the
  table's blanket “all asserting denial.” The intended behavior is otherwise clear.
- Requirement 9 asks for reminder identity in the audit. Eight-character UUID prefixes (`:168`)
  can collide; full validated UUIDs are already bounded and contain no reminder text. Prefer full
  UUIDs, or explicitly document that audit correlation currently uses prefixes. Likewise never
  print a malformed file entry's unvalidated `id` verbatim in its warning (`:85–87`).
- Keep malformed-file/digest checks concrete in the existing test file, including duplicate IDs
  and invalid hex. The planned auth checks cannot be treated as verified merely because they are  [Unverified — no citation]
  specified. The small CLI and existing bulk preparation/application seam remain warranted;
  no additional service framework, database or suite is requested.

### Evidence and handoff

Read-only source inspection: `nl -ba src/web-api.js | sed -n '1070,1095p'`, exit **0**,
showed preparation copies recognized values without an unknown-key check. Plan inspection:
`nl -ba PROJECT/1-INBOX/GH-301-BOT-REMOTE-CRUD.md | sed -n '140,265p'`, exit **0**,
showed the three checks, test criteria and on-box smoke wording cited above. These are static
observations, not execution of proposed code. Graph discovery was attempted first and returned
`MCP tool call requires approval, but approval policy is never`; direct source reads were used.

Only this relay file was changed. No git commands, tests, executable fixtures, validation scripts,
server connections or source/artifact changes were performed. Runtime behavior and red controls
remain **[Unverified — needs clone run]** for implementation/harness verification.

Return to Producer for the two small plan corrections, then re-review.
