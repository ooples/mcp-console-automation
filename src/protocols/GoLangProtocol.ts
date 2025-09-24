import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage
} from '../core/IProtocol.js';

// Go Protocol connection options
interface GoConnectionOptions extends SessionOptions {
  goPath?: string;
  goRoot?: string;
  goVersion?: string;
  module?: string;
  packagePath?: string;
  buildFlags?: string[];
  runFlags?: string[];
  testFlags?: string[];
  sourceFile?: string;
  mainPackage?: string;
  buildTags?: string[];
  cgEnabled?: boolean;
  goOs?: string;
  goArch?: string;
  environment?: Record<string, string>;
  enableRace?: boolean;
  enablePprof?: boolean;
  pprofPort?: number;
  workspaceMode?: boolean;
  vendorMode?: boolean;
  modMode?: 'readonly' | 'vendor' | 'mod';
  enableDebug?: boolean;
  debugPort?: number;
  delveDebugger?: boolean;
}

/**
 * Go (Golang) Protocol Implementation
 *
 * Provides Go development environment console access through go command
 * Supports building, running, testing, modules, workspaces, debugging with Delve, and profiling
 */
export class GoLangProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'golang';
  public readonly capabilities: ProtocolCapabilities;

  private goProcesses = new Map<string, ChildProcess>();

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
        uptime: 0
      },
      dependencies: {}
    };
  }

  constructor() {
    super('golang');

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
      maxConcurrentSessions: 25,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Go is available
      await this.checkGoAvailability();
      this.isInitialized = true;
      this.logger.info('Go protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Go protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `go-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const goProcess = this.goProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!goProcess || !goProcess.stdin || !session) {
      throw new Error(`No active Go session: ${sessionId}`);
    }

    goProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Go session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const goProcess = this.goProcesses.get(sessionId);
      if (goProcess) {
        // Try graceful shutdown first
        goProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (goProcess && !goProcess.killed) {
            goProcess.kill('SIGKILL');
          }
        }, 5000);

        this.goProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Go session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Go session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const goOptions = options as GoConnectionOptions;

    // Build Go command
    const goCommand = this.buildGoCommand(goOptions);

    // Spawn Go process
    const goProcess = spawn(goCommand[0], goCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(goOptions), ...options.env }
    });

    // Set up output handling
    goProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    goProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    goProcess.on('error', (error) => {
      this.logger.error(`Go process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    goProcess.on('close', (code) => {
      this.logger.info(`Go process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.goProcesses.set(sessionId, goProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: goCommand[0],
      args: goCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(goOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: goProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Go session ${sessionId} created for ${goOptions.sourceFile || goOptions.packagePath || goOptions.module || 'Go application'}`);
    this.emit('session-created', { sessionId, type: 'golang', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map(output => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(session =>
      session.status === 'running'
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
      isOneShot: true, // Go commands are typically one-shot unless running a server
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Go session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const goProcess = this.goProcesses.get(sessionId);
    return goProcess && !goProcess.killed || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0]
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.goProcesses.size
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size
      }
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkGoAvailability();
      return {
        ...baseStatus,
        dependencies: {
          go: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Go not available: ${error}`],
        dependencies: {
          go: { available: false }
        }
      };
    }
  }

  private async checkGoAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('go', ['version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Go toolchain not found. Please install Go.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Go toolchain not found. Please install Go.'));
      });
    });
  }

  private buildGoCommand(options: GoConnectionOptions): string[] {
    const command = [];

    // Delve debugger for debugging
    if (options.enableDebug && options.delveDebugger && options.debugPort) {
      command.push('dlv', 'debug');
      if (options.packagePath) {
        command.push(options.packagePath);
      }
      command.push('--headless', '--listen', `:${options.debugPort}`, '--api-version=2');
      return command;
    }

    // Go executable
    if (options.goPath && options.goPath.includes('go')) {
      command.push(options.goPath);
    } else {
      command.push('go');
    }

    // Determine the Go subcommand
    if (options.sourceFile) {
      // Running a single Go file
      command.push('run');

      // Build flags for run
      if (options.buildFlags) {
        command.push(...options.buildFlags);
      }

      // Race detection
      if (options.enableRace) {
        command.push('-race');
      }

      // Build tags
      if (options.buildTags) {
        command.push('-tags', options.buildTags.join(','));
      }

      command.push(options.sourceFile);

    } else if (options.packagePath && options.packagePath.includes('test')) {
      // Running tests
      command.push('test');

      // Test flags
      if (options.testFlags) {
        command.push(...options.testFlags);
      }

      // Race detection for tests
      if (options.enableRace) {
        command.push('-race');
      }

      command.push(options.packagePath);

    } else if (options.mainPackage || options.packagePath) {
      // Running a package
      command.push('run');

      // Build flags
      if (options.buildFlags) {
        command.push(...options.buildFlags);
      }

      // Race detection
      if (options.enableRace) {
        command.push('-race');
      }

      // Build tags
      if (options.buildTags) {
        command.push('-tags', options.buildTags.join(','));
      }

      command.push(options.mainPackage || options.packagePath);

    } else {
      // Default to version if nothing specified
      command.push('version');
    }

    // Application arguments
    if (options.args) {
      command.push('--');
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: GoConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Go environment variables
    if (options.goPath) {
      env.GOPATH = options.goPath;
    }

    if (options.goRoot) {
      env.GOROOT = options.goRoot;
    }

    // Cross-compilation
    if (options.goOs) {
      env.GOOS = options.goOs;
    }

    if (options.goArch) {
      env.GOARCH = options.goArch;
    }

    // CGO settings
    if (options.cgEnabled !== undefined) {
      env.CGO_ENABLED = options.cgEnabled ? '1' : '0';
    }

    // Module mode
    if (options.modMode) {
      env.GOFLAGS = `-mod=${options.modMode}`;
    }

    // Vendor mode
    if (options.vendorMode) {
      env.GOFLAGS = env.GOFLAGS ? `${env.GOFLAGS} -mod=vendor` : '-mod=vendor';
    }

    // Workspace mode
    if (options.workspaceMode) {
      env.GOWORK = 'auto';
    }

    // Profiling
    if (options.enablePprof && options.pprofPort) {
      env.GOPPROF_PORT = options.pprofPort.toString();
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Go protocol');

    // Close all Go processes
    for (const [sessionId, process] of Array.from(this.goProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Go process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.goProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default GoLangProtocol;