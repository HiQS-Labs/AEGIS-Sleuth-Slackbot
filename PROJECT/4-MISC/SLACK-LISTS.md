# Slack Lists Audit & Sync Plan

Date: 2026-05-13 (audit) · 2026-05-14 (sync plan added, action items resolved)

Status: source of truth for Slack Lists work. The original audit findings (1–8) have all been resolved — see "What To Change First — RESOLVED". The `docs/slack-lists-*.md` files are now accurate implementation-level references; this file remains the strategy/plan SOT. The "Findings" section below is kept as a historical record of the 2026-05-13 audit.

Scope: audit of Sleuth's current Slack Lists integration against Slack's currently published Lists API docs checked on 2026-05-13, plus a forward design plan for making per-user lists a bi-directional sync target.

## Verdict

The integration is only partially aligned with the published Slack Lists API.

What looks sound:
- The published Lists API is real and public. Slack announced it on September 2, 2025.
- `slackLists.create`, `slackLists.items.create`, and `slackLists.items.list` are real method names.
- The item-create path in [`src/lists-module.js`](../../src/lists-module.js) mostly follows the documented `initial_fields` + `column_id` shape.

What is not sound:
- Update and delete calls do not match Slack's current request contract.
- List creation/access management mixes documented Lists methods with undocumented or generic file-sharing behavior.
- Cached-list verification relies on an undocumented `slackLists.info` method.
- The read/validation path is out of sync with the documented `items.info` response shape.
- The repo's Slack Lists docs materially overstate correctness.

## Findings

### 1. Critical: item update payload does not match the published API

