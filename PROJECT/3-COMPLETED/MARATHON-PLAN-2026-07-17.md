---
title: Marathon Plan — 10-day GH-issue triage, collision-aware queue
status: COMPLETE — all 5 lanes shipped 2026-07-17 in v1.4.235
created: 2026-07-17
roadmap_exempt: true
updated: 2026-07-17
owner: noel
branch: development
doc_type: project
source: GH issue triage (issues #358-#407, opened 2026-07-07..2026-07-17)
generated_by: hand-authored during /marathon-triage run
goal: >
  26 GitHub issues opened in the last 10 days were reconciled against CHANGELOG.md, git log, and
  existing PROJECT/** docs. 19 were already shipped, deferred-by-design, or not real work items
  (see Held/Excluded below). 5 pass valid + reproducible + not-completed and now carry a preflight
  contract. This plan sequences those 5 into collision-safe waves.
---

# Marathon Plan 2026-07-17 — 10-day GH triage

> Derived from a full read of every issue opened 2026-07-07..2026-07-17, not from the ROADMAP ledger.
> Each candidate below has an in-repo `GH-<n>-*.md` capture doc + preflight contract in
> `PROJECT/2-WORKING/`; all 5 preflighted `ready` via `.xyz/utils/swarm-preflight.sh --gh-issue <n>
> --dry-run` on 2026-07-17 (development @ f8eb552d1).

## Status

| What was just completed | What's next |
|---|---|
| All 5 lanes (#365, #366 P2.2, #367, #393, #399) built independently in isolated worktrees, tested green, merged to `development`, and shipped in **v1.4.235 (2026-07-17)**. #365/#367/#393/#399 closed and docs moved to `PROJECT/3-COMPLETED/`; #366 stays open in `2-WORKING` (only P2.2 of its 4 phases is done). Two side-findings filed as new issues (**#410**, **#411**), not fixed here. | Nothing — this plan is done. #366's remaining phases (P2.3/P2.4/Phase 3) need a fresh preflight contract before they're marathon-ready; not carried by this plan. |

## The one safety rule

Two lanes are safe to run concurrently **iff their write-sets are disjoint**. Originally thought
#367 and #393 collided on `src/reminder-query-engine.js` — corrected: #367's real scope is
`src/client-mapping.js`, which is independent of every other lane in this batch.

## Collision map

| Zone | Parallel-safe? | Active items here |
|---|---|---|
| independent | ✅ one lane per file | #365 (`data/static/ai/command-catalog.json`), #366 (`src/learned-conventions.js`), #399 (`src/reminders-app-mention-handler.js`), #393 (`src/reminder-query-engine.js`), #367 (`src/client-mapping.js`) |

## Per-item scoring

| Item | effort | complexity | risk | artifacts | wave |
|---|---|---|---|---|---|
| #365 command-catalog gap | 1 | 1 | 1 | `data/static/ai/command-catalog.json` | 1 |
| #366 proactive P2.2 suppression store | 3 | 3 | 2 | `src/learned-conventions.js` (+new suppression-store module) | 1 |
| #399 candidate-title guard | 1 | 1 | 2 | `src/reminders-app-mention-handler.js` | 1 |
| #393 NaN timestamp filter | 1 | 1 | 1 | `src/reminder-query-engine.js` | 1 |
| #367 ambiguous-client test (QA-gate close-out) | 1 | 1 | 1 | `src/reminder-query-engine.js` (test-only) | 2 (after #393) |

## Recommended waves

**Wave 1** (fire concurrently — disjoint write-sets):
- #365 → `swarm-preflight --gh-issue 365` → `suggested_branch: marathon/gh-365-command-catalog-gap-2026-07-17`
- #366 → `swarm-preflight --gh-issue 366` → `suggested_branch: marathon/gh-366-proactive-phases-2-3-2026-07-17`
- #399 → `swarm-preflight --gh-issue 399` → `suggested_branch: marathon/gh-399-candidate-title-guard-2026-07-17`
- #393 → `swarm-preflight --gh-issue 393` → `suggested_branch: marathon/gh-393-nan-timestamp-filter-2026-07-17`

**Wave 2** (after #393 merges/lands — same file):
- #367 → `swarm-preflight --gh-issue 367` → `suggested_branch: marathon/gh-367-richer-reminder-queries-2026-07-17`

## Held / excluded — reconciled but not marathon-ready

### ✅ Already shipped — verify-and-close, not a build lane
- #358, #360, #361, #362, #373, #374, #378, #380, #383, #387, #388, #391, #395, #396, #397 — confirmed
  landed via CHANGELOG.md / git log during this triage. Propose closing each with a comment pointing
  at the shipping commit/version; #373/#374 explicitly say to close alongside #378.

### 🗒️ Explicitly deferred / not actionable now
- #369 (multi-tenant client-mapping debt) — issue itself says "no action needed, filed so it isn't
  forgotten," deferred until a 2nd workspace needs it.
- #392 (Needle router spike) — explicitly deferred, gated on #397's outcome (which has since shipped —
  the gate condition is resolved, but re-opening #392 is a fresh decision, not automatic).
- #403 (Cloudflare hosting exploration), #404 (context-caching fine-tuning) — research/decision docs,
  no code change requested yet.
- #407 (Slack confirmation bug-reaction) — no clear defect stated; looks like a correct confirmation
  message reacted by mistake.

## How to fire a lane

```
.xyz/utils/swarm-preflight.sh --gh-issue <n>              # emits ready packet
.xyz/relay-automation/marathon-drive.sh --phase-brief <packet>/packet.md ...
```

Per-lane `--artifact` scoping matches the "Per-item scoring" table above — see each `GH-<n>-*.md`
doc's Swarm Preflight Contract for the exact gate/artifacts/lanes.

---

*Hand-authored from a direct GH-issue triage (not the ROADMAP ledger) on 2026-07-17.*
