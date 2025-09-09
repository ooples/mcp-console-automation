/**
 * SFTP/SCP File Transfer Example
 * 
 * This example demonstrates how to use the SFTP/SCP protocol support
 * in the console automation MCP server for file transfers.
 */

import { ConsoleManager } from '../src/core/ConsoleManager.js';
import { SFTPSessionOptions, SFTPTransferOptions } from '../src/types/index.js';

async function sftpExample() {
  const consoleManager = new ConsoleManager();

  try {
    console.log('=== SFTP File Transfer Example ===\n');

    // Create SFTP session
    const sessionId = await consoleManager.createSession({
      command: 'sftp',
      consoleType: 'sftp',
      sshOptions: {
        host: 'example.com',
        port: 22,
        username: 'myuser',
        // Use privateKeyPath or password for authentication
        privateKeyPath: '/path/to/private/key',
        // password: 'mypassword',
        timeout: 30000,
        keepAliveInterval: 30000
      }
    });

    console.log(`SFTP session created: ${sessionId}`);

    // Upload a single file
    console.log('\n1. Uploading file...');
    const uploadOptions: SFTPTransferOptions = {
      source: '/local/path/file.txt',
      destination: '/remote/path/file.txt',
      preservePermissions: true,
      preserveTimestamps: true,
      overwrite: true,
      createDirectories: true,
      checksumVerification: true,
      resumeSupport: true
    };

    const uploadProgress = await consoleManager.uploadFile(
      sessionId,
      uploadOptions.source,
      uploadOptions.destination,
      uploadOptions
    );

    console.log(`Upload completed:`, {
      transferId: uploadProgress.transferId,
      bytesTransferred: uploadProgress.transferredBytes,
      speed: `${(uploadProgress.speed / 1024 / 1024).toFixed(2)} MB/s`,
      status: uploadProgress.status
    });

    // Download a file
    console.log('\n2. Downloading file...');
    const downloadProgress = await consoleManager.downloadFile(
      sessionId,
      '/remote/path/data.txt',
      '/local/path/downloaded_data.txt',
      {
        createDirectories: true,
        checksumVerification: true,
        bandwidth: 1024 * 1024 * 10 // 10 MB/s limit
      }
    );

    console.log(`Download completed:`, {
      transferId: downloadProgress.transferId,
      bytesTransferred: downloadProgress.transferredBytes,
      status: downloadProgress.status
    });

    // Batch transfer multiple files
    console.log('\n3. Batch transfer...');
    const batchTransfers: SFTPTransferOptions[] = [
      {
        source: '/local/dir/file1.txt',
        destination: '/remote/dir/file1.txt',
        priority: 'high'
      },
      {
        source: '/local/dir/file2.txt',
        destination: '/remote/dir/file2.txt',
        priority: 'normal'
      },
      {
        source: '/remote/dir/file3.txt',
        destination: '/local/dir/file3.txt',
        priority: 'high'
      }
    ];

    const batchResult = await consoleManager.batchTransfer(sessionId, batchTransfers);
    console.log(`Batch transfer:`, {
      batchId: batchResult.batchId,
      totalTransfers: batchResult.totalTransfers,
      completedTransfers: batchResult.completedTransfers,
      failedTransfers: batchResult.failedTransfers,
      overallProgress: `${batchResult.overallProgress.toFixed(1)}%`
    });

    // Directory synchronization
    console.log('\n4. Directory synchronization...');
    const syncResult = await consoleManager.synchronizeDirectories(
      sessionId,
      '/local/sync/directory',
      '/remote/sync/directory',
      {
        direction: 'bidirectional',
        syncMode: 'hybrid',
        conflictResolution: 'newer',
        deleteExtraneous: false,
        excludePatterns: ['*.tmp', '*.log'],
        dryRun: false,
        preservePermissions: true,
        recursive: true
      }
    );

    console.log(`Synchronization completed:`, {
      syncId: syncResult.syncId,
      filesTransferred: syncResult.summary.filesTransferred,
      filesSkipped: syncResult.summary.filesSkipped,
      totalBytes: `${(syncResult.summary.totalBytes / 1024 / 1024).toFixed(2)} MB`,
      transferTime: `${(syncResult.summary.transferTime / 1000).toFixed(2)} seconds`,
      conflicts: syncResult.summary.conflicts
    });

    // Get connection state and statistics
    console.log('\n5. Connection statistics...');
    const connectionState = consoleManager.getSFTPConnectionState(sessionId);
    console.log(`Connection state:`, {
      isConnected: connectionState.isConnected,
      serverVersion: connectionState.serverInfo.version,
      activeTransfers: connectionState.activeTransfers,
      queuedTransfers: connectionState.queuedTransfers,
      totalUploads: connectionState.transferStats.totalUploads,
      totalDownloads: connectionState.transferStats.totalDownloads,
      totalBytes: `${(connectionState.transferStats.totalBytes / 1024 / 1024).toFixed(2)} MB`,
      averageSpeed: `${(connectionState.transferStats.averageSpeed / 1024 / 1024).toFixed(2)} MB/s`
    });

    // Directory operations
    console.log('\n6. Directory operations...');
    const sftpProtocol = consoleManager.getSFTPProtocol(sessionId);
    if (sftpProtocol) {
      // List directory contents
      const listing = await sftpProtocol.directories.list('/remote/path');
      console.log(`Directory listing:`, {
        path: listing.path,
        totalFiles: listing.totalFiles,
        totalDirectories: listing.totalDirectories,
        totalSize: `${(listing.totalSize / 1024 / 1024).toFixed(2)} MB`
      });

      // Create directory
      await sftpProtocol.directories.create('/remote/new/directory', undefined, true);
      console.log('Directory created: /remote/new/directory');

      // Check if file exists
      const fileExists = await sftpProtocol.files.exists('/remote/path/file.txt');
      console.log(`File exists: ${fileExists}`);

      // Get file information
      if (fileExists) {
        const fileInfo = await sftpProtocol.directories.stat('/remote/path/file.txt');
        console.log(`File info:`, {
          name: fileInfo.name,
          size: `${(fileInfo.size / 1024).toFixed(2)} KB`,
          type: fileInfo.type,
          modified: fileInfo.mtime.toISOString()
        });
      }
    }

    console.log('\n=== SFTP Example Completed Successfully ===');

  } catch (error) {
    console.error('SFTP Example Error:', error);
  } finally {
    // Clean up
    await consoleManager.stopSession(sessionId);
    console.log('SFTP session closed');
  }
}

async function scpExample() {
  console.log('\n=== SCP File Transfer Example ===\n');
  
  const consoleManager = new ConsoleManager();

  try {
    // Create SCP session (uses SFTP protocol internally for better functionality)
    const sessionId = await consoleManager.createSession({
      command: 'scp',
      consoleType: 'scp',
      sshOptions: {
        host: 'example.com',
        port: 22,
        username: 'myuser',
        privateKeyPath: '/path/to/private/key',
        timeout: 30000
      }
    });

    console.log(`SCP session created: ${sessionId}`);

    // SCP-style file copy (upload)
    const uploadResult = await consoleManager.uploadFile(
      sessionId,
      '/local/file.txt',
      '/remote/file.txt',
      {
        preserveAttributes: true,
        overwrite: true
      }
    );

    console.log(`SCP upload completed: ${uploadResult.status}`);

    // SCP-style file copy (download)
    const downloadResult = await consoleManager.downloadFile(
      sessionId,
      '/remote/data.txt',
      '/local/data.txt',
      {
        preserveAttributes: true
      }
    );

    console.log(`SCP download completed: ${downloadResult.status}`);

    console.log('\n=== SCP Example Completed Successfully ===');

  } catch (error) {
    console.error('SCP Example Error:', error);
  }
}

// Event handling example
function setupEventHandlers(consoleManager: ConsoleManager) {
  consoleManager.on('sftp-connected', (data) => {
    console.log(`SFTP Connected: ${data.sessionId}`);
  });

  consoleManager.on('sftp-transfer-progress', (data) => {
    const progress = data.progress;
    console.log(`Transfer Progress: ${progress.percentage.toFixed(1)}% - ${(progress.speed / 1024 / 1024).toFixed(2)} MB/s`);
  });

  consoleManager.on('sftp-transfer-completed', (data) => {
    console.log(`Transfer Completed: ${data.progress.transferId}`);
  });

  consoleManager.on('sftp-error', (data) => {
    console.error(`SFTP Error: ${data.error.message}`);
  });
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.all([
    sftpExample(),
    scpExample()
  ]).catch(console.error);
}

export { sftpExample, scpExample, setupEventHandlers };