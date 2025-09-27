#!/bin/bash

# Install MCP Persistent Server Configuration for Claude
# This script sets up the persistent MCP server configuration

set -e

echo -e "\033[32mInstalling MCP Console Automation Persistent Server...\033[0m"

# Define paths
PROJECT_PATH="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_CONFIG_PATH="$HOME/.config/Claude/claude_desktop_config.json"
CLAUDE_CONFIG_DIR="$(dirname "$CLAUDE_CONFIG_PATH")"

# Create Claude config directory if it doesn't exist
if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
    mkdir -p "$CLAUDE_CONFIG_DIR"
    echo -e "\033[33mCreated Claude configuration directory\033[0m"
fi

# Create or update configuration
if [ -f "$CLAUDE_CONFIG_PATH" ]; then
    echo -e "\033[33mFound existing Claude configuration\033[0m"
    # Backup existing config
    cp "$CLAUDE_CONFIG_PATH" "$CLAUDE_CONFIG_PATH.backup"

    # Update existing config using Node.js
    node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CLAUDE_CONFIG_PATH', 'utf8'));

    if (!config.mcpServers) {
        config.mcpServers = {};
    }

    config.mcpServers['console-automation'] = {
        command: 'npx',
        args: [
            'tsx',
            '$PROJECT_PATH/src/mcp/persistent-server.ts'
        ],
        env: {
            LOG_LEVEL: 'info',
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=4096'
        }
    };

    fs.writeFileSync('$CLAUDE_CONFIG_PATH', JSON.stringify(config, null, 2));
    "
else
    # Create new config
    cat > "$CLAUDE_CONFIG_PATH" <<EOF
{
  "mcpServers": {
    "console-automation": {
      "command": "npx",
      "args": [
        "tsx",
        "$PROJECT_PATH/src/mcp/persistent-server.ts"
      ],
      "env": {
        "LOG_LEVEL": "info",
        "NODE_ENV": "production",
        "NODE_OPTIONS": "--max-old-space-size=4096"
      }
    }
  }
}
EOF
fi

echo -e "\n\033[32mConfiguration saved to: $CLAUDE_CONFIG_PATH\033[0m"
echo -e "\n\033[36mPersistent MCP server features:\033[0m"
echo -e "  - Automatic reconnection on disconnect"
echo -e "  - Keepalive heartbeat (15s interval)"
echo -e "  - Connection state monitoring"
echo -e "  - Graceful error recovery"
echo -e "  - Session persistence across reconnects"

echo -e "\n\033[32mInstallation complete!\033[0m"
echo -e "\033[33mPlease restart Claude Desktop for changes to take effect.\033[0m"

# Offer to test the server
read -p $'\nWould you like to test the persistent server now? (y/n): ' test_server
if [[ "$test_server" == "y" || "$test_server" == "Y" ]]; then
    echo -e "\n\033[36mStarting persistent server test...\033[0m"
    cd "$PROJECT_PATH"
    npx tsx src/mcp/persistent-server.ts
fi