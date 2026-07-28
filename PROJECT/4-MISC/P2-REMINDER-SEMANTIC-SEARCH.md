# Project Plan: Semantic Search over Sleuth Reminders

## Goal
Let users find reminders by meaning, not just exact keywords — including closed/completed ones — via a `search-reminders <query>` command. The current keyword search misses synonyms, paraphrases, and typos, and Slack's built-in search is unreliable enough that important historical context is effectively lost.

## Effort Level
Medium. The project already operates a working sqlite + `sqlite-vec` RAG stack (`src/rag/`), so we reuse the storage pattern. The embedding provider is **OpenAI** (`text-embedding-3-small`) since OpenAI is currently the default LLM for the project; the existing `OPENAI_API_KEY` is reused. Phase 0 is a standalone spike to validate quality before building the full feature, because OpenAI embeddings have given mixed results in past attempts.

## Design Principles
- **Validate before building** — Phase 0 spike must show that OpenAI embeddings actually retrieve the right reminders for paraphrased / synonym queries on a representative sample. If the spike fails the bar, fall back to `gemini-embedding-001` before continuing.
- **Event-driven, not nightly** — embed on `create`/`update`/`complete`/`cancel`, with a daily reconciliation sweep as a safety net only. Re-vectorizing the entire archive every night is wasteful and gets expensive as the closed-reminder set grows.
- **Hybrid search, not pure semantic** — keyword and vector results are both produced and merged by reciprocal-rank-fusion (RRF). Queries like `PR #1234`, `<@octo-dev>`, or specific dates must still hit exactly. Pure semantic ranking degrades these.
- **Per-workspace tenancy** — same strict pattern as `GEMINI_API_KEY` / `OPENAI_API_KEY`. Each workspace gets its own sqlite vector store keyed by workspace name, no global state.
- **Closed reminders included by default** — that's where the search-pain actually is; live reminders are usually findable via `show my reminders`.

## Phase 0: OpenAI Embeddings Spike (do this first)

**Goal:** prove that `text-embedding-3-small` actually retrieves the right reminders for realistic paraphrased / synonym / typo queries on this workspace's data, before any production code is written.

**Why a spike, not just trust the docs:** past attempts with OpenAI embeddings returned poor recall on short, jargon-heavy text. Reminders are exactly that shape — short, often containing project nicknames, internal abbreviations, and `<@U…>` mentions. Worth a 1-day validation.

### Spike Deliverables

A standalone, throwaway script at `scripts/spike-reminder-embeddings.mjs` that:

1. **Loads** ~200–500 real reminders from an existing `data/runtime/workspaces/<workspace>_reminders.json` (read-only — no writes back to that file).
2. **Synthesizes embed text** using the same template the production module will use (`[Status] <title> · assigned to <name> · channel <name> · due <date>`), resolving Slack IDs to display names where possible.
3. **Embeds all reminders** with `text-embedding-3-small` in batches (the API supports up to 2048 inputs per call).
4. **Stores the vectors** in an in-memory array (no sqlite needed for the spike — keep it simple).
5. **Runs an eval set** of ~15–25 hand-picked query/expected-result pairs, capturing for each:
   - The 5 nearest neighbors by cosine similarity.
   - Whether the expected reminder is in top-1 / top-5 / top-10.
   - Side-by-side comparison vs current keyword search results.
6. **Reports** a summary table: per-query rank of expected hit (keyword vs semantic), recall@5 and recall@10 across the eval set, total embed cost, total wall-clock time for the batch embed.

### Eval Set Construction

The eval set is the most important artifact — and it's manual. Pull 15–25 representative pain cases from your own memory of "I knew there was a reminder about X but couldn't find it." Categories to include:

- **Paraphrase** — query uses different words than the reminder ("billing migration" → reminder says "switch payment provider").
- **Synonym** — ("PR review" → "code review").
- **Typo** — ("kustomer" → "customer").
- **Project nickname** — internal slang that may not embed well ("the Vegas thing" → reminder mentions a specific client).
- **Mention-based** — query is `<@U…>`; this should fail semantic and succeed keyword (validates the case for hybrid).
- **Exact-phrase** — query is a literal token like `PR #1234`; same as above.

### Pass/Fail Bar

- **Pass** if semantic recall@5 ≥ 70% on paraphrase/synonym/typo categories *and* the mention/exact-phrase categories degrade only marginally (proving the case for the hybrid merge).
- **Soft fail** (recall 50–70%): proceed but flag in the plan that hybrid weighting needs to lean keyword-heavy.
- **Hard fail** (recall < 50%): switch the production plan to `gemini-embedding-001` and re-run the same eval before continuing.

