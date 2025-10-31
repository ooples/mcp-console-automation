import { LocalProtocol } from '../../src/protocols/LocalProtocol.js';
import { SessionOptions, LocalConsoleType } from '../../src/types/index.js';
import { spawn } from 'child_process';
import * as os from 'os';

// Mock child_process
jest.mock('child_process');
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Mock os module
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(),
}));
const mockPlatform = os.platform as jest.MockedFunction<typeof os.platform>;

// Setup default mock process for all tests
const createMockProcess = () => {
  const mockProcess: any = {
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
    on: jest.fn<any>().mockImplementation((event: string, callback: Function) => {
      if (event === 'close') {
        // Simulate successful shell validation immediately (synchronously)
        // Use process.nextTick for faster execution than setImmediate
        process.nextTick(() => callback(0, null));
      }
      return mockProcess;
    }),
    kill: jest.fn<any>(),
    killed: false,
  };
  return mockProcess;
};

describe('LocalProtocol', () => {
  let protocol: LocalProtocol;
  // Use platform-appropriate shell type
  const actualPlatform = os.platform();
  const protocolType: LocalConsoleType = actualPlatform === 'win32' ? 'powershell' : 'bash';

  beforeAll(() => {
    // Set up default mock behavior before any tests
    mockSpawn.mockImplementation(() => createMockProcess());
    mockPlatform.mockReturnValue(actualPlatform as NodeJS.Platform);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSpawn.mockImplementation(() => createMockProcess());
    mockPlatform.mockReturnValue(actualPlatform as NodeJS.Platform);

    protocol = new LocalProtocol(protocolType);
    // Mock validateShellAvailability to avoid real process spawning
    jest.spyOn(protocol as any, 'validateShellAvailability').mockResolvedValue(undefined);
    await protocol.initialize();
  });

  afterEach(async () => {
    await protocol.dispose();
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newProtocol = new LocalProtocol(protocolType);
      jest.spyOn(newProtocol as any, 'validateShellAvailability').mockResolvedValue(undefined);
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

      const protocol = new LocalProtocol(protocolType);
      jest.spyOn(protocol as any, 'validateShellAvailability').mockResolvedValue(undefined);
      await expect(protocol.initialize()).resolves.not.toThrow();
    });

    it('should throw error for unavailable shell', async () => {
      const protocol = new LocalProtocol('nonexistent' as LocalConsoleType);
      // Mock validateShellAvailability to throw error for unavailable shell
      jest.spyOn(protocol as any, 'validateShellAvailability').mockRejectedValue(
        new Error('Shell not available')
      );
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
        command: 'auto',
        cwd: process.cwd(),
        env: { TEST: 'value' },
        streaming: true,
      };

      const session = await protocol.createSession(options);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.command).toBeDefined();
      expect(session.cwd).toBe(process.cwd());
      expect(session.env.TEST).toBe('value');
      expect(session.type).toBe(protocolType);
      expect(session.status).toBe('running');
      expect(session.pid).toBe(1234);

      expect(mockSpawn).toHaveBeenCalled();
      const spawnCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1];
      expect(spawnCall[2]).toMatchObject({
        cwd: process.cwd(),
        env: expect.objectContaining({ TEST: 'value' }),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
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
        command: 'auto',
        streaming: true,
      });

      // Get the last spawned process (the one we just created)
      const mockProcess = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;

      await protocol.closeSession(session.id);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('Command Execution', () => {
    let sessionId: string;
    let mockProcess: any;

    beforeEach(async () => {
      const session = await protocol.createSession({
        command: 'auto',
        streaming: true,
      });
      sessionId = session.id;
      // Get the last spawned process
      mockProcess = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;
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
        command: 'auto',
        streaming: true,
      });
      sessionId = session.id;
      // Get the last spawned process
      mockProcess = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;
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
        .find((call: any[]) => call[0] === 'data')[1];

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
      // Create a new protocol with an invalid shell type to trigger validation failure
      const invalidProtocol = new LocalProtocol('nonexistent' as LocalConsoleType);

      // Mock spawn to fail for validation
      mockSpawn.mockImplementationOnce(() => {
        const mockProcess = {
          on: jest.fn<any>().mockImplementation((event, callback) => {
            if (event === 'error') {
              setTimeout(() => callback(new Error('Shell not available')), 10);
            }
            return mockProcess;
          }),
          kill: jest.fn<any>(),
        };
        return mockProcess as any;
      });

      // Try to initialize, which will fail
      try {
        await invalidProtocol.initialize();
      } catch {
        // Expected to fail
      }

      const healthStatus = await invalidProtocol.getHealthStatus();

      expect(healthStatus.isHealthy).toBe(false);
      expect(healthStatus.errors.length).toBeGreaterThan(0);
      expect(healthStatus.errors[0]).toContain('Shell not available');
    });
  });

  describe('Platform-specific Shell Selection', () => {
    afterEach(() => {
      // Restore to actual platform after each test
      mockPlatform.mockReturnValue(actualPlatform as NodeJS.Platform);
    });

    it('should select PowerShell on Windows for auto type', async () => {
      mockSpawn.mockClear();
      mockSpawn.mockImplementation(() => createMockProcess());
      mockPlatform.mockReturnValue('win32');

      const autoProtocol = new LocalProtocol('auto');
      jest.spyOn(autoProtocol as any, 'validateShellAvailability').mockResolvedValue(undefined);
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

      await autoProtocol.dispose();
    });

    it('should select zsh on macOS for auto type', async () => {
      // Reset mock to ensure clean state
      mockSpawn.mockClear();
      mockSpawn.mockImplementation(() => createMockProcess());
      mockPlatform.mockReturnValue('darwin');

      const autoProtocol = new LocalProtocol('auto');
      jest.spyOn(autoProtocol as any, 'validateShellAvailability').mockResolvedValue(undefined);
      await autoProtocol.initialize();

      const session = await autoProtocol.createSession({
        command: 'auto',
        streaming: true,
      });

      // Check that zsh was used (either for validation or session creation)
      const zshCalls = mockSpawn.mock.calls.filter((call) => call[0] === 'zsh');
      expect(zshCalls.length).toBeGreaterThan(0);

      // Check that at least one zsh call has the login flag
      const hasLoginFlag = zshCalls.some((call) =>
        Array.isArray(call[1]) && call[1].includes('-l')
      );
      expect(hasLoginFlag).toBe(true);

      await autoProtocol.dispose();
    });

    it('should select bash on Linux for auto type', async () => {
      // Reset mock to ensure clean state
      mockSpawn.mockClear();
      mockSpawn.mockImplementation(() => createMockProcess());
      mockPlatform.mockReturnValue('linux');

      const autoProtocol = new LocalProtocol('auto');
      jest.spyOn(autoProtocol as any, 'validateShellAvailability').mockResolvedValue(undefined);
      await autoProtocol.initialize();

      const session = await autoProtocol.createSession({
        command: 'auto',
        streaming: true,
      });

      // Check that bash was used (either for validation or session creation)
      const bashCalls = mockSpawn.mock.calls.filter((call) => call[0] === 'bash');
      expect(bashCalls.length).toBeGreaterThan(0);

      // Check that at least one bash call has the login flag
      const hasLoginFlag = bashCalls.some((call) =>
        Array.isArray(call[1]) && call[1].includes('--login')
      );
      expect(hasLoginFlag).toBe(true);

      await autoProtocol.dispose();
    });
  });

  describe('Event Handling', () => {
    it('should emit session events', async () => {
      const sessionCreatedSpy = jest.fn<any>();
      const outputSpy = jest.fn<any>();
      const sessionClosedSpy = jest.fn<any>();

      protocol.on('session-created', sessionCreatedSpy);
      protocol.on('output', outputSpy);
      protocol.on('session-closed', sessionClosedSpy);

      const session = await protocol.createSession({
        command: 'auto',
        streaming: true,
      });

      expect(sessionCreatedSpy).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id,
        type: expect.any(String),
        session: expect.objectContaining({
          id: session.id,
        }),
      }));

      // Simulate process events
      const mockProcess = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;

      const outputCallback = mockProcess.stdout.on.mock.calls
        .find((call: any[]) => call[0] === 'data')[1];
      outputCallback(Buffer.from('test output'));

      expect(outputSpy).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id,
        type: 'stdout',
        data: 'test output',
      }));

      const closeCallback = mockProcess.on.mock.calls
        .find((call: any[]) => call[0] === 'close')[1];
      closeCallback(0, null);

      expect(sessionClosedSpy).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id,
        exitCode: 0,
      }));
    });
  });
});