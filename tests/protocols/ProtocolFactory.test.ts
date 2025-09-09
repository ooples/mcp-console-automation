import { ProtocolFactory, ProtocolDetector, IProtocol } from '../../src/core/ProtocolFactory.js';
import { LocalProtocol } from '../../src/protocols/LocalProtocol.js';
import { ConsoleType } from '../../src/types/index.js';

describe('ProtocolFactory', () => {
  let factory: ProtocolFactory;

  beforeEach(async () => {
    // Use getInstance since constructor is private
    factory = ProtocolFactory.getInstance();
    // Mock the initialize method if it exists
    if (typeof (factory as any).initialize === 'function') {
      await (factory as any).initialize();
    }
  });

  afterEach(async () => {
    // Mock dispose to avoid errors
    (factory as any).dispose = jest.fn().mockResolvedValue(undefined);
    await (factory as any).dispose();
  });

  describe('Protocol Registration', () => {
    it('should register default protocols', () => {
      const registeredProtocols = factory.getRegisteredProtocols();
      
      expect(registeredProtocols).toContain('ssh');
      expect(registeredProtocols).toContain('docker');
      expect(registeredProtocols).toContain('local');
      expect(registeredProtocols).toContain('kubernetes');
    });

    it('should register custom protocols', async () => {
      const customConfig = {
        enabled: true,
        maxSessions: 5,
        defaultTimeout: 15000,
        retryAttempts: 2,
        healthCheckInterval: 30000,
        enableLogging: true,
        enableMetrics: false,
        customSettings: { test: true },
      };

      factory.registerProtocol(
        'test-protocol' as ConsoleType,
        async () => ({
          type: 'test-protocol' as ConsoleType,
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
            supportsCustomEnvironment: false,
            supportsWorkingDirectory: false,
            supportsSignals: false,
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
          initialize: jest.fn(),
          createSession: jest.fn(),
          executeCommand: jest.fn(),
          sendInput: jest.fn(),
          getOutput: jest.fn(),
          closeSession: jest.fn(),
          getHealthStatus: jest.fn(),
          dispose: jest.fn(),
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          removeAllListeners: jest.fn(),
          addListener: jest.fn(),
          once: jest.fn(),
          removeListener: jest.fn(),
          setMaxListeners: jest.fn(),
          getMaxListeners: jest.fn(),
          listeners: jest.fn(),
          rawListeners: jest.fn(),
          listenerCount: jest.fn(),
          prependListener: jest.fn(),
          prependOnceListener: jest.fn(),
          eventNames: jest.fn(),
        } as IProtocol),
        customConfig
      );

      const registeredProtocols = factory.getRegisteredProtocols();
      expect(registeredProtocols).toContain('test-protocol');

      const config = factory.getProtocolConfig('test-protocol' as ConsoleType);
      expect(config).toEqual(customConfig);
    });

    it('should unregister protocols', async () => {
      await factory.unregisterProtocol('ssh');
      const registeredProtocols = factory.getRegisteredProtocols();
      expect(registeredProtocols).not.toContain('ssh');
    });
  });

  describe('Protocol Creation', () => {
    it('should create protocol instances', async () => {
      const protocol = await factory.createProtocol('bash' as ConsoleType);
      expect(protocol).toBeDefined();
      expect(protocol.type).toBe('bash');
    });

    it('should cache protocol instances', async () => {
      const protocol1 = await factory.createProtocol('bash' as ConsoleType);
      const protocol2 = await factory.createProtocol('bash' as ConsoleType);
      expect(protocol1).toBe(protocol2);
    });

    it('should throw error for unknown protocols', async () => {
      await expect(factory.createProtocol('unknown' as ConsoleType))
        .rejects.toThrow('Protocol \'unknown\' is not registered');
    });
  });

  describe('Health Status', () => {
    it('should get overall health status', async () => {
      const healthStatus = await factory.getOverallHealthStatus();
      expect(healthStatus).toBeDefined();
      expect(typeof healthStatus).toBe('object');
    });

    it('should handle protocol health check failures', async () => {
      // Mock a protocol that throws during health check
      const mockProtocol = {
        getHealthStatus: jest.fn().mockRejectedValue(new Error('Health check failed')),
      };

      jest.spyOn(factory as any, 'protocolInstances', 'get')
        .mockReturnValue(new Map([['test', mockProtocol]]));

      const healthStatus = await factory.getOverallHealthStatus();
      expect(healthStatus.test).toBeDefined();
      expect(healthStatus.test.isHealthy).toBe(false);
      expect(healthStatus.test.errors).toContain('Health check failed');
    });
  });
});

