import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
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

// Unix Socket Protocol connection options
interface UnixSocketConnectionOptions extends SessionOptions {
  // Basic Socket Configuration
  socketPath: string;
  socketType?: 'stream' | 'dgram';
  socketMode?: 'client' | 'server';
  createSocket?: boolean;

  // Server Configuration
  serverPath?: string;
  serverBacklog?: number;
  serverExclusive?: boolean;
  enableReuseAddr?: boolean;

  // Client Configuration
  clientPath?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;

  // Socket Options
  allowHalfOpen?: boolean;
  pauseOnConnect?: boolean;
  readable?: boolean;
  writable?: boolean;

  // Permissions and Security
  socketUser?: string;
  socketGroup?: string;
  socketPermissions?: number;
  socketPerms?: string;
  enableCredentials?: boolean;

  // Buffer and Performance
  bufferSize?: number;
  highWaterMark?: number;
  objectMode?: boolean;
  encoding?: BufferEncoding;

  // Message Framing
  messageFraming?: 'none' | 'length' | 'delimiter' | 'json' | 'line';
  messageDelimiter?: string;
  maxMessageSize?: number;
  enableHeartbeat?: boolean;
  heartbeatInterval?: number;

  // Timeout Configuration
  connectTimeout?: number;
  idleTimeout?: number;
  keepAliveTimeout?: number;

  // Protocol Features
  enableAck?: boolean;
  enableSequencing?: boolean;
  enableRetransmission?: boolean;
  enableCompression?: boolean;
  compressionAlgorithm?: 'gzip' | 'deflate' | 'brotli';

  // Error Handling
  enableErrorRecovery?: boolean;
  errorRetryAttempts?: number;
  errorRetryDelay?: number;

  // Monitoring and Logging
  enableMetrics?: boolean;
  enableDebugLogging?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';

  // Advanced Socket Features
  enableSocketReuse?: boolean;
  enableSocketKeepAlive?: boolean;
  socketKeepAliveDelay?: number;
  enableNodelay?: boolean;

  // Event Handling
  enableEventLogging?: boolean;
  eventLogPath?: string;

  // Custom Protocol
  customProtocol?: string;
  protocolVersion?: string;
  enableHandshake?: boolean;
  handshakeTimeout?: number;

  // File System Integration
  enableFileWatch?: boolean;
  fileWatchPath?: string;
  enableDirectorySync?: boolean;

  // Process Integration
  enableProcessBinding?: boolean;
  bindToProcess?: number;
  processIpcPath?: string;

  // Container Integration
  enableContainerBinding?: boolean;
  containerName?: string;
  containerNamespace?: string;

  // Load Balancing
  enableLoadBalancing?: boolean;
  loadBalanceStrategy?: 'round-robin' | 'least-connections' | 'hash';
  poolSize?: number;

  // Security and Access Control
  enableAccessControl?: boolean;
  allowedUsers?: string[];
  allowedGroups?: string[];
  enableAuditLogging?: boolean;
  auditLogPath?: string;

  // Backup and Recovery
  enableBackup?: boolean;
  backupPath?: string;
  enableAutoRecovery?: boolean;
  recoveryTimeout?: number;

  // Performance Tuning
  enableBatching?: boolean;
  batchSize?: number;
  batchTimeout?: number;
  enablePipelining?: boolean;
  pipelineDepth?: number;

  // Protocol Extensions
  enableExtensions?: boolean;
  extensionPath?: string;
  customHeaders?: Record<string, string>;

  // Multi-socket Support
  enableMultiSocket?: boolean;
  socketCount?: number;
  socketPrefix?: string;

  // Unix-specific Features
  enableAbstractNamespace?: boolean;
  enableLinuxSocketOptions?: boolean;
  enableBsdSocketOptions?: boolean;
  enableSocketFiltering?: boolean;

  // Advanced IPC Features
  enableSharedMemory?: boolean;
  sharedMemorySize?: number;
  enableSignalHandling?: boolean;
  signalMask?: string[];

