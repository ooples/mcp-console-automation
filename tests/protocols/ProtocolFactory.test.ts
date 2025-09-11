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
    (factory as any).dispose = jest.fn<any>().mockResolvedValue(undefined);
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
          initialize: jest.fn<any>(),
          createSession: jest.fn<any>(),
          executeCommand: jest.fn<any>(),
          sendInput: jest.fn<any>(),
          getOutput: jest.fn<any>(),
          closeSession: jest.fn<any>(),
          getHealthStatus: jest.fn<any>(),
          dispose: jest.fn<any>(),
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
        getHealthStatus: jest.fn<any>().mockRejectedValue(new Error('Health check failed')),
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