---
gh_issue: 168
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/168
title: "Model alias resolver: 'OpenAI', 'ChatGPT', 'Claude', 'Sonnet' resolve to a pinned model ID before catalog validation"
status: Proposed (1-INBOX — not yet active)
created: 2026-09-04
owner: noel
doc_type: feature
effort: 2
complexity: 1
risk: 2
phases: 1
related: "GH-88 Phase 5 (dual-path did-you-mean reply) is the catch-all for what this table cannot map; ship this first"
---

# GH-168 — Model alias resolver

## Model alias resolver — vendor and family names resolve to a pinned model ID before validation

**Trigger (2026-09-04, prod):** `rmm change model to Open AI` / `ChatGPT` → `not found`. A user who says "OpenAI", "ChatGPT", "Claude", "Sonnet" means something specific and conventional; the bot should honor the convention, then validate the result against the live catalog exactly as it does today.

**Operator decision folded in (2026-09-04):** every alias is a **static pin in JSON** — no live "newest in family" lookups, no catalog dependency in the resolver. A new model release is one JSON row.

**Revision 2 (after Codex review round 1, relay `relay-system/2026-09-04/gh168-alias-resolver-plan.md`):** the root cause is corrected — the direct path *does* already run the alias table (upstream, before routing), so the gaps are coverage, unsafe substring replacement, and lost provenance, not "handlers skip it." Resolution becomes a **staged, entire-value lookup on the isolated model field**, applied once at the executor handlers; the free-text substitution pass is removed; `WholeInput` and the exact-ID guard are subsumed; pin auditing moves to `run-diagnostics`.

**Revision 3 (after Codex review round 2 — round cap reached, escalated, all findings folded in):** the rmm LLM prompt stops normalizing aliases (it was a third resolver); a stripped vendor prefix is honoured only when the resolved ID belongs to that vendor's provider; the diagnostics probe gains `UNVERIFIABLE`; the `models` alias section gets a concrete accessor and test file.

**Revision 4 (2026-09-04, operator-supplied pins):** the pin values come from a Perplexity pass over first-party model pages (table in "Pins" below). Two deviations from that JSON, called out for the operator: bare `gpt` is pinned to the vendor default (`gpt-5.6-terra`) rather than the flagship `gpt-6-astra`, which gets its own rows; `gemini pro` → `gemini-2.5-pro` is carried but flagged — an older generation than the Flash pin, verify or drop at merge.

### What already exists (verified — this is an extension, not a new subsystem)

- **Alias table:** `data/static/ai/command-normalization.json` → `ModelAliases: [{ Match, Replace }]`. Today it covers `chatgpt 5`, `gpt 4o mini`, `fable 5` etc. — **no vendor names, no families**.
- **Applier:** `ApplyNormalizationRules` (`src/command-intent-resolver.js:143-160`) replaces each `Match` as a whole phrase **anywhere in the text** (`BuildWholePhraseRegex`, `:130-134`, `\b`-bounded). It runs (a) on the whole command text before routing — `NormalizeDirectCommandTextAsync` at `src/chat-module.js:1172` — and (b) on each model argument in `BuildCanonicalCommand` (`:202-208`) for the `rmm` / router-active paths. Verified: `switch-models:'chatgpt 5'` → `switch-models:'gpt-5'` before the handler ever sees it; `'ChatGPT'` / `'Open AI'` / `'Claude Sonnet'` pass through only because no row matches.
- **A third resolver hides in the prompt:** `data/static/ai/rmm-instructions.md:22-25` (rule 8) tells the LLM to normalize `gpt5` / `gpt 5` / `chatgpt 5` → `gpt-5` inside the structured field, and `ResolveRmmIntentAsync` builds the canonical command from that field (`command-intent-resolver.js:545-565`). Provenance for those aliases dies in the model, before any code runs.
- **Consequences of "anywhere in the text":** the existing row `chatgpt 5` matches inside `chatgpt 5.6 terra` (`\b` accepts the boundary before `.`), and any longer row that fires first blocks a shorter prefix-strip row (`openai chatgpt 5.6 terra` → `openai gpt-5.6-terra`). Ordering rows cannot fix a substitution model.
- **Provenance is lost:** because normalization happens upstream, the handler receives the already-rewritten ID and cannot say "resolved from 'ChatGPT'".

So the gaps are exactly four: (1) table coverage, (2) substring substitution is unsafe for prefixed phrases, (3) provenance is destroyed before the executor, (4) the LLM prompt is a second, unverifiable copy of the table.

### Resolution rules

Resolution is **field-only and entire-value**. The model field is isolated (already quoted by the command syntax), lower-cased, whitespace-collapsed, then:

