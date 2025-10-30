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

// VMware Protocol connection options
interface VMwareConnectionOptions extends SessionOptions {
  // Basic VM Configuration
  vmName?: string;
  vmxPath?: string;
  datastore?: string;
  operation?:
    | 'start'
    | 'stop'
    | 'pause'
    | 'unpause'
    | 'suspend'
    | 'reset'
    | 'list'
    | 'clone'
    | 'snapshot'
    | 'delete'
    | 'register'
    | 'unregister'
    | 'upgrade'
    | 'migrate'
    | 'export'
    | 'import'
    | 'console'
    | 'monitor';

  // VMware Tools and CLI
  vmrunPath?: string;
  vmwarePath?: string;
  enableVmtools?: boolean;
  vmtoolsTimeout?: number;

  // VM Control Options
  vmType?:
    | 'ws'
    | 'fusion'
    | 'player'
    | 'server1'
    | 'server'
    | 'esx'
    | 'embeddedEsx'
    | 'hosted'
    | 'gsx';
  startMode?: 'gui' | 'nogui';
  enableGuestIsolation?: boolean;
  enableDragDrop?: boolean;
  enableCopyPaste?: boolean;

  // vSphere and ESXi Configuration
  esxiHost?: string;
  esxiUsername?: string;
  esxiPassword?: string;
  datacenterName?: string;
  clusterName?: string;
  resourcePool?: string;
  vmwareServer?: string;
  vmwarePort?: number;

  // Authentication
  authenticationType?: 'basic' | 'ssl' | 'kerberos' | 'saml';
  certificatePath?: string;
  keyPath?: string;
  enableSsl?: boolean;
  sslVerify?: boolean;

  // VM Hardware Configuration
  memory?: number;
  cpus?: number;
  coresPerSocket?: number;
  enableVirtualization?: boolean;
  enableIommu?: boolean;
  enableVbs?: boolean;

  // Storage Configuration
  diskPath?: string;
  diskSize?: number;
  diskType?: 'ide' | 'scsi' | 'nvme' | 'sata';
  enableSsd?: boolean;
  thinProvisioned?: boolean;
  diskMode?: 'persistent' | 'nonpersistent' | 'undoable' | 'append';

  // Network Configuration
  networkAdapter?: number;
  networkType?: 'bridged' | 'nat' | 'hostonly' | 'custom' | 'vmnet';
  networkName?: string;
  macAddress?: string;
  enableWakeOnLan?: boolean;

  // USB and Devices
  enableUsb?: boolean;
  usbVersion?: '1.1' | '2.0' | '3.0' | '3.1';
  enableSound?: boolean;
  soundCard?: 'sb16' | 'es1371' | 'hdaudio';
  enableSerial?: boolean;
  enableParallel?: boolean;

  // Display Configuration
  videoMemory?: number;
  enableAcceleration?: boolean;
  enable3d?: boolean;
  maxDisplays?: number;
  resolution?: string;

  // Shared Folders
  sharedFolders?: Array<{
    name: string;
    hostPath: string;
    readOnly?: boolean;
    enabled?: boolean;
  }>;

  // Snapshots
  snapshotName?: string;
  snapshotDescription?: string;
  snapshotMemory?: boolean;
  snapshotQuiesce?: boolean;

  // Advanced Features
  enableHotAdd?: boolean;
  enableHotPlug?: boolean;
  enableVProbes?: boolean;
  enableReplay?: boolean;
  replayFile?: string;

  // Performance Settings
  memoryReservation?: number;
  cpuReservation?: number;
  memoryLimit?: number;
  cpuLimit?: number;
  numaTopology?: string;

  // Security Settings
  enableEncryption?: boolean;
  encryptionKeyId?: string;
  enableSecureBoot?: boolean;
  enableVtpm?: boolean;

  // Power Management
  powerSettings?: {
    standbyAction?: 'default' | 'suspend' | 'powerOff';
    suspendAction?: 'default' | 'suspend' | 'powerOff';
    powerOffAction?: 'default' | 'suspend' | 'powerOff';
  };

  // Monitoring and Logging
  enableLogging?: boolean;
  logLevel?: 'error' | 'warning' | 'info' | 'verbose' | 'debug';
  logFile?: string;
  enableStats?: boolean;
  statsInterval?: number;

  // Guest OS Configuration
  guestOs?: string;
  guestOsVersion?: string;
  timeSync?: boolean;
  timeSyncInterval?: number;

  // vMotion and HA
  enableVmotion?: boolean;
  enableHA?: boolean;
  enableDRS?: boolean;
  drsSettings?: {
    enabled?: boolean;
    automationLevel?: 'manual' | 'partiallyAutomated' | 'fullyAutomated';
    migrationThreshold?: number;
  };

