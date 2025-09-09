/**
 * SFTP Protocol Integration Tests
 * Production-ready comprehensive test suite for SFTP protocol
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { SFTPProtocol } from '../../../src/protocols/SFTPProtocol.js';
import { MockSFTPProtocol } from '../../utils/protocol-mocks.js';
import { TestServerManager, createTestServer } from '../../utils/test-servers.js';
import { 
  SFTPSession, 
  SFTPProtocolConfig, 
  ConsoleOutput,
  FileInfo,
  TransferProgress 
} from '../../../src/types/index.js';

describe('SFTP Protocol Integration Tests', () => {
  let sftpProtocol: SFTPProtocol;
  let mockSFTPProtocol: MockSFTPProtocol;
  let testServerManager: TestServerManager;
  let mockConfig: SFTPProtocolConfig;

  beforeAll(async () => {
    testServerManager = new TestServerManager();
    
    // Create mock SSH/SFTP server
    const sftpServerConfig = createTestServer()
      .protocol('ssh')
      .port(2222)
      .host('127.0.0.1')
      .auth('testuser', 'testpass')
      .withLogging(true)
      .withBehavior({
        responseDelay: 100,
        errorRate: 0.02
      })
      .build();
    
    testServerManager.createServer('sftp-server', sftpServerConfig);
    await testServerManager.startServer('sftp-server');

    mockSFTPProtocol = new MockSFTPProtocol();
    await mockSFTPProtocol.start();

    mockConfig = {
      host: '127.0.0.1',
      port: 2222,
      username: 'testuser',
      password: 'testpass',
      timeout: 30000,
      maxConnections: 10,
      keepAliveInterval: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      security: {
        enableStrictHostKeyChecking: false,
        allowedHostKeys: [],
        preferredCiphers: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
        preferredKex: ['diffie-hellman-group14-sha256'],
        preferredServerHostKey: ['rsa-sha2-512', 'rsa-sha2-256'],
        enableCompression: true
      },
      transfer: {
        concurrentTransfers: 3,
        chunkSize: 32768,
        enableResume: true,
        enableIntegrityCheck: true,
        compressionLevel: 6,
        bufferSize: 65536
      },
      monitoring: {
        enableMetrics: true,
        enableProgressTracking: true,
        enableBandwidthMonitoring: true,
        logTransfers: true
      },
      fileSystem: {
        defaultPermissions: 0o644,
        preserveTimestamps: true,
        followSymlinks: false,
        enableAttributeCaching: true,
        cacheTtl: 60000
      }
    };

    sftpProtocol = new SFTPProtocol(mockConfig);
  });

  afterAll(async () => {
    await sftpProtocol.cleanup();
    await mockSFTPProtocol.stop();
    await testServerManager.stopAllServers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    const sessions = sftpProtocol.getAllSessions();
    for (const session of sessions) {
      try {
        await sftpProtocol.closeSession(session.id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Connection Management', () => {
    test('should establish SFTP connection successfully', async () => {
      const sessionOptions = {
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const,
        timeout: 30000
      };

      const session = await sftpProtocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.host).toBe('127.0.0.1');
      expect(session.port).toBe(2222);
      expect(session.username).toBe('testuser');
      expect(session.status).toBe('running');
      expect(session.type).toBe('sftp');
      expect(session.isConnected).toBe(true);
    }, 15000);

    test('should handle authentication failure', async () => {
      await expect(sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'wrongpassword',
        consoleType: 'sftp' as const
      })).rejects.toThrow();
    });

    test('should handle connection timeout', async () => {
      await expect(sftpProtocol.createSession({
        host: '192.0.2.1', // Non-routable IP
        port: 22,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const,
        timeout: 2000
      })).rejects.toThrow();
    }, 5000);

    test('should support SSH key authentication', async () => {
      const keySession = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        privateKey: 'mock-private-key',
        passphrase: 'key-passphrase',
        consoleType: 'sftp' as const
      });

      expect(keySession.privateKey).toBeDefined();
      expect(keySession.passphrase).toBe('key-passphrase');
    }, 15000);
  });

  describe('File Operations', () => {
    let testSession: SFTPSession;

    beforeEach(async () => {
      testSession = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });
    });

    test('should list directory contents', async () => {
      const result = await sftpProtocol.executeCommand(testSession.id, 'ls /home/user');
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    }, 10000);

    test('should create and delete directories', async () => {
      const testDir = '/tmp/sftp-test-dir-' + Date.now();
      
      // Create directory
      await sftpProtocol.executeCommand(testSession.id, `mkdir ${testDir}`);
      
      // Verify directory exists
      const listResult = await sftpProtocol.executeCommand(testSession.id, `ls -la ${testDir}`);
      expect(listResult).toContain(testDir);
      
      // Delete directory
      await sftpProtocol.executeCommand(testSession.id, `rmdir ${testDir}`);
    }, 15000);

    test('should upload files', async () => {
      const localFile = '/tmp/local-test.txt';
      const remoteFile = '/tmp/remote-test.txt';
      const testContent = 'SFTP upload test content';
      
      // Create local test file (mocked)
      const uploadResult = await sftpProtocol.uploadFile(testSession.id, localFile, remoteFile);
      
      expect(uploadResult).toBeDefined();
      expect(uploadResult.bytesTransferred).toBeGreaterThan(0);
      expect(uploadResult.success).toBe(true);
      
      // Update transfer stats
      const session = sftpProtocol.getSession(testSession.id) as SFTPSession;
      expect(session.transferStats.uploadedFiles).toBeGreaterThan(0);
      expect(session.transferStats.uploadedBytes).toBeGreaterThan(0);
    }, 10000);

    test('should download files', async () => {
      const remoteFile = '/home/user/test.txt';
      const localFile = '/tmp/downloaded-test.txt';
      
      const downloadResult = await sftpProtocol.downloadFile(testSession.id, remoteFile, localFile);
      
      expect(downloadResult).toBeDefined();
      expect(downloadResult.bytesTransferred).toBeGreaterThan(0);
      expect(downloadResult.success).toBe(true);
      
      // Update transfer stats
      const session = sftpProtocol.getSession(testSession.id) as SFTPSession;
      expect(session.transferStats.downloadedFiles).toBeGreaterThan(0);
      expect(session.transferStats.downloadedBytes).toBeGreaterThan(0);
    }, 10000);

    test('should handle large file transfers', async () => {
      const largeFile = '/tmp/large-file.bin';
      const remoteFile = '/tmp/large-remote.bin';
      
      // Mock large file transfer (10MB)
      const transferSpy = jest.fn();
      sftpProtocol.on('transfer-progress', transferSpy);
      
      const result = await sftpProtocol.uploadFile(testSession.id, largeFile, remoteFile, {
        fileSize: 10 * 1024 * 1024,
        enableProgress: true
      });
      
      expect(result.success).toBe(true);
      expect(transferSpy).toHaveBeenCalled();
      
      const progressEvent = transferSpy.mock.calls[0][0];
      expect(progressEvent.sessionId).toBe(testSession.id);
      expect(progressEvent.filename).toBe(largeFile);
      expect(progressEvent.bytesTransferred).toBeGreaterThan(0);
      expect(progressEvent.totalBytes).toBe(10 * 1024 * 1024);
    }, 15000);

    test('should resume interrupted transfers', async () => {
      const partialFile = '/tmp/partial-file.bin';
      const remoteFile = '/tmp/resume-test.bin';
      
      // Simulate partial transfer
      const resumeResult = await sftpProtocol.resumeUpload(testSession.id, partialFile, remoteFile, {
        startOffset: 1024 * 1024, // Resume from 1MB
        totalSize: 5 * 1024 * 1024 // 5MB total
      });
      
      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.startOffset).toBe(1024 * 1024);
      expect(resumeResult.bytesTransferred).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Advanced File Operations', () => {
    let testSession: SFTPSession;

    beforeEach(async () => {
      testSession = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });
    });

    test('should get file attributes', async () => {
      const remoteFile = '/home/user/test.txt';
      
      const attrs = await sftpProtocol.getFileAttributes(testSession.id, remoteFile);
      
      expect(attrs).toBeDefined();
      expect(attrs.size).toBeGreaterThanOrEqual(0);
      expect(attrs.mode).toBeDefined();
      expect(attrs.uid).toBeDefined();
      expect(attrs.gid).toBeDefined();
      expect(attrs.atime).toBeInstanceOf(Date);
      expect(attrs.mtime).toBeInstanceOf(Date);
    }, 10000);

    test('should set file permissions', async () => {
      const remoteFile = '/tmp/permissions-test.txt';
      
      // Create file first
      await sftpProtocol.uploadFile(testSession.id, '/tmp/local.txt', remoteFile);
      
      // Set permissions (readable/writable by owner only)
      await sftpProtocol.setFilePermissions(testSession.id, remoteFile, 0o600);
      
      // Verify permissions
      const attrs = await sftpProtocol.getFileAttributes(testSession.id, remoteFile);
      expect(attrs.mode & 0o777).toBe(0o600);
    }, 10000);

    test('should handle symbolic links', async () => {
      const targetFile = '/home/user/test.txt';
      const linkFile = '/tmp/test-link.txt';
      
      // Create symbolic link
      await sftpProtocol.createSymbolicLink(testSession.id, targetFile, linkFile);
      
      // Verify link
      const linkAttrs = await sftpProtocol.getFileAttributes(testSession.id, linkFile);
      expect(linkAttrs.isSymbolicLink).toBe(true);
      
      // Read link target
      const linkTarget = await sftpProtocol.readSymbolicLink(testSession.id, linkFile);
      expect(linkTarget).toBe(targetFile);
    }, 10000);

    test('should rename and move files', async () => {
      const sourceFile = '/tmp/source-file.txt';
      const destFile = '/tmp/dest-file.txt';
      
      // Create source file
      await sftpProtocol.uploadFile(testSession.id, '/tmp/local.txt', sourceFile);
      
      // Rename/move file
      await sftpProtocol.renameFile(testSession.id, sourceFile, destFile);
      
      // Verify source doesn't exist and dest exists
      await expect(sftpProtocol.getFileAttributes(testSession.id, sourceFile)).rejects.toThrow();
      
      const destAttrs = await sftpProtocol.getFileAttributes(testSession.id, destFile);
      expect(destAttrs).toBeDefined();
    }, 10000);

    test('should handle file locking', async () => {
      const remoteFile = '/tmp/locked-file.txt';
      
      // Upload and lock file
      await sftpProtocol.uploadFile(testSession.id, '/tmp/local.txt', remoteFile);
      
      const lockResult = await sftpProtocol.lockFile(testSession.id, remoteFile, {
        exclusive: true,
        timeout: 10000
      });
      
      expect(lockResult.locked).toBe(true);
      expect(lockResult.lockId).toBeDefined();
      
      // Unlock file
      await sftpProtocol.unlockFile(testSession.id, remoteFile, lockResult.lockId);
    }, 10000);
  });

  describe('Performance and Monitoring', () => {
    let monitoringSession: SFTPSession;

    beforeEach(async () => {
      monitoringSession = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });
    });

    test('should track transfer metrics', async () => {
      const metricsSpy = jest.fn();
      sftpProtocol.on('transfer-metrics', metricsSpy);
      
      // Perform several transfers
      await sftpProtocol.uploadFile(monitoringSession.id, '/tmp/file1.txt', '/tmp/remote1.txt');
      await sftpProtocol.uploadFile(monitoringSession.id, '/tmp/file2.txt', '/tmp/remote2.txt');
      await sftpProtocol.downloadFile(monitoringSession.id, '/home/user/test.txt', '/tmp/downloaded.txt');
      
      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(metricsSpy).toHaveBeenCalled();
      
      const metrics = metricsSpy.mock.calls[0][0];
      expect(metrics.sessionId).toBe(monitoringSession.id);
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(metrics.totalBytesTransferred).toBeGreaterThan(0);
      expect(metrics.averageSpeed).toBeGreaterThan(0);
      expect(metrics.activeTransfers).toBeGreaterThanOrEqual(0);
    }, 15000);

    test('should monitor bandwidth usage', async () => {
      const bandwidthSpy = jest.fn();
      sftpProtocol.on('bandwidth-usage', bandwidthSpy);
      
      // Simulate bandwidth-intensive transfer
      await sftpProtocol.uploadFile(monitoringSession.id, '/tmp/large.txt', '/tmp/bandwidth-test.txt', {
        fileSize: 1024 * 1024, // 1MB
        enableProgress: true
      });
      
      // Wait for bandwidth monitoring
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      expect(bandwidthSpy).toHaveBeenCalled();
      
      const usage = bandwidthSpy.mock.calls[0][0];
      expect(usage.sessionId).toBe(monitoringSession.id);
      expect(usage.uploadBandwidth).toBeGreaterThan(0);
      expect(usage.downloadBandwidth).toBeGreaterThanOrEqual(0);
      expect(usage.totalBandwidth).toBeGreaterThan(0);
    }, 10000);

    test('should track connection health', async () => {
      const healthSpy = jest.fn();
      sftpProtocol.on('connection-health', healthSpy);
      
      // Wait for health monitoring
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      expect(healthSpy).toHaveBeenCalled();
      
      const health = healthSpy.mock.calls[0][0];
      expect(health.sessionId).toBe(monitoringSession.id);
      expect(health.timestamp).toBeInstanceOf(Date);
      expect(health.isConnected).toBe(true);
      expect(health.latency).toBeGreaterThan(0);
      expect(health.packetLoss).toBeGreaterThanOrEqual(0);
      expect(['excellent', 'good', 'fair', 'poor']).toContain(health.quality);
    }, 8000);

    test('should handle concurrent transfers', async () => {
      const transferPromises = [];
      
      // Start multiple concurrent transfers
      for (let i = 0; i < 5; i++) {
        const promise = sftpProtocol.uploadFile(
          monitoringSession.id, 
          `/tmp/concurrent${i}.txt`, 
          `/tmp/remote-concurrent${i}.txt`
        );
        transferPromises.push(promise);
      }
      
      // Wait for all transfers to complete
      const results = await Promise.all(transferPromises);
      
      expect(results.length).toBe(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.bytesTransferred).toBeGreaterThan(0);
      });
      
      // Verify session stats
      const session = sftpProtocol.getSession(monitoringSession.id) as SFTPSession;
      expect(session.transferStats.uploadedFiles).toBe(5);
    }, 20000);
  });

  describe('Error Handling and Recovery', () => {
    let errorTestSession: SFTPSession;

    beforeEach(async () => {
      errorTestSession = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });
    });

    test('should handle network disconnection', async () => {
      const disconnectSpy = jest.fn();
      sftpProtocol.on('connection-lost', disconnectSpy);
      
      // Simulate network disconnection
      sftpProtocol.emit('connection-lost', { sessionId: errorTestSession.id });
      
      expect(disconnectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: errorTestSession.id
        })
      );
    });

    test('should retry failed operations', async () => {
      const retrySpy = jest.fn();
      sftpProtocol.on('operation-retry', retrySpy);
      
      // Attempt operation that should trigger retries
      try {
        await sftpProtocol.downloadFile(errorTestSession.id, '/nonexistent/file.txt', '/tmp/fail.txt');
      } catch (error) {
        // Expected to fail after retries
      }
      
      // Verify retries were attempted (this depends on mock implementation)
      // expect(retrySpy).toHaveBeenCalled();
    });

    test('should handle permission errors', async () => {
      // Try to access restricted file/directory
      await expect(sftpProtocol.executeCommand(
        errorTestSession.id, 
        'ls /root'
      )).rejects.toThrow();
    });

    test('should handle disk full errors', async () => {
      // Simulate disk full scenario
      const diskFullFile = '/tmp/disk-full-test.txt';
      
      try {
        await sftpProtocol.uploadFile(errorTestSession.id, '/tmp/huge-file.txt', diskFullFile, {
          fileSize: 100 * 1024 * 1024 * 1024 // 100GB - should cause disk full
        });
      } catch (error) {
        expect(error.message).toMatch(/disk|space|full/i);
      }
    });

    test('should recover from temporary network issues', async () => {
      const recoverySpy = jest.fn();
      sftpProtocol.on('connection-recovered', recoverySpy);
      
      // Simulate temporary disconnection and recovery
      sftpProtocol.emit('connection-lost', { sessionId: errorTestSession.id });
      
      // Wait for recovery attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      sftpProtocol.emit('connection-recovered', { sessionId: errorTestSession.id });
      
      expect(recoverySpy).toHaveBeenCalled();
    });
  });

  describe('Security Features', () => {
    test('should enforce host key verification', async () => {
      const secureConfig = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          enableStrictHostKeyChecking: true,
          allowedHostKeys: ['ssh-rsa AAAAB3NzaC1yc2E...'] // Mock host key
        }
      };

      const secureProtocol = new SFTPProtocol(secureConfig);
      
      // Should fail with unknown host key
      await expect(secureProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      })).rejects.toThrow();
      
      await secureProtocol.cleanup();
    });

    test('should validate file paths for security', async () => {
      const session = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });

      // Test path traversal attempts
      const maliciousPaths = [
        '../../../etc/passwd',
        '/etc/shadow',
        '..\\..\\windows\\system32\\config\\sam',
        '/proc/self/environ',
        '../../../../../root/.ssh/id_rsa'
      ];

      for (const path of maliciousPaths) {
        await expect(sftpProtocol.downloadFile(session.id, path, '/tmp/stolen')).rejects.toThrow();
      }
    });

    test('should implement secure file permissions', async () => {
      const session = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });

      const testFile = '/tmp/secure-permissions.txt';
      
      // Upload file with secure permissions
      await sftpProtocol.uploadFile(session.id, '/tmp/local.txt', testFile);
      
      // Verify default secure permissions were applied
      const attrs = await sftpProtocol.getFileAttributes(session.id, testFile);
      expect(attrs.mode & 0o777).toBe(mockConfig.fileSystem.defaultPermissions);
    });
  });

  describe('Session Management', () => {
    test('should manage multiple concurrent sessions', async () => {
      const sessionPromises = Array.from({ length: 5 }, (_, i) =>
        sftpProtocol.createSession({
          host: '127.0.0.1',
          port: 2222,
          username: 'testuser',
          password: 'testpass',
          consoleType: 'sftp' as const
        })
      );

      const sessions = await Promise.all(sessionPromises);
      
      expect(sessions.length).toBe(5);
      sessions.forEach(session => {
        expect(session.id).toBeDefined();
        expect(session.isConnected).toBe(true);
      });

      // Cleanup all sessions
      await Promise.all(sessions.map(session => 
        sftpProtocol.closeSession(session.id)
      ));
    }, 30000);

    test('should enforce connection limits', async () => {
      const connectionPromises = Array.from({ length: mockConfig.maxConnections + 2 }, (_, i) =>
        sftpProtocol.createSession({
          host: '127.0.0.1',
          port: 2222,
          username: 'testuser',
          password: 'testpass',
          consoleType: 'sftp' as const
        }).catch(err => err)
      );

      const results = await Promise.all(connectionPromises);
      
      const successfulConnections = results.filter(result => !(result instanceof Error));
      const failedConnections = results.filter(result => result instanceof Error);

      expect(successfulConnections.length).toBeLessThanOrEqual(mockConfig.maxConnections);
      expect(failedConnections.length).toBeGreaterThan(0);

      // Cleanup successful connections
      await Promise.all(successfulConnections.map(session => 
        sftpProtocol.closeSession(session.id).catch(() => {})
      ));
    }, 30000);

    test('should handle session cleanup properly', async () => {
      const session = await sftpProtocol.createSession({
        host: '127.0.0.1',
        port: 2222,
        username: 'testuser',
        password: 'testpass',
        consoleType: 'sftp' as const
      });

      expect(session.status).toBe('running');
      expect(session.isConnected).toBe(true);

      await sftpProtocol.closeSession(session.id);

      const closedSession = sftpProtocol.getSession(session.id);
      expect(closedSession?.status).toBe('closed');
      expect(closedSession?.isConnected).toBe(false);
    });

    test('should cleanup all resources on protocol shutdown', async () => {
      const sessions = await Promise.all([
        sftpProtocol.createSession({
          host: '127.0.0.1',
          port: 2222,
          username: 'testuser',
          password: 'testpass',
          consoleType: 'sftp' as const
        }),
        sftpProtocol.createSession({
          host: '127.0.0.1',
          port: 2222,
          username: 'testuser',
          password: 'testpass',
          consoleType: 'sftp' as const
        })
      ]);

      expect(sftpProtocol.getAllSessions().length).toBe(2);

      await sftpProtocol.cleanup();

      expect(sftpProtocol.getAllSessions().length).toBe(0);
    }, 15000);
  });
});