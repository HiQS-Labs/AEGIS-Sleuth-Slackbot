# GH-250 Phase 4 — store the task structure next to the legacy text

- Issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/250 (phase 4 of the simplification plan; reopened 2026-10-20)
- Branch: `docs/AEGIS-Sleuth-Slackbot-gh250-store-structure-2026-10-20` off `origin/development` 50fa08c
- Doc type: plan only. Implementation starts after #250 phase 3 lands (owned by a separate session) and this plan passes review.
- Rating: rated 60/45/55/70 (value/risk/effort/confidence), provisional — touches the stored reminder shape and the P3 event ledger; every display surface benefits.

## Status

| Step | State |
|---|---|
| Recon (write path, ledger, consumers) | done — see "Recon" and the #250 inventory comment |
| Plan | drafted |
| Plan QA (Codex relay) | 7 rounds; r7 fix accepted by operator-authorized override (`PROJECT/RELAY/gh-250-phase4-plan-qa.md`); implementation final QA re-checks requirement 5's dashboard branch |
| Implementation | blocked on #250 phase 3 |

## Problem

A reminder's tasks are decided once, then stored only as formatted Slack mrkdwn inside
`ReminderMessageText`: a composed header and optional quote, then `\n\nKey task(s):` and one `• <task>`
line per task, each optionally followed by an italic context line
(`src/reminders-module.js:2045-2058`). Every surface that needs the task text re-parses that string by
regex. #250's inventory counts the re-parsers as items 27–31; phase 6 deletes them, which is only safe
once the structure itself is stored. This phase stores it.

## Recon

Full consumer inventory: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/250#issuecomment-6308099892
(writers, ~25 in-repo readers, ~8 rebalanceOS readers, 9 test files). What it changes here:

- **Writers:** two creation sites (`src/reminders-module.js:2052-2060` stored at :2134; List row at
  :1184-1196) and one edit site (`ReplaceReminderSummary` via the Slack Lists edit at :1145). Pass-through copies (event payload
  :775, completion summary :591/:723, projection, state snapshot, reminders-export) carry the string
  as-is and keep doing so.
- **Readers that gain a structured branch in this phase** (the ones that break without the block):
  `ExtractKeyTasks` users (`lists-module.js:1339` summary column; drift compare `lists-module.js:2720`,
  `reminders-module.js:1140`), `ExtractKeyTaskSummaries`/`ExtractCompactSummary` users
  (`reminders-display-utils.js:307,356`; `web-api.js:597,1085,1137`), `ExtractReminderTitle`
  (`show-me-projects-command.js:211`, `reminder-clustering.js:181`).
- **Readers left alone:** raw-text model/keyword consumers (dedup prompt, search, MCP store,
  talk-to-reminders) — the text is unchanged; quote-boundary readers (`ExtractQuotedOriginalMessage`,
  assignee extraction) — unaffected.
- **Published contract:** `?format=rebalance` `display.summary` / `display.slackSummary` are read by
  rebalanceOS (`scripts/dashboard.py:739-753`, `pulse_web.py:1660`). They stay, computed through the
  compact-line rule; `tasks` is added to each record additively. rebalanceOS's two regex copies
  (`ingest/sleuth_grouping.py`, `ingest/slack_users.py:281`) keep working (text unchanged) and move to
  `display.summary`/`tasks` in a separate rebalanceOS issue.
- **Legacy strings are permanent** in completion records, event ledgers and the published export, so
  phase 6 keeps one legacy parser as the else-branch; this phase must not assume it can go.
- **Latent edge:** `ReplaceReminderSummary` (`slack-format-utils.js:302`) replaces the whole string when
  the `Key task(s):` marker is absent (dropping header, quote, permalink). Only List-row reminders lack
  the marker today, where it is harmless; this phase adds no marker-less writer.

## Requirements

1. **One new optional field, written at both creation sites.** `ReminderInfo.Tasks`:
   `Array<{ title: string, context?: string }>`, in display order.
   - Message path (`src/reminders-module.js:2045-2058` -> `#MakeScheduledReminder` at :2126): built in
     the same reduce that composes the `Key task(s):` block, from the same `#SelectReminderTaskText` /
     `#SelectReminderContextLine` values, so the field and the text cannot disagree at birth.
   - **`context` is data, not presentation:** the semantic italic fragment with no leading newline or
     indentation (e.g. `_before Friday_`), omitted when empty. `#SelectReminderContextLine`
     (:2631-2649) is split so it returns the fragment and the composer adds `\n  ` only when writing
     the legacy text — the legacy bytes stay identical.
   - Slack List row path (`CreateReminderFromListRowAsync`, :1184-1196): `[{ title: Summary }]` (that
     path stores the bare summary as `ReminderMessageText`, with no `Key task(s):` block).
   Absent on records that predate the change (no backfill required).
2. **Dual-write, legacy text unchanged.** `ReminderMessageText` keeps exactly its current bytes, so
   every existing reader, the rollback binary and external consumers keep working.
