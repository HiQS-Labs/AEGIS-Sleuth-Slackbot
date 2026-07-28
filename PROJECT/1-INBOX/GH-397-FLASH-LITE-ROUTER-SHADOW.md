---
title: "Router mode: Gemini Flash Lite shadow corpus + operator off/shadow/active toggle"
status: Proposed (1-INBOX — not yet active)
created: 2026-07-16
updated: 2026-07-16
owner: noel
gh_issue: 397
source: https://github.com/NeochromeTeam/sleuth-app/issues/397
branch: feat/gh-397-flash-lite-router-shadow
doc_type: spike
complexity: 3
risk: 2
effort: 3
phases: 2
ratings_provisional: true
strategic_role: >
  This is the low-hanging-fruit experiment that decides whether GH-392 (Needle) is worth
  pursuing. Flash Lite is near-zero integration, so it produces the shadow corpus + a live
  active-mode datapoint fastest; the corpus + the operator toggle are what a Needle GO/NO-GO
  is later judged against. #397 gates #392.
operator_decisions_locked:
  - "Active mode = FULL TAKEOVER: above the confidence threshold Flash Lite executes whatever it resolves, INCLUDING Risk-tagged / admin commands (operator's explicit call, 2026-07-16)."
  - "Toggle = Slack admin command only (`@Sleuth AI router-mode <off|shadow|active>`), in-memory per-workspace; on restart/redeploy it resets to the `ROUTER_SHADOW_DEFAULT_MODE` env value (default `off`) — set that env to make a mode (e.g. prod `shadow`) sticky across deploys (added 2026-07-16)."
non_goals:
  - Per-workspace persisted mode in a state file (the sticky default is a single process-wide env, `ROUTER_SHADOW_DEFAULT_MODE`, applied at startup — deliberately coarse; a per-workspace persisted toggle is out of scope)
  - Changing the RMM prompt / schema / candidate set (apples-to-apples is the point)
  - Letting the shadow corpus reach the authoritative event ledger or the ?format=rebalance export
  - Building a second, parallel shadow path separate from GH-392
  - Removing the confidence threshold + fallback to the current resolver (kept — that is correctness, not authority policy)
related:
  - "#392 (Needle first-responder router spike — the SAME experiment; #397 is its go/no-go gate)"
  - "COMMAND-NEAR-MISS-AI-FALLBACK.md (Phase 0 readout: ~2 near-misses / 6wk — the sparsity prior)"
  - "#391 / #387 / #388 (structural guards for the convention-drift class — the corpus is the model-agnostic complement)"
  - "P3 event-sourced core (event-store.js shadow-diff pattern this mirrors)"
