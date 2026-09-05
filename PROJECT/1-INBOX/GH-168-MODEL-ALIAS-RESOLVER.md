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

### What already exists (verified — this is an extension, not a new subsystem)

- **Alias table:** `data/static/ai/command-normalization.json` → `ModelAliases: [{ Match, Replace }]`. Today it covers `chatgpt 5`, `gpt 4o mini`, `fable 5` etc. — **no vendor names, no families**.
- **Applier:** `ApplyNormalizationRules` (`src/command-intent-resolver.js:143-160`) replaces each `Match` as a whole phrase **anywhere in the text** (`BuildWholePhraseRegex`, `:130-134`, `\b`-bounded). It runs (a) on the whole command text before routing — `NormalizeDirectCommandTextAsync` at `src/chat-module.js:1172` — and (b) on each model argument in `BuildCanonicalCommand` (`:202-208`) for the `rmm` / router-active paths. Verified: `switch-models:'chatgpt 5'` → `switch-models:'gpt-5'` before the handler ever sees it; `'ChatGPT'` / `'Open AI'` / `'Claude Sonnet'` pass through only because no row matches.
- **Consequences of "anywhere in the text":** the existing row `chatgpt 5` matches inside `chatgpt 5.6 sol` (`\b` accepts the boundary before `.`), and any longer row that fires first blocks a shorter prefix-strip row (`openai chatgpt 5.6 sol` → `openai gpt-5.6-sol`). Ordering rows cannot fix a substitution model.
- **Provenance is lost:** because normalization happens upstream, the handler receives the already-rewritten ID and cannot say "resolved from 'ChatGPT'".
- **LLM prompt** `data/static/ai/rmm-instructions.md` rule 8 asks the model to "normalize aliases mentally" — a second, unverifiable copy of the same table. Not extended; deterministic resolution after extraction makes it redundant.

So the gaps are exactly three: (1) table coverage, (2) substring substitution is unsafe for prefixed phrases, (3) provenance is destroyed before the executor.

### Resolution rules (operator conventions, as stated)

Resolution is **field-only and entire-value**. The model field is isolated (already quoted by the command syntax), lower-cased, whitespace-collapsed, then:

1. **Entire-value lookup** in `ModelAliases` (`Match` is now the whole value, case-insensitive). Hit → `Replace`.
2. Else **strip one anchored leading vendor word** (`^(openai|anthropic|google)\s+`) and repeat the entire-value lookup.
3. Else **unchanged** → catalog validation as today → GH-88 Phase 5 "did you mean" reply.

No substring replacement anywhere. An exact model ID (`gpt-5.6-sol`, `o3-mini`, `claude-haiku-4-5-20251001`, or an unknown-prefix ID that happens to contain `sonnet`) is never a declared key, so it passes step 1 and 2 untouched — "exact always wins" falls out of the design instead of needing a guard.

| Input (model field) | Step | Resolves to |
|---|---|---|
| `gpt-5.6-sol` · `o3-mini` · `claude-haiku-4-5-20251001` · `acme-sonnet-1` | 3 | itself |
| `openai` · `open ai` · `chatgpt` · `chat gpt` · `gpt` | 1 | `gpt-5.6-luna` (vendor default, operator-owned) |
| `anthropic` · `claude` | 1 | `claude-haiku-4-5` (vendor default) |
| `google` · `gemini` | — | _(rows omitted until a default is named)_ |
| `claude sonnet` · `sonnet` | 1 | `claude-sonnet-4-6` _(pin to verify against the live catalog before merge)_ |
| `claude opus` · `opus` | 1 | `claude-opus-4-7` _(verify)_ |
| `claude haiku` · `haiku` | 1 | `claude-haiku-4-5` |
| `chatgpt 5.6 sol` · `gpt 5.6 sol` | 1 | `gpt-5.6-sol` |
| `openai chatgpt 5.6 sol` | 2 → 1 | `gpt-5.6-sol` |
| `anthropic claude sonnet 4.6` | 2 → 1 | `claude-sonnet-4-6` |
| `chatgpt 5` · `gpt 5` (existing rows) | 1 | `gpt-5` — and can no longer touch `chatgpt 5.6 sol` |
| `openai gpt-9` | 2 → miss | unchanged → not-found reply, never a silent switch |

