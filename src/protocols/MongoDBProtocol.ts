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
  ErrorContext
} from '../core/IProtocol.js';

// MongoDB Client connection options
interface MongoDBConnectionOptions extends SessionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  authSource?: string;
  ssl?: boolean;
  connectTimeout?: number;
  socketTimeout?: number;
  replicaSet?: string;
  uri?: string;
}

/**
 * MongoDB Protocol Implementation
 *
 * Provides MongoDB database console access through mongosh CLI
 * Supports both local and remote MongoDB connections with authentication
 */
export class MongoDBProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'mongodb';
  public readonly capabilities: ProtocolCapabilities;

  private mongoProcesses = new Map<string, ChildProcess>();

  constructor() {
    super('mongodb');

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
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'ssl', 'x509'],
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
      // Check if mongosh client is available
      await this.checkMongoClientAvailability();
      this.isInitialized = true;
      this.logger.info('MongoDB protocol initialized with session management fixes');
    } catch (error: any) {
      this.logger.error('Failed to initialize MongoDB protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `mongodb-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const mongoProcess = this.mongoProcesses.get(sessionId);
    if (!mongoProcess || !mongoProcess.stdin) {
      throw new Error(`No active MongoDB connection for session: ${sessionId}`);
    }

    mongoProcess.stdin.write(input);
    this.logger.debug(`Sent input to MongoDB session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const mongoProcess = this.mongoProcesses.get(sessionId);
      if (mongoProcess) {
        mongoProcess.kill();
        this.mongoProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.logger.info(`MongoDB session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(`Error closing MongoDB session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const mongoOptions = options as MongoDBConnectionOptions;

    // Build MongoDB connection command
    const mongoCommand = this.buildMongoCommand(mongoOptions);

    // Spawn mongosh process
    const mongoProcess = spawn(mongoCommand[0], mongoCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env }
    });

    // Set up output handling
    mongoProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    mongoProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    mongoProcess.on('error', (error) => {
      this.logger.error(`MongoDB process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    mongoProcess.on('close', (code) => {
      this.logger.info(`MongoDB process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.mongoProcesses.set(sessionId, mongoProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: mongoCommand[0],
      args: mongoCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map()
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`MongoDB session ${sessionId} created for ${mongoOptions.host || 'localhost'}:${mongoOptions.port || 27017}`);
    this.emit('session-created', { sessionId, type: 'mongodb', session });

    return session;
  }

  private async checkMongoClientAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('mongosh', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('MongoDB shell (mongosh) not found. Please install MongoDB shell.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('MongoDB shell (mongosh) not found. Please install MongoDB shell.'));
      });
    });
  }

  private buildMongoCommand(options: MongoDBConnectionOptions): string[] {
    if (options.uri) {
      return ['mongosh', options.uri];
    }

    const command = ['mongosh'];

    // Connection parameters
    if (options.host) {
      command.push('--host', options.host);
    }

    if (options.port) {
      command.push('--port', options.port.toString());
    }

    if (options.username) {
      command.push('--username', options.username);
    }

    if (options.password) {
      command.push('--password', options.password);
    }

    if (options.database) {
      command.push(options.database);
    }

    if (options.authSource) {
      command.push('--authenticationDatabase', options.authSource);
    }

    if (options.ssl) {
      command.push('--ssl');
    }

    return command;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up MongoDB protocol');

    // Close all MongoDB processes
    for (const [sessionId, process] of Array.from(this.mongoProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing MongoDB process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.mongoProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default MongoDBProtocol;