3. **Every mutation of the task text updates both, as a whole.** The only post-creation writer is
   `UpdateReminderSummaryFromListAsync` (`src/reminders-module.js:1127-1153`, Slack Lists edit). The
   List column flattens every bullet and context into one summary (`ExtractKeyTasks`), and
   `ReplaceReminderSummary` (`src/slack-format-utils.js:302-326`) rewrites ALL bullets from the new
   summary's normalized lines. So the edit replaces the whole `Tasks` array, atomically, from those
   same lines: extract the line normalization inside `ReplaceReminderSummary` into one exported
   helper (`NormalizeSummaryLines(summary) -> string[]`), have `ReplaceReminderSummary` use it, and
   set `Tasks = lines.map(title => ({ title }))` (no contexts — the rewritten text has none). Only
   when the reminder already had `Tasks`; an old record stays field-less. No other writer exists:
   `rg 'ReminderMessageText\s*='` finds only the creation compose (:2046-2052), the Lists edit
   (:1145) and the projection's rehydrate (`src/reminders-projection.js:321`), which requirement 4
   covers.
4. **Ledger: additive keys and one forward-ignorable update event.**
   - **`tasks` follows the existing `NotifyIDs` path at every ledger touchpoint** (swept with
     `rg "notifyIds|NotifyIDs|BaselineReminderImported" src scripts deploy`), each conditional so absent
     stays absent:
     1. creation payload — `src/reminders-module.js:786` (`ReminderCreated`);
     2. compaction — `src/state-snapshot-writer.js:173-185` (`BuildCompactedEvents` ->
        `BaselineReminderImported`), plus its folded-reminder typedef;
     3. baseline import — `scripts/baseline-import.js:159-175` (`BaselineReminderImported`);
     4. fold — `src/reminders-projection.js:392` (`WhenRecorded(Payload, 'tasks', 'Tasks', …)`) and
        the late-baseline merge at `:333-336` (fill `Tasks` from a later same-id creation-shaped event
        only when the reminder lacks it);
     5. `tests/projection-coverage-gate.test.js` — register the new key and event so the gate covers them.
     Not changed: `deploy/reminders-export/events-projection.js` and `src/entity-projection-inputs.js`
     read creation events but carry no optional reminder fields today (no `notifyIds` either); the
     export gets `tasks` from `?format=rebalance` (requirement 5). No schema-version bump:
     `REQUIRED_PAYLOAD_KEYS` (`src/event-store.js:39,44`) is a minimum.
   - **List edits are ledgered.** Today `UpdateReminderSummaryFromListAsync` rewrites the text and
     only saves (`src/reminders-module.js:1145-1149`); no event reaches the fold, so the projection
     already drifts from the store after any List edit (pre-existing). Add one event type,
     `ReminderSummaryUpdated`, payload `{ text }` plus `tasks` only when present, registered in
     `REQUIRED_PAYLOAD_KEYS` with `['text']`, emitted after the successful edit through the existing
     `#EmitLifecycleEvent`, and folded by replacing `ReminderMessageText` and — only when the payload
     has `tasks` — `Tasks` (absent stays absent). Older binaries skip unknown event types on read
     and keep using the byte-identical JSON text on rollback.
   - Parity fixtures: creation + update folds to exactly the edited text and `Tasks`; an unedited
     creation needs no update event and stays byte-identical.
5. **Readers: structured when present, otherwise exactly today's code.** Every moved reader takes the
   same shape as `ListSummaryFor`: `reminder.Tasks ? <structured value> : <the legacy function it
   calls today, unchanged>`. There is no generic parser fallback, so every legacy shape — bulleted,
   unquoted long, and the bare List-row summary with no marker (`src/reminders-module.js:1184-1196`) —
   renders exactly as now.
   - Compact/digest lines (`reminders-display-utils.js:302-309`): `Tasks[0].title`, else
     `ExtractCompactSummary(text)`.
   - Delivery extra subtasks (`:353-363`): `Tasks.slice(1).map(t => t.title)`, else
     `ExtractKeyTaskSummaries(text).slice(1)`.
   - show-me-projects / clustering (`show-me-projects-command.js:209-215`, `reminder-clustering.js:181`):
     `Tasks[0].title`, else `ExtractReminderTitle(text)`.
   - Admin dashboard, active reminders (`src/web-api.js:1080-1085`, `#BuildDashboardReminderExportAsync`):
     decided from the SOURCE reminder, not the exported record: `HasStructuredTasks(reminder) ?
     reminder.Tasks[0].title : ExtractCompactSummary(reminder.ReminderMessageText)`. The lowercase
     `tasks` key exists only on the public export; no internal reader branches on it. The completion-history row (`:1117-1139`) stays on
     its current text-only parser: completion records never receive `Tasks`.
   - One helper, `HasStructuredTasks(reminder)` (`Array.isArray(reminder.Tasks) && reminder.Tasks.length
     > 0`), is the only branch condition.
   **Export handoff:** the `?format=rebalance` record builder (`src/web-api.js:485-517`) copies
   `Tasks` to a `tasks` property only when present (omitted for old records); `display.summary` /
   `display.slackSummary` (`:597`, `:625-638`) use the compact-line rule above, so they are
   byte-identical for old records.
   **Slack Lists summary keeps contexts.** The List column and its drift compare
   (`src/lists-module.js:1339-1343,2720-2723`) use one function, `ListSummaryFor(reminder)`: when the
   reminder has `Tasks`, `FormatTasksAsListSummary(Tasks)` joins each `title` and non-empty `context`
   with single spaces exactly as `ExtractKeyTasks` folds the legacy block
   (`src/slack-format-utils.js:272-289`); when it has no `Tasks` (every pre-phase record), it returns
   `ExtractKeyTasks(ReminderMessageText)` unchanged (never a title-only form, which drops contexts).
   Either way the summary string is the one today's code produces, so reconciliation sees no false
   edit. The legacy parsers stay as the else-branches (one of them permanently, see Recon).