### What ships (ponytail: one resolver, one table, three call sites, one probe)

1. **Table** — `command-normalization.json` `ModelAliases`, same `{ Match, Replace }` shape (existing rows are already whole phrases, so they keep working as entire-value keys). Add: vendor rows (`openai`, `open ai`, `chatgpt`, `chat gpt`, `gpt` → `gpt-5.6-luna`; `anthropic`, `claude` → `claude-haiku-4-5`), family rows (`claude sonnet`/`sonnet` → `claude-sonnet-4-6`; `claude opus`/`opus` → `claude-opus-4-7`; `claude haiku`/`haiku` → `claude-haiku-4-5`), model rows for the named house models (`chatgpt 5.6 luna`/`gpt 5.6 luna` → `gpt-5.6-luna`; `chatgpt 5.6 sol`/`gpt 5.6 sol` → `gpt-5.6-sol`; `claude sonnet 4.6`/`sonnet 4.6` → `claude-sonnet-4-6`). No `WholeInput` flag, no prefix-strip rows — the resolver does both. Prose forms of a model need a row; the exact ID always works without one (the cost of all-static, the operator's call).
2. **Resolver** — `ResolveModelAliasAsync(ArgRequestedName)` in `src/command-intent-resolver.js` (the table already lives there): awaits `LoadCommandIntentAssetsAsync()`, builds the lower-cased `Map` once, runs steps 1-3, returns `{ ModelId, Note }` with `Note` = `'ChatGPT -> gpt-5.6-luna'` or `null`. ~30 lines.
3. **Remove the substitution pass.** `ApplyNormalizationRules` keeps `NormalizeFreeformText` and drops the `ModelAliases` loop; `BuildCanonicalCommand` sanitizes model arguments (`SanitizeSingleQuotedValue`) but no longer aliases them. Canonical commands therefore carry the **raw** model value (`switch-models:'ChatGPT'`), and the executor is the one place that resolves. `rmm`'s "Normalized:" note moves to the executor's reply. Existing assertions at `tests/command-intent-resolver.test.js:33-35` and `:63` change to the new contract (raw value preserved in the canonical command).
4. **Handlers** — `model-switch-command.js` (default and complex) and `set-channel-model-command.js`: `const { ModelId, Note } = await ResolveModelAliasAsync(ArgRequested…)` before validation; validate and persist `ModelId`. Success reply gains one clause when `Note` is set: `Default model switched to 'gpt-5.6-luna' (resolved from 'ChatGPT')`. Not-found on a resolved name says so: `'ChatGPT' → 'gpt-5.6-luna' is not in this workspace's OpenAI catalog — the alias pin is stale.` These handlers are the choke point for all three entry paths: the direct routes call them (`src/chat-module.js:642-651`, `:690-700`); `rmm ifl` and router-active dispatch canonical commands through the same router (`:423`, `:952-958`).
5. **Discoverability** — `models` command (`models-command.js:52`) gets a static `*Aliases:*` section rendered from the table, grouped by `Replace`. No I/O added to `models`.
6. **Stale-pin probe** — `run-diagnostics` (admin, already probes providers at `diagnostics-report.js:262-271`) gains `• Alias pins: OK` / `• Alias pins: STALE — claude-opus-4-7 (anthropic)`, built by `VerifyModelAliasPinsAsync` over every distinct `Replace` value using `GetAvailableModelCatalogStatusByProviderAsync` (`workspace-ai.js:366-399`, best-effort per provider). Bounded, admin-invoked cost; a retired pin is caught before a user hits it.

### Files

- `data/static/ai/command-normalization.json` — rows above.
- `src/command-intent-resolver.js` — `ResolveModelAliasAsync`; alias loop removed from `ApplyNormalizationRules`; `BuildCanonicalCommand` stops aliasing. Net ~+30/−15 lines.
- `src/chat-commands/model-switch-command.js`, `src/chat-commands/set-channel-model-command.js` — one call each + success/stale-pin clauses.
- `src/chat-commands/models-command.js` — static alias section.
- `src/diagnostics-report.js` — `VerifyModelAliasPinsAsync` probe line in `BuildDiagnosticsCommandReportAsync`.
- `tests/command-intent-resolver.test.js` — every row of the table above as a control, plus red controls: `openai chatgpt 5.6 sol` → `gpt-5.6-sol` (not `openai gpt-5.6-sol`), `anthropic claude sonnet 4.6` → `claude-sonnet-4-6`, `chatgpt 5.6 sol` untouched by the `chatgpt 5` row, `gpt 5` → `gpt-5`, `o3-mini` / `acme-sonnet-1` / `claude-haiku-4-5-20251001` unchanged, `openai gpt-9` unchanged; canonical commands now preserve the raw value.
- `tests/model-switch-command.test.js` — `'ChatGPT'` validates `gpt-5.6-luna`, reply carries `resolved from 'ChatGPT'`; stale-pin message on not-found.
- `tests/set-channel-model-command.test.js` — new: `set-channel-model:'Claude'` persists `claude-haiku-4-5` and reports provenance.
- `tests/chat-module.integration.test.js` — direct, `rmm ifl`, and router-active success replies each include the original alias.
- `tests/run-diagnostics-command.test.js` / `tests/diagnostics-report.test.js` — alias-pin probe OK / STALE / provider-unavailable.
- `tests/models-command` coverage — alias section rendered from the table.

### Acceptance

- [ ] `switch-models:'ChatGPT'`, `switch-models:'OpenAI'`, `rmm ifl change model to Open AI`, and a router-active takeover of the same text all switch to `gpt-5.6-luna` and reply `(resolved from 'ChatGPT')` / `(… 'Open AI')`.
- [ ] `switch-models:'Claude Sonnet'` switches to the pinned Sonnet ID.
- [ ] `switch-models:'OpenAI ChatGPT 5.6 Sol'` switches to exactly `gpt-5.6-sol`; `anthropic claude sonnet 4.6` to `claude-sonnet-4-6`.
- [ ] No declared key ever rewrites part of a longer value; an exact or unknown-prefix ID is never rewritten.
- [ ] A pinned ID missing from the live catalog does not crash and does not switch: the not-found path fires and names the stale pin; `run-diagnostics` reports it as STALE.
- [ ] Every pin in the table is present in the live catalog at merge time (recorded in the PR via the new probe).
- [ ] `set-channel-model:'Claude'` persists the resolved ID and reports provenance.
- [ ] `models` shows the alias table with no provider I/O.

### Not doing (named so it stops resurfacing)

- Live "newest in family" resolution — operator chose static pins.
- Fuzzy/typo matching — GH-88 Phase 5 owns "did you mean."
- Per-workspace alias overrides — one table; revisit if a second workspace needs different house defaults.
- Teaching the rmm LLM prompt the new aliases — deterministic resolution at the executor covers it.
- Changing the OpenAI default-provider fallback in `GetDefaultProviderDescriptor`.
- Showing the resolved ID in `rmm`'s *suggestion* text (it now shows the raw value; the executor reply shows the resolution). Revisit only if users report confusion.

### Risks

- Pins go stale when a vendor retires an ID. Mitigation: validation still runs; the stale-pin reply names the row; `run-diagnostics` flags it proactively; fix is one JSON line.
- Removing the free-text substitution changes two existing resolver assertions and the `rmm` suggestion text. Both are contract changes made on purpose and pinned by the updated tests.
