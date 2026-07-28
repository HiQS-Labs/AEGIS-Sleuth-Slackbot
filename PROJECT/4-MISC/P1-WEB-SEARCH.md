# P1 Web Search Command

## Probe Results

Both passed.

Live probe against production Neochrome API key:

| Model | Responses API | `web_search` executed | Sources | Citations |
|---|---:|---:|---:|---:|
| `gpt-5.4` | HTTP 200 | yes | 17 | 1 |
| `gpt-5.4-mini` | HTTP 200 | yes | 16 | 1 |

Either model can support a Sleuth `web-search` command via Responses API integrated web search.

Official docs reference:
- OpenAI web search tool guide: https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
- Responses API reference: https://platform.openai.com/docs/api-reference/responses

## Phase 1: Straight Pass-Through

Add `@Sleuth AI web-search <query>` in `src/chat-module.js`.

### Completed Checklist

- [x] Route `@Sleuth AI web-search <query>` in `ChatModule` after internal/RAG commands and before generic chat fallback.
- [x] Reserve `@Sleuth AI web-search-advanced <query>` as the future advanced-mode command with a clear placeholder response.
- [x] Add `WorkspaceAI.ProcessWebSearchAsync(query, options)` so OpenAI access stays centralized in `src/workspace-ai.js`.
- [x] Use Responses API with `gpt-5.4-mini`, `tools: [{ type: "web_search" }]`, and `include: ["web_search_call.action.sources"]`.
- [x] Post an immediate `_Searching the web..._` acknowledgement before the final answer.
- [x] Preserve citations/sources in Slack-readable links, capped to the first five sources.
- [x] Add command routing, usage, advanced-placeholder, response formatting, and `WorkspaceAI` payload/source extraction tests.
- [x] Update user-facing help text in `data/static/HELP.md`.
- [x] Bump app version to `1.4.80` and update `CHANGELOG.md`.
- [x] Verify with focused Jest tests: `tests/chat-module.test.js`, `tests/chat-module.integration.test.js`, and `tests/workspace-ai.test.js`.
- [x] Verify `npm run build`.
- [x] Verify full Jest suite outside sandbox: 29 suites, 390 tests passed.

## Phase 1.5: Surgical Auto-Routing

Implement the two lowest-risk no-command improvements before any broader tool autonomy:

- [x] Add natural-language alias routing so explicit lookup requests such as `search the web for ...`, `look up ...`, `google ...`, and `find latest info on ...` reuse the existing Phase 1 pass-through path without requiring the `web-search` keyword.
- [x] Add a narrow freshness heuristic for clearly current external-information questions, such as `what's the latest on ...`, `any recent news on ...`, `current weather ...`, and `current price ...`.
- [x] Keep both routes in `src/chat-module.js` after explicit commands and before generic chat fallback so the change is localized and reversible.
- [x] Reuse `WorkspaceAI.ProcessWebSearchAsync(...)` and the existing Slack formatting path. No new OpenAI client or alternate citation formatter.
- [x] Add focused unit/integration tests proving these routes hit web search and do not fall through to generic chat.

Why this order:
- It reduces behavior change risk versus making generic chat decide when to browse.
- It removes the memorization burden for the most obvious lookup cases.
- It keeps the scope small enough that opt-in gating can still be added later if the team wants a rollout brake.

## Phase 2: Buffered Synthesis Mode

I agree with the concept, with one adjustment: do it asynchronously and treat the temp file as an operator/debug artifact, not the primary source of truth.

If later rollout control is needed, Phase 2 is a reasonable place to add optional workspace/channel gating because the async buffered pipeline will already introduce a more distinct execution mode.

Suggested command:
- `@Sleuth AI web-search <query>` = quick pass-through
- `@Sleuth AI web-search-advanced <query>` = deeper two-step mode

Flow:
1. Save raw query plus metadata to `data/runtime/web-search-buffer/<workspace>/<request-id>.md`.
2. First Responses call runs web search and stores raw answer/sources in the same markdown file for inspection.
3. Second full-model call, e.g. `gpt-5.4`, should synthesize from the in-memory structured search result, with the markdown file kept as a debug artifact rather than runtime source of truth.
4. Post final answer to Slack with citations.
5. TTL cleanup old buffer files, e.g. delete after 24-72 hours.

I’d avoid blocking the Slack event handler during Phase 2. Acknowledge immediately, then complete in-thread when the synthesis finishes. This keeps production behavior resilient if web search or the second model call is slow.
