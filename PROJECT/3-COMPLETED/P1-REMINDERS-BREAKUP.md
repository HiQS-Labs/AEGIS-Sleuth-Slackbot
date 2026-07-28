# P1: RemindersModule Final Breakup

Status: In Progress

> **Preceded by:** [P1-GEMINI-3-AUDIT.md](./P1-GEMINI-3-AUDIT.md) — the original DRY/SOLID audit that produced `RemindersRepository`, `RemindersScheduler`, `RemindersFSM`, and `RemindersSlackUI`. This doc picks up the remaining seams.

---

## Table of Contents

1. [High-Level Phased Checklist](#high-level-phased-checklist)
2. [Context](#context)
3. [User-Filtered Reminder Query Trace](#user-filtered-reminder-query-trace-2026-03-24)
4. [Extraction Queue](#extraction-queue)
   - [Phase 1: Channel Settings](#1-reminders-channel-settingsjs--start-here)
   - [Phase 2: AI Pipeline](#2-reminders-ai-pipelinejs)
   - [Phase 3: Reaction Handler](#3-reminders-reaction-handlerjs)
   - [Phase 4: App Mention Handler](#4-reminders-app-mention-handlerjs-optional-high-value)
5. [Deferred Follow-Ups](#deferred-follow-ups)
6. [Architecture Guardrails](#architecture-guardrails)

---

## High-Level Phased Checklist

**⚠️ LLM Note:** Continuously mark off items below as progress is made. Update this section after each phase completion.

### Phase 1: Channel Settings Extraction
**Risk:** 🟢 Low | **Effort:** 🟢 Low | **Est. Time:** 1–2 hours

- [x] Create `src/reminders-channel-settings.js`
- [x] Update `RemindersModule.StartAsync` to instantiate and load it
- [x] Replace all `#EnabledChannels` / `#EnabledChannelsFilePath` references
- [x] Add unit tests to `tests/reminders-channel-settings.test.js`
- [x] Verify `npm run build` passes
- [x] Verify `npm test` passes

**Status:** ✅ COMPLETE

---

### Phase 2: AI Pipeline Extraction
**Risk:** 🟡 Medium | **Effort:** 🟡 Medium | **Est. Time:** 3–4 hours

- [x] Create `src/reminders-ai-pipeline.js`
- [x] Pass `WorkspaceAI` and `GetPendingReminders` callback at construction
- [x] Update `#TryScheduleRemindersAsync` to call `this.#AIPipeline.*`
- [x] Migrate typedef shapes into the new file
- [x] Add unit tests to `tests/reminders-ai-pipeline.test.js`
- [x] Log dead code issue for `#CheckForDuplicateReminderAsync` as follow-up
- [x] Verify `npm run build` passes
- [x] Verify `npm test` passes

**Status:** ✅ COMPLETE

---

### Phase 3: Reaction Handler Extraction
**Risk:** 🟡 Medium | **Effort:** 🟡 Medium | **Est. Time:** 2–3 hours

- [x] Create `src/reminders-reaction-handler.js` using dependency-bag pattern
- [x] Document snooze guard bypass in `#HandleAlarmClockReactionAsync`
- [x] Wire into `RemindersModule` constructor
- [x] Add unit tests to `tests/reminders-reaction-handler.test.js`
- [x] Verify `npm run build` passes
- [x] Verify `npm test` passes

**Status:** ✅ COMPLETE

---

### Phase 4: App Mention Handler Extraction (Optional, High Value)
**Risk:** 🟢 Low | **Effort:** 🟡 Medium | **Est. Time:** 3–4 hours

- [x] Create `src/reminders-app-mention-handler.js`
- [x] Move all `#HandleShow*Async` methods and debug commands
- [x] Update `RemindersModule` app mention wiring to delegate
- [x] Add unit tests to `tests/reminders-app-mention-handler.test.js`
- [x] Cross-check [P1-SEARCH-REMINDERS.md](./P1-SEARCH-REMINDERS.md) alignment
- [x] Verify `npm run build` passes
- [x] Verify `npm test` passes

**Status:** COMPLETED

---

### Post-Extraction Verification
**Risk:** 🟢 Low | **Effort:** 🟢 Low | **Est. Time:** 1 hour

- [x] ~~Confirm `RemindersModule` is down to ~550–600 lines~~ — Actual: **1,908 lines**. The 550–600 estimate assumed all display/search logic would leave the module, but three shared helpers (`#HandleShowRemindersListAsync`, `#BuildCompactTextForReminder`, `#GetRemindersForUserID`) remain because the daily digest still calls them. The scheduling pipeline, reminder composition, persistence layer, and daily digest account for the rest. Down from ~2,750 pre-Phase 3 — a ~45% total reduction across all four phases.
- [x] Run full test suite: `npm test` — 200 tests, 15 suites, all passing
- [x] Run type check: `npm run build` — clean
- [x] Manual smoke test in Slack workspace — ✅ 2026-03-26: wastebasket reaction cancel and `show my reminders` verified on local dev instance
- [x] Update `CHANGELOG.md` with extraction summary
- [x] Increment version in `package.json` — bumped to 1.4.50

**Status:** ✅ COMPLETE

---

## Context

As of 2026-03-19, `src/reminders-module.js` is approximately **2,000 lines** after four extractions. The remaining responsibilities that still violate SRP are:

- Reaction handling (emoji-driven lifecycle transitions)
- AI pipeline (GPT-powered extraction, date parsing, deduplication)
- Channel settings persistence (`_enabled_channels.json`)
- App mention command handlers (`#HandleShow*Async` variants, debug commands)

After all four extractions the orchestration core (`#TryScheduleRemindersAsync`, event dispatch, lifecycle) is estimated at **~550–600 lines** — an appropriate size for a true coordinator class.

## User-Filtered Reminder Query Trace (updated 2026-03-25)

End-to-end trace of every code path that returns reminders filtered by user. Use this as a regression checklist when modifying `#GetRemindersForUserID` or any "show/search reminders" handler.

### Query Paths

| Command | Handler | Collection method | Created-by | Assigned-to | Mentioned-in | Sender-mention excluded |
|---|---|---|---|---|---|---|
| `show reminders for @user` | `#HandleShowRemindersForUserAsync` | `#GetRemindersTargetingUserID(target)` | NO | YES | — | — |
| `show reminders @user only` | `#HandleShowRemindersForUserAsync` | `#GetRemindersTargetingUserID(target)` | NO | YES | — | — |
| `show reminders of @user` | `#HandleShowRemindersForUserAsync` | `#GetRemindersTargetingUserID(target)` | NO | YES | — | — |
| `search reminders for @user` | `#HandleSearchRemindersForUserAsync` | `#GetRemindersForMention` → `#GetRemindersTargetingUserID` | NO | YES | — | — |
| `show my reminders` | `#HandleShowMyRemindersAsync` | `#GetRemindersTargetingUserID(user)` | NO | YES | — | — |
| `search my reminders` | `#HandleSearchMyRemindersAsync` | `#GetRemindersInvolvingUserID(user)` | YES | YES | YES | N/A |
| Daily digest | `#RunDailyTaskDigestAsync` | `#BuildReminderMapByUser` → `#GetRemindersTargetingUserID` | NO | YES | — | — |
| Deterministic API | `ShowRemindersForUserDeterministicAsync` | `#HandleShowRemindersForUserAsync` | NO | YES | — | — |

"Targeting" queries use the O(1) `#RemindersByAssignee` index — no queue scan. "Involving" queries (broad search) still scan the queue for text mentions after exhausting index lookups.

**Intentional asymmetry:** `search my reminders` uses the broad `#GetRemindersInvolvingUserID` for wider keyword search scope (you want to find a task you created even if it's assigned away). `show my reminders` uses the narrow `#GetRemindersTargetingUserID` — it shows only reminders where you are the assignee.

### Key implementation details

- **Sender always embedded in reminder text:** `#ComposeReminderMessageAsync` prepends `<@SenderID>` to every reminder message. "Targeting" queries ignore text mentions entirely — they use only `AssigneeID`, so the sender mention no longer causes false-positives.
- **O(1) `#RemindersByAssignee` map lookup:** `#GetRemindersTargetingUserID` reads directly from the `#RemindersByAssignee` index — no queue scan. The index is maintained in `#BuildReminderIndexes` (full rebuild on load) and `#QueueReminderAsync` (incremental on creation).
- **`AssigneeID` always non-null:** `#TryScheduleRemindersAsync` now defaults `AssigneeID` to `OriginalSenderID` when extraction finds no explicit target. This makes the index authoritative and eliminates the need for text-scan fallbacks in targeting queries.
- **`@username` fallback:** When Slack doesn't resolve a mention to `<@userid>`, only text search against `ReminderMessageText` is possible — no created-by or assignee matching. This path is unchanged in `#GetRemindersForMention`.

### Known inconsistency — RESOLVED (1.4.51, Phase 5)

The original `#GetRemindersForUserID(bool)` was split into `#GetRemindersTargetingUserID` (O(1) assignee index) and `#GetRemindersInvolvingUserID` (broad scan) in v1.4.51, eliminating the boolean-flag ambiguity that caused the recurring "show my reminders" bug.

### Fix attempt history — "show my reminders / show reminders for @user" filtering bug

This bug was subtle and required four attempts across multiple sessions. Documented here as a regression reference.

| Attempt | Version | Commit | What changed | Why it was still wrong |
|---|---|---|---|---|
| 1 | 1.4.47 | `297deb3` | Added sender-exclusion guard to `#GetRemindersForUserID` so "show reminders for @user" excluded creator-only matches. "show my reminders" intentionally left unchanged — assumed "created + assigned" was the right behavior for self-queries. | "show my reminders" still returned tasks the user created for others. |
| 2 | 1.4.48 | `b0055bc` | Fixed two regressions from attempt 1: re-added `ArgIncludeCreated` param so "search my reminders" recovered created-by scope; fixed mentioned-but-not-assigned users being silently dropped when `AssigneeID` existed. | `ArgIncludeCreated=true` was now the path for "show my reminders" too, keeping the leak. |
| 3 | 1.4.48 | `93a5b85` | Replaced inline logic in `#HandleShowMyRemindersAsync` with `#GetRemindersForUserID(user, true)` — a recommendation written into this doc in the same commit. | The recommendation itself was wrong. `ArgIncludeCreated=true` makes every reminder from `#RemindersBySender` visible regardless of assignee — exactly the wrong set for "show my reminders". |
| 4 | 1.4.49 | `current` | `#HandleShowMyRemindersAsync` calls `#GetRemindersForUserID(user)` without `ArgIncludeCreated`. | — |
| 5 | 1.4.51 | Phase 5 | Split `#GetRemindersForUserID(bool)` into `#GetRemindersTargetingUserID` + `#GetRemindersInvolvingUserID`. Boolean flag eliminated entirely. | Final resolution. |

**#lessonslearned:** "show my reminders" means "reminders targeting me", not "reminders I've ever touched". The `ArgIncludeCreated` flag is appropriate only for keyword search (where you want to find a task regardless of who it was assigned to), not for the default list view. When in doubt, `show my reminders` should behave identically to `show reminders for @me`. Boolean-flag functions whose callers cannot be trusted to use the right value are a maintenance hazard — split early, name clearly.

---

## Extraction Queue

### 1. `reminders-channel-settings.js` — Start here

**Effort:** Low | **Risk:** Low

The cleanest lift. Fully analogous to `RemindersRepository` — owns one JSON file, has no AI or FSM dependency, only needs the logger.

**Methods to move:**

| Method | Current lines (approx) |
|--------|------------------------|
| `#LoadEnabledChannelsAsync` | ~25 |
| `#SaveEnabledChannelsAsync` | ~17 |
| `#EnableRemindersForChannelAsync` | ~9 |
| `#DisableRemindersForChannelAsync` | ~8 |
| `#AreRemindersEnabledForChannel` | ~3 |

**Fields to move:** `#EnabledChannelsFilePath`, `#EnabledChannels`

**Constructor pattern:** Follow `RemindersRepository` exactly — `constructor(ArgSlackApp, ArgFilePath)`.

- [ ] Create `src/reminders-channel-settings.js`
- [ ] Update `RemindersModule.StartAsync` to instantiate and load it
- [ ] Replace all `#EnabledChannels` / `#EnabledChannelsFilePath` references with `this.#ChannelSettings`
- [ ] Add unit tests to `tests/reminders-channel-settings.test.js` (ENOENT, enable/disable round-trip, save failure)

---

### 2. `reminders-ai-pipeline.js`

**Effort:** Medium | **Risk:** Medium

Owns the six instruction/schema fields and all GPT interactions. Stateful (loaded schemas persist across calls), so this is a class, not a static module.

**Methods to move:**

| Method | Current lines (approx) |
|--------|------------------------|
| `#LoadInstructionsAndSchemaAsync` | ~44 |
| `#AnalyzeMessageForRemindersAsync` | ~26 |
| `#ExtractDateWithGptAsync` | ~80 |
| `#CheckForDuplicateReminderAsync` | ~57 |

**Fields to move:** `#RemindersInstructions`, `#RemindersSchema`, `#DateExtractionInstructions`, `#DateExtractionSchema`, `#DedupInstructions`, `#DedupSchema`

**Dependencies:** `WorkspaceAI`, `SlackApp` (logger + timezone), `DateUtils`, `fs`/`path`, `GetPendingReminders` callback.

**Known issue to flag (do not fix silently):** `#CheckForDuplicateReminderAsync` contains a dead code branch — the GPT dedup path is unreachable due to an early return. Log as a separate issue in this doc after extraction; do not fix it as part of the extraction commit.

- [x] Create `src/reminders-ai-pipeline.js`
- [x] Pass `WorkspaceAI` and a `GetPendingReminders` callback at construction
- [x] Update `#TryScheduleRemindersAsync` to call `this.#AIPipeline.*` instead of private methods
- [x] Migrate `typedef` shapes (`GptReminderInfo`, `GptReminderResponse`, `DateExtractionResult`, `GptDateExtractionResult`) into the new file
- [x] Add unit tests to `tests/reminders-ai-pipeline.test.js`
- [x] Log dead code issue for `#CheckForDuplicateReminderAsync` as a follow-up item below

---

### 3. `reminders-reaction-handler.js`

**Effort:** Medium | **Risk:** Medium

Handles emoji reactions that drive user-initiated lifecycle transitions. Follows the `RemindersScheduler` dependency-bag injection pattern.

**Methods to move:**

| Method | Current lines (approx) |
|--------|------------------------|
| `#OnReactionAddedAsync` (dispatcher) | ~17 |
| `#HandleWhiteCheckMarkReactionAsync` | ~37 |
| `#HandleAlarmClockReactionAsync` | ~19 |
| `#HandleWastebasketReactionAsync` | ~35 |

**Dependencies (via bag):** `SlackApp`, `RemindersFSM`, `GetPendingReminders`, `DeleteRemindersAsync`, `TryScheduleRemindersAsync`, `ListsModule` reference.

**Snooze guard note:** `#HandleAlarmClockReactionAsync` routes to `#TryScheduleRemindersAsync` and intentionally bypasses the scheduler's snooze guard (alarm_clock is explicit user intent). This bypass must be documented in a comment at the call site in the new module.

- [x] Create `src/reminders-reaction-handler.js` using dependency-bag pattern
- [x] Document snooze guard bypass in `#HandleAlarmClockReactionAsync`
- [x] Wire into `RemindersModule` constructor — replace direct handler registration
- [x] Add unit tests to `tests/reminders-reaction-handler.test.js`

---

### 4. `reminders-app-mention-handler.js` (optional, high value)

**Effort:** Medium | **Risk:** Low

The largest remaining block (~430 lines). All `#HandleShow*Async` command variants and GitHub debug commands registered via `AppMentionCommandRegistry`.

**Dependencies:** `SlackApp`, `RemindersSlackUI`, read-only queue access, channel-enable callbacks.

**Note:** Only tackle after #1–3 are stable. `RemindersModule` is down to ~550–600 lines at that point; this extraction is valuable but not blocking.

- [x] Create `src/reminders-app-mention-handler.js`
- [x] Move all `#HandleShow*Async` methods and debug commands
- [x] `RemindersModule` app mention wiring delegates to the new handler
- [x] Add unit tests to `tests/reminders-app-mention-handler.test.js`
- [x] Move search commands (`search reminders`, `search my reminders`, `search reminders for @user`, `search reminders here`) alongside the other `#HandleShow*Async` methods — these already shipped on `development` and are included in this branch

---

### Phase 5. `#GetRemindersForUserID` — Split, index, and harden

**Effort:** Low | **Risk:** Low | **Motivation:** 4-attempt regression history (see Fix Attempt History above)

The boolean flag `ArgIncludeCreated` silently changes the semantics of this function — "reminders targeting me" vs. "reminders I've ever touched" — and every regression to date traced back to a caller choosing the wrong mode. This phase eliminates the flag and adds a proper `AssigneeID` index so filtering no longer requires full-queue scans or text-scan fallbacks.

> **⚠️ Phase 4 architectural impact (verified 2026-03-25):** Phase 4 moved `#HandleShow*Async` and the search handlers to `src/reminders-app-mention-handler.js`. Because `#GetRemindersForUserID` is a private method, Phase 4 copied the full implementation into the handler class at line 705. **`reminders-module.js` now owns only 2 of the original 6 call sites** (the definition at line 692 + `#BuildReminderMapByUser` at line 1248); the other 4 are in the handler.
>
> Additionally, the 1.4.49 fix that removed `ArgIncludeCreated=true` from `#HandleShowMyRemindersAsync` was applied to `reminders-module.js` — but the handler that actually runs the command is in `reminders-app-mention-handler.js` at line 687, which was still calling `#GetRemindersForUserID(user, true)`. **✅ Fixed (commit `13a1945`):** line 687 now calls `#GetRemindersForUserID(user)` with no `ArgIncludeCreated`, matching the original 1.4.49 intent. Proceed with the rename steps below.

#### Change 1 — Split into two named functions

| New function | Replaces | Intent |
|---|---|---|
| `#GetRemindersTargetingUserID(ArgUserID)` | `#GetRemindersForUserID(userId)` (default) | Show view: assignee or mentioned as target; never creator-only |
| `#GetRemindersInvolvingUserID(ArgUserID)` | `#GetRemindersForUserID(userId, true)` | Search view: broad — assignee, mentioned, OR creator |

Callers to update:

| Caller | File | Current call | New call |
|---|---|---|---|
| `#HandleShowRemindersForUserAsync` | handler | `#GetRemindersForUserID(target)` | `GetRemindersTargetingUserID(target)` (callback) |
| `#HandleShowMyRemindersAsync` | handler | `#GetRemindersForUserID(user, true)` ⚠️ **bug** | `GetRemindersTargetingUserID(user)` (callback) |
| `#GetRemindersForMention` | handler | `#GetRemindersForUserID(userId)` | `GetRemindersTargetingUserID(userId)` (callback) |
| `#HandleSearchMyRemindersAsync` | handler | `#GetRemindersForUserID(user, true)` | `GetRemindersInvolvingUserID(user)` (callback) |
| `#BuildReminderMapByUser` (daily digest) | module | `#GetRemindersForUserID(userId)` | `#GetRemindersTargetingUserID(userId)` |

The handler call sites must receive the two functions as **dependency-bag callbacks** (same pattern as `GetPendingReminders`, `TryScheduleRemindersAsync`, etc.) — they cannot call private module methods directly. The single implementation lives in `reminders-module.js`; the duplicate in the handler is removed.

#### Change 2 — Add `#RemindersByAssignee` index

Currently the only secondary index is `#RemindersBySender`. Assignee lookups scan the full `#PendingRemindersQueue` which forces the text-scan `IsMentioned` fallback for any reminder without an explicit `AssigneeID`.

- Add `#RemindersByAssignee = new Map()` alongside `#RemindersBySender` in `#BuildReminderIndexes()`
- Populate it in `#QueueReminderAsync` (same pattern as `#RemindersBySender`)
- Update `#DeleteRemindersAsync` / `#CancelReminderAsync` to remove entries from the new index
- `#GetRemindersTargetingUserID` can then do a direct map lookup for `AssigneeID` matches instead of scanning the queue

#### Change 3 — Default `AssigneeID = OriginalSenderID` at creation time

`AssigneeID` is currently nullable and backfilled at load time for legacy records. Defaulting it to `OriginalSenderID` when no explicit assignee is detected makes every reminder's ownership unambiguous at creation:

- Update `#TryScheduleRemindersAsync` where `NewReminderInfo` is built: `AssigneeID: AssigneeID ?? ArgUserID`
- Remove the text-scan `IsMentioned` fallback from `#GetRemindersTargetingUserID` (it becomes dead code once `AssigneeID` is always set)
- The load-time backfill in `#LoadRemindersAsync` can remain for legacy JSON records

#### Checklist

**Pre-requisite — fix the immediate bug first:**
- [x] `reminders-app-mention-handler.js` line 687: change `#GetRemindersForUserID(ArgEventInfo.user, true)` → `#GetRemindersForUserID(ArgEventInfo.user)` (no `ArgIncludeCreated`) to restore the 1.4.49 fix that was lost when the handler was extracted in Phase 4

**Rename and split (in `reminders-module.js`):**
- [x] Rename `#GetRemindersForUserID` → `#GetRemindersTargetingUserID`; remove `ArgIncludeCreated` parameter
- [x] Add `#GetRemindersInvolvingUserID` with the broad logic (sender bucket + assignee + mentioned)
- [x] Update `#BuildReminderMapByUser` (the only remaining module call site) to `#GetRemindersTargetingUserID`

**Eliminate the duplicate (in `reminders-app-mention-handler.js`):**
- [x] Add `GetRemindersTargetingUserID` and `GetRemindersInvolvingUserID` as callbacks to the dependency bag in `reminders-module.js`
- [x] Wire the callbacks in `RemindersModule` constructor: `GetRemindersTargetingUserID: (id) => this.#GetRemindersTargetingUserID(id)`, etc.
- [x] Replace the 4 handler call sites to use the new callbacks (see table above)
- [x] Remove the duplicate `#GetRemindersForUserID` implementation from `reminders-app-mention-handler.js`
- [x] Remove `#GetRemindersBySender` from the handler dependency bag (no longer needed once duplicate is gone)

**Index and harden:**
- [x] Add `#RemindersByAssignee` map to `#BuildReminderIndexes`, `#QueueReminderAsync`, and deletion paths
- [x] Default `AssigneeID = OriginalSenderID` in the `NewReminderInfo` object in `#TryScheduleRemindersAsync`
- [x] Remove `IsMentioned` text-scan fallback from `#GetRemindersTargetingUserID` after confirming `AssigneeID` is always set (`#GetRemindersTargetingUserID` is now a pure index lookup)

**Doc and test:**
- [x] Update the Query Paths table in this doc to reflect the new function names
- [x] Update the "No AssigneeID index" note in Key Implementation Details to "O(1) `#RemindersByAssignee` map lookup"
- [x] Verify all existing tests pass; add a targeted regression test for the "show my reminders does not return creator-only tasks" invariant — 5/5 tests passing

---

### 5. `#GetRemindersForUserID` — Split, index, and harden

**Effort:** Low | **Risk:** Low | **Motivation:** 4-attempt regression history (see Fix Attempt History above)

The boolean flag `ArgIncludeCreated` silently changes the semantics of this function — "reminders targeting me" vs. "reminders I've ever touched" — and every regression to date traced back to a caller choosing the wrong mode. This phase eliminates the flag and adds a proper `AssigneeID` index so filtering no longer requires full-queue scans or text-scan fallbacks.

All 6 call sites and both implementations are fully contained within `src/reminders-module.js`. No external callers.

#### Change 1 — Split into two named functions

| New function | Replaces | Intent |
|---|---|---|
| `#GetRemindersTargetingUserID(ArgUserID)` | `#GetRemindersForUserID(userId)` (default) | Show view: assignee or mentioned as target; never creator-only |
| `#GetRemindersInvolvingUserID(ArgUserID)` | `#GetRemindersForUserID(userId, true)` | Search view: broad — assignee, mentioned, OR creator |

Callers to update:

| Line (approx) | Caller | New call |
|---|---|---|
| `#HandleShowRemindersForUserAsync` | `#GetRemindersForUserID(target)` | `#GetRemindersTargetingUserID(target)` |
| `#HandleShowMyRemindersAsync` | `#GetRemindersForUserID(user)` | `#GetRemindersTargetingUserID(user)` |
| `#GetRemindersForMention` | `#GetRemindersForUserID(userId)` | `#GetRemindersTargetingUserID(userId)` |
| `#BuildReminderMapByUser` (daily digest) | `#GetRemindersForUserID(userId)` | `#GetRemindersTargetingUserID(userId)` |
| `#HandleSearchMyRemindersAsync` | `#GetRemindersForUserID(user, true)` | `#GetRemindersInvolvingUserID(user)` |

#### Change 2 — Add `#RemindersByAssignee` index

Currently the only secondary index is `#RemindersBySender`. Assignee lookups scan the full `#PendingRemindersQueue` which forces the text-scan `IsMentioned` fallback for any reminder without an explicit `AssigneeID`.

- Add `#RemindersByAssignee = new Map()` alongside `#RemindersBySender` in `#BuildReminderIndexes()`
- Populate it in `#QueueReminderAsync` (same pattern as `#RemindersBySender`)
- Update `#DeleteRemindersAsync` / `#CancelReminderAsync` to remove entries from the new index
- `#GetRemindersTargetingUserID` can then do a direct map lookup for `AssigneeID` matches instead of scanning the queue

#### Change 3 — Default `AssigneeID = OriginalSenderID` at creation time

`AssigneeID` is currently nullable and backfilled at load time for legacy records. Defaulting it to `OriginalSenderID` when no explicit assignee is detected makes every reminder's ownership unambiguous at creation:

- Update `#TryScheduleRemindersAsync` where `NewReminderInfo` is built: `AssigneeID: AssigneeID ?? ArgUserID`
- Remove the text-scan `IsMentioned` fallback from `#GetRemindersTargetingUserID` (it becomes dead code once `AssigneeID` is always set)
- The load-time backfill in `#LoadRemindersAsync` can remain for legacy JSON records

#### Checklist

- [ ] Rename `#GetRemindersForUserID` → `#GetRemindersTargetingUserID`; remove `ArgIncludeCreated` parameter
- [ ] Add `#GetRemindersInvolvingUserID` with the existing broad logic (sender bucket + assignee + mentioned)
- [ ] Update all 5 non-search call sites to `#GetRemindersTargetingUserID`
- [ ] Update `#HandleSearchMyRemindersAsync` to `#GetRemindersInvolvingUserID`
- [ ] Add `#RemindersByAssignee` map to `#BuildReminderIndexes`, `#QueueReminderAsync`, and deletion paths
- [ ] Default `AssigneeID = OriginalSenderID` in the `NewReminderInfo` object in `#TryScheduleRemindersAsync`
- [ ] Remove `IsMentioned` text-scan fallback from `#GetRemindersTargetingUserID` after confirming `AssigneeID` is always set
- [ ] Update the Query Paths table in this doc to reflect the new function names
- [ ] Update the "No AssigneeID index" note in Key Implementation Details to "O(1) `#RemindersByAssignee` map lookup"
- [ ] Verify all existing tests pass; add a targeted regression test for the "show my reminders does not return creator-only tasks" invariant

---

## Deferred Follow-Ups

Migrated from [P1-GEMINI-3-AUDIT.md](./P1-GEMINI-3-AUDIT.md):

- [ ] **DRY: Path Joining Patterns** — `path.join(__dirname, '..', 'data', 'runtime', ...)` repeated across `diagnostics.js`, `chat-module.js`, `workspaces.js`. Centralize in `workspaces.js`.
- [ ] **Isolated test seam for `#GetNextNonSnoozeDate()` edge cases** — currently only tested indirectly through `CheckRemindersAsync()`.
- [ ] **Replace test-channel suppression heuristic** — `OriginalChannelName.toLowerCase().includes('test')` should become an explicit workspace-level exclusion list.
- [ ] **Reminder `State` encapsulation** — direct mutation is unsupported by convention only; cannot be enforced without a representation change.
- [ ] **Compound FSM transition logging volume** — multi-step normalization logs each edge; may warrant a higher-level wrapper if volume becomes distracting in production.

New follow-ups (identified during this phase):

- [ ] **Dead code in `#CheckForDuplicateReminderAsync`** — the GPT dedup branch (lines ~1812–1830 in current `reminders-module.js`) is unreachable due to an early return at the preceding line. Investigate and either fix or remove during a dedicated pass after AI pipeline extraction.
- [ ] **`IsTerminalState()` in `RemindersFSM` is defined but never called** — either wire it into `PrepareForSnooze`/`PrepareForPosting` as a guard, or remove it.
- [x] **Reminder search parity** — search commands shipped on `development` and are included in this branch. No porting needed.
- [ ] **DRY: Shared display helpers duplicated across `RemindersModule` and `RemindersAppMentionHandler`** — `#HandleShowRemindersListAsync`, `#BuildCompactTextForReminder`, and `#GetRemindersForUserID` exist in both files because the daily digest (`#RunDailyTaskDigestAsync`) in `RemindersModule` still calls them. Extract into a shared utility (e.g. `reminders-display-utils.js`) or extract the daily digest into its own module so the helpers can live in one place.

---

## Architecture Guardrails

- **Snooze guard invariant:** Any code path that posts reminders must either go through `RemindersScheduler` (which enforces the snooze check) or explicitly document the bypass reason. `HandleAlarmClockReactionAsync` is an approved bypass (user-explicit intent).
- **Dependency direction:** `RemindersModule` → extracted modules. No extracted module may import `RemindersModule` directly; callbacks/bags only.
- **Pattern references:** Use `RemindersRepository` as the structural template for `reminders-channel-settings.js`. Use `RemindersScheduler` as the template for dependency-bag injection in `reminders-reaction-handler.js` and `reminders-ai-pipeline.js`.
- **Constructor injection: pass `SlackApp`, not individual pieces.** All extracted modules receive the full `SlackApp` instance (not just the logger). This is consistent with `RemindersRepository`, `RemindersScheduler`, and `RemindersChannelSettings`. `SlackApp` is already a focused wrapper — not a god object — and passing it avoids growing parameter lists when a module later needs `WorkspaceInfo`, `BotUserID`, or other properties. `MockSlackApp` keeps test setup trivial. Decision made 2026-03-25.

---

## Phase 1 Completion Report (2026-03-25)

### Summary
✅ **Phase 1 successfully completed.** Extracted channel settings management into a dedicated `RemindersChannelSettings` class.

### Files Created
1. **`src/reminders-channel-settings.js`** (127 lines)
   - Manages per-channel reminder enable/disable settings
   - Owns the enabled channels JSON file
   - Public methods: `LoadEnabledChannelsAsync()`, `SaveEnabledChannelsAsync()`, `AreRemindersEnabledForChannel()`, `EnableRemindersForChannelAsync()`, `DisableRemindersForChannelAsync()`
   - No external dependencies beyond `fs.promises` and logger

2. **`tests/reminders-channel-settings.test.js`** (160 lines)
   - 11 comprehensive unit tests covering all public methods
   - Tests for file I/O, error handling (ENOENT, invalid JSON), empty files, and duplicate operations
   - All tests passing ✅

### Files Modified
1. **`src/reminders-module.js`**
   - Added import: `const RemindersChannelSettings = require('./reminders-channel-settings');`
   - Replaced `#EnabledChannelsFilePath` and `#EnabledChannels` fields with single `#ChannelSettings` instance
   - Updated `StartAsync()` to instantiate `RemindersChannelSettings`
   - Updated `StopAsync()` to call `this.#ChannelSettings.SaveEnabledChannelsAsync()`
   - Updated `#OnMessageAsync()` to use `this.#ChannelSettings.AreRemindersEnabledForChannel()`
   - Updated app mention handler to use `this.#ChannelSettings.EnableRemindersForChannelAsync()` and `DisableRemindersForChannelAsync()`
   - Removed 4 private methods: `#LoadEnabledChannelsAsync()`, `#SaveEnabledChannelsAsync()`, `#AreRemindersEnabledForChannel()`, `#EnableRemindersForChannelAsync()`, `#DisableRemindersForChannelAsync()`
   - **Net reduction: ~95 lines removed from RemindersModule**

### Test Results
- ✅ All 11 new channel settings tests pass
- ✅ All 171 total tests pass (no regressions)
- ✅ Type check passes (`npm run build`)

### Key Findings & Adaptations for Phase 2+

#### 1. **Extraction Pattern Validated**
The `RemindersChannelSettings` pattern works well and should be replicated for Phase 2 (AI Pipeline). Key success factors:
- Single responsibility (file I/O + state management for one concern)
- Constructor injection of dependencies (SlackApp for logging, FilePath for persistence)
- Public methods with clear naming (no `#` prefix for public API)
- Comprehensive error handling (ENOENT, invalid JSON, uninitialized paths)

#### 2. **RemindersModule Size Reduction**
- **Before Phase 1:** ~2,000 lines
- **After Phase 1:** ~1,905 lines (95 lines removed)
- **Estimated after all 4 phases:** ~550–600 lines (as originally planned)

#### 3. **No Breaking Changes**
- All existing call sites updated seamlessly
- No changes to public API of `RemindersModule`
- File persistence format unchanged (backward compatible)

#### 4. **Recommendations for Phase 2 (AI Pipeline)**

The AI pipeline extraction will be more complex than Phase 1 due to:
- **Stateful schema loading** — 6 instruction/schema fields that persist across calls
- **Multiple dependencies** — `WorkspaceAI`, `SlackApp`, `DateUtils`, `fs`, `path`
- **Callback injection** — Will need `GetPendingReminders` callback to avoid circular dependency

**Suggested approach:**
- Follow the same constructor-injection pattern as `RemindersChannelSettings`
- Pass `WorkspaceAI` and `GetPendingReminders` callback at construction
- Keep schema loading lazy (load on first use, cache thereafter)
- Add comprehensive tests for each AI method (analyze, extract date, check dedup)

#### 5. **Known Issue Flagged (Not Fixed)**
As noted in the original doc, `#CheckForDuplicateReminderAsync` contains unreachable code (GPT dedup branch). This was intentionally left unfixed during Phase 1 extraction to keep the scope focused. **Recommend investigating and fixing in a dedicated follow-up after Phase 2 is stable.**

#### 6. **Test Harness Observations**
- The `MockLogger` in `tests/mocks/mock-slack-app.js` works well for capturing log output in tests
- File-based testing (creating temp files, cleaning up) is straightforward with Jest
- No issues with test isolation or cleanup

### Next Steps
1. Begin Phase 2 (AI Pipeline extraction) using the validated pattern from Phase 1
2. Adapt the AI pipeline extraction plan based on findings above
3. After Phase 2 is stable, investigate and fix the dead code in `#CheckForDuplicateReminderAsync`
4. Continue with Phase 3 (Reaction Handler) and Phase 4 (App Mention Handler)