### Spike Cost & Effort
- ~1 day of work, maybe less if a reminder JSON is readily available.
- ~$0.001–$0.005 in API spend at current `text-embedding-3-small` pricing for 500 reminders + 25 query embeddings.
- Throwaway code — the script does not need tests, polish, or merging. Output (the eval-set markdown table) is the artifact that gets attached to this plan.

### Spike Exit Decision
Update this doc with a "Phase 0 Result" section recording: model used, recall numbers per category, decision (proceed with OpenAI / proceed with Gemini / abandon), and any embed-text refinements suggested by what the spike revealed.

---

## Implementation Steps (Phase 1+, gated on Phase 0 passing)

### 1. Workspace Config (`src/workspaces.js`, `config/workspace-template.json`)
- Add typedef + validation for new optional fields:
  - `REMINDER_SEARCH_ENABLED` — `'true'`/`'false'` flag, defaults to false (existing tenants unaffected).
  - `REMINDER_SEARCH_EMBED_MODEL` — defaults to `text-embedding-3-small` (OpenAI is the project default LLM); accept `gemini-embedding-001` as an alternative if Phase 0 forces a switch.
- Reuse the existing `OPENAI_API_KEY` (or `GEMINI_API_KEY` if the model override points at Gemini). No new key required for the default path.

### 2. New Module: `src/reminder-search-module.js`
Responsible for the vector-index lifecycle and search execution. Mirrors the structure of `src/rag/`:

- **Storage:** sqlite file at `data/runtime/workspaces/<workspace>_reminder_index.sqlite`, with two tables — `reminders(reminder_id PRIMARY KEY, workspace_name, status, updated_at, embed_text)` and `reminders_vec(rowid, embedding float[1536])` (dim matches `text-embedding-3-small`; switch to `float[768]` if Phase 0 forces a fall back to `gemini-embedding-001`). The `workspace_name` column is defense-in-depth — see Multi-Tenant Security below.
- **Embed text:** synthesized per reminder as `[Status] <title/text> · assigned to <name> · created by <name> · channel <name> · due <date>`. Channel/user names resolved via the existing slack-app helpers so embeddings include human-readable context, not just IDs.
- **Public API:**
  - `IndexReminderAsync(reminder)` — upsert single reminder.
  - `RemoveReminderAsync(reminderId)` — delete from both tables.
  - `SearchAsync(query, { userId, includeClosed, limit })` — returns ranked `[{ reminder, score, matchType }]`. `matchType` is `'keyword'`, `'semantic'`, or `'both'` for UI hinting.
  - `ReconcileAsync()` — sweep: find reminders in the source-of-truth JSON not in the index (or stale by `updated_at`), embed the diff. Used by the daily sweep and for first-run backfill.

### 3. Embedding Hook Integration (`src/reminders-module.js`)
- After every successful state transition that the FSM commits to disk (`create`, `update`, `complete`, `cancel`, `snooze`), call `ReminderSearchModule.IndexReminderAsync` (or `RemoveReminderAsync` for hard deletes).
- Failure is **isolated** — index errors must not block the reminder write. Warn-log and let the daily reconcile fix it.
- On module start, kick off a one-shot background `ReconcileAsync()` to backfill historical reminders the first time the feature is enabled.

### 4. Daily Reconcile (`src/reminders-module.js`)
- Append a call to `ReminderSearchModule.ReconcileAsync()` to the existing daily-digest scheduler hook (where the GitHub-digest plan also hooks). Cheap if nothing drifted; resilient if an embed call failed mid-day.
- Skip silently if `REMINDER_SEARCH_ENABLED` is false.

### 5. Hybrid Search (`src/reminder-search-module.js`)
- Run keyword search and vector search **in parallel** against the same `embed_text` column.
- Merge with **reciprocal-rank-fusion**: `score = sum(1 / (k + rank_i))` across the two result lists, default `k=60`. Simple, well-studied, no tuning required.
- Tag results with `matchType` so the Slack rendering can show `:mag:` for keyword hits and `:brain:` for semantic-only hits.
- Cap to top N results (default 10).

### 6. Slack Command (`src/chat-module.js`)
- Add `@Sleuth AI search-reminders <query>` (with `reminders-search` reverse alias for symmetry with `web-search`/`search-web`).
- Default scope: reminders involving the requesting user, includes closed by default. Modifiers:
  - `search-reminders all <query>` — workspace-wide (admin-only).
  - `search-reminders open <query>` / `search-reminders closed <query>` — status filter.
