# Claude Code MCP Persistent Server Setup

## ✅ Configuration Complete

The persistent MCP server has been configured for **both Claude Desktop and Claude Code**. They share the same configuration file.

## Configuration Location
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS/Linux**: `~/.config/Claude/claude_desktop_config.json`

## What Was Configured

The `console-automation` MCP server has been updated to use the persistent server:

```json
"console-automation": {
  "command": "npx",
  "args": [
    "tsx",
    "C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\src\\mcp\\persistent-server.ts"
  ],
  "env": {
    "LOG_LEVEL": "info",
    "NODE_ENV": "production",
    "NODE_OPTIONS": "--max-old-space-size=4096"
  }
}
```

## Features Enabled

### 🔄 Auto-Reconnection
- Automatically reconnects when connection is lost
- Exponential backoff retry (1s → 2s → 4s → ... max 30s)
- Up to 10 reconnection attempts

### 💓 Keepalive Heartbeat
- Sends ping every 15 seconds to maintain connection
- Prevents idle timeouts
- Monitors connection health

### 🛡️ Error Recovery
- Handles non-critical errors without crashing
- Distinguishes between recoverable and critical errors
- Preserves sessions during recovery

### 📊 Health Monitoring
- System health checks every 30 seconds
- Session state tracking
- Performance monitoring

## How to Use with Claude Code

1. **No additional setup needed** - Configuration is already in place

2. **Restart Claude Code** (if it was running):
   ```bash
   # Just restart your terminal or VS Code
   # The next time you use Claude Code, it will use the persistent server
   ```

3. **Test the connection**:
   ```bash
   claude-code
   # Then in Claude Code, type:
   /mcp
   # You should see "console-automation" in the list
   ```

## Verify It's Working

When using Claude Code, you should no longer see disconnection issues. The MCP server will:
- Stay connected throughout your session
- Automatically reconnect if connection drops
- Maintain your active console sessions

## Troubleshooting

### If MCP still disconnects:

1. **Check server is running**:
   ```bash
   # Run directly to see logs
   cd C:\Users\yolan\source\repos\mcp-console-automation
   npx tsx src/mcp/persistent-server.ts
   ```

2. **Verify configuration**:
   ```bash
   # Check config file
   cat %APPDATA%\Claude\claude_desktop_config.json | grep -A 10 console-automation
   ```

3. **Check Claude Code version**:
   ```bash
   claude-code --version
   # Should be recent version
   ```

## Manual Test

You can manually test the persistent features:

```bash
# Start the server manually
cd C:\Users\yolan\source\repos\mcp-console-automation
npm run start:persistent

# You should see:
# - "Persistent MCP Console Automation Server started"
# - "Connection monitoring and auto-reconnection enabled"
# - "Keepalive heartbeat active (15s interval)"
```

## Benefits for Claude Code

- ✅ **No more `/mcp` reconnections needed**
- ✅ **Stable SSH connections** maintained across sessions
- ✅ **Background processes** continue running
- ✅ **Error recovery** without manual intervention
- ✅ **Better performance** with connection pooling

## Architecture

```
Claude Code
    ↓
[Shared MCP Config]
    ↓
Persistent MCP Server
    ├── Keepalive (15s)
    ├── Auto-reconnect
    ├── Health checks (30s)
    └── Session persistence
```

## Next Steps

Just use Claude Code normally! The persistent server will:
- Start automatically when Claude Code needs it
- Maintain connection throughout your session
- Handle any connection issues transparently
- Keep your console sessions active

No more manual reconnections needed! 🎉