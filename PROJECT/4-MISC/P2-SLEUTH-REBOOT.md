# Sleuth Open Source Reboot Strategy (P2-SLEUTH-REBOOT)

## Overview
This document outlines the architectural strategy and effort required to convert Sleuth from a purpose-built reminders bot into a generalized, open-source Slack-to-AI gateway. 

To achieve this, the core conversational and routing capabilities will be open-sourced, while product-specific features like the Reminders system, Lists, and GitHub sync will be decoupled and packaged as "premium" add-ons.

## 1. Advance the Plugin Architecture (Phases 3 & 5)
Currently, `app.js` tightly couples `RemindersModule`, `ListsModule`, `NotionModule`, and `GitHubSyncModule` in a hardcoded waterfall event chain. To decouple Reminders into a standalone plugin, the Plugin Architecture must be advanced:

*   **Event Hooks (Phase 3):** The plugin system currently supports `@sleuth command` mentions (Phase 1). Reminders require passive message monitoring (for scheduling) and reaction handling (for the 🚨 and 🗑️ emojis). We must expose `SlackApp.HandleMessage` and `SlackApp.HandleReactionAdded` to the plugin loader.
*   **Background Jobs (Phase 5):** The Reminders module relies on a 60-second timer interval. The plugin system will need a safe lifecycle (`StartAsync`/`StopAsync`) for plugins to register background tasks and timers without leaking memory on reload.
*   **Data Persistence (Phase 2):** Plugins need a localized runtime data namespace. The premium Reminders plugin must be able to store its `reminders.json` securely without cluttering the core gateway's state.

## 2. Refactor the Core Gateway
Once the plugin architecture supports message/reaction hooks and timers, product-specific modules can be stripped from `app.js`.

*   The open-source core will consist of `SlackApp`, `PluginLoader`, and `ChatModule`.
*   `ChatModule` acts as the default "catch-all" conversationalist at the end of the event chain.
*   Since plugins load first and return `true` when they consume an event, a premium Reminders plugin can successfully intercept a message, schedule a reminder, and halt the chain before the core `ChatModule` attempts to generate a generic AI reply.

## 3. Implement AI Provider Abstraction (Phase 4)
A generalized open-source gateway should not be hardcoded to OpenAI. We will execute the planned Phase 4 of the Plugin Architecture:

*   Extract OpenAI-specific logic from `WorkspaceAI`.
*   Create an `AIAdapter` interface (e.g., `CallAsync(prompt, schema, model, temperature)`).
*   Ship the OpenAI adapter as the default in the open-source repository.
*   Allow the community to build and distribute adapter plugins for Claude, Google Gemini, or local models (like Ollama).

## 4. Single-Tenant "Easy Mode"
Sleuth's current multi-tenant architecture (driven by the Port 2020 Web API and `workspaces.json`) is optimized for SaaS but is heavy for open-source self-hosters. 

*   Implement a simple `.env` fallback mode where a single `SLACK_APP_TOKEN` and `OPENAI_API_KEY` bypasses the workspace provisioner.
*   This ensures "time-to-first-message" is instantaneous for new community users testing the open-source gateway.

## 5. Distribution Strategy
*   **Core Repo (Public):** Released under MIT or Apache license. Contains `app.js`, Slack routing, Plugin loading, and the baseline Chat gateway.
*   **Premium Plugins Repo (Private):** Contains the decoupled `reminders`, `lists`, and `github-sync` plugins.
*   **Monetization / Access:** Distribute premium features as an NPM package behind a private registry, or have the core `PluginLoader` fetch them at runtime if the workspace configuration contains a valid premium license key.