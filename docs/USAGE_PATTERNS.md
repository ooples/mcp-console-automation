# Console Automation Usage Patterns

## Quick Decision Tree

**Need to execute a command?**

```
START: What kind of command?
│
├─ Not sure / Want automatic optimization?
│  → Use Pattern 0: Smart Execute (Recommended)
│
├─ Fast command (<30s) + Small output (<10KB)
│  → Use Pattern 1: Synchronous Execution
│
├─ Long-running command OR Large output (>10KB)
│  ├─ Need real-time output?
│  │  → Use Pattern 2: Streaming Execution
│  │
│  └─ Can run in background?
│     → Use Pattern 3: Background Jobs
│
└─ Interactive shell (SSH login, prompts, interactive CLI)
   → Use Low-Level APIs (sendInput + waitForOutput)
```

---

## Pattern 0: Smart Execute (Recommended)

**Best for:** Any command execution - automatically selects optimal strategy

**Tool:** `console_execute_smart`

**Example:**
```typescript
const result = await executeSmart({
  sessionId: 'my-session',
  command: 'any-command-here'
});

console.log(result.output);         // Command output
console.log(result.exitCode);       // Exit code (0 = success)
console.log(result.duration);       // Execution time in ms
console.log(result.strategyUsed);   // 'fast', 'streaming', or 'background'
console.log(result.switched);       // true if strategy was changed mid-execution
console.log(result.switchReason);   // Why strategy was switched (if applicable)
```

**How it works:**
1. **Analyzes command** - Recognizes patterns (npm install, git clone, etc.)
2. **Selects strategy** - Picks fast/streaming/background based on analysis
3. **Monitors execution** - Watches output size and duration
4. **Switches if needed** - Changes strategy mid-execution if needed
5. **Returns unified result** - Same format regardless of strategy used

**Command Pattern Recognition:**
- **Quick commands** (`ls`, `pwd`, `echo`) → Fast path
- **Long-running** (`npm install`, `cargo build`) → Background job
- **Streaming** (`tail -f`, `watch`) → Streaming execution
- **Unknown** → Start with fast path, switch if needed

**Automatic Strategy Switching:**
```typescript
// Example: Command expected to be fast but produces large output
const result = await executeSmart({
  sessionId: 'my-session',
  command: 'cat huge-log-file.txt'
});

// System detects large output and switches to streaming
console.log(result.strategyUsed);  // 'streaming'
console.log(result.switched);       // true
console.log(result.switchReason);   // 'Large output detected'
```

---

## Pattern 1: Synchronous Execution

**Best for:** Commands that complete quickly (< 30 seconds) with manageable output

**Tool:** `console_execute_command`

**Example:**
```typescript
const result = await executeCommand({
  sessionId: 'my-session',
  command: 'ls -la',
  timeout: 30000  // 30 seconds (default: 120s)
});

console.log(result.output);      // Command output
console.log(result.exitCode);    // Exit code (0 = success)
console.log(result.duration);    // Execution time in ms
```

**With longer timeout for slower commands:**
```typescript
const result = await executeCommand({
  command: 'npm run build',
  timeout: 300000  // 5 minutes
});
```

**How it works:**
- Sends command to session
- **Event-driven waiting** (no polling, zero CPU waste)
- Returns output when command completes
- Includes exit code and execution duration

---

## Pattern 2: Streaming Execution

**Best for:** Commands with large output (>10KB) or long-running commands where you need real-time feedback

**Tools:** `console_create_session` (with streaming) + `console_get_stream`

**Example:**
```typescript
// Step 1: Create streaming session
const session = await createSession({
  command: 'npm install',
  streaming: true,
  streamingOptions: {
    chunkSize: 1024,        // 1KB chunks
    maxBufferSize: 10485760 // 10MB buffer
  }
});

// Step 2: Get output chunks
const stream = await getStream({
  sessionId: session.sessionId,
  maxLines: 50  // Retrieve 50 lines at a time
});

console.log(stream.chunks);      // Array of output chunks
console.log(stream.hasMore);     // More chunks available?
console.log(stream.nextSequenceId); // For pagination

// Step 3: Paginate through all output
let allOutput = '';
let currentStream = stream;

while (currentStream.hasMore) {
  // Process chunks
  allOutput += currentStream.chunks.map(c => c.data).join('');
  
  // Get next page
  currentStream = await getStream({
    sessionId: session.sessionId,
    since: currentStream.nextSequenceId
  });
}

console.log('Complete output:', allOutput);
```

