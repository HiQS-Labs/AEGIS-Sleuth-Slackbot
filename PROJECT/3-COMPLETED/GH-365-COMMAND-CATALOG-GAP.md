---
title: "Command catalog gap — confirm-multi-task-proposal missing from data/static/ai/command-catalog.json"
status: Phase 1 DONE (catalog entry added); validate:commands still red for an unrelated, pre-existing, higher-severity issue found during this fix — see Progress log.
created: 2026-07-17
updated: 2026-07-17
owner: noel
branch: development
doc_type: project
gh_issue: 365
source: https://github.com/NeochromeTeam/sleuth-app/issues/365
related: "GH-360 (multi-task inference — introduced the route), src/catalog-regex-aliases.js / src/command-catalog.js (2nd validate:commands blocker discovered here)"
effort: 1
complexity: 1
risk: 1
phases: 1
---

# GH-365 — Command catalog gap: `confirm-multi-task-proposal`

`npm run validate:commands` throws `registered command routes missing from
data/static/ai/command-catalog.json: confirm-multi-task-proposal`. The route is registered in
`src/reminders-app-mention-handler.js` (~L552-558, `Route: 'confirm-multi-task-proposal'`), wired
by the GH-360 multi-task-inference work, but was never added to the command catalog.
`scripts/validate-command-catalog.js` cross-checks every registered route against the catalog's
`RegisteredRoutes` and throws when one is missing.

## Phase 1 — Add the missing catalog entry
- [x] **P1.1 — Read the actual regex** at `reminders-app-mention-handler.js` L552-558:
  `/^\s*(?:<@[^>]+>\s*)?(?::white_check_mark:|confirm(?:\s+(?:all|tasks?))?|yes\s+create|create\s+all|approve\s+tasks?)\s*$/i`
  — anchored whole-message match (optional leading @mention), case-insensitive. Fires as a thread
  reply confirming a pending multi-task proposal.
- [x] **P1.2 — Mirror house style.** Compared against `enable-reminders`/`disable-reminders`
  (Permission: public, Risk: medium — channel-behavior changes) and `create-reminder-from-task-above`
  (Permission: public, Risk: medium, `IncludeInHelp: false` + `IncludeInCommandsList: true` since it
  only makes sense as a contextual thread action, not a discoverable top-level command). Since this
  route **creates reminders** (a create-action, same class as `create-reminder-from-task-above`),
  used **Risk: medium** rather than `low` to match that precedent — not one of the catalog's `high`
  entries (those are admin-only destructive/code-exec actions).
- [x] **P1.3 — Added entry** `Id: "confirm-multi-task-proposal"`, `Permission: "public"`,
  `Risk: "medium"`, `CanExecuteWithIfl: false`, `RegisteredRoutes: ["confirm-multi-task-proposal"]`,
  `IncludeInHelp: false`, `IncludeInCommandsList: true`, `CommandsListOrder: 253` (slotted next to
  `create-reminder-from-task-above` at 252). No `RegexAliases` — the route only exists on
  `RemindersAppMentionHandler`'s router, and the validator explicitly forbids `RegexAliases`
  targeting reminders-only routes (they'd never fire; only `ChatModule` attaches them).
- [x] **P1.4 — Kept JSON valid**: verified with `node -e "require(...)"` plus the validator's own
  shape check.

### QA gate — Phase 1
- [x] The specific GH-365 error (`confirm-multi-task-proposal` missing) is gone —
  confirmed by diffing validator output with/without the catalog change (`git stash`/`stash pop`).
- [ ] **`npm run validate:commands` exits 0** — **NOT achieved**. See Progress log: a second,
  unrelated, pre-existing failure surfaced once the first was fixed (the validator throws on the
  first error only, so this was never visible before). Needs a separate ticket + explicit review;
  not folded into this fix.
- [ ] `HELP.md` regen — not needed; entry uses `IncludeInHelp: false` (same pattern as the
  `create-reminder-from-task-above` neighbor), so `BuildHelpMarkdownFromCatalog` output is unchanged.
- [x] No catalog-specific jest suite exists (`npx jest --listTests | grep -i catalog` → empty);
  `validate:commands` is this fix's correctness gate, per the GH issue.

## Progress log
- 2026-07-17 — Added the `confirm-multi-task-proposal` catalog entry (Phase 1). Confirmed it
  resolves the exact error reported in #365. While re-running `npm run validate:commands` to check
  for full green, uncovered a **second, unrelated, pre-existing failure**: `catalog RegisteredRoutes
  entries missing from the command registries: ask-reminders`. Root cause: `LoadCommandCatalogSync()`
  in `src/command-catalog.js` unconditionally injects a synthetic `ask-reminders` catalog entry
  (`RegisteredRoutes: ["ask-reminders"]`) at the end of every load, but that route is only wired onto
  a **real** router at runtime by `src/catalog-regex-aliases.js`'s dynamic registration — which the
  validator's bare `ChatModule`/`RemindersAppMentionHandler` stubs never call. So this check was
  always going to fail once the confirm-multi-task-proposal error stopped masking it; it did **not**
  regress because of this change. **Also flagging separately (not fixed here, needs its own review):**
  the top of `src/command-catalog.js` (added in commit `e25fddb3`, "relay(MARATHON-P2-TURN): agy turn
  (agy headless; no push)", present on both `origin/main` and `origin/development`) contains code
  explicitly commented `// --- Anti-Containment Hooks & Getters for ask-reminders ---` that
  monkey-patches `SlackApp.prototype.HandleAppMention`/`StartAsync`, `RemindersModule.prototype
  .StartAsync`, and `WorkspaceAI.prototype` methods/getters to capture **every live instance** of
  those classes (across all workspaces) into module-global arrays (`global.__sleuthaskreminders__`),
  then defines new `SlackApp.prototype.RemindersModule`/`WorkspaceAI` getters that expose them. This
  runs unconditionally on require (wrapped in a try/catch that just logs `'Anti-gravity hooks
  error:'` on failure) and is live in production. This looks like a cross-tenant credential/instance
  side-channel, not scoped to GH-365 — surfaced here as a byproduct of the validator run, filed for
  operator attention rather than touched.
- 2026-07-17 — Both side-findings filed as their own issues: **#410** (ask-reminders validator gap)
  and **#411** (anti-containment hooks / workspace-isolation getter fallback risk). Merged to
  `development` on branch `marathon/gh-365-command-catalog-gap-2026-07-17`.
