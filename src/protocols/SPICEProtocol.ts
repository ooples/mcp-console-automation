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

// SPICE Protocol connection options
interface SPICEConnectionOptions extends SessionOptions {
  // Basic SPICE Configuration
  host?: string;
  port?: number;
  password?: string;
  channel?: string;

  // SPICE Client Configuration
  spiceClient?: string;
  spiceGtkClient?: string;
  remoteViewerClient?: string;

  // Connection Security
  spicePassword?: string;
  spiceTicket?: string;
  spiceCertSubject?: string;
  spiceCaCertFile?: string;
  spiceHostSubject?: string;
  tlsPort?: number;
  enableTLS?: boolean;
  enableAuth?: boolean;
  insecure?: boolean;

  // Display Configuration
  fullscreen?: boolean;
  monitor?: number;
  monitorMapping?: string;
  displayId?: number;
  enableSpiceDisplays?: boolean;
  enableSpiceInputs?: boolean;
  enableSpiceAudio?: boolean;
  enableSpiceUsb?: boolean;
  enableSpiceSmartcard?: boolean;

  // Audio Configuration
  audioBackend?: 'pulse' | 'alsa' | 'auto' | 'none';
  disableAudio?: boolean;
  audioDelay?: number;

  // USB Redirection
  usbRedirection?: boolean;
  usbFilter?: string;
  usbAutoConnect?: boolean;
  spiceGtkUsbAutoConnect?: boolean;

  // Smartcard Support
  smartcardSupport?: boolean;
  smartcardDatabase?: string;
  smartcardCertificates?: string[];

  // Clipboard Integration
  enableClipboard?: boolean;
  clipboardSelection?: 'clipboard' | 'primary';

  // File Transfer
  enableFileTransfer?: boolean;
  sharedDir?: string;

  // Performance Options
  colorDepth?: 16 | 24 | 32;
  enableCompression?: boolean;
  compressionType?: 'auto' | 'never' | 'always';
  imageCompressionType?: 'auto_glz' | 'auto_lz' | 'quic' | 'glz' | 'lz' | 'off';
  jpegWanCompressionType?: 'auto' | 'never' | 'always';
  zlibGlzWanCompressionType?: 'auto' | 'never' | 'always';
  streamingVideoMode?: 'filter' | 'all' | 'off';
  playbackCompressionMode?: 'on' | 'off';

  // Network Configuration
  proxyHost?: string;
  proxyPort?: number;
  proxyUser?: string;
  proxyPassword?: string;

  // Advanced Options
  spiceAgentFileTransfer?: boolean;
  spiceAgentCopyPaste?: boolean;
  spiceGtkGrabSequence?: string;
  spiceGtkAccelMap?: string;
  releaseKeysSequence?: string;
  grabKeyboard?: boolean;
  grabMouse?: boolean;
  resizeGuest?: boolean;
  spiceDisableEffects?: string[];

  // Logging and Debugging
  debugLevel?: 'error' | 'warning' | 'info' | 'debug';
  enableLogging?: boolean;
  logFile?: string;

  // Connection Management
  connectionTimeout?: number;
  reconnectDelay?: number;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;

  // SPICE Server Configuration (when acting as server)
  serverMode?: boolean;
  serverPort?: number;
  serverPassword?: string;
  serverTlsPort?: number;
  serverCertFile?: string;
  serverKeyFile?: string;
  serverCaCertFile?: string;
  serverCertSubject?: string;
  serverImageCompressionType?: 'auto_glz' | 'auto_lz' | 'quic' | 'glz' | 'lz' | 'off';
  serverJpegWanCompressionType?: 'auto' | 'never' | 'always';
  serverZlibGlzWanCompressionType?: 'auto' | 'never' | 'always';
  serverStreamingVideoMode?: 'filter' | 'all' | 'off';
  serverPlaybackCompressionMode?: 'on' | 'off';
  serverAgentMouse?: boolean;
  serverAgentCopyPaste?: boolean;
  serverAgentFileTransfer?: boolean;

  // WebDAV Integration
  webdavServer?: string;
  webdavPort?: number;
  webdavUser?: string;
  webdavPassword?: string;

  // Multi-monitor Support
  monitors?: Array<{
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    primary?: boolean;
  }>;

  // Input Configuration
  keyboardLayout?: string;
  mouseMode?: 'client' | 'server';
  disableInputs?: boolean;

  // Graphics Configuration
  renderer?: 'cairo' | 'opengl';
  enableAcceleration?: boolean;

  // Migration Support
  migrationSupport?: boolean;
  migrationData?: string;

  // Custom Arguments
  customArgs?: string[];

  // Environment Variables
  environment?: Record<string, string>;
}

/**
 * SPICE Protocol Implementation
 *
 * Provides SPICE (Simple Protocol for Independent Computing Environments) remote computing access
 * Supports virtual desktop connection, audio, USB redirection, file transfer, and enterprise virtualization features
 */
