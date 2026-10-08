# GH-215 Claude implementation QA

Reviewed builder commit a2795c1. Read-only Claude CLI with Read/Grep/Glob; native runner adaptation as recorded in the plan. No live validation.

Full-detail exception: the orchestrator asked for a complete cited verdict as final text.

VERDICT: PASS. No blocking findings. Four Should items, all introduced by this branch, none affecting the security boundary. No secret leakage found. Source review only; no live validation claimed.

**Answers to the six questions**

1. Auth/credential boundary holds. Mapping is keyed by channel ID with a `^[CG]` regex, so DMs cannot be mapped (`src/product-compass.js:26`). Token is read per request from systemd's credential directory or Keychain with fixed argv, regex-checked, and every error collapses to `credentials` (`src/product-compass.js:35-49`). The transport fetch pins the URL to the fixed endpoint, sets `redirect: 'error'`, and fails closed on 401/403 (`src/product-compass.js:53-57`). The model picks only an enum Action; `team_id` always comes from the mapping, `list_teams` is never exposed, and ProductId/ReleaseId are checked against the scoped catalog before any call (`src/product-compass.js:179`). Returned passages are re-validated against the catalog and the filter used, links are constructed from validated IDs rather than taken from model or PC text, and Answer text has URLs stripped and `<>&` escaped (`src/product-compass.js:194-199, 172`). Logs carry only workspace, channel and a code (`src/chat-commands/ask-compass-command.js:17`).

2. Context reuse is complete and bounded. The current event is appended explicitly after filtering by timestamp (`src/chat-module.js:3011-3012`), prior bot replies ride along as assistant role, and the upload memory key matches the writer (`src/chat-module.js:2964` vs `3045`). Pagination is 5×100 with refusal on a remaining cursor or `has_more` (`src/slack-app.js:853-865`). Hands-free gating reads later pages up to the event timestamp and hands the same array to Compass, so no second fetch. Mention hook sits after deterministic routes and before web-search heuristics (`src/chat-module.js:1272`), with the file-loaded path covered at `1323`. One gap: Should 2.

3. Deadlines are genuine. OpenAI and Anthropic receive `{signal, timeout, maxRetries: 0}` as SDK request options; Gemini receives the signal on fetch. All default callers branch on `undefined` and are untouched. `TimedAsync` races each step against the shared controller, the post-await aborted check suppresses late results (`src/product-compass.js:160`), and `finally` aborts then closes (`src/product-compass.js:210-214`). Because the custom fetch substitutes the workflow signal for the SDK's own, the SSE GET and all POSTs die on abort, and reconnection is disabled.

4. Canaries detect the main regressions: unmapped channel, out-of-catalog IDs, fabricated citation, foreign URL, oversized context, missing tool contract, tool cap, stalled model with late result, two-page `no_bell`, prior answer and upload in prompt, channel model forwarded, single fetch on follow-up. Weakness: the later-page stop is proven at the SlackApp layer and the ChatModule layer separately, not end to end through the real paginator. Acceptable for a canary.

5. Changes are minimal and backwards compatible. New workspace field is optional, validated only when present, template defaults to `{}`. Provider signatures are additive. The MCP SDK ships CJS exports (node_modules 1.30.0), so the `require` at `src/product-compass.js:5-6` resolves outside the mocked test. Catalog entry is additive.

6. No correctness or leakage blockers.

**Should**

1. OpenAI temperature fallback is disabled whenever request options are present (`src/ai-providers/openai-provider.js:136`). Failing input: channel model set to a name outside `MODEL_CONFIGURATIONS` that rejects temperature 0, such as `o3-pro` or `gpt-5-chat-latest`. Generic chat recovers via the retry; every Compass turn throws and the user sees the generic failure. Fix: drop `ArgRequestOptions ||` from line 136 and pass `ArgRequestOptions` as the second argument on the retry at line 137.

