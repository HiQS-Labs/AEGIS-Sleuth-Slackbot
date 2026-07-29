# AEGIS App Installation Guide for macOS

> **Prefer the main path:** [docs/getting-started.md](docs/getting-started.md) is the canonical
> step-by-step guide for all platforms. This document adds macOS-specific notes (Homebrew, GitHub Desktop).

This guide provides step-by-step instructions to install the AEGIS Node.js application on a macOS machine, including common troubleshooting steps and instructions for using the GitHub Desktop application.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Install Xcode Command Line Tools](#step-1-install-xcode-command-line-tools)
3. [Step 2: Install Homebrew and Node.js](#step-2-install-homebrew-and-nodejs)
4. [Step 3: Download the Application using GitHub Desktop](#step-3-download-the-application-using-github-desktop)
5. [Step 4: Create and Configure the Slack App](#step-4-create-and-configure-the-slack-app)
6. [Step 5: Configure and Run the Application](#step-5-configure-and-run-the-application)
7. [Troubleshooting](#troubleshooting)
8. [How to Switch Branches for Testing](#how-to-switch-branches-for-testing-with-github-desktop)
9. [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)

## Prerequisites

  * A Mac running macOS.
  * Your GitHub account credentials.
  * An OpenAI API key (or Anthropic/Gemini — see [Getting Started](docs/getting-started.md#what-you-need-before-you-start)).
  * Steps 1–2 from [Getting Started](docs/getting-started.md) completed if you use the terminal path instead of GitHub Desktop.

## Step 1: Install Xcode Command Line Tools

Homebrew (the package manager we'll use) requires Apple's Command Line Tools. The standard installation can sometimes hang, so we recommend installing them manually to avoid this issue.

1.  **Go to Apple's Developer Website**: Open your browser and navigate to [developer.apple.com/download/all/](https://www.google.com/search?q=https://developer.apple.com/download/all/).
2.  **Sign in** with your Apple ID.
3.  **Search and Download**: In the search bar, type `Command Line Tools for Xcode`. Find the latest version compatible with your macOS and download the `.dmg` file.
4.  **Install the Package**: Open the downloaded `.dmg` file and run the installer (`.pkg`) inside. Follow the on-screen instructions.

## Step 2: Install Homebrew and Node.js

With the prerequisites installed, you can now install Homebrew and the necessary packages.

1.  **Open the Terminal** (found in `Applications/Utilities/Terminal`).

2.  **Install Homebrew** by pasting this command into your terminal:

    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```

3.  **Install Node.js**: The AEGIS app uses a specific version of Node.js. Use Homebrew to install it.

    ```bash
    brew install node@18
    ```

4.  **Configure Your Terminal for Node.js**: Homebrew installs `node@18` in a way that requires you to manually update your terminal's PATH. Run the following commands to do this:

    ```bash
    echo 'export PATH="/opt/homebrew/opt/node@18/bin:$PATH"' >> ~/.zshrc
    echo 'export LDFLAGS="-L/opt/homebrew/opt/node@18/lib"' >> ~/.zshrc
    echo 'export CPPFLAGS="-I/opt/homebrew/opt/node@18/include"' >> ~/.zshrc
    ```

    **Important**: Open a new terminal window or run `source ~/.zshrc` for these changes to take effect. Verify the correct version is active by running `node -v`, which should return `v18.x.x`.

## Step 3: Download the Application using GitHub Desktop

Using the GitHub Desktop app provides a user-friendly way to manage the source code.

1.  **Download and Install GitHub Desktop** from [desktop.github.com](https://desktop.github.com/).

2.  **Log in** to the app using your GitHub account credentials.

3.  **Clone the Repository**:

      * In GitHub Desktop, go to **File** \> **Clone Repository**.
      * Select your `sleuth` repository from the list or enter its URL.
      * Choose a local path where you want to save the project files.
      * Click **Clone**.

4.  **Navigate to the App Directory in Terminal**:

      * Open your terminal.
      * Type ` cd  ` (with a space after `cd`) and then drag the `sleuth-app` folder from your Finder into the terminal window. This will automatically paste the correct path. Press Enter.
        ```bash
        # Example command
        cd /path/to/your/sleuth-app
        ```

5.  **Install Dependencies**:

    ```bash
    npm install
    ```

## Step 4: Create and Configure the Slack App

You need to create a corresponding app in your Slack workspace to get the necessary credentials.

1.  **Create the App from Manifest**:

      * Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** \> **From an app manifest**.
      * Select your workspace.
      * In the JSON tab, paste the manifest content from the `README.md` file.

2.  **Important: Rename Your Test App**

      * To differentiate your local test version from a production copy running on the same Slack workspace, you **must** give it a unique name.
      * In the JSON manifest, change the `name` and `display_name` fields to something like `"AEGIS AI - [Your Name]"`. This prevents confusion and ensures you are testing the correct bot.

3.  **Install and Get Credentials**:

      * **Install the app** to your workspace.
      * You will now gather three different credentials from three different pages in the app's settings.

    **Credential 1: `LIVE_SIGNING_SECRET`**

      * Navigate to the **Basic Information** page.
      * Under the "App Credentials" panel, find and copy the **Signing Secret**.

    **Credential 2: `LIVE_TOKEN` (Bot User OAuth Token)**

      * Navigate to the **OAuth & Permissions** page in the left sidebar.
      * Copy the **Bot User OAuth Token** shown at the top of the page. It will start with `xoxb-`.

    **Credential 3: `LIVE_APP_TOKEN` (App-Level Token)**

      * Return to the **Basic Information** page.
      * Scroll down to the "App-Level Tokens" section and click the **Generate Token and Scopes** button.
      * Add the `connections:write` scope, give the token a name, and generate it.
      * Copy this token. It will start with `xapp-`.

## Step 5: Configure and Run the Application

1.  **Customize the Bot's Name in Code**:

      * To ensure your test bot identifies itself correctly in chat, open the following file in a text editor: `sleuth-app/data/static/ai/chat-instructions.md`.
      * Find the line: `- your name is \`AEGIS AI\`...\`
      * Change it to match the name you used in the manifest: `- your name is \`AEGIS AI - [Your Name]\`...\`

2.  **Start the Web API**:

    ```bash
    npm run dev
    ```

3.  **Configure Your Workspace**:

      * Open a **new terminal window** (leave the app running in the first one).
      * Use the `curl` command below to send your credentials to the app. **Replace all placeholder values** with your actual credentials.
        ```bash
        curl -X POST "http://localhost:2020/workspace" \
        -H "Authorization: Bearer $WEB_API_BEARER_TOKEN" \
        -H "Content-Type: application/json" -d '{
            "WORKSPACE_NAME": "your-workspace-name",
            "ADMIN_EMAIL": "your-email@example.com",
            "LIVE_TOKEN": "xoxb-YOUR-BOT-TOKEN-HERE",
            "LIVE_SIGNING_SECRET": "YOUR-SIGNING-SECRET-HERE",
            "LIVE_APP_TOKEN": "xapp-YOUR-APP-TOKEN-HERE",
            "OPENAI_API_KEY": "sk-YOUR-OPENAI-KEY-HERE",
            "REMINDER_CHANNEL_NAME": "general",
            "MAIN_TIMEZONE": "America/Los_Angeles"
        }'
        ```

4.  **Restart the Application**:

      * Go back to the first terminal window where the app is running.
      * Stop it by pressing `Ctrl+C`.
      * Restart it to load the new workspace:
        ```bash
        npm run dev
        ```

## Troubleshooting

#### Error: `Cannot find module 'newrelic'` (or any other module)

This error means a required package is missing. This can happen if `npm install` was interrupted or corrupted.

1.  **Stop the running app** (`Ctrl+C`).
2.  **Perform a clean installation**:
    ```bash
    # Remove old installation files to ensure a fresh start
    rm -rf node_modules package-lock.json

    # Clear the npm cache to resolve potential corruption
    npm cache clean --force

    # Re-install all packages from scratch
    npm install
    ```
3.  **Restart the app**:
    ```bash
    npm run dev
    ```

## How to Switch Branches for Testing with GitHub Desktop

1.  **Open the repository** in the GitHub Desktop app.
2.  At the top of the window, click on the **Current Branch** dropdown menu.
3.  You will see a list of all available branches. **Select the branch** you want to test (e.g., `development`).
4.  If the branch is new, GitHub Desktop may need to **fetch** it from the remote repository first.
5.  Once you've switched branches, go to your terminal (which should still be in the `sleuth-app` directory) and **re-install dependencies**, as they may have changed:
    ```bash
    npm install
    ```
6.  You can now run `npm run dev` to test the app from the new branch.

## Frequently Asked Questions (FAQ)

**Q: What happens to the app when my Mac goes to sleep?**
A: When your Mac sleeps, the AEGIS app's connection to Slack will be paused and may become unstable. It is best practice to stop the app (`Ctrl+C`) and restart it (`npm run dev`) after your computer wakes up to ensure a stable connection.

**Q: Do I need to run the `curl` command to configure the workspace every time I restart the app?**
A: No, you only need to do it once. The application saves your workspace configuration to a file in the `data/runtime/workspaces/` directory the first time you send it. On every subsequent start, the app loads the configuration from that file. You only need to use `curl` again if you want to update your credentials.

**Q: How can I create a clickable Dock icon to start the app easily?**
A: You can use macOS's built-in Script Editor to create a startup application.

1.  Open **Script Editor** (search for it in Spotlight).
2.  Paste the following AppleScript code, making sure to replace `/path/to/your/sleuth-app` with the correct path to your project folder.
    ```applescript
    tell application "Terminal"
        if not (exists window 1) then
            do script ""
        end if
        do script "cd /path/to/your/sleuth-app && npm run dev" in window 1
        activate
    end tell
    ```
3.  Go to **File \> Save**.
4.  Set the **File Format** to **Application**, give it a name like "Start AEGIS", and save it to your Applications folder.
5.  Drag your new "Start AEGIS" application from the Applications folder to your Dock. Now you can start the app with a single click.
