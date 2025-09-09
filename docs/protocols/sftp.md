# SFTP Protocol

## Overview

The SFTP Protocol enables AI assistants to securely transfer files, manage remote directories, and perform file operations over SSH connections through the MCP Console Automation server. It provides comprehensive secure file management capabilities with support for various authentication methods and advanced features.

## Features

- **Secure File Transfer**: Encrypted file transfers over SSH
- **Multiple Authentication**: Password, key-based, and agent authentication
- **Directory Management**: Create, list, and manage remote directories
- **File Operations**: Upload, download, rename, delete, and set permissions
- **Batch Operations**: Multiple file transfers with progress tracking
- **Resume Support**: Resume interrupted transfers
- **Compression**: Optional data compression for faster transfers
- **Symbolic Links**: Support for symbolic link operations
- **File Integrity**: Checksum verification for transferred files

## Prerequisites

- SSH server with SFTP subsystem enabled
- Network connectivity to target server
- Valid authentication credentials
- Appropriate file system permissions

### Server Requirements

#### Linux/Unix SFTP Server
```bash
# Install OpenSSH server
sudo apt-get install openssh-server

# Enable SFTP subsystem in /etc/ssh/sshd_config
Subsystem sftp /usr/lib/openssh/sftp-server

# Optional: Restrict users to SFTP only
Match User sftpuser
    ForceCommand internal-sftp
    PasswordAuthentication yes
    ChrootDirectory /var/sftp
    PermitTunnel no
    AllowAgentForwarding no
    AllowTcpForwarding no
    X11Forwarding no

sudo systemctl restart ssh
```

#### Windows SFTP Server
- Install OpenSSH Server feature
- Or use third-party solutions like FileZilla Server, Bitvise SSH Server

## Configuration

### Basic Configuration

```typescript
const sftpConfig: SFTPProtocolConfig = {
  connection: {
    host: 'sftp.example.com',
    port: 22,
    username: 'user',
    password: 'password', // or use privateKey
    // privateKey: require('fs').readFileSync('/path/to/private/key'),
    // passphrase: 'key-passphrase'
  },
  options: {
    keepAliveInterval: 60000,
    readyTimeout: 30000,
    strictVendorChecking: false,
    compression: true,
    algorithms: {
      kex: ['diffie-hellman-group14-sha256', 'ecdh-sha2-nistp256'],
      cipher: ['aes128-gcm', 'aes256-gcm', 'aes128-ctr', 'aes256-ctr'],
      serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
      hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
    }
  },
  transfer: {
    concurrency: 3,
    chunkSize: 32768, // 32KB
    preserveTimestamps: true,
    preservePermissions: true,
    resumeSupport: true,
    checksumVerification: true
  }
};
```

### Advanced Configuration

```typescript
const advancedSFTPConfig: SFTPProtocolConfig = {
  connection: {
    host: 'secure-server.example.com',
    port: 2222,
    username: 'deployuser',
    privateKey: require('fs').readFileSync('/home/user/.ssh/id_rsa'),
    passphrase: process.env.SSH_KEY_PASSPHRASE,
    agent: process.env.SSH_AUTH_SOCK, // Use SSH agent
    agentForward: true
  },
  security: {
    hostVerification: true,
    knownHostsFile: '/home/user/.ssh/known_hosts',
    strictHostKeyChecking: true,
    allowInsecureConnection: false,
    maxAuthAttempts: 3,
    bannedCiphers: ['des', '3des', 'rc4'],
    requiredServerHostKeyAlgs: ['ssh-rsa', 'ssh-ed25519']
  },
  performance: {
    maxConcurrentTransfers: 5,
    transferTimeout: 300000, // 5 minutes
    chunkSize: 65536, // 64KB for high-speed networks
    windowSize: 2097152, // 2MB
    packetSize: 32768,
    compression: 'zlib@openssh.com'
  },
  retry: {
    maxAttempts: 3,
    backoffMultiplier: 2,
    initialDelay: 1000,
    maxDelay: 30000
  }
};
```

### Multi-Server Configuration

```typescript
const multiServerConfig = {
  servers: {
    production: {
      host: 'prod-sftp.example.com',
      port: 22,
      username: 'produser',
      privateKey: '/keys/prod_key',
      basePath: '/var/www/production'
    },
    staging: {
      host: 'staging-sftp.example.com', 
      port: 22,
      username: 'stageuser',
      privateKey: '/keys/staging_key',
      basePath: '/var/www/staging'
    },
    development: {
      host: 'dev-sftp.example.com',
      port: 22,
      username: 'devuser',
      password: 'devpass123',
      basePath: '/var/www/development'
    }
  },
  defaultServer: 'development'
};
```

