# ROUTER.md

This file is the first entry point for an AI agent working in this repo: it tells you what to read,
what to run, and which files are canonical.

## Role split

- `ROUTER.md` = startup order and canonical entry points
- `AGENTS.md` = Sleuth's own behavioral contract and non-negotiables (architecture-first search, RAG
  usage, Slack Bolt/OpenAI/Express stack, multi-tenant isolation) — the canonical agent contract for
  this repo and intentionally contract-only; read it in full, but use `ARCHITECTURE.md` for
  system/persistence inventories and reminder write-path details, `docs/web-api.md` for
  endpoint/auth payload inventories, and `src/workspaces.js` for workspace field definitions,
  required/optional validation, and compatibility rules
- `CLAUDE.md` = thin pointer to `AGENTS.md` for Claude Code specifically
- `GUIDING-PRINCIPLES.md` = the doc-governance north star that PDDA's checks answer to (not Sleuth's
  product principles — those live in `AGENTS.md` / `ARCHITECTURE-DECISIONS.md`)
- `README.md` = human-facing repo/product overview
- `docs/getting-started.md` = human first-run onboarding (requirements checklist + clone → Slack → verify)
- `ARCHITECTURE.md` = living canonical system design; `ARCHITECTURE-DECISIONS.md` = graph-derived
  snapshot of past decisions (regenerated via `codebase-memory-mcp`, not hand-authored — see its file
  header for regen steps)
- `ROADMAP.md` = manually-maintained ledger of in-progress/next/shipped work — hand-updated (no writer
  automation), but now read by the marathon scheduling layer, so keep it current when you start or
  finish work
- `CHANGELOG.md` = the end-of-iteration running log (governed by `PROJECT/PDDA.md`)
- `RELEASES.md` = the forward-looking release-planning ledger (governed by `PROJECT/PDDA.md`)
- `PROJECT/PDDA.md` = the canonical PDDA contract and automation rules for this repo's docs
- `utils/pdda/PDDA-INSTALL.md` = the extraction/install manifest (PDDA is synced in from its
  standalone HQ repo via `install.sh`; this repo does not carry that installer)
- `utils/pdda/pdda.sh` = the unified runnable PDDA surface (dispatcher + every deterministic check +
  `run`)
- `utils/pdda/pdda-doc-ready.sh` = the opt-in LLM readiness review

## Startup sequence

1. Read `ROUTER.md` (this file). -> expect one clear next file, not a repo-wide scavenger hunt.
2. Read `AGENTS.md` in full before making recommendations or edits. -> expect Sleuth's stack
   constraints, RAG-first search discipline, and non-negotiables honored; use the canonical docs it
   points to for detailed inventories.
3. Read `GUIDING-PRINCIPLES.md` if the task touches doc governance, roadmap hygiene, or the PDDA
   layer itself. -> expect the north star PDDA's checks answer to.
4. For repo-management, doc-governance, or "what changed recently" tasks, read `CHANGELOG.md` (top
   entries), `PROJECT/PDDA.md`, and `ROADMAP.md` in that order before going further. -> expect
   current operational state and the source of truth for lifecycle/enforcement rules; recent work
   concentrates here, not in `README.md`.
5. Read `README.md` for the product's purpose and baseline usage. -> expect a short explanation of
   what Sleuth does; this is a conditional background read, not required once step 4 already covers
   the task.
6. Before reporting success on repo changes, run `utils/pdda/pdda.sh run` or a narrower check
   (`utils/pdda/pdda.sh <check>`). -> expect deterministic findings first, then any LLM review.

## Canonical rules

- `AGENTS.md` is Sleuth's canonical behavioral contract — do not duplicate or contradict it here.
- Do not put phase checklists, build steps, or deep execution notes in `ROADMAP.md`.
- Every active doc in `PROJECT/2-WORKING/` must be reflected by a pointer in `ROADMAP.md` — or opt
  out with `roadmap_exempt: true` in its frontmatter. Enforced by `utils/pdda/pdda.sh
  roadmap-coverage`; governance lives in `PROJECT/PDDA.md`.
- Do not override deterministic PDDA findings with prose.
- Do not report a win you did not verify with the relevant script or test.
- Update `CHANGELOG.md` at the end of each iteration; its governance lives in `PROJECT/PDDA.md` — do
  not re-specify CHANGELOG rules in `AGENTS.md` or elsewhere.
