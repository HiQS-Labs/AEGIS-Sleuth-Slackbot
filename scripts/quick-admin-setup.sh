#!/bin/bash
#
# Quick admin setup script.
# Generates encryption key, prompts for passwords, and configures admin-auth.json.
#
# Usage: bash scripts/quick-admin-setup.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
AUTH_FILE="$PROJECT_DIR/data/runtime/admin-auth.json"

echo ""
echo "=== Sleuth Admin Quick Setup ==="
echo ""

# check if admin-auth.json already exists.
if [ -f "$AUTH_FILE" ]; then
  echo "WARNING: $AUTH_FILE already exists."
  read -p "Overwrite existing config? (y/N): " OVERWRITE
  if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
  echo ""
fi

# step 1: generate or load encryption key.
if [ -f "$ENV_FILE" ] && grep -q "^ADMIN_ENCRYPTION_KEY=" "$ENV_FILE" 2>/dev/null; then
  ADMIN_ENCRYPTION_KEY=$(grep "^ADMIN_ENCRYPTION_KEY=" "$ENV_FILE" | head -1 | cut -d'=' -f2)
  if [ ${#ADMIN_ENCRYPTION_KEY} -eq 64 ]; then
    echo "Using existing ADMIN_ENCRYPTION_KEY from .env"
  else
    ADMIN_ENCRYPTION_KEY=""
  fi
fi

if [ -z "$ADMIN_ENCRYPTION_KEY" ]; then
  ADMIN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "Generated new ADMIN_ENCRYPTION_KEY"

  # write to .env (create or append).
  if [ -f "$ENV_FILE" ]; then
    # remove old key if present.
    grep -v "^ADMIN_ENCRYPTION_KEY=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  echo "ADMIN_ENCRYPTION_KEY=$ADMIN_ENCRYPTION_KEY" >> "$ENV_FILE"
  echo "Saved to $ENV_FILE"
fi

echo ""
export ADMIN_ENCRYPTION_KEY

# step 2: prompt for admin password.
while true; do
  read -s -p "Admin password (min 8 chars): " ADMIN_PASSWORD
  echo ""
  if [ ${#ADMIN_PASSWORD} -lt 8 ]; then
    echo "Password must be at least 8 characters."
    continue
  fi
  read -s -p "Confirm admin password: " ADMIN_PASSWORD_CONFIRM
  echo ""
  if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]; then
    echo "Passwords do not match."
    continue
  fi
  break
done

# step 3: prompt for Gmail App Password (optional).
echo ""
echo "Gmail SMTP setup (for password reset emails)."
echo "Press Enter to skip if you don't have a Gmail App Password yet."
read -s -p "Gmail App Password (16-char token, or Enter to skip): " GMAIL_APP_PASSWORD
echo ""

# step 4: prompt for admin base URL.
read -p "Admin base URL [http://localhost:2020]: " ADMIN_BASE_URL
ADMIN_BASE_URL=${ADMIN_BASE_URL:-http://localhost:2020}

# step 5: run node to create the config file.
if [ -z "$GMAIL_APP_PASSWORD" ]; then
  # no SMTP — create config without smtp block.
  node -e "
    const AdminAuth = require('./src/admin-auth');
    const fs = require('fs');
    const path = require('path');

    const PasswordData = AdminAuth.CreatePasswordHash(process.argv[1]);
    const Config = {
      adminEmail: 'devops@neochro.me',
      adminBaseUrl: process.argv[2].replace(/\/+\$/, ''),
      passwordHash: PasswordData.PasswordHash,
      passwordSalt: PasswordData.PasswordSalt
    };

    const ConfigPath = AdminAuth.GetConfigFilePath();
    const DirPath = path.dirname(ConfigPath);
    fs.mkdirSync(DirPath, { recursive: true });
    fs.writeFileSync(ConfigPath, JSON.stringify(Config, null, 2), 'utf8');
    console.log('Saved: ' + ConfigPath);
  " "$ADMIN_PASSWORD" "$ADMIN_BASE_URL"
else
  # with SMTP — create full config.
  node -e "
    const AdminAuth = require('./src/admin-auth');
    const fs = require('fs');
    const path = require('path');

    const PasswordData = AdminAuth.CreatePasswordHash(process.argv[1]);
    const EncryptedSmtpPass = AdminAuth.EncryptSecret(process.argv[2], process.env.ADMIN_ENCRYPTION_KEY);
    const Config = {
      adminEmail: 'devops@neochro.me',
      adminBaseUrl: process.argv[3].replace(/\/+\$/, ''),
      passwordHash: PasswordData.PasswordHash,
      passwordSalt: PasswordData.PasswordSalt,
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        authUser: 'devops@neochro.me',
        authPassEncrypted: EncryptedSmtpPass
      }
    };

    const ConfigPath = AdminAuth.GetConfigFilePath();
    const DirPath = path.dirname(ConfigPath);
    fs.mkdirSync(DirPath, { recursive: true });
    fs.writeFileSync(ConfigPath, JSON.stringify(Config, null, 2), 'utf8');
    console.log('Saved: ' + ConfigPath);
  " "$ADMIN_PASSWORD" "$GMAIL_APP_PASSWORD" "$ADMIN_BASE_URL"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Admin email:    devops@neochro.me"
echo "Admin base URL: $ADMIN_BASE_URL"
echo "SMTP:           $([ -z "$GMAIL_APP_PASSWORD" ] && echo 'skipped (run again to add later)' || echo 'configured')"
echo "Auth config:    $AUTH_FILE"
echo "Encryption key: $ENV_FILE"
echo ""
echo "Next steps:"
echo "  1. Start the app:  npm run dev"
echo "  2. Open admin UI:  $ADMIN_BASE_URL/admin/"
echo ""
