# GH-290 verification — 2026-11-05

Code under test: branch `feat/AEGIS-Sleuth-Slackbot-gh290-reminders-edit-api-2026-10-28` @ `236ac10`. The
branch was rebased onto `origin/development` @ `d8f3b15` first. Everything ran on a local checkout; nothing
ran on a server.

## Focused suites

`npx jest tests/web-api-reminders.test.js tests/reminders-integration.test.js tests/lists-module.test.js` →
**144 passed**. `npm run build` clean; `validate:fsm`, `validate:reminder-pipeline`, `validate:commands`,
`validate:workspace-isolation`, `validate:changelog-tone`, `utils/sanitize-scan.sh` and `utils/pdda/pdda.sh run`
all exit 0.

## Red controls (checked by hand, source restored afterwards)

- `ListsModule.#AddToUserContextsAsync` without the `!ItemCache.has` guard → the reassign-mover test fails
  (a duplicate row is created on the added owner's list).
- `MoveReminderBetweenUserListsAsync` without the owner-cell update loop → two GH-290 lists tests fail.
- The 2026-10-28 integration tests carry their own red controls (claim-site state check, FSM transitions),
  listed in the plan.

## Full suite

| Run | Result |
|---|---|
| Branch, run 1 | 7 failed / 2946 passed. Six were 5 s timeouts in diagnostics/thread-memory suites under load. |
| Branch, run 2 | **1 failed / 2952 passed**: `thread-memory store › SaveThreadMemoryAsync stores the row but no embedding when no key/embedder`. |
| `development` @ `d8f3b15` (disposable verify clone) | 1 failed / 2932 passed / 4 skipped: the **same** `thread-memory` test. |

The one remaining failure exists before this change and is in code this branch does not touch.

## Smoke (`gh290-smoke.cjs`, output in `smoke-output.txt`)

The real `WebAPI` and a real `RemindersModule` ran in a throwaway `SLEUTH_DATA_DIR` with the test
`MockSlackApp`. The real `skills/bulk-edit-reminders/bulk-edit-reminders.mjs` drove them over HTTP.

- **Main path:** `backup` → dry-run of a mixed batch (store unchanged) → `create` → one batch doing retitle,
  reschedule and reassign on the new reminder plus a reschedule of an overdue one (store shows the new
  title, date and owners; the overdue reminder is `scheduled` again) → complete it.
- **Adjacent path:** rerun the same edit batch → all four items `unchanged`, exit 0.
- **Refusals:** a contract-refused title refuses the whole batch, so the `complete` in the same batch does
  not run. `--tunnel` refuses an occupied port and refuses a non-loopback base URL.
- No Slack messages were posted during the smoke.

Harness artefact, not a defect: `execFile` does no shell quote-stripping, so the dry-run's
`aaaaaaaa="…"` title kept its literal quotes. From a shell, `id="Title"` arrives without them.

## Not verified here

- Real Slack List rendering of the updated cells, and a live server write. The dev server runs deployed
  `development`, which does not have these actions yet. Smoke on dev after this lands and deploys:
  create → edit → rerun → complete in the dev test channel.
- `--tunnel` against a real host. Production uses password SSH (`sshpass -e` with the parsed
  `vultr-sleuth-production.env`), and this machine has no `sleuth-oracle-dev` alias. Dev's base URL
  reaches the API directly, so dev needs no tunnel.
