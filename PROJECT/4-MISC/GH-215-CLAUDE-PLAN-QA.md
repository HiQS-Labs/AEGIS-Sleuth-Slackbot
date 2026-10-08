# GH-215 Claude plan QA

2026-10-07 PDT. Independent read-only Claude CLI review of plan at 476705e. Source checks only; no live endpoint validation. Producer dispositions are in the canonical task plan.

Full-detail exception: the orchestrator asked for a complete cited review as final text.

VERDICT: PASS. No blocking findings. Three Should items for the builder to fold in, none require re-planning.

**Requirement checks**

- Authorization is concrete. Mapping keyed by channel ID with TeamId plus CredentialName, missing mapping fails closed, every channel member may query, no admin gate (plan line 96). The nearest existing pattern at `src/chat-commands/ask-woo-command.js:43` is admin-only, and the plan correctly does not copy it. DMs are unaffected because `src/chat-module.js:2679` returns early for `im` channels and a DM ID will never be mapped.
- Credential custody is concrete on Linux (CREDENTIALS_DIRECTORY, reference-only config, per-request read, fixed origin, no redirects, plan line 97). Workspace writer stays `SaveWorkspaceInfoAsync` at `src/workspaces.js:479`. New field validation slots beside the existing per-field blocks such as GITHUB_USER_MAP at `src/workspaces.js:304`.
- Scoped model/tool args are concrete. Catalog comes only from list_products for the mapped TeamId, list_teams is never exposed, IDs are validated against the scoped catalog before any fetch, and `search_documents` gets team_id from the mapping (plan lines 100 to 101). The `Validate` hook in `src/ai-decision.js:223` is the right seam for rejecting out-of-scope IDs inside the chokepoint.
- Citation enforcement is concrete. Rendered references must match returned passage IDs/links, excerpts serve Slack-only contributors (plan lines 102, 132).
- Context reuse holds. `#GatherThreadContextAsync` at `src/chat-module.js:2980` already includes bot replies tagged assistant (line 2991) and the uploaded memory file (line 3001), so previous Compass answers ride along. The 200 KiB constant is inline at `src/chat-module.js:2896`; moving it to `src/context-file-classifier.js` and reusing it for the combined prompt is the right minimal move.
- Hands-free gating is reachable. `#ShouldRespondToMessageAsync` at `src/chat-module.js:2690` and `#GatherThreadContextAsync` at 2982 both call the single-page helper at `src/slack-app.js:850`, which never checks `has_more` or a cursor. Opt-in pagination plus later-page no_bell/octagonal_sign handling is executable there without touching the twelve other callers.
- Deadlines and late-result suppression are executable. `DecideAsync` at `src/ai-decision.js:208` to 214 calls `ProcessMessageWithJsonResponseAsync` on `src/workspace-ai.js:493`, which forwards to the provider. All three registered providers (`src/ai-providers/index.js:51` to 79: anthropic, gemini, openai) implement that JSON method. OpenAI (`openai-provider.js:131`) and Anthropic (`anthropic-provider.js:89`) SDK calls accept a second request-options argument for signal/timeout/maxRetries. Gemini uses raw fetch at `gemini-provider.js:168`, which accepts `signal` only. Deadline-before-publish and transport close in finally are builder-side and need no new seam.
- Touchpoints are named: workspace typedef and validation, docs/web-api.md, config/workspace-template.json, command-catalog.json, HELP regen, compass-instructions.md and compass-schema.json in EXPECTED_PAIRS at `scripts/validate-ai-prompts.js:21`, CHANGELOG. MCP SDK is already a runtime dependency (`package.json:78`).
- Prior Codex concerns are addressed: pagination (plan line 99), deadlines (line 100), registration (line 98).

**Should (non-blocking, fold into build)**

1. Hook position in the mention path is unspecified relative to heuristics. Plan line 98 says explicit commands keep precedence, but the natural-language web search route at `src/chat-module.js:1267` and the freshness auto-route at 1281 are heuristics, not commands. A question like "what changed in release 1.65" can be hijacked to web search before Compass runs. Resolution: in mapped channels, run the Compass handler immediately after `RouteAsync` at line 1253 and the deterministic check at 1256, before line 1264.
2. Pagination bound is smaller than today. Slack's documented default page size for conversations.replies is 1000, so the current single call at `src/slack-app.js:852` already returns up to 1000 messages. "5 pages of 100" caps at 500 and would refuse threads that work today. Resolution: paginate on `response_metadata.next_cursor` with the default page size and a small page cap, and treat a remaining cursor as incomplete.
3. Two credential backends is overbuilt for one opt-in integration. macOS Keychain needs either a native module or a spawned `security` process, which conflicts with "no arbitrary commands" (plan line 97). Resolution: one reader over a directory of 0600 files, which is what systemd CREDENTIALS_DIRECTORY provides and a developer can emulate locally. State Gemini receives `signal` only, no maxRetries.

**Build-time acceptance vs live activation**

- Build-time canaries (Jest, mocked SlackApp, stubbed WorkspaceAI, in-process or mocked MCP client): mapped ingress through context, scoped tool loop, cited answer and follow-up including later-page stop gate; unauthorized and out-of-scope fail-closed; timeout, malformed, oversized and stalled-model late-result suppression. Red controls per plan line 108. These are sufficient to accept the source PR.
- Live activation checks (separately marked unverified until an admin maps a channel and provisions a credential): tools/list shows the `search_documents` schema, scoped search returns passages with IDs, a two-release comparison plus follow-up, token revoke yields denial. Absence of live credentials does not block the implementation.

Dropped as out of scope: `#GetThreadDebugInfo` at `src/chat-module.js:1879` ignores octagonal_sign in its diagnostic summary, unrelated to this integration.
