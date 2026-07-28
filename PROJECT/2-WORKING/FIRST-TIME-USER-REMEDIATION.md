---
title: First-Time-User UX Remediation — close the dead-ends the live battery surfaced
created: 2026-06-21
updated: 2026-06-21
branch: development
status: PLAN — Phase 0 (baseline) DONE via live capture; Phases 1–3 not started. Phase 3 gated on near-miss Phase 0 count.
owner: noel
author: Claude (Opus 4.8, 1M)
goal: >
  Close the first-time-user dead-ends the question battery surfaced, phase by phase,
  gating the riskiest fix (catching direct reminder attempts) on real near-miss-probe evidence.
complexity: 3
risk: 3
effort: 3
phases: 5
evidence: PROJECT/2-WORKING/FIRST-TIME-USER-QUESTION-BATTERY.md   # the live dev-box capture this plan remediates
surface:
  - src/chat-module.js                       # intercept (#TryHandleUnsupportedReminderActionAsync L1682), seam L770, near-miss probe L709/807
  - src/reminders-display-utils.js           # reminders show-path copy (empty-state string)
  - src/reminders-module.js                  # reminders show-path copy
  - data/static/ai/chat-instructions.md      # free-chat persona (anti-/remind + capability line)
  - data/static/ai/command-catalog.json      # capability→help RegexAlias (Phase 1)
  - data/static/HELP.md                      # the help tour Q1 should reach
related:
  - PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md   # Phase 3 here = a consumer of that plan's Phase 0 count
---

## Status

| What was just completed | What's next |
| --- | --- |
| **Phase 0 — Baseline capture** ✅ (2026-06-21). Live battery run on the Vultr dev box against `neochrome-dev` (real LLM) recorded the *before* truth for all 5 first-time questions. Findings: Q4 guard green; Q1 generic; Q5 terse; **Q2/Q3 give contradictory reminder stories and the direct attempt leaks past the intercept.** | **Phase 0.5 — Freeze the measurement substrate** (prerequisite, added per Codex review): commit the battery harness so every QA re-run is reproducible, and define the near-miss probe metric (numerator/denominator/threshold/window/owner) that gates Phase 3. Must land before Phase 1. |

## Swarm Preflight Contract (scoped to Phase 1)

