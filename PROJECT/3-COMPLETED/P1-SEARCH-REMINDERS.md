# P1: Search Reminders Command

Status: In Progress

> **Branch strategy:** Implement first on `development`, then port forward into `fix/breakup-reminders-module`.

## Context

Sleuth already supports reminder-listing commands such as:

- `@Sleuth AI show reminders`
- `@Sleuth AI show reminders github`
- `@Sleuth AI show reminders here`
- `@Sleuth AI show my reminders`
- `@Sleuth AI show reminders for @user`

What is missing is a direct way to search reminder task text by keyword and return only matching reminders.

The architectural decision for this feature is:

1. Ship **exact keyword search** first.
2. Treat **fuzzy typo-tolerant matching** as a follow-up phase, not part of the first release.
3. Implement on `development` first because the breakup branch is still in motion.
4. Port the finished behavior into `fix/breakup-reminders-module` after `development` is green.

## Goals

- Add a user-facing Slack command to search pending reminders by keyword.
- Return only matching reminders.
- Reuse the existing reminder rendering flow and thread reply behavior.
- Keep the implementation small and easy to forward-port into the breakup branch.

## Out Of Scope For Phase 1

- Fuzzy matching.
- Ranking/scoring search results beyond basic filtering.
- Searching completed/canceled reminders.
- Web API support.
- Slack Lists API search integration.

## Recommended Command Contract

Primary command:

```text
@Sleuth AI search reminders <keywords>
```

Optional variants that may be supported in the same pass if cheap:

```text
@Sleuth AI search my reminders <keywords>
@Sleuth AI search reminders here <keywords>
@Sleuth AI search reminders for @user <keywords>
```

Phase 1 recommendation:

- Start with `search reminders <keywords>`.
- Optionally support `here` in the same first pass if the parser stays clean.
- Defer `my reminders` and `for @user` search variants until after the base command is stable.

## Why `development` First

This feature does not depend on the unfinished breakup work. The current breakup branch already contains a substantial reorganization of reminder internals, including extracted scheduler/UI/repository/FSM modules and app-mention routing changes. That makes backward cherry-picking into `development` riskier than forward-porting from `development` into the breakup branch.

Implementation order should therefore be:

1. Build and test on `development`.
2. Merge or cherry-pick the feature commit(s) into `fix/breakup-reminders-module`.
3. Resolve any reminder-command conflicts during the forward port.

## End-To-End Plan

> **Note to LLMs:** Mark items `[x]` as they are completed. Keep this checklist current while implementation proceeds.

- [x] **Phase 0: Baseline And Branch Prep** — Risk: None | Effort: Low
  - [x] 0.1 Confirm `development` is up to date and clean
  - [x] 0.2 Confirm reminder command tests pass on `development`
  - [x] 0.3 Confirm `npm run build` passes on `development`
  - [x] 0.4 Review current reminder command parsing in `src/reminders-module.js`

- [x] **Phase 1: Exact Search On `development`** — Risk: Low | Effort: Low
  - [x] 1.1 Add `search reminders <keywords>` command parsing
  - [x] 1.2 Extract search query text safely from the app mention
  - [x] 1.3 Filter pending reminders by case-insensitive keyword match against `ReminderMessageText`
  - [x] 1.4 Reuse existing reminder list rendering and thread reply behavior
  - [x] 1.5 Add empty-state copy for no matches
  - [x] 1.6 Update admin/user command reference if needed

- [x] **Phase 2: Automated Verification On `development`** — Risk: None | Effort: Low
  - [x] 2.1 Add integration tests for matching results
  - [x] 2.2 Add integration tests for no-match behavior
  - [x] 2.3 Add integration tests for multi-result behavior and ordering
  - [x] 2.4 Add optional `here`-filter coverage if implemented
  - [x] 2.5 Run targeted reminder/chat Jest suites
  - [x] 2.6 Run `npm run build`

- [x] **Phase 3: Release Hygiene On `development`** — Risk: Low | Effort: Low
  - [x] 3.1 Bump `package.json` version because user-visible behavior changed
  - [x] 3.2 Update `changelog.md`
  - [x] 3.3 Commit the feature as one focused change set or two small commits (`feature`, `tests/docs`)

- [x] **Phase 4: Port To `fix/breakup-reminders-module`** — Risk: Medium | Effort: Low-Medium
  - [x] 4.1 Port the `development` search behavior into `fix/breakup-reminders-module`
  - [x] 4.2 Resolve `src/reminders-module.js` conflicts by preserving the breakup branch’s extracted handler boundaries
  - [x] 4.3 Preserve the breakup branch’s extracted module boundaries and current app mention delegation style
  - [x] 4.4 Reconcile command/help behavior where needed without changing the shipped command surface
  - [x] 4.5 Keep the port behavior-identical to `development`

- [x] **Phase 5: Verification On `fix/breakup-reminders-module`** — Risk: None | Effort: Low
  - [x] 5.1 Run reminder-focused mock-Slack tests
  - [x] 5.2 Run chat command tests if command help text changed
  - [x] 5.3 Run `npm run build`
  - [x] 5.4 Confirm the port did not regress existing `show reminders` behavior

