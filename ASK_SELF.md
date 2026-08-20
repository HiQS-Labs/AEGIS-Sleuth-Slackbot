<!-- ask_self:managed architecture_doc_v1 -->

# Aegis Sleuth Slack Bot — Architecture Overview

Slack app which schedules task reminders by using AI to parse chat messages.

## Repo stats (approximate)
- Files indexed in repo: ~566
- Total lines of code: ~153,682
- By language:
  - JavaScript: 299 files, 94,527 LOC
  - Markdown: 191 files, 40,068 LOC
  - Other: 15 files, 6,913 LOC
  - JSON: 30 files, 5,417 LOC
  - Shell: 21 files, 4,289 LOC
  - HTML: 2 files, 1,711 LOC
  - YAML: 6 files, 668 LOC
  - Text: 2 files, 89 LOC
- Languages: JavaScript, TypeScript
- Frameworks: Express, Anthropic SDK, OpenAI SDK, better-sqlite3
- Test frameworks: Jest
- Build tools: tsc
- Git: branch `development` at `3c267cd`

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
- `src/` (~124 files)
- `tests/` (~141 files)
- `tools/` (~5 files)
- `utils/` (~14 files)

## Most important files
### Source: doc
- `REPO_MAP.md` (priority 2, 402 chunks)
- `PROJECT/3-COMPLETED/P1-GOOGLE-CALENDAR.md` (priority 2, 73 chunks)
- `PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md` (priority 2, 59 chunks)
- `PROJECT/3-COMPLETED/P3-GITHUB-ISSUE-SYNC.md` (priority 2, 56 chunks)
- `PROJECT/1-INBOX/GH-423-PUBLIC-REPO-CUTOVER.md` (priority 2, 54 chunks)
- `docs/server-installation-guide.md` (priority 2, 54 chunks)
- `docs/web-api.md` (priority 2, 54 chunks)
- `docs/architecture.md` (priority 2, 53 chunks)
- `PROJECT/3-COMPLETED/GH-12-DURABILITY-HARDENING.md` (priority 2, 49 chunks)
- `PROJECT/3-COMPLETED/P2-WEB-ADMIN-UI.md` (priority 2, 47 chunks)
- `PROJECT/PDDA.md` (priority 2, 47 chunks)
- `PROJECT/3-COMPLETED/P1-REMINDERS-BREAKUP.md` (priority 2, 44 chunks)

### Source: module
- `src/reminders-module.js` (priority 3, 76 chunks)
- `src/chat-module.js` (priority 3, 56 chunks)
- `src/lists-module.js` (priority 3, 44 chunks)
- `src/reminders-app-mention-handler.js` (priority 3, 36 chunks)
- `src/slack-app.js` (priority 3, 27 chunks)
- `src/entity-linking.js` (priority 3, 24 chunks)
- `src/command-intent-resolver.js` (priority 3, 23 chunks)
- `src/reminders-ai-pipeline.js` (priority 3, 22 chunks)
- `src/reminders-projection.js` (priority 3, 22 chunks)
- `src/client-mapping.js` (priority 3, 20 chunks)
- `src/entity-read-model.js` (priority 3, 20 chunks)
- `src/web-api.js` (priority 3, 20 chunks)

### Source: test
- `tests/reminders-integration.test.js` (priority 1, 54 chunks)
- `tests/chat-module.integration.test.js` (priority 1, 34 chunks)
- `tests/reminders-app-mention-handler.test.js` (priority 1, 29 chunks)
- `tests/github-comment-relay.test.js` (priority 1, 24 chunks)
- `tests/show-me-command.test.js` (priority 1, 17 chunks)
- `tests/projection-parity.test.js` (priority 1, 15 chunks)
- `tests/reminders-ai-pipeline.test.js` (priority 1, 15 chunks)
- `tests/marathon-360-361-362-e2e.test.js` (priority 1, 14 chunks)
- `tests/show-me-projects-command.test.js` (priority 1, 14 chunks)
- `tests/lists-module.test.js` (priority 1, 13 chunks)
- `tests/gemini-ocr-slack-list.test.js` (priority 1, 12 chunks)
- `tests/github-sync-module.test.js` (priority 1, 12 chunks)

### Source: script
- `scripts/entity-linking-diagnostics.js` (priority 2, 24 chunks)
- `scripts/baseline-import.js` (priority 2, 19 chunks)
- `scripts/slack-harness-file-upload.js` (priority 2, 18 chunks)
- `scripts/decision-replay.js` (priority 2, 15 chunks)
- `scripts/lists-harness.js` (priority 2, 15 chunks)
- `scripts/reconstruct-github-reminders.js` (priority 2, 15 chunks)
- `scripts/admin-setup.js` (priority 2, 14 chunks)
- `scripts/reminder-thread-battery.js` (priority 2, 14 chunks)
- `scripts/projection-parity-harness.js` (priority 2, 12 chunks)
- `tools/snapshot-sleuth-forward.js` (priority 2, 11 chunks)
- `deploy/reminders-export/events-projection.js` (priority 2, 10 chunks)
- `scripts/slack-harness-post.js` (priority 2, 10 chunks)

### Source: changelog
- `CHANGELOG.md` (priority 5, 232 chunks)

### Source: policy
- `AGENTS.md` (priority 5, 38 chunks)

## Freshness
- Generated at: `2026-08-20T02:16:17+00:00`
- Generated from commit: `3c267cd`
- Current HEAD at ingest: `3c267cd`
- Working tree at ingest: dirty (5 files)
- This document should be considered stale once the repo moves to a different HEAD or the working tree changes materially.

## How it fits together
_Narrative fallback used: Gemini finish reason was MAX_TOKENS; compact retry: Gemini finish reason was MAX_TOKENS._

The repository is organized around `src/reminders-module.js`, `src/chat-module.js`, `src/lists-module.js`, and `src/reminders-app-mention-handler.js`, which appear to be the highest-signal implementation files in the indexed corpus. Together they act as the main execution and coordination layer, with the remaining modules filling in supporting configuration, helper, and documentation roles.

Outside the main implementation path, documentation and policy context lives in `REPO_MAP.md`, `PROJECT/3-COMPLETED/P1-GOOGLE-CALENDAR.md`, `PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md` while behavioral expectations are exercised in `tests/reminders-integration.test.js`, `tests/chat-module.integration.test.js`, `tests/reminders-app-mention-handler.test.js`. Those files are useful for understanding intended usage, invariants, and recent architectural decisions without reading every source file front to back.

---
_Generated by ask-self ingest at 2026-08-20T02:16:17+00:00 using deterministic-fallback. Embed model: gemini-embedding-001 (dim=768). Indexed chunks: 5265._

_Chunks by source: doc=2720, module=1019, test=801, script=304, changelog=232, policy=137, strategy=53, overview=1._