- Generated overlays under `PROJECT/2-WORKING/` (e.g. `MARATHON-PLAN-*.md`, marked `roadmap_exempt:
  true` in frontmatter) are scheduling aids derived from `ROADMAP.md`, not source-of-truth plans — do
  not hand-edit them or treat them as canonical.

## Command rails

For baseline verification and document hygiene:

```bash
utils/pdda/pdda.sh run
```

For targeted PDDA debugging, run a single check by name:

```bash
utils/pdda/pdda.sh frontmatter
utils/pdda/pdda.sh status-table
utils/pdda/pdda.sh hardcoded-paths
utils/pdda/pdda.sh roadmap
utils/pdda/pdda.sh roadmap-coverage
utils/pdda/pdda.sh changelog
utils/pdda/pdda.sh stale
utils/pdda/pdda.sh issue-doc-sync   # flag GH-*.md docs drifted from their GitHub issue state (warn-only)
utils/pdda/pdda.sh releases        # validate RELEASES.md, the release-planning ledger (warn-only)
utils/pdda/pdda.sh releases-current # read-only roll-up: RELEASES.md entries not yet Shipped
utils/pdda/pdda.sh governance      # governance-doc cross-reference + doc/code drift
utils/pdda/pdda.sh quad-concepts   # opt-in: a "## Quad Concepts" section of 1-4 bullets (lever: .pdda-quad / PDDA_QUAD)
utils/pdda/pdda.sh glance          # read-only roll-up: title + Quad Concepts for each PROJECT/2-WORKING doc
utils/pdda/pdda.sh gh-refresh      # refresh the cached GitHub issue-state file (needs gh)
utils/pdda/pdda.sh doc-ready       # LLM readiness review — set PDDA_LLM_BIN (codex/claude/agy) to enable
utils/pdda/pdda.sh catchup         # LLM repo triage and ROUTER.md recommendations — opt-in
utils/pdda/pdda.sh help            # list every command
```

## Routing hints

- If the task is about Sleuth's architecture, Slack/OpenAI integration, RAG usage, or persistence
  path inventory, start in `AGENTS.md` for constraints, then `ARCHITECTURE.md` for the actual
  inventory. For architecture/repo-topology review specifically, also read
  `ARCHITECTURE-DECISIONS.md` right after `ARCHITECTURE.md` — it's a durable, regenerated snapshot.
- If the task is about workspace config fields, required/optional validation, compatibility rules,
  payload examples, bearer-auth details, or endpoint inventory, start in `src/workspaces.js` and
  `docs/web-api.md` rather than expecting `AGENTS.md` to mirror those lists.
- If the task is "what changed recently" or a general catch-up, read `CHANGELOG.md`, `git log
  --oneline -10`, `ROADMAP.md`, the newest `PROJECT/1-INBOX/GH-*.md` captures, and active
  `PROJECT/2-WORKING` docs — or run `utils/pdda/pdda.sh catchup` (opt-in, needs `PDDA_LLM_BIN`) to get
  this triaged automatically against `ROUTER.md` itself.
- If the task is about document quality, active-doc lifecycle, roadmap sprawl, or PDDA automation
  policy, start in `PROJECT/PDDA.md`.
- If the task is about repo-local maintenance state, start in `ROADMAP.md`. Treat any
  `PROJECT/2-WORKING/MARATHON-PLAN-*.md` as a generated scheduling overlay derived from it — read it
  after the ledger when batching work, never hand-edit it.
- If the task is a repo-level question (architecture, past decisions, how something works), start
  in `ARCHITECTURE.md`, then `CHANGELOG.md` and `PROJECT/`.
- If the task is about command aliases, `rmm`, help output, or command normalization, start in
  `ARCHITECTURE.md`'s "Command Catalog, Help, and RMM Intent Resolution" section, then
  `data/static/ai/command-catalog.json` and `data/static/ai/command-normalization.json`.
- If the task is about the Claude Desktop / MCP connector, see `mcp/README.md` — it's a separate
  stdio server, not part of the main `src/` startup path.
- If the task is about installing or upgrading PDDA itself, see `utils/pdda/PDDA-INSTALL.md` — the
  runtime is synced in from the separate `pdda` HQ repo's install.sh / pdda-sync.sh (canonical-only
  tooling; those two scripts are not shipped into this repo).
- To re-run this startup sequence mid-session (task switch, resume, post-compact, context drift),
  invoke the `/pdda` skill (`.claude/skills/pdda/SKILL.md`) instead of re-reading by hand.
