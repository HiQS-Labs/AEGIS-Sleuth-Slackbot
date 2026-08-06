# AEGIS App Server Installation Guide

> **First time with AEGIS?** Run through [Getting Started](getting-started.md) on your laptop first
> (clone → Slack app → workspace registration). This guide is for **24/7 production** on a Linux server.

This is the canonical **first-time server install** and SSH operations guide for AEGIS. Use this
document as the single source of truth for:

- first-time server installation
- emergency / fallback manual deployments
- operator SSH access from this machine
- service locations and restart/logging commands

**Routine deploys** (development and production) use **DeployHQ** — see [`docs/deployhq.md`](deployhq.md).
Other docs should link here (or to DeployHQ) instead of duplicating command blocks.

## Prerequisites

### Server Requirements
- Fresh Ubuntu 20.04+ or Debian 11+ server
- Root access (sudo privileges)
- Minimum 2GB RAM, 20GB disk space
- Internet connectivity

### Required Credentials and Information

Before starting, gather the following:

#### 1. GitHub Information
- **GitHub Personal Access Token** with `repo` scope (needed to clone during bootstrap)
- **Repository**: `owner/repository-name` — your fork or clone of AEGIS (canonical: `hiqs-suite/aegis-sleuth-slack-bot`)
- **Branch**: Usually `main`, `development`, or `experimental`

> A `workflow` scope is **not** required. This project deploys with DeployHQ, not GitHub Actions.

#### 2. Git Configuration
- **Your full name** (for git commits)
- **Your email address** (must match GitHub account)

#### 3. Server Environment
- **Environment name**: `experimental`, `development`, or `production`
- **Deploy method**: default `deployhq` (skip self-hosted runners). Set `DEPLOY_METHOD=github-actions` only for the legacy path.

#### 4. Slack App Credentials (for later workspace configuration)
- **WORKSPACE_NAME**: Unique identifier for this workspace
- **ADMIN_EMAIL**: Administrator email for the workspace
- **LIVE_TOKEN**: Slack Bot User OAuth Token (`xoxb-...`)
- **LIVE_SIGNING_SECRET**: Slack Signing Secret
- **LIVE_APP_TOKEN**: Slack App-Level Token for Socket Mode (`xapp-...`)
- **OPENAI_API_KEY**: OpenAI API key (`sk-...`)
- **REMINDER_CHANNEL_NAME**: Default channel for reminders
- **MAIN_TIMEZONE**: Primary timezone (e.g., `America/New_York`)
- **SNOOZE_DAYS**: Optional days of the week to skip posting reminders
- **NOTION_TOKEN**: Optional Notion API token (`ntn_...`)

## Installation Steps

### Step 1: Prepare the Server

1. **Create/access your server** on Vultr or your preferred provider
2. **Connect via SSH** as root:
   ```bash
   ssh root@your-server-ip
   ```

### Step 2: Download the Installation Script

```bash
# Download the installation script
curl -o server-install.sh "https://raw.githubusercontent.com/$GITHUB_REPO/main/scripts/server-install.sh"
chmod +x server-install.sh
```

### Step 3: Set Environment Variables

```bash
# Required environment variables
export GITHUB_TOKEN="ghp_your_personal_access_token_here"
export GITHUB_REPO="hiqs-suite/aegis-sleuth-slack-bot"   # or your own fork/clone
export SERVER_ENV="development"  # or "production" or "experimental"
export GIT_USER_NAME="Your Full Name"
export GIT_USER_EMAIL="your.email@domain.com"
# Optional — default is deployhq (no GitHub Actions runner):
# export DEPLOY_METHOD=deployhq
```

### Step 4: Run the Installation

```bash
./server-install.sh
```

The script will:
- Update system packages
- Install Node.js 18.x
- Clone the repository to `/root/sleuth-app`
- Install npm production dependencies
- Configure `sleuth-app.service`
- Generate SSH keys for operator access
- **Skip** GitHub Actions runner install when `DEPLOY_METHOD=deployhq` (default)

### Step 5: Configure Workspace

After installation, register your Slack workspace through the Web API (preferred — same as local dev).
The app must be running and reachable on port 2020.

1. **Set a production bearer token** (if not already in `/root/sleuth-app/.env.runtime`):
   ```bash
   cat >/root/sleuth-app/.env.runtime <<'EOF'
   WEB_API_BEARER_TOKEN=replace-with-a-long-random-token
   WEB_API_PORT=2020
   EOF
   chmod 600 /root/sleuth-app/.env.runtime
   systemctl restart sleuth-app
   ```

