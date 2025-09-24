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

// Chef Protocol connection options
interface ChefConnectionOptions {
  chefPath?: string;
  cookbookPath?: string;
  chefRepoPath?: string;
  nodeName?: string;
  runlist?: string[];
  attributes?: Record<string, any>;
  environment?: string;
  configFile?: string;
  clientKey?: string;
  validationKey?: string;
  chefServerUrl?: string;
  clientName?: string;
  validationClientName?: string;
  chefZeroMode?: boolean;
  localMode?: boolean;
  soloMode?: boolean;
  whyRun?: boolean;
  enableReporting?: boolean;
  reportHandler?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  logFile?: string;
  jsonAttributes?: string;
  dataPath?: string;
  sslVerifyMode?: 'none' | 'peer';
  format?: 'doc' | 'min' | 'null';
  color?: boolean;
  enablePolicePattern?: boolean;
  policyName?: string;
  policyGroup?: string;
  enableAuditMode?: boolean;
  auditMode?: boolean;
  enableStreamingOutput?: boolean;
  environment_variables?: Record<string, string>;
  timeout?: number;
  interval?: number;
  splay?: number;
  pidFile?: string;
  enableDaemonMode?: boolean;
  enableOnceMode?: boolean;
  noFork?: boolean;
  user?: string;
  group?: string;
  version?: string;
  serverVersion?: string;
  args?: string[];
}

/**
 * Chef Protocol Implementation
 *
 * Provides Chef configuration management console access through chef-client command
 * Supports cookbook execution, node management, environments, roles, and Chef Server integration
 */
