# MCP Console Automation - Practical Examples

This document provides real-world examples of using the MCP Console Automation Server.

## Table of Contents

- [Basic Usage](#basic-usage)
- [SSH & Remote Execution](#ssh--remote-execution)
- [Test Automation](#test-automation)
- [Background Jobs](#background-jobs)
- [Monitoring & Alerts](#monitoring--alerts)
- [Profile Management](#profile-management)
- [Advanced Patterns](#advanced-patterns)

---

## Basic Usage

### Example 1: Run a Simple Command

```typescript
// Create session and run ls command
const session = await console_create_session({
  command: "ls",
  args: ["-la", "/home/user"],
  detectErrors: true
});

// Get output
const output = await console_get_output({
  sessionId: session.sessionId
});

console.log(output);

// Clean up
await console_stop_session({
  sessionId: session.sessionId
});
```

### Example 2: Interactive Session

```typescript
// Start interactive Python session
const session = await console_create_session({
  command: "python3",
  consoleType: "auto"
});

// Send Python code
await console_send_input({
  sessionId: session.sessionId,
  input: "print('Hello, World!')"
});

await console_send_key({
  sessionId: session.sessionId,
  key: "enter"
});

// Wait for output
await new Promise(resolve => setTimeout(resolve, 1000));

// Get result
const output = await console_get_output({
  sessionId: session.sessionId,
  tail: 10
});

console.log(output);
```

### Example 3: Wait for Specific Output

```typescript
// Start a server
const session = await console_create_session({
  command: "npm",
  args: ["start"],
  cwd: "/path/to/app"
});

// Wait for server to be ready
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: "Server listening on port \\d+",
  timeout: 30000
});

console.log("Server is ready!");
```

---

## SSH & Remote Execution

### Example 4: Connect via SSH

```typescript
// Connect to remote server
const session = await console_create_session({
  command: "bash",
  consoleType: "ssh",
  sshOptions: {
    host: "example.com",
    port: 22,
    username: "deploy",
    privateKeyPath: "~/.ssh/id_rsa"
  }
});

// Execute commands on remote server
await console_send_input({
  sessionId: session.sessionId,
  input: "cd /var/www/app && git pull"
});

await console_send_key({
  sessionId: session.sessionId,
  key: "enter"
});

// Wait for git pull to complete
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: "Already up to date|Updating",
  timeout: 60000
});

// Get output
const output = await console_get_output({
  sessionId: session.sessionId,
  tail: 50
});
```

### Example 5: SSH with Password Authentication

```typescript
const session = await console_create_session({
  command: "bash",
  consoleType: "ssh",
  sshOptions: {
    host: "192.168.1.100",
    username: "admin",
    password: process.env.SSH_PASSWORD  // Securely stored
  }
});

// Run system update
await console_send_input({
  sessionId: session.sessionId,
  input: "sudo apt update && sudo apt upgrade -y"
});

await console_send_key({
  sessionId: session.sessionId,
  key: "enter"
});

// Monitor progress
const stream = await console_get_stream({
  sessionId: session.sessionId
});
```

### Example 6: Multi-Server Deployment

```typescript
const servers = [
  "web1.example.com",
  "web2.example.com",
  "web3.example.com"
];

const sessions = await Promise.all(
  servers.map(host =>
    console_create_session({
      command: "bash",
      consoleType: "ssh",
      sshOptions: {
        host,
        username: "deploy",
        privateKeyPath: "~/.ssh/deploy_key"
      }
    })
  )
);

// Deploy to all servers
for (const session of sessions) {
  await console_send_input({
    sessionId: session.sessionId,
    input: "cd /var/www/app && ./deploy.sh"
  });

  await console_send_key({
    sessionId: session.sessionId,
    key: "enter"
  });
}

// Wait for all deployments
await Promise.all(
  sessions.map(session =>
    console_wait_for_output({
      sessionId: session.sessionId,
      pattern: "Deployment successful",
      timeout: 300000  // 5 minutes
    })
  )
);

console.log("All servers deployed!");
```

---

## Test Automation

### Example 7: Test Suite with Assertions

```typescript
// Start test session
const session = await console_create_session({
  command: "npm",
  args: ["test"],
  cwd: "/path/to/project",
  detectErrors: true
});

// Wait for tests to complete
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: "Tests.*\\d+ passed",
  timeout: 120000
});

// Assert no errors
await console_assert_no_errors({
  sessionId: session.sessionId,
  message: "Tests should complete without errors"
});

// Assert output contains success
await console_assert_output({
  sessionId: session.sessionId,
  assertionType: "contains",
  expected: "All tests passed"
});

// Assert exit code
await console_assert_exit_code({
  sessionId: session.sessionId,
  expectedCode: 0,
  message: "Test suite should exit successfully"
});

console.log("All assertions passed!");
```

### Example 8: Snapshot-Based Testing

```typescript
// Create baseline session
const baseline = await console_create_session({
  command: "npm",
  args: ["run", "build"],
  cwd: "/path/to/project"
});

await console_wait_for_output({
  sessionId: baseline.sessionId,
  pattern: "Build complete",
  timeout: 120000
});

// Save baseline snapshot
await console_save_snapshot({
  sessionId: baseline.sessionId,
  name: "build-baseline",
  metadata: {
    version: "1.0.0",
    date: new Date().toISOString()
  }
});

// Make changes and build again
const current = await console_create_session({
  command: "npm",
  args: ["run", "build"],
  cwd: "/path/to/project"
});

await console_wait_for_output({
  sessionId: current.sessionId,
  pattern: "Build complete",
  timeout: 120000
});

// Save current snapshot
await console_save_snapshot({
  sessionId: current.sessionId,
  name: "build-current"
});

// Compare snapshots
const diff = await console_compare_snapshots({
  snapshot1: "build-baseline",
  snapshot2: "build-current"
});

console.log("Build differences:", diff);
```

### Example 9: Continuous Integration Testing

```typescript
async function runCITests() {
  // Lint
  console.log("Running linter...");
  const lintSession = await console_create_session({
    command: "npm",
    args: ["run", "lint"]
  });

  await console_wait_for_output({
    sessionId: lintSession.sessionId,
    pattern: "✔|✓|passed",
    timeout: 30000
  });

  await console_assert_exit_code({
    sessionId: lintSession.sessionId,
    expectedCode: 0
  });

  // Type check
  console.log("Running type checker...");
  const typecheckSession = await console_create_session({
    command: "npm",
    args: ["run", "typecheck"]
  });

  await console_wait_for_output({
    sessionId: typecheckSession.sessionId,
    pattern: "Compilation complete",
    timeout: 60000
  });

  await console_assert_no_errors({
    sessionId: typecheckSession.sessionId
  });

  // Unit tests
  console.log("Running unit tests...");
  const unitSession = await console_create_session({
    command: "npm",
    args: ["test", "--", "--coverage"]
  });

  await console_wait_for_output({
    sessionId: unitSession.sessionId,
    pattern: "Coverage",
    timeout: 120000
  });

  await console_assert_output({
    sessionId: unitSession.sessionId,
    assertionType: "matches",
    expected: "All files.*\\|\\s+\\d+.*\\|"
  });

  // Build
  console.log("Building...");
  const buildSession = await console_create_session({
    command: "npm",
    args: ["run", "build"]
  });

  await console_wait_for_output({
    sessionId: buildSession.sessionId,
    pattern: "Build successful",
    timeout: 180000
  });

  console.log("CI tests passed!");
}

runCITests();
```

---

## Background Jobs

### Example 10: Long-Running Background Task

```typescript
// Create session
const session = await console_create_session({
  command: "bash",
  consoleType: "auto"
});

// Start long-running job
const job = await console_execute_async({
  sessionId: session.sessionId,
  command: "npm run build:production",
  priority: 8,
  timeout: 600000,  // 10 minutes
  captureOutput: true,
  metadata: {
    project: "my-app",
    environment: "production"
  }
});

console.log(`Job started: ${job.jobId}`);

// Monitor progress
const checkProgress = setInterval(async () => {
  const status = await console_get_job_status({
    jobId: job.jobId
  });

  const progress = await console_get_job_progress({
    jobId: job.jobId
  });

  console.log(`Job ${status.status}: ${progress.progress}%`);

  if (status.status === "completed" || status.status === "failed") {
    clearInterval(checkProgress);

    const result = await console_get_job_result({
      jobId: job.jobId
    });

    console.log("Job Result:", result);
  }
}, 5000);
```

### Example 11: Parallel Job Execution

```typescript
const session = await console_create_session({
  command: "bash"
});

// Start multiple jobs in parallel
const jobs = await Promise.all([
  console_execute_async({
    sessionId: session.sessionId,
    command: "npm run test:unit",
    priority: 10
  }),
  console_execute_async({
    sessionId: session.sessionId,
    command: "npm run test:integration",
    priority: 8
  }),
  console_execute_async({
    sessionId: session.sessionId,
    command: "npm run lint",
    priority: 5
  }),
  console_execute_async({
    sessionId: session.sessionId,
    command: "npm run typecheck",
    priority: 5
  })
]);

console.log(`Started ${jobs.length} jobs`);

// Wait for all to complete
const results = await Promise.all(
  jobs.map(job =>
    waitForJobCompletion(job.jobId)
  )
);

console.log("All jobs completed:", results);

async function waitForJobCompletion(jobId) {
  while (true) {
    const status = await console_get_job_status({ jobId });

    if (status.status === "completed" || status.status === "failed") {
      return console_get_job_result({ jobId });
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

---

## Monitoring & Alerts

### Example 12: System Monitoring Dashboard

```typescript
async function monitoringDashboard() {
  // Get dashboard data
  const dashboard = await console_get_monitoring_dashboard();

  console.log("System Metrics:");
  console.log(`CPU: ${dashboard.cpu.usage}%`);
  console.log(`Memory: ${dashboard.memory.usedPercent}%`);
  console.log(`Active Sessions: ${dashboard.sessions.active}`);

  // Check alerts
  const alerts = await console_get_alerts();

  if (alerts.alerts.length > 0) {
    console.log("\n⚠️  Active Alerts:");
    alerts.alerts.forEach(alert => {
      console.log(`[${alert.severity}] ${alert.message}`);
    });
  }

  // Get system metrics
  const metrics = await console_get_system_metrics();

  console.log("\nDetailed Metrics:");
  console.log(JSON.stringify(metrics, null, 2));
}

// Run every 30 seconds
setInterval(monitoringDashboard, 30000);
```

### Example 13: Session Monitoring with Custom Thresholds

```typescript
// Create session with monitoring
const session = await console_create_session({
  command: "npm",
  args: ["start"],
  monitoring: {
    enabled: true,
    metrics: ["cpu", "memory", "output"],
    interval: 5000,
    alerts: {
      cpuThreshold: 80,
      memoryThreshold: 500 * 1024 * 1024,  // 500MB
      outputErrorPattern: "error|exception|failed"
    }
  }
});

// Start monitoring
await console_start_monitoring({
  sessionId: session.sessionId,
  options: {
    metrics: ["cpu", "memory", "disk", "network"],
    interval: 10000,
    alerts: true
  }
});

// Monitor in real-time
setInterval(async () => {
  const metrics = await console_get_session_metrics({
    sessionId: session.sessionId
  });

  console.log("Session Metrics:", metrics);

  if (metrics.cpu > 80) {
    console.warn("⚠️  High CPU usage detected!");
  }
}, 15000);
```

---

## Profile Management

### Example 14: Save and Use SSH Profiles

```typescript
// Save production server profile
await console_save_profile({
  profileType: "connection",
  name: "prod-db-server",
  connectionType: "ssh",
  sshOptions: {
    host: "db.prod.example.com",
    port: 22,
    username: "dbadmin",
    privateKeyPath: "~/.ssh/prod_db_key"
  }
});

// Save staging server profile
await console_save_profile({
  profileType: "connection",
  name: "staging-web-server",
  connectionType: "ssh",
  sshOptions: {
    host: "web.staging.example.com",
    username: "deploy",
    privateKeyPath: "~/.ssh/staging_key"
  }
});

// List all profiles
const profiles = await console_list_profiles();
console.log("Saved profiles:", profiles);

// Use profile to connect
const session = await console_use_profile({
  name: "prod-db-server"
});

console.log("Connected to production database server");
```

### Example 15: Application Profiles

```typescript
// Save Node.js app profile
await console_save_profile({
  profileType: "application",
  name: "my-api",
  applicationType: "node",
  command: "npm",
  args: ["start"],
  workingDirectory: "/var/www/api",
  environmentVariables: {
    NODE_ENV: "production",
    PORT: "3000",
    LOG_LEVEL: "info"
  }
});

// Save Python app profile
await console_save_profile({
  profileType: "application",
  name: "ml-service",
  applicationType: "python",
  command: "python",
  args: ["main.py"],
  workingDirectory: "/opt/ml-service",
  environmentVariables: {
    PYTHONPATH: "/opt/ml-service/lib",
    MODEL_PATH: "/data/models"
  }
});

// Start app using profile
const apiSession = await console_use_profile({
  name: "my-api"
});

// Override environment
const mlSession = await console_use_profile({
  name: "ml-service",
  overrides: {
    environmentVariables: {
      MODEL_PATH: "/data/models/v2"
    }
  }
});
```

---

## Advanced Patterns

### Example 16: Advanced Output Filtering

```typescript
const session = await console_create_session({
  command: "npm",
  args: ["run", "test:verbose"]
});

// Wait for tests to start
await new Promise(resolve => setTimeout(resolve, 5000));

// Get only error lines from last 5 minutes
const errors = await console_get_output({
  sessionId: session.sessionId,
  grep: "error|exception|failed",
  grepIgnoreCase: true,
  since: "5m"
});

// Get lines 100-200
const chunk = await console_get_output({
  sessionId: session.sessionId,
  lineRange: [100, 200]
});

// Get last 50 lines excluding warnings
const recentOutput = await console_get_output({
  sessionId: session.sessionId,
  tail: 50,
  grep: "warning",
  grepInvert: true
});

// Complex multi-pattern search
const criticalLogs = await console_get_output({
  sessionId: session.sessionId,
  multiPattern: {
    patterns: ["error", "critical", "fatal"],
    operator: "OR",
    negate: false
  },
  since: "1h"
});
```

### Example 17: Error Detection and Recovery

```typescript
async function robustExecution(command, args) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    console.log(`Attempt ${attempt} of ${maxRetries}`);

    const session = await console_create_session({
      command,
      args,
      detectErrors: true
    });

    try {
      // Wait for completion
      await console_wait_for_output({
        sessionId: session.sessionId,
        pattern: "complete|finished|done",
        timeout: 120000
      });

      // Check for errors
      const errors = await console_detect_errors({
        sessionId: session.sessionId
      });

      if (errors.hasErrors) {
        console.warn(`Errors detected on attempt ${attempt}:`, errors.errors);

        if (attempt < maxRetries) {
          console.log("Retrying...");
          await console_stop_session({ sessionId: session.sessionId });
          continue;
        } else {
          throw new Error("Max retries exceeded");
        }
      }

      // Success
      console.log("Execution successful!");
      return await console_get_output({ sessionId: session.sessionId });

    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);

      if (attempt >= maxRetries) {
        throw error;
      }
    } finally {
      await console_stop_session({ sessionId: session.sessionId });
    }
  }
}

// Use it
robustExecution("npm", ["run", "deploy"]);
```

### Example 18: Resource Management

```typescript
async function manageResources() {
  // Check resource usage
  const usage = await console_get_resource_usage();

  console.log("Current resource usage:", usage);

  if (usage.sessionCount > 40) {
    console.log("High session count, cleaning up...");

    // Clean up old sessions
    await console_cleanup_sessions({
      maxAge: 3600000,  // 1 hour
      force: false
    });
  }

  if (usage.memoryUsed > 1024 * 1024 * 1024) {  // 1GB
    console.log("High memory usage, clearing output buffers...");

    const sessions = await console_list_sessions();

    for (const session of sessions.sessions) {
      await console_clear_output({
        sessionId: session.sessionId
      });
    }
  }

  // Clean up completed jobs
  await console_cleanup_jobs({
    olderThan: 3600000,  // 1 hour
    status: "completed"
  });
}

// Run every 5 minutes
setInterval(manageResources, 300000);
```

---

## See Also

- [TOOLS.md](./TOOLS.md) - Complete tool reference
- [README.md](../README.md) - Main documentation
- [PUBLISHING.md](../PUBLISHING.md) - Registry submission guide
