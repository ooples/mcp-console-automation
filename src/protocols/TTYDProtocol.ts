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

// TTYD Protocol connection options
interface TTYDConnectionOptions extends SessionOptions {
  // Basic TTYD Configuration
  executable?: string;
  port?: number;
  interface?: string;
  indexFile?: string;
  socketPath?: string;
  terminalType?: string;

  // Authentication and Security
  credential?: string;
  userid?: string;
  gid?: string;
  enableBasicAuth?: boolean;
  sslCert?: string;
  sslKey?: string;
  sslCaCert?: string;
  verifySsl?: boolean;
  enableSsl?: boolean;
  forceSsl?: boolean;
  maxClients?: number;
  clientTimeOut?: number;

  // Terminal Configuration
  enableWriteable?: boolean;
  onceMode?: boolean;
  checkOrigin?: boolean;
  allowWriteableConnections?: boolean;
  maxConnectionsPerIp?: number;
  signalList?: string;
  reconnect?: number;

  // Logging and Debug
  debugLevel?: number;
  enableSyslog?: boolean;
  logFile?: string;
  accessLog?: string;

  // TTY Settings
  columns?: number;
  rows?: number;
  closeSignal?: string;
  titleFixed?: string;
  ptyPath?: string;

  // Advanced Options
  baseUrl?: string;
  urlArg?: boolean;
  ipv6Support?: boolean;
  keepAliveInterval?: number;
  pingInterval?: number;
  pongTimeout?: number;
  startSessionTimeout?: number;

  // Command and Shell
  shell?: string;
  shellCommand?: string;
  loginCommand?: string;
  homeDir?: string;
  loginShell?: boolean;

  // Environment Variables
  termEnv?: Record<string, string>;
  processEnvironment?: Record<string, string>;

  // Browser and Client
  browserCommand?: string;
  enableBrowser?: boolean;
  enableFullscreen?: boolean;
  terminalTheme?: string;
  fontFamily?: string;
  fontSize?: number;

  // WebSocket Configuration
  wsOrigin?: string;
  enableCors?: boolean;
  corsOrigin?: string;

  // Process Management
  enableKillAllOnExit?: boolean;
  gracefulShutdown?: boolean;
  processCleanup?: boolean;

  // Network and Performance
  bufferSize?: number;
  outputBufferSize?: number;
  enableCompression?: boolean;
  compressionLevel?: number;
  enableZlibDeflate?: boolean;
  enablePermessageDeflate?: boolean;

  // Monitoring and Health
  enableHealthCheck?: boolean;
  healthCheckPath?: string;
  enableMetrics?: boolean;
  metricsPath?: string;
  enableStatus?: boolean;
  statusPath?: string;

  // Security Headers
  enableSecurityHeaders?: boolean;
  cspDirectives?: string;
  enableHsts?: boolean;
  hstsMaxAge?: number;
  enableXssProtection?: boolean;
  enableFrameOptions?: boolean;
  enableContentTypeNosniff?: boolean;

  // Session Management
  enableSessionTimeout?: boolean;
  sessionTimeout?: number;
  enableIdleTimeout?: boolean;
  idleTimeout?: number;
  enableMaxSessions?: boolean;
  maxSessions?: number;

  // File and Directory Access
  enableFileAccess?: boolean;
  allowedDirectories?: string[];
  restrictedDirectories?: string[];
  enableUpload?: boolean;
  uploadPath?: string;
  enableDownload?: boolean;

  // Integration Options
  enableWebdav?: boolean;
  webdavPath?: string;
  enableFtp?: boolean;
  ftpPort?: number;
  enableSftp?: boolean;
  sftpPort?: number;

  // Customization
  customCss?: string;
  customJs?: string;
  customTitle?: string;
  customFavicon?: string;
  customLogo?: string;
  enableCustomization?: boolean;

  // Plugin and Extension Support
  enablePlugins?: boolean;
  pluginDirectory?: string;
  enableExtensions?: boolean;
  extensionPath?: string;

