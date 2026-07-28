## MOVE

- Move the `PROJECT/PDDA.md` and `ROADMAP.md` reads ahead of `README.md` in the startup sequence for repo-management, doc-governance, or “what changed recently?” tasks. Recent work is concentrated there: the stalled-state correction for `P3-EVENT-SOURCED-CORE`, the new `MARATHON-PLAN-2026-07-03.md`, and the fresh `GH-348` / `GH-349` captures are operationally more important than product background.
- Move `CHANGELOG.md` out of the passive role list and into an explicit early catch-up rail. For repository-manager work, it should be read before `README.md`, not treated as an end-of-iteration artifact only.
- Move `ARCHITECTURE-DECISIONS.md` from a generic paired mention with `ARCHITECTURE.md` into an explicit conditional read right after `ARCHITECTURE.md` for architecture/repo-topology reviews. Commit `013504a` made it a durable repo artifact, not just an incidental side file.

## DELETE

- Delete `README.md` as an unconditional startup step. Keep it as a conditional background read for product overview only; it is no longer one of the highest-signal files for active repo state.
- Delete or rewrite the `ROADMAP.md` description that says “no automated enforcement.” That wording is now misleading: the ledger is still hand-maintained, but it is also machine-consumed by the new marathon scheduling layer, so the current phrasing undersells its routing importance.
- Delete any ambiguity that a generated file in `PROJECT/2-WORKING` is automatically canonical working state. `MARATHON-PLAN-2026-07-03.md` is explicitly generated and `roadmap_exempt: true`; `ROUTER.md` should not leave that distinction implicit.

## ADD

- Add a dedicated “recent activity / catch-up” routing hint: read `CHANGELOG.md`, `git log --oneline -10`, `ROADMAP.md`, newest `PROJECT/1-INBOX/GH-*.md` captures, and active `PROJECT/2-WORKING` docs. This matches the task pattern your current request represents, and it aligns with the existing `utils/pdda/pdda.sh catchup` rail.
- Add a note for `PROJECT/2-WORKING/MARATHON-PLAN-*.md`: it is a generated scheduling overlay derived from `ROADMAP.md`, not a source-of-truth plan; read it after the ledger when batching work, and do not hand-edit it.
- Add a local RAG rail to `ROUTER.md`: for repo-level questions, use `scripts/ask-self-query.sh` or `npm run rag:query`; for index refreshes, use `scripts/ask-self-ingest.sh` / `npm run rag:ingest`. Recent `1.4.209` work made this path materially more important.
- Add a command-routing hint: for aliases, `rmm`, help output, or command normalization, start in `ARCHITECTURE.md`’s “Command Catalog, Help, and RMM Intent Resolution” section, then `data/static/ai/command-catalog.json` and `data/static/ai/command-normalization.json`. Recent activity (`1.4.208`, `1.4.200`, `1.4.199`, `GH-349`) is concentrated there.
- Add a conditional pointer to `mcp/README.md` for Claude Desktop / MCP integration tasks. `1.4.202` introduced a separate read-only MCP surface, and it is now a real routing destination absent from `ROUTER.md`.
