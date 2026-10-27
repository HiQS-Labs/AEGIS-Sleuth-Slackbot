---
Goal: Final QA for GH-279 (bulk-close Sleuth reminders via Web API endpoint + skill)
Date: 2026-10-27
NEXT: Reviewer
STATUS: Open
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
