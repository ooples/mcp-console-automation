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

// BMC Protocol connection options
interface BMCConnectionOptions extends SessionOptions {
  bmcHost: string;
  bmcPort?: number;
  username?: string;
  password?: string;
  ipmiPath?: string;
  ipmiVersion?: '1.5' | '2.0';
  interface?: 'lan' | 'lanplus' | 'open' | 'imb' | 'smic' | 'ssif';
  privilege?: 'CALLBACK' | 'USER' | 'OPERATOR' | 'ADMINISTRATOR';
  authType?: 'NONE' | 'STRAIGHT_PASSWORD_KEY' | 'MD2' | 'MD5' | 'OEM';
  cipherSuite?: number;
  sessionTimeout?: number;
  retries?: number;
  enableSol?: boolean; // Serial Over LAN
  solBaudRate?: 9600 | 19200 | 38400 | 57600 | 115200;
  solEscapeChar?: string;
  enableKvm?: boolean; // Keyboard Video Mouse redirection
  enableFru?: boolean; // Field Replaceable Unit
  enableSdr?: boolean; // Sensor Data Records
  enableSel?: boolean; // System Event Log
  enablePef?: boolean; // Platform Event Filtering
  powerControl?: 'on' | 'off' | 'cycle' | 'reset' | 'diag' | 'soft';
  bootDevice?: 'pxe' | 'disk' | 'safe' | 'diag' | 'cdrom' | 'floppy';
  enableWatchdog?: boolean;
  watchdogTimeout?: number;
  fanControl?: boolean;
  thermalManagement?: boolean;
  environment?: Record<string, string>;
}

/**
 * BMC Protocol Implementation
 *
 * Provides Baseboard Management Controller console access through IPMI command
 * Supports server hardware management, SOL, power control, sensor monitoring, and system administration
 */
