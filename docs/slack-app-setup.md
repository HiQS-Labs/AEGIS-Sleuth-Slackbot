# Creating a Slack app for AEGIS

AEGIS needs a Slack app with **Socket Mode** enabled. Use the app-manifest route unless you have a
reason not to — it configures every scope and event subscription in one step.

When you finish, you will have the three credentials AEGIS needs per workspace:
`LIVE_TOKEN`, `LIVE_SIGNING_SECRET`, and `LIVE_APP_TOKEN`. Supply them via the
[Web API](web-api.md), never by committing them to a file.

---

## Method 1: Using App Manifest (Recommended)

1. **Create the App**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From an app manifest"
   - Select your workspace
   - Choose "JSON" format and paste this manifest:

```json
{
    "display_information": {
        "name": "AEGIS AI",
        "description": "Schedules reminders and acts as an AI team member.",
        "background_color": "#050505"
    },
    "features": {
        "bot_user": {
            "display_name": "AEGIS AI",
            "always_online": false
        }
    },
    "oauth_config": {
        "scopes": {
            "bot": [
                "app_mentions:read",
                "calls:write",
                "channels:history",
                "channels:read",
                "chat:write",
                "groups:history",
                "groups:read",
                "im:history",
                "im:read",
                "mpim:read",
                "reactions:read",
                "reactions:write",
                "users:read"
            ]
        }
    },
    "settings": {
        "event_subscriptions": {
            "bot_events": [
                "app_mention",
                "message.channels",
                "message.groups",
                "message.im",
                "reaction_added"
            ]
        },
        "interactivity": {
            "is_enabled": true
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": true,
        "token_rotation_enabled": false
    }
}
```

2. **Review and Create**
   - Review the configuration summary
   - Click "Create"

3. **Install the App**
   - Click "Install to Workspace"
   - Authorize the app

4. **Gather Credentials**
   - Go to "Basic Information" → "App Credentials" to get your `LIVE_SIGNING_SECRET`
   - Go to "OAuth & Permissions" to get your `LIVE_TOKEN` (Bot User OAuth Token)
   - Go to "Basic Information" → "App-Level Tokens" → "Generate Token and Scopes"
   - Add the `connections:write` scope and generate the token
   - Save this as your `LIVE_APP_TOKEN`

## Method 2: Manual Setup

1. **Create the App**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Enter an app name (e.g., "AEGIS")
   - Select your workspace

2. **Enable Socket Mode**
   - Go to "Socket Mode" in the left sidebar
   - Enable Socket Mode
   - Generate an app-level token with `connections:write` scope
   - Save this token - you'll need it as `LIVE_APP_TOKEN` (starts with `xapp-`)

3. **Configure OAuth & Permissions**
   - Go to "OAuth & Permissions" in the left sidebar
   - Scroll down to "Scopes" → "Bot Token Scopes"
   - Add these scopes (in alphabetical order):
     - `app_mentions:read` - Receive @mentions of the app
     - `calls:write` - Start calls in channels
     - `channels:history` - View messages in public channels
     - `channels:read` - View basic channel information
     - `chat:write` - Send messages as the app
     - `groups:history` - View messages in private channels
     - `groups:read` - View basic private channel information
     - `im:history` - View direct message history
     - `im:read` - View basic direct message information
     - `mpim:read` - View basic group direct message information
     - `reactions:read` - View emoji reactions
     - `reactions:write` - Add emoji reactions
     - `users:read` - View user information (required for diagnostics)
   - Click "Install to Workspace" at the top of the page
   - Authorize the app
   - Copy the Bot User OAuth Token - you'll need it as `LIVE_TOKEN` (starts with `xoxb-`)

4. **Get the Signing Secret**
   - Go to "Basic Information" in the left sidebar
   - Under "App Credentials", find "Signing Secret"
   - Copy it - you'll need it as `LIVE_SIGNING_SECRET`

5. **Enable Event Subscriptions**
   - Go to "Event Subscriptions" in the left sidebar
   - Toggle "Enable Events" to On
   - Under "Subscribe to bot events", add:
     - `app_mention` - When someone mentions @yourapp
     - `message.channels` - Messages in public channels
     - `message.groups` - Messages in private channels
     - `message.im` - Direct messages
     - `reaction_added` - When reactions are added
   - Save changes

Now you have all three required credentials:
- `LIVE_TOKEN` - Bot User OAuth Token
- `LIVE_SIGNING_SECRET` - Signing Secret
- `LIVE_APP_TOKEN` - App-level token for Socket Mode

