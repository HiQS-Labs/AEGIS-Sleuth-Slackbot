# Review: summarize-week completion history

## Findings

1. Medium: `CompletionStore.Record()` is fire-and-forget from the FSM hook, but shutdown never flushes the queued write.

   Evidence: `RemindersModule.#RecordCompletion()` calls `this.#CompletionStore.Record(...)` and discards the returned promise at `src/reminders-module.js:410`, while `RemindersModule.StopAsync()` only saves reminders, channel settings, and the reminder counter at `src/reminders-module.js:846`. `CompletionStore` keeps the durability queue private in `#WriteChain` at `src/completion-store.js:34` and exposes no `FlushAsync()`/`StopAsync()` method.

   Impact: a completion is visible in memory immediately, but a graceful restart or deploy that lands before the async write finishes can lose that completion from `<workspace>_completed.json`. That reintroduces a narrower version of the original user-facing bug: after restart, `summarize-week` can omit a recently completed task even though the completion path returned successfully. This also means the current "durable writes" claim is only best-effort for the production path.

   Suggested fix: add `CompletionStore.FlushAsync()` returning `this.#WriteChain`, and call it from `RemindersModule.StopAsync()` after saving reminder state. Add a restart-style regression test that completes a reminder, calls `StopAsync()`, constructs a fresh `RemindersModule` for the same workspace, and verifies `GetCompletedRemindersBetween(...)` still returns the record.

2. Low: load-time retention pruning is memory-only, despite comments/changelog reading like durable pruning.

   Evidence: `CompletionStore.LoadAsync()` filters loaded rows and calls `#PruneExpired()` at `src/completion-store.js:51`, but does not persist the pruned result. Stale records disappear from queries, but remain on disk until the next successful `Record()` call.

   Impact: not user-visible in `summarize-week`, but it weakens the retention guarantee and can leave old rows in runtime JSON indefinitely for quiet workspaces.

   Suggested fix: either persist after load if pruning removed records, or tighten the wording to say load pruning is in-memory and durable pruning happens on the next record.

## Notes

- The architecture shape is sound: completion capture is at the FSM transition chokepoint, and the app-mention handler reads through dependency injection instead of reaching into Slack Lists.
- The new tests cover the pure store behavior and the handler's in-window/out-of-window rendering. The key missing coverage is the unawaited production write across `RemindersModule.StopAsync()` and restart.

## Verification Run

- `npm run build` passed.
- `npm test -- --runTestsByPath tests/completion-store.test.js tests/reminders-app-mention-handler.test.js tests/reminders-fsm-invariants.test.js` passed: 104/104.
- `npm run validate:fsm` passed.
- `npm test` passed: 1100/1100. Jest still reported the existing force-exit/open-handle warning.
- `git diff --cached --check` passed.
