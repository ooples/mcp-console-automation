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

// PostgreSQL Client connection options
interface PostgreSQLConnectionOptions extends SessionOptions {
  host?: string;
  port?: number;
  user?: string;
  username?: string;
  password?: string;
  database?: string;
  dbname?: string;
  ssl?: boolean;
  sslmode?:
    | 'disable'
    | 'allow'
    | 'prefer'
    | 'require'
    | 'verify-ca'
    | 'verify-full';
  connectTimeout?: number;
}

/**
 * PostgreSQL Protocol Implementation
 *
 * Provides PostgreSQL database console access through psql CLI
 * Supports both local and remote PostgreSQL connections with authentication
 */
export class PostgreSQLProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'postgresql';
  public readonly capabilities: ProtocolCapabilities;

  private psqlProcesses = new Map<string, ChildProcess>();

  constructor() {
    super('postgresql');

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
      supportedEncodings: ['utf-8', 'latin1', 'sql_ascii'],
      supportedAuthMethods: ['password', 'md5', 'scram-sha-256', 'ssl'],
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
      // Check if psql client is available
      await this.checkPSQLClientAvailability();
      this.isInitialized = true;
      this.logger.info(
        'PostgreSQL protocol initialized with session management fixes'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize PostgreSQL protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `postgresql-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const psqlProcess = this.psqlProcesses.get(sessionId);
    if (!psqlProcess || !psqlProcess.stdin) {
      throw new Error(
        `No active PostgreSQL connection for session: ${sessionId}`
      );
    }

    psqlProcess.stdin.write(input);
    this.logger.debug(
      `Sent input to PostgreSQL session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const psqlProcess = this.psqlProcesses.get(sessionId);
      if (psqlProcess) {
        psqlProcess.kill();
        this.psqlProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.logger.info(`PostgreSQL session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(
        `Error closing PostgreSQL session ${sessionId}:`,
        error
      );
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

    const psqlOptions = options as PostgreSQLConnectionOptions;

    // Build PostgreSQL connection command
    const psqlCommand = this.buildPSQLCommand(psqlOptions);

    // Spawn psql process
    const psqlProcess = spawn(psqlCommand[0], psqlCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    // Set up output handling
    psqlProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    psqlProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    psqlProcess.on('error', (error) => {
      this.logger.error(
        `PostgreSQL process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    psqlProcess.on('close', (code) => {
      this.logger.info(
        `PostgreSQL process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.psqlProcesses.set(sessionId, psqlProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: psqlCommand[0],
      args: psqlCommand.slice(1),
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
      `PostgreSQL session ${sessionId} created for ${psqlOptions.host || 'localhost'}:${psqlOptions.port || 5432}`
    );
    this.emit('session-created', { sessionId, type: 'postgresql', session });

    return session;
  }

  private async checkPSQLClientAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('psql', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              'PostgreSQL client (psql) not found. Please install PostgreSQL client.'
            )
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error(
            'PostgreSQL client (psql) not found. Please install PostgreSQL client.'
          )
        );
      });
    });
  }

  private buildPSQLCommand(options: PostgreSQLConnectionOptions): string[] {
    const command = ['psql'];

    // Connection parameters
    if (options.host) {
      command.push('-h', options.host);
    }

    if (options.port) {
      command.push('-p', options.port.toString());
    }

    if (options.user || options.username) {
      command.push('-U', options.user || options.username!);
    }

    if (options.database || options.dbname) {
      command.push('-d', options.database || options.dbname!);
    }

    if (options.sslmode) {
      // Set environment variable for SSL mode
      process.env.PGSSLMODE = options.sslmode;
    } else if (options.ssl) {
      process.env.PGSSLMODE = 'require';
    }

    if (options.password) {
      // Set password via environment variable
      process.env.PGPASSWORD = options.password;
    }

    return command;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up PostgreSQL protocol');

    // Close all psql processes
    for (const [sessionId, process] of Array.from(this.psqlProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing PostgreSQL process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.psqlProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PostgreSQLProtocol;