2. **Create the workspace** (replace placeholders; keep secrets out of shell history where possible):
   ```bash
   curl -X POST "http://localhost:2020/workspace" \
     -H "Authorization: Bearer $WEB_API_BEARER_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "WORKSPACE_NAME": "your-workspace",
       "ADMIN_EMAIL": "admin@yourcompany.com",
       "LIVE_TOKEN": "xoxb-your-bot-token",
       "LIVE_SIGNING_SECRET": "your-signing-secret",
       "LIVE_APP_TOKEN": "xapp-your-app-token",
       "OPENAI_API_KEY": "sk-your-openai-key",
       "REMINDER_CHANNEL_NAME": "general",
       "MAIN_TIMEZONE": "America/New_York",
       "SNOOZE_DAYS": ["Saturday", "Sunday"]
     }'
   ```

3. **Restart the app** so it loads the new workspace:
   ```bash
   systemctl restart sleuth-app
   ```

> **Emergency recovery only:** you may hand-edit `data/runtime/workspaces/your-workspace_workspace.json`
> if the Web API is unreachable. Prefer the API for normal operation — see [`docs/web-api.md`](docs/web-api.md).

### Step 6: Start the Application

```bash
# Start the service
systemctl start sleuth-app

# Check status
systemctl status sleuth-app

# View logs
journalctl -u sleuth-app --follow
```

App/service locations on the server:

- App checkout: `/root/sleuth-app`
- Service name: `sleuth-app.service`

### Step 7: Wire DeployHQ

Add this host as a DeployHQ server (SSH key + pre/post deploy commands). Full steps:
[`docs/deployhq.md`](deployhq.md).

### Optional: Configure Web API Token For External Consumers

If another service such as `rebalance-OS` needs to read AEGIS reminders over HTTP, create an optional runtime env file
used by `sleuth-app.service`:

```bash
cat >/root/sleuth-app/.env.runtime <<'EOF'
WEB_API_BEARER_TOKEN=replace-with-a-long-random-token
WEB_API_PORT=2020
EOF

chmod 600 /root/sleuth-app/.env.runtime
systemctl daemon-reload
systemctl restart sleuth-app
```

If `WEB_API_BEARER_TOKEN` is omitted, AEGIS falls back to the legacy development token `test`. Do not rely on that
fallback for production integrations.

## Routine Deployments

**Primary path:** DeployHQ — see [`docs/deployhq.md`](deployhq.md).

Post-upload on the server always runs:

```bash
bash /root/sleuth-app/scripts/deploy.sh
```

### Emergency fallback (manual SSH)

Only when DeployHQ is unavailable:

```bash
systemctl stop sleuth-app
cd /root/sleuth-app
git pull
npm ci --omit=dev
systemctl daemon-reload
systemctl start sleuth-app
systemctl status sleuth-app
```

Do not commit deploy credentials or server-specific tokens to this public repository.

### SSH Access Setup

The installation generates SSH keys for server management. To set up operator access:

1. **Copy the public key** (shown during installation)
2. **Add to authorized_keys** on servers you want to manage:
   ```bash
   ssh-copy-id -i /root/.ssh/sleuth-experimental-server.pub user@target-server
   ```

## Operator SSH Access From This Machine

Operator SSH credentials on this machine live in bare `KEY=value` env files under
`~/secrets/sleuth/`:

| Server | Env file | Vars |
|---|---|---|
| Development (`203.0.113.12`) | `~/secrets/sleuth/vultr-sleuth-development.env` | `SLEUTH_DEV_HOST`, `SLEUTH_DEV_USER`, `SLEUTH_DEV_PASS` |
| Production (`203.0.113.13`) | `~/secrets/sleuth/vultr-sleuth-production.env` | `SLEUTH_PROD_HOST`, `SLEUTH_PROD_USER`, `SLEUTH_PROD_PASS` |

### Password Metacharacter Gotcha

Do **not** `source` these Vultr env files directly if the password may contain shell metacharacters
such as `$`, `!`, or `{`. Because the files are plain shell assignments without quotes, `source`
can expand `$...` inside the password and silently corrupt the literal value before `sshpass`
receives it.

Read the values literally and use `sshpass -e` instead:

```bash
# development
SLEUTH_DEV_HOST="$(sed -n 's/^SLEUTH_DEV_HOST=//p' ~/secrets/sleuth/vultr-sleuth-development.env)"
SLEUTH_DEV_USER="$(sed -n 's/^SLEUTH_DEV_USER=//p' ~/secrets/sleuth/vultr-sleuth-development.env)"
SSHPASS="$(sed -n 's/^SLEUTH_DEV_PASS=//p' ~/secrets/sleuth/vultr-sleuth-development.env)"
export SSHPASS
sshpass -e ssh -o StrictHostKeyChecking=accept-new \
  -o PubkeyAuthentication=no -o PreferredAuthentications=password \
  "$SLEUTH_DEV_USER@$SLEUTH_DEV_HOST" '<command>'

# production
SLEUTH_PROD_HOST="$(sed -n 's/^SLEUTH_PROD_HOST=//p' ~/secrets/sleuth/vultr-sleuth-production.env)"
SLEUTH_PROD_USER="$(sed -n 's/^SLEUTH_PROD_USER=//p' ~/secrets/sleuth/vultr-sleuth-production.env)"
SSHPASS="$(sed -n 's/^SLEUTH_PROD_PASS=//p' ~/secrets/sleuth/vultr-sleuth-production.env)"
export SSHPASS
sshpass -e ssh -o StrictHostKeyChecking=accept-new \
  -o PubkeyAuthentication=no -o PreferredAuthentications=password \
  "$SLEUTH_PROD_USER@$SLEUTH_PROD_HOST" '<command>'
```

