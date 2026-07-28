---
title: "Missing/blank Candidate.title can leak undefined/empty text into a scheduled reminder"
status: Active (2-WORKING)
created: 2026-07-16
updated: 2026-07-16
owner: noel
branch: development
doc_type: project
gh_issue: 399
source: https://github.com/NeochromeTeam/sleuth-app/issues/399
related: "#360 (multi-task inference — introduced #HandleConfirmMultiTaskProposalAsync)"
effort: 1
complexity: 1
risk: 2
phases: 1
---

# GH-399 — guard against a missing/blank `Candidate.title`

In `#HandleConfirmMultiTaskProposalAsync`
([src/reminders-app-mention-handler.js:939](../../src/reminders-app-mention-handler.js#L939)),
`const TaskText = Candidate.title;` is used verbatim (intentionally — see the comment above it, this
is WYSIWYG-with-the-proposal by design, not a bug to "fix" by falling back to raw source text). But
if the AI pipeline ever returns a candidate with a missing or blank `title`, `TaskText` becomes
`undefined`/`''`, and `ScheduleText` (line 944) ends up containing the literal string `"undefined"`
or a malformed mention-only line — a bad reminder gets persisted with no upstream validation
catching it. Flagged medium severity in PR #375 review (Augment Code).

## Phase 1 — validate before scheduling
- [x] In `#HandleConfirmMultiTaskProposalAsync`, before building `ScheduleText`, skip (or coerce) a
      `Candidate` whose `title` is missing/blank: log a warning via `ArgSlackApp.Logger` and treat it
      like the existing duplicate-skip path (don't call `#TryScheduleRemindersAsync` for it), so a bad
      AI-pipeline result can't leak an `undefined`-text reminder into persistence.
- [x] Add a regression test in `tests/reminders-app-mention-handler.test.js`: a confirm-proposal
      candidate with `title: undefined` (or `''`) is skipped, not scheduled, and doesn't throw.

### QA gate
- [x] Confirming a proposal with one blank-title candidate among valid ones creates reminders for the
      valid ones only; no `"undefined"` text is ever scheduled.
- [x] Existing multi-task confirm tests still green (no change to the WYSIWYG-title behavior for
      valid candidates).

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest reminders-app-mention-handler --forceExit",
  "fix_probes":  [
    { "type": "grep_present", "path": "src/reminders-app-mention-handler.js", "pattern": "const TaskText = Candidate\\.title;" }
  ],
  "artifacts":   [
    "src/reminders-app-mention-handler.js",
    "tests/reminders-app-mention-handler.test.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-399 Phase 1 — skip confirm-proposal candidates with a missing/blank title" },
  "lanes":       { "agy_safe": [ "src/reminders-app-mention-handler.js", "tests/reminders-app-mention-handler.test.js" ], "orchestrator_only": [] }
}
```

> Note: the `grep_present` fix probe targets the exact current unguarded assignment
> (`const TaskText = Candidate.title;` at line 939). It reads "unfixed" (correct) while that literal
> line stands, and "landed" once the fix rewrites it to validate/skip a missing title — even a
> one-line rewrite changes the string enough to flip the probe. Re-check by hand if the eventual fix
> keeps that exact substring elsewhere (e.g. copy-pastes it into a comment).

## Progress log
- 2026-07-16: filed as #399 from PR #375 code review; capture doc + contract authored during 10-day
  GH triage.
- 2026-07-17: Phase 1 shipped — `NonDuplicate`/`Confirmable` filter chain in
  `#HandleConfirmMultiTaskProposalAsync` now also drops candidates with a missing/blank `title`,
  logging `ArgSlackApp.Logger.warn` per skipped candidate (mirrors the existing duplicate-skip
  filter). New regression test added; all 90 tests in
  `tests/reminders-app-mention-handler.test.js` pass. Note: the line
  `const TaskText = Candidate.title;` is untouched (still valid for confirmable candidates), so the
  `grep_present` fix probe above will still read "unfixed" per its own caveat — the actual guard
  lives earlier, in the filter chain.
