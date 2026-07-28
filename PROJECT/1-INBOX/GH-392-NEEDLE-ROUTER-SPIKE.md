---
title: "Spike: Needle (26M ARM tool-calling model) as Sleuth's first-responder module/function router"
status: Deferred (1-INBOX) — gated on GH-397 / PR #401 (see re-trigger)
created: 2026-07-16
updated: 2026-07-16
owner: noel
gh_issue: 392
source: https://github.com/NeochromeTeam/sleuth-app/issues/392
branch: spike/gh-392-needle-router
doc_type: spike
complexity: 2
risk: 1
effort: 2
phases: 1
ratings_provisional: true
non_goals:
  - Production cutover or giving Needle any routing authority
  - Migrating the main Sleuth app to ARM
  - Fine-tuning Needle (Phase 0 evaluates the base tool-calling model only)
  - Wiring Needle into tick / marathon / HQ orchestration
  - An authority flip of any kind (shadow-only in Phase 0)
related:
  - "GH-397 / PR #401 (Gemini Flash Lite router — the PRIMARY router POC this is gated behind)"
  - "#384 (ask-reminders tenant-isolation incident — the driver)"
  - "#387 / #388 / #391 (structural guards for the same convention-drift class — complementary)"
  - "#366 (learned-convention proposals — adjacent 'smarter Sleuth' work)"
  - "cactus/Needle: github.com/cactus-compute/cactus (README line 178)"
  - "xyz-3-agents-swarm: /relay + /consult for the build discipline"
goal: >
  Decide GO/NO-GO on adopting Needle as Sleuth's local first-responder router,
  backed by real evidence: a golden-routing eval set + a shadow-diff comparison
  against the current main-LLM router on real traffic. Phase 0 delivers the
  decision AND the golden set (a model-agnostic routing regression gate) — so it
  pays off even on NO-GO.
---

# GH-392 — Needle as Sleuth's first-responder router (spike)

> **⏸️ DEFERRED (2026-07-16) — gated on GH-397 / PR #401 (Gemini Flash Lite router).**
> The Flash Lite router is the **primary router POC**: it's already built, needs no new infra, and
> its off/shadow/active shadow-store *is* the shadow-diff/eval harness this Needle spike would need.
> Doing it first answers the **model-agnostic** question ("does a cheap first-responder router tier
> actually improve routing?") for ~$0. Needle answers a *different* question — **local / private /
> offline / near-zero-marginal-cost** inference — which Flash Lite does **not** validate.
>
> **Re-trigger — start GH-392 only when BOTH hold:**
> 1. #401's shadow data shows the routing tier is worth **activating** (net routing improvement), AND
> 2. a **privacy / cost / offline** driver makes *local* inference matter.
>
> When re-triggered, evaluate Needle as the **local-tier alternative on #401's existing harness**
> (same golden set + shadow-diff), **not** as a separate evaluation rig. Do not build a second harness.

> **1-INBOX capture**, not the active-work doc — no `## Status` table yet. On promotion to
> `PROJECT/2-WORKING/`, add the status table + per-phase QA gates and carry `gh_issue` forward.

## Key concepts
- **Tiered routing.** Needle (26M, local, ARM) answers the easy 90%; cactus's
  confidence-based cloud-handoff escalates the hard 10% to the main LLM. Same
  escalation shape already used across the XYZ/HQ ecosystem.
- **Golden-routing eval set = the real prize.** A labeled set of real Sleuth
  inputs → correct module/function route + slots. It is (a) the spike's evidence
  base, (b) a PDDA-gated regression suite any future routing change must pass —
  the actual fix for convention drift (cf. #391) — and (c) training data if a
  fine-tune is ever justified. Works even if we keep the main LLM (model-agnostic).
- **Shadow-diff, never authority.** Needle's routes run alongside the current
  router on the same inputs; log agreement/disagreement; review the diffs. Needle
  gets zero authority in Phase 0 (mirrors the P3 event-sourced shadow-diff pattern).
- **Dumb sidecar.** Needle runs behind `cactus serve` (OpenAI-compatible HTTP);
  Sleuth calls it over HTTP. Decouples "adopt the router" from "re-home to ARM."
- **Build via /relay, not solo.** Producer builds, Codex/agy reviews — a Reviewer
  turn is exactly what would have caught the #384/#391 regressions. Optional /consult
  on the core architecture decision first.

## Idea
Adopt cactus/Needle (a 26M-param ARM-native on-device tool-calling model) as Sleuth's
module/function router — the "first responder" that decides which module/tool/function
to call and extracts slots, before escalating to the main cloud LLM. Gate the whole
thing behind a Phase 0 technical spike that decides go/no-go before any real adoption.

## Why
Convention-drift incidents (#384, #391) keep costing time because routing/rendering
convention lives in prose, not an enforced artifact. This spike explores a cheap, local,
private first-responder tier whose routing behavior is defined by a labeled dataset. The
golden-routing eval set is the durable win regardless of whether Needle is adopted.

## Phase 0 — Explore & scope (go/no-go)
> Discovery phase: findings are written **back into this doc** before its QA gate can pass.

### Checklist
- [ ] **Ground it in the real router.** Identify Sleuth's routing entry point(s) and how the main
      LLM currently picks module/function + extracts slots (`src/catalog-regex-aliases.js`, command-
      route registration, `ask-reminders`). `TODO(operator)`: confirm exact files.
- [ ] **Build the golden-routing eval set** from real reminder/command traffic: input → correct
      route + slots. Target an initial N (e.g. 100–200 labeled cases).
- [ ] **Establish the main-LLM baseline** accuracy on the golden set (the number to beat).
- [ ] **Stand up Needle** on OCI Always Free Ampere A1 via `cactus serve`; capture TTFT/decode/RAM.
- [ ] **Shadow-diff harness**: run Needle + current router on the golden set (and a slice of live
      traffic), log agreement/disagreement, review disagreements.
- [ ] **Measure the handoff**: does confidence-thresholded escalation catch Needle's misses so
      end-to-end accuracy ≥ baseline?
- [ ] **Write the GO/NO-GO decision back into this doc** with the numbers.
- [ ] Set/correct triage ratings; clear `ratings_provisional` once real.

### GO gate (all must hold)
- Needle+handoff routing accuracy ≥ current main-LLM baseline on the golden set
- Local decision latency acceptable (target < ~150ms TTFT on A1)
- Sidecar RAM < ~1GB
- `cactus serve` stands up reliably on OCI A1

### NO-GO still ships value
Even on NO-GO, Phase 0 leaves behind the **golden-routing eval set as a PDDA-gated regression
suite** — the model-agnostic fix for convention drift. Nothing wasted.

### QA checklist — Phase 0
- [ ] Scope grounded in real code/history (the actual router + real traffic), not hypotheticals
- [ ] Composes with existing patterns (shadow-diff like P3; sidecar over HTTP) — no parallel authority path
- [ ] Needle has zero authority; a human GO decision remains before any Phase 1
- [ ] The golden set is committed as a reusable artifact regardless of GO/NO-GO

## Provisional downstream phases (only if Phase 0 = GO — not committed here)
- **P1** — Wire Needle as the *shadow* first tier in a real environment (still no authority),
  widen the golden set, watch live agreement over a shadow window.
- **P2** — Flip Needle to *authoritative* first tier behind a flag, with main-LLM handoff;
  stop-and-re-decide gate before this flip (per the P3 authority-flip discipline).
- **P3** — Host/prod decision (stay OCI free vs GCP Axion C4A/Tau T2A vs existing Vultr);
  optional fine-tune on the accumulated golden set if base-model accuracy is the blocker.
