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

// Containerd Protocol connection options
interface ContainerdConnectionOptions extends SessionOptions {
  namespace?: string;
  image: string;
  containerName?: string;
  containerdPath?: string;
  runtime?: string;
  network?: string;
  volumes?: string[];
  removeOnExit?: boolean;
  workingDir?: string;
  user?: string;
  platform?: string;
  pullPolicy?: 'always' | 'missing' | 'never';
  enableTTY?: boolean;
  enableStdin?: boolean;
  detach?: boolean;
  cpus?: string;
  memory?: string;
  cpuShares?: number;
  memoryLimit?: string;
  memorySwap?: string;
  securityOpt?: string[];
  privileged?: boolean;
  readOnly?: boolean;
  ulimits?: Record<string, number>;
  sysctl?: Record<string, string>;
  devices?: string[];
  tmpfs?: string[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  hooks?: string[];
  mounts?: string[];
  logDriver?: string;
  logOpts?: Record<string, string>;
  enableNetworkHost?: boolean;
  enablePidHost?: boolean;
  enableIpcHost?: boolean;
  enableUtsHost?: boolean;
  enableUserNs?: boolean;
  environment?: Record<string, string>;
}

/**
 * Containerd Protocol Implementation
 *
 * Provides Containerd container runtime console access through ctr command
 * Supports container lifecycle management, execution, streaming, and enterprise container orchestration
 */
export class ContainerdProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'containerd';
  public readonly capabilities: ProtocolCapabilities;

