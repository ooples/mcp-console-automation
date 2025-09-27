# Background Jobs Implementation Documentation

## Overview

This document provides comprehensive documentation for the background job execution system implemented in the MCP Console Automation server. The system enables asynchronous execution of long-running commands without blocking console sessions, providing full job lifecycle management, status tracking, output buffering, and timeout handling.

## Architecture

### Core Components

1. **JobManager** (`src/core/JobManager.ts`)
   - Central orchestrator for background job execution
   - Manages job lifecycle, concurrency, and resource cleanup
   - Implements priority-based job queuing
   - Handles timeout management and process spawning

2. **Background Job Types** (`src/types/index.ts`)
   - Comprehensive type definitions for job management
   - Interfaces for job status, options, output, and metrics
   - Type-safe API contracts

3. **ConsoleManager Integration** (`src/core/ConsoleManager.ts`)
   - Seamless integration with existing console management
   - Unified API for both foreground and background operations
   - Resource sharing and cleanup coordination

4. **MCP Server Handlers** (`src/mcp/server.ts`)
   - RESTful-like API endpoints for job operations
   - JSON-RPC tool definitions for client integration
   - Error handling and response formatting

## Features

### ✅ Asynchronous Job Execution
- Non-blocking command execution
- Full process lifecycle management
- Cross-platform compatibility (Windows, Linux, macOS)

### ✅ Job Status Tracking
- Real-time status updates (pending, running, completed, failed, cancelled)
- Detailed job metadata (creation time, duration, exit codes)
- Session-based job organization

### ✅ Output Buffering and Streaming
- Separate stdout/stderr capture
- Sequence-numbered output for ordering
- Configurable buffer limits and retention

### ✅ Timeout and Cleanup Management
- Configurable job timeouts
- Automatic resource cleanup
- Graceful process termination

### ✅ Concurrency Control
- Global and per-session concurrency limits
- Priority-based job scheduling
- Resource-aware execution management

### ✅ Comprehensive Monitoring
- Real-time metrics collection
- Job performance statistics
- System resource tracking

## API Reference

### MCP Tools

#### `console_execute_async`
Execute a command asynchronously in the background.

**Parameters:**
- `command` (string): The command to execute
- `args` (string[]): Command arguments (optional)
- `options` (object): Job execution options (optional)
  - `sessionId` (string): Associate job with specific session
  - `workingDirectory` (string): Working directory for execution
  - `environment` (object): Environment variables
  - `timeout` (number): Timeout in milliseconds
  - `priority` (number): Job priority (1-10, higher = more priority)
  - `tags` (object): Custom metadata tags

**Returns:**
```json
{
  "success": true,
  "jobId": "job-12345-abcde",
  "status": "running"
}
```

**Example:**
```typescript
const result = await server.handleExecuteAsync({
  name: 'console_execute_async',
  arguments: {
    command: 'python',
    args: ['train_model.py', '--epochs', '100'],
    options: {
      sessionId: 'ml-training',
      timeout: 3600000, // 1 hour
      priority: 8,
      tags: { model: 'nlp', task: 'training' }
    }
  }
});
```

#### `console_get_job_status`
Get the current status and metadata of a background job.

**Parameters:**
- `jobId` (string): Unique job identifier

**Returns:**
```json
{
  "success": true,
  "job": {
    "id": "job-12345-abcde",
    "command": "python",
    "args": ["train_model.py", "--epochs", "100"],
    "status": "running",
    "sessionId": "ml-training",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "startedAt": "2024-01-15T10:30:01.000Z",
    "priority": 8,
    "timeout": 3600000,
    "tags": { "model": "nlp", "task": "training" }
  }
}
```

#### `console_get_job_output`
Retrieve output from a background job.

**Parameters:**
- `jobId` (string): Unique job identifier
- `options` (object): Output retrieval options (optional)
  - `latest` (boolean): Get only latest output chunks