export class BMCProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'bmc';
  public readonly capabilities: ProtocolCapabilities;

  private bmcProcesses = new Map<string, ChildProcess>();

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
    super('bmc');

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
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: true,
      maxConcurrentSessions: 5,
      defaultTimeout: 30000, // BMC operations can be slow
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'certificate'],
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
      // Check if IPMI tool is available
      await this.checkIpmiAvailability();
      this.isInitialized = true;
      this.logger.info('BMC protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize BMC protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `bmc-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const bmcProcess = this.bmcProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!bmcProcess || !bmcProcess.stdin || !session) {
      throw new Error(`No active BMC session: ${sessionId}`);
    }

    bmcProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to BMC session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const bmcProcess = this.bmcProcesses.get(sessionId);
      if (bmcProcess) {
        // Try graceful shutdown first
        bmcProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (bmcProcess && !bmcProcess.killed) {
            bmcProcess.kill('SIGKILL');
          }
        }, 5000);

        this.bmcProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`BMC session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing BMC session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const bmcOptions = options as BMCConnectionOptions;

    // Validate required BMC connection parameters
    if (!bmcOptions.bmcHost) {
      throw new Error('BMC host is required for BMC protocol');
    }

    // Build IPMI command
    const ipmiCommand = this.buildIpmiCommand(bmcOptions);

    // Spawn IPMI process
    const bmcProcess = spawn(ipmiCommand[0], ipmiCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(bmcOptions), ...options.env }
    });

    // Set up output handling
    bmcProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    bmcProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    bmcProcess.on('error', (error) => {
      this.logger.error(`BMC process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    bmcProcess.on('close', (code) => {
      this.logger.info(`BMC process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.bmcProcesses.set(sessionId, bmcProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: ipmiCommand[0],
      args: ipmiCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(bmcOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: bmcProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`BMC session ${sessionId} created for ${bmcOptions.bmcHost}`);
    this.emit('session-created', { sessionId, type: 'bmc', session });

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
      isOneShot: true, // BMC commands are typically one-shot
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in BMC session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const bmcProcess = this.bmcProcesses.get(sessionId);
    return bmcProcess && !bmcProcess.killed || false;
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
        connectionsActive: this.bmcProcesses.size
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
      await this.checkIpmiAvailability();
      return {
        ...baseStatus,
        dependencies: {
          ipmi: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `IPMI not available: ${error}`],
        dependencies: {
          ipmi: { available: false }
        }
      };
    }
  }

  private async checkIpmiAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ipmitool', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('IPMI tool not found. Please install ipmitool.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('IPMI tool not found. Please install ipmitool.'));
      });
    });
  }

  private buildIpmiCommand(options: BMCConnectionOptions): string[] {
    const command = [];

    // IPMI executable
    if (options.ipmiPath) {
      command.push(options.ipmiPath);
    } else {
      command.push('ipmitool');
    }

    // Interface type
    if (options.interface) {
      command.push('-I', options.interface);
    } else {
      command.push('-I', 'lanplus'); // Default to lanplus for better security
    }

    // BMC host and port
    command.push('-H', options.bmcHost);
    if (options.bmcPort) {
      command.push('-p', options.bmcPort.toString());
    }

    // Authentication
    if (options.username) {
      command.push('-U', options.username);
    }

    if (options.password) {
      command.push('-P', options.password);
    }

    // Privilege level
    if (options.privilege) {
      command.push('-L', options.privilege);
    }

    // Authentication type
    if (options.authType) {
      command.push('-A', options.authType);
    }

    // IPMI version
    if (options.ipmiVersion === '1.5') {
      command.push('-v');
    }

    // Cipher suite for encryption
    if (options.cipherSuite !== undefined) {
      command.push('-C', options.cipherSuite.toString());
    }

    // Session timeout
    if (options.sessionTimeout) {
      command.push('-N', options.sessionTimeout.toString());
    }

    // Retries
    if (options.retries) {
      command.push('-R', options.retries.toString());
    }

    // Command based on options
    if (options.enableSol) {
      // Serial Over LAN
      command.push('sol', 'activate');
      if (options.solBaudRate) {
        command.push('baud', options.solBaudRate.toString());
      }
      if (options.solEscapeChar) {
        command.push('escape-char', options.solEscapeChar);
      }
    } else if (options.powerControl) {
      // Power control
      command.push('power', options.powerControl);
    } else if (options.bootDevice) {
      // Boot device selection
      command.push('chassis', 'bootdev', options.bootDevice);
    } else if (options.enableSdr) {
      // Sensor Data Records
      command.push('sdr', 'list');
    } else if (options.enableSel) {
      // System Event Log
      command.push('sel', 'list');
    } else if (options.enableFru) {
      // Field Replaceable Unit
      command.push('fru', 'list');
    } else if (options.enableWatchdog) {
      // Watchdog timer
      command.push('mc', 'watchdog', 'get');
      if (options.watchdogTimeout) {
        command.push('timeout', options.watchdogTimeout.toString());
      }
    } else if (options.fanControl) {
      // Fan control
      command.push('sensor', 'list', 'Fan');
    } else if (options.thermalManagement) {
      // Thermal management
      command.push('sensor', 'list', 'Temperature');
    } else {
      // Default to chassis status
      command.push('chassis', 'status');
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: BMCConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // IPMI environment variables
    if (options.bmcHost) {
      env.IPMI_BMC_HOST = options.bmcHost;
    }

    if (options.username) {
      env.IPMI_USERNAME = options.username;
    }

    if (options.password) {
      env.IPMI_PASSWORD = options.password;
    }

    // Interface settings
    if (options.interface) {
      env.IPMI_INTERFACE = options.interface;
    }

    // Privilege level
    if (options.privilege) {
      env.IPMI_PRIVILEGE_LEVEL = options.privilege;
    }

    // Timeout settings
    if (options.sessionTimeout) {
      env.IPMI_SESSION_TIMEOUT = options.sessionTimeout.toString();
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up BMC protocol');

    // Close all BMC processes
    for (const [sessionId, process] of Array.from(this.bmcProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing BMC process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.bmcProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default BMCProtocol;