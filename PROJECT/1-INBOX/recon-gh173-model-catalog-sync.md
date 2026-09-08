# Recon Map — GH-173 Model-catalog sync (AEGIS-Sleuth-Slackbot PR #180)

Head: `aea40b8e326591cc67e02da6ab0d43eccd979113` · Base: `development` @ merge-base `0ac2cbce` · Mode: grep+read in the review clone + one read-only Explore lane (hermetic/consumers/docs) · Review artifact for PR #180 (Phase 2 mirror of XYZ-forge #456 / GH-450)

## Subject and change class

- **Subject**: build-time sync of Model-catalog v1.0.0 into the GH-168 resolver's `ModelAliases` table + provenance-aware `run-diagnostics`.
- **Change class**: contract change — `ModelAliases` becomes a GENERATED section (single writer: `scripts/sync-model-catalog.js`), with two new provenance fields and one additive accessor.

## The seams

| Seam | Location | Crosses | Breaks if |
|---|---|---|---|
| Vendored byte-identity | `data/static/ai/model-catalog.json` + `.pin.json` (sha256 `9ff019fd…` = v1.0.0) | this repo ↔ Model-catalog v1.0.0 (`75e19139`) | hand edit (CheckSync red); tag move without `--expect-sha256` (script refuses, `sync-model-catalog.js:270-274`) |
| Generated section | `command-normalization.json` `ModelAliases` + `ModelAliasesCatalog` header | sync script (only writer) ↔ resolver + diagnostics | hand edit (drift red, `tests/model-catalog-sync.test.js:117`); row edits anywhere but upstream |
| Row order | catalog order kept deterministic (`sync-model-catalog.js:86-88`) | `--check` compares index-by-index (order contract for the drift check); runtime is order-insensitive (first-match on duplicate lowercase `Match` only, upstream enforces `(match,target)` uniqueness) | non-deterministic render |
| Additive provenance | `GetModelAliasProvenanceAsync` (`command-intent-resolver.js:259-270`) | diagnostics only; resolution untouched (`:180-224` reads `Match`/`Replace`) | any consumer assuming the table has exactly 2 fields (none exists) |
| Hermetic runtime | `src/` reads only `command-normalization.json` (`command-intent-resolver.js:98`); vendored copy read only by script + tests | deploy needs no catalog network (`.deploybuild.yaml` has no sync step) | someone adding a runtime catalog fetch |
| Docs story | `GH-168-MODEL-ALIAS-RESOLVER.md:84`, `ARCHITECTURE.md:182` still say hand-maintained | operator guidance ↔ generated reality | an operator follows them → red `--check` (the stale-survivor class) |

## Call paths in

- Resolution: `model-switch-command.js:58,90`, `set-channel-model-command.js:36` → `ResolveModelAliasAsync` → `GetModelAliasMap` (order-insensitive). Display: `models` command (`chat-module.js:670`, `models-command.js:20`) → `GetModelAliasRowsAsync` (file order; integration assertion made order-independent in this PR). Diagnostics: `VerifyModelAliasPinsAsync` + new `DescribeModelAliasCatalogAsync` (`diagnostics-report.js:222,258`).
- Sync (commit-time only): `npm run sync:model-catalog -- --tag vX.Y.Z [--expect-sha256]` → fetch/verify/write 3 files → post-write self-check. `--check` fully offline.

## State

- Vendored copy + pin + rewritten `ModelAliases` (53 rows, provenance columns, catalog order); `DirectCommandPatterns` and all other keys carried byte-identical; generated keys moved to file front (cosmetic to all consumers — everything `JSON.parse`s).
- `catalog-editor` (`tools/catalog-server.js`) writes only `command-catalog.json` — no two-writer conflict with the sync.
- `releases.db/sql`: intake snapshot; `development` hasn't moved them since the merge base (no conflict risk).

## Contracts

- `--check` = vendored sha == pin, version == pin, header == pin, rows 1:1 in catalog order. Gap: `Pin.native_rows` itself is never cross-checked (review follow-up).
- Tag moves require operator-supplied `--expect-sha256` — a fetch is never self-certifying (stronger than the XYZ `pin` verb; worth porting there).
- Miss ≠ refusal preserved: pass-through unresolved → catalog validation → `'…' not found` (GH-168 tests untouched and green).

## Build, failure and rollback

- CI PR job: `npm test` (jest 2298 + node:test 116 — reproduced locally, exit 0), `tsc` build, FSM invariants, sanitize + TruffleHog scans. Drift check covered via the sync suite, not a dedicated named step.
- Failure: every failure path in `DescribeModelAliasCatalogAsync` degrades to a diagnostics line; `catalog_version`-style never-throw discipline maintained.
- Rollback: revert branch; generated section reverts with it; no data migration (JSON only).

## Unknowns

| Unknown | Why it matters | What would settle it |
|---|---|---|
| Whether `GH-168-MODEL-ALIAS-RESOLVER.md:84` provenance sentence has other readers relying on "loader ignores them" | docs-only, but the loader no longer ignores them | grep for `Provider`/`Source` consumers in src/ (none found within budget) |
| Upstream `verified_on` authenticity | 31/53 diagnostics claim | settled by this review: the vendored copy is sha-identical to the tag, so dates are upstream's verbatim |

## Current-state radius, one line

The Sleuth bot's entire model-routing vocabulary on dev (and now deployed to Development at `af182b0`) resolves through one generated, sha-pinned table shared with XYZ-forge and the catalog of record.

**Verdict**: Recon complete — 6 seams, 1 real unknown, current-state radius: the bot's model routing + its diagnostics trail, pinned to the same v1.0.0 tag as the Phase 1 mirror.
