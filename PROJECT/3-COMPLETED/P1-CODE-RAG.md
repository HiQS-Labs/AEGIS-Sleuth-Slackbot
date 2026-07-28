---
title: P1 — Sleuth Code RAG (ask-self)
date: 2026-04-15
branch: feat/code-rag
status: mvp-complete
owner: noel
---

> **Status 2026-04-15:** MVP built and tested locally. Ingest works (144 chunks, ~13s), end-to-end query works with `gemini-pro-latest`, all 254 Jest tests pass (11 new tenancy regression tests + 243 pre-existing, zero regressions), CI static check added. Still TODO: deploy ingest + env var to dev server, live Slack smoke test with Neochrome + one outsider workspace, update deployment docs.

# P1 — Sleuth Code RAG ("ask-self")

Let the marketing team ask Sleuth questions *about itself* from inside Slack. Meta-RAG: Sleuth indexes its own codebase + CHANGELOG + GitHub PRs, then answers product / PMF / marketing questions grounded in that corpus.

## Goals

- **Same-day MVP** — working end-to-end by tonight on `feat/code-rag`.
- **Not throwaway** — ingestion script, query module, and prompts file live in the repo and are re-runnable.
- **Single runtime** — pure Node/TS; no Python sidecar.
- **Gemini-only** — Gemini embeddings for indexing, Gemini Pro for orchestration/synthesis.
- **Neochrome-only tenancy** — Sleuth is multi-tenant; `ask-self` is the **only** command that exposes Sleuth's own codebase / strategy / PR internals. It MUST be hard-gated to the Neochrome workspace. Other tenants invoking it get no response, no Gemini call, no sqlite read. (The raw inbound mention is still logged by `SlackApp`'s generic app_mention logger, which is fine — same as any other mention. See Tenancy gate section for the honest scope.)

## Non-goals (explicit v2)

- Hierarchical agentic reasoning (multi-step tool-calling loops). Replaced by a **static feature-map pass** during ingest.
- Reranking, hybrid BM25+vector search.
- Per-user auth-gating *within* Neochrome (any workspace member can ask — user-level gating is v2).
- CI-driven index rebuild on merge to main.
- PR comment threads (v1 uses PR body only).

## Tenancy gate (non-negotiable)

**Threat model:** Sleuth runs in multiple customer workspaces. The RAG index contains Sleuth's full source, CHANGELOG, PR bodies, and `PROJECT/**` strategy docs (competitive positioning, ICP, moat analysis). Leaking any of that to a non-Neochrome workspace is a product and business incident.

**Scope of "invisibility" — honest version:**

