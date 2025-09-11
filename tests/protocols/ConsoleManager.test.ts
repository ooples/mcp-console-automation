import { ConsoleManager } from '../../src/core/ConsoleManager.js';
import { ProtocolFactory, IProtocol } from '../../src/core/ProtocolFactory.js';
import { SessionOptions, ConsoleType, ConsoleSession } from '../../src/types/index.js';

// Mock dependencies
jest.mock('../../src/core/ProtocolFactory.js');
jest.mock('../../src/core/SessionManager.js');
jest.mock('../../src/core/ErrorDetector.js');
jest.mock('../../src/utils/logger.js');
jest.mock('../../src/monitoring/MonitoringSystem.js');
jest.mock('../../src/core/StreamManager.js');
jest.mock('../../src/core/PromptDetector.js');
jest.mock('../../src/core/ConnectionPool.js');
jest.mock('../../src/core/RetryManager.js');
jest.mock('../../src/core/ErrorRecovery.js');
jest.mock('../../src/core/HealthMonitor.js');
jest.mock('../../src/core/HeartbeatMonitor.js');
jest.mock('../../src/core/SessionRecovery.js');
jest.mock('../../src/core/MetricsCollector.js');

describe('ConsoleManager', () => {
  let consoleManager: ConsoleManager;
  let mockProtocolFactory: jest.Mocked<ProtocolFactory>;
  let mockProtocol: jest.Mocked<IProtocol>;

  beforeEach(async () => {
    // Setup mock protocol
    mockProtocol = {
      type: 'bash' as ConsoleType,
      capabilities: {
        supportsStreaming: true,
        supportsFileTransfer: false,
        supportsX11Forwarding: false,
        supportsPortForwarding: false,
        supportsAuthentication: false,
        supportsEncryption: false,
        supportsCompression: false,
        supportsMultiplexing: false,
        supportsKeepAlive: false,
        supportsReconnection: false,
        supportsBinaryData: false,
        supportsCustomEnvironment: true,
        supportsWorkingDirectory: true,
        supportsSignals: true,
        supportsResizing: false,
        supportsPTY: false,
        maxConcurrentSessions: 10,
        defaultTimeout: 30000,
        supportedEncodings: [],
        supportedAuthMethods: [],
        platformSupport: {
          windows: true,
          linux: true,
          macos: true,
          freebsd: true,
        },
      },
      healthStatus: {
        isHealthy: true,
        lastChecked: new Date(),
        errors: [],
        warnings: [],
        metrics: {
          activeSessions: 0,
          totalSessions: 0,
          averageLatency: 0,
          successRate: 1.0,
          uptime: 0,
        },
        dependencies: {},
      },
      initialize: jest.fn<any>().mockResolvedValue(undefined),
      createSession: jest.fn<any>(),
      executeCommand: jest.fn<any>().mockResolvedValue(undefined),
      sendInput: jest.fn<any>().mockResolvedValue(undefined),
      getOutput: jest.fn<any>().mockResolvedValue('test output'),
      closeSession: jest.fn<any>().mockResolvedValue(undefined),
      getHealthStatus: jest.fn<any>().mockResolvedValue({
        isHealthy: true,
        lastChecked: new Date(),
        errors: [],
        warnings: [],
        metrics: {
          activeSessions: 0,
          totalSessions: 0,
          averageLatency: 0,
          successRate: 1.0,
          uptime: 0,
        },
        dependencies: {},
      }),
      dispose: jest.fn<any>().mockResolvedValue(undefined),
      on: jest.fn<any>(),
      off: jest.fn<any>(),
      emit: jest.fn<any>(),
      removeAllListeners: jest.fn<any>(),
      addListener: jest.fn<any>(),
      once: jest.fn<any>(),
      removeListener: jest.fn<any>(),
      setMaxListeners: jest.fn<any>(),
      getMaxListeners: jest.fn<any>(),
      listeners: jest.fn<any>(),
      rawListeners: jest.fn<any>(),
      listenerCount: jest.fn<any>(),
      prependListener: jest.fn<any>(),
      prependOnceListener: jest.fn<any>(),
      eventNames: jest.fn<any>(),
    } as jest.Mocked<IProtocol>;

    // Setup mock protocol factory
    mockProtocolFactory = {
      createProtocol: jest.fn<any>().mockResolvedValue(mockProtocol),
      getOverallHealthStatus: jest.fn<any>().mockResolvedValue({
        local: mockProtocol.healthStatus,
      }),
      dispose: jest.fn<any>().mockResolvedValue(undefined),
      on: jest.fn<any>(),
      off: jest.fn<any>(),
      emit: jest.fn<any>(),
      removeAllListeners: jest.fn<any>(),
    } as any;

    // Create instance without singleton pattern since constructor is not private
    consoleManager = new ConsoleManager();
    
    // Mock the ProtocolFactory.getInstance to return our mock
    (ProtocolFactory.getInstance as jest.Mock<any>).mockReturnValue(mockProtocolFactory);
    
    // Mock internal components
    (consoleManager as any).protocolFactory = mockProtocolFactory;
    (consoleManager as any).sessionManager = { 
      initialize: jest.fn<any>().mockResolvedValue(undefined),
      registerSession: jest.fn<any>().mockResolvedValue(undefined)
    };
    (consoleManager as any).errorDetector = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).streamManager = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).promptDetector = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).connectionPool = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).retryManager = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).errorRecovery = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).healthMonitor = { 
      initialize: jest.fn<any>().mockResolvedValue(undefined),
      start: jest.fn<any>(),
      stop: jest.fn<any>()
    };
    (consoleManager as any).heartbeatMonitor = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).sessionRecovery = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    (consoleManager as any).metricsCollector = { 
      initialize: jest.fn<any>().mockResolvedValue(undefined),
      getMetrics: jest.fn<any>().mockResolvedValue({})
    };
    (consoleManager as any).monitoringSystem = { initialize: jest.fn<any>().mockResolvedValue(undefined) };
    
    // Mock logger and other dependencies
    (consoleManager as any).logger = {
      info: jest.fn<any>(),
      error: jest.fn<any>(),
      warn: jest.fn<any>(),
      debug: jest.fn<any>()
    };
  });

  afterEach(async () => {
    // Mock the dispose method to avoid errors
    if (consoleManager) {
      (consoleManager as any).dispose = jest.fn<any>().mockResolvedValue(undefined);
      await (consoleManager as any).dispose();
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const manager = new ConsoleManager();
      // Mock internal initialization
      jest.spyOn(manager as any, 'initializeSelfHealingComponents').mockImplementation(() => {});
      jest.spyOn(manager as any, 'setupSelfHealingIntegration').mockImplementation(() => {});
      await expect(Promise.resolve()).resolves.not.toThrow();
    });

    it('should create new instances', () => {
      const manager1 = new ConsoleManager();
      const manager2 = new ConsoleManager();
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('Session Management', () => {
    it('should create session with protocol detection', async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        args: ['--login'],
        cwd: '/home/user',
        env: { TEST: 'value' },
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: ['--login'],
        cwd: '/home/user',
        env: { TEST: 'value' },
        createdAt: new Date(),
        pid: 1234,
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);

      const sessionId = await consoleManager.createSession(sessionOptions);

      expect(sessionId).toBeDefined();
      expect(sessionId).toBe('session-123');
      expect(mockProtocolFactory.createProtocol).toHaveBeenCalled();
      expect(mockProtocol.createSession).toHaveBeenCalledWith(sessionOptions);
    });

    it('should throw error when protocol detection fails', async () => {
      // Mock protocol detector to return null
      jest.doMock('../../src/core/ProtocolFactory.js', () => ({
        ProtocolDetector: {
          detectProtocol: jest.fn<any>().mockReturnValue(null),
        },
      }));

      const sessionOptions: SessionOptions = {
        command: 'unknown-command',
        streaming: true,
      };

      await expect(consoleManager.createSession(sessionOptions))
        .rejects.toThrow('Unable to detect protocol type');
    });

    it('should get active sessions', async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      await consoleManager.createSession(sessionOptions);

      const activeSessions = consoleManager.getActiveSessions();
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe('session-123');
    });

    it('should get session by ID', async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      await consoleManager.createSession(sessionOptions);

      const session = consoleManager.getSession('session-123');
      expect(session).toBeDefined();
      expect(session?.id).toBe('session-123');

      const nonExistentSession = consoleManager.getSession('non-existent');
      expect(nonExistentSession).toBeUndefined();
    });

    it('should close session', async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      await consoleManager.createSession(sessionOptions);

      await consoleManager.closeSession('session-123');

      expect(mockProtocol.closeSession).toHaveBeenCalledWith('session-123');

      const sessions = consoleManager.getActiveSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('Command Execution', () => {
    let sessionId: string;

    beforeEach(async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      const sessionIdResult = await consoleManager.createSession(sessionOptions);
      sessionId = sessionIdResult;
    });

    it('should execute command', async () => {
      await consoleManager.executeCommand(sessionId, 'ls -la');
      expect(mockProtocol.executeCommand).toHaveBeenCalledWith(sessionId, 'ls -la', undefined);
    });

    it('should execute command with arguments', async () => {
      await consoleManager.executeCommand(sessionId, 'ls', ['-la', '/home']);
      expect(mockProtocol.executeCommand).toHaveBeenCalledWith(sessionId, 'ls', ['-la', '/home']);
    });

    it('should handle command execution with options', async () => {
      const options = { timeout: 10000, priority: 1 };
      await consoleManager.executeCommand(sessionId, 'long-running-command', [], options);
      
      // Should still call the protocol method
      expect(mockProtocol.executeCommand).toHaveBeenCalled();
    });

    it('should throw error for non-existent session', async () => {
      await expect(consoleManager.executeCommand('non-existent', 'ls'))
        .rejects.toThrow('Session non-existent not found');
    });
  });

  describe('Input/Output Operations', () => {
    let sessionId: string;

    beforeEach(async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      const sessionIdResult = await consoleManager.createSession(sessionOptions);
      sessionId = sessionIdResult;
    });

    it('should send input to session', async () => {
      await consoleManager.sendInput(sessionId, 'test input');
      expect(mockProtocol.sendInput).toHaveBeenCalledWith(sessionId, 'test input');
    });

    it('should get output from session', async () => {
      const output = await consoleManager.getOutput(sessionId);
      
      expect(mockProtocol.getOutput).toHaveBeenCalledWith(sessionId, undefined);
      expect(output).toHaveLength(1);
      expect(output[0]).toEqual(expect.objectContaining({
        sessionId,
        type: 'stdout',
        data: 'test output',
        timestamp: expect.any(Date),
      }));
    });

    it('should get output with timestamp filter', async () => {
      const since = new Date();
      await consoleManager.getOutput(sessionId, since);
      
      expect(mockProtocol.getOutput).toHaveBeenCalledWith(sessionId, since);
    });

    it('should throw error for operations on non-existent session', async () => {
      await expect(consoleManager.sendInput('non-existent', 'input'))
        .rejects.toThrow('Protocol not found for session non-existent');

      await expect(consoleManager.getOutput('non-existent'))
        .rejects.toThrow('Protocol not found for session non-existent');
    });
  });

  describe('Protocol Management', () => {
    it('should get protocol capabilities', async () => {
      const capabilities = await consoleManager.getProtocolCapabilities('local');
      
      expect(mockProtocolFactory.createProtocol).toHaveBeenCalledWith('local');
      expect(capabilities).toEqual(mockProtocol.capabilities);
    });

    it('should get protocol health status', async () => {
      const healthStatus = await consoleManager.getProtocolHealthStatus('local');
      
      expect(mockProtocolFactory.createProtocol).toHaveBeenCalledWith('local');
      expect(mockProtocol.getHealthStatus).toHaveBeenCalled();
      expect(healthStatus).toEqual(mockProtocol.healthStatus);
    });

    it('should get overall protocol health status', async () => {
      const overallHealth = await consoleManager.getProtocolHealthStatus();
      
      expect(mockProtocolFactory.getOverallHealthStatus).toHaveBeenCalled();
      expect(overallHealth).toEqual({ local: mockProtocol.healthStatus });
    });
  });

  describe('System Health', () => {
    it('should get system health status', async () => {
      // Create a mock session first
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      await consoleManager.createSession(sessionOptions);

      const systemHealth = await consoleManager.getSystemHealthStatus();

      expect(systemHealth).toEqual({
        overall: 'healthy',
        protocols: { local: mockProtocol.healthStatus },
        sessions: {
          total: 1,
          active: 1,
          errors: 0,
        },
        metrics: {},
      });
    });

    it('should report degraded health when some protocols are unhealthy', async () => {
      const unhealthyProtocolHealth = {
        isHealthy: false,
        lastChecked: new Date(),
        errors: ['Connection failed'],
        warnings: [],
        metrics: {
          activeSessions: 0,
          totalSessions: 0,
          averageLatency: 0,
          successRate: 0,
          uptime: 0,
        },
        dependencies: {},
      };

      mockProtocolFactory.getOverallHealthStatus.mockResolvedValue({
        local: mockProtocol.healthStatus,
        ssh: unhealthyProtocolHealth,
      });

      const systemHealth = await consoleManager.getSystemHealthStatus();

      expect(systemHealth.overall).toBe('degraded');
      expect(systemHealth.protocols.ssh.isHealthy).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle protocol creation failure', async () => {
      mockProtocolFactory.createProtocol.mockRejectedValue(new Error('Protocol creation failed'));

      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      await expect(consoleManager.createSession(sessionOptions))
        .rejects.toThrow('Protocol creation failed');
    });

    it('should handle session creation failure', async () => {
      mockProtocol.createSession.mockRejectedValue(new Error('Session creation failed'));

      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      await expect(consoleManager.createSession(sessionOptions))
        .rejects.toThrow('Session creation failed');
    });
  });

  describe('Disposal', () => {
    it('should dispose of manager and all resources', async () => {
      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      const mockSession = {
        id: 'session-123',
        command: '/bin/bash',
        args: [],
        cwd: process.cwd(),
        env: {},
        createdAt: new Date(),
        status: 'running' as const,
        type: 'bash' as ConsoleType,
        streaming: true,
        executionState: 'idle' as const,
        activeCommands: new Map(),
      };

      mockProtocol.createSession.mockResolvedValue(mockSession);
      await consoleManager.createSession(sessionOptions);

      await consoleManager.dispose();

      expect(mockProtocol.closeSession).toHaveBeenCalledWith('session-123');
      expect(mockProtocolFactory.dispose).toHaveBeenCalled();
      expect(mockProtocol.dispose).toHaveBeenCalled();
    });

    it('should handle disposal when already disposed', async () => {
      await consoleManager.dispose();
      await expect(consoleManager.dispose()).resolves.not.toThrow();
    });

    it('should reject operations after disposal', async () => {
      await consoleManager.dispose();

      const sessionOptions: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      await expect(consoleManager.createSession(sessionOptions))
        .rejects.toThrow('ConsoleManager has been disposed');
    });
  });
});