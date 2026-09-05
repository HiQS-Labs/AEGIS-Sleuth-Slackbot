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

### What already exists (verified — this is an extension, not a new subsystem)

- **Alias table:** `data/static/ai/command-normalization.json` → `ModelAliases: [{ Match, Replace }]` (whole-phrase, case-insensitive, table order). Today it covers `chatgpt 5`, `gpt 4o mini`, `fable 5` etc. — **no vendor names, no families**.
- **Applier:** `ApplyNormalizationRules` / `NormalizeModelName` in `src/command-intent-resolver.js:143-174`, used by `BuildCanonicalCommand` (`:202`) — i.e. only on the `rmm` / router-active path. Verified: `BuildCanonicalCommand('model-switch-default', {DefaultModelName:'chatgpt 5'})` → `switch-models:'gpt-5'`, but `'Open AI'` / `'ChatGPT'` / `'Claude Sonnet'` pass through untouched.
- **Not applied at all** for a directly typed `switch-models:'ChatGPT'` or `set-channel-model:'Claude'` — the handlers go straight to `GetModelAvailabilityAsync` (`model-switch-command.js:53`, `set-channel-model-command.js:33`).
- **LLM prompt** `data/static/ai/rmm-instructions.md` rule 8 asks the model to "normalize aliases mentally" — a second, unverifiable copy of the same table. Not extended here; deterministic normalization after extraction makes it redundant.

So the gaps are exactly two: (1) table coverage, (2) the direct-command handlers skip the table.

### Resolution rules (operator conventions, as stated)

| Input (after normalization) | Resolves to | Rule |
|---|---|---|
| exact model ID (`gpt-5.6-sol`, `claude-haiku-4-5-20251001`) | itself | exact always wins; never re-aliased |
| `openai` · `open ai` · `chatgpt` · `chat gpt` · `gpt` (whole input) | `gpt-5.6-luna` | **vendor default** — static row, operator-owned |
| `anthropic` · `claude` (whole input) | `claude-haiku-4-5` | vendor default |
| `google` · `gemini` (whole input) | _(row omitted until a default is named)_ | vendor default |
| `claude sonnet` · `sonnet` | `claude-sonnet-4-6` _(pin to verify against the live catalog before merge)_ | **family pin** |
| `claude opus` · `opus` | `claude-opus-4-7` _(verify)_ | family pin |
| `claude haiku` · `haiku` | `claude-haiku-4-5` | family pin |
| `openai chatgpt 5.6 sol` · `chatgpt 5.6 sol` | `gpt-5.6-sol` | vendor prefix stripped, then the model row |
| `anthropic claude sonnet 4.6` | `claude-sonnet-4-6` | same |
| anything else | unchanged | falls through to validation → GH-88 Phase 5 "did you mean" reply |

Precedence: **longest `Match` first** (sort the table by `Match` length at load — one line), so `openai chatgpt 5.6 sol` can never be swallowed by the bare `openai` row, and `chatgpt 5.6 sol` is consumed before `chatgpt 5` can mangle it. Vendor-default rows carry `"WholeInput": true` and fire only when the entire normalized input equals the phrase — `openai gpt-9` stays `openai gpt-9` and gets the not-found reply, never a silent switch to the house default.

Exact-ID guard: an input with no whitespace that matches a provider prefix pattern (`OpenAIModelPattern` / `AnthropicModelPattern` / `GeminiModelPattern` from `src/ai-providers/index.js`) skips aliasing entirely. One line.

### What ships (ponytail: extend the table, export one function, call it in two handlers)

1. **Table** — `command-normalization.json`:
   - vendor rows: `{ "Match": "openai", "Replace": "gpt-5.6-luna", "WholeInput": true }` (+ `open ai`, `chatgpt`, `chat gpt`, `gpt`); `{ "Match": "anthropic", "Replace": "claude-haiku-4-5", "WholeInput": true }` (+ `claude`).
   - family rows: `claude sonnet` / `sonnet` → `claude-sonnet-4-6`; `claude opus` / `opus` → `claude-opus-4-7`; `claude haiku` / `haiku` → `claude-haiku-4-5`.
   - model rows for the named house models: `chatgpt 5.6 luna` / `gpt 5.6 luna` → `gpt-5.6-luna`; `chatgpt 5.6 sol` / `gpt 5.6 sol` → `gpt-5.6-sol`; `claude sonnet 4.6` / `sonnet 4.6` → `claude-sonnet-4-6`.
   - vendor-prefix strip rows: `{ "Match": "openai chatgpt", "Replace": "chatgpt" }`, `{ "Match": "openai gpt", "Replace": "gpt" }`, `{ "Match": "anthropic claude", "Replace": "claude" }`.
   - Prose forms of a model need a row; the exact ID always works without one. That is the cost of all-static and it is the operator's call.
