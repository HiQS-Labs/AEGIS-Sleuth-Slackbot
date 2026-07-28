#!/bin/bash

# SSH Setup Helper for Sleuth App Servers
# This script helps configure passwordless SSH access for Claude Code

set -e

echo "Sleuth SSH Setup Helper"
echo "======================"
echo ""

# Function to add SSH key to agent
setup_ssh_agent() {
    echo "Setting up SSH agent..."
    # Start ssh-agent if not running
    if ! pgrep -x "ssh-agent" > /dev/null; then
        eval "$(ssh-agent -s)"
    fi
    
    # Add the key to ssh-agent
    ssh-add ~/.ssh/sleuth_servers
    echo "SSH key added to agent."
}

# Function to copy SSH key to server
copy_key_to_server() {
    local server_alias=$1
    local server_host=$2
    local server_user=$3
    
    echo "Copying SSH key to $server_alias ($server_user@$server_host)..."
    
    # Copy the public key
    ssh-copy-id -i ~/.ssh/sleuth_servers.pub "$server_user@$server_host"
    
    # Add server to SSH config
    cat >> ~/.ssh/config << EOF

Host $server_alias
    HostName $server_host
    User $server_user
    IdentityFile ~/.ssh/sleuth_servers
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
    
    echo "Server $server_alias configured successfully!"
}

# Main menu
main() {
    echo "What would you like to do?"
    echo "1) Set up SSH agent"
    echo "2) Add a new server"
    echo "3) Test SSH connection"
    echo "4) Show current SSH config"
    echo "5) Exit"
    echo ""
    read -p "Enter your choice (1-5): " choice
    
    case $choice in
        1)
            setup_ssh_agent
            ;;
        2)
            read -p "Enter server alias (e.g., sleuth-prod): " alias
            read -p "Enter server hostname or IP: " host
            read -p "Enter username: " user
            copy_key_to_server "$alias" "$host" "$user"
            ;;
        3)
            read -p "Enter server alias to test: " alias
            echo "Testing connection to $alias..."
            ssh -o ConnectTimeout=5 "$alias" "echo 'SSH connection successful!'"
            ;;
        4)
            echo "Current SSH config:"
            echo "==================="
            cat ~/.ssh/config
            ;;
        5)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo "Invalid choice. Please try again."
            ;;
    esac
    
    echo ""
    read -p "Press Enter to continue..."
    clear
    main
}

# Check if SSH key exists
if [ ! -f ~/.ssh/sleuth_servers ]; then
    echo "ERROR: SSH key not found at ~/.ssh/sleuth_servers"
    echo "Please run: ssh-keygen -t ed25519 -f ~/.ssh/sleuth_servers -C 'sleuth-servers' -N ''"
    exit 1
fi

# Start the main menu
main