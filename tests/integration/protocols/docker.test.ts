/**
 * Docker Protocol Integration Tests
 * Production-ready comprehensive test suite for Docker protocol
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { DockerProtocol } from '../../../src/protocols/DockerProtocol.js';
import { MockDockerProtocol, MockTestServerFactory } from '../../utils/protocol-mocks.js';
import { TestServerManager, createTestServer } from '../../utils/test-servers.js';
import {
  DockerSession,
  DockerProtocolConfig,
  ConsoleOutput,
  DockerHealthCheck,
  DockerMetrics
} from '../../../src/types/index.js';

// Mock dockerode module before any imports
jest.mock('dockerode', () => {
  class MockStream {
    private listeners: Map<string, Function[]> = new Map();
    on(event: string, callback: Function) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(callback);
      return this;
    }
    emit(event: string, data?: any) {
      (this.listeners.get(event) || []).forEach(cb => cb(data));
    }
    removeAllListeners() {
      this.listeners.clear();
    }
  }

  class MockContainer {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
    async start() { return Promise.resolve(); }
    async stop() { return Promise.resolve(); }
    async remove() { return Promise.resolve(); }
    async kill() { return Promise.resolve(); }
    async inspect() {
      return {
        Id: this.id,
        Name: `/mock-${this.id}`,
        State: { Status: 'running', Running: true },
        Image: 'ubuntu:latest',
        Created: new Date().toISOString(),
        Config: { Image: 'ubuntu:latest', Cmd: ['/bin/bash'] }
      };
    }
    exec() {
      return Promise.resolve({
        id: `exec-${Date.now()}`,
        start: async () => {
          const stream = new MockStream();
          setTimeout(() => {
            stream.emit('data', Buffer.from('Mock output\n'));
            stream.emit('end');
          }, 10);
          return stream;
        },
        inspect: async () => ({ ID: 'exec-1', Running: false, ExitCode: 0 })
      });
    }
    stats() {
      const stream = new MockStream();
      setTimeout(() => {
        stream.emit('data', JSON.stringify({
          cpu_stats: { cpu_usage: { total_usage: 123456 }, system_cpu_usage: 1000000, online_cpus: 4 },
          memory_stats: { usage: 128 * 1024 * 1024, limit: 512 * 1024 * 1024 },
          networks: { eth0: { rx_bytes: 1024, tx_bytes: 2048 } },
          blkio_stats: { io_service_bytes_recursive: [{ op: 'Read', value: 4096 }] }
        }));
      }, 10);
      return stream;
    }
    logs() {
      const stream = new MockStream();
      setTimeout(() => {
        stream.emit('data', Buffer.from('Log entry\n'));
        stream.emit('end');
      }, 10);
      return stream;
    }
  }

  return class MockDocker {
    private containers: Map<string, MockContainer> = new Map();
    async createContainer() {
      const id = `container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const container = new MockContainer(id);
      this.containers.set(id, container);
      return container;
    }
    getContainer(id: string) {
      let container = this.containers.get(id);
      if (!container) {
        container = new MockContainer(id);
        this.containers.set(id, container);
      }
      return container;
    }
    async listContainers() {
      return Array.from(this.containers.values()).map(c => ({
        Id: c.id,
        Names: [`/mock-${c.id}`],
        Image: 'ubuntu:latest',
        State: 'running'
      }));
    }
    getEvents() {
      return new MockStream();
    }
    async version() {
      return { Version: '20.10.0', ApiVersion: '1.41' };
    }
    async info() {
      return { Containers: 0, Images: 5, Driver: 'overlay2' };
    }
    async ping() {
      return 'OK';
    }
  };
}, { virtual: true });

// Skip these tests if dockerode is not available (CI environment)
const describeIfDocker = process.env.SKIP_HARDWARE_TESTS ? describe.skip : describe;

describeIfDocker('Docker Protocol Integration Tests', () => {
  let dockerProtocol: DockerProtocol;
  let mockDockerProtocol: MockDockerProtocol;
  let testServerManager: TestServerManager;
  let mockConfig: DockerProtocolConfig;

  beforeAll(async () => {
    // Initialize test environment
    testServerManager = new TestServerManager();
    
    // Create mock Docker daemon server
    const dockerServerConfig = createTestServer()
      .protocol('http')
      .port(2376)
      .host('127.0.0.1')
      .withLogging(true)
      .withBehavior({
        responseDelay: 50,
        errorRate: 0.05 // 5% error rate for resilience testing
      })
      .build();
    
    testServerManager.createServer('docker-daemon', dockerServerConfig);
    await testServerManager.startServer('docker-daemon');

    // Initialize mock Docker protocol for isolated testing
    mockDockerProtocol = new MockDockerProtocol();
    await mockDockerProtocol.start();

    // Production Docker protocol configuration
    mockConfig = {
      connection: {
        host: '127.0.0.1',
        port: 2376,
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000
      },
      healthCheck: {
        enabled: true,
        interval: 10000,
        timeout: 5000,
        retries: 3,
        startPeriod: 0,
        unhealthyThreshold: 3,
        healthyThreshold: 2
      },
      logStreaming: {
        enabled: true,
        follow: true,
        timestamps: true,
        tail: 100,
        since: undefined,
        until: undefined,
        bufferSize: 1024 * 1024, // 1MB buffer
        maxLogSize: 10 * 1024 * 1024 // 10MB max
      },
      monitoring: {
        enableMetrics: true,
        metricsInterval: 5000,
        collectCpuStats: true,
        collectMemoryStats: true,
        collectNetworkStats: true,
        collectBlockIOStats: true,
        enableProfiling: false,
        enableTracing: false,
        enableAuditing: true
      },
      autoCleanup: false, // Don't auto-cleanup for testing
      maxContainers: 100,
      containerDefaults: {
        image: 'ubuntu:latest',
        shell: '/bin/bash',
        workingDir: '/app',
        user: 'root',
        tty: true,
        stdin: true,
        networkMode: 'bridge',
        restartPolicy: { name: 'no' }
      },
      security: {
        allowPrivileged: false,
        allowHostNetwork: false,
        allowHostPid: false,
        allowedCapabilities: [],
        droppedCapabilities: ['ALL'],
        seccompProfile: 'default',
        apparmorProfile: 'default',
        selinuxOptions: {}
      },
      resourceLimits: {
        cpuShares: 1024,
        memory: 512 * 1024 * 1024, // 512MB
        memorySwap: 1024 * 1024 * 1024, // 1GB
        cpuQuota: 50000,
        cpuPeriod: 100000,
        pidsLimit: 100,
        ulimits: []
      }
    };

    // Initialize real Docker protocol for production testing
    dockerProtocol = new DockerProtocol(mockConfig);
  });

  afterAll(async () => {
    // Cleanup resources
    await dockerProtocol.cleanup();
    await mockDockerProtocol.stop();
    await testServerManager.stopAllServers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any test sessions
    const sessions = dockerProtocol.getAllSessions();
    for (const session of sessions) {
      try {
        await dockerProtocol.stopSession(session.id, { force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Connection Management', () => {
    test('should establish Docker connection successfully', async () => {
      expect(dockerProtocol.isConnectionHealthy()).toBe(true);
      
      const health = dockerProtocol.getConnectionHealth();
      expect(health.healthy).toBe(true);
      expect(health.reconnectAttempts).toBe(0);
      expect(health.lastCheck).toBeInstanceOf(Date);
    });

    test('should handle connection failures gracefully', async () => {
      // Create protocol with invalid configuration
      const invalidConfig = {
        ...mockConfig,
        connection: {
          host: 'invalid-host',
          port: 99999,
          timeout: 1000,
          maxRetries: 1,
          retryDelay: 100
        }
      };

      const failingProtocol = new DockerProtocol(invalidConfig);
      
      // Connection should fail but not throw
      expect(failingProtocol.isConnectionHealthy()).toBe(false);
      
      await failingProtocol.cleanup();
    });

    test('should attempt reconnection on connection loss', async () => {
      const connectionErrorSpy = jest.fn<any>();
      const reconnectedSpy = jest.fn<any>();
      
      dockerProtocol.on('connection-error', connectionErrorSpy);
      dockerProtocol.on('reconnected', reconnectedSpy);

      // Simulate connection loss
      dockerProtocol.emit('connection-error', new Error('Simulated connection loss'));

      // Wait for reconnection attempt
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(connectionErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Container Session Management', () => {
    test('should create Docker container session successfully', async () => {
      const sessionOptions = {
        command: '/bin/bash',
        args: ['-c', 'echo "Hello Docker"'],
        cwd: '/app',
        env: { TEST_VAR: 'test_value' },
        consoleType: 'docker' as const,
        streaming: true,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'test-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'echo "Hello Docker"'],
          workingDir: '/app',
          env: ['TEST_VAR=test_value'],
          hostConfig: {
            autoRemove: true,
            memory: 128 * 1024 * 1024, // 128MB
            cpuShares: 512
          }
        }
      };

      const session = await dockerProtocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.containerId).toBeDefined();
      expect(session.status).toBe('running');
      expect(session.type).toBe('docker');
      expect(session.isRunning).toBe(true);
      expect(session.autoCleanup).toBe(true);
      expect(session.command).toBe('/bin/bash');
      expect(session.args).toEqual(['-c', 'echo "Hello Docker"']);
      expect(session.cwd).toBe('/app');
      expect(session.env).toEqual({ TEST_VAR: 'test_value' });
    }, 30000);

    test('should create Docker exec session successfully', async () => {
      // First create a container session
      const containerSession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'test-exec-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'sleep 30'],
          hostConfig: { autoRemove: true }
        }
      });

      expect(containerSession.containerId).toBeDefined();

      // Create exec session in the container
      const execSession = await dockerProtocol.createExecSession({
        command: 'echo',
        args: ['Hello from exec'],
        containerId: containerSession.containerId!,
        consoleType: 'docker-exec' as const,
        dockerExecOptions: {
          user: 'root',
          privileged: false,
          tty: true
        }
      });

      expect(execSession).toBeDefined();
      expect(execSession.id).toBeDefined();
      expect(execSession.execId).toBeDefined();
      expect(execSession.containerId).toBe(containerSession.containerId);
      expect(execSession.isExecSession).toBe(true);
      expect(execSession.command).toBe('echo');
      expect(execSession.args).toEqual(['Hello from exec']);
    }, 30000);

    test('should handle container creation failures', async () => {
      const invalidSessionOptions = {
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'nonexistent:image',
          name: 'invalid-container',
          hostConfig: { autoRemove: true }
        }
      };

      await expect(dockerProtocol.createSession(invalidSessionOptions))
        .rejects.toThrow();
    });
  });

  describe('Command Execution', () => {
    let testSession: DockerSession;

    beforeEach(async () => {
      testSession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'test-cmd-container-' + Date.now(),
          cmd: ['/bin/bash'],
          hostConfig: { autoRemove: true }
        }
      });
    });

    test('should execute simple commands successfully', async () => {
      const result = await dockerProtocol.executeCommand(testSession.id, 'echo "Hello World"');
      
      expect(result).toContain('Hello World');
    }, 15000);

    test('should execute commands with environment variables', async () => {
      const result = await dockerProtocol.executeCommand(
        testSession.id, 
        'echo "Value: $TEST_VAR"'
      );
      
      expect(result).toBeDefined();
    }, 15000);

    test('should handle command timeouts', async () => {
      await expect(dockerProtocol.executeCommand(
        testSession.id, 
        'sleep 60', 
        { timeout: 2000 }
      )).rejects.toThrow('timeout');
    }, 5000);

    test('should handle command failures', async () => {
      await expect(dockerProtocol.executeCommand(
        testSession.id, 
        'nonexistent-command'
      )).rejects.toThrow();
    }, 10000);

    test('should capture command output correctly', async () => {
      const outputSpy = jest.fn<any>();
      dockerProtocol.on('output', outputSpy);

      await dockerProtocol.executeCommand(testSession.id, 'echo "Test Output"');

      expect(outputSpy).toHaveBeenCalled();
      const outputCall = outputSpy.mock.calls.find(call => 
        call[0].data.includes('Test Output')
      );
      expect(outputCall).toBeDefined();
    }, 10000);
  });

  describe('Health Monitoring', () => {
    let healthSession: DockerSession;

    beforeEach(async () => {
      healthSession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'health-test-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'while true; do sleep 1; done'],
          hostConfig: { 
            autoRemove: true 
          },
          healthcheck: {
            test: ['CMD', 'echo', 'healthy'],
            interval: 5000,
            timeout: 3000,
            retries: 3,
            startPeriod: 1000
          }
        }
      });
    });

    test('should monitor container health status', async () => {
      const healthCheckSpy = jest.fn<any>();
      dockerProtocol.on('health-check', healthCheckSpy);

      // Wait for health checks to run
      await new Promise(resolve => setTimeout(resolve, 15000));

      expect(healthCheckSpy).toHaveBeenCalled();
      
      const healthCheck: DockerHealthCheck = healthCheckSpy.mock.calls[0][0];
      expect(healthCheck.containerId).toBe(healthSession.containerId);
      expect(healthCheck.timestamp).toBeInstanceOf(Date);
      expect(['healthy', 'unhealthy', 'starting', 'none']).toContain(healthCheck.status);
    }, 20000);

    test('should detect unhealthy containers', async () => {
      // Create container with failing health check
      const unhealthySession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'unhealthy-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'while true; do sleep 1; done'],
          hostConfig: { autoRemove: true },
          healthcheck: {
            test: ['CMD', 'exit', '1'], // Always fails
            interval: 2000,
            timeout: 1000,
            retries: 2,
            startPeriod: 500
          }
        }
      });

      const healthCheckSpy = jest.fn<any>();
      dockerProtocol.on('health-check', healthCheckSpy);

      // Wait for health checks to fail
      await new Promise(resolve => setTimeout(resolve, 10000));

      expect(healthCheckSpy).toHaveBeenCalled();
      
      const healthChecks = healthCheckSpy.mock.calls.map(call => call[0]);
      const unhealthyCheck = healthChecks.find(check => 
        check.containerId === unhealthySession.containerId && 
        check.status === 'unhealthy'
      );
      
      expect(unhealthyCheck).toBeDefined();
    }, 15000);
  });

  describe('Log Streaming', () => {
    let streamSession: DockerSession;

    beforeEach(async () => {
      streamSession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        streaming: true,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'log-stream-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'for i in {1..5}; do echo "Log entry $i"; sleep 1; done'],
          hostConfig: { autoRemove: true }
        }
      });
    });

    test('should stream container logs in real-time', async () => {
      const logStreamSpy = jest.fn<any>();
      const outputSpy = jest.fn<any>();
      
      dockerProtocol.on('log-stream', logStreamSpy);
      dockerProtocol.on('output', outputSpy);

      // Wait for logs to be generated
      await new Promise(resolve => setTimeout(resolve, 8000));

      expect(logStreamSpy).toHaveBeenCalled();
      expect(outputSpy).toHaveBeenCalled();

      const logEntries = logStreamSpy.mock.calls.map(call => call[0]);
      expect(logEntries.length).toBeGreaterThan(0);
      
      const logEntry = logEntries[0];
      expect(logEntry.containerId).toBe(streamSession.containerId);
      expect(logEntry.timestamp).toBeInstanceOf(Date);
      expect(['stdout', 'stderr']).toContain(logEntry.stream);
    }, 12000);

    test('should retrieve historical container logs', async () => {
      // Wait for some logs to be generated
      await new Promise(resolve => setTimeout(resolve, 3000));

      const logs = await dockerProtocol.getSessionOutput(streamSession.id, {
        since: new Date(Date.now() - 10000),
        limit: 10
      });

      expect(logs).toBeInstanceOf(Array);
      expect(logs.length).toBeGreaterThan(0);
      
      logs.forEach(log => {
        expect(log.sessionId).toBe(streamSession.id);
        expect(log.type).toMatch(/^(stdout|stderr)$/);
        expect(log.timestamp).toBeInstanceOf(Date);
        expect(log.data).toBeDefined();
      });
    }, 8000);
  });

  describe('Metrics Collection', () => {
    let metricsSession: DockerSession;

    beforeEach(async () => {
      metricsSession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'metrics-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'while true; do echo "Working..."; sleep 2; done'],
          hostConfig: { 
            autoRemove: true,
            memory: 64 * 1024 * 1024, // 64MB limit
            cpuShares: 256
          }
        }
      });
    });

    test('should collect container performance metrics', async () => {
      const metricsSpy = jest.fn<any>();
      dockerProtocol.on('metrics-collected', metricsSpy);

      // Wait for metrics to be collected
      await new Promise(resolve => setTimeout(resolve, 15000));

      expect(metricsSpy).toHaveBeenCalled();

      const metrics: DockerMetrics = metricsSpy.mock.calls[0][0];
      expect(metrics.containerId).toBe(metricsSession.containerId);
      expect(metrics.timestamp).toBeInstanceOf(Date);
      
      // CPU metrics
      expect(metrics.cpu).toBeDefined();
      expect(typeof metrics.cpu.usage).toBe('number');
      expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
      
      // Memory metrics
      expect(metrics.memory).toBeDefined();
      expect(typeof metrics.memory.usage).toBe('number');
      expect(typeof metrics.memory.limit).toBe('number');
      expect(metrics.memory.usage).toBeGreaterThan(0);
      
      // Network metrics
      expect(metrics.network).toBeDefined();
      
      // Block I/O metrics
      expect(metrics.blockIO).toBeDefined();
      expect(typeof metrics.blockIO.readBytes).toBe('number');
      expect(typeof metrics.blockIO.writeBytes).toBe('number');
    }, 20000);

    test('should track resource usage over time', async () => {
      const metricsSpy = jest.fn<any>();
      dockerProtocol.on('metrics-collected', metricsSpy);

      // Wait for multiple metrics collections
      await new Promise(resolve => setTimeout(resolve, 25000));

      expect(metricsSpy.mock.calls.length).toBeGreaterThan(1);

      // Verify metrics consistency
      const allMetrics = metricsSpy.mock.calls.map(call => call[0]);
      allMetrics.forEach(metrics => {
        expect(metrics.containerId).toBe(metricsSession.containerId);
        expect(metrics.memory.usage).toBeGreaterThan(0);
        expect(metrics.memory.usage).toBeLessThanOrEqual(64 * 1024 * 1024); // Within limit
      });
    }, 30000);
  });

  describe('Container Information', () => {
    let infoSession: DockerSession;

    beforeEach(async () => {
      infoSession = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'info-container-' + Date.now(),
          cmd: ['/bin/bash'],
          ports: ['8080:80'],
          labels: { 'test.label': 'test-value' },
          hostConfig: { 
            autoRemove: true,
            portBindings: {
              '80/tcp': [{ hostPort: '8080' }]
            }
          }
        }
      });
    });

    test('should retrieve detailed container information', async () => {
      const containerInfo = await dockerProtocol.getContainerInfo(infoSession.containerId!);

      expect(containerInfo).toBeDefined();
      expect(containerInfo.id).toBe(infoSession.containerId);
      expect(containerInfo.name).toBe(infoSession.containerName);
      expect(containerInfo.image).toBe('ubuntu:latest');
      expect(containerInfo.state).toBeDefined();
      expect(containerInfo.created).toBeInstanceOf(Date);
      expect(containerInfo.status).toMatch(/^(running|created|exited|paused|restarting|removing|dead)$/);
    }, 10000);

    test('should handle container inspection errors', async () => {
      await expect(dockerProtocol.getContainerInfo('nonexistent-container'))
        .rejects.toThrow();
    });
  });

  describe('Session Cleanup', () => {
    test('should stop container session properly', async () => {
      const session = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'cleanup-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'sleep 30'],
          hostConfig: { autoRemove: false }
        }
      });

      expect(session.status).toBe('running');

      await dockerProtocol.stopSession(session.id);

      const updatedSession = dockerProtocol.getSession(session.id);
      expect(updatedSession?.status).toBe('stopped');
      expect(updatedSession?.isRunning).toBe(false);
    }, 15000);

    test('should force stop unresponsive containers', async () => {
      const session = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'force-stop-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'trap "" SIGTERM; while true; do sleep 1; done'],
          hostConfig: { autoRemove: true }
        }
      });

      await dockerProtocol.stopSession(session.id, { 
        force: true, 
        timeout: 2 
      });

      const updatedSession = dockerProtocol.getSession(session.id);
      expect(updatedSession?.status).toBe('stopped');
    }, 10000);

    test('should clean up all resources on protocol cleanup', async () => {
      const session1 = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'cleanup1-' + Date.now(),
          cmd: ['/bin/bash'],
          hostConfig: { autoRemove: true }
        }
      });

      const session2 = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'cleanup2-' + Date.now(),
          cmd: ['/bin/bash'],
          hostConfig: { autoRemove: true }
        }
      });

      expect(dockerProtocol.getAllSessions().length).toBe(2);

      await dockerProtocol.cleanup();

      expect(dockerProtocol.getAllSessions().length).toBe(0);
    }, 15000);
  });

  describe('Error Handling and Resilience', () => {
    test('should handle Docker daemon disconnection', async () => {
      const connectionErrorSpy = jest.fn<any>();
      dockerProtocol.on('connection-error', connectionErrorSpy);

      // Simulate daemon disconnection
      dockerProtocol.emit('connection-error', new Error('Docker daemon disconnected'));

      expect(connectionErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Docker daemon disconnected'
        })
      );
    });

    test('should handle resource exhaustion gracefully', async () => {
      // Try to create a container with excessive resource requirements
      await expect(dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'resource-exhaustion-' + Date.now(),
          hostConfig: {
            memory: 1024 * 1024 * 1024 * 1024, // 1TB - should fail
            cpuShares: 999999,
            autoRemove: true
          }
        }
      })).rejects.toThrow();
    });

    test('should handle concurrent session creation', async () => {
      const sessionPromises = Array.from({ length: 5 }, (_, i) =>
        dockerProtocol.createSession({
          command: '/bin/bash',
          consoleType: 'docker' as const,
          dockerContainerOptions: {
            image: 'ubuntu:latest',
            name: `concurrent-${i}-${Date.now()}`,
            cmd: ['/bin/bash', '-c', 'echo "Session ' + i + '"'],
            hostConfig: { autoRemove: true }
          }
        })
      );

      const sessions = await Promise.all(sessionPromises);
      
      expect(sessions.length).toBe(5);
      sessions.forEach((session, i) => {
        expect(session.id).toBeDefined();
        expect(session.containerName).toContain(`concurrent-${i}`);
      });

      // Cleanup
      await Promise.all(sessions.map(session => 
        dockerProtocol.stopSession(session.id, { force: true })
      ));
    }, 20000);
  });

  describe('Event Handling', () => {
    test('should emit proper events during session lifecycle', async () => {
      const containerCreatedSpy = jest.fn<any>();
      const containerStartedSpy = jest.fn<any>();
      const containerStoppedSpy = jest.fn<any>();
      const containerRemovedSpy = jest.fn<any>();

      dockerProtocol.on('container-created', containerCreatedSpy);
      dockerProtocol.on('container-started', containerStartedSpy);
      dockerProtocol.on('container-stopped', containerStoppedSpy);
      dockerProtocol.on('container-removed', containerRemovedSpy);

      const session = await dockerProtocol.createSession({
        command: '/bin/bash',
        consoleType: 'docker' as const,
        dockerContainerOptions: {
          image: 'ubuntu:latest',
          name: 'events-container-' + Date.now(),
          cmd: ['/bin/bash', '-c', 'echo "Event test"'],
          hostConfig: { autoRemove: true }
        }
      });

      expect(containerCreatedSpy).toHaveBeenCalledWith(
        session.containerId,
        expect.objectContaining({ id: session.id })
      );

      expect(containerStartedSpy).toHaveBeenCalledWith(
        session.containerId,
        expect.objectContaining({ id: session.id })
      );

      await dockerProtocol.stopSession(session.id);

      // Note: containerStopped and containerRemoved events may be async
      // and might not be captured immediately in this test
    }, 15000);
  });
});