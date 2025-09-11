import { LocalProtocol } from '../../src/protocols/LocalProtocol.js';
import { SessionOptions, LocalConsoleType } from '../../src/types/index.js';
import { spawn } from 'child_process';

// Mock child_process
jest.mock('child_process');
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('LocalProtocol', () => {
  let protocol: LocalProtocol;
  const protocolType: LocalConsoleType = 'bash';

  beforeEach(async () => {
    protocol = new LocalProtocol(protocolType);
    
    // Setup spawn mock
    const mockProcess = {
      pid: 1234,
      stdin: {
        write: jest.fn<any>(),
      },
      stdout: {
        on: jest.fn<any>(),
      },
      stderr: {
        on: jest.fn<any>(),
      },
      on: jest.fn<any>(),
      kill: jest.fn<any>(),
      killed: false,
    };
    
    mockSpawn.mockReturnValue(mockProcess as any);
    
    await protocol.initialize();
  });

  afterEach(async () => {
    await protocol.dispose();
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newProtocol = new LocalProtocol('bash');
      await expect(newProtocol.initialize()).resolves.not.toThrow();
    });

    it('should validate shell availability', async () => {
      // Mock successful validation
      mockSpawn.mockImplementationOnce(() => {
        const mockProcess = {
          on: jest.fn<any>().mockImplementation((event, callback) => {
            if (event === 'close') {
              setTimeout(() => callback(0), 10);
            }
          }),
        };
        return mockProcess as any;
      });

      const protocol = new LocalProtocol('bash');
      await expect(protocol.initialize()).resolves.not.toThrow();
    });

    it('should throw error for unavailable shell', async () => {
      // Mock failed validation
      mockSpawn.mockImplementationOnce(() => {
        const mockProcess = {
          on: jest.fn<any>().mockImplementation((event, callback) => {
            if (event === 'error') {
              setTimeout(() => callback(new Error('Command not found')), 10);
            }
          }),
          kill: jest.fn<any>(),
        };
        return mockProcess as any;
      });

      const protocol = new LocalProtocol('nonexistent' as LocalConsoleType);
      await expect(protocol.initialize()).rejects.toThrow();
    });
  });

  describe('Protocol Properties', () => {
    it('should have correct type', () => {
      expect(protocol.type).toBe(protocolType);
    });

    it('should have appropriate capabilities', () => {
      const capabilities = protocol.capabilities;
      
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsCustomEnvironment).toBe(true);
      expect(capabilities.supportsWorkingDirectory).toBe(true);
      expect(capabilities.supportsSignals).toBe(true);
      expect(capabilities.supportsPTY).toBe(true);
      
      expect(capabilities.supportsFileTransfer).toBe(false);
      expect(capabilities.supportsAuthentication).toBe(false);
      expect(capabilities.supportsEncryption).toBe(false);
      
      expect(capabilities.maxConcurrentSessions).toBe(50);
      expect(capabilities.defaultTimeout).toBe(30000);
    });

    it('should have healthy initial status', () => {
      const healthStatus = protocol.healthStatus;
      expect(healthStatus.isHealthy).toBe(true);
      expect(healthStatus.errors).toHaveLength(0);
      expect(healthStatus.warnings).toHaveLength(0);
    });
  });

  describe('Session Management', () => {
    it('should create session successfully', async () => {
      const options: SessionOptions = {
        command: '/bin/bash',
        args: ['--login'],
        cwd: '/home/user',
        env: { TEST: 'value' },
        streaming: true,
      };

      const session = await protocol.createSession(options);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.command).toBe('/bin/bash');
      expect(session.args).toEqual(['--login']);
      expect(session.cwd).toBe('/home/user');
      expect(session.env.TEST).toBe('value');
      expect(session.type).toBe(protocolType);
      expect(session.status).toBe('running');
      expect(session.pid).toBe(1234);

      expect(mockSpawn).toHaveBeenCalledWith(
        '/bin/bash',
        ['--login'],
        expect.objectContaining({
          cwd: '/home/user',
          env: expect.objectContaining({ TEST: 'value' }),
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        })
      );
    });

    it('should handle session creation failure', async () => {
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('Spawn failed');
      });

      const options: SessionOptions = {
        command: '/bin/bash',
        streaming: true,
      };

      await expect(protocol.createSession(options)).rejects.toThrow('Spawn failed');
    });

    it('should close session gracefully', async () => {
      const session = await protocol.createSession({
        command: '/bin/bash',
        streaming: true,
      });

      const mockProcess = mockSpawn.mock.results[0].value;
      
      await protocol.closeSession(session.id);
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('Command Execution', () => {
    let sessionId: string;
    let mockProcess: any;

    beforeEach(async () => {
      const session = await protocol.createSession({
        command: '/bin/bash',
        streaming: true,
      });
      sessionId = session.id;
      mockProcess = mockSpawn.mock.results[0].value;
    });

    it('should execute commands', async () => {
      await protocol.executeCommand(sessionId, 'ls -la');
      
      expect(mockProcess.stdin.write).toHaveBeenCalledWith('ls -la\n');
    });

    it('should execute commands with arguments', async () => {
      await protocol.executeCommand(sessionId, 'ls', ['-la', '/home']);
      
      expect(mockProcess.stdin.write).toHaveBeenCalledWith('ls -la /home\n');
    });

    it('should handle execution errors for invalid session', async () => {
      await expect(protocol.executeCommand('invalid-session', 'ls'))
        .rejects.toThrow('Session invalid-session not found or inactive');
    });
  });

  describe('Input/Output Handling', () => {
    let sessionId: string;
    let mockProcess: any;

    beforeEach(async () => {
      const session = await protocol.createSession({
        command: '/bin/bash',
        streaming: true,
      });
      sessionId = session.id;
      mockProcess = mockSpawn.mock.results[0].value;
    });

    it('should send raw input', async () => {
      await protocol.sendInput(sessionId, 'test input');
      
      expect(mockProcess.stdin.write).toHaveBeenCalledWith('test input');
    });

    it('should handle input errors for invalid session', async () => {
      await expect(protocol.sendInput('invalid-session', 'input'))
        .rejects.toThrow('Session invalid-session not found or inactive');
    });

    it('should return accumulated output', async () => {
      // Simulate some output
      const outputCallback = mockProcess.stdout.on.mock.calls
        .find(call => call[0] === 'data')[1];
      
      outputCallback(Buffer.from('test output'));
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('test output');
    });
  });

  describe('Health Status', () => {
    it('should return current health status', async () => {
      const healthStatus = await protocol.getHealthStatus();
      
      expect(healthStatus.isHealthy).toBe(true);
      expect(healthStatus.lastChecked).toBeInstanceOf(Date);
      expect(healthStatus.metrics.activeSessions).toBeGreaterThanOrEqual(0);
    });

    it('should update health status on shell validation failure', async () => {
      // Mock failed shell validation
      jest.spyOn(protocol as any, 'validateShellAvailability')
        .mockRejectedValue(new Error('Shell not available'));

      const healthStatus = await protocol.getHealthStatus();
      
      expect(healthStatus.isHealthy).toBe(false);
      expect(healthStatus.errors).toContain('Shell not available: Shell not available');
    });
  });

  describe('Platform-specific Shell Selection', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('should select PowerShell on Windows for auto type', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      const autoProtocol = new LocalProtocol('auto');
      await autoProtocol.initialize();
      
      const session = await autoProtocol.createSession({
        command: 'auto',
        streaming: true,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoLogo', '-NoExit'],
        expect.any(Object)
      );
    });

    it('should select zsh on macOS for auto type', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      const autoProtocol = new LocalProtocol('auto');
      await autoProtocol.initialize();
      
      const session = await autoProtocol.createSession({
        command: 'auto',
        streaming: true,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'zsh',
        ['-l'],
        expect.any(Object)
      );
    });

    it('should select bash on Linux for auto type', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const autoProtocol = new LocalProtocol('auto');
      await autoProtocol.initialize();
      
      const session = await autoProtocol.createSession({
        command: 'auto',
        streaming: true,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'bash',
        ['--login'],
        expect.any(Object)
      );
    });
  });

  describe('Event Handling', () => {
    it('should emit session events', async () => {
      const sessionCreatedSpy = jest.fn<any>();
      const outputSpy = jest.fn<any>();
      const sessionClosedSpy = jest.fn<any>();

      protocol.on('sessionCreated', sessionCreatedSpy);
      protocol.on('output', outputSpy);
      protocol.on('sessionClosed', sessionClosedSpy);

      const session = await protocol.createSession({
        command: '/bin/bash',
        streaming: true,
      });

      expect(sessionCreatedSpy).toHaveBeenCalledWith(session);

      // Simulate process events
      const mockProcess = mockSpawn.mock.results[0].value;
      
      const outputCallback = mockProcess.stdout.on.mock.calls
        .find(call => call[0] === 'data')[1];
      outputCallback(Buffer.from('test output'));
      
      expect(outputSpy).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id,
        type: 'stdout',
        data: 'test output',
      }));

      const closeCallback = mockProcess.on.mock.calls
        .find(call => call[0] === 'close')[1];
      closeCallback(0, null);

      expect(sessionClosedSpy).toHaveBeenCalledWith(session.id);
    });
  });
});