# GH-248 / git-pulse#5 — GitHub issue stream → Slack

## Goal

Every 15 minutes, post newly filed GitHub issues from HiQS-watched repos into a Slack channel, and thread follow-up activity (comments, referencing PRs, close/reopen) under each issue's parent message. Idempotent across restarts. Default off.

## Ownership

| Piece | Repo |
|---|---|
| Polling, Slack posts, state, DND, kill switch | **this repo** (`src/github-issue-stream-module.js`, planner, url utils) |
| Watched-repo allowlist export | **RebalanceOS** (`export_watched_repos` → `sync/repos/<device>.json`) |
| Transport file only | the private git-pulse repo (no code) |

Tracked as git-pulse#5 in the private git-pulse repo (moved from AEGIS-Sleuth-Slackbot#248).

## Phase 0 spike results (2026-10-20)

- `GET /repos/{r}/issues` includes `pull_request.merged_at` on merged PRs — confirmed on HiQS-Labs/rebalanceOS.
- Workspace PAT reach: HiQS-Labs, BinoidCBD, NeochromeTeam, kissplugins repos returned 200 with operator PAT.
- Bot parent posts: `GitHubCommentRelay` skips `user === BotUserID` and only matches reminder threads; reminder auto-schedule requires a temporal trigger — stream messages do not schedule reminders.
- Rate budget: ~8–50 watched repos × 2 calls × 4/hour ≪ 10% of 5,000/hour GitHub limit.

## Design summary

- Sleuth polls GitHub directly (issues + issue comments since cursor).
- Default allowlist = union of fresh `sync/repos/*.json` from git-pulse; override with `GITHUB_ISSUE_STREAM_REPOS`.
- State: durable JSON under `data/runtime/github-issue-stream/<ws>_github-issue-stream.json` (not SQLite — matches snapshot-relay seen-set pattern; recorded in CHANGELOG).
- Kill switch: remove workspace from `GITHUB_ISSUE_STREAM_WORKSPACES` and restart.
- Immediate silence: existing `dnd on` holds posts without advancing cursors.

## Env vars (`.env.runtime`)

| Var | Role |
|---|---|
| `GITHUB_ISSUE_STREAM_WORKSPACES` | Comma-separated workspace names; unset = off |
| `GITHUB_ISSUE_STREAM_CHANNEL_ID` | Target channel ID; no default; unset = stay disabled |
| `GITHUB_ISSUE_STREAM_INTERVAL_MS` | Default `900000` (15 min) |
| `GITHUB_ISSUE_STREAM_REPOS` | Optional explicit `owner/repo` list (overrides pulse) |
| `GITHUB_ISSUE_STREAM_ORG_FILTER` | Optional owner filter, e.g. `HiQS-Labs` |
| `GITHUB_ISSUE_STREAM_IGNORE_AUTHORS` | Extra logins to skip (bots already skipped) |

Reuses `WorkspaceInfo.GITHUB_PAT`, `SLEUTH_RAG_GITHUB_PAT`, `SNAPSHOT_RELAY_REPO` / `SNAPSHOT_RELAY_BRANCH`.

## Checklist

- [x] RebalanceOS `export_watched_repos` + `SYNC_SOURCES`
- [x] `ExtractIssueReferences` + planner + module + app.js wiring
- [x] Unit tests (url, planner, module including restart-no-duplicates)
- [x] `npm run build`, validators clean
- [ ] Dev-server dry run on Oracle (`development` branch) with a test channel
- [ ] Production enable: set channel + workspaces in `.env.runtime`, restart

## Rollback

Remove the workspace from `GITHUB_ISSUE_STREAM_WORKSPACES` and restart. State file is left in place for a later re-enable.
