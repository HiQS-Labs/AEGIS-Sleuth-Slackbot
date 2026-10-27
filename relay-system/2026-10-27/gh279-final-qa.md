---
Goal: Final QA for GH-279 (bulk-close Sleuth reminders via Web API endpoint + skill)
Date: 2026-10-27
NEXT: Reviewer
STATUS: Approved
---

# Context

Final review of the completed implementation of https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/279
against its approved plan (`PROJECT/2-WORKING/GH-279-BULK-EDIT-REMINDERS.md`; plan QA in
`relay-system/2026-10-27/gh279-plan-qa.md`, Approved). Diff: `git diff a0dddb0..HEAD`.

**Operational envelope:** single-team Slack bot. The existing bearer-token Web API is reached by one operator over an SSH tunnel; the skill is a local operator CLI. Grade against the plan's requirements and commensurate complexity. Don't ask for unrequested enterprise machinery.

Files to read:
- `src/web-api.js`: `MaxBulkReminderActions`, route registration, `#HandlePostWorkspaceRemindersBulkAsync`
- `tests/web-api-reminders.test.js`: the `POST /workspace/:name/reminders/bulk (GH-279)` describe block
- `skills/bulk-edit-reminders/SKILL.md`, `skills/bulk-edit-reminders/bulk-edit-reminders.mjs`
- `docs/web-api.md` (new section), `CHANGELOG.md` (Unreleased, first entry)
- `PROJECT/2-WORKING/GH-279-BULK-EDIT-REMINDERS.md` → "Verification" (gates, red controls, smoke) and `PROJECT/2-WORKING/GH-279-smoke/server.js`

Questions:

1. Does the endpoint match the plan: whole-batch validation before any write, existing writers only (no new state writer), serial application, per-item outcomes, the `success/data` envelope, bearer auth from the existing middleware? Cite file:line for any divergence.
2. Does the skill enforce **backup first**? Is there any path where a POST can happen without a successful, non-empty, written backup, or where a backup can be overwritten? Is the secrets file only parsed (never executed or echoed)?
3. Does ID resolution fail closed? Consider unknown, ambiguous, short (<8) and duplicate IDs, and the same reminder named under both `--complete` and `--cancel`.
4. Do the tests and red controls substantiate the claims? Did a duplicate subsystem or writer slip in? Is anything over-built?
5. Are the docs (SKILL.md, docs/web-api.md, CHANGELOG) accurate to the code, including the rerun behaviour the smoke corrected?
6. The rating `55/35/50/70` stays as recorded. Does the evidence still support it?

Every [Blocker]/[Should] asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines.

Write your verdict below. Set STATUS to Approved if it can ship (Nits allowed); otherwise leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Reviewer verdict — Approved

The implementation matches the approved GH-279 plan and is appropriately small. No blocker or
should-fix finding.

1. Endpoint: `src/web-api.js:143-161` installs the existing JSON parser and bearer middleware before
the route, and registers the additive POST route. `:1018-1029` validates every action (non-empty
array, maximum 100, id, action and optional reason) before looking up a workspace or invoking a
writer; `:1031-1034` requires both an existing and live workspace. `:1038-1052` awaits each item in
request order and calls only `CompleteReminderByIdAsync` or `CancelReminderFromListAsync`, with
per-item `completed|canceled|not-found|error` results; `:1054-1059` preserves the `{success,data}`
envelope. Those writers are the established FSM/write paths (`src/reminders-module.js:1076-1088`,
`:1119-1129`), so no competing state writer was added.

2. Backup first is enforced by execution order: the GET must return the successful data envelope
(`skills/bulk-edit-reminders/bulk-edit-reminders.mjs:67-75`), it must be a non-empty array
(`:104-107`), and its JSON is durably written before resolution or POST (`:108-116`). The mode-600,
exclusive `wx` write (`:108-113`) refuses a timestamp collision rather than overwriting a prior
backup. The only POST is after backup and successful complete resolution (`:126-130`). Secrets are
read as strict `KEY=VALUE` text (`:42-50`); the script has no shell/process-execution surface.

3. Resolution fails closed: only an exact id or an 8+-character prefix can match (`:78-83`); zero
or multiple matches are accumulated as failures, then abort the entire request before POST
(`:79-92`). A short non-exact value consequently has zero matches. The `Seen` check (`:85-90`)
rejects a duplicate resolved reminder, including one supplied once to `--complete` and once to
`--cancel`.

4. The endpoint tests cover bearer auth, unknown/not-running workspaces, six whole-batch no-write
validation cases, routing/reason/order, all result classes and single in-flight application
(`tests/web-api-reminders.test.js:491-550`). The plan records red controls for swapped writers,
dropped validation, dropped live-workspace checking and `Promise.all`
(`PROJECT/2-WORKING/GH-279-BULK-EDIT-REMINDERS.md:106-109`). A narrow symbol-surface probe found
one new route and its intended skill only; the endpoint calls the two pre-existing writers rather
than introducing another subsystem.

5. `SKILL.md:8-17,55-58`, `docs/web-api.md:378-420`, and the Unreleased changelog entry accurately
describe the order, envelope, writers, outcomes and corrected rerun behavior: an already-applied
batch stops at local resolution with no POST, while `not-found` covers a close that races after
backup. This agrees with the recorded isolated smoke results (`GH-279-BULK-EDIT-REMINDERS.md:111-124`).

6. The recorded `55/35/50/70` rating remains supported: this is a timely operator batch-cleanup
need with limited severity, neutral appeal and bounded additive effort (`GH-279-BULK-EDIT-REMINDERS.md:131-140`).

Static probes only, per relay constraint (no test/fixture execution in this worktree):

- `node --check skills/bulk-edit-reminders/bulk-edit-reminders.mjs` — exit 0.
- `node --check src/web-api.js` — exit 0.
- `rg -n 'CompleteReminderByIdAsync|CancelReminderFromListAsync|reminders/bulk|bulk-edit-reminders' src skills docs tests PROJECT/2-WORKING/GH-279-BULK-EDIT-REMINDERS.md CHANGELOG.md` — exit 0; decisive output showed the new route invokes only the two established writers and one dedicated skill surface.
- `rg -n 'exec|spawn|child_process|writeFile|appendFile|rename|unlink|rm|fetch' skills/bulk-edit-reminders/bulk-edit-reminders.mjs` — exit 0; decisive output showed only `fetch` and the exclusive backup `writeFileSync`, with no execution primitive.

### Attestation · relay-drive — 2026-10-27T16:40:53Z
task: RELAY-gh279-final-qa-1
reviewer: codex
status: Approved
reviewed-head: 4743697fd7a15cef38ac6ac99fb4450ea31cc186
added-range: 2657+3830
added-sha256: 25b3c388e1861f5985020e6916a02fba2701a3046219902e0e84d2dec0c689eb
