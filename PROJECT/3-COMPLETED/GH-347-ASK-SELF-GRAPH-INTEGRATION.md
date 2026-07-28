---
gh_issue: 347
source: https://github.com/NeochromeTeam/sleuth-app/issues/347
title: Explore using codebase-memory-mcp graph index to improve ask-self RAG
status: Completed (#1 shipped 1.4.209; #2/#3 deferred, not opened as separate issues yet)
created: 2026-07-03
updated: 2026-07-03
doc_type: feedback
---

# Explore using codebase-memory-mcp graph index to improve ask-self RAG

## Ask

`codebase-memory-mcp` was installed and indexed against this repo. Research compared it
against the existing `ask-self` RAG (`src/rag/`) to see whether the graph index can improve
`ask-self`. See [GH issue #347](https://github.com/NeochromeTeam/sleuth-app/issues/347) for
the full findings.

## Findings (summary)

The two systems are complementary, not substitutable: `ask-self` is a semantic RAG over
unstructured text chunks (docs/code/PRs/changelog); the graph is structural
(Functions/Methods/Classes/Routes + call/import edges) plus its own separate code-level
semantic layer. The graph's markdown `Section` nodes only capture heading lines, not body
text, so it can't substitute for full-document retrieval. The graph is only reachable as an
MCP tool inside an agent session, not as a library Sleuth's own process can call live —
so query-time hybrid retrieval is a real architectural change, not a small wire-up.

## Opportunities

1. **Replace the regex-based architecture summary with graph-derived facts** (low effort) —
   this doc's scope.
2. **Function-boundary-aware code chunking** (medium effort) — future work, not started.
3. **Query-time hybrid retrieval** (high effort, architectural friction) — future work, not started.

## Resolution (#1)

Live graph-tool calls turned out to be infeasible inside `ingest.mjs` itself: `codebase-memory-mcp`
is only reachable as an MCP tool inside an agent session (stdio protocol), not as a library Sleuth's
own offline ingest script can import — so "sources facts from the graph at ingest time" (as originally
scoped) isn't achievable without the same architectural coupling flagged for opportunity #3. Instead,
the graph's `get_architecture` output was used at *investigation* time to find two concrete,
self-contained bugs in `buildArchitectureSummary()`, both fixed with no new dependency and no MCP
runtime coupling:

- **Module inventory was top-level-only** (plus a hardcoded `src/rag/` special case), silently
  missing `src/chat-commands/` (28 files — the single largest source package per the graph's package
  breakdown), `src/ai-providers/` (4 files), and `src/plugins/` (1 file). Fixed with a recursive
  `collectSourceFiles()` walk — verified all 84 `.js`/`.mjs` files under `src/` are now found across
  the correct subdirectories.
- **The command feature-map was silently broken.** It regex-matched `if (/pattern/.test(...))`
  branches in `chat-module.js`, an extraction pattern that predates the CommandRouter refactor
  (ARCHITECTURE.md § *Command Catalog, Help, and RMM Intent Resolution*) — verified today it matches
  zero real command branches. Replaced with reading `data/static/ai/command-catalog.json` directly
  (55 commands with real `Id`/`Permission`/`Description`), plus a new real HTTP route extraction from
  `src/web-api.js` (16 routes; a `req.get('host')` false-positive was caught and filtered by requiring
  the path literal to start with `/`).

Verified: `node --check src/rag/ingest.mjs` passes; isolated logic test confirms the 84-file/5-subdir
inventory, 55 catalog commands, and 16 routes; `npm run build` shows no new type errors (the 6
existing `snapshot-relay-module.js` errors are pre-existing and unrelated). Did not run a full
`npm run rag:ingest` (real Gemini API calls + rewrites the committed `data/rag/sleuth-rag.sqlite`) —
left for the operator to run when convenient. No change to the live query path (`src/rag/index.js`)
or runtime behavior.

## Deferred

#2 (function-boundary-aware code chunking) and #3 (query-time hybrid retrieval) are not started and
not yet filed as separate GitHub issues — revisit if `ask-self`'s code-question answer quality becomes
a problem worth the added effort/coupling.
