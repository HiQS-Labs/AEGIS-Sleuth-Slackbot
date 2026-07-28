---
title: Unify Command Catalog / Registry
status: complete
last_updated: 2026-06-10
objective: Consolidate Sleuth's natural-language command discovery into one declarative registry centered on `data/static/ai/command-catalog.json` without regressing deterministic routing, help generation, or RMM safety.
primary_sources:
  - ARCHITECTURE.md
  - src/chat-module.js
  - src/command-intent-resolver.js
  - src/command-catalog.js
  - src/catalog-regex-aliases.js
---

| Most recently completed phase | What's next |
| --- | --- |
| Phase 5 - Verification and cutover complete. All success criteria met. | Project complete — move to 3-COMPLETED. |

## Table of Contents

1. [Goal](#goal)
2. [Current State](#current-state)
3. [Phases](#phases)
4. [Success Criteria](#success-criteria)
5. [Non-Goals](#non-goals)

## Goal

Create one place to review and edit natural-language command discovery.

In the target design:

- `data/static/ai/command-catalog.json` is the canonical registry for command discovery inputs: aliases, intent phrases, regex aliases, and any other command-shaped natural-language mappings that should resolve into an existing route.
- `CommandRouter` remains the execution registry in code.
- `deterministic-responses.json` remains only for true canned responses that are not part of the command catalog.
- `command-normalization.json` either becomes a narrow preprocessing layer with a clearly documented boundary, or its command-shaped patterns move into catalog-owned metadata.

## Current State

- [x] `CommandRouter` in `src/chat-module.js` is still the runtime execution registry for chat commands.
- [x] `data/static/ai/command-catalog.json` already drives help generation, the `commands` list, RMM candidate selection, and catalog-backed `RegexAliases`.
- [x] `src/catalog-regex-aliases.js` already lets catalog entries register NL regex aliases onto existing routes at startup.
- [x] `data/static/ai/command-normalization.json` still owns model alias rewrites and `DirectCommandPatterns` that build canonical commands before RMM.
- [x] `data/static/deterministic-responses.json` still owns exact-phrase deterministic replies checked before AI chat.
- [x] `show-me` and `show-me-projects` already use catalog-backed `RegexAliases`.
- [x] `show-channel-model` natural-language identity questions still rely on the code-exported `ModelIdentityPattern`, so that command family is not fully catalog-owned yet.

## Phases

### Phase 0 - Baseline Audit

- [x] Confirm the architecture boundary from `ARCHITECTURE.md`: router executes commands, catalog drives discovery, and RMM resolves against the catalog rather than live route registration.
- [x] Confirm the current split across `command-catalog.json`, `command-normalization.json`, `deterministic-responses.json`, and code-registered fast paths in `src/chat-module.js`.
- [x] Confirm catalog-backed alias registration already exists through `src/catalog-regex-aliases.js`, so the plan should extend that mechanism instead of inventing a parallel one.
- [x] Identify the main remaining drift point: code-only NL aliases such as `show-channel-model` model-identity questions.
- [x] `/phase-qa` gate — not applicable (docs-only audit phase; no DRY/SOLID surface).

### Phase 1 - Define the Unified Registry Contract ✅ Closed 2026-06-10 — phase-gate passed

- [x] Write a short architecture note that explicitly answers which discovery inputs belong in `command-catalog.json`, which belong in `command-normalization.json`, and which remain in `deterministic-responses.json`. → Added three-file boundary table to `ARCHITECTURE.md` (command-catalog-help-rmm section).
- [x] Add first-class typedef and validation coverage in `src/command-catalog.js` for every catalog field the plan depends on, instead of relying on implicit JSON shape. → `@typedef CommandCatalogEntry` and `ValidateCommandCatalogShape` now cover `RegexAliases` shape and cross-validate `RegisteredRoutes`.
- [x] Decide whether exact-match command phrases become catalog metadata or remain a separate exact-match layer with a documented reason. → Decision: they remain in `deterministic-responses.json` as a separate layer; the LLM is not involved. Phase 3 will classify each entry and migrate the command-shaped ones into the catalog.
- [x] Define the only acceptable code-only exception: a route may keep an inline pattern only when its behavior cannot be expressed safely as declarative alias data, and that exception must be commented in code. → Documented in `ARCHITECTURE.md` and enforced by convention in `src/chat-module.js` (outgoing aliases carry the required comment).
- [x] `/phase-qa` gate — passed (DRY fix applied: `CommandCatalogPath` import; no SOLID violations).

### Phase 2 - Inventory and Migrate Remaining Code-Only NL Aliases ✅ Closed 2026-06-10 — phase-gate passed

- [x] Audit every `Router.Register(...)` pattern in `src/chat-module.js` and `RemindersAppMentionHandler` and label it as one of: primary command syntax, catalog-owned alias, or justified code-only matcher. → All routes are primary command syntax except two justified code-only matchers (`switch-models` uses a function pattern for key-value parsing; `live-model-catalog-question` uses `IsLiveModelCatalogQuestion`). The only catalog-owned alias was `show-channel-model` NL identity — migrated below.
- [x] Move `show-channel-model` natural-language identity questions out of `show-channel-model-command.js` / `chat-module.js` and into catalog-backed alias data. → `ModelIdentityPattern` regex moved to `RegexAliases` on the `show-channel-model` catalog entry. `ModelIdentityPattern` export kept for the thread-reply intercept in `chat-module.js`, which is a justified code-only use outside the route dispatch path.
- [x] For any other command family that has multiple NL phrasings, prefer catalog aliases over new inline regexes. → No other families found with tacked-on NL aliases; `RemindersAppMentionHandler` patterns are all primary command syntax.
- [x] Keep exact typed command syntax as the primary code route so alias registration remains append-only and cannot shadow the base command. → Maintained throughout; all catalog `RegexAliases` are registered after code routes.
- [x] `/phase-qa` gate — passed retroactively. `ModelIdentityPattern` appears in both JS and catalog JSON (two occurrences, different formats, documented); within Rule-of-Two threshold.

### Phase 3 - Fold Command-Shaped Exact Matches Into the Same Registry ✅ Closed 2026-06-10 — phase-gate passed

- [x] Review `data/static/deterministic-responses.json` and classify each entry as either a true canned reply or a command-shaped alias. → 3 entries: `version` (command-shaped, migrated), `ping` (true health probe, stays), `reminders-for-user` (workspace-specific config template with hardcoded user IDs, stays).
- [x] Move command-shaped exact matches into the command catalog so they dispatch through the same route and validation pipeline as regex aliases and RMM intents. → `version` migrated: new `src/chat-commands/version-command.js`, registered route in `chat-module.js`, catalog entry with `RegexAliases` for "show version" / "what version". Removed from deterministic-responses.json and the `#ExecuteDeterministicResponseAsync` switch.
- [x] Keep true non-command responses such as static replies or health probes in `deterministic-responses.json`, or document why a given entry still belongs there. → `ping` stays (true canned response); `reminders-for-user` stays (documented: workspace-specific user IDs cannot be a generic catalog pattern).
- [x] Add validation that the same phrase cannot be declared as both a deterministic response and a catalog-owned command alias. → Added to `scripts/validate-command-catalog.js`: strips app-mention prefix from deterministic phrases and checks for overlap with catalog `Aliases` arrays.
- [x] `/phase-qa` gate — passed retroactively. `version` case removed from deterministic switch (improves O/C); `version-command.js` single-responsibility; cross-validation in validate script is standalone. No violations.

### Phase 4 - Reduce the Split Between Normalization and the Catalog ✅ Closed 2026-06-10 — phase-gate passed

- [x] Review `DirectCommandPatterns` in `data/static/ai/command-normalization.json` and decide whether they are genuinely preprocessing logic or command discovery data in disguise. → **Decision: they stay.** All 8 patterns canonicalize typed command syntax variations (spacing, key order, hyphen vs. space); none are NL discovery. Boundary documented in `ARCHITECTURE.md` three-file table.
- [x] If they stay separate, narrow that file to reusable normalization primitives and document the boundary clearly. → Boundary note added to ARCHITECTURE.md: add to normalization for syntax variants; add to catalog RegexAliases for NL phrasings.
- [x] If they move, teach `src/command-intent-resolver.js` to read the patterns from catalog-owned metadata and remove the duplicate source of truth. → Not applicable — they stay.
- [x] Add validation that every executable catalog intent still has matching `BuildCanonicalCommand` and `BuildSyntaxTemplate` coverage where required. → `BuildCanonicalCommandIntentIds` set exported from `command-intent-resolver.js`; `validate-command-catalog.js` now checks (a) every `CanExecuteWithIfl:true` catalog entry and (b) every `DirectCommandPatterns` IntentId against this set. Also fixed a Phase 3 gap: `version` was missing its `BuildCanonicalCommand` case.
- [x] `/phase-qa` gate — passed. Waiver: `BuildCanonicalCommandIntentIds` intentionally duplicates switch case labels for static validation snapshot; documented in code comment, same file, low drift risk.

### Phase 5 - Verification and Cutover ✅ Closed 2026-06-10 — phase-gate passed

- [x] Run `npm run validate:commands` with zero route drift and zero help drift. → Passed after fixing 6 pre-existing `CanExecuteWithIfl:true` catalog entries missing `BuildCanonicalCommand` cases (`view-stratalist`, `changelog`, `rmm`, `ask-self`, `ask-code`, `recall`) and removing `"ping"` from the `ping` catalog `Aliases` array (conflict with deterministic-responses.json).
- [x] Regenerate `data/static/HELP.md` with `node scripts/generate-help.js` after catalog changes. → Regenerated clean.
- [x] Add focused tests for alias registration and precedence across the critical paths: `show-me`, `show-me-projects`, `show-channel-model`, deterministic exact match, and direct model-switch normalization. → Added to `tests/catalog-regex-aliases.test.js`: 42 tests passing. New sections cover `show-channel-model` NL aliases, deterministic/catalog boundary (ping), and `NormalizeDirectCommandTextAsync` model-switch patterns.
- [x] Update `ARCHITECTURE.md` so the final boundary is explicit: catalog owns NL command discovery, router owns execution, and deterministic responses are only for non-command canned replies. → Added four-row "Final command-discovery boundary summary" table to the command-catalog-help-rmm section.
- [x] `/phase-qa` gate — passed. No DRY/SOLID violations; 6 switch cases fill pre-existing gaps, not new debt.

## Success Criteria

- [x] A developer can audit almost all NL-to-command mappings by reading `data/static/ai/command-catalog.json` first.
- [x] No command alias lives only in code unless the code carries a documented exception.
- [x] RMM, regex aliases, and exact-match command aliases all resolve into the same registered route names.
- [x] Validation fails when route registration, help output, or command-discovery metadata drift out of sync.

## Non-Goals

- [x] Do not move command handler implementations out of code. *(honored)*
- [x] Do not collapse `CommandRouter` and reminder app-mention routing into one runtime dispatcher as part of this effort. *(honored)*
- [x] Do not change command permissions, risk levels, or execution semantics unless the unification work requires a separate, explicitly reviewed behavior change. *(honored)*