- Render results identically to existing `show reminders` output, with a small footer noting how many were keyword vs semantic matches.
- Update `HELP.md` and the commands list.

### 7. Cost & Privacy Note
- One embed per reminder mutation on `text-embedding-3-small` is fractions of a cent (~$0.00002 per reminder at current pricing). A 10k-reminder backfill is ~$0.20 — flag in the PR description so it isn't a surprise on first enable.
- Reminders contain user-authored Slack content. Embeddings are stored locally in the per-workspace sqlite file; no third-party vector DB. Only the embedding API call leaves the host (same trust boundary as the existing RAG module).

### 8. Multi-Tenant Security (must-have, not optional)

Reminders may contain confidential information (deal names, internal incidents, customer details). A leak between workspaces would be a serious trust violation. The following safeguards are layered defense — any single one failing must not be sufficient to leak data.

**Layer 1 — Per-workspace module instance, no singletons.**
- `ReminderSearchModule` is constructed once per workspace, the same lifecycle as `WorkspaceAI`. Workspace name is captured at construction and never reassigned.
- No static caches, no module-level mutable state, no shared sqlite connection pool. Each instance owns exactly one sqlite handle bound to its own file.

**Layer 2 — Path traversal hardening.**
- The sqlite file path is built as `path.join(RuntimeDir, 'workspaces', `${SafeWorkspaceName}_reminder_index.sqlite`)`, where `SafeWorkspaceName` is validated against `^[a-z0-9-]+$` (matches the existing workspace naming convention). Any workspace name containing `/`, `\`, `.`, `..`, null bytes, or control characters is **rejected at module construction with a thrown error** — the module never starts.
- After joining, assert the resolved real path still lives under the runtime workspaces directory; if `path.relative(RuntimeDir, ResolvedPath)` starts with `..`, throw.

**Layer 3 — Defense-in-depth column on every row.**
- Every row in `reminders` carries `workspace_name`. Every read query includes `WHERE workspace_name = ?` bound to `this.WorkspaceName`. This is redundant with the per-file isolation but catches bugs where the wrong sqlite file is opened (e.g. a misconfigured backup-restore, a future migration that consolidates files).
- `INSERT`s set `workspace_name` from `this.WorkspaceName`, never from the reminder object — so a poisoned reminder JSON cannot smuggle a foreign workspace name into the index.

**Layer 4 — SearchAsync contract.**
- `SearchAsync` is a method on the per-workspace instance. There is no `SearchAcrossWorkspacesAsync` — we explicitly do not build the API surface that would make cross-tenant queries possible.
- Vector search joins back to the `reminders` table and re-applies the `workspace_name` filter before returning rows, so even if `sqlite-vec` returned a foreign rowid (it can't, given file isolation, but suspenders + belt) it would be filtered.
- Within a workspace, `SearchAsync({ userId })` further applies the existing `#GetRemindersInvolvingUserID` visibility rules so a regular user can't see reminders they wouldn't see via `show my reminders`. Admin-only `search-reminders all` bypasses this *within* the workspace only.

**Layer 5 — Embedding API isolation.**
- Embed-batch calls never combine reminders from different workspaces in one API request. Each workspace's reconcile/index call uses its own client invocation. (Even though OpenAI doesn't store request inputs by default, request-level isolation is the simplest mental model and removes a class of "did batching merge tenants" bugs.)
- The OpenAI client is instantiated per-workspace using the workspace's own `OPENAI_API_KEY`. No global client reuse.

**Layer 6 — Logging redaction.**
- Embed text and search query strings are **not** logged at INFO level. DEBUG level logs only the workspace name + a SHA-256 hash of the query (so log files cannot become a cross-tenant content aggregation surface).
- Errors that bubble up to logs include workspace name and reminder ID but not embed text.

**Layer 7 — Reconcile isolation.**
- `ReconcileAsync` reads from `data/runtime/workspaces/<workspace>_reminders.json` only — the path is derived from `this.WorkspaceName` the same way as the index path, with the same validation. There is no globbing of the workspaces directory.
- Two workspaces' reconciles can run concurrently; each must touch only its own JSON and DB. Verified by a dedicated leak test (see §9).

### 9. Testing

