# MCP Console Automation - Complete Tools Reference

This document provides comprehensive documentation for all 40 tools available in the MCP Console Automation Server.

## Table of Contents

- [Session Management Tools](#session-management-tools) (9 tools)
- [Command Execution Tools](#command-execution-tools) (6 tools)
- [Monitoring Tools](#monitoring-tools) (6 tools)
- [Profile Management Tools](#profile-management-tools) (4 tools)
- [Background Job Tools](#background-job-tools) (9 tools)
- [Test Automation Tools](#test-automation-tools) (6 tools)
- [Quick Reference Table](#quick-reference-table)

---

## Session Management Tools

### `console_create_session`

Create a new console session for running commands locally or via SSH.

**Parameters:**
```typescript
{
  command: string;          // Command to execute (required)
  args?: string[];          // Command arguments
  cwd?: string;            // Working directory
  env?: object;            // Environment variables
  detectErrors?: boolean;  // Enable automatic error detection
  timeout?: number;        // Session timeout in ms
  consoleType?: 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh' | 'sh' | 'ssh' | 'auto';
  sshOptions?: {
    host: string;
    port?: number;        // Default: 22
    username: string;
    password?: string;
    privateKey?: string;  // Key content
    privateKeyPath?: string;
    passphrase?: string;
  };
  streaming?: boolean;    // Enable streaming for long-running processes
  monitoring?: object;    // Monitoring options
}
```

**Returns:**
```typescript
{
  sessionId: string;
  status: string;
  consoleType: string;
  // ... additional session details
}
```

**Example:**
```typescript
// Local session
await console_create_session({
  command: "npm",
  args: ["run", "build"],
  cwd: "/path/to/project",
  detectErrors: true
});

// SSH session
await console_create_session({
  command: "bash",
  consoleType: "ssh",
  sshOptions: {
    host: "example.com",
    username: "user",
    privateKeyPath: "~/.ssh/id_rsa"
  }
});
```

---

### `console_send_input`

Send text input to an interactive console session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
  input: string;      // Text to send (required)
}
```

**Example:**
```typescript
await console_send_input({
  sessionId: "session-123",
  input: "yes"
});
```

---

### `console_send_key`

Send special key sequences (Enter, Ctrl+C, etc.) to a console session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
  key: 'enter' | 'tab' | 'up' | 'down' | 'left' | 'right' |
       'escape' | 'backspace' | 'delete' | 'ctrl+c' | 'ctrl+d' |
       'ctrl+z' | 'ctrl+l' | 'ctrl+break';  // (required)
}
```

**Example:**
```typescript
// Submit input
await console_send_key({
  sessionId: "session-123",
  key: "enter"
});

// Interrupt process
await console_send_key({
  sessionId: "session-123",
  key: "ctrl+c"
});
```

---

### `console_get_output`

Get console output with advanced filtering, pagination, and search capabilities.

**Parameters:**
```typescript
{
  sessionId: string;         // Session ID (required)
  limit?: number;            // Max lines to return
  grep?: string;             // Regex pattern for filtering
  grepIgnoreCase?: boolean;  // Case-insensitive grep
  grepInvert?: boolean;      // Invert grep (exclude matches)
  tail?: number;             // Return last N lines
  head?: number;             // Return first N lines
  lineRange?: [number, number];  // [start, end] line numbers (1-indexed)
  since?: string;            // Filter by timestamp (ISO or relative: '5m', '1h', '2d')
  until?: string;            // Filter until timestamp
  multiPattern?: {
    patterns: string[];
    operator: 'AND' | 'OR';
    negate?: boolean;
  };
}
```

**Example:**
```typescript
// Get last 100 lines
await console_get_output({
  sessionId: "session-123",
  tail: 100
});

// Search for errors in last 5 minutes
await console_get_output({
  sessionId: "session-123",
  grep: "error|exception",
  grepIgnoreCase: true,
  since: "5m"
});

// Get lines 50-100
await console_get_output({
  sessionId: "session-123",
  lineRange: [50, 100]
});
```

---

### `console_get_stream`

Get streaming output from a long-running console session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

**Returns:** Real-time streaming output

**Example:**
```typescript
await console_get_stream({
  sessionId: "session-123"
});
```

---

### `console_wait_for_output`

Wait for specific output pattern to appear in console.

**Parameters:**
```typescript
{
  sessionId: string;   // Session ID (required)
  pattern: string;     // Pattern to wait for (required)
  timeout?: number;    // Wait timeout in ms
}
```

**Example:**
```typescript
// Wait for server to start
await console_wait_for_output({
  sessionId: "session-123",
  pattern: "Server listening on port 3000",
  timeout: 30000
});
```

---

### `console_stop_session`

Stop a console session and clean up resources.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

**Example:**
```typescript
await console_stop_session({
  sessionId: "session-123"
});
```

---

### `console_list_sessions`

List all active console sessions.

**Parameters:** None

**Returns:**
```typescript
{
  sessions: [{
    sessionId: string;
    command: string;
    status: string;
    startTime: string;
    consoleType: string;
    // ... more details
  }]
}
```

**Example:**
```typescript
await console_list_sessions();
```

---

### `console_cleanup_sessions`

Clean up inactive or stuck sessions.

**Parameters:**
```typescript
{
  maxAge?: number;   // Maximum age in ms
  force?: boolean;   // Force cleanup
}
```

**Example:**
```typescript
// Clean sessions older than 1 hour
await console_cleanup_sessions({
  maxAge: 3600000
});
```

---

## Command Execution Tools

### `console_execute_command`

Execute a command in an existing session or create a one-off session.

**Parameters:**
```typescript
{
  sessionId?: string;   // Session ID (optional for one-off commands)
  command: string;      // Command to execute (required)
  args?: string[];      // Command arguments
  timeout?: number;     // Execution timeout in ms
}
```

**Example:**
```typescript
// One-off command
await console_execute_command({
  command: "npm",
  args: ["test"],
  timeout: 60000
});

// In existing session
await console_execute_command({
  sessionId: "session-123",
  command: "ls -la"
});
```

---

### `console_detect_errors`

Analyze console output for errors and exceptions.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

**Returns:**
```typescript
{
  hasErrors: boolean;
  errors: [{
    type: string;
    message: string;
    lineNumber: number;
    severity: string;
  }]
}
```

**Example:**
```typescript
const result = await console_detect_errors({
  sessionId: "session-123"
});
console.log(`Found ${result.errors.length} errors`);
```

---

### `console_get_resource_usage`

Get resource usage statistics for all sessions.

**Parameters:** None

**Returns:** CPU, memory, and resource usage stats

**Example:**
```typescript
const usage = await console_get_resource_usage();
```

---

### `console_clear_output`

Clear the output buffer for a session to reduce memory usage.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

---

### `console_get_session_state`

Get the execution state of a console session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

**Returns:**
```typescript
{
  sessionId: string;
  status: 'running' | 'stopped' | 'error' | 'completed';
  exitCode?: number;
  // ... more state details
}
```

---

### `console_get_command_history`

Get command execution history for a session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

**Returns:**
```typescript
{
  history: [{
    command: string;
    timestamp: string;
    exitCode?: number;
  }]
}
```

---

## Monitoring Tools

### `console_get_system_metrics`

Get comprehensive system monitoring metrics.

**Parameters:** None

**Returns:**
```typescript
{
  cpu: {
    usage: number;
    cores: number;
    // ... more CPU metrics
  };
  memory: {
    used: number;
    free: number;
    total: number;
    // ... more memory metrics
  };
  disk: { ... };
  network: { ... };
}
```

---

### `console_get_session_metrics`

Get detailed metrics for a specific session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

**Returns:** Session-specific performance metrics

---

### `console_get_alerts`

Get current monitoring alerts.

**Parameters:** None

**Returns:**
```typescript
{
  alerts: [{
    type: 'performance' | 'error' | 'security' | 'anomaly';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: string;
  }]
}
```

---

### `console_get_monitoring_dashboard`

Get real-time monitoring dashboard data.

**Parameters:** None

**Returns:** Complete dashboard data with metrics, alerts, and system status

---

### `console_start_monitoring`

Start monitoring for a specific session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
  options?: {
    metrics: string[];
    interval: number;
    alerts: boolean;
  };
}
```

---

### `console_stop_monitoring`

Stop monitoring for a specific session.

**Parameters:**
```typescript
{
  sessionId: string;  // Session ID (required)
}
```

---

## Profile Management Tools

### `console_save_profile`

Save a connection or application profile for reuse.

**Parameters:**
```typescript
{
  profileType: 'connection' | 'application';  // (required)
  name: string;                                // (required)

  // Connection profile options
  connectionType?: 'ssh' | 'docker' | 'wsl' | 'azure' | 'aws' | 'gcp' | 'kubernetes';
  sshOptions?: { ... };
  dockerOptions?: { ... };

  // Application profile options
  applicationType?: 'node' | 'python' | 'dotnet' | 'java' | 'go' | 'rust' | 'custom';
  command?: string;
  args?: string[];
  workingDirectory?: string;
  environmentVariables?: object;
}
```

**Example:**
```typescript
// Save SSH profile
await console_save_profile({
  profileType: "connection",
  name: "prod-server",
  connectionType: "ssh",
  sshOptions: {
    host: "prod.example.com",
    username: "deploy",
    privateKeyPath: "~/.ssh/prod_key"
  }
});

// Save Node.js app profile
await console_save_profile({
  profileType: "application",
  name: "my-app",
  applicationType: "node",
  command: "npm",
  args: ["start"],
  workingDirectory: "/path/to/app"
});
```

---

### `console_list_profiles`

List all saved profiles.

**Parameters:** None

**Returns:**
```typescript
{
  profiles: [{
    name: string;
    type: string;
    // ... profile details
  }]
}
```

---

### `console_remove_profile`

Remove a saved profile.

**Parameters:**
```typescript
{
  name: string;  // Profile name (required)
}
```

---

### `console_use_profile`

Create a session using a saved profile.

**Parameters:**
```typescript
{
  name: string;      // Profile name (required)
  overrides?: object; // Override profile settings
}
```

**Example:**
```typescript
// Connect using saved SSH profile
await console_use_profile({
  name: "prod-server"
});

// Start app with profile, override env vars
await console_use_profile({
  name: "my-app",
  overrides: {
    environmentVariables: {
      NODE_ENV: "production"
    }
  }
});
```

---

## Background Job Tools

### `console_execute_async`

Execute a command in background (async mode).

**Parameters:**
```typescript
{
  sessionId: string;      // Session ID (required)
  command: string;        // Command to execute (required)
  args?: string[];
  background?: boolean;   // Default: true
  timeout?: number;
  priority?: number;      // 1-10 (10 highest)
  captureOutput?: boolean;
  metadata?: object;
}
```

**Returns:**
```typescript
{
  jobId: string;
  status: 'queued' | 'running';
}
```

**Example:**
```typescript
const job = await console_execute_async({
  sessionId: "session-123",
  command: "npm run build",
  priority: 8,
  timeout: 300000  // 5 minutes
});

console.log(`Job started: ${job.jobId}`);
```

---

### `console_get_job_status`

Get the status of a background job.

**Parameters:**
```typescript
{
  jobId: string;  // Job ID (required)
}
```

**Returns:**
```typescript
{
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime?: string;
  endTime?: string;
}
```

---

### `console_get_job_output`

Get output from a background job.

**Parameters:**
```typescript
{
  jobId: string;  // Job ID (required)
}
```

**Returns:** Job output

---

### `console_cancel_job`

Cancel a running background job.

**Parameters:**
```typescript
{
  jobId: string;  // Job ID (required)
}
```

---

### `console_list_jobs`

List background jobs for a session or all sessions.

**Parameters:**
```typescript
{
  sessionId?: string;  // Optional, omit for all jobs
}
```

**Returns:**
```typescript
{
  jobs: [{
    jobId: string;
    status: string;
    command: string;
    // ... more details
  }]
}
```

---

### `console_get_job_progress`

Get progress information for a background job.

**Parameters:**
```typescript
{
  jobId: string;  // Job ID (required)
}
```

**Returns:**
```typescript
{
  jobId: string;
  progress: number;  // 0-100
  status: string;
}
```

---

### `console_get_job_result`

Get complete result of a background job.

**Parameters:**
```typescript
{
  jobId: string;  // Job ID (required)
}
```

**Returns:**
```typescript
{
  jobId: string;
  output: string;
  exitCode: number;
  duration: number;
  status: string;
}
```

---

### `console_get_job_metrics`

Get metrics and statistics about background job execution.

**Parameters:** None

**Returns:** Job execution statistics

---

### `console_cleanup_jobs`

Clean up completed background jobs.

**Parameters:**
```typescript
{
  olderThan?: number;   // Clean jobs older than N ms
  status?: string;      // Clean jobs with specific status
}
```

**Example:**
```typescript
// Clean completed jobs older than 1 hour
await console_cleanup_jobs({
  olderThan: 3600000,
  status: "completed"
});
```

---

## Test Automation Tools

### `console_assert_output`

Assert that session output matches expected criteria.

**Parameters:**
```typescript
{
  sessionId: string;                           // (required)
  assertionType: 'contains' | 'matches' | 'equals';  // (required)
  expected: string;                            // (required)
  message?: string;                            // Custom assertion message
}
```

**Example:**
```typescript
// Assert output contains success message
await console_assert_output({
  sessionId: "session-123",
  assertionType: "contains",
  expected: "Build successful",
  message: "Build should complete successfully"
});

// Assert output matches regex
await console_assert_output({
  sessionId: "session-123",
  assertionType: "matches",
  expected: "Tests passed: \\d+/\\d+"
});
```

---

### `console_assert_exit_code`

Assert that session exit code matches expected value.

**Parameters:**
```typescript
{
  sessionId: string;     // (required)
  expectedCode: number;  // (required)
  message?: string;
}
```

**Example:**
```typescript
await console_assert_exit_code({
  sessionId: "session-123",
  expectedCode: 0,
  message: "Command should exit successfully"
});
```

---

### `console_assert_no_errors`

Assert that session output contains no error messages.

**Parameters:**
```typescript
{
  sessionId: string;  // (required)
  message?: string;
}
```

**Example:**
```typescript
await console_assert_no_errors({
  sessionId: "session-123",
  message: "Build should complete without errors"
});
```

---

### `console_save_snapshot`

Save a snapshot of current session state.

**Parameters:**
```typescript
{
  sessionId: string;  // (required)
  name: string;       // (required)
  metadata?: object;
}
```

**Example:**
```typescript
await console_save_snapshot({
  sessionId: "session-123",
  name: "before-deployment",
  metadata: {
    version: "1.0.0",
    environment: "staging"
  }
});
```

---

### `console_compare_snapshots`

Compare two session snapshots.

**Parameters:**
```typescript
{
  snapshot1: string;  // First snapshot name (required)
  snapshot2: string;  // Second snapshot name (required)
}
```

**Returns:**
```typescript
{
  differences: [{
    field: string;
    oldValue: any;
    newValue: any;
  }]
}
```

---

### `console_assert_state`

Assert that session state matches expected values.

**Parameters:**
```typescript
{
  sessionId: string;         // (required)
  expectedState: object;     // (required)
  message?: string;
}
```

**Example:**
```typescript
await console_assert_state({
  sessionId: "session-123",
  expectedState: {
    status: "running",
    hasErrors: false
  }
});
```

---

## Quick Reference Table

| Tool Name | Category | Purpose |
|-----------|----------|---------|
| `console_create_session` | Session | Create new local or SSH session |
| `console_send_input` | Session | Send text to session |
| `console_send_key` | Session | Send special keys (Enter, Ctrl+C, etc.) |
| `console_get_output` | Session | Get filtered/paginated output |
| `console_get_stream` | Session | Get streaming output |
| `console_wait_for_output` | Session | Wait for pattern in output |
| `console_stop_session` | Session | Stop session |
| `console_list_sessions` | Session | List active sessions |
| `console_cleanup_sessions` | Session | Clean up inactive sessions |
| `console_execute_command` | Command | Execute one-off or in-session command |
| `console_detect_errors` | Command | Analyze output for errors |
| `console_get_resource_usage` | Command | Get resource usage stats |
| `console_clear_output` | Command | Clear output buffer |
| `console_get_session_state` | Command | Get session state |
| `console_get_command_history` | Command | Get command history |
| `console_get_system_metrics` | Monitoring | Get system-wide metrics |
| `console_get_session_metrics` | Monitoring | Get session metrics |
| `console_get_alerts` | Monitoring | Get monitoring alerts |
| `console_get_monitoring_dashboard` | Monitoring | Get dashboard data |
| `console_start_monitoring` | Monitoring | Start session monitoring |
| `console_stop_monitoring` | Monitoring | Stop session monitoring |
| `console_save_profile` | Profile | Save connection/app profile |
| `console_list_profiles` | Profile | List saved profiles |
| `console_remove_profile` | Profile | Remove profile |
| `console_use_profile` | Profile | Use saved profile |
| `console_execute_async` | Background | Execute async command |
| `console_get_job_status` | Background | Get job status |
| `console_get_job_output` | Background | Get job output |
| `console_cancel_job` | Background | Cancel job |
| `console_list_jobs` | Background | List jobs |
| `console_get_job_progress` | Background | Get job progress |
| `console_get_job_result` | Background | Get complete job result |
| `console_get_job_metrics` | Background | Get job metrics |
| `console_cleanup_jobs` | Background | Clean up jobs |
| `console_assert_output` | Testing | Assert output matches |
| `console_assert_exit_code` | Testing | Assert exit code |
| `console_assert_no_errors` | Testing | Assert no errors |
| `console_save_snapshot` | Testing | Save state snapshot |
| `console_compare_snapshots` | Testing | Compare snapshots |
| `console_assert_state` | Testing | Assert state matches |

---

## Usage Patterns

### Common Workflows

#### 1. Run Tests with Assertions
```typescript
// Create session and run tests
const session = await console_create_session({
  command: "npm",
  args: ["test"],
  detectErrors: true
});

// Wait for completion
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: "Tests.*passed",
  timeout: 60000
});

// Assert no errors
await console_assert_no_errors({
  sessionId: session.sessionId
});

// Assert exit code
await console_assert_exit_code({
  sessionId: session.sessionId,
  expectedCode: 0
});
```

#### 2. SSH Deployment with Monitoring
```typescript
// Create SSH session
const session = await console_use_profile({
  name: "prod-server"
});

// Start monitoring
await console_start_monitoring({
  sessionId: session.sessionId
});

// Execute deployment
const job = await console_execute_async({
  sessionId: session.sessionId,
  command: "deploy.sh",
  priority: 10
});

// Monitor progress
const status = await console_get_job_status({
  jobId: job.jobId
});
```

#### 3. Long-Running Process with Streaming
```typescript
// Create session with streaming
const session = await console_create_session({
  command: "npm",
  args: ["run", "watch"],
  streaming: true
});

// Get streaming output
await console_get_stream({
  sessionId: session.sessionId
});
```

---

## See Also

- [README.md](../README.md) - Main documentation
- [EXAMPLES.md](./EXAMPLES.md) - Detailed usage examples
- [API.md](./API.md) - API reference
- [PUBLISHING.md](../PUBLISHING.md) - Registry submission guide
