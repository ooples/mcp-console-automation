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

// Hyper-V Protocol connection options
interface HyperVConnectionOptions extends SessionOptions {
  hyperVHost?: string;
  vmName?: string;
  vmId?: string;
  hyperVPath?: string;
  username?: string;
  password?: string;
  domain?: string;
  operation?: 'connect' | 'start' | 'stop' | 'save' | 'pause' | 'resume' | 'checkpoint' | 'restore';
  checkpointName?: string;
  enableEnhancedSession?: boolean;
  enableRDP?: boolean;
  rdpPort?: number;
  enableVMConnect?: boolean;
  vmGeneration?: 1 | 2;
  memorySizeMB?: number;
  cpuCount?: number;
  enableDynamicMemory?: boolean;
  memoryMinimumMB?: number;
  memoryMaximumMB?: number;
  enableNestedVirtualization?: boolean;
  enableSecureBoot?: boolean;
  enableTPM?: boolean;
  switchName?: string;
  vlanId?: number;
  macAddress?: string;
  enableMacSpoofing?: boolean;
  enableDhcpGuard?: boolean;
  enableRouterGuard?: boolean;
  enablePortMirroring?: boolean;
  vhdPath?: string;
  vhdSizeGB?: number;
  enableCheckpoints?: boolean;
  automaticStartAction?: 'Nothing' | 'StartIfRunning' | 'Start';
  automaticStopAction?: 'TurnOff' | 'Save' | 'ShutDown';
  automaticStartDelay?: number;
  smartPagingFilePath?: string;
  snapshotFileLocation?: string;
  configurationDataRoot?: string;
  enableGuestServices?: boolean;
  enableHeartbeat?: boolean;
  enableKeyValuePairExchange?: boolean;
  enableShutdown?: boolean;
  enableTimeSynchronization?: boolean;
  enableVSS?: boolean;
  environment?: Record<string, string>;
}

/**
 * Hyper-V Protocol Implementation
 *
 * Provides Microsoft Hyper-V virtualization console access through PowerShell and VM management commands
 * Supports VM lifecycle management, enhanced sessions, RDP connections, and enterprise virtualization features
 */