`PubkeyAuthentication=no` is required. Without it, ssh tries the local `id_ed25519` key first,
the server rejects it, and `sshpass` never gets a turn.

### Web API Access

The app exposes a Web API on port 2020 for workspace management:
- **Base URL**: `http://your-server-ip:2020`
- **Authentication**: Bearer token required
- **Endpoints**: See `docs/web-api.md`

For reminder export integrations, the primary endpoint is:

```bash
curl -H "Authorization: Bearer $WEB_API_BEARER_TOKEN" \
  "http://your-server-ip:2020/workspace/neochrome/reminders?format=rebalance&activeOnly=true"
```

## Troubleshooting

### Common Issues

#### 1. DeployHQ SSH Connection Fails
- **Cause**: DeployHQ public key missing on the host, or wrong user/path
- **Solution**: Append DeployHQ’s public key to `/root/.ssh/authorized_keys`; path must be `/root/sleuth-app`. See [`docs/deployhq.md`](deployhq.md).

#### 2. Permission Denied Errors
- **Cause**: Incorrect file permissions
- **Solution**: Ensure the app tree is owned by root (DeployHQ path):
  ```bash
  chown -R root:root /root/sleuth-app
  chmod -R u+rwX,go-rwx /root/sleuth-app/data/runtime
  ```

#### 3. Service Fails to Start
- **Cause**: Missing workspace configuration or invalid credentials
- **Solution**: Check logs and verify workspace configuration:
  ```bash
  journalctl -u sleuth-app -n 50
  ```

#### 4. Git Authentication Issues (bootstrap / emergency pull)
- **Cause**: Incorrect git credentials
- **Solution**: Update credentials file:
  ```bash
  echo "https://your-email:your-token@github.com" > /root/.git-credentials
  chmod 600 /root/.git-credentials
  ```

### Log Locations

- **Application logs**: `journalctl -u sleuth-app`
- **System logs**: `/var/log/syslog`
- **DeployHQ**: deployment / build logs in the DeployHQ project UI

### Service Management

```bash
# Start/stop/restart service
systemctl start sleuth-app
systemctl stop sleuth-app
systemctl restart sleuth-app

# View status
systemctl status sleuth-app

# Enable/disable auto-start
systemctl enable sleuth-app
systemctl disable sleuth-app
```

## Security Considerations

### File Permissions
- Application files: owned by `root` (DeployHQ path)
- Runtime data (`data/runtime/`): root-only (`go-rwx`)
- SSH keys: `600` permissions for private keys

### Network Access
- **Port 2020**: Web API (consider firewall rules)
- **SSH access**: Prefer key-based authentication; add the DeployHQ deploy key for automated deploys

### Credentials Management
- Store sensitive credentials securely
- Rotate tokens regularly
- Use environment-specific credentials
- Never commit credentials to repository

## Manual Tasks Required

Some tasks still require manual intervention:

1. **Slack App Configuration**: Set up Slack app in your workspace
2. **OpenAI API Key**: Obtain and configure API key
3. **DNS/Domain Setup**: Configure domain if needed
4. **SSL/TLS**: Set up certificates for production
5. **Monitoring**: Configure monitoring and alerting
6. **Backup Strategy**: Implement data backup procedures
7. **DeployHQ**: Wire project + servers per [`docs/deployhq.md`](deployhq.md)

## Testing the Installation

### 1. Verify Service Status
```bash
systemctl status sleuth-app
```

### 2. Test Web API
```bash
curl -H "Authorization: Bearer $WEB_API_BEARER_TOKEN" http://localhost:2020/workspaces
```

### 3. Test DeployHQ
Trigger a deploy to **Development** from DeployHQ; confirm build + `scripts/deploy.sh` succeed.

### 4. Test Slack Integration
Send a message mentioning the bot in your configured channel.

## Next Steps

1. **Wire DeployHQ** for routine deploys ([`docs/deployhq.md`](deployhq.md))
2. **Configure monitoring** and log aggregation
3. **Set up backup** procedures for workspace data
4. **Configure SSL/TLS** for production environments
5. **Implement security hardening** measures

For additional help, refer to:
- Main documentation: `README.md`
- Deploy path: `docs/deployhq.md`
- API documentation: `docs/web-api.md`
- Coding conventions: `docs/coding-conventions.md`