## Usage Examples

### 1. Basic File Operations

```javascript
// Connect to SFTP server
const sftpSession = await console_create_session({
  command: 'sftp-connect',
  consoleType: 'sftp',
  sftpOptions: {
    host: 'files.example.com',
    port: 22,
    username: 'fileuser',
    password: 'secure123'
  }
});

// Upload a file
await console_execute_command({
  command: 'sftp-put',
  args: ['local-file.txt', 'remote-file.txt'],
  consoleType: 'sftp',
  sessionId: sftpSession.sessionId
});

// Download a file
await console_execute_command({
  command: 'sftp-get',
  args: ['remote-file.txt', 'downloaded-file.txt'],
  consoleType: 'sftp',
  sessionId: sftpSession.sessionId
});

// List remote directory
const listResult = await console_execute_command({
  command: 'sftp-ls',
  args: ['/home/user/documents'],
  consoleType: 'sftp',
  sessionId: sftpSession.sessionId
});

console.log('Remote files:', listResult.output);

// Create directory
await console_execute_command({
  command: 'sftp-mkdir',
  args: ['/home/user/backup'],
  consoleType: 'sftp',
  sessionId: sftpSession.sessionId
});
```

### 2. Web Application Deployment

```javascript
// Deploy web application to production server
async function deployApplication(version) {
  const deploySession = await console_create_session({
    command: 'sftp-connect',
    consoleType: 'sftp',
    sftpOptions: {
      host: 'web-server.example.com',
      port: 22,
      username: 'webdeploy',
      privateKey: '/keys/deploy_key',
      basePath: '/var/www/html'
    }
  });

  try {
    // Create backup of current version
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await console_execute_command({
      command: 'sftp-mkdir',
      args: [`backups/backup-${timestamp}`],
      consoleType: 'sftp',
      sessionId: deploySession.sessionId
    });

    // Backup current files
    await console_execute_command({
      command: 'sftp-get-recursive',
      args: ['current/', `backups/backup-${timestamp}/`],
      consoleType: 'sftp',
      sessionId: deploySession.sessionId
    });

    // Upload new version
    console.log('Uploading new application version...');
    
    const uploadResult = await console_execute_command({
      command: 'sftp-put-recursive',
      args: [`builds/${version}/`, 'staging/'],
      consoleType: 'sftp',
      sessionId: deploySession.sessionId,
      options: {
        preserveTimestamps: true,
        overwrite: true,
        excludePatterns: ['*.log', '*.tmp', 'node_modules/']
      }
    });

    if (uploadResult.exitCode === 0) {
      console.log('Upload successful, activating new version...');
      
      // Atomic swap - rename directories
      await console_execute_command({
        command: 'sftp-rename',
        args: ['current', `old-${timestamp}`],
        consoleType: 'sftp',
        sessionId: deploySession.sessionId
      });

      await console_execute_command({
        command: 'sftp-rename', 
        args: ['staging', 'current'],
        consoleType: 'sftp',
        sessionId: deploySession.sessionId
      });

      console.log(`Deployment of version ${version} completed successfully`);
    } else {
      throw new Error('Upload failed');
    }

  } catch (error) {
    console.error('Deployment failed:', error.message);
    
    // Rollback if necessary
    console.log('Initiating rollback...');
    await rollbackDeployment(deploySession.sessionId, timestamp);
    
    throw error;
  } finally {
    await console_stop_session({
      sessionId: deploySession.sessionId
    });
  }
}

// Monitor deployment progress
protocol.on('transfer-progress', (progress, session) => {
  const percent = ((progress.transferred / progress.total) * 100).toFixed(1);
  console.log(`Transfer progress: ${percent}% (${progress.filename})`);
});

protocol.on('transfer-complete', (result, session) => {
  console.log(`File transfer completed: ${result.filename} (${result.size} bytes)`);
});
```

### 3. Automated Backup System

