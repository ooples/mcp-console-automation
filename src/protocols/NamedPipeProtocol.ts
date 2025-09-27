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
import * as fs from 'fs';
import * as path from 'path';

// Named Pipe Protocol connection options
interface NamedPipeConnectionOptions extends SessionOptions {
  pipeName: string;
  pipeType?: 'byte' | 'message';
  pipeDirection?: 'in' | 'out' | 'duplex';
  pipeAccess?: 'read' | 'write' | 'readwrite';
  pipeMode?: 'byte' | 'message' | 'nowait' | 'wait' | 'readmode_byte' | 'readmode_message';
  maxInstances?: number;
  outputBufferSize?: number;
  inputBufferSize?: number;
  defaultTimeout?: number;
  securityDescriptor?: string;
  enableInheritHandle?: boolean;
  enableOverlapped?: boolean;
  enableFirstPipeInstance?: boolean;
  enableWriteThrough?: boolean;
  enableServerEnd?: boolean;
  enableClientEnd?: boolean;
  waitNamedPipe?: boolean;
  waitTimeout?: number;
  createIfNotExist?: boolean;
  deleteOnClose?: boolean;
  impersonateClient?: boolean;
  pipeNamespace?: string;
  enableAcl?: boolean;
  aclPermissions?: string[];
  fifoPath?: string;
  fifoMode?: number;
  fifoOwner?: string;
  fifoGroup?: string;
  enableBlocking?: boolean;
  enableNonBlocking?: boolean;
  enableAsync?: boolean;
  bufferSize?: number;
  readTimeout?: number;
  writeTimeout?: number;
  autoFlush?: boolean;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warning' | 'error';
  platform?: 'windows' | 'linux' | 'unix' | 'auto';
  operation?: 'server' | 'client' | 'connect' | 'listen' | 'send' | 'receive' | 'monitor';
  protocol?: 'simple' | 'json' | 'binary' | 'custom';
  messageDelimiter?: string;
  encoding?: 'utf8' | 'ascii' | 'base64' | 'hex' | 'binary';
  enableCompression?: boolean;
  compressionLevel?: number;
  enableChecksum?: boolean;
  checksumAlgorithm?: 'crc32' | 'md5' | 'sha1' | 'sha256';
  enableHeartbeat?: boolean;
  heartbeatInterval?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  environment?: Record<string, string>;
}

/**
 * Named Pipe Protocol Implementation
 *
 * Provides Named Pipe (Windows) and FIFO (Unix) inter-process communication console access
 * Supports pipe creation, connection, data transfer, messaging protocols, and cross-platform IPC
 */
