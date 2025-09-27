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

// Guacamole Protocol connection options
interface GuacamoleConnectionOptions extends SessionOptions {
  guacamoleHost?: string;
  guacamolePort?: number;
  protocol?: 'vnc' | 'rdp' | 'ssh' | 'telnet';
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  security?: 'rdp' | 'tls' | 'nla' | 'any';
  ignoreCert?: boolean;
  enableDrive?: boolean;
  drivePath?: string;
  createDrivePath?: boolean;
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
  enableDesktopComposition?: boolean;
  enableMenuAnimations?: boolean;
  disableBitmapCaching?: boolean;
  disableOffscreenCaching?: boolean;
  disableGlyphCaching?: boolean;
  colorDepth?: 8 | 16 | 24 | 32;
  width?: number;
  height?: number;
  dpi?: number;
  resizeMethod?: 'display-update' | 'reconnect';
  enableAudio?: boolean;
  audioServername?: string;
  enablePrinting?: boolean;
  printDriverName?: string;
  enableClipboard?: boolean;
  sshHostKey?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  enableSftp?: boolean;
  sftpHostname?: string;
  sftpPort?: number;
  sftpUsername?: string;
  sftpPassword?: string;
  sftpPrivateKey?: string;
  sftpPassphrase?: string;
  sftpDirectory?: string;
  enableRecording?: boolean;
  recordingPath?: string;
  recordingName?: string;
  recordingExcludeOutput?: boolean;
  recordingExcludeMouse?: boolean;
  recordingIncludeKeys?: boolean;
  enableWol?: boolean;
  wolMacAddr?: string;
  wolBroadcastAddr?: string;
  wolUdpPort?: number;
  wolWaitTime?: number;
  loadBalanceInfo?: string;
  environment?: Record<string, string>;
}

/**
 * Guacamole Protocol Implementation
 *
 * Provides Apache Guacamole clientless remote desktop gateway access
 * Supports VNC, RDP, SSH, and Telnet protocols through web browser interface
 */