```javascript
// Automated backup system
async function performBackup() {
  const backupSession = await console_create_session({
    command: 'sftp-connect',
    consoleType: 'sftp',
    sftpOptions: {
      host: 'backup-server.example.com',
      port: 22,
      username: 'backupuser',
      privateKey: '/keys/backup_key'
    }
  });

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const backupPath = `/backups/${timestamp}`;

  try {
    // Create backup directory
    await console_execute_command({
      command: 'sftp-mkdir-recursive',
      args: [backupPath],
      consoleType: 'sftp',
      sessionId: backupSession.sessionId
    });

    // Define backup sets
    const backupSets = [
      {
        name: 'databases',
        source: '/var/backups/databases',
        destination: `${backupPath}/databases`,
        compress: true
      },
      {
        name: 'configurations',
        source: '/etc',
        destination: `${backupPath}/configurations`,
        excludePatterns: ['*.log', 'cache/*', 'tmp/*']
      },
      {
        name: 'user-data',
        source: '/home',
        destination: `${backupPath}/user-data`,
        includePatterns: ['*.doc*', '*.pdf', '*.jpg', '*.png']
      }
    ];

    // Perform backups
    for (const backupSet of backupSets) {
      console.log(`Starting backup: ${backupSet.name}`);
      
      const backupResult = await console_execute_command({
        command: 'sftp-put-recursive',
        args: [backupSet.source, backupSet.destination],
        consoleType: 'sftp',
        sessionId: backupSession.sessionId,
        options: {
          compress: backupSet.compress || false,
          excludePatterns: backupSet.excludePatterns || [],
          includePatterns: backupSet.includePatterns || [],
          preserveTimestamps: true,
          checksumVerification: true
        }
      });

      if (backupResult.exitCode === 0) {
        console.log(`Backup completed: ${backupSet.name}`);
      } else {
        console.error(`Backup failed: ${backupSet.name} - ${backupResult.stderr}`);
      }
    }

    // Generate backup manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      backupSets: backupSets,
      totalSize: await getTotalBackupSize(backupSession.sessionId, backupPath),
      checksums: await generateChecksums(backupSession.sessionId, backupPath)
    };

    // Upload manifest
    const manifestContent = JSON.stringify(manifest, null, 2);
    await console_execute_command({
      command: 'sftp-put-content',
      args: [manifestContent, `${backupPath}/manifest.json`],
      consoleType: 'sftp',
      sessionId: backupSession.sessionId
    });

    console.log(`Backup completed successfully: ${backupPath}`);

    // Cleanup old backups (keep last 7 days)
    await cleanupOldBackups(backupSession.sessionId, 7);

  } catch (error) {
    console.error('Backup failed:', error.message);
    
    // Send alert notification
    await sendBackupAlert('FAILED', error.message);
    
  } finally {
    await console_stop_session({
      sessionId: backupSession.sessionId
    });
  }
}

// Run backup daily at 2 AM
const backupSchedule = require('node-cron');
backupSchedule.schedule('0 2 * * *', performBackup);
```

### 4. Log File Management

```javascript
// Collect and archive log files from multiple servers
async function collectLogs(dateRange) {
  const servers = [
    { name: 'web-server-1', host: 'web1.example.com' },
    { name: 'web-server-2', host: 'web2.example.com' },
    { name: 'api-server', host: 'api.example.com' },
    { name: 'database-server', host: 'db.example.com' }
  ];

  const logCollectionPath = `/logs/collection-${Date.now()}`;
  require('fs').mkdirSync(logCollectionPath, { recursive: true });

  for (const server of servers) {
    console.log(`Collecting logs from ${server.name}...`);

    try {
      const serverSession = await console_create_session({
        command: 'sftp-connect',
        consoleType: 'sftp',
        sftpOptions: {
          host: server.host,
          port: 22,
          username: 'logcollector',
          privateKey: '/keys/log_collector_key'
        }
      });

      // List available log files
      const logListResult = await console_execute_command({
        command: 'sftp-ls',
        args: ['/var/log', '--pattern=*.log', '--pattern=*.log.*'],
        consoleType: 'sftp',
        sessionId: serverSession.sessionId
      });

      const logFiles = parseFileList(logListResult.output);
      const filteredLogs = logFiles.filter(file => 
        isWithinDateRange(file.modifiedDate, dateRange.start, dateRange.end)
      );

      // Download log files
      for (const logFile of filteredLogs) {
        const localPath = `${logCollectionPath}/${server.name}_${logFile.name}`;
        
        await console_execute_command({
          command: 'sftp-get',
          args: [logFile.path, localPath],
          consoleType: 'sftp',
          sessionId: serverSession.sessionId,
          options: {
            compress: true, // Compress during transfer
            resume: true   // Resume if interrupted
          }
        });

        console.log(`Downloaded: ${logFile.name} from ${server.name}`);
      }

      await console_stop_session({
        sessionId: serverSession.sessionId
      });

    } catch (error) {
      console.error(`Failed to collect logs from ${server.name}:`, error.message);
    }
  }

  // Compress collected logs
  const archivePath = `${logCollectionPath}.tar.gz`;
  await console_execute_command({
    command: 'tar',
    args: ['-czf', archivePath, logCollectionPath]
  });

  console.log(`Log collection completed: ${archivePath}`);

  // Upload to central log storage
  await uploadToLogStorage(archivePath);
  
  // Cleanup temporary files
  require('fs').rmSync(logCollectionPath, { recursive: true });
}
```