- [x] **Phase 6: Optional Fuzzy Search Follow-Up** — Risk: Medium | Effort: Medium
  - [x] 6.1 Decide whether typo tolerance is still needed after exact search ships
  - [x] 6.2 If yes, add a dedicated matching helper instead of embedding fuzzy logic into command parsing
  - [x] 6.3 Restrict fuzzy matching to longer tokens to avoid noisy false positives
  - [x] 6.4 Return exact matches first and fuzzy matches second
  - [x] 6.5 Label fuzzy matches clearly in Slack output
  - [x] 6.6 Add dedicated tests for thresholds and false-positive control

---

## Phase 1 Implementation Checklist

### Branch: `development`

**Effort:** Low  
**Risk:** Low

**Primary files expected to change:**

- `src/reminders-module.js`
- `tests/reminders-integration.test.js`
- `src/chat-module.js` if the commands reference is updated
- `package.json`
- `changelog.md`

### Command parsing

- [x] Register the search command before the broad `show reminders` matcher if any regex overlap exists
- [x] Require non-empty search text
- [x] Reply with a helpful validation message when the user omits keywords

### Search behavior

- [x] Normalize the query and reminder text to lower case
- [x] Match against `ReminderMessageText`
- [x] Keep matching logic deterministic and local
- [x] Do not call OpenAI for search
- [x] Do not touch persisted reminder schema

### Rendering behavior

- [x] Reuse the existing `#HandleShowRemindersListAsync(...)` path
- [x] Keep sort order consistent with current reminder list output
- [x] Use summary text that includes the query
- [x] Use a search-specific empty state such as `No pending reminders found matching "invoice".`

### Minimal first-pass query rules

- [x] Treat the query as a plain text substring match
- [x] Make matching case-insensitive
- [x] Trim leading/trailing whitespace
- [x] Do not split into advanced boolean operators in phase 1

## Testing Checklist

### `development`

- [x] Empty queue returns the search-specific empty state
- [x] Non-empty queue with zero matches returns the search-specific empty state
- [x] One matching reminder returns summary + one result
- [x] Multiple matching reminders return only matching results
- [x] Matching is case-insensitive
- [x] Non-matching reminders are excluded
- [x] Existing `show reminders` tests still pass unchanged

### Suggested mock-Slack scenarios

- [x] Search for one unique word inside `ReminderMessageText`
- [x] Search for a common word that matches multiple reminders
- [x] Search with extra spaces around the query
- [ ] If `here` support is added, prove cross-channel reminders are excluded

## Porting Checklist

### Target branch: `fix/breakup-reminders-module`

**Effort:** Low-Medium  
**Risk:** Medium

The port target is not a pure cherry-pick target. If Git applies the commit cleanly, that is ideal. If not, port behavior, not patch shape.

### Expected conflict areas

- `src/reminders-module.js`
- `src/chat-module.js`
- reminder integration tests if file structure differs between branches

### Port strategy

- [ ] Cherry-pick the `development` feature commit first
- [ ] If conflicts occur, inspect the breakup branch’s current command registration flow and reapply only the search-specific logic
- [ ] Keep the search logic close to existing app-mention command handlers on that branch
- [ ] Do not use the search feature as a reason to continue the breakup refactor in the same change
- [ ] Keep the port commit narrowly scoped to behavior parity

### Verification after port

- [ ] `npm test -- --runInBand tests/reminders-integration.test.js tests/reminders-module.test.js tests/reminders-scheduler.test.js tests/reminders-repository.test.js tests/reminders-slack-ui.test.js`
- [ ] `npm test -- --runInBand tests/chat-module.test.js tests/chat-module.integration.test.js` if command help changed
- [ ] `npm run build`

## Risks And Controls

### Low-risk items

- Search is read-only against in-memory pending reminders
- Existing reminder UI rendering can be reused
- Existing mock-Slack integration tests already cover this command family

### Medium-risk items

- Regex ordering mistakes may cause the new command to be swallowed by broader reminder matchers
- Command help text may drift between branches
- Back-porting from the breakup branch to `development` would be awkward; this plan avoids that

### Risk controls

- Implement on `development` first
- Keep phase 1 to exact search only
- Reuse existing list rendering rather than inventing a new output path
- Verify both branches independently with the mock-Slack harness

## AGENTS.md Compliance Notes

- OpenAI is out of scope for search; reminder search must remain deterministic and local.
- Reminder search should stay inside the Slack app-mention reminder command flow.
- This feature does not require any persistence schema change.
- Because the feature changes application behavior, `package.json` version bump and `changelog.md` update are required in the implementation phase.

## Deferred Follow-Ups

- [x] Add `search my reminders <keywords>`
- [x] Add `search reminders for @user <keywords>`
- [x] Add `search reminders here <keywords>` if omitted from phase 1
- [ ] Add exact-token matching mode to reduce substring noise if users report false positives