2. Hands-free refusal is silent. A mapped thread over 500 messages makes the paginated read throw at `src/chat-module.js:2715`, the catch at `2745` logs and returns `ShouldRespond: false`, and nothing is posted. The mention path posts the "start a new thread" reply (`src/chat-commands/ask-compass-command.js:19`), and `docs/web-api.md:441` promises refusal is explicit. Fix: in that catch, when `error.code === 'context-incomplete'` and the channel is mapped, post the same reply before returning false.

3. Passage link exact-match is pure fragility (`src/product-compass.js:197-198`). The rendered link is already built from validated team and document IDs, so the check adds no safety, but an absolute URL from PC (shape unverified) fails the whole answer with `citations`. Fix: compare `new URL(link, Endpoint).pathname + search` to the expected path, or drop the check and keep it on the live-acceptance list.

4. A clarifying answer after evidence is rejected (`src/product-compass.js:170`). Instructions tell the model to ask when ambiguous; if search returned passages and the model replies "Which release did you mean?" with empty Citations, the user gets the generic failure. The `[n.m]` consistency check at line 169 already blocks fabricated references. Fix: remove line 170; the "no retrieved source evidence" footer still renders.

**Nit**

- `GetMapping` re-parses workspace JSON on every call, including once per message inside the filter at `src/chat-module.js:2718`. Hoist to one lookup.
- `src/slack-app.js:859` drops Slack's error reason from the thrown message for all callers. Restore `${Result.error}`.
- Duplicate `CommandsListOrder: 103` with test-random-reminder (`data/static/ai/command-catalog.json:2081` vs `2140`). Tie-breaks by Id, cosmetic.
- Invalid `PRODUCT_COMPASS_CHANNELS` surfaces to the admin API as the bare message "configuration" (`src/workspaces.js:302`). Siblings name the field.
- `too-large` from evidence accumulation gets the "narrow the attached document" wording (`src/chat-commands/ask-compass-command.js:19`).

**Preexisting vs introduced**: every item above is introduced on this branch; no preexisting path is newly broken. The validate:commands failure for ask-self/run-tests-unavailable is baseline and unrelated. Live PC auth, index state, credential provisioning, Slack `conversations.replies` behavior with `latest` plus `inclusive`, and model quality remain unverified and do not block the source PR.

1. Orchestrator records this verdict; builder applies Should 1 and 2 (two-line fixes each), decides on 3 and 4.
2. Parent runs the full final gate only after those edits land, then push and open the PR into development.

## Parent review dispositions

- Should 1 accepted: preserve the existing one-shot temperature compatibility fallback with the same cancellation options; already-aborted requests do not retry. This is not a network retry loop and remains inside the 45-second outer bound. Existing provider canary extended.
- Should 2 modified: posting on incomplete hands-free history could disregard an unseen stop reaction. Keep silence in that case; document the distinction and use an explicit mention for a visible refusal. Full pagination and later-page stop refusal remain covered.
- Should 3 declined: checked-out PC search-documents/retrieve source supplies the exact relative path currently checked. Retain a narrow, fail-closed contract rather than broaden URL acceptance speculatively; live compatibility remains an activation gate.
- Should 4 declined: removing the no-citations guard permits uncited evidence-based answers. Clarify before retrieval or cite the sources that introduced ambiguity; prompt clarified accordingly.
- Nits: hoisted channel mapping out of per-message filter; clarified config validation and size-limit message; assigned unique command ordering. Keep Slack error message generic to avoid forwarding upstream error text.

## Independent parent branch review

Reviewed the diff from cd7b46f in a separate full review clone: concrete MCP workflow/credential boundary, all JSON providers, ChatModule routing/thread assembly, Slack pagination, workspace config/catalog and canaries. Graph generation 2026-10-08T02:29:43Z was stale for changed source; exact coverage checks returned metadata_changed/not_tracked, so direct source reads supplied the evidence. Compared tool schemas and payloads against PC source at aa7ac66. No additional blocking finding. Native store setup, real Slack/MCP behavior, quotas and model quality remain unverified.
