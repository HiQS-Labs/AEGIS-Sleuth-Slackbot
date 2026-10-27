---
Goal: Pre-implementation plan QA for GH-279 (bulk-close Sleuth reminders via Web API + skill)
Date: 2026-10-27
NEXT: Reviewer
STATUS: Open
---

# Context

Review the plan in `PROJECT/1-INBOX/GH-279-BULK-EDIT-REMINDERS.md` (issue https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/279) **before any code is written**.

Requirement from the operator: a skill so an agent session can close/complete existing Sleuth reminders in bulk, and it must **first back up the production reminders**. The operator chose "new Web API endpoint + skill" over editing data on the host. First real use: close 7 triaged reminders in one workspace after deploy.

**Operational envelope:** a single-tenant-per-workspace Slack bot with an existing bearer-token Web API reached by the operator over an SSH tunnel, plus a local operator CLI skill. Grade against the stated requirements and commensurate complexity. Do not ask for unrequested enterprise machinery (rate limiting, RBAC, audit DBs, idempotency keys, distributed locks). Non-goals are listed in the plan.

Read the plan in full, then the code it cites:
- `src/web-api.js` (constructor routes ~141-165, `#AuthorizationMiddleware`, `#HandleGetWorkspaceRemindersAsync`)
- `src/reminders-module.js` `CompleteReminderByIdAsync` (~1076), `CancelReminderFromListAsync` (~1119), `#DeleteRemindersAsync`
- `src/slack-app.js` `get RemindersModule` (~331)
- `src/app.js` WebAPI construction (~412) and how `SlackAppsByWorkspace` is populated
- `tests/web-api-reminders.test.js` (existing harness with a mock SlackApp map)
- `skills/download/`, `skills/talk-to-reminders/` (prior-art skills); issue #154's critique of `skills/download`
- `AGENTS.md` (repo contract; tests rule "mutation-verify every new regression test")

Questions:

1. Are the plan's claims about the code paths grounded? In particular: is `SlackAppsByWorkspace` actually populated with live SlackApps whose `RemindersModule` is set in production startup (`src/app.js`), so the endpoint can reach the in-memory queue?
2. Is calling `CompleteReminderByIdAsync` / `CancelReminderFromListAsync` from the API the right reuse of the canonical writer, or does either carry caller-specific side effects (log tags, list sync, Slack posts) that make it wrong for an API-originated close? Is there a better existing method to reuse instead of adding a new one?
3. Is serial application within one request sufficient given `#DeleteRemindersAsync` rewrites the file? Could a bulk call race the module's own scheduler tick or another writer in a way that loses data? Answer only with concrete code evidence.
4. Is the backup step sound? The skill takes it via `GET /workspace/:name/reminders` (raw records) and aborts if `success` is not true or the list is empty. Does that read return the same records the writer mutates (note the `REMINDERS_READ_SOURCE` flag / projection fallback)?
5. Are the acceptance checks falsifiable, and do they include a red control? Is anything required missing, or is anything over-built for this envelope?
6. Is the rating (55/35/50/70) and its rationale grounded?

Flag anything wrong, missing, mis-scoped, or over/under-engineered. Cite file:line. Every [Blocker]/[Should] asking for a behaviour change must carry `Observed input:`, `Affected scope:` and `Falsifier:` lines.

Write your verdict below and set STATUS to Approved if the plan can proceed as written (Nits allowed), otherwise leave it Open and hand back.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->
