---
gh_issue: 139
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/139
title: "ask-code: re-introduce file references / citations lost from the ask-self generation"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-26
owner: noel
doc_type: feedback
effort: 3
complexity: 2
risk: 1
phases: 1
---

# GH-139 — ask-code citations parity with ask-self

## Asks / acceptance criteria

`ask-self` (`src/rag/index.js`) always appends `_Sources consulted: ..._`, derived from the
retrieved chunks' own `path`/`pr_number` metadata (`queryRagAsync`, `askSelf()` at
`src/rag/index.js:264`). `ask-code` (`src/chat-commands/ask-code-command.js`) has no equivalent —
`ExtractAnswerText` reads only `.answer` from the remote JSON payload and discards everything else.

1. Phase 0: check whether the remote wrapper response for at least one registered project already
   carries a sources/citations field `ExtractAnswerText` is ignoring, vs. the wrapper contract never
   defining one at all (a cross-repo dependency in the second case — e.g. LTVera's own endpoint).
   There is no documented response contract today beyond the informal `{answer}` shape assumed by
   `ExtractAnswerText`; worth writing one down regardless of which case this turns out to be.
2. Extend `ExtractAnswerText` (or a sibling extractor) to render a returned sources/citations array
   the same way ask-self does, for format consistency between the two commands.
3. Degrade gracefully (no citation line) when a project's wrapper has no source metadata to return.

## Non-goals

- Rewriting the remote wrapper protocol wholesale.
- Retrofitting citations into every registered project if their wrappers can't supply them.
