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

// VirtualBox Protocol connection options
interface VirtualBoxConnectionOptions extends SessionOptions {
  // Basic VM Configuration
  vmName?: string;
  vmUuid?: string;
  operation?:
    | 'start'
    | 'stop'
    | 'pause'
    | 'resume'
    | 'reset'
    | 'poweroff'
    | 'savestate'
    | 'list'
    | 'showvminfo'
    | 'clone'
    | 'snapshot'
    | 'import'
    | 'export'
    | 'manage'
    | 'console'
    | 'connect';

  // VM Control Options
  vmType?: 'gui' | 'headless' | 'separate' | 'sdl';
  startupDelay?: number;
  enableVrde?: boolean;
  vrdePort?: number;
  vrdeAddress?: string;
  vrdeAuthType?: 'null' | 'external' | 'guest';

  // VM Configuration
  osType?: string;
  memory?: number;
  cpus?: number;
  vram?: number;
  enableAccel3d?: boolean;
  enableAccel2d?: boolean;

  // Storage Configuration
  hddPath?: string;
  hddSize?: number;
  hddType?: 'dynamic' | 'fixed';
  enableSata?: boolean;
  enableIde?: boolean;
  enableScsi?: boolean;
  enableNvme?: boolean;

  // Network Configuration
  networkAdapter?: number;
  networkType?:
    | 'none'
    | 'null'
    | 'nat'
    | 'natnetwork'
    | 'bridged'
    | 'intnet'
    | 'hostonly'
    | 'generic';
  networkName?: string;
  macAddress?: string;
  enableCable?: boolean;

  // Audio Configuration
  audioController?: 'none' | 'ac97' | 'hda' | 'sb16';
  audioDriver?:
    | 'none'
    | 'pulse'
    | 'alsa'
    | 'oss'
    | 'coreaudio'
    | 'directsound'
    | 'was';

  // USB Configuration
  enableUsb?: boolean;
  usbVersion?: '1.0' | '2.0' | '3.0';
  usbFilters?: string[];

  // Shared Folders
  sharedFolders?: Array<{
    name: string;
    hostPath: string;
    readonly?: boolean;
    automount?: boolean;
  }>;

  // Advanced Settings
  biosSettings?: Record<string, string>;
  extraData?: Record<string, string>;
  enableIoApic?: boolean;
  enablePae?: boolean;
  enableLongMode?: boolean;
  enableVtx?: boolean;
  enableNestedPaging?: boolean;

  // Guest Additions
  enableGuestAdditions?: boolean;
  guestAdditionsIso?: string;
  enableClipboard?: boolean;
  clipboardMode?: 'disabled' | 'hosttoguest' | 'guesttohost' | 'bidirectional';
  enableDragDrop?: boolean;
  dragDropMode?: 'disabled' | 'hosttoguest' | 'guesttohost' | 'bidirectional';

  // Snapshots
  snapshotName?: string;
  snapshotDescription?: string;
  enableSnapshots?: boolean;
  deleteSnapshots?: boolean;

  // Groups
  groupName?: string;
  enableGroups?: boolean;

  // VirtualBox Management
  vboxmanagePath?: string;
  vboxheadlessPath?: string;
  vboxsdlPath?: string;

  // Automation
  automateInstall?: boolean;
  unattendedScript?: string;
  kickstartFile?: string;
  preseedFile?: string;

  // Security
  enableEncryption?: boolean;
  encryptionPassword?: string;
  enableSecureBoot?: boolean;

  // Performance
  enableHardwareVirt?: boolean;
  enableLargePages?: boolean;
  enablePageFusion?: boolean;
  paravirtProvider?:
    | 'none'
    | 'default'
    | 'legacy'
    | 'minimal'
    | 'hyperv'
    | 'kvm';

  // Remote Display
  enableVnc?: boolean;
  vncPort?: number;
  vncPassword?: string;
  enableSpice?: boolean;
  spicePort?: number;

  // Cloud Integration
  enableCloudSync?: boolean;
  cloudProvider?: string;
  cloudProfile?: string;

  // Debugging
  enableDebugger?: boolean;
  debuggerType?: 'builtin' | 'gdb';
  enableTracing?: boolean;
  tracingConfig?: string;