1. **Entire-value lookup** in `ModelAliases` (`Match` is now the whole value, case-insensitive). Hit → `Replace`.
2. Else **strip one anchored leading vendor word** — `^(openai|open ai|anthropic|google)\s+` — and repeat the entire-value lookup. The retry is accepted **only if the resolved ID's provider (`GetProviderDescriptorForModel`, `src/ai-providers/index.js:87`) is the stripped word's provider** (`openai`/`open ai` → `openai`, `anthropic` → `anthropic`, `google` → `gemini`). A mismatch is treated as a miss.
3. Else **unchanged** → catalog validation as today → GH-88 Phase 5 "did you mean" reply.

No substring replacement anywhere. An exact model ID (`gpt-5.6-terra`, `o3-mini`, `claude-haiku-4-5-20251001`, or an unknown-prefix ID that happens to contain `sonnet`) is never a declared key, so it passes steps 1 and 2 untouched — "exact always wins" falls out of the design instead of needing a guard.

| Input (model field) | Step | Resolves to |
|---|---|---|
| `gpt-5.6-terra` · `o3-mini` · `claude-haiku-4-5-20251001` · `acme-sonnet-1` | 3 | itself |
| `openai` · `open ai` · `chatgpt` · `chat gpt` · `gpt` | 1 | `gpt-5.6-terra` (vendor default) |
| `gpt 6` · `gpt6` · `gpt 6 astra` · `astra` | 1 | `gpt-6-astra` (flagship — deliberate, never the bare-word default) |
| `anthropic` · `claude` · `haiku` · `claude haiku` · `haiku 4.5` | 1 | `claude-haiku-4-5-20251001` (vendor default = current workspace default) |
| `sonnet` · `claude sonnet` · `sonnet 5` · `claude sonnet 5` | 1 | `claude-sonnet-5` |
| `opus` · `claude opus` · `opus 5` · `claude opus 5` | 1 | `claude-opus-5` |
| `google` · `gemini` · `gemini flash` · `flash` · `gemini 3.8 flash` | 1 | `gemini-3.8-flash` (vendor default) |
| `gemini pro` · `gemini 2.5 pro` | 1 | `gemini-2.5-pro` _(flagged — verify at merge)_ |
| `gpt 5.6 terra` · `chatgpt 5.6 terra` · `terra` | 1 | `gpt-5.6-terra` |
| `openai chatgpt 5.6 terra` · `open ai chatgpt 5.6 terra` | 2 → 1, provider matches | `gpt-5.6-terra` |
| `anthropic claude sonnet 5` | 2 → 1, provider matches | `claude-sonnet-5` |
| `google gemini pro` | 2 → 1, provider matches | `gemini-2.5-pro` |
| `chatgpt 5` · `gpt 5` (existing rows) | 1 | `gpt-5` — and can no longer touch `chatgpt 5.6 terra` |
| `openai gpt-9` | 2 → miss | unchanged → not-found reply, never a silent switch |
| `openai claude opus` · `anthropic gpt` · `google gpt` | 2 → provider mismatch | unchanged → not-found reply, never a cross-vendor switch |

### Pins (operator-supplied 2026-09-04 via Perplexity over first-party pages; the live-catalog probe is still the gate)

| Pin (`Replace`) | Provider | Source | Verified on | Note |
|---|---|---|---|---|
| `gpt-5.6-terra` | openai | https://platform.openai.com/docs/models/gpt-5.6-terra | 2026-09-04 | vendor default |
| `gpt-6-astra` | openai | https://platform.openai.com/docs/models/gpt-6-astra | 2026-09-04 | flagship; reachable only by explicit rows |
| `claude-haiku-4-5-20251001` | anthropic | https://platform.claude.com/docs/en/models/haiku-4-5/overview | 2026-09-04 | dated snapshot; equals the current workspace default |
| `claude-sonnet-5` | anthropic | https://platform.claude.com/docs/en/models/sonnet-5/overview | 2026-09-04 | undated alias — a moving pointer if Anthropic keeps its convention; acceptable, the probe checks the alias string itself |
| `claude-opus-5` | anthropic | https://platform.claude.com/docs/en/models/opus-5/overview | 2026-09-04 | undated alias, same note |
| `gemini-3.8-flash` | gemini | https://ai.google.dev/gemini-api/docs/models | 2026-09-04 | vendor default |
| `gemini-2.5-pro` | gemini | https://ai.google.dev/gemini-api/docs/models | 2026-09-04 | **flagged**: older generation than the Flash pin (this repo's own list already names `gemini-3.1-pro-preview`); confirm it is the newest GA Pro or replace before merge |

Superseded by this revision: the earlier working names `gpt-5.6-luna` / `gpt-5.6-sol` / `claude-sonnet-4-6` / `claude-opus-4-7` — none appear in the first-party pass; do not pin them.

### What ships (ponytail: one resolver, one table, three call sites, one probe, one prompt line)

