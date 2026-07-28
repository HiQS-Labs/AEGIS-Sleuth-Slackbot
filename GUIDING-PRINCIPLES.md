# Guiding Principles (PDDA doc-governance layer)

The north star that this repo's PDDA-managed project docs (`PROJECT/**`, `ROADMAP.md`,
`CHANGELOG.md`) answer to. This governs the doc-automation layer, not Sleuth's product or
architecture principles — see `AGENTS.md` and `ARCHITECTURE-DECISIONS.md` for those.

## Purpose

PDDA exists to make this repo's project docs a **reliable source of truth and work signal for
long-running AI agent tasks** — so an agent (or human) can stop, resume, or hand off at any point and
recover full state from the docs alone, not from memory or chat history.

## Principles

1. **Docs are the runtime state, not a record of it.** The current `PROJECT/**` docs *are* the
   project's state. If reality and the docs disagree, that is the bug to fix.
2. **Resumable by a cold agent.** Every active doc must let an agent with zero prior context answer
   "what was just done, what's next" in seconds — that's why the status header is a contract.
3. **Deterministic where judgment isn't needed.** Scripts enforce the mechanical rules; the LLM
   reviewer only handles what regex can't. Never make an agent re-decide settled hygiene.
4. **One canonical place per fact.** `ROADMAP.md` points, project docs hold detail, `CHANGELOG.md`
   logs outcomes. No fact lives in two places where they can drift.
5. **A clear signal of what is live.** `PROJECT/2-WORKING` holds only truly active work, so "what
   should an agent pick up" is never ambiguous.
6. **Low-friction and portable.** The contract must be cheap to adopt and cheap to obey, or agents
   will route around it.

## Engineering Philosophy

This section governs default engineering judgment for new work in this repo. It is additive to the
PDDA doc-governance rules above, and it never weakens explicit Sleuth contracts in `AGENTS.md`,
`ARCHITECTURE.md`, or `docs/coding-conventions.md`.

1. **Complexity is the enemy.** Minimize surface area, maximize module depth, and defer design
   machinery that is not yet justified by a real requirement.
2. **One decision, one owner.** A data format, state transition, protocol rule, or algorithm should
   have one clear owning module or write path.
3. **No abstraction without a second real case.** Prefer direct concrete code until a second real
   mechanism, or a true IO/trust-boundary contract, proves the seam is worth carrying.
4. **Pull complexity downward.** Internal complexity is acceptable when it makes callers simpler;
   shallow wrappers and pass-through layers are not.
5. **Keep essential complexity.** Do not trade away trust boundaries, error handling, recovery
   behavior, or contract honesty in the name of minimalism.
6. **Respect the neighborhood.** Apply these rules to the diff you are making; do not widen scope
   into opportunistic refactors just to make surrounding code look purer.
7. **Prefer reversible changes.** When two approaches are equally valid, choose the one that is
   easier to delete or revise next week.
8. **Leave behind a concrete check when logic earns it.** New code with branches, state mutation,
   math, or data transformation should leave behind one runnable check on the concrete path by
   default.

### Adoption Notes

- This philosophy applies prospectively to new or modified production code. It is guidance for
  present-tense decisions, not a mandate to refactor the existing codebase into compliance.
- Sleuth-specific contracts remain authoritative. If this section conflicts with a repo-specific
  rule, the narrower rule in `AGENTS.md`, `ARCHITECTURE.md`, or a canonical subsystem doc wins.
- Existing `jest.mock` / `jest.fn` test infrastructure is a standing exception to the seam rule. No
  current test-suite refactor is implied or required by this adoption.
- When an assumptions/ceilings comment is useful, the preferred form is
  `// ponytail: [assumption], revisit when [trigger].` It remains subject to the existing single-line
  comment convention in `docs/coding-conventions.md`.

## How to apply

When adding or changing a PDDA-governed doc, ask: *does this make project state more resumable, less
ambiguous, and harder to drift for a long-running agent?* If not, reconsider.
