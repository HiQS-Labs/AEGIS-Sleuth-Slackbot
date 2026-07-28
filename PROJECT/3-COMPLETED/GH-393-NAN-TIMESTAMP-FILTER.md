---
title: "ask-reminders: NaN completion timestamp bypasses the time-window filter"
status: Active (2-WORKING)
created: 2026-07-16
updated: 2026-07-17
owner: noel
branch: development
doc_type: project
gh_issue: 393
source: https://github.com/NeochromeTeam/sleuth-app/issues/393
related: "#391 (reminder-render primitive — where this was surfaced by /consult), #367 (query engine)"
effort: 1
complexity: 1
risk: 1
phases: 1
---

# GH-393 — NaN completion timestamp bypasses the time-window filter

`FilterCandidates` in [src/reminder-query-engine.js:179](../../src/reminder-query-engine.js#L179)
guards the time window with `typeof Ts !== 'number'`. Since `typeof NaN === 'number'`, a candidate
whose `timestampMs` is `NaN` slips past the guard (`NaN < startMs` and `NaN >= endMs` both evaluate
`false`). `AssembleCandidates` (`src/reminder-candidates.js`) emits `timestampMs: NaN` for a
completion whose `completedMs` is missing/non-numeric — the same malformed-record case
`RenderCitedCandidates` already defends against with `Number.isFinite`. Net effect: a completion
with a bad `completedMs` is incorrectly included in every time-scoped query (e.g. "what was
completed last week for X?" wrongly returns items with no valid completion time).

Pre-existing bug in the query core, not introduced by GH-391. Found during the GH-391 cross-model
`/consult` (transcripts under `relay-system/2026-07-16/gh391-qa-075133/`).

## Phase 1 — tighten the time-window predicate
- [x] `src/reminder-query-engine.js` `FilterCandidates`: change the guard to
      `if (typeof Ts !== 'number' || !Number.isFinite(Ts) || Ts < startMs || Ts >= endMs) return false;`
- [x] Add a regression test in `tests/reminder-query-engine.test.js`: a completed candidate with
      `timestampMs: NaN` must be excluded from a time-scoped query.

### QA gate
- [x] New regression test fails on the old guard, passes on the fixed guard.
- [x] Full `reminder-query-engine` suite still green.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest reminder-query-engine --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/reminder-query-engine.js", "pattern": "Number.isFinite(Ts)" }
  ],
  "artifacts":   [
    "src/reminder-query-engine.js",
    "tests/reminder-query-engine.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-393 Phase 1 — reject non-finite timestamps in FilterCandidates" },
  "lanes":       { "agy_safe": [ "src/reminder-query-engine.js", "tests/reminder-query-engine.test.js" ], "orchestrator_only": [] }
}
```

## Progress log
- 2026-07-16: filed as #393 during the GH-391 /consult review; capture doc + contract authored
  during 10-day GH triage.
- 2026-07-17: Phase 1 shipped on `marathon/gh-393-nan-timestamp-filter-2026-07-17` (commit d1b5437)
  — guard now rejects non-finite timestamps; new regression test + full suite green (17 passed).
