# Project Plan: GitHub Activity Digest

## Goal
Surface GitHub activity that people forget about — primarily stale PRs and outstanding review requests — directly inside Slack via the existing daily digest, so important review/follow-up work doesn't rot. Designed to be **automatic and visible** rather than another inbox to check.

## Effort Level
Medium. The plumbing exists (per-workspace `GITHUB_PAT`, `GitHubSyncModule`, `RunDailyDigestNowAsync` in `reminders-module.js`, daily-digest scheduler with `DAILY_TASK_DIGEST_TIME`), but org-wide PR querying, the Slack-user→GitHub-handle map, and a new digest section are all net-new.

## Scope (v1)
Three buckets, in order of value:

1. **Awaiting your review** — open PRs across watched repos where the user is in `requested_reviewers`. *Highest leverage: this is the actual job-to-be-done.*
2. **Your stale PRs** — PRs authored by the user that are still open with no commit, comment, or review activity in the last `STALE_PR_DAYS` (default 7).
3. **Recently closed/merged** — PRs across watched repos closed or merged in the last 2 days, grouped by repo.

Explicitly **out of scope for v1**: issue activity, draft PRs (filter out by default), CI status, Dependabot PRs (filter by author by default), per-channel digests, "your turn" interactivity (resolve, dismiss, snooze).

## Implementation Steps

### 1. Workspace Config (`src/workspaces.js`, `config/workspace-template.json`)
- Add typedef + validation for new optional fields:
  - `GITHUB_DIGEST_ORGS` — string array of org or `org/repo` entries to watch.
  - `GITHUB_USER_MAP` — object mapping Slack user IDs → GitHub usernames (e.g. `{ "U000EXAMPLE4": "octo-dev1" }`).
  - `GITHUB_DIGEST_STALE_DAYS` — number, default 7.
  - `GITHUB_DIGEST_ENABLED` — `'true'`/`'false'` flag, defaulting to false so existing tenants are unaffected.
- Reuse `GITHUB_PAT` — no second key needed.
- Document the fields in `docs/web-api.md`.

### 2. New Module: `src/github-digest-module.js`
- `BuildOrgDigestAsync({ orgs, userMap, stalePrDays, lookbackDays })` returns a structured payload:
  ```js
  {
    perUser: Map<slackUserId, { awaitingReview: PR[], staleAuthored: PR[] }>,
    sharedRecent: { closedOrMerged: PR[] }
  }
  ```
- Use **GitHub GraphQL** (single query per org via `search` with qualifiers) over REST — one round trip per bucket beats N REST calls. Queries:
  - `is:pr is:open review-requested:<gh-user> org:<org>`
  - `is:pr is:open author:<gh-user> org:<org> updated:<YYYY-MM-DD..*`
  - `is:pr is:closed org:<org> closed:>=<YYYY-MM-DD>`
- Filter out drafts and bot authors (`dependabot`, `renovate-bot`, anything in a configurable `GITHUB_DIGEST_IGNORED_AUTHORS` list).
- Cap each bucket at a sensible max (e.g. 10 per user per bucket) to keep digests readable.

### 3. Slack Rendering (`src/github-digest-module.js`)
- Build Slack blocks (not raw text) so the digest can later support buttons (snooze/dismiss). For v1, render text-with-links is fine:
  ```
  *:eyes: Awaiting your review (3)*
  • <https://...|repo#123> — <Title> · opened 2d ago by @author
  ...
  *:hourglass: Your stale PRs (1)*
  • <https://...|repo#456> — <Title> · last activity 9d ago
  ...
  *:checkered_flag: Closed/merged in the last 2 days*
  • org/repo: 4 merged, 1 closed
  ```
- Mirror citation/link formatting conventions already in `chat-module.js` (`BuildSafeSlackLinkUrl`, `SlackFormatUtils.SanitizeForInlineSlack`).

### 4. Daily Digest Hook (`src/reminders-module.js`)
- Append the GitHub digest as an extra section after the existing reminders digest in `RunDailyDigestNowAsync` (and in the scheduled run).
- Per-user buckets (`awaitingReview`, `staleAuthored`) are posted in DMs to each mapped user; `sharedRecent` is posted in the main reminder channel as a single org-wide note.
- Skip silently if `GITHUB_DIGEST_ENABLED` is false or `GITHUB_DIGEST_ORGS` is empty.
- Failure is isolated like the v1.4.86 mirror: a GitHub digest failure must not break the reminders digest. Warn-log, move on.

### 5. Manual Trigger (`src/chat-module.js`)
- Add `@Sleuth AI run github digest` (admin-only) for ad-hoc execution and debugging — mirrors the pattern of the existing `run daily digest` command.
- Update help text in `HELP.md` and the commands list.

### 6. Testing
- Unit-test the GraphQL response → bucket mapping with fixtures (avoid live API calls).
- Test the bot-author filter, draft filter, stale-day cutoff, and empty-bucket handling.
- Integration-test the Slack rendering and that a GitHub digest failure does not abort the reminders digest.

### 7. Versioning & CHANGELOG
- Bump version, document the new `GITHUB_DIGEST_*` config fields and the manual trigger command.

## Open Questions (raise before implementation)
- **Where do per-user DMs land** — the bot opens an IM with each mapped user, or post in a designated channel like `#sleuth-github`? DM is more "private inbox" but harder to dismiss; channel is more visible but noisier.
- **Should "stale" use `updatedAt` or last *human* comment/review?** GitHub's `updatedAt` flips on bot pushes and label changes, which can hide truly stale PRs. v1 uses `updatedAt` for simplicity; revisit if signal is weak.
- **Throttling** — if a user has 50 review requests, do we list all or summarize? v1 caps at 10 with a "+N more" suffix.
- **Cross-org users** — the user map is workspace-wide, but a user may only care about a subset of watched orgs. Likely fine for v1; revisit per-user filters if needed.

## Future Extensions (not v1)
- Snooze / dismiss buttons via Slack interactivity.
- Per-channel digests for repos linked to a channel.
- Issue digests (assigned, mentioned).
- "Stuck" detection: PRs approved >24h ago but not merged.
- Slack notifications when a PR you authored gets a review (push, not pull).
