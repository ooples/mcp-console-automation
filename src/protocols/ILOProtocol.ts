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

// ILO Protocol connection options
interface ILOConnectionOptions {
  iloHost: string;
  iloPort?: number;
  username?: string;
  password?: string;
  sshKey?: string;
  args?: string[];
  sshPassphrase?: string;
  operation?:
    | 'console'
    | 'power'
    | 'virtual-media'
    | 'health'
    | 'firmware'
    | 'storage'
    | 'network'
    | 'webui';
  powerAction?:
    | 'on'
    | 'off'
    | 'reset'
    | 'cold-boot'
    | 'warm-boot'
    | 'nmi'
    | 'power-cycle';
  consoleType?: 'ilo' | 'ssh' | 'telnet' | 'web';
  enableVSP?: boolean; // Virtual Serial Port
  vspPort?: number;
  enableVirtualMedia?: boolean;
  virtualMediaType?: 'floppy' | 'cd' | 'usb';
  virtualMediaImage?: string;
  enableWebConsole?: boolean;
  healthCommand?: string;
  firmwareFile?: string;
  biosSettings?: Record<string, string>;
  enableSNMP?: boolean;
  snmpVersion?: '1' | '2c' | '3';
  snmpCommunity?: string;
  enableHTTPS?: boolean;
  httpsPort?: number;
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
  enableSmartArray?: boolean;
  enableOneView?: boolean;
  oneViewSettings?: Record<string, string>;
  environment?: Record<string, string>;
}

/**
 * ILO Protocol Implementation
 *
 * Provides HP ILO (Integrated Lights-Out) console access for HP/HPE servers
 * Supports remote management, VSP, power control, virtual media, health monitoring, and enterprise server administration
 */
