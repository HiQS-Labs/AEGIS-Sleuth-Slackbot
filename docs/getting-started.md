# Getting Started with AEGIS

**Goal:** go from zero to a working Slack bot in about **30–45 minutes**.

When you finish, AEGIS will be running locally, connected to your Slack workspace, and responding to
`@YourBotName help`.

---

## What you need before you start

Gather everything in this checklist first. Steps below assume you have it ready.

### Software (your machine)

| Requirement | Notes |
|---|---|
| **Node.js 18.20.4+** | Node **20 or 22 LTS** recommended. Check: `node -v` |
| **npm** | Ships with Node. Check: `npm -v` |
| **git** | To clone the repository |
| **Build tools** (macOS/Linux) | Required for native modules (`better-sqlite3`). macOS: Xcode Command Line Tools (`xcode-select --install`). Linux: `build-essential` |

### Accounts & permissions

| Requirement | Notes |
|---|---|
| **Slack workspace** | You must be allowed to **install apps** (admin or approved installer) |
| **AI provider account** | At least one of: [OpenAI](https://platform.openai.com/), [Anthropic](https://console.anthropic.com/), or [Google AI](https://aistudio.google.com/) with a billable API key |

### Credentials you will create during setup

| Credential | Where it comes from | Used for |
|---|---|---|
| `LIVE_TOKEN` | Slack app → Bot User OAuth Token (`xoxb-…`) | Slack connection |
| `LIVE_SIGNING_SECRET` | Slack app → Signing Secret | Slack verification |
| `LIVE_APP_TOKEN` | Slack app → App-Level Token with `connections:write` (`xapp-…`) | Socket Mode |
| `OPENAI_API_KEY` (or Anthropic/Gemini) | Your AI provider dashboard | Reminders & chat |
| `ADMIN_ENCRYPTION_KEY` | You generate locally (64-char hex) | Admin panel (optional) |
| `WEB_API_BEARER_TOKEN` | You choose a long random string | Secures the REST API in production |

> **Local dev shortcut:** if `WEB_API_BEARER_TOKEN` is unset in `.env`, the API accepts the
> development bearer `test`. **Never use that on a server reachable from the internet.**

### Optional (not needed for first run)

- Linux server with `systemd` — for 24/7 production ([server install guide](server-installation-guide.md))
- New Relic license — monitoring only
- Notion / GitHub tokens — integrations you can add later

---

## Step 1 — Clone and install

```bash
git clone https://github.com/hiqs-suite/aegis-sleuth-slack-bot.git aegis
cd aegis
npm ci
```

Verify the install:

```bash
npm run build
npm test
```

Both should exit without errors.

---

## Step 2 — Create your `.env` file

```bash
cp .env.example .env
```

Generate an admin encryption key and paste it into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edit `.env` and set at minimum:

```bash
ADMIN_ENCRYPTION_KEY=<paste-64-char-hex-here>
# Optional locally — leave blank to use dev bearer "test":
# WEB_API_BEARER_TOKEN=
WEB_API_PORT=2020
```

**What goes in `.env` vs workspace config**

| `.env` (host) | Web API `POST /workspace` (per Slack workspace) |
|---|---|
| `ADMIN_ENCRYPTION_KEY`, `WEB_API_BEARER_TOKEN`, `WEB_API_PORT` | `LIVE_TOKEN`, `LIVE_SIGNING_SECRET`, `LIVE_APP_TOKEN`, `OPENAI_API_KEY`, channel, timezone |

The app loads `.env` automatically when you run `npm run dev` or `node src/app.js`.

---

## Step 3 — Create a Slack app

AEGIS uses **Socket Mode** (no public URL required for Slack events).

**Full manifest and screenshots:** [`docs/slack-app-setup.md`](slack-app-setup.md)

Short version:

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an app manifest**
2. Paste the manifest from [`slack-app-setup.md`](slack-app-setup.md) (enables Socket Mode + required scopes)
3. **Install to Workspace**
4. Collect three values from the Slack app settings:
   - **Bot User OAuth Token** → `LIVE_TOKEN` (`xoxb-…`)
   - **Signing Secret** → `LIVE_SIGNING_SECRET`
   - **App-Level Token** (`connections:write`) → `LIVE_APP_TOKEN` (`xapp-…`)
5. **Invite the bot** to the channel where you want reminders (e.g. `#general`)

---

## Step 4 — Start AEGIS

In one terminal, from the repo root:

```bash
npm run dev
```

Leave this running. You should see the process start and the Web API listen on port **2020**.

If `WEB_API_BEARER_TOKEN` is unset, expect a **security warning** in the logs — that is normal for local dev.

---

## Step 5 — Register your workspace

Open a **second terminal**. Export your credentials (never commit these):

```bash
cd aegis   # same repo root

export SLACK_BOT_TOKEN=xoxb-your-token
export SLACK_SIGNING_SECRET=your-signing-secret
export SLACK_APP_TOKEN=xapp-your-app-token
export OPENAI_API_KEY=sk-your-openai-key

# Match .env — or omit to use dev bearer "test":
export WEB_API_BEARER_TOKEN=test
```

Register the workspace:

```bash
curl -X POST "http://localhost:2020/workspace" \
  -H "Authorization: Bearer ${WEB_API_BEARER_TOKEN:-test}" \
  -H "Content-Type: application/json" \
  -d '{
    "WORKSPACE_NAME": "my-team",
    "ADMIN_EMAIL": "you@example.com",
    "LIVE_TOKEN": "'"$SLACK_BOT_TOKEN"'",
    "LIVE_SIGNING_SECRET": "'"$SLACK_SIGNING_SECRET"'",
    "LIVE_APP_TOKEN": "'"$SLACK_APP_TOKEN"'",
    "OPENAI_API_KEY": "'"$OPENAI_API_KEY"'",
    "REMINDER_CHANNEL_NAME": "general",
    "MAIN_TIMEZONE": "America/Los_Angeles",
    "SNOOZE_DAYS": ["Saturday", "Sunday"]
  }'
```

**Success looks like:**

```json
{"success":true,"data":"Workspace saved."}
```

**Common failures:**

| Response | Fix |
|---|---|
| `Forbidden.` | Wrong bearer token — check `WEB_API_BEARER_TOKEN` matches your `.env` or use `test` locally |
| HTML instead of JSON | Malformed JSON in the curl body — check quotes and commas |
| Connection refused | App not running — go back to Step 4 |

---

## Step 6 — Restart and verify in Slack

AEGIS does not hot-reload workspace config.

1. In the **first terminal**, stop the app (`Ctrl+C`) and start again:
   ```bash
   npm run dev
   ```
2. In Slack, in a channel where the bot is invited, mention your bot:
   ```
   @AEGIS AI help
   ```
   (Use whatever **display name** you gave the app in the manifest.)

**You are done** when the bot replies with a help message.

---

## Step 7 — Optional: admin panel

For the web admin UI (reminders dashboard):

```bash
npm run admin:setup
```

Then, with the app running, open <http://localhost:2020/admin/login.html> and sign in with the
email/password you chose during setup.

---

## Troubleshooting

### `npm ci` fails on native modules

Install build tools (see requirements table), then:

```bash
rm -rf node_modules
npm ci
```

### Bot does not respond in Slack

- Confirm the bot is **invited** to the channel
- Confirm you **restarted** after `POST /workspace`
- Check the terminal running `npm run dev` for errors
- Verify Socket Mode is enabled and `LIVE_APP_TOKEN` has `connections:write`

### `admin:setup` fails on encryption key

Ensure `ADMIN_ENCRYPTION_KEY` is set in `.env` (64 hex characters). The script loads `.env` automatically.

### Node version warnings

Node 18.20.4+ is the minimum. Node **20 LTS** or **22 LTS** is recommended for fewer dependency warnings.

---

## Next steps

| Goal | Doc |
|---|---|
| Run 24/7 on a Linux server | [`server-installation-guide.md`](server-installation-guide.md) |
| macOS-specific notes | [`../macos-install-guide.md`](../macos-install-guide.md) |
| Web API reference | [`web-api.md`](web-api.md) |
| Security hardening | [`../SECURITY.md`](../SECURITY.md) |
| Contribute code | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
