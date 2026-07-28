# P2: Web Admin UI for AI Assets

Status: Paused

## Table of Contents

- [Phased Progress Overview](#phased-progress-overview)
- [Context and Scope](#context-and-scope)
- [Phase 0: Authentication, Sessions, and Email](#phase-0-authentication-sessions-and-email)
- [Phase 1: Backend API for AI Assets](#phase-1-backend-api-for-ai-assets)
- [Phase 2: Lightweight Frontend](#phase-2-lightweight-frontend)
- [Phase 3: Cache Invalidation and Live Reload](#phase-3-cache-invalidation-and-live-reload)
- [Phase 4: Deterministic Responses Editor](#phase-4-deterministic-responses-editor)
- [Phase 5: Post-Build Verification and Release](#phase-5-post-build-verification-and-release)
- [AGENTS.md Compliance Notes](#agentsmd-compliance-notes)
- [Future Considerations (Out of Scope)](#future-considerations-out-of-scope)

---

## Phased Progress Overview

> **Note to LLMs:** As you complete each item below, mark it `[x]` immediately. This section is the high-level tracker — users should be able to see overall progress here without scrolling through phase details.

- [ ] **Phase 0: Authentication, Sessions, and Email**
  - [ ] 0.1 Create `AdminAuth` module with hashed password storage
  - [ ] 0.2 Add login and session endpoints
  - [ ] 0.3 Build login page UI
  - [ ] 0.4 Add outgoing mailer with Nodemailer + Gmail SMTP
  - [ ] 0.5 Add password reset flow (email reset link)
  - [ ] 0.6 First-run setup and CLI password reset
  - [ ] 0.7 First-run web welcome page with on-screen setup instructions
  - [ ] 0.8 Gitignore and environment-specific credential strategy

- [ ] **Phase 1: Backend API for AI Assets**
  - [ ] 1.1 Add AI asset CRUD endpoints to `web-api.js`
  - [ ] 1.2 Add server-side validation endpoint (reuse `validate-ai-prompts.js` logic)
  - [ ] 1.3 Add static file serving middleware for `/admin` route
  - [ ] 1.4 Add single-depth backup and rollback endpoints

- [ ] **Phase 2: Lightweight Frontend**
  - [ ] 2.1 Create `public/admin/` directory with `index.html`
  - [ ] 2.2 Build file browser sidebar (list + select AI assets)
  - [ ] 2.3 Integrate CodeMirror editor with markdown/JSON modes
  - [ ] 2.4 Add save + validate buttons with status feedback
  - [ ] 2.5 Add rollback button with one-click restore

- [ ] **Phase 3: Cache Invalidation and Live Reload**
  - [ ] 3.1 Add `InvalidateInstructionCache()` to `ChatModule`
  - [ ] 3.2 Add `InvalidateInstructionCache()` to `RemindersModule`
  - [ ] 3.3 Wire cache invalidation into the `PUT /admin/ai-assets/:filename` save flow
  - [ ] 3.4 Add reload confirmation indicator in the UI

- [ ] **Phase 4: Deterministic Responses Editor**
  - [ ] 4.1 Add CRUD endpoints for deterministic response entries
  - [ ] 4.2 Build structured form UI for adding/editing/removing entries
  - [ ] 4.3 Add validation for entry structure (`phrases`, `response.type`, etc.)

- [ ] **Phase 5: Post-Build Verification and Release**
  - [ ] 5.1 `npm run build` passes
  - [ ] 5.2 `npm run dev` smoke test clean
  - [ ] 5.3 `npm run validate:ai` passes
  - [ ] 5.4 Manual verification: edit an instruction file via UI, confirm change persists and cache invalidates
  - [ ] 5.5 Version bump in `package.json` and CHANGELOG update

---

## Context and Scope

### What exists today

| Component | Status | Details |
|---|---|---|
| Web API | Express 5, port 2020 | 8 JSON endpoints, bearer token auth, no frontend |
| AI instruction files | `data/static/ai/` | 4 markdown files (33-98 lines each), 3 JSON schemas |
| Deterministic responses | `data/static/deterministic-responses.json` | 3 entries, pattern-matched before AI |
| Model configuration | `src/workspace-ai.js` | `MODEL_CONFIGURATIONS` array, regex-based |
| AI validation script | `scripts/validate-ai-prompts.js` | Checks file existence, JSON validity, OpenAI schema contracts |
| Frontend | None | Zero HTML/CSS/JS; Express serves JSON only |
| Instruction caching | Lazy-load + in-memory | Read on first use, cached in private fields, no invalidation |

### What's in scope (v1)

- Proper authentication: hashed password, session tokens, login page
- Password reset via email (Gmail SMTP relay via Nodemailer)
- View and edit AI instruction files (`.md`) and schemas (`.json`) via browser
- View and edit deterministic responses
- Server-side validation before save
- Cache invalidation after save so changes take effect without restart
- Single-depth rollback: one previous snapshot per file, one-click restore

### What's out of scope (v1)

- Model configuration editing (`MODEL_CONFIGURATIONS` in `workspace-ai.js` — code, not data)
- Workspace management (already has API endpoints)
- Multi-user / role-based auth (single admin account for v1)
- Full version history / multi-step diff / deep rollback (use git for that)

### Architectural decision: no frontend build pipeline

Per AGENTS.md Section 15 (anti-patterns): "Introducing React/Vite/Supabase assumptions into this backend-focused repo" is explicitly called out. The frontend will be **vanilla HTML/CSS/JS** served from a `public/admin/` directory via Express static middleware. CodeMirror is loaded from CDN. No build step, no bundler, no transpiler.

### Auth architecture: dual middleware model

The existing `#AuthorizationMiddleware` in `web-api.js` (line 69) applies globally with a single hardcoded bearer token. This plan introduces **two auth paths** that coexist:

| Route pattern | Auth method | Details |
|---|---|---|
| `/admin/*.html`, `/admin/*.css`, `/admin/*.js` | **None** (static files) | Express static middleware registered **before** auth middleware |
| `/admin/login` | **None** (entry point) | Auth-exempt — this is how you get a session token |
| `/admin/auth-status` | **None** (status check) | Auth-exempt — returns `{ configured: true/false }` only |
| `/admin/forgot-password` | **None** (recovery) | Auth-exempt, rate-limited |
| `/admin/reset-password` | **None** (recovery) | Auth-exempt, validates reset token in request body |
| `/admin/ai-assets/*`, `/admin/deterministic-responses/*`, `/admin/logout` | **Session token** | Validated via `AdminAuth.ValidateSessionAsync()` |
| `/workspace/*`, `/settings/*` | **Legacy bearer token** | Unchanged from current behavior — `"test"` NOT retired |

**Implementation:** The existing `#AuthorizationMiddleware` is updated to branch:
1. If path starts with `/admin/` → delegate to session auth logic (skip auth-exempt routes, validate session token for the rest)
2. If any other path → use existing bearer token comparison (unchanged)

The legacy `"test"` bearer token is **not retired** in this plan. Existing API consumers (workspace CRUD, settings) continue working exactly as before. Retiring it is a separate, future change.

---

## Phase 0: Authentication, Sessions, and Email

This phase replaces the hardcoded `"test"` bearer token with proper authentication before any write-access endpoints are built.

### 0.1 Create `AdminAuth` module

**New file:** `src/admin-auth.js`

A standalone module that owns admin credential storage, password hashing, and session management. Follows existing module patterns (class with private fields, PascalCase, `Async` suffix).

**Auth config file:** `data/runtime/admin-auth.json`

```json
{
  "adminEmail": "devops@neochro.me",
  "adminBaseUrl": "http://localhost:2020",
  "passwordHash": "<scrypt hash>",
  "passwordSalt": "<random salt>",
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "authUser": "devops@neochro.me",
    "authPassEncrypted": "<encrypted Gmail App Password>"
  }
}
```

**Config field notes:**
- `adminEmail` — the single admin identity. All references in this plan (login, reset emails, SMTP sender) read from this field. `devops@neochro.me` is the default set during CLI setup, not a hardcoded value.
- `adminBaseUrl` — the canonical URL of the admin panel (e.g., `http://localhost:2020` for dev, `https://sleuth.example.com` for production). Used to build password reset links. Set during CLI setup; falls back to `req.protocol + '://' + req.get('host')` if not configured.

**Password hashing:** Use Node's built-in `crypto.scryptSync()` with a random 32-byte salt. No new npm dependencies for auth.

**SMTP credential encryption:** The Gmail App Password is encrypted at rest using `crypto.createCipheriv()` with AES-256-GCM. The encryption key is derived from an environment variable (`ADMIN_ENCRYPTION_KEY`). This means:
- The Gmail App Password is never stored in plaintext on disk
- The encryption key lives only in the process environment (set in systemd unit file or `.env`), not in source or config files
- If someone gets the `admin-auth.json` file, they can't decrypt the SMTP credentials without the env var

**Important:** SMTP credentials are configured during server setup via CLI (step 0.6), **not** through the admin web UI. The web UI requires auth to function — it can't be used to configure the auth system itself.

- [ ] `AdminAuth` class created in `src/admin-auth.js`
- [ ] Password hashing with `crypto.scryptSync()` + random salt
- [ ] SMTP credentials encrypted with AES-256-GCM, key from `ADMIN_ENCRYPTION_KEY` env var
- [ ] Auth config stored in `data/runtime/admin-auth.json`
- [ ] `adminBaseUrl` field used for reset link generation, with request-header fallback

### 0.2 Add login and session endpoints

Add session-based auth for `/admin/*` API routes (see [Auth architecture](#auth-architecture-dual-middleware-model) for the full route matrix):

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/admin/login` | None (rate-limited) | Accept `{ email, password }`, verify against stored hash, return session token |
| `POST` | `/admin/logout` | Session token | Invalidate current session token |
| `POST` | `/admin/forgot-password` | None (rate-limited) | Accept `{ email }`, send reset link to configured admin email |
| `POST` | `/admin/reset-password` | None (validates reset token in body) | Accept `{ token, newPassword }`, verify reset token, update stored hash |

**Session tokens:**
- Generated with `crypto.randomBytes(32).toString('hex')` on successful login
- Stored in memory (Map of token -> expiry timestamp) — no disk persistence needed for sessions
- Expire after 8 hours of inactivity (sliding expiry, refreshed on each authenticated request)
- Sent by the client as `Authorization: Bearer <session-token>` (same header format as before, but now with a real token)

**Auth middleware update (`#AuthorizationMiddleware` at `web-api.js:90`):**

The existing middleware is updated to branch by path prefix:

```javascript
#AuthorizationMiddleware(ArgReq, ArgRes, ArgNext) {
  const RequestPath = ArgReq.path;

  // admin routes: delegate to session auth.
  if(RequestPath.startsWith('/admin/')) {
    // auth-exempt routes (login, status, recovery).
    const ExemptRoutes = ['/admin/login', '/admin/auth-status', '/admin/forgot-password', '/admin/reset-password'];
    if(ExemptRoutes.includes(RequestPath)) return ArgNext();

    // session token validation for all other /admin/* API routes.
    const AuthHeader = ArgReq.headers['authorization'];
    const Token = AuthHeader?.startsWith('Bearer ') ? AuthHeader.slice(7) : null;
    if(Token && this.#AdminAuth.ValidateSessionToken(Token)) return ArgNext();

    return ArgRes.status(200).json({ success: false, data: 'Forbidden.' });
  }

  // all other routes: legacy bearer token (unchanged behavior).
  const AuthHeader = ArgReq.headers['authorization'];
  if(AuthHeader && AuthHeader === `Bearer ${this.#BearerToken}`)
    return ArgNext();

  ArgRes.status(200).json({ success: false, data: 'Forbidden.' });
}
```

**Rate limiting on auth-exempt endpoints:**

In-memory rate limiter (no npm dependency) — simple Map of `IP -> { count, windowStart }`:

| Endpoint | Limit | Window | Lockout behavior |
|---|---|---|---|
| `POST /admin/login` | 5 attempts | 15 minutes | Returns `{ success: false, data: 'Too many attempts. Try again later.' }` |
| `POST /admin/forgot-password` | 3 attempts | 15 minutes | Same response (prevents email flooding) |

Rate limit state resets after the window expires. No persistent storage needed — restarting the app clears the counters (acceptable tradeoff for single-admin use).

- [ ] Login endpoint with password verification
- [ ] Session token generation and in-memory storage
- [ ] Sliding 8-hour session expiry
- [ ] Logout endpoint that invalidates session
- [ ] `#AuthorizationMiddleware` updated: session auth for `/admin/*`, legacy bearer for everything else
- [ ] Rate limiting on `/admin/login` (5/15min) and `/admin/forgot-password` (3/15min)
- [ ] Legacy `/workspace/*` and `/settings/*` bearer auth unchanged (backward compatible)

### 0.3 Build login page UI

**New file:** `public/admin/login.html` (or a login view within `index.html`)

Simple login form:
- Email field (pre-filled or validated against `devops@neochro.me`)
- Password field
- "Log in" button
- "Forgot password?" link

On successful login, store the session token in `sessionStorage` and redirect to the main admin editor view. On failure, show an error message.

- [ ] Login form with email and password fields
- [ ] Session token stored in `sessionStorage` on success
- [ ] Error feedback on invalid credentials
- [ ] "Forgot password?" link wired to reset flow

### 0.4 Add outgoing mailer with Nodemailer + Gmail SMTP

**New npm dependency:** `nodemailer`

This is the **only** new npm dependency in the entire P2 plan. Nodemailer is the standard Node.js email library — stable, well-maintained, no sub-dependencies that conflict with the existing stack.

**Mailer module:** `src/admin-mailer.js`

A thin wrapper around Nodemailer that:
- Reads SMTP config from `AdminAuth` (decrypting the Gmail App Password at runtime using the `ADMIN_ENCRYPTION_KEY` env var)
- Exposes a single method: `async SendEmailAsync(ArgTo, ArgSubject, ArgHtmlBody)`
- Uses Gmail SMTP relay: `smtp.gmail.com`, port 587, STARTTLS
- Sender address: `devops@neochro.me` (same account used for auth)

**Gmail App Password setup (one-time, manual):**
1. Enable 2FA on the `devops@neochro.me` Google account
2. Generate an App Password at https://myaccount.google.com/apppasswords
3. Provide the 16-character App Password during first-run setup (step 0.6)

**Vultr compatibility:** Uses port 587 (STARTTLS), which is **not blocked** by Vultr. Port 25 is blocked by default on Vultr, but 587 works fine for authenticated relay through Gmail.

- [ ] `nodemailer` added to `package.json` dependencies
- [ ] `AdminMailer` class created in `src/admin-mailer.js`
- [ ] SMTP credentials decrypted from `admin-auth.json` at runtime
- [ ] `SendEmailAsync()` method tested with Gmail relay on port 587

### 0.5 Add password reset flow

**Flow:**
1. User clicks "Forgot password?" on login page
2. UI calls `POST /admin/forgot-password` with `{ email }` (rate-limited: 3 requests / 15 min per IP)
3. Server checks `email` against stored `adminEmail` from config. Only matching emails trigger a reset email — but the response is always the same (no user enumeration).
4. Server generates a reset token (`crypto.randomBytes(32)`), stores it in memory with a 15-minute expiry
5. Server builds the reset link using `adminBaseUrl` from config (falls back to `req.protocol + '://' + req.get('host')` if not set): `{adminBaseUrl}/admin/reset-password.html?token=<reset-token>`
6. Server sends the email to the configured `adminEmail` via `AdminMailer`
7. User clicks link, enters new password on the reset page
8. UI calls `POST /admin/reset-password` with `{ token, newPassword }`
9. Server verifies the reset token, hashes the new password, saves to `admin-auth.json`, invalidates the reset token and all active sessions

**Security notes:**
- Reset tokens are single-use and expire after 15 minutes
- Only emails matching the stored `adminEmail` trigger a reset email (no user enumeration — always return same success message regardless)
- New password is hashed before storage (same `scryptSync` flow as initial setup)
- All existing sessions are invalidated on password change (forces re-login)
- Rate limited at the endpoint level (see Phase 0.2)

**Reset page:** `public/admin/reset-password.html` — simple form with "New password" + "Confirm password" fields.

- [ ] Reset token generation with 15-minute expiry
- [ ] Email sent with reset link via `AdminMailer`
- [ ] Reset page with new password form
- [ ] Password update + session invalidation on successful reset
- [ ] No user enumeration (constant-time response regardless of email match)

### 0.6 First-run setup and CLI password reset

On first startup (no `admin-auth.json` exists), the app needs an initial password and SMTP configuration. This is done via a **CLI setup script**, not the web UI.

**New script:** `scripts/admin-setup.js`

```
Usage: node scripts/admin-setup.js
```

Interactive prompts (via Node's built-in `readline`):
1. "Admin email" → defaults to `devops@neochro.me`
2. "Admin password" → entered twice for confirmation, hashed with scrypt
3. "Admin base URL" → defaults to `http://localhost:2020` (used for password reset links; set to production URL on server)
4. "Gmail SMTP user" → defaults to the admin email
5. "Gmail App Password" → the 16-character token from Google, encrypted with AES-256-GCM using `ADMIN_ENCRYPTION_KEY`

Writes `data/runtime/admin-auth.json` with all fields populated.

**Password reset via CLI** (for lockout recovery):

```
Usage: node scripts/admin-setup.js --reset-password
```

Prompts for new password only, updates the hash in `admin-auth.json`, preserves SMTP config.

**npm script:**
```json
"admin:setup": "node scripts/admin-setup.js",
"admin:reset": "node scripts/admin-setup.js --reset-password"
```

- [ ] `scripts/admin-setup.js` created with interactive prompts
- [ ] Initial setup writes complete `admin-auth.json`
- [ ] `--reset-password` flag for password-only reset
- [ ] npm scripts added: `admin:setup`, `admin:reset`
- [ ] Startup check: if `admin-auth.json` missing, log warning with setup instructions (don't crash)

### 0.7 First-run web welcome page with on-screen setup instructions

When `admin-auth.json` does not exist (first-time deployment or fresh install), the admin UI should show a **welcome/setup page** instead of the login form. This page does **not** allow password creation through the browser (that's the CLI's job for security) — it guides the user to run the CLI setup.

**New file:** `public/admin/setup.html`

**What the page shows:**

```
┌─────────────────────────────────────────────────────┐
│  🔧  Sleuth Admin — First-Time Setup                │
│                                                     │
│  The admin panel hasn't been configured yet.        │
│  Follow these steps to get started:                 │
│                                                     │
│  Step 1: Set your encryption key                    │
│  ─────────────────────────────────────────────      │
│  Add ADMIN_ENCRYPTION_KEY to your environment:      │
│                                                     │
│  # Generate a random key:                           │
│  node -e "console.log(require('crypto')             │
│    .randomBytes(32).toString('hex'))"               │
│                                                     │
│  # Add to your .env or systemd unit:                │
│  ADMIN_ENCRYPTION_KEY=<your-generated-key>          │
│                                                     │
│  Step 2: Run the setup script                       │
│  ─────────────────────────────────────────────      │
│  npm run admin:setup                                │
│                                                     │
│  This will prompt you for:                          │
│  • Admin email (default: devops@neochro.me)         │
│  • Admin password                                   │
│  • Gmail SMTP credentials (for password reset)      │
│                                                     │
│  Step 3: Restart the app                            │
│  ─────────────────────────────────────────────      │
│  npm run dev  (development)                         │
│  systemctl restart sleuth-app  (production)         │
│                                                     │
│  Then refresh this page to log in.                  │
│                                                     │
│  [Refresh Page]                                     │
└─────────────────────────────────────────────────────┘
```

**How it works:**

- The login page (`login.html`) makes a lightweight `GET /admin/auth-status` call on load
- The endpoint returns `{ configured: false }` if `admin-auth.json` doesn't exist, or `{ configured: true }` if it does
- If `configured: false`, the login page redirects to `setup.html`
- If `configured: true`, the login page shows the normal login form
- The setup page has a "Refresh Page" button that rechecks the status

**New endpoint:**

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/admin/auth-status` | Returns `{ configured: true/false }` — no auth required |

This endpoint is safe to expose without auth because it reveals no sensitive information — just whether setup has been completed.

- [ ] `public/admin/setup.html` created with step-by-step instructions
- [ ] `GET /admin/auth-status` endpoint returns configuration status
- [ ] Login page checks auth-status on load and redirects to setup if unconfigured
- [ ] Setup page has "Refresh Page" button to recheck after CLI setup completes

### 0.8 Gitignore and environment-specific credential strategy

**Current state:** `.gitignore` already ignores `data/runtime/` (line 10), which covers `admin-auth.json`. But the plan introduces additional files and environment variables that need explicit handling.

**Files and secrets to protect:**

| Asset | Where it lives | Gitignore status | Notes |
|---|---|---|---|
| `data/runtime/admin-auth.json` | `data/runtime/` | Already ignored | Hashed password + encrypted SMTP creds |
| `ADMIN_ENCRYPTION_KEY` | Environment variable | N/A (not a file) | Set in `.env` (dev) or systemd unit (prod) |
| `.env` file (dev) | Project root | **Needs to be added** | Local dev env vars |
| `.backup` files | `data/static/ai/` | **Needs to be added** | Runtime rollback snapshots |
| `data/runtime/settings.json` | `data/runtime/` | Already ignored | Global app settings |

**Changes to `.gitignore`:**

Add to the "Our Custom Settings" block:

```gitignore
# Admin credentials and environment
.env
.env.*
!.env.example

# AI asset rollback backups (runtime safety nets, not source)
data/static/ai/*.backup
```

The `!.env.example` exception ensures the template file is committed to source even though `.env.*` is ignored. Git processes rules top-to-bottom, so the negation must come after the glob.

**Environment-specific credential strategy:**

| Environment | `ADMIN_ENCRYPTION_KEY` source | `admin-auth.json` setup | SMTP relay |
|---|---|---|---|
| **Local dev** | `.env` file in project root | `npm run admin:setup` (local) | Gmail SMTP (port 587) or skip SMTP for dev-only |
| **Staging** | systemd unit `Environment=` directive or `/etc/sleuth/env` | `npm run admin:setup` on staging server | Gmail SMTP (port 587) |
| **Production (Vultr)** | systemd unit `Environment=` directive | `npm run admin:setup` on production server | Gmail SMTP (port 587) |

**Key principles:**

1. **The encryption key is never committed to source.** In dev, it's in `.env` (gitignored). In staging/production, it's in the systemd unit file or a protected env file outside the repo.
2. **Each environment runs its own `npm run admin:setup`.** The `admin-auth.json` is unique per environment — different passwords, potentially different SMTP configs.
3. **No credential file is shared between environments.** Each server generates its own salt, hash, and encrypted SMTP credentials. Compromising one environment's `admin-auth.json` does not help with another (different encryption keys).
4. **`.backup` files are environment-specific runtime artifacts.** They exist only on the server where an admin made an edit. They're gitignored so they don't accidentally get committed.

**Optional: `.env.example` template** (committed to source as a reference):

```
# Admin Panel Configuration
# Copy this to .env and fill in values — never commit .env itself

# Required: 32-byte hex key for encrypting SMTP credentials at rest
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_ENCRYPTION_KEY=

# Existing app env vars (if any) go here too
```

- [ ] `.env` and `.env.*` added to `.gitignore` with `!.env.example` exception
- [ ] `data/static/ai/*.backup` added to `.gitignore`
- [ ] `.env.example` template committed with placeholder instructions (verified not ignored by `!.env.example` rule)
- [ ] Documentation in this plan covers local dev / staging / production credential flow

---

## Phase 1: Backend API for AI Assets

### 1.1 Add AI asset CRUD endpoints

Add the following endpoints to `src/web-api.js`, protected by session token auth (see [Auth architecture](#auth-architecture-dual-middleware-model)):

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/admin/ai-assets` | List all files in `data/static/ai/` with metadata (name, size, modified date) |
| `GET` | `/admin/ai-assets/:filename` | Read file content as `{ success: true, data: { filename, content, type } }` |
| `PUT` | `/admin/ai-assets/:filename` | Save edited content back to disk after validation |

Implementation notes:
- All handlers follow existing patterns: `async #HandleGetAiAssetsAsync(ArgReq, ArgRes)` with try/catch returning `{ success, data }`
- Filenames must be validated against an allowlist — only known files in `data/static/ai/` are accessible (prevents path traversal)
- `PUT` should write to a temp file first, then rename (atomic write) to avoid corruption on crash
- The `PUT` handler should auto-run validation (see 1.2) before committing the write

**Allowlist:**
```
chat-instructions.md
reminders-instructions.md
reminders-dedup-instructions.md
date-extraction-instructions.md
reminders-schema.json
reminders-dedup-schema.json
date-extraction-schema.json
```

- [ ] Endpoints registered in constructor
- [ ] Path traversal protection via allowlist
- [ ] Atomic write (temp file + rename)
- [ ] Response format matches existing `{ success, data }` contract

### 1.2 Add server-side validation endpoint

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/admin/ai-assets/:filename/validate` | Validate content without saving |

Reuse the logic from `scripts/validate-ai-prompts.js` as a runtime function:
- For `.json` files: parse JSON, check `strict: true`, `name` field, `schema.additionalProperties: false`, `schema.required` array, required fields exist in properties
- For `.md` files: check non-empty, check required placeholders exist (e.g., `{{CURRENT_DATETIME_UTC}}` in chat-instructions, `{{MAIN_TIMEZONE}}` in date-extraction)
- Return `{ success: true, data: { valid: true, checks: [...] } }` or `{ valid: false, errors: [...] }`

- [ ] JSON schema validation (mirrors `validate-ai-prompts.js`)
- [ ] Markdown placeholder validation
- [ ] Returns structured validation results

### 1.3 Add static file serving

Add Express static middleware to serve the admin UI:

```javascript
this.#ExpressApp.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
```

This must be registered **before** the auth middleware for static assets, OR the admin page itself must include the bearer token in its API calls (recommended — keeps all API access authenticated, page is just static HTML).

Decision: **Static files served without auth, API calls require session token (Phase 0).** The admin page is just an HTML shell; all data access goes through authenticated API calls using the session token from Phase 0.2.

- [ ] Static middleware registered
- [ ] Auth only on API routes, not static files
- [ ] Serves from `public/admin/`

### 1.4 Single-depth backup and rollback

**Effort: Low.** This piggybacks on the atomic write flow already in 1.1. Before overwriting the current file, copy it to a `.backup` sibling. Only two copies ever exist per file: current and previous.

**Backup storage:**
```
data/static/ai/
  chat-instructions.md            -- current (live)
  chat-instructions.md.backup     -- previous snapshot (created on last save)
  reminders-instructions.md
  reminders-instructions.md.backup
  ...
```

**How it works in the `PUT` save flow:**
1. Validate new content (step 1.2)
2. Copy current file to `<filename>.backup` (overwriting any existing backup — single depth)
3. Atomic write new content to `<filename>` (temp file + rename)
4. Invalidate cache (Phase 3)

**New endpoints:**

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/admin/ai-assets/:filename/has-backup` | Check if a `.backup` file exists. Returns `{ success: true, data: { hasBackup: true/false, backupDate } }` |
| `POST` | `/admin/ai-assets/:filename/rollback` | Copy `.backup` back to the live file. The current live file becomes the new `.backup` (swap). Returns the restored content. |

**Rollback is a swap, not a delete:** When you roll back, the current (bad) version becomes the new backup, and the backup (good) version becomes current. This means you can roll back the rollback — one level of undo in both directions.

Implementation notes:
- `.backup` files are in the same directory as the originals — no new directories needed
- The allowlist from 1.1 applies to backup operations too (can't rollback files not on the list)
- Backup files are excluded from `npm run validate:ai` (the script checks specific filenames, not globs)
- `.backup` files should be added to `.gitignore` — they're runtime safety nets, not source-controlled artifacts

- [ ] `PUT` handler copies current file to `.backup` before writing
- [ ] `GET /has-backup` endpoint checks for `.backup` existence and modified date
- [ ] `POST /rollback` endpoint swaps `.backup` and current file
- [ ] `.backup` files added to `.gitignore`

---

## Phase 2: Lightweight Frontend

### 2.1 Create `public/admin/index.html`

Single-page admin interface. No framework, no build step.

Structure:
```
public/
  admin/
    index.html      -- main page shell, loads CSS + JS
    admin.css        -- layout and styling
    admin.js         -- all client-side logic (fetch API, editor init, save/validate)
```

On load, check `sessionStorage` for a session token. If none exists (or it's expired), redirect to the login page (Phase 0.3). All API calls include the session token as `Authorization: Bearer <session-token>`.

- [ ] `index.html` created with basic layout
- [ ] Session token check on load, redirect to login if missing
- [ ] No external dependencies except CodeMirror CDN

### 2.2 Build file browser sidebar

Left panel listing all AI asset files, fetched from `GET /admin/ai-assets`. Each item shows:
- Filename
- File type badge (`.md` / `.json`)
- Last modified timestamp

Clicking a file loads its content into the editor via `GET /admin/ai-assets/:filename`.

- [ ] File list fetched from API
- [ ] Click-to-load wired up
- [ ] Active file highlighted

### 2.3 Integrate CodeMirror editor

Use CodeMirror 5 from CDN (stable, no build step needed):
- Markdown mode for `.md` files
- JSON mode for `.json` files (with lint/error indicators)
- Line numbers, word wrap, dark/light theme toggle

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/codemirror.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/mode/markdown/markdown.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/mode/javascript/javascript.min.js"></script>
```

- [ ] CodeMirror loaded from CDN
- [ ] Mode switches based on file extension
- [ ] Line numbers and word wrap enabled

### 2.4 Save and validate buttons

Two action buttons above the editor:

- **Validate** — calls `POST /admin/ai-assets/:filename/validate` with current editor content. Shows pass/fail results inline below the editor.
- **Save** — calls `PUT /admin/ai-assets/:filename` with current editor content. Validation runs server-side before write. Shows success/error feedback.

Unsaved changes indicator: track dirty state by comparing editor content to last-loaded content. Show a visual indicator (e.g., dot on the filename tab) when there are unsaved changes. Warn before navigating away with `beforeunload`.

- [ ] Validate button with inline results display
- [ ] Save button with success/error feedback
- [ ] Dirty state tracking and unsaved changes warning

### 2.5 Rollback button

A **Rollback** button in the editor toolbar, next to Save and Validate. Behavior:

- **Disabled** when no `.backup` exists for the current file (checked via `GET /has-backup` when file is loaded)
- **Enabled** when a backup exists — shows the backup date as a tooltip (e.g., "Restore version from Feb 28, 2:15 PM")
- **On click:** confirmation prompt ("Restore previous version? Your current version will become the new backup."), then calls `POST /admin/ai-assets/:filename/rollback`
- **After rollback:** reloads the editor with the restored content, re-checks backup availability, triggers cache invalidation, shows success feedback

- [ ] Rollback button with disabled/enabled state based on backup existence
- [ ] Confirmation prompt before rollback
- [ ] Editor reloads with restored content after rollback
- [ ] Cache invalidation triggered on rollback (same as save flow)

---

## Phase 3: Cache Invalidation and Live Reload

This is the critical phase — without it, saved changes don't take effect until the app restarts.

### 3.1-3.2 Add `InvalidateInstructionCache()` to modules

Add a public method to each module that clears its cached instruction/schema fields. On the next AI/deterministic call, the existing lazy-load pattern (`if(!this.#Field)`) will re-read from disk automatically.

**ChatModule** (`src/chat-module.js`):

ChatModule caches **both** AI instructions (`#SystemInstructionsTemplate`, line 63) **and** deterministic responses (`#DeterministicResponsesByPhrase`, line 69). The invalidation method must clear both:

```javascript
InvalidateInstructionCache() {
  this.#SystemInstructionsTemplate = null;
  this.#DeterministicResponsesByPhrase = null;
}
```

This single method covers:
- AI instruction file edits (Phase 1-3) — clears `#SystemInstructionsTemplate`
- Deterministic response edits (Phase 4) — clears `#DeterministicResponsesByPhrase`

**RemindersModule** (`src/reminders-module.js`):
```javascript
InvalidateInstructionCache() {
  this.#RemindersInstructions = null;
  this.#RemindersSchema = null;
  this.#DedupInstructions = null;
  this.#DedupSchema = null;
  this.#DateExtractionInstructions = null;
  this.#DateExtractionSchema = null;
}
```

- [ ] `ChatModule.InvalidateInstructionCache()` clears both `#SystemInstructionsTemplate` and `#DeterministicResponsesByPhrase`
- [ ] `RemindersModule.InvalidateInstructionCache()` clears all 6 cached instruction/schema fields
- [ ] Existing lazy-load pattern handles re-read automatically (no additional reload logic needed)

### 3.3 Wire invalidation into the save flow

The `WebAPI` class needs access to the module instances to call their invalidation methods.

**Multi-tenant context:** `app.js` creates **one module instance per workspace** and stores them in arrays (`ChatModules[]` at line 156, `RemindersModules[]` at line 157). AI instruction files are shared across all workspaces (they live in `data/static/ai/`, not per-workspace), so invalidation must iterate **all** instances.

**Approach:** Pass the existing module arrays to the `WebAPI` constructor (extends the existing pattern of passing `WorkspaceStatsMap` and `SettingsModule`):

```javascript
// in app.js, after the workspace loop completes (line 250):
const ApiServer = new WebAPI(2020, "test", WorkspaceStatsMap, SettingsModuleInstance, ChatModules, RemindersModules);
```

In `web-api.js`, store these as `#ChatModules` and `#RemindersModules` private fields. In the save/rollback handlers, after a successful write:

```javascript
#InvalidateInstructionCaches(ArgFilename) {
  // AI instruction files: invalidate based on filename prefix.
  if(ArgFilename.startsWith('chat-')) {
    for(const Module of this.#ChatModules) Module.InvalidateInstructionCache();
  }
  if(ArgFilename.startsWith('reminders-') || ArgFilename.startsWith('date-extraction-')) {
    for(const Module of this.#RemindersModules) Module.InvalidateInstructionCache();
  }
}
```

For deterministic response edits (Phase 4), the `PUT /admin/deterministic-responses` handler calls:
```javascript
for(const Module of this.#ChatModules) Module.InvalidateInstructionCache();
```

This works because `ChatModule.InvalidateInstructionCache()` clears both `#SystemInstructionsTemplate` and `#DeterministicResponsesByPhrase` (see 3.1-3.2).

- [ ] `WebAPI` constructor accepts `ChatModules[]` and `RemindersModules[]` arrays
- [ ] `#InvalidateInstructionCaches(ArgFilename)` helper iterates all workspace instances
- [ ] `PUT /admin/ai-assets/:filename` calls `#InvalidateInstructionCaches` after save
- [ ] `POST /admin/ai-assets/:filename/rollback` calls `#InvalidateInstructionCaches` after swap
- [ ] `PUT /admin/deterministic-responses` calls `InvalidateInstructionCache()` on all ChatModule instances

### 3.4 Reload confirmation in UI

After a successful save + invalidation, the API response should include a `cacheInvalidated: true` field. The UI shows a brief confirmation message: "Saved and reloaded — changes are live."

- [ ] API response includes cache invalidation status
- [ ] UI shows confirmation feedback

---

## Phase 4: Deterministic Responses Editor

### 4.1 CRUD endpoints for deterministic responses

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/admin/deterministic-responses` | Read all entries |
| `PUT` | `/admin/deterministic-responses` | Save entire entries array (overwrite) |

The file is small (3 entries, ~40 lines) — full-file read/write is simpler and safer than per-entry patching.

**Cache invalidation:** The `PUT` handler calls `InvalidateInstructionCache()` on all `ChatModule` instances after a successful write (see Phase 3.3). This clears `#DeterministicResponsesByPhrase` across all workspaces. The lazy-load pattern in `#GetDeterministicResponseMapAsync()` (chat-module.js:493) re-reads from disk on the next message.

- [ ] GET endpoint returns parsed entries array
- [ ] PUT endpoint validates and writes back to disk
- [ ] Atomic write pattern (temp file + rename)
- [ ] PUT handler triggers `InvalidateInstructionCache()` on all ChatModule instances (Phase 3.3)

### 4.2 Structured form UI

Instead of a raw JSON editor, build a simple form-based UI for deterministic responses:

Each entry shows:
- **Description** (text input)
- **Phrases** (editable list — add/remove phrase inputs)
- **Case insensitive** (checkbox)
- **Response type** (dropdown: `static-text`, `reminders-for-user`, `version`)
- **Type-specific fields** (conditional inputs based on response type)

Plus "Add new entry" and "Remove entry" buttons.

- [ ] Entry list with editable fields
- [ ] Add/remove entry controls
- [ ] Response type dropdown with conditional fields

### 4.3 Entry validation

Before save, validate:
- Every entry has at least one non-empty phrase
- Every entry has a `response.type` that matches a known type
- `static-text` entries have a non-empty `text` field
- `reminders-for-user` entries have a `userMention` field
- No duplicate phrases across entries

- [ ] Client-side validation before submit
- [ ] Server-side validation before write
- [ ] Error messages shown inline per entry

---

## Phase 5: Post-Build Verification and Release

- [ ] `npm run build` — type check passes (new endpoints, method signatures, JSDoc types)
- [ ] `npm run dev` — startup smoke test, confirm `/admin` serves HTML and API endpoints respond
- [ ] `npm run validate:ai` — existing AI asset validation still passes
- [ ] Manual test: run `npm run admin:setup`, confirm `admin-auth.json` created with hashed password and encrypted SMTP credentials
- [ ] Manual test: log in with correct password, confirm session token issued
- [ ] Manual test: log in with wrong password, confirm rejection
- [ ] Manual test: trigger password reset, confirm email received at `devops@neochro.me`, reset password via link
- [ ] Manual test: navigate to `/admin` before setup — confirm welcome page appears with setup instructions
- [ ] Manual test: run `npm run admin:setup`, refresh `/admin` — confirm login page appears
- [ ] Manual test: confirm existing `/workspace/*` API endpoints still work with the original bearer token
- [ ] Manual test: load admin UI in browser, authenticate, open a markdown file, edit, validate, save
- [ ] Manual test: confirm saved instruction change takes effect on next AI call (cache invalidation works)
- [ ] Manual test: save a file, confirm `.backup` is created, click Rollback, confirm original content is restored and cache invalidates
- [ ] Manual test: edit a JSON schema, introduce an error, confirm validation catches it
- [ ] Manual test: edit deterministic responses, add a new entry, confirm it works in Slack
- [ ] Bump version in `package.json`
- [ ] Update `CHANGELOG.md` with feature description
- [ ] Update `AGENTS.md` Section 5 (Web API Contract) with new `/admin/*` endpoints
- [ ] Update `docs/web-api.md` with new endpoint documentation
- [ ] Verify `.gitignore` includes `.env`, `.env.*`, and `data/static/ai/*.backup`
- [ ] Verify `.env.example` is committed with placeholder instructions

---

## AGENTS.md Compliance Notes

| AGENTS.md Section | Status | Notes |
|---|---|---|
| 0.1 Guardrails | Aligned | Extends `web-api.js` surgically; new modules (`admin-auth.js`, `admin-mailer.js`) follow existing patterns |
| 0.2 Dependency contract | Aligned | One new npm dependency (`nodemailer`); CodeMirror loaded from CDN; no circular imports |
| 1 Pre-build | Aligned | Module owners: `web-api.js` (endpoints), `admin-auth.js` (auth), `admin-mailer.js` (email), `chat/reminders-module.js` (cache) |
| 4 Data persistence | Aligned | New file `data/runtime/admin-auth.json` follows existing `data/runtime/` convention |
| 5 Web API contract | Update needed | New `/admin/*` endpoints must be documented in `docs/web-api.md` |
| 6 Coding conventions | Must follow | PascalCase methods, `Arg` prefix params, `Async` suffix, JSDoc conventions |
| 7 Observability | Aligned | Log login attempts, password resets, save/validate/invalidate operations via existing logger |
| 8 Post-build | Phase 5 | Explicit `npm run build` + `npm run dev` + `npm run validate:ai` + manual auth + editor checks |
| 11 Key paths | Aligned | Changes in `src/web-api.js`, `src/app.js`, `src/admin-auth.js` (new), `src/admin-mailer.js` (new), `src/chat-module.js`, `src/reminders-module.js` |
| 12 Configuration | Aligned | SMTP config in `data/runtime/admin-auth.json`; encryption key in env var (`ADMIN_ENCRYPTION_KEY`); `.env.example` committed as reference |
| 15 Anti-patterns | Aligned | No React/Vite/build pipeline; vanilla HTML/CSS/JS frontend; password never in source; secrets not hardcoded; `.env` gitignored |

---

## Future Considerations (Out of Scope)

These are explicitly **not** part of this plan but worth noting for future iterations:

- **Deep version history / diff view:** Multi-version history with git commits on save, side-by-side diff in UI (single-depth rollback is already in scope)
- **Model configuration editor:** Make `MODEL_CONFIGURATIONS` data-driven (move to JSON file) so it can be edited from the UI
- **Multi-user / role-based auth:** Multiple admin accounts with different permission levels
- **Workspace-specific overrides:** Allow per-workspace instruction overrides (currently all workspaces share the same instruction files)
- **Live preview:** Show how a prompt + schema would render in an actual OpenAI call (dry-run mode)
