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

// SaltStack Protocol connection options
interface SaltStackConnectionOptions extends SessionOptions {
  // Basic Salt Configuration
  operation?: 'call' | 'run' | 'cp' | 'grain' | 'pillar' | 'key' | 'minion' | 'master' | 'syndic' | 'state' | 'mine' | 'event' | 'debug' | 'ssh' | 'cloud' | 'batch' | 'jobs' | 'ret' | 'vault' | 'proxy';

  // Core Commands
  target?: string;
  function?: string;
  module?: string;
  arguments?: string[];

  // State Management
  stateFiles?: string[];
  stateTree?: string;
  stateEnv?: string;
  pillarData?: Record<string, any>;
  pillarFile?: string;
  test?: boolean;
  saltenv?: string;

  // Targeting
  targetType?: 'glob' | 'pcre' | 'list' | 'grain' | 'grain_pcre' | 'pillar' | 'pillar_pcre' | 'nodegroup' | 'range' | 'compound' | 'ipcidr' | 'subnet';
  compound?: boolean;
  batch?: string | number;
  batchSize?: number;

  // Authentication and Security
  masterHost?: string;
  masterPort?: number;
  masterFingerprint?: string;
  authKey?: string;
  authTimeout?: number;

  // Execution Options
  timeout?: number;
  gatherJobTimeout?: number;
  asyncMode?: boolean;
  returnJob?: boolean;
  failHard?: boolean;
  failSomeMinions?: boolean;

  // Output Options
  outputFormat?: 'yaml' | 'json' | 'txt' | 'raw' | 'nested' | 'quiet' | 'pprint' | 'key' | 'overstatestage' | 'highstate' | 'table' | 'newline_values_only';
  outputIndent?: number;
  noColor?: boolean;
  forceColor?: boolean;
  stateOutput?: 'full' | 'terse' | 'mixed' | 'changes' | 'filter';
  stateVerbose?: boolean;

  // Configuration Files
  configDir?: string;
  configFile?: string;
  cacheDir?: string;
  extPillarDir?: string;
  logFile?: string;
  logLevel?: 'all' | 'garbage' | 'trace' | 'debug' | 'profile' | 'info' | 'warning' | 'error' | 'critical' | 'quiet';

  // Minion Management
  minionId?: string;
  showTimeout?: boolean;
  showJid?: boolean;

  // Keys Management
  keyDir?: string;
  keySize?: number;
  keyGenDir?: string;
  enableAutoSigning?: boolean;
  autoSignGrains?: string[];

  // Master Configuration
  worker_processes?: number;
  ret_port?: number;
  publish_port?: number;
  user?: string;
  cachedir?: string;
  sock_dir?: string;

  // File Server
  fileRoots?: Record<string, string[]>;
  gitfs_remotes?: string[];
  gitfs_provider?: 'gitpython' | 'dulwich' | 'pygit2';
  gitfs_branch?: string;

  // Pillar Configuration
  pillarRoots?: Record<string, string[]>;
  pillarCache?: boolean;
  pillarCacheTtl?: number;

  // External Modules
  extension_modules?: string;
  module_dirs?: string[];

  // Event System
  eventPublishPort?: number;
  eventPullPort?: number;
  eventIpcMode?: number;

  // Reactor System
  reactor?: Array<{
    salt: string;
    [key: string]: any;
  }>;

  // Job Cache
  jobCache?: boolean;
  keepJobs?: number;
  jobCacheStoreFunc?: string;

  // Mine Configuration
  mineInterval?: number;
  mineFunctions?: Record<string, any>;

  // Scheduling
  schedule?: Record<string, {
    function: string;
    seconds?: number;
    minutes?: number;
    hours?: number;
    days?: number;
    when?: string;
    cron?: string;
    args?: any[];
    kwargs?: Record<string, any>;
  }>;

  // SSH Configuration (for salt-ssh)
  sshHost?: string;
  sshUser?: string;
  sshPassword?: string;
  sshKeyfile?: string;
  sshPort?: number;
  sshSudo?: boolean;
  sshIdentitiesOnly?: boolean;
  sshConfigFile?: string;

  // Cloud Configuration
  cloudProvider?: string;
  cloudProfile?: string;
  cloudMap?: string;
  cloudConfig?: Record<string, any>;

  // Proxy Minion
  proxyHost?: string;
  proxyModule?: string;
  proxyArgs?: Record<string, any>;

  // Syndic Configuration
  syndicMaster?: string;
  syndicMasterPort?: number;
  syndicLogFile?: string;

  // Multi-Master
  master_type?: 'str' | 'failover' | 'distributed';
  master_alive_interval?: number;
  master_failback?: boolean;
  master_failback_interval?: number;

  // Transport
  transport?: 'zeromq' | 'tcp' | 'raet';
  zmq_filtering?: boolean;
  zmq_monitor?: boolean;

