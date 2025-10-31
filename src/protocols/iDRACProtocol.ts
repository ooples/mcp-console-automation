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
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage,
} from '../core/IProtocol.js';

// iDRAC Protocol connection options
interface iDRACConnectionOptions {
  idracHost: string;
  idracPort?: number;
  username?: string;
  password?: string;
  sshKey?: string;
  args?: string[];
  sshPassphrase?: string;
  operation?:
    | 'console'
    | 'power'
    | 'lifecycle'
    | 'diagnostics'
    | 'racadm'
    | 'webui';
  powerAction?:
    | 'on'
    | 'off'
    | 'reset'
    | 'cycle'
    | 'graceful-shutdown'
    | 'force-off';
  consoleType?: 'sol' | 'ssh' | 'telnet' | 'web';
  enableSOL?: boolean;
  solPort?: number;
  enableVirtualMedia?: boolean;
  virtualMediaType?: 'floppy' | 'cd' | 'usb';
  virtualMediaImage?: string;
  enableVirtualConsole?: boolean;
  racadmCommand?: string;
  racadmSubCommand?: string;
  firmwareUpdate?: boolean;
  firmwareFile?: string;
  biosSettings?: Record<string, string>;
  enableSNMP?: boolean;
  snmpCommunity?: string;
  enableWS?: boolean;
  wsPort?: number;
  enableTLS?: boolean;
  tlsVersion?: '1.2' | '1.3';
  certificatePath?: string;
  privateKeyPath?: string;
  timeout?: number;
  retries?: number;
  enableLogs?: boolean;
  logLevel?:
    | 'emergency'
    | 'alert'
    | 'critical'
    | 'error'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug';
  eventFilters?: string[];
  enableFAN?: boolean;
  enableThermal?: boolean;
  enableRAID?: boolean;
  enableNIC?: boolean;
  enablePSU?: boolean;
  enableCPU?: boolean;
  enableMemory?: boolean;
  enablePCI?: boolean;
  environment?: Record<string, string>;
}

/**
 * iDRAC Protocol Implementation
 *
 * Provides Dell iDRAC (integrated Dell Remote Access Controller) console access
 * Supports server management, SOL, power control, diagnostics, RACADM commands, and enterprise server administration
 */