**Returns:**
```json
{
  "success": true,
  "output": [
    {
      "content": "Epoch 1/100\n",
      "timestamp": "2024-01-15T10:30:05.000Z",
      "sequenceNumber": 1,
      "type": "stdout"
    },
    {
      "content": "Loss: 0.95, Accuracy: 0.78\n",
      "timestamp": "2024-01-15T10:30:15.000Z",
      "sequenceNumber": 2,
      "type": "stdout"
    }
  ]
}
```

#### `console_cancel_job`
Cancel a running background job.

**Parameters:**
- `jobId` (string): Unique job identifier

**Returns:**
```json
{
  "success": true,
  "cancelled": true,
  "message": "Job cancelled successfully"
}
```

#### `console_list_jobs`
List background jobs with optional filtering.

**Parameters:**
- `options` (object): Filtering options (optional)
  - `status` (string): Filter by job status
  - `sessionId` (string): Filter by session
  - `limit` (number): Maximum number of jobs to return

**Returns:**
```json
{
  "success": true,
  "jobs": [
    {
      "id": "job-12345-abcde",
      "command": "python",
      "status": "running",
      "sessionId": "ml-training",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 1
}
```

#### `console_get_job_metrics`
Get system-wide background job metrics.

**Returns:**
```json
{
  "success": true,
  "metrics": {
    "totalJobs": 25,
    "runningJobs": 3,
    "completedJobs": 20,
    "failedJobs": 1,
    "cancelledJobs": 1,
    "queueSize": 2,
    "concurrency": {
      "current": 3,
      "maximum": 10
    },
    "averageExecutionTime": 45000,
    "systemLoad": 0.65
  }
}
```

#### `console_cleanup_jobs`
Clean up completed and failed background jobs.

**Parameters:**
- `options` (object): Cleanup options (optional)
  - `maxAge` (number): Remove jobs older than this (milliseconds)
  - `keepCount` (number): Keep this many recent jobs
  - `statuses` (string[]): Only clean jobs with these statuses

**Returns:**
```json
{
  "success": true,
  "cleaned": 15,
  "remaining": 10
}
```

## Usage Examples

### 1. Long-Running Data Processing

```typescript
// Start a data processing job
const processingJob = await executeAsync({
  command: 'python',
  args: ['process_dataset.py', '--input', 'data.csv', '--output', 'processed.csv'],
  options: {
    sessionId: 'data-pipeline',
    timeout: 1800000, // 30 minutes
    priority: 5,
    tags: { pipeline: 'etl', stage: 'processing' }
  }
});

// Monitor progress
const jobId = processingJob.jobId;
let status;
do {
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
  status = await getJobStatus(jobId);
  console.log(`Job ${jobId}: ${status.job.status}`);
} while (status.job.status === 'running');

// Get final output
if (status.job.status === 'completed') {
  const output = await getJobOutput(jobId);
  console.log('Processing completed successfully:', output);
} else {
  console.error('Processing failed:', status.job.error);
}
```

### 2. Parallel Model Training

```typescript
// Start multiple training jobs in parallel
const models = ['model_a', 'model_b', 'model_c'];
const trainingJobs = [];

for (const model of models) {
  const job = await executeAsync({
    command: 'python',
    args: ['train.py', '--model', model, '--epochs', '50'],
    options: {
      sessionId: `training-${model}`,
      timeout: 7200000, // 2 hours
      priority: 7,
      tags: { type: 'ml-training', model }
    }
  });
  trainingJobs.push(job.jobId);
}

// Wait for all jobs to complete
const waitForCompletion = async (jobIds) => {
  let completed = 0;
  while (completed < jobIds.length) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds

    for (const jobId of jobIds) {
      const status = await getJobStatus(jobId);
      if (status.job.status !== 'running') {
        completed++;
        console.log(`Job ${jobId} finished with status: ${status.job.status}`);
      }
    }
  }
};

await waitForCompletion(trainingJobs);
console.log('All training jobs completed');
```

### 3. System Monitoring with Background Jobs