2. **Resolver** — `ResolveModelAliasAsync(ArgRequestedName)` exported from `src/command-intent-resolver.js` (the table already lives there; no new module). Awaits `LoadCommandIntentAssetsAsync()` like `NormalizeDirectCommandTextAsync` does, applies the exact-ID guard, then `NormalizeModelName`. Returns `{ ModelId, Note }` where `Note` is the existing normalization note (`'chatgpt -> gpt-5.6-luna'`) or `null`. ~25 lines including the `WholeInput` gate and load-time sort.
3. **Handlers** — `model-switch-command.js` (default and complex) and `set-channel-model-command.js`: one line before validation, `const { ModelId, Note } = await ResolveModelAliasAsync(ArgRequested…);` then validate `ModelId`. Success reply gains one clause when `Note` is set: `Default model switched to 'gpt-5.6-luna' (resolved from 'ChatGPT')`. Not-found on a resolved name says so: `'ChatGPT' → 'gpt-5.6-luna' is not in this workspace's OpenAI catalog — the alias pin is stale.` The `rmm` path keeps working unchanged because `BuildCanonicalCommand` already normalizes.
4. **Discoverability** — `models` command (`models-command.js:52`) gets one section, `*Aliases:*`, rendered from the table (grouped by `Replace`) so it cannot drift from the JSON.

### Files

- `data/static/ai/command-normalization.json` — rows above.
- `src/command-intent-resolver.js` — `ResolveModelAliasAsync`, `WholeInput` gate + exact-ID guard in `ApplyNormalizationRules`/`NormalizeModelName`, load-time sort. ~35 lines.
- `src/chat-commands/model-switch-command.js`, `src/chat-commands/set-channel-model-command.js` — one call each + success/stale-pin clauses.
- `src/chat-commands/models-command.js` — alias section.
- `tests/command-intent-resolver.test.js` — table test: every row of "Resolution rules" above; precedence (`openai chatgpt 5.6 sol` ≠ vendor default; `chatgpt 5.6 sol` ≠ `gpt-5.6 sol`); `WholeInput` negative (`openai gpt-9` unchanged); exact-ID guard (`gpt-5.6-luna` and `claude-haiku-4-5-20251001` unchanged).
- `tests/model-switch-command.test.js` — `'ChatGPT'` → validates `gpt-5.6-luna`, reply names the resolution; stale-pin message when validation says not-found.

### Acceptance

- [ ] `switch-models:'ChatGPT'`, `switch-models:'OpenAI'`, `rmm ifl change model to Open AI` all switch to `gpt-5.6-luna` and say what was resolved.
- [ ] `switch-models:'Claude Sonnet'` switches to the pinned Sonnet ID.
- [ ] `switch-models:'OpenAI ChatGPT 5.6 Sol'` switches to exactly `gpt-5.6-sol`.
- [ ] An exact model ID is never rewritten.
- [ ] A pinned ID missing from the live catalog does not crash and does not switch: the not-found path fires and names the stale pin.
- [ ] Every pin in the table is present in the live catalog at merge time (one-off check via `GetAvailableModelsAsync`; recorded in the PR).
- [ ] `models` shows the alias table.

### Not doing (named so it stops resurfacing)

- Live "newest in family" resolution — operator chose static pins.
- Fuzzy/typo matching — GH-88 Phase 5 owns "did you mean."
- Per-workspace alias overrides — one table; revisit if a second workspace needs different house defaults.
- Teaching the rmm LLM prompt the new aliases — deterministic post-normalization covers it.
- Changing the OpenAI default-provider fallback in `GetDefaultProviderDescriptor`.

### Risks

- Pins go stale when a vendor retires an ID. Mitigation: validation still runs; the stale-pin message names the row; fix is one JSON line.
- A row's `Match` accidentally matches inside a longer prose name. Mitigation: longest-first ordering + the table test that pins the precedence cases.
