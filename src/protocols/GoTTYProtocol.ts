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

// GoTTY Protocol connection options
interface GoTTYConnectionOptions {
  gottyPath?: string;
  address?: string;
  port?: number;
  command?: string;
  commandArgs?: string[];
  args?: string[];
  configFile?: string;
  enableAuth?: boolean;
  username?: string;
  password?: string;
  credential?: string;
  enableTLS?: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCA?: string;
  title?: string;
  enableReconnect?: boolean;
  maxClients?: number;
  enableOnce?: boolean;
  closeSignal?: number;
  timeout?: number;
  enablePermitWrite?: boolean;
  enableWSPingPong?: boolean;
  pingPongInterval?: number;
  enableRandomUrl?: boolean;
  indexFile?: string;
  iconFile?: string;
  titleFormat?: string;
  enableCompression?: boolean;
  terminalType?: string;
  windowWidth?: number;
  windowHeight?: number;
  preferences?: Record<string, any>;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  logFile?: string;
  enableCors?: boolean;
  corsOrigin?: string;
  environment?: Record<string, string>;
}

/**
 * GoTTY Protocol Implementation
 *
 * Provides web-based terminal console access through GoTTY server
 * Supports terminal sharing over HTTP/WebSocket, authentication, TLS, and session management
 */