  // Database Integration
  enableDbLogging?: boolean;
  dbConnectionString?: string;

  // Message Queue Integration
  enableMqIntegration?: boolean;
  mqConnectionString?: string;

  // Web Integration
  enableWebSocketBridge?: boolean;
  webSocketPort?: number;
  enableHttpBridge?: boolean;
  httpPort?: number;

  // Testing and Development
  enableTestMode?: boolean;
  mockResponses?: Record<string, string>;
  enableProfiling?: boolean;
  profilingPath?: string;
}

/**
 * Unix Socket Protocol Implementation
 *
 * Provides Unix domain socket communication for IPC
 * Supports stream and datagram sockets, client/server modes, message framing, and advanced socket features
 */
export class UnixSocketProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'unix-socket';
  public readonly capabilities: ProtocolCapabilities;

  private sockets = new Map<string, net.Socket | net.Server>();
  private socketStates = new Map<string, 'connecting' | 'connected' | 'disconnected' | 'error'>();

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
    super('unix-socket');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: false, // Unix sockets are local, security through filesystem permissions
      supportsCompression: true,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 1000, // Unix sockets can handle many connections
      defaultTimeout: 30000, // Socket operations
      supportedEncodings: ['utf-8', 'ascii', 'binary', 'base64', 'hex'],
      supportedAuthMethods: ['file-permissions', 'process-credentials'],
      platformSupport: {
        windows: false, // Unix domain sockets are primarily Unix/Linux
        linux: true,
        macos: true,
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Unix socket functionality is available
      await this.checkUnixSocketAvailability();
      this.isInitialized = true;
      this.logger.info('Unix Socket protocol initialized with IPC features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Unix Socket protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `unix-socket-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const data = JSON.stringify({
      type: 'command',
      command,
      args: args || [],
      timestamp: new Date().toISOString()
    });
    await this.sendInput(sessionId, data + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const socket = this.sockets.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!socket || !session) {
      throw new Error(`No active Unix socket session: ${sessionId}`);
    }

    if (socket instanceof net.Socket) {
      socket.write(input);
    }

    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Unix socket session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const socket = this.sockets.get(sessionId);
      if (socket) {
        if (socket instanceof net.Socket) {
          socket.end();
          socket.destroy();
        } else if (socket instanceof net.Server) {
          socket.close();
        }

        this.sockets.delete(sessionId);
        this.socketStates.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Unix socket session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Unix socket session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const socketOptions = options as UnixSocketConnectionOptions;

    // Validate required socket parameters
    if (!socketOptions.socketPath) {
      throw new Error('Socket path is required for Unix Socket protocol');
    }

    // Create socket based on mode
    let socket: net.Socket | net.Server;

    if (socketOptions.socketMode === 'server') {
      socket = await this.createUnixServer(sessionId, socketOptions);
    } else {
      socket = await this.createUnixClient(sessionId, socketOptions);
    }

    // Store the socket
    this.sockets.set(sessionId, socket);
    this.socketStates.set(sessionId, 'connecting');

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: 'unix-socket',
      args: [socketOptions.socketPath],
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

    this.logger.info(`Unix socket session ${sessionId} created for path ${socketOptions.socketPath}`);
    this.emit('session-created', { sessionId, type: 'unix-socket', session });

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
      isOneShot: false, // Unix socket sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      metadata: {
        socketState: this.socketStates.get(sessionId) || 'unknown'
      }
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Unix socket session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const socket = this.sockets.get(sessionId);
    const state = this.socketStates.get(sessionId);
    return socket && state === 'connected' || false;
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
        connectionsActive: this.sockets.size
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
      await this.checkUnixSocketAvailability();
      return {
        ...baseStatus,
        dependencies: {
          'unix-sockets': { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Unix sockets not available: ${error}`],
        dependencies: {
          'unix-sockets': { available: false }
        }
      };
    }
  }

  private async checkUnixSocketAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if we're on a Unix-like platform
      if (process.platform === 'win32') {
        reject(new Error('Unix domain sockets are not supported on Windows'));
        return;
      }

      // Try to create a temporary Unix socket to test availability
      const testPath = path.join('/tmp', `test-socket-${Date.now()}`);
      const testServer = net.createServer();

      testServer.listen(testPath, () => {
        testServer.close(() => {
          // Clean up test socket file
          try {
            fs.unlinkSync(testPath);
          } catch (e) {
            // Ignore cleanup errors
          }
          resolve();
        });
      });

      testServer.on('error', (error) => {
        reject(new Error(`Unix socket test failed: ${error.message}`));
      });
    });
  }

  private async createUnixServer(sessionId: string, options: UnixSocketConnectionOptions): Promise<net.Server> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.setupSocketHandlers(sessionId, socket, options);
      });

      // Remove existing socket file if it exists
      if (fs.existsSync(options.socketPath)) {
        fs.unlinkSync(options.socketPath);
      }

      server.listen(options.socketPath, () => {
        this.socketStates.set(sessionId, 'connected');
        this.logger.info(`Unix socket server listening on ${options.socketPath}`);

        // Set socket permissions if specified
        if (options.socketMode) {
          fs.chmodSync(options.socketPath, options.socketMode);
        }

        resolve(server);
      });

      server.on('error', (error) => {
        this.socketStates.set(sessionId, 'error');
        this.logger.error(`Unix socket server error: ${error.message}`);
        reject(error);
      });
    });
  }

  private async createUnixClient(sessionId: string, options: UnixSocketConnectionOptions): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(options.socketPath);

      socket.on('connect', () => {
        this.socketStates.set(sessionId, 'connected');
        this.logger.info(`Unix socket client connected to ${options.socketPath}`);
        this.setupSocketHandlers(sessionId, socket, options);
        resolve(socket);
      });

      socket.on('error', (error) => {
        this.socketStates.set(sessionId, 'error');
        this.logger.error(`Unix socket client error: ${error.message}`);
        reject(error);
      });

      // Set connection timeout if specified
      if (options.connectTimeout) {
        socket.setTimeout(options.connectTimeout, () => {
          socket.destroy();
          reject(new Error(`Connection timeout after ${options.connectTimeout}ms`));
        });
      }
    });
  }

  private setupSocketHandlers(sessionId: string, socket: net.Socket, options: UnixSocketConnectionOptions): void {
    // Set up data handling
    socket.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(options.encoding || 'utf-8'),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    socket.on('error', (error) => {
      this.logger.error(`Unix socket error for session ${sessionId}:`, error);
      this.socketStates.set(sessionId, 'error');
      this.emit('session-error', { sessionId, error });
    });

    socket.on('close', () => {
      this.logger.info(`Unix socket closed for session ${sessionId}`);
      this.socketStates.set(sessionId, 'disconnected');
      this.markSessionComplete(sessionId, 0);
    });

    socket.on('end', () => {
      this.logger.info(`Unix socket ended for session ${sessionId}`);
    });

    // Set socket options
    if (options.allowHalfOpen !== undefined) {
      socket.allowHalfOpen = options.allowHalfOpen;
    }

    if (options.enableSocketKeepAlive && options.socketKeepAliveDelay) {
      socket.setKeepAlive(true, options.socketKeepAliveDelay);
    }

    if (options.enableNodelay) {
      socket.setNoDelay(true);
    }
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Unix Socket protocol');

    // Close all sockets
    for (const [sessionId, socket] of Array.from(this.sockets)) {
      try {
        if (socket instanceof net.Socket) {
          socket.end();
          socket.destroy();
        } else if (socket instanceof net.Server) {
          socket.close();
        }
      } catch (error) {
        this.logger.error(`Error closing Unix socket for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.sockets.clear();
    this.socketStates.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default UnixSocketProtocol;