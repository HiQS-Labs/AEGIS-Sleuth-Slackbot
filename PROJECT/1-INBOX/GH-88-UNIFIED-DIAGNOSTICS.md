---
gh_issue: 88
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/88
title: "Unify diagnostics: one system, a shared baseline, and route errors through it"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-18
doc_type: refactor
related: "GH-86 (baseline must show the RESOLVED runtime path — two install dirs held divergent state); GH-89 (the 404 reply is a worked example of a context-free error)"
---

# GH-88 — One diagnostics system, one baseline, errors included

## The problem, stated as the user hit it

Running `diagnostics` returns 12 green infra lines and **does not mention** that auto-scheduling is
disabled in the channel it was run in. The reminder-triage output — a completely different code path
— leads with exactly that fact. So the command named *diagnostics* is the one report that omits the
answer to "why did nothing happen."

## Current surfaces

| Surface | Where | Reports |
|---|---|---|
| `diagnostics` command | `src/chat-commands/run-diagnostics-command.js` | config, Slack API, 3 directory probes, data-loaded flags, per-provider AI connectivity, thread-memory, Notion |
| Reminder triage | `src/reminders-module.js:2070+` | channel status, AI analysis, "Why this task text", "How ownership resolved" |
| Error replies | scattered literals | one sentence, no context |
| Startup summary | `src/github-actions-startup-summary.js` | version, branch, CI run |

Four builders, no shared code, no shared format, no shared routing.
`HandleRunDiagnosticsCommandAsync` even receives `ArgEventInfo.channel` and uses it only as a
post target.

## Design

**One module** — `src/diagnostics-report.js` — owning collection and rendering. Every surface calls it.

**Baseline, on every diagnostic output, user- or error-triggered (5 lines):**

1. Version + branch + workspace
2. **Reminders enabled in this channel** (yes/no) + reminder target channel
3. Slack API connectivity
4. Runtime data directory — **resolved path** + writability
5. Configured AI providers + which is active

Line 2 is the user's explicit requirement. Line 4 is not padding: GH-86 is a bug that existed
*because* nothing ever printed which runtime tree was in use, and two of them held different state.

**Contextual section**, appended by the caller: triage adds AI analysis; an OCR failure adds provider
and model; an issue-filing failure adds the attempted repo (GH-89).

**Error routing.** User-visible failures render the terse sentence *plus* the baseline beneath it.
Target: a screenshot of a failure is enough to diagnose it without a log pull. Keep the one-line
summary first — the baseline is context, not a wall to read before the point.

## Plan

**Phase 1 — extract the collector.** Build the module and the baseline; make `diagnostics` the first
consumer. No behaviour change beyond the baseline appearing. Ship alone.

**Phase 2 — migrate triage.** Replace the hand-built channel-status block in `reminders-module.js`
with the shared baseline, keeping its AI-analysis block as the contextual section. Assert the
overlapping facts render identically.

**Phase 3 — route errors.** Introduce one helper for user-facing failure replies and convert the
known offenders (OCR failure, issue-filing failure, list-creation failure). Convert opportunistically
after that; a big-bang string sweep is not required and would balloon the diff.

**Phase 4 — retire duplicates.** Delete the builders that Phases 1-3 superseded. The refactor is not
done while a second renderer of the *same* report still exists — that is how the current state arose.

**Explicitly out of scope: the startup summary.** `src/github-actions-startup-summary.js` is listed
above as a surface, but it is a boot announcement, not a response to a user action or a failure. It
has **no channel context**, so baseline line 2 (per-channel reminders-enabled) is meaningless for it,
and the baseline contract would have to be weakened to accommodate it. It therefore keeps its own
renderer and **Phase 4 must not delete it**. If it should carry the channel-free subset (version,
branch, resolved runtime path, providers), that is a follow-up issue, not part of this one — say so
rather than letting it drift in as unplanned scope.

## Sequencing against GH-86 / GH-89

The three are **not** a dependency knot, but the naive order is wrong in one respect worth stating.

- **GH-86 Phase 1 and GH-89 Phase 3 are ops/config fixes and ship first, independently.** One is a
  live state-divergence hazard, the other a one-variable deployment gap. Neither should queue behind
  a refactor, and neither needs anything from this issue.
- **This issue (Phases 1-2) ships next**, on its own merits.
- **GH-89 Phase 2** (name the attempted repo) then becomes a contextual line on the baseline instead
  of a bespoke string.