6. **#261 ratchet:** `key_task_reparse_sites` must not rise. It does not fall in this phase (the
   parsers remain as else-branches); it falls in phase 6.

## Non-goals

- Deleting any parser (phase 6), backfilling old records, changing `ReminderMessageText`, changing
  the Slack Lists column contract, structured owner/due fields (owner and due are already fields).

## Preflight bet

- Outcome: the task text is read from data, not recovered from a rendered string.
- Smallest bet: one optional field + one branch helper + one List formatter + one creation key + one
  update event, written at the two creation sites and the one edit site.
- Rejected: a full structured `ReminderView` object or a migration of stored records — both add a
  second source of truth or a one-way data change before the readers need it.
- Rollback: older binaries ignore the extra field and payload key (both optional and additive);
  `ReminderMessageText` is unchanged, so rolling back loses nothing. Last safe rollback point: any.

## Risks

- **Drift between field and text** if a new writer edits one but not the other. Mitigation:
  requirement 3 names every writer; a test asserts both change together on the Lists edit path.
- **Projection parity** if the payload key is emitted unconditionally. Mitigation: conditional key,
  parity harness in verification.
- **External consumers** of the text (see Recon) keep working because the text is unchanged; the
  ones that would benefit from `Tasks` are listed, not changed here.

## Verification

- Focused: `npx jest tests/reminders-integration.test.js tests/reminders-projection*.test.js
  tests/lists-*.test.js` plus the display-utils suite.
- `npm run projection:parity`, `npm run decision:replay`, `npm run validate:fsm`,
  `npm run validate:reminder-pipeline` (#261), then the full CI gate once.
- Pinned ledger cases: compacting a structured reminder through `BuildCompactedEvents` emits
  `payload.tasks` and folds back to the identical `Tasks`; compacting an old reminder omits both; a
  baseline-import of a structured record carries `tasks`; a `ReminderCreated` without `tasks` followed by
  a same-id `BaselineReminderImported` with `tasks` folds to that `Tasks` (late-baseline merge).
- Pinned dashboard cases: active source reminder `{Tasks:[{title:'Ship'}], ReminderMessageText:'legacy
  text'}` shows `Ship` (and its exported record carries `tasks:[{title:'Ship'}]`); active `{ReminderMessageText:'Review release notes'}` keeps its text-derived title; a completion
  row `{summary:'Finished task'}` still uses its legacy parser.
- Pinned legacy-shape cases: a pre-phase List-row reminder `{ReminderMessageText:'Review release
  notes'}` (no `Tasks`, no marker) renders `Review release notes` in compact lines, show-me-projects and
  the List summary; `{Tasks:[{title:'Review release notes'}]}` renders the same through the structured
  branch. A context-bearing task stores `{title:'Ship', context:'_before Friday_'}`, writes the legacy
  bullet `• Ship\n  _before Friday_`, exports the same object, and its List summary is `Ship _before
  Friday_`; a context-free task stores no `context`.
- Pinned cases (existing suites): `Tasks:[{title:'Task A',context:'_Context A_'},{title:'Task B',context:'_Context B_'}]`
  yields List summary `Task A _Context A_ Task B _Context B_` (create and drift compare), and the
  context-free pair yields `Task A Task B`; a pre-phase record (no `Tasks`) with indented contexts
  yields `Task A _Context A_ Task B _Context B_` via `ListSummaryFor` and compares equal to its
  unchanged List row without invoking the edit path; creation + `ReminderSummaryUpdated` folds to the edited
  text and `Tasks` in the parity fixture; a one-bullet reminder + one-line List edit persists exactly one
  `Tasks` item equal to the replacement bullet; a two-bullet-with-context reminder + one-line edit
  persists one item and no stale second item or context; an old record without `Tasks` keeps no field
  after an edit; an export of `{Tasks:[{title:'Ship', context:'_before Friday_'}]}` carries
  `tasks` with both fields, an old record omits `tasks` and its `display.summary` is unchanged.
- Smoke on dev: create a reminder through the battery, confirm `Tasks` equals the bullets in
  `ReminderMessageText`; edit its Slack List row title, confirm both changed; restart, confirm the
  projected reminder carries the same `Tasks`. Old record without `Tasks` still renders.
- ATE: not required for this phase (no extraction change); the #250 metamorphic suite must stay green.