  // Proxy and Load Balancing
  enableProxy?: boolean;
  proxyUrl?: string;
  proxyTimeout?: number;
  enableLoadBalancing?: boolean;
  loadBalancerConfig?: string;

  // Backup and Recovery
  enableBackup?: boolean;
  backupPath?: string;
  backupInterval?: number;
  enableAutoRestore?: boolean;

  // Advanced Terminal Features
  enableScrollback?: boolean;
  scrollbackLines?: number;
  enableCopyPaste?: boolean;
  enableRightClick?: boolean;
  enableQuickEdit?: boolean;
  enableInsertMode?: boolean;

  // WebRTC and P2P
  enableWebrtc?: boolean;
  webrtcConfig?: string;
  enableP2p?: boolean;
  p2pConfig?: string;

  // Docker and Container Integration
  enableDocker?: boolean;
  dockerImage?: string;
  dockerContainer?: string;
  dockerNetwork?: string;
  enableKubernetes?: boolean;
  kubernetesConfig?: string;
}

/**
 * TTYD Protocol Implementation
 *
 * Provides web-based terminal access through ttyd server
 * Supports HTTP/HTTPS terminal servers, authentication, real-time terminal streaming, and web terminal management
 */
export class TTYDProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'web-terminal';
  public readonly capabilities: ProtocolCapabilities;

  private ttydProcesses = new Map<string, ChildProcess>();

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
    super('ttyd');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: true,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 1000, // TTYD can handle many web terminal sessions
      defaultTimeout: 30000, // Web terminal operations
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['basic', 'bearer', 'custom'],
      platformSupport: {
        windows: true, // TTYD supports Windows through WSL/MinGW
        linux: true,
        macos: true,
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if TTYD is available
      await this.checkTtydAvailability();
      this.isInitialized = true;
      this.logger.info('TTYD protocol initialized with web terminal features');
    } catch (error: any) {
      this.logger.error('Failed to initialize TTYD protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `ttyd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const ttydProcess = this.ttydProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!ttydProcess || !ttydProcess.stdin || !session) {
      throw new Error(`No active TTYD session: ${sessionId}`);
    }

    ttydProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to TTYD session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const ttydProcess = this.ttydProcesses.get(sessionId);
      if (ttydProcess) {
        // Try graceful shutdown first
        ttydProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (ttydProcess && !ttydProcess.killed) {
            ttydProcess.kill('SIGKILL');
          }
        }, 10000);

        this.ttydProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`TTYD session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing TTYD session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const ttydOptions = options as TTYDConnectionOptions;

    // Build TTYD command
    const ttydCommand = this.buildTtydCommand(ttydOptions);

    // Spawn TTYD process
    const ttydProcess = spawn(ttydCommand[0], ttydCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(ttydOptions), ...options.env }
    });

    // Set up output handling
    ttydProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    ttydProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    ttydProcess.on('error', (error) => {
      this.logger.error(`TTYD process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    ttydProcess.on('close', (code) => {
      this.logger.info(`TTYD process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.ttydProcesses.set(sessionId, ttydProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: ttydCommand[0],
      args: ttydCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(ttydOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: ttydProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`TTYD session ${sessionId} created on port ${ttydOptions.port || 7681}`);
    this.emit('session-created', { sessionId, type: 'web-terminal', session });

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
      isOneShot: false, // TTYD sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in TTYD session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const ttydProcess = this.ttydProcesses.get(sessionId);
    return ttydProcess && !ttydProcess.killed || false;
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
        connectionsActive: this.ttydProcesses.size
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
      await this.checkTtydAvailability();
      return {
        ...baseStatus,
        dependencies: {
          ttyd: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `TTYD not available: ${error}`],
        dependencies: {
          ttyd: { available: false }
        }
      };
    }
  }

  private async checkTtydAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ttyd', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('TTYD not found. Please install ttyd.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('TTYD not found. Please install ttyd.'));
      });
    });
  }

  private buildTtydCommand(options: TTYDConnectionOptions): string[] {
    const command = [];

    // TTYD executable
    if (options.executable) {
      command.push(options.executable);
    } else {
      command.push('ttyd');
    }

    // Port configuration
    if (options.port) {
      command.push('-p', options.port.toString());
    }

    // Interface binding
    if (options.interface) {
      command.push('-i', options.interface);
    }

    // Authentication
    if (options.credential) {
      command.push('-c', options.credential);
    }

    if (options.userid) {
      command.push('-u', options.userid);
    }

    if (options.gid) {
      command.push('-g', options.gid);
    }

    // SSL/TLS configuration
    if (options.enableSsl) {
      if (options.sslCert) {
        command.push('-C', options.sslCert);
      }
      if (options.sslKey) {
        command.push('-K', options.sslKey);
      }
      if (options.sslCaCert) {
        command.push('-A', options.sslCaCert);
      }
    }

    // Terminal configuration
    if (options.enableWriteable) {
      command.push('-W');
    }

    if (options.onceMode) {
      command.push('-o');
    }

    if (options.checkOrigin) {
      command.push('-O');
    }

    if (options.maxClients) {
      command.push('-m', options.maxClients.toString());
    }

    if (options.clientTimeOut) {
      command.push('-t', options.clientTimeOut.toString());
    }

    // Terminal settings
    if (options.indexFile) {
      command.push('-I', options.indexFile);
    }

    if (options.socketPath) {
      command.push('-s', options.socketPath);
    }

    if (options.terminalType) {
      command.push('-T', options.terminalType);
    }

    // Debug and logging
    if (options.debugLevel) {
      command.push('-d', options.debugLevel.toString());
    }

    if (options.enableSyslog) {
      command.push('-S');
    }

    if (options.logFile) {
      command.push('-L', options.logFile);
    }

    if (options.accessLog) {
      command.push('-l', options.accessLog);
    }

    // Signal configuration
    if (options.signalList) {
      command.push('-a', options.signalList);
    }

    if (options.closeSignal) {
      command.push('-k', options.closeSignal);
    }

    // Reconnection support
    if (options.reconnect) {
      command.push('-r', options.reconnect.toString());
    }

    // Base URL
    if (options.baseUrl) {
      command.push('-b', options.baseUrl);
    }

    // URL arguments
    if (options.urlArg) {
      command.push('-R');
    }

    // IPv6 support
    if (options.ipv6Support) {
      command.push('-6');
    }

    // Keep alive settings
    if (options.keepAliveInterval) {
      command.push('-P', options.keepAliveInterval.toString());
    }

    // Terminal title
    if (options.titleFixed) {
      command.push('-T', options.titleFixed);
    }

    // PTY path
    if (options.ptyPath) {
      command.push('-E', options.ptyPath);
    }

    // Shell command
    if (options.shell) {
      command.push(options.shell);
    } else if (options.shellCommand) {
      command.push(options.shellCommand);
    } else {
      // Default shell
      if (process.platform === 'win32') {
        command.push('cmd');
      } else {
        command.push('bash');
      }
    }

    // Command arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: TTYDConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Terminal environment
    if (options.termEnv) {
      Object.assign(env, options.termEnv);
    }

    // Process environment
    if (options.processEnvironment) {
      Object.assign(env, options.processEnvironment);
    }

    // Terminal type
    if (options.terminalType) {
      env.TERM = options.terminalType;
    }

    // Terminal size
    if (options.columns) {
      env.COLUMNS = options.columns.toString();
    }

    if (options.rows) {
      env.LINES = options.rows.toString();
    }

    // Home directory
    if (options.homeDir) {
      env.HOME = options.homeDir;
    }

    // Shell configuration
    if (options.shell) {
      env.SHELL = options.shell;
    }

    // TTYD specific environment
    env.TTYD_SESSION = 'true';

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up TTYD protocol');

    // Close all TTYD processes
    for (const [sessionId, process] of Array.from(this.ttydProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing TTYD process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.ttydProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default TTYDProtocol;