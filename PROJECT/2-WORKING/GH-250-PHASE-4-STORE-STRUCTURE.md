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
| Plan QA (Codex relay) | pending |
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
- **Readers to move onto the accessor in this phase** (the ones that break without the block):
  `ExtractKeyTasks` users (`lists-module.js:1339` summary column; drift compare `lists-module.js:2720`,
  `reminders-module.js:1140`), `ExtractKeyTaskSummaries`/`ExtractCompactSummary` users
  (`reminders-display-utils.js:307,356`; `web-api.js:597,1085,1137`), `ExtractReminderTitle`
  (`show-me-projects-command.js:211`, `reminder-clustering.js:181`).
- **Readers left alone:** raw-text model/keyword consumers (dedup prompt, search, MCP store,
  talk-to-reminders) — the text is unchanged; quote-boundary readers (`ExtractQuotedOriginalMessage`,
  assignee extraction) — unaffected.
- **Published contract:** `?format=rebalance` `display.summary` / `display.slackSummary` are read by
  rebalanceOS (`scripts/dashboard.py:739-753`, `pulse_web.py:1660`). They stay, computed through the
  accessor; `tasks` is added to each record additively. rebalanceOS's two regex copies
  (`ingest/sleuth_grouping.py`, `ingest/slack_users.py:281`) keep working (text unchanged) and move to
  `display.summary`/`tasks` in a separate rebalanceOS issue.
- **Legacy strings are permanent** in completion records, event ledgers and the published export, so
  phase 6 keeps one legacy parser behind the accessor; this phase must not assume it can go.
- **Latent edge:** `ReplaceReminderSummary` (`slack-format-utils.js:302`) replaces the whole string when
  the `Key task(s):` marker is absent (dropping header, quote, permalink). Only List-row reminders lack
  the marker today, where it is harmless; this phase adds no marker-less writer.

## Requirements

1. **One new optional field, written at both creation sites.** `ReminderInfo.Tasks`:
   `Array<{ title: string, context?: string }>`, in display order.
   - Message path (`src/reminders-module.js:2045-2058` -> `#MakeScheduledReminder` at :2126): built in
     the same reduce that composes the `Key task(s):` block, from the same `#SelectReminderTaskText` /
     `#SelectReminderContextLine` values, so the field and the text cannot disagree at birth.
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
4. **Ledger: additive, conditional payload key.** `ReminderCreated` carries `tasks` only when the
   reminder has `Tasks` (the same conditional discipline as `notifyIds` / `enrichedFrom`,
   `src/reminders-module.js:774-800`), and the projection fold rehydrates it
   (`src/reminders-projection.js:320,385`), so `npm run projection:parity` stays green and absent
   stays absent. No schema-version bump: `REQUIRED_PAYLOAD_KEYS` is a minimum.
5. **Readers prefer the field, fall back to the parser — one return shape.** One accessor,
   `GetReminderTasks(reminder) -> Array<{ title: string, context?: string }>` in
   `src/reminders-display-utils.js`: `reminder.Tasks` when present, else
   `ExtractKeyTaskSummaries(text).map(title => ({ title }))`. Consumers that need strings take
   `.map(t => t.title)`; `ExtractCompactSummary`'s quote/first-line fallback for records with no bullets
   stays as today. The readers listed under Recon switch to it in this phase; the parsers remain as
   the legacy fallback (one of them permanently, see Recon).
   **Export handoff:** the `?format=rebalance` record builder (`src/web-api.js:485-517`) copies
   `Tasks` to a `tasks` property only when present (omitted for old records), and
   `display.summary` / `display.slackSummary` (`:597`, `:625-638`) are computed through the accessor,
   so they are byte-identical for old records.
6. **#261 ratchet:** `key_task_reparse_sites` must not rise; it falls as readers move to the accessor.

## Non-goals

- Deleting any parser (phase 6), backfilling old records, changing `ReminderMessageText`, changing
  the Slack Lists column contract, structured owner/due fields (owner and due are already fields).

## Preflight bet

- Outcome: the task text is read from data, not recovered from a rendered string.
- Smallest bet: one optional field + one accessor + one ledger key, written at the one creation site
  and the one edit site.
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
- Pinned cases (existing suites): a one-bullet reminder + one-line List edit persists exactly one
  `Tasks` item equal to the replacement bullet; a two-bullet-with-context reminder + one-line edit
  persists one item and no stale second item or context; an old record without `Tasks` keeps no field
  after an edit; an export of `{Tasks:[{title:'Ship', context:'_before Friday_'}]}` carries
  `tasks` with both fields, an old record omits `tasks` and its `display.summary` is unchanged.
- Smoke on dev: create a reminder through the battery, confirm `Tasks` equals the bullets in
  `ReminderMessageText`; edit its Slack List row title, confirm both changed; restart, confirm the
  projected reminder carries the same `Tasks`. Old record without `Tasks` still renders.
- ATE: not required for this phase (no extraction change); the #250 metamorphic suite must stay green.