export class HyperVProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'hyperv';
  public readonly capabilities: ProtocolCapabilities;

  private hyperVProcesses = new Map<string, ChildProcess>();

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
    super('hyperv');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: false, // Hyper-V uses console redirection
      maxConcurrentSessions: 50, // Hyper-V can handle many VMs
      defaultTimeout: 120000, // VM operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'certificate', 'domain'],
      platformSupport: {
        windows: true, // Hyper-V is Windows-only
        linux: false,
        macos: false,
        freebsd: false
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Hyper-V tools are available
      await this.checkHyperVAvailability();
      this.isInitialized = true;
      this.logger.info('Hyper-V protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Hyper-V protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `hyperv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const hyperVProcess = this.hyperVProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!hyperVProcess || !hyperVProcess.stdin || !session) {
      throw new Error(`No active Hyper-V session: ${sessionId}`);
    }

    hyperVProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Hyper-V session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const hyperVProcess = this.hyperVProcesses.get(sessionId);
      if (hyperVProcess) {
        // Try graceful shutdown first
        hyperVProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (hyperVProcess && !hyperVProcess.killed) {
            hyperVProcess.kill('SIGKILL');
          }
        }, 30000);

        this.hyperVProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Hyper-V session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Hyper-V session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const hyperVOptions = options as HyperVConnectionOptions;

    // Validate required VM parameters
    if (!hyperVOptions.vmName && !hyperVOptions.vmId) {
      throw new Error('VM name or VM ID is required for Hyper-V protocol');
    }

    // Build Hyper-V command
    const hyperVCommand = this.buildHyperVCommand(hyperVOptions);

    // Spawn Hyper-V process
    const hyperVProcess = spawn(hyperVCommand[0], hyperVCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(hyperVOptions), ...options.env }
    });

    // Set up output handling
    hyperVProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    hyperVProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    hyperVProcess.on('error', (error) => {
      this.logger.error(`Hyper-V process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    hyperVProcess.on('close', (code) => {
      this.logger.info(`Hyper-V process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.hyperVProcesses.set(sessionId, hyperVProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: hyperVCommand[0],
      args: hyperVCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(hyperVOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: hyperVProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Hyper-V session ${sessionId} created for VM ${hyperVOptions.vmName || hyperVOptions.vmId}`);
    this.emit('session-created', { sessionId, type: 'hyperv', session });

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
      isOneShot: false, // Hyper-V sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Hyper-V session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const hyperVProcess = this.hyperVProcesses.get(sessionId);
    return hyperVProcess && !hyperVProcess.killed || false;
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
        connectionsActive: this.hyperVProcesses.size
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
      await this.checkHyperVAvailability();
      return {
        ...baseStatus,
        dependencies: {
          hyperv: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Hyper-V not available: ${error}`],
        dependencies: {
          hyperv: { available: false }
        }
      };
    }
  }

  private async checkHyperVAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('powershell', ['-Command', 'Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Hyper-V not available. Please enable Hyper-V feature on Windows.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('PowerShell not available. Hyper-V requires Windows PowerShell.'));
      });
    });
  }

  private buildHyperVCommand(options: HyperVConnectionOptions): string[] {
    const command = [];

    // Use PowerShell for Hyper-V management
    command.push('powershell');
    command.push('-ExecutionPolicy', 'Bypass');
    command.push('-Command');

    let psCommand = '';

    // Build PowerShell command based on operation
    switch (options.operation) {
      case 'start':
        psCommand = `Start-VM -Name '${options.vmName || options.vmId}'`;
        break;
      case 'stop':
        psCommand = `Stop-VM -Name '${options.vmName || options.vmId}' -Force`;
        break;
      case 'save':
        psCommand = `Save-VM -Name '${options.vmName || options.vmId}'`;
        break;
      case 'pause':
        psCommand = `Suspend-VM -Name '${options.vmName || options.vmId}'`;
        break;
      case 'resume':
        psCommand = `Resume-VM -Name '${options.vmName || options.vmId}'`;
        break;
      case 'checkpoint':
        psCommand = `Checkpoint-VM -Name '${options.vmName || options.vmId}'`;
        if (options.checkpointName) {
          psCommand += ` -SnapshotName '${options.checkpointName}'`;
        }
        break;
      case 'restore':
        if (options.checkpointName) {
          psCommand = `Restore-VMSnapshot -VMName '${options.vmName || options.vmId}' -Name '${options.checkpointName}' -Confirm:$false`;
        } else {
          psCommand = `Get-VMSnapshot -VMName '${options.vmName || options.vmId}' | Sort-Object CreationTime | Select-Object -Last 1 | Restore-VMSnapshot -Confirm:$false`;
        }
        break;
      case 'connect':
      default:
        if (options.enableVMConnect !== false) {
          // Use VMConnect for console access
          if (options.hyperVHost) {
            psCommand = `vmconnect '${options.hyperVHost}' '${options.vmName || options.vmId}'`;
          } else {
            psCommand = `vmconnect 'localhost' '${options.vmName || options.vmId}'`;
          }
        } else if (options.enableRDP) {
          // Use RDP connection
          psCommand = `Get-VM -Name '${options.vmName || options.vmId}' | Get-VMNetworkAdapter | Select-Object -ExpandProperty IPAddresses | Where-Object { $_ -match '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$' } | Select-Object -First 1 | ForEach-Object { mstsc /v:$_ }`;
        } else {
          // PowerShell Direct (enhanced session)
          if (options.enableEnhancedSession !== false) {
            psCommand = `Enter-PSSession -VMName '${options.vmName || options.vmId}'`;
          } else {
            psCommand = `Get-VM -Name '${options.vmName || options.vmId}' | Format-Table Name, State, CPUUsage, MemoryAssigned, MemoryDemand, MemoryStatus, Uptime, Status`;
          }
        }
        break;
    }

    // Add credentials if provided
    if (options.username && options.password) {
      if (psCommand.includes('Enter-PSSession')) {
        const credScript = `$securePassword = ConvertTo-SecureString '${options.password}' -AsPlainText -Force; `;
        if (options.domain) {
          psCommand = credScript + `$credential = New-Object System.Management.Automation.PSCredential('${options.domain}\\${options.username}', $securePassword); ` + psCommand + ` -Credential $credential`;
        } else {
          psCommand = credScript + `$credential = New-Object System.Management.Automation.PSCredential('${options.username}', $securePassword); ` + psCommand + ` -Credential $credential`;
        }
      }
    }

    command.push(psCommand);

    return command;
  }

  private buildEnvironment(options: HyperVConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Hyper-V environment variables
    if (options.hyperVHost) {
      env.HYPERV_HOST = options.hyperVHost;
    }

    if (options.vmName) {
      env.HYPERV_VM_NAME = options.vmName;
    }

    if (options.vmId) {
      env.HYPERV_VM_ID = options.vmId;
    }

    // Authentication
    if (options.username) {
      env.HYPERV_USERNAME = options.username;
    }

    if (options.domain) {
      env.HYPERV_DOMAIN = options.domain;
    }

    // Operation settings
    if (options.operation) {
      env.HYPERV_OPERATION = options.operation;
    }

    // Enhanced session settings
    if (options.enableEnhancedSession !== undefined) {
      env.HYPERV_ENHANCED_SESSION = options.enableEnhancedSession.toString();
    }

    // RDP settings
    if (options.enableRDP !== undefined) {
      env.HYPERV_ENABLE_RDP = options.enableRDP.toString();
    }

    if (options.rdpPort) {
      env.HYPERV_RDP_PORT = options.rdpPort.toString();
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Hyper-V protocol');

    // Close all Hyper-V processes
    for (const [sessionId, process] of Array.from(this.hyperVProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Hyper-V process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.hyperVProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default HyperVProtocol;