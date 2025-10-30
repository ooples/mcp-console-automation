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

// SQLite Client connection options
interface SQLiteConnectionOptions extends SessionOptions {
  database?: string;
  file?: string;
  readOnly?: boolean;
  timeout?: number;
  extensions?: string[];
  initScript?: string;
  pragma?: Record<string, string>;
}

/**
 * SQLite Protocol Implementation
 *
 * Provides SQLite database console access through sqlite3 CLI
 * Supports both file-based and in-memory SQLite databases
 */
export class SQLiteProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'sqlite';
  public readonly capabilities: ProtocolCapabilities;

  private sqliteProcesses = new Map<string, ChildProcess>();

  constructor() {
    super('sqlite');

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
      supportsPTY: false,
      maxConcurrentSessions: 50,
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
      // Check if sqlite3 client is available
      await this.checkSQLiteClientAvailability();
      this.isInitialized = true;
      this.logger.info(
        'SQLite protocol initialized with session management fixes'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize SQLite protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `sqlite-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const sqliteProcess = this.sqliteProcesses.get(sessionId);
    if (!sqliteProcess || !sqliteProcess.stdin) {
      throw new Error(`No active SQLite connection for session: ${sessionId}`);
    }

    sqliteProcess.stdin.write(input);
    this.logger.debug(
      `Sent input to SQLite session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const sqliteProcess = this.sqliteProcesses.get(sessionId);
      if (sqliteProcess) {
        sqliteProcess.kill();
        this.sqliteProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.logger.info(`SQLite session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(`Error closing SQLite session ${sessionId}:`, error);
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

    const sqliteOptions = options as SQLiteConnectionOptions;

    // Build SQLite connection command
    const sqliteCommand = this.buildSQLiteCommand(sqliteOptions);

    // Spawn sqlite3 process
    const sqliteProcess = spawn(sqliteCommand[0], sqliteCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    // Set up output handling
    sqliteProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    sqliteProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    sqliteProcess.on('error', (error) => {
      this.logger.error(
        `SQLite process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    sqliteProcess.on('close', (code) => {
      this.logger.info(
        `SQLite process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.sqliteProcesses.set(sessionId, sqliteProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: sqliteCommand[0],
      args: sqliteCommand.slice(1),
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
      `SQLite session ${sessionId} created for database ${sqliteOptions.database || sqliteOptions.file || ':memory:'}`
    );
    this.emit('session-created', { sessionId, type: 'sqlite', session });

    return session;
  }

  private async checkSQLiteClientAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('sqlite3', ['-version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('SQLite CLI not found. Please install SQLite.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('SQLite CLI not found. Please install SQLite.'));
      });
    });
  }

  private buildSQLiteCommand(options: SQLiteConnectionOptions): string[] {
    const command = ['sqlite3'];

    // Database file (or :memory: for in-memory database)
    const database = options.database || options.file || ':memory:';
    command.push(database);

    // Read-only mode
    if (options.readOnly) {
      command.push('-readonly');
    }

    // Interactive mode with headers and column mode
    command.push('-header', '-column');

    return command;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up SQLite protocol');

    // Close all SQLite processes
    for (const [sessionId, process] of Array.from(this.sqliteProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing SQLite process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.sqliteProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default SQLiteProtocol;
