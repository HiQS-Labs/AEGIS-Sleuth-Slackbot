# AEGIS App Server Installation Guide

This is the canonical deployment and SSH operations guide for AEGIS. Use this document as the
single source of truth for:

- first-time server installation
- routine deployments
- operator SSH access from this machine
- service locations and restart/logging commands

Other docs should link here instead of duplicating command blocks.

## Prerequisites

### Server Requirements
- Fresh Ubuntu 20.04+ or Debian 11+ server
- Root access (sudo privileges)
- Minimum 2GB RAM, 20GB disk space
- Internet connectivity

### Required Credentials and Information

Before starting, gather the following:

#### 1. GitHub Information
- **GitHub Personal Access Token** with permissions:
  - `repo` (Full control of private repositories)
  - `workflow` (Update GitHub Action workflows)
  - `admin:org` (if using organization repository)
- **Repository**: `owner/repository-name` (e.g., `your-org/sleuth`)
- **Branch**: Usually `main`, `development`, or `experimental`

#### 2. Git Configuration
- **Your full name** (for git commits)
- **Your email address** (must match GitHub account)

#### 3. Server Environment
- **Environment name**: `experimental`, `development`, or `production`

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
export GITHUB_REPO="your-org/sleuth"   # your fork/clone
export SERVER_ENV="experimental"  # or "development" or "production"
export GIT_USER_NAME="Your Full Name"
export GIT_USER_EMAIL="your.email@domain.com"
```

### Step 4: Run the Installation

```bash
./server-install.sh
```

The script will:
- Update system packages
- Install Node.js 18.20.4
- Create github-runner user with proper permissions
- Download and configure GitHub Actions runner
- Clone the repository
- Install npm dependencies
- Configure systemd service
- Set up permissions and git credentials
- Generate SSH keys for server management

### Step 5: Configure Workspace

After installation, you need to configure a workspace for Slack integration:

1. **Create workspace configuration file**:
   ```bash
   nano /root/sleuth-app/data/runtime/workspaces/your-workspace_workspace.json
   ```

2. **Add workspace configuration**:
   ```json
   {
     "WORKSPACE_NAME": "your-workspace",
     "ADMIN_EMAIL": "admin@yourcompany.com",
     "LIVE_TOKEN": "xoxb-your-bot-token",
     "LIVE_SIGNING_SECRET": "your-signing-secret",
     "LIVE_APP_TOKEN": "xapp-your-app-token",
     "OPENAI_API_KEY": "sk-your-openai-key",
    "REMINDER_CHANNEL_NAME": "general",
    "MAIN_TIMEZONE": "America/New_York",
    "SNOOZE_DAYS": ["Saturday", "Sunday"],
    "NOTION_TOKEN": "ntn_your-notion-token"
  }
  ```

`SNOOZE_DAYS` lists days when reminders are not posted unless they were scheduled manually.

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

## Post-Installation Configuration

## Routine Deployments

Subsequent deployments can be done by pulling the latest changes from the repository and restarting
the service:

```bash
systemctl stop sleuth-app   # stop the service before pulling the latest changes.
cd /root/sleuth-app         # change to the app directory.
git pull                    # pull the latest changes from the repository.
npm install                 # restore the dependencies.
systemctl daemon-reload     # reload the service configuration (in case it has changed).
systemctl start sleuth-app  # start the service.
```

We automate subsequent deployments using GitHub Actions. The workflow runs on a self-hosted runner
installed on the target machine, so `main` / `development` merges normally deploy without requiring
manual SSH.

### GitHub Actions Workflow

Ensure your `.github/workflows/deploy.yml` includes the correct runner label:

```yaml
jobs:
  deploy:
    runs-on: [self-hosted, experimental]  # Use your SERVER_ENV value
    steps:
      # Your deployment steps
```

### SSH Access Setup

The installation generates SSH keys for server management. To set up Claude Code access:

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

#### 1. GitHub Runner Registration Fails
- **Cause**: Invalid GitHub token or repository permissions
- **Solution**: Verify token has `repo` and `workflow` permissions

#### 2. Permission Denied Errors
- **Cause**: Incorrect file permissions
- **Solution**: Re-run permission configuration:
  ```bash
  chmod 755 /root
  chown -R root:github-runner /root/sleuth-app
  chmod -R g+w /root/sleuth-app
  ```

#### 3. Service Fails to Start
- **Cause**: Missing workspace configuration or invalid credentials
- **Solution**: Check logs and verify workspace configuration:
  ```bash
  journalctl -u sleuth-app -n 50
  ```

#### 4. Git Authentication Issues
- **Cause**: Incorrect git credentials
- **Solution**: Update credentials file:
  ```bash
  echo "https://your-email:your-token@github.com" > /root/.git-credentials
  chmod 600 /root/.git-credentials
  ```

### Log Locations

- **Application logs**: `journalctl -u sleuth-app`
- **GitHub runner logs**: `journalctl -u actions.runner.*`
- **System logs**: `/var/log/syslog`

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
- Application files: `root:github-runner` with group write access
- Git credentials: `600` permissions, readable by github-runner
- SSH keys: `600` permissions for private keys

### Network Access
- **Port 2020**: Web API (consider firewall rules)
- **SSH access**: Use key-based authentication only
- **GitHub Actions**: Uses HTTPS for repository access

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

## Testing the Installation

### 1. Verify Service Status
```bash
systemctl status sleuth-app
```

### 2. Test Web API
```bash
curl http://localhost:2020/workspaces
```

### 3. Test GitHub Actions
Push a commit to trigger deployment workflow.

### 4. Test Slack Integration
Send a message mentioning the bot in your configured channel.

## Next Steps

1. **Configure monitoring** and log aggregation
2. **Set up backup** procedures for workspace data
3. **Configure SSL/TLS** for production environments
4. **Implement security hardening** measures
5. **Document workspace-specific** configuration

For additional help, refer to:
- Main documentation: `README.md`
- API documentation: `docs/web-api.md`
- Coding conventions: `docs/coding-conventions.md`