**Functional**
- Unit-test the embed-text synthesis (snapshots), the RRF merge, and the matchType tagging.
- Integration-test the `IndexReminderAsync` → `SearchAsync` round-trip with a fixture sqlite file.
- Test that an embedding API failure during a state transition does **not** prevent the reminder from being persisted.
- Test that `ReconcileAsync` correctly backfills missing rows and updates stale ones.

**Multi-tenant leak tests (mandatory — block release if any fail)**

A dedicated `tests/reminder-search-multitenant.test.js` suite explicitly attempts the leak scenarios:

- **Two-workspace round-trip:** construct two `ReminderSearchModule` instances (`acme`, `globex`), index distinct reminders into each, then call `SearchAsync` on each and assert: every result row's `workspace_name` matches the queried workspace; no `acme` reminder ID appears in `globex`'s results across 100 randomized queries; vice versa.
- **Path traversal rejection:** assert construction throws on workspace names `../evil`, `acme/../globex`, `acme\0`, `acme\n`, `Acme` (uppercase rejected), `'`, empty string, and very long names.
- **Path containment assertion:** stub a malicious workspace name that passes regex but resolves outside the runtime dir (use a symlink in test setup); assert the runtime path-containment check rejects it.
- **Defense-in-depth:** open `acme`'s sqlite file directly in test setup, manually `INSERT` a row with `workspace_name = 'globex'`, then call `acme`'s `SearchAsync` for that row's content — assert the row is filtered out (the `WHERE workspace_name = 'acme'` clause kicks in).
- **Concurrent reconcile isolation:** kick off `acme.ReconcileAsync()` and `globex.ReconcileAsync()` in `Promise.all`, with each workspace's reminders JSON populated with sentinel content; assert `acme`'s sqlite contains only `acme`'s sentinels and `globex`'s contains only `globex`'s.
- **Embedding-batch isolation:** mock the OpenAI client; assert that during a reconcile batch, every `embeddings.create` call's input array contains content only from one workspace. Cross-tenant batching → fail.
- **Logging redaction:** capture all log output during a search; assert the raw query string and embed text are not present anywhere in INFO-level logs.
- **Cross-workspace API surface absence:** static assertion (or `expect(ReminderSearchModule.prototype).not.toHaveProperty('SearchAcrossWorkspacesAsync')`) so a future contributor adding a cross-tenant method trips a test.

**Leak scanner (CI-integrated)**

A small standalone script `scripts/scan-multitenant-leaks.mjs` runs in CI on every PR that touches `src/reminder-search-module.js` or `src/reminders-module.js`:

- AST-parses the module file and asserts: no `static` properties on the class hold mutable state; no module-level `let`/`var` other than imports/constants; every public method either takes no args or its first action references `this.WorkspaceName`.
- Greps for forbidden patterns in the module: literal workspace names, `process.env.WORKSPACE_*`, hard-coded paths, `glob(`, `readdir` of the workspaces directory.
- Greps log call-sites for INFO-level logs that include `embed_text` or raw `query` variable names.

The scanner is intentionally heuristic — it catches obvious regressions, not a determined adversary. The functional leak tests are the real guarantee; the scanner is a fast pre-PR check.

### 10. Versioning & CHANGELOG
- Bump version, document the new `search-reminders` command, the `REMINDER_SEARCH_ENABLED` flag, and the per-workspace sqlite file location.

## Open Questions
- **Embedding provider** — *Decided.* `text-embedding-3-small` (OpenAI) since OpenAI is the project default LLM and `OPENAI_API_KEY` is already required. Phase 0 spike validates this works on real data; falls back to `gemini-embedding-001` if recall is poor.
- **Per-user index vs shared index** — a shared index per workspace with userId filtering at query time is simpler and cheaper; per-user indexes would complicate writes for shared/assigned reminders. v1: shared, filter at query.
- **Index corruption recovery** — if the sqlite file is deleted or corrupt, `ReconcileAsync` will rebuild from the JSON source of truth on next run. Worth a `@Sleuth AI rebuild reminder index` admin command for explicit recovery.
- **Snippet extraction** — should results show a highlighted snippet of the matching text? Nice-to-have; not needed for v1.

## Future Extensions (not v1)
- Cross-workspace search for users who belong to multiple Sleuth tenants.
- Embed thread context alongside the reminder text (much richer signal — e.g. a reminder created from a long thread becomes searchable by anything anyone said in that thread).
- Use the index to power smarter duplicate detection on reminder creation (replace or augment the current `:gemini:` reaction logic).
- Auto-link related closed reminders when a new similar reminder is created ("you completed something similar last month — link?").
