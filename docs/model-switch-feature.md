# Model Switch Feature

Runtime model switching via Slack command without app restart.

## Overview

Allow users to switch the AI model used by AEGIS through a Slack command. Changes take effect immediately without restarting the Node app.

## How to Use

### Quick Reference

**Switch default model only:**
```
@Sleuth AI model-switch:'gpt-4o-mini'
```

**Switch complex model only:**
```
@Sleuth AI model-switch:complex='gpt-4o'
```

**Switch both models:**
```
@Sleuth AI model-switch:default='gpt-4o-mini',complex='gpt-4o'
```

**View current models:**
```
@Sleuth AI models
```

### Model Types

- **Default Model**: Used for general chat responses, reminder analysis, and deduplication
- **Complex Model**: Used specifically for date/time extraction (more accurate for complex date parsing)

### Notes

- Model names are validated against OpenAI's available models before switching
- Invalid model names will be rejected with an error message
- Changes take effect immediately - no restart required
- Both models are updated when switching the default model
- Complex model switching only affects date extraction tasks

## Command Formats

### Switch Default Model Only
```
@Sleuth AI model-switch:'gpt-4o-mini'
```
This switches only the default model (used for chat and reminder analysis).

### Switch Complex Model Only
```
@Sleuth AI model-switch:complex='gpt-4o'
```
This switches only the complex model (used for date extraction).

### Switch Both Models
```
@Sleuth AI model-switch:default='gpt-4o-mini',complex='gpt-4o'
```
This switches both the default and complex models in a single command.

### View Current Models
```
@Sleuth AI models
```
This displays the current default and complex model configuration.

## User Experience

### Success Flow - Default Model Only
```
User: @Sleuth AI model-switch:'gpt-4o-mini'
AEGIS: Default model switched to 'gpt-4o-mini'
```

### Success Flow - Complex Model Only
```
User: @Sleuth AI model-switch:complex='gpt-4o'
AEGIS: Complex model switched to 'gpt-4o'
```

### Success Flow - Both Models
```
User: @Sleuth AI model-switch:default='gpt-4o-mini',complex='gpt-4o'
AEGIS: Default model switched to 'gpt-4o-mini'
       Complex model switched to 'gpt-4o'
```

### View Current Models
```
User: @Sleuth AI models
AEGIS: *Current Model Configuration*
       Default model: `gpt-4o-mini`
       Complex model: `gpt-4o`
```

### Failure Flow (Invalid Model)
```
User: @Sleuth AI model-switch:'gpt-5-mni'
AEGIS: 'gpt-5-mni' not found. Default still using 'gpt-4o-mini'
```

## Current Model Usage

| Model | Location | Purpose |
|-------|----------|---------|
| `gpt-4o-mini` | `workspace-ai.js:71` | Default - chat, reminder extraction, deduplication |
| `gpt-4o` | `workspace-ai.js:74` | Complex - date extraction (complex task) |

## Architecture Notes

- Two separate `WorkspaceAI` instances exist (chat-module and reminders-module)
- ✅ `DefaultModelName` setter already implemented in `workspace-ai.js:98`
- ✅ `ComplexModelName` setter already implemented in `workspace-ai.js:114`
- ✅ `GetAvailableModelsAsync()` already implemented in `workspace-ai.js:122`
- ✅ `IsValidModelAsync()` already implemented in `workspace-ai.js:143`
- The `gpt-4o` for date extraction uses `ComplexModelName` property
- When default model is switched, both chat-module and reminders-module are updated
- Complex model switching only affects reminders-module (date extraction)

## Implementation Plan

### 1. WorkspaceAI Class Changes (`src/workspace-ai.js`) ✅ DONE

The following have already been implemented:

```javascript
// Cache for available models (line 48)
#AvailableModels = null;

// Getter for available models - fetches and caches on first call (line 122)
async GetAvailableModelsAsync() {
  if (this.#AvailableModels) return this.#AvailableModels;
  const response = await this.#OpenAI.models.list();
  this.#AvailableModels = [];
  for await (const model of response) {
    this.#AvailableModels.push(model.id);
  }
  return this.#AvailableModels;
}

// Validate model name against available models (line 143)
async IsValidModelAsync(ArgModelName) {
  const models = await this.GetAvailableModelsAsync();
  return models.includes(ArgModelName);
}

// Setter for default model name (line 98)
set DefaultModelName(value) {
  this.#DefaultModelName = value;
}

// Setter for complex model name (line 114)
set ComplexModelName(value) {
  this.#ComplexModelName = value;
}
```

### 2. Command Detection (`src/chat-module.js`)

Add detection before AI processing:

```javascript
// Check for model-switch command before sending to AI
const modelSwitchMatch = MessageText.match(/@Sleuth\s+AI\s+model-switch:'([^']+)'/i);
if (modelSwitchMatch) {
  const requestedModel = modelSwitchMatch[1];
  return await this.#HandleModelSwitchAsync(requestedModel);
}
```

### 3. Command Handler (`src/chat-module.js`)

New method to handle the switch:

