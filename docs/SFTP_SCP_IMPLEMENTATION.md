# SFTP/SCP File Transfer Protocol Implementation

This document describes the comprehensive SFTP/SCP file transfer protocol support implemented in the Console Automation MCP Server.

## Overview

The SFTP/SCP implementation provides production-ready file transfer capabilities with advanced features including:

- **Concurrent file transfers** with intelligent queuing
- **Progress tracking** with real-time bandwidth monitoring
- **Transfer resume capability** for interrupted transfers
- **Batch operations** with priority handling
- **Directory synchronization** with conflict resolution
- **Comprehensive error handling** and automatic recovery
- **Bandwidth throttling** and adaptive compression
- **File integrity verification** with checksums
- **Connection pooling** and keep-alive management

## Architecture

### Core Components

1. **SFTPProtocol.ts** - Main protocol implementation
2. **ConsoleManager.ts** - Integration layer
3. **Type Definitions** - Comprehensive TypeScript interfaces
4. **Event System** - Real-time progress and error reporting

### Dependencies

```json
{
  "ssh2-sftp-client": "^10.0.3",
  "@types/ssh2-sftp-client": "^9.0.3"
}
```

## Usage

### Creating an SFTP Session

```typescript
import { ConsoleManager } from './src/core/ConsoleManager.js';

const consoleManager = new ConsoleManager();

const sessionId = await consoleManager.createSession({
  command: 'sftp',
  consoleType: 'sftp',
  sshOptions: {
    host: 'your-server.com',
    port: 22,
    username: 'username',
    privateKeyPath: '/path/to/private/key',
    // or use password: 'your-password',
    timeout: 30000,
    keepAliveInterval: 30000
  }
});
```

### File Upload

```typescript
const uploadProgress = await consoleManager.uploadFile(
  sessionId,
  '/local/path/file.txt',
  '/remote/path/file.txt',
  {
    preservePermissions: true,
    preserveTimestamps: true,
    overwrite: true,
    createDirectories: true,
    checksumVerification: true,
    resumeSupport: true,
    bandwidth: 1024 * 1024 * 10, // 10 MB/s limit
    priority: 'high',
    retryAttempts: 3
  }
);
```

### File Download

```typescript
const downloadProgress = await consoleManager.downloadFile(
  sessionId,
  '/remote/path/data.txt',
  '/local/path/data.txt',
  {
    createDirectories: true,
    checksumVerification: true,
    resumeSupport: true
  }
);
```

### Batch Transfer

```typescript
const batchTransfers = [
  {
    source: '/local/file1.txt',
    destination: '/remote/file1.txt',
    priority: 'high'
  },
  {
    source: '/local/file2.txt',
    destination: '/remote/file2.txt',
    priority: 'normal'
  }
];

const batchResult = await consoleManager.batchTransfer(sessionId, batchTransfers);
```

### Directory Synchronization

```typescript
const syncResult = await consoleManager.synchronizeDirectories(
  sessionId,
  '/local/sync/directory',
  '/remote/sync/directory',
  {
    direction: 'bidirectional', // 'push', 'pull', 'bidirectional'
    syncMode: 'hybrid', // 'timestamp', 'checksum', 'size', 'hybrid'
    conflictResolution: 'newer', // 'newer', 'larger', 'local', 'remote', 'prompt', 'skip'
    deleteExtraneous: false,
    excludePatterns: ['*.tmp', '*.log'],
    includePatterns: ['*.txt', '*.json'],
    recursive: true,
    preservePermissions: true,
    dryRun: false
  }
);
```

## Advanced Features

### Progress Monitoring

```typescript
consoleManager.on('sftp-transfer-progress', (data) => {
  const progress = data.progress;
  console.log(`Transfer: ${progress.percentage.toFixed(1)}%`);
  console.log(`Speed: ${(progress.speed / 1024 / 1024).toFixed(2)} MB/s`);
  console.log(`ETA: ${progress.eta} seconds`);
});

consoleManager.on('sftp-transfer-completed', (data) => {
  console.log(`Completed: ${data.progress.transferId}`);
});

consoleManager.on('sftp-transfer-failed', (data) => {
  console.error(`Failed: ${data.progress.error}`);
});
```

### Transfer Control

```typescript
// Pause transfer
await consoleManager.pauseTransfer(sessionId, transferId);

// Resume transfer
await consoleManager.resumeTransfer(sessionId, transferId);

// Cancel transfer
await consoleManager.cancelTransfer(sessionId, transferId);
```

### Connection State Monitoring

```typescript
const connectionState = consoleManager.getSFTPConnectionState(sessionId);
console.log({
  isConnected: connectionState.isConnected,
  serverVersion: connectionState.serverInfo.version,
  activeTransfers: connectionState.activeTransfers,
  totalBytes: connectionState.transferStats.totalBytes,
  averageSpeed: connectionState.transferStats.averageSpeed
});
```

