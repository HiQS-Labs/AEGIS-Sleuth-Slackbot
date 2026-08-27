---
gh_issue: 137
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/137
title: "ask-code: hands-free thread-sticky routing (skip repeating the project slug)"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-25
owner: noel
doc_type: feedback
effort: 2
complexity: 2
risk: 2
phases: 1
---

# GH-137 — ask-code hands-free thread-sticky routing

## Asks / acceptance criteria

`ask-code <project> <question>` (`src/chat-commands/ask-code-command.js`) is stateless — routing
only fires on a literal `ask-code <slug>` prefix match
(`ChatModule.AskCodeCommandRegex`, `src/chat-module.js:152`). Every follow-up in a thread requires
retyping the prefix.

1. Add a sticky-session store (new module, e.g. `src/ask-code-session.js`, mirroring the split-out
   pattern already used by `src/thread-memory.js`) mapping `channel:thread_ts -> { slug, lastActiveAt }`,
   written after `HandleAskCodeCommandAsync` posts its first reply. In-memory only.
2. In the message router (`src/chat-module.js` around lines 495-520), check the sticky map before
   falling through to generic chat handling: a threaded reply to an active session, not matching any
   other registered command, routes straight to `HandleAskCodeCommandAsync` with the remembered slug.
3. Required exit conditions: idle TTL (proposed 20-30 min), explicit `ask-code stop`, or a new
   `ask-code <slug>` overriding the session. This is the acceptance-critical part — without a bounded
   exit, an unrelated later reply in the thread gets silently proxied to a remote RAG endpoint.
4. Keep the existing `NEOCHROME_TEAM_ID` tenancy gate on the sticky path.

## Non-goals

- Persisting sessions across a process restart.
- Any change to `ask-self`'s own regex-only routing.
