#!/bin/bash

# Sleuth App Server Installation Script
# For Ubuntu/Debian servers
# Default: DeployHQ-ready install (no GitHub Actions runner).
# Legacy: DEPLOY_METHOD=github-actions installs a self-hosted runner.

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration variables
NODE_VERSION="18.20.4"
RUNNER_VERSION="2.325.0"
APP_USER="root"
# Overridable, to match deploy/reminders-export/install.sh which already honours SLEUTH_APP_DIR.
APP_DIRECTORY="${SLEUTH_APP_DIR:-/root/sleuth-app}"
RUNNER_USER="github-runner"
RUNNER_HOME="/home/${RUNNER_USER}"
RUNNER_DIRECTORY="${RUNNER_HOME}/actions-runner"
# deployhq (default) | github-actions (legacy self-hosted runner)
DEPLOY_METHOD="${DEPLOY_METHOD:-deployhq}"

# Function to check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Function to validate inputs
validate_inputs() {
    log_info "Validating required inputs..."

    if [[ -z "$GITHUB_TOKEN" ]]; then
        log_error "GITHUB_TOKEN environment variable is required"
        exit 1
    fi

    if [[ -z "$GITHUB_REPO" ]]; then
        log_error "GITHUB_REPO environment variable is required (format: owner/repo)"
        exit 1
    fi

    if [[ -z "$SERVER_ENV" ]]; then
        log_error "SERVER_ENV environment variable is required (experimental, development, production)"
        exit 1
    fi

    if [[ -z "$GIT_USER_NAME" ]]; then
        log_error "GIT_USER_NAME environment variable is required"
        exit 1
    fi

    if [[ -z "$GIT_USER_EMAIL" ]]; then
        log_error "GIT_USER_EMAIL environment variable is required"
        exit 1
    fi

    if [[ "$DEPLOY_METHOD" != "deployhq" && "$DEPLOY_METHOD" != "github-actions" ]]; then
        log_error "DEPLOY_METHOD must be 'deployhq' (default) or 'github-actions' (legacy)"
        exit 1
    fi

    log_success "All required inputs validated (DEPLOY_METHOD=${DEPLOY_METHOD})"
}

# Function to update system packages
update_system() {
    log_info "Updating system packages..."
    apt-get update -y
    apt-get upgrade -y
    apt-get install -y curl wget git build-essential sudo
    log_success "System packages updated"
}

# Function to install Node.js
install_nodejs() {
    log_info "Installing Node.js ${NODE_VERSION}..."

    # Remove any existing Node.js
    apt-get remove -y nodejs npm 2>/dev/null || true

    # Install Node.js via NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs

    # Verify installation
    node_version=$(node --version)
    npm_version=$(npm --version)
    log_success "Node.js installed: ${node_version}, npm: ${npm_version}"
}

# Function to create github-runner user (legacy github-actions path only)
create_runner_user() {
    log_info "Creating github-runner user..."

    if id "${RUNNER_USER}" &>/dev/null; then
        log_warning "User ${RUNNER_USER} already exists"
    else
        useradd -m -s /bin/bash "${RUNNER_USER}"
        log_success "User ${RUNNER_USER} created"
    fi

    # Add to sudo group for deployment tasks
    usermod -aG sudo "${RUNNER_USER}"

    # Configure sudo without password for specific commands
    cat > /etc/sudoers.d/github-runner << EOF
${RUNNER_USER} ALL=(ALL) NOPASSWD: /bin/systemctl start sleuth-app
${RUNNER_USER} ALL=(ALL) NOPASSWD: /bin/systemctl stop sleuth-app
${RUNNER_USER} ALL=(ALL) NOPASSWD: /bin/systemctl restart sleuth-app
${RUNNER_USER} ALL=(ALL) NOPASSWD: /bin/systemctl reload sleuth-app
${RUNNER_USER} ALL=(ALL) NOPASSWD: /bin/systemctl status sleuth-app
${RUNNER_USER} ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
EOF

    log_success "GitHub runner user configured with sudo permissions"
}