### 5. Configuration Management

```javascript
// Synchronize configuration files across servers
async function syncConfigurations(environment) {
  const configMaster = {
    host: 'config-master.example.com',
    path: `/configs/${environment}`
  };

  const targetServers = [
    { name: 'web-1', host: 'web1.example.com', services: ['nginx', 'php-fpm'] },
    { name: 'web-2', host: 'web2.example.com', services: ['nginx', 'php-fpm'] },
    { name: 'api', host: 'api.example.com', services: ['api-server', 'redis'] },
    { name: 'db', host: 'db.example.com', services: ['mysql', 'backup'] }
  ];

  // Connect to configuration master
  const masterSession = await console_create_session({
    command: 'sftp-connect',
    consoleType: 'sftp',
    sftpOptions: {
      host: configMaster.host,
      port: 22,
      username: 'configadmin',
      privateKey: '/keys/config_key'
    }
  });

  // Get configuration manifest
  const manifestResult = await console_execute_command({
    command: 'sftp-get-content',
    args: [`${configMaster.path}/manifest.json`],
    consoleType: 'sftp',
    sessionId: masterSession.sessionId
  });

  const configManifest = JSON.parse(manifestResult.output);

  // Sync configurations to each server
  for (const server of targetServers) {
    console.log(`Syncing configurations to ${server.name}...`);

    try {
      const serverSession = await console_create_session({
        command: 'sftp-connect',
        consoleType: 'sftp',
        sftpOptions: {
          host: server.host,
          port: 22,
          username: 'configsync',
          privateKey: '/keys/sync_key'
        }
      });

      // Download current configurations for backup
      const backupPath = `/tmp/config-backup-${Date.now()}`;
      await console_execute_command({
        command: 'sftp-get-recursive',
        args: ['/etc/services/', backupPath],
        consoleType: 'sftp',
        sessionId: serverSession.sessionId
      });

      // Sync relevant configurations
      for (const service of server.services) {
        if (configManifest.services[service]) {
          const serviceConfig = configManifest.services[service];
          
          for (const configFile of serviceConfig.files) {
            // Download from master
            const tempFile = `/tmp/${configFile.name}`;
            await console_execute_command({
              command: 'sftp-get',
              args: [`${configMaster.path}/${service}/${configFile.path}`, tempFile],
              consoleType: 'sftp',
              sessionId: masterSession.sessionId
            });

            // Upload to target server
            await console_execute_command({
              command: 'sftp-put',
              args: [tempFile, configFile.targetPath],
              consoleType: 'sftp',
              sessionId: serverSession.sessionId,
              options: {
                preservePermissions: true,
                backup: true
              }
            });

            // Verify checksum
            const checksumResult = await console_execute_command({
              command: 'sftp-checksum',
              args: [configFile.targetPath, 'sha256'],
              consoleType: 'sftp',
              sessionId: serverSession.sessionId
            });

            if (checksumResult.output.trim() === configFile.checksum) {
              console.log(`✓ ${service}/${configFile.name} synced successfully`);
            } else {
              console.error(`✗ ${service}/${configFile.name} checksum mismatch`);
            }

            // Cleanup temp file
            require('fs').unlinkSync(tempFile);
          }

          // Restart service if needed
          if (serviceConfig.restartRequired) {
            console.log(`Restarting ${service} service...`);
            // This would be done via SSH, not SFTP
            // await restartService(server.host, service);
          }
        }
      }

      await console_stop_session({
        sessionId: serverSession.sessionId
      });

      console.log(`Configuration sync completed for ${server.name}`);

    } catch (error) {
      console.error(`Configuration sync failed for ${server.name}:`, error.message);
    }
  }

  await console_stop_session({
    sessionId: masterSession.sessionId
  });
}
```

### 6. File Monitoring and Synchronization