  // Import/Export
  importPath?: string;
  exportPath?: string;
  exportFormat?: 'ovf' | 'ova';
  enableManifest?: boolean;

  // Extension Packs
  extensionPacks?: string[];
  enableExtensionPack?: boolean;

  // Host Integration
  enableHostOnlyNetwork?: boolean;
  hostOnlyAdapter?: string;
  enableNatNetwork?: boolean;
  natNetworkName?: string;

  // Resource Limits
  cpuExecutionCap?: number;
  memoryBalloon?: number;
  enableLimitCpuTime?: boolean;
  cpuTimeLimit?: number;

  // Logging
  enableVmLogging?: boolean;
  logLevel?: 'disabled' | 'error' | 'warning' | 'info' | 'debug' | 'trace';
  logFile?: string;

  // Backup and Recovery
  enableBackup?: boolean;
  backupPath?: string;
  backupFrequency?: 'daily' | 'weekly' | 'monthly';

  // Guest OS Features
  guestOsFeatures?: {
    enableSymlinks?: boolean;
    enableHardlinks?: boolean;
    enableStatfs?: boolean;
    hostTimeSync?: boolean;
  };

  // API Configuration
  enableWebservice?: boolean;
  webservicePort?: number;
  webserviceAuth?: boolean;
  enableSoap?: boolean;
  soapTimeout?: number;

  // Networking Advanced
  portForwarding?: Array<{
    name: string;
    protocol: 'tcp' | 'udp';
    hostPort: number;
    guestPort: number;
    hostIp?: string;
    guestIp?: string;
  }>;

  // Custom Properties
  customProperties?: Record<string, string>;
  vmDescription?: string;
  vmTags?: string[];

  // Power Management
  powerSettings?: {
    acpiEnabled?: boolean;
    ioapicEnabled?: boolean;
    utcClock?: boolean;
    hwClockUtc?: boolean;
  };

  // Display Settings
  displaySettings?: {
    monitorCount?: number;
    resolutionWidth?: number;
    resolutionHeight?: number;
    colorDepth?: number;
    enableAcceleration?: boolean;
  };
}

/**
 * VirtualBox Protocol Implementation
 *
 * Provides VirtualBox virtual machine management and console access
 * Supports VM lifecycle, headless operations, VRDE/VNC remote access, and comprehensive virtualization control
 */