# Function to install GitHub Actions runner (legacy)
install_github_runner() {
    log_info "Installing GitHub Actions runner..."

    # Create runner directory
    sudo -u "${RUNNER_USER}" mkdir -p "${RUNNER_DIRECTORY}"
    cd "${RUNNER_DIRECTORY}"

    # Download and extract runner
    local runner_url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
    sudo -u "${RUNNER_USER}" wget -O "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" "${runner_url}"
    sudo -u "${RUNNER_USER}" tar xzf "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

    # Install dependencies
    ./bin/installdependencies.sh

    log_success "GitHub Actions runner downloaded and extracted"
}

# Function to configure GitHub Actions runner (legacy)
configure_github_runner() {
    log_info "Configuring GitHub Actions runner..."

    cd "${RUNNER_DIRECTORY}"

    # Get registration token
    local reg_token_response=$(curl -s -X POST \
        -H "Authorization: token ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/${GITHUB_REPO}/actions/runners/registration-token")

    local reg_token=$(echo "${reg_token_response}" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

    if [[ -z "$reg_token" ]]; then
        log_error "Failed to get registration token from GitHub"
        log_error "Response: ${reg_token_response}"
        exit 1
    fi

    # Configure runner
    local runner_name="${GITHUB_REPO##*/}-${SERVER_ENV}"
    sudo -u "${RUNNER_USER}" ./config.sh \
        --url "https://github.com/${GITHUB_REPO}" \
        --token "${reg_token}" \
        --name "${runner_name}" \
        --labels "${SERVER_ENV}" \
        --work "_work" \
        --unattended

    # Install as service
    sudo ./svc.sh install "${RUNNER_USER}"
    sudo ./svc.sh start

    log_success "GitHub Actions runner configured and started"
}

# Function to clone and setup application
setup_application() {
    log_info "Setting up Sleuth application..."

    # Clone repository
    if [[ -d "$APP_DIRECTORY" ]]; then
        log_warning "Application directory already exists, pulling latest changes..."
        cd "$APP_DIRECTORY"
        git pull origin main
    else
        git clone "https://github.com/${GITHUB_REPO}.git" "$APP_DIRECTORY"
        cd "$APP_DIRECTORY"
    fi

    # Configure git
    git config user.name "${GIT_USER_NAME}"
    git config user.email "${GIT_USER_EMAIL}"

    # Set up git credentials
    cat > /root/.git-credentials << EOF
https://${GIT_USER_EMAIL}:${GITHUB_TOKEN}@github.com
EOF
    chmod 600 /root/.git-credentials
    git config --global credential.helper "store --file=/root/.git-credentials"

    # Install npm dependencies
    npm ci --omit=dev

    log_success "Application cloned and dependencies installed"
}

# Function to configure permissions (legacy github-actions path)
configure_permissions() {
    log_info "Configuring permissions for github-runner..."

    # Make /root accessible to github-runner
    chmod 755 /root

    # Set group ownership for app directory
    chown -R root:${RUNNER_USER} "$APP_DIRECTORY"
    chmod -R g+rX "$APP_DIRECTORY"
    chmod -R g+w "$APP_DIRECTORY"

    # Configure git permissions specifically
    chown -R root:${RUNNER_USER} "${APP_DIRECTORY}/.git"
    chmod -R g+w "${APP_DIRECTORY}/.git"

    # Make git credentials readable by github-runner
    chmod 644 /root/.git-credentials

    # Configure github-runner git settings
    sudo -u "${RUNNER_USER}" git config --global user.name "${GIT_USER_NAME}"
    sudo -u "${RUNNER_USER}" git config --global user.email "${GIT_USER_EMAIL}"
    sudo -u "${RUNNER_USER}" git config --global credential.helper "store --file=/root/.git-credentials"
    sudo -u "${RUNNER_USER}" git config --global --add safe.directory "$APP_DIRECTORY"

    # Create npm cache directory with proper permissions
    mkdir -p /root/.npm
    chown -R ${RUNNER_USER}:${RUNNER_USER} /root/.npm

    log_success "Permissions configured"
}

# Function to setup systemd service
setup_systemd_service() {
    log_info "Setting up systemd service..."

    # Copy service file and enable
    cp "${APP_DIRECTORY}/sleuth-app.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable sleuth-app

    # Create runtime directories
    mkdir -p "${APP_DIRECTORY}/data/runtime/workspaces"
    if [[ "$DEPLOY_METHOD" == "github-actions" ]]; then
        chown -R root:${RUNNER_USER} "${APP_DIRECTORY}/data/runtime"
        chmod -R g+w "${APP_DIRECTORY}/data/runtime"
    else
        chown -R root:root "${APP_DIRECTORY}/data/runtime"
        chmod -R u+rwX,go-rwx "${APP_DIRECTORY}/data/runtime"
    fi

    log_success "Systemd service configured"
}

# Function to generate SSH keys for server management
setup_ssh_keys() {
    log_info "Setting up SSH keys..."

    local ssh_key_name="sleuth-${SERVER_ENV}-server"
    local ssh_key_path="/root/.ssh/${ssh_key_name}"

    # Generate SSH key if it doesn't exist
    if [[ ! -f "${ssh_key_path}" ]]; then
        ssh-keygen -t ed25519 -f "${ssh_key_path}" -C "${ssh_key_name}" -N ""
        log_success "SSH key generated: ${ssh_key_path}"
        log_info "Public key content:"
        cat "${ssh_key_path}.pub"
    else
        log_warning "SSH key already exists: ${ssh_key_path}"
    fi
}

# Function to display completion information
display_completion_info() {
    log_success "==================================="
    log_success "Installation completed successfully!"
    log_success "==================================="
    echo
    log_info "Next steps:"
    echo "1. Register a workspace via the Web API (preferred) — see docs/web-api.md"
    echo "   or create a JSON file under:"
    echo "   ${APP_DIRECTORY}/data/runtime/workspaces/[workspace-name]_workspace.json"
    echo
    echo "2. Start the application:"
    echo "   systemctl start sleuth-app"
    echo
    echo "3. Check application status:"
    echo "   systemctl status sleuth-app"
    echo
    echo "4. View logs:"
    echo "   journalctl -u sleuth-app --follow"
    echo
    if [[ "$DEPLOY_METHOD" == "deployhq" ]]; then
        echo "5. Wire DeployHQ to this host (SSH key + post-deploy scripts/deploy.sh):"
        echo "   see docs/deployhq.md"
        echo
        log_info "Deploy method: DeployHQ (no GitHub Actions runner installed)"
    else
        echo "5. For legacy GitHub Actions deployment, ensure the workflow uses:"
        echo "   runs-on: [self-hosted, ${SERVER_ENV}]"
        echo
        log_info "GitHub Actions runner is installed and ready for deployments"
    fi
    log_info "Application directory: ${APP_DIRECTORY}"
    log_info "Web API will be available on port 2020 when started"
}

# Main installation function
main() {
    log_info "Starting Sleuth App installation on $(hostname)..."
    log_info "Environment: ${SERVER_ENV}"
    log_info "Repository: ${GITHUB_REPO}"
    log_info "Deploy method: ${DEPLOY_METHOD}"

    check_root
    validate_inputs
    update_system
    install_nodejs

    if [[ "$DEPLOY_METHOD" == "github-actions" ]]; then
        create_runner_user
        install_github_runner
        configure_github_runner
    else
        log_info "Skipping GitHub Actions runner install (DEPLOY_METHOD=deployhq)"
    fi

    setup_application

    if [[ "$DEPLOY_METHOD" == "github-actions" ]]; then
        configure_permissions
    fi

    setup_systemd_service
    setup_ssh_keys
    display_completion_info
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