```javascript
// Monitor and sync files between local and remote locations
class SFTPFileSyncer {
  constructor(localPath, remotePath, sftpConfig) {
    this.localPath = localPath;
    this.remotePath = remotePath;
    this.sftpConfig = sftpConfig;
    this.session = null;
    this.watchedFiles = new Map();
    this.syncInterval = 30000; // 30 seconds
  }

  async initialize() {
    // Connect to SFTP
    this.session = await console_create_session({
      command: 'sftp-connect',
      consoleType: 'sftp',
      sftpOptions: this.sftpConfig
    });

    // Start file monitoring
    this.startFileMonitoring();
    
    // Start periodic sync
    this.startPeriodicSync();

    console.log('File syncer initialized');
  }

  startFileMonitoring() {
    const fs = require('fs');
    const chokidar = require('chokidar');

    const watcher = chokidar.watch(this.localPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false
    });

    watcher.on('change', async (filePath) => {
      console.log(`File changed: ${filePath}`);
      await this.syncFile(filePath, 'upload');
    });

    watcher.on('add', async (filePath) => {
      console.log(`File added: ${filePath}`);
      await this.syncFile(filePath, 'upload');
    });

    watcher.on('unlink', async (filePath) => {
      console.log(`File removed: ${filePath}`);
      await this.syncFile(filePath, 'delete');
    });
  }

  async syncFile(localFilePath, action) {
    try {
      const relativePath = path.relative(this.localPath, localFilePath);
      const remoteFilePath = path.posix.join(this.remotePath, relativePath);

      switch (action) {
        case 'upload':
          await console_execute_command({
            command: 'sftp-put',
            args: [localFilePath, remoteFilePath],
            consoleType: 'sftp',
            sessionId: this.session.sessionId,
            options: {
              createDirectories: true,
              preserveTimestamps: true
            }
          });
          
          console.log(`Uploaded: ${relativePath}`);
          break;

        case 'delete':
          await console_execute_command({
            command: 'sftp-rm',
            args: [remoteFilePath],
            consoleType: 'sftp',
            sessionId: this.session.sessionId
          });
          
          console.log(`Deleted remote: ${relativePath}`);
          break;
      }

    } catch (error) {
      console.error(`Sync failed for ${localFilePath}:`, error.message);
    }
  }

  startPeriodicSync() {
    setInterval(async () => {
      await this.performBidirectionalSync();
    }, this.syncInterval);
  }

  async performBidirectionalSync() {
    try {
      // Get local file list
      const localFiles = await this.getLocalFileList();
      
      // Get remote file list
      const remoteListResult = await console_execute_command({
        command: 'sftp-ls-recursive',
        args: [this.remotePath],
        consoleType: 'sftp',
        sessionId: this.session.sessionId
      });

      const remoteFiles = this.parseRemoteFileList(remoteListResult.output);

      // Compare and sync differences
      await this.syncDifferences(localFiles, remoteFiles);

    } catch (error) {
      console.error('Periodic sync failed:', error.message);
    }
  }

  async syncDifferences(localFiles, remoteFiles) {
    const localFileMap = new Map(localFiles.map(f => [f.relativePath, f]));
    const remoteFileMap = new Map(remoteFiles.map(f => [f.relativePath, f]));

    // Files that exist locally but not remotely (upload)
    for (const [relativePath, localFile] of localFileMap) {
      if (!remoteFileMap.has(relativePath)) {
        await this.syncFile(localFile.fullPath, 'upload');
      } else {
        // Check if local file is newer
        const remoteFile = remoteFileMap.get(relativePath);
        if (localFile.mtime > remoteFile.mtime) {
          await this.syncFile(localFile.fullPath, 'upload');
        }
      }
    }

    // Files that exist remotely but not locally (download)
    for (const [relativePath, remoteFile] of remoteFileMap) {
      if (!localFileMap.has(relativePath)) {
        await this.downloadFile(remoteFile);
      } else {
        // Check if remote file is newer
        const localFile = localFileMap.get(relativePath);
        if (remoteFile.mtime > localFile.mtime) {
          await this.downloadFile(remoteFile);
        }
      }
    }
  }

  async downloadFile(remoteFile) {
    const localFilePath = path.join(this.localPath, remoteFile.relativePath);
    const localDir = path.dirname(localFilePath);

    // Create local directory if it doesn't exist
    require('fs').mkdirSync(localDir, { recursive: true });

    await console_execute_command({
      command: 'sftp-get',
      args: [remoteFile.fullPath, localFilePath],
      consoleType: 'sftp',
      sessionId: this.session.sessionId,
      options: {
        preserveTimestamps: true
      }
    });

    console.log(`Downloaded: ${remoteFile.relativePath}`);
  }
}

// Usage
const syncer = new SFTPFileSyncer(
  '/local/project/files',
  '/remote/backup/files',
  {
    host: 'sync-server.example.com',
    username: 'syncuser',
    privateKey: '/keys/sync_key'
  }
);

await syncer.initialize();
```

## Advanced Features