export class VirtualBoxProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'virtualization';
  public readonly capabilities: ProtocolCapabilities;

  private vboxProcesses = new Map<string, ChildProcess>();

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
    super('virtualbox');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: true,
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
      maxConcurrentSessions: 100, // VirtualBox can run many VMs simultaneously
      defaultTimeout: 60000, // VM operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'key-file'],
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
      // Check if VirtualBox is available
      await this.checkVirtualBoxAvailability();
      this.isInitialized = true;
      this.logger.info(
        'VirtualBox protocol initialized with virtualization features'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize VirtualBox protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `vbox-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const vboxProcess = this.vboxProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!vboxProcess || !vboxProcess.stdin || !session) {
      throw new Error(`No active VirtualBox session: ${sessionId}`);
    }

    vboxProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to VirtualBox session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const vboxProcess = this.vboxProcesses.get(sessionId);
      if (vboxProcess) {
        // Try graceful shutdown first
        vboxProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (vboxProcess && !vboxProcess.killed) {
            vboxProcess.kill('SIGKILL');
          }
        }, 10000);

        this.vboxProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`VirtualBox session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(
        `Error closing VirtualBox session ${sessionId}:`,
        error
      );
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

    const vboxOptions = options as VirtualBoxConnectionOptions;

    // Validate VM parameters
    if (!vboxOptions.vmName && !vboxOptions.vmUuid) {
      throw new Error('VM name or UUID is required for VirtualBox protocol');
    }

    // Build VirtualBox command
    const vboxCommand = this.buildVirtualBoxCommand(vboxOptions);

    // Spawn VirtualBox process
    const vboxProcess = spawn(vboxCommand[0], vboxCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(vboxOptions),
        ...options.env,
      },
    });

    // Set up output handling
    vboxProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    vboxProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    vboxProcess.on('error', (error) => {
      this.logger.error(
        `VirtualBox process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    vboxProcess.on('close', (code) => {
      this.logger.info(
        `VirtualBox process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.vboxProcesses.set(sessionId, vboxProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: vboxCommand[0],
      args: vboxCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(vboxOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: vboxProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `VirtualBox session ${sessionId} created for VM ${vboxOptions.vmName || vboxOptions.vmUuid}`
    );
    this.emit('session-created', {
      sessionId,
      type: 'virtualization',
      session,
    });

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
      isOneShot: false, // VirtualBox sessions are typically persistent
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
      `Error in VirtualBox session ${context.sessionId}: ${error.message}`
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
    const vboxProcess = this.vboxProcesses.get(sessionId);
    return (vboxProcess && !vboxProcess.killed) || false;
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
        connectionsActive: this.vboxProcesses.size,
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
      await this.checkVirtualBoxAvailability();
      return {
        ...baseStatus,
        dependencies: {
          virtualbox: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `VirtualBox not available: ${error}`],
        dependencies: {
          virtualbox: { available: false },
        },
      };
    }
  }

  private async checkVirtualBoxAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('VBoxManage', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              'VirtualBox VBoxManage tool not found. Please install VirtualBox.'
            )
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error(
            'VirtualBox VBoxManage tool not found. Please install VirtualBox.'
          )
        );
      });
    });
  }

  private buildVirtualBoxCommand(
    options: VirtualBoxConnectionOptions
  ): string[] {
    const command = [];

    // VirtualBox executable
    if (options.vboxmanagePath) {
      command.push(options.vboxmanagePath);
    } else {
      command.push('VBoxManage');
    }

    // Operation type
    switch (options.operation) {
      case 'start':
        command.push('startvm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }

        // VM type
        if (options.vmType) {
          command.push('--type', options.vmType);
        }

        // VRDE settings
        if (options.enableVrde) {
          command.push('--vrde', 'on');
          if (options.vrdePort) {
            command.push('--vrdeport', options.vrdePort.toString());
          }
        }
        break;

      case 'stop':
        command.push('controlvm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        command.push('poweroff');
        break;

      case 'pause':
        command.push('controlvm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        command.push('pause');
        break;

      case 'resume':
        command.push('controlvm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        command.push('resume');
        break;

      case 'reset':
        command.push('controlvm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        command.push('reset');
        break;

      case 'savestate':
        command.push('controlvm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        command.push('savestate');
        break;

      case 'list':
        command.push('list', 'vms');
        break;

      case 'showvminfo':
        command.push('showvminfo');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        break;

      case 'snapshot':
        command.push('snapshot');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        command.push('take');
        if (options.snapshotName) {
          command.push(options.snapshotName);
        }
        break;

      case 'clone':
        command.push('clonevm');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        break;

      case 'import':
        command.push('import');
        if (options.importPath) {
          command.push(options.importPath);
        }
        break;

      case 'export':
        command.push('export');
        if (options.vmName) {
          command.push(options.vmName);
        } else if (options.vmUuid) {
          command.push(options.vmUuid);
        }
        if (options.exportPath) {
          command.push('--output', options.exportPath);
        }
        break;

      default:
        // Default to VM management operations
        command.push('list', 'vms');
        break;
    }

    return command;
  }

  private buildEnvironment(
    options: VirtualBoxConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // VirtualBox environment variables
    if (options.vboxmanagePath) {
      env.VBOX_MANAGE_PATH = options.vboxmanagePath;
    }

    // VM configuration
    if (options.vmName) {
      env.VBOX_VM_NAME = options.vmName;
    }

    if (options.vmUuid) {
      env.VBOX_VM_UUID = options.vmUuid;
    }

    // VRDE settings
    if (options.enableVrde) {
      env.VBOX_VRDE_ENABLED = 'true';
      if (options.vrdePort) {
        env.VBOX_VRDE_PORT = options.vrdePort.toString();
      }
    }

    // Custom properties
    if (options.customProperties) {
      Object.entries(options.customProperties).forEach(([key, value]) => {
        env[`VBOX_${key.toUpperCase()}`] = value;
      });
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up VirtualBox protocol');

    // Close all VirtualBox processes
    for (const [sessionId, process] of Array.from(this.vboxProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing VirtualBox process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.vboxProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default VirtualBoxProtocol;
