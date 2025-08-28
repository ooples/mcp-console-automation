# MCP Console Automation Server

A Model Context Protocol (MCP) server that enables AI assistants to fully interact with console applications, monitor output, detect errors, and automate terminal workflows - similar to how Playwright works for web browsers.

## Features

- **Full Terminal Control**: Create and manage multiple console sessions simultaneously
- **Interactive Input**: Send text input and special key sequences (Enter, Tab, Ctrl+C, etc.)
- **Real-time Output Monitoring**: Capture and analyze console output as it happens
- **Automatic Error Detection**: Built-in patterns to detect errors, exceptions, and stack traces
- **Session Management**: Create, stop, resize, and manage terminal sessions
- **Command Execution**: Run commands and wait for completion with timeout support
- **Pattern Matching**: Wait for specific output patterns before continuing
- **Cross-platform**: Works on Windows, macOS, and Linux

## Installation

### From npm (when published)
```bash
npm install -g @mcp/console-automation
```

### From source
```bash
git clone https://github.com/yourusername/mcp-console-automation.git
cd mcp-console-automation
npm install
npm run build
npm link
```

## Configuration

### For Claude Desktop

Add to your Claude Desktop configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "console-automation": {
      "command": "npx",
      "args": ["@mcp/console-automation"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### For other MCP clients

```bash
# Start the server
mcp-console --log-level info

# Or with npx
npx @mcp/console-automation --log-level info
```

## Available Tools

### `console_create_session`
Create a new console session for running commands.

**Parameters:**
- `command` (required): The command to execute
- `args`: Array of command arguments
- `cwd`: Working directory
- `env`: Environment variables object
- `detectErrors`: Enable automatic error detection (default: true)
- `timeout`: Session timeout in milliseconds

**Example:**
```json
{
  "command": "python",
  "args": ["script.py"],
  "cwd": "/path/to/project",
  "detectErrors": true
}
```

### `console_send_input`
Send text input to an active console session.

**Parameters:**
- `sessionId` (required): Session ID
- `input` (required): Text to send

### `console_send_key`
Send special key sequences to a console session.

**Parameters:**
- `sessionId` (required): Session ID
- `key` (required): Key to send (enter, tab, up, down, ctrl+c, escape, etc.)

### `console_get_output`
Retrieve output from a console session.

**Parameters:**
- `sessionId` (required): Session ID
- `limit`: Maximum number of output lines to return

### `console_wait_for_output`
Wait for specific output pattern in console.

**Parameters:**
- `sessionId` (required): Session ID
- `pattern` (required): Regex pattern to wait for
- `timeout`: Timeout in milliseconds (default: 5000)

### `console_execute_command`
Execute a command and wait for completion.

**Parameters:**
- `command` (required): Command to execute
- `args`: Command arguments
- `cwd`: Working directory
- `env`: Environment variables
- `timeout`: Execution timeout

### `console_detect_errors`
Analyze console output for errors and exceptions.

**Parameters:**
- `sessionId`: Session ID to analyze
- `text`: Direct text to analyze (if not using session)

### `console_stop_session`
Stop an active console session.

**Parameters:**
- `sessionId` (required): Session ID to stop

### `console_list_sessions`
List all active console sessions.

### `console_resize_session`
Resize terminal dimensions for a session.

**Parameters:**
- `sessionId` (required): Session ID
- `cols` (required): Number of columns
- `rows` (required): Number of rows

### `console_clear_output`
Clear the output buffer for a session.

**Parameters:**
- `sessionId` (required): Session ID

## Use Cases

### 1. Running and monitoring a development server
```javascript
// Create a session for the dev server
const session = await console_create_session({
  command: "npm",
  args: ["run", "dev"],
  detectErrors: true
});

// Wait for server to start
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: "Server running on",
  timeout: 10000
});

// Monitor for errors
const errors = await console_detect_errors({
  sessionId: session.sessionId
});
```

### 2. Interactive debugging session
```javascript
// Start a Python debugging session
const session = await console_create_session({
  command: "python",
  args: ["-m", "pdb", "script.py"]
});

// Set a breakpoint
await console_send_input({
  sessionId: session.sessionId,
  input: "b main\n"
});

// Continue execution
await console_send_input({
  sessionId: session.sessionId,
  input: "c\n"
});

// Step through code
await console_send_key({
  sessionId: session.sessionId,
  key: "n"
});
```

### 3. Automated testing with error detection
```javascript
// Run tests
const result = await console_execute_command({
  command: "pytest",
  args: ["tests/"],
  timeout: 30000
});

// Check for test failures
const errors = await console_detect_errors({
  text: result.output
});

if (errors.hasErrors) {
  console.log("Test failures detected:", errors);
}
```

### 4. Interactive CLI tool automation
```javascript
// Start an interactive CLI tool
const session = await console_create_session({
  command: "mysql",
  args: ["-u", "root", "-p"]
});

// Enter password
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: "Enter password:"
});

await console_send_input({
  sessionId: session.sessionId,
  input: "mypassword\n"
});

// Run SQL commands
await console_send_input({
  sessionId: session.sessionId,
  input: "SHOW DATABASES;\n"
});
```

## Error Detection Patterns

The server includes built-in patterns for detecting common error types:

- Generic errors (error:, ERROR:, Error:)
- Exceptions (Exception:, exception)
- Warnings (Warning:, WARNING:)
- Fatal errors
- Failed operations
- Permission/access denied
- Timeouts
- Stack traces (Python, Java, Node.js)
- Compilation errors
- Syntax errors
- Memory errors
- Connection errors

## Development

### Building from source
```bash
npm install
npm run build
```

### Running in development mode
```bash
npm run dev
```

### Running tests
```bash
npm test
```

### Type checking
```bash
npm run typecheck
```

### Linting
```bash
npm run lint
```

## Architecture

The server is built with:
- **node-pty**: For creating and managing pseudo-terminals
- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **TypeScript**: For type safety and better developer experience
- **Winston**: For structured logging

### Core Components

1. **ConsoleManager**: Manages terminal sessions, input/output, and lifecycle
2. **ErrorDetector**: Analyzes output for errors and exceptions
3. **MCP Server**: Exposes console functionality through MCP tools
4. **Session Management**: Handles multiple concurrent console sessions

## Requirements

- Node.js >= 18.0.0
- Windows, macOS, or Linux operating system
- Python (for node-pty compilation on some systems)

## Troubleshooting

### Installation Issues

If you encounter issues during installation, especially with `node-pty`:

**Windows:**
```bash
npm install --global windows-build-tools
```

**macOS:**
```bash
xcode-select --install
```

**Linux:**
```bash
sudo apt-get install build-essential python
```

### Common Issues

1. **Permission denied errors**: Ensure the server has permission to spawn processes
2. **node-pty compilation errors**: Install build tools for your platform
3. **Session not responding**: Check if the command requires TTY interaction
4. **Output not captured**: Some applications may write directly to terminal, bypassing stdout

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Support

For issues, questions, or suggestions, please open an issue on GitHub:
https://github.com/yourusername/mcp-console-automation/issues

## Roadmap

- [ ] Add support for terminal recording and playback
- [ ] Implement session persistence and recovery
- [ ] Add more error detection patterns for specific languages
- [ ] Support for terminal multiplexing (tmux/screen integration)
- [ ] Web-based terminal viewer
- [ ] Session sharing and collaboration features
- [ ] Performance profiling tools
- [ ] Integration with popular CI/CD systems