---
title: "Reminder-render primitive: every reminder list must post as individual reactable messages"
status: Active (2-WORKING) — Phase 1 shipped (1.4.225), Phase 2 in progress
created: 2026-07-15
updated: 2026-07-16
owner: noel
gh_issue: 391
source: https://github.com/NeochromeTeam/sleuth-app/issues/391
branch: fix/gh-391-reminder-render-primitive
doc_type: feature
complexity: 3
risk: 2
effort: 3
phases: 3
ratings_provisional: true
non_goals:
  - Changing the query/matching engine (#367) — this is purely the render seam
  - Inventing a new message format — reuse the existing individual-message renderer verbatim
  - Exposing raw `id:` values in any user-facing output (they are model-facing debug context)
related:
  - "#338 (established the per-reminder individual-message renderer this must reuse)"
  - "#367 (reminder-query-engine — feeds the ask-reminders path that regressed)"
  - "#384 / #387 (the primitive + CI-guard pattern to mirror)"
  - "BaseModule 1.4.222 (today's per-workspace primitive — same intent, different class)"
goal: >
  Make the canonical per-reminder poster the ONE sanctioned way to display a reminder
  list, so every path (ask-reminders, "what's open", show-me, queries, digests) renders
  as individual reaction-actionable messages — never a custom text blob with raw ids —
  and make that enforceable in CI so no LLM session can quietly re-roll its own render.
---

# GH-391 — Reminder-render primitive (individual reactable messages, enforced)

## Status

| What was just completed | What's next |
|---|---|
| **Consult hardening (1.4.227).** Codex + agy `/consult` on the diff caught a Blocker a green suite missed: the open render had no cap → channel flood / Slack 429. Fixed: cap at 15 soonest-due + "showing 15 of N" note; hardened `StripInternalReminderIds` (space/brackets); broadened the guard (concat vector) + fixed a Shape-2 negation false-positive. **Phase 2 shipped 1.4.226** (guard + AGENTS.md §0.1). **Phase 1 shipped 1.4.225.** | **Done** — all 3 phases + consult hardening complete. Follow-up filed: **#393** (pre-existing NaN time-window bypass, out of scope). Move doc to `3-COMPLETED` after a soak. |

## Quad Concepts
- Reminder lists re-rolled as custom text blobs → force delegation to the one canonical per-reminder poster.
- Raw internal `id:` values leaking to users → strip from every user-facing branch; ids live only in message metadata.
- Tasks not individually completable/deletable → each reminder is its own message carrying the reaction metadata.
- Convention drift by the next LLM session → make the render primitive CI-enforced (Phase 2), not advisory.

## Table of contents
- [Phase 0 — Explore & scope (confirm the seam)](#phase-0--explore--scope-confirm-the-seam) — ✅ done
- [Phase 1 — Delegate ask-reminders to the primitive](#phase-1--delegate-ask-reminders-to-the-primitive--shipped-14225-2026-07-16) — ✅ shipped
- [Phase 2 — Elevate to a primitive + CI guard](#phase-2--elevate-to-a-primitive--ci-guard) — in progress

## Key concepts
- **One sanctioned render path.** `PostRemindersListAsync()` / `PostBucketedReminderSectionsAsync()`
  (`src/reminders-display-utils.js:294`/`:400`) already post reminders as individual, bucketed,
  reaction-actionable messages (the `A.) B.) C.)` daily-tasks format from #338). Every
  reminder-list output must delegate to it — none may hand-roll its own.
- **The regression.** `RenderCitedCandidates()` (`src/chat-commands/ask-reminders-command.js:129`)
  builds `OPEN id:<id> … — text` lines *for the model*, and that id-citing blob is reaching the
  user (screenshot: "8 open items total", raw `id:fc3d9b07` prefixes). Model-facing debug context
  must never be user-facing.
- **Same shape as the primitives we already trust.** `BaseModule` (1.4.222) guides devs on the
  #384 per-workspace class; #387 fails CI on that class. This is the *rendering* analogue: a
  documented primitive + a CI guard, because "docs are advisory" was exactly why #384 shipped.
- **Second occurrence.** An LLM session re-rolled reminder output again despite the convention —
  evidence that guidance without enforcement doesn't hold for this class either.

## Idea
Add a rendering primitive that all reminder-listing paths must follow: always show reminders by
re-using the per-reminder individual-message renderer, so each task is its own message with an emoji
reaction to complete or delete it — instead of a custom text blob with debugging IDs.

## Why
`what's open for Client A?` returned a bespoke consolidated blob with raw `id:` prefixes instead of
individual reactable messages. The user can't ✅/🗑 a task from a blob, and raw ids are internal
debug context. The canonical renderer already exists (#338) — the query path just bypasses it. Making
the renderer a primitive + CI-enforced closes the convention-drift loop that keeps re-appearing.

## Phase 0 — Explore & scope (confirm the seam)
> Discovery phase: findings are written **back into this doc** before its QA gate can pass.

### Checklist
- [x] Confirm the exact user-facing post in the ask-reminders path.
- [x] Inventory reminder-list emitters and which already delegate to the poster.
- [x] Confirm the poster's expected shape / define the minimal adapter.
- [x] Decide the guard's detection shape (deferred to Phase 2).
- [ ] Set/correct triage ratings; clear `ratings_provisional` once real. `TODO(operator)`.

### Phase 0 findings (2026-07-16)
- **The exact seam.** `ask-reminders-command.js` built `SystemPrompt` telling the model to *"Always
  cite reminder IDs (e.g. id:abc-123)"* + *"Use bullet lists"* (old lines 254-260), fed it the
  id-citing `RenderCitedCandidates(Result.matched)` set, and posted the model's single free-text
  answer via `PostMessageTextAsync` (old line 271). That is the screenshot blob — confirmed, not the
  `RenderCitedCandidates` output posted directly.
- **Canonical primitive already exists.** `PostRemindersListAsync` / `PostBucketedReminderSectionsAsync`
  (`src/reminders-display-utils.js:294`/`:400`) post individual, bucketed, per-reminder messages and
  stamp each with `event_type:'sleuth-ai-reminder-ids'` metadata carrying the `ReminderID` — **this
  metadata is what makes the ✅/🗑 reactions work.** `show-me` (`show-me-command.js:260`) already
  delegates to it, sourcing reminders from the *same* `GetAllReminders()` ask-reminders uses.
- **Adapter is trivial.** `candidate.id === Reminder.ReminderID` for active reminders
  (`reminder-candidates.js:81-86`), so matched-open candidates map straight back to live `Reminder`
  objects (which already carry the `Date` fields + permalink source the poster needs).
- **⚠️ Material entanglement (scope-shaping).** The LLM was doing **open-vs-completed intent
  resolution**, not just phrasing: the handler pulls *all* completion history into candidates
  (`GetCompletedRemindersBetween(0, now+retention)` when untimed) and let the model decide what
  "open" meant. So a naïve renderer swap would mis-handle history queries. Phase 1 therefore routes
  **open** matches to the poster and preserves a (now id-free) prose path for completed-only queries,
  rather than deterministically re-deriving open/completed intent (a larger NLP change — deferred).

### QA checklist — Phase 0
- [x] Scope grounded in real code/history (the actual emitters + the real prompt), not hypotheticals
- [x] Reuses the existing `#338` renderer — no parallel render path introduced
- [x] Raw `id:` values proven absent from all user-facing branches (open: no ids; completed: stripped)
- [x] A human checkpoint remains before the guard is flipped to blocking (Phase 2, not built here)

## Phase 1 — Delegate ask-reminders to the primitive  ✅ shipped (1.4.225, 2026-07-16)
- [x] Route the open-reminder result through `PostBucketedReminderSectionsAsync` so each match is its
      own reaction-actionable message (no model call for the open-listing path).
- [x] Strip id-citing output from the user-facing branch: open path posts no ids; completed-history
      path drops the "cite ids" instruction + strips ids via `StripInternalReminderIds`.
- [x] Regression tests: assert per-reminder `ReminderID` metadata (not model input), no `id:` in
      channel text, completed-history + id-strip coverage. `tests/ask-reminders-command.test.js` green.
- [x] Mixed open+completed results surface a "plus N already completed" note (no silent drop).

## Phase 2 — Elevate to a primitive + CI guard  ✅ shipped (1.4.226, 2026-07-16)
- [x] Documented the poster as the single sanctioned reminder-list render in AGENTS.md §0.1, beside
      the BaseModule + isolation-guard rules (+ the guard family listed together in the validators section).
- [x] `scripts/validate-reminder-render.js` — static scan (mirrors `validate-workspace-isolation.js`):
      **Shape 1** flags a standalone `id:${…}` construction; **Shape 2** flags a prompt instructing the
      model to cite reminder ids. `// RENDER-OK:` pragma allowlist; `file:line`; non-zero exit. Added
      `npm run validate:reminder-render`.
- [x] Model-input renders pragma'd: `RenderCitedCandidates` (ask-reminders) + the extraction-prompt
      dedup summary (`reminders-ai-pipeline.js`).
- [x] Enforced under `npm test` via `tests/validate-reminder-render.test.js` (unit shapes + "tree is
      clean" integration). Zero false positives on the current tree (the `code-task-relay` `task-id:`
      hit surfaced during build → pattern tightened to a standalone `id:` token).

### QA checklist — Phase 2
- [ ] The guard mirrors `scripts/validate-fsm-invariants.js` / `validate-workspace-isolation.js`
      (allowlist pragma, `file:line` output, non-zero exit) — no new validator idiom invented.
- [ ] The guard **fails on the pre-1.4.225 shape**: reintroducing the old `RenderCitedCandidates`
      blob post makes CI red (mutation-verified), and passes clean on the current tree.
- [ ] Zero false positives across the existing reminder emitters (`show-me`, digest, ask-reminders,
      web-api) — each either sources from the poster or carries a reviewed `// RENDER-OK:` pragma.
- [ ] AGENTS.md names the primitive next to the BaseModule + isolation-guard rules; `npm run validate`
      runs it. Built via /relay (Producer + Reviewer), since this is the convention-drift class itself.