Code:
- [`src/lists-module.js:914`](../../src/lists-module.js#L914)

Current implementation:
- Sends `slackLists.items.update` with `{ list_id, item_id, item }`.

Published Slack contract:
- `slackLists.items.update` requires `{ list_id, cells: [...] }`.
- Each cell update needs a `row_id` plus a `column_id` and a type-specific value payload.

Impact:
- Reminder status syncs such as `MarkReminderCompletedAsync()` and `MarkReminderPostedAsync()` are not using a valid request shape.
- Even if the list exists and scopes are correct, update calls should fail or be ignored by Slack.

### 2. High: item delete payload uses the wrong parameter name

Code:
- [`src/lists-module.js:947`](../../src/lists-module.js#L947)

Current implementation:
- Sends `slackLists.items.delete` with `{ list_id, item_id }`.

Published Slack contract:
- `slackLists.items.delete` requires `{ list_id, id }`.

Impact:
- Reminder deletion from Lists is not aligned with the documented API and is likely broken.

### 3. High: list creation/access flow uses undocumented `channel_id` and bypasses the official access API

Code:
- [`src/lists-module.js:421`](../../src/lists-module.js#L421)
- [`src/lists-module.js:507`](../../src/lists-module.js#L507)

Current implementation:
- Sends `channel_id` to `slackLists.create`.
- Then tries `files.sharedPublicURL` and `files.share`.

Published Slack contract:
- `slackLists.create` documents `name`, `description_blocks`, `schema`, `copy_from_list_id`, `include_copied_list_records`, and `todo_mode`.
- Channel/user access management is documented under `slackLists.access.set`, not as a `channel_id` creation argument.

Impact:
- Creation may fail on `channel_id` as an invalid argument.
- Even if creation succeeds, channel access is being managed outside the documented Lists contract.

### 4. High: cached-list verification depends on an undocumented method

Code:
- [`src/lists-module.js:567`](../../src/lists-module.js#L567)
- [`src/lists-module.js:595`](../../src/lists-module.js#L595)

Current implementation:
- Verifies cached list IDs via `slackLists.info`.

Published Slack method family:
- The current family documents:
  - `slackLists.access.delete`
  - `slackLists.access.set`
  - `slackLists.create`
  - `slackLists.download.get`
  - `slackLists.download.start`
  - `slackLists.items.create`
  - `slackLists.items.delete`
  - `slackLists.items.deleteMultiple`
  - `slackLists.items.info`
  - `slackLists.items.list`
  - `slackLists.items.update`
  - `slackLists.update`
- There is no published `slackLists.info`.

Impact:
- Existing cached lists may be treated as missing even when they still exist.
- This can cause unnecessary list recreation and cache churn.

### 5. Medium: roundtrip validation reads the wrong response field from `items.info`

Code:
- [`src/lists-module.js:872`](../../src/lists-module.js#L872)

Current implementation:
- Calls `slackLists.items.info`, then reads `Response.item`.

Published Slack contract:
- `slackLists.items.info` returns the list metadata under `list` and the row under `record`.

Impact:
- Roundtrip validation should report false negatives even when the row exists.
- That makes post-write validation noisy and untrustworthy.

### 6. Medium: field model drift between list schema and list update/read logic

Code:
- Schema creation: [`src/lists-module.js:437`](../../src/lists-module.js#L437)
- Completion update path: [`src/lists-module.js:983`](../../src/lists-module.js#L983)
- Validation assumptions: [`src/lists-module.js:1425`](../../src/lists-module.js#L1425)

Current implementation:
- Created schema keys are `summary`, `assignee`, `due_date`, `created_on`, `source_channel`, `original_message`, `requester`, and `reminder_id`.
- Update logic tries to write `status` and `todo_completed`.
- Validation logic still checks legacy-style fields such as `scheduled_time`, `todo_completed`, and `todo_due_date`.

Impact:
- The module is not internally consistent even before comparing it to Slack's API.
- Polling and write-back behavior can disagree about what fields actually exist in the List.

### 7. Medium: availability check hides configuration errors as feature unavailability

Code:
- [`src/lists-module.js:270`](../../src/lists-module.js#L270)

Current implementation:
- Treats `missing_scope` as "Lists not available."

Published Slack contract:
- `missing_scope` means the app token lacks the required scope.
- `lists:read` and `lists:write` are separate published scopes with specific compatible methods.

Impact:
- Paid workspace + misconfigured app can be misdiagnosed as unsupported feature.
- Operators lose the signal that the fix is app scopes/reinstall, not workspace plan.

### 8. Medium: internal Slack Lists docs are stale and in several places incorrect

Docs:
- [`docs/slack-lists-research-findings.md:81`](../../docs/slack-lists-research-findings.md#L81)
- [`docs/slack-lists-implementation-notes.md:31`](../../docs/slack-lists-implementation-notes.md#L31)
- [`docs/slack-lists-next-steps.md:5`](../../docs/slack-lists-next-steps.md#L5)

Examples of drift:
- They claim the implementation is "correct" overall.
- They reference nonexistent or stale calls such as `slackLists.list` / `lists.list`.
- They show outdated item payload shapes using `item: { ... }` instead of `initial_fields` for creates and `cells` for updates.
- They present the main remaining problem as scopes/rate limiting, when request-shape mismatches are the bigger issue.

Impact:
- The repo's written guidance currently points future work in the wrong direction.

## What To Change First — RESOLVED (1.4.107 + 2026-05-14 cleanup)

All five action items have been addressed. Findings 1–7 were closed by the `1.4.107` API-alignment work; the residual legacy-field cleanup (Finding 6) and the doc reconciliation (Finding 8) were closed on 2026-05-14. Status of each:

### 1. Rewrite update/delete around the documented row/cell model — ✅ done

- `UpdateReminderInListAsync` builds `cells` via `#BuildUpdateCells` and sends `{ list_id, cells }` ([`src/lists-module.js`](../../src/lists-module.js)).
- `#BuildUpdateCells` uses cached column IDs from `#ListSchema` and the row ID from `#ItemCache` as `row_id`.
- `DeleteReminderFromListAsync` sends `{ list_id, id }`.

### 2. Fix creation/access around the documented Lists surface — ✅ done

- `slackLists.create` no longer sends `channel_id`; it sends `name` + `schema` only.
- The shared workspace list grants the reminder channel `read` access, while each per-user list grants the assignee `write` access and the invocation channel a secondary `read` share for discovery.
- `list_id` and the extracted schema map are still persisted to the per-workspace cache.

### 3. Stop using undocumented `slackLists.info` — ✅ done

- `#VerifyListExistsAsync` verifies a cached `list_id` with `slackLists.items.list`. No `slackLists.info` references remain in `src/`.

### 4. Unify the schema and the reminder sync model — ✅ done

- The module committed to the **custom-columns** path: schema includes a `status` (`select`) and `completed` (`checkbox`) column, and `#BuildUpdateCells` / `MarkReminderCompletedAsync` write those keys.
- 2026-05-14 cleanup removed the dead legacy read/fallback branches (`todo_completed`, `todo_due_date`, `scheduled_time`) from `#ValidateListItem` and `#BuildUpdateCells` — no such columns exist in the current schema.

### 5. Reconcile the Slack Lists docs under `docs/` — ✅ done

- The `docs/slack-lists-*.md` files have been rewritten to describe the `1.4.107` contract accurately (correct method family, `cells` updates, `{ list_id, id }` deletes, `record` readback, current custom-column schema). They are no longer stale and did not need archiving.
- This file remains the single source of truth and forward plan; the `docs/` files are the implementation-level reference.

## Bi-Directional Sync: Design Plan

Goal: turn the per-user list into a 1:1 bi-directional mirror of that user's Sleuth reminders.

### Current state

The integration is **output-only by design**, but the inbound scaffolding already exists and is deliberately stubbed:
- A polling loop runs every 5 min ([`src/lists-module.js:1442`](../../src/lists-module.js#L1442)).
- It already diffs added/updated/deleted rows ([`#DetectChanges`](../../src/lists-module.js#L1482)) and routes them to handlers.
- All three handlers — [`#HandleAddedListItemAsync`](../../src/lists-module.js#L1761), [`#HandleUpdatedListItemAsync`](../../src/lists-module.js#L1775), [`#HandleDeletedListItemAsync`](../../src/lists-module.js#L1788) — are no-ops that log "reminders JSON is the source of truth."

So bi-directional is not a from-scratch build; it is filling in those three handlers plus fixing the broken write path above.

### Key design facts

- **Reminder lifecycle is delete-on-terminal.** Per the FSM in [`src/reminders-module.js:97-118`](../../src/reminders-module.js#L97-L118), both `completed` (white_check_mark) and `canceled` (wastebasket) are terminal log-only states; the reminder is deleted from JSON immediately. There is no persisted "done" archive.
- **`CompleteReminderByIdAsync` already exists** ([`src/reminders-module.js:381`](../../src/reminders-module.js#L381)) and is the natural target for an inbound checkbox event.
- **Reminder summary text is now mutable at the list-title level.** Per-user row `summary` edits now sync back into Sleuth's persisted reminder summary and mirror out to the other list contexts that track that reminder. The broader reminder envelope (quoted source message, canonical reminder composition) is still Sleuth-owned; the mutable surface is the task-title summary, not arbitrary free-form body editing.
- **A new list row has no reminder context.** A reminder needs `ShouldPostOn`, `TargetChannelID`, `OriginalChannelID`, and the source message link; a fresh row has only text + maybe a date. Reminders are normally born from a Slack message.

### Decisions to lock before building

1. **Per-user list naming.** Make the list durable per person — drop the `YYYY-MM-DD` date stamp from [`#BuildUserSnapshotListNameAsync`](../../src/lists-module.js#L633). A daily-rotating list cannot be a sync target. Use `Sleuth Reminders — @username` as the display title, but key the persisted cache on the **user ID** (usernames change; titles are display-only, not the mapping contract).

Decision: Yes, correct.

2. **Completed-row behavior.** Because Sleuth keeps no archive, the list itself becomes the history record. On inbound completion, Sleuth should mark the row done and stop managing it — **not** delete it. Confirm this is desired before Phase 1.

Decision: Yes, correct. One time completion is ok for now. We may revisit this later.

3. **Conflict model.** With two writers, define the rule. Recommended: structured-state fields are last-write-wins by timestamp; task-title summary edits from a managed per-user row can flow back into Sleuth, while the broader reminder envelope stays Sleuth-owned.

Decision: Yes, go with recommendation.

### Phased plan

**Prerequisite — fix the audit write-path bugs.** Items 1–3 of "What To Change First" are hard blockers; outbound writes are currently broken, so there is nothing reliable to sync against.

**Phase 1 — inbound state sync (complete + delete).**
- Implement `#HandleUpdatedListItemAsync`: map a checked completion cell to `CompleteReminderByIdAsync`.
- Implement `#HandleDeletedListItemAsync`: map a deleted row to reminder cancel.
- Make the per-user list durable (decision 1).
- Low conflict risk, delivers most of the value.

**Phase 2 — inbound row creation.**
- Implement `#HandleAddedListItemAsync`: synthesize a reminder from a defined minimum column contract (summary + due_date + assignee + target channel), with validation and defaults.
- Write `reminder_id` back into the new row so it does not re-trigger as "new" on the next poll.
- This is the most complex piece; defer until Phase 1 is stable.

## Audit Notes

- I could not verify the app's actual OAuth scope configuration from the repo because there is no local manifest file checked in here.
- I also did not verify live runtime behavior against a real paid Slack workspace in this pass. This audit is against the published API contract and the current code/docs only.
- Blast radius is contained to one file. A scan of the local ask_self index ([`data/rag/sleuth-rag.sqlite`](../../data/rag/sleuth-rag.sqlite)) shows every `slackLists.*` API call lives in [`src/lists-module.js`](../../src/lists-module.js); other files that mention "Slack Lists" ([`src/reminders-module.js`](../../src/reminders-module.js), [`src/reminders-reaction-handler.js`](../../src/reminders-reaction-handler.js), [`src/slack-format-utils.js`](../../src/slack-format-utils.js), [`AGENTS.md`](../../AGENTS.md)) only reference it in prose. The fixes in "What To Change First" do not need to fan out beyond `lists-module.js`.

## Sources

- Slack changelog, "Introducing the Lists API" (published 2025-09-02):
  - https://docs.slack.dev/changelog/2025/09/02/list-api/
- Slack Lists surface overview:
  - https://docs.slack.dev/surfaces/lists/
- `slackLists.create`:
  - https://docs.slack.dev/reference/methods/slackLists.create/
- `slackLists.access.set`:
  - https://docs.slack.dev/reference/methods/slackLists.access.set/
- `slackLists.items.create`:
  - https://docs.slack.dev/reference/methods/slackLists.items.create/
- `slackLists.items.update`:
  - https://docs.slack.dev/reference/methods/slackLists.items.update/
- `slackLists.items.delete`:
  - https://docs.slack.dev/reference/methods/slackLists.items.delete/
- `slackLists.items.info`:
  - https://docs.slack.dev/reference/methods/slackLists.items.info/
- `slackLists.items.list`:
  - https://docs.slack.dev/reference/methods/slackLists.items.list/
- `lists:read` scope:
  - https://docs.slack.dev/reference/scopes/lists.read/
- `lists:write` scope:
  - https://docs.slack.dev/reference/scopes/lists.write/
