# RELAY · GH-250 phase 4 plan QA — store task structure next to legacy text
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Escalated
ROUND: 4 / 4

## ▶ TAKE YOUR TURN — read this first (works for ANY agent: Claude, Codex, agy)
1. **Read this whole file** (header, Setup, Ground rules, every block in the Log).
2. **Check it's your turn:** `NEXT` (top) names the role to act. Confirm you are bound to it and the
   last Log block isn't already yours. If not → STOP and reply "wrong window — nudge the <other> window."
3. **Do your role's work** on the artifact named in Setup:
   - **Reviewer:** review vs the Definition of Done → graded findings
     (`[Blocker]`/`[Should]`/`[Nit]`/`[Pass]`), each with a concrete fix → set a **VERDICT**
     (exactly PASS, FAIL, or PARKED) and a **Basis** (explanation). **Review the whole file, not just the diff** (GH-268):
     a beta test had this loop reach `Approved` in two rounds while an independent audit of the same
     branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the
     change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN
     SCOPE; if you find none, say so explicitly rather than leaving it unstated.
     **Declare it: every review block must contain a literal `swept file: yes` or `swept file: no`
     line.** Without it a reviewer that skipped the sweep is indistinguishable in the transcript from
     one that did it and found nothing — which is how the original 20 issues stayed invisible.
     Any `[Pass]` or "verified"/"confirmed" finding MUST
     carry a quoted span or a `file:line` citation — an uncited one is mechanically downgraded to
     `[Unverified — no citation]` (GH-173 B3). Do **not** edit the artifact; only append findings here.
     **A finding that asks for a behaviour change is a generalization unless you can paste the concrete
     input — a row, a value, a `file:line` — that fails under the current code** (GH-681: the gh673
     final QA relay generalized one late-error observation into "or a later invalid identity", the
     Producer implemented it, the same seat `[Pass]`ed it next round, and one historical NULL-URL
     ledger row then blanked every issue). Every `[Blocker]` or `[Should]` requesting a behaviour
     change MUST carry three lines: `Observed input:` (the failing input you saw), `Affected scope:`
     (the input predicate the change would govern), `Falsifier:` (the fixture or data that would show
     the change unnecessary or wrong, and its expected result).
     A `[Blocker]` must cite an observed failure. This is a protocol rule, not a mechanical check —
     the Producer may disposition a request lacking these as `Declined — unproven generalization`.
   - **Producer:** log a disposition for every open finding (Implemented / Modified / Declined + why,
     including `Declined — unproven generalization` for a behaviour-change request that carries no
     `Observed input:` / `Affected scope:` / `Falsifier:`), make the change, then add new work.
4. **Append ONE block** at the very bottom, directly **above** the marker line. Never edit earlier turns.
   Reviewer headings may be `### Reviewer · Round N`, `### Round N · Reviewer · <agent>`, `### Reviewer (<agent>)` (optionally followed by `— rN`), or `### Reviewer — Round N` (optionally followed by `(<agent>)`); follow the heading with a non-empty review body.
5. **Update the header:** flip `NEXT`; set `STATUS` (`Approved` closes — Reviewer only; else `Open`);
   the Producer bumps `ROUND` when opening a new cycle. If the max `ROUND` ends without `Approved`,
   set `STATUS: Escalated`.
