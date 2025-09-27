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

// Cassandra Client connection options
interface CassandraConnectionOptions extends SessionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  keyspace?: string;
  ssl?: boolean;
  connectTimeout?: number;
  consistencyLevel?: string;
  datacenter?: string;
  protocolVersion?: number;
  cqlVersion?: string;
}

/**
 * Cassandra Protocol Implementation
 *
 * Provides Cassandra database console access through cqlsh CLI
 * Supports both local and remote Cassandra connections with authentication
 */
export class CassandraProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'cassandra';
  public readonly capabilities: ProtocolCapabilities;

  private cassandraProcesses = new Map<string, ChildProcess>();

  constructor() {
    super('cassandra');

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
      // Check if cqlsh client is available
      await this.checkCassandraClientAvailability();
      this.isInitialized = true;
      this.logger.info('Cassandra protocol initialized with session management fixes');
    } catch (error: any) {
      this.logger.error('Failed to initialize Cassandra protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `cassandra-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const cassandraProcess = this.cassandraProcesses.get(sessionId);
    if (!cassandraProcess || !cassandraProcess.stdin) {
      throw new Error(`No active Cassandra connection for session: ${sessionId}`);
    }

    cassandraProcess.stdin.write(input);
    this.logger.debug(`Sent input to Cassandra session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const cassandraProcess = this.cassandraProcesses.get(sessionId);
      if (cassandraProcess) {
        cassandraProcess.kill();
        this.cassandraProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.logger.info(`Cassandra session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(`Error closing Cassandra session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const cassandraOptions = options as CassandraConnectionOptions;

    // Build Cassandra connection command
    const cassandraCommand = this.buildCassandraCommand(cassandraOptions);

    // Spawn cqlsh process
    const cassandraProcess = spawn(cassandraCommand[0], cassandraCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env }
    });

    // Set up output handling
    cassandraProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    cassandraProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    cassandraProcess.on('error', (error) => {
      this.logger.error(`Cassandra process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    cassandraProcess.on('close', (code) => {
      this.logger.info(`Cassandra process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.cassandraProcesses.set(sessionId, cassandraProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: cassandraCommand[0],
      args: cassandraCommand.slice(1),
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

    this.logger.info(`Cassandra session ${sessionId} created for ${cassandraOptions.host || 'localhost'}:${cassandraOptions.port || 9042}`);
    this.emit('session-created', { sessionId, type: 'cassandra', session });

    return session;
  }

  private async checkCassandraClientAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('cqlsh', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Cassandra CQL shell (cqlsh) not found. Please install Cassandra CQL shell.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Cassandra CQL shell (cqlsh) not found. Please install Cassandra CQL shell.'));
      });
    });
  }

  private buildCassandraCommand(options: CassandraConnectionOptions): string[] {
    const command = ['cqlsh'];

    // Connection parameters
    if (options.host) {
      command.push(options.host);
    }

    if (options.port) {
      command.push(options.port.toString());
    }

    if (options.username) {
      command.push('-u', options.username);
    }

    if (options.password) {
      command.push('-p', options.password);
    }

    if (options.keyspace) {
      command.push('-k', options.keyspace);
    }

    if (options.ssl) {
      command.push('--ssl');
    }

    if (options.cqlVersion) {
      command.push('--cqlversion', options.cqlVersion);
    }

    if (options.protocolVersion) {
      command.push('--protocol-version', options.protocolVersion.toString());
    }

    return command;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Cassandra protocol');

    // Close all Cassandra processes
    for (const [sessionId, process] of Array.from(this.cassandraProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Cassandra process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.cassandraProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default CassandraProtocol;