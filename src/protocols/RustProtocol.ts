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

// Rust Protocol connection options
interface RustConnectionOptions extends SessionOptions {
  rustcPath?: string;
  cargoPath?: string;
  rustupPath?: string;
  toolchain?: string;
  target?: string;
  profile?: 'dev' | 'release' | 'test' | 'bench';
  features?: string[];
  allFeatures?: boolean;
  noDefaultFeatures?: boolean;
  package?: string;
  bin?: string;
  example?: string;
  test?: string;
  bench?: string;
  cargoFlags?: string[];
  rustcFlags?: string[];
  sourceFile?: string;
  cratePath?: string;
  enableBacktrace?: boolean;
  enableDebug?: boolean;
  debugTool?: 'gdb' | 'lldb' | 'rr' | 'valgrind';
  enableProfiling?: boolean;
  profilingTool?: 'perf' | 'valgrind' | 'cargo-profdata';
  environment?: Record<string, string>;
  crossCompile?: boolean;
  linker?: string;
  rustFlags?: string[];
  manifestPath?: string;
  workspaceRoot?: string;
}

/**
 * Rust Protocol Implementation
 *
 * Provides Rust development environment console access through cargo and rustc commands
 * Supports building, running, testing, cross-compilation, debugging, and profiling
 */
export class RustProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'rust';
  public readonly capabilities: ProtocolCapabilities;

  private rustProcesses = new Map<string, ChildProcess>();

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
    super('rust');

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
      maxConcurrentSessions: 30,
      defaultTimeout: 60000, // Rust builds can take longer
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
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
      // Check if Rust/Cargo is available
      await this.checkRustAvailability();
      this.isInitialized = true;
      this.logger.info('Rust protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Rust protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `rust-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const rustProcess = this.rustProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!rustProcess || !rustProcess.stdin || !session) {
      throw new Error(`No active Rust session: ${sessionId}`);
    }

    rustProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Rust session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const rustProcess = this.rustProcesses.get(sessionId);
      if (rustProcess) {
        // Try graceful shutdown first
        rustProcess.kill('SIGTERM');

        // Force kill after timeout (longer for Rust builds)
        setTimeout(() => {
          if (rustProcess && !rustProcess.killed) {
            rustProcess.kill('SIGKILL');
          }
        }, 10000);

        this.rustProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Rust session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Rust session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const rustOptions = options as RustConnectionOptions;

    // Build Rust command
    const rustCommand = this.buildRustCommand(rustOptions);

    // Spawn Rust process
    const rustProcess = spawn(rustCommand[0], rustCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(rustOptions), ...options.env }
    });

    // Set up output handling
    rustProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    rustProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    rustProcess.on('error', (error) => {
      this.logger.error(`Rust process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    rustProcess.on('close', (code) => {
      this.logger.info(`Rust process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.rustProcesses.set(sessionId, rustProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: rustCommand[0],
      args: rustCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(rustOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: rustProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Rust session ${sessionId} created for ${rustOptions.sourceFile || rustOptions.package || rustOptions.cratePath || 'Rust application'}`);
    this.emit('session-created', { sessionId, type: 'rust', session });

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
      isOneShot: true, // Rust builds are typically one-shot unless running a server
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Rust session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const rustProcess = this.rustProcesses.get(sessionId);
    return rustProcess && !rustProcess.killed || false;
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
        connectionsActive: this.rustProcesses.size
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
      await this.checkRustAvailability();
      return {
        ...baseStatus,
        dependencies: {
          rust: { available: true },
          cargo: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Rust not available: ${error}`],
        dependencies: {
          rust: { available: false },
          cargo: { available: false }
        }
      };
    }
  }

  private async checkRustAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check for cargo first since it's the primary tool
      const testProcess = spawn('cargo', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Rust toolchain not found. Please install Rust via rustup.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Rust toolchain not found. Please install Rust via rustup.'));
      });
    });
  }

  private buildRustCommand(options: RustConnectionOptions): string[] {
    const command = [];

    // Debug with external tools
    if (options.enableDebug && options.debugTool) {
      switch (options.debugTool) {
        case 'gdb':
          command.push('gdb', '--args');
          break;
        case 'lldb':
          command.push('lldb', '--');
          break;
        case 'rr':
          command.push('rr', 'record');
          break;
        case 'valgrind':
          command.push('valgrind');
          break;
      }
    }

    // Profiling with external tools
    if (options.enableProfiling && options.profilingTool) {
      switch (options.profilingTool) {
        case 'perf':
          command.push('perf', 'record', '--call-graph=dwarf');
          break;
        case 'valgrind':
          command.push('valgrind', '--tool=callgrind');
          break;
      }
    }

    // Primary command: cargo vs rustc
    if (options.sourceFile && !options.cratePath) {
      // Direct rustc compilation
      if (options.rustcPath) {
        command.push(options.rustcPath);
      } else {
        command.push('rustc');
      }

      // Rustc flags
      if (options.rustcFlags) {
        command.push(...options.rustcFlags);
      }

      // Target specification
      if (options.target) {
        command.push('--target', options.target);
      }

      // Source file
      command.push(options.sourceFile);

    } else {
      // Cargo-based project
      if (options.cargoPath) {
        command.push(options.cargoPath);
      } else {
        command.push('cargo');
      }

      // Determine cargo subcommand
      if (options.test) {
        command.push('test');
        if (options.test !== 'all') {
          command.push(options.test);
        }
      } else if (options.bench) {
        command.push('bench');
        if (options.bench !== 'all') {
          command.push(options.bench);
        }
      } else if (options.example) {
        command.push('run', '--example', options.example);
      } else if (options.bin) {
        command.push('run', '--bin', options.bin);
      } else {
        command.push('run');
      }

      // Build profile
      if (options.profile && options.profile !== 'dev') {
        command.push('--profile', options.profile);
      }

      // Release build
      if (options.profile === 'release') {
        command.push('--release');
      }

      // Package selection
      if (options.package) {
        command.push('--package', options.package);
      }

      // Manifest path
      if (options.manifestPath) {
        command.push('--manifest-path', options.manifestPath);
      }

      // Target specification
      if (options.target) {
        command.push('--target', options.target);
      }

      // Features
      if (options.allFeatures) {
        command.push('--all-features');
      } else if (options.noDefaultFeatures) {
        command.push('--no-default-features');
      } else if (options.features && options.features.length > 0) {
        command.push('--features', options.features.join(','));
      }

      // Cargo flags
      if (options.cargoFlags) {
        command.push(...options.cargoFlags);
      }
    }

    // Application arguments
    if (options.args) {
      command.push('--');
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: RustConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Rust toolchain selection
    if (options.toolchain) {
      env.RUSTUP_TOOLCHAIN = options.toolchain;
    }

    // Cross-compilation target
    if (options.target) {
      env.CARGO_BUILD_TARGET = options.target;
    }

    // Custom linker
    if (options.linker) {
      env.CARGO_TARGET_LINKER = options.linker;
    }

    // Rust flags
    if (options.rustFlags) {
      env.RUSTFLAGS = options.rustFlags.join(' ');
    }

    // Backtrace settings
    if (options.enableBacktrace) {
      env.RUST_BACKTRACE = '1';
    }

    // Debug settings
    if (options.enableDebug) {
      env.RUST_LOG = 'debug';
    }

    // Profiling
    if (options.enableProfiling) {
      env.CARGO_PROFILE_RELEASE_DEBUG = 'true';
    }

    // Workspace root
    if (options.workspaceRoot) {
      env.CARGO_WORKSPACE_DIR = options.workspaceRoot;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Rust protocol');

    // Close all Rust processes
    for (const [sessionId, process] of Array.from(this.rustProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Rust process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.rustProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default RustProtocol;