### Directory Operations

```typescript
const sftpProtocol = consoleManager.getSFTPProtocol(sessionId);

// List directory contents
const listing = await sftpProtocol.directories.list('/remote/path');

// Create directory
await sftpProtocol.directories.create('/remote/new/path', 0o755, true);

// Remove directory
await sftpProtocol.directories.remove('/remote/path', true);

// Check if path exists
const exists = await sftpProtocol.directories.exists('/remote/path');

// Get file/directory information
const fileInfo = await sftpProtocol.directories.stat('/remote/file.txt');

// Change permissions
await sftpProtocol.directories.chmod('/remote/file.txt', 0o644);
```

### File Operations

```typescript
// Check if file exists
const exists = await sftpProtocol.files.exists('/remote/file.txt');

// Copy file (server-side)
await sftpProtocol.files.copy('/remote/source.txt', '/remote/dest.txt');

// Move/rename file
await sftpProtocol.files.move('/remote/old.txt', '/remote/new.txt');

// Delete file
await sftpProtocol.files.remove('/remote/file.txt');

// Compare local and remote files
const comparison = await sftpProtocol.files.compare(
  '/local/file.txt',
  '/remote/file.txt'
);
```

## Configuration Options

### SFTP Session Options

```typescript
interface SFTPSessionOptions extends SSHConnectionOptions {
  maxConcurrentTransfers?: number;          // Default: 3
  transferQueue?: {
    maxSize: number;                        // Default: 100
    priorityLevels: number;                 // Default: 4
    timeoutMs: number;                      // Default: 300000 (5 minutes)
  };
  bandwidth?: {
    uploadLimit?: number;                   // bytes per second
    downloadLimit?: number;                 // bytes per second
    adaptiveThrottling?: boolean;           // Default: true
  };
  resumeDirectory?: string;                 // Resume data storage
  tempDirectory?: string;                   // Temporary files
  compressionLevel?: number;                // 0-9, Default: 6
  keepAlive?: {
    enabled: boolean;                       // Default: true
    interval: number;                       // Default: 30000ms
    maxMissed: number;                      // Default: 3
  };
}
```

### Transfer Options

```typescript
interface SFTPTransferOptions {
  source: string;
  destination: string;
  recursive?: boolean;                      // For directories
  preservePermissions?: boolean;            // Default: true
  preserveTimestamps?: boolean;            // Default: true
  overwrite?: boolean;                     // Default: false
  createDirectories?: boolean;             // Default: true
  followSymlinks?: boolean;                // Default: false
  compression?: boolean;                   // Default: true
  bandwidth?: number;                      // bytes per second limit
  priority?: 'low' | 'normal' | 'high' | 'critical'; // Default: 'normal'
  retryAttempts?: number;                  // Default: 3
  resumeSupport?: boolean;                 // Default: true
  checksumVerification?: boolean;          // Default: false
}
```

## Error Handling

The implementation includes comprehensive error handling:

### Automatic Recovery

- **Connection failures**: Automatic reconnection with exponential backoff
- **Transfer interruptions**: Resume capability with progress preservation
- **Network issues**: Retry logic with configurable attempts
- **Authentication problems**: Re-authentication support

### Error Classification

```typescript
// Retryable errors (automatic retry)
- Network timeouts
- Connection resets
- Temporary server issues

// Non-retryable errors (immediate failure)
- Authentication failures
- Permission denied
- File not found
- Disk space issues
```

### Custom Error Handling

```typescript
consoleManager.on('sftp-error', (data) => {
  const { sessionId, error } = data;
  
  if (error.code === 'ECONNRESET') {
    // Handle connection reset
    console.log('Connection reset, will retry automatically');
  } else if (error.code === 'EACCES') {
    // Handle permission error
    console.error('Permission denied:', error.message);
  }
});

consoleManager.on('sftp-retry-attempted', (data) => {
  console.log(`Retry attempt ${data.attemptNumber} for ${data.operation}`);
});
```

## Performance Optimization

### Bandwidth Management

```typescript
// Configure bandwidth limits
const sessionOptions = {
  // ... other options
  bandwidth: {
    uploadLimit: 1024 * 1024 * 10,      // 10 MB/s upload limit
    downloadLimit: 1024 * 1024 * 20,    // 20 MB/s download limit
    adaptiveThrottling: true             // Adjust based on network conditions
  }
};
```

### Concurrent Transfers

```typescript
// Optimize for your use case
const sessionOptions = {
  maxConcurrentTransfers: 5,  // More transfers for small files
  transferQueue: {
    maxSize: 200,             // Larger queue for batch operations
    priorityLevels: 4,        // Priority-based processing
    timeoutMs: 600000         // 10-minute timeout for large files
  }
};
```

### Compression