  // Security
  open_mode?: boolean;
  auto_accept?: boolean;
  autosign_timeout?: number;
  rotate_aes_key?: boolean;
  publish_session?: number;
  auth_safemode?: boolean;

  // Performance
  loop_interval?: number;
  sock_pool_size?: number;
  ipc_mode?: number;
  tcp_keepalive?: boolean;
  tcp_keepalive_idle?: number;

  // Engines
  engines?: Array<{
    name: string;
    config: Record<string, any>;
  }>;

  // Beacons
  beacons?: Record<string, any>;

  // RAET Configuration
  raet_port?: number;
  raet_alt_port?: number;
  raet_mutable?: boolean;

  // Logging
  log_fmt_console?: string;
  log_fmt_logfile?: string;
  log_datefmt?: string;
  log_datefmt_console?: string;
  log_datefmt_logfile?: string;

  // Salt Binary Path
  saltBinary?: string;
  saltCallBinary?: string;
  saltKeyBinary?: string;
  saltRunBinary?: string;
  saltCpBinary?: string;
  saltSshBinary?: string;
  saltCloudBinary?: string;
  saltSyndicBinary?: string;
  saltMasterBinary?: string;
  saltMinionBinary?: string;

  // Custom Arguments
  customArgs?: string[];

  // Environment Variables
  environment?: Record<string, string>;
}

/**
 * SaltStack Protocol Implementation
 *
 * Provides SaltStack configuration management and orchestration console access
 * Supports state management, minion targeting, pillar data, grains, mine, events, and enterprise Salt operations
 */
