# Persistent MCP Server Solution

## Problem Solved
The MCP server was disconnecting frequently, requiring manual reconnection through the MCP menu. This was disruptive to workflow and prevented continuous automation.

## Solution Implemented
Created a persistent MCP server (`persistent-server.ts`) with:

### Key Features
1. **Automatic Reconnection**: Detects disconnections and automatically reconnects with exponential backoff
2. **Keepalive Heartbeat**: Sends periodic pings every 15 seconds to maintain connection
3. **Connection State Management**: Tracks connection state (connected/disconnected/reconnecting)
4. **Graceful Error Recovery**: Handles non-critical errors without crashing
5. **Session Persistence**: Maintains sessions across reconnections
6. **Health Monitoring**: Regular system health checks every 30 seconds

### Technical Details
- Extends the base `ConsoleAutomationServer` with persistence features
- Overrides process exit handlers to prevent unexpected shutdowns
- Implements exponential backoff for reconnection (1s → 2s → 4s → ... max 30s)
- Maximum of 10 reconnection attempts before requiring manual intervention
- Distinguishes between critical errors (requiring restart) and recoverable errors

## Installation

### Windows (PowerShell)
```powershell
.\install-mcp-persistent.ps1
```

### Linux/macOS
```bash
./install-mcp-persistent.sh
```

### Manual Installation
Update your Claude configuration file:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS/Linux: `~/.config/Claude/claude_desktop_config.json`

Replace the console-automation server configuration with:
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

## Testing

Run the persistent server directly:
```bash
npm run start:persistent
```

## Benefits
- **No more manual reconnections**: Server maintains connection automatically
- **Improved reliability**: Handles network interruptions gracefully
- **Better performance**: Keepalive prevents idle disconnections
- **Error resilience**: Recovers from non-critical errors without user intervention
- **Session continuity**: Active sessions preserved across reconnections

## Architecture

```
PersistentMCPServer
├── Connection Management
│   ├── Keepalive heartbeat (15s interval)
│   ├── Connection state tracking
│   └── Auto-reconnection with backoff
├── Error Handling
│   ├── Critical error detection
│   ├── Recovery strategies
│   └── Graceful degradation
├── Health Monitoring
│   ├── System health checks (30s interval)
│   ├── Session health tracking
│   └── Performance metrics
└── Cleanup & Shutdown
    ├── Graceful session closure
    ├── Resource cleanup
    └── State preservation
```

## Logs
The persistent server provides detailed logging:
- Connection state changes
- Reconnection attempts
- Health check results
- Error recovery actions
- Active session counts

Monitor logs with:
```bash
LOG_LEVEL=debug npm run start:persistent
```

## Troubleshooting

### Server not reconnecting
- Check maximum reconnection attempts (default: 10)
- Review logs for critical errors
- Verify network connectivity

### High memory usage
- Adjust `NODE_OPTIONS`: `--max-old-space-size=2048` (lower value)
- Check for memory leaks in active sessions

### Connection drops frequently
- Reduce keepalive interval (currently 15s)
- Check network stability
- Review firewall/proxy settings

## Future Improvements
- WebSocket support for more stable connections
- Connection pooling for multiple Claude instances
- Metrics dashboard for monitoring
- Automatic session recovery with state preservation
- Cloud-based relay for enhanced reliability