export class NamedPipeProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'named-pipe';
  public readonly capabilities: ProtocolCapabilities;

  private namedPipeProcesses = new Map<string, ChildProcess>();
  private pipeHandles = new Map<string, any>();

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
    super('named-pipe');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: false,
      supportsCompression: true,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: false,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 50, // Named pipes can handle multiple instances
      defaultTimeout: 30000, // IPC operations are typically fast
      supportedEncodings: ['utf-8', 'ascii', 'binary'],
      supportedAuthMethods: ['pipe', 'acl'],
      platformSupport: {
        windows: true, // Primary named pipe support
        linux: true, // FIFO support
        macos: true, // FIFO support
        freebsd: true // FIFO support
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Named Pipe/FIFO tools are available
      await this.checkNamedPipeAvailability();
      this.isInitialized = true;
      this.logger.info('Named Pipe protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Named Pipe protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `namedpipe-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const namedPipeProcess = this.namedPipeProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!namedPipeProcess || !namedPipeProcess.stdin || !session) {
      throw new Error(`No active Named Pipe session: ${sessionId}`);
    }

    namedPipeProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Named Pipe session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const namedPipeProcess = this.namedPipeProcesses.get(sessionId);
      if (namedPipeProcess) {
        // Try graceful shutdown first
        namedPipeProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (namedPipeProcess && !namedPipeProcess.killed) {
            namedPipeProcess.kill('SIGKILL');
          }
        }, 5000);

        this.namedPipeProcesses.delete(sessionId);
      }

      // Clean up pipe handle if exists
      const pipeHandle = this.pipeHandles.get(sessionId);
      if (pipeHandle) {
        this.pipeHandles.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Named Pipe session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Named Pipe session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const namedPipeOptions = options as NamedPipeConnectionOptions;

    // Validate required pipe parameters
    if (!namedPipeOptions.pipeName) {
      throw new Error('Pipe name is required for Named Pipe protocol');
    }

    // Build Named Pipe command
    const namedPipeCommand = this.buildNamedPipeCommand(namedPipeOptions);

    // Spawn Named Pipe process
    const namedPipeProcess = spawn(namedPipeCommand[0], namedPipeCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(namedPipeOptions), ...options.env }
    });

    // Set up output handling
    namedPipeProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    namedPipeProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    namedPipeProcess.on('error', (error) => {
      this.logger.error(`Named Pipe process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    namedPipeProcess.on('close', (code) => {
      this.logger.info(`Named Pipe process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.namedPipeProcesses.set(sessionId, namedPipeProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: namedPipeCommand[0],
      args: namedPipeCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(namedPipeOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: namedPipeProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Named Pipe session ${sessionId} created for pipe ${namedPipeOptions.pipeName}`);
    this.emit('session-created', { sessionId, type: 'named-pipe', session });

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
      isOneShot: false, // Named pipe sessions can be persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Named Pipe session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const namedPipeProcess = this.namedPipeProcesses.get(sessionId);
    return namedPipeProcess && !namedPipeProcess.killed || false;
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
        connectionsActive: this.namedPipeProcesses.size
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
      await this.checkNamedPipeAvailability();
      return {
        ...baseStatus,
        dependencies: {
          namedpipe: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Named Pipe not available: ${error}`],
        dependencies: {
          namedpipe: { available: false }
        }
      };
    }
  }

  private async checkNamedPipeAvailability(): Promise<void> {
    // Check platform-specific pipe availability
    if (process.platform === 'win32') {
      // Windows - check for named pipe support via PowerShell
      return new Promise((resolve, reject) => {
        const testProcess = spawn('powershell', ['-Command', 'Get-ChildItem \\\\.\\pipe\\'], { stdio: 'pipe' });

        testProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('Windows Named Pipes not available. Please check system permissions.'));
          }
        });

        testProcess.on('error', () => {
          reject(new Error('PowerShell not available for Named Pipe operations.'));
        });
      });
    } else {
      // Unix-like systems - check for FIFO support
      return new Promise((resolve, reject) => {
        const testProcess = spawn('mkfifo', ['--help'], { stdio: 'pipe' });

        testProcess.on('close', (code) => {
          if (code === 0 || code === 1) { // mkfifo --help returns 1 on some systems
            resolve();
          } else {
            reject(new Error('FIFO/Named Pipe tools not found. Please install coreutils.'));
          }
        });

        testProcess.on('error', () => {
          reject(new Error('FIFO/Named Pipe tools not found. Please install coreutils.'));
        });
      });
    }
  }

  private buildNamedPipeCommand(options: NamedPipeConnectionOptions): string[] {
    const command = [];
    const isWindows = process.platform === 'win32';
    const platform = options.platform === 'auto' ? (isWindows ? 'windows' : 'unix') : (options.platform || (isWindows ? 'windows' : 'unix'));

    if (platform === 'windows') {
      // Windows Named Pipe operations via PowerShell
      command.push('powershell');
      command.push('-Command');

      const pipePath = options.pipeName.startsWith('\\\\.\\pipe\\') ? options.pipeName : `\\\\.\\pipe\\${options.pipeName}`;

      if (options.operation === 'server' || options.operation === 'listen') {
        // Create and listen on named pipe
        let pipeScript = `
          $pipe = New-Object System.IO.Pipes.NamedPipeServerStream('${options.pipeName.replace('\\\\.\\pipe\\', '')}`;

        if (options.pipeDirection) {
          const direction = options.pipeDirection === 'duplex' ? 'InOut' : (options.pipeDirection === 'in' ? 'In' : 'Out');
          pipeScript += `, [System.IO.Pipes.PipeDirection]::${direction}`;
        }

        if (options.maxInstances) {
          pipeScript += `, ${options.maxInstances}`;
        }

        pipeScript += `); $pipe.WaitForConnection(); `;

        if (options.operation === 'listen') {
          pipeScript += `while($pipe.IsConnected) { Start-Sleep -Milliseconds 100 }`;
        }

        command.push(pipeScript);
      } else if (options.operation === 'client' || options.operation === 'connect') {
        // Connect to named pipe as client
        let pipeScript = `
          $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', '${options.pipeName.replace('\\\\.\\pipe\\', '')}`;

        if (options.pipeDirection) {
          const direction = options.pipeDirection === 'duplex' ? 'InOut' : (options.pipeDirection === 'in' ? 'In' : 'Out');
          pipeScript += `, [System.IO.Pipes.PipeDirection]::${direction}`;
        }

        pipeScript += `); $pipe.Connect(`;

        if (options.waitTimeout) {
          pipeScript += `${options.waitTimeout}`;
        }

        pipeScript += `);`;
        command.push(pipeScript);
      } else {
        // General pipe operations
        command.push(`Get-ChildItem '${pipePath}'`);
      }
    } else {
      // Unix FIFO operations
      const fifoPath = options.fifoPath || `/tmp/${options.pipeName}`;

      if (options.operation === 'server' || options.operation === 'listen') {
        // Create FIFO and listen
        command.push('sh');
        command.push('-c');

        let fifoScript = '';
        if (options.createIfNotExist) {
          fifoScript += `mkfifo '${fifoPath}' 2>/dev/null || true; `;
        }

        if (options.fifoMode) {
          fifoScript += `chmod ${options.fifoMode.toString(8)} '${fifoPath}'; `;
        }

        if (options.fifoOwner) {
          fifoScript += `chown ${options.fifoOwner} '${fifoPath}'; `;
        }

        if (options.operation === 'listen') {
          if (options.enableNonBlocking) {
            fifoScript += `tail -f '${fifoPath}'`;
          } else {
            fifoScript += `cat '${fifoPath}'`;
          }
        } else {
          fifoScript += `echo 'FIFO created at ${fifoPath}'`;
        }

        command.push(fifoScript);
      } else if (options.operation === 'client' || options.operation === 'connect') {
        // Connect to FIFO
        command.push('sh');
        command.push('-c');

        let connectScript = '';
        if (options.waitNamedPipe) {
          connectScript += `while [ ! -p '${fifoPath}' ]; do sleep 0.1; done; `;
        }

        if (options.pipeAccess === 'write') {
          connectScript += `exec 3>'${fifoPath}'; echo 'Connected to FIFO for writing' >&3`;
        } else {
          connectScript += `exec 3<'${fifoPath}'; cat <&3`;
        }

        command.push(connectScript);
      } else {
        // General FIFO operations
        command.push('ls');
        command.push('-la');
        command.push(fifoPath);
      }
    }

    // Add custom command if provided
    if (options.command) {
      if (platform === 'windows') {
        command.push(';');
        command.push(options.command);
      } else {
        command[command.length - 1] += `; ${options.command}`;
      }
    }

    // Add arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: NamedPipeConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Named Pipe environment variables
    if (options.pipeName) {
      env.PIPE_NAME = options.pipeName;
    }

    if (options.pipeNamespace) {
      env.PIPE_NAMESPACE = options.pipeNamespace;
    }

    // Buffer and timeout settings
    if (options.bufferSize) {
      env.PIPE_BUFFER_SIZE = options.bufferSize.toString();
    }

    if (options.defaultTimeout) {
      env.PIPE_TIMEOUT = options.defaultTimeout.toString();
    }

    // Protocol settings
    if (options.protocol) {
      env.PIPE_PROTOCOL = options.protocol;
    }

    if (options.messageDelimiter) {
      env.PIPE_MESSAGE_DELIMITER = options.messageDelimiter;
    }

    if (options.encoding) {
      env.PIPE_ENCODING = options.encoding;
    }

    // Logging
    if (options.enableLogging && options.logLevel) {
      env.PIPE_LOG_LEVEL = options.logLevel;
      env.PIPE_VERBOSE = '1';
    }

    // Compression
    if (options.enableCompression) {
      env.PIPE_COMPRESSION = '1';
      if (options.compressionLevel) {
        env.PIPE_COMPRESSION_LEVEL = options.compressionLevel.toString();
      }
    }

    // Checksum
    if (options.enableChecksum && options.checksumAlgorithm) {
      env.PIPE_CHECKSUM = '1';
      env.PIPE_CHECKSUM_ALGORITHM = options.checksumAlgorithm;
    }

    // Heartbeat
    if (options.enableHeartbeat && options.heartbeatInterval) {
      env.PIPE_HEARTBEAT = '1';
      env.PIPE_HEARTBEAT_INTERVAL = options.heartbeatInterval.toString();
    }

    // Reconnection
    if (options.reconnectAttempts) {
      env.PIPE_RECONNECT_ATTEMPTS = options.reconnectAttempts.toString();
    }

    if (options.reconnectDelay) {
      env.PIPE_RECONNECT_DELAY = options.reconnectDelay.toString();
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Named Pipe protocol');

    // Close all Named Pipe processes
    for (const [sessionId, process] of Array.from(this.namedPipeProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Named Pipe process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.namedPipeProcesses.clear();
    this.pipeHandles.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default NamedPipeProtocol;