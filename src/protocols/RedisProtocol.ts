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

// Redis Client connection options
interface RedisConnectionOptions extends SessionOptions {
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  username?: string;
  ssl?: boolean;
  connectTimeout?: number;
  sentinelMaster?: string;
  sentinelHosts?: Array<{ host: string; port: number }>;
  clusterMode?: boolean;
  uri?: string;
}

/**
 * Redis Protocol Implementation
 *
 * Provides Redis database console access through redis-cli
 * Supports both local and remote Redis connections with authentication
 */
export class RedisProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'redis';
  public readonly capabilities: ProtocolCapabilities;

  private redisProcesses = new Map<string, ChildProcess>();

  constructor() {
    super('redis');

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
      supportedAuthMethods: ['password', 'ssl'],
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
      // Check if redis-cli client is available
      await this.checkRedisClientAvailability();
      this.isInitialized = true;
      this.logger.info('Redis protocol initialized with session management fixes');
    } catch (error: any) {
      this.logger.error('Failed to initialize Redis protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `redis-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const redisProcess = this.redisProcesses.get(sessionId);
    if (!redisProcess || !redisProcess.stdin) {
      throw new Error(`No active Redis connection for session: ${sessionId}`);
    }

    redisProcess.stdin.write(input);
    this.logger.debug(`Sent input to Redis session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const redisProcess = this.redisProcesses.get(sessionId);
      if (redisProcess) {
        redisProcess.kill();
        this.redisProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.logger.info(`Redis session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(`Error closing Redis session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const redisOptions = options as RedisConnectionOptions;

    // Build Redis connection command
    const redisCommand = this.buildRedisCommand(redisOptions);

    // Spawn redis-cli process
    const redisProcess = spawn(redisCommand[0], redisCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env }
    });

    // Set up output handling
    redisProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    redisProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    redisProcess.on('error', (error) => {
      this.logger.error(`Redis process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    redisProcess.on('close', (code) => {
      this.logger.info(`Redis process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.redisProcesses.set(sessionId, redisProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: redisCommand[0],
      args: redisCommand.slice(1),
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

    this.logger.info(`Redis session ${sessionId} created for ${redisOptions.host || 'localhost'}:${redisOptions.port || 6379}`);
    this.emit('session-created', { sessionId, type: 'redis', session });

    return session;
  }

  private async checkRedisClientAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('redis-cli', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Redis CLI not found. Please install Redis CLI.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Redis CLI not found. Please install Redis CLI.'));
      });
    });
  }

  private buildRedisCommand(options: RedisConnectionOptions): string[] {
    if (options.uri) {
      return ['redis-cli', '-u', options.uri];
    }

    const command = ['redis-cli'];

    // Connection parameters
    if (options.host) {
      command.push('-h', options.host);
    }

    if (options.port) {
      command.push('-p', options.port.toString());
    }

    if (options.username) {
      command.push('--user', options.username);
    }

    if (options.password) {
      command.push('-a', options.password);
    }

    if (options.database !== undefined) {
      command.push('-n', options.database.toString());
    }

    if (options.ssl) {
      command.push('--tls');
    }

    // Interactive mode
    command.push('-i');

    return command;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Redis protocol');

    // Close all Redis processes
    for (const [sessionId, process] of Array.from(this.redisProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Redis process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.redisProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default RedisProtocol;