  private containerdProcesses = new Map<string, ChildProcess>();

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
    super('containerd');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: false,
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
      maxConcurrentSessions: 100, // Containerd can handle many containers
      defaultTimeout: 60000, // Container operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['registry'],
      platformSupport: {
        windows: true, // Windows containers
        linux: true,
        macos: false, // MacOS uses Docker Desktop
        freebsd: false,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Containerd tools are available
      await this.checkContainerdAvailability();
      this.isInitialized = true;
      this.logger.info(
        'Containerd protocol initialized with production features'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize Containerd protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `containerd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const containerdProcess = this.containerdProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!containerdProcess || !containerdProcess.stdin || !session) {
      throw new Error(`No active Containerd session: ${sessionId}`);
    }

    containerdProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to Containerd session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const containerdProcess = this.containerdProcesses.get(sessionId);
      if (containerdProcess) {
        // Try graceful shutdown first
        containerdProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (containerdProcess && !containerdProcess.killed) {
            containerdProcess.kill('SIGKILL');
          }
        }, 10000);

        this.containerdProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Containerd session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(
        `Error closing Containerd session ${sessionId}:`,
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

    const containerdOptions = options as ContainerdConnectionOptions;

    // Validate required container parameters
    if (!containerdOptions.image) {
      throw new Error('Container image is required for Containerd protocol');
    }

    // Build Containerd command
    const containerdCommand = this.buildContainerdCommand(containerdOptions);

    // Spawn Containerd process
    const containerdProcess = spawn(
      containerdCommand[0],
      containerdCommand.slice(1),
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...this.buildEnvironment(containerdOptions),
          ...options.env,
        },
      }
    );

    // Set up output handling
    containerdProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    containerdProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    containerdProcess.on('error', (error) => {
      this.logger.error(
        `Containerd process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    containerdProcess.on('close', (code) => {
      this.logger.info(
        `Containerd process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.containerdProcesses.set(sessionId, containerdProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: containerdCommand[0],
      args: containerdCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(containerdOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: containerdProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `Containerd session ${sessionId} created for image ${containerdOptions.image}`
    );
    this.emit('session-created', { sessionId, type: 'containerd', session });

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
      isOneShot: false, // Container sessions are typically persistent
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
      `Error in Containerd session ${context.sessionId}: ${error.message}`
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
    const containerdProcess = this.containerdProcesses.get(sessionId);
    return (containerdProcess && !containerdProcess.killed) || false;
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
        connectionsActive: this.containerdProcesses.size,
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
      await this.checkContainerdAvailability();
      return {
        ...baseStatus,
        dependencies: {
          containerd: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Containerd not available: ${error}`],
        dependencies: {
          containerd: { available: false },
        },
      };
    }
  }

  private async checkContainerdAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ctr', ['version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              'Containerd ctr tool not found. Please install containerd.'
            )
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error('Containerd ctr tool not found. Please install containerd.')
        );
      });
    });
  }

  private buildContainerdCommand(
    options: ContainerdConnectionOptions
  ): string[] {
    const command = [];

    // Containerd executable
    if (options.containerdPath) {
      command.push(options.containerdPath);
    } else {
      command.push('ctr');
    }

    // Namespace
    if (options.namespace) {
      command.push('--namespace', options.namespace);
    }

    // Container operation based on configuration
    if (options.detach === false) {
      // Interactive container run
      command.push('run', '--rm');

      if (options.enableTTY !== false) {
        command.push('-t');
      }

      if (options.enableStdin !== false) {
        command.push('-i');
      }
    } else {
      // Create and start container
      command.push('container', 'create');
    }

    // Runtime
    if (options.runtime) {
      command.push('--runtime', options.runtime);
    }

    // Working directory
    if (options.workingDir) {
      command.push('--cwd', options.workingDir);
    }

    // User
    if (options.user) {
      command.push('--user', options.user);
    }

    // Platform
    if (options.platform) {
      command.push('--platform', options.platform);
    }

    // Environment variables
    if (options.environment) {
      Object.entries(options.environment).forEach(([key, value]) => {
        command.push('--env', `${key}=${value}`);
      });
    }

    // Security options
    if (options.privileged) {
      command.push('--privileged');
    }

    if (options.readOnly) {
      command.push('--read-only');
    }

    if (options.securityOpt) {
      options.securityOpt.forEach((opt) => {
        command.push('--security-opt', opt);
      });
    }

    // Resource limits
    if (options.cpus) {
      command.push('--cpus', options.cpus);
    }

    if (options.memory) {
      command.push('--memory', options.memory);
    }

    // Network
    if (options.network) {
      command.push('--net', options.network);
    }

    if (options.enableNetworkHost) {
      command.push('--net', 'host');
    }

    // Host namespace options
    if (options.enablePidHost) {
      command.push('--pid', 'host');
    }

    if (options.enableIpcHost) {
      command.push('--ipc', 'host');
    }

    if (options.enableUtsHost) {
      command.push('--uts', 'host');
    }

    // Volumes and mounts
    if (options.volumes) {
      options.volumes.forEach((volume) => {
        command.push('--volume', volume);
      });
    }

    if (options.mounts) {
      options.mounts.forEach((mount) => {
        command.push('--mount', mount);
      });
    }

    // Devices
    if (options.devices) {
      options.devices.forEach((device) => {
        command.push('--device', device);
      });
    }

    // Tmpfs
    if (options.tmpfs) {
      options.tmpfs.forEach((tmpfs) => {
        command.push('--tmpfs', tmpfs);
      });
    }

    // Labels
    if (options.labels) {
      Object.entries(options.labels).forEach(([key, value]) => {
        command.push('--label', `${key}=${value}`);
      });
    }

    // Container image
    command.push(options.image);

    // Container name
    if (options.containerName) {
      command.push(options.containerName);
    } else {
      command.push(`containerd-session-${Date.now()}`);
    }

    // Command and arguments
    if (options.command) {
      command.push(options.command);
    }

    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: ContainerdConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Containerd environment variables
    if (options.namespace) {
      env.CONTAINERD_NAMESPACE = options.namespace;
    }

    // Runtime settings
    if (options.runtime) {
      env.CONTAINERD_RUNTIME = options.runtime;
    }

    // Logging
    if (options.logDriver) {
      env.CONTAINERD_LOG_DRIVER = options.logDriver;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Containerd protocol');

    // Close all Containerd processes
    for (const [sessionId, process] of Array.from(this.containerdProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing Containerd process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.containerdProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default ContainerdProtocol;
