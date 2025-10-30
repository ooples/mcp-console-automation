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

// Ruby Protocol connection options
interface RubyConnectionOptions extends SessionOptions {
  rubyPath?: string;
  rubyVersion?: string;
  scriptFile?: string;
  gemfile?: string;
  bundleExec?: boolean;
  interactive?: boolean;
  irb?: boolean;
  rubyFlags?: string[];
  gemSet?: string;
  rvmUse?: string;
  rbenvVersion?: string;
  environment?: Record<string, string>;
  enableDebug?: boolean;
  debugPort?: number;
  enableProfiling?: boolean;
  railsApp?: boolean;
  railsEnv?: string;
  rakeTask?: string;
}

/**
 * Ruby Protocol Implementation
 *
 * Provides Ruby interpreter console access through ruby command
 * Supports IRB, script execution, Bundler, Rails, RVM, rbenv, debugging, and profiling
 */
export class RubyProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'ruby';
  public readonly capabilities: ProtocolCapabilities;

  private rubyProcesses = new Map<string, ChildProcess>();

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
    super('ruby');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
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
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
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
      // Check if Ruby is available
      await this.checkRubyAvailability();
      this.isInitialized = true;
      this.logger.info('Ruby protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Ruby protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `ruby-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const rubyProcess = this.rubyProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!rubyProcess || !rubyProcess.stdin || !session) {
      throw new Error(`No active Ruby session: ${sessionId}`);
    }

    rubyProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to Ruby session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const rubyProcess = this.rubyProcesses.get(sessionId);
      if (rubyProcess) {
        // Try graceful shutdown first
        rubyProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (rubyProcess && !rubyProcess.killed) {
            rubyProcess.kill('SIGKILL');
          }
        }, 5000);

        this.rubyProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Ruby session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Ruby session ${sessionId}:`, error);
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

    const rubyOptions = options as RubyConnectionOptions;

    // Build Ruby command
    const rubyCommand = this.buildRubyCommand(rubyOptions);

    // Spawn Ruby process
    const rubyProcess = spawn(rubyCommand[0], rubyCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(rubyOptions),
        ...options.env,
      },
    });

    // Set up output handling
    rubyProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    rubyProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    rubyProcess.on('error', (error) => {
      this.logger.error(`Ruby process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    rubyProcess.on('close', (code) => {
      this.logger.info(
        `Ruby process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.rubyProcesses.set(sessionId, rubyProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: rubyCommand[0],
      args: rubyCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(rubyOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: rubyProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `Ruby session ${sessionId} created for ${rubyOptions.scriptFile || rubyOptions.rakeTask || rubyOptions.irb ? 'IRB' : 'Ruby application'}`
    );
    this.emit('session-created', { sessionId, type: 'ruby', session });

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
      isOneShot: false, // Ruby sessions are typically persistent
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
      `Error in Ruby session ${context.sessionId}: ${error.message}`
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
    const rubyProcess = this.rubyProcesses.get(sessionId);
    return (rubyProcess && !rubyProcess.killed) || false;
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
        connectionsActive: this.rubyProcesses.size,
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
      await this.checkRubyAvailability();
      return {
        ...baseStatus,
        dependencies: {
          ruby: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Ruby not available: ${error}`],
        dependencies: {
          ruby: { available: false },
        },
      };
    }
  }

  private async checkRubyAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ruby', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Ruby interpreter not found. Please install Ruby.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Ruby interpreter not found. Please install Ruby.'));
      });
    });
  }

  private buildRubyCommand(options: RubyConnectionOptions): string[] {
    const command = [];

    // Handle RVM environment
    if (options.rvmUse) {
      command.push('rvm', options.rvmUse, 'do');
    }

    // Handle rbenv environment
    if (options.rbenvVersion) {
      command.push('rbenv', 'exec');
    }

    // Bundle exec wrapper
    if (options.bundleExec && options.gemfile) {
      command.push('bundle', 'exec');
    }

    // Ruby executable
    if (options.rubyPath) {
      command.push(options.rubyPath);
    } else if (options.rubyVersion) {
      command.push(`ruby-${options.rubyVersion}`);
    } else {
      command.push('ruby');
    }

    // Ruby flags
    if (options.rubyFlags) {
      command.push(...options.rubyFlags);
    }

    // Debug options
    if (options.enableDebug && options.debugPort) {
      command.push(
        '-rdebug-ide',
        `--host`,
        '0.0.0.0',
        `--port`,
        options.debugPort.toString()
      );
    }

    // Profiling
    if (options.enableProfiling) {
      command.push('-rprofile');
    }

    // Rails application
    if (options.railsApp) {
      if (options.railsEnv) {
        command.push('-e', `ENV['RAILS_ENV'] = '${options.railsEnv}'`);
      }
      command.push('-rrails/all');
    }

    // IRB mode
    if (options.irb || options.interactive) {
      command.push('-i');
      // Add IRB if not already a script
      if (!options.scriptFile && !options.rakeTask) {
        const irbIndex = command.indexOf('ruby');
        if (irbIndex !== -1) {
          command[irbIndex] = 'irb';
        }
      }
    }

    // Rake task
    if (options.rakeTask) {
      const rubyIndex = command.indexOf('ruby');
      if (rubyIndex !== -1) {
        command[rubyIndex] = 'rake';
        command.push(options.rakeTask);
      }
    } else if (options.scriptFile) {
      command.push(options.scriptFile);
    } else if (!options.irb && !options.interactive) {
      // Default to IRB if no script specified
      const rubyIndex = command.indexOf('ruby');
      if (rubyIndex !== -1) {
        command[rubyIndex] = 'irb';
      }
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: RubyConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Gemfile path
    if (options.gemfile) {
      env.BUNDLE_GEMFILE = options.gemfile;
    }

    // Gem set
    if (options.gemSet) {
      env.GEM_HOME = options.gemSet;
      env.GEM_PATH = options.gemSet;
    }

    // RVM environment
    if (options.rvmUse) {
      env.rvm_ruby_string = options.rvmUse;
    }

    // rbenv version
    if (options.rbenvVersion) {
      env.RBENV_VERSION = options.rbenvVersion;
    }

    // Rails environment
    if (options.railsEnv) {
      env.RAILS_ENV = options.railsEnv;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    // Ruby path modifications
    if (options.rubyPath) {
      env.RUBY_PATH = options.rubyPath;
    }

    // Profiling
    if (options.enableProfiling) {
      env.RUBY_PROF = '1';
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Ruby protocol');

    // Close all Ruby processes
    for (const [sessionId, process] of Array.from(this.rubyProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing Ruby process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.rubyProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default RubyProtocol;