export class ChefProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'chef';
  public readonly capabilities: ProtocolCapabilities;

  private chefProcesses = new Map<string, ChildProcess>();

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
    super('chef');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: true,
      maxConcurrentSessions: 20,
      defaultTimeout: 180000, // Chef runs can take longer
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['key', 'certificate'],
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
      // Check if Chef is available
      await this.checkChefAvailability();
      this.isInitialized = true;
      this.logger.info('Chef protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Chef protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `chef-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const chefProcess = this.chefProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!chefProcess || !chefProcess.stdin || !session) {
      throw new Error(`No active Chef session: ${sessionId}`);
    }

    chefProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Chef session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const chefProcess = this.chefProcesses.get(sessionId);
      if (chefProcess) {
        // Try graceful shutdown first
        chefProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (chefProcess && !chefProcess.killed) {
            chefProcess.kill('SIGKILL');
          }
        }, 10000);

        this.chefProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Chef session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Chef session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const chefOptions = options.chefOptions || {} as ChefConnectionOptions;

    // Build Chef command
    const chefCommand = this.buildChefCommand(chefOptions);

    // Spawn Chef process
    const chefProcess = spawn(chefCommand[0], chefCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || chefOptions.chefRepoPath || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(chefOptions), ...options.env }
    });

    // Set up output handling
    chefProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    chefProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    chefProcess.on('error', (error) => {
      this.logger.error(`Chef process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    chefProcess.on('close', (code) => {
      this.logger.info(`Chef process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.chefProcesses.set(sessionId, chefProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: chefCommand[0],
      args: chefCommand.slice(1),
      cwd: options.cwd || chefOptions.chefRepoPath || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(chefOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: chefProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Chef session ${sessionId} created for ${chefOptions.nodeName || chefOptions.cookbookPath || 'Chef automation'}`);
    this.emit('session-created', { sessionId, type: 'chef', session });

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
      isOneShot: true, // Chef runs are typically one-shot
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Chef session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const chefProcess = this.chefProcesses.get(sessionId);
    return chefProcess && !chefProcess.killed || false;
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
        connectionsActive: this.chefProcesses.size
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
      await this.checkChefAvailability();
      return {
        ...baseStatus,
        dependencies: {
          chef: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Chef not available: ${error}`],
        dependencies: {
          chef: { available: false }
        }
      };
    }
  }

  private async checkChefAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('chef-client', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Chef client not found. Please install Chef.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Chef client not found. Please install Chef.'));
      });
    });
  }

  private buildChefCommand(options: ChefConnectionOptions): string[] {
    const command = [];

    // Chef executable
    if (options.chefPath) {
      command.push(options.chefPath);
    } else {
      command.push('chef-client');
    }

    // Run mode - determine if solo, local, or server mode
    if (options.soloMode) {
      command[0] = 'chef-solo';
    } else if (options.localMode || options.chefZeroMode) {
      command.push('--local-mode');
    }

    // Node name
    if (options.nodeName) {
      command.push('--node-name', options.nodeName);
    }

    // Environment
    if (options.environment) {
      command.push('--environment', options.environment);
    }

    // Run list
    if (options.runlist && options.runlist.length > 0) {
      command.push('--runlist', options.runlist.join(','));
    }

    // Configuration file
    if (options.configFile) {
      command.push('--config', options.configFile);
    }

    // JSON attributes
    if (options.jsonAttributes) {
      command.push('--json-attributes', options.jsonAttributes);
    } else if (options.attributes) {
      // Create temporary JSON file for attributes
      const tempFile = `/tmp/chef-attributes-${Date.now()}.json`;
      require('fs').writeFileSync(tempFile, JSON.stringify(options.attributes));
      command.push('--json-attributes', tempFile);
    }

    // Cookbook path
    if (options.cookbookPath) {
      command.push('--cookbook-path', options.cookbookPath);
    }

    // Why-run mode (dry run)
    if (options.whyRun) {
      command.push('--why-run');
    }

    // Once mode
    if (options.enableOnceMode) {
      command.push('--once');
    }

    // Daemon mode
    if (options.enableDaemonMode) {
      command.push('--daemonize');
    }

    // No fork
    if (options.noFork) {
      command.push('--no-fork');
    }

    // Log level
    if (options.logLevel) {
      command.push('--log_level', options.logLevel);
    }

    // Log file
    if (options.logFile) {
      command.push('--logfile', options.logFile);
    }

    // Format
    if (options.format) {
      command.push('--format', options.format);
    }

    // Color
    if (options.color === false) {
      command.push('--no-color');
    }

    // SSL verify mode
    if (options.sslVerifyMode) {
      command.push('--ssl-verify-mode', options.sslVerifyMode);
    }

    // Interval and splay for daemon mode
    if (options.interval) {
      command.push('--interval', options.interval.toString());
    }

    if (options.splay) {
      command.push('--splay', options.splay.toString());
    }

    // PID file
    if (options.pidFile) {
      command.push('--pid', options.pidFile);
    }

    // User and group
    if (options.user) {
      command.push('--user', options.user);
    }

    if (options.group) {
      command.push('--group', options.group);
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: ChefConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Chef server configuration
    if (options.chefServerUrl) {
      env.CHEF_SERVER_URL = options.chefServerUrl;
    }

    if (options.clientName) {
      env.CHEF_CLIENT_NAME = options.clientName;
    }

    if (options.clientKey) {
      env.CHEF_CLIENT_KEY = options.clientKey;
    }

    if (options.validationKey) {
      env.CHEF_VALIDATION_KEY = options.validationKey;
    }

    if (options.validationClientName) {
      env.CHEF_VALIDATION_CLIENT_NAME = options.validationClientName;
    }

    // Data path
    if (options.dataPath) {
      env.CHEF_DATA_PATH = options.dataPath;
    }

    // Policy settings
    if (options.policyName) {
      env.CHEF_POLICY_NAME = options.policyName;
    }

    if (options.policyGroup) {
      env.CHEF_POLICY_GROUP = options.policyGroup;
    }

    // Audit mode
    if (options.enableAuditMode) {
      env.CHEF_AUDIT_MODE = 'enabled';
    }

    // Custom environment variables
    if (options.environment_variables) {
      Object.assign(env, options.environment_variables);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Chef protocol');

    // Close all Chef processes
    for (const [sessionId, process] of Array.from(this.chefProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Chef process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.chefProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default ChefProtocol;