**How it works:**
- Real-time EventEmitter-based output capture
- Configurable chunking (512B - 4KB)
- Server-side filtering to reduce data transfer
- Rolling buffer with retention policies
- **Solves 25k token limit problem**

---

## Pattern 3: Background Jobs

**Best for:** Truly async operations, batch processing, parallel execution, commands that take minutes/hours

**Tools:** `console_execute_async` + job management tools

**Example:**
```typescript
// Step 1: Start background job
const job = await executeAsync({
  command: 'npm run test',
  options: {
    sessionId: 'my-session',
    timeout: 600000,  // 10 minutes
    priority: 5       // Priority 1-10 (10 = highest)
  }
});

console.log(job.jobId);  // Job ID for tracking

// Step 2: Poll for completion
let status;
do {
  await sleep(1000);  // Wait 1 second
  status = await getJobStatus(job.jobId);
  
  console.log(status.job.status);    // pending/running/completed/failed
  console.log(status.job.progress);  // Progress percentage
} while (status.job.status === 'running');

// Step 3: Get job output
const output = await getJobOutput(job.jobId);

console.log(output.stdout);  // Standard output
console.log(output.stderr);  // Standard error
console.log(output.exitCode); // Exit code
```

**Advanced: List all jobs**
```typescript
const jobs = await listJobs({
  status: 'running',  // Filter by status
  sessionId: 'my-session'
});

console.log(jobs.jobs);  // Array of job objects
```

**Advanced: Cancel a job**
```typescript
await cancelJob(jobId);
```

**How it works:**
- Priority-based job queue (1-10 priority levels)
- Concurrency control (max 5 concurrent jobs)
- Full lifecycle management (pending → running → completed/failed)
- Event-driven notifications
- Separate stdout/stderr capture

---

## Low-Level Interactive APIs

**⚠️ WARNING:** Only use for interactive shells, NOT for command execution!

**Tools:** `console_send_input`, `console_wait_for_output`

**Intended use case:**
- SSH login prompts
- Interactive CLI tools requiring user input
- Waiting for specific shell prompts

**Example (SSH authentication):**
```typescript
// Send password to SSH prompt
await sendInput(sessionId, 'mypassword\n');

// Wait for shell prompt
await waitForOutput(sessionId, /\$\s*$/);

// Now can send commands
await sendInput(sessionId, 'ls -la\n');
```

**Why NOT to use for command execution:**
- `sendInput` sends text but **doesn't wait**
- `getOutput` retrieves whatever is in buffer **at that moment**
- `waitForOutput` waits for a **PATTERN** (like a prompt), not command completion
- No automatic command completion detection
- **Creates race conditions!**

---

## Anti-Patterns

### ❌ Race Condition: sendInput + getOutput

**WRONG - Creates Race Condition:**
```typescript
await sendInput(sessionId, "npm install\n");
const output = await getOutput(sessionId); // ⚠️ Command not finished!
// Result: You get the echo "npm install" but not the actual output
```

**Why this fails:**
1. `sendInput` sends the command and returns immediately
2. Command starts executing but hasn't completed
3. `getOutput` retrieves current buffer (usually just the echo)
4. Actual output comes later and is missed

**✅ CORRECT - Use execute_command:**
```typescript
const result = await executeCommand({
  sessionId,
  command: "npm install",
  timeout: 300000  // 5 minutes
});
console.log(result.output);  // ✅ Complete output guaranteed
```

### ❌ Polling with sendInput + sleep + getOutput

**WRONG - Still a race condition:**
```typescript
await sendInput(sessionId, "long-command\n");
await sleep(5000);  // Hope 5 seconds is enough?
const output = await getOutput(sessionId); // ⚠️ Might not be complete!
```

