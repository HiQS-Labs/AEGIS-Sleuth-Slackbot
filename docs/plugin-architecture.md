
# Plugin Architecture

## Overview

This document describes the AEGIS plugin system, which lets third-party developers extend the AEGIS Slack AI agent without modifying its core source code. Plugins hook into AEGIS's existing event handler chain, AI pipeline, and persistence layer through a stable, versioned interface.

Adoption is phased. Each phase unlocks a new category of extension while keeping earlier phases stable. Start at Phase 1 and graduate to later phases only when the added complexity is justified.

---

## Design Goals

- **Low barrier to entry.** A Phase 1 plugin is a single JavaScript file.
- **Convention over configuration.** Plugins follow the same module patterns already in the codebase.
- **Isolation by default.** Plugins own their own data namespace; they cannot corrupt core workspace files.
- **Registry-gated installs.** Every plugin must be registered in `data/plugin-registry.json` before it can load.
- **No new OpenAI clients.** Plugins that use AI must go through `WorkspaceAI`, the same as core modules.

---

## Plugin Registry

All plugins must be listed in `data/plugin-registry.json` before they can run. This file is the single source of truth for which plugins are installed and enabled across all workspaces.

```json
{
  "version": "1",
  "plugins": [
    {
      "name": "echo-command",
      "displayName": "Echo Command",
      "version": "1.0.0",
      "purpose": "Echoes back any text passed to @sleuth echo. Demonstrates the Phase 1 plugin interface.",
      "publisher": "NeochromeTeam",
      "phase": 1,
      "entryPoint": "src/plugins/echo-command/index.js",
      "enabled": true
    }
  ]
}
```

### Registry Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique kebab-case identifier. Used for file paths and log prefixes. |
| `displayName` | string | yes | Human-readable name shown in help text and logs. |
| `version` | string | yes | Semver string. Increment on every published change. |
| `purpose` | string | yes | One-sentence description of what the plugin does. |
| `publisher` | string | yes | Organization or individual who owns the plugin. |
| `phase` | number | yes | Lowest phase number whose interface this plugin relies on. |
| `entryPoint` | string | yes | Path to the plugin's main file, relative to the project root. |
| `enabled` | boolean | yes | Set to `false` to disable without removing the registry entry. |

> Only plugins with `"enabled": true` are loaded at startup. Changing this field requires a service restart.

---

## Phase Roadmap

### Phase 1 — Command Extension (implemented)

**What it unlocks:** Custom Slack slash-style commands triggered by `@sleuth <your-command>`.

**API surface exposed to plugins:**
- `SlackApp.HandleAppMention(handler)` — register a mention handler.
- `SlackApp.PostMessageTextAsync(channel, threadTs, text)` — post a reply.
- `SlackApp.AppMentionString` — the `<@BOTID>` prefix to match against.
- Read-only access to `WorkspaceInfo` fields (workspace name, timezone, etc.).

**Plugin lifecycle:**

```
PluginLoader.StartAsync()
  └── plugin.StartAsync(ArgSlackApp, ArgWorkspaceInfo)
        └── ArgSlackApp.HandleAppMention(handler)  ← registers into handler chain

Slack app_mention event arrives
  └── handler chain runs; plugin handler fires if text matches its command
        └── returns true (handled) or false (pass through)

PluginLoader.StopAsync()
  └── plugin.StopAsync()
```

**Constraints:**
- Handlers must return `true` when they consume the event and `false` otherwise.
- Do not store a reference to `SlackApp` beyond `StartAsync` if the plugin has no `StopAsync` cleanup needs.
- Plugins load after all core modules, so core commands (reminders, chat, stats) take priority in the handler chain.

---

### Phase 2 — Data Persistence & Per-Workspace Configuration (planned)

**What it unlocks:**
- Plugin-scoped data files under `data/runtime/plugins/<plugin-name>/<workspace-name>_<plugin-name>.json`.
- Optional per-workspace plugin config stored in workspace JSON under a `PLUGINS` object.
- `PluginLoader` passes a `PluginContext` helper with `ReadDataAsync` / `WriteDataAsync` methods that enforce the namespace.

**API additions:**
- `PluginContext.ReadDataAsync()` — reads plugin's workspace-scoped data file.
- `PluginContext.WriteDataAsync(data)` — writes plugin's workspace-scoped data file atomically.
- `WorkspaceInfo.PLUGINS[pluginName]` — plugin config set via workspace JSON or Web API.

**Example use case:** A plugin that tracks which users have run a custom command and how often.

---

### Phase 3 — Reaction & Message Extensions (planned)

**What it unlocks:**
- `SlackApp.HandleReactionAdded(handler)` — register a custom emoji reaction handler.
- `SlackApp.HandleMessage(handler)` — register a handler for non-mention channel messages.

**Use case examples:**
- A plugin that responds to a custom emoji with a formatted summary.
- A plugin that passively monitors messages for keywords and queues follow-ups.

**Constraints:**
- Reaction plugins must not interfere with the core `:alarm_clock:`, `:white_check_mark:`, and `:wastebasket:` emoji flows used by the reminders system.

---

### Phase 4 — AI Provider Abstraction (planned)