⚠️ **SOLO lane — reminder-display collision cluster.** Write-set touches `src/reminders-display-utils.js`
+ `src/reminders-module.js` (Q5 empty-state copy) — the same spine as **GH-338** (show-me) and GH-337.
The collision detector will serialize this lane out of any wave that runs GH-338; it must **never** share
a wave with a reminder-display or chat-ladder lane. This contract covers **Phase 1 only** (Q5/Q1 safe
deterministic quick wins) — Phase 1 is independent of the Phase-3 near-miss gate, so it is buildable now;
Phases 2–3 stay held (Phase 3 gated on the near-miss metric, see Phase 0.5 → *Metric — finalized*).

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm run validate:commands && npx jest catalog-regex-aliases",
  "fix_probes": [
    { "type": "grep_absent", "path": "data/static/ai/command-catalog.json", "pattern": "what can you do" }
  ],
  "artifacts": [
    "src/reminders-display-utils.js",
    "src/reminders-module.js",
    "data/static/ai/command-catalog.json",
    "tests/catalog-regex-aliases.test.js"
  ],
  "remediation": {
    "source": "self#phase-1--safe-deterministic-quick-wins-q5-q1",
    "criteria": "Phase 1 only. Q5: append one line to the 'You have no pending reminders.' empty-state copy in the reminders show-path (reminders-display-utils.js / reminders-module.js) telling a new user HOW to make a reminder (:alarm_clock: on a message, or `enable reminders`) — empty-state ONLY, never appended to a populated list. Q1: add a command-catalog.json RegexAlias mapping capability phrasings ('what can you do', 'what are you for', 'help me get started', 'what can i ask you') to the existing `help` route. Add a catalog-alias unit test in tests/catalog-regex-aliases.test.js asserting each phrasing resolves to `help` and an unrelated phrase still falls through to chat. DONE when: `npm run validate:commands` passes (alias Route in the target's RegisteredRoutes), `npx jest catalog-regex-aliases` green, and the capability phrasing appears in the catalog (freshness probe flips to landed). OUT OF SCOPE: Phase 2 (canonical reminder-create copy) and Phase 3 (direct-attempt intercept — gated)."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```

## Table of Contents

- [Phase 0 — Baseline capture (DONE)](#phase-0--baseline-capture-done)
- [Phase 0.5 — Freeze the measurement substrate (prerequisite)](#phase-05--freeze-the-measurement-substrate-prerequisite)
- [Phase 1 — Safe deterministic quick wins](#phase-1--safe-deterministic-quick-wins-q5-q1)
- [Phase 2 — One canonical reminder-creation story](#phase-2--one-canonical-reminder-creation-story-q2q3-copy)
- [Phase 3 — Catch the direct reminder attempt (GATED)](#phase-3--catch-the-direct-reminder-attempt-q3--gated)
- [Cross-phase shipping checklist](#cross-phase-shipping-checklist)
- [Review log](#review-log)

---

## Phase 0 — Baseline capture (DONE)

The *before* baseline. No remediation here — it exists so every later phase has a measured comparison
and so we never "fix" a rung that was already healthy.

- [x] Battery of 5 first-time questions defined, one per dispatch-ladder rung.
- [x] Real `ChatModule` + real `WorkspaceAI` driven through the mock SlackApp on the dev box (`neochrome-dev`, real LLM).
- [x] Verbatim replies recorded in [FIRST-TIME-USER-QUESTION-BATTERY.md](PROJECT/2-WORKING/FIRST-TIME-USER-QUESTION-BATTERY.md).
- [x] Per-rung verdict assigned (Q4 ✅ / Q1 ⚠️ / Q5 ⚠️ / Q2 ✅-ish / Q3 ❌ leak).

### Phase 0 — QA checklist

- **Reproducible:** the capture is re-runnable (`scripts/first-time-user-battery.js`) so every phase can produce an *after* diff against this baseline.
- **Observability:** the baseline names the exact rung each question hit, not just the text — so a regression is attributable to a rung, not a vibe.
- **Litmus:** re-running the harness today reproduces the same 5 verdicts byte-for-byte (modulo LLM nondeterminism on Q1's free-chat wording).
- **Anti-goal:** do not treat Q4 (model guard) as in-scope — it is the reference for correct behavior, not a target.

---

## Phase 0.5 — Freeze the measurement substrate (prerequisite)

**Goal (added per Codex review):** every later phase's QA re-runs the battery harness and Phase 3's gate
reads the near-miss probe — but today the harness is **untracked** and the probe is a fire-and-forget log,
not a classifiable metric. Make both durable and well-defined *before* Phase 1 ships, or "reproducible" and
"gated" are claims we can't actually honor.

- [ ] **Commit the harness:** move `scripts/first-time-user-battery.js` into the repo (version bump + CHANGELOG per AGENTS.md) so re-runs are reproducible by anyone, not just this session. Add a one-line usage note to the script header (run target = a configured server, e.g. dev box).
- [ ] **Pin the battery questions** as the canonical 5 (they live in the harness array) so *before/after* always compares the same inputs.
- [ ] **Define the near-miss probe metric** the Phase 3 gate will read, concretely:
  - **Numerator** = unmatched mentions (reached the L807 probe) whose top deterministic candidate is a reminder-create intent **and** whose text carries a time signal.
  - **Denominator** = all mentions that reached the probe (total fallthroughs to generic chat) in the window.
  - **Window** = a fixed ≥7-day span (record the exact dates when read).
  - **Owner** = noel reads the [near-miss probe](src/chat-module.js#L709) output; no dashboard required — a one-off `grep`/count of the structured probe line is enough.
- [ ] **Confirm the probe actually carries the classifying fields** (top candidate id + score). If it can't distinguish a reminder-create miss, note the smallest probe enrichment needed — that enrichment becomes the first task of Phase 3's gate-check, not a silent assumption.

### Phase 0.5 — QA checklist

- **DRY / reuse:** one committed harness, one battery array — no parallel copies; Phase 0's transcript stays the baseline it diffs against.
- **SOLID / ownership:** the harness lives under `scripts/` like its siblings (`slack-harness-post.js`); it does **not** become a second code path into ChatModule beyond test/measurement.
- **Observability:** the probe-metric definition is the observability deliverable — numerator/denominator/window/owner written down, not implied.
- **Litmus:** a second person can `git pull`, run the harness against a configured workspace, and reproduce the Phase 0 verdicts; the probe metric can be computed from real probe lines with a single documented command.
- **Anti-goals:** do **not** build a metrics dashboard or persist the harness output to a service — a counted log line is the bar; do **not** let the harness make real LLM calls in CI (it's an operator-run tool, not a `npm test` gate).
- **Deploy:** committing the harness is a repo change (version bump + CHANGELOG); no service behavior changes, so no dev-service restart needed for this phase.

### Metric — finalized (2026-07-05, real prod readout)

The near-miss probe metric that gates Phase 3, now defined against real data. Harness
(`scripts/first-time-user-battery.js`) is already git-tracked ✅; the battery's 5 questions are pinned
in its array ✅.

- **Numerator** = probe events (`near-miss probe...`, [chat-module.js:712](../../src/chat-module.js#L712))
  whose `topCandidateId` is a reminder-create intent **and** whose text carries a time signal.
- **Denominator** = all probe events (total unmatched-mention fallthroughs to chat) in the window.
- **Window** = fixed ≥7-day span; record exact dates at read time.
- **Owner** = noel; read via `journalctl -u sleuth-app --since <date> | grep -A5 "near-miss probe"`. No dashboard.

**First read — window 2026-05-25 → 2026-07-05 (full journal retention, prod `neochrome`):**

| topCandidateId | topScore | reminder-create intent? |
|---|---|---|
| `recall` | 9 | no |
| `commands` | 4 | no |

- **Denominator = 2** probe events over ~6 weeks. **Numerator = 0** (neither is a reminder-create intent).
  Observed reminder-create dead-end rate = **0/2**.
- **⚠️ Probe-enrichment gap (Phase-3 gate blocker):** the probe logs `topCandidateId` + `topScore` but
  **not** a time-signal boolean or the normalized text — so it *cannot* fully classify a reminder-create
  miss on its own. Enriching the probe to log `hasTimeSignal` (and/or the normalized text) is therefore
  **the first task of Phase 3's gate-check**, not a silent assumption. Until then the numerator is a
  lower bound.
- **Read-out implication:** the dead-end volume is tiny (2 fallthroughs in 6 weeks) and zero are
  reminder-create. Phase 1 (Q5/Q1) is worth doing regardless (cheap, deterministic, not gated). **Phase 3
  (catch the direct reminder attempt) stays HELD** — the evidence does not yet show a reminder-create
  dead-end problem worth the intercept complexity; revisit only if the enriched probe shows the rate climbing.

---

## Phase 1 — Safe deterministic quick wins (Q5, Q1)

**Goal:** kill the two lowest-risk first-impression misses with **zero LLM** and near-zero false-positive
surface. Ships independently of Phases 2–3.

- [ ] **Q5 empty-state pointer:** append one line to the "You have no pending reminders." copy in the reminders show-path ([reminders-display-utils.js](src/reminders-display-utils.js) / [reminders-module.js](src/reminders-module.js)) telling a new user *how* to make one (`:alarm_clock:` on a message, or `enable reminders` for auto-detection).
- [ ] Confirm the same pointer reads correctly for the populated list (it should appear **only** on empty state, not append to a real list).
- [ ] **Q1 capability tour:** add a catalog `RegexAlias` mapping capability phrasings (`what can you do`, `what are you for`, `help me get started`, `what can i ask you`) → the existing `help` route in [command-catalog.json](data/static/ai/command-catalog.json).
- [ ] `npm run validate:commands` passes (alias `Route` ∈ the target entry's `RegisteredRoutes`).
- [ ] Add a catalog-alias unit test asserting each capability phrasing resolves to `help` and that a bare/unrelated phrase still falls through to chat.
- [ ] Re-run `scripts/first-time-user-battery.js`: Q1 now returns the [HELP.md](data/static/HELP.md) tour (router rung), Q5 now ends with the create-a-reminder line.

### Phase 1 — QA checklist

- **DRY / reuse:** Q1 routes to the *existing* `help` route — no new handler, no duplicated help text (AGENTS.md §14: phrasing additions go in the catalog, never a new `Router.Register`). Q5 edits the single canonical empty-state string, not a copy.
- **SOLID / ownership:** copy change stays inside the reminders module's display surface; routing change stays in the catalog. No cross-boundary reach.
- **Observability:** none required — both changes are deterministic and visible in the harness diff.
- **Litmus:** `what can you do?` → help tour (not generic chat); `show my reminders` (empty) → ends with the pointer; an unrelated message (`how's the weather`) still reaches generic chat (no over-trigger).
- **Anti-goals:** do **not** touch [chat-instructions.md](data/static/ai/chat-instructions.md) here (that is Phase 2's blast radius); do **not** make the capability alias so broad it swallows real questions.
- **Deploy:** data/catalog change → `npm test` + `npm run validate:commands`, version bump + CHANGELOG, push `development`, restart dev service, re-run harness.

---

## Phase 2 — One canonical reminder-creation story (Q2/Q3 copy)

**Goal:** Q2 (intercept) and Q3 (leaked-to-LLM) currently tell users **two different** ways to create a
reminder — `:alarm_clock:`/thread-command vs Slack's native `/remind`. Pick one canonical story and make
every reminder-creation answer tell it. **No trigger logic changes here** — copy + instruction only.

- [ ] Decide the single canonical first-time creation path (recommendation: `:alarm_clock:` reaction + the thread `make a Sleuth reminder` command + `enable reminders` for auto-detection — i.e. Sleuth's own surfaces, **not** Slack `/remind`).
- [ ] Rewrite the intercept copy in [`#TryHandleUnsupportedReminderActionAsync`](src/chat-module.js#L1682) to lead with that canonical story and drop the defensive "I didn't create a reminder" opener for the "how do I" phrasing.
- [ ] Add an explicit instruction to [chat-instructions.md](data/static/ai/chat-instructions.md): when a user asks to create/set a reminder in free chat, **do not** invent or recommend Slack's `/remind`; point to Sleuth's supported paths (consistent with lines 36–37's no-overclaim rule).
- [ ] `npm run validate:ai` passes (chat-instructions asset integrity).
- [ ] Re-run the harness: Q2 and any Q3 that still reaches chat now tell the **same** creation story; no `/remind` suggestion appears.

### Phase 2 — QA checklist

- **DRY / single source:** there is now exactly one canonical creation story; the intercept copy and the chat-instruction reference the same surfaces (no third wording).
- **SOLID / ownership:** `WorkspaceAI`/persona owns the free-chat instruction; `ChatModule` owns the intercept copy — neither reaches into the reminders write path. No behavior change to actual reminder creation.
- **Observability:** if the near-miss probe (L709/807) is on, confirm Q3-class messages still log so Phase 3 keeps its signal.
- **Rollback:** the only change is copy + one instruction line — backout = revert the two commits. **Backout trigger:** the *after* battery shows the canonical guidance is worse/confusing, or the LLM still emits `/remind` after the instruction (instruction ineffective → reconsider lever).
- **Litmus:** `how do I set a reminder?` and `remind me to pay invoices tomorrow at 9am` produce **non-contradictory** guidance; neither mentions `/remind`.
- **Anti-goals:** do **not** broaden *what gets intercepted* here (that is Phase 3, and it is gated); do **not** start auto-creating reminders from free chat.
- **Deploy:** source + AI-asset change → `npm test` + `npm run validate:ai`, version bump + CHANGELOG, push `development`, restart dev service, re-run harness.

---

## Phase 3 — Catch the direct reminder attempt (Q3) — GATED

**Goal:** the headline miss — `remind me to <task> <time>` leaks past the intercept to generic chat. Make
the intercept (or a deterministic pre-chat guard) fire on the first-person direct attempt too.

> **GATE (recorded decision):** the [near-miss recovery plan](PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md)
> says *measure first, broaden on evidence — not on faith.* Do **not** start Phase 3 until the Phase 0.5
> probe metric shows direct-attempt misses are a real, recurring share. This plan's live battery is the
> first data point, not the whole case.

- [ ] **Concrete gate (from Phase 0.5):** open Phase 3 only if, over the fixed ≥7-day window, reminder-create-intent-with-time-signal misses are **≥ 20% of probe fallthroughs OR ≥ 5/week** (whichever the operator confirms is material), read by **noel** from the [probe](src/chat-module.js#L709) output. Record the actual numerator/denominator/dates in this checklist when read. If below threshold, **stop here** and leave the rung as-is.
- [ ] If the probe can't yet classify reminder-create misses, the **first** Phase 3 task is the minimal probe enrichment named in Phase 0.5 — not a guess.
- [ ] If gated open: extend [`#TryHandleUnsupportedReminderActionAsync`](src/chat-module.js#L1682) (or add a deterministic guard above the generic-chat rung at the [L770 seam](src/chat-module.js#L770)) to match a **schedulable-task pattern + an explicit time signal** — **never `remind me` alone.**
- [ ] The new match emits the **Phase 2 canonical** creation story (reuse, don't re-author).
- [ ] **Negative-case set (Codex):** `remind me what HTTP 200 means`, `remind me how /remind works`, and other recall/definitional prompts that contain "remind" but no schedulable task + time must **not** trigger — they fall through to chat.
- [ ] Unit tests: positive (`remind me to pay invoices tomorrow at 9am` → intercept) + the full negative set above + Q2 still caught.
- [ ] Re-run the harness: Q3 now lands on the intercept rung with the canonical story; no leak to generic chat; no negative-case regression.

### Phase 3 — QA checklist

- **DRY / reuse:** the broadened trigger emits the Phase 2 canonical copy — no new third wording; reuse `ScoreCommandEntry`/existing detection rather than a parallel regex zoo where possible.
- **SOLID / ownership:** the guard stays at the chat-ladder seam and remains **suggest-only** — it must not call the reminder write path or bypass the FSM (`#MakeScheduledReminder` / `#TransitionReminderState`).
- **Observability:** log when the new branch fires (workspace, channel, matched phrase class) so over-/under-triggering is measurable post-deploy; keep the near-miss probe intact.
- **Rollback (Codex):** ship the new trigger behind a default-OFF flag (e.g. `REMINDER_ATTEMPT_INTERCEPT`) so backout is instant — no revert/redeploy. **Backout triggers:** any negative-case prompt appears intercepted in the battery, or the post-deploy fire-log shows a spike in interceptions of non-reminder conversation. Flag off → byte-for-byte Phase 2 behavior.
- **Litmus:** the exact baseline failure (`remind me to pay invoices tomorrow at 9am`) is intercepted; the full negative set is not; Q2 unchanged.
- **Anti-goals:** **no** auto-execution / auto-creation; **no** nagging on conversational messages; **no** regression of any rung that was green in Phase 0 (esp. Q4 guard, Q5 router).
- **Deploy:** source change → full `npm test` + `npm run validate:commands` + `npm run validate:ai`, version bump + CHANGELOG (note the trigger-surface change), push `development`, restart dev service, re-run harness, then watch the probe for false-positive rate.

---

## Cross-phase shipping checklist

Applies to every code/data-bearing phase (0.5–3):

- [ ] `npm run build` (type check) + `npm test` green.
- [ ] `npm run validate:commands` (catalog changes) / `npm run validate:ai` (AI-asset changes) as applicable.
- [ ] `package.json` version bumped + `CHANGELOG.md` entry per AGENTS.md.
- [ ] Pushed to `development`; dev service restarted (skip for Phase 0.5 — harness commit changes no service behavior); `scripts/first-time-user-battery.js` re-run as the *after* baseline and diffed against Phase 0.
- [ ] No regression in the rungs that were green at baseline.

---

## Review log

- **2026-06-21 — Codex (gpt-5.4) reviewer pass.** Requested via `/relay-xyz`; the automated relay harness (`relay-automation/`) is not present in this clone, so Codex was run directly as the reviewer (`codex exec`, read-only) over this plan + its evidence doc. Three findings, all accepted and folded in:
  1. *Gate not auditable* → added concrete metric/threshold/window/owner to the **Phase 3** gate and defined the probe metric in new **Phase 0.5**.
  2. *Missing prerequisite (untracked harness, soft "reproducible")* → added **Phase 0.5 — Freeze the measurement substrate** (commit the harness + pin the battery + define the probe readout) before Phase 1.
  3. *QA thin on rollback* → added explicit **Rollback/backout triggers** to Phase 2 and Phase 3 QA (Phase 3 ships behind a default-OFF flag).
  - *Correctness risk on Phase 3 trigger* (over-catching `remind me what HTTP 200 means`) → Phase 3 now keys on **schedulable-task + explicit time signal**, never `remind me` alone, with Codex's negative cases in the test set.
  - Transcript: `${TMPDIR}/codex-remediation-review.log`.
