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

// .NET Protocol connection options
interface DotNetConnectionOptions extends SessionOptions {
  dotnetPath?: string;
  dotnetVersion?: string;
  projectFile?: string;
  solutionFile?: string;
  assemblyPath?: string;
  framework?: string;
  configuration?: 'Debug' | 'Release';
  runtime?: string;
  enableWatch?: boolean;
  enableHotReload?: boolean;
  aspNetCore?: boolean;
  entityFramework?: boolean;
  enableDebug?: boolean;
  debugPort?: number;
  verbosity?: 'quiet' | 'minimal' | 'normal' | 'detailed' | 'diagnostic';
  buildFlags?: string[];
  runFlags?: string[];
  testFlags?: string[];
  environment?: Record<string, string>;
  enableProfiling?: boolean;
  profilingTool?: 'dotnet-trace' | 'dotnet-dump' | 'dotnet-counters';
  enableNuget?: boolean;
  nugetSource?: string[];
  packageRestore?: boolean;
  selfContained?: boolean;
  singleFile?: boolean;
  trimmed?: boolean;
  aot?: boolean;
  dockerize?: boolean;
  dockerImage?: string;
}

/**
 * .NET Protocol Implementation
 *
 * Provides .NET development environment console access through dotnet command
 * Supports building, running, testing, debugging, ASP.NET Core, Entity Framework, and NuGet
 */
export class DotNetProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'dotnet';
  public readonly capabilities: ProtocolCapabilities;

  private dotnetProcesses = new Map<string, ChildProcess>();

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
    super('dotnet');

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
      defaultTimeout: 60000, // .NET builds can take longer
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
      // Check if .NET is available
      await this.checkDotNetAvailability();
      this.isInitialized = true;
      this.logger.info('.NET protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize .NET protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `dotnet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const dotnetProcess = this.dotnetProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!dotnetProcess || !dotnetProcess.stdin || !session) {
      throw new Error(`No active .NET session: ${sessionId}`);
    }

    dotnetProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to .NET session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const dotnetProcess = this.dotnetProcesses.get(sessionId);
      if (dotnetProcess) {
        // Try graceful shutdown first
        dotnetProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (dotnetProcess && !dotnetProcess.killed) {
            dotnetProcess.kill('SIGKILL');
          }
        }, 5000);

        this.dotnetProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`.NET session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing .NET session ${sessionId}:`, error);
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

    const dotnetOptions = options as DotNetConnectionOptions;

    // Build .NET command
    const dotnetCommand = this.buildDotNetCommand(dotnetOptions);

    // Spawn .NET process
    const dotnetProcess = spawn(dotnetCommand[0], dotnetCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(dotnetOptions),
        ...options.env,
      },
    });

    // Set up output handling
    dotnetProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    dotnetProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    dotnetProcess.on('error', (error) => {
      this.logger.error(`.NET process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    dotnetProcess.on('close', (code) => {
      this.logger.info(
        `.NET process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.dotnetProcesses.set(sessionId, dotnetProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: dotnetCommand[0],
      args: dotnetCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(dotnetOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: dotnetProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `.NET session ${sessionId} created for ${dotnetOptions.projectFile || dotnetOptions.solutionFile || dotnetOptions.assemblyPath || '.NET application'}`
    );
    this.emit('session-created', { sessionId, type: 'dotnet', session });

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
      isOneShot: true, // .NET builds are typically one-shot unless running a server
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
      `Error in .NET session ${context.sessionId}: ${error.message}`
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
    const dotnetProcess = this.dotnetProcesses.get(sessionId);
    return (dotnetProcess && !dotnetProcess.killed) || false;
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
        connectionsActive: this.dotnetProcesses.size,
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
      await this.checkDotNetAvailability();
      return {
        ...baseStatus,
        dependencies: {
          dotnet: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `.NET not available: ${error}`],
        dependencies: {
          dotnet: { available: false },
        },
      };
    }
  }

  private async checkDotNetAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('dotnet', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('.NET SDK not found. Please install .NET SDK.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('.NET SDK not found. Please install .NET SDK.'));
      });
    });
  }

  private buildDotNetCommand(options: DotNetConnectionOptions): string[] {
    const command = [];

    // .NET executable
    if (options.dotnetPath) {
      command.push(options.dotnetPath);
    } else {
      command.push('dotnet');
    }

    // Determine the .NET subcommand
    if (options.projectFile || options.solutionFile) {
      // Building/running project or solution
      if (options.enableWatch) {
        command.push('watch');
        command.push('run');
      } else {
        command.push('run');
      }

      // Project/solution file
      if (options.projectFile) {
        command.push('--project', options.projectFile);
      } else if (options.solutionFile) {
        command.push('--', options.solutionFile);
      }

      // Framework
      if (options.framework) {
        command.push('--framework', options.framework);
      }

      // Configuration
      if (options.configuration) {
        command.push('--configuration', options.configuration);
      }

      // Runtime
      if (options.runtime) {
        command.push('--runtime', options.runtime);
      }

      // Self-contained
      if (options.selfContained) {
        command.push('--self-contained');
      }

      // Verbosity
      if (options.verbosity) {
        command.push('--verbosity', options.verbosity);
      }

      // Build flags
      if (options.buildFlags) {
        command.push(...options.buildFlags);
      }
    } else if (options.assemblyPath) {
      // Running compiled assembly directly
      command.push(options.assemblyPath);
    } else {
      // Default to --info if nothing specified
      command.push('--info');
    }

    // Application arguments
    if (options.args) {
      command.push('--');
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: DotNetConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // .NET environment variables
    if (options.dotnetVersion) {
      env.DOTNET_VERSION = options.dotnetVersion;
    }

    // ASP.NET Core settings
    if (options.aspNetCore) {
      env.ASPNETCORE_ENVIRONMENT = env.ASPNETCORE_ENVIRONMENT || 'Development';
      if (options.enableHotReload) {
        env.DOTNET_WATCH_RESTART_ON_RUDE_EDIT = 'true';
      }
    }

    // Entity Framework settings
    if (options.entityFramework) {
      env.ASPNETCORE_ENVIRONMENT = env.ASPNETCORE_ENVIRONMENT || 'Development';
    }

    // Debug settings
    if (options.enableDebug && options.debugPort) {
      env.ASPNETCORE_URLS = `http://localhost:${options.debugPort}`;
    }

    // NuGet settings
    if (options.enableNuget && options.nugetSource) {
      env.NUGET_SOURCES = options.nugetSource.join(';');
    }

    // Runtime settings
    if (options.runtime) {
      env.DOTNET_RUNTIME_IDENTIFIER = options.runtime;
    }

    // Profiling
    if (options.enableProfiling) {
      env.DOTNET_EnableDiagnostics = '1';
      if (options.profilingTool) {
        env.DOTNET_DiagnosticPorts = '/tmp/dotnet-diagnostic.sock';
      }
    }

    // AOT and trimming
    if (options.aot) {
      env.DOTNET_PublishAot = 'true';
    }

    if (options.trimmed) {
      env.DOTNET_PublishTrimmed = 'true';
    }

    if (options.singleFile) {
      env.DOTNET_PublishSingleFile = 'true';
    }

    // Docker settings
    if (options.dockerize && options.dockerImage) {
      env.DOTNET_DOCKER_IMAGE = options.dockerImage;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up .NET protocol');

    // Close all .NET processes
    for (const [sessionId, process] of Array.from(this.dotnetProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing .NET process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.dotnetProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default DotNetProtocol;