**What it unlocks:** Plugins can register an alternative LLM provider (e.g. Google Gemini) that `WorkspaceAI` delegates to when the workspace configuration opts in.

**Proposed design:**
- New `AIAdapter` interface: `CallAsync(prompt, schema, model, temperature)`.
- `WorkspaceAI` gains a `RegisterAdapterAsync(name, adapter)` method.
- Workspace JSON gains an optional `AI_PROVIDER` field (default: `"openai"`).
- When `AI_PROVIDER` matches a registered adapter's name, `WorkspaceAI` routes calls through it.

**Example plugins this phase enables:**
- `gemini-adapter` — routes AI calls to Google Gemini instead of OpenAI.
- `claude-adapter` — routes AI calls to Anthropic Claude.

**Constraints:**
- Adapters must implement the same `{ ok, content }` response shape as `WorkspaceAI.CallAsync`.
- Adapters are responsible for their own API key management (workspace JSON field, never hardcoded).
- The `WorkspaceAI` owner-contract in `AGENTS.md § 0.2` remains: no module outside `workspace-ai.js` creates its own LLM client.

---

### Phase 5 — Complex Feature Plugins (planned)

**What it unlocks:** Plugins can act as full feature modules with their own timers, background jobs, and cross-module data access.

**Example plugins this phase targets:**

**`task-history-search`**
- Persists AEGIS reminder history to a per-workspace SQLite database.
- Generates embeddings (via the configured AI provider) for each task.
- Adds a `@sleuth search-history <query>` command that runs vector similarity search and returns the top matching past tasks.
- Leverages the `sqlite-vec` dependency already in the project.

**`github-issues-inbox`**
- Adds a `@sleuth create-issue <title>` command that opens a GitHub issue in a configured repository.
- Uses `GITHUB_PAT` from workspace config (already supported by the workspace schema).
- Complements the existing `github-sync-module` which relays thread replies to existing issues.

**`model-switcher`**
- Extends the existing `@sleuth model-switch <model>` command to support non-OpenAI models.
- Works in conjunction with the Phase 4 AI provider adapter to route traffic to the selected provider.
- Persists the active provider per workspace in the plugin data file.

---

## Writing a Phase 1 Plugin

### File Structure

```
src/plugins/
  <your-plugin-name>/
    index.js          ← required; must export a class with StartAsync / StopAsync
```

### Plugin Interface (Phase 1)

```js
class MyPlugin {
  /**
   * Start the plugin and register any Slack event handlers.
   * @param {import('../../slack-app')} ArgSlackApp Slack app instance for this workspace.
   * @param {import('../../workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace configuration.
   * @returns {Promise<void>}
   */
  async StartAsync(ArgSlackApp, ArgWorkspaceInfo) {
    ArgSlackApp.HandleAppMention(this.#OnAppMentionAsync.bind(this));
  }

  /**
   * Stop the plugin and clean up any resources.
   * @returns {Promise<void>}
   */
  async StopAsync() { }

  async #OnAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    const Prefix = `${ArgSlackApp.AppMentionString} your-command`;
    if (!ArgEventInfo.text.startsWith(Prefix)) return false;

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'Hello from my plugin!');
    return true;
  }
}

module.exports = MyPlugin;
```

### Registering Your Plugin

Add an entry to `data/plugin-registry.json`:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "purpose": "One sentence description.",
  "publisher": "YourName",
  "phase": 1,
  "entryPoint": "src/plugins/my-plugin/index.js",
  "enabled": true
}
```

Restart the service for the change to take effect:

```
systemctl restart sleuth-app.service
```

---

## Architecture Constraints for Plugin Authors

These rules mirror the core `AGENTS.md` non-negotiables and apply equally to plugins:

1. **No ad-hoc LLM clients.** If your plugin calls an AI model it must go through the `WorkspaceAI` instance passed via `ArgModules.workspaceAI` (available from Phase 2). Never create a new `OpenAI` / `GoogleGenerativeAI` / `Anthropic` client directly inside a plugin.

2. **No cross-workspace file access.** If your plugin persists data, scope all file paths to the current workspace name. Use the `PluginContext` helpers provided in Phase 2+.

3. **Handler return values are a contract.** Return `true` only when your handler fully consumed the event. Returning `true` when you should not silently breaks downstream handlers including core reminders and chat.

4. **Timers must be cleared in `StopAsync`.** Any `setTimeout` or `setInterval` started in `StartAsync` must be cleared in `StopAsync` to allow graceful shutdown.

5. **No hardcoded workspace names, channel IDs, or secrets.** Read all configuration from `ArgWorkspaceInfo` fields or plugin-specific workspace config.

6. **Follow AEGIS coding conventions.** PascalCase identifiers, `Async` suffix on async functions, `Arg` prefix on parameters, `error` as catch variable. See `docs/coding-conventions.md`.

---

## Example Plugin: `echo-command` (Phase 1)

Source: `src/plugins/echo-command/index.js`

Adds the command `@sleuth echo <text>`, which replies with the same text. This plugin ships enabled by default as a reference implementation.

```
@sleuth echo hello world
→ Echo: hello world
```

To disable it, set `"enabled": false` for `"echo-command"` in `data/plugin-registry.json` and restart.