export class ILOProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'ilo';
  public readonly capabilities: ProtocolCapabilities;

  private iloProcesses = new Map<string, ChildProcess>();

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
    super('ilo');

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
      maxConcurrentSessions: 5, // ILO typically supports limited concurrent sessions
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
      // Check if ILO tools are available
      await this.checkILOAvailability();
      this.isInitialized = true;
      this.logger.info('ILO protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize ILO protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `ilo-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const iloProcess = this.iloProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!iloProcess || !iloProcess.stdin || !session) {
      throw new Error(`No active ILO session: ${sessionId}`);
    }

    iloProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to ILO session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const iloProcess = this.iloProcesses.get(sessionId);
      if (iloProcess) {
        // Try graceful shutdown first
        iloProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (iloProcess && !iloProcess.killed) {
            iloProcess.kill('SIGKILL');
          }
        }, 10000);

        this.iloProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`ILO session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing ILO session ${sessionId}:`, error);
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

    const iloOptions =
      (options as any).iloOptions || ({} as ILOConnectionOptions);

    // Validate required ILO parameters
    if (!iloOptions.iloHost) {
      throw new Error('ILO host is required for ILO protocol');
    }

    // Build ILO command
    const iloCommand = this.buildILOCommand(iloOptions);

    // Spawn ILO process
    const iloProcess = spawn(iloCommand[0], iloCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(iloOptions),
        ...options.env,
      },
    });

    // Set up output handling
    iloProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    iloProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    iloProcess.on('error', (error) => {
      this.logger.error(`ILO process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    iloProcess.on('close', (code) => {
      this.logger.info(
        `ILO process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.iloProcesses.set(sessionId, iloProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: iloCommand[0],
      args: iloCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(iloOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: iloProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `ILO session ${sessionId} created for host ${iloOptions.iloHost} operation ${iloOptions.operation || 'console'}`
    );
    this.emit('session-created', { sessionId, type: 'ilo', session });

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
      isOneShot: false, // ILO sessions can be persistent
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
      `Error in ILO session ${context.sessionId}: ${error.message}`
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
    const iloProcess = this.iloProcesses.get(sessionId);
    return (iloProcess && !iloProcess.killed) || false;
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
        connectionsActive: this.iloProcesses.size,
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
      await this.checkILOAvailability();
      return {
        ...baseStatus,
        dependencies: {
          ilo: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `ILO tools not available: ${error}`],
        dependencies: {
          ilo: { available: false },
        },
      };
    }
  }

  private async checkILOAvailability(): Promise<void> {
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

  private buildILOCommand(options: ILOConnectionOptions): string[] {
    const command = [];

    // Determine operation type and build appropriate command
    switch (options.operation) {
      case 'console':
        // ILO Virtual Serial Port (VSP) console access
        if (options.consoleType === 'ilo' && options.enableVSP) {
          command.push('ssh');
          if (options.iloPort) {
            command.push('-p', options.iloPort.toString());
          }
          if (options.sshKey) {
            command.push('-i', options.sshKey);
          }
          command.push('-o', 'StrictHostKeyChecking=no');
          command.push(
            `${options.username || 'Administrator'}@${options.iloHost}`
          );
          command.push('vsp');
        } else {
          // SSH to ILO
          command.push('ssh');
          if (options.iloPort) {
            command.push('-p', options.iloPort.toString());
          }
          if (options.sshKey) {
            command.push('-i', options.sshKey);
          }
          if (options.enableHTTPS) {
            command.push('-o', 'StrictHostKeyChecking=yes');
          } else {
            command.push('-o', 'StrictHostKeyChecking=no');
          }
          command.push(
            `${options.username || 'Administrator'}@${options.iloHost}`
          );
        }
        break;

      case 'power':
        // Power management operations using SSH
        command.push('ssh');
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );

        switch (options.powerAction) {
          case 'on':
            command.push('power', 'on');
            break;
          case 'off':
            command.push('power', 'off');
            break;
          case 'reset':
            command.push('power', 'reset');
            break;
          case 'cold-boot':
            command.push('power', 'cold-boot');
            break;
          case 'warm-boot':
            command.push('power', 'warm-boot');
            break;
          case 'nmi':
            command.push('power', 'nmi');
            break;
          case 'power-cycle':
            command.push('power', 'cycle');
            break;
        }
        break;

      case 'virtual-media':
        // Virtual media operations
        command.push('ssh');
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );

        if (options.virtualMediaImage) {
          command.push('vm', 'cdrom', 'insert', options.virtualMediaImage);
        } else {
          command.push('vm', 'status');
        }
        break;

      case 'health':
        // System health monitoring
        command.push('ssh');
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );

        if (options.healthCommand) {
          command.push(options.healthCommand);
        } else {
          command.push('show', 'server', 'status');
        }
        break;

      case 'firmware':
        // Firmware operations
        command.push('ssh');
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );

        if (options.firmwareFile) {
          command.push('update', 'firmware', options.firmwareFile);
        } else {
          command.push('show', 'firmware');
        }
        break;

      case 'storage':
        // Storage management
        command.push('ssh');
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );
        command.push('show', 'storage');
        break;

      case 'network':
        // Network configuration
        command.push('ssh');
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );
        command.push('show', 'network');
        break;

      case 'webui':
        // Launch web browser to ILO web interface
        const port = options.httpsPort || (options.enableHTTPS ? 443 : 80);
        const protocol = options.enableHTTPS ? 'https' : 'http';
        const url = `${protocol}://${options.iloHost}:${port}`;

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
        if (options.iloPort) {
          command.push('-p', options.iloPort.toString());
        }
        if (options.sshKey) {
          command.push('-i', options.sshKey);
        }
        command.push('-o', 'StrictHostKeyChecking=no');
        command.push(
          `${options.username || 'Administrator'}@${options.iloHost}`
        );
        break;
    }

    // Add additional arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: ILOConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // ILO environment variables
    if (options.iloHost) {
      env.ILO_HOST = options.iloHost;
    }

    if (options.iloPort) {
      env.ILO_PORT = options.iloPort.toString();
    }

    if (options.username) {
      env.ILO_USERNAME = options.username;
    }

    // SSH settings
    if (options.sshKey) {
      env.SSH_KEY_PATH = options.sshKey;
    }

    if (options.sshPassphrase) {
      env.SSH_PASSPHRASE = options.sshPassphrase;
    }

    // VSP settings
    if (options.enableVSP) {
      env.ILO_VSP_ENABLED = 'true';
      if (options.vspPort) {
        env.ILO_VSP_PORT = options.vspPort.toString();
      }
    }

    // Virtual media settings
    if (options.enableVirtualMedia) {
      env.ILO_VIRTUAL_MEDIA_ENABLED = 'true';
      if (options.virtualMediaType) {
        env.ILO_VIRTUAL_MEDIA_TYPE = options.virtualMediaType;
      }
      if (options.virtualMediaImage) {
        env.ILO_VIRTUAL_MEDIA_IMAGE = options.virtualMediaImage;
      }
    }

    // HTTPS settings
    if (options.enableHTTPS) {
      env.ILO_HTTPS_ENABLED = 'true';
      if (options.tlsVersion) {
        env.ILO_TLS_VERSION = options.tlsVersion;
      }
      if (options.certificatePath) {
        env.ILO_CERT_PATH = options.certificatePath;
      }
      if (options.privateKeyPath) {
        env.ILO_KEY_PATH = options.privateKeyPath;
      }
    }

    // SNMP settings
    if (options.enableSNMP) {
      env.ILO_SNMP_ENABLED = 'true';
      if (options.snmpVersion) {
        env.ILO_SNMP_VERSION = options.snmpVersion;
      }
      if (options.snmpCommunity) {
        env.ILO_SNMP_COMMUNITY = options.snmpCommunity;
      }
    }

    // Logging settings
    if (options.enableLogs) {
      env.ILO_LOGGING_ENABLED = 'true';
      if (options.logLevel) {
        env.ILO_LOG_LEVEL = options.logLevel;
      }
    }

    // Hardware monitoring settings
    if (options.enableFAN) {
      env.ILO_FAN_MONITORING = 'true';
    }
    if (options.enableThermal) {
      env.ILO_THERMAL_MONITORING = 'true';
    }
    if (options.enableRAID) {
      env.ILO_RAID_MONITORING = 'true';
    }
    if (options.enableNIC) {
      env.ILO_NIC_MONITORING = 'true';
    }
    if (options.enablePSU) {
      env.ILO_PSU_MONITORING = 'true';
    }
    if (options.enableCPU) {
      env.ILO_CPU_MONITORING = 'true';
    }
    if (options.enableMemory) {
      env.ILO_MEMORY_MONITORING = 'true';
    }
    if (options.enablePCI) {
      env.ILO_PCI_MONITORING = 'true';
    }

    // SmartArray and OneView settings
    if (options.enableSmartArray) {
      env.ILO_SMARTARRAY_ENABLED = 'true';
    }
    if (options.enableOneView) {
      env.ILO_ONEVIEW_ENABLED = 'true';
      if (options.oneViewSettings) {
        Object.entries(options.oneViewSettings).forEach(([key, value]) => {
          env[`ILO_ONEVIEW_${key.toUpperCase()}`] = value;
        });
      }
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up ILO protocol');

    // Close all ILO processes
    for (const [sessionId, process] of Array.from(this.iloProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing ILO process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.iloProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default ILOProtocol;
