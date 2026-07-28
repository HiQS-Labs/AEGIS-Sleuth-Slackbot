---
gh_issue: 348
source: https://github.com/NeochromeTeam/sleuth-app/issues/348
title: Adopt AGENTS-PROPOSED.md (Blend philosophy) into GUIDING-PRINCIPLES.md — gradiated, 2-phase plan
status: Completed — both phases landed via the marathon swarm (codex builder + agy reviewer), 2026-07-09; issue #348 closed via PR #359
created: 2026-07-03
updated: 2026-07-09
owner: noel
doc_type: feedback
effort: 2
complexity: 2
risk: 1
phases: 2
goal: >-
  Reconcile the incoming AGENTS-PROPOSED.md (Blend philosophy) submission against current repo
  state and land it as a new Engineering Philosophy section in GUIDING-PRINCIPLES.md, without
  weakening any existing Sleuth-specific contract.
---

# Adopt AGENTS-PROPOSED.md (Blend philosophy) into GUIDING-PRINCIPLES.md

## Status

| What was just completed | What's next |
|---|---|
| Both phases shipped via the marathon swarm (codex builder + agy reviewer), 2026-07-09 — `GUIDING-PRINCIPLES.md` has a new Engineering Philosophy section; `npm test` green (1200/1200). | _None — issue closed._ |

## Amendment (2026-07-03)

**Destination changed from `AGENTS.md` to `GUIDING-PRINCIPLES.md`.** Original review landed on an
additive "Engineering Philosophy" section inside `AGENTS.md`. A follow-up doc-governance pass (same
day, prompted by an unrelated PDDA-install discussion) decided `GUIDING-PRINCIPLES.md` should hold
*two* sections — its existing PDDA doc-governance content, plus a new general engineering-philosophy
section — while `AGENTS.md` sheds both this new content and its own redundant inventory sections
(tracked separately, see the sibling AGENTS.md-trim issue). Everything below this note is the
original Phase 1/2 analysis; read `AGENTS.md` → `GUIDING-PRINCIPLES.md` wherever it says the
opposite.

## Ask

`AGENTS-PROPOSED.md` ("The Blend: SOLID × Ponytail × Ousterhout") is a repo-agnostic engineering
philosophy submitted as an incoming directive to overwrite the SWE-philosophy portion of
`AGENTS.md`. First review (2026-07-03) found it well-formed but with zero Sleuth-specific
grounding and two direct conflicts with current repo state — see [GH issue #348](https://github.com/NeochromeTeam/sleuth-app/issues/348)
for the full two-phase breakdown and QA gates.

## Findings (summary)

- `AGENTS.md` has no single "philosophy" section to overwrite — it is checklist-driven throughout,
  with philosophy implicit in §0.1 Guardrails, §6 Conventions, §15 Anti-Patterns. A wholesale
  overwrite risks deleting Sleuth-specific contracts (FSM invariants, command-catalog boundary,
  module ownership) that the raw proposal has no equivalent for.
- Rule 4 (mandated `// ponytail: [assumption], revisit when [trigger]` comment tag) overlaps
  `docs/coding-conventions.md`'s existing single-line comment rule (lowercase first word, ends
  with a period) — needs reconciling into one convention, not left to silently coexist.
- Rule 9 ("an injected seam is the absolute last resort") contradicts current test practice:
  `tests/mocks/`, `mock-slack-app.test.js`, and 43 test files rely on `jest.mock`/`jest.fn` as
  first-class seams. Adopted literally, this would put a large share of the existing suite in
  violation on day one.
- `AGENTS.md` §15 itself lists "adding architecture rules to this file without code evidence" as
  an anti-pattern — the raw proposal, as submitted, cites no Sleuth code evidence anywhere.

## Explicit non-goal

This work does **not** require refactoring the existing test suite to comply with Rule 9. The
DI/seam rule is scoped to new, non-test production code only going forward; the current
jest-mock-based test infrastructure is treated as a permanent, accepted exception — not deferred
debt to pay down later. This is a deliberate gradiated/non-dogmatic adoption, not a full-compliance
mandate.

## Acceptance criteria

- [x] Phase 1 — reconciled `AGENTS-PROPOSED.md`: added a landing annotation noting the section is
      prospective/additive, doesn't require a test-suite retrofit, and treats the `// ponytail:`
      comment form as preferred-when-needed rather than mandatory.
- [x] Phase 2 — landed a new `## Engineering Philosophy` section in `GUIDING-PRINCIPLES.md` (not
      `AGENTS.md`, per the 2026-07-03 amendment above), with an explicit Adoption Notes subsection
      carving out: prospective-only application, Sleuth-specific contracts stay authoritative on
      conflict, the existing `jest.mock`/`jest.fn` test infrastructure as a standing seam-rule
      exception, and the `// ponytail: [assumption], revisit when [trigger].` comment form.
- [x] No Sleuth-specific contract weakened (`AGENTS.md`/`ARCHITECTURE.md`/coding-conventions untouched).
- [x] `npm test` green (1200/1200) as the regression gate.

Built via the marathon swarm (codex builder + agy reviewer) 2026-07-09.

## Swarm Preflight Contract

Docs/governance-only lane, independent zone. Write-set (`GUIDING-PRINCIPLES.md`, `AGENTS-PROPOSED.md`)
is file-disjoint from every active lane. **Semantic-coupling note:** sibling of GH-352 (trim
`AGENTS.md`) — file-disjoint, so parallel-safe by the collision detector, but both restructure the
AGENTS/GUIDING/ROUTER doc trio; prefer landing this one first so GH-352 can point at the finished
`GUIDING-PRINCIPLES.md` Engineering Philosophy section. `gate: npm test` is a regression guard only.

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test",
  "fix_probes": [
    { "type": "grep_absent", "path": "GUIDING-PRINCIPLES.md", "pattern": "Engineering Philosophy" }
  ],
  "artifacts": [
    "GUIDING-PRINCIPLES.md",
    "AGENTS-PROPOSED.md"
  ],
  "remediation": {
    "source": "self#acceptance-criteria",
    "criteria": "Phase 1: reconcile AGENTS-PROPOSED.md (Blend philosophy) — decide placement, merge comment-format guidance, carve out the DI/seam rule as an accepted test-suite exception (do NOT refactor the test suite), add inline annotations. Phase 2: land the reconciled content as a new 'Engineering Philosophy' section in GUIDING-PRINCIPLES.md (NOT AGENTS.md — see the 2026-07-03 amendment), applied prospectively to new code only. DONE when: GUIDING-PRINCIPLES.md contains the 'Engineering Philosophy' section (freshness probe flips to landed), no Sleuth-specific contract is weakened, npm test green."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```
