import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput,
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage,
} from '../core/IProtocol.js';

// Python Protocol connection options
interface PythonConnectionOptions extends SessionOptions {
  pythonPath?: string;
  virtualEnv?: string;
  pythonVersion?: string;
  scriptFile?: string;
  module?: string;
  interactive?: boolean;
  buffered?: boolean;
  optimized?: boolean;
  pythonFlags?: string[];
  environment?: Record<string, string>;
  pipRequirements?: string[];
  condaEnv?: string;
  enableDebug?: boolean;
  debugPort?: number;
  enableProfiling?: boolean;
}

/**
 * Python Protocol Implementation
 *
 * Provides Python interpreter console access through python command
 * Supports virtual environments, modules, scripts, debugging, and interactive sessions
 */
export class PythonProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'python';
  public readonly capabilities: ProtocolCapabilities;

  private pythonProcesses = new Map<string, ChildProcess>();

  // Compatibility property for old ProtocolFactory interface
  public get healthStatus(): ProtocolHealthStatus {
    return {
      isHealthy: this.isInitialized,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: this.sessions.size,
        totalSessions: this.sessions.size,
        averageLatency: 0,
        successRate: 100,
        uptime: 0,
      },
      dependencies: {},
    };
  }

  constructor() {
    super('python');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: true,
      maxConcurrentSessions: 20,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Python is available
      await this.checkPythonAvailability();
      this.isInitialized = true;
      this.logger.info('Python protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Python protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `python-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const fullCommand =
      args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const pythonProcess = this.pythonProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!pythonProcess || !pythonProcess.stdin || !session) {
      throw new Error(`No active Python session: ${sessionId}`);
    }

    pythonProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to Python session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const pythonProcess = this.pythonProcesses.get(sessionId);
      if (pythonProcess) {
        // Try graceful shutdown first
        pythonProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (pythonProcess && !pythonProcess.killed) {
            pythonProcess.kill('SIGKILL');
          }
        }, 5000);

        this.pythonProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Python session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Python session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const pythonOptions = options as PythonConnectionOptions;

    // Build Python command
    const pythonCommand = this.buildPythonCommand(pythonOptions);

    // Spawn Python process
    const pythonProcess = spawn(pythonCommand[0], pythonCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(pythonOptions),
        ...options.env,
      },
    });

    // Set up output handling
    pythonProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    pythonProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    pythonProcess.on('error', (error) => {
      this.logger.error(
        `Python process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    pythonProcess.on('close', (code) => {
      this.logger.info(
        `Python process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.pythonProcesses.set(sessionId, pythonProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: pythonCommand[0],
      args: pythonCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(pythonOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: pythonProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `Python session ${sessionId} created for ${pythonOptions.scriptFile || pythonOptions.module || 'interactive Python'}`
    );
    this.emit('session-created', { sessionId, type: 'python', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map((output) => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.status === 'running'
    );
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      status: session.status,
      isOneShot: false, // Python sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {},
    };
  }

  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorRecoveryResult> {
    this.logger.error(
      `Error in Python session ${context.sessionId}: ${error.message}`
    );

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message,
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const pythonProcess = this.pythonProcesses.get(sessionId);
    return (pythonProcess && !pythonProcess.killed) || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal,
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0],
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.pythonProcesses.size,
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0,
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size,
      },
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkPythonAvailability();
      return {
        ...baseStatus,
        dependencies: {
          python: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Python not available: ${error}`],
        dependencies: {
          python: { available: false },
        },
      };
    }
  }

  private async checkPythonAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('python', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error('Python interpreter not found. Please install Python.')
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error('Python interpreter not found. Please install Python.')
        );
      });
    });
  }

  private buildPythonCommand(options: PythonConnectionOptions): string[] {
    const command = [];

    // Python executable
    if (options.pythonPath) {
      command.push(options.pythonPath);
    } else if (options.pythonVersion) {
      command.push(`python${options.pythonVersion}`);
    } else {
      command.push('python');
    }

    // Python flags
    if (options.pythonFlags) {
      command.push(...options.pythonFlags);
    }

    // Optimization flags
    if (options.optimized) {
      command.push('-O');
    }

    // Buffering
    if (options.buffered === false) {
      command.push('-u');
    }

    // Debug options
    if (options.enableDebug && options.debugPort) {
      command.push('-m', 'pdb');
    }

    // Interactive mode
    if (options.interactive) {
      command.push('-i');
    }

    // Module or script execution
    if (options.module) {
      command.push('-m', options.module);
    } else if (options.scriptFile) {
      command.push(options.scriptFile);
    } else if (!options.interactive) {
      // Default to interactive if no script or module specified
      command.push('-i');
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: PythonConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Virtual environment activation
    if (options.virtualEnv) {
      env.VIRTUAL_ENV = options.virtualEnv;
      env.PATH = `${options.virtualEnv}/bin:${process.env.PATH}`;
    }

    // Conda environment
    if (options.condaEnv) {
      env.CONDA_DEFAULT_ENV = options.condaEnv;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    // Python path modifications
    if (options.pythonPath) {
      env.PYTHONPATH = options.pythonPath;
    }

    // Profiling
    if (options.enableProfiling) {
      env.PYTHONPROFILEOUTPUT = 'profile.out';
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Python protocol');

    // Close all Python processes
    for (const [sessionId, process] of Array.from(this.pythonProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing Python process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.pythonProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PythonProtocol;