6. **Commit only the relay file** (`relay(gh-250-phase4-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md` (the plan). Source paths
  it relies on, read them: `src/reminders-module.js` (ReminderInfo typedef ~:93-123,
  `UpdateReminderSummaryFromListAsync` ~:1127-1153, `CreateReminderFromListRowAsync` ~:1162-1200,
  `#MakeScheduledReminder` + `ReminderCreated` payload ~:748-830, the Key-task compose ~:2040-2140),
  `src/reminders-projection.js` (fold ~:300-400), `src/reminders-display-utils.js`
  (`ExtractKeyTaskSummaries`, `ExtractCompactSummary`, `BuildCompactTextForReminder`),
  `src/slack-format-utils.js` (`ExtractKeyTasks` ~:267, `ReplaceReminderSummary` ~:302),
  `src/lists-module.js` (~:1339, ~:2620-2740), `src/web-api.js` (~:497, ~:597, ~:1085-1137),
  `src/event-store.js` (REQUIRED_PAYLOAD_KEYS), `scripts/projection-parity-harness.js`.
  Issue text and the consumer inventory: #250 comments, especially
  https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/250#issuecomment-6308099892 .
- **Operational envelope:** a single-process multi-workspace Slack bot persisting reminders to a JSON
  file per workspace, with a non-authoritative event ledger and a projection-parity harness. Grade
  against the stated requirements and commensurate complexity, not enterprise migration frameworks.
  Existing suites only; no new test files.
- Questions:
  1. Are the creation/edit sites and the reader list complete? Name any writer of the task text or
     any reader that breaks without the `Key task(s):` block that the plan misses (file:line).
  2. Does the ledger change keep projection parity (absent stays absent; older readers ignore it)?
  3. Is rollback safe at every point (older binary reading new records/events; ReminderMessageText
     unchanged)? Is "last safe rollback point: any" true?
  4. Can `Tasks` and `ReminderMessageText` drift? Is requirement 3 sufficient, and is the List-row
     path (bare summary, no marker) handled correctly by both the accessor and `ReplaceReminderSummary`?
  5. Is the `?format=rebalance` change additive for rebalanceOS consumers?
  6. Is anything over-built (a second source of truth, a migration, a view object) or missing?
- Output: graded findings with file:line citations, then VERDICT. Approve if no Blocker/Should remains.
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: the plan dual-writes one optional `Tasks` field at every creation and edit site,
  keeps `ReminderMessageText` byte-identical, keeps projection parity and rollback safety, moves the
  breaking readers onto one accessor with a legacy fallback, keeps the rebalance export contract, and
  verifies each with existing suites and a dev smoke — with no unrequested machinery.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1

swept file: yes

- [Blocker] Requirement 3's proposed `Tasks[0].title` edit is not a dual write for a multi-task reminder. The existing list column flattens every key-task bullet and its context into one summary, while `ReplaceReminderSummary` rewrites the text to the new summary's normalized bullet lines. A list edit therefore removes/replaces all rendered tasks, but updating only index 0 leaves index 1 onward (and their contexts) in `Tasks`; the accessor would subsequently disagree with `ReminderMessageText`. Fix requirement 3 to derive the entire `Tasks` array from the exact normalized list-summary lines used by `ReplaceReminderSummary` (or a shared normalization helper), and replace the whole array atomically. This also handles a multi-line List edit rather than assuming one title.
  - Observed input: `Header\n\nKey task(s):\n• Task A\n  _Context A_\n• Task B\n  _Context B_`, then List summary `Edited list title`.
  - Affected scope: every structured reminder with two or more key-task bullets (with or without context) reconciled from an edited Slack List row.
  - Falsifier: a fixture with one existing bullet and a one-line List edit must persist exactly one `Tasks` item matching the one replacement bullet; a multi-bullet fixture must persist no stale item after replacement.
  - Citation: `src/reminders-module.js:1140-1149` performs the current edit; `src/slack-format-utils.js:308-326` normalizes and replaces all bullets; plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:66-70` specifies only `Tasks[0].title`.
  - Probe: `node -e "const SlackFormatUtils=require('./src/slack-format-utils'); const text='Header\\n\\nKey task(s):\\n• Task A\\n  _Context A_\\n• Task B\\n  _Context B_'; const listSummary=SlackFormatUtils.ExtractKeyTasks(text); const replaced=SlackFormatUtils.ReplaceReminderSummary(text, 'Edited list title'); console.log(JSON.stringify({listSummary,replaced}));"` — exit 0; output `{"listSummary":"Task A _Context A_ Task B _Context B_","replaced":"Header\\n\\nKey task(s):\\n• Edited list title"}`.

- [Should] Specify the accessor's normalized return shape and the export handoff. Requirement 5 currently says `GetReminderTasks` returns either `Tasks` objects or the legacy `ExtractKeyTaskSummaries` strings, but consumers such as compact rendering presently consume strings. Also, the rebalance record currently copies only `reminderMessageText`; without an explicit `Tasks` mapping there, the proposed accessor sees only the legacy fallback and the promised additive per-record `tasks` field cannot be emitted.
  - Observed input: `{ Tasks: [{ title: 'Ship', context: '_before Friday_' }], ReminderMessageText: '...Key task(s):\\n• Ship' }` sent through the current record builder produces no `tasks` property.
  - Affected scope: all structured reminders reaching `BuildCompactTextForReminder`/web exports, especially `?format=rebalance` records.
  - Falsifier: an export fixture with the observed reminder must contain `tasks: [{title:'Ship', context:'_before Friday_'}]`, while an old reminder with no field must omit `tasks` and render the parser-derived summary unchanged.
  - Citation: plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:77-82`; `src/reminders-display-utils.js:353-363`; `src/web-api.js:485-517,625-638`.

- [Pass] The planned ledger direction is additive and presence-preserving: the plan requires conditional `tasks` emission and fold rehydration, matching the existing `NotifyIDs` pattern that emits only when present and reconstructs with `WhenRecorded`. Older event readers validate only a required minimum, so an added optional key is rollback-safe at that boundary. Citation: plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:72-82,97-98`; `src/reminders-module.js:774-792`; `src/reminders-projection.js:362-365,389-403`; `src/event-store.js:38-50`.

No additional pre-existing defect was found in the swept plan/source scope. VERDICT: FAIL. Basis: the required edit path demonstrably permits `Tasks`/legacy-text drift, and the reader/export contract needs a single explicit normalized shape before implementation.

Handing off to Producer — go to the Producer window and say 'take your turn'.

### Producer · Round 1 · claude-a

- **Blocker (List edit drift) — Implemented.** Requirement 3 now replaces the whole `Tasks` array
  atomically from the same normalized lines `ReplaceReminderSummary` writes, via one extracted helper
  (`NormalizeSummaryLines`) shared by both, with no contexts (the rewritten text has none); old
  records stay field-less. Pinned your one-bullet and two-bullet-with-context falsifiers.
- **Should (accessor shape + export) — Implemented.** `GetReminderTasks` always returns
  `Array<{title, context?}>` (legacy strings mapped to `{title}`); string consumers take `.title`.
  The rebalance record builder copies `Tasks` to `tasks` only when present; `display.summary` /
  `slackSummary` go through the accessor and stay byte-identical for old records. Pinned both export
  fixtures.

Requesting Round 2 review.

### Reviewer · Round 2

swept file: yes

- [Blocker] Requirement 4 only puts `tasks` on the creation event, but Requirement 3 changes both `ReminderMessageText` and `Tasks` after creation without a corresponding ledger event. The current edit path saves the JSON queue immediately after replacing the summary; the fold has no branch that can apply a later text/tasks update. Therefore, after any List-row edit, `npm run projection:parity` compares the edited authoritative reminder with the original `ReminderCreated` projection and must diverge. Add one additive, forward-ignorable update event (for example `ReminderSummaryUpdated` carrying the post-edit `text` plus conditional `tasks`), emit it only after the successful edit, and make the fold apply both fields with absent-preserving semantics; cover that event in the parity fixture. An old binary already skips unknown event types on read, while it continues to use the byte-identical JSON text on rollback.
  - Observed input: a newly-created reminder whose `ReminderCreated.payload` contains `text: 'Header\\n\\nKey task(s):\\n• Task A'` and `tasks: [{title:'Task A'}]`, followed by List edit `Edited list title`.
  - Affected scope: every post-creation `UpdateReminderSummaryFromListAsync` mutation of a reminder carrying `Tasks`.
  - Falsifier: a parity fixture containing the creation event plus the proposed update event must fold to exactly `ReminderMessageText: 'Header\\n\\nKey task(s):\\n• Edited list title'` and `Tasks: [{title:'Edited list title'}]`; an unedited creation must need no update event and remain byte-identical.
  - Citation: `src/reminders-module.js:1145-1149` replaces text then only saves; `src/reminders-module.js:774-814` emits the sole creation payload; `src/reminders-projection.js:464-544` handles creations and state transitions but no summary update; plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:66-82` requires the mutation yet specifies only creation-event rehydration.
  - Probe: `node - <<'NODE' > "$TMPDIR/context-summary-probe.txt" ... NODE` (full command: `node - <<'NODE' > "$TMPDIR/context-summary-probe.txt"\nconst F=require('./src/slack-format-utils');\nconst text='Header\\n\\nKey task(s):\\n• Task A\\n  _Context A_\\n• Task B\\n  _Context B_';\nconsole.log(JSON.stringify({existingListSummary:F.ExtractKeyTasks(text), plannedTitles:['Task A','Task B'].join(' ')}));\nNODE\nPROBE_EXIT=$?; printf 'exit=%s\\n' "$PROBE_EXIT"; cat "$TMPDIR/context-summary-probe.txt"`) — exit 0; decisive output is quoted under the next finding.

- [Blocker] Requirement 5 says every `ExtractKeyTasks` reader moves to `GetReminderTasks(...).map(t => t.title)`, but that loses the persisted optional context from the Slack Lists summary contract. The existing List create and drift-compare readers flatten title and indented context into the one `summary` column. With the proposed title-only mapping, a newly structured reminder’s List row becomes `Task A Task B` instead of the current `Task A _Context A_ Task B _Context B_`; the next reconciliation sees it as a user edit and destroys contexts. Specify a shared accessor-derived flattening formatter for the List summary and drift comparison which includes `context` exactly as the legacy parser does, while compact/title consumers may use title only; pin the context case.
  - Observed input: `Header\n\nKey task(s):\n• Task A\n  _Context A_\n• Task B\n  _Context B_`.
  - Affected scope: structured message-path reminders with one or more non-empty task contexts synchronized to a Slack List.
  - Falsifier: a context-free structured reminder with `Tasks: [{title:'Task A'}, {title:'Task B'}]` must still yield `Task A Task B`; the observed context-bearing record must yield `Task A _Context A_ Task B _Context B_` for both initial List creation and reconciliation comparison.
  - Citation: `src/lists-module.js:1339-1343,2720-2723` build and compare the List summary via `ExtractKeyTasks`; `src/slack-format-utils.js:272-289` removes bullets then folds all whitespace, preserving contexts; plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:83-93` mandates title-only string consumers while moving those readers.
  - Probe: `node - <<'NODE' > "$TMPDIR/context-summary-probe.txt" ... NODE` — exit 0; output `{"existingListSummary":"Task A _Context A_ Task B _Context B_","plannedTitles":"Task A Task B"}`.

No additional pre-existing defect was found in the swept plan/source scope. VERDICT: FAIL. Basis: post-creation edits presently cannot reach the projection, and the specified title-only reader conversion regresses the unchanged Slack Lists summary contract for contextual tasks.

Handing off to Producer — go to the Producer window and say 'take your turn'.

### Producer · Round 2 · claude-a

- **Blocker (List edit not ledgered) — Implemented.** Confirmed pre-existing: the edit path saves
  without an event today. Requirement 4 adds one forward-ignorable `ReminderSummaryUpdated` event
  (`{text}` + conditional `tasks`, `REQUIRED_PAYLOAD_KEYS: ['text']`), emitted after a successful edit
  through `#EmitLifecycleEvent`, folded with absent-preserving semantics. Pinned your parity
  falsifiers (creation + update; unedited creation unchanged).
- **Blocker (List summary loses contexts) — Implemented.** One `FormatTasksAsListSummary` formatter,
  matching `ExtractKeyTasks`' whitespace folding, used by both the List create and drift compare;
  title-only consumers keep `.title`. Pinned the context and context-free cases.

Requesting Round 3 review.

### Reviewer · Round 3

swept file: yes

- [Blocker] Requirement 5's legacy fallback cannot preserve the existing Slack Lists summary contract for old, context-bearing reminders. It specifies `ExtractKeyTaskSummaries(text).map(title => ({ title }))`, but that parser reads only bullet lines and drops each following italic context line. Once the List create and drift readers switch to `FormatTasksAsListSummary(GetReminderTasks(reminder))`, an old reminder's expected summary becomes `Task A Task B` while its existing List row remains `Task A _Context A_ Task B _Context B_`; reconciliation treats this as a user edit and Requirement 3 rewrites away the legacy contexts. Fix the accessor fallback (or the List-specific accessor/formatter branch) to parse and retain the indented context exactly as `ExtractKeyTasks` currently folds it, and pin the old-record context case for both List creation and drift comparison.
  - Observed input: a pre-phase reminder with no `Tasks`: `Header\n\nKey task(s):\n• Task A\n  _Context A_\n• Task B\n  _Context B_`.
  - Affected scope: every pre-phase, marker-bearing reminder with one or more indented task-context lines when its Slack List row is created or reconciled after this phase.
  - Falsifier: a legacy record with context-free bullets must still format as `Task A Task B`; the observed old record must format as `Task A _Context A_ Task B _Context B_` and compare equal to its unchanged List row without invoking the edit path.
  - Citation: plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:93-105` defines the title-only fallback while moving both List readers; `src/reminders-display-utils.js:176-182` strips context; `src/lists-module.js:1335-1343,2715-2723` creates and compares the List summary; `src/slack-format-utils.js:272-289` preserves and folds the indented contexts today.
  - Probe: `node - <<'NODE' > "$TMPDIR/legacy-context-fallback-probe.txt"` with `F.ExtractKeyTasks(text)` and `D.ExtractKeyTaskSummaries(text)` for the observed input, then `probe_exit=$?; printf 'exit=%s\n' "$probe_exit"; cat "$TMPDIR/legacy-context-fallback-probe.txt"` — exit 0; decisive output: `{"listSummary":"Task A _Context A_ Task B _Context B_","accessorFallback":["Task A","Task B"]}`.

No additional pre-existing defect was found in the swept plan/source scope. VERDICT: FAIL. Basis: the planned fallback turns an unchanged legacy List row with stored context into a false edit and violates the requirement that the List summary contract remain unchanged. The round cap is reached, so this relay is escalated for the producer to disposition the concrete blocker.

Handing off to Producer — go to the Producer window and say 'take your turn'.

### Producer · Round 3 · claude-a

- **Blocker (legacy List summary loses contexts) — Implemented in plan.** The List create and drift
  compare use `ListSummaryFor(reminder)`: `FormatTasksAsListSummary(Tasks)` when `Tasks` exists, else
  `ExtractKeyTasks(ReminderMessageText)` unchanged (not the title-only accessor fallback). Pinned the
  old-record context case and the context-free case.
- Relay at the 3-round cap (Escalated). Held for the operator to authorize one more round.

### Producer · Round 4 · claude-a

Operator authorized one additional round (2026-10-20, "Ok round 4"). Scope: the round-3 blocker's
disposition above (`ListSummaryFor` legacy branch) plus a whole-plan re-sweep. Requesting Round 4 review.

### Reviewer · Round 4

swept file: yes

- [Blocker] The plan omits the compaction writer from the `Tasks` ledger path, so compaction destroys the optional field and breaks projection parity. Requirement 4 only adds `tasks` to `ReminderCreated` and the new update event, yet compaction replaces the ledger with `BaselineReminderImported` records. Its payload currently copies `text` and the existing optional fields but never `Tasks`; the planned fold rehydration cannot recover an omitted key. Add conditional `tasks` emission to `BuildCompactedEvents` (and its folded-reminder typedef), preserving absent as absent, and retain the planned conditional fold rehydration for baseline records. Pin this compacted-baseline case alongside the creation/update parity cases.
  - Observed input: one authoritative reminder with `Tasks: [{title:'Ship', context:'_today_'}]` and `ReminderMessageText: 'Header\\n\\nKey task(s):\\n• Ship\\n  _today_'` compacted through `BuildCompactedEvents`.
  - Affected scope: every structured reminder when the event ledger reaches compaction and is replaced by `BaselineReminderImported` events.
  - Falsifier: compacting a structured reminder must emit `payload.tasks` and fold it back to the identical `Tasks` array; compacting an old reminder without `Tasks` must omit both payload and projected field.
  - Citation: plan `PROJECT/2-WORKING/GH-250-PHASE-4-STORE-STRUCTURE.md:78-92` defines the only planned ledger writes and omits compaction; `src/state-snapshot-writer.js:164-205` constructs replacement `BaselineReminderImported` payloads without `tasks`; `src/reminders-projection.js:464-484` folds those events through the same creation path.
  - Probe: `node - <<'NODE' > "$TMPDIR/snapshot-tasks-probe.txt"\nconst { BuildCompactedEvents } = require('./src/state-snapshot-writer');\nconst { FoldReminderReadModels } = require('./src/reminders-projection');\nconst tasks = [{title: 'Ship', context: '_today_'}];\nconst source = [{ReminderID:'r1', CreatedOn:'2026-10-20T00:00:00.000Z', ShouldPostOn:'2026-10-21T00:00:00.000Z', TargetChannelID:'C1', OriginalChannelID:'C1', OriginalMessageID:'M1', OriginalSenderID:'U1', ReminderMessageText:'Header\\n\\nKey task(s):\\n• Ship\\n  _today_', AssigneeID:'U1', AssigneeIDs:['U1'], GitHubUrls:[], clientId:null, projectId:null, State:'scheduled', Tasks:tasks}];\nconst events = BuildCompactedEvents({workspace:'w', folded:{reminders:source, completed:[]}, authoritative:{reminders:source, completed:[]}});\nconst payload = events.find(e => e.type === 'BaselineReminderImported').payload;\nconst folded = FoldReminderReadModels(events, {strict:false}).reminders[0];\nconsole.log(JSON.stringify({payloadHasTasks:Object.hasOwn(payload,'tasks'), foldedHasTasks:Object.hasOwn(folded,'Tasks'), sourceHasTasks:Object.hasOwn(source[0],'Tasks')}));\nNODE\nprobe_exit=$?; printf 'exit=%s\\n' "$probe_exit"; cat "$TMPDIR/snapshot-tasks-probe.txt"` — exit 0; decisive output: `{"payloadHasTasks":false,"foldedHasTasks":false,"sourceHasTasks":true}`.

No additional pre-existing defect was found in the swept plan/source scope. VERDICT: FAIL. Basis: a normal ledger-compaction path loses persisted task structure, so the stated projection-parity and rollback guarantees do not yet hold. The round cap is reached; this relay is escalated for the producer to disposition the concrete blocker.

Handing off to Producer — go to the Producer window and say 'take your turn'.

### Producer · Round 4 · claude-a (disposition)

- **Blocker (compaction drops `Tasks`) — Implemented, and swept.** Instead of fixing only compaction,
  requirement 4 now routes `tasks` through every ledger touchpoint the existing optional `NotifyIDs`
  field uses, found by `rg "notifyIds|NotifyIDs|BaselineReminderImported" src scripts deploy`: creation
  payload, compaction (`state-snapshot-writer.js:173-185` + typedef), baseline import
  (`scripts/baseline-import.js:159-175`), fold `WhenRecorded` and the late-baseline merge
  (`reminders-projection.js:333-336,392`), and the coverage-gate test. Two creation-event readers that
  carry no optional fields today are named as unchanged. Pinned your compaction falsifier plus
  baseline-import and late-baseline-merge cases.
- Relay at the 4-round cap (Escalated). Held for the operator.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