A prior draft of this plan asked for "no log line that would reveal the command exists." After reading [src/slack-app.js:742-744](../../src/slack-app.js#L742-L744), that's not achievable without butchering `SlackApp`'s generic `app_mention` logging, which would hurt observability for everything else. **Corrected scope:** the raw mention text is logged by `SlackApp` the same way every other mention is — that's inherent to operating a Slack bot. What the gate DOES guarantee for non-Neochrome workspaces:

- Zero response posted (nothing in any channel they can see)
- Zero `RagModule` code path entered
- Zero Gemini API calls (no cost, no data in transit)
- Zero sqlite reads (no index access)
- Zero workspace-breaking side effects if `NEOCHROME_TEAM_ID` is unset (fail-closed for `ask-self` only, not for Sleuth as a whole)

An attacker who types `@Sleuth ask-self ...` in their own workspace will show up in that workspace's own `SlackApp` logs as a normal mention — exactly as they would if they had typed anything else at Sleuth. That's fine. What they will NOT get is any exfiltration of Sleuth's internal corpus.

**Team ID plumbing — this codebase does NOT put `team` on the mention event.** [src/slack-app.js:734-740](../../src/slack-app.js#L734-L740) strips the raw Bolt event down to `{channel, text, ts, thread_ts, user}`. `ChatModule` never sees `team_id`. Each `SlackApp` instance is already workspace-scoped (it runs its own `auth.test()` at startup, [src/slack-app.js:215](../../src/slack-app.js#L215)) so tenancy is determined by *which `SlackApp` instance is handling the event*, not by a field on the event itself.

**Correct implementation path:**

1. **Capture `team_id` once at `SlackApp.StartAsync()`**, right next to the existing `user_id` capture at [src/slack-app.js:225](../../src/slack-app.js#L225). Store as a private field and expose via a read-only getter (e.g., `slackApp.TeamId`). This is a ~3-line change to `SlackApp` and costs zero per-event overhead.
2. **`ChatModule`'s `ask-self` branch calls `RagModule.askSelf(query, ArgSlackApp.TeamId)`** — passing the known-for-this-instance team ID. No event-payload plumbing, no Bolt-to-ChatModule contract change.
3. **Module-level guard in [src/rag-module.js](../../src/rag-module.js).** `askSelf(query, teamId)` requires the team_id argument and throws `TenancyError` unless `teamId === process.env.NEOCHROME_TEAM_ID` (strict equality, no trimming, no case folding, both sides must be non-empty strings).
4. **Fail-closed, but ONLY for `ask-self`.** If `NEOCHROME_TEAM_ID` is unset, `rag-module.js` does NOT throw at import — that would break Sleuth startup for every workspace. Instead, `askSelf()` throws `TenancyError` on first call and the handler catches it as a silent no-op. Missing env var = ask-self is inert everywhere, normal chat still works everywhere.
5. **Lazy-load the module.** `chat-module.js` does `const RagModule = require('./rag-module')` **inside** the ask-self branch, not at the top of the file. Extra insurance that a buggy rag-module load never poisons non-Neochrome startup paths.

**Gate placement in the handler — only the ask-self branch, not the function entry.** A prior draft had `if (teamId !== NEOCHROME) return` at the top of `OnAppMentionAsync`, which would have disabled `help`, `commands`, `run-diagnostics`, and normal chat fallback for every other tenant. The gate must live strictly **inside** the ask-self regex branch, after other branches have had their chance.

**Team ID source for the env var:** Acquired 2026-04-15 by SSH'ing to the live Sleuth dev server, reading the Neochrome workspace config, and calling `auth.test` with the live bot token. The team ID is now stored in `~/secrets/client-a-rag.env` as `NEOCHROME_TEAM_ID` (not in the repo, not in this plan file). Production deployment needs the same env var added to whatever systemd unit / pm2 config / shell script starts Sleuth on the server — TODO during rollout.

**What NOT to do:** don't match on workspace URL/domain (mutable), don't match on channel ID (channels move), don't match on user ID (users churn), don't match on `WorkspaceInfo.WORKSPACE_NAME` (human-editable config). Team ID is the only stable, Slack-issued, forgery-resistant identifier.

## Pipeline

```
Slack app-mention  →  chat-module regex branch  →  src/rag/index.js askSelf()
   →  Gemini gemini-embedding-001 embed query (768-dim)
   →  sqlite-vec KNN top-20 + priority boost re-rank
   →  Gemini gemini-pro-latest synthesis (rolling alias, always newest Pro)
   →  PostMessageTextAsync → Slack thread reply
```

No Claude / OpenAI in the loop. Gemini does both embedding and synthesis.

## Corpus (v1 — docs-only, per spike learnings)

The Phase 0 spike showed Gemini cites markdown near-exclusively and ignores raw source for PMF/marketing questions. **v1 skips `src/**/*.js` ingest entirely** — smaller index, faster ingest, no retrieval noise. Deep code scan moves to v2 when someone actually asks code questions.

1. **Docs** — root `*.md` (AGENTS.md, CLAUDE.md, README.md, changelog.md, etc.) + `PROJECT/**/*.md` (strategy briefs, working docs). Chunked ~1200 tokens with 150 overlap.
2. **CHANGELOG** — [changelog.md](../../changelog.md) gets special handling: one chunk per version entry, tagged with the version string for filterable queries like "what shipped in 1.4.65?"
3. **GitHub PRs** — last ~200 merged PRs (title + body), fetched via Octokit using Sleuth's existing per-workspace `GITHUB_PAT`. One chunk per PR.
4. **Feature map** — one-time Gemini 2.5 Pro pass at end of ingest. Input: file tree + list of slash-command / app-mention handler signatures extracted via grep. Output: structured JSON of user-facing features → each feature stored as a high-priority chunk tagged `source: feature_map` with `priority=10`.

Each chunk carries metadata: `{source, path, pr_number, version, priority}`. The ingest script also **boosts priority** on the strategy brief and changelog chunks (`priority=5`) per spike learning #2.

**Excluded from v1:** `src/**/*.js`, `src/**/*.mjs`, `tests/**`, `node_modules/**`, `data/**`, `.git/**`, everything under `src/rag/` itself (self-reference noise).

## Storage

- `data/sleuth-rag.sqlite` — **not committed** (gitignored), rebuilt via `npm run rag:ingest`
- Schema:
  ```sql
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    source TEXT,        -- 'code' | 'doc' | 'changelog' | 'pr' | 'feature_map'
    path TEXT,
    pr_number INTEGER,
    version TEXT,
    content TEXT,
    priority INTEGER DEFAULT 0  -- feature_map chunks get boost
  );
  CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[768]);
  ```
- Embedding model: `gemini-embedding-001` with `outputDimensionality: 768` (Matryoshka truncation from native 3072)
- Verified working against the live API on 2026-04-15 with the key in `~/secrets/client-a-rag.env` (`GOOGLE_API_KEY`)
- Swapping models later = one column migration, not a rewrite.

## Containerization — one folder to rule them all

Everything RAG-related lives under [src/rag/](../../src/rag/) so the whole feature can be lifted into a standalone package or microservice later without a rewrite. Integration points with the rest of Sleuth are deliberately narrow and explicit:

1. Three-line `TeamId` getter added to [src/slack-app.js](../../src/slack-app.js)
2. ~20-line `ask-self` branch added to [src/chat-module.js](../../src/chat-module.js) that lazy-requires `./rag`
3. One `TeamId` getter added to [tests/mocks/mock-slack-app.js](../../tests/mocks/mock-slack-app.js)

Everything else — ingest script, query module, prompts, chunk strategy, sqlite schema, embedding logic, Gemini client — lives inside `src/rag/`. Tests stay in [tests/](../../tests/) per Sleuth's Jest convention (no co-located test dirs in this codebase).

## Files to create

| Path | Purpose |
|---|---|
| [src/rag/ingest.mjs](../../src/rag/ingest.mjs) | Walk repo, fetch PRs, chunk, embed, write sqlite. Invoked via `npm run rag:ingest` |
| [src/rag/index.js](../../src/rag/index.js) | Module entry: exports `askSelf(query, teamId)` → embed → KNN → synthesize. Contains `TenancyError` class |
| [src/rag/prompts.json](../../src/rag/prompts.json) | External system prompts (orchestrator, feature-map extractor, answer format). Ported from the spike's prompt as-is |
| [src/rag/README.md](../../src/rag/README.md) | Brief module-level doc: how to run ingest, how to call askSelf, where the team ID comes from, what the tenancy gate guarantees. One page max |

## Files to edit

| Path | Change |
|---|---|
| [src/slack-app.js](../../src/slack-app.js) | Capture `team_id` from `auth.test()` response at `StartAsync()` ([line ~215](../../src/slack-app.js#L215)) into a private `#TeamId` field; expose via read-only `get TeamId()`. Also add to the [AppMentionEventInfo](../../src/slack-app.js#L39) stripped shape if the mock harness needs to assert on it (probably not — handler reads it from `ArgSlackApp.TeamId`, not from the event) |
| [src/chat-module.js](../../src/chat-module.js) | Add `ask-self` regex branch **inside** the existing command-dispatch block in `OnAppMentionAsync`, positioned alongside `help` / `commands` / diagnostics — never before them. Lazy-require `./rag-module` inside the branch |
| [tests/mocks/mock-slack-app.js](../../tests/mocks/mock-slack-app.js) | Add a `TeamId` getter returning a test-injected value so handler tests can drive tenancy cases |
| [package.json](../../package.json) | Add deps + `rag:ingest` script |
| [.gitignore](../../.gitignore) | Ignore `data/*.sqlite` (done) |

## Dependencies to add

- `better-sqlite3` — sqlite bindings
- `sqlite-vec` — vector extension
- `@google/generative-ai` — Gemini SDK
- `@octokit/rest` — GitHub PR fetch

## External prompts file shape

[config/rag-prompts.json](../../config/rag-prompts.json):

```json
{
  "orchestrator_system": "You are Sleuth, a Slack-native task reminder bot, describing yourself to the marketing team. Ground every claim in the provided context. Cite sources as [source:path]. If context is thin, say so — do not invent features.",
  "feature_map_extractor": "Given this repo file tree and command handler signatures, produce a JSON array of features: [{feature, entry_points[], one_line_description}]. Focus on user-facing capabilities, not internal plumbing.",
  "answer_format": "Structure answers as: (1) direct answer, (2) supporting evidence with citations, (3) caveats or gaps."
}
```

Loaded once at module init. Marketing team can iterate tone without a code change.

## Slack command shape

```
@Sleuth ask-self What's our differentiation vs Linear's Slack app?
@Sleuth ask-self Summarize the last 10 PRs in marketing-friendly language.
@Sleuth ask-self What features landed in the last 3 versions?
```

Regex: `/^ask-self\s+(.+)/i` in [src/chat-module.js](../../src/chat-module.js) `OnAppMentionAsync`. Fits the existing 2–5s async pattern — no deferred ack needed. Reply goes in-thread via `PostMessageTextAsync(channel, msgTS, text)`.

**Handler shape (order matters) — ask-self branch only, lives alongside existing `help` / `commands` / diagnostics branches inside `OnAppMentionAsync`, NOT before them:**

```js
// Inside OnAppMentionAsync, alongside other command branches.
// All other commands (help, diagnostics, fallback chat) are unaffected for any workspace.

const askSelfMatch = AppMentionInfo.text.match(/ask-self\s+(.+)/i);
if (askSelfMatch) {
  // Tenancy gate — silent no-op for non-Neochrome workspaces.
  // ArgSlackApp.TeamId is captured at SlackApp.StartAsync() from auth.test().
  const allowedTeamId = process.env.NEOCHROME_TEAM_ID;
  if (!allowedTeamId || ArgSlackApp.TeamId !== allowedTeamId) {
    return true; // handled: drop silently, do not fall through to other handlers
  }

  // Lazy-load so a bad rag-module never poisons startup for other tenants.
  const RagModule = require('./rag-module');

  try {
    const answer = await RagModule.askSelf(askSelfMatch[1], ArgSlackApp.TeamId);
    await ArgSlackApp.PostMessageTextAsync(AppMentionInfo.channel, AppMentionInfo.ts, answer);
  } catch (err) {
    // TenancyError → silent. Anything else → log + generic failure message in-thread.
    if (err.name !== 'TenancyError') {
      this.#Logger.error('ask-self failed:', err);
      await ArgSlackApp.PostMessageTextAsync(AppMentionInfo.channel, AppMentionInfo.ts,
        "Sorry — couldn't complete that lookup. Check the logs.");
    }
  }
  return true;
}
// ... fall through to other command branches unchanged
```

## Env / secrets

**Discipline — keys never touch the repo workspace:**

- No key material in any tracked file — no `.env.example` values, no hardcoded fallbacks, no test fixtures, no plan docs (including this one).
- `.env` and `.env.*` are already gitignored ([.gitignore:14-16](../../.gitignore#L14-L16)). Any local `.env` used during dev lives outside the repo (`~/secrets/`) and is *sourced*, not copied in.
- `data/*.sqlite` added to [.gitignore](../../.gitignore) so the built index (which contains no keys, but does contain full repo content + PR bodies) also never commits.
- Loader in [src/rag-module.js](../../src/rag-module.js) reads `process.env.GOOGLE_API_KEY` only — no file reads, no path lookups. If missing, module throws at init with a clear message pointing at `~/secrets/client-a-rag.env`.
- Pre-commit guard (optional, v2): add `gitleaks` or a simple regex grep for `AIza[0-9A-Za-z_-]{35}` in the pre-commit hook.

**Keys needed (both verified available):**

- `GOOGLE_API_KEY` — lives in [~/secrets/client-a-rag.env](~/secrets/client-a-rag.env); verified working against `gemini-embedding-001` and Gemini 2.5 Pro on 2026-04-15.
- **Sleuth's existing GitHub PAT** — Sleuth already loads its own PAT at startup to read GH issue statuses. **Reuse the existing loader** — do not introduce a new `GITHUB_TOKEN` env var. Ingest script imports whatever module Sleuth uses (TBD — find it during step 1 of build order) and calls Octokit through that, so the RAG ingest inherits the same auth without adding surface area.

**Where ingest runs:**

- Option A — local laptop: fastest to iterate tonight, secrets stay on dev machine, index lives in `data/` locally. Good for MVP testing.
- Option B — dev server via SSH: required eventually so the live Sleuth process can read the index. For tonight, either (a) build locally then `scp` the sqlite file up, or (b) SSH in and run ingest there.
- **Recommendation for tonight:** build locally, test the query module against the local sqlite, only `scp` the index up once answers look good. Keeps the iteration loop fast.

## Phase 0: quality spike (do this FIRST, ~30 min)

**The biggest unknown is not retrieval — it's synthesis.** Everything downstream (sqlite-vec, chunking, PR fetch, feature-map pass, Slack wiring, tenancy plumbing) is only worth building if Gemini 2.5 Pro can actually produce useful PMF/marketing answers from Sleuth's own text. If answer quality is mediocre even with *hand-curated, guaranteed-relevant* context, the problem is not retrieval and no RAG pipeline will fix it. If answer quality is excellent from a thin corpus, you know the full pipeline will only improve it.

**Spike shape — 30 minutes, no code committed:**

1. **Hand-pick the corpus** (~10 min): `cat` together `PROJECT/1-INBOX/sleuth-product-strategy-brief.md`, the last 20 entries of `changelog.md`, `AGENTS.md`, and one representative source file (maybe `src/chat-module.js` or whatever exposes the reaction-driven UX). Total ~15–25k tokens — fits in Gemini 2.5 Pro's context with room to spare.
2. **Throwaway script `scratch/rag-spike.mjs`** (~10 min, not committed): load `GOOGLE_API_KEY`, stuff the concatenated text into Gemini 2.5 Pro with a draft version of `orchestrator_system`, ask the three canned success-criteria questions one at a time. Log the answers.
3. **Judge** (~10 min): read the answers cold. Are they grounded, specific, and marketing-useful? Or generic, hallucinated, repetitive?

**Decision gates:**

- **Answers are great** → premise validated. Proceed with the full plan below. The pipeline's job becomes "automate what we just did manually, for queries we can't predict in advance."
- **Answers are mediocre** → prompt is the problem. Iterate on the system prompt in the same scratch script for another 30 min before committing to a pipeline. Retrieval won't rescue a weak prompt.
- **Answers are bad even with curated context** → the whole premise is wrong. Sleuth's text isn't dense enough for this use case, or the questions are too open-ended. Stop. Reconsider whether a hand-maintained FAQ / feature card set is a better fit than a RAG.

**What the spike deliberately doesn't test:**

- Retrieval quality (we're hand-picking context)
- sqlite-vec install / Node bindings (defer to Phase 1)
- PR ingest (defer)
- Tenancy gate (defer — the spike is local-only, no Slack)
- Chunking strategy (defer)

**Why this specific thing is the spike** (vs. testing sqlite-vec install or PR ingest first): those are *known-solvable* engineering problems with predictable fixes. Synthesis quality is the only thing that, if it fails, kills the whole project rather than costing you a library swap. Spike the existential risk, not the implementation risk.

**`scratch/` is gitignored.** Add `scratch/` to [.gitignore](../../.gitignore) at the same time as `data/*.sqlite` so spike code doesn't leak into the repo.

### Spike results (2026-04-15)

**Ran:** `scratch/rag-spike.mjs` with the 4-file hand-curated corpus (strategy brief + full changelog + AGENTS.md + src/chat-module.js), ~18k input tokens, against `gemini-2.5-pro`.

**Verdict: PASS.** All three canned questions produced grounded, specific, well-cited, marketing-useful answers. No hallucinations. Model appropriately hedged draft-status caveats from the strategy brief. Total cost ~57k input tokens, ~34s latency across three calls.

**Key learnings that should shape Phase 1:**

1. **Synthesis is not the bottleneck** — Gemini 2.5 Pro does excellent grounded synthesis from even thin curated context. The pipeline's job is retrieval quality, not prompt engineering heroics.
2. **Docs dominate, code barely gets cited** — the full `src/chat-module.js` was in context but the model's citations were ~100% from markdown/strategy/changelog sources. **Phase 1 ingest should boost `priority` on markdown/strategy/changelog chunks and down-weight raw source** for PMF/marketing questions. Raw source is still worth indexing for questions like "how is the reminder stored?" but should not dominate retrieval for positioning questions.
3. **~18k input tokens answers well** — don't micro-optimize retrieval to 2-3k chunks. Pull generously (top-k ~15-20, concat generously) and let Gemini sort it out.
4. **Prompt shape works** — the spike prompt ("direct answer / evidence / caveats") is good enough for v1 of `config/rag-prompts.json`. Port it as-is.

## Build order (tonight)

0. **Phase 0 quality spike** (see section above) — ~30 min, gates the rest of the work
1. **Find Sleuth's existing GitHub PAT loader** (grep `src/` for octokit / `GH_PAT` / `GITHUB_TOKEN` / `personal-access`) so the ingest script reuses it instead of introducing a new env var (5 min)
2. **Grab Neochrome's Slack team ID** and add `NEOCHROME_TEAM_ID` to the dev-server runtime env (not the repo). Fastest path: temp script that logs `SlackApp.client.auth.test().team_id` from the Neochrome-installed Sleuth, then delete the script (5 min)
3. **Deps + scripts entry** — `npm install` the four packages, add `rag:ingest` script (5 min)
4. **`scripts/rag-ingest.mjs`** — walk repo, chunk, embed, write sqlite (40 min)
   - Start with code + docs + changelog
   - Add PR fetch
   - Add feature-map pass last
5. **`config/rag-prompts.json`** — draft the three prompts (10 min)
6. **`src/rag-module.js`** — `askSelf(query, teamId)` query path with defensive team-ID check (20 min)
7. **Wire into `src/chat-module.js`** — tenancy gate + regex branch + handler (15 min)
8. **Write `tests/rag-ask-self-tenancy.test.js`** — seven tests from the Regression tests table; mock Gemini + sqlite at module boundary (25 min)
9. **Add tenancy static check to `.github/workflows/ci.yml`** — 5-line grep step (5 min)
10. **Live tenancy smoke test** — verify a non-Neochrome workspace mention of `ask-self` produces *zero* response in real Slack (10 min)
11. **End-to-end test** in a Neochrome dev channel (20 min)
12. **Iterate prompts + chunk size** based on answer quality (remainder)

Rough total: ~3 hours of focused work.

## Regression tests (CI-enforced tenancy gate)

**Rationale:** the tenancy gate is the only thing standing between Sleuth's internal strategy/source and every other customer workspace. A future refactor could accidentally bypass it (removed check, reordered handler, new code path). CI must fail loudly before that ships.

**Test infra already in place:** Jest 30, [tests/](../../tests/), [tests/mocks/mock-slack-app.js](../../tests/mocks/mock-slack-app.js), pattern precedent in [tests/chat-module.integration.test.js](../../tests/chat-module.integration.test.js). GitHub Actions workflows in [.github/workflows/](../../.github/workflows/) — `ci.yml` and `cicd-development.yml` already run the Jest suite on PRs, so new tests get enforced automatically with no workflow changes.

**New file: `tests/rag-ask-self-tenancy.test.js`** — must cover all four escape routes:

| # | Test | Expected |
|---|---|---|
| 1 | Module-level: `askSelf('q', 'T_WRONG_TEAM')` when `NEOCHROME_TEAM_ID=T_NEO` | throws `TenancyError`, no Gemini call, no sqlite read |
| 2 | Module-level: `askSelf('q', undefined)` | throws `TenancyError` — no "default to allow" bug |
| 3 | Module-level: `askSelf('q', '')` / `null` / `'T_NEOCHROME '` (trailing space) / case-mismatch | all throw — no sloppy equality |
| 4 | Module init: load `rag-module.js` with `NEOCHROME_TEAM_ID` unset | module throws at import / first call — fail-closed |
| 5 | Handler-level: `MockSlackApp.TeamId === 'T_OUTSIDER_TEST'`, fire app_mention with text `"@Sleuth ask-self What is Sleuth?"` | zero `PostMessageTextAsync` calls, zero `RagModule.askSelf` calls (spy assertion), zero Gemini calls. Note: generic app_mention inbound log from `SlackApp` is expected and NOT asserted against |
| 6 | Handler-level: `MockSlackApp.TeamId === 'T_OUTSIDER_TEST'`, fire app_mention with `"@Sleuth help"` | `help` command still produces its normal response — gate doesn't break unrelated branches for non-Neochrome workspaces |
| 7 | Handler-level: `MockSlackApp.TeamId === 'T_NEOCHROME_TEST'`, fire app_mention with `"@Sleuth ask-self What is Sleuth?"` | `RagModule.askSelf` **is** called with `'T_NEOCHROME_TEST'` as the teamId argument (happy path still works) |
| 8 | Handler-level: `NEOCHROME_TEAM_ID` unset, `MockSlackApp.TeamId === 'T_NEOCHROME_TEST'`, fire ask-self mention | zero `RagModule.askSelf` calls, zero reply — fail-closed when env var is missing, no workspace-wide breakage |

**Mock shape:** stub `RagModule.askSelf` as a Jest spy in tests 5–7 so we assert on call count without actually hitting Gemini or sqlite. Tests 1–4 call the real module with Gemini + sqlite-vec mocked at the module boundary (no network, no disk).

**Test team IDs:** use obvious placeholders like `'T_NEOCHROME_TEST'` and `'T_OUTSIDER_TEST'` injected via `process.env.NEOCHROME_TEAM_ID` in `beforeEach` — never the real production team ID in a tracked test file.

**CI wiring:** none needed. The new test file is picked up by the existing `jest --forceExit` command, which already runs in `.github/workflows/ci.yml` and `cicd-development.yml`. A failing tenancy test blocks the PR.

**Belt-and-suspenders: a static check too.** Add a grep-based CI step (5 lines of bash in `ci.yml`) that fails the build if anyone deletes the tenancy gate from the handler:

```yaml
- name: Tenancy gate static check
  run: |
    grep -q "NEOCHROME_TEAM_ID" src/chat-module.js || { echo "Tenancy gate missing from chat-module.js"; exit 1; }
    grep -q "NEOCHROME_TEAM_ID" src/rag-module.js || { echo "Tenancy gate missing from rag-module.js"; exit 1; }
```

Catches the case where someone removes the check *and* also deletes the failing test in the same PR. Cheap insurance.

## Success criteria

- `@Sleuth ask-self <question>` in a Neochrome channel returns a grounded answer with source citations in a Slack thread
- **Tenancy:** the same mention in a non-Neochrome workspace produces **no response** — verified by checking bot logs show zero activity for the other team_id
- Answer quality on three canned questions:
  1. *"What are Sleuth's core differentiators?"*
  2. *"Summarize what shipped in the last 5 versions."*
  3. *"Who is Sleuth's ideal customer?"* (tests cross-source synthesis: `sleuth-product-strategy-brief.md` + changelog)
- Ingest is re-runnable: `npm run rag:ingest` from a clean clone rebuilds the index

## Open questions

- Chunk size for code — 1000 tokens is a guess; may need tuning after first test.
- PR fetch scope: last 200 merged, or all time? 200 keeps ingest under a minute.
- Do we cite `[source:path]` inline or as a footer block? Decide after first answer.

## Dev server deployment (2026-04-15, completed)

- `/etc/sleuth-app/secrets.env` written (0600 root:root) with `GOOGLE_API_KEY`, `NEOCHROME_TEAM_ID` (value sourced from `auth.test` against the Neochrome workspace), `SLEUTH_RAG_GITHUB_PAT` (reused from the existing per-workspace JSON on the server)
- `/etc/systemd/system/sleuth-app.service.d/50-rag-env.conf` drop-in added alongside the existing `override.conf` (NewRelic). `override.conf` left untouched — verified by mtime. Drop-ins merge, so both env sources are loaded
- `systemctl daemon-reload && systemctl restart sleuth-app` — clean restart, all three new env vars present in `/proc/$PID/environ`, no startup errors in journal
- `npm run rag:ingest` ran on the dev server — 154 chunks indexed, `data/rag/sleuth-rag.sqlite` built, live smoke-test query returned a grounded answer with correct citations
- **Zero in-repo file changes on the server** — no propagation path to production. `/etc/sleuth-app/` is outside the repo, the systemd drop-in is outside the repo, the repo checkout itself was never touched (only a pre-existing `package-lock.json` drift that predated this work)

### Known drift surfaced by dev deployment

- The repo tracks both `CHANGELOG.md` and `changelog.md` as separate index entries (pre-existing quirk, case-insensitive filesystem on macOS collapses them locally). On dev's case-sensitive Linux filesystem the ingest walker sees both and **double-indexes the changelog** — dev shows 16 changelog chunks vs 8 locally. Not blocking MVP; flagged as a cleanup follow-up.

## Automated ingest roadmap (sketch — not building this yet)

**Goal:** rebuild the RAG index automatically on every push to `development` (and later `main`), so marketing's answers stay in sync with shipped behavior and CHANGELOG updates without anyone remembering to run `npm run rag:ingest`.

### Key architectural fact

The deploy runner is **self-hosted on the Sleuth server itself** (`runs-on: [self-hosted, development]` in [cicd-development.yml](../../.github/workflows/cicd-development.yml)). That means an auto-ingest step does NOT need to SSH anywhere, manage deploy keys, or ship secrets through GitHub Actions — it runs directly on the box where the repo, the secrets file, and the sqlite index all live.

### Phase 1 — post-deploy ingest step (the obvious first move, ~15 min to ship)

Add a new step to [cicd-development.yml](../../.github/workflows/cicd-development.yml) right after `Start Service`:

```yaml
- name: Rebuild RAG Index
  continue-on-error: true  # Gemini outage must not break a deploy
  run: |
    cd $APP_DIRECTORY
    set -a && source /etc/sleuth-app/secrets.env && set +a
    npm run rag:ingest
```

**Why `continue-on-error: true`:** if Gemini's API is briefly unavailable, the deploy should still succeed and the old index keeps serving queries until the next push. An ingest failure is a freshness issue, not a service outage.

Same step added to [cicd.yml](../../.github/workflows/cicd.yml) for production rollout.

### Phase 2 — scheduled refresh (daily cron, ~10 min)

Add a separate workflow file `cicd-rag-refresh.yml` that runs on `schedule:` (daily) using the same self-hosted runner. This catches PR body edits and CHANGELOG tweaks that happen *outside* a push — which matters more for the production branch where deploys are infrequent.

```yaml
on:
  schedule:
    - cron: '0 12 * * *'   # daily at noon UTC
  workflow_dispatch:       # allow manual trigger from Actions UI
```

### Phase 3 — polish (only if Phase 1/2 prove noisy or slow)

- **Atomic index swap** — current ingest deletes the sqlite file then writes a new one. A crash mid-write leaves a broken file. Fix: write to `sleuth-rag.sqlite.new`, `rename()` over the old file after the commit. ~5 line code change in `src/rag/ingest.mjs`.
- **Path-filter the deploy-triggered ingest** — only rebuild when doc/changelog/src changes are in the diff. Cuts wasted ingests on trivial CI-only pushes. Example: `paths: ['**/*.md', 'src/**', 'changelog.md']`.
- **Incremental ingest** — hash each chunk's source content, only re-embed changed chunks. Cuts ingest cost ~80% at steady state but adds complexity. Only worth it if the corpus grows much larger.
- **Observability** — post a terse summary line (`"RAG index rebuilt: 154 chunks, 8.8s"`) to a Neochrome ops channel so marketing sees when refresh happens. Gemini Slack Webhook or reuse Sleuth's own `PostMessageTextAsync`.
- **Failure alerting** — if ingest fails three times in a row, page someone (GitHub Actions built-in notifications are enough).

### Roadmap recommendation

**Ship Phase 1 this week** (tiny change, immediate value, no new secrets, no new infra). **Add Phase 2 once prod gets the RAG feature** (so we don't have a long-running staleness gap between prod deploys). **Skip Phase 3 entirely until we see an actual failure mode** — it's all premature optimization right now.

The self-hosted runner architecture makes this a ~20-line workflow change total. The reason to write it down rather than ship it now is that the Phase 1 step depends on Phase 0 (prod rollout of the env file + systemd drop-in), which should be done deliberately rather than automated.

## Follow-ups (v2, not tonight)

- **Deep code-level scan of `src/**/*.js`** — deferred from v1 per spike learning. Add when users start asking implementation questions the doc corpus can't answer
- CI hook: rebuild index on merge to main
- Reranking pass (e.g., Gemini Flash cross-encoder over top-30 → top-8)
- Per-command auth (limit `ask-self` to certain user IDs or channels)
- Incremental ingest (only re-embed changed files)
- Evaluation harness — canned Q&A with expected source paths
- Hybrid search (BM25 + vector) if single-vector recall disappoints
- Real hierarchical agentic reasoning once we have eval data showing where single-shot fails
- Spin `src/rag/` out as its own npm package or microservice once the feature stabilizes — the containerized layout is designed to make this a mechanical move