1. **Table** — `command-normalization.json` `ModelAliases`, same `{ Match, Replace }` shape (existing rows are already whole phrases, so they keep working as entire-value keys). Add every `Match` → `Replace` pair in the "Resolution rules" table above; nothing else. No `WholeInput` flag, no prefix-strip rows — the resolver does both. Prose forms of a model need a row; the exact ID always works without one (the cost of all-static, the operator's call). Optional provenance columns (`Provider`, `Source`, `VerifiedOn`) may be kept in the JSON for the operator's benefit; the loader ignores them.
2. **Resolver** — `ResolveModelAliasAsync(ArgRequestedName)` in `src/command-intent-resolver.js` (the table already lives there): awaits `LoadCommandIntentAssetsAsync()`, builds the lower-cased `Map` once, runs steps 1-3 including the provider-match check on the prefix retry, returns `{ ModelId, Note }` with `Note` = `'ChatGPT -> gpt-5.6-terra'` or `null`. ~35 lines. Also export `GetModelAliasRowsAsync()` — the cached, loaded table (file I/O once, **no provider I/O**) for the `models` section.
3. **Remove the substitution pass.** `ApplyNormalizationRules` keeps `NormalizeFreeformText` and drops the `ModelAliases` loop; `BuildCanonicalCommand` sanitizes model arguments (`SanitizeSingleQuotedValue`) but no longer aliases them. Canonical commands therefore carry the **raw** model value (`switch-models:'ChatGPT'`), and the executor is the one place that resolves. `rmm`'s "Normalized:" note moves to the executor's reply. Existing assertions at `tests/command-intent-resolver.test.js:33-35` and `:63` change to the new contract (raw value preserved in the canonical command).
4. **Stop the prompt from resolving.** Replace `rmm-instructions.md` rule 8 with: *"Copy the user's model phrase verbatim into the model field (`default_model_name` / `complex_model_name` / `channel_model_name`). Do not normalize, expand, or correct aliases — the executor resolves them."* Same change for the router-active resolver, which shares the prompt. Provenance now survives every path.
5. **Handlers** — `model-switch-command.js` (default and complex) and `set-channel-model-command.js`: `const { ModelId, Note } = await ResolveModelAliasAsync(ArgRequested…)` before validation; validate and persist `ModelId`. Success reply gains one clause when `Note` is set: `Default model switched to 'gpt-5.6-terra' (resolved from 'ChatGPT')`. Not-found on a resolved name says so: `'ChatGPT' → 'gpt-5.6-terra' is not in this workspace's OpenAI catalog — the alias pin is stale.` These handlers are the choke point for all three entry paths: the direct routes call them (`src/chat-module.js:642-651`, `:690-700`); `rmm ifl` and router-active dispatch canonical commands through the same router (`:423`, `:952-958`).
6. **Discoverability** — `HandleModelsCommandAsync` (`models-command.js:21-31`) gains one injected argument, `ArgModelAliasRows` (ChatModule passes `await CommandIntentResolver.GetModelAliasRowsAsync()` at `chat-module.js:657-669`), and renders a static `*Aliases:*` section grouped by `Replace`. No provider I/O; the table file is already cached after first load. The hard-coded "Common … Models" lines at `models-command.js:63-66` are replaced by this section so there is one list, not two.
7. **Stale-pin probe** — `run-diagnostics` (admin, already probes providers at `diagnostics-report.js:262-271`) gains one line built by `VerifyModelAliasPinsAsync` over every distinct `Replace` value using `GetAvailableModelCatalogStatusByProviderAsync` (`workspace-ai.js:366-399`, best-effort per provider), with three outcomes: `• Alias pins: OK` · `• Alias pins: STALE — gemini-2.5-pro (gemini)` (a **successful** catalog that lacks the pin) · `• Alias pins: UNVERIFIABLE — anthropic (not configured | catalog error)` (an unconfigured or failed provider is never labelled stale). Bounded, admin-invoked cost.

### Files

- `data/static/ai/command-normalization.json` — rows above.
- `data/static/ai/rmm-instructions.md` — rule 8 replaced (verbatim copy, no normalization).
- `src/command-intent-resolver.js` — `ResolveModelAliasAsync`, `GetModelAliasRowsAsync`; alias loop removed from `ApplyNormalizationRules`; `BuildCanonicalCommand` stops aliasing. Net ~+40/−15 lines.
- `src/chat-commands/model-switch-command.js`, `src/chat-commands/set-channel-model-command.js` — one call each + success/stale-pin clauses.
- `src/chat-commands/models-command.js`, `src/chat-module.js` — alias rows injected and rendered; hard-coded model lines removed.
- `src/diagnostics-report.js` — `VerifyModelAliasPinsAsync` probe line in `BuildDiagnosticsCommandReportAsync`.
- `tests/command-intent-resolver.test.js` — every row of the table above as a control, plus red controls: `openai chatgpt 5.6 terra` and `open ai chatgpt 5.6 terra` → `gpt-5.6-terra` (not `openai gpt-5.6-terra`), `anthropic claude sonnet 5` → `claude-sonnet-5`, `chatgpt 5.6 terra` untouched by the `chatgpt 5` row, `gpt 5` → `gpt-5`, `gpt` → `gpt-5.6-terra` (never `gpt-6-astra`), `o3-mini` / `acme-sonnet-1` / `claude-haiku-4-5-20251001` unchanged, `openai gpt-9` unchanged, `openai claude opus` / `anthropic gpt` / `google gpt` unchanged (provider mismatch); canonical commands now preserve the raw value.
- `tests/model-switch-command.test.js` — `'ChatGPT'` validates `gpt-5.6-terra`, reply carries `resolved from 'ChatGPT'`; stale-pin message on not-found.
- `tests/set-channel-model-command.test.js` — new: `set-channel-model:'Claude'` persists `claude-haiku-4-5-20251001` and reports provenance.
- `tests/chat-module.integration.test.js` — extend the existing `models` coverage (`:787-820`) with the alias section; direct, `rmm ifl`, and router-active success replies each include the original alias — including `gpt 5`, which the prompt used to normalize (raw canonical suggestion `switch-models:'gpt 5'`, executor reply `resolved from 'gpt 5'`).
- `tests/run-diagnostics-command.test.js` / `tests/diagnostics-report.test.js` — alias-pin probe OK / STALE / UNVERIFIABLE (unconfigured) / UNVERIFIABLE (catalog error).

### Acceptance

- [ ] `switch-models:'ChatGPT'`, `switch-models:'OpenAI'`, `rmm ifl change model to Open AI`, and a router-active takeover of the same text all switch to `gpt-5.6-terra` and reply `(resolved from 'ChatGPT')` / `(… 'Open AI')`; `rmm ifl switch to gpt 5` replies `(resolved from 'gpt 5')`.
- [ ] `switch-models:'Claude Sonnet'` → `claude-sonnet-5`; `switch-models:'Claude'` → `claude-haiku-4-5-20251001`; `switch-models:'Gemini'` → `gemini-3.8-flash`.
- [ ] `switch-models:'OpenAI ChatGPT 5.6 Terra'` → exactly `gpt-5.6-terra`; `anthropic claude sonnet 5` → `claude-sonnet-5`; `gpt 6` → `gpt-6-astra` but bare `gpt` → `gpt-5.6-terra`.
- [ ] `openai claude opus`, `anthropic gpt`, `google gpt` never switch providers — they fall through to not-found.
- [ ] No declared key ever rewrites part of a longer value; an exact or unknown-prefix ID is never rewritten.
- [ ] A pinned ID missing from the live catalog does not crash and does not switch: the not-found path fires and names the stale pin; `run-diagnostics` reports STALE only for a successful catalog, UNVERIFIABLE otherwise.
- [ ] **Every pin in the "Pins" table is present in the live catalog of the workspace's keys at merge time** (recorded in the PR via the new probe); `gemini-2.5-pro` in particular is confirmed or replaced.
- [ ] `set-channel-model:'Claude'` persists the resolved ID and reports provenance.
- [ ] `models` shows the alias table with no provider I/O, and the old hard-coded model lines are gone.
- [ ] `rmm-instructions.md` no longer instructs the model to normalize aliases; `scripts/validate-ai-prompts.js` still passes.

### Not doing (named so it stops resurfacing)

- Live "newest in family" resolution — operator chose static pins.
- Fuzzy/typo matching — GH-88 Phase 5 owns "did you mean."
- Per-workspace alias overrides — one table; revisit if a second workspace needs different house defaults.
- Changing the OpenAI default-provider fallback in `GetDefaultProviderDescriptor`.
- Showing the resolved ID in `rmm`'s *suggestion* text (it now shows the raw value; the executor reply shows the resolution). Revisit only if users report confusion.
- Pinning bare `gpt` to the flagship — a bare word gets the everyday model; the flagship needs an explicit ask.

### Risks

- Pins go stale when a vendor retires an ID. Mitigation: validation still runs; the stale-pin reply names the row; `run-diagnostics` flags it proactively; fix is one JSON line.
- Undated Anthropic aliases (`claude-sonnet-5`, `claude-opus-5`) may silently advance to a newer snapshot. Accepted: that is less staleness, not more; the probe verifies the alias string is still listed.
- Removing the free-text substitution and the prompt rule changes two existing resolver assertions and the `rmm` suggestion text. Both are contract changes made on purpose and pinned by the updated tests.
- The LLM may still "helpfully" normalize despite rule 8's replacement. The integration assertion for `gpt 5` is the tripwire; if it flakes, the executor still resolves correctly and only the provenance clause is lost.
