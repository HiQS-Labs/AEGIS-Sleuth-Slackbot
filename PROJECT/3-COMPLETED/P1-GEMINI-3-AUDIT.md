# Code Audit: DRY and SOLID Principles

Status: Not Started

This document contains an audit of the Sleuth application codebase, focusing on adherence to DRY (Don't Repeat Yourself) and SOLID principles.

## Prerequisites

Before undertaking the major refactoring tasks below, the following dependencies must be met to ensure a safe and controlled migration:

1. **Layer 2 Test Harness:** Establish the **Layer 2 (Mock SlackApp)** test harness (defined in `P1-TEST-HARNESS.md`) completely. This will provide a critical regression safety net by simulating user inputs and block actions before breaking apart existing module interactions.
2. **Technical Spike:** Execute a timeboxed technical spike targeting one specific responsibility extraction (e.g., File System I/O) from `RemindersModule`. The goal is to prove the pattern and validate end-to-end functionality using the new Layer 2 test harness without altering UI or scheduling logic yet.

## 🔴 High Severity

### `RemindersModule` Violates Single Responsibility Principle (SRP)
- **Status:** [ ] To Do
- **Dependencies:** Requires Layer 2 Mock SlackApp Harness and successful Technical Spike.
- **Effort:** High
- **Risk:** High
- **File:** `src/reminders-module.js`
- **Issue:** The `RemindersModule` is extremely large (~2800 lines) and clearly violates SRP. It currently seems to handle:
  - File I/O and persistence (loading/saving JSON files).
  - Scheduling logic (timers, snooze logic, intervals).
  - Business logic (FSM state transitions, deduplication, GitHub issue syncing logic).
  - Command dispatch logic.
  - Slack UI formatting and posting.
- **Risk:** This file is a "God object". Any change to persistence, scheduling, or Slack formatting requires modifying this single large file, which increases the likelihood of introducing regressions. It also makes unit testing significantly harder, as extracting isolated testing logic (like `GitHubSyncModule`) was already a necessary workaround.
- **Recommendation:** Break `RemindersModule` into smaller, cohesive classes. Potential extractions:
  - `RemindersRepository`: Handles only reading/writing the `_reminders.json` data.
  - `RemindersScheduler`: Handles timers, polling loops, and snooze math.
  - `RemindersFSM`: Handles state transitions to make the State the single source of truth.
  - `RemindersSlackUI`: Handles building blocks for Slack messages.

## 🟠 Medium Severity

### Slack App Event Handling Tight Coupling
- **Status:** [ ] To Do
- **Effort:** Medium
- **Risk:** Medium
- **File:** `src/chat-module.js`, `src/slack-app.js`
- **Issue:** Command routing logic inside of handlers like `onAppMentionAsync` heavily utilizes procedural `if/else if` blocks tied to regular expressions (`/run-diagnostics\b/i.test(...)`). 
- **Risk:** This violates the **Open/Closed Principle (OCP)**. Every time a new command is added (e.g. `run-tests`), `ChatModule` must be modified.
- **Recommendation:** Implement a central Command Registry or Command Pattern where individual modules can register their command regex and handler functions independently.

### `workspace-ai.js` Coupling with Third-Party Models
- **Status:** [ ] To Do
- **Effort:** Medium
- **Risk:** Low
- **File:** `src/workspace-ai.js` 
- **Issue:** The AI logic is hardcoded to specific expected behaviors of OpenAI. 
- **Risk:** Violates **Dependency Inversion Principle (DIP)**. If the app needs to support an alternative LLM provider (e.g. Anthropic, Gemini) via an abstraction, the strong coupling to OpenAI specifics will require significant refactoring.
- **Recommendation:** Define an interface (even if implicit in JS) for `IAIProvider` and have `WorkspaceAI` use that interface rather than being the direct tight integration.

## 🟡 Low Severity

### DRY: Path Joining Patterns
- **Status:** [ ] To Do
- **Effort:** Low
- **Risk:** Low
- **Files:** Spread across various modules (`diagnostics.js`, `chat-module.js`, `workspaces.js`)
- **Issue:** Logic to build file paths for workspaces, stats, and reminders using `path.join(__dirname, '..', 'data', 'runtime', ...)` is repeated in multiple places.
- **Risk:** Minor violation of DRY. If the data directory structure moves, numerous files must be updated.
- **Recommendation:** Centralize path resolution logic within a configuration manager or the `workspaces.js` utility, which should serve as the single source of truth for all runtime file paths.
