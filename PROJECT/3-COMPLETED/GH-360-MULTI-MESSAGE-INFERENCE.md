---
title: "Multi-message inference improvement — reconcile a scattered thread into N proposed tasks"
status: Complete (3-COMPLETED) — shipped 2026-07-13 via marathon lane p3 (smart-sleuth-360-361-362); e2e lane p6 green
created: 2026-07-10
updated: 2026-07-10
owner: noel
branch: main
doc_type: project
gh_issue: 360
source: https://github.com/NeochromeTeam/sleuth-app/issues/360
related: "#361, #337, #339"
consult: relay-system/2026-07-10/smart-plan-360-361-131306/ (Codex gpt-5.4 + agy, reconciled)
model: Complex tier (WorkspaceAI.ComplexModelName) — same as show-me-projects
goal: >
  Extend the "above" family from single-message task inference to whole-thread, multi-task
  reconciliation: read a scattered multi-party Slack thread and propose N distinct tasks, each
  with a resolved assignee and concrete deadline (from operator defaults), behind a
  propose-and-confirm surface — never auto-emitted.
effort: 3
complexity: 4
risk: 2
phases: 3
---

# Multi-message inference — reconcile a scattered thread into N proposed tasks

## Status

| What was just completed | What's next |
|---|---|
| Issue [#360](https://github.com/NeochromeTeam/sleuth-app/issues/360) filed; cross-model consult adjudicated (Complex-tier, propose-and-confirm, whole-thread collection, defaults from operator config + live data) and folded in; promoted to 2-WORKING with a swarm-preflight contract + acceptance criteria. | Runs as marathon lane **p3**, after #361 Phase A (operator defaults) + Phase B (live-data injection). Fire via the [marathon plan](../../marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml). Awaiting operator go. |

## Table of contents

- [Phase 1 — Whole-thread → N candidate tasks (structured, verbatim-safe)](#phase-1--whole-thread--n-candidate-tasks-structured-verbatim-safe)
- [Phase 2 — Assignee + deadline from operator defaults + live data, editable](#phase-2--assignee--deadline-from-operator-defaults--live-data-editable)
- [Phase 3 — Propose-and-confirm surface](#phase-3--propose-and-confirm-surface)

## Problem

Today the "above" family infers a task from **one** message, or enriches a single vague pronoun with
up to the last 3 preceding messages:

- `create-reminder-from-task-above` — regex
  [reminders-app-mention-handler.js:325](../../src/reminders-app-mention-handler.js#L325), handler
  `#HandleCreateReminderFromTaskAboveAsync` at
  [L757](../../src/reminders-app-mention-handler.js#L757): turns the *single* human message above into
  a reminder.
- `create-reminder-from-task-above-shorthand` — "do the above"
  ([L24](../../src/reminders-app-mention-handler.js#L24)).
- `TryEnrichVagueCompletionFromAboveAsync` —
  [L210](../../src/reminders-app-mention-handler.js#L210): pulls up to the last **3** preceding human
  messages (`#CollectPrecedingHumanThreadMessagesAsync`
  [L690](../../src/reminders-app-mention-handler.js#L690)) to resolve a vague pronoun into one task.

None of these do what a real multi-party thread actually requires: read a **scattered** back-and-forth
and reconcile it into **N distinct tasks**, with a resolved assignee and a concrete deadline.

## Motivating example (real thread — `clients-1-client-a-devops`)

Elan's asks were spread across ~10 messages ("Did we delete the Silverpeak locations from the map?",
"We had all", "And The Dab", two Drive links, "@noel.saw / For next week"). A human (noel) collapsed
them into one clean, assigned, dated instruction:

> @Mike please on "ClientATHC.com" — three things — 1.) delete Silverpeak location(s) from map
> 2.) add new locations and 3.) add locations for images from Google Drive — on Sunday night at 9 PM PT

### What is inferable from the text alone
- **Task 1 (remove Silverpeak from map):** an unanswered question ("Did we delete…?") → an imperative.
  Directly inferable.
- **Task 3 (ingest Drive images/addresses):** assets delivered + person tagged + timeframe → a task.
  Inferable.

### What is NOT inferable from the text alone
- **Task 2 (add new locations):** the real source is the **contents of the linked Drive folder**,
  which the text never states. Needs the connector, not just the transcript.
- **Assignee = @Mike:** Elan tagged *noel*; noel re-routed to Mike. That's an org/role fact
  (#361 Phase A defaults), not in the thread.
- **Deadline = Sunday 9 PM PT:** Elan said only "For next week." The concrete slot is noel's deploy
  convention (#361 Phase A `DeadlineConvention`).

## Design decisions (locked)

1. **Model tier: Complex.** Whole-thread reconciliation runs on `WorkspaceAI.ComplexModelName`
   ([workspace-ai.js:292](../../src/workspace-ai.js#L292)) — like `show-me-projects` — inheriting the
   per-workspace `switch-models:complex` toggle. No new model plumbing.
2. **Standing context from config + live data, not synthesized summaries** *(per consult)*. The prompt
   is composed with (a) the **per-client operator defaults** from #361 Phase A and (b) **live open
   reminders + completion history** for the resolved client (#361 Phase B path) for dedupe/context. No
   dependency on any pre-synthesized summary pipeline.
3. **Propose, never auto-emit.** Extraction is safe to automate; assignee + deadline are judgment calls
   rendered as editable fields with confident defaults.
4. **Structured, verbatim-safe output.** Reuse the
   [show-me-projects](../../src/chat-commands/show-me-projects-command.js) pattern — strict schema,
   every candidate maps back to source message ids, deterministic text from stored data,
   Ungrouped-style completeness guard.

## Phase 1 — Whole-thread → N candidate tasks (structured, verbatim-safe)

- New whole-thread collection helper — `#CollectPrecedingHumanThreadMessagesAsync`'s hardcoded
  3-message cap ([reminders-app-mention-handler.js:690](../../src/reminders-app-mention-handler.js#L690))
  is a vague-pronoun heuristic, not a base to extend; the new path captures the complete thread
  (flagged by both consult advisors).
- Analyze the full thread into an ordered candidate-task list, on the Complex model.
- Strict schema; every candidate maps back to source message id(s); never invent or drop text.
- Per-task confidence; low-confidence candidates flagged, not dropped.

### QA gate — Phase 1
- [x] Client A thread yields Task 1 and Task 3 as high-confidence; Task 2 flagged low-confidence with a
      "needs linked-asset context" note.
- [x] No candidate contains text absent from the thread.
- [x] `switch-models:complex` change is respected on the next extraction (no restart).

## Phase 2 — Assignee + deadline from operator defaults + live data, editable

- Prompt composed with the per-client operator defaults (#361 Phase A) + live open reminders/completions
  for the client (#361 Phase B path) as context.
- Assignee default from `DefaultAssigneeID`, overridable; falls back to the tagged user.
- Vague timeframe ("next week") → concrete slot from `DeadlineConvention` when set, overridable;
  otherwise left blank, never guessed silently.
- Candidate tasks deduped against the client's live open reminders (don't propose what's already
  tracked).

### QA gate — Phase 2
- [x] With Client A defaults configured, the thread resolves assignee=Mike and the Sunday deploy slot as
      *defaults*.
- [x] With no defaults configured, extraction still works — defaults simply blank (graceful
      degradation).
- [x] A candidate matching an already-open reminder is flagged as existing, not re-proposed.

## Phase 3 — Propose-and-confirm surface

- N proposed tasks rendered in-thread with confirm/edit before any reminder is created.
- Confirmed set creates reminders via the existing factory (`#MakeScheduledReminder`), emitting
  `ReminderCreated` stamped with `clientId`/`projectId` (#361 Phase A) so history stays connected.

### QA gate — Phase 3
- [x] Nothing is auto-scheduled without a confirm.
- [x] Editing assignee/deadline before confirm is reflected in the created reminders.

## Acceptance criteria

- [x] A whole-thread collector captures the complete thread (not the 3-message vague-pronoun cap) and
      feeds the Complex model.
- [x] Extraction returns N candidate tasks under a strict schema, each mapping to source message ids,
      with per-task confidence; no invented or dropped text.
- [x] Assignee/deadline defaults resolve from #361 Phase A operator config, overridable, graceful when
      unset; candidates deduped against live open reminders.
- [x] Nothing is scheduled without an explicit confirm; confirmed reminders are created via
      `#MakeScheduledReminder` and stamped with client/project identity.
- [x] Full test suite green (`npm test`).

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "main" },
  "gate":        "npx jest reminders-app-mention-handler reminders-ai-pipeline show-me-projects --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/reminders-app-mention-handler.js", "pattern": "CollectWholeThread" }
  ],
  "artifacts":   [
    "src/reminders-app-mention-handler.js",
    "src/reminders-ai-pipeline.js",
    "src/chat-commands/show-me-projects-command.js",
    "tests/reminders-app-mention-handler.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "Phases 1–3 of GH-360" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

## Notes

Builds on the FYI-synthesis work in #337 and the run-on/parity follow-ups in #339, extending from
single-message synthesis to whole-thread, multi-task reconciliation. **Blocked-by (soft): #361 Phase A**
(operator defaults + stamping) + Phase B (live-data path) — Phase 1 here can ship standalone. Runs as
marathon lane **p3** in
[marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml](../../marathon-plans/smart-sleuth-360-361-362/MARATHON.yaml).
