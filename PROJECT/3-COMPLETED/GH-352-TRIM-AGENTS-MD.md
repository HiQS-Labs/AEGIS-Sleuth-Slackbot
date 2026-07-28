---
gh_issue: 352
source: https://github.com/NeochromeTeam/sleuth-app/issues/352
title: Trim AGENTS.md's redundant inventory sections — point at ARCHITECTURE.md/docs/web-api.md instead
status: Completed — built via the marathon swarm (codex builder + agy reviewer), 2026-07-09; issue #352 closed via PR #359
created: 2026-07-03
updated: 2026-07-09
owner: noel
doc_type: feedback
effort: 2
complexity: 1
risk: 1
phases: 1
goal: >-
  Trim AGENTS.md's redundant inventory sections (persistence, web API, architecture, key
  paths) down to pointers at their already-current canonical homes, keeping only genuine
  non-negotiable contracts.
---

# Trim AGENTS.md's redundant inventory sections

## Status

| What was just completed | What's next |
|---|---|
| Shipped via the marathon swarm (codex builder + agy reviewer), 2026-07-09 — `AGENTS.md` 395→305 lines, no information loss, `npm test` green (1200/1200). | _None — issue closed._ |

## Ask

`AGENTS.md` (395 lines) mixes genuine non-negotiable Sleuth contracts (FSM invariants, provider
dispatch, module-ownership boundaries) with hand-maintained reference/inventory material that now
duplicates docs which already exist and are kept current elsewhere. This issue removes the
duplication so `AGENTS.md` shrinks back to real contracts only — sibling of
[GH-348](https://github.com/NeochromeTeam/sleuth-app/issues/348) (Engineering Philosophy →
`GUIDING-PRINCIPLES.md`); together these are the 2026-07-03 "radical surgery" pass on the
AGENTS.md/GUIDING-PRINCIPLES.md/ROUTER.md split.

## Findings — confirmed redundant, not just similar

- **§4 Data Persistence contract** duplicates `ARCHITECTURE.md`'s "Persistence Pipeline" section
  (same workspace/reminder/stats file paths).
- **§5 Web API contract** (hand-listed endpoint set) duplicates `docs/web-api.md`, which `AGENTS.md`
  itself already names as the doc to update on endpoint changes.
- **§11 Architecture And Key Paths** duplicates `ARCHITECTURE.md`'s System Map (49 `src/`
  references) and `ARCHITECTURE-DECISIONS.md`, a `codebase-memory-mcp` graph snapshot regenerated on
  demand instead of hand-maintained.
- **§12 Important Configuration** (workspace field list) partially overlaps `ARCHITECTURE.md`'s
  persistence section; the required/optional split is the one part not clearly duplicated and needs
  an explicit "where does this live" call.

## Explicit non-goal

Not a rewrite of `AGENTS.md`'s real contracts. §0.1–§0.3, §1–§3, §6–§10, §13–§15 stay — they have
code evidence and no duplicate home elsewhere. Only the inventory sections above are in scope, and
only where a genuine duplicate already exists and is kept current.

## Acceptance criteria

- [x] §4 Data Persistence — replaced with a one-line pointer to `ARCHITECTURE.md`'s Persistence Pipeline.
- [x] §5 Web API Contract Checklist — deleted, pointer to `docs/web-api.md` added.
- [x] §11 Architecture And Key Paths — deleted, pointer to `ARCHITECTURE.md`/`ARCHITECTURE-DECISIONS.md` added.
- [x] §12 field-list placement decided — required/optional workspace field tables removed (owned by
      `src/workspaces.js`); kept only the Process Environment Flags subsection, which has no other home.
- [x] No contract with real code evidence touched (§0.1–§0.3, §1–§3, §6–§10, §13–§15 untouched).
- [x] `ROUTER.md` pointers updated to route persistence/endpoint/workspace-field questions to their
      new canonical homes.
- [x] `AGENTS.md` line count materially dropped: 395 → 305 lines, no information loss (each removed
      section replaced by a pointer to its still-current canonical home).
- [x] `npm test` green (1200/1200) as the regression gate.

## Swarm Preflight Contract

Docs-only lane, independent zone. Write-set (`AGENTS.md`, `ROUTER.md`) is file-disjoint from every
active lane. **Semantic-coupling note:** sibling of GH-348 (Blend philosophy → `GUIDING-PRINCIPLES.md`)
— file-disjoint so the collision detector allows them to run in parallel, but they are two halves of
the same 2026-07-03 doc-governance restructure; prefer sequencing them (this one after GH-348 lands)
so cross-references stay consistent. `gate: npm test` is a regression guard only (docs changes don't
touch code paths); the real "done" signal is the freshness probe + criteria.

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test",
  "fix_probes": [
    { "type": "grep_present", "path": "AGENTS.md", "pattern": "## 5\\) Web API Contract Checklist" }
  ],
  "artifacts": [
    "AGENTS.md",
    "ROUTER.md"
  ],
  "remediation": {
    "source": "self#acceptance-criteria",
    "criteria": "In AGENTS.md, delete or reduce to one-line pointers the sections now duplicated elsewhere: §4 Data Persistence (→ ARCHITECTURE.md Persistence Pipeline), §5 Web API Contract Checklist (→ docs/web-api.md), §11 Architecture And Key Paths (→ ARCHITECTURE.md System Map / ARCHITECTURE-DECISIONS.md); decide §12 Important Configuration field-list placement explicitly. Update ROUTER.md pointers if any targets move. Do NOT touch the real contracts (§0.1-§0.3, §1-§3, §6-§10, §13-§15 — code evidence, no duplicate home). DONE when: the §5 Web API Contract Checklist heading is gone (freshness probe flips to landed), AGENTS.md line count materially drops with no information loss, npm test green."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```