- **GH-86's verification** (reading the resolved runtime path off a diagnostic surface) is the last
  step, and is a convenience — `systemctl show` answers the same question without it.

Stated because the tempting summary is "GH-88 first, it builds the baseline the others consume" —
which is true of the *presentation* work and false of the ops work, and following it would park a
production hazard behind a refactor.

## Acceptance

- [ ] One module renders the `diagnostics` command, triage, and error replies; no second builder of
      those remains. The startup summary is exempt by the note above and still exists.
- [ ] Per-channel reminders-enabled appears in the baseline on **every** surface, errors included.
- [ ] `diagnostics` run in a channel with auto-scheduling off says so.
- [ ] A test asserts the baseline lines are present and **identical** between a user-triggered
      diagnostic and an error-triggered one.
- [ ] Baseline collection is resilient: one failing probe degrades to a FAILED line, never an
      exception that suppresses the whole report.

## Risks

- **Scope.** Phases 1-2 are the value; Phase 3 can sprawl across every string literal in the repo.
  Convert the named offenders and stop.
- **Cost.** The baseline runs on every error. Probes must be cheap or cached — a Slack API round-trip
  per error reply is not acceptable. Decide per line: 1 and 2 are in-memory; 3 should be cached.
- **Verbosity.** Errors must not become walls of text. Summary first, baseline beneath.
- **Admin gating.** `diagnostics` is admin-only today. Decide whether the error baseline is shown to
  all users, and make sure it never leaks configuration a non-admin should not see.


---

<!-- Phase 5 appended 2026-09-04 from https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/88 (second comment). Sibling: GH-168 alias resolver. -->

## GH-88 Phase 5 — Dual-path error UX: deterministic reply + simple-model "did you mean", every time

