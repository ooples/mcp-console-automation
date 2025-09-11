/**
 * WSL Protocol Integration Tests
 * Production-ready comprehensive test suite for WSL protocol
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { WSLProtocol } from '../../../src/protocols/WSLProtocol.js';
import { MockWSLProtocol } from '../../utils/protocol-mocks.js';
import { TestServerManager, createTestServer } from '../../utils/test-servers.js';
import { 
  WSLSession, 
  WSLProtocolConfig, 
  ConsoleOutput,
  WSLDistribution,
  WSLSystemInfo 
} from '../../../src/types/index.js';

describe('WSL Protocol Integration Tests', () => {
  let wslProtocol: WSLProtocol;
  let mockWSLProtocol: MockWSLProtocol;
  let testServerManager: TestServerManager;
  let mockConfig: WSLProtocolConfig;

  beforeAll(async () => {
    // Initialize test environment
    testServerManager = new TestServerManager();
    
    // Create mock WSL service server
    const wslServerConfig = createTestServer()
      .protocol('tcp')
      .port(9001)
      .host('127.0.0.1')
      .withLogging(true)
      .withBehavior({
        responseDelay: 100,
        errorRate: 0.03 // 3% error rate
      })
      .build();
    
    testServerManager.createServer('wsl-service', wslServerConfig);
    await testServerManager.startServer('wsl-service');

    // Initialize mock WSL protocol
    mockWSLProtocol = new MockWSLProtocol();
    await mockWSLProtocol.start();

    // Production WSL protocol configuration
    mockConfig = {
      defaultDistribution: 'Ubuntu',
      wslPath: 'wsl.exe', // Windows path to WSL
      timeout: 30000,
      maxSessions: 50,
      autoStartDistributions: true,
      monitoring: {
        enableMetrics: true,
        metricsInterval: 10000,
        collectSystemInfo: true,
        trackResourceUsage: true,
        enableHealthChecks: true,
        healthCheckInterval: 15000
      },
      security: {
        allowRootAccess: false,
        restrictedCommands: ['sudo rm -rf /', 'format', 'fdisk'],
        allowedUsers: ['user', 'developer'],
        enableAuditLogging: true
      },
      networking: {
        allowPortForwarding: true,
        allowedPorts: [3000, 8000, 8080, 9000],
        enableHostAccess: true,
        dnsServers: ['8.8.8.8', '1.1.1.1']
      },
      fileSystem: {
        defaultMountPoint: '/mnt/c',
        allowWindowsFileAccess: true,
        enableCaseInsensitive: false,
        mountOptions: {
          metadata: true,
          uid: 1000,
          gid: 1000,
          umask: 0o022
        }
      },
      distributions: {
        Ubuntu: {
          version: '22.04',
          kernel: '5.15.0',
          defaultUser: 'ubuntu',
          autoStart: true,
          resourceLimits: {
            memory: '4GB',
            processors: 4,
            swap: '1GB'
          }
        },
        Debian: {
          version: '11',
          kernel: '5.10.0',
          defaultUser: 'debian',
          autoStart: false,
          resourceLimits: {
            memory: '2GB',
            processors: 2,
            swap: '512MB'
          }
        }
      },
      interop: {
        enableWindowsInterop: true,
        appendWindowsPath: true,
        allowWindowsExecutables: true,
        enableWSLG: true, // WSL GUI support
        enableSystemD: true
      }
    };

    // Initialize real WSL protocol for production testing
    wslProtocol = new WSLProtocol(mockConfig);
  });

  afterAll(async () => {
    // Cleanup resources
    await wslProtocol.cleanup();
    await mockWSLProtocol.stop();
    await testServerManager.stopAllServers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any test sessions
    const sessions = wslProtocol.getAllSessions();
    for (const session of sessions) {
      try {
        await wslProtocol.terminateSession(session.id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('WSL Service Management', () => {
    test('should initialize WSL service successfully', async () => {
      expect(wslProtocol.isWSLAvailable()).toBe(true);
      
      const version = await wslProtocol.getWSLVersion();
      expect(version).toBeDefined();
      expect(version.version).toMatch(/^2\.\d+\.\d+/); // WSL2
    });

    test('should list available distributions', async () => {
      const distributions = await wslProtocol.listDistributions();
      
      expect(distributions).toBeInstanceOf(Array);
      expect(distributions.length).toBeGreaterThan(0);
      
      const ubuntu = distributions.find(d => d.name === 'Ubuntu');
      expect(ubuntu).toBeDefined();
      expect(ubuntu?.state).toMatch(/^(Running|Stopped|Installing|Uninstalling)$/);
      expect(ubuntu?.version).toBeDefined();
      expect(ubuntu?.isDefault).toBeDefined();
    });

    test('should get default distribution', async () => {
      const defaultDistro = await wslProtocol.getDefaultDistribution();
      
      expect(defaultDistro).toBeDefined();
      expect(defaultDistro.name).toBe('Ubuntu');
      expect(defaultDistro.isDefault).toBe(true);
    });

    test('should set default distribution', async () => {
      const originalDefault = await wslProtocol.getDefaultDistribution();
      
      // Set a different distribution as default (if available)
      const distributions = await wslProtocol.listDistributions();
      const alternativeDistro = distributions.find(d => d.name !== originalDefault.name);
      
      if (alternativeDistro) {
        await wslProtocol.setDefaultDistribution(alternativeDistro.name);
        
        const newDefault = await wslProtocol.getDefaultDistribution();
        expect(newDefault.name).toBe(alternativeDistro.name);
        
        // Restore original default
        await wslProtocol.setDefaultDistribution(originalDefault.name);
      }
    }, 15000);

    test('should handle WSL service unavailability', async () => {
      // Test with invalid WSL path
      const invalidConfig = {
        ...mockConfig,
        wslPath: 'invalid-wsl-path.exe'
      };

      const invalidProtocol = new WSLProtocol(invalidConfig);
      expect(invalidProtocol.isWSLAvailable()).toBe(false);
      
      await invalidProtocol.cleanup();
    });
  });

  describe('Session Management', () => {
    test('should create WSL session successfully', async () => {
      const sessionOptions = {
        command: '/bin/bash',
        args: ['-c', 'echo "Hello WSL"'],
        cwd: '/home/user',
        env: { TEST_VAR: 'wsl_test' },
        consoleType: 'wsl' as const,
        streaming: true,
        distribution: 'Ubuntu',
        user: 'ubuntu',
        workingDirectory: '/home/ubuntu'
      };

      const session = await wslProtocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.distribution).toBe('Ubuntu');
      expect(session.status).toBe('running');
      expect(session.type).toBe('wsl');
      expect(session.command).toBe('/bin/bash');
      expect(session.args).toEqual(['-c', 'echo "Hello WSL"']);
      expect(session.cwd).toBe('/home/user');
      expect(session.env).toEqual({ TEST_VAR: 'wsl_test' });
      expect(session.wslVersion).toBe(2);
      expect(session.kernelVersion).toMatch(/^\d+\.\d+\.\d+/);
    }, 20000);

    test('should create session with default distribution', async () => {
      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const
      });

      expect(session.distribution).toBe('Ubuntu'); // Default from config
      expect(session.isDefaultDistro).toBe(true);
    }, 15000);

    test('should create session with specific user', async () => {
      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu',
        user: 'ubuntu'
      });

      expect(session.user).toBe('ubuntu');
    }, 15000);

    test('should handle invalid distribution', async () => {
      await expect(wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'NonExistent'
      })).rejects.toThrow();
    });

    test('should handle invalid user', async () => {
      await expect(wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu',
        user: 'nonexistentuser'
      })).rejects.toThrow();
    });
  });

  describe('Command Execution', () => {
    let testSession: WSLSession;

    beforeEach(async () => {
      testSession = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu',
        cwd: '/home/ubuntu'
      });
    });

    test('should execute simple commands successfully', async () => {
      const result = await wslProtocol.executeCommand(testSession.id, 'echo "Hello WSL World"');
      
      expect(result).toContain('Hello WSL World');
    }, 10000);

    test('should execute Linux-specific commands', async () => {
      const result = await wslProtocol.executeCommand(testSession.id, 'uname -a');
      
      expect(result).toContain('Linux');
      expect(result).toContain('Microsoft'); // WSL kernel signature
    }, 10000);

    test('should handle file system operations', async () => {
      // Create a test file
      await wslProtocol.executeCommand(testSession.id, 'echo "test content" > /tmp/wsl-test.txt');
      
      // Read the file
      const result = await wslProtocol.executeCommand(testSession.id, 'cat /tmp/wsl-test.txt');
      
      expect(result).toContain('test content');
      
      // Clean up
      await wslProtocol.executeCommand(testSession.id, 'rm /tmp/wsl-test.txt');
    }, 15000);

    test('should handle Windows interoperability', async () => {
      if (mockConfig.interop.enableWindowsInterop) {
        // Test Windows executable from WSL
        const result = await wslProtocol.executeCommand(testSession.id, 'cmd.exe /c echo "Windows from WSL"');
        
        expect(result).toContain('Windows from WSL');
      }
    }, 10000);

    test('should handle file path conversions', async () => {
      // Test accessing Windows C: drive
      const result = await wslProtocol.executeCommand(testSession.id, 'ls /mnt/c');
      
      expect(result).toBeDefined();
      // Should list Windows C: drive contents
    }, 10000);

    test('should handle command timeouts', async () => {
      await expect(wslProtocol.executeCommand(
        testSession.id, 
        'sleep 60', 
        { timeout: 2000 }
      )).rejects.toThrow('timeout');
    }, 5000);

    test('should handle restricted commands', async () => {
      const restrictedCommand = mockConfig.security.restrictedCommands[0];
      
      await expect(wslProtocol.executeCommand(
        testSession.id, 
        restrictedCommand
      )).rejects.toThrow('restricted');
    }, 5000);

    test('should capture command output with streaming', async () => {
      const outputSpy = jest.fn<any>();
      wslProtocol.on('output', outputSpy);

      await wslProtocol.executeCommand(testSession.id, 'echo "Stream Test"');

      expect(outputSpy).toHaveBeenCalled();
      const outputCall = outputSpy.mock.calls.find(call => 
        call[0].data.includes('Stream Test')
      );
      expect(outputCall).toBeDefined();
    }, 10000);
  });

  describe('System Information and Monitoring', () => {
    let monitoringSession: WSLSession;

    beforeEach(async () => {
      monitoringSession = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });
    });

    test('should collect WSL system information', async () => {
      const systemInfo = await wslProtocol.getSystemInfo(monitoringSession.distribution);

      expect(systemInfo).toBeDefined();
      expect(systemInfo.distribution).toBe('Ubuntu');
      expect(systemInfo.kernelVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(systemInfo.wslVersion).toBe(2);
      expect(systemInfo.totalMemory).toBeGreaterThan(0);
      expect(systemInfo.availableMemory).toBeGreaterThan(0);
      expect(systemInfo.cpuCount).toBeGreaterThan(0);
      expect(systemInfo.uptime).toBeGreaterThan(0);
    }, 10000);

    test('should monitor resource usage', async () => {
      const resourceUsageSpy = jest.fn<any>();
      wslProtocol.on('resource-usage', resourceUsageSpy);

      // Wait for resource monitoring to kick in
      await new Promise(resolve => setTimeout(resolve, 12000));

      expect(resourceUsageSpy).toHaveBeenCalled();

      const resourceUsage = resourceUsageSpy.mock.calls[0][0];
      expect(resourceUsage.distribution).toBe(monitoringSession.distribution);
      expect(resourceUsage.timestamp).toBeInstanceOf(Date);
      expect(typeof resourceUsage.memoryUsage.used).toBe('number');
      expect(typeof resourceUsage.memoryUsage.available).toBe('number');
      expect(typeof resourceUsage.cpuUsage.percentage).toBe('number');
      expect(resourceUsage.cpuUsage.percentage).toBeGreaterThanOrEqual(0);
      expect(resourceUsage.cpuUsage.percentage).toBeLessThanOrEqual(100);
    }, 15000);

    test('should perform health checks', async () => {
      const healthCheckSpy = jest.fn<any>();
      wslProtocol.on('health-check', healthCheckSpy);

      // Wait for health checks to run
      await new Promise(resolve => setTimeout(resolve, 18000));

      expect(healthCheckSpy).toHaveBeenCalled();

      const healthCheck = healthCheckSpy.mock.calls[0][0];
      expect(healthCheck.distribution).toBe(monitoringSession.distribution);
      expect(healthCheck.timestamp).toBeInstanceOf(Date);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(healthCheck.status);
      expect(healthCheck.checks).toBeDefined();
      expect(healthCheck.checks.serviceStatus).toBeDefined();
      expect(healthCheck.checks.memoryStatus).toBeDefined();
      expect(healthCheck.checks.diskStatus).toBeDefined();
    }, 20000);

    test('should track file system usage', async () => {
      const fsUsage = await wslProtocol.getFileSystemUsage(monitoringSession.distribution);

      expect(fsUsage).toBeInstanceOf(Array);
      expect(fsUsage.length).toBeGreaterThan(0);

      const rootFS = fsUsage.find(fs => fs.mountPoint === '/');
      expect(rootFS).toBeDefined();
      expect(rootFS?.totalSize).toBeGreaterThan(0);
      expect(rootFS?.usedSize).toBeGreaterThan(0);
      expect(rootFS?.availableSize).toBeGreaterThan(0);
      expect(rootFS?.usagePercentage).toBeGreaterThanOrEqual(0);
      expect(rootFS?.usagePercentage).toBeLessThanOrEqual(100);
    }, 10000);
  });

  describe('Network Configuration', () => {
    test('should configure port forwarding', async () => {
      const portConfig = {
        hostPort: 8080,
        guestPort: 80,
        protocol: 'tcp' as const
      };

      await wslProtocol.configurePortForwarding('Ubuntu', portConfig);

      const portForwards = await wslProtocol.listPortForwards('Ubuntu');
      const configuredPort = portForwards.find(p => 
        p.hostPort === 8080 && p.guestPort === 80
      );

      expect(configuredPort).toBeDefined();
      expect(configuredPort?.protocol).toBe('tcp');
      expect(configuredPort?.state).toBe('active');

      // Cleanup
      await wslProtocol.removePortForwarding('Ubuntu', 8080, 80, 'tcp');
    }, 15000);

    test('should handle network connectivity', async () => {
      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      // Test internet connectivity
      const pingResult = await wslProtocol.executeCommand(
        session.id, 
        'ping -c 1 8.8.8.8'
      );

      expect(pingResult).toContain('1 packets transmitted');
      expect(pingResult).toContain('1 received');
    }, 15000);

    test('should configure DNS settings', async () => {
      const dnsServers = ['8.8.8.8', '1.1.1.1'];
      
      await wslProtocol.configureDNS('Ubuntu', dnsServers);

      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      const resolveConfig = await wslProtocol.executeCommand(
        session.id, 
        'cat /etc/resolv.conf'
      );

      expect(resolveConfig).toContain('8.8.8.8');
      expect(resolveConfig).toContain('1.1.1.1');
    }, 10000);
  });

  describe('File System Operations', () => {
    let fsSession: WSLSession;

    beforeEach(async () => {
      fsSession = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu',
        cwd: '/tmp'
      });
    });

    test('should handle Windows-Linux file path conversion', async () => {
      const windowsPath = 'C:\\Users\\test\\document.txt';
      const linuxPath = await wslProtocol.convertWindowsPathToLinux(windowsPath);
      
      expect(linuxPath).toBe('/mnt/c/Users/test/document.txt');

      const convertedBack = await wslProtocol.convertLinuxPathToWindows(linuxPath);
      expect(convertedBack).toBe('C:\\Users\\test\\document.txt');
    });

    test('should handle file permissions correctly', async () => {
      // Create a test file
      await wslProtocol.executeCommand(fsSession.id, 'echo "permission test" > /tmp/perm-test.txt');
      
      // Set specific permissions
      await wslProtocol.executeCommand(fsSession.id, 'chmod 644 /tmp/perm-test.txt');
      
      // Check permissions
      const permissions = await wslProtocol.executeCommand(fsSession.id, 'ls -l /tmp/perm-test.txt');
      
      expect(permissions).toContain('-rw-r--r--');
      
      // Cleanup
      await wslProtocol.executeCommand(fsSession.id, 'rm /tmp/perm-test.txt');
    }, 10000);

    test('should handle symbolic links', async () => {
      // Create source file
      await wslProtocol.executeCommand(fsSession.id, 'echo "symlink source" > /tmp/source.txt');
      
      // Create symbolic link
      await wslProtocol.executeCommand(fsSession.id, 'ln -s /tmp/source.txt /tmp/link.txt');
      
      // Verify link
      const linkContent = await wslProtocol.executeCommand(fsSession.id, 'cat /tmp/link.txt');
      expect(linkContent).toContain('symlink source');
      
      const linkInfo = await wslProtocol.executeCommand(fsSession.id, 'ls -l /tmp/link.txt');
      expect(linkInfo).toContain('->');
      expect(linkInfo).toContain('/tmp/source.txt');
      
      // Cleanup
      await wslProtocol.executeCommand(fsSession.id, 'rm /tmp/source.txt /tmp/link.txt');
    }, 10000);

    test('should handle case sensitivity correctly', async () => {
      // Create files with different cases
      await wslProtocol.executeCommand(fsSession.id, 'echo "lower" > /tmp/testfile.txt');
      await wslProtocol.executeCommand(fsSession.id, 'echo "upper" > /tmp/TESTFILE.txt');
      
      // Both should exist as separate files
      const lowerContent = await wslProtocol.executeCommand(fsSession.id, 'cat /tmp/testfile.txt');
      const upperContent = await wslProtocol.executeCommand(fsSession.id, 'cat /tmp/TESTFILE.txt');
      
      expect(lowerContent.trim()).toBe('lower');
      expect(upperContent.trim()).toBe('upper');
      
      // Cleanup
      await wslProtocol.executeCommand(fsSession.id, 'rm /tmp/testfile.txt /tmp/TESTFILE.txt');
    }, 10000);
  });

  describe('Distribution Management', () => {
    test('should start and stop distributions', async () => {
      const distributions = await wslProtocol.listDistributions();
      const testDistro = distributions.find(d => d.name === 'Ubuntu');
      
      if (testDistro && testDistro.state === 'Stopped') {
        await wslProtocol.startDistribution('Ubuntu');
        
        const updatedDistros = await wslProtocol.listDistributions();
        const startedDistro = updatedDistros.find(d => d.name === 'Ubuntu');
        
        expect(startedDistro?.state).toBe('Running');
      }

      if (testDistro && testDistro.state === 'Running') {
        await wslProtocol.stopDistribution('Ubuntu');
        
        const updatedDistros = await wslProtocol.listDistributions();
        const stoppedDistro = updatedDistros.find(d => d.name === 'Ubuntu');
        
        expect(stoppedDistro?.state).toBe('Stopped');
        
        // Restart for other tests
        await wslProtocol.startDistribution('Ubuntu');
      }
    }, 30000);

    test('should restart distribution', async () => {
      await wslProtocol.restartDistribution('Ubuntu');
      
      // Wait for restart to complete
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const distributions = await wslProtocol.listDistributions();
      const restartedDistro = distributions.find(d => d.name === 'Ubuntu');
      
      expect(restartedDistro?.state).toBe('Running');
    }, 20000);

    test('should get distribution configuration', async () => {
      const config = await wslProtocol.getDistributionConfig('Ubuntu');

      expect(config).toBeDefined();
      expect(config.name).toBe('Ubuntu');
      expect(config.version).toBeDefined();
      expect(config.defaultUser).toBeDefined();
      expect(config.resourceLimits).toBeDefined();
      expect(config.resourceLimits.memory).toBeDefined();
      expect(config.resourceLimits.processors).toBeGreaterThan(0);
    }, 10000);

    test('should update distribution configuration', async () => {
      const newConfig = {
        defaultUser: 'ubuntu',
        resourceLimits: {
          memory: '3GB',
          processors: 2,
          swap: '1GB'
        }
      };

      await wslProtocol.updateDistributionConfig('Ubuntu', newConfig);

      const updatedConfig = await wslProtocol.getDistributionConfig('Ubuntu');
      expect(updatedConfig.defaultUser).toBe('ubuntu');
      expect(updatedConfig.resourceLimits.memory).toBe('3GB');
      expect(updatedConfig.resourceLimits.processors).toBe(2);
    }, 15000);
  });

  describe('Security and Access Control', () => {
    test('should enforce user restrictions', async () => {
      await expect(wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu',
        user: 'restricted-user'
      })).rejects.toThrow();
    });

    test('should block restricted commands', async () => {
      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      for (const restrictedCmd of mockConfig.security.restrictedCommands) {
        await expect(wslProtocol.executeCommand(session.id, restrictedCmd))
          .rejects.toThrow();
      }
    });

    test('should audit command execution', async () => {
      const auditSpy = jest.fn<any>();
      wslProtocol.on('command-audit', auditSpy);

      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      await wslProtocol.executeCommand(session.id, 'echo "audit test"');

      expect(auditSpy).toHaveBeenCalled();
      const auditLog = auditSpy.mock.calls[0][0];
      expect(auditLog.sessionId).toBe(session.id);
      expect(auditLog.command).toBe('echo "audit test"');
      expect(auditLog.user).toBeDefined();
      expect(auditLog.timestamp).toBeInstanceOf(Date);
    }, 10000);

    test('should enforce root access restrictions', async () => {
      if (!mockConfig.security.allowRootAccess) {
        await expect(wslProtocol.createSession({
          command: '/bin/bash',
          consoleType: 'wsl' as const,
          distribution: 'Ubuntu',
          user: 'root'
        })).rejects.toThrow('root access not allowed');
      }
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle WSL service restart', async () => {
      const serviceRestartSpy = jest.fn<any>();
      wslProtocol.on('service-restarted', serviceRestartSpy);

      // Simulate service restart
      await wslProtocol.restartWSLService();

      expect(serviceRestartSpy).toHaveBeenCalled();
    }, 15000);

    test('should handle distribution unavailability', async () => {
      await expect(wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'NonExistentDistro'
      })).rejects.toThrow('Distribution not found');
    });

    test('should handle resource exhaustion', async () => {
      // Try to create many sessions to exhaust resources
      const sessionPromises = Array.from({ length: mockConfig.maxSessions + 5 }, (_, i) =>
        wslProtocol.createSession({
          command: '/bin/bash',
          consoleType: 'wsl' as const,
          distribution: 'Ubuntu'
        }).catch(() => null) // Catch expected failures
      );

      const sessions = await Promise.all(sessionPromises);
      const successfulSessions = sessions.filter(s => s !== null);
      
      expect(successfulSessions.length).toBeLessThanOrEqual(mockConfig.maxSessions);

      // Cleanup
      await Promise.all(successfulSessions.map(session => 
        wslProtocol.terminateSession(session!.id)
      ));
    }, 30000);

    test('should handle concurrent operations', async () => {
      const sessionPromises = Array.from({ length: 3 }, (_, i) =>
        wslProtocol.createSession({
          command: '/bin/bash',
          consoleType: 'wsl' as const,
          distribution: 'Ubuntu',
          cwd: `/tmp/concurrent-${i}`
        })
      );

      const sessions = await Promise.all(sessionPromises);
      
      expect(sessions.length).toBe(3);
      sessions.forEach((session, i) => {
        expect(session.id).toBeDefined();
        expect(session.cwd).toBe(`/tmp/concurrent-${i}`);
      });

      // Cleanup
      await Promise.all(sessions.map(session => 
        wslProtocol.terminateSession(session.id)
      ));
    }, 20000);
  });

  describe('Session Cleanup and Termination', () => {
    test('should terminate session gracefully', async () => {
      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      expect(session.status).toBe('running');

      await wslProtocol.terminateSession(session.id);

      const terminatedSession = wslProtocol.getSession(session.id);
      expect(terminatedSession?.status).toBe('terminated');
    }, 10000);

    test('should force terminate unresponsive sessions', async () => {
      const session = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      // Execute a command that ignores SIGTERM
      wslProtocol.executeCommand(session.id, 'trap "" SIGTERM; while true; do sleep 1; done');

      await wslProtocol.terminateSession(session.id, { force: true, timeout: 2000 });

      const terminatedSession = wslProtocol.getSession(session.id);
      expect(terminatedSession?.status).toBe('terminated');
    }, 8000);

    test('should cleanup all resources on protocol shutdown', async () => {
      const session1 = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      const session2 = await wslProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'wsl' as const,
        distribution: 'Ubuntu'
      });

      expect(wslProtocol.getAllSessions().length).toBe(2);

      await wslProtocol.cleanup();

      expect(wslProtocol.getAllSessions().length).toBe(0);
    }, 15000);
  });
});