```typescript
// Start system monitoring job
const monitoringJob = await executeAsync({
  command: 'python',
  args: ['system_monitor.py', '--interval', '60', '--duration', '3600'],
  options: {
    sessionId: 'system-monitoring',
    timeout: 3900000, // Slightly longer than duration
    priority: 3,
    tags: { type: 'monitoring', component: 'system' }
  }
});

// Stream monitoring output in real-time
const streamOutput = async (jobId) => {
  let lastSequence = 0;

  while (true) {
    const status = await getJobStatus(jobId);
    if (status.job.status !== 'running') break;

    const output = await getJobOutput(jobId, { since: lastSequence });

    if (output.output.length > 0) {
      for (const chunk of output.output) {
        console.log(`[${chunk.timestamp}] ${chunk.content.trim()}`);
        lastSequence = Math.max(lastSequence, chunk.sequenceNumber);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
  }
};

await streamOutput(monitoringJob.jobId);
```

### 4. Batch File Processing with Cleanup

```typescript
// Process multiple files in parallel
const files = ['file1.txt', 'file2.txt', 'file3.txt'];
const processingJobs = [];

for (const file of files) {
  const job = await executeAsync({
    command: 'python',
    args: ['process_file.py', file],
    options: {
      sessionId: 'batch-processing',
      timeout: 300000, // 5 minutes per file
      priority: 4,
      tags: { type: 'batch', file }
    }
  });
  processingJobs.push(job.jobId);
}

// Wait for all jobs to complete
let allCompleted = false;
while (!allCompleted) {
  await new Promise(resolve => setTimeout(resolve, 2000));

  const jobs = await listJobs({ sessionId: 'batch-processing' });
  allCompleted = jobs.jobs.every(job =>
    job.status === 'completed' || job.status === 'failed'
  );
}

// Clean up completed jobs older than 1 hour
const cleaned = await cleanupJobs({ maxAge: 3600000 });
console.log(`Cleaned up ${cleaned} old jobs`);
```

### 5. Error Handling and Recovery

```typescript
const executeWithRetry = async (command, args, options = {}, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const job = await executeAsync({
        command,
        args,
        options: {
          ...options,
          tags: { ...options.tags, attempt }
        }
      });

      // Wait for completion
      let status;
      do {
        await new Promise(resolve => setTimeout(resolve, 2000));
        status = await getJobStatus(job.jobId);
      } while (status.job.status === 'running');

      if (status.job.status === 'completed') {
        return job.jobId;
      } else {
        throw new Error(`Job failed: ${status.job.error}`);
      }

    } catch (error) {
      console.warn(`Attempt ${attempt} failed: ${error.message}`);

      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
};

// Usage
try {
  const jobId = await executeWithRetry('python', ['unreliable_script.py'], {
    timeout: 120000,
    sessionId: 'retry-demo'
  });
  console.log('Script completed successfully:', jobId);
} catch (error) {
  console.error('Script failed after all retries:', error.message);
}
```

## Performance Considerations

### Concurrency Management
- **Global Limits**: Default maximum of 10 concurrent background jobs
- **Session Limits**: Default maximum of 5 concurrent jobs per session
- **Priority Queuing**: Higher priority jobs execute first
- **Resource Monitoring**: System load influences job scheduling

### Memory Management
- **Output Buffering**: Configurable buffer size with automatic rotation
- **Job Cleanup**: Automatic cleanup of completed jobs older than 24 hours
- **Process Management**: Proper cleanup of child processes and file handles

### Scalability
- **Tested Configuration**: Up to 1000 concurrent jobs in performance tests
- **Throughput**: Capable of 100+ job creations per second
- **Storage**: Efficient in-memory storage with optional persistence

## Error Handling

### Common Error Scenarios
1. **Command Not Found**: Invalid executable path
2. **Permission Denied**: Insufficient privileges
3. **Timeout**: Job exceeds configured timeout
4. **Resource Exhaustion**: System resource limits reached
5. **Network Issues**: For remote command execution

