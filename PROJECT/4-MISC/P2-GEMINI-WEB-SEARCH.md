# Project Plan: Gemini Web Search

## Goal
Allow users to specify a command to use Google Gemini for web searches, extending the current web search capabilities which currently rely on the OpenAI Responses API.

## Effort Level
Medium. The fundamental infrastructure (Slack message formatting for sources, REST fetch patterns for Gemini) already exists in the project, but strict adherence to tenancy and Gemini 2.0+ schema requirements adds some complexity.

## Implementation Steps

### 1. Command Routing & Coexistence (`src/chat-module.js`)
- **Add new commands:** Introduce `@Sleuth AI gemini-search <query>` and a reverse alias `@Sleuth AI search-gemini <query>`.
- **Update handlers:** Route this new command to a new handler that interacts with `WorkspaceAI` for the Gemini integration.
- **Auto-routing Strategy:** Explicitly keep `gemini-search` as an opt-in manual command for v1. Existing natural-language web search auto-routing will continue to default to the OpenAI provider to maintain current behavior.
- **Update Help Text:** Add the new command to the usage instructions and `HELP.md`.

### 2. Provider Integration (`src/workspace-ai.js`)
- **New Method:** Implement `ProcessGeminiWebSearchAsync(ArgQuery, ArgOptions)`.
- **Model Configuration:** Ensure the implementation honors `MODEL_CONFIGURATIONS` (around line 67) for model definitions. We will use `gemini-flash-latest` as the default model alias to always point to the newest flash model regardless of version number.
- **API Call:** Reuse the REST fetch pattern (against `generateContent`) established in `src/rag/index.js`.
- **Tool Configuration (Gemini 2.0+ Schema):** Inject the simpler `googleSearch` tool into the payload (as `googleSearchRetrieval` is for 1.5):
  ```json
  {
    "tools": [
      {
        "googleSearch": {}
      }
    ]
  }
  ```

### 3. Response Normalization & Compliance (`src/workspace-ai.js`)
- **Extract Text:** Parse the text output from the Gemini response.
- **Extract Sources (Chunks):** Map Gemini's grounding metadata (`groundingChunks` containing web URIs and titles) to the normalized structure expected by `ChatModule`:
  ```javascript
  { 
    text: "...", 
    sources: [ { title: "Example", url: "https://example.com" } ],
    model: "gemini-flash-latest"
  }
  ```
- **Compliance (`searchEntryPoint`):** Google's Terms of Service require displaying the HTML "Search Suggestions" widget (`searchEntryPoint.renderedContent`). We will parse this and map it to a format that can be appended to the Slack message or linked to ensure compliance without breaking the Slack UI format.

### 4. API Key and Tenancy (`src/workspaces.js` & `src/workspace-ai.js`)
- **Per-Workspace Tenancy (Strict Requirement):** Update `workspaces.js` typedef and validation to support a new `GEMINI_API_KEY` setting (SCREAMING_SNAKE case convention). Do **not** use a global fallback to environment variables.
- **Documentation:** Update `docs/web-api.md` with examples of the new workspace config field.
- **Pass to `WorkspaceAI`:** Update the constructor to ingest the `GEMINI_API_KEY` from the workspace settings. `ProcessGeminiWebSearchAsync` will throw a clear error if invoked without this key configured for the tenant.

### 5. Testing
- **Command Routing:** Update `tests/chat-module.integration.test.js` to ensure `@Sleuth AI gemini-search` routes correctly and shows usage text on empty queries.
- **Parser & Metdata Tests:** Unit tests to verify that Gemini's specific grounding metadata shape is successfully normalized.
- **Error Paths:** Add tests for missing-key error paths, network/5xx failures, and empty results.
- **Formatting Parity:** Tests to ensure Slack citation rendering parity with the existing OpenAI surface.

### 6. Versioning & CHANGELOG
- **Update CHANGELOG.md:** Document the new command, its usage, and configuration requirements.
- **Bump Version:** Increment the application version following the established semantic versioning practices in the project.