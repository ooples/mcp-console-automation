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
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';

// Podman Protocol connection options
interface PodmanConnectionOptions extends SessionOptions {
  image: string;
  containerName?: string;
  operation?:
    | 'run'
    | 'exec'
    | 'logs'
    | 'inspect'
    | 'build'
    | 'push'
    | 'pull'
    | 'ps'
    | 'stop'
    | 'start'
    | 'restart'
    | 'kill'
    | 'rm'
    | 'rmi'
    | 'pod'
    | 'volume'
    | 'network'
    | 'system';
  workingDir?: string;
  volumes?: string[];
  ports?: string[];
  network?: string;
  pod?: string;
  user?: string;
  group?: string;
  privileged?: boolean;
  capabilities?: string[];
  securityOpt?: string[];
  removeOnExit?: boolean;
  detach?: boolean;
  interactive?: boolean;
  tty?: boolean;
  readOnly?: boolean;
  tmpfs?: string[];
  shmSize?: string;
  ulimits?: string[];
  memory?: string;
  memorySwap?: string;
  memoryReservation?: string;
  kernelMemory?: string;
  cpus?: string;
  cpuShares?: number;
  cpuQuota?: number;
  cpuPeriod?: number;
  cpusetCpus?: string;
  cpusetMems?: string;
  blkioWeight?: number;
  blkioWeightDevice?: string[];
  deviceReadBps?: string[];
  deviceWriteBps?: string[];
  deviceReadIops?: string[];
  deviceWriteIops?: string[];
  devices?: string[];
  dns?: string[];
  dnsSearch?: string[];
  dnsOptions?: string[];
  hostname?: string;
  domainname?: string;
  macAddress?: string;
  ip?: string;
  ip6?: string;
  linkLocalIPs?: string[];
  publishAll?: boolean;
  expose?: string[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  restart?: 'no' | 'on-failure' | 'always' | 'unless-stopped';
  restartRetries?: number;
  healthCmd?: string[];
  healthInterval?: string;
  healthTimeout?: string;
  healthStartPeriod?: string;
  healthRetries?: number;
  noHealthcheck?: boolean;
  init?: boolean;
  initPath?: string;
  systemd?: boolean;
  cidfile?: string;
  conmonPidfile?: string;
  entrypoint?: string[];
  stopSignal?: string;
  stopTimeout?: number;
  oomKillDisable?: boolean;
  oomScoreAdj?: number;
  pidsLimit?: number;
  userns?: string;
  usernsUIDMap?: string[];
  usernsGIDMap?: string[];
  uidmap?: string[];
  gidmap?: string[];
  subuidname?: string;
  subgidname?: string;
  cgroupns?: string;
  cgroupParent?: string;
  cgroupConf?: string[];
  hooks?: string[];
  secrets?: string[];
  mounts?: string[];
  imageVolume?: 'bind' | 'tmpfs' | 'ignore';
  log?: string;
  logOpt?: Record<string, string>;
  logDriver?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'panic';
  sysctl?: Record<string, string>;
  tz?: string;
  umask?: string;
  unsetenv?: string[];
  unsetenvAll?: boolean;
  variant?: string;
  workdir?: string;
  rootfs?: boolean;
  pull?: 'always' | 'missing' | 'never';
  quietPull?: boolean;
  signaturePolicy?: string;
  tlsVerify?: boolean;
  authfile?: string;
  certDir?: string;
  creds?: string;
  platform?: string;
  os?: string;
  arch?: string;
  decryptionKey?: string[];
  runtime?: string;
  runtimeFlag?: string[];
  sdnotify?: string;
  generateSystemd?: boolean;
  systemdScope?: boolean;
  replace?: boolean;
  gpus?: string;
  preserveFds?: number;
  external?: boolean;
  infra?: boolean;
  infraImage?: string;
  infraCommand?: string[];
  infraName?: string;
  podIDFile?: string;
  shareParent?: boolean;
  shareNet?: boolean;
  shareIpc?: boolean;
  sharePid?: boolean;
  shareUts?: boolean;
  shareCgroup?: boolean;
  usePodCgroup?: boolean;
  exitPolicy?: 'continue' | 'stop';
  podmanPath?: string;
  registriesConf?: string;
  registriesConfDir?: string;
  shortNameMode?: 'enforcing' | 'permissive' | 'disabled';
  storageDriver?: string;
  storageOpt?: string[];
  modulesLoadDir?: string;
  ociRuntime?: string;
  ociRuntimeFlag?: string[];
  hooksDir?: string[];
  namespace?: string;
  maxLogSize?: string;
  maxLogFiles?: number;
  enableFuse?: boolean;
  enableUserns?: boolean;
  enableCgroupsV2?: boolean;
  enableSeccomp?: boolean;
  enableApparmor?: boolean;
  enableSelinux?: boolean;
  enableLabelNesting?: boolean;
  enableRootless?: boolean;
  remoteConfigPath?: string;
  remoteSocket?: string;
  remoteIdentity?: string;
  sshPassphrase?: string;
  connection?: string;
  url?: string;
  context?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  compression?: 'gzip' | 'zstd' | 'zlib';
  format?: 'oci' | 'docker';
  sign?: boolean;
  encryptLayer?: number[];
  encryptionKey?: string[];
  squash?: boolean;
  cache?: boolean;
  cacheFrom?: string[];
  cacheTo?: string[];
  target?: string;
  buildArg?: Record<string, string>;
  file?: string;
  ignorefile?: string;
  isolation?: 'oci' | 'rootless' | 'chroot';
  layers?: boolean;
  logRustc?: boolean;
  enableLogging?: boolean;
  timestamp?: boolean;
  environment?: Record<string, string>;
}

/**
 * Podman Protocol Implementation
 *
 * Provides Podman container runtime console access through podman command
 * Supports container lifecycle management, pod orchestration, image operations, and rootless containers
 */
export class PodmanProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'podman';
  public readonly capabilities: ProtocolCapabilities;