### Resume Interrupted Transfers

```javascript
// Resume large file transfers
async function resumableUpload(localFile, remoteFile, sessionId) {
  try {
    // Check if partial file exists on remote
    const remoteStatResult = await console_execute_command({
      command: 'sftp-stat',
      args: [remoteFile],
      consoleType: 'sftp',
      sessionId: sessionId
    });

    const localStats = require('fs').statSync(localFile);
    let resumeFrom = 0;

    if (remoteStatResult.exitCode === 0) {
      const remoteStat = JSON.parse(remoteStatResult.output);
      resumeFrom = remoteStat.size;
      
      if (resumeFrom >= localStats.size) {
        console.log('File already fully transferred');
        return;
      }
    }

    // Upload with resume
    await console_execute_command({
      command: 'sftp-put',
      args: [localFile, remoteFile],
      consoleType: 'sftp',
      sessionId: sessionId,
      options: {
        resume: true,
        resumeFrom: resumeFrom
      }
    });

    console.log(`Upload completed (resumed from ${resumeFrom} bytes)`);

  } catch (error) {
    console.error('Resumable upload failed:', error.message);
    throw error;
  }
}
```

### Batch Operations with Progress

```javascript
// Upload multiple files with progress tracking
async function batchUpload(fileList, remotePath, sessionId) {
  const totalFiles = fileList.length;
  let completedFiles = 0;
  let totalBytes = 0;
  let transferredBytes = 0;

  // Calculate total size
  for (const file of fileList) {
    const stats = require('fs').statSync(file.localPath);
    totalBytes += stats.size;
  }

  console.log(`Starting batch upload: ${totalFiles} files (${formatBytes(totalBytes)})`);

  // Track progress
  protocol.on('transfer-progress', (progress, session) => {
    if (session.sessionId === sessionId) {
      const overallProgress = ((transferredBytes + progress.transferred) / totalBytes * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${overallProgress}% - ${progress.filename}`);
    }
  });

  protocol.on('transfer-complete', (result, session) => {
    if (session.sessionId === sessionId) {
      completedFiles++;
      transferredBytes += result.size;
      
      const overallProgress = (transferredBytes / totalBytes * 100).toFixed(1);
      console.log(`\n[${completedFiles}/${totalFiles}] ${result.filename} - ${overallProgress}% complete`);
    }
  });

  // Upload files with controlled concurrency
  const concurrency = 3;
  const batches = [];
  
  for (let i = 0; i < fileList.length; i += concurrency) {
    batches.push(fileList.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    const uploadPromises = batch.map(async (file) => {
      const remoteFile = path.posix.join(remotePath, file.relativePath);
      
      return console_execute_command({
        command: 'sftp-put',
        args: [file.localPath, remoteFile],
        consoleType: 'sftp',
        sessionId: sessionId,
        options: {
          createDirectories: true,
          preserveTimestamps: true,
          checksumVerification: true
        }
      });
    });

    await Promise.allSettled(uploadPromises);
  }

  console.log(`\nBatch upload completed: ${completedFiles}/${totalFiles} files`);
}

function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}
```

### File Integrity Verification

```javascript
// Verify file integrity after transfer
async function verifyFileIntegrity(localFile, remoteFile, sessionId, algorithm = 'sha256') {
  // Calculate local file checksum
  const localChecksum = await calculateLocalChecksum(localFile, algorithm);
  
  // Get remote file checksum
  const remoteChecksumResult = await console_execute_command({
    command: 'sftp-checksum',
    args: [remoteFile, algorithm],
    consoleType: 'sftp',
    sessionId: sessionId
  });

  if (remoteChecksumResult.exitCode !== 0) {
    throw new Error('Failed to calculate remote checksum');
  }

  const remoteChecksum = remoteChecksumResult.output.trim();

  if (localChecksum === remoteChecksum) {
    console.log(`✓ File integrity verified: ${path.basename(localFile)}`);
    return true;
  } else {
    console.error(`✗ File integrity check failed: ${path.basename(localFile)}`);
    console.error(`Local: ${localChecksum}`);
    console.error(`Remote: ${remoteChecksum}`);
    return false;
  }
}