**Trigger (2026-09-04, prod):** `@Sleuth AI v2 rmm change model to Open AI` → `'Open AI' not found. Default still using 'claude-haiku-4-5-20251001'`. Same for `ChatGPT`. Accurate, actionable-to-nobody. Fifth issue in this family (#63, #88, #96, #113, #114) — the pattern is "terse terminal string, no next move."

**Operator decisions folded in (2026-09-04):** both paths ship in v1 and the LLM path is on by default; the LLM path uses the workspace's **simple (default) model** — there are exactly two model paths in this system, simple and complex, and this adds no third; confirmation is "paste this command," no pending state.

**Revision 2 (after Codex review round 1, relay `relay-system/2026-09-04/gh88-p5-dual-path-plan.md`):** one aggregated post per command (a `switch-models` request can carry default *and* complex); catalog access is best-effort per provider, never the throwing all-or-nothing API; the reply contract is "exactly one reply within ≤4 s, never silence, never double-post" (not "never blocks"); prompt assets are wired into the validator; the `rmm ifl` retry variant is dropped; requested text is capped and passed as data; test seams named.

### Ground truth (debug-mantra)

- **Reproduced deterministically, no network:** `GetProviderDescriptorForModel('Open AI')` → `null` → default provider `openai` (`src/ai-providers/index.js:87-104`); `'ChatGPT'` → `openai` via `/^chatgpt/` (`index.js:48`). Both then miss the live OpenAI catalog → `reason: 'not-found'` (`src/workspace-ai.js:433-462`). The string is emitted only at `src/chat-commands/model-switch-command.js:61` (default) / `:88` (complex); `set-channel-model-command.js:39` is the same shape.
- **Fail path:** three entry paths converge on that handler — direct `switch-models:'X'` (`src/chat-module.js:628-655`), `rmm ifl` (`:413`), and the GH-397 router `active` takeover (`:953-957`). Plain `rmm` is suggest-only in this tree, so the screenshot reached the handler via router-active or a prod build that differs — unverified (SSH to Vultr is classifier-blocked); irrelevant to the fix because **the handler is the single choke point** for all three.
- **Knobs:** `ModelAliases` (`data/static/ai/command-normalization.json`), provider prefix patterns, default-provider fallback, `COMMAND_NEAR_MISS_LLM`, router mode.
- **Disproof run:** if the alias mechanism were broken, `chatgpt 5` would also pass through. It resolves to `gpt-5` on both the rmm path (`BuildCanonicalCommand`) and the direct path (`NormalizeDirectCommandTextAsync` at `chat-module.js:1172`). So the mechanism works; the gap is table coverage and provenance — that is GH-168. This phase is the catch-all for what no alias table can map — typos, retired IDs, made-up names.

### What ships (ponytail: reuse `FormatErrorReport` / `CollectDiagnosticsBaselineAsync`, add one context builder + one scorer, no new module, no new env var)

**Two-stage helper, three consumers, one post.**

- `BuildModelNotFoundContextAsync(ArgWorkspaceAI, ArgRequestedNames, ArgCommandTemplate, ArgOptions)` in `src/diagnostics-report.js` (it already owns error rendering and already takes WorkspaceAI by injection, `diagnostics-report.js:87-91`, so no circular require). Input: **every** not-found name from the command (one or two), plus the template the caller wants rendered (`switch-models:'{id}'`, `switch-models:complex='{id}'`, `set-channel-model:'{id}'`). Output: `{ ContextualLines: string[] }` — classification + closest IDs per name, then at most one AI suggestion line per name.
- The **handlers keep their existing `Results` accumulation** (`model-switch-command.js:48-49, 52-88`). Each not-found attempt pushes its deterministic default-error line exactly as today. After all validations, if any attempt was not-found, the handler posts **one** message: `FormatErrorReport(ContextualLines + Results-with-default-error-lines-last, baseline)`. If nothing was not-found, the existing single post is unchanged. So: one catalog fetch, one AI call, one baseline, one post per command — for the single, mixed (default ok + complex not-found) and two-invalid cases alike.
- `set-channel-model-command.js:39` is the third consumer with one name.

**Reply shape, top to bottom (deterministic lines, then the LLM line(s) when valid, then the deterministic default-error line(s), then the baseline):**

```
'ChatGPT' isn't a model ID — it looks like a vendor name (OpenAI).
Closest IDs in this workspace's catalog: `gpt-5-mini`, `gpt-5`, `gpt-4o-mini`
Did you mean `gpt-5-mini`? To switch: `@Sleuth AI switch-models:'gpt-5-mini'`   _(AI suggestion, 82%)_
Default still using 'claude-haiku-4-5-20251001'.

*Diagnostics:*
• Version … • Auto-scheduling … • Slack API … • Runtime dir … • Providers …
```

Mixed case (`switch-models:default='gpt-5-mini',complex='ChatGPT'`): `Default model switched to 'gpt-5-mini'` stays in `Results`; the complex name gets its context lines above and `Complex still using 'gpt-4o'` last before `*Diagnostics:*`.

**Path 1 — deterministic (always runs, zero LLM):**
1. Classify the input: vendor word (`openai|open ai|chatgpt|anthropic|claude|google|gemini`) / family word (`sonnet|opus|haiku|gpt|o-series`) / other. One regex table, ~10 lines.
2. Catalog: call `GetAvailableModelCatalogStatusByProviderAsync()` (`src/workspace-ai.js:366-399`) — it catches per provider and never throws for one failing provider — **not** `GetAvailableModelsByProviderAsync` (`:408-425`), which throws when any configured provider fails and would turn a confirmed not-found into the outer bare `Failed to switch model` (`model-switch-command.js:118-124`). Score only IDs from providers with `ok: true`. Zero usable providers → skip line 2, keep classification + default-error + baseline.
3. Nearest-match: lower-case, strip `-._ `, score by longest common substring + shared numeric tokens; top 3 above a floor. Stdlib only. `// ponytail: LCS over ≤300 IDs; revisit if catalogs grow 10×`.

**Path 2 — simple-model assist (runs alongside Path 1, contained, one reply):**
- Model: `ArgWorkspaceAI.DefaultModelName` — the simple model, whatever it currently is. No env var, no model list, no third path. (Still valid: a failed switch leaves the current default untouched.)
- Call: `ArgWorkspaceAI.ProcessMessageWithJsonResponseAsync(prompt, instructions, schema, ArgWorkspaceAI.DefaultModelName)` — the same primitive `live-model-catalog-question.js` uses, grounded on the same scored catalog list so it cannot invent an ID. One call per command covering every not-found name. Schema: `{ suggestions: [{ requested: string, suggested_model_id: string, confidence: number }] }`. A `suggested_model_id` not in the catalog is dropped; the line is omitted.
- **Contract:** exactly one reply, posted within ≤4 s of validation completing; never silence, never a second post. Implementation: `Promise.race` against a 4 s timer with the timer cleared in `finally` on every path (the exact pattern at `src/chat-module.js:1092-1108`); a late settlement after the timeout is ignored (the reply already went out). Rejection, timeout and late-settle each collapse to "Path 1 lines only."
- **Untrusted input:** the requested name is user text (`chat-module.js:630-638` accepts anything between quotes). Cap each name at 200 characters and pass names to the prompt as a JSON array (data, not prose) — schema-constrained output plus the catalog-membership check bounds the output side; the cap and delimiting bound the input side.
- **Prompt assets:** `data/static/ai/model-suggestion-instructions.md` + `model-suggestion-schema.json`, registered in `scripts/validate-ai-prompts.js` `EXPECTED_PAIRS` (`:20-36` — assets absent from that map are silently skipped) and loaded once via a module-level cache in `diagnostics-report.js`, same shape as `CachedVersion`.
- "Ask the user if that's what they meant": the suggestion line carries the exact command to paste, rendered from the caller's template. No `rmm ifl` variant (the helper has no event/source mode and does not need one), no pending state, no thread memory. `// ponytail: paste-the-command; add a Slack button only if users demonstrably re-type it wrong`.

**Out of scope here:** vendor/family → ID mapping (GH-168); changing the OpenAI default-provider fallback; any other "not found" surface.

### Files

- `src/diagnostics-report.js` — `BuildModelNotFoundContextAsync`, `ScoreNearestModelIds` (exported), prompt-asset cache. ~120 lines.
- `src/chat-commands/model-switch-command.js` — collect not-found names during validation; one aggregated post at the end when any attempt was not-found (default-error lines last).
- `src/chat-commands/set-channel-model-command.js` — one call-site swap.
- `data/static/ai/model-suggestion-instructions.md`, `data/static/ai/model-suggestion-schema.json`; `scripts/validate-ai-prompts.js` — one `EXPECTED_PAIRS` entry.
- `tests/diagnostics-report.test.js` — scorer table (`'gpt5 mini'`→`gpt-5-mini` first; `'sonnet'`→ every `claude-sonnet-*`; garbage → empty); partial catalog failure scores the OK provider only; total catalog failure still yields classification + baseline; baseline lines identical to the user-triggered report.
- `tests/model-switch-command.test.js` — extend `MakeEnv` with `GetAvailableModelCatalogStatusByProviderAsync` and `ProcessMessageWithJsonResponseAsync` doubles; cases: single not-found; mixed (default ok, complex not-found) → one post, success line kept, complex default-error line last; two invalid → one catalog fetch, one AI call, one baseline; AI model argument equals `DefaultModelName`; off-catalog suggestion dropped; rejection; timeout (fake timers) posts within cap; late settlement after timeout does not post again; 200-char cap and an instruction-shaped name rendered as data.
- `tests/set-channel-model-command.test.js` — new, same shape (today the only coverage is the integration call at `tests/chat-module.integration.test.js:802-803`).

### Acceptance

- [ ] `switch-models:'ChatGPT'` (with GH-168 **disabled**) replies once with classification + ≥1 catalog suggestion + paste-able command + the original default-error line + baseline, in that order.
- [ ] `switch-models:default='gpt-5-mini',complex='ChatGPT'` posts **one** message: success line retained, complex context above, `Complex still using …` last before `*Diagnostics:*`, one baseline.
- [ ] Two invalid names: one catalog fetch, one AI call, one baseline, one post.
- [ ] A failing provider catalog never suppresses the reply: partial → scores the healthy provider; total → classification + default-error + baseline.
- [ ] The assist call goes to `DefaultModelName` (asserted by mock) — never a hard-coded model or a new env var.
- [ ] Exactly one reply within ≤4 s of validation; rejection, timeout and late settlement each produce exactly one post.
- [ ] An AI suggestion that is not in the live catalog never appears.
- [ ] Requested names are capped at 200 chars and passed as data; an instruction-shaped name cannot change the prompt's instructions.
- [ ] `set-channel-model` not-found reply has the same shape.
- [ ] `scripts/validate-ai-prompts.js` covers the new instruction/schema pair.
- [ ] Baseline lines byte-identical to `run-diagnostics` (extends the existing GH-88 test).

### Sequencing

Ship GH-168 first (retires the reported case with config + one resolver), then this phase (durable net for everything the table can't map). Independent of GH-113 (`app_mention` catch-all).

### Risks

- Reply length: up to 4 lines per not-found name + 5 baseline lines. Admin-only surface; if it reads as a wall, drop the "Closest IDs" line when the AI line fired.
- Cost: one short JSON call to the simple model per not-found command. Not on the hot path; rare by construction once aliases land.
- Scorer/LLM false positives: they suggest, the catalog validates; a wrong suggestion costs the user one more command, never a bad switch.