```typescript
// Adjust compression level (0-9)
const sessionOptions = {
  compressionLevel: 9,  // Maximum compression (slower, smaller)
  // compressionLevel: 0,  // No compression (faster, larger)
  // compressionLevel: 6,  // Balanced (default)
};
```

## Security Considerations

### Authentication

```typescript
// Recommended: Use SSH key authentication
const sessionOptions = {
  sshOptions: {
    privateKeyPath: '/path/to/private/key',
    passphrase: 'key-passphrase',  // If key is encrypted
    strictHostKeyChecking: true,   // Verify server identity
    knownHostsFile: '/path/to/known_hosts'
  }
};

// Alternative: Password authentication (less secure)
const sessionOptions = {
  sshOptions: {
    password: 'your-password',
    strictHostKeyChecking: true
  }
};
```

### File Integrity

```typescript
// Enable checksum verification for critical files
const transferOptions = {
  checksumVerification: true,  // Verify file integrity
  preservePermissions: true,   // Maintain file permissions
  preserveTimestamps: true     // Maintain timestamps
};
```

## SCP Support

SCP (Secure Copy Protocol) is supported as a simplified interface that uses the SFTP implementation internally:

```typescript
// Create SCP session
const sessionId = await consoleManager.createSession({
  command: 'scp',
  consoleType: 'scp',
  sshOptions: {
    host: 'server.com',
    username: 'user',
    privateKeyPath: '/path/to/key'
  }
});

// SCP-style operations (simplified interface)
await consoleManager.uploadFile(sessionId, '/local/file', '/remote/file', {
  preserveAttributes: true,  // SCP equivalent of -p flag
  recursive: true           // SCP equivalent of -r flag
});
```

## Monitoring and Metrics

### Built-in Metrics

The SFTP implementation automatically collects:

- Transfer statistics (bytes, speed, success rate)
- Connection health metrics
- Queue performance data
- Error rates and types

### Integration with Monitoring Systems

```typescript
// Get detailed metrics
const fileTransferSession = consoleManager.getFileTransferSession(sessionId);
console.log({
  totalTransfers: fileTransferSession.transferStats.totalTransfers,
  successfulTransfers: fileTransferSession.transferStats.successfulTransfers,
  failedTransfers: fileTransferSession.transferStats.failedTransfers,
  totalBytesTransferred: fileTransferSession.transferStats.totalBytesTransferred,
  averageSpeed: fileTransferSession.transferStats.averageSpeed
});
```

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   ```typescript
   // Increase timeout values
   sshOptions: {
     timeout: 60000,           // 60 seconds
     keepAliveInterval: 15000  // 15 seconds
   }
   ```

2. **Permission Errors**
   ```typescript
   // Ensure proper file permissions and ownership
   transferOptions: {
     preservePermissions: false,  // Don't preserve permissions
     createDirectories: true      // Create missing directories
   }
   ```

3. **Large File Transfers**
   ```typescript
   // Optimize for large files
   transferOptions: {
     resumeSupport: true,      // Enable resume capability
     checksumVerification: false,  // Disable for speed
     bandwidth: 0              // Remove bandwidth limits
   }
   ```

4. **Memory Issues**
   ```typescript
   // Reduce concurrent transfers
   sessionOptions: {
     maxConcurrentTransfers: 2,  // Reduce memory usage
     transferQueue: {
       maxSize: 50               // Smaller queue
     }
   }
   ```

## Examples

Complete examples are available in:
- `examples/sftp-usage-example.ts` - Comprehensive usage examples
- `test/integration/sftp.test.ts` - Integration tests
- `docs/SFTP_RECIPES.md` - Common use case recipes

## API Reference

### ConsoleManager SFTP Methods

- `createSession(options)` - Create SFTP/SCP session
- `uploadFile(sessionId, local, remote, options)` - Upload file
- `downloadFile(sessionId, remote, local, options)` - Download file
- `batchTransfer(sessionId, transfers)` - Batch transfer
- `synchronizeDirectories(sessionId, local, remote, options)` - Sync directories
- `getSFTPProtocol(sessionId)` - Get SFTP protocol instance
- `getSFTPConnectionState(sessionId)` - Get connection state
- `cancelTransfer(sessionId, transferId)` - Cancel transfer
- `pauseTransfer(sessionId, transferId)` - Pause transfer
- `resumeTransfer(sessionId, transferId)` - Resume transfer

### SFTPProtocol Methods

- `connect()` - Establish connection
- `disconnect()` - Close connection
- `uploadFile(local, remote, options)` - Upload file
- `downloadFile(remote, local, options)` - Download file
- `batchTransfer(transfers)` - Batch operations
- `synchronizeDirectories(local, remote, options)` - Directory sync
- `getConnectionState()` - Connection information
- `directories.*` - Directory operations
- `files.*` - File operations

This implementation provides enterprise-grade file transfer capabilities with comprehensive error handling, monitoring, and performance optimization features.