export class SaltStackProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'saltstack';
  public readonly capabilities: ProtocolCapabilities;

  private saltProcesses = new Map<string, ChildProcess>();

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
    super('saltstack');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
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
      maxConcurrentSessions: 100, // Salt can manage many minions
      defaultTimeout: 300000, // Salt operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['key', 'password', 'auto'],
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
      // Check if Salt is available
      await this.checkSaltAvailability();
      this.isInitialized = true;
      this.logger.info('SaltStack protocol initialized with production configuration management features');
    } catch (error: any) {
      this.logger.error('Failed to initialize SaltStack protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `salt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const saltProcess = this.saltProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!saltProcess || !saltProcess.stdin || !session) {
      throw new Error(`No active SaltStack session: ${sessionId}`);
    }

    saltProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to SaltStack session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const saltProcess = this.saltProcesses.get(sessionId);
      if (saltProcess) {
        // Try graceful shutdown first
        saltProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (saltProcess && !saltProcess.killed) {
            saltProcess.kill('SIGKILL');
          }
        }, 10000);

        this.saltProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`SaltStack session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing SaltStack session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const saltOptions = options as SaltStackConnectionOptions;

    // Build Salt command
    const saltCommand = this.buildSaltCommand(saltOptions);

    // Spawn Salt process
    const saltProcess = spawn(saltCommand[0], saltCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(saltOptions), ...options.env }
    });

    // Set up output handling
    saltProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    saltProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    saltProcess.on('error', (error) => {
      this.logger.error(`SaltStack process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    saltProcess.on('close', (code) => {
      this.logger.info(`SaltStack process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.saltProcesses.set(sessionId, saltProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: saltCommand[0],
      args: saltCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(saltOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: saltProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`SaltStack session ${sessionId} created for operation ${saltOptions.operation || 'call'}`);
    this.emit('session-created', { sessionId, type: 'saltstack', session });

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
      isOneShot: true, // Salt commands are typically one-shot
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in SaltStack session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const saltProcess = this.saltProcesses.get(sessionId);
    return saltProcess && !saltProcess.killed || false;
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
        connectionsActive: this.saltProcesses.size
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
      await this.checkSaltAvailability();
      return {
        ...baseStatus,
        dependencies: {
          salt: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `SaltStack not available: ${error}`],
        dependencies: {
          salt: { available: false }
        }
      };
    }
  }

  private async checkSaltAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('salt', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('SaltStack not found. Please install SaltStack.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('SaltStack not found. Please install SaltStack.'));
      });
    });
  }

  private buildSaltCommand(options: SaltStackConnectionOptions): string[] {
    const command = [];

    // Salt binary based on operation
    if (options.saltBinary) {
      command.push(options.saltBinary);
    } else {
      switch (options.operation) {
        case 'call':
          command.push(options.saltCallBinary || 'salt-call');
          break;
        case 'run':
          command.push(options.saltRunBinary || 'salt-run');
          break;
        case 'cp':
          command.push(options.saltCpBinary || 'salt-cp');
          break;
        case 'key':
          command.push(options.saltKeyBinary || 'salt-key');
          break;
        case 'ssh':
          command.push(options.saltSshBinary || 'salt-ssh');
          break;
        case 'cloud':
          command.push(options.saltCloudBinary || 'salt-cloud');
          break;
        case 'syndic':
          command.push(options.saltSyndicBinary || 'salt-syndic');
          break;
        case 'master':
          command.push(options.saltMasterBinary || 'salt-master');
          break;
        case 'minion':
          command.push(options.saltMinionBinary || 'salt-minion');
          break;
        default:
          command.push('salt');
      }
    }

    // Configuration file
    if (options.configFile) {
      command.push('--config-dir', options.configDir || '/etc/salt');
      command.push('--config', options.configFile);
    } else if (options.configDir) {
      command.push('--config-dir', options.configDir);
    }

    // Output format
    if (options.outputFormat) {
      command.push('--out', options.outputFormat);
    }

    if (options.outputIndent) {
      command.push('--out-indent', options.outputIndent.toString());
    }

    if (options.noColor) {
      command.push('--no-color');
    }

    if (options.forceColor) {
      command.push('--force-color');
    }

    // State output
    if (options.stateOutput) {
      command.push('--state-output', options.stateOutput);
    }

    if (options.stateVerbose) {
      command.push('--state-verbose');
    }

    // Logging
    if (options.logLevel) {
      command.push('--log-level', options.logLevel);
    }

    if (options.logFile) {
      command.push('--log-file', options.logFile);
    }

    // Timeout
    if (options.timeout) {
      command.push('--timeout', options.timeout.toString());
    }

    if (options.gatherJobTimeout) {
      command.push('--gather-job-timeout', options.gatherJobTimeout.toString());
    }

    // Execution options
    if (options.asyncMode) {
      command.push('--async');
    }

    if (options.returnJob) {
      command.push('--return');
    }

    if (options.failHard) {
      command.push('--fail-hard');
    }

    if (options.test) {
      command.push('--test');
    }

    // Targeting options
    if (options.targetType && options.targetType !== 'glob') {
      command.push(`--${options.targetType.replace('_', '-')}`);
    }

    if (options.compound) {
      command.push('-C');
    }

    if (options.batch) {
      command.push('--batch', options.batch.toString());
    }

    // SSH specific options
    if (options.operation === 'ssh') {
      if (options.sshUser) {
        command.push('--user', options.sshUser);
      }
      if (options.sshPassword) {
        command.push('--passwd', options.sshPassword);
      }
      if (options.sshKeyfile) {
        command.push('--key-file', options.sshKeyfile);
      }
      if (options.sshPort) {
        command.push('--port', options.sshPort.toString());
      }
      if (options.sshSudo) {
        command.push('--sudo');
      }
    }

    // Operation-specific arguments
    switch (options.operation) {
      case 'call':
        if (options.function) {
          command.push(options.function);
        }
        break;

      case 'run':
        if (options.function) {
          command.push(options.function);
        }
        break;

      case 'key':
        if (options.function) {
          command.push(options.function);
        }
        break;

      case 'state':
        if (options.stateFiles) {
          command.push('state.apply');
          command.push(...options.stateFiles);
        }
        break;

      case 'cloud':
        if (options.cloudProvider && options.cloudProfile) {
          command.push('-p', options.cloudProfile);
        }
        break;

      default:
        // Regular salt command
        if (options.target) {
          command.push(options.target);
        }
        if (options.function) {
          command.push(options.function);
        }
    }

    // Pillar data
    if (options.pillarData) {
      command.push('pillar=\'');
      command.push(JSON.stringify(options.pillarData));
      command.push('\'');
    }

    if (options.pillarFile) {
      command.push('--pillar-file', options.pillarFile);
    }

    // Salt environment
    if (options.saltenv) {
      command.push('saltenv=' + options.saltenv);
    }

    // Function arguments
    if (options.arguments) {
      command.push(...options.arguments);
    }

    // Custom arguments
    if (options.customArgs) {
      command.push(...options.customArgs);
    }

    return command;
  }

  private buildEnvironment(options: SaltStackConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Salt environment variables
    if (options.configDir) {
      env.SALT_CONFIG_DIR = options.configDir;
    }

    if (options.cacheDir) {
      env.SALT_CACHE_DIR = options.cacheDir;
    }

    if (options.logFile) {
      env.SALT_LOG_FILE = options.logFile;
    }

    if (options.logLevel) {
      env.SALT_LOG_LEVEL = options.logLevel;
    }

    if (options.masterHost) {
      env.SALT_MASTER = options.masterHost;
    }

    if (options.minionId) {
      env.SALT_MINION_ID = options.minionId;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up SaltStack protocol');

    // Close all Salt processes
    for (const [sessionId, process] of Array.from(this.saltProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing SaltStack process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.saltProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default SaltStackProtocol;