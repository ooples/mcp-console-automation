import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { platform } from 'os';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleType,
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
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

/**
 * Local Protocol implementation for native shell access
 * Supports cmd, powershell, bash, zsh, and other local shells
 */
export class LocalProtocol extends BaseProtocol {
  public readonly type: ConsoleType;
  public readonly capabilities: ProtocolCapabilities;

  private localSessions: Map<string, LocalSession> = new Map();

  // Compatibility property for old ProtocolFactory interface
  public get healthStatus(): ProtocolHealthStatus {
    // Return a default health status, real status should be obtained via getHealthStatus()
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

  constructor(type: ConsoleType) {
    super('local');
    this.type = type;

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: false,
      supportsReconnection: false,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 50,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'ascii'],
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
    if (this.isInitialized) {
      return;
    }

    try {
      // Validate shell availability
      await this.validateShellAvailability();

      this.isInitialized = true;
      this.logger.info(`Local protocol initialized for shell: ${this.type}`);
    } catch (error) {
      this.logger.error(`Failed to initialize Local protocol: ${error}`);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    console.error(
      `[DEBUG-HANG] LocalProtocol.createSession called with:`,
      JSON.stringify(
        {
          command: options.command,
          args: options.args,
          cwd: options.cwd,
          consoleType: options.consoleType,
          hasEnv: !!options.env,
          streaming: options.streaming,
          timeout: options.timeout,
          isOneShot: options.isOneShot,
        },
        null,
        2
      )
    );

    const sessionId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    console.error(
      `[DEBUG-HANG] Generated sessionId: ${sessionId}, calling createSessionWithTypeDetection`
    );
    const result = await this.createSessionWithTypeDetection(
      sessionId,
      options
    );
    console.error(
      `[DEBUG-HANG] createSessionWithTypeDetection completed for sessionId: ${sessionId}`
    );
    return result;
  }

  async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    console.error(
      `[DEBUG-HANG] LocalProtocol.doCreateSession called, sessionId: ${sessionId}`
    );

    if (!this.isInitialized) {
      console.error(
        `[DEBUG-HANG] Protocol not initialized, calling initialize()`
      );
      await this.initialize();
    }

    try {
      console.error(
        `[DEBUG-HANG] LocalProtocol received options:`,
        JSON.stringify(options, null, 2)
      );
      const shellInfo = this.getShellInfo(options);
      console.error(
        `[DEBUG-HANG] Got shell info:`,
        JSON.stringify(shellInfo, null, 2)
      );

      const spawnOptions: SpawnOptions = {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      };
      console.error(
        `[DEBUG-HANG] About to spawn process with command: ${shellInfo.command}, args:`,
        shellInfo.args
      );
      console.error(
        `[DEBUG-HANG] Spawn options:`,
        JSON.stringify(
          {
            cwd: spawnOptions.cwd,
            stdio: spawnOptions.stdio,
            shell: spawnOptions.shell,
            hasEnv: !!spawnOptions.env,
          },
          null,
          2
        )
      );

      const childProcess = spawn(
        shellInfo.command,
        shellInfo.args,
        spawnOptions
      );
      console.error(
        `[DEBUG-HANG] Process spawned, PID: ${childProcess.pid}, killed: ${childProcess.killed}`
      );

      const localSession: LocalSession = {
        id: sessionId,
        type: this.type,
        process: childProcess,
        created: new Date(),
        lastActivity: new Date(),
        outputBuffer: '',
        errorBuffer: '',
        isActive: true,
      };

      // Setup process event handlers
      console.error(
        `[DEBUG-HANG] Setting up process handlers for sessionId: ${sessionId}`
      );
      this.setupProcessHandlers(localSession);

      this.localSessions.set(sessionId, localSession);
      console.error(
        `[DEBUG-HANG] LocalSession stored and ConsoleSession created for sessionId: ${sessionId}`
      );

      const consoleSession: ConsoleSession = {
        id: sessionId,
        command: shellInfo.command,
        args: shellInfo.args,
        cwd: options.cwd || process.cwd(),
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...options.env }).filter(
            ([_, value]) => typeof value === 'string'
          )
        ) as Record<string, string>,
        createdAt: new Date(),
        pid: childProcess.pid ?? undefined,
        status: 'running',
        type: this.type,
        streaming: options.streaming ?? false,
        lastActivity: new Date(),
        executionState: 'idle',
        activeCommands: new Map(),
      };

      this.sessions.set(sessionId, consoleSession);

      this.logger.info(
        `Local session ${sessionId} created for shell: ${this.type}`
      );
      console.error(
        `[DEBUG-HANG] About to emit 'session-created' event for sessionId: ${sessionId}`
      );
      this.emit('session-created', {
        sessionId,
        type: this.type,
        session: consoleSession,
      });
      console.error(
        `[DEBUG-HANG] 'session-created' event emitted, returning ConsoleSession for sessionId: ${sessionId}`
      );

      return consoleSession;
    } catch (error) {
      this.logger.error(`Failed to create local session: ${error}`);
      throw error;
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    console.error(
      `[DEBUG-HANG] LocalProtocol.executeCommand called with sessionId: ${sessionId}, command: ${command}, args:`,
      args
    );

    const localSession = this.localSessions.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!localSession || !localSession.isActive || !session) {
      console.error(
        `[DEBUG-HANG] Session ${sessionId} not found or inactive - localSession exists: ${!!localSession}, isActive: ${localSession?.isActive}, session exists: ${!!session}`
      );
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    try {
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      const commandWithNewline = fullCommand + '\n';
      console.error(
        `[DEBUG-HANG] About to write to stdin: "${commandWithNewline}"`
      );

      if (localSession.process.stdin) {
        localSession.process.stdin.write(commandWithNewline);
        console.error(`[DEBUG-HANG] Command written to stdin successfully`);
        localSession.lastActivity = new Date();
        session.lastActivity = new Date();
      } else {
        console.error(`[DEBUG-HANG] ERROR: Session stdin is not available`);
        throw new Error('Session stdin is not available');
      }

      console.error(
        `[DEBUG-HANG] About to emit 'command-executed' event for sessionId: ${sessionId}`
      );
      this.emit('command-executed', {
        sessionId,
        command: fullCommand,
        timestamp: new Date(),
      });
      console.error(
        `[DEBUG-HANG] 'command-executed' event emitted for sessionId: ${sessionId}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to execute command in session ${sessionId}: ${error}`
      );
      throw error;
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const localSession = this.localSessions.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!localSession || !localSession.isActive || !session) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    try {
      if (localSession.process.stdin) {
        localSession.process.stdin.write(input);
        localSession.lastActivity = new Date();
        session.lastActivity = new Date();
      } else {
        throw new Error('Session stdin is not available');
      }

      this.emit('input-sent', {
        sessionId,
        input,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send input to session ${sessionId}: ${error}`
      );
      throw error;
    }
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  // while still providing BaseProtocol functionality
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);

    // Check if caller expects string (old interface) or ConsoleOutput[] (new interface)
    // For now, always return string for compatibility with ProtocolFactory
    return outputs.map((output) => output.data).join('');
  }

  // Separate method for getting structured output
  async getOutputArray(
    sessionId: string,
    since?: Date
  ): Promise<ConsoleOutput[]> {
    return await super.getOutput(sessionId, since);
  }

  // Missing IProtocol methods that BaseProtocol may not implement
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
      isOneShot: false, // Local sessions are persistent by default
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
      `Error in session ${context.sessionId}: ${error.message}`
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
    // Simple recovery - just check if session exists and is active
    const localSession = this.localSessions.get(sessionId);
    return localSession?.isActive || false;
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
        load: [0, 0, 0], // Default load averages
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.localSessions.size,
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

  async closeSession(sessionId: string): Promise<void> {
    const localSession = this.localSessions.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!localSession && !session) {
      return; // Session doesn't exist, nothing to close
    }

    try {
      if (localSession) {
        localSession.isActive = false;

        if (localSession.process && !localSession.process.killed) {
          // Try graceful shutdown first
          localSession.process.kill('SIGTERM');

          // Force kill after timeout
          setTimeout(() => {
            if (localSession.process && !localSession.process.killed) {
              localSession.process.kill('SIGKILL');
            }
          }, 5000);
        }

        this.localSessions.delete(sessionId);
      }

      if (session) {
        this.sessions.delete(sessionId);
      }

      // Session count is managed by BaseProtocol

      // CRITICAL FIX: Emit proper object structure instead of just sessionId string
      this.emit('session-closed', { sessionId, exitCode: 0 }); // Manual closure = success
    } catch (error) {
      this.logger.error(`Failed to close session ${sessionId}: ${error}`);
      throw error;
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    // Add shell-specific health checks
    try {
      await this.validateShellAvailability();
      return {
        ...baseStatus,
        dependencies: {
          shell: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Shell not available: ${error}`],
        dependencies: {
          shell: { available: false },
        },
      };
    }
  }

  async cleanup(): Promise<void> {
    this.logger.info(`Disposing local protocol: ${this.type}`);

    // Close all active sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));

    this.sessions.clear();
    this.localSessions.clear();
    this.removeAllListeners();
    this.isInitialized = false;
  }

  private getShellInfo(options?: SessionOptions): {
    command: string;
    args: string[];
  } {
    switch (this.type) {
      case 'cmd':
        return { command: 'cmd.exe', args: ['/k'] };
      case 'powershell':
        // For one-shot sessions, don't use -NoExit so PowerShell closes after command
        return {
          command: 'powershell.exe',
          args: options?.isOneShot ? ['-NoLogo'] : ['-NoLogo', '-NoExit'],
        };
      case 'pwsh':
        // For one-shot sessions, don't use -NoExit so PowerShell Core closes after command
        return {
          command: 'pwsh',
          args: options?.isOneShot ? ['-NoLogo'] : ['-NoLogo', '-NoExit'],
        };
      case 'bash':
        return { command: 'bash', args: ['--login'] };
      case 'zsh':
        return { command: 'zsh', args: ['-l'] };
      case 'sh':
        return { command: 'sh', args: [] };
      case 'auto':
        return this.getDefaultShell(options);
      default:
        throw new Error(`Unsupported shell type: ${this.type}`);
    }
  }

  private getDefaultShell(options?: SessionOptions): {
    command: string;
    args: string[];
  } {
    switch (platform()) {
      case 'win32':
        // For one-shot sessions, don't use -NoExit so PowerShell closes after command
        return {
          command: 'powershell.exe',
          args: options?.isOneShot ? ['-NoLogo'] : ['-NoLogo', '-NoExit'],
        };
      case 'darwin':
        return { command: 'zsh', args: ['-l'] };
      default:
        return { command: 'bash', args: ['--login'] };
    }
  }

  private async validateShellAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const shellInfo = this.getShellInfo();
      const versionArgs = this.getVersionArgs();

      this.logger.debug(
        `Validating shell: ${shellInfo.command} ${versionArgs.join(' ')}`
      );

      const testProcess = spawn(shellInfo.command, versionArgs, {
        stdio: 'ignore',
        windowsHide: true,
      });

      testProcess.on('close', (code) => {
        this.logger.debug(
          `Shell validation for ${shellInfo.command} exited with code: ${code}`
        );
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Shell ${shellInfo.command} not available (exit code: ${code ?? 'unknown'})`
            )
          );
        }
      });

      testProcess.on('error', (error) => {
        this.logger.error(
          `Shell validation error for ${shellInfo.command}: ${error.message}`
        );
        reject(
          new Error(
            `Shell ${shellInfo.command} not available: ${error.message}`
          )
        );
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        this.logger.warn(`Shell validation timeout for ${shellInfo.command}`);
        testProcess.kill();
        reject(new Error(`Shell validation timeout for ${shellInfo.command}`));
      }, 5000);
    });
  }

  private getVersionArgs(): string[] {
    switch (this.type) {
      case 'cmd':
        return ['/C', 'ver'];
      case 'powershell':
        return ['-Command', '$PSVersionTable.PSVersion.ToString()'];
      case 'pwsh':
        return ['-Command', '$PSVersionTable.PSVersion.ToString()'];
      case 'bash':
        return ['--version'];
      case 'zsh':
        return ['--version'];
      case 'sh':
        // sh typically doesn't have a version flag, just test basic execution
        return ['-c', 'true'];
      case 'auto':
        // For auto mode, use the default shell's version command
        const defaultShell = this.getDefaultShell();
        if (
          defaultShell.command.includes('powershell') ||
          defaultShell.command.includes('pwsh')
        ) {
          return ['-Command', '$PSVersionTable.PSVersion.ToString()'];
        } else if (defaultShell.command.includes('cmd')) {
          return ['/C', 'ver'];
        } else {
          return ['--version'];
        }
      default:
        return ['--version'];
    }
  }

  private setupProcessHandlers(session: LocalSession): void {
    console.error(
      `[DEBUG-HANG] setupProcessHandlers called for sessionId: ${session.id}`
    );

    if (!session.process) {
      console.error(
        `[DEBUG-HANG] ERROR: No process found for session ${session.id}`
      );
      return;
    }

    console.error(
      `[DEBUG-HANG] Setting up stdout handler for sessionId: ${session.id}`
    );
    // Handle stdout
    session.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.error(
        `[DEBUG-HANG] stdout data received for sessionId: ${session.id}, length: ${text.length}`
      );
      session.outputBuffer += text;
      session.lastActivity = new Date();

      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stdout',
        data: text,
        timestamp: new Date(),
        raw: text,
      };

      // Add to BaseProtocol's output buffer
      this.addToOutputBuffer(session.id, output);
      console.error(
        `[DEBUG-HANG] Emitting 'output' event for sessionId: ${session.id}`
      );
      this.emit('output', output);
    });

    console.error(
      `[DEBUG-HANG] Setting up stderr handler for sessionId: ${session.id}`
    );
    // Handle stderr
    session.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.error(
        `[DEBUG-HANG] stderr data received for sessionId: ${session.id}, length: ${text.length}`
      );
      session.errorBuffer += text;
      session.lastActivity = new Date();

      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stderr',
        data: text,
        timestamp: new Date(),
        raw: text,
      };

      // Add to BaseProtocol's output buffer
      this.addToOutputBuffer(session.id, output);
      console.error(
        `[DEBUG-HANG] Emitting 'output' event for stderr, sessionId: ${session.id}`
      );
      this.emit('output', output);
    });

    console.error(
      `[DEBUG-HANG] Setting up process close handler for sessionId: ${session.id}`
    );
    // Handle process exit
    session.process.on(
      'close',
      (code: number | null, signal: NodeJS.Signals | null) => {
        console.error(
          `[DEBUG-HANG] Process close event fired for sessionId: ${session.id}, code: ${code}, signal: ${signal}`
        );
        session.isActive = false;
        this.logger.info(
          `Local session ${session.id} closed with code: ${code}, signal: ${signal}`
        );

        console.error(
          `[DEBUG-HANG] Emitting 'session-closed' event for sessionId: ${session.id}`
        );
        // CRITICAL FIX: Emit proper object structure with actual exit code
        this.emit('session-closed', {
          sessionId: session.id,
          exitCode: code || 0,
        });
        this.sessions.delete(session.id);
        this.localSessions.delete(session.id);
        // Session count is managed by BaseProtocol
      }
    );

    console.error(
      `[DEBUG-HANG] Setting up process error handler for sessionId: ${session.id}`
    );
    // Handle process errors
    session.process.on('error', (error) => {
      console.error(
        `[DEBUG-HANG] Process error event fired for sessionId: ${session.id}, error: ${error.message}`
      );
      session.isActive = false;
      this.logger.error(`Local session ${session.id} error: ${error}`);

      console.error(
        `[DEBUG-HANG] Emitting 'error' event for sessionId: ${session.id}`
      );
      this.emit('error', {
        sessionId: session.id,
        error: error.message,
        timestamp: new Date(),
      });
    });

    console.error(
      `[DEBUG-HANG] All process handlers set up for sessionId: ${session.id}`
    );
  }
}

interface LocalSession {
  id: string;
  type: ConsoleType;
  process: ChildProcess;
  created: Date;
  lastActivity: Date;
  outputBuffer: string;
  errorBuffer: string;
  isActive: boolean;
}