export class GuacamoleProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'guacamole';
  public readonly capabilities: ProtocolCapabilities;

  private guacamoleProcesses = new Map<string, ChildProcess>();

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
    super('guacamole');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: true,
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
      supportsPTY: true,
      maxConcurrentSessions: 50, // Guacamole can handle many concurrent sessions
      defaultTimeout: 300000, // Remote desktop sessions can be long
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'key', 'domain'],
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
      // Check if Guacamole tools are available
      await this.checkGuacamoleAvailability();
      this.isInitialized = true;
      this.logger.info('Guacamole protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Guacamole protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `guacamole-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const guacamoleProcess = this.guacamoleProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!guacamoleProcess || !guacamoleProcess.stdin || !session) {
      throw new Error(`No active Guacamole session: ${sessionId}`);
    }

    guacamoleProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Guacamole session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const guacamoleProcess = this.guacamoleProcesses.get(sessionId);
      if (guacamoleProcess) {
        // Try graceful shutdown first
        guacamoleProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (guacamoleProcess && !guacamoleProcess.killed) {
            guacamoleProcess.kill('SIGKILL');
          }
        }, 15000);

        this.guacamoleProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Guacamole session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Guacamole session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const guacamoleOptions = options as GuacamoleConnectionOptions;

    // Validate required connection parameters
    if (!guacamoleOptions.hostname) {
      throw new Error('Target hostname is required for Guacamole protocol');
    }

    // Build Guacamole command
    const guacamoleCommand = this.buildGuacamoleCommand(guacamoleOptions);

    // Spawn Guacamole process
    const guacamoleProcess = spawn(guacamoleCommand[0], guacamoleCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(guacamoleOptions), ...options.env }
    });

    // Set up output handling
    guacamoleProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    guacamoleProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    guacamoleProcess.on('error', (error) => {
      this.logger.error(`Guacamole process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    guacamoleProcess.on('close', (code) => {
      this.logger.info(`Guacamole process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.guacamoleProcesses.set(sessionId, guacamoleProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: guacamoleCommand[0],
      args: guacamoleCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(guacamoleOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: guacamoleProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Guacamole session ${sessionId} created for ${guacamoleOptions.protocol}://${guacamoleOptions.hostname}:${guacamoleOptions.port || 'default'}`);
    this.emit('session-created', { sessionId, type: 'guacamole', session });

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
      isOneShot: false, // Guacamole sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Guacamole session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const guacamoleProcess = this.guacamoleProcesses.get(sessionId);
    return guacamoleProcess && !guacamoleProcess.killed || false;
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
        connectionsActive: this.guacamoleProcesses.size
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
      await this.checkGuacamoleAvailability();
      return {
        ...baseStatus,
        dependencies: {
          guacamole: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Guacamole not available: ${error}`],
        dependencies: {
          guacamole: { available: false }
        }
      };
    }
  }

  private async checkGuacamoleAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('guacd', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Guacamole daemon not found. Please install guacamole-server.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Guacamole daemon not found. Please install guacamole-server.'));
      });
    });
  }

  private buildGuacamoleCommand(options: GuacamoleConnectionOptions): string[] {
    const command = [];

    // Guacamole client executable
    if (options.guacamoleHost) {
      // Use guacenc for recording or direct client connection
      command.push('guacenc');
    } else {
      // Use guacd daemon
      command.push('guacd');
    }

    // Connection parameters
    if (options.guacamoleHost) {
      command.push('-h', options.guacamoleHost);
    }

    if (options.guacamolePort) {
      command.push('-p', options.guacamolePort.toString());
    }

    // Protocol-specific configurations
    if (options.protocol) {
      command.push('-P', options.protocol);
    }

    if (options.hostname) {
      command.push('-H', options.hostname);
    }

    if (options.port) {
      command.push('-p', options.port.toString());
    }

    // Authentication
    if (options.username) {
      command.push('-u', options.username);
    }

    if (options.password) {
      command.push('-w', options.password);
    }

    if (options.domain) {
      command.push('-d', options.domain);
    }

    // RDP-specific options
    if (options.protocol === 'rdp') {
      if (options.security) {
        command.push('-s', options.security);
      }

      if (options.ignoreCert) {
        command.push('-i');
      }

      if (options.enableDrive) {
        command.push('-D');
        if (options.drivePath) {
          command.push('-F', options.drivePath);
        }
      }

      if (options.colorDepth) {
        command.push('-c', options.colorDepth.toString());
      }

      if (options.width && options.height) {
        command.push('-g', `${options.width}x${options.height}`);
      }

      if (options.dpi) {
        command.push('-r', options.dpi.toString());
      }

      if (options.enableAudio) {
        command.push('-a');
      }

      if (options.enablePrinting) {
        command.push('-P');
      }

      if (options.enableClipboard) {
        command.push('-C');
      }
    }

    // VNC-specific options
    if (options.protocol === 'vnc') {
      if (options.colorDepth) {
        command.push('-c', options.colorDepth.toString());
      }

      if (options.enableClipboard) {
        command.push('-C');
      }
    }

    // SSH-specific options
    if (options.protocol === 'ssh') {
      if (options.sshPrivateKey) {
        command.push('-k', options.sshPrivateKey);
      }

      if (options.sshPassphrase) {
        command.push('-K', options.sshPassphrase);
      }

      if (options.enableSftp) {
        command.push('-S');
        if (options.sftpDirectory) {
          command.push('-D', options.sftpDirectory);
        }
      }
    }

    // Recording options
    if (options.enableRecording) {
      command.push('-R');
      if (options.recordingPath) {
        command.push('-P', options.recordingPath);
      }
      if (options.recordingName) {
        command.push('-N', options.recordingName);
      }
    }

    // Wake-on-LAN options
    if (options.enableWol) {
      command.push('-W');
      if (options.wolMacAddr) {
        command.push('-M', options.wolMacAddr);
      }
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: GuacamoleConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Guacamole environment variables
    if (options.guacamoleHost) {
      env.GUACD_HOSTNAME = options.guacamoleHost;
    }

    if (options.guacamolePort) {
      env.GUACD_PORT = options.guacamolePort.toString();
    }

    // Connection parameters
    if (options.protocol) {
      env.GUAC_PROTOCOL = options.protocol;
    }

    if (options.hostname) {
      env.GUAC_HOSTNAME = options.hostname;
    }

    if (options.username) {
      env.GUAC_USERNAME = options.username;
    }

    if (options.password) {
      env.GUAC_PASSWORD = options.password;
    }

    // Display settings
    if (options.width && options.height) {
      env.GUAC_WIDTH = options.width.toString();
      env.GUAC_HEIGHT = options.height.toString();
    }

    if (options.dpi) {
      env.GUAC_DPI = options.dpi.toString();
    }

    // Recording settings
    if (options.enableRecording && options.recordingPath) {
      env.GUAC_RECORDING_PATH = options.recordingPath;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Guacamole protocol');

    // Close all Guacamole processes
    for (const [sessionId, process] of Array.from(this.guacamoleProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Guacamole process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.guacamoleProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}