export class GoTTYProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'gotty';
  public readonly capabilities: ProtocolCapabilities;

  private gottyProcesses = new Map<string, ChildProcess>();

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
    super('gotty');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: true,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 100, // GoTTY can handle many concurrent web clients
      defaultTimeout: 300000, // Web sessions can be longer
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['basic', 'credential'],
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
      // Check if GoTTY is available
      await this.checkGoTTYAvailability();
      this.isInitialized = true;
      this.logger.info('GoTTY protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize GoTTY protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `gotty-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const gottyProcess = this.gottyProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!gottyProcess || !gottyProcess.stdin || !session) {
      throw new Error(`No active GoTTY session: ${sessionId}`);
    }

    gottyProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to GoTTY session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const gottyProcess = this.gottyProcesses.get(sessionId);
      if (gottyProcess) {
        // Try graceful shutdown first
        gottyProcess.kill('SIGTERM');

        // Force kill after timeout (GoTTY should shutdown gracefully)
        setTimeout(() => {
          if (gottyProcess && !gottyProcess.killed) {
            gottyProcess.kill('SIGKILL');
          }
        }, 10000);

        this.gottyProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`GoTTY session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing GoTTY session ${sessionId}:`, error);
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

    const gottyOptions = options as GoTTYConnectionOptions;

    // Build GoTTY command
    const gottyCommand = this.buildGoTTYCommand(gottyOptions);

    // Spawn GoTTY process
    const gottyProcess = spawn(gottyCommand[0], gottyCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(gottyOptions),
        ...options.env,
      },
    });

    // Set up output handling
    gottyProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    gottyProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    gottyProcess.on('error', (error) => {
      this.logger.error(`GoTTY process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    gottyProcess.on('close', (code) => {
      this.logger.info(
        `GoTTY process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.gottyProcesses.set(sessionId, gottyProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: gottyCommand[0],
      args: gottyCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(gottyOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: gottyProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `GoTTY session ${sessionId} created for ${gottyOptions.address || '0.0.0.0'}:${gottyOptions.port || 8080}`
    );
    this.emit('session-created', { sessionId, type: 'gotty', session });

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
      isOneShot: false, // GoTTY sessions are persistent web servers
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
      `Error in GoTTY session ${context.sessionId}: ${error.message}`
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
    const gottyProcess = this.gottyProcesses.get(sessionId);
    return (gottyProcess && !gottyProcess.killed) || false;
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
        connectionsActive: this.gottyProcesses.size,
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
      await this.checkGoTTYAvailability();
      return {
        ...baseStatus,
        dependencies: {
          gotty: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `GoTTY not available: ${error}`],
        dependencies: {
          gotty: { available: false },
        },
      };
    }
  }

  private async checkGoTTYAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('gotty', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('GoTTY not found. Please install GoTTY.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('GoTTY not found. Please install GoTTY.'));
      });
    });
  }

  private buildGoTTYCommand(options: GoTTYConnectionOptions): string[] {
    const command = [];

    // GoTTY executable
    if (options.gottyPath) {
      command.push(options.gottyPath);
    } else {
      command.push('gotty');
    }

    // Address and port
    if (options.address) {
      command.push('--address', options.address);
    }

    if (options.port) {
      command.push('--port', options.port.toString());
    }

    // Configuration file
    if (options.configFile) {
      command.push('--config', options.configFile);
    }

    // Authentication
    if (options.enableAuth) {
      if (options.username && options.password) {
        command.push('--credential', `${options.username}:${options.password}`);
      } else if (options.credential) {
        command.push('--credential', options.credential);
      }
    }

    // TLS settings
    if (options.enableTLS) {
      command.push('--tls');
      if (options.tlsCert) {
        command.push('--tls-crt', options.tlsCert);
      }
      if (options.tlsKey) {
        command.push('--tls-key', options.tlsKey);
      }
      if (options.tlsCA) {
        command.push('--tls-ca', options.tlsCA);
      }
    }

    // Title and branding
    if (options.title) {
      command.push('--title-format', options.title);
    }

    if (options.titleFormat) {
      command.push('--title-format', options.titleFormat);
    }

    if (options.indexFile) {
      command.push('--index', options.indexFile);
    }

    if (options.iconFile) {
      command.push('--icon', options.iconFile);
    }

    // Connection settings
    if (options.enableReconnect) {
      command.push('--reconnect');
    }

    if (options.maxClients) {
      command.push('--max-connection', options.maxClients.toString());
    }

    if (options.enableOnce) {
      command.push('--once');
    }

    if (options.closeSignal) {
      command.push('--close-signal', options.closeSignal.toString());
    }

    if (options.timeout) {
      command.push('--timeout', options.timeout.toString());
    }

    // Terminal settings
    if (options.enablePermitWrite) {
      command.push('--permit-write');
    }

    if (options.enableRandomUrl) {
      command.push('--random-url');
    }

    if (options.terminalType) {
      command.push('--term', options.terminalType);
    }

    if (options.windowWidth && options.windowHeight) {
      command.push('--width', options.windowWidth.toString());
      command.push('--height', options.windowHeight.toString());
    }

    // WebSocket settings
    if (options.enableWSPingPong) {
      command.push('--ws-origin');
      if (options.pingPongInterval) {
        command.push('--ping-interval', options.pingPongInterval.toString());
      }
    }

    // Compression
    if (options.enableCompression) {
      command.push('--enable-gzip');
    }

    // CORS
    if (options.enableCors) {
      command.push('--ws-origin', options.corsOrigin || '*');
    }

    // Logging
    if (options.enableLogging) {
      if (options.logLevel) {
        command.push('--log-level', options.logLevel);
      }
      if (options.logFile) {
        command.push('--log-file', options.logFile);
      }
    }

    // Preferences (JSON configuration)
    if (options.preferences) {
      const prefsJson = JSON.stringify(options.preferences);
      command.push('--preferences', prefsJson);
    }

    // Command to run in terminal
    if (options.command) {
      command.push(options.command);
      if (options.commandArgs) {
        command.push(...options.commandArgs);
      }
    } else {
      // Default to shell
      const shell =
        process.env.SHELL || (process.platform === 'win32' ? 'cmd' : 'bash');
      command.push(shell);
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: GoTTYConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // GoTTY environment variables
    if (options.address) {
      env.GOTTY_ADDRESS = options.address;
    }

    if (options.port) {
      env.GOTTY_PORT = options.port.toString();
    }

    if (options.enableAuth && options.credential) {
      env.GOTTY_CREDENTIAL = options.credential;
    }

    // TLS settings
    if (options.enableTLS) {
      env.GOTTY_TLS = 'true';
      if (options.tlsCert) {
        env.GOTTY_TLS_CRT = options.tlsCert;
      }
      if (options.tlsKey) {
        env.GOTTY_TLS_KEY = options.tlsKey;
      }
    }

    // Terminal settings
    if (options.terminalType) {
      env.TERM = options.terminalType;
    }

    if (options.enablePermitWrite) {
      env.GOTTY_PERMIT_WRITE = 'true';
    }

    // Logging
    if (options.enableLogging && options.logLevel) {
      env.GOTTY_LOG_LEVEL = options.logLevel;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up GoTTY protocol');

    // Close all GoTTY processes
    for (const [sessionId, process] of Array.from(this.gottyProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing GoTTY process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.gottyProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default GoTTYProtocol;
