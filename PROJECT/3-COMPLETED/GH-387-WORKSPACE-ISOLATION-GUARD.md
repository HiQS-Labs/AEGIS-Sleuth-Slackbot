---
title: "CI guard: fail on per-workspace state resolved via globals / off-pattern route registration (#384 class)"
status: Planned (1-INBOX) — not started
created: 2026-07-15
updated: 2026-07-15
owner: noel
branch: fix/gh-387-workspace-isolation-guard
doc_type: project
gh_issue: 387
source: https://github.com/NeochromeTeam/sleuth-app/issues/387
related: "#384 (root cause), BaseModule 1.4.222, scripts/validate-fsm-invariants.js (pattern to copy)"
effort: 2
complexity: 2
risk: 1
phases: 1
---

# GH-387 — Structural CI guard for the #384 tenant-isolation class

## Problem
#384 shipped because `ask-reminders` resolved its per-workspace `SlackApp` from a **process-global**
(`global.__sleuthaskreminders__`) that always returned the first-loaded workspace. It was the *only*
route off the canonical per-workspace pattern, and nothing structural caught the deviation. We now
have the `BaseModule` primitive (1.4.222) + AGENTS.md §0.1/§0.1.1/§0.1.2 — but docs are advisory. This
class of bug should **fail CI**, exactly as the reminder FSM invariants already do
(`npm run validate:fsm` → `scripts/validate-fsm-invariants.js`).

## Integration points
- `scripts/validate-fsm-invariants.js` — the proven scan-and-fail validator to mirror (allowlist
  pragma, file:line output, non-zero exit).
- `package.json` — `scripts` (`validate:*`) + the aggregate `validate` + CI wiring.
- `src/catalog-regex-aliases.js` — holds the remaining legacy `global.__sleuthaskreminders__`
  fallback lookup; it gets the reviewed pragma so the guard lands green.
- `AGENTS.md` — note the new validator next to the FSM one.

## Phase 1 — the guard (single phase)
- [ ] **P1.1 — `scripts/validate-workspace-isolation.js`.** Scan `src/` for the two #384 shapes:
      (1) a `global.__sleuth*` (or module-level singleton) read that resolves per-workspace state;
      (2) a **primary** `Router.Register({... Route ...})` whose Handle is the primary implementation
      registered outside a module's `RegisterCommandRoutes()` (catalog-alias delegation in
      `catalog-regex-aliases.js` stays allowed). Honor an inline `// ISOLATION-OK: <reason>` pragma
      (mirror `// FSM-BACKFILL-OK`). Exit non-zero with file:line on violation.
- [ ] **P1.2 — wire + seed.** Add `validate:workspace-isolation` to `package.json` scripts + the
      `validate` aggregate + CI. Run against current tree; pragma-tag the known-legit globals so it
      lands green. Document in AGENTS.md.

### QA gate — Phase 1
- [ ] Reintroducing the #384 pattern (resolve `SlackApp` from `global.__sleuthaskreminders__` without
      a pragma) fails the validator with a file:line pointer.
- [ ] Registering a primary route outside `RegisterCommandRoutes` fails it.
- [ ] A legit global tagged with the reviewed pragma passes.
- [ ] Runs in CI; `development`/`main` green after seeding the allowlist.

## Out of scope (YAGNI)
- Migrating existing modules onto `BaseModule` (separate, incremental).
- Runtime enforcement — this is a static/CI guard only.
- A full AST parser if regex + a narrow set of shapes suffices (mirror the FSM validator's approach).

## Constraints
Mirror the proven `validate-fsm-invariants.js` design, don't invent a new validator framework. Must
land green on the current tree (seed the allowlist). `npm test` + `npm run validate` green. Bump
version + CHANGELOG.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "node scripts/validate-workspace-isolation.js && npx jest validate-workspace-isolation --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "package.json", "pattern": "validate:workspace-isolation" }
  ],
  "artifacts":   [
    "scripts/validate-fsm-invariants.js",
    "package.json",
    "AGENTS.md"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-387 Phase 1 — validator + wiring + allowlist seed (P1.1, P1.2)" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

<!-- Preflight note: `artifacts` lists EXISTING anchor files verified at the ref. The NEW files the
     lane creates (scripts/validate-workspace-isolation.js, tests/validate-workspace-isolation.test.js)
     go in the MARATHON.yaml phase `artifact` write-allowlist, not here. -->

## Progress log
- 2026-07-15: issue #387 filed, plan drafted, parked in ROADMAP, added to the
  `sleuth-hardening-383-387-388` marathon (phase p1). Not started.