  // Backup and Recovery
  enableBackup?: boolean;
  backupSchedule?: string;
  enableFaultTolerance?: boolean;
  ftSettings?: {
    enabled?: boolean;
    bandwidth?: number;
    latencyTolerance?: number;
  };

  // Cloud Integration
  enableVmc?: boolean;
  vmcSettings?: {
    orgId?: string;
    sddcId?: string;
    region?: string;
  };

  // Container Integration
  enableContainers?: boolean;
  containerRuntime?: 'docker' | 'containerd' | 'cri-o';
  enableK8s?: boolean;
  k8sVersion?: string;

  // Automation and Scripting
  enablePowerCLI?: boolean;
  powerCLIScript?: string;
  enableGovc?: boolean;
  govcCommands?: string[];

  // Templates and OVF
  templateName?: string;
  ovfPath?: string;
  ovfProperties?: Record<string, string>;
  enableOvfDeploy?: boolean;

  // Resource Pools
  resourcePoolPath?: string;
  resourcePoolSettings?: {
    cpuShares?: number;
    memoryShares?: number;
    cpuExpandableReservation?: boolean;
    memoryExpandableReservation?: boolean;
  };

  // Distributed Switches
  dvsSettings?: {
    switchName?: string;
    portGroupName?: string;
    vlanId?: number;
    enableNetIOC?: boolean;
  };

  // Storage Policy
  storagePolicy?: string;
  storagePolicySettings?: {
    profileId?: string;
    compliance?: 'compliant' | 'nonCompliant' | 'notApplicable';
  };

  // Migration Settings
  migrationSettings?: {
    priority?: 'low' | 'normal' | 'high';
    bandwidth?: number;
    enableChangedBlockTracking?: boolean;
  };

  // Custom Properties
  customProperties?: Record<string, string>;
  vmNotes?: string;
  vmFolder?: string;

  // API Configuration
  enableRestApi?: boolean;
  apiVersion?: string;
  apiEndpoint?: string;
  apiTimeout?: number;

  // License Management
  licenseKey?: string;
  licenseMode?: 'evaluation' | 'licensed';

  // Update and Patching
  enableAutoUpdate?: boolean;
  updateChannel?: 'stable' | 'beta' | 'dev';
  patchBaseline?: string;
}

/**
 * VMware Protocol Implementation
 *
 * Provides VMware virtualization management and console access
 * Supports VMware Workstation, vSphere, ESXi, VM lifecycle, vMotion, and enterprise virtualization features
 */
