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

// Vagrant Protocol connection options
interface VagrantConnectionOptions extends SessionOptions {
  vagrantPath?: string;
  vagrantfile?: string;
  workingDir?: string;
  machineName?: string;
  provider?:
    | 'virtualbox'
    | 'vmware_desktop'
    | 'hyper-v'
    | 'docker'
    | 'libvirt'
    | 'parallels';
  box?: string;
  boxVersion?: string;
  boxUrl?: string;
  boxCheckUpdate?: boolean;
  provision?: boolean;
  provisionWith?: string[];
  destroyOnError?: boolean;
  parallelRuns?: number;
  enableGui?: boolean;
  enableDebug?: boolean;
  debugLevel?: 'info' | 'debug' | 'trace';
  vagrantHome?: string;
  vagrantDotfilePath?: string;
  environment?: Record<string, string>;
  networking?: {
    forwarded_port?: Array<{
      guest: number;
      host: number;
      protocol?: 'tcp' | 'udp';
      auto_correct?: boolean;
    }>;
    private_network?: {
      ip?: string;
      type?: 'dhcp' | 'static';
    };
    public_network?: {
      bridge?: string;
      ip?: string;
    };
  };
  synced_folders?: Array<{
    host_path: string;
    guest_path: string;
    type?: 'nfs' | 'rsync' | 'smb' | 'virtualbox';
    options?: Record<string, any>;
  }>;
  vmConfig?: {
    memory?: number;
    cpus?: number;
    name?: string;
    gui?: boolean;
    check_guest_additions?: boolean;
  };
  sshConfig?: {
    username?: string;
    password?: string;
    private_key_path?: string;
    forward_agent?: boolean;
    forward_x11?: boolean;
    insert_key?: boolean;
  };
  pluginOptions?: Record<string, any>;
}

/**
 * Vagrant Protocol Implementation
 *
 * Provides Vagrant virtual machine management console access through vagrant command
 * Supports VM provisioning, box management, multi-machine environments, and provider integration
 */
export class VagrantProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'vagrant';
  public readonly capabilities: ProtocolCapabilities;

  private vagrantProcesses = new Map<string, ChildProcess>();

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
    super('vagrant');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: false,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 10,
      defaultTimeout: 300000, // Vagrant operations can take very long
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['ssh-key', 'password'],
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
      // Check if Vagrant is available
      await this.checkVagrantAvailability();
      this.isInitialized = true;
      this.logger.info('Vagrant protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Vagrant protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `vagrant-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const vagrantProcess = this.vagrantProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!vagrantProcess || !vagrantProcess.stdin || !session) {
      throw new Error(`No active Vagrant session: ${sessionId}`);
    }

    vagrantProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to Vagrant session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const vagrantProcess = this.vagrantProcesses.get(sessionId);
      if (vagrantProcess) {
        // Try graceful shutdown first
        vagrantProcess.kill('SIGTERM');

        // Force kill after timeout (longer for Vagrant operations)
        setTimeout(() => {
          if (vagrantProcess && !vagrantProcess.killed) {
            vagrantProcess.kill('SIGKILL');
          }
        }, 20000);

        this.vagrantProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Vagrant session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Vagrant session ${sessionId}:`, error);
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

    const vagrantOptions = options as VagrantConnectionOptions;

    // Build Vagrant command
    const vagrantCommand = this.buildVagrantCommand(vagrantOptions);

    // Spawn Vagrant process
    const vagrantProcess = spawn(vagrantCommand[0], vagrantCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || vagrantOptions.workingDir || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(vagrantOptions),
        ...options.env,
      },
    });

    // Set up output handling
    vagrantProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    vagrantProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    vagrantProcess.on('error', (error) => {
      this.logger.error(
        `Vagrant process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    vagrantProcess.on('close', (code) => {
      this.logger.info(
        `Vagrant process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.vagrantProcesses.set(sessionId, vagrantProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: vagrantCommand[0],
      args: vagrantCommand.slice(1),
      cwd: options.cwd || vagrantOptions.workingDir || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(vagrantOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: vagrantProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `Vagrant session ${sessionId} created for ${vagrantOptions.vagrantfile || vagrantOptions.workingDir || 'Vagrant environment'}`
    );
    this.emit('session-created', { sessionId, type: 'vagrant', session });

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
      isOneShot: true, // Vagrant commands are typically one-shot
      isPersistent: false,
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
      `Error in Vagrant session ${context.sessionId}: ${error.message}`
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
    const vagrantProcess = this.vagrantProcesses.get(sessionId);
    return (vagrantProcess && !vagrantProcess.killed) || false;
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
        connectionsActive: this.vagrantProcesses.size,
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
      await this.checkVagrantAvailability();
      return {
        ...baseStatus,
        dependencies: {
          vagrant: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Vagrant not available: ${error}`],
        dependencies: {
          vagrant: { available: false },
        },
      };
    }
  }

  private async checkVagrantAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('vagrant', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Vagrant not found. Please install Vagrant.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Vagrant not found. Please install Vagrant.'));
      });
    });
  }

  private buildVagrantCommand(options: VagrantConnectionOptions): string[] {
    const command = [];

    // Vagrant executable
    if (options.vagrantPath) {
      command.push(options.vagrantPath);
    } else {
      command.push('vagrant');
    }

    // Determine Vagrant subcommand based on options
    if (options.args && options.args.length > 0) {
      // Use provided command arguments
      command.push(...options.args);
    } else {
      // Default to up command for VM provisioning
      command.push('up');
    }

    // Machine name
    if (options.machineName) {
      command.push(options.machineName);
    }

    // Provider
    if (options.provider) {
      command.push('--provider', options.provider);
    }

    // Provision options
    if (options.provision === true) {
      command.push('--provision');
    } else if (options.provision === false) {
      command.push('--no-provision');
    }

    if (options.provisionWith && options.provisionWith.length > 0) {
      command.push('--provision-with', options.provisionWith.join(','));
    }

    // Destroy on error
    if (options.destroyOnError) {
      command.push('--destroy-on-error');
    }

    // Parallel runs
    if (options.parallelRuns) {
      command.push('--parallel');
    }

    // Debug options
    if (options.enableDebug) {
      if (options.debugLevel) {
        command.push('--debug', `--${options.debugLevel}`);
      } else {
        command.push('--debug');
      }
    }

    return command;
  }

  private buildEnvironment(
    options: VagrantConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Vagrant home directory
    if (options.vagrantHome) {
      env.VAGRANT_HOME = options.vagrantHome;
    }

    // Vagrant dotfile path
    if (options.vagrantDotfilePath) {
      env.VAGRANT_DOTFILE_PATH = options.vagrantDotfilePath;
    }

    // Box update checking
    if (options.boxCheckUpdate === false) {
      env.VAGRANT_BOX_UPDATE_CHECK_DISABLE = '1';
    }

    // Disable checkpoint for CI environments
    env.VAGRANT_CHECKPOINT_DISABLE = '1';

    // Disable experimental features warnings
    env.VAGRANT_EXPERIMENTAL = 'typed_triggers';

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Vagrant protocol');

    // Close all Vagrant processes
    for (const [sessionId, process] of Array.from(this.vagrantProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing Vagrant process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.vagrantProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default VagrantProtocol;
