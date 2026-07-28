---
title: P3 Event-Sourced Core — Phase 0 Architecture Spike (seam map, read inventory, contracts)
date: 2026-06-13
branch: feat/event-sourced-core
status: paused after 4 passes (Claude -> Codex)
generated_by: inline spike (manual synthesis + grep read-inventory) — NOT the rebalance-OS phase-0-spike workflow
owner: noel
author: Claude (Opus 4.8, 1M)
related:
  - PROJECT/1-INBOX/P3-EVENT-SOURCED-CORE.md
  - PROJECT/RELAY/p3-event-sourced-core-review.md
  - ARCHITECTURE.md (volatile — regenerated; see README for durable findings)
---

> **Phase 0 deliverable.** This is the seam map + read inventory + the four hard contracts
> (write-order, corrupt-tail, baseline, event-validation) required before the log becomes
> **authoritative** for boot rebuild. No production code was written to produce this. Validate the
> read inventory against the live codebase and check off the QA list at the bottom before any
> authoritative source-of-truth phase begins.
>
> **Provenance note:** the installed `phase-0-spike` skill is a saved workflow **hardcoded for
> rebalance-OS** (it ignores args and writes to the rebalance repo). It was not usable here; this
> artifact was produced inline instead. Durable findings are mirrored into [README](../../README.md#event-sourced-core-p3--phase-0-architectural-findings).

## ⏸️ Status: PAUSED 2026-06-13 — Resume Here

**Where this stands.** Phase 0 spike complete; **three independent Codex review rounds applied** (see
[Independent Review](#independent-review-codex-2026-06-13)). R1 (async boundary) cleared; rounds 1–3
fixed read-inventory completeness, the no-`fsync` reality, the non-FSM write surface, and two genuine
correctness bugs (rebuild **stranding** and per-workspace **concurrency**). **No production code was
written.** Branch `feat/event-sourced-core`. Paused at the owner's call to bank the investment — this
doc is the durable record.

**Counter-view — the RECOMMENDED path on resume (Codex, 2026-06-13; author agrees).** Do **not** make
the log authoritative immediately. Every hard edge specified below (rebuild stranding, the per-workspace
critical section, baseline fidelity, recorded-after-effect posting) is a *consequence of the log being
authoritative for boot rebuild* — none of them bite a log that is merely an observer. So:

1. **Phase 1 = a NON-authoritative append-only ledger.** Keep mutate-first behavior for reminder
   lifecycle state. The ledger is durable and awaited where it is the product guarantee
   (`summarize-week` completion history / HiQS export), but it is **not** used to rebuild the reminder
   queue and it does **not** fail-closed unrelated Slack lifecycle behavior. This banks the two
   motivating wins — durable completion history (the original `summarize-week` complaint) and the
   rebalanceOS **HiQS** completion/event export — with **none** of the authoritative edges.
2. **Graduate projections one at a time, only after a shadow-diff** proves each matches the live JSON
   for a real week.
3. **Pay the authoritative cost only when a projection graduates to source-of-truth** (boot rebuild).
   Then — and only then — every edge in this doc (Contracts 1–4, the resting-state event model, the
   critical section, the risk table) becomes mandatory. It is all specified here and **held in reserve**.

**To resume:** build the [Recommended Phase 1 Slice](#recommended-phase-1-slice--non-authoritative-ledger)
unless the owner explicitly re-approves authoritative boot rebuild. Re-read the
[Independent Review](#independent-review-codex-2026-06-13) (3 rounds) and
[Contract 1](#contract-1--authoritative-durable-append-the-load-bearing-rule) before any
source-of-truth work. Open items remain in the [Phase 0 QA Checklist](#phase-0-qa-checklist).

## Context

Sleuth's reminder lifecycle already funnels `.State` changes through one FSM chokepoint. The original
P3 proposal made that chokepoint **append an immutable event as the authoritative write** before
mutating in-memory state or any derived cache; every JSON file, `summarize-week`, the rebalance export,
and (later) client/project buckets would become **projections** — pure folds over the per-workspace log
(`data/runtime/events/<WORKSPACE>_events.jsonl`).

The spike proved that this is a valid long-term architecture, but it is a larger migration than the
triggering product need. There are now two tracks:

- **Recommended near-term track:** a durable, non-authoritative ledger for completion/event history.
  It serves `summarize-week` and HiQS without replacing reminder-state boot load.
- **Reserved authoritative track:** the full event-sourced core. Contracts 1–4 below apply when a
  projection graduates to source-of-truth and the app boots from the log.

This distinction matters. A non-authoritative ledger can be introduced behind shadow reads and can
fail without changing reminder lifecycle state. It still needs durable writes before any user-facing
history depends on it. A log that is the source of truth must additionally explain every persisted
field, every external side effect, and every crash point. Most of this document exists because of that
last sentence.

## Architectural Lesson — Why The Spike Expanded

The hard part was not writing JSONL. It was accepting the phrase **source of truth**. Once the log is
authoritative, Sleuth's mutable reminder object graph becomes part of the event contract:

- lifecycle state is only one field; persisted data also includes summary text, assignee/channel
  backfills, GitHub URLs, relay flags, snooze flags, timestamps, and export-facing IDs.
- Slack and GitHub side effects cannot be rolled back, so post-result events need explicit
  at-least-once semantics.
- transient FSM states (`overdue`, `posting`, `posted`, `rescheduled`) are useful in memory but are
  dangerous as rebuilt resting states.
- async JavaScript can interleave handlers across an awaited append, so authoritative mode needs a
  per-workspace critical section, not just serialized file writes.
- baseline import has to be exact; omitting one persisted field makes replay wrong from day one.

The earlier spike flaw was starting from the target architecture ("event-sourced core") rather than
the smallest problem ("weekly summary needs durable completion history"). Future work should first
ask: **audit ledger, completion ledger, or source-of-truth log?** These are different projects with
different invariants.

## R1 Spike Result (2026-06-13) — the async boundary is clean ✅

R1 — "authoritative append forces `#TransitionReminderState` async and breaks synchronous callers" —
was the gating risk for the **authoritative** track. Audited **every** call site in `src`.
**Verdict: no cascading refactor.** Every caller is already in an `async` function and an
**awaitable position** (a statement or a `for…of` loop) — none is inside a synchronous
`.map`/`.filter`/`.forEach` callback, a getter, a constructor, or a non-async handler.

| Caller | Site | Context | Awaitable? |
|---|---|---|---|
| `CompleteReminderByIdAsync` (github-sync) | [reminders-module.js:544](../../src/reminders-module.js#L544) | async; already `await`s next line | ✅ |
| `CompleteReminderFromListAsync` | [:566](../../src/reminders-module.js#L566) | async | ✅ |
| `CancelReminderFromListAsync` | [:587](../../src/reminders-module.js#L587) | async | ✅ |
| `#CheckRemindersAsync` ×10 | [:2284–2519](../../src/reminders-module.js#L2284) | async; PASS-1 & PASS-2 are `for…of` loops | ✅ |
| white_check_mark handler | [reaction-handler.js:142](../../src/reminders-reaction-handler.js#L142) | async; `for…of ReminderIDs` | ✅ |
| wastebasket handler | [:209](../../src/reminders-reaction-handler.js#L209) | async; `for…of ReminderIDs` | ✅ |

**The one contract boundary:** `#TransitionReminderState` is exposed as a synchronous `=> void`
callback ([reminders-module.js:750](../../src/reminders-module.js#L750)) to the **reaction handler
only** — the sole external consumer (grep-confirmed). Authoritative-track change: return the promise;
reaction handler adds `await` at :142/:209 and updates the JSDoc type `=> void → => Promise<void>`
([reaction-handler.js:66](../../src/reminders-reaction-handler.js#L66)).

**Authoritative-track follow-ups (not blockers for the non-authoritative ledger):**
- The design note at [reminders-module.js:400–403](../../src/reminders-module.js#L400) ("…never makes
  `#TransitionReminderState` async") is exactly the assumption P3 overturns; the fire-and-forget
  `#RecordCompletion` is subsumed by the authoritative append. Update the comment.
- Transitions run in batch loops (reaction IDs; check-cycle passes; the snooze pair :2355→:2357 and
  reschedule pair :2499→:2500). With awaited fail-closed append, choose per-reminder granularity —
  default to per-reminder try/catch + continue so one bad append doesn't strand the batch.

**Net:** the authoritative path is an additive, awaitable change across ~13 sites + one
single-consumer callback — not a broad refactor. R1 cleared. The remaining proof is semantic
correctness (Contracts 1–4), not call-site shape.

## Independent Review (Codex, 2026-06-13)

An independent skeptical pass verified this doc against the code. Outcome:

- **R1 (async boundary): Confirmed** — clean. (Plus: reaction-handler test mocks at
  [tests/reminders-reaction-handler.test.js:36](../../tests/reminders-reaction-handler.test.js#L36)
  also need the `=> Promise<void>` signature update.)
- **Read inventory: Refuted (incomplete)** — missed `GetAllReminders()` consumers, the digest's
  direct queue reads, the raw Web API format, and operator scripts. **Corrected above.**
- **Authoritative append "fsync": Refuted** — `CompletionStore` does not fsync (plain `fs.writeFile`),
  and "append fails → no Slack post" is overbroad for post-result transitions. **Contract 1 corrected.**
- **Publisher path: wrong** — it is `deploy/reminders-export/publish-reminders-export.mjs`, not
  `scripts/…`. **Fixed above (and in the P3 proposal).**
- **Authoritative Phase 1 additive: Uncertain** — true on the success path; append failure
  intentionally changes failure behavior (that is the point).

**Go/No-go (Codex round 1): No-go until those corrections land — applied.** 

### Round 2 (Codex, 2026-06-13)

Second pass confirmed the Round-1 fixes and went deeper. New findings, all applied above:
- **Read/write surface still incomplete** → added the internal `GetAllReminders` consumer (:492),
  `scripts/lists-harness.js`, `#GetRemindersInvolvingUserID`, the check-cycle direct queue reads, and
  `scripts/spike-github-url-extraction.js`.
- **Non-FSM writers (the big one)** → new [Write Surface](#write-surface--transitionreminderstate-is-not-the-only-write-codex-round-2) section + `ReminderSummaryUpdated` / `GitHubRelayToggled` events; "single emit point" corrected.
- **Schema omissions** → `ReminderCreated` gains `originalThreadTs`, `ignoreSnooze`, preserved `createdOn`; `ReminderBaselined` carries the full field set.
- **Partial-failure was a placeholder** → now DECIDED in Contract 1 (one-event-per-transition; recorded-after-effect posting; per-reminder batch isolation).
- **Durable append underspecified** → append-mode / single-owner / newline-delimited / parent-dir-`fsync` added.

Round-2 verdict was **No-go pending these — now applied.**

### Round 3 (Codex, 2026-06-13)

Third pass stress-tested the *decisions* (not completeness) and found correctness bugs in the round-2
semantics — all now fixed above:
- **D1/D2 — stranding bug:** logging `Posted`/`Rescheduled` separately could rebuild a reminder into
  `posted`/`rescheduled`, which the check cycle never re-processes → stranded forever. **Fixed:** events
  are resting-state outcomes; a successful post collapses to one `ReminderPostedAndRescheduled` (rebuild
  → `scheduled`).
- **D3 — concurrency:** `#WriteChain` serializes appends, not the read→append→mutate→cache sequence;
  handlers interleave across `await`. **Fixed:** Contract 1 now mandates one per-workspace critical
  section over the whole operation.
- **D4 — more non-FSM writes:** load-time enrichment also mutates `AssigneeID`/`OriginalChannelName`/
  `GitHubUrls`. **Fixed:** added to Write Surface + baseline.
- **D5 — baseline fidelity:** baseline must carry every persisted field incl. relay flags. **Fixed.**
- **D6:** `GitHubRelayToggled` made first-class (flags gate real GitHub comments).

Round-3 verdict was **No-go** pending these; now applied. The two correctness bugs (stranding,
torn-state interleaving) would have been production data-loss bugs surfacing only after code — exactly
what Phase 0 is for.

## The main emit point (why emission is localized, not why the migration is cheap)

| Gate | Location | Role |
|---|---|---|
| Creation | `#MakeScheduledReminder` — [reminders-module.js:435](../../src/reminders-module.js#L435) | Only constructor of a `ReminderInfo`; emits `ReminderCreated`. |
| Scheduling | `#TryScheduleRemindersAsync` — [reminders-module.js:1027](../../src/reminders-module.js#L1027) | AI/manual/forced scheduling; emits `ReminderScheduled`. |
| **All mid-life transitions** | `#TransitionReminderState` — [reminders-module.js:385](../../src/reminders-module.js#L385) | The **only** place `.State` changes. Already records completions to `CompletionStore` ([:407–410](../../src/reminders-module.js#L407)). This is the one place to emit `ReminderCompleted` / `Snoozed` / `Cancelled` / `Posted` / `Rescheduled` / `Failed` / `DeadLetter`. |
| Enforcement | [scripts/validate-fsm-invariants.js](../../scripts/validate-fsm-invariants.js) | Build-time guard: `.State` may only be assigned inside the two methods above. |

Because the contract is already structurally enforced, lifecycle event emission is localized inside an
approved method — no new `.State` bypass surface, and `validate:fsm` stays green by construction. This
does **not** make the whole source-of-truth migration cheap: non-state field writes, side effects,
baseline import, and concurrency still need their own contracts below. (One sanctioned exception, per
Codex: legacy-load **backfill** assigns `.State` at
[reminders-module.js:2102,2110](../../src/reminders-module.js#L2102) under a `// FSM-BACKFILL-OK`
pragma the validator allows ([validate-fsm-invariants.js:101–115](../../scripts/validate-fsm-invariants.js#L101)).
That backfill is exactly where Contract 3's `ReminderBaselined` synthetic event is emitted.)

## Read Inventory — every current reader that becomes a projection

**Corrected 2026-06-13 after independent Codex review** — the first pass missed several readers
(`GetAllReminders()` consumers, the digest's direct queue reads, the raw Web API format, and operator
scripts) and cited the wrong publisher path. Each reader is a future `reduce(events) → view`.

| Reader | Location | Reads | Becomes projection |
|---|---|---|---|
| `summarize-week` — completed | [reminders-app-mention-handler.js:912](../../src/reminders-app-mention-handler.js#L912) via `GetCompletedRemindersBetween` ([reminders-module.js:527](../../src/reminders-module.js#L527)) | `CompletionStore.GetCompletedBetween` | `reduce(events,[wkStart,wkEnd]) → completed` |
| `summarize-week` open / `show reminders` / search / per-channel | [reminders-app-mention-handler.js:858,880,938,1055,1182](../../src/reminders-app-mention-handler.js#L858) | pending queue (`GetPendingReminders`) | `reduce(events) → active` |
| Reaction handling | [reminders-reaction-handler.js:138,203](../../src/reminders-reaction-handler.js#L138) | pending queue | `reduce(events) → active` |
| AI pipeline (dedup/context) | [reminders-ai-pipeline.js:485](../../src/reminders-ai-pipeline.js#L485) | pending queue | `reduce(events) → active` |
| GitHub comment relay (URL match) | [github-comment-relay.js:90](../../src/github-comment-relay.js#L90) | pending queue | `reduce(events) → active by gh-url` |
| **`GetAllReminders()` consumers** (ALL states) | [reminders-module.js:474](../../src/reminders-module.js#L474); internal open-filter [:492](../../src/reminders-module.js#L492) → [github-sync-module.js:247](../../src/github-sync-module.js#L247), [lists-module.js:2738,2800](../../src/lists-module.js#L2738), [show-me-context.js:129](../../src/chat-commands/show-me-context.js#L129), [scripts/lists-harness.js:369,402](../../scripts/lists-harness.js#L369) | full reminder set | `reduce(events) → all reminders` |
| **Direct `#PendingRemindersQueue` readers** | digest/weekly [reminders-module.js:1870,1984](../../src/reminders-module.js#L1870); `#GetRemindersInvolvingUserID` [:966–990](../../src/reminders-module.js#L966); check-cycle mark/filter/delete [:2279,2302,2517](../../src/reminders-module.js#L2279) | `#PendingRemindersQueue` directly | `reduce(events) → active` |
| **Raw Web API** `GET /workspace/:name/reminders` (non-rebalance) | [web-api.js:855,878](../../src/web-api.js#L855) | filtered reminders | `reduce(events) → raw shape` |
| Rebalance export (`?format=rebalance`) | [web-api.js:397–460,857](../../src/web-api.js#L397) → [deploy/reminders-export/publish-reminders-export.mjs](../../deploy/reminders-export/publish-reminders-export.mjs) → `export-repo` | filtered reminders → JSON | `reduce(events) → rebalance shape` |
| Internal: completion capture / load / flush | [reminders-module.js:410,732,859](../../src/reminders-module.js#L410) | `CompletionStore` Record/Load/Flush | collapses into the log (Phase 5) |
| ⚠️ **Operator scripts that READ/WRITE reminder JSON** (bypass the FSM) | [scripts/reconstruct-github-reminders.js:16,142,157](../../scripts/reconstruct-github-reminders.js#L16); [scripts/spike-github-url-extraction.js:139,159](../../scripts/spike-github-url-extraction.js#L139) | read **and rewrite** `<ws>_reminders.json` | out-of-band repair tools — rebuild the log, never dual-write |

**Not a single seam** (correction). Reads flow through **two** in-memory accessors —
`GetPendingReminders` *and* `GetAllReminders` — plus `GetCompletedRemindersBetween`, plus **direct
`#PendingRemindersQueue` reads** in the digest, plus the raw + rebalance Web API exports. All are
repointable to projections (Phase 4), but the surface is larger than first claimed. The one genuine
wrinkle: **operator scripts mutate the reminder JSON directly, outside `#TransitionReminderState`** —
under P3 they must emit events through the FSM or be quarantined as log-rebuilding repair tools.

## Write Surface — `#TransitionReminderState` is not the only write (Codex round 2)

Correction to "single emit point": **`.State` changes funnel through `#TransitionReminderState`, but
other persisted reminder fields are mutated directly and saved via `#SaveRemindersAsync`, outside the
FSM.** Lifecycle-only events therefore cannot rebuild the JSON faithfully. Each needs its own event
(or an explicit "non-authoritative runtime cache" exclusion):

| Out-of-FSM write | Location | Field(s) | Decision |
|---|---|---|---|
| Slack-List summary edit | [reminders-module.js:620–624](../../src/reminders-module.js#L620) | `ReminderMessageText` | emit `ReminderSummaryUpdated` |
| GitHub relay toggles | [github-comment-relay.js:109,140](../../src/github-comment-relay.js#L109) | `GitHubRelayStopped` / `GitHubRelayStarted` | emit `GitHubRelayToggled` — **first-class** (Codex round 3 D6: they gate real GitHub comments) |
| Load-time enrichment self-updates | [reminders-module.js:2081–2095,2114–2132](../../src/reminders-module.js#L2081) | `AssigneeID`, `OriginalChannelName`, `GitHubUrls` | captured by the `ReminderBaselined` full-field payload (Contract 3); **before authoritative promotion, audit whether any of these also mutate at RUNTIME** — if so they need their own events |
| Snooze / reschedule date advance | inside `#CheckRemindersAsync` (`#AdvanceToNextNonSnoozeDay`) | `ShouldPostOn` | folded INTO the single `ReminderSnoozed` / `ReminderRescheduled` event (Contract 1) |
| Operator scripts (reconstruct, spike) | read inventory above | whole record | out-of-band; they rebuild the log, never dual-write |

**Consequence for testing:** the Phase-2 replay shadow-diff (R3) **must** include a summary edit and a
relay toggle, or a clean diff would be a false positive.

## Seam Map

| Subsystem | Entry points | Contract owner | Shared surfaces | Change under authoritative P3 |
|---|---|---|---|---|
| FSM transition chokepoint | reactions, commands, check-cycle, github-sync | `reminders-module.js` `#TransitionReminderState` | `ReminderState` enum; `ReminderInfo` shape | **Emit point** — append event (authoritative) before mutation |
| Reminder persistence | `#LoadRemindersAsync` / `#SaveRemindersAsync` | `reminders-module.js` (`#PendingRemindersQueue`, `<ws>_reminders.json`) | reminders JSON shape; `GetPendingReminders` callback | JSON becomes a **disposable cache** rebuilt from the log |
| CompletionStore | `Record` / `LoadAsync` / `GetCompletedBetween` / `FlushAsync` | [completion-store.js](../../src/completion-store.js) (`#WriteChain` = promise-serialization, **NOT fsync**) | `<ws>_completed.json`; `CompletionRecord` shape | Collapses into a **completed projection** (Phase 5); donates the **serialization** pattern — the log writer must **add real durability** the store lacks (`fs.open`+`appendFile`+`fsync`) |
| Read consumers | `summarize-week`, `show reminders`, search, reaction, ai-pipeline, gh-relay | the readers above | `GetPendingReminders`, `GetCompletedRemindersBetween` callbacks | Repoint callbacks to projections (Phase 4) |
| Downstream export | `?format=rebalance` | `web-api.js` builder ([:444](../../src/web-api.js#L444)) | rebalance JSON shape (byte-compat); `display.*` fields | Becomes a projection; **+ a new completion/event export** for rebalanceOS HiQS |

Cross-cutting: **boot** (`StartAsync` [:699](../../src/reminders-module.js#L699), load at [:788](../../src/reminders-module.js#L788)) and the **check cycle** (`#CheckRemindersAsync` [:2263](../../src/reminders-module.js#L2263)) are where most non-reaction transitions fire — both already route through `#TransitionReminderState`.

## Event Schema (Phase-0 draft — finalize at gate)

One JSON line per event in `data/runtime/events/<WORKSPACE>_events.jsonl`. Closed `type` enum
mirroring the FSM states. **Denormalize at event time** so replay never depends on live Slack/API state.

| Event | Required payload (beyond `v,id,ts,workspace,reminderId,type`) |
|---|---|
| `ReminderCreated` | `text, targetChannelId, originalChannelId, originalChannelName, originalMessageId, `**`originalThreadTs`**`, originalSenderId, assigneeId, githubUrls, `**`ignoreSnooze`**`, `**`createdOn`** (preserve original — Codex), `source` |
| `ReminderScheduled` | `shouldPostOn, via` (`ai`/`manual`/`force`) |
| **`ReminderPostedAndRescheduled`** *(single resting-state outcome of a successful post — Codex round 3; replaces separate `Posted`+`Rescheduled`, which could rebuild a reminder into `posted`/`rescheduled` — states the check cycle never re-processes → stranded)* | `postedChannelIds, postedAt, shouldPostOn` (next) |
| `ReminderSnoozed` *(single atomic event — carries the advanced date; NO separate `Scheduled`)* | `snoozeDay, advancedTo` |
| `ReminderCompleted` | `by, method` (`reaction`/`list`/`command`/`github-sync`), `summary, assigneeId, sourceChannelId, dueDate` (the `CompletionRecord` fields — see [completion-store.js](../../src/completion-store.js)) |
| `ReminderCancelled` / `ReminderFailed` / `ReminderDeadLetter` | `reason` (+ `method` for cancel) |
| **`ReminderSummaryUpdated`** *(non-lifecycle field mutation — Codex)* | `text` (new `ReminderMessageText`), `via` (`list-edit`) |
| **`GitHubRelayToggled`** *(non-lifecycle field mutation; **first-class** — relay flags control external GitHub comments, not display — Codex round 3 D6)* | `stopped` (bool) |
| **`ReminderBaselined`** *(synthetic, Contract 3)* | **EVERY persisted `ReminderInfo` field** — incl. `state, shouldPostOn`, relay flags (`gitHubRelayStopped/Started`), `assigneeId`, `originalChannelName`, `githubUrls` (Codex round 3 D5: behavior-affecting, must not be omitted) — so a log-only rebuild reproduces the live record exactly; `synthetic:true` |

Invariants: append-only; `ts` monotonic per workspace; `v` enables upcasting; `reminderId` ties a per-entity stream. The **delegation edge** (`assigneeId` vs `originalSenderId`) is first-class from day one — required by the rebalanceOS HiQS dropped-ball consumer. **Lifecycle events alone are insufficient (Codex):** the schema must also carry the non-lifecycle field mutations (`ReminderSummaryUpdated`, `GitHubRelayToggled`) or the rebuilt JSON drifts from the live cache. Each logical transition is **one** event — compound state pairs (snooze, reschedule) are collapsed so a single durable append is the atomic unit (no partial-pair stranding; see Contract 1). **Events are resting-state OUTCOMES, not transient micro-states (Codex round 3):** the check cycle's in-memory `Overdue`/`Posting`/`Posted`/`Rescheduled` are NEVER logged on their own — only the resting outcomes `ReminderSnoozed`, `ReminderPostedAndRescheduled`, `ReminderFailed`, `ReminderDeadLetter`. So a rebuild can never land in a transient state the check cycle won't re-process.

## Contract 1 — Authoritative durable append (the load-bearing rule)

```
append(event) durably (write + fsync) succeeds -> mutate #PendingRemindersQueue / write JSON cache / record completion
append(event) fails                            -> transition THROWS; no in-memory state advances; no cache write
```

- **No fsync exists today** (Codex correction): `CompletionStore` is promise-serialized **only** —
  [completion-store.js:134](../../src/completion-store.js#L134) is a plain `fs.writeFile`. Any ledger
  or event-store implementation must add a **real durable append** (`fs.open` + `appendFile` +
  `fsync`/`fdatasync`), reusing the `#WriteChain` *serialization* discipline but adding the durability
  the store lacks. **Round-2 specifics (Codex):** open in append mode with single-process ownership;
  write one newline-delimited record per append; `fsync` the parent directory when the log or a
  quarantine file is first created. `fsync` *reduces* loss but a crash can still leave a partial final
  line — so Contract 2 (tail quarantine) stays necessary, not redundant.
- Async/awaited boundary forces `#TransitionReminderState` async — **confirmed clean (R1)**. Today's
  completion capture is fire-and-forget ([reminders-module.js:407](../../src/reminders-module.js#L407));
  under authoritative P3 the append is awaited and authoritative. **Mutate-first + fire-and-forget
  would recreate the `CompletionStore.Record()` bug with a bigger name.**
- **Fail-closed stops the *side effect* only for PRE-effect transitions** — `Created`, `Scheduled`,
  `Completed`, `Cancelled`, `Snoozed`: the append precedes the effect, so a failed append leaves no
  trace. A *successful post* is recorded **after** the Slack I/O ([:2363–2451](../../src/reminders-module.js#L2363))
  as the single `ReminderPostedAndRescheduled` outcome; a *failed post* as `ReminderFailed`. A failed
  append there cannot un-post → **recorded-after-effect** (at-least-once delivery). So "append fails →
  no side effect" applies to pre-effect transitions only.
- **Events = resting-state outcomes, never transient micro-states — Codex round 3 (fixes a stranding
  bug).** The round-2 plan to log `Posted` then `Rescheduled` separately could rebuild a reminder into
  `posted`/`rescheduled` — states the check cycle never re-processes
  ([:2282–2307](../../src/reminders-module.js#L2282)) → **stranded forever.** Fix: a successful post is
  **one** event, `ReminderPostedAndRescheduled`, whose rebuild state is `scheduled` (next date);
  transient `Overdue`/`Posting` stay in-memory only. Every rebuilt state is then one the cycle handles:
  `scheduled`, `failed` (retried), `snoozed→scheduled`, or `dead-letter`/deleted. Same one-event
  collapse for snooze ([:2355→:2357](../../src/reminders-module.js#L2355)) and reschedule
  ([:2499→:2500](../../src/reminders-module.js#L2499)).
- **Recorded-after-effect, done right:** post → append the combined event. If the append fails, the
  rebuild stays `scheduled`+due → the next cycle re-posts (at-least-once = today's behavior). It is
  **not** stranded, because the resting state is `scheduled`, not `posted`.
- **One per-workspace critical section — Codex round 3 (D3, the subtle one).** `#WriteChain` serializes
  *appends*, not the `read → append → mutate → cache-write` sequence; across an `await`, two handlers
  (check-cycle timer + a reaction, or list-sync + github-sync) can interleave and tear the in-memory
  queue (Node single-threading does not protect state across `await`). **Rule: the entire
  `read → append → in-memory mutate → cache write` is one serialized per-workspace operation** (extend
  `#WriteChain` to wrap the whole op, or a per-workspace async mutex). Awaiting the append alone is
  insufficient.
- **Batch loops** (reaction IDs, check-cycle passes): per-reminder, each its own critical-section op —
  one bad append never strands the rest.

## Contract 2 — Corrupt-tail recovery

A crash mid-append can leave a partial last line. On load: parse line-by-line; if the **final** line
fails to parse, quarantine it (move to `<ws>_events.jsonl.corrupt-<ts>`) and continue from the last
valid line — never abort replay, never silently drop a mid-file line (a mid-file parse failure is a
hard error, not a tail-truncation, and must halt with a loud log).

## Contract 3 — Baseline-event strategy

Completion history before P3 cannot be recovered (it was never durably retained pre-v1.4.189, and
even after, only forward). For the **active queue**, on first run synthesize a `ReminderBaselined`
event per existing reminder from the current `<ws>_reminders.json` so a log-only rebuild (Phase 3)
reproduces the live queue. **Baseline payload = every persisted `ReminderInfo` field (Codex round 3),
not just the created subset** — relay flags, `assigneeId`, `originalChannelName`, `githubUrls`, and any
load-time-enriched field included, since they affect runtime behavior. Baseline events are marked
`synthetic:true` so projections can exclude them from "real activity" metrics.

## Contract 4 — Event validation (build + runtime)

- **Build:** decide whether [validate-fsm-invariants.js](../../scripts/validate-fsm-invariants.js)
  grows a payload-schema check or a dedicated validator runs in CI. Emission lives inside
  `#TransitionReminderState`, so the existing `.State`-assignment rule is unaffected — the new rule
  is "every emitted event matches the closed schema."
- **Runtime:** reject (throw, fail-closed per Contract 1) any event failing schema validation before
  append — a poison-pill event must never enter the log.

## Risk Table

| # | Risk | Mitigation | Pre-edit test (must pass first) |
|---|---|---|---|
| R1 | Async append boundary breaks synchronous callers of `#TransitionReminderState` | **RESOLVED 2026-06-13** (see [R1 Spike Result](#r1-spike-result-2026-06-13--the-async-boundary-is-clean-)): all ~13 callers are async + awaitable; only the single-consumer `=> void` reaction-handler callback needs a signature change. No cascading refactor. | `npx jest reminders-integration --forceExit` (57/57) — the lifecycle + new fake-timer gate tests |
| R2 | Fire-and-forget append silently recreates the lost-completion class | Ledger mode: append failures are observable and flushed; authoritative mode: Contract 1 fail-closed, **inject an append failure, assert no state advance** | Ledger append failure test + authoritative append-throws ⇒ transition throws, queue unchanged |
| R3 | Dual-write drift (log ≠ JSON) during Phases 1–4 | Shadow-diff the projection vs. JSON for a full week on `neochrome` before any cutover | `summarize-week` shadow diff = 0 over 7 days |
| R4 | Boot rebuild changes startup behavior (High-tier) | Phase 3 only; baseline events (Contract 3); stage to one workspace; cold-start parity check | Cold start from log-only reproduces prior in-memory queue on `neochrome` |
| R5 | Rebalance export byte-changes break rebalanceOS | Keep `?format=rebalance` byte-compatible; shadow-diff the JSON before cutover | Export diff = 0 vs. pre-P3 output |
| R6 | Replay cost grows unbounded | Snapshot + compaction (Phase 5); per-workspace volumes are tens–low-hundreds | Replay of full log < N ms budget at Phase 5 |
| R7 | Corrupt tail poisons replay | Contract 2 quarantine-tail policy + loud halt on mid-file corruption | Truncated-last-line fixture loads cleanly; mid-file corruption halts |
| R8 | Event schema mistake is permanent | Additive-only evolution; `v` + upcasters; schema reviewed at this gate | Schema review sign-off (this doc) |

## Compatibility Rules

These rules apply differently by track. For the recommended ledger track, the JSON files remain the
source of truth and the new log is additive. For the reserved authoritative track, the JSON files
eventually become derived caches.

1. **Add before remove.** Every phase ≤4 leaves the JSON write path intact; any phase reverts by deleting new code.
2. The JSON files remain **readable** caches through Phase 4; they stop being *trusted* at Phase 3 and stop being *written* at Phase 5 (after a one-release rollback window).
3. The `?format=rebalance` export contract is **frozen** until a shadow-diff proves byte-compatibility; the new completion/event export is **additive** beside it.
4. `GetPendingReminders` / `GetCompletedRemindersBetween` callback signatures are **frozen** — repoint their *implementations* to projections, never change the seam.
5. No event emission may bypass `#TransitionReminderState` / `#MakeScheduledReminder` — `validate:fsm` must stay green every phase.
6. `data/runtime/events/` + the `replay` CLI are new operator surfaces — document in README (ARCHITECTURE.md is regenerated) and operator notes before Phase 3.

## Rollout Invariants (machine-checkable, hold after every phase)

1. `npx jest --forceExit` green (1105+/… ; web-api port tests need un-sandboxed `listen`).
2. `npm run validate:fsm` OK.
3. `npm run build` (tsc) clean.
4. `summarize-week` output unchanged for users until its projection cutover (Phase 2 shadow-diff = 0).
5. `?format=rebalance` output byte-identical until Phase 4 cutover.
6. Reaction-driven complete/cancel still works (harness lifecycle tests).
7. The natural check cycle still posts due reminders / honors snooze (v1.4.191 fake-timer gate tests).
8. On `development` merge, service restarts onto the new commit (`journalctl --unit=sleuth-app`: start-time vs commit-time).

## Recommended Phase 1 Slice — non-authoritative ledger

This is the preferred resume point. It answers the original product need without promoting the log to
source of truth.

1. **`EventLedger.AppendAsync`** — new durable JSONL writer: append-mode file handle, one
   newline-delimited record per append, `fsync`/`fdatasync`, parent-dir `fsync` on first create, and a
   serialized write chain. This is a side ledger, not the reminder-state owner.
2. **Completion events first** — append `ReminderCompleted` records at the existing completion
   chokepoint. Do not boot from this log; do not fail unrelated Slack lifecycle behavior because the
   side ledger is down. Keep `CompletionStore` until a shadow diff proves the ledger can replace it.
3. **HiQS/export surface** — add the completion/event export needed by rebalanceOS beside the existing
   `?format=rebalance` export. Existing raw/rebalance reminder exports remain JSON-backed.
4. **Shadow projection** — fold the ledger into "completed this week" and compare against
   `CompletionStore` for a real week before switching `summarize-week`.
5. **Operational guardrails** — add flush-on-shutdown for the ledger, corrupt-tail load tests, and a
   warning/metric for append failures. Since this is not source-of-truth yet, an append failure is an
   observability incident, not a reason to strand Slack reminder behavior.

This slice should not require the per-workspace critical section, resting-state event taxonomy,
baseline events, or boot rebuild. Those are reserved for authoritative promotion.

## Reserved Authoritative Slice — only after re-approval

Do this only when the owner explicitly decides to make the event log the source of truth for reminder
state. At that point every edge in Contracts 1–4 is mandatory.

1. **Promote `EventLedger` to `EventStore`** — same durable writer, but now the append is the
   authoritative write.
2. **Wrap state mutations in one per-workspace critical section** — `read → append → in-memory mutate
   → cache write` is serialized as a unit. A serialized append alone is insufficient.
3. **Emit source-of-truth events** from `#TransitionReminderState`, `#MakeScheduledReminder`, and each
   non-FSM mutation site (`ReminderSummaryUpdated`, `GitHubRelayToggled`, baseline/backfill).
4. **Add `ReminderBaselined` import** carrying every persisted `ReminderInfo` field before any
   log-only boot.
5. **Run replay parity** against the live JSON and `?format=rebalance` export before trusting the log
   at startup.

## Cross-Subsystem Dependencies (phase ordering)

- Ledger writer (append+fsync) → completion/event ledger: the writer must be durable before any
  user-facing history depends on it.
- Completion ledger shadow-diff → `summarize-week` cutover: prove a week of parity before reading the
  ledger in the command.
- Authoritative decision gate → Contracts 1–4: do not spend the critical-section/baseline/replay cost
  until source-of-truth promotion is explicitly approved.
- Baseline events (Contract 3) → boot rebuild (reserved): the live queue cannot rebuild without a
  full-field starting point.
- summarize-week projection proven → remaining projections + export shadowing.
- All authoritative projections proven → retire mutable writes + snapshotting.

## Phase 0 QA Checklist

- [ ] Decision recorded: non-authoritative ledger now vs. authoritative source-of-truth promotion.
- [ ] Read inventory validated against the live codebase before any authoritative projection work.
- [ ] Event schema reviewed and frozen as additive-only for the slice being built.
- [ ] Authoritative append+fsync write-order contract (Contract 1) accepted before any boot-rebuild work; the async-boundary blast radius (R1) on `#TransitionReminderState` callers is enumerated.
- [ ] Corrupt-tail policy (Contract 2) accepted for the ledger; baseline strategy (Contract 3) accepted before boot rebuild.
- [ ] Event-validation approach (Contract 4) decided: extend `validate-fsm-invariants.js` vs. dedicated validator.
- [ ] Rollout invariants are each backed by a runnable check before implementation starts.
- [ ] Recommended Phase 1 slice order confirmed; `feat/event-sourced-core` is the branch.