### Error Response Format
```json
{
  "success": false,
  "error": "Command not found: nonexistent-command",
  "code": "COMMAND_NOT_FOUND",
  "details": {
    "command": "nonexistent-command",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

## Testing

The implementation includes comprehensive test coverage:

### Unit Tests (`tests/unit/JobManager.test.ts`)
- Job lifecycle management
- Concurrency control
- Output handling
- Error scenarios
- Resource cleanup

### Integration Tests (`tests/integration/background-jobs.test.ts`)
- MCP server handler functionality
- End-to-end job execution
- Cross-platform compatibility
- Error handling integration

### Performance Tests (`tests/performance/background-jobs.performance.test.ts`)
- High-volume job creation
- Concurrent execution performance
- Memory usage under load
- Cleanup performance

### Running Tests
```bash
# Run all background job tests
node test-background-jobs.js

# Run with performance tests (may take several minutes)
node test-background-jobs.js --performance

# Generate coverage reports
node test-background-jobs.js --coverage

# Run in watch mode for development
node test-background-jobs.js --watch
```

## Configuration

### Default Configuration
```typescript
const defaultConfig = {
  maxConcurrentJobs: 10,
  maxConcurrentJobsPerSession: 5,
  defaultTimeout: 300000, // 5 minutes
  retainCompletedJobs: 86400000, // 24 hours
  outputBufferSize: 10000,
  priorityLevels: 10,
  cleanupInterval: 3600000 // 1 hour
};
```

### Environment Variables
- `MAX_CONCURRENT_JOBS`: Override global concurrency limit
- `JOB_TIMEOUT_MS`: Default timeout for jobs
- `JOB_CLEANUP_INTERVAL`: Frequency of automatic cleanup

## Security Considerations

### Command Execution
- **Input Validation**: All commands and arguments are validated
- **Path Restrictions**: Working directory restrictions enforced
- **Environment Isolation**: Clean environment variable handling

### Resource Protection
- **Process Limits**: Configurable limits on child processes
- **Memory Limits**: Buffer size restrictions to prevent memory exhaustion
- **File System Access**: Restricted to configured directories

### Session Security
- **Session Isolation**: Jobs are isolated per session
- **Authentication**: Integration with existing MCP authentication
- **Audit Logging**: Comprehensive logging of job operations

## Migration Guide

### From Synchronous to Asynchronous Execution

**Before:**
```typescript
const result = await consoleManager.executeCommand(sessionId, 'python script.py');
```

**After:**
```typescript
const job = await consoleManager.startBackgroundJob('python', ['script.py'], {
  sessionId
});

// Monitor completion
let status;
do {
  await new Promise(resolve => setTimeout(resolve, 1000));
  status = await consoleManager.getBackgroundJobStatus(job);
} while (status?.status === 'running');

const output = await consoleManager.getBackgroundJobOutput(job);
```

## Future Enhancements

### Planned Features
1. **Job Persistence**: Save job state to disk for server restarts
2. **Distributed Execution**: Support for running jobs on remote workers
3. **Job Dependencies**: Define job execution dependencies
4. **Resource Quotas**: Per-user and per-session resource limits
5. **Job Templates**: Predefined job configurations
6. **Notification System**: Webhooks and email notifications
7. **Job Scheduling**: Cron-like job scheduling capabilities

### API Evolution
The background job API is designed for backward compatibility. Future versions will:
- Add optional parameters without breaking existing calls
- Maintain existing response formats
- Provide migration utilities for breaking changes

## Support and Troubleshooting

### Common Issues

**Issue**: Jobs stuck in "running" state
**Solution**: Check for zombie processes, verify timeout configuration

**Issue**: High memory usage
**Solution**: Reduce output buffer size, increase cleanup frequency

**Issue**: Commands not found
**Solution**: Verify PATH environment, use absolute paths

### Debugging
Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

### Performance Monitoring
```typescript
// Get system metrics
const metrics = await consoleManager.getBackgroundJobMetrics();
console.log('Current system load:', metrics.systemLoad);
console.log('Active jobs:', metrics.runningJobs);
```

---

## Conclusion

The background jobs implementation provides a robust, scalable solution for asynchronous command execution in the MCP Console Automation server. With comprehensive testing, monitoring, and error handling, it enables complex automation workflows while maintaining system stability and performance.

For additional support or feature requests, please refer to the project repository or contact the development team.