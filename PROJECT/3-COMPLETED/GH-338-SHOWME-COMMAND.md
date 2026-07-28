---
issue: "#338"
title: show-me — reuse individual reactable reminder messages (ranked, bucketed)
desc: Make show-me post each ranked reminder as its own checkmark-closable, permalinked message.
status: Completed — shipped 1.4.209 (commit 2c8ee7d, 2026-07-03); found already-implemented-but-undocumented during the 2026-07-09 marathon run, regression tests added same run, ledger/CHANGELOG backfilled; issue #338 closed via PR #359
created: 2026-06-24
updated: 2026-07-09
owner: noel
goal: >-
  Make show-me render each ranked reminder as its own reactable, permalinked message (like
  show-reminders-for-@user) instead of one consolidated AI-text blob, so items can be
  checkmark-closed and linked back to source.
related: "#337 (task-text synthesis — show-me inherits its display text)"
surface:
  - src/chat-commands/show-me-command.js        # ranking + output (L55-151)
  - src/reminders-display-utils.js              # shared renderer (L137,177,278)
  - src/reminders-reaction-handler.js           # checkmark→complete (L115)
complexity: 2
risk: 2
effort: 3
phases: 3
---

## Status

| What was just completed | What's next |
|---|---|
| **Phase 3 — Top N, bucketed, reactable** (1.4.209, commit 2c8ee7d) | _None — all 3 phases shipped. Regression tests added 2026-07-09._ |

## Table of contents
- [Problem](#problem)
- [Phase 1 — AI output contract: ordered IDs + rationale](#phase-1)
- [Phase 2 — Renderer accepts per-reminder rationale](#phase-2)
- [Phase 3 — show-me renders Top N, bucketed, reactable](#phase-3)

## Problem
`show-me` posts one consolidated AI-text message ([show-me-command.js:142](../../src/chat-commands/show-me-command.js#L142)): items can't be checkmark-closed and have no link to the task. The `show reminders for @user` path already renders each reminder as its own message — reactable (metadata `sleuth-ai-reminder-ids`, [reminders-reaction-handler.js:115](../../src/reminders-reaction-handler.js#L115)) and permalinked ([reminders-display-utils.js:137](../../src/reminders-display-utils.js#L137)). Keep show-me's ranking; render through that shared path. Decisions: rationale **appended per message**, **top N only (N=5, named constant)**, **bucketed by due date** with AI-priority inside each bucket. Footer omitted.

<a id="phase-1"></a>
## Phase 1 — AI output contract: ordered IDs + rationale ✅ (1.4.209, commit 2c8ee7d)
- [x] AI returns ordered `[{ ReminderID, rationale }]` (rank order) instead of prose.
- [x] Validate IDs map 1:1 onto the input set; on mismatch (hallucinated/dropped/dup id) **fall back to deterministic deadline-specificity ordering, no rationale** — never post a broken/short list.
- [x] Take top N (N=5 constant).

**QA**
- [x] Malformed AI response → deterministic fallback fires; valid list still posts. — regression test added 2026-07-09 (`falls back when the AI response hallucinates a reminder ID that was not in the input set`).
- [x] Every rendered item's ID exists in the user's open reminders.

<a id="phase-2"></a>
## Phase 2 — Renderer accepts per-reminder rationale ✅ (1.4.209, commit 2c8ee7d)
- [x] Add optional annotation map (`ReminderID → rationale line`) to `BuildCompactTextForReminder` / `PostRemindersListAsync` / `PostBucketedReminderSectionsAsync`.
- [x] When present, append rationale as a sub-line under the compact line; metadata/permalink unchanged.
- [x] Backward compatible: existing callers (show-reminders, summarize-week, etc.) pass nothing → byte-for-byte unchanged.

**QA**
- [x] Other five callers render identically with no annotation arg.
- [x] Annotated reminder shows compact line + rationale; checkmark still closes it.

<a id="phase-3"></a>
## Phase 3 — show-me renders Top N, bucketed, reactable ✅ (1.4.209, commit 2c8ee7d)
- [x] Replace the single `PostMessageTextAsync` with `PostBucketedReminderSectionsAsync` over the top-N ranked reminders, passing the rationale map.
- [x] Priority order preserved within each due-date bucket; empty buckets skipped.
- [x] Per-item text inherits #337's synthesis behavior automatically (no extra work).

**QA**
- [x] User with >N reminders sees exactly N reactable messages; each closes via checkmark. — regression test added 2026-07-09 (single-ID metadata per reactable message, AI-ranked order).
- [x] Each message has a working permalink to the source task.
- [x] Buckets ordered today → upcoming → older; priority within bucket.

**Note (2026-07-09):** all 3 phases were fully shipped on 2026-07-03 (commit 2c8ee7d) but the doc/ROADMAP/CHANGELOG were never updated — discovered when the marathon swarm's builder (codex) investigated this lane, found the acceptance criteria already met in `src/chat-commands/show-me-command.js`, and added regression test coverage (2 new tests in `tests/show-me-command.test.js`) rather than duplicating working code. Reviewer (agy) confirmed all criteria met and `npm test -- show-me-command` green; full suite independently re-verified (1201/1201). Backfilled the missing `CHANGELOG.md` entry.

## Swarm Preflight Contract

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test -- show-me-command",
  "fix_probes": [
    { "type": "grep_present", "path": "src/chat-commands/show-me-command.js", "pattern": "up to 3 items" }
  ],
  "artifacts": [
    "src/chat-commands/show-me-command.js",
    "src/reminders-display-utils.js",
    "src/reminders-reaction-handler.js",
    "tests/show-me-command.test.js"
  ],
  "remediation": {
    "source": "self#phase-1",
    "criteria": "Phase 1 checklist above: AI returns ordered [{ ReminderID, rationale }] (top N=5) instead of prose, with a deterministic deadline-specificity fallback on any ID mismatch. NOTE: artifacts declare the FULL 3-phase write-set (Phase 2 adds a rationale annotation map to reminders-display-utils.js; Phase 3 routes show-me through PostBucketedReminderSectionsAsync) so the collision detector serializes this lane against GH-337 Phase 3, which also edits reminders-display-utils.js. fix_probes stay Phase-1 scoped (freshness), independent of the write-set (blast radius)."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```
