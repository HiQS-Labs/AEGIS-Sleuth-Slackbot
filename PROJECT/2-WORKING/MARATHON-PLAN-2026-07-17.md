---
title: Marathon Plan — startup CI-results poll (GH-418)
status: OPEN — 1 candidate, not yet fired
created: 2026-07-17
roadmap_exempt: true
updated: 2026-07-17
owner: noel
branch: development
doc_type: project
source: operator ask, filed during boot-message QA (v1.4.238)
generated_by: hand-authored (single-candidate plan)
goal: >
  One small, low-risk candidate (GH-418) is marathon-ready with a preflight contract: the startup
  GitHub Actions follow-up reports "in_progress" instead of real test results because it only checks
  once, 4 seconds after boot. This plan tracks that single lane until it's fired or superseded by a
  larger batch.
---

# Marathon Plan 2026-07-17 — startup CI-results poll

> Single-candidate plan, not derived from a full ROADMAP/issue sweep (cf.
> `PROJECT/3-COMPLETED/MARATHON-PLAN-2026-07-17.md`, the prior 10-day-triage batch, already shipped
> in full). Add further candidates here as they're triaged, rather than opening a new dated file,
> until this one is fired or closed out.

## Status

| What was just completed | What's next |
|---|---|
| GH-418 filed and promoted to `2-WORKING` with a preflight contract (2026-07-17), during operator QA of the startup-message changelog-leak fix (v1.4.238). `swarm-preflight --gh-issue 418 --dry-run` verdicts **ready (exit 0)**. Not yet fired. | Fire as a solo lane (no collision — touches only `src/github-actions-startup-summary.js` + its test; `src/app.js` is orchestrator-only per the contract) — operator decides when, per GUIDING-PRINCIPLES.md §8. |

## Collision map

| Zone | Parallel-safe? | Active items here |
|---|---|---|
| independent | ✅ solo lane, no concurrent candidates in this plan | #418 (`src/github-actions-startup-summary.js`) |

## Per-item scoring

| Item | effort | complexity | risk | artifacts | wave |
|---|---|---|---|---|---|
| #418 startup CI-results poll | 2 | 2 | 1 | `src/github-actions-startup-summary.js`, `tests/github-actions-startup-summary.test.js` (agy-safe); `src/app.js` (orchestrator-only) | 1 |

## Recommended wave

**Wave 1** (solo — no concurrent lanes in this plan):
- #418 → `swarm-preflight --gh-issue 418` → `suggested_branch: marathon/gh-418-startup-ci-results-poll-2026-07-17`

## How to fire the lane

```
.xyz/utils/swarm-preflight.sh --gh-issue 418              # emits ready packet
.xyz/relay-automation/marathon-drive.sh --phase-brief <packet>/packet.md ...
```

Artifact scoping matches the "Per-item scoring" table above — see
[GH-418-STARTUP-CI-RESULTS-POLL.md](GH-418-STARTUP-CI-RESULTS-POLL.md)'s Swarm Preflight Contract for
the exact gate/artifacts/lanes.

---

*Hand-authored 2026-07-17 as a single-candidate plan; not yet preflighted or fired.*
