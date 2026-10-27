---
Goal: Pre-implementation plan QA for GH-279 (bulk-close Sleuth reminders via Web API + skill)
Date: 2026-10-27
NEXT: Closed
STATUS: Approved
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

## Reviewer verdict — Codex (2026-10-27)

**Approved.** The proposed endpoint is the smallest sound seam for this operator-only workflow;
no new writer or persistence abstraction is warranted.

- **Live-module claim — grounded.** `src/app.js:283` creates the shared map, adds each
  `SlackAppInstance` at `:319`, constructs `RemindersModule` at `:325`, and starts it at `:370`.
  Its constructor assigns itself to the app at `src/reminders-module.js:433-438`; the API is not
  constructed until `src/app.js:472-481`. Thus the endpoint's
  `SlackAppsByWorkspace.get(name)?.RemindersModule` reaches the live queue for a successfully
  started workspace. Failed starts remove the map entry (`src/app.js:446-450`), so the plan's
  "workspace isn't running" error is the right result.

- **Writer reuse — grounded.** `CompleteReminderByIdAsync` finds the live queue item, makes the
  FSM transition, records completion history through that transition, and calls the sole removal
  choke point (`src/reminders-module.js:1076-1088`, `:528-552`).
  `CancelReminderFromListAsync` has the matching cancel transition/removal path (`:1119-1129`).
  `#DeleteRemindersAsync` persists and performs the intended Slack List fan-out: completion keeps
  history rows, while cancel removes them (`:4456-4502`). There are no API-inappropriate Slack
  posts. The existing `[github-sync]` / `[lists-sync]` log prefixes are provenance-imprecise for
  this new caller, but `api-bulk:` in the reason makes the action traceable; a generic writer only
  to change those labels would be needless scope.

- **Concurrency — sufficient for data safety.** Serial request application makes result ordering
  deterministic. More importantly, the module already serializes *every* snapshot-and-write pair:
  `#SaveRemindersAsync` queues `#PersistRemindersAsync` (`src/reminders-module.js:3958-3976`),
  which snapshots the current queue only inside that chain (`:3978-3996`). The implementation
  explicitly documents this as protection from concurrent writers overwriting a later queue
  update (`:389-400`). Scheduler work can interleave at its Slack awaits (`:4214-4225`,
  `:4282-4324`), so a reminder can conceivably be delivered just before its API close; however
  its subsequent save serializes the already-mutated shared queue and cannot resurrect a removed
  item. This is not a lost-data race and does not justify locks for the stated envelope.

- **Backup — sound in the current runtime.** The GET handler uses
  `REMINDERS_READ_SOURCE` (`src/web-api.js:959-994`) and its authoritative reader parses the same
  workspace reminders JSON (`:358-379`). Even if an operator sets that flag to `projection`, the
  projection module hard-blocks this flag and returns the authoritative source
  (`src/reminders-projection.js:115-129`, `:684-700`). Thus the skill backs up the persisted
  records that the live writer updates. The existing API regression explicitly exercises that
  flag and rollback (`tests/web-api-reminders.test.js:70-110`).

- **Acceptance/rating — adequate.** The endpoint cases are falsifiable and include concrete
  mutation red controls, while the isolated smoke distinguishes first application, repeat
  (`not-found`), and dry-run. `npm run build`, `npm test`, and the FSM validator are proportional
  to the changed seam. `55/35/50/70` matches analogous small, existing-pattern work: operator
  urgency without a data-loss/outage incident, neutral appeal, and one bounded API/skill change.
  No requested enterprise mechanisms are missing.

Nits only (not plan blockers): name the API-originated log tag expectation explicitly if log
searchability matters, and have the endpoint tests assert the exact `api-bulk:` reason passed to
each mock writer in addition to call order. Neither changes behavior or expands scope.

**Read-only probe record:** `nl -ba src/app.js | sed -n '272,345p;460,485p'; nl -ba
src/reminders-module.js | sed -n '4435,4515p'; nl -ba src/reminders-projection.js | sed -n
'115,145p;676,748p'` (exit 0) showed map insertion at app `:319`, module binding at reminders
`:433-438`, queued durable saves at `:3971-3996`, list fan-out at `:4493-4502`, and a blocked
projection read returning authoritative JSON at projection `:690-700`.