export class VMwareProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'virtualization';
  public readonly capabilities: ProtocolCapabilities;

  private vmwareProcesses = new Map<string, ChildProcess>();

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
    super('vmware');

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
      maxConcurrentSessions: 1000, // VMware enterprise can handle many VMs
      defaultTimeout: 120000, // VM operations can take significant time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'certificate', 'kerberos', 'saml'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: false, // VMware has limited FreeBSD support
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if VMware tools are available
      await this.checkVMwareAvailability();
      this.isInitialized = true;
      this.logger.info(
        'VMware protocol initialized with enterprise virtualization features'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize VMware protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `vmware-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const vmwareProcess = this.vmwareProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!vmwareProcess || !vmwareProcess.stdin || !session) {
      throw new Error(`No active VMware session: ${sessionId}`);
    }

    vmwareProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to VMware session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const vmwareProcess = this.vmwareProcesses.get(sessionId);
      if (vmwareProcess) {
        // Try graceful shutdown first
        vmwareProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (vmwareProcess && !vmwareProcess.killed) {
            vmwareProcess.kill('SIGKILL');
          }
        }, 15000);

        this.vmwareProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`VMware session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing VMware session ${sessionId}:`, error);
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

    const vmwareOptions = options as VMwareConnectionOptions;

    // Validate VM parameters
    if (!vmwareOptions.vmName && !vmwareOptions.vmxPath) {
      throw new Error('VM name or VMX path is required for VMware protocol');
    }

    // Build VMware command
    const vmwareCommand = this.buildVMwareCommand(vmwareOptions);

    // Spawn VMware process
    const vmwareProcess = spawn(vmwareCommand[0], vmwareCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(vmwareOptions),
        ...options.env,
      },
    });

    // Set up output handling
    vmwareProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    vmwareProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    vmwareProcess.on('error', (error) => {
      this.logger.error(
        `VMware process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    vmwareProcess.on('close', (code) => {
      this.logger.info(
        `VMware process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.vmwareProcesses.set(sessionId, vmwareProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: vmwareCommand[0],
      args: vmwareCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(vmwareOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: vmwareProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `VMware session ${sessionId} created for VM ${vmwareOptions.vmName || vmwareOptions.vmxPath}`
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
      isOneShot: false, // VMware sessions are typically persistent
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
      `Error in VMware session ${context.sessionId}: ${error.message}`
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
    const vmwareProcess = this.vmwareProcesses.get(sessionId);
    return (vmwareProcess && !vmwareProcess.killed) || false;
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
        connectionsActive: this.vmwareProcesses.size,
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
      await this.checkVMwareAvailability();
      return {
        ...baseStatus,
        dependencies: {
          vmware: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `VMware not available: ${error}`],
        dependencies: {
          vmware: { available: false },
        },
      };
    }
  }

  private async checkVMwareAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try vmrun first (most common)
      const testProcess = spawn('vmrun', ['-T', 'ws', 'list'], {
        stdio: 'pipe',
      });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Try alternative VMware tools
          this.tryAlternativeVMwareTools().then(resolve).catch(reject);
        }
      });

      testProcess.on('error', () => {
        // Try alternative VMware tools
        this.tryAlternativeVMwareTools()
          .then(resolve)
          .catch(() =>
            reject(
              new Error(
                'VMware tools not found. Please install VMware Workstation, Player, or vSphere CLI.'
              )
            )
          );
      });
    });
  }

  private async tryAlternativeVMwareTools(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try govc (vSphere CLI)
      const govcProcess = spawn('govc', ['version'], { stdio: 'pipe' });

      govcProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('No VMware tools available'));
        }
      });

      govcProcess.on('error', () => {
        reject(new Error('No VMware tools available'));
      });
    });
  }

  private buildVMwareCommand(options: VMwareConnectionOptions): string[] {
    const command = [];

    // VMware executable
    if (options.vmrunPath) {
      command.push(options.vmrunPath);
    } else if (options.enableGovc) {
      command.push('govc');
    } else {
      command.push('vmrun');
    }

    // Handle govc commands
    if (options.enableGovc && options.govcCommands) {
      command.push(...options.govcCommands);
      return command;
    }

    // VM Type for vmrun
    if (!options.enableGovc) {
      command.push('-T');
      command.push(options.vmType || 'ws');
    }

    // Operation type
    switch (options.operation) {
      case 'start':
        command.push('start');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }

        if (options.startMode) {
          command.push(options.startMode);
        }
        break;

      case 'stop':
        command.push('stop');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        break;

      case 'pause':
        command.push('pause');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        break;

      case 'unpause':
        command.push('unpause');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        break;

      case 'suspend':
        command.push('suspend');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        break;

      case 'reset':
        command.push('reset');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        break;

      case 'list':
        command.push('list');
        break;

      case 'snapshot':
        command.push('snapshot');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        if (options.snapshotName) {
          command.push(options.snapshotName);
        }
        break;

      case 'clone':
        command.push('clone');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        }
        break;

      case 'delete':
        command.push('deleteVM');
        if (options.vmxPath) {
          command.push(options.vmxPath);
        } else if (options.vmName) {
          command.push(options.vmName);
        }
        break;

      default:
        // Default to list VMs
        command.push('list');
        break;
    }

    return command;
  }

  private buildEnvironment(
    options: VMwareConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // VMware environment variables
    if (options.vmrunPath) {
      env.VMWARE_VMRUN_PATH = options.vmrunPath;
    }

    if (options.vmwarePath) {
      env.VMWARE_PATH = options.vmwarePath;
    }

    // vSphere environment
    if (options.esxiHost) {
      env.GOVC_URL = options.esxiHost;
    }

    if (options.esxiUsername) {
      env.GOVC_USERNAME = options.esxiUsername;
    }

    if (options.esxiPassword) {
      env.GOVC_PASSWORD = options.esxiPassword;
    }

    if (options.datacenterName) {
      env.GOVC_DATACENTER = options.datacenterName;
    }

    if (options.datastore) {
      env.GOVC_DATASTORE = options.datastore;
    }

    // SSL settings
    if (options.enableSsl === false) {
      env.GOVC_INSECURE = 'true';
    }

    // API settings
    if (options.apiVersion) {
      env.VMWARE_API_VERSION = options.apiVersion;
    }

    // Custom properties
    if (options.customProperties) {
      Object.entries(options.customProperties).forEach(([key, value]) => {
        env[`VMWARE_${key.toUpperCase()}`] = value;
      });
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up VMware protocol');

    // Close all VMware processes
    for (const [sessionId, process] of Array.from(this.vmwareProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing VMware process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.vmwareProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default VMwareProtocol;
