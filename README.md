# Console Automation MCP Server

Model Context Protocol (MCP) server for controlled interaction with local console applications and remote SSH sessions, including output monitoring, error detection, and long-running workflows.

[![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)](https://github.com/ooples/mcp-console-automation)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

## Security status

This server can execute arbitrary commands and open remote SSH sessions. Treat it like a privileged terminal, not a low-risk documentation connector:

- keep MCP tool approvals enabled for command/session mutations;
- prefer SSH keys or environment-variable credential references over inline secrets;
- use a restricted deployment account and a separate production approval step;
- leave `MCP_DEBUG_LOG` and `MCP_LOG_DIR` unset unless diagnostics are explicitly required;
- leave session persistence disabled unless recovery metadata is explicitly required;
- install cloud, container, and serial integrations only when needed.

## Features

### 🚀 Core Capabilities

- **Full Terminal Control**: Create and manage up to 50 concurrent console sessions
- **Multi-Protocol Support**: Local shells (cmd, PowerShell, pwsh, bash, zsh, sh) and remote SSH connections
- **Interactive Input**: Send text input and special key sequences (Enter, Tab, Ctrl+C, etc.)
- **Real-time Output Monitoring**: Capture, filter, and analyze console output with advanced search
- **Streaming Support**: Efficient streaming for long-running processes with pattern matching
- **Automatic Error Detection**: Built-in patterns to detect errors, exceptions, and stack traces across languages
- **Cross-platform**: Works on Windows, macOS, and Linux without native dependencies

### 🔐 SSH & Remote Connections

- **Full SSH Support**: Password and key-based authentication with passphrase support
- **SSH Options**: Custom ports, connection timeouts, keep-alive settings
- **Connection Profiles**: Save reusable SSH metadata and environment-variable credential references
- **Cloud Platform Support**: Azure, AWS, GCP, Kubernetes connections via saved profiles
- **Container Support**: Docker and WSL integration for containerized workflows

### ✅ Test Automation Framework

- **Automated Test Cases**: Built-in assertion tools for console output validation
- **Output Assertions**: Verify output contains, matches regex, or equals expected values
- **Exit Code Validation**: Assert command exit codes for success/failure detection
- **Error-Free Validation**: Automatically check for errors in command output
- **State Snapshots**: Save and compare session states before/after operations
- **Test Workflows**: Chain assertions for comprehensive testing scenarios

### 🔄 Background Job Execution

- **Async Command Execution**: Run long-running commands in background with full output capture
- **Priority Queue System**: Prioritize jobs (1-10 scale) for optimal resource utilization
- **Job Monitoring**: Track status, progress, and completion of background jobs
- **Job Control**: Cancel, pause, or resume background operations
- **Result Retrieval**: Get complete output and exit codes from completed jobs
- **Resource Management**: Automatic cleanup of completed jobs with configurable retention

### 📊 Enterprise Monitoring & Alerts

- **System-Wide Metrics**: CPU, memory, disk, and network usage tracking
- **Session Metrics**: Per-session performance monitoring and resource consumption
- **Real-time Dashboards**: Live monitoring data with customizable views
- **Alert System**: Performance, error, security, and anomaly alerts with severity levels
- **Custom Monitoring**: Configure monitoring intervals, metrics, and thresholds per session
- **Diagnostics**: Built-in error analysis and session health validation

### 📁 Profile Management

- **Connection Profiles**: Save SSH, Docker, WSL, and cloud platform connections
- **Application Profiles**: Store common command configurations (Node.js, Python, .NET, Java, Go, Rust)
- **Quick Connect**: Instantly connect using saved profiles with override support
- **Environment Variables**: Store environment configurations per profile
- **Working Directory Management**: Set default directories for each profile

### 🔍 Advanced Output Processing

- **Regex Filtering**: Search output with regular expressions (case-sensitive/insensitive)
- **Multi-Pattern Search**: Combine multiple patterns with AND/OR logic
- **Pagination**: Get specific line ranges, head, or tail of output
- **Time-based Filtering**: Filter output by timestamp (absolute or relative: '5m', '1h', '2d')
- **Output Streaming**: Real-time output capture for long-running processes
- **Buffer Management**: Clear output buffers to reduce memory usage

## Quick Installation

### Windows
```powershell
git clone https://github.com/ooples/mcp-console-automation.git
cd mcp-console-automation
.\install.ps1 -Target codex
```

### macOS/Linux
```bash
git clone https://github.com/ooples/mcp-console-automation.git
cd mcp-console-automation
chmod +x install.sh
./install.sh --target codex
```

### Manual Installation
```bash
git clone https://github.com/ooples/mcp-console-automation.git
cd mcp-console-automation
npm ci
npm run build
codex mcp add console-automation --env LOG_LEVEL=warn -- node "$PWD/dist/mcp/server.js"
```

## Configuration

Codex stores MCP configuration in `~/.codex/config.toml`. The installers use `codex mcp add` and safely replace an existing `console-automation` registration. Restart Codex after installation and use `/mcp` to verify the connection.

For another MCP client, generate a new JSON configuration without overwriting an existing file:

```powershell
.\install.ps1 -Target custom -CustomPath C:\path\to\new-mcp-config.json
```

The npm package has not been published, so `npx console-automation-mcp` and `@mcp/console-automation` are not valid installation paths.

### Saved SSH credentials

`console_save_profile` rejects inline passwords, private-key material, and passphrases. Use `passwordEnvVar`, `privateKeyEnvVar` or `privateKeyPath`, and `passphraseEnvVar`. Profile-list responses never return credential values, and configuration files are created with owner-only permissions where the operating system supports POSIX modes.

### Session persistence

Session persistence is disabled by default because session recovery data can include commands, paths, and environment values. To opt in, set `MCP_SESSION_PERSISTENCE=true`. The default file is `~/.console-automation-mcp/sessions.json`; override it with `MCP_SESSION_PERSISTENCE_PATH`. Persisted command/environment recovery data remains disabled unless enabled through the programmatic `SessionManager` configuration.

The production installers remove development and optional protocol packages. Local consoles and SSH remain available. Install only the peer packages required for Docker, cloud, Kubernetes, serial, or other optional adapters.

## Available Tools (40 Total)

This MCP server provides **40 comprehensive tools** organized into 6 categories:

### 📚 Complete Documentation

- **[Complete Tools Reference](docs/TOOLS.md)** - Detailed documentation for all 40 tools
- **[Practical Examples](docs/EXAMPLES.md)** - Real-world usage examples and patterns
- **[Publishing Guide](PUBLISHING.md)** - How to list this server in registries

### Tool Categories

#### 🖥️ Session Management (9 tools)
- `console_create_session` - Create local or SSH console sessions
- `console_send_input` - Send text input to sessions
- `console_send_key` - Send special keys (Enter, Ctrl+C, etc.)
- `console_get_output` - Get filtered/paginated output with advanced search
- `console_get_stream` - Stream output from long-running processes
- `console_wait_for_output` - Wait for specific patterns
- `console_stop_session` - Stop sessions
- `console_list_sessions` - List all active sessions
- `console_cleanup_sessions` - Clean up inactive sessions

#### ⚡ Command Execution (6 tools)
- `console_execute_command` - Execute commands with output capture
- `console_detect_errors` - Analyze output for errors
- `console_get_resource_usage` - Get system resource stats
- `console_clear_output` - Clear output buffers
- `console_get_session_state` - Get session execution state
- `console_get_command_history` - View command history

#### 📊 Monitoring & Alerts (6 tools)
- `console_get_system_metrics` - Comprehensive system metrics
- `console_get_session_metrics` - Session-specific metrics
- `console_get_alerts` - Active monitoring alerts
- `console_get_monitoring_dashboard` - Real-time dashboard data
- `console_start_monitoring` - Start custom monitoring
- `console_stop_monitoring` - Stop monitoring

#### 📁 Profile Management (4 tools)
- `console_save_profile` - Save SSH/app connection profiles
- `console_list_profiles` - List saved profiles
- `console_remove_profile` - Remove profiles
- `console_use_profile` - Quick connect with saved profiles

#### 🔄 Background Jobs (9 tools)
- `console_execute_async` - Execute commands asynchronously
- `console_get_job_status` - Check job status
- `console_get_job_output` - Get job output
- `console_cancel_job` - Cancel running jobs
- `console_list_jobs` - List all background jobs
- `console_get_job_progress` - Monitor job progress
- `console_get_job_result` - Get complete job results
- `console_get_job_metrics` - Job execution statistics
- `console_cleanup_jobs` - Clean up completed jobs

#### ✅ Test Automation (6 tools)
- `console_assert_output` - Assert output matches criteria
- `console_assert_exit_code` - Assert exit codes
- `console_assert_no_errors` - Verify no errors occurred
- `console_save_snapshot` - Save session state snapshots
- `console_compare_snapshots` - Compare state differences
- `console_assert_state` - Assert session state

### Quick Start Examples

#### Create a Local Session
```javascript
const session = await console_create_session({
  command: "npm",
  args: ["run", "dev"],
  detectErrors: true
});
```

#### Connect via SSH
```javascript
const session = await console_create_session({
  command: "bash",
  consoleType: "ssh",
  sshOptions: {
    host: "example.com",
    username: "user",
    privateKeyPath: "~/.ssh/id_rsa"
  }
});
```

#### Run Tests with Assertions
```javascript
const session = await console_create_session({
  command: "npm",
  args: ["test"]
});

await console_assert_output({
  sessionId: session.sessionId,
  assertionType: "contains",
  expected: "All tests passed"
});
```

#### Background Job Execution
```javascript
const job = await console_execute_async({
  sessionId: session.sessionId,
  command: "npm run build",
  priority: 8
});

const status = await console_get_job_status({
  jobId: job.jobId
});
```

For more examples, see [docs/EXAMPLES.md](docs/EXAMPLES.md)

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
- **Node child processes and ssh2**: For local command execution and SSH sessions
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
- Optional serial-port integrations can require platform build tools.

## Testing

Run static validation, the build, MCP smoke tests, and the test suite:
```bash
npm run lint
npm run typecheck
npm run build
npm run test:mcp
npm run test:logger
npm run test:installer
npm run test:package
npm test
```

## Troubleshooting

### Common Issues

1. **Permission denied errors**: Ensure the server has permission to spawn processes
2. **Optional native dependency errors**: Install platform build tools only when enabling serial-port integrations
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
https://github.com/ooples/mcp-console-automation/issues

## Roadmap

- [ ] Add support for terminal recording and playback
- [ ] Implement session persistence and recovery
- [ ] Add more error detection patterns for specific languages
- [ ] Support for terminal multiplexing (tmux/screen integration)
- [ ] Web-based terminal viewer
- [ ] Session sharing and collaboration features
- [ ] Performance profiling tools
- [ ] Integration with popular CI/CD systems