goal: >
  Ship an operator-controlled three-state router mode — off | shadow | active — with Gemini
  Flash Lite as the model. SHADOW logs every @Sleuth routing decision (matched AND unmatched)
  to a separate, non-authoritative per-workspace JSONL corpus. ACTIVE gives Flash Lite full
  takeover of command resolution above a confidence threshold (falling back to the current
  resolver below it). A `@Sleuth AI router-mode <mode>` admin command flips it live. The corpus
  is the durable deliverable — replayable OFFLINE against Needle (#392) / an embedding tier / a
  local 0.5B — and the whole thing is the go/no-go evidence base for #392.
---

# GH-397 — Router mode: Flash Lite shadow corpus + operator off/shadow/active toggle

> **1-INBOX capture**, not the active-work doc — no `## Status` table yet. On promotion to
> `PROJECT/2-WORKING/`, add the status table + per-phase QA gates and carry `gh_issue` forward.
> **The full evaluated project plan lives at the bottom of the GH issue**
> ([#397](https://github.com/NeochromeTeam/sleuth-app/issues/397)) — this doc is the PDDA hook; the
> issue is the canonical plan. Keep them in sync on promotion.

## Key concepts
- **The corpus is the asset, the model is the variable.** Log routing decisions to a replayable
  JSONL corpus; every candidate model is scored offline against it. Answers "regex vs. embeddings vs.
  small LLM" for *our* traffic, model-agnostic — the durable win even on NO-GO.
- **Unify with #392.** The Needle spike is the same shadow-router experiment with a different
  candidate (local 26M ARM) + a hosting question. Build ONE capture harness; Flash Lite is candidate
  #1 (cheapest to wire, §1 of the issue plan), Needle/embeddings/0.5B replay offline. Re-scope #392 to
  "offline replay candidate + hosting spike against this corpus."
- **Near-zero integration, verified.** Prefix routing (`gemini-*` → `gemini-provider.js`, which already
  strips the schema keys Gemini rejects), `GEMINI_API_KEY` already a validated workspace field, and
  the fire-and-forget unmatched-mention hook (`#EmitNearMissProbeAsync`) all already exist. Flash Lite
  is a model-ID + a shadow emitter + one env flag.
- **Shadow ALL mentions, both outcomes.** Matched records give the false-alarm/agreement metrics;
  given the near-miss sparsity prior (~2 failures / 6 weeks on `neochrome`), the matched mass is where
  statistical power actually is — so capturing matched inputs is non-optional, not a nicety.
- **One switch, three states, default `off`.** A per-workspace in-memory `RouterMode ∈ {off, shadow,
  active}`, flipped live by an admin-only `@Sleuth AI router-mode <mode>` command. `off` = nothing;
  `shadow` = Flash Lite runs + logs, zero authority; `active` = Flash Lite full takeover above the
  confidence threshold (operator's locked call — see front-matter). Stored on per-workspace state, not
  a module global (respects the #387 isolation guard). In-memory ⇒ on restart/redeploy it resets to
  the `ROUTER_SHADOW_DEFAULT_MODE` env (default `off`); set that env to keep a mode sticky across
  deploys (e.g. prod `shadow`) without re-issuing the command. Invalid env value → warned, falls to `off`.
- **Corpus store mirrors the P3 event-store.** `event-store.js`-style append (never throws), a
  separate non-authoritative store outside `data/runtime/events/`
  (`data/runtime/shadow/<workspace>_router-shadow.jsonl`). `rawText` capture is a real privacy
  escalation over the existing metadata-only probe — tenancy-gate to `neochrome` + retention-bound it.
- **Review discipline still applies.** Operator directed an end-to-end solo build (2026-07-16); given
  this is authority-bearing hot-path code (the #384/#391 class), run a `/code-review` (or `/relay`
  reviewer turn) before merging to `development`.

## Phase 1 — Ship the router-mode toggle end-to-end (the build)
> Operator wants this "ready to go" now. Default `off`; flipping to `active` is a pure operator action.
> **BUILT 2026-07-16** on `feat/gh-397-flash-lite-router-shadow` (uncommitted pending review). 22 new
> tests green (18 unit + 4 chat-module integration); `validate:ai` / `validate:fsm` /
> `validate:workspace-isolation` clean; `validate:commands` and `tsc` carry only pre-existing
> `development` failures (unrelated: `confirm-multi-task-proposal` route; GH-366 checkJs errors).

### Checklist
- [x] `router-mode` catalog entry (`data/static/ai/command-catalog.json`, `Permission: admin`,
      `Risk: high`) + route registered via `#RegisterCommandRoutes` + admin-gated handler
      (`src/chat-commands/router-mode-command.js`). Reports current mode; validates the arg.
- [x] Per-workspace in-memory mode on `RouterShadowModule` (instance field, NOT a global — passes the
      #387 guard), default `off`. (`src/router-shadow-module.js`.)
- [x] Shadow emitter in the `#OnAppMentionAsync` ladder (before dispatch), firing on matched AND
      unmatched mentions; non-authoritative JSONL store in `event-store.js`'s image
      (`src/router-shadow-store.js` → `data/runtime/shadow/<ws>_router-shadow.jsonl`, gitignored).
- [x] Flash Lite call path — `ResolveRmmIntentAsync` gained a `ModelNameOverride` option (default
      `gemini-3.1-flash-lite` — the stable pinned first-responder default, env `ROUTER_SHADOW_MODEL`);
      incumbent callers keep `ComplexModelName`.
- [x] `active` mode: `#TryRouterActiveTakeoverAsync` resolves with Flash Lite; if confidence ≥ floor
      (`ROUTER_ACTIVE_CONFIDENCE_MIN`, default 0.7) and a runnable canonical command exists, executes
      via the same `CommandRouter.RouteAsync` (FULL takeover — any command, incl. Risk-tagged, since
      the real handler still enforces its own admin gate); else falls back. New `MatchRouteName` on
      `CommandRouter` gives an honest, side-effect-free incumbent outcome for the corpus.
- [x] Optional `ROUTER_SHADOW_WORKSPACES` allowlist gates which workspaces may arm (privacy guard for
      the rawText capture); unset ⇒ any admin may arm their own workspace, per the operator's
      general-toggle intent. (Reconciled the earlier neochrome-only note.)
- [x] `ROUTER_SHADOW_DEFAULT_MODE` env seeds the startup mode at construction, making a mode sticky
      across restart/redeploy (added 2026-07-16). Invalid value → warned + fail-safe to `off` (never arm
      on a typo); runtime `router-mode` command still overrides. Re-applied on the next boot.
      (`src/router-shadow-module.js#ResolveStartupMode`.)
- [x] Tests: mode transitions, admin-gating (non-admin rejected), workspace allowlist, resolve-maps +
      model override, injected Flash Lite failure → error candidate (production intact), `ShouldExecute`
      threshold, shadow record shape, store never-throws + torn-tail tolerance, and chat-module active
      takeover / threshold fallback / shadow-leaves-behavior-unchanged.

### QA checklist — Phase 1
- [ ] `RouterMode` is per-workspace state, never `global.*`/singleton (passes the #387 guard intent).
- [ ] `router-mode` primary route registered only in `RegisterCommandRoutes`; admin-only enforced.
- [ ] Corpus is separate + non-authoritative; never reaches the event ledger or the rebalance export.
- [ ] Default `off`; a Flash Lite outage in shadow/active never blocks or breaks the hot path.
- [ ] `rawText` privacy escalation scoped (neochrome-only) + retention-bounded + documented.

## Phase 2 — Shadow run, bake-off, and the #392 go/no-go
> Discovery phase: the GO/NO-GO decision + numbers are written **back into this doc** (and the issue).

### Checklist
- [ ] Pre-register decision criteria BEFORE arming (rescue rate, false-alarm rate, agreement with the
      gpt-4o-mini RMM, latency p50/p95, cost/1k, and — in active mode — the live wrong-execution rate).
      Add retry-pair mining.
- [ ] Arm `shadow` for `neochrome`; run until a record-count target (not a fixed calendar window —
      the sparsity prior means calendar windows undersample failures).
- [ ] Offline replay/scoring script (candidate-agnostic).
- [ ] Bake-off: Flash Lite vs. embedding tier vs. local 0.5B (and Needle, per #392) on the one corpus.
- [ ] Write the **#392 go/no-go** + numbers back into this doc and the issue. Clear `ratings_provisional`.

### NO-GO still ships value
The **corpus as a PDDA-gated routing regression suite** — the model-agnostic fix for the
convention-drift class (cf. #391). And "the router rarely misses" is itself a valid finding. The
toggle also stays as an operator-controlled capability regardless.
