#!/bin/bash

# macOS Local Installation Script for Sleuth App
# This script automates the setup of the development environment on a Mac.

# --- Color Codes for Output ---
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# --- Logging Functions ---
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

# --- Main Installation Functions ---

# Function to install Xcode Command Line Tools
install_xcode_tools() {
    log_info "Checking for Xcode Command Line Tools..."
    if ! xcode-select -p &>/dev/null; then
        log_info "Xcode Command Line Tools not found. Starting installation..."
        xcode-select --install
        # Pause the script until the user completes the installation
        read -p "Please complete the Xcode Command Line Tools installation and then press Enter to continue..."
    else
        log_success "Xcode Command Line Tools are already installed."
    fi
}

# Function to install Homebrew
install_homebrew() {
    log_info "Checking for Homebrew..."
    if ! command -v brew &>/dev/null; then
        log_info "Homebrew not found. Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add Homebrew to PATH for the current session
        eval "$(/opt/homebrew/bin/brew shellenv)"
        log_success "Homebrew installed successfully."
    else
        log_success "Homebrew is already installed."
    fi
}

# Function to install Node.js and Git
install_packages() {
    log_info "Installing Node.js v18 and Git using Homebrew..."
    brew install node@18 git
    log_success "Node.js and Git installed."
}

# Function to configure the shell environment for Node.js
configure_shell() {
    log_info "Configuring shell environment for Node.js..."
    local shell_config_file="$HOME/.zshrc"
    local node_path_export='export PATH="/opt/homebrew/opt/node@18/bin:$PATH"'

    # Check if the configuration already exists to avoid duplicates
    if grep -q "$node_path_export" "$shell_config_file"; then
        log_success "Shell is already configured for Node.js v18."
    else
        log_info "Adding Node.js v18 to your PATH in $shell_config_file."
        echo "" >> "$shell_config_file"
        echo "# Configure Node.js v18 for Sleuth App" >> "$shell_config_file"
        echo "$node_path_export" >> "$shell_config_file"
        echo 'export LDFLAGS="-L/opt/homebrew/opt/node@18/lib"' >> "$shell_config_file"
        echo 'export CPPFLAGS="-I/opt/homebrew/opt/node@18/include"' >> "$shell_config_file"
        log_warning "Please open a new terminal window after this script completes for changes to take effect."
    fi
}

# Function to clone the repository.
#
# Both the clone URL and the target directory are configurable. A hardcoded owner/name breaks
# for anyone installing from a fork or from a repo that has since moved org — which this one
# has. SLEUTH_DIR also lets you avoid colliding with an existing checkout.
SLEUTH_REPO_URL="${SLEUTH_REPO_URL:-}"
SLEUTH_DIR="${SLEUTH_DIR:-sleuth-app}"

clone_repo() {
    log_info "Cloning the Sleuth repository..."
    if [ -d "$SLEUTH_DIR" ]; then
        log_warning "A '$SLEUTH_DIR' directory already exists. Skipping clone."
    elif [ -z "$SLEUTH_REPO_URL" ]; then
        log_error "Set SLEUTH_REPO_URL to the repository to clone, e.g.:"
        log_error "  SLEUTH_REPO_URL=https://github.com/your-org/sleuth.git $0"
        exit 1
    else
        git clone "$SLEUTH_REPO_URL" "$SLEUTH_DIR"
        log_success "Repository cloned successfully."
    fi
}

# Function to install npm dependencies
install_dependencies() {
    log_info "Changing into the sleuth-app directory..."
    cd "$SLEUTH_DIR" || { log_error "Failed to enter $SLEUTH_DIR directory."; exit 1; }

    log_info "Installing npm dependencies. This may take a moment..."
    npm install
    log_success "Dependencies installed."
}

# --- Main Script Execution ---
main() {
    echo -e "${BLUE}==============================================${NC}"
    echo -e "${BLUE}  Sleuth App macOS Local Development Setup    ${NC}"
    echo -e "${BLUE}==============================================${NC}"
    echo

    install_xcode_tools
    install_homebrew
    install_packages
    configure_shell
    clone_repo
    install_dependencies

    echo
    echo -e "${GREEN}==============================================${NC}"
    echo -e "${GREEN}      Setup Complete! Next Steps:             ${NC}"
    echo -e "${GREEN}==============================================${NC}"
    echo
    echo "1.  Open a ${YELLOW}new terminal window${NC} to ensure the environment changes are loaded."
    echo "2.  Follow the instructions in the ${YELLOW}macos-install-guide.md${NC} guide to:"
    echo "    a. Create your Slack App and get your credentials."
    echo "    b. Customize the bot's name in the code."
    echo "    c. Run the app for the first time with ${YELLOW}npm run dev${NC}."
    echo "    d. Configure your workspace using the ${YELLOW}curl${NC} command."
    echo "    e. Restart the app to connect to Slack."
    echo
}

# Run the main function
main
