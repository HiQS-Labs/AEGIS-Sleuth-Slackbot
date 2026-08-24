---
title: Command Near-Miss Recovery — turn "command not found" dead-ends into AI review → synthesis
date: 2026-06-20
branch: development
status: Phase 0 + Phase 1 SHIPPED (1.4.199 / 1.4.200); Phase 2-lite SHIPPED and flipped ON in prod (2026-07-06). 2026-08-24: a 3rd near-miss (bare `model` mention, neochrome workspace) landed below the deterministic floor and needed a manual catalog alias (GH-132 issue #132, `data/static/ai/command-catalog.json` hotfix, shipped same day). Operator decision: build Phase 2-full now rather than continue waiting on the Phase 0 gate — IN PROGRESS as of 2026-08-24 on `feat/gh-132-near-miss-llm-escalation`. Phase 3/4 remain HELD, out of scope for this pass. Codex-reviewed + worth-it re-sequenced.
owner: noel
author: Claude (Opus 4.8, 1M)
complexity: 3
risk: 2
effort: 2
surface:
  - src/chat-module.js                  # the mention dispatch ladder (interception seam ~L776)
  - src/command-intent-resolver.js      # ResolveRmmIntentAsync — the existing AI review→synthesis engine
  - src/catalog-regex-aliases.js        # JSON-driven phrasing aliases (Phase 1 mechanism)
  - data/static/ai/command-catalog.json # the declarative command registry
  - src/workspace-ai.js                 # GetModelAvailabilityAsync + GetAvailableModelCatalogStatusByProviderAsync (Phase 3 ground truth)
related:
  - PROJECT/3-COMPLETED/UNIFY-COMMANDS.md  # COMPLETE — built the catalog + alias infra this plan extends
  - data/static/ai/rmm-instructions.md
---

## TL;DR — the reframe

Today the bot's mention handler is a **first-match-wins ladder**: deterministic routes →
deterministic responses → unsupported-reminder → NL web-search → **generic AI chat**. When a
message *looks like an attempt to run a command* but matches no route, it drops to the bottom
rung (free-form chat), which answers conversationally but never says *"did you mean this exact
command?"* — that's the dead end that produced the `ifl rmm switch model to opus 4.8` →
"I didn't run anything" reply.

The fix is not new AI — `ResolveRmmIntentAsync` is **already** an AI review → synthesis →
"here's the exact command" engine. The gaps are:
1. **Invocation** — it only fires on the literal `rmm` keyword, never automatically on a near-miss.
2. **Argument-level repair** — it can't yet say "`opus 4.8` isn't a valid model; did you mean
   `claude-opus-4-7`?" against the *live* model catalog.

So: insert a **near-miss recovery tier** above the generic-chat fallback, reuse the existing
resolver, and route imprecision to the right ground truth. **Phases 2–4 are additive, flag-gated,
default-OFF**, and fall through to today's behavior when they don't fire (no regression). **Phase 1 is a
small deterministic catalog addition** (no flag — its rollback lever is deleting the alias entry).

**Worth-it sequencing (2026-06-20 review):** actual usage is "occasional, a few users" with **no miss-logging
today**, so the LLM tier's benefit is *asserted, not measured*. **Phase 0** (a no-LLM counter) measures the
dead-end rate first; **Phase 2 is split** into a cheap deterministic **2-lite** (no model call) and a gated
**2-full** (LLM), so the expensive tier is built only on evidence it's needed. Ship **Phase 0 + Phase 1** now;
let the count gate the rest.

## What already exists (reuse, don't rebuild)

- `ScoreCommandEntry` — a **cheap deterministic** relevance score of a message against one catalog
  entry. Note `RetrieveCandidateCommands` *ranks* with it but returns only the entries; the score is
  discarded ([command-intent-resolver.js:446-456](src/command-intent-resolver.js#L446-L456)), so the
  cost gate must call `ScoreCommandEntry` directly (or a thin scored-candidates helper) — not
  `RetrieveCandidateCommands` alone.
- `ResolveRmmIntentAsync` — normalize → candidate retrieval → complex-model intent resolution →
  returns a runnable `CanonicalCommand`, a `SyntaxTemplate` (arg missing), or a clarification.
- `catalog-regex-aliases.js` — add a phrasing as a JSON edit that delegates to an existing route.
- `WorkspaceAI.GetModelAvailabilityAsync(model)` — the **live** validity check returning a typed
  `ModelAvailabilityResult` that distinguishes `provider-not-configured` / `catalog-unavailable` /
  `not-found` ([workspace-ai.js:432-482](src/workspace-ai.js#L432-L482)) — richer than the lower-level
  `IsValidModelAsync` primitive (which *throws* on the first two states). Pair with
  `GetAvailableModelCatalogStatusByProviderAsync()` to list the ids a workspace can actually use now.

## Design principle: dead-end → review → synthesis, grounded in the RIGHT source

Not all imprecision is the same, and using the wrong ground truth is how you get
confidently-wrong suggestions. Route by *kind*:

| Imprecision | Ground truth | Example |
| --- | --- | --- |
| Which **command** did they mean? | command-catalog.json (+ deterministic score) | "switch model to opus" → `model-switch-default` |
| Is this **model id** real for this workspace? | **live model catalog** (`GetModelAvailabilityAsync`) — **NOT ask-self** | "opus 4.8" → `claude-opus-4-7` (+ needs `ANTHROPIC_API_KEY`) |
| "How do I…/what can you do?" (genuine help) | **ask-self RAG** over repo docs/code | grounds the help answer instead of free-chatting |

> **Important correction to the original idea:** ask-self is RAG over *our repo's docs/code* — perfect
> for "how do I do X in Sleuth," useless for "is `opus 4.8` a live model." Model-name repair must hit
> the live provider catalog, not ask-self. ask-self belongs in the Phase 4 *help* fallback.

---

## Phase 0 — Measure the dead-end rate (ship now, no LLM, no user-facing change)

**Goal:** convert the asserted "near-misses are a frequent dead-end" into a real number *before* paying for
the LLM tier. Per the worth-it review: usage is "occasional, a few users" and there is no miss logging today,
so the benefit of Phase 2-full–4 is **asserted, not measured** — this phase makes it measurable for ~the cost
of a log line.

- At the same fallback seam Phase 2 targets ([chat-module.js:776](src/chat-module.js#L776)) — **after** all
  deterministic routes + web-search auto-routes fail, **before** the generic AI chat — emit a best-effort
  structured **near-miss probe**: workspace, channel, user, the top deterministic candidate id, and its
  `ScoreCommandEntry` score (the signal that separates "wrong syntax for a real command" from genuine
  off-topic chat). No reply, no LLM, no behavior change; wrapped so a probe failure can never block the
  fallthrough (mirror the fire-and-forget audit idiom).
- **Privacy:** logs metadata only — workspace, channel, user, top candidate id, top score. **No raw message
  text** (the score is the signal; there's nothing to gate).
- **No flag (ponytail):** it's temporary measurement scaffolding — disable by reverting the commit, not a
  permanent env knob. Fire-and-forget + `.catch`-guarded so a probe failure can never affect the fallthrough.
- **Read it after ~1–2 weeks:** count the probes and bucket by score. High score = "wrong syntax for a real
  command" → Phase 2-lite handles it cheaply; low score = genuine chat → leave alone; "right intent / fuzzy
  arg" → the Phase 3 signal.

**Success metric:** a real weekly count of unmatched mentions, split by deterministic score — the input that
decides whether Phase 2-full / 3 / 4 earn their carrying cost.

**Litmus:** an unmatched mention emits exactly one structured probe line and the user still gets today's
chat reply, byte-for-byte; a matched command emits no probe.

### Phase 0 READOUT — 2026-07-05 (gate resolved)

Read the probe from prod `neochrome` over the **full journal retention window (2026-05-25 → 2026-07-05)**
via `journalctl -u sleuth-app --since 2026-06-01 | grep -A5 "near-miss probe"`. Complete dataset (not
truncated — retention predates the Phase 0 ship):

| Date | topCandidateId | topScore |
|---|---|---|
| Jun 22 | `recall` | 9 |
| Jul 02 | `commands` | 4 |

**N = 2 near-misses in ~6 weeks.** Findings:

1. **Insufficient data to re-set `NEAR_MISS_SCORE_FLOOR`.** Two samples ({9, 4}) cannot ground a threshold;
   the provisional **floor = 5 stands** (it would catch the `9`, miss the `4`). No change warranted.
2. **The measured rate retires the heavy-tier case.** The whole point of Phase 0 was to convert "near-misses
   are a frequent dead-end" into a number *before* paying for the LLM tier. The number is **~2 per 6 weeks on
   the busiest workspace** — near-nonexistent. This is the worth-it review's "asserted, not measured" caution,
   now measured against.

**Decision (gate resolved):**
- **Phase 2-lite** (deterministic, already built, zero LLM): **FLIPPED ON on prod 2026-07-06** —
  `COMMAND_NEAR_MISS_LITE=ON` added to `/root/sleuth-app/.env.runtime` + service restarted (verified in the
  running env). It's free, gives users deterministic "Did you mean?" suggestions, and thickens the dataset for
  any future re-decision.
- **Phase 2-full / 3 / 4** (the LLM tiers): **HELD — do not build.** The measured dead-end rate does not
  justify the carrying cost. Revisit only if a longer/enabled-2-lite window shows the rate materially climbing.

See [[command-near-miss-phase0-readout]] and the [First-Time-User metric readout](../2-WORKING/FIRST-TIME-USER-REMEDIATION.md#metric--finalized-2026-07-05-real-prod-readout)
(same probe, same conclusion: 0 of the 2 events were reminder-create intents).

---

## Phase 1 — "I Feel Lucky" alias. ✅ SHIPPED (1.4.200). Zero LLM.

**Goal:** the exact failure the user hit stops being a dead end, with no model call and no deploy-logic risk.

- A single `RegexAliases` entry on the **`rmm-ifl`** catalog command (validator requires the alias's
  `Route` ∈ that entry's `RegisteredRoutes`, and `rmm-ifl` owns `"rmm ifl"`):
  ```jsonc
  "RegexAliases": [
    { "Pattern": "^(?:ifl|(?:i'?m?\\s+)?feel(?:ing)?\\s+lucky)\\b(?:\\s+rmm\\b)?[\\s,:;.!?]+(.+)",
      "Flags": "is", "Route": "rmm ifl", "Args": ["$1"] }
  ]
  ```
  **Broadened for demo UX (operator decision):** matches `ifl …`, `ifl rmm …`, `i feel lucky …`,
  `i'm feeling lucky …`, and `feeling lucky …` — all → the `rmm ifl` execute path (resolve → auto-run if
  IFL-eligible). The spread is a deliberate sales-demo requirement, not over-engineering (`/ponytail`
  kept the breadth, collapsed the prefix alternation). `Flags: "is"` mirrors the hardcoded route's dotall;
  `Args:["$1"]` feeds the captured request — the redundant `rmm` stripped — to
  `HandleRmmCommandAsync(..., execute=true)`. The `\b` guard stops words like "iflation" matching; a bare
  prefix with no request falls through to chat.
- (Optional, same mechanism) seed a small set of other high-frequency transpositions/typos as aliases
  once we see them in logs — this is the cheap, deterministic catch layer beneath the AI tier.
- **Validate + ship:** `npm run validate:commands`, add a catalog-alias test, bump `package.json` +
  CHANGELOG per AGENTS.md.

**Does NOT fix:** "opus 4.8" still isn't a switchable model — Phase 1 only gets the message *into* the
resolver. That's Phase 3.

**Litmus (met):** `rmm ifl …`, `ifl rmm …`, `ifl …`, `i feel lucky …`, `i'm feeling lucky …`, and
`feeling lucky …` all reach the `rmm ifl` execute path; `iflation` / bare `ifl` do not; no existing route
changes classification. Covered by the `rmm-ifl RegexAliases (live catalog)` test.

---

## Phase 2-lite — Deterministic "Did you mean?" (no LLM; gated on Phase 0)

**Goal:** recover the *obvious* near-misses — wrong syntax for a real command (`ifl rmm …`, `show remindrs`) —
with the cheapest possible mechanism. **Gate:** ship only if Phase 0 shows non-trivial high-score misses.

- New `#TryHandleNearMissCommandAsync` at the seam ([chat-module.js:776](src/chat-module.js#L776)), **after**
  web-search auto-routes and **before** the generic AI chat. Returns `true` only when it responds; else falls
  through (no regression).
- **Deterministic only — no model call.** Score the message with `ScoreCommandEntry` — the primitive
  `RetrieveCandidateCommands` ranks with but discards ([command-intent-resolver.js:446-456](src/command-intent-resolver.js#L446-L456));
  add a `RetrieveScoredCandidates` helper that surfaces the `{Entry, Score}` pairs. When the top score ≥ a
  floor (set from Phase 0's distribution), reply with that candidate's syntax example — *"Did you mean the
  `switch-models` command? Try `switch-models:'gpt-5'`."* Below the floor → `false`, fall through to chat.
- **Why this is the 80/20 at our volume:** at "a few users / weekly," a permanent LLM-on-every-miss subsystem
  is over-built; the deterministic top candidate is right for the common wrong-syntax case, with near-zero
  carrying cost (no spend, no latency) and a much smaller false-positive surface.
- **Flag:** `COMMAND_NEAR_MISS_LITE` (default OFF). Off = byte-for-byte current behavior.

**Anti-goals:** no LLM, no auto-execution, no nagging — the score floor (from Phase 0) keeps false positives near zero.

**Success metric:** of the high-score misses Phase 0 counted, the share 2-lite turns into a correct suggestion,
with **no** measurable rise in suggestions on truly conversational messages.

---

## Phase 2-full — LLM escalation. 🚧 IN PROGRESS (GH-132, `feat/gh-132-near-miss-llm-escalation`, 2026-08-24)

Gate override: shipping this now on operator direction rather than waiting for the Phase 0 counter
to climb further — see the `status` line above for the incident that triggered it.

**Goal:** handle the near-misses deterministic ranking *can't* — argument extraction, close-call
disambiguation — by escalating the residual misses to the existing AI engine.

- When 2-lite has a strong signal but can't build a runnable suggestion (needs arg extraction, or two
  candidates tie), escalate to `ResolveRmmIntentAsync` (the existing normalize → resolve → synthesize engine),
  still **suggest-only**. The Phase 0 counter + 2-lite's own residual-miss log say whether this increment is
  worth the per-call LLM cost + tuning carrying cost — **don't build it on faith.**
- **Confidence-tiered synthesis:**
  - High confidence + runnable `CanonicalCommand` → *"Did you mean `switch-models:'gpt-5'`? Reply `rmm ifl …` to run it."*
  - High confidence + missing/invalid arg → hand to Phase 3 (argument repair).
  - Low confidence → `false`, fall through to today's chat. **Never** nag on genuine conversation.
- **Flag:** `COMMAND_NEAR_MISS_LLM` (default OFF).

**Success metric:** of the misses 2-lite *couldn't* resolve, the share the LLM tier turns into a correct
runnable suggestion — with no measurable rise in suggestions on truly conversational messages.

### Implementation notes (2026-08-24)

- Shipped as `#TryHandleNearMissAiEscalationAsync` in `chat-module.js`, wired immediately after
  `#TryHandleNearMissCommandAsync` at the same seam, still before generic chat.
- **Empirical finding that changed the design:** `ScoreCommandEntry`'s token-substring scoring is
  noisier than assumed. Measured directly (`RetrieveScoredCandidates`): ordinary chat like *"sounds
  good, appreciate it"* scores 3 with a 3-way tie for top candidate — same raw score as the genuine
  `command` → `commands` near-miss (also 3, but with a clear single leader, margin 2). A bare score
  floor cannot separate real near-misses from common-word noise at this volume.
- **Mitigation:** in addition to `NEAR_MISS_LLM_SIGNAL_FLOOR` (3) and the existing
  `NEAR_MISS_SCORE_FLOOR` (5) as the escalation band's bounds, require a **margin** over the
  runner-up candidate (`NEAR_MISS_LLM_MARGIN_FLOOR = 2`) — a genuine near-miss has one clear top
  pick; noise ties or nearly ties across several unrelated entries. Coarse but empirically effective
  on the samples checked; not a proof for all inputs. Mutation-tested (see
  `tests/command-near-miss-llm.test.js`, "tied with runner-up" case).
- Confidence gate: `NEAR_MISS_LLM_CONFIDENCE_FLOOR = 0.6` on `RmmResolutionResult.Confidence` (the
  resolver itself does not threshold this — it's a raw LLM-reported float).
- **New, separate finding — not fixed here, flagging for later:** the same empirical check found
  `"what time is it"` scores **5** against `convert-text-into-slack-list`/`generate-user-list`/
  `model-switch-default` (a 3-way tie) — at or above `NEAR_MISS_SCORE_FLOOR`, meaning the *already
  shipped* Phase 2-lite tier can misfire a "Did you mean...?" suggestion on plainly conversational
  input. Phase 2-full's margin check does not apply to 2-lite. Worth a follow-up issue: add the same
  margin check (or an equivalent) to `#TryHandleNearMissCommandAsync`.

---

## Phase 3 — Argument-level repair, model-switch first (live-catalog-grounded)

**Goal:** "right intent, fuzzy value" stops being a dead end — starting with the model-switch family,
the most common precision failure.

- When the resolver maps to `model-switch-*` / `set-channel-model` but the model name fails
  `GetModelAvailabilityAsync` (use it, not the lower-level `IsValidModelAsync`, so we can tell
  `provider-not-configured` / `catalog-unavailable` / `not-found` apart instead of catching a throw),
  query `GetAvailableModelCatalogStatusByProviderAsync()`, fuzzy-match the user's
  token ("opus 4.8") to the nearest valid id(s), and synthesize:
  *"I can't switch to `opus 4.8`. Closest available: `claude-opus-4-7` (needs `ANTHROPIC_API_KEY` on
  this workspace). Want `switch-models:'claude-opus-4-7'`?"*
- Surface the **prerequisite** (API key / provider) and the **canonical id form** — the two things
  that silently fail today.
- Built as a reusable "argument repair" seam so other fuzzy args (channel, user, list slug) can plug
  in later; model-switch is the first consumer.
- **Flag:** `MODEL_NAME_REPAIR` (default OFF).

**Anti-goal:** do **not** use ask-self for model validity (stale/ungrounded) — live catalog only.

**Success metric:** model-switch attempts with an imprecise id resolve to a valid suggestion (or a
clear "no key / not available") instead of a generic refusal.

---

## Phase 4 — (Stretch) Interactive confirm + ask-self-grounded help fallback

**Goal:** close the loop from *suggest* to *one-tap do*, and make the genuine "how do I…" miss helpful
instead of hallucinated.

- **Confirm button:** render the suggested command as a Block Kit "Run it" button (reuse the existing
  block-action handler — `chat-module.js` already dispatches `ArgActionInfo.value`). **There is no shared
  runtime "risk gate" to reuse** — `Risk` is catalog metadata fed to the resolver *prompt*
  ([command-intent-resolver.js:462-477](src/command-intent-resolver.js#L462-L477)), not an enforcement
  hook; today the only `rmm ifl` execution gate is `CanExecuteWithIfl`
  ([rmm-command.js:101-124](src/chat-commands/rmm-command.js#L101-L124)) and any admin check happens
  *inside* the destination handler (e.g. [model-switch-command.js:36-44](src/chat-commands/model-switch-command.js#L36-L44)).
  So the button needs a **dedicated execution-policy layer** that explicitly re-checks `CanExecuteWithIfl`
  **and** routes through the destination command's own auth path before running — a near-miss may *show* an
  admin command, but the button must not become a way to bypass that handler's permission check.
- **ask-self help fallback:** for misses that are clearly "how do I / what can you do" rather than a
  specific command attempt, ground the conversational answer in **ask-self** (repo docs/code) instead of
  free chat — turns "I'm not sure" into a cited, correct answer. **Caveat — `ask-self` is tenancy-gated:**
  it's a silent no-op outside the Neochrome workspace (`NEOCHROME_TEAM_ID`, fail-closed —
  [ask-self-command.js:18-29](src/chat-commands/ask-self-command.js#L18-L29)). So this fallback must
  **scope to gated workspaces only** (where it's a real grounded answer) and fall through to today's chat
  elsewhere — otherwise it'd be a *new* silent dead-end for every other tenant. A tenant-agnostic grounded-help
  seam (e.g. catalog/help-driven) is the alternative if we want it everywhere.
- **Flag:** `COMMAND_CONFIRM_BUTTONS`, `ASK_SELF_HELP_FALLBACK` (default OFF; the help fallback additionally
  no-ops where `ask-self` is gated out).

---

## Cross-cutting

- **Authority (spike-360-lite):** this is a UX/routing layer over *existing* commands — **no new
  authoritative state**. The execute paths are: (a) **Phase 1** — the `ifl rmm` alias routes into the
  *existing* `rmm ifl` execution path, so it neither adds nor relaxes a gate; it inherits that path's
  current `CanExecuteWithIfl` + destination-handler auth behavior ([chat-module.js:351-366](src/chat-module.js#L351-L366),
  [rmm-command.js:101-124](src/chat-commands/rmm-command.js#L101-L124)). (b) **Phase 4 button / any
  auto-run** — the new sharp edge; it must re-check `CanExecuteWithIfl` and go through each destination
  command's own auth path (there is **no shared runtime risk gate** — see Phase 4). Only **Phases 2–3 are
  suggest-only** and carry no execution risk.
- **Cost/latency:** Phase 2-lite makes **no model call at all**; Phase 2-full's deterministic score gate
  bounds LLM-call rate so there's no LLM on pure chat. Phase 0 is logging only.
- **Rollout:** Phases 2–4 are additive + flag-gated + default-OFF, mirroring the repo's P3 pattern, and
  each falls through to current behavior when its flag is off or it doesn't fire. **Phase 1 has no flag** —
  it's a deterministic catalog-alias addition whose rollback lever is deleting the alias entry (gated by
  `validate:commands`); its litmus is that no existing route changes classification.
- **Loop safety:** never re-process the bot's own suggestion/confirmation messages.

## Open questions

1. Phase 2-lite score floor — set from the Phase 0 counter's score distribution before enabling (no longer a guess).
2. Should `ifl <request>` (bare, no `rmm`) also auto-run, or only `rmm ifl` / `ifl rmm`? (Broader pattern
   = more convenience but more surface; decide before Phase 1 if we want it in the first alias batch.)
3. Phase 4 confirm-button execution for **admin/medium-risk** commands — button + permission check, or
   require the typed `rmm ifl` for anything above low-risk?

## Sequencing

**Phase 0** (now, no LLM — measure the miss rate) + **Phase 1** (now, no LLM — the `ifl rmm` alias) → read the
counter (~1–2 weeks) → **Phase 2-lite** (deterministic "did you mean?", if high-score misses are non-trivial) →
**Phase 2-full** (LLM) / **Phase 3** (model-name repair) / **Phase 4** (stretch) **only if** the data shows the
LLM tier + arg-repair earn their carrying cost. Phase 0 and Phase 1 are independently shippable today.
