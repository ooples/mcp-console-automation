import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleOutput,
  ConsoleType,
  ContainerConsoleType,
  CommandExecution,
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage,
} from '../core/IProtocol.js';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';

// LXC Protocol connection options
interface LXCConnectionOptions extends SessionOptions {
  containerName: string;
  template?: string;
  lxcCommand?: string[];
  workingDir?: string;
  config?: Record<string, string>;
  network?: string;
  autoStart?: boolean;
  privileged?: boolean;
  removeOnExit?: boolean;
  rootfs?: string;
  storage?: string;
  enableTTY?: boolean;
  enableStdin?: boolean;
  detach?: boolean;
  user?: string;
  group?: string;
  capabilities?: string[];
  clearEnv?: boolean;
  keepEnv?: string[];
  unshareNetwork?: boolean;
  unshareIPC?: boolean;
  unsharePID?: boolean;
  unshareUTS?: boolean;
  unshareUser?: boolean;
  remountSysProc?: boolean;
  elevatedPrivileges?: boolean;
  enableLogging?: boolean;
  logFile?: string;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  enableCgroups?: boolean;
  cgroupPath?: string;
  memoryLimit?: string;
  cpuLimit?: string;
  enableAppArmor?: boolean;
  apparmorProfile?: string;
  enableSeccomp?: boolean;
  seccompProfile?: string;
  enableSELinux?: boolean;
  selinuxContext?: string;
  mountOptions?: string[];
  bindMounts?: string[];
  enableSnapshots?: boolean;
  snapshotName?: string;
  enableCloning?: boolean;
  cloneSource?: string;
  enableMigration?: boolean;
  migrationTarget?: string;
  environment?: Record<string, string>;
}

/**
 * LXC Protocol Implementation
 *
 * Provides LXC container console access through lxc-attach, lxc-create commands
 * Supports container lifecycle management, security features, resource limits, and enterprise container orchestration
 */
