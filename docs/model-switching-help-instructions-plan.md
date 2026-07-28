# Model Switching Help Instructions Plan

## Summary

This plan adds clear instructions for the model switching feature to two locations:
1. The "help" command output (HELP.md)
2. The "models" command output (chat-module.js)

**Total Estimated Time: 1-2 work hours**

Breakdown:
- **Phase 1: Update Help Command** - 30-45 minutes
  - Add model switching section to HELP.md
  - Include example commands and short model list
  
- **Phase 2: Update Models Command** - 30-45 minutes
  - Append instructions to models command output
  - Include example commands and short model list

**Note**: This estimate includes AI-assisted implementation, code review, and manual testing in Slack to verify the instructions display correctly.

## Overview

Add clear, concise instructions for switching AI models to the help output and models command output. Users should be able to quickly understand how to switch models with example commands and a short list of available models to choose from.

## Requirements

- Add instructions to `@Sleuth AI help` command output
- Add instructions to `@Sleuth AI models` command output
- Include example commands showing how to switch models
- Include a short list of commonly used models
- Keep instructions concise and easy to understand

## Implementation Plan

### Phase 1: Update Help Command (30-45 minutes)

#### 1.1 Add Model Switching Section to HELP.md
**File**: `data/static/HELP.md`

Add a new section after the "Viewing Stats" section and before "Viewing Help":

```markdown
:point_right: *Switching AI Models*: you can switch the AI model used by AEGIS AI at any time. Use *"@Sleuth AI model-switch:'gpt-4o-mini'"* to switch the default model, or *"@Sleuth AI model-switch:complex='gpt-4o'"* to switch the complex model used for date extraction. You can also switch both at once: *"@Sleuth AI model-switch:default='gpt-4o-mini',complex='gpt-4o'"*. Common models: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo`. Changes take effect immediately without restarting the app.
```

**Location**: Insert after line 35 (after "Viewing Stats" section) and before line 38 (before "Viewing Help" section).

**Formatting**: Follow the existing pattern with `:point_right:` emoji and use backticks for model names in the list.

### Phase 2: Update Models Command (30-45 minutes)

#### 2.1 Append Instructions to Models Command Output
**File**: `src/chat-module.js`

Modify the `#OnModelsCommandAsync` method to append instructions after displaying the current model configuration:

```javascript
async #OnModelsCommandAsync(ArgSlackApp, ArgEventInfo) {
  const DefaultModel = this.#WorkspaceAI.DefaultModelName;
  const ComplexModel = this.#RemindersModule?.WorkspaceAI?.ComplexModelName || 'not available';

  const Response = [
    '*Current Model Configuration*',
    `Default model: \`${DefaultModel}\``,
    `Complex model: \`${ComplexModel}\``,
    '',
    '*Switch Models*',
    'To switch the default model: `@Sleuth AI model-switch:\'gpt-4o-mini\'`',
    'To switch the complex model: `@Sleuth AI model-switch:complex=\'gpt-4o\'`',
    'To switch both: `@Sleuth AI model-switch:default=\'gpt-4o-mini\',complex=\'gpt-4o\'`',
    '',
    '*Common Models*: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo`'
  ].join('\n');

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Response);
}
```

**Changes**:
- Add empty line separator after current configuration
- Add "*Switch Models*" section header
- Add three example commands (one per line)
- Add empty line separator
- Add "*Common Models*" line with short list

**Formatting**: Use backticks for code/commands and model names. Use single quotes inside backticks for the example commands to match the actual command syntax.

## Model List

The short list of common models to include:
- `gpt-4o-mini` - Default, cost-effective
- `gpt-4o` - More capable, used for complex tasks
- `gpt-4-turbo` - High performance option
- `o1-mini` - Reasoning model (mini)
- `o1` - Reasoning model (full)
- `gpt-3.5-turbo` - Legacy option

This list covers the most commonly used models without overwhelming users with too many options.

## Testing Checklist

### Help Command Testing
- [ ] Run `@Sleuth AI help` in Slack
- [ ] Verify model switching section appears in output
- [ ] Verify example commands are formatted correctly
- [ ] Verify model list is readable
- [ ] Check that instructions are clear and concise

### Models Command Testing
- [ ] Run `@Sleuth AI models` in Slack
- [ ] Verify current model configuration displays correctly
- [ ] Verify switch instructions appear after configuration
- [ ] Verify example commands are formatted correctly
- [ ] Verify model list is readable
- [ ] Check spacing and formatting looks good

### Edge Cases
- [ ] Test with complex model set to "not available"
- [ ] Verify formatting works in different Slack clients
- [ ] Check that backticks render correctly in Slack

## File Changes Summary

### Modified Files
1. `data/static/HELP.md` - Add model switching section to help output
2. `src/chat-module.js` - Append instructions to models command output

### No New Files Required

## Time Estimate

**Total: 1-2 work hours**

Breakdown:
- Phase 1 (Help Command): 30-45 minutes
  - Update HELP.md: 15-20 minutes
  - Testing: 15-25 minutes
  
- Phase 2 (Models Command): 30-45 minutes
  - Update chat-module.js: 15-20 minutes
  - Testing: 15-25 minutes

**Note**: This estimate includes:
- AI-assisted code implementation
- Manual review of changes
- Testing in Slack workspace
- Formatting adjustments if needed
- Verification that instructions are clear and helpful

