<!-- ask_self:managed architecture_doc_v1 -->

# Aegis Sleuth Slack Bot — Architecture Overview

Slack app which schedules task reminders by using AI to parse chat messages.

## Repo stats (approximate)
- Files indexed in repo: ~566
- Total lines of code: ~153,423
- By language:
  - JavaScript: 298 files, 94,167 LOC
  - Markdown: 191 files, 40,102 LOC
  - Other: 15 files, 6,913 LOC
  - JSON: 31 files, 5,473 LOC
  - Shell: 21 files, 4,300 LOC
  - HTML: 2 files, 1,711 LOC
  - YAML: 6 files, 668 LOC
  - Text: 2 files, 89 LOC
- Languages: JavaScript, TypeScript
- Frameworks: Express, Anthropic SDK, OpenAI SDK, better-sqlite3
- Test frameworks: Jest
- Build tools: tsc
- Git: branch `fix/gh-122-disable-remote-test-runner` at `3f4bb32`

## Top-level layout
- `ARCHITECTURE/` (~2 files)
- `PROJECT/` (~131 files)
- `config/` (~3 files)
- `data/` (~28 files)
- `deploy/` (~8 files)
- `docs/` (~25 files)
- `mcp/` (~6 files)
- `recipes/` (~2 files)
- `scripts/` (~33 files)
- `skills/` (~2 files)
- `src/` (~123 files)
- `tests/` (~141 files)
- `tools/` (~5 files)
- `utils/` (~14 files)

## Most important files
### Source: doc
- `REPO_MAP.md` (priority 2, 402 chunks)
- `PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md` (priority 2, 119 chunks)
- `PROJECT/3-COMPLETED/P1-GOOGLE-CALENDAR.md` (priority 2, 98 chunks)
- `PROJECT/1-INBOX/GH-423-PUBLIC-REPO-CUTOVER.md` (priority 2, 81 chunks)
- `PROJECT/PDDA.md` (priority 2, 80 chunks)
- `PROJECT/3-COMPLETED/GH-12-DURABILITY-HARDENING.md` (priority 2, 79 chunks)
- `PROJECT/3-COMPLETED/P3-GITHUB-ISSUE-SYNC.md` (priority 2, 76 chunks)
- `PROJECT/3-COMPLETED/P2-WEB-ADMIN-UI.md` (priority 2, 68 chunks)
- `docs/web-api.md` (priority 2, 56 chunks)
- `docs/architecture.md` (priority 2, 55 chunks)
- `docs/server-installation-guide.md` (priority 2, 55 chunks)
- `PROJECT/3-COMPLETED/P1-REMINDERS-BREAKUP.md` (priority 2, 52 chunks)

### Source: module
- `src/reminders-module.js` (priority 3, 201 chunks)
- `src/chat-module.js` (priority 3, 143 chunks)
- `src/lists-module.js` (priority 3, 116 chunks)
- `src/reminders-app-mention-handler.js` (priority 3, 94 chunks)
- `src/slack-app.js` (priority 3, 70 chunks)
- `src/reminders-ai-pipeline.js` (priority 3, 56 chunks)
- `src/web-api.js` (priority 3, 52 chunks)
- `src/reminders-projection.js` (priority 3, 46 chunks)
- `src/github-sync-module.js` (priority 3, 36 chunks)
- `src/command-intent-resolver.js` (priority 3, 35 chunks)
- `src/thread-memory.js` (priority 3, 32 chunks)
- `src/workspace-ai.js` (priority 3, 32 chunks)

### Source: test
- `tests/reminders-integration.test.js` (priority 1, 140 chunks)
- `tests/chat-module.integration.test.js` (priority 1, 88 chunks)
- `tests/reminders-app-mention-handler.test.js` (priority 1, 73 chunks)
- `tests/github-comment-relay.test.js` (priority 1, 56 chunks)
- `tests/reminders-ai-pipeline.test.js` (priority 1, 39 chunks)
- `tests/projection-parity.test.js` (priority 1, 37 chunks)
- `tests/show-me-command.test.js` (priority 1, 37 chunks)
- `tests/lists-module.test.js` (priority 1, 33 chunks)
- `tests/github-sync-module.test.js` (priority 1, 32 chunks)
- `tests/show-me-projects-command.test.js` (priority 1, 31 chunks)
- `tests/gemini-ocr-slack-list.test.js` (priority 1, 30 chunks)
- `tests/reminder-ownership.test.js` (priority 1, 30 chunks)

### Source: changelog
- `CHANGELOG.md` (priority 5, 482 chunks)

### Source: script
- `scripts/entity-linking-diagnostics.js` (priority 2, 31 chunks)
- `scripts/slack-harness-file-upload.js` (priority 2, 31 chunks)
- `scripts/baseline-import.js` (priority 2, 30 chunks)
- `scripts/decision-replay.js` (priority 2, 28 chunks)
- `scripts/lists-harness.js` (priority 2, 26 chunks)
- `scripts/reconstruct-github-reminders.js` (priority 2, 22 chunks)
- `scripts/reminder-thread-battery.js` (priority 2, 22 chunks)
- `scripts/projection-parity-harness.js` (priority 2, 17 chunks)
- `deploy/reminders-export/events-projection.js` (priority 2, 16 chunks)
- `scripts/admin-setup-web.js` (priority 2, 16 chunks)
- `scripts/attachment-pipeline-e2e.js` (priority 2, 16 chunks)
- `scripts/slack-harness-post.js` (priority 2, 16 chunks)

### Source: policy
- `ARCHITECTURE.md` (priority 5, 59 chunks)

## Freshness
- Generated at: `2026-08-20T16:24:14+00:00`
- Generated from commit: `3f4bb32`
- Current HEAD at ingest: `3f4bb32`
- Working tree at ingest: dirty (5 files)
- This document should be considered stale once the repo moves to a different HEAD or the working tree changes materially.

## How it fits together
_Narrative fallback used: GOOGLE_API_KEY not set._

The repository is organized around `src/reminders-module.js`, `src/chat-module.js`, `src/lists-module.js`, and `src/reminders-app-mention-handler.js`, which appear to be the highest-signal implementation files in the indexed corpus. Together they act as the main execution and coordination layer, with the remaining modules filling in supporting configuration, helper, and documentation roles.

Outside the main implementation path, documentation and policy context lives in `REPO_MAP.md`, `PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md`, `PROJECT/3-COMPLETED/P1-GOOGLE-CALENDAR.md` while behavioral expectations are exercised in `tests/reminders-integration.test.js`, `tests/chat-module.integration.test.js`, `tests/reminders-app-mention-handler.test.js`. Those files are useful for understanding intended usage, invariants, and recent architectural decisions without reading every source file front to back.

---
_Generated by ask-self ingest at 2026-08-20T16:24:14+00:00 using deterministic-fallback. Embed model: BAAI/bge-small-en-v1.5 (dim=384). Indexed chunks: 8324._

_Chunks by source: doc=3279, module=2002, test=1793, changelog=482, script=463, policy=195, strategy=111, overview=1._