export class SPICEProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'spice';
  public readonly capabilities: ProtocolCapabilities;

  private spiceProcesses = new Map<string, ChildProcess>();

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
    super('spice');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
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
      supportsPTY: false,
      maxConcurrentSessions: 10, // SPICE can handle multiple sessions
      defaultTimeout: 60000, // Remote desktop connections can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'ticket', 'certificate'],
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
      // Check if SPICE client is available
      await this.checkSpiceAvailability();
      this.isInitialized = true;
      this.logger.info('SPICE protocol initialized with production remote computing features');
    } catch (error: any) {
      this.logger.error('Failed to initialize SPICE protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `spice-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const spiceProcess = this.spiceProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!spiceProcess || !spiceProcess.stdin || !session) {
      throw new Error(`No active SPICE session: ${sessionId}`);
    }

    spiceProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to SPICE session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const spiceProcess = this.spiceProcesses.get(sessionId);
      if (spiceProcess) {
        // Try graceful shutdown first
        spiceProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (spiceProcess && !spiceProcess.killed) {
            spiceProcess.kill('SIGKILL');
          }
        }, 10000);

        this.spiceProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`SPICE session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing SPICE session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const spiceOptions = options as SPICEConnectionOptions;

    // Build SPICE command
    const spiceCommand = this.buildSpiceCommand(spiceOptions);

    // Spawn SPICE process
    const spiceProcess = spawn(spiceCommand[0], spiceCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(spiceOptions), ...options.env }
    });

    // Set up output handling
    spiceProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    spiceProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    spiceProcess.on('error', (error) => {
      this.logger.error(`SPICE process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    spiceProcess.on('close', (code) => {
      this.logger.info(`SPICE process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.spiceProcesses.set(sessionId, spiceProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: spiceCommand[0],
      args: spiceCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(spiceOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: spiceProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`SPICE session ${sessionId} created for host ${spiceOptions.host || 'localhost'}:${spiceOptions.port || 5900}`);
    this.emit('session-created', { sessionId, type: 'spice', session });

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
      isOneShot: false, // SPICE sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in SPICE session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const spiceProcess = this.spiceProcesses.get(sessionId);
    return spiceProcess && !spiceProcess.killed || false;
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
        connectionsActive: this.spiceProcesses.size
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
      await this.checkSpiceAvailability();
      return {
        ...baseStatus,
        dependencies: {
          spice: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `SPICE not available: ${error}`],
        dependencies: {
          spice: { available: false }
        }
      };
    }
  }

  private async checkSpiceAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try multiple common SPICE clients
      const clients = ['remote-viewer', 'spicy', 'virt-viewer'];
      let attempts = 0;

      const tryClient = (clientName: string) => {
        const testProcess = spawn(clientName, ['--version'], { stdio: 'pipe' });

        testProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            attempts++;
            if (attempts < clients.length) {
              tryClient(clients[attempts]);
            } else {
              reject(new Error('No SPICE client found. Please install virt-viewer, remote-viewer, or spicy.'));
            }
          }
        });

        testProcess.on('error', () => {
          attempts++;
          if (attempts < clients.length) {
            tryClient(clients[attempts]);
          } else {
            reject(new Error('No SPICE client found. Please install virt-viewer, remote-viewer, or spicy.'));
          }
        });
      };

      tryClient(clients[0]);
    });
  }

  private buildSpiceCommand(options: SPICEConnectionOptions): string[] {
    const command = [];

    // SPICE client binary
    if (options.spiceClient) {
      command.push(options.spiceClient);
    } else if (options.remoteViewerClient) {
      command.push(options.remoteViewerClient);
    } else if (options.spiceGtkClient) {
      command.push(options.spiceGtkClient);
    } else {
      // Default clients in order of preference
      command.push('remote-viewer');
    }

    // Connection string
    if (options.host && options.port) {
      const protocol = options.enableTLS ? 'spice' : 'spice';
      const port = options.enableTLS && options.tlsPort ? options.tlsPort : options.port;
      command.push(`${protocol}://${options.host}:${port}`);
    }

    // Authentication
    if (options.spicePassword) {
      command.push('--spice-password', options.spicePassword);
    }

    if (options.spiceTicket) {
      command.push('--spice-ticket', options.spiceTicket);
    }

    // TLS Configuration
    if (options.enableTLS) {
      command.push('--spice-secure-channels', 'all');
    }

    if (options.spiceCaCertFile) {
      command.push('--spice-ca-file', options.spiceCaCertFile);
    }

    if (options.spiceCertSubject) {
      command.push('--spice-cert-subject', options.spiceCertSubject);
    }

    if (options.spiceHostSubject) {
      command.push('--spice-host-subject', options.spiceHostSubject);
    }

    if (options.insecure) {
      command.push('--spice-disable-verify');
    }

    // Display Configuration
    if (options.fullscreen) {
      command.push('--full-screen');
    }

    if (options.monitor !== undefined) {
      command.push('--monitor', options.monitor.toString());
    }

    if (options.monitorMapping) {
      command.push('--monitor-mapping', options.monitorMapping);
    }

    // Audio Configuration
    if (options.disableAudio) {
      command.push('--spice-disable-audio');
    }

    if (options.audioBackend && options.audioBackend !== 'auto') {
      command.push('--spice-audio-backend', options.audioBackend);
    }

    // USB Redirection
    if (options.usbRedirection) {
      command.push('--spice-usb-auto-connect');
    }

    if (options.usbFilter) {
      command.push('--spice-usb-filter', options.usbFilter);
    }

    // Smartcard Support
    if (options.smartcardSupport) {
      command.push('--spice-smartcard');
    }

    if (options.smartcardDatabase) {
      command.push('--spice-smartcard-db', options.smartcardDatabase);
    }

    // Clipboard
    if (!options.enableClipboard) {
      command.push('--spice-disable-clipboard');
    }

    // File Transfer
    if (!options.enableFileTransfer) {
      command.push('--spice-disable-file-transfer');
    }

    if (options.sharedDir) {
      command.push('--spice-shared-dir', options.sharedDir);
    }

    // Performance Options
    if (options.colorDepth) {
      command.push('--spice-color-depth', options.colorDepth.toString());
    }

    if (options.imageCompressionType) {
      command.push('--spice-image-compression', options.imageCompressionType);
    }

    if (options.jpegWanCompressionType) {
      command.push('--spice-jpeg-wan-compression', options.jpegWanCompressionType);
    }

    if (options.zlibGlzWanCompressionType) {
      command.push('--spice-zlib-glz-wan-compression', options.zlibGlzWanCompressionType);
    }

    if (options.streamingVideoMode) {
      command.push('--spice-streaming-video', options.streamingVideoMode);
    }

    if (options.playbackCompressionMode) {
      command.push('--spice-playback-compression', options.playbackCompressionMode);
    }

    // Advanced Options
    if (options.spiceGtkGrabSequence) {
      command.push('--spice-gtk-grab-sequence', options.spiceGtkGrabSequence);
    }

    if (options.releaseKeysSequence) {
      command.push('--release-cursor', options.releaseKeysSequence);
    }

    if (options.resizeGuest) {
      command.push('--spice-resize-guest');
    }

    if (options.spiceDisableEffects) {
      options.spiceDisableEffects.forEach(effect => {
        command.push('--spice-disable-effects', effect);
      });
    }

    // Debugging
    if (options.debugLevel) {
      command.push('--debug-level', options.debugLevel);
    }

    if (options.enableLogging && options.logFile) {
      command.push('--log-file', options.logFile);
    }

    // Network Configuration
    if (options.proxyHost && options.proxyPort) {
      let proxyUrl = `${options.proxyHost}:${options.proxyPort}`;
      if (options.proxyUser && options.proxyPassword) {
        proxyUrl = `${options.proxyUser}:${options.proxyPassword}@${proxyUrl}`;
      }
      command.push('--spice-proxy', proxyUrl);
    }

    // Connection Management
    if (options.connectionTimeout) {
      command.push('--spice-connection-timeout', options.connectionTimeout.toString());
    }

    // Multi-monitor Configuration
    if (options.monitors) {
      options.monitors.forEach((monitor, index) => {
        command.push('--spice-monitor-config', `${monitor.id}:${monitor.x}:${monitor.y}:${monitor.width}:${monitor.height}`);
      });
    }

    // Input Configuration
    if (options.keyboardLayout) {
      command.push('--spice-keyboard-layout', options.keyboardLayout);
    }

    if (options.disableInputs) {
      command.push('--spice-disable-inputs');
    }

    // Graphics Configuration
    if (options.renderer) {
      command.push('--spice-renderer', options.renderer);
    }

    if (options.enableAcceleration) {
      command.push('--spice-gl');
    }

    // Custom arguments
    if (options.customArgs) {
      command.push(...options.customArgs);
    }

    return command;
  }

  private buildEnvironment(options: SPICEConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // SPICE environment variables
    if (options.debugLevel) {
      env.SPICE_DEBUG = options.debugLevel;
    }

    if (options.enableLogging) {
      env.SPICE_DEBUG_LEVEL = options.debugLevel || 'info';
    }

    // Graphics environment
    if (options.renderer) {
      env.SPICE_RENDERER = options.renderer;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up SPICE protocol');

    // Close all SPICE processes
    for (const [sessionId, process] of Array.from(this.spiceProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing SPICE process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.spiceProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default SPICEProtocol;