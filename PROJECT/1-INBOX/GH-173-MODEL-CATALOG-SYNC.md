---
gh_issue: 173
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/173
title: "Consume Model-catalog v1 (Phase 2): sync ModelAliases from the shared catalog + provenance-aware diagnostics"
status: Proposed (1-INBOX — executing on feat/gh173-model-catalog-sync; this repo's vendored releases CLI has no repoint verb, so the capture stays here like GH-168 did)
created: 2026-09-05
updated: 2026-09-05
owner: noel
doc_type: feature
effort: 2
complexity: 1
risk: 1
phases: 1
branch: feat/gh173-model-catalog-sync
related: "GH-168 (resolver, shipped), GH-171 (resolver project), HiQS-Labs/Model-catalog#1 (umbrella), HiQS-Labs/XYZ-forge#450 (Phase 1 mirror)"
---

# GH-173 — Consume Model-catalog v1 (Phase 2)

> **1-INBOX capture** (PROJECT/PDDA.md → GitHub issue intake), parked in the RELEASES DB ledger.
> Executed on `feat/gh173-model-catalog-sync`; the PR is the surface of record for gate evidence.

## What shipped (Model-catalog PROJECT.md Phase 2)

1. **Build-time sync — `scripts/sync-model-catalog.js`** (`npm run sync:model-catalog -- --tag vX.Y.Z`).
   Fetches `https://raw.githubusercontent.com/HiQS-Labs/Model-catalog/<tag>/data/catalog.json`,
   verifies its sha256 (against the committed pin when the tag is unchanged; against an
   operator-supplied `--expect-sha256` when moving to a new tag — a fetch is never
   self-certifying), keeps a byte-identical vendored copy at `data/static/ai/model-catalog.json`
   with `model-catalog.pin.json` beside it, filters `target: "native"`, and rewrites the
   `ModelAliases` section of `data/static/ai/command-normalization.json` as
   `{ Match, Replace, Source, VerifiedOn, Flags }` plus a `ModelAliasesCatalog` header
   (repo/tag/version/sha256/synced date). Every other key in that file is hand-maintained and is
   carried through untouched. `--from <file>` syncs offline from a local checkout. Nothing reads
   the catalog at runtime.
2. **Loader unchanged.** `GetModelAliasMap` / `GetModelAliasRowsAsync` still read only
   `Match`/`Replace` (`src/command-intent-resolver.js`). One additive accessor,
   `GetModelAliasProvenanceAsync`, exposes the provenance columns and the catalog header for
   diagnostics; the resolver's staged entire-value lookup and its refusal contract are untouched.
3. **Reconciliation — `npm run validate:model-catalog`** (`--check`) and
   `tests/model-catalog-sync.test.js`: vendored sha256 == pin, catalog version == pin,
   `ModelAliases` == the vendored copy's native rows 1:1 and in order (53 for `v1.0.0`), no
   openrouter row leaks, provenance columns present, `gemini pro` carries
   `unverified-generation`, `DirectCommandPatterns` unchanged. Negative controls on scratch copies:
   hand-edited `Replace`, removed row, flipped vendored row, stale pin sha, missing copy — each red
   by name; re-running the sync closes every edge.
4. **Diagnostics — `DescribeModelAliasCatalogAsync`** (`src/diagnostics-report.js`): one new
   `run-diagnostics` line directly under the GH-168 pins line, read from the synced file:
   `• Alias catalog: HiQS-Labs/Model-catalog v1.0.0 (v1.0.0, 53 rows, synced 2026-09-05) — 31/53
   rows verified on 2026-09-04; flagged: gemini 2.5 pro → gemini-2.5-pro [unverified-generation],
   gemini pro → gemini-2.5-pro [unverified-generation]`. The pins line keeps its exact GH-168
   semantics: STALE only for a successful catalog that lacks the pin, UNVERIFIABLE for an
   unconfigured or failed provider. Flags are advisory — they surface here and nowhere else; a
   flagged row resolves normally.

## Decisions taken that the plan left open

- **The catalog version is recorded in the diagnostics trail, not appended to the chat reply.**
  `(resolved from 'ChatGPT')` is pinned by `tests/model-switch-command.test.js` and the GH-168
  smoke; changing the reply string would churn every consumer for a fact the operator reads in
  `run-diagnostics`. The "resolved by catalog vX.Y.Z" record lives on the catalog line.
- **A vendored copy, not a deploy-time fetch.** The sync runs in the sync PR and the deploy ships
  the committed result — a build box that must reach GitHub to deploy would be a new failure mode
  for a change whose whole point is hermetic pins.
- **Row order follows the catalog.** The resolver is entire-value with upstream-enforced
  `(match, target)` uniqueness, so order is not load-bearing; the previous hand order was not
  preserved because a deterministic order is what makes the 1:1 check comparable.

## Data reconciliation against the previous hand-maintained table

Before the sync, `ModelAliases` had 53 rows; the catalog's native set is the same 53 `Match` keys
with the same `Replace` values (0 added, 0 removed, 0 repinned). The sync changed provenance and
order, never resolution — the resolver tests pass unchanged.

## Acceptance (from #173)

- [x] Synced rows reconcile 1:1 with Model-catalog `v1.0.0` native rows (53).
- [x] Resolver tests green unchanged; `rmm change model to ChatGPT` → `gpt-5.6-terra`
      `(resolved from 'ChatGPT')`; catalog version on the diagnostics line.
- [x] Flags advisory end to end: `gemini pro` resolves to `gemini-2.5-pro`; the flag shows in
      `run-diagnostics`.
- [x] Unknown names refuse exactly as #168 shipped (pass-through → validation → not found).
- [x] Deploy to development verified per `temp/SOP.md` — see Evidence.

## Evidence (PR #180 carries the full transcript)

- Gates (un-sandboxed): jest 2298/2298 (131 suites), node:test 116/116, `tsc` clean, secret scan
  clean, `validate:changelog-tone` clean, `validate:model-catalog` OK.
- Red before green: hand-edited `Replace` → `--check` exit 1 + 3 sync cases red; flag surfacing
  removed → 2 diagnostics cases red; resolver default-on-miss → 4 cases red (incl. GH-168's
  refusal test). Each reverted.
- Development deploy: DeployHQ `d415dc27-6996-4bc0-8370-cf4e74846415`, branch
  `feat/gh173-model-catalog-sync` → `af182b0`, completed in 315 s with all 5 build gates executed;
  host `sleuth-app` active, MainPID started 2026-09-06 04:06:39 UTC, new symbols present by
  content grep. Live in `#2-sleuth-dev-branch`: `run-diagnostics` shows the
  `• Alias catalog: HiQS-Labs/Model-catalog v1.0.0 … flagged: … gemini pro → gemini-2.5-pro
  [unverified-generation]` line; `switch-models:'ChatGPT'` → `Default model switched to
  'gpt-5.6-terra' (resolved from 'ChatGPT')`; `switch-models:'no-such-model-gh173-live'` →
  `'no-such-model-gh173-live' not found. Default still using 'gemini-3.8-flash'`. Default restored
  to `gemini-3.8-flash` afterwards.

## Known, not touched

- `npm run validate:commands` fails on `development` before this change (`registered command
  routes missing from command-catalog.json: ask-self, run-tests-unavailable`). Not in CI's gate
  list; unrelated to this change; left for its own issue.