```javascript
async #HandleModelSwitchAsync(requestedModel) {
  const currentModel = this.#WorkspaceAI.DefaultModelName;

  // Validate the requested model
  const isValid = await this.#WorkspaceAI.IsValidModelAsync(requestedModel);

  if (!isValid) {
    return `'${requestedModel}' not found. Still using '${currentModel}'`;
  }

  // Update the model
  this.#WorkspaceAI.DefaultModelName = requestedModel;

  return `Model switched to '${requestedModel}'`;
}
```

### 4. Update Both Instances

Since chat-module and reminders-module have separate WorkspaceAI instances, consider:

**Option A**: Only switch chat-module's model (simpler)
- Reminders would continue using their default
- Date extraction stays on `gpt-4o`

**Option B**: Expose reminders-module's WorkspaceAI and switch both
- More complex but consistent behavior

**Recommendation**: Start with Option A for initial testing.

## Implementation Status

| Task | Status |
|------|--------|
| Add model list caching and validation to WorkspaceAI | ✅ Done |
| Add setter for DefaultModelName | ✅ Done |
| Add setter for ComplexModelName | ✅ Done |
| Add command detection in chat-module | ✅ Done |
| Add command handler with validation | ✅ Done |
| Add confirmation/error response | ✅ Done |
| Support switching both default and complex models | ✅ Done |
| Add models command to show current configuration | ✅ Done |
| **Status** | **✅ Fully Implemented** |

## Security Considerations

- No authentication required (internal testing only)
- Anyone in the Slack workspace can switch the model
- Consider adding logging for model switches

## Future Enhancements

1. ✅ **Multiple model configuration**: Switch both default and complex models - **IMPLEMENTED**
   ```
   @Sleuth AI model-switch:default='gpt-4o-mini',complex='gpt-4o'
   ```

2. ✅ **Show current model**: Command to display active models - **IMPLEMENTED**
   ```
   @Sleuth AI models
   ```

3. **List available models**: Show valid model options
   ```
   @Sleuth AI model-list
   ```

4. **Restrict access**: Add user/admin checks if needed later

## Available Models

The full list of available models is fetched dynamically from the OpenAI API via `GetAvailableModelsAsync()`. Below are the commonly used models organized by category.

### Chat Completion Models (Recommended)

| Model | Description | Cost | Best For |
|-------|-------------|------|----------|
| `gpt-4o` | Latest flagship model, multimodal | $$$ | Complex reasoning, date extraction |
| `gpt-4o-mini` | Fast, cost-effective | $ | General chat, reminder analysis (default) |
| `gpt-4o-audio-preview` | Audio input/output support | $$$ | Voice interactions |

### Reasoning Models (o-series)

These models use extended thinking time for complex reasoning tasks.

| Model | Description | Cost | Best For |
|-------|-------------|------|----------|
| `o1` | Advanced reasoning | $$$$ | Complex multi-step problems |
| `o1-mini` | Faster reasoning | $$$ | Math, coding, logic |
| `o1-preview` | Preview of o1 capabilities | $$$ | Testing reasoning features |
| `o3-mini` | Latest compact reasoning model | $$ | Balanced reasoning tasks |

> **Note:** o-series models have different API parameters and may not support all features (e.g., `temperature` must be 1, no `system` messages in some versions).

### GPT-4 Turbo Models

| Model | Description | Cost | Best For |
|-------|-------------|------|----------|
| `gpt-4-turbo` | 128K context, vision capable | $$$ | Long documents, image analysis |
| `gpt-4-turbo-preview` | Preview features | $$$ | Testing new capabilities |

### Legacy Models (Still Supported)

| Model | Description | Cost | Best For |
|-------|-------------|------|----------|
| `gpt-4` | Original GPT-4 | $$$ | Compatibility with existing code |
| `gpt-3.5-turbo` | Fast, very cheap | $ | Simple tasks, high volume |
| `gpt-3.5-turbo-0125` | Latest 3.5 snapshot | $ | Budget-conscious applications |

### Dated Snapshots

OpenAI provides dated snapshots for reproducibility:

- `gpt-4o-2024-11-20` - November 2024 snapshot
- `gpt-4o-2024-08-06` - August 2024 snapshot  
- `gpt-4o-2024-05-13` - May 2024 snapshot
- `gpt-4-turbo-2024-04-09` - April 2024 snapshot
- `gpt-3.5-turbo-0125` - January 2025 snapshot

### Checking Available Models

To see all models available to your API key, use the `@Sleuth AI model-list` command (when implemented), or query the API directly:

```javascript
const models = await workspaceAI.GetAvailableModelsAsync();
console.log(models.filter(m => m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')));
```

### Model Selection Guidelines

| Use Case | Recommended Model |
|----------|-------------------|
| General chat responses | `gpt-4o-mini` (default) |
| Date/time extraction | `gpt-4o` (complex model) |
| Cost-sensitive high volume | `gpt-3.5-turbo` |
| Maximum accuracy needed | `gpt-4o` or `o1` |
| Complex reasoning/coding | `o1-mini` or `o3-mini` |

## Package Requirements

- `openai`: `^6.9.1` (current version in package.json)
- Node.js: 18+ (v18.20.4 used in development per AGENTS.md)
