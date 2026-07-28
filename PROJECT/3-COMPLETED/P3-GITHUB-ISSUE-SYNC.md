# P3: GitHub Issue/PR Auto-Complete Sync

Status: In Progress

## Table of Contents

- [Phased Progress Overview](#phased-progress-overview)
- [Context and Motivation](#context-and-motivation)
- [Local Dev Environment](#local-dev-environment)
- [Spike A: Offline URL Extraction Test](#spike-a-offline-url-extraction-test)
- [Spike B: Live End-to-End Test](#spike-b-live-end-to-end-test)
- [Phase 1: Add GitHubUrls Meta Field to Reminders](#phase-1-add-githuburls-meta-field-to-reminders)
- [Phase 2: GitHub Status Polling Cron](#phase-2-github-status-polling-cron)
- [Phase 3: Post-Build Verification and Release](#phase-3-post-build-verification-and-release)
- [Phase 4: Manual Force Sync Command](#phase-4-manual-force-sync-command)
- [Phase 5: Pull Request Auto-Complete Support](#phase-5-pull-request-auto-complete-support)
- [Phase 6: Main-Channel Sync Heartbeat](#phase-6-main-channel-sync-heartbeat)
- [Risk and Effort Summary](#risk-and-effort-summary)
- [AGENTS.md Compliance Notes](#agentsmd-compliance-notes)
- [Future Considerations (Out of Scope)](#future-considerations-out-of-scope)

---

## Phased Progress Overview

> **Note to LLMs:** As you complete each item below, mark it `[x]` immediately. This section is the high-level tracker — users should be able to see overall progress here without scrolling through phase details.

- [x] **Spike A: Offline URL Extraction Test** — Risk: None | Effort: Low
  - [x] A.1 Write standalone regex extraction script
  - [x] A.2 Test against all 3 Slack message URL formats
  - [x] A.3 Verify field can be added to existing reminder JSON without breakage

- [x] **Spike B: Live End-to-End Test** — Risk: Low | Effort: Low
  - [x] B.1 Start local Sleuth instance (`npm run dev`)
  - [x] B.2 Enable reminders in `2-sleuth-ai-noel` test channel
  - [x] B.3 Send test message with GitHub anchor-text link (GH issue 718)
  - [x] B.4 Verify GitHub URL survives in composed ReminderMessageText
  - [x] B.5 Document spike findings and confirm approach

- [x] **Phase 1: Add GitHubUrls Meta Field to Reminders** — Risk: Low | Effort: Low-Medium
  - [x] 1.1 Add `GitHubUrls` field to `ReminderInfo` typedef
  - [x] 1.2 Extract GitHub URLs from raw message text before sanitization
  - [x] 1.3 Persist `GitHubUrls` in reminder JSON on disk
  - [x] 1.4 Backwards compatibility for existing reminders (null/undefined)
  - [x] 1.5 Log tagged reminders via existing CombinedLogger
  - [x] 1.6 Add historical reconstruction CLI for reminders whose stored text no longer preserves GitHub links

- [x] **Phase 2: GitHub Status Polling Cron** — Risk: Low-Medium | Effort: Medium
  - [x] 2.1 Add GitHub PAT configuration to workspace
  - [x] 2.2 Create `GitHubSyncModule` with polling loop
  - [x] 2.3 Check issue/PR status via GitHub API
  - [x] 2.4 Auto-complete reminders when linked GitHub issues are closed
  - [x] 2.5 Post Slack notification when auto-completing

- [ ] **Phase 3: Post-Build Verification and Release** — Risk: None | Effort: Low
  - [x] 3.1 `npm run build` passes
  - [ ] 3.2 `npm run dev` smoke test
  - [ ] 3.3 Manual verification of end-to-end flow
  - [x] 3.4 Version bump and CHANGELOG

- [ ] **Phase 4: Manual Force Sync Command** — Risk: None | Effort: Low
  - [x] 4.1 Add `RunNowAsync()` to `GitHubSyncModule`
  - [x] 4.2 Add `github sync now` regex and dispatch in `RemindersModule`
  - [x] 4.3 Add `#HandleRunGitHubSyncNowAsync` handler (admin-only)
  - [x] 4.4 `npm run build` passes
  - [ ] 4.5 Manual test: `@Sleuth AI github sync now` triggers poll and posts result in Slack

- [ ] **Phase 5: Pull Request Auto-Complete Support** — Risk: Low-Medium | Effort: Medium
  - [x] 5.1 Update completion policy so PR URLs are eligible for auto-complete
  - [x] 5.2 Treat PR `open` as active and PR `closed` or `merged` as complete
  - [x] 5.3 Update debug/test command output to reflect PR completion eligibility
  - [x] 5.4 Update Slack auto-complete notification copy for issue vs PR outcomes
  - [x] 5.5 Add automated tests for PR decision logic and Slack command behavior
  - [ ] 5.6 Manual verification: merged/closed PR auto-completes linked reminder

- [ ] **Phase 6: Main-Channel Sync Heartbeat** — Risk: Low-Medium | Effort: Low-Medium
  - [x] 6.1 Refactor `#PollGitHubStatusesAsync()` to return structured per-workspace poll summaries
  - [x] 6.2 Add `BuildHeartbeatCopy(summary)` shared formatter for scheduled/manual sync reporting
  - [x] 6.3 Cache `REMINDER_CHANNEL_NAME` resolution instead of calling Slack channel lookup every cycle
  - [x] 6.4 Post one heartbeat message per workspace to `REMINDER_CHANNEL_NAME` only, never all channels
  - [x] 6.5 Gate heartbeat behind an explicit workspace config flag (`GITHUB_SYNC_HEARTBEAT_ENABLED`) to avoid channel noise by default
  - [x] 6.6 Define error-path behavior so failed poll cycles can still emit an error heartbeat
  - [x] 6.7 Add automated tests for channel targeting, copy, zero-eligible reminders, and error summaries
  - [ ] 6.8 Manual verification: one heartbeat appears after each poll cycle in the main reminder channel only

---

## Context and Motivation

### The problem

Task reminders in Sleuth often reference GitHub issues or PRs. When a linked GitHub issue is closed, the Sleuth task remains open — the user must manually react with ✅ to complete it. For teams tracking dozens of tasks, this creates stale reminders that clutter the daily digest.

### The solution

1. **Tag** reminders that contain GitHub issue/PR URLs with a `GitHubUrls` meta field at creation time
2. **Poll** GitHub on a cron schedule to check the status of linked issues/PRs
3. **Auto-complete** reminders whose linked GitHub issues are closed
4. **Auto-complete** reminders whose linked GitHub PRs are merged or closed

PR URLs are now first-class completion signals alongside issues. Open PRs keep reminders active; merged PRs and closed-without-merge PRs make linked reminders eligible for auto-complete once all linked GitHub items are complete.

This is a **one-way sync**: GitHub → Sleuth only. Sleuth never writes to GitHub.

### How GitHub URLs appear in Slack messages

| Format | Raw Slack text | Example |
|---|---|---|
| Bare URL | `https://github.com/org/repo/issues/42` | User pastes a plain link |
| Angle-bracket (auto-linked) | `<https://github.com/org/repo/pull/15>` | Slack auto-wraps URLs |
| Anchor text (embedded link) | `<https://github.com/org/repo/pull/15\|Review the Client A Theme PR>` | User creates a named link — **URL is hidden behind display text** |

All three formats are currently **stripped** by `#ComposeReminderMessageAsync()` at `reminders-module.js:1640-1649`. The extraction must happen **before** that sanitization step, using the raw `ArgMessageText` parameter.

### GitHub URL patterns to match

```
https://github.com/{owner}/{repo}/issues/{number}
https://github.com/{owner}/{repo}/pull/{number}
```

Both issues and PRs. Optional trailing fragments (e.g., `#issuecomment-123`) should be captured but the base URL (owner/repo/number) is what gets checked against the API.

---

## Local Dev Environment

### Neochrome workspace

A local Sleuth instance was previously configured and connected to the **Neochrome** Slack test workspace.

| Component | Value | Notes |
|---|---|---|
| Workspace name | `Neochrome` | Configured in `data/runtime/workspaces/Neochrome_workspace.json` |
| Reminder channel | `2-sleuth-ai-noel` | Set via `REMINDER_CHANNEL_NAME` — this is where reminders are **posted to** |
| Enabled channels | **None** (empty `[]`) | Channels must be explicitly enabled — see below |
| Active reminders | 1 | In `data/runtime/reminders/Neochrome_reminders.json` |
| App status | **Not running** | Port 2020 is free |
| Slack tokens | Configured | Bot token, signing secret, app token all present |
| OpenAI key | Configured | Used for reminder analysis and date extraction |

### Enabling a channel for testing

Channels are enabled per-workspace by typing in the Slack channel:

```
@Sleuth AI enable reminders
```

Only the **channel creator** can run this command. It adds the channel ID to `Neochrome_enabled_channels.json`. The channel `2-sleuth-ai-noel` is the designated test channel.

To disable: `@Sleuth AI disable reminders`

### Can a specific Slack channel be tied to a local Sleuth instance?

**Yes.** The architecture supports this naturally:

- Each workspace config (`Neochrome_workspace.json`) has its own Slack bot tokens
- The Slack bot only listens in channels where it's been **invited** and where reminders have been **enabled**
- `REMINDER_CHANNEL_NAME` controls where reminders are posted (can differ from where messages are monitored)
- The `2-sleuth-ai-noel` channel is already mapped to the local Neochrome workspace

**Important:** Only one Sleuth instance should be connected to a given Slack workspace at a time. If a production instance is running with the same bot tokens, two instances would receive duplicate events. For local testing, either:
1. Use the Neochrome test workspace (which is separate from production)
2. Or temporarily stop the production instance

### Starting the local instance

```bash
npm run dev
```

This starts the Express server on port 2020 and connects to Slack via Socket Mode (no public URL needed). The app will load the Neochrome workspace, connect to Slack, and begin listening for messages.

---

## Spike A: Offline URL Extraction Test

**Goal:** Prove that GitHub URLs can be reliably extracted from all three Slack message formats, and that adding a `GitHubUrls` field to existing reminder JSON doesn't break anything.

**Risk: None** — no production code changes, no Slack connection needed.
**Effort: Low** — standalone script, ~30 minutes.

### A.1 Write standalone regex extraction script

**New file:** `scripts/spike-github-url-extraction.js`

A throwaway script that:
1. Defines the GitHub URL regex
2. Tests it against sample Slack messages in all three formats
3. Loads the existing `Neochrome_reminders.json`, adds a `GitHubUrls` field to each reminder, and writes to a temp file to verify JSON roundtrip

**Regex:**

```javascript
// matches GitHub issue and PR URLs in all three Slack message formats.
// captures from: bare URLs, <angle-bracket> URLs, and <url|anchor text> URLs.
const GITHUB_URL_REGEX = /(?:<)?(https:\/\/github\.com\/[^\/\s>]+\/[^\/\s>]+\/(?:issues|pull)\/\d+)(?:[^>\s|]*)?(?:\|[^>]*)?(?:>)?/gi;
```

This regex handles:
- `https://github.com/org/repo/issues/42` → captures base URL
- `<https://github.com/org/repo/pull/15>` → captures base URL (strips angle brackets)
- `<https://github.com/org/repo/pull/15|Review PR>` → captures base URL (strips anchor text)
- `https://github.com/org/repo/issues/42#issuecomment-123` → captures base URL (strips fragment)

**Test messages:**

```javascript
const TestMessages = [
  // bare URL.
  "Hey team, please review https://github.com/NeochromeTeam/sleuth-app/issues/42 by Friday",

  // angle-bracket (Slack auto-wrap).
  "Look into <https://github.com/NeochromeTeam/sleuth-app/pull/15> when you get a chance",

  // anchor text (embedded link — the tricky one).
  "Can you <https://github.com/NeochromeTeam/sleuth-app/pull/15|review the Client A Theme PR> and merge it?",

  // multiple URLs in one message.
  "Close <https://github.com/NeochromeTeam/sleuth-app/issues/10> and check https://github.com/NeochromeTeam/sleuth-app/pull/11",

  // URL with fragment (issuecomment).
  "See https://github.com/NeochromeTeam/sleuth-app/issues/42#issuecomment-1234567890",

  // non-GitHub URL (should NOT match).
  "Check <https://woocommerce.com/products/subscription-churn-saver/|this plugin>",

  // no URL at all.
  "Write up Client A plans for next 7 days",
];
```

- [x] Script created with regex and test messages (`scripts/spike-github-url-extraction.js`)
- [x] All three Slack URL formats correctly extracted
- [x] Non-GitHub URLs correctly ignored
- [x] Fragment/comment suffixes stripped to base URL

### A.2 Test against all 3 Slack message formats

Run the script and verify output. Expected:

```
Test 1: ["https://github.com/NeochromeTeam/sleuth-app/issues/42"]
Test 2: ["https://github.com/NeochromeTeam/sleuth-app/pull/15"]
Test 3: ["https://github.com/NeochromeTeam/sleuth-app/pull/15"]
Test 4: ["https://github.com/NeochromeTeam/sleuth-app/issues/10", "https://github.com/NeochromeTeam/sleuth-app/pull/11"]
Test 5: ["https://github.com/NeochromeTeam/sleuth-app/issues/42"]
Test 6: []
Test 7: []
```

- [x] All 11 test cases pass (expanded from 7 to include real-world examples)
- [x] Output matches expected results

### A.3 Verify field can be added to existing reminder JSON without breakage

Load `Neochrome_reminders.json`, add `GitHubUrls: []` to the existing reminder, write to a temp file, reload it, and verify all existing fields are intact. Also verify that the `reminders-module.js` date reviver function still works with the extra field.

- [x] Existing reminder data survives roundtrip with new field
- [x] Date fields (`CreatedOn`, `ShouldPostOn`) still parse correctly
- [x] No field corruption or data loss
- [x] Existing reminder correctly gets `GitHubUrls: []` (no GitHub links in that message)

---

## Spike B: Live End-to-End Test

**Goal:** Confirm that the raw message text (with URLs intact) is available at the right point in the reminder creation flow, and that a GitHub URL can be captured and stored in a real reminder.

**Risk: Low** — uses test channel only, no production impact.
**Effort: Low** — requires starting local Sleuth and sending test messages, ~1 hour.

### B.1 Start local Sleuth instance

```bash
npm run dev
```

Verify:
- Neochrome workspace loads successfully
- Slack Socket Mode connects
- Web API starts on port 2020
- No errors in console output

- [x] Local Sleuth running and connected to Neochrome Slack workspace (app name: "Sleuth AI - Robin")

### B.2 Enable reminders in test channel

In the `2-sleuth-ai-noel` Slack channel, type:

```
@Sleuth AI enable reminders
```

Verify the bot responds with confirmation. Check that the channel ID appears in `Neochrome_enabled_channels.json`.

- [x] Reminders enabled in `2-sleuth-ai-noel`
- [x] Channel ID persisted to enabled channels file

### B.3 Send test messages with GitHub URLs

Send these messages in `2-sleuth-ai-noel`:

1. **Bare URL:** "Review https://github.com/NeochromeTeam/sleuth-app/issues/1 by tomorrow"
2. **Anchor text link:** Create a message with a [linked text](https://github.com/NeochromeTeam/sleuth-app/pull/1) pointing to a GitHub PR
3. **Mixed content:** "Follow up on the churn saver plugin and also check https://github.com/NeochromeTeam/sleuth-app/issues/2 next week"

Wait for Sleuth to process each message and create reminders.

- [x] Anchor-text link message sent: `@noel.saw please work on "Prioritization system GH issue 718" by 5 PM PT today`
- [x] Reminder created successfully (ID: `ba6f2c8f-21d3-49ea-8e9a-d9cd3ff0e690`)

### B.4 Verify raw message text is available before URL sanitization

Add a **temporary** `console.log` at `reminders-module.js:1244` (just before `#ComposeReminderMessageAsync` is called) to log the raw `ArgMessageText`:

```javascript
ArgSlackApp.Logger.info("[spike] raw message text:", ArgMessageText);
```

Confirm that the raw text at this point still contains the GitHub URLs in their original Slack format. This proves the extraction can happen here — before the sanitization at line 1640-1649 strips them.

- [x] Confirmed: GitHub URL present in composed `ReminderMessageText` (in Key task(s) section)
- [x] Confirmed: URL survives in GPT-generated `reminder_message` bullets (appended at `reminders-module.js:1251`)
- [x] Confirmed: extraction can work on raw input text OR final composed text (two opportunities)

### B.5 Document spike findings and confirm/revise approach

After both spikes, update this document with:
- Confirmed regex pattern (or revisions needed)
- Confirmed extraction point in the code
- Any edge cases discovered
- Go/no-go decision for Phase 1

**Spike findings (2026-03-18):**

1. **Regex confirmed.** The pattern `/(?:<)?(https:\/\/github\.com\/[^\/\s>|]+\/[^\/\s>|]+\/(?:issues|pull)\/\d+)/gi` correctly handles all three Slack URL formats, fragments, duplicates, and mixed GitHub/non-GitHub content. 11/11 offline tests passed.

2. **Two extraction points discovered.** The URL sanitization at `reminders-module.js:1640-1649` strips GitHub links from the quoted message text. However, the GPT-generated "Key task(s)" bullets (appended at line 1251) preserve the full `<url|anchor text>` Slack link format. This means:
   - **Primary extraction point:** raw `ArgMessageText` in `#TryScheduleRemindersAsync` (before sanitization) — captures all formats
   - **Fallback extraction point:** the composed `ReminderMessageText` after creation — catches URLs that appear in GPT-generated task bullets

3. **Real-world test passed.** A live message with anchor-text link `<url|GH issue 718>` was correctly processed by Sleuth. The regex extracted `https://github.com/ClientA/universal-child-theme-oct-2024/issues/718` from the stored `ReminderMessageText`.

4. **JSON roundtrip safe.** Adding `GitHubUrls` to existing reminders causes no data corruption. Existing reminders without GitHub links get `GitHubUrls: []` (or `null`).

5. **No approach revision needed.** The original plan is confirmed. Extract at the primary point (raw message text before sanitization), store in `GitHubUrls` field on `ReminderInfo`.

- [x] Findings documented
- [x] Approach confirmed — no revision needed

---

## Phase 1: Add GitHubUrls Meta Field to Reminders

**Risk: Low** — additive field, backwards compatible, no breaking changes.
**Effort: Low-Medium** — regex extraction + typedef update + persistence, ~2-3 hours.

### 1.1 Add `GitHubUrls` field to `ReminderInfo` typedef

Update the JSDoc typedef at `reminders-module.js:52-69`:

```javascript
/**
 * @typedef {Object} ReminderInfo
 * ...existing fields...
 * @property {string[]|null} [GitHubUrls] - GitHub issue/PR URLs extracted from the original message (backwards compatible, null for older reminders)
 */
```

- [x] Typedef updated with `GitHubUrls` field
- [x] JSDoc type is `string[]|null` for backwards compatibility

### 1.2 Extract GitHub URLs from raw message text before sanitization

Add a private extraction method:

```javascript
/**
 * Extract GitHub issue and PR URLs from raw Slack message text.
 * Must be called BEFORE URL sanitization strips links.
 * @param {string} ArgMessageText Raw message text from Slack.
 * @returns {string[]}
 */
#ExtractGitHubUrls(ArgMessageText) {
  // regex matches GitHub issue/PR URLs in all Slack message formats:
  // bare URLs, <angle-bracket> URLs, and <url|anchor text> URLs.
  const GitHubUrlRegex = /(?:<)?(https:\/\/github\.com\/[^\/\s>]+\/[^\/\s>]+\/(?:issues|pull)\/\d+)/gi;
  const Matches = [];
  let CurrentMatch;
  while((CurrentMatch = GitHubUrlRegex.exec(ArgMessageText)) !== null) {
    Matches.push(CurrentMatch[1]);
  }
  // deduplicate (same URL might appear twice in a message).
  return [...new Set(Matches)];
}
```

Call this in `#TryScheduleRemindersAsync` at line ~1244, **before** `#ComposeReminderMessageAsync`:

```javascript
// extract GitHub issue/PR URLs before sanitization strips them.
const GitHubUrls = this.#ExtractGitHubUrls(ArgMessageText);
```

Then include it in the reminder object at line ~1267:

```javascript
const NewReminderInfo = /** @type {ReminderInfo} */({
  ...existing fields,
  GitHubUrls: GitHubUrls.length > 0 ? GitHubUrls : null,
});
```

- [x] `#ExtractGitHubUrls()` method added
- [x] Called before `#ComposeReminderMessageAsync` (before URL sanitization)
- [x] Result stored in `NewReminderInfo.GitHubUrls`
- [x] `null` when no GitHub URLs found (keeps JSON clean for non-GitHub tasks)

### 1.3 Persist `GitHubUrls` in reminder JSON on disk

No changes needed — the existing `#SaveRemindersAsync()` uses `JSON.stringify()` which will automatically include the new field. The load path uses `JSON.parse()` with a date reviver that only touches `CreatedOn` and `ShouldPostOn`, so it won't interfere.

**Example persisted reminder with GitHub URLs:**

```json
{
  "ReminderID": "abc-123",
  "CreatedOn": "2026-03-18T17:00:00.000Z",
  "ShouldPostOn": "2026-03-25T17:00:00.000Z",
  "ReminderMessageText": "<@U032TCHJ8> - please follow up on ...",
  "GitHubUrls": [
    "https://github.com/NeochromeTeam/sleuth-app/pull/15"
  ],
  "State": "scheduled"
}
```

- [x] Verified: existing save/load path handles new field without changes
- [x] `GitHubUrls` appears in persisted JSON when present
- [x] `GitHubUrls` absent from older reminders (backwards compatible)

### 1.4 Backwards compatibility for existing reminders

Existing reminders on disk won't have `GitHubUrls`. This is fine — JavaScript treats missing properties as `undefined`, and any code that reads this field should handle `null`/`undefined`:

```javascript
const HasGitHubUrls = Array.isArray(Reminder.GitHubUrls) && Reminder.GitHubUrls.length > 0;
```

No migration needed. Old reminders just won't have the field and won't be eligible for auto-complete.

This was true for the initial rollout, but it is not the most robust recovery path for historical data. Load-time backfill now extracts from `ReminderMessageText`, which works only if the persisted reminder text still contains the GitHub link. Some older reminders may have had the GitHub URL stripped during reminder composition, especially when the original Slack message used anchor-text links. Those reminders need a stronger reconstruction pass that looks at the original Slack message instead of only the persisted reminder body.

- [x] Existing reminders load without errors
- [x] Phase 2 polling code guards against null/undefined `GitHubUrls`

### 1.5 Log tagged reminders via existing CombinedLogger

When a reminder is created with GitHub URLs, log it:

```javascript
if(GitHubUrls.length > 0) {
  ArgSlackApp.Logger.info(`[github-sync] tagged reminder ${NewReminderInfo.ReminderID} with ${GitHubUrls.length} GitHub URL(s):`, GitHubUrls.join(', '));
}
```

- [x] GitHub-tagged reminders logged with `[github-sync]` prefix
- [x] URL count and URLs visible in log output

### 1.6 Add historical reconstruction CLI for legacy reminders

To harden historical backfill, add a separate operator-run script that reconstructs `GitHubUrls` using the original Slack message when possible:

1. Read each workspace reminder file under `data/runtime/reminders/`
2. For reminders with missing/empty `GitHubUrls` (or all reminders when explicitly requested), fetch the original Slack message using `OriginalChannelID` + `OriginalMessageID`
3. Extract GitHub issue/PR URLs from the raw Slack message text
4. Fall back to persisted `ReminderMessageText` only when the original Slack message cannot be recovered
5. Persist reconstructed `GitHubUrls` back to disk only in explicit write mode

**Implemented command:**

```bash
npm run reconstruct:github -- --workspace Neochrome --write
```

**Safety defaults:**

- default mode is dry-run
- `--write` is required to persist changes
- `--refresh-existing` re-checks reminders that already have `GitHubUrls`

This keeps runtime backfill lightweight while giving operators a stronger, auditable repair path for legacy reminders that were created before GitHub URL preservation was reliable.

- [x] Added `scripts/reconstruct-github-reminders.js`
- [x] Script prefers original Slack message text over persisted reminder text
- [x] Script supports dry-run and explicit write mode
- [x] Script can target one or more specific workspaces

---

## Phase 2: GitHub Status Polling Cron

**Risk: Low-Medium** — introduces external API dependency and auto-completion behavior.
**Effort: Medium** — new module, GitHub API integration, cron loop, ~4-6 hours.

### 2.1 Add GitHub PAT configuration

**GitHub PAT (Personal Access Token)** is the standard auth mechanism for the GitHub API. There is no separate "API key" — a PAT _is_ the credential. A **fine-grained PAT** scoped to read-only on issues/PRs is recommended.

**Storage model:** per-workspace, multi-tenant, aligned with Sleuth's existing workspace configuration model.

Each Sleuth workspace should provide its own GitHub credential so GitHub access stays isolated by workspace, just like Slack and OpenAI credentials already are. A process-wide shared PAT is out of scope for this feature.

**Recommended v1 storage:**

| Option | Where | Pro | Con |
|---|---|---|---|
| Workspace config | `GITHUB_PAT` in `<WORKSPACE_NAME>_workspace.json` | Per-workspace, matches Sleuth tenancy model | Stored in plaintext in runtime dir |
| Encrypted config | `admin-auth.json` via P2 module | Encrypted at rest | Depends on P2 being complete |

**Recommended for v1:** Workspace config field (`GITHUB_PAT`). This preserves multi-tenant isolation and keeps GitHub auth scoped to each Sleuth workspace.

**Rate limits:**
- Authenticated (PAT): 5,000 requests/hour
- A cron checking 50 reminders every 30 minutes = 100 requests/hour = ~2% of limit

- [x] `GITHUB_PAT` added as optional per-workspace config field
- [x] `src/workspaces.js` typedef + validation updated for `GITHUB_PAT`
- [x] `docs/web-api.md` request examples updated to show optional `GITHUB_PAT`
- [ ] PAT creation instructions documented (fine-grained, read-only issues/PRs scope)

### 2.2 Create `GitHubSyncModule`

**New file:** `src/github-sync-module.js`

A lightweight module that:
- Runs on a recursive `setTimeout` polling loop (configurable, default 30 minutes) to avoid overlapping async polls
- Iterates all reminders across workspaces
- Filters for reminders where `GitHubUrls` is non-empty and the reminder is still active in the in-memory queue
- Checks each URL against the GitHub API using endpoint-specific helpers
- Auto-completes reminders when all linked GitHub issues and PRs are complete

```javascript
class GitHubSyncModule {
  #PollIntervalMs;
  #RemindersModules;   // array of RemindersModule instances (multi-tenant)
  #PollTimerId;
  #Logger;

  constructor(ArgRemindersModules, ArgLogger, ArgPollIntervalMs = 30 * 60 * 1000) { ... }

  async StartAsync() { ... }
  async StopAsync() { ... }
  async #PollGitHubStatusesAsync() { ... }
  #ParseGitHubUrl(ArgUrl) { ... }              // returns { owner, repo, type, number }
  async #CheckGitHubIssueAsync(ArgParsedUrl) { ... }
  async #CheckGitHubPullRequestAsync(ArgParsedUrl) { ... }
}
```

**GitHub API calls:**

```javascript
// issue URL: https://github.com/{owner}/{repo}/issues/{number}
// API:       GET https://api.github.com/repos/{owner}/{repo}/issues/{number}

const Response = await fetch(ApiUrl, {
  headers: {
    'Authorization': `Bearer ${WorkspacePat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
});
const Data = await Response.json();
// Data.state === 'closed' → issue closed
```

```javascript
// pull request URL: https://github.com/{owner}/{repo}/pull/{number}
// API:              GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}

const Response = await fetch(ApiUrl, {
  headers: {
    'Authorization': `Bearer ${WorkspacePat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
});
const Data = await Response.json();
// PR endpoint reserved for future flexibility and observability.
// In v1, PR results never trigger auto-completion.
```

- [x] `GitHubSyncModule` class created
- [x] Recursive `setTimeout` poll loop with configurable interval
- [x] Reads `GITHUB_PAT` from each workspace's `WorkspaceInfo`
- [x] Filters reminders with non-empty `GitHubUrls` that are still active in `RemindersModule.GetAllReminders()`
- [x] Does not rely on `State === 'scheduled'` as the sole eligibility gate
- [x] Uses Node's built-in `fetch` (Node 18+, no new dependency)

### 2.3 Check issue/PR status via GitHub API

For each reminder with `GitHubUrls`, first classify each URL by path (`/issues/` vs `/pull/`), then check status with the matching API endpoint:

| GitHub state | `Data.state` | `Data.pull_request` | Sleuth action |
|---|---|---|---|
| Issue open | `"open"` | N/A | No action |
| Issue closed | `"closed"` | N/A | Auto-complete |
| PR open | `"open"` | N/A | No action |
| PR merged | `"closed"` | N/A | Auto-complete |
| PR closed (not merged) | `"closed"` | N/A | Auto-complete |

**Completion rule:** Auto-complete if **all** linked GitHub URLs on a reminder are complete. A closed issue is complete. A merged or closed PR is complete. Any open issue, open PR, or unresolved lookup keeps the reminder active.

**Error handling:**
- 404 (issue/PR not found, or private repo without access): skip, log warning
- 403 (rate limited): stop polling this cycle, retry next interval
- Network error: skip, log, retry next interval

- [x] Issue vs PR URLs classified correctly
- [x] Issue URLs checked via `/issues/{number}` endpoint
- [x] PR URLs checked via `/pulls/{number}` endpoint or explicitly skipped with logged rationale
- [x] PR-linked reminders can auto-complete when the PR is merged or closed
- [x] Multi-URL reminders require all linked GitHub items to be complete before completing
- [x] 404, 403, and network errors handled gracefully

### 2.4 Auto-complete reminders when linked GitHub items are complete

Reuse the existing completion path — the same one triggered by ✅ emoji reaction:

```javascript
// in RemindersModule, expose a public method for external completion:
async CompleteReminderByIdAsync(ArgReminderID, ArgReason) {
  // find reminder in queue.
  // if Slack Lists is available, mark the reminder completed in the list first.
  // transition state to completed.
  // call #DeleteRemindersAsync() to remove from queue and persist.
  // log with reason for audit trail.
}
```

This avoids duplicating the completion logic. The `GitHubSyncModule` calls this method on the appropriate `RemindersModule` instance.

**Reason logging:** `"github-complete issue-closed https://github.com/org/repo/issues/42, pr-merged https://github.com/org/repo/pull/15"`

- [x] `CompleteReminderByIdAsync()` public method added to `RemindersModule`
- [x] Reuses Slack List completion side effect (`MarkReminderCompletedAsync()`) before deletion
- [x] Reuses existing `#DeleteRemindersAsync()` and FSM transition
- [x] Completion reason logged for audit trail

### 2.5 Post Slack notification when auto-completing

When a reminder is auto-completed via GitHub sync, post a brief message in the reminder's target channel:

```
✅ Auto-completed: "<reminder text snippet>" — linked GitHub issue was closed.
https://github.com/org/repo/issues/42
```

This gives the user visibility into what happened — tasks don't silently disappear.

- [x] Notification posted to reminder's target channel
- [x] Includes reminder text snippet and GitHub URL
- [x] Uses existing `PostMessageTextAsync()`

---

## Phase 3: Post-Build Verification and Release

**Risk: None** | **Effort: Low**

- [x] `npm run build` — type check passes
- [ ] `npm run dev` — startup smoke test, confirm GitHub sync module initializes
- [ ] `npm run validate:ai` — existing AI validation still passes
- [ ] Manual test: send message with GitHub issue URL → verify `GitHubUrls` field in `Neochrome_reminders.json`
- [ ] Manual test: send message with non-GitHub URL → verify `GitHubUrls` is null/absent
- [ ] Manual test: send message with anchor-text GitHub link → verify URL extracted from behind display text
- [ ] Manual test: close a GitHub issue → wait for poll cycle → verify reminder auto-completed and Slack notification posted
- [ ] Manual test: merge or close a GitHub PR → verify reminder auto-completes with the correct Slack copy
- [ ] Manual test: verify existing reminders (without `GitHubUrls`) still load and function normally
- [ ] Manual test: run `npm run reconstruct:github -- --workspace Neochrome --write` against a legacy reminder whose stored reminder text lacks the GitHub URL
- [x] Bump version in `package.json`
- [x] Update `CHANGELOG.md`
- [ ] Update `AGENTS.md` with GitHub sync module documentation

---

## Phase 4: Manual Force Sync Command

**Risk: None** | **Effort: Low**

Adds an admin-only Slack command to trigger an immediate GitHub sync poll without waiting for the 30-minute scheduled cycle. Useful during development and for confirming that a recently closed issue auto-completes the expected reminder.

### Command

```
@Sleuth AI github sync now
```

- Admin or workspace owner only.
- Posts an acknowledgement message, runs the full `#PollGitHubStatusesAsync()` cycle, then posts the result.
- Reuses the existing poll logic — no separate code path.

### Implementation

- `RunNowAsync()` added to `GitHubSyncModule` — calls `#PollGitHubStatusesAsync()` and returns a `GitHubDebugResult`.
- `RunGitHubSyncNowRegex` + dispatch added to `#OnAppMentionAsync` in `RemindersModule`.
- `#HandleRunGitHubSyncNowAsync` handler added to `RemindersModule` (admin-only guard, module-availability guard, two-message reply pattern).

### Checklist

- [x] `npm run build` passes
- [ ] Manual test: `@Sleuth AI github sync now` posts acknowledgement then result in Slack
- [ ] Manual test: non-admin user receives permission-denied message
- [ ] Manual test: confirmed poll runs against reminders with `GitHubUrls` field

---

## Phase 5: Pull Request Auto-Complete Support

**Risk: Low-Medium** | **Effort: Medium**

Extends the existing GitHub sync pipeline so PR-linked reminders follow the same automation model as issue-linked reminders. In this phase, PR URLs stop being informational-only and become eligible for auto-complete.

### 5.1 Update completion policy

Revise the current completion rule from:

- auto-complete only if all linked URLs are complete

To:

- auto-complete if all linked GitHub URLs are complete
- issue complete = `state === "closed"`
- PR complete = `state === "closed"` (includes merged PRs and closed-without-merge PRs)
- any open issue or open PR keeps the reminder active

- [x] `GitHubSyncModule.EvaluateAutoComplete()` updated to allow PR completion
- [x] Mixed issue + PR reminders supported under the unified "all linked URLs complete" rule
- [x] Existing issue-only behavior preserved while adding PR support

### 5.2 Update PR status evaluation

The module already parses PR URLs and calls the pull request endpoint. This phase changes the result interpretation only:

| URL type | GitHub state | Sleuth action |
|---|---|---|
| Issue | `open` | Keep reminder active |
| Issue | `closed` | Eligible for completion |
| PR | `open` | Keep reminder active |
| PR | `closed` and `merged_at !== null` | Eligible for completion |
| PR | `closed` and `merged_at === null` | Eligible for completion |

This keeps the rule aligned with the product decision: PR `open` = active, PR `merged` or `closed` = completed.

**Safe failure rule:** if the PR endpoint returns `403`, `404`, or a network error for a linked PR, treat that PR as still active for completion purposes, leave the reminder open, and log the failure. This keeps the system conservative when PAT scope or repo visibility is incomplete.

- [x] `#CheckGitHubPullRequestAsync()` returns enough data for merged-vs-closed observability
- [x] PR status is treated as completion-eligible when `state === "closed"`
- [x] `403`, `404`, and network errors on the PR endpoint keep the reminder active and emit actionable logs
- [x] Logs clearly distinguish issue closure, PR merge, and PR close-without-merge

### 5.3 Update operator-facing debug output

The admin debug/test surfaces should describe the real completion policy so operators can validate PR behavior without reading logs.

Update:

- `@Sleuth AI test github sync`
- `@Sleuth AI test github https://github.com/org/repo/pull/123`
- `@Sleuth AI github sync now`

Expected PR debug behavior:

- open PR: states that the reminder would remain active
- merged PR: states that the reminder would be eligible for auto-complete
- closed-unmerged PR: states that the reminder would still be eligible for auto-complete

- [x] `TestGitHubUrlAsync()` PR message updated from informational-only wording
- [x] Manual sync result copy still makes sense when PR-linked reminders complete
- [x] Help text and operator expectations updated where relevant

### 5.4 Update Slack notification copy

When a reminder is auto-completed because of a PR, the notification should say whether the linked item was an issue or PR and, for PRs, whether it was merged or simply closed.

Examples:

```text
✅ Auto-completed: "<reminder text snippet>" — linked GitHub PR was merged.
https://github.com/org/repo/pull/15
```

```text
✅ Auto-completed: "<reminder text snippet>" — linked GitHub PR was closed.
https://github.com/org/repo/pull/15
```

- If a reminder completes because of multiple linked GitHub items, the copy should summarize the set instead of pretending there was only one trigger.

Example mixed-item copy:

```text
✅ Auto-completed: "<reminder text snippet>" — linked GitHub items were completed (1 issue closed, 1 PR merged).
https://github.com/org/repo/issues/42
https://github.com/org/repo/pull/15
```

- [x] Slack notification copy distinguishes issue vs PR completions
- [x] PR notifications distinguish merged vs closed when GitHub data allows it
- [x] Mixed issue + PR completion uses combined wording instead of a misleading single-item message
- [x] Completion reason logged for audit trail

**Implementation note:** the completion decision/formatting path will likely need to return structured completion reasons, not just `shouldComplete: true/false`, so the Slack formatter can distinguish:

- issue-only completion
- PR merged completion
- PR closed-without-merge completion
- mixed issue + PR completion

### 5.5 Automated testing strategy

This phase should explicitly take advantage of the new Jest + Layer 2 harness work so PR support can be iterated quickly without relying on repeated live Slack/GitHub testing.

**Fast feedback loop:**

1. Expand `tests/github-sync-module.test.js` for pure decision-matrix coverage:
   - PR open -> `shouldComplete: false`
   - PR merged -> `shouldComplete: true`
   - PR closed-unmerged -> `shouldComplete: true`
   - mixed closed issue + merged PR -> `shouldComplete: true`
   - mixed closed issue + open PR -> `shouldComplete: false`
2. Use the Layer 2 `MockSlackApp` harness in `tests/mocks/mock-slack-app.js` to validate Slack command and notification behavior:
   - admin `github sync now` flow with PR-linked reminders
   - Slack notification copy for merged vs closed PR outcomes
   - exact `PostMessageTextAsync()` assertions for merged, closed, and mixed-item wording
   - non-admin guard paths remain intact
3. Keep live Slack/GitHub manual verification for one final smoke test only.

- [x] `tests/github-sync-module.test.js` expanded for PR completion matrix
- [x] Harness-backed integration coverage added for `github sync now` + PR notifications
- [x] Existing issue-only tests updated rather than duplicated

### 5.6 Manual verification

**Suggested real PR fixtures (verified on 2026-03-19):**

- Merged PR: [#221](https://github.com/NeochromeTeam/sleuth-app/pull/221) — `state: MERGED`, `mergedAt: 2026-03-04T18:01:56Z`
- Closed-unmerged PR: [#218](https://github.com/NeochromeTeam/sleuth-app/pull/218) — `state: CLOSED`, `closedAt: 2026-02-19T17:12:36Z`, `mergedAt: null`
- Open PR: [#223](https://github.com/NeochromeTeam/sleuth-app/pull/223) — `state: OPEN`, `mergedAt: null`, `closedAt: null`

These are useful smoke-test fixtures because they already cover all three PR outcome states without requiring new repository setup. Since PR status can change over time, re-verify them before relying on them for final release validation.

- [ ] Create reminder with a GitHub PR URL and confirm `GitHubUrls` persists
- [ ] Confirm open PR leaves reminder active after poll/manual sync (suggested fixture: PR `#223`)
- [ ] Confirm merged PR auto-completes with merged notification copy (suggested fixture: PR `#221`)
- [ ] Confirm closed-unmerged PR auto-completes with closed notification copy (suggested fixture: PR `#218`)
- [ ] Confirm mixed issue + PR reminders only complete when all linked items are complete

---

## Phase 6: Main-Channel Sync Heartbeat

**Goal:** After each GitHub sync poll cycle, post a confirmation that the cycle ran, but only in the workspace's main configured reminder channel (`REMINDER_CHANNEL_NAME`) and not in all channels.

### Feasibility

Yes, this is realistic and feasible with the current architecture.

Reasons:

- `GitHubSyncModule` already runs on a 30-minute polling loop
- each workspace already provides `REMINDER_CHANNEL_NAME`
- `SlackApp` already supports resolving a channel ID from that configured name and posting a message there
- the current sync path already computes per-cycle information such as how many reminders were checked, even though it only logs that information today

This means the feature does **not** require a new scheduler, a persistence migration, or any change to the one-way GitHub -> Sleuth data flow.

### Risk and effort assessment

- **Risk: Low-Medium**
- **Effort: Low-Medium**

Why this is not purely Low:

- a 30-minute heartbeat can create visible channel noise if enabled by default
- `GitHubSyncModule` currently logs sync activity but does not yet return a structured per-workspace summary that is ready to post into Slack
- the implementation must be careful to post only to `REMINDER_CHANNEL_NAME`, not to every enabled channel and not to each reminder's `TargetChannelID`
- the error path matters for observability: if the poll throws, the spec needs to define whether an error heartbeat still posts and what it says

Why this is still not High:

- existing Slack posting primitives already exist
- the polling cadence already exists
- the correct workspace-scoped target channel already exists in config

### Proposed implementation plan

1. Make the poll summary refactor the critical-path prerequisite.

   `#PollGitHubStatusesAsync()` currently only logs and returns nothing. Heartbeat posting is not a minor additive step on top of the current implementation. The poll path must first accumulate and return structured per-workspace summaries before any heartbeat posting is possible.

   This is the critical path for the phase.

2. Extend `GitHubSyncModule` to build and return a per-workspace heartbeat summary after each poll cycle.

   Suggested fields:
   - workspace name
   - reminders checked
   - reminders auto-completed
   - reminders eligible for checking
   - whether the workspace was skipped and why
   - whether the cycle hit an error or early-stop condition
   - error text when applicable
   - heartbeat target channel ID if already cached/resolved

3. Add a shared, testable copy builder.

   Add a static helper such as:

```text
BuildHeartbeatCopy(summary)
```

   This should be the single source of truth for heartbeat wording so the copy is easy to unit test and does not get embedded inline in the polling loop.

4. Add an explicit workspace config flag for heartbeat posting.

   Proposed name:

```text
GITHUB_SYNC_HEARTBEAT_ENABLED
```

   Proposed behavior:
   - unset/false: no heartbeat posts
   - `true` or `yes`: post a heartbeat after each scheduled poll cycle

   This keeps the feature safe for production and avoids making the main channel noisy unless an operator opts in.

5. Cache the heartbeat target channel ID.

   `GetChannelIdAsync(REMINDER_CHANNEL_NAME)` should not run on every poll cycle. Resolve the channel ID once at startup or on first heartbeat attempt, cache it, and reuse it for later cycles. If cache resolution fails, log and retry on a later cycle instead of throwing.

6. Post only to the workspace's configured main reminder channel.

   For each workspace with heartbeat enabled:
   - use that workspace's `SlackApp`
   - use the cached/resolved channel ID for `REMINDER_CHANNEL_NAME`
   - post exactly one heartbeat message there for the cycle

   Explicit non-goals:
   - do **not** post to all channels
   - do **not** post to reminder `TargetChannelID`
   - do **not** post once per reminder

7. Define the error-path heartbeat behavior explicitly.

   If the poll cycle throws or partially fails, the phase should still allow an error heartbeat when heartbeat posting is enabled. Observability is weakest precisely when silent failures swallow the cycle.

   Proposed behavior:
   - success summary: normal heartbeat copy
   - workspace skipped: heartbeat may still post a "skipped" or "0 eligible reminders" summary
   - cycle error: post an error heartbeat with compact wording if a workspace summary exists
   - fatal error before workspace summaries exist: log only

   Example error copy:

```text
GitHub sync heartbeat: cycle encountered an error after checking 3 reminder(s). Review logs for details.
```

8. Keep the Slack copy short and operational.

   Example:

```text
GitHub sync heartbeat: checked 7 reminder(s), auto-completed 1. Next scheduled poll in ~30 minutes.
```

   If nothing was eligible:

```text
GitHub sync heartbeat: ran successfully, checked 0 GitHub-linked reminders.
```

   The wording should describe completion of the poll cycle, not claim a fixed wall-clock interval. The heartbeat is poll-cycle-based, so actual timing can drift slightly if a cycle runs long.

9. Reuse summary generation between scheduled and manual sync where practical.

   `@Sleuth AI github sync now` can keep its current command response, but the underlying summary builder should be shared so manual and scheduled reporting do not drift.

10. Add focused coverage and manual verification.

   Automated tests should verify:
   - flag unset -> no heartbeat post
   - flag enabled -> heartbeat posts to `REMINDER_CHANNEL_NAME` only
   - flag enabled + reminder `TargetChannelID` differs -> heartbeat does not bleed into target channel
   - zero eligible reminders -> copy reflects zero correctly
   - error summary -> copy reflects failure state correctly
   - cached channel ID is reused across cycles instead of forcing lookup every time

### Manual verification checklist

- enable `GITHUB_SYNC_HEARTBEAT_ENABLED` for one test workspace
- run `npm run dev`
- wait for a scheduled sync cycle to finish
- confirm one heartbeat appears after the poll cycle in `REMINDER_CHANNEL_NAME`
- confirm no heartbeat appears in other channels
- confirm the heartbeat does not post into reminder target channels that differ from `REMINDER_CHANNEL_NAME`
- confirm a workspace without the flag does not receive heartbeat posts

---

## Risk and Effort Summary

| Phase | Risk | Effort | Notes |
|---|---|---|---|
| Spike A (offline regex) | None | Low (~30 min) | Standalone script, no production impact |
| Spike B (live test) | Low | Low (~1 hr) | Test channel only, temporary log line |
| Phase 1 (meta field) | Low | Low-Medium (~2-3 hrs) | Additive field, backwards compatible, no migration |
| Phase 2 (GitHub cron) | Low-Medium | Medium (~4-6 hrs) | New module, external API, initial issue-first auto-completion behavior |
| Phase 6 (main-channel heartbeat) | Low-Medium | Low-Medium (~2-4 hrs) | Reuses existing poll cadence and Slack posting primitives, but the critical path is refactoring the poll loop to return structured summaries, then posting one opt-in heartbeat to the cached `REMINDER_CHANNEL_NAME` target only |
| Phase 3 (verification) | None | Low (~1 hr) | Standard post-build checks |
| Phase 4 (manual sync) | None | Low (~30 min) | Thin Slack command wrapper over existing poll logic |
| Phase 5 (PR auto-complete) | Low-Medium | Medium (~2-4 hrs) | Reuses existing PR parsing/check path; mainly decision logic, copy, and tests |

**Overall: Low-Medium risk, Medium effort.**

Highest risk item is still the auto-completion behavior. Mitigated by:
- Requiring ALL linked GitHub items on a reminder to be complete before completing
- Treating PR lookup failures conservatively by leaving reminders active
- Using endpoint-specific GitHub checks and a non-overlapping polling loop
- Posting a Slack notification so completions aren't silent
- Using the existing FSM transition path (proven code, not new logic)
- One-way sync only (Sleuth never writes to GitHub)

If Phase 5 is implemented, the main new risk becomes widening the completion rule from issues-only to "all linked items complete." That risk is contained by:
- reusing the existing PR endpoint helper instead of introducing a new integration surface
- covering the decision matrix with unit tests first
- using the Layer 2 harness for Slack command/notification assertions before live testing

---

## AGENTS.md Compliance Notes

| AGENTS.md Section | Status | Notes |
|---|---|---|
| 0.1 Guardrails | Aligned | New method in `reminders-module.js`, new standalone module `github-sync-module.js` |
| 0.2 Dependency contract | Aligned | No new npm dependencies — uses Node 18 built-in `fetch` and existing `crypto`; keeps GitHub polling isolated in a dedicated module |
| 6 Coding conventions | Must follow | PascalCase, `Arg` prefix params, `Async` suffix, `#` private methods |
| 7 Observability | Aligned | `[github-sync]` prefix tag on all log messages |
| 8 Post-build | Phase 3 | Explicit build + smoke test + manual verification |
| 11 Key paths | Aligned | Changes in `src/reminders-module.js` (typedef + extraction + public completion entrypoint), new `src/github-sync-module.js`, `src/app.js` (module wiring) |
| 15 Anti-patterns | Aligned | No new npm dependencies, no over-engineering, reuses existing completion path |

---

## Future Considerations (Out of Scope)

- **Two-way sync:** Creating GitHub issues from Sleuth reminders (requires write access, higher risk)
- **Webhook-based sync:** Instead of polling, receive GitHub webhook events for instant updates (requires public URL or GitHub App, more complex setup)
- **Multi-provider support:** Extending to Jira, Linear, or other issue trackers (same pattern, different API)
- **Partial completion:** Completing individual tasks within a multi-URL reminder when their specific issue closes (current rule: all must close)
- **Reopen detection:** Reopening a completed Sleuth task if the linked GitHub issue is reopened
