#!/bin/bash

# MCP Console Automation Installer for Unix-like systems
# Supports: Claude Desktop, Google AI Studio, OpenAI Desktop, and custom MCP clients

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Functions for colored output
success() { echo -e "${GREEN}$1${NC}"; }
info() { echo -e "${CYAN}$1${NC}"; }
warning() { echo -e "${YELLOW}$1${NC}"; }
error() { echo -e "${RED}$1${NC}"; exit 1; }

# Parse arguments
TARGET="claude"
CUSTOM_PATH=""
DEV_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --target)
            TARGET="$2"
            shift 2
            ;;
        --custom-path)
            CUSTOM_PATH="$2"
            shift 2
            ;;
        --dev)
            DEV_MODE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --target [claude|google|openai|custom|all]  Target platform (default: claude)"
            echo "  --custom-path PATH                          Path for custom configuration"
            echo "  --dev                                       Run in development mode"
            echo "  --help                                      Show this help message"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

info "==================================================="
info "MCP Console Automation Server - Installer"
info "==================================================="

# Get installation directory
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check Node.js installation
info "\nChecking Node.js installation..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    success "✓ Node.js $NODE_VERSION found"
else
    error "✗ Node.js not found. Please install Node.js 18+ from https://nodejs.org"
fi

# Install dependencies
info "\nInstalling dependencies..."
cd "$INSTALL_DIR"
npm install --production

# Build TypeScript
info "Building TypeScript..."
npm run build

if [ ! -f "dist/index.js" ]; then
    error "✗ Build failed. dist/index.js not found"
fi

success "✓ Build completed successfully"

# Configuration functions
install_claude() {
    info "\nConfiguring for Claude Desktop..."
    
    local CONFIG_DIR=""
    local CONFIG_PATH=""
    
    case "$(uname -s)" in
        Darwin)
            CONFIG_DIR="$HOME/Library/Application Support/Claude"
            ;;
        Linux)
            CONFIG_DIR="$HOME/.config/Claude"
            ;;
        *)
            error "Unsupported OS for Claude Desktop"
            ;;
    esac
    
    CONFIG_PATH="$CONFIG_DIR/claude_desktop_config.json"
    
    mkdir -p "$CONFIG_DIR"
    
    if [ -f "$CONFIG_PATH" ]; then
        # Backup existing config
        cp "$CONFIG_PATH" "${CONFIG_PATH}.backup"
    fi
    
    # Create or update configuration
    if [ "$DEV_MODE" = true ]; then
        SERVER_COMMAND="npx"
        SERVER_ARGS='["tsx", "'$INSTALL_DIR'/src/index.ts"]'
    else
        SERVER_COMMAND="node"
        SERVER_ARGS='["'$INSTALL_DIR'/dist/index.js"]'
    fi
    
    # Use Python to safely update JSON
    python3 -c "
import json
import os

config_path = '$CONFIG_PATH'
config = {}

if os.path.exists(config_path):
    with open(config_path, 'r') as f:
        config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['console-automation'] = {
    'command': '$SERVER_COMMAND',
    'args': $SERVER_ARGS,
    'env': {
        'LOG_LEVEL': 'info'
    }
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
"
    
    success "✓ Claude Desktop configured at: $CONFIG_PATH"
    warning "  Please restart Claude Desktop for changes to take effect"
}

install_google() {
    info "\nConfiguring for Google AI Studio..."
    
    local CONFIG_DIR="$HOME/.config/google-ai-studio"
    local CONFIG_PATH="$CONFIG_DIR/mcp_config.json"
    
    mkdir -p "$CONFIG_DIR"
    
    python3 -c "
import json
import os

config_path = '$CONFIG_PATH'
config = {'servers': {}}

if os.path.exists(config_path):
    with open(config_path, 'r') as f:
        config = json.load(f)

config['servers']['console-automation'] = {
    'type': 'stdio',
    'command': 'node',
    'args': ['$INSTALL_DIR/dist/index.js'],
    'description': 'Console application automation and monitoring'
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
"
    
    success "✓ Google AI Studio configured at: $CONFIG_PATH"
}

install_openai() {
    info "\nConfiguring for OpenAI Desktop..."
    
    local CONFIG_DIR=""
    case "$(uname -s)" in
        Darwin)
            CONFIG_DIR="$HOME/Library/Application Support/OpenAI/desktop"
            ;;
        Linux)
            CONFIG_DIR="$HOME/.local/share/openai/desktop"
            ;;
        *)
            error "Unsupported OS for OpenAI Desktop"
            ;;
    esac
    
    local CONFIG_PATH="$CONFIG_DIR/mcp_servers.json"
    mkdir -p "$CONFIG_DIR"
    
    python3 -c "
import json
import os

config_path = '$CONFIG_PATH'
config = {'servers': []}

if os.path.exists(config_path):
    with open(config_path, 'r') as f:
        config = json.load(f)

# Remove existing entry if present
config['servers'] = [s for s in config.get('servers', []) if s.get('name') != 'console-automation']

config['servers'].append({
    'name': 'console-automation',
    'command': 'node',
    'args': ['$INSTALL_DIR/dist/index.js'],
    'type': 'stdio'
})

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
"
    
    success "✓ OpenAI Desktop configured at: $CONFIG_PATH"
}

install_custom() {
    info "\nConfiguring for custom MCP client..."
    
    if [ -z "$CUSTOM_PATH" ]; then
        warning "Please provide a config file path with --custom-path parameter"
        return
    fi
    
    local CONFIG_DIR="$(dirname "$CUSTOM_PATH")"
    mkdir -p "$CONFIG_DIR"
    
    info "Add the following to your MCP configuration:"
    cat << EOF
{
  "console-automation": {
    "command": "node",
    "args": ["$INSTALL_DIR/dist/index.js"],
    "env": {
      "LOG_LEVEL": "info"
    }
  }
}
EOF
    
    if [ -f "$CUSTOM_PATH" ]; then
        warning "\nConfiguration file exists at: $CUSTOM_PATH"
        warning "Please manually add the above configuration to avoid overwriting"
    else
        python3 -c "
import json

config = {
    'servers': {
        'console-automation': {
            'command': 'node',
            'args': ['$INSTALL_DIR/dist/index.js'],
            'env': {
                'LOG_LEVEL': 'info'
            }
        }
    }
}

with open('$CUSTOM_PATH', 'w') as f:
    json.dump(config, f, indent=2)
"
        success "✓ Configuration written to: $CUSTOM_PATH"
    fi
}

# Perform installation based on target
case "$TARGET" in
    claude)
        install_claude
        ;;
    google)
        install_google
        ;;
    openai)
        install_openai
        ;;
    custom)
        install_custom
        ;;
    all)
        install_claude
        install_google
        install_openai
        ;;
    *)
        error "Invalid target: $TARGET"
        ;;
esac

# Create test script
cat > "$INSTALL_DIR/test-server.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "Starting MCP Console Automation Server in development mode..."
npm run dev
EOF
chmod +x "$INSTALL_DIR/test-server.sh"

success "\n✓ Installation completed successfully!"
info "
Next steps:
1. Restart your MCP client ($TARGET)
2. The console-automation server should appear in available tools
3. Test with a simple command like 'echo Hello World'

Test the server: $INSTALL_DIR/test-server.sh

For documentation, visit: https://github.com/ooples/console-automation-mcp
"