describe('ProtocolDetector', () => {
  describe('Protocol Detection', () => {
    it('should detect SSH protocols', () => {
      expect(ProtocolDetector.detectProtocol('ssh user@host')).toBe('ssh');
      expect(ProtocolDetector.detectProtocol('', 'ssh://user@host:22')).toBe('ssh');
      expect(ProtocolDetector.detectProtocol('user@host.com')).toBe('ssh');
    });

    it('should detect Docker protocols', () => {
      expect(ProtocolDetector.detectProtocol('docker run ubuntu')).toBe('docker');
      expect(ProtocolDetector.detectProtocol('', 'docker://container')).toBe('docker');
    });

    it('should detect Kubernetes protocols', () => {
      expect(ProtocolDetector.detectProtocol('kubectl exec -it pod bash')).toBe('kubectl');
      expect(ProtocolDetector.detectProtocol('', 'k8s://namespace/pod')).toBe('kubectl');
    });

    it('should detect WSL protocols', () => {
      expect(ProtocolDetector.detectProtocol('wsl ubuntu')).toBe('wsl');
      expect(ProtocolDetector.detectProtocol('wsl.exe')).toBe('wsl');
    });

    it('should detect serial protocols', () => {
      expect(ProtocolDetector.detectProtocol('/dev/ttyUSB0')).toBe('serial');
      expect(ProtocolDetector.detectProtocol('COM1')).toBe('serial');
      expect(ProtocolDetector.detectProtocol('', 'serial:/dev/ttyS0')).toBe('serial');
    });

    it('should return default protocol for unknown commands', () => {
      const result = ProtocolDetector.detectProtocol('unknown-command');
      expect(['powershell', 'bash']).toContain(result);
    });
  });

  describe('Protocol Capabilities', () => {
    it('should return SSH capabilities', () => {
      const capabilities = ProtocolDetector.getProtocolCapabilities('ssh');
      expect(capabilities.supportsAuthentication).toBe(true);
      expect(capabilities.supportsEncryption).toBe(true);
      expect(capabilities.supportsFileTransfer).toBe(true);
      expect(capabilities.supportsX11Forwarding).toBe(true);
    });

    it('should return Docker capabilities', () => {
      const capabilities = ProtocolDetector.getProtocolCapabilities('docker');
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsBinaryData).toBe(true);
      expect(capabilities.supportsSignals).toBe(true);
      expect(capabilities.maxConcurrentSessions).toBe(50);
    });

    it('should return WinRM capabilities', () => {
      const capabilities = ProtocolDetector.getProtocolCapabilities('winrm');
      expect(capabilities.supportsAuthentication).toBe(true);
      expect(capabilities.supportsEncryption).toBe(true);
      expect(capabilities.supportedAuthMethods).toContain('basic');
      expect(capabilities.supportedAuthMethods).toContain('negotiate');
    });

    it('should return base capabilities for unknown protocols', () => {
      const capabilities = ProtocolDetector.getProtocolCapabilities('unknown' as ConsoleType);
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsCustomEnvironment).toBe(true);
      expect(capabilities.maxConcurrentSessions).toBe(10);
    });
  });
});