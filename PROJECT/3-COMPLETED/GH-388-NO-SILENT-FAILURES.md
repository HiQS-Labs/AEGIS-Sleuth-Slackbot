---
title: "No silent failures in ask-reminders (and command paths): every error must surface"
status: Planned (1-INBOX) — not started
created: 2026-07-15
updated: 2026-07-15
owner: noel
branch: fix/gh-388-no-silent-failures
doc_type: project
gh_issue: 388
source: https://github.com/NeochromeTeam/sleuth-app/issues/388
related: "#384 (the silent-failure incident), #383 (UNRESOLVED surfacing overlap — same empty-result copy)"
effort: 3
complexity: 3
risk: 2
phases: 2
---

# GH-388 — Remove silent failures in ask-reminders and command paths

## Problem (from the #384 incident)
#384 stayed invisible because the failure was **silent at every layer**:
1. Wrong-workspace query matched nothing → flat *"No matching tasks found."* (looks like a real empty).
2. The reply post then failed with `channel_not_found` (wrong bot, not in the private channel) →
   the error was **swallowed**, nothing surfaced.
3. The handler's own catch posted *"Sorry — couldn't complete that query. Check the logs."* through the
   **same wrong client**, so even the failsafe failed silently.

Operator intent: **remove any semblance of silent failure. If there's an error, surface a message.**

## Integration points
- `src/chat-commands/ask-reminders-command.js` — `HandleAskRemindersCommandAsync` reply post + catch;
  the `matchedCount === 0` short-circuit copy.
- `src/slack-app.js` — `PostMessageTextAsync` (L548) is where a post failure currently returns without
  distinguishing a delivery failure from success.
- `src/chat-module.js` + `src/chat-commands/*` — swallowed `catch` audit surface.

## Phase 1 — ask-reminders never fails silently (the primary fix)
- [ ] **P1.1 — reply-post failures surface + log with context.** When the ask-reminders reply
      `chat.postMessage` fails (`channel_not_found`, `not_in_channel`, rate limit, …), log at `error`
      with `{workspace, channel, command}` and attempt a fallback signal (ephemeral / DM / thread)
      rather than returning silently. A post that can't be delivered must never read as success.
- [ ] **P1.2 — failsafe can't itself fail silently.** If the primary reply channel is unusable, the
      catch-block failsafe attempts a fallback path (or at minimum an `error` log with full context),
      never a swallow.

### QA gate — Phase 1
- [ ] Simulated `channel_not_found` on the reply post ⇒ asserted `error` log with
      workspace+channel+command context, plus a fallback attempt — not a silent return.
- [ ] Genuine successful post path unchanged.

## Phase 2 — distinguish "empty" from "couldn't determine" + audit swallows
- [ ] **P2.1 — honest empty copy.** A genuine zero-match keeps its copy; a zero-match that involved an
      unresolved/errored dependency says so. **Dovetails with #383 P2** (UNRESOLVED channel surfacing) —
      coordinate the copy so the two don't double-implement it. (#383 lands first in the marathon; this
      builds on its UNRESOLVED signal.)
- [ ] **P2.2 — command-path catch audit.** Grep `src/chat-commands/` + `src/chat-module.js` for `catch`
      blocks that return/no-op without a user-visible reply **or** an `error`-level log with context;
      fix or annotate each with a reviewed pragma.

### QA gate — Phase 2
- [ ] Empty result with an unresolved dependency ⇒ "may be incomplete" copy (not a flat empty).
- [ ] Empty result with everything resolved ⇒ unchanged "No matching tasks" copy.
- [ ] Audit complete; no un-annotated silent swallow remains in the command paths.

## Out of scope (YAGNI)
- The privacy-cache fix itself (#383) — this is the *surfacing* side; they meet on the empty copy only.
- A repo-wide logging-framework change (use the existing logger + `error` level with context).

## Constraints
Sequenced **after #383** in the marathon (shared file `ask-reminders-command.js` + shared empty-result
copy → serialize, don't parallelize). `npm test` green. Bump version + CHANGELOG.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest ask-reminders --forceExit",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/chat-commands/ask-reminders-command.js", "pattern": "channel_not_found" }
  ],
  "artifacts":   [
    "src/chat-commands/ask-reminders-command.js",
    "src/slack-app.js",
    "src/chat-module.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-388 Phase 1 (reply-post surfacing) + Phase 2 (honest empty copy + catch audit)" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

<!-- Preflight note: `artifacts` are EXISTING anchors at the ref; new test files go in the
     MARATHON.yaml phase `artifact` write-allowlist. -->

## Progress log
- 2026-07-15: issue #388 filed, plan drafted, parked in ROADMAP, added to the
  `sleuth-hardening-383-387-388` marathon (phase p3, after #383). Not started.
