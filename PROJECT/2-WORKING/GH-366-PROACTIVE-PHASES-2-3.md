---
title: "Proactive layer Phases 2 & 3 — learned-convention proposals + dropped-thread watch"
status: Active (2-WORKING) — building (P2.1, P2.2 shipped; P2.3/P2.4/Phase 3 remaining)
created: 2026-07-14
updated: 2026-07-17
owner: noel
branch: development
doc_type: project
gh_issue: 366
source: https://github.com/NeochromeTeam/sleuth-app/issues/366
related: "#362 (Phase 1 shipped p5), #360, #361"
effort: 3
complexity: 3
risk: 2
phases: 2
goal: >
  Ship the two deferred GH-362 phases without breaking the noise budget: propose-and-confirm
  learned-convention proposals (P2, no LLM) and dropped-thread watch (P3, one bounded LLM use at
  digest time) — both riding the existing ≤3/day proactive digest section.
---

# GH-366 — Proactive layer Phases 2 & 3

## Status

| What was just completed | What's next |
|---|---|
| P2.1 (deterministic proposal core) + P2.2 (suppression + rate-limit store) shipped 2026-07-17, merged to `development` in v1.4.235. 24/24 tests green. | P2.3 (digest wiring) — needs its own preflight contract before it can be marathon'd. P2.4 (confirm/decline actions) and Phase 3 (dropped-thread watch) remain after that. |

Deferred remainder of [GH-362](../3-COMPLETED/GH-362-PROACTIVE-LAYER.md). Phase 1 (deterministic
digest signals) shipped 2026-07-13 as marathon lane p5. This doc drives the two deferred phases.
Both ride the **existing** daily-digest proactive section (`reminders-module.js`, ≤3 items/day cap,
severity-ranked) — no new timers, no new always-on LLM calls.

## Integration points (Phase 1 gave us these)
- `reminders-module.js#GetProactiveDigestSettings()` + `#PROACTIVE_*` consts (~L2207) — the digest
  section, cap, severity ladder, per-signal env toggles.
- `completion-store.js` — `GetCompletedBetween(start,end)`, `CompletionRecord` (`assigneeID`,
  `completedMs`, `clientId`, `reminderId`, `summary`).
- `client-mapping.js` — `GetClientDefaults(clientId)`, config `data/static/client-channel-mapping.json`
  (`Defaults: { DefaultAssigneeID, DeadlineConvention }`).

## Phase 2 — Learned-convention proposals (propose-and-confirm, NO LLM)

**Design note:** the durable completion field is `assigneeID` (not a separate "completedBy"). We
mine **assignee concentration** among a client's completed tasks — the faithful, shippable reading
of the #362 "completer concentration" idea, and it feeds `DefaultAssigneeID` directly. (A true
completer field would be a CompletionRecord schema change; out of scope here, noted for later.)

- [x] **P2.1 — deterministic core (pure, testable).** `src/learned-conventions.js`:
  `ComputeAssigneeConventionProposal(completions, opts)` and `ComputeCadenceConventionProposal(...)`.
  Pure folds over `CompletionRecord[]`; decide *whether* a proposal is warranted + build evidence;
  no I/O, no writes. Unit tests in `tests/learned-conventions.test.js`. **← this increment.**
- [x] **P2.2 — suppression + rate-limit store.** `src/learned-convention-suppression-store.js`
      (`LearnedConventionSuppressionStore`): `RecordDecline`/`IsSuppressed` (per client+kind, 4-week
      window) and `RecordProposalSurfaced`/`IsRateLimited` (1/client/week, any kind); mirrors
      `completion-store.js`'s serialized-write idiom exactly. Pure JSON I/O, no LLM/Slack calls. 14
      unit tests in `tests/learned-convention-suppression-store.test.js`.
- [ ] **P2.3 — digest wiring.** Emit proposals into the existing proactive section under the shared
      ≤3/day cap; each cites its completion records.
- [ ] **P2.4 — confirm/decline actions.** Confirm applies the edit to `client-channel-mapping.json`
      (serialized write) via `client-mapping` helper; decline records suppression.

### QA gate — Phase 2
- [ ] Below-threshold concentration (e.g. 6/10) proposes nothing. *(covered by P2.1 tests)*
- [x] Declined proposal does not reappear within the suppression window. *(P2.2, unit-tested)*
- [ ] Confirmed proposal round-trips: next #360 extraction in that client resolves the new default. *(P2.4)*

## Phase 3 — Dropped-thread watch (the one new signal, the one LLM use)

- [ ] **P3.1 — open-question capture (deterministic prefilter).** On message analysis, when a
      client-channel message is a question (?, mention) with no in-thread reply and no reminder within
      T hours, record a lightweight open-question entry (reuse thread-memory persistence idiom).
- [ ] **P3.2 — digest-time LLM classify (Complex tier, strict schema).** Over the candidate set only,
      classify question-ness/answered-ness; never per-message free-running.
- [ ] **P3.3 — surface + one-tap convert/dismiss.** Digest lists it; convert routes through
      `#TryScheduleRemindersAsync` with the client stamp; dedupe via thread ts against the queue;
      entries expire after E days.

### QA gate — Phase 3
- [ ] Answered-in-thread question never surfaces.
- [ ] Question that became a reminder never surfaces (dedupe via thread ts).
- [ ] One-tap convert creates the reminder through the FSM gateway with client stamp intact.

## Constraints (from #362)
Noise budget hard (≤3/day, ride the digest); propose-never-write for config; deterministic-first
(P2 no LLM; P3 LLM only phrases/classifies at digest time); every signal cites its data; `npm test` green.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest learned-conventions --forceExit",
  "fix_probes":  [
    { "type": "path_absent", "path": "src/learned-convention-suppression-store.js" }
  ],
  "artifacts":   [
    "src/learned-conventions.js",
    "tests/learned-conventions.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-366 Phase 2 lane P2.2 — suppression + rate-limit store" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

> Note: `artifacts[]` lists existing anchor files at the ref; the **new** suppression-store module
> (`src/learned-convention-suppression-store.js`, name TBD by the implementing lane) is the actual
> P2.2 deliverable and is what the `path_absent` fix probe checks for. P2.1 (deterministic proposal
> core) is already shipped — this contract scopes P2.2 only, not P2.3/P2.4/Phase 3.

## Progress log
- 2026-07-14: doc hygiene closed (#362/#360/#361 → 3-COMPLETED), issue #366 filed, branch cut from
  `development`. Started P2.1 — deterministic proposal core + unit tests.
- 2026-07-16: promoted to 2-WORKING, preflight contract authored (scoped to P2.2) during 10-day GH
  triage.
- 2026-07-17: P2.2 done — `learned-convention-suppression-store.js` (declined-proposal suppression +
  1/client/week rate limit, completion-store-style serialized writes), 14 unit tests, `npm test` green
  aside from the known pre-existing sandbox-only `listen EPERM` false-fails in the 3 web-api suites.
  Merged to `development` from `marathon/gh-366-proactive-phases-2-3-2026-07-17`. P2.3/P2.4/Phase 3
  remain unbuilt.
