# SSH Access for AEGIS App Servers

## Quick Reference - Server Aliases

**USE THESE ALIASES, NOT RAW IP ADDRESSES:**

| Alias | IP | User | Purpose |
|-------|-----|------|---------|
| `sleuth-development` | 203.0.113.12 | root | Development/testing server |
| `sleuth-production` | 203.0.113.13 | root | Production server |
| `sleuth-experimental` | 203.0.113.11 | root | Experimental features |

## How to SSH

**ALWAYS use the alias, not the IP address:**

```bash
# Correct - use alias
ssh sleuth-development "command here"

# Wrong - will fail without password
ssh root@203.0.113.12 "command here"
```

## Common Operations

### Deploy (primary: DeployHQ)

Routine deploys go through **DeployHQ** — see [`docs/deployhq.md`](deployhq.md).
Do not rely on GitHub Actions for this public repo.

After DeployHQ uploads, the server runs:

```bash
bash /root/sleuth-app/scripts/deploy.sh
```

### Emergency manual deploy (fallback only)

```bash
ssh sleuth-development 'bash /root/sleuth-app/scripts/deploy.sh'
# Or restore files first, then:
ssh sleuth-development 'cd /root/sleuth-app && git pull origin BRANCH_NAME && bash scripts/deploy.sh'
```

### View Logs
```bash
ssh sleuth-development 'journalctl --unit=sleuth-app --lines=50 --no-pager'
```

### Follow Logs Live
```bash
ssh sleuth-development 'journalctl --unit=sleuth-app --follow'
```

### Check Service Status
```bash
ssh sleuth-development 'systemctl status sleuth-app'
```

### Restart Service
```bash
ssh sleuth-development 'systemctl restart sleuth-app'
```

### Check Disk Space
```bash
ssh sleuth-development 'df -h'
```

### View Runtime Data
```bash
ssh sleuth-development 'ls -la /root/sleuth-app/data/runtime/'
```

### Clear Lists Cache
```bash
ssh sleuth-development 'rm /root/sleuth-app/data/runtime/reminders/*_lists_cache.json'
```

## Full Deploy Sequence (emergency fallback)

Prefer DeployHQ. If you must deploy by hand:

```bash
# 1. Update code + restart via canonical script
ssh sleuth-development 'cd /root/sleuth-app && git pull origin BRANCH_NAME && bash scripts/deploy.sh'

# 2. Verify logs
ssh sleuth-development 'journalctl --unit=sleuth-app --lines=50 --no-pager'
```

## Why Aliases Work

SSH is configured with passwordless access using key-based authentication:
- Key file: `~/.ssh/sleuth_servers`
- Config file: `~/.ssh/config`

Each alias in `~/.ssh/config` specifies:
- The hostname/IP
- The username (root)
- The identity file (private key)
- Options for automatic key acceptance

## Troubleshooting

### "Permission denied" Error
You're probably using the raw IP instead of the alias:
```bash
# Wrong
ssh root@203.0.113.12

# Correct
ssh sleuth-development
```

### Connection Timeout
Check if the server is running and the IP hasn't changed.

### "Host key verification failed"
The server was rebuilt. Remove the old key:
```bash
ssh-keygen -R 203.0.113.12
```
Then reconnect using the alias.

## SSH Config Location

The SSH configuration is at `~/.ssh/config` and looks like:

```
Host sleuth-development
    HostName 203.0.113.12
    User root
    IdentityFile ~/.ssh/sleuth_servers
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new

Host sleuth-production
    HostName 203.0.113.13
    User root
    IdentityFile ~/.ssh/sleuth_servers
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new

Host sleuth-experimental
    HostName 203.0.113.11
    User root
    IdentityFile ~/.ssh/sleuth_servers
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
```
