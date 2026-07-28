#!/bin/bash

# Quick Install Script for Sleuth App
# This script prompts for required information and runs the installation

set -e

echo "=================================="
echo "Sleuth App Quick Installation"
echo "=================================="
echo

# Function to prompt for input with validation
prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local is_secret="${3:-false}"
    local value=""
    
    while [[ -z "$value" ]]; do
        if [[ "$is_secret" == "true" ]]; then
            read -s -p "$prompt: " value
            echo
        else
            read -p "$prompt: " value
        fi
        
        if [[ -z "$value" ]]; then
            echo "This field is required. Please try again."
        fi
    done
    
    export "$var_name"="$value"
}

# Function to prompt for selection
prompt_selection() {
    local prompt="$1"
    local var_name="$2"
    local options=("${@:3}")
    local value=""
    
    echo "$prompt"
    for i in "${!options[@]}"; do
        echo "$((i+1)). ${options[i]}"
    done
    
    while [[ -z "$value" ]]; do
        read -p "Select option (1-${#options[@]}): " selection
        if [[ "$selection" =~ ^[0-9]+$ ]] && [[ "$selection" -ge 1 ]] && [[ "$selection" -le "${#options[@]}" ]]; then
            value="${options[$((selection-1))]}"
        else
            echo "Invalid selection. Please choose 1-${#options[@]}."
        fi
    done
    
    export "$var_name"="$value"
}

echo "This script will install the Sleuth app with GitHub Actions runner."
echo "Please have your GitHub personal access token ready."
echo

# Collect required information
prompt_input "GitHub Personal Access Token" "GITHUB_TOKEN" "true"
prompt_input "GitHub Repository (format: owner/repo)" "GITHUB_REPO"
prompt_selection "Server Environment" "SERVER_ENV" "experimental" "development" "production"
prompt_input "Your Full Name (for git)" "GIT_USER_NAME"
prompt_input "Your Email Address" "GIT_USER_EMAIL"

echo
echo "Configuration Summary:"
echo "Repository: $GITHUB_REPO"
echo "Environment: $SERVER_ENV"
echo "Git User: $GIT_USER_NAME <$GIT_USER_EMAIL>"
echo "Token: $(echo $GITHUB_TOKEN | sed 's/./*/g')"
echo

read -p "Proceed with installation? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Installation cancelled."
    exit 0
fi

echo
echo "Starting installation..."

# Check if we're root
if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root. Please use sudo."
    exit 1
fi

# Download and run the main installation script.
#
# The repo slug is configurable because it is NOT stable: this project is published from a
# different org than it was developed in, and a hardcoded owner/name 404s the moment either
# changes — leaving a new user with a curl failure on step one and no idea why.
# Override with SLEUTH_REPO=owner/name (and SLEUTH_BRANCH) to install from a fork.
SLEUTH_REPO="${SLEUTH_REPO:-}"
SLEUTH_BRANCH="${SLEUTH_BRANCH:-main}"

if [ -z "$SLEUTH_REPO" ]; then
    echo "ERROR: set SLEUTH_REPO to the GitHub repo to install from, e.g.:"
    echo "  SLEUTH_REPO=hiqs-suite/aegis-sleuth-slack-bot $0"
    exit 1
fi

SCRIPT_URL="https://raw.githubusercontent.com/${SLEUTH_REPO}/${SLEUTH_BRANCH}/scripts/server-install.sh"
SCRIPT_FILE="/tmp/server-install.sh"

echo "Downloading installation script..."
curl -fsSL "$SCRIPT_URL" -o "$SCRIPT_FILE"
chmod +x "$SCRIPT_FILE"

echo "Running installation..."
"$SCRIPT_FILE"

echo
echo "Quick installation completed!"
echo
echo "Next steps:"
echo "1. Configure your workspace in /root/sleuth-app/data/runtime/workspaces/"
echo "2. Start the service: systemctl start sleuth-app"
echo "3. Check logs: journalctl -u sleuth-app --follow"