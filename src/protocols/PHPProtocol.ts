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

// PHP Protocol connection options
interface PHPConnectionOptions extends SessionOptions {
  phpPath?: string;
  phpVersion?: string;
  scriptFile?: string;
  interactive?: boolean;
  phpFlags?: string[];
  iniFile?: string;
  iniSettings?: Record<string, string>;
  extensions?: string[];
  includePath?: string[];
  composerPath?: string;
  composerCommand?: string;
  artisanCommand?: string;
  laravelEnv?: string;
  symfonyEnv?: string;
  enableXdebug?: boolean;
  xdebugConfig?: Record<string, string>;
  enableOpcache?: boolean;
  enableProfiler?: boolean;
  profilerOutputDir?: string;
  environment?: Record<string, string>;
  webServerPort?: number;
  enableBuiltinServer?: boolean;
  documentRoot?: string;
  phpFpmConfig?: string;
  memory_limit?: string;
  max_execution_time?: number;
}

/**
 * PHP Protocol Implementation
 *
 * Provides PHP development environment console access through php command
 * Supports scripts, interactive mode, Composer, Laravel, Symfony, Xdebug, and built-in web server
 */
export class PHPProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'php';
  public readonly capabilities: ProtocolCapabilities;

  private phpProcesses = new Map<string, ChildProcess>();

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
    super('php');

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
      maxConcurrentSessions: 25,
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
      // Check if PHP is available
      await this.checkPHPAvailability();
      this.isInitialized = true;
      this.logger.info('PHP protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize PHP protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `php-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const phpProcess = this.phpProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!phpProcess || !phpProcess.stdin || !session) {
      throw new Error(`No active PHP session: ${sessionId}`);
    }

    phpProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to PHP session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const phpProcess = this.phpProcesses.get(sessionId);
      if (phpProcess) {
        // Try graceful shutdown first
        phpProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (phpProcess && !phpProcess.killed) {
            phpProcess.kill('SIGKILL');
          }
        }, 5000);

        this.phpProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`PHP session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing PHP session ${sessionId}:`, error);
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

    const phpOptions = options as PHPConnectionOptions;

    // Build PHP command
    const phpCommand = this.buildPHPCommand(phpOptions);

    // Spawn PHP process
    const phpProcess = spawn(phpCommand[0], phpCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(phpOptions),
        ...options.env,
      },
    });

    // Set up output handling
    phpProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    phpProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    phpProcess.on('error', (error) => {
      this.logger.error(`PHP process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    phpProcess.on('close', (code) => {
      this.logger.info(
        `PHP process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.phpProcesses.set(sessionId, phpProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: phpCommand[0],
      args: phpCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(phpOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: phpProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `PHP session ${sessionId} created for ${phpOptions.scriptFile || phpOptions.artisanCommand || phpOptions.interactive ? 'interactive PHP' : 'PHP application'}`
    );
    this.emit('session-created', { sessionId, type: 'php', session });

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
      isOneShot: false, // PHP sessions can be persistent (especially interactive mode)
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
      `Error in PHP session ${context.sessionId}: ${error.message}`
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
    const phpProcess = this.phpProcesses.get(sessionId);
    return (phpProcess && !phpProcess.killed) || false;
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
        connectionsActive: this.phpProcesses.size,
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
      await this.checkPHPAvailability();
      return {
        ...baseStatus,
        dependencies: {
          php: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `PHP not available: ${error}`],
        dependencies: {
          php: { available: false },
        },
      };
    }
  }

  private async checkPHPAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('php', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('PHP interpreter not found. Please install PHP.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('PHP interpreter not found. Please install PHP.'));
      });
    });
  }

  private buildPHPCommand(options: PHPConnectionOptions): string[] {
    const command = [];

    // Composer command wrapper
    if (options.composerCommand) {
      if (options.composerPath) {
        command.push(options.composerPath);
      } else {
        command.push('composer');
      }
      command.push(options.composerCommand);

      // Add arguments if any
      if (options.args) {
        command.push(...options.args);
      }

      return command;
    }

    // Laravel Artisan command
    if (options.artisanCommand) {
      if (options.phpPath) {
        command.push(options.phpPath);
      } else {
        command.push('php');
      }
      command.push('artisan', options.artisanCommand);

      // Add arguments if any
      if (options.args) {
        command.push(...options.args);
      }

      return command;
    }

    // PHP executable
    if (options.phpPath) {
      command.push(options.phpPath);
    } else if (options.phpVersion) {
      command.push(`php${options.phpVersion}`);
    } else {
      command.push('php');
    }

    // PHP flags
    if (options.phpFlags) {
      command.push(...options.phpFlags);
    }

    // INI file
    if (options.iniFile) {
      command.push('-c', options.iniFile);
    }

    // INI settings
    if (options.iniSettings) {
      for (const [key, value] of Object.entries(options.iniSettings)) {
        command.push('-d', `${key}=${value}`);
      }
    }

    // Memory limit
    if (options.memory_limit) {
      command.push('-d', `memory_limit=${options.memory_limit}`);
    }

    // Execution time
    if (options.max_execution_time) {
      command.push('-d', `max_execution_time=${options.max_execution_time}`);
    }

    // Built-in web server
    if (options.enableBuiltinServer && options.webServerPort) {
      command.push('-S', `localhost:${options.webServerPort}`);
      if (options.documentRoot) {
        command.push('-t', options.documentRoot);
      }
      return command;
    }

    // Interactive mode
    if (options.interactive) {
      command.push('-a');
    }

    // Script file or default to interactive
    if (options.scriptFile) {
      command.push(options.scriptFile);
    } else if (!options.interactive) {
      // Default to interactive if no script specified
      command.push('-a');
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: PHPConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Include path
    if (options.includePath) {
      env.PHP_INCLUDE_PATH = options.includePath.join(':');
    }

    // Xdebug configuration
    if (options.enableXdebug) {
      env.XDEBUG_MODE = 'debug';
      if (options.xdebugConfig) {
        for (const [key, value] of Object.entries(options.xdebugConfig)) {
          env[`XDEBUG_CONFIG`] = env[`XDEBUG_CONFIG`]
            ? `${env[`XDEBUG_CONFIG`]} ${key}=${value}`
            : `${key}=${value}`;
        }
      }
    }

    // OPcache
    if (options.enableOpcache) {
      env.PHP_OPCACHE_ENABLE = '1';
    }

    // Profiler
    if (options.enableProfiler && options.profilerOutputDir) {
      env.XDEBUG_PROFILE_OUTPUT_DIR = options.profilerOutputDir;
      env.XDEBUG_PROFILE = '1';
    }

    // Laravel environment
    if (options.laravelEnv) {
      env.APP_ENV = options.laravelEnv;
    }

    // Symfony environment
    if (options.symfonyEnv) {
      env.SYMFONY_ENV = options.symfonyEnv;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up PHP protocol');

    // Close all PHP processes
    for (const [sessionId, process] of Array.from(this.phpProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing PHP process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.phpProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PHPProtocol;