export class LXCProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'lxc';
  public readonly capabilities: ProtocolCapabilities;

  private lxcProcesses = new Map<string, ChildProcess>();
  private lxcAvailable: boolean = false;

  // Compatibility property for old ProtocolFactory interface
  public get healthStatus(): ProtocolHealthStatus {
    return {
      isHealthy: this.isInitialized && this.lxcAvailable,
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
    super('lxc');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 30, // LXC can handle many containers
      defaultTimeout: 60000, // Container operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
      platformSupport: {
        windows: false, // LXC is Linux-only
        linux: true,
        macos: false,
        freebsd: false,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if LXC is available
      await this.checkLXCAvailability();
      this.isInitialized = true;
      this.logger.info('LXC protocol initialized with production features', {
        available: this.lxcAvailable,
      });
    } catch (error: any) {
      this.logger.error('Failed to initialize LXC protocol', error);
      throw error;
    }
  }

  private async checkLXCAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const lxcProcess = spawn('lxc-ls', ['--version'], { stdio: 'pipe' });

      lxcProcess.on('exit', (code) => {
        this.lxcAvailable = code === 0;
        if (this.lxcAvailable) {
          resolve();
        } else {
          reject(new Error('LXC tools not found. Please install lxc package.'));
        }
      });

      lxcProcess.on('error', (error) => {
        this.lxcAvailable = false;
        reject(new Error('LXC tools not found. Please install lxc package.'));
      });
    });
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `lxc-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const lxcProcess = this.lxcProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!lxcProcess || !lxcProcess.stdin || !session) {
      throw new Error(`No active LXC session: ${sessionId}`);
    }

    lxcProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to LXC session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const lxcProcess = this.lxcProcesses.get(sessionId);
      if (lxcProcess) {
        // Try graceful shutdown first
        lxcProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (lxcProcess && !lxcProcess.killed) {
            lxcProcess.kill('SIGKILL');
          }
        }, 10000);

        this.lxcProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`LXC session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing LXC session ${sessionId}:`, error);
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

    if (!this.lxcAvailable) {
      throw new Error(
        'LXC is not available. Ensure LXC is installed and properly configured'
      );
    }

    const lxcOptions = options as LXCConnectionOptions;

    // Validate required LXC parameters
    if (!lxcOptions.containerName) {
      throw new Error('Container name is required for LXC protocol');
    }

    try {
      // Create container if it doesn't exist
      await this.ensureContainer(lxcOptions);

      // Start container if not running
      await this.startContainer(lxcOptions.containerName);

      // Build LXC command
      const lxcCommand = this.buildLXCCommand(lxcOptions);

      // Spawn LXC process
      const lxcProcess = spawn(lxcCommand[0], lxcCommand.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...this.buildEnvironment(lxcOptions),
          ...options.env,
        },
      });

      // Set up output handling
      lxcProcess.stdout?.on('data', (data) => {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data: stripAnsi(data.toString()),
          timestamp: new Date(),
        };
        this.addToOutputBuffer(sessionId, output);
      });

      lxcProcess.stderr?.on('data', (data) => {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: stripAnsi(data.toString()),
          timestamp: new Date(),
        };
        this.addToOutputBuffer(sessionId, output);
      });

      lxcProcess.on('error', (error) => {
        this.logger.error(`LXC process error for session ${sessionId}:`, error);
        this.emit('session-error', { sessionId, error });
      });

      lxcProcess.on('close', (code) => {
        this.logger.info(
          `LXC process closed for session ${sessionId} with code ${code}`
        );
        this.markSessionComplete(sessionId, code || 0);
      });

      // Store the process
      this.lxcProcesses.set(sessionId, lxcProcess);

      // Create session object
      const session: ConsoleSession = {
        id: sessionId,
        command: lxcCommand[0],
        args: lxcCommand.slice(1),
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...this.buildEnvironment(lxcOptions),
          ...options.env,
        },
        createdAt: new Date(),
        lastActivity: new Date(),
        status: 'running',
        type: this.type,
        streaming: options.streaming,
        executionState: 'idle',
        activeCommands: new Map(),
        pid: lxcProcess.pid,
      };

      this.sessions.set(sessionId, session);

      this.logger.info(
        `LXC session ${sessionId} created for container ${lxcOptions.containerName}`
      );
      this.emit('session-created', { sessionId, type: 'lxc', session });

      return session;
    } catch (error) {
      this.logger.error('Failed to create LXC session', {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
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
      isOneShot: false, // LXC sessions are typically persistent
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
      `Error in LXC session ${context.sessionId}: ${error.message}`
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
    const lxcProcess = this.lxcProcesses.get(sessionId);
    return (lxcProcess && !lxcProcess.killed) || false;
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
        connectionsActive: this.lxcProcesses.size,
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
      await this.checkLXCAvailability();
      return {
        ...baseStatus,
        dependencies: {
          lxc: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `LXC not available: ${error}`],
        dependencies: {
          lxc: { available: false },
        },
      };
    }
  }

  private buildLXCCommand(options: LXCConnectionOptions): string[] {
    const command = [];

    // LXC attach command
    command.push('sudo', 'lxc-attach');

    // Container name
    command.push('-n', options.containerName);

    // User
    if (options.user) {
      command.push('--user', options.user);
    }

    // Group
    if (options.group) {
      command.push('--group', options.group);
    }

    // Capabilities
    if (options.capabilities) {
      options.capabilities.forEach((cap) => {
        command.push('--keep-capability', cap);
      });
    }

    // Environment handling
    if (options.clearEnv) {
      command.push('--clear-env');
    }

    if (options.keepEnv) {
      options.keepEnv.forEach((env) => {
        command.push('--keep-env', env);
      });
    }

    // Namespace options
    if (options.unshareNetwork) {
      command.push('--unshare-net');
    }

    if (options.unshareIPC) {
      command.push('--unshare-ipc');
    }

    if (options.unsharePID) {
      command.push('--unshare-pid');
    }

    if (options.unshareUTS) {
      command.push('--unshare-uts');
    }

    if (options.unshareUser) {
      command.push('--unshare-user');
    }

    // Remount sys/proc
    if (options.remountSysProc) {
      command.push('--remount-sys-proc');
    }

    // Elevated privileges
    if (options.elevatedPrivileges) {
      command.push('--elevated-privileges');
    }

    // Environment variables
    if (options.environment) {
      Object.entries(options.environment).forEach(([key, value]) => {
        command.push('--set-var', `${key}=${value}`);
      });
    }

    // Working directory
    if (options.workingDir) {
      command.push('--cwd', options.workingDir);
    }

    // Command separator
    command.push('--');

    // Command and arguments
    if (options.command) {
      command.push(options.command);
    } else if (options.lxcCommand && options.lxcCommand.length > 0) {
      command.push(...options.lxcCommand);
    } else {
      command.push('/bin/bash');
    }

    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: LXCConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // LXC environment variables
    if (options.containerName) {
      env.LXC_CONTAINER_NAME = options.containerName;
    }

    if (options.template) {
      env.LXC_TEMPLATE = options.template;
    }

    // Resource limits
    if (options.memoryLimit) {
      env.LXC_MEMORY_LIMIT = options.memoryLimit;
    }

    if (options.cpuLimit) {
      env.LXC_CPU_LIMIT = options.cpuLimit;
    }

    // Security profiles
    if (options.enableAppArmor && options.apparmorProfile) {
      env.LXC_APPARMOR_PROFILE = options.apparmorProfile;
    }

    if (options.enableSeccomp && options.seccompProfile) {
      env.LXC_SECCOMP_PROFILE = options.seccompProfile;
    }

    if (options.enableSELinux && options.selinuxContext) {
      env.LXC_SELINUX_CONTEXT = options.selinuxContext;
    }

    // Logging
    if (options.enableLogging) {
      env.LXC_LOGGING_ENABLED = '1';
      if (options.logLevel) env.LXC_LOG_LEVEL = options.logLevel;
      if (options.logFile) env.LXC_LOG_FILE = options.logFile;
    }

    // CGroups
    if (options.enableCgroups && options.cgroupPath) {
      env.LXC_CGROUP_PATH = options.cgroupPath;
    }

    // Snapshots
    if (options.enableSnapshots && options.snapshotName) {
      env.LXC_SNAPSHOT_NAME = options.snapshotName;
    }

    // Cloning
    if (options.enableCloning && options.cloneSource) {
      env.LXC_CLONE_SOURCE = options.cloneSource;
    }

    // Migration
    if (options.enableMigration && options.migrationTarget) {
      env.LXC_MIGRATION_TARGET = options.migrationTarget;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  private async ensureContainer(options: LXCConnectionOptions): Promise<void> {
    // Check if container exists
    const exists = await this.containerExists(options.containerName);

    if (!exists) {
      await this.createContainer(options);
    }
  }

  private async containerExists(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const lxcProcess = spawn('lxc-info', ['-n', containerName], {
        stdio: 'pipe',
      });

      lxcProcess.on('exit', (code) => {
        resolve(code === 0);
      });

      lxcProcess.on('error', () => {
        resolve(false);
      });
    });
  }

  private async createContainer(options: LXCConnectionOptions): Promise<void> {
    const lxcArgs = ['lxc-create', '-n', options.containerName];

    if (options.template) {
      lxcArgs.push('-t', options.template);
    }

    // Add configuration options
    if (options.config) {
      for (const [key, value] of Object.entries(options.config)) {
        lxcArgs.push('--', `--${key}=${value}`);
      }
    }

    return new Promise((resolve, reject) => {
      const createProcess = spawn('sudo', lxcArgs, { stdio: 'pipe' });

      let stderr = '';
      createProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      createProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to create LXC container: ${stderr}`));
        }
      });

      createProcess.on('error', (error) => {
        reject(new Error(`Container creation failed: ${error.message}`));
      });
    });
  }

  private async startContainer(containerName: string): Promise<void> {
    // Check if container is already running
    const isRunning = await this.isContainerRunning(containerName);
    if (isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      const startProcess = spawn(
        'sudo',
        ['lxc-start', '-n', containerName, '-d'],
        { stdio: 'pipe' }
      );

      let stderr = '';
      startProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      startProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to start LXC container: ${stderr}`));
        }
      });

      startProcess.on('error', (error) => {
        reject(new Error(`Container start failed: ${error.message}`));
      });
    });
  }

  private async isContainerRunning(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const infoProcess = spawn('lxc-info', ['-n', containerName, '-s'], {
        stdio: 'pipe',
      });

      let stdout = '';
      infoProcess.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      infoProcess.on('exit', () => {
        resolve(stdout.includes('RUNNING'));
      });

      infoProcess.on('error', () => {
        resolve(false);
      });
    });
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up LXC protocol');

    // Close all LXC processes
    for (const [sessionId, process] of Array.from(this.lxcProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing LXC process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.lxcProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default LXCProtocol;