**Problem:** You're guessing how long to wait. Command might:
- Complete in 2 seconds (wasted 3 seconds)
- Take 10 seconds (missed the output)

**✅ CORRECT - Let the system handle timing:**
```typescript
// Option 1: Synchronous with proper timeout
const result = await executeCommand({
  command: "long-command",
  timeout: 300000  // 5 minutes max
});

// Option 2: Background job for very long commands
const job = await executeAsync({
  command: "long-command",
  options: { timeout: 600000 }  // 10 minutes
});
```

---

## Migration Guide

### If you're currently using sendInput + getOutput:

**Before (Race Condition):**
```typescript
await sendInput(sessionId, "command\n");
await sleep(???);  // How long to wait?
const output = await getOutput(sessionId);
```

**After - Choose based on your needs:**

**Option 1: Synchronous (most common)**
```typescript
const result = await executeCommand({
  sessionId,
  command: "command",
  timeout: 120000  // Adjust as needed
});
console.log(result.output);
```

**Option 2: Streaming (large outputs)**
```typescript
const session = await createSession({
  command: "command",
  streaming: true
});

let allOutput = '';
const stream = await getStream({
  sessionId: session.sessionId,
  maxLines: 50
});

while (stream.hasMore) {
  allOutput += stream.chunks.map(c => c.data).join('');
  stream = await getStream({
    sessionId: session.sessionId,
    since: stream.nextSequenceId
  });
}
```

**Option 3: Background job (async)**
```typescript
const job = await executeAsync({
  command: "command",
  options: { sessionId, timeout: 600000 }
});

// Poll for completion
let status;
do {
  await sleep(1000);
  status = await getJobStatus(job.jobId);
} while (status.job.status === 'running');

const output = await getJobOutput(job.jobId);
```

---

## Best Practices

1. **Start with Pattern 1 (Synchronous)**
   - Simplest approach
   - Works for most commands
   - Increase timeout if needed

2. **Use Pattern 2 (Streaming) when:**
   - Output exceeds 10KB
   - Need real-time feedback
   - Command runs for extended periods

3. **Use Pattern 3 (Background Jobs) when:**
   - Command takes minutes/hours
   - Running multiple commands in parallel
   - Need to continue other operations while command runs

4. **Reserve Low-Level APIs for:**
   - Interactive shell scenarios only
   - SSH authentication flows
   - Interactive CLI tools

5. **Never use sendInput + getOutput for command execution**
   - Always causes race conditions
   - No way to know when command completes
   - Use proper execution patterns instead

---

## Troubleshooting

### Command times out
**Solution:** Increase timeout or switch to background job
```typescript
// Longer timeout
await executeCommand({ command: 'cmd', timeout: 600000 });

// Or use background job
const job = await executeAsync({ command: 'cmd' });
```

### Output truncated or missing
**Solution:** Use streaming
```typescript
const session = await createSession({
  command: 'cmd',
  streaming: true
});
// Then paginate through all chunks
```

### Multiple commands need to run
**Solution:** Use background jobs with priorities
```typescript
const job1 = await executeAsync({ 
  command: 'cmd1', 
  options: { priority: 10 } // High priority
});

const job2 = await executeAsync({ 
  command: 'cmd2', 
  options: { priority: 5 } // Normal priority
});
```

---

## Summary

| Pattern | Use Case | Pros | Cons |
|---------|----------|------|------|
| **Smart Execute** | Any command (recommended) | Auto-optimizes, switches strategies | Requires session |
| **Synchronous** | Fast commands | Simple, immediate results | Limited by timeout |
| **Streaming** | Large outputs | Real-time, paginated | More complex setup |
| **Background Jobs** | Long-running | Truly async, parallel | Need to poll status |
| **Low-Level** | Interactive shells | Full control | Easy to misuse |

**Golden Rule:** Use Smart Execute for most commands. Use specific execution patterns (1-3) when you need precise control. Reserve low-level APIs for interactive scenarios only.
