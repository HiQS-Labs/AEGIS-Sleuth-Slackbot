---
title: Myriad — Week of 2026-07-06
status: Active (weekly myriad parking lot)
created: 2026-07-07
updated: 2026-07-09
owner: octo-dev
goal: >-
  Park non-critical follow-up items from end-of-day agent triage in one
  durable weekly backlog.
doc_type: backlog
roadmap_exempt: true
---

# Myriad — Week of 2026-07-06

## Status

| What was just completed | What's next |
|---|---|
| GH-338/348/349/351/352 docs reconciled to `3-COMPLETED` (2026-07-10) — closes two items below (dead-refs partially addressed via PDDA reinstall; P2/P3-doc-move and changelog-check items still open). | Move `P3-PHASE-2-CLOUD-TASK.md` → `3-COMPLETED`, and `P2-SNAPSHOT-SLACK-RELAY.md` → `3-COMPLETED` once the final live `/snapshot` test lands; investigate the GH-351 marathon thrash; tune the changelog-check false positive. |

### 2026-07-07
- [x] Investigate why the GH-351 flaky-port-test lane thrashed through 5 marathon attempts with repeated containment-violations — the lane meant to fix a flaky test is itself unstable. — Root-caused 2026-07-09: `agy-turn.sh`'s isolation-breach check (`GH-178 B1`) greps agy's own transcript for the real repo-root path and hard-fails if found, but agy's Antigravity narration style always mentions the real path as normal prose (markdown links, backtick-quoted paths) — a false positive, not an actual containment violation. Confirmed via byte-for-byte diff against upstream `xyz-3-agents-swarm` that this is a genuine upstream bug, not vendor drift. Fixed locally (vendored `.xyz/` only, gitignored) by downgrading the check from a hard `exit 5` to a non-blocking warning; the real containment enforcement (`rtl_worktree_end`'s git-diff-based off-lane detection) was passing correctly on every attempt.
- [x] Resolve the open §12 (Important Configuration) field-list placement decision in GH-352 before that lane can cleanly land. — Resolved: required/optional workspace field tables removed (owned by `src/workspaces.js`), kept only the Process Environment Flags subsection. Shipped 2026-07-09.
- [ ] Route GH-348 (Blend philosophy) through human review of the reconciliation diff rather than autonomous auto-merge — it is judgment-heavy. — **Not followed**: GH-348 shipped 2026-07-09 via full marathon automation (codex builder + agy reviewer), not a human-reviewed diff. Flagging as still-open in case the reconciliation content warrants a retroactive human read.
- [ ] Fix the 12 PDDA governance dead-refs in PROJECT/PDDA.md and utils/pdda/PDDA-INSTALL.md (RECAP.md, REAL-AGENT-OBSERVATIONS.md, stale PDDA_* env vars). — Still open; `pdda.sh run` on 2026-07-09 shows 10 remaining governance WARNs (dead refs in ROUTER.md/PDDA-INSTALL.md + 3 stale `PDDA_*` env var mentions).
- [x] Move self-declared-historical docs out of 2-WORKING: P3-PHASE-2-CLOUD-TASK.md → 3-COMPLETED, and P2-SNAPSHOT-SLACK-RELAY.md → 3-COMPLETED after the final live /snapshot test. — `P3-PHASE-2-CLOUD-TASK.md` moved to `3-COMPLETED` (commit `938cfc5`). `P2-SNAPSHOT-SLACK-RELAY.md` correctly still in `2-WORKING` — the live `/snapshot` test gating its move hasn't happened yet.
- [ ] Tune or suppress the PDDA changelog check — it warns 'no dated entry' even though 1.4.211 is correctly dated at the top (false positive). — Re-diagnosed 2026-07-09: not quite a false positive. `check_changelog`'s regex requires `## [x.y.z] - YYYY-MM-DD` (bracketed version) or a bare `## YYYY-MM-DD`; this repo's convention is unbracketed (`## 1.4.211 - 2026-07-06`), which the regex rejects. It's WARN-only and non-blocking (PDDA runs in report-only mode), so no doc accuracy is at risk — but the check and the repo's actual convention disagree. Needs a human call: change the convention to add brackets, or loosen the regex to accept the existing format.
