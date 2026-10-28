---
gh_issue: 289
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/289
title: "Router takeover can still reach takeover-excluded commands through rmm ifl"
status: Proposed (1-INBOX — not yet active)
created: 2026-10-28
doc_type: bugfix
---

# GH-289 · Takeover can reach takeover-excluded commands through `rmm ifl`

Deferred follow-up to #287 / #288. Found by CodeRabbit on #287.

## Ask

- **The hole:** `rmm` may run from takeover (`CanExecuteFromTakeover: true`), and `BuildCanonicalCommand` passes the model's query text through (`src/command-intent-resolver.js:405`). A takeover candidate `rmm` with a query starting `ifl` therefore runs `rmm ifl …`. That handler checks only `CanExecuteWithIfl` (`src/chat-commands/rmm-command.js`), so it can reach `ask-reminders`, `scan-image-for-text`, `make-list-from-image` and `convert-text-into-slack-list`.
- **Fix (not chosen):** either takeover refuses a canonical command starting `rmm ifl`, or `rmm` loses `CanExecuteFromTakeover`. A typed `rmm ifl …` is unaffected either way, because the deterministic router matches it first (GH-174).
- **Done when:** a takeover candidate `rmm` with query `ifl make a list from this` doesn't execute (red with the guard removed), and a typed `rmm ifl …` still runs.

## Confidence

The path is confirmed by reading the code at `bc4ce41`. It hasn't been reproduced live or in a test, and it needs a two-step model misread.

**Revisit:** before the next router-mode or takeover change, or if a corpus record shows a takeover candidate of `rmm ifl`.
