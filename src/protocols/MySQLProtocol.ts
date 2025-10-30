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
} from '../core/IProtocol.js';

// MySQL Client connection options
interface MySQLConnectionOptions extends SessionOptions {
  host?: string;
  port?: number;
  user?: string;
  username?: string;
  password?: string;
  database?: string;
  schema?: string;
  ssl?: boolean;
  connectTimeout?: number;
  socketPath?: string;
  charset?: string;
}

/**
 * MySQL Protocol Implementation
 *
 * Provides MySQL database console access through mysql CLI
 * Supports both local and remote MySQL connections with authentication
 */
export class MySQLProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'mysql';
  public readonly capabilities: ProtocolCapabilities;

  private mysqlProcesses = new Map<string, ChildProcess>();

  constructor() {
    super('mysql');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 50,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'latin1', 'ascii'],
      supportedAuthMethods: ['password', 'ssl'],
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
      // Check if mysql client is available
      await this.checkMySQLClientAvailability();
      this.isInitialized = true;
      this.logger.info(
        'MySQL protocol initialized with session management fixes'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize MySQL protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `mysql-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const mysqlProcess = this.mysqlProcesses.get(sessionId);
    if (!mysqlProcess || !mysqlProcess.stdin) {
      throw new Error(`No active MySQL connection for session: ${sessionId}`);
    }

    mysqlProcess.stdin.write(input);
    this.logger.debug(
      `Sent input to MySQL session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const mysqlProcess = this.mysqlProcesses.get(sessionId);
      if (mysqlProcess) {
        mysqlProcess.kill();
        this.mysqlProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.logger.info(`MySQL session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(`Error closing MySQL session ${sessionId}:`, error);
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

    const mysqlOptions = options as MySQLConnectionOptions;

    // Build MySQL connection command
    const mysqlCommand = this.buildMySQLCommand(mysqlOptions);

    // Spawn MySQL process
    const mysqlProcess = spawn(mysqlCommand[0], mysqlCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    // Set up output handling
    mysqlProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    mysqlProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    mysqlProcess.on('error', (error) => {
      this.logger.error(`MySQL process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    mysqlProcess.on('close', (code) => {
      this.logger.info(
        `MySQL process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.mysqlProcesses.set(sessionId, mysqlProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: mysqlCommand[0],
      args: mysqlCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `MySQL session ${sessionId} created for ${mysqlOptions.host || 'localhost'}:${mysqlOptions.port || 3306}`
    );
    this.emit('session-created', { sessionId, type: 'mysql', session });

    return session;
  }

  private async checkMySQLClientAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('mysql', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error('MySQL client not found. Please install MySQL client.')
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error('MySQL client not found. Please install MySQL client.')
        );
      });
    });
  }

  private buildMySQLCommand(options: MySQLConnectionOptions): string[] {
    const command = ['mysql'];

    // Connection parameters
    if (options.host) {
      command.push('-h', options.host);
    }

    if (options.port) {
      command.push('-P', options.port.toString());
    }

    if (options.user || options.username) {
      command.push('-u', options.user || options.username!);
    }

    if (options.password) {
      command.push(`-p${options.password}`);
    }

    if (options.database || options.schema) {
      command.push(options.database || options.schema!);
    }

    if (options.ssl) {
      command.push('--ssl-mode=REQUIRED');
    }

    if (options.socketPath) {
      command.push('-S', options.socketPath);
    }

    if (options.charset) {
      command.push('--default-character-set=' + options.charset);
    }

    // Interactive mode
    command.push('-i');

    return command;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up MySQL protocol');

    // Close all MySQL processes
    for (const [sessionId, process] of Array.from(this.mysqlProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing MySQL process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.mysqlProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default MySQLProtocol;