export class iDRACProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'idrac';
  public readonly capabilities: ProtocolCapabilities;

  private idracProcesses = new Map<string, ChildProcess>();

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
        uptime: 0,
      },
      dependencies: {},
    };
  }

  constructor() {
    super('idrac');

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
      maxConcurrentSessions: 5, // iDRAC typically supports limited concurrent sessions
      defaultTimeout: 120000, // Server operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'key', 'external'],
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
      // Check if iDRAC tools are available
      await this.checkiDRACAvailability();
      this.isInitialized = true;
      this.logger.info('iDRAC protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize iDRAC protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `idrac-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const idracProcess = this.idracProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!idracProcess || !idracProcess.stdin || !session) {
      throw new Error(`No active iDRAC session: ${sessionId}`);
    }

    idracProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to iDRAC session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const idracProcess = this.idracProcesses.get(sessionId);
      if (idracProcess) {
        // Try graceful shutdown first
        idracProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (idracProcess && !idracProcess.killed) {
            idracProcess.kill('SIGKILL');
          }
        }, 10000);

        this.idracProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`iDRAC session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing iDRAC session ${sessionId}:`, error);
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

    const idracOptions =
      (options as any).idracOptions || ({} as iDRACConnectionOptions);

    // Validate required iDRAC parameters
    if (!idracOptions.idracHost) {
      throw new Error('iDRAC host is required for iDRAC protocol');
    }

    // Build iDRAC command
    const idracCommand = this.buildIDRACCommand(idracOptions);

    // Spawn iDRAC process
    const idracProcess = spawn(idracCommand[0], idracCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(idracOptions),
        ...options.env,
      },
    });

    // Set up output handling
    idracProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    idracProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    idracProcess.on('error', (error) => {
      this.logger.error(`iDRAC process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    idracProcess.on('close', (code) => {
      this.logger.info(
        `iDRAC process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.idracProcesses.set(sessionId, idracProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: idracCommand[0],
      args: idracCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(idracOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: idracProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `iDRAC session ${sessionId} created for host ${idracOptions.idracHost} operation ${idracOptions.operation || 'console'}`
    );
    this.emit('session-created', { sessionId, type: 'idrac', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map((output) => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.status === 'running'
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
      isOneShot: false, // iDRAC sessions can be persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {},
    };
  }

  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorRecoveryResult> {
    this.logger.error(
      `Error in iDRAC session ${context.sessionId}: ${error.message}`
    );

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message,
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const idracProcess = this.idracProcesses.get(sessionId);
    return (idracProcess && !idracProcess.killed) || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal,
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0],
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.idracProcesses.size,
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0,
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size,
      },
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkiDRACAvailability();
      return {
        ...baseStatus,
        dependencies: {
          idrac: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `iDRAC tools not available: ${error}`],
        dependencies: {
          idrac: { available: false },
        },
      };
    }
  }

  private async checkiDRACAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ssh', ['-V'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              'SSH client not found. Please install openssh-client package.'
            )
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error(
            'SSH client not found. Please install openssh-client package.'
          )
        );
      });
    });
  }

  private buildIDRACCommand(options: iDRACConnectionOptions): string[] {
    const command = [];

    // Determine operation type and build appropriate command
    switch (options.operation) {
      case 'console':
        // iDRAC Serial over LAN (SOL) console access
        if (options.consoleType === 'sol') {
          command.push('racadm');
          command.push('-r', options.idracHost);
          if (options.idracPort) {
            command.push('-p', options.idracPort.toString());
          }
          if (options.username) {
            command.push('-u', options.username);
          }
          if (options.password) {
            command.push('-p', options.password);
          }
          command.push('console', 'com2');
        } else {
          // SSH to iDRAC
          command.push('ssh');
          if (options.idracPort) {
            command.push('-p', options.idracPort.toString());
          }
          if (options.sshKey) {
            command.push('-i', options.sshKey);
          }
          if (options.enableTLS) {
            command.push('-o', 'StrictHostKeyChecking=yes');
          } else {
            command.push('-o', 'StrictHostKeyChecking=no');
          }
          command.push(`${options.username || 'root'}@${options.idracHost}`);
        }
        break;

      case 'power':
        // Power management operations
        command.push('racadm');
        command.push('-r', options.idracHost);
        if (options.idracPort) {
          command.push('-p', options.idracPort.toString());
        }
        if (options.username) {
          command.push('-u', options.username);
        }
        if (options.password) {
          command.push('-p', options.password);
        }

        switch (options.powerAction) {
          case 'on':
            command.push('serveraction', 'powerup');
            break;
          case 'off':
            command.push('serveraction', 'powerdown');
            break;
          case 'reset':
            command.push('serveraction', 'hardreset');
            break;
          case 'cycle':
            command.push('serveraction', 'powercycle');
            break;
          case 'graceful-shutdown':
            command.push('serveraction', 'graceshutdown');
            break;
          case 'force-off':
            command.push('serveraction', 'forceoff');
            break;
        }
        break;

      case 'lifecycle':
        // Lifecycle controller operations
        command.push('racadm');
        command.push('-r', options.idracHost);
        if (options.idracPort) {
          command.push('-p', options.idracPort.toString());
        }
        if (options.username) {
          command.push('-u', options.username);
        }
        if (options.password) {
          command.push('-p', options.password);
        }
        command.push('lclog');
        break;

      case 'diagnostics':
        // System diagnostics
        command.push('racadm');
        command.push('-r', options.idracHost);
        if (options.idracPort) {
          command.push('-p', options.idracPort.toString());
        }
        if (options.username) {
          command.push('-u', options.username);
        }
        if (options.password) {
          command.push('-p', options.password);
        }
        command.push('getraclog');
        break;

      case 'racadm':
        // Custom RACADM command
        command.push('racadm');
        command.push('-r', options.idracHost);
        if (options.idracPort) {
          command.push('-p', options.idracPort.toString());
        }
        if (options.username) {
          command.push('-u', options.username);
        }
        if (options.password) {
          command.push('-p', options.password);
        }
        if (options.racadmCommand) {
          command.push(options.racadmCommand);
          if (options.racadmSubCommand) {
            command.push(options.racadmSubCommand);
          }
        }
        break;

      case 'webui':
        // Launch web browser to iDRAC web interface
        const port = options.wsPort || (options.enableTLS ? 443 : 80);
        const protocol = options.enableTLS ? 'https' : 'http';
        const url = `${protocol}://${options.idracHost}:${port}`;

        if (process.platform === 'win32') {
          command.push('start', url);
        } else if (process.platform === 'darwin') {
          command.push('open', url);
        } else {
          command.push('xdg-open', url);
        }
        break;

      default:
        // Default to console access
        command.push('ssh');
        if (options.idracPort) {
          command.push('-p', options.idracPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(`${options.username || 'root'}@${options.idracHost}`);
        break;
    }

    // Add additional arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: iDRACConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // iDRAC environment variables
    if (options.idracHost) {
      env.IDRAC_HOST = options.idracHost;
    }

    if (options.idracPort) {
      env.IDRAC_PORT = options.idracPort.toString();
    }

    if (options.username) {
      env.IDRAC_USERNAME = options.username;
    }

    // SSH settings
    if (options.sshKey) {
      env.SSH_KEY_PATH = options.sshKey;
    }

    if (options.sshPassphrase) {
      env.SSH_PASSPHRASE = options.sshPassphrase;
    }

    // SOL settings
    if (options.enableSOL) {
      env.IDRAC_SOL_ENABLED = 'true';
      if (options.solPort) {
        env.IDRAC_SOL_PORT = options.solPort.toString();
      }
    }

    // Virtual media settings
    if (options.enableVirtualMedia) {
      env.IDRAC_VIRTUAL_MEDIA_ENABLED = 'true';
      if (options.virtualMediaType) {
        env.IDRAC_VIRTUAL_MEDIA_TYPE = options.virtualMediaType;
      }
      if (options.virtualMediaImage) {
        env.IDRAC_VIRTUAL_MEDIA_IMAGE = options.virtualMediaImage;
      }
    }

    // TLS settings
    if (options.enableTLS) {
      env.IDRAC_TLS_ENABLED = 'true';
      if (options.tlsVersion) {
        env.IDRAC_TLS_VERSION = options.tlsVersion;
      }
      if (options.certificatePath) {
        env.IDRAC_CERT_PATH = options.certificatePath;
      }
      if (options.privateKeyPath) {
        env.IDRAC_KEY_PATH = options.privateKeyPath;
      }
    }

    // SNMP settings
    if (options.enableSNMP) {
      env.IDRAC_SNMP_ENABLED = 'true';
      if (options.snmpCommunity) {
        env.IDRAC_SNMP_COMMUNITY = options.snmpCommunity;
      }
    }

    // Logging settings
    if (options.enableLogs) {
      env.IDRAC_LOGGING_ENABLED = 'true';
      if (options.logLevel) {
        env.IDRAC_LOG_LEVEL = options.logLevel;
      }
    }

    // Hardware monitoring settings
    if (options.enableFAN) {
      env.IDRAC_FAN_MONITORING = 'true';
    }
    if (options.enableThermal) {
      env.IDRAC_THERMAL_MONITORING = 'true';
    }
    if (options.enableRAID) {
      env.IDRAC_RAID_MONITORING = 'true';
    }
    if (options.enableNIC) {
      env.IDRAC_NIC_MONITORING = 'true';
    }
    if (options.enablePSU) {
      env.IDRAC_PSU_MONITORING = 'true';
    }
    if (options.enableCPU) {
      env.IDRAC_CPU_MONITORING = 'true';
    }
    if (options.enableMemory) {
      env.IDRAC_MEMORY_MONITORING = 'true';
    }
    if (options.enablePCI) {
      env.IDRAC_PCI_MONITORING = 'true';
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up iDRAC protocol');

    // Close all iDRAC processes
    for (const [sessionId, process] of Array.from(this.idracProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing iDRAC process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.idracProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default iDRACProtocol;