async function calculateLocalChecksum(filePath, algorithm) {
  const crypto = require('crypto');
  const fs = require('fs');
  
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
```

## Error Handling

### Connection and Authentication Errors

```javascript
protocol.on('connection-error', (error, config) => {
  console.error(`SFTP connection failed to ${config.host}:${config.port}:`, error.message);
  
  if (error.level === 'client-authentication') {
    console.error('Authentication failed - check credentials');
  } else if (error.code === 'ENOTFOUND') {
    console.error('Host not found - check hostname and network connectivity');
  } else if (error.code === 'ECONNREFUSED') {
    console.error('Connection refused - check if SSH service is running');
  } else if (error.code === 'ETIMEDOUT') {
    console.error('Connection timeout - check network and firewall settings');
  }
});

protocol.on('authentication-error', (error, config) => {
  console.error(`Authentication failed for user ${config.username}@${config.host}`);
  
  if (config.privateKey) {
    console.log('Check private key path and passphrase');
  } else {
    console.log('Check username and password');
  }
});
```

### Transfer Errors

```javascript
protocol.on('transfer-error', async (error, operation, session) => {
  console.error(`Transfer error during ${operation.type}:`, error.message);
  
  if (error.code === 'ENOSPC') {
    console.error('No space left on device');
  } else if (error.code === 'EACCES') {
    console.error('Permission denied');
  } else if (error.code === 'EISDIR') {
    console.error('Target is a directory, expected file');
  } else if (error.message.includes('No such file')) {
    console.error('Source file not found');
    
    // Auto-retry after short delay
    setTimeout(async () => {
      try {
        await retryOperation(operation, session);
      } catch (retryError) {
        console.error('Retry failed:', retryError.message);
      }
    }, 5000);
  }
});

async function retryOperation(operation, session, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Retry attempt ${attempt}/${maxRetries} for ${operation.type}`);
      
      await console_execute_command({
        command: operation.command,
        args: operation.args,
        consoleType: 'sftp',
        sessionId: session.sessionId,
        options: operation.options
      });
      
      console.log('Retry successful');
      return;
      
    } catch (error) {
      console.error(`Retry attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}
```

## Best Practices

### 1. Security

```javascript
// Use key-based authentication
const secureConfig = {
  host: 'secure-server.com',
  username: 'deployuser',
  privateKey: require('fs').readFileSync('/secure/path/to/private/key'),
  passphrase: process.env.SSH_KEY_PASSPHRASE, // Store in environment
  algorithms: {
    kex: ['curve25519-sha256', 'diffie-hellman-group16-sha512'],
    cipher: ['chacha20-poly1305@openssh.com', 'aes256-gcm'],
    serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256'],
    hmac: ['umac-128-etm@openssh.com', 'hmac-sha2-256-etm@openssh.com']
  },
  hostVerification: true,
  strictHostKeyChecking: true
};

// Implement connection timeout
const connectionOptions = {
  readyTimeout: 30000,
  keepAliveInterval: 60000,
  keepAliveCountMax: 3
};

// Use secure file permissions
const transferOptions = {
  preservePermissions: true,
  mode: 0o600, // Read/write for owner only
  uid: 1000,   // Set appropriate user
  gid: 1000    // Set appropriate group
};
```

### 2. Performance

```javascript
// Optimize for your network conditions
const performanceConfig = {
  transfer: {
    concurrency: 5, // Adjust based on bandwidth
    chunkSize: 65536, // 64KB for high-speed networks
    windowSize: 2097152, // 2MB
    compression: true, // Enable for slow connections
    packetSize: 32768
  },
  retry: {
    maxAttempts: 3,
    backoffMultiplier: 1.5,
    initialDelay: 1000,
    maxDelay: 30000
  }
};

// Use connection pooling for multiple operations
class SFTPConnectionPool {
  constructor(config, maxConnections = 5) {
    this.config = config;
    this.maxConnections = maxConnections;
    this.availableConnections = [];
    this.busyConnections = new Set();
  }

  async getConnection() {
    if (this.availableConnections.length > 0) {
      const connection = this.availableConnections.pop();
      this.busyConnections.add(connection);
      return connection;
    }

    if (this.busyConnections.size < this.maxConnections) {
      const connection = await this.createConnection();
      this.busyConnections.add(connection);
      return connection;
    }

    // Wait for connection to become available
    return new Promise((resolve) => {
      const checkForConnection = () => {
        if (this.availableConnections.length > 0) {
          const connection = this.availableConnections.pop();
          this.busyConnections.add(connection);
          resolve(connection);
        } else {
          setTimeout(checkForConnection, 100);
        }
      };
      checkForConnection();
    });
  }

  releaseConnection(connection) {
    this.busyConnections.delete(connection);
    this.availableConnections.push(connection);
  }
}
```

### 3. Monitoring and Logging

```javascript
// Comprehensive logging
const logger = require('winston').createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'sftp-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'sftp-combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Monitor transfer statistics
protocol.on('transfer-complete', (result, session) => {
  logger.info('Transfer completed', {
    filename: result.filename,
    size: result.size,
    duration: result.duration,
    speed: result.speed,
    sessionId: session.sessionId,
    remoteHost: session.config.host
  });
});

// Track connection health
protocol.on('connection-established', (config) => {
  logger.info('SFTP connection established', {
    host: config.host,
    username: config.username,
    timestamp: new Date().toISOString()
  });
});
```

## Troubleshooting

### Common Issues

#### 1. Permission Denied
```javascript
// Check file permissions
const statResult = await console_execute_command({
  command: 'sftp-stat',
  args: ['/path/to/file'],
  consoleType: 'sftp',
  sessionId: sessionId
});

console.log('File permissions:', JSON.parse(statResult.output));

// Fix permissions if needed
await console_execute_command({
  command: 'sftp-chmod',
  args: ['644', '/path/to/file'],
  consoleType: 'sftp',
  sessionId: sessionId
});
```

#### 2. Connection Timeouts
```javascript
// Increase timeout values
const robustConfig = {
  readyTimeout: 60000,    // 1 minute
  keepAliveInterval: 30000, // 30 seconds
  keepAliveCountMax: 5,
  connectionTimeout: 120000 // 2 minutes
};

// Implement connection retry logic
async function connectWithRetry(config, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await console_create_session({
        command: 'sftp-connect',
        consoleType: 'sftp',
        sftpOptions: config
      });
    } catch (error) {
      console.log(`Connection attempt ${attempt}/${maxAttempts} failed:`, error.message);
      
      if (attempt === maxAttempts) throw error;
      
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
}
```

#### 3. Host Key Verification
```javascript
// Handle host key verification
protocol.on('host-key-verification', async (hostKey, config) => {
  console.log('Host key verification required');
  console.log('Host:', config.host);
  console.log('Key fingerprint:', hostKey.fingerprint);
  
  // Auto-accept for known safe hosts (be careful!)
  const trustedHosts = ['internal-server.company.com'];
  if (trustedHosts.includes(config.host)) {
    return true; // Accept
  }
  
  // Prompt user or check against known_hosts
  const knownHosts = require('fs').readFileSync('/home/user/.ssh/known_hosts', 'utf8');
  return knownHosts.includes(hostKey.fingerprint);
});
```

## Migration Guide

### From FTP to SFTP

#### Before (FTP)
```javascript
const ftp = require('ftp');
const client = new ftp();

client.connect({
  host: 'ftp.example.com',
  user: 'username',
  password: 'password'
});

client.put('local-file.txt', 'remote-file.txt', (err) => {
  if (err) throw err;
  console.log('Upload complete');
  client.end();
});
```

#### After (SFTP via MCP)
```javascript
const session = await console_create_session({
  command: 'sftp-connect',
  consoleType: 'sftp',
  sftpOptions: {
    host: 'sftp.example.com', // Changed from FTP to SFTP
    port: 22,                 // Changed from 21 to 22
    username: 'username',
    password: 'password'      // Consider using private key instead
  }
});

await console_execute_command({
  command: 'sftp-put',
  args: ['local-file.txt', 'remote-file.txt'],
  consoleType: 'sftp',
  sessionId: session.sessionId
});

console.log('Secure upload complete');
```

## API Reference

### Events
- `connection-established`: Connection successful
- `connection-error`: Connection failed
- `authentication-error`: Authentication failed
- `transfer-progress`: Transfer progress update
- `transfer-complete`: Transfer completed
- `transfer-error`: Transfer failed
- `host-key-verification`: Host key verification needed

### Methods
- `createSession(options)`: Create SFTP session
- `uploadFile(local, remote, options)`: Upload single file
- `downloadFile(remote, local, options)`: Download single file
- `uploadDirectory(localDir, remoteDir, options)`: Upload directory
- `downloadDirectory(remoteDir, localDir, options)`: Download directory
- `listFiles(remotePath, options)`: List remote files
- `createDirectory(remotePath)`: Create remote directory
- `removeFile(remotePath)`: Remove remote file
- `removeDirectory(remotePath)`: Remove remote directory
- `renameFile(oldPath, newPath)`: Rename remote file
- `setFilePermissions(remotePath, mode)`: Set file permissions
- `getFileStats(remotePath)`: Get file statistics
- `calculateChecksum(remotePath, algorithm)`: Calculate file checksum

### Configuration Options
See the TypeScript interfaces in the source code for complete configuration options including `SFTPProtocolConfig`, `SFTPConnectionOptions`, and `SFTPTransferOptions`.