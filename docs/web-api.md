
# Overview

This document describes the Web API for the AEGIS backend and provides snippets of code to help you get started.

**Note:** All requests return the 200 status code and use the "success" property to indicate error/success.

## Bearer Token Authentication

All requests must include a valid Bearer token in the Authorization header. If the token is missing or invalid, the 
request will be forbidden with the following response:
```json
{
    "success": false,
    "data": "Forbidden."
}
```

For local development, AEGIS still falls back to the legacy token `test` when no environment override is configured.
For production, set `WEB_API_BEARER_TOKEN` so external consumers do not depend on that fallback. AEGIS also accepts
an optional `WEB_API_PORT` override; if unset it listens on port `2020`.

## POST /workspace

### Description
Creates or updates a workspace with the provided information. The workspace information must include all required non-AI fields as defined in the `WorkspaceInfo` type, plus at least one supported AI provider key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`.

Unused optional AI-key fields may be omitted. If they are submitted as blank strings, AEGIS normalizes them away before validation and persistence.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspace" -Method Post -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
} -Body (@{
    WORKSPACE_NAME = "example_workspace"
    ADMIN_EMAIL = "admin@example.com"
    LIVE_TOKEN = "live_token"
    LIVE_SIGNING_SECRET = "live_signing_secret"
    LIVE_APP_TOKEN = "live_app_token"
    OPENAI_API_KEY = "openai_api_key"
    ANTHROPIC_API_KEY = "anthropic_api_key"
    GEMINI_API_KEY = "gemini_api_key"
    REMINDER_CHANNEL_NAME = "reminder_channel"
    MAIN_TIMEZONE = "UTC"
    NOTION_TOKEN = "notion_api_token"
    GITHUB_PAT = "github_pat_xxx"
    GITHUB_USER_MAP = '{"U000EXAMPLE1": "octo-dev"}'
    GITHUB_ACTIONS_REPO = "your-org/your-repo"
    GITHUB_ACTIONS_WORKFLOW = "ci.yml"
    GITHUB_ACTIONS_BRANCH = "development"
    GITHUB_SYNC_HEARTBEAT_ENABLED = "yes"
    WPDBTK_RAG_ENABLED = "yes"
    WPDBTK_RAG_BASE_URL = "https://rag.example.com"
    WPDBTK_RAG_SERVICE_TOKEN = "rag_service_token_here"
    WPDBTK_RAG_DEFAULT_SOURCE = "bq_client-a"
} | ConvertTo-Json)
```

### Mac/Linux (cURL)

```bash
curl -X POST "http://localhost:2020/workspace" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json" -d '{
    "WORKSPACE_NAME": "example_workspace",
    "ADMIN_EMAIL": "admin@example.com",
    "LIVE_TOKEN": "live_token",
    "LIVE_SIGNING_SECRET": "live_signing_secret",
    "LIVE_APP_TOKEN": "live_app_token",
    "OPENAI_API_KEY": "openai_api_key",
    "ANTHROPIC_API_KEY": "anthropic_api_key",
    "GEMINI_API_KEY": "gemini_api_key",
    "REMINDER_CHANNEL_NAME": "reminder_channel",
    "MAIN_TIMEZONE": "UTC",
    "NOTION_TOKEN": "notion_api_token",
    "GITHUB_PAT": "github_pat_xxx",
    "GITHUB_USER_MAP": "{\"U000EXAMPLE1\": \"octo-dev\"}",
    "GITHUB_ACTIONS_REPO": "your-org/your-repo",
    "GITHUB_ACTIONS_WORKFLOW": "ci.yml",
    "GITHUB_ACTIONS_BRANCH": "development",
    "GITHUB_SYNC_HEARTBEAT_ENABLED": "yes",
    "WPDBTK_RAG_ENABLED": "yes",
    "WPDBTK_RAG_BASE_URL": "https://rag.example.com",
    "WPDBTK_RAG_SERVICE_TOKEN": "rag_service_token_here",
    "WPDBTK_RAG_DEFAULT_SOURCE": "bq_client-a"
}'
```

### Example Response

```json
{
    "success": true,
    "data": "Workspace saved."
}
```

## GET /workspaces

### Description
Retrieves a list of all workspace names.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspaces" -Method Get -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Mac/Linux (cURL)

```bash
curl -X GET "http://localhost:2020/workspaces" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Example Response

```json
{
    "success": true,
    "data": ["example_workspace"]
}
```

## GET /workspace/:name/exists

### Description
Checks if a workspace with the given name exists.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspace/example_workspace/exists" -Method Get -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Mac/Linux (cURL)

```bash
curl -X GET "http://localhost:2020/workspace/example_workspace/exists" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Example Response

```json
{
    "success": true,
    "data": true
}
```

## GET /workspace/:name

### Description
Retrieves the information for a workspace with the given name.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspace/example_workspace" -Method Get -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Mac/Linux (cURL)

```bash
curl -X GET "http://localhost:2020/workspace/example_workspace" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Example Response

```json
{
    "success": true,
    "data": {
        "WORKSPACE_NAME": "example_workspace",
        "ADMIN_EMAIL": "admin@example.com",
        "LIVE_TOKEN": "live_token",
        "LIVE_SIGNING_SECRET": "live_signing_secret",
        "LIVE_APP_TOKEN": "live_app_token",
        "OPENAI_API_KEY": "openai_api_key",
        "ANTHROPIC_API_KEY": "anthropic_api_key",
        "GEMINI_API_KEY": "gemini_api_key",
        "REMINDER_CHANNEL_NAME": "reminder_channel",
        "MAIN_TIMEZONE": "UTC",
        "NOTION_TOKEN": "notion_api_token",
        "GITHUB_PAT": "github_pat_xxx",
        "GITHUB_ACTIONS_REPO": "your-org/your-repo",
        "GITHUB_ACTIONS_WORKFLOW": "ci.yml",
        "GITHUB_ACTIONS_BRANCH": "development",
        "GITHUB_SYNC_HEARTBEAT_ENABLED": "yes",
        "WPDBTK_RAG_ENABLED": "yes",
        "WPDBTK_RAG_BASE_URL": "https://rag.example.com",
        "WPDBTK_RAG_SERVICE_TOKEN": "rag_service_token_here",
        "WPDBTK_RAG_DEFAULT_SOURCE": "bq_client-a"
    }
}
```

## DELETE /workspace/:name

### Description
Deletes the workspace with the given name.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspace/example_workspace" -Method Delete -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Mac/Linux (cURL)

```bash
curl -X DELETE "http://localhost:2020/workspace/example_workspace" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Example Response

```json
{
    "success": true,
    "data": "Workspace deleted."
}
```

## GET /workspace/:name/reminders

### Description
Retrieves reminders for the workspace with the given name. The endpoint reads directly from the persisted reminders file
on disk, so it is available even during app startup or after a restart. Returns an empty array if the workspace has no
reminders yet.

By default, the response is the raw reminders array from `data/runtime/reminders/<WORKSPACE_NAME>_reminders.json`.
External consumers can opt into a more stable export envelope by adding `?format=rebalance`.

### Query Parameters

| Name | Required | Values | Description |
|---|---|---|---|
| `format` | no | `raw` (default), `rebalance` | `raw` returns the persisted reminder records directly. `rebalance` wraps them in metadata and normalizes dates/state values for external services. |
| `activeOnly` | no | `true`, `false` | When `true`, excludes terminal reminder states such as `completed`, `canceled`, and `dead-letter`. |
| `state` | no | comma-separated reminder states | Filters by normalized reminder state. Supported values: `scheduled`, `overdue`, `snoozed`, `posting`, `posted`, `rescheduled`, `failed`, `completed`, `canceled`, `dead-letter`. Legacy `due` is treated as `overdue`. |

### Mac/Linux (cURL)

```bash
curl -X GET "http://localhost:2020/workspace/example_workspace/reminders" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspace/example_workspace/reminders" -Method Get -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Example Response

```json
{
    "success": true,
    "data": [
        {
            "ReminderID": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "CreatedOn": "2026-03-20T09:00:00.000Z",
            "ShouldPostOn": "2026-03-28T09:00:00.000Z",
            "TargetChannelID": "C_REMINDERS",
            "OriginalChannelID": "C_GENERAL",
            "OriginalMessageID": "1773990000.000001",
            "OriginalSenderID": "U12345678",
            "ReminderMessageText": "Review PR 240",
            "IgnoreSnooze": false,
            "OriginalChannelName": "general",
            "AssigneeID": "U12345678",
            "GitHubUrls": ["https://github.com/your-org/your-repo/pull/240"],
            "State": "scheduled"
        }
    ]
}
```

### Empty Workspace Response

```json
{
    "success": true,
    "data": []
}
```

### Rebalance Export Example

This form is intended for external consumers such as `rebalance-OS`. It returns metadata plus normalized reminder
records:

```bash
curl -X GET "http://localhost:2020/workspace/neochrome/reminders?format=rebalance&activeOnly=true" \
  -H "Authorization: Bearer $WEB_API_BEARER_TOKEN" \
  -H "Content-Type: application/json"
```

```json
{
    "success": true,
    "data": {
        "workspaceName": "neochrome",
        "fetchedAt": "2026-04-18T15:12:34.567Z",
        "totalReminderCount": 12,
        "returnedReminderCount": 10,
        "filters": {
            "activeOnly": true,
            "states": []
        },
        "source": {
            "type": "sleuth-reminders-file",
            "relativePath": "data/runtime/reminders/neochrome_reminders.json"
        },
        "reminders": [
            {
                "reminderId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "state": "scheduled",
                "isActive": true,
                "createdOn": "2026-03-20T09:00:00.000Z",
                "shouldPostOn": "2026-03-28T09:00:00.000Z",
                "reminderMessageText": "Review PR 240",
                "ignoreSnooze": false,
                "assigneeId": "U12345678",
                "originalSenderId": "U12345678",
                "targetChannelId": "C_REMINDERS",
                "originalChannelId": "C_GENERAL",
                "originalChannelName": "general",
                "originalMessageId": "1773990000.000001",
                "originalThreadTs": null,
                "githubUrls": ["https://github.com/your-org/your-repo/pull/240"]
            }
        ]
    }
}
```

### Python Example (`requests`)

```python
import os
import requests

base_url = os.environ.get("SLEUTH_WEB_API_BASE_URL", "http://127.0.0.1:2020")
token = os.environ["SLEUTH_WEB_API_TOKEN"]

response = requests.get(
    f"{base_url}/workspace/neochrome/reminders",
    params={"format": "rebalance", "activeOnly": "true"},
    headers={"Authorization": f"Bearer {token}"},
    timeout=30,
)
response.raise_for_status()

payload = response.json()
if not payload["success"]:
    raise RuntimeError(payload["data"])

for reminder in payload["data"]["reminders"]:
    print(reminder["shouldPostOn"], reminder["reminderMessageText"])
```

## Admin Reminders Dashboard

The read-only reminders dashboard is a static page served at `/admin/reminders.html`. It is backed by
two `/admin/*` endpoints that — unlike the endpoints above — are protected by the **admin session token**
(the same token issued by `POST /admin/login` and stored in the browser's `sessionStorage`), not the legacy
`WEB_API_BEARER_TOKEN`. Requests without a valid session token receive `{ "success": false, "data": "Forbidden." }`.

### GET /admin/dashboard/workspaces

Returns the list of workspace names for the dashboard's workspace selector.

```bash
curl -X GET "http://localhost:2020/admin/dashboard/workspaces" -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>"
```

```json
{
    "success": true,
    "data": ["neochrome", "neochrome-dev"]
}
```

### GET /admin/dashboard/reminders?workspace=NAME

Returns a flat, display-ready view of the workspace's reminders: a human-readable task name, resolved
assignee and assignor display names, due date (`ShouldPostOn`), created date, and — for completed reminders —
the completed date pulled from the workspace completion history (`<WORKSPACE_NAME>_completed.json`). Reminders
that exist only in the completion history are folded in so finished tasks still appear.

| Name | Required | Description |
|---|---|---|
| `workspace` | yes | Workspace name to load reminders for. |

```bash
curl -X GET "http://localhost:2020/admin/dashboard/reminders?workspace=neochrome" -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>"
```

```json
{
    "success": true,
    "data": {
        "workspaceName": "neochrome",
        "fetchedAt": "2026-07-02T15:12:34.567Z",
        "reminderCount": 1,
        "reminders": [
            {
                "reminderId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "taskName": "Review PR 240",
                "assigneeId": "U12345678",
                "assigneeName": "octo-dev",
                "assignorId": "U12345678",
                "assignorName": "octo-dev",
                "createdOn": "2026-03-20T09:00:00.000Z",
                "dueDate": "2026-03-28T09:00:00.000Z",
                "completedDate": null,
                "state": "scheduled",
                "permalink": "https://neochrome.slack.com/archives/C_GENERAL/p1773990000000001"
            }
        ]
    }
}
```

Note: `assigneeName` / `assignorName` fall back to the raw Slack user id when no live SlackApp is available to
resolve a display name (e.g. during startup or in tests).

## GET /workspace/:name/stats

### Description
Retrieves usage statistics for the workspace with the given name.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/workspace/example_workspace/stats" -Method Get -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Mac/Linux (cURL)

```bash
curl -X GET "http://localhost:2020/workspace/example_workspace/stats" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Example Response

```json
{
    "success": true,
    "data": {
        "IncomingMessageCount": 1234,
        "IncomingMessageLength": 45678,
        "OutgoingMessageCount": 567,
        "OutgoingMessageLength": 23456,
        "OutgoingGptMessageCount": 789,
        "OutgoingGptMessageLength": 34567,
        "IncomingGptMessageCount": 789,
        "IncomingGptMessageLength": 45678
    }
}
```

## POST /settings/last-file-path

### Description
Saves the last manually entered file path for later retrieval.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/settings/last-file-path" -Method Post -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
} -Body (@{ path = "C:\\data\\file.json" } | ConvertTo-Json)
```

### Mac/Linux (cURL)

```bash
curl -X POST "http://localhost:2020/settings/last-file-path" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json" -d '{"path":"/data/file.json"}'
```

### Example Response

```json
{
    "success": true,
    "data": "Path saved."
}
```

## GET /settings/last-file-path

### Description
Retrieves the last manually entered file path.

### Windows (PowerShell)

```powershell
Invoke-RestMethod -Uri "http://localhost:2020/settings/last-file-path" -Method Get -Headers @{
    "Authorization" = "Bearer $SLEUTH_API_TOKEN"
    "Content-Type" = "application/json"
}
```

### Mac/Linux (cURL)

```bash
curl -X GET "http://localhost:2020/settings/last-file-path" -H "Authorization: Bearer $SLEUTH_API_TOKEN" -H "Content-Type: application/json"
```

### Example Response

```json
{
    "success": true,
    "data": "/data/file.json"
}
```