  private podmanProcesses = new Map<string, ChildProcess>();
  private containerStates = new Map<string, any>();

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
    super('podman');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: true,
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
      maxConcurrentSessions: 100, // Podman can handle many containers
      defaultTimeout: 60000, // Container operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['registry'],
      platformSupport: {
        windows: false, // Podman is primarily Linux/Unix
        linux: true,
        macos: true,
        freebsd: false,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Podman tools are available
      await this.checkPodmanAvailability();
      this.isInitialized = true;
      this.logger.info('Podman protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Podman protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `podman-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const podmanProcess = this.podmanProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!podmanProcess || !podmanProcess.stdin || !session) {
      throw new Error(`No active Podman session: ${sessionId}`);
    }

    podmanProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to Podman session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const podmanProcess = this.podmanProcesses.get(sessionId);
      if (podmanProcess) {
        // Try graceful shutdown first
        podmanProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (podmanProcess && !podmanProcess.killed) {
            podmanProcess.kill('SIGKILL');
          }
        }, 10000);

        this.podmanProcesses.delete(sessionId);
      }

      // Clean up container state if exists
      const containerState = this.containerStates.get(sessionId);
      if (containerState) {
        this.containerStates.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Podman session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Podman session ${sessionId}:`, error);
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

    const podmanOptions = options as PodmanConnectionOptions;

    // Validate required container parameters
    if (!podmanOptions.image) {
      throw new Error('Container image is required for Podman protocol');
    }

    // Build Podman command
    const podmanCommand = this.buildPodmanCommand(podmanOptions);

    // Spawn Podman process
    const podmanProcess = spawn(podmanCommand[0], podmanCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(podmanOptions),
        ...options.env,
      },
    });

    // Set up output handling
    podmanProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: stripAnsi(data.toString()),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    podmanProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: stripAnsi(data.toString()),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    podmanProcess.on('error', (error) => {
      this.logger.error(
        `Podman process error for session ${sessionId}:`,
        error
      );
      this.emit('session-error', { sessionId, error });
    });

    podmanProcess.on('close', (code) => {
      this.logger.info(
        `Podman process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.podmanProcesses.set(sessionId, podmanProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: podmanCommand[0],
      args: podmanCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(podmanOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: podmanProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `Podman session ${sessionId} created for image ${podmanOptions.image}`
    );
    this.emit('session-created', { sessionId, type: 'podman', session });

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
      `Error in Podman session ${context.sessionId}: ${error.message}`
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
    const podmanProcess = this.podmanProcesses.get(sessionId);
    return (podmanProcess && !podmanProcess.killed) || false;
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
        connectionsActive: this.podmanProcesses.size,
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
      await this.checkPodmanAvailability();
      return {
        ...baseStatus,
        dependencies: {
          podman: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Podman not available: ${error}`],
        dependencies: {
          podman: { available: false },
        },
      };
    }
  }

  private async checkPodmanAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('podman', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Podman not found. Please install podman.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Podman not found. Please install podman.'));
      });
    });
  }

  private buildPodmanCommand(options: PodmanConnectionOptions): string[] {
    const command = [];

    // Podman executable
    if (options.podmanPath) {
      command.push(options.podmanPath);
    } else {
      command.push('podman');
    }

    // Add global options
    if (options.remoteSocket) {
      command.push('--remote');
      command.push('--url', options.remoteSocket);
    }

    if (options.connection) {
      command.push('--connection', options.connection);
    }

    if (options.context) {
      command.push('--context', options.context);
    }

    if (options.logLevel) {
      command.push('--log-level', options.logLevel);
    }

    if (options.namespace) {
      command.push('--namespace', options.namespace);
    }

    // Operation-specific commands
    if (options.operation === 'exec') {
      command.push('exec');

      if (options.interactive !== false) {
        command.push('-i');
      }

      if (options.tty !== false) {
        command.push('-t');
      }

      if (options.workingDir) {
        command.push('-w', options.workingDir);
      }

      if (options.user) {
        command.push('-u', options.user);
      }

      // Environment variables for exec
      if (options.environment) {
        Object.entries(options.environment).forEach(([key, value]) => {
          command.push('-e', `${key}=${value}`);
        });
      }

      // Container name/ID (required for exec)
      command.push(options.containerName || options.image);
    } else if (options.operation === 'logs') {
      command.push('logs');

      if (options.operation) {
        command.push('-f'); // Follow logs
      }

      if (options.timestamp) {
        command.push('-t');
      }

      command.push(options.containerName || options.image);
    } else if (options.operation === 'build') {
      command.push('build');

      if (options.file) {
        command.push('-f', options.file);
      }

      if (options.target) {
        command.push('--target', options.target);
      }

      if (options.buildArg) {
        Object.entries(options.buildArg).forEach(([key, value]) => {
          command.push('--build-arg', `${key}=${value}`);
        });
      }

      if (options.squash) {
        command.push('--squash');
      }

      if (options.layers === false) {
        command.push('--layers=false');
      }

      command.push('-t', options.image);
      command.push(options.cwd || '.');
    } else {
      // Default to 'run' operation
      command.push('run');

      // Interactive/TTY flags
      if (options.interactive !== false) {
        command.push('-i');
      }

      if (options.tty !== false) {
        command.push('-t');
      }

      // Detach mode
      if (options.detach) {
        command.push('-d');
      }

      // Remove on exit
      if (options.removeOnExit !== false) {
        command.push('--rm');
      }

      // Container name
      if (options.containerName) {
        command.push('--name', options.containerName);
      }

      // Working directory
      if (options.workingDir) {
        command.push('-w', options.workingDir);
      }

      // User and group
      if (options.user) {
        command.push('-u', options.user);
      }

      // Privileged mode
      if (options.privileged) {
        command.push('--privileged');
      }

      // Capabilities
      if (options.capabilities) {
        options.capabilities.forEach((cap) => {
          command.push('--cap-add', cap);
        });
      }

      // Security options
      if (options.securityOpt) {
        options.securityOpt.forEach((opt) => {
          command.push('--security-opt', opt);
        });
      }

      // Environment variables
      if (options.environment) {
        Object.entries(options.environment).forEach(([key, value]) => {
          command.push('-e', `${key}=${value}`);
        });
      }

      // Volumes
      if (options.volumes) {
        options.volumes.forEach((volume) => {
          command.push('-v', volume);
        });
      }

      // Port mappings
      if (options.ports) {
        options.ports.forEach((port) => {
          command.push('-p', port);
        });
      }

      // Network
      if (options.network) {
        command.push('--network', options.network);
      }

      // Pod
      if (options.pod) {
        command.push('--pod', options.pod);
      }

      // Memory and CPU limits
      if (options.memory) {
        command.push('-m', options.memory);
      }

      if (options.cpus) {
        command.push('--cpus', options.cpus);
      }

      if (options.cpuShares) {
        command.push('--cpu-shares', options.cpuShares.toString());
      }

      // Devices
      if (options.devices) {
        options.devices.forEach((device) => {
          command.push('--device', device);
        });
      }

      // Labels
      if (options.labels) {
        Object.entries(options.labels).forEach(([key, value]) => {
          command.push('-l', `${key}=${value}`);
        });
      }

      // Restart policy
      if (options.restart) {
        command.push('--restart', options.restart);
      }

      // Health checks
      if (options.healthCmd) {
        command.push('--health-cmd', options.healthCmd.join(' '));
      }

      if (options.healthInterval) {
        command.push('--health-interval', options.healthInterval);
      }

      if (options.noHealthcheck) {
        command.push('--no-healthcheck');
      }

      // Pull policy
      if (options.pull) {
        command.push('--pull', options.pull);
      }

      // Read-only
      if (options.readOnly) {
        command.push('--read-only');
      }

      // Tmpfs
      if (options.tmpfs) {
        options.tmpfs.forEach((tmpfs) => {
          command.push('--tmpfs', tmpfs);
        });
      }

      // Image
      command.push(options.image);
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
    options: PodmanConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Podman environment variables
    if (options.remoteSocket) {
      env.CONTAINER_HOST = options.remoteSocket;
    }

    if (options.connection) {
      env.CONTAINER_CONNECTION = options.connection;
    }

    if (options.sshPassphrase) {
      env.CONTAINER_SSHKEY = options.sshPassphrase;
    }

    // Registry settings
    if (options.registriesConf) {
      env.REGISTRIES_CONFIG_PATH = options.registriesConf;
    }

    if (options.authfile) {
      env.REGISTRY_AUTH_FILE = options.authfile;
    }

    // Storage settings
    if (options.storageDriver) {
      env.STORAGE_DRIVER = options.storageDriver;
    }

    // Runtime settings
    if (options.runtime) {
      env.OCI_RUNTIME = options.runtime;
    }

    // Logging
    if (options.enableLogging && options.logLevel) {
      env.PODMAN_LOG_LEVEL = options.logLevel;
    }

    // Rootless mode
    if (options.enableRootless) {
      env.PODMAN_USERNS = 'keep-id';
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Podman protocol');

    // Close all Podman processes
    for (const [sessionId, process] of Array.from(this.podmanProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing Podman process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.podmanProcesses.clear();
    this.containerStates.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PodmanProtocol;
