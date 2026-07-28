---
title: "Proactive layer — Sleuth speaks up: stale-work nudges, deadline collisions, learned conventions"
status: Phase 1 complete (shipped 2026-07-13 via marathon lane p5); Phases 2 & 3 deferred → tracked in GH-366
created: 2026-07-10
updated: 2026-07-10
owner: noel
branch: main
doc_type: project
gh_issue: 362
source: https://github.com/NeochromeTeam/sleuth-app/issues/362
related: "#360, #361"
goal: >
  Add initiative on top of #361's memory: compute deterministic signals (gone-quiet,
  deadline-window collisions, aging-without-owner) and surface them through the existing daily
  digest, plus propose learned config edits from completion history — all propose-never-write,
  every signal citing its data, under a hard noise budget.
effort: 3
complexity: 3
risk: 2
phases: 3
---

# Proactive layer — Sleuth speaks up

## Status

| What was just completed | What's next |
|---|---|
| Issue [#362](https://github.com/NeochromeTeam/sleuth-app/issues/362) filed, grounded in the existing daily-digest scheduler; cross-linked from #361; promoted to 2-WORKING with a swarm-preflight contract + acceptance criteria. Added an end-to-end net-improvement test spec, wired as marathon lane **p6** after p5. | Marathon fired on `marathon/smart-sleuth-360-361-362-2026-07-10`, chain p1→p6 running via [marathon plan](../../marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml). |

## Table of contents

- [Phase 1 — Deterministic signals in the daily digest (no LLM)](#phase-1--deterministic-signals-in-the-daily-digest-no-llm)
- [Phase 2 — Learned-convention proposals (propose-and-confirm)](#phase-2--learned-convention-proposals-propose-and-confirm)
- [Phase 3 — Dropped-thread watch (the one new signal, the one LLM use)](#phase-3--dropped-thread-watch-the-one-new-signal-the-one-llm-use)
- [End-to-end net-improvement test (marathon lane p6)](#end-to-end-net-improvement-test-marathon-lane-p6)

## Why this issue exists

#360/#361 close the memory gap: Sleuth will stamp identity, know org conventions, and answer questions
about its own data. But every one of those behaviors is **reactive** — intelligence appears only when
asked. Humans attribute intelligence heavily to *initiative*: the system that says "this went quiet" or
"you have a deploy window Sunday and 4 open Client A items" at the right moment feels far smarter than one
that answers well on demand.

This issue is deliberately **pure read-side**: it computes signals from the memory #361 builds (stamps,
defaults, live queue, completion history) and surfaces them through the digest that already ships daily.
That's why it's cheap — the same reason `ask-reminders` got cheap when the summary pipeline died.

## Design principles (carried over from the #360/#361 consult)

1. **Noise is the death of proactive features.** A nudge system that's wrong or chatty gets muted, and
   then the *whole product* reads as dumb — worse than never nudging. Hard budget: proactive items ride
   the **existing daily digest**
   ([reminders-module.js:952](../../src/reminders-module.js#L952)) as one section, capped (e.g. 3
   items/day, most-severe first, rest silently dropped with a count). No new ad-hoc pings in v1. No new
   timers — the digest scheduler already exists.
2. **Deterministic first, LLM last.** Phases 1–2 are pure computation over authoritative data (in-memory
   queue + [completion-store.js](../../src/completion-store.js)) — no model call, no hallucination
   surface, trivially testable. The LLM appears only in Phase 3, and only to *phrase*, never to *decide*.
3. **Propose, never write.** Learned-convention proposals target the operator-owned config from #361
   Phase A — Sleuth suggests the edit with evidence; the operator confirms; only then is the file
   touched. Config-not-inference stays intact; this adds config-*from*-evidence.
4. **Every signal cites its data.** Each nudge names the task ids / completion records it derives from —
   same never-invent contract as ask-reminders.

## Phase 1 — Deterministic signals in the daily digest (no LLM)

Computed at digest time from the live queue + completion store + Phase A stamps:

- **Gone quiet:** client/project with open items but zero creations *and* zero completions in N days
  (default 14; per-client override in the defaults block). "Dab project: 2 open items, no activity in
  16 days."
- **Deadline-window collision:** open items for a client whose `DeadlineConvention` window falls within
  the next 48h. "Client A deploys Sunday 9 PM PT — 4 open items, 1 unassigned."
- **Aging without owner:** open items past M days with no assignee.
- Digest section is capped and ranked (severity ladder mirroring show-me's urgency rank); overflow
  reported as a count, never listed.
- Per-workspace kill switch + per-signal toggles (settings-module pattern, default ON for the digest
  section as a whole).

### QA gate — Phase 1 ✅ (shipped, lane p5)
- [x] Signal fires only when the deterministic predicate holds (unit-testable with a synthetic
      queue/store — no mocks of AI).
- [x] Digest with zero signals renders no proactive section (no "nothing to report" noise).
- [x] Cap respected: 5 eligible signals → 3 shown + "and 2 more".

## Phase 2 — Learned-convention proposals (propose-and-confirm)

Mine the completion history for stable patterns and propose config edits — the self-updating-memory
loop, kept operator-gated:

- **Assignee pattern:** completer concentration over the last K completions per client (e.g. Mike ≥ 8/10
  Client A) *and* differs from current `DefaultAssigneeID` (or none set) → propose: "Mike completed 9 of
  the last 10 Client A tasks — set him as DefaultAssigneeID? [yes/no]". Evidence lists the completion
  records.
- **Cadence pattern:** completion timestamps clustering in a weekly window (e.g. Sun 20:00–22:00 PT)
  with no `DeadlineConvention` set → propose the window.
- Confirm applies the edit to `client-channel-mapping.json` via a serialized write (completion-store
  idiom); decline suppresses that proposal for L weeks (persisted, so it doesn't nag).
- Proposals ride the same digest section, count against the same cap, and are rate-limited to
  1/client/week.

### QA gate — Phase 2 ⏳ (DEFERRED → GH-366, in progress)
- [ ] Below-threshold concentration (e.g. 6/10) proposes nothing.
- [ ] Declined proposal does not reappear within the suppression window.
- [ ] Confirmed proposal round-trips: next #360 extraction in that client resolves the new default.

## Phase 3 — Dropped-thread watch (the one new signal, the one LLM use)

The only phase that captures a new signal rather than reading existing memory — sequenced last
deliberately:

- When message analysis (which already runs on every message) sees a direct question in a client channel
  that is neither answered in-thread nor followed by a reminder within T hours, record a lightweight
  open-question entry (channel, thread ts, asker, question text — reuse the thread-memory persistence
  idiom).
- Digest surfaces: "Elan asked about Silverpeak locations 2 days ago — no reply, no task." One tap
  converts it to a reminder via the existing `#TryScheduleRemindersAsync` gateway (or dismisses it).
- LLM (Complex tier, strict schema) is used only to classify question-ness/answered-ness at digest time
  over the candidate set — never free-running on every message; deterministic prefilters (question mark,
  mention, no thread replies) gate what reaches the model.
- Same cap, same kill switch; entries expire after E days unanswered-and-undismissed.

### QA gate — Phase 3 ⏳ (DEFERRED → GH-366, in progress)
- [ ] Answered-in-thread question never surfaces.
- [ ] Question that became a reminder never surfaces (dedupe via thread ts against the queue).
- [ ] One-tap convert creates the reminder through the FSM gateway with client stamp intact.

## Explicitly out of scope (v1)

- Real-time interruptions/pings outside the digest (earn trust first; revisit with evidence from digest
  engagement).
- Any writing of config without operator confirmation.
- New always-on LLM calls per message (Phase 3's model use is digest-time, prefiltered, batched).

## Acceptance criteria

- [x] Digest carries a capped (≤3/day, ranked), citation-bearing proactive section computed
      deterministically from the live queue + completion store; renders nothing when empty; kill switch +
      per-signal toggles. *(Phase 1, shipped p5)*
- [ ] Learned-convention proposals mine completion history above a concentration threshold, propose
      config edits with evidence, apply only on confirm, and suppress declines for a persisted window.
      *(Phase 2 — DEFERRED → GH-366)*
- [ ] Dropped-thread watch prefilters deterministically, uses the LLM only at digest time to classify,
      dedupes against the queue, and one-tap converts through the FSM gateway with the client stamp
      intact. *(Phase 3 — DEFERRED → GH-366)*
- [x] Full test suite green (`npm test`). *(1285 jest + 30 node at marathon.complete)*

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "main" },
  "gate":        "npx jest reminders-module completion connection-surfacing --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/reminders-module.js", "pattern": "ProactiveDigestSignals" }
  ],
  "artifacts":   [
    "src/reminders-module.js",
    "src/completion-store.js",
    "src/connection-surfacing.js",
    "tests/reminders-module.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "Phases 1–3 of GH-362" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

## Sequencing

After #361 A+B ship and soak briefly (the signals need stamped data and a couple weeks of completion
history to be non-trivial). Phase 1 → 2 → 3, each independently shippable; #360 is not a dependency,
but its confirmed tasks enrich the same memory these signals read. Runs as marathon lane **p5** in
[marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml](../../marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml),
followed by lane **p6** below.

## End-to-end net-improvement test (marathon lane p6)

Every phase above gates on its own `npm test` slice in isolation. None of those gates prove the chain
actually *connects* — that data one phase persists is the data a later phase reads, not just that each
phase's code exists. This section is the spec for that proof; it runs as marathon lane **p6**, the
final lane in
[MARATHON.yaml](../../marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml), depends on p5, and is
gated by the same `npm test` the whole marathon already runs after every phase.

### Why this is a separate gate, not folded into p5

The operator's original complaint was that Sleuth computes valuable data — client/project groupings,
task relationships, event history — and discards it instead of persisting/analyzing/connecting it. A
green suite of five independently-mocked phase tests cannot distinguish "connected" from
"coincidentally adjacent" — each phase's own tests mock its neighbors' outputs. This test instead
drives the real modules together, end to end, so a broken hand-off (e.g. p4's project map never
actually consulted by p2's ask-reminders) fails loudly instead of shipping silently.

### Definition of "net effective improvement" (what this test proves)

A single synthetic scenario is run through the connected pipeline. The delta against what the
pre-marathon code path could do — not the presence of new code — is the proof:

| Step | Pre-marathon | Post-marathon (asserted) |
|---|---|---|
| Reminder created in a known client channel | no client/project stamp | `clientId`/`projectId` stamped on the event + object (p1) |
| Scattered thread about that client | one reminder per "above" message, no reconciliation | N proposed tasks, correctly split, inheriting the client stamp (p3/#360) |
| Second reminder for the same project | `show-me-projects` re-asks the LLM every time | durable map resolves it with **zero** LLM calls (p4) |
| Operator asks "what's open for `<client>`?" | no such surface exists | `ask-reminders` answers, citing the real ids created above (p2) |
| Time advances past the client's deadline window with an unassigned item | nothing surfaces | digest emits an "aging without owner" / "deadline-window collision" signal citing the same task ids (p5) |

If any row's post-marathon column doesn't hold, the chain hasn't actually connected — regardless of
each phase's own green tests.

### Test shape (Jest, offline leg)

New file: `tests/marathon-360-361-362-e2e.test.js`. Follows the `tests/reminders-integration.test.js`
precedent — real modules driven against temp runtime files, Slack and the LLM boundary mocked via the
existing `tests/mocks/mock-slack-app.js` and `tests/mocks/mock-workspace-ai.js` (script deterministic
Complex-tier responses for the thread-inference and project-grouping calls only; every other assertion
is against real, unmocked module output).

Scenario fixture: one synthetic client ("Northwind Test") in a temp `client-channel-mapping.json`, a
temp workspace event-store dir, and a 4-message scattered Slack thread fixture (mirrors the
Client A/Silverpeak example already used in #360's QA gate).

Scripted steps, each asserting against the previous step's real output (not a fresh fixture):
1. Seed the client mapping + `Defaults` block; create one reminder via the real creation path; assert
   the stamped event (`event-store.readAll`) and object carry `clientId`.
2. Feed the scattered thread through the real thread-inference path; assert N proposed tasks, each
   carrying the same `clientId`, with no invented/dropped text (byte-check against the fixture).
3. Call `show-me-projects` twice for the same project; assert the mock LLM's grouping call is invoked
   on the first call only — the second call must resolve from the durable map with zero LLM calls
   (instrument the mock's call count).
4. Invoke `ask-reminders` with a query naming the client; assert the answer cites the exact ids created
   in steps 1–2 (string/id containment, not fuzzy match).
5. Advance the fixture clock past the deadline window (or age an item past the no-owner threshold);
   run the digest signal pass; assert a signal fires citing the same ids, and that the digest section
   is absent before that point (zero-signal-renders-nothing, per #362 Phase 1's own QA gate).

### Live-connector leg (manual, not part of the automated gate)

One optional companion leg, reusing the dry-run/`--execute` harness convention already established for
`P2-SNAPSHOT-SLACK-RELAY.md`'s live test (`scripts/slack-harness-post.js`): post the same scattered
thread into a real Slack test channel and drive step 2 against real Slack API message shapes instead
of fixture JSON, to catch anything the fixture's shape hides. This stays manual/gated — it is not
wired into `npm test` or the marathon gate, the same way the existing harness scripts keep live
network calls behind `--execute`.

### Status

This spec is intentionally **red** as written — `GetClientDefaults`, the whole-thread collector,
`ask-reminders`, the durable project map, and the digest signals don't exist until p1–p5 land. Lane
p6's job is to materialize this spec into `tests/marathon-360-361-362-e2e.test.js` against whatever the
actual p1–p5 APIs turn out to be (the brief pins exact names/paths; the builder adapts to real
signatures if a phase's implementation deviates), then let the standard `npm test` gate run it.
`marathon.complete` should not be read as "Sleuth is smarter" until this lane is green — the five
phase gates prove code shipped; this lane proves it connected.
