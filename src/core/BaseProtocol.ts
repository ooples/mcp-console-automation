import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import {
  IProtocol,
  ProtocolCapabilities,
  ProtocolHealthStatus,
  SessionState,
  // CommandExecutionOptions,
  // WaitOptions,
  // WaitResult,
  ErrorContext,
  ErrorRecoveryResult,
  ResourceUsage,
} from './IProtocol.js';
import {
  ConsoleType,
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
  // HealthCheckResult
} from '../types/index.js';

/**
 * Base protocol implementation with session management fixes
 */
export abstract class BaseProtocol extends EventEmitter implements IProtocol {
  public abstract readonly type: ConsoleType;
  public abstract readonly capabilities: ProtocolCapabilities;

  protected logger: Logger;
  protected sessions: Map<string, ConsoleSession> = new Map();
  protected outputBuffers: Map<string, ConsoleOutput[]> = new Map();
  protected isInitialized: boolean = false;
  private initializationTime: number = Date.now();

  // Session management fixes
  private sessionTypes: Map<string, 'oneshot' | 'persistent'> = new Map();
  private sessionStates: Map<string, SessionState> = new Map();

  constructor(name: string) {
    super();
    this.logger = new Logger(name);
  }

  // Abstract methods that must be implemented by concrete protocols
  abstract initialize(): Promise<void>;
  abstract dispose(): Promise<void>;
  abstract createSession(options: SessionOptions): Promise<ConsoleSession>;
  abstract closeSession(sessionId: string): Promise<void>;
  abstract executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void>;
  abstract sendInput(sessionId: string, input: string): Promise<void>;

  /**
   * Detect if session options indicate a one-shot command
   * This is the core fix for "stream destroyed" errors
   */
  protected isOneShotCommand(options: SessionOptions): boolean {
    // First check if isOneShot is explicitly set in options
    if (options.isOneShot !== undefined) {
      return options.isOneShot;
    }

    const command = options.command?.toLowerCase() || '';
    const args = options.args || [];

    // PowerShell one-shot patterns
    if (command === 'powershell' || command === 'pwsh') {
      return (
        args.includes('-Command') ||
        args.includes('-c') ||
        args.some((arg) => arg.toLowerCase().startsWith('-command'))
      );
    }

    // CMD one-shot patterns
    if (command === 'cmd') {
      return args.includes('/c') || args.includes('/C');
    }

    // Bash/sh one-shot patterns
    if (['bash', 'sh', 'zsh'].includes(command)) {
      return args.includes('-c');
    }

    // SSH with direct commands
    if (command === 'ssh') {
      // If there's a command after the connection params, it's one-shot
      const hostArgIndex = args.findIndex((arg) => !arg.startsWith('-'));
      return hostArgIndex >= 0 && hostArgIndex < args.length - 1;
    }

    // Docker exec with commands
    if (command === 'docker') {
      return args.includes('exec') && args.length > 3;
    }

    // Kubectl exec with commands
    if (command === 'kubectl') {
      return args.includes('exec') && args.includes('--');
    }

    // .NET console apps with command-line arguments
    // When running: dotnet run -- <command> <args>
    // Or direct execution: ./app.exe <command> <args>
    if (command === 'dotnet') {
      // Check if this is "dotnet run" with arguments passed via "--"
      const runIndex = args.indexOf('run');
      const dashDashIndex = args.indexOf('--');
      return runIndex >= 0 && dashDashIndex > runIndex;
    }

    // Direct .NET executable with .exe or .dll extension and arguments
    if (
      (command.endsWith('.exe') || command.endsWith('.dll')) &&
      args.length > 0
    ) {
      // If the executable has arguments, it might be a command-style invocation
      // This is a heuristic - apps with interactive loops need special handling
      return true;
    }

    return false;
  }

  /**
   * Enhanced session creation with type detection
   */
  protected async createSessionWithTypeDetection(
    sessionId: string,
    options: SessionOptions
  ): Promise<ConsoleSession> {
    // Detect session type
    const isOneShot = this.isOneShotCommand(options);
    this.sessionTypes.set(sessionId, isOneShot ? 'oneshot' : 'persistent');

    // Create session state
    const sessionState: SessionState = {
      sessionId,
      status: 'initializing',
      isOneShot,
      isPersistent: !isOneShot,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessionStates.set(sessionId, sessionState);

    this.logger.info(
      `Creating ${isOneShot ? 'one-shot' : 'persistent'} session ${sessionId}`,
      {
        command: options.command,
        args: options.args,
      }
    );

    return this.doCreateSession(sessionId, options, sessionState);
  }

  /**
   * Abstract method for actual session creation - must be implemented by subclasses
   */
  protected abstract doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession>;

  /**
   * Get output with proper handling for one-shot vs persistent sessions
   */
  async getOutput(sessionId: string, since?: Date): Promise<ConsoleOutput[]> {
    const buffer = this.outputBuffers.get(sessionId) || [];
    const sessionType = this.sessionTypes.get(sessionId);

    if (since) {
      return buffer.filter((output) => output.timestamp >= since);
    }

    // For one-shot sessions, wait a bit for output to be captured
    if (sessionType === 'oneshot') {
      await this.waitForOneShotOutput(sessionId);
    }

    return [...buffer];
  }

  /**
   * Wait for one-shot command output with timeout
   */
  private async waitForOneShotOutput(
    sessionId: string,
    maxWaitMs: number = 5000
  ): Promise<void> {
    const startTime = Date.now();
    const sessionState = this.sessionStates.get(sessionId);

    while (Date.now() - startTime < maxWaitMs) {
      const buffer = this.outputBuffers.get(sessionId) || [];

      // If we have output or session is complete, return
      if (buffer.length > 0 || sessionState?.status === 'stopped') {
        return;
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Add output to buffer with session state tracking
   */
  protected addToOutputBuffer(sessionId: string, output: ConsoleOutput): void {
    if (!this.outputBuffers.has(sessionId)) {
      this.outputBuffers.set(sessionId, []);
    }

    const buffer = this.outputBuffers.get(sessionId)!;
    buffer.push(output);

    // Update session activity
    const sessionState = this.sessionStates.get(sessionId);
    if (sessionState) {
      sessionState.lastActivity = new Date();
    }

    // Emit output event
    this.emit('output', output);

    // For one-shot sessions, check if we should mark as complete
    const sessionType = this.sessionTypes.get(sessionId);
    if (sessionType === 'oneshot') {
      this.checkOneShotCompletion(sessionId, output);
    }
  }

  /**
   * Check if one-shot session should be marked as complete
   */
  private checkOneShotCompletion(
    sessionId: string,
    output: ConsoleOutput
  ): void {
    // Look for completion indicators in output
    const text = output.data.toLowerCase();

    // Common completion patterns
    if (
      text.includes('command not found') ||
      text.includes('error:') ||
      output.type === 'stderr'
    ) {
      this.markSessionComplete(sessionId, 1); // Error exit
    }

    // Check for .NET console app completion patterns
    if (this.isInteractiveDotnetApp(sessionId)) {
      this.checkDotnetAppCompletion(sessionId, output);
    }
  }

  /**
   * Check if this is an interactive .NET console app
   */
  private isInteractiveDotnetApp(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const command = session.command?.toLowerCase() || '';
    const args = session.args || [];

    // Check for dotnet run with arguments
    if (command === 'dotnet' && args.includes('run') && args.includes('--')) {
      return true;
    }

    // Check for direct .exe/.dll execution
    if (
      (session.command?.endsWith('.exe') || session.command?.endsWith('.dll')) &&
      args.length > 0
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if .NET console app has completed its command
   * and needs to be sent a quit command
   */
  private async checkDotnetAppCompletion(
    sessionId: string,
    output: ConsoleOutput
  ): Promise<void> {
    const text = output.data.toLowerCase();

    // Detect completion patterns common in .NET console apps
    if (
      text.includes('command complete') ||
      text.includes('operation complete') ||
      text.includes('finished successfully') ||
      text.includes('enter a command or enter q to quit') ||
      text.includes('please enter a command')
    ) {
      // Mark that we've detected completion
      const sessionState = this.sessionStates.get(sessionId);
      if (sessionState && !sessionState.completionDetected) {
        sessionState.completionDetected = true;

        this.logger.info(
          `Detected command completion for .NET app ${sessionId}, sending quit command`
        );

        // Wait a moment for any remaining output to flush
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Send quit command to exit the interactive loop
        try {
          await this.sendInput(sessionId, 'q\n');
        } catch (error) {
          this.logger.warn(
            `Failed to send quit command to session ${sessionId}:`,
            error
          );
        }
      }
    }
  }

  /**
   * Mark session as complete
   */
  protected markSessionComplete(sessionId: string, exitCode?: number): void {
    const sessionState = this.sessionStates.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (sessionState) {
      sessionState.status = 'stopped';
      sessionState.exitCode = exitCode;
    }

    if (session) {
      session.status = 'stopped';
      session.exitCode = exitCode;
    }

    this.emit('session-complete', { sessionId, exitCode });
  }

  /**
   * Get session state
   */
  async getSessionState(sessionId: string): Promise<SessionState> {
    const state = this.sessionStates.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return { ...state };
  }

  /**
   * Default implementations for common methods
   */
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return this.getAllSessions().filter((session) =>
      ['running', 'initializing'].includes(session.status)
    );
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Default health status implementation
   */
  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const now = new Date();
    const activeSessions = this.getActiveSessions();
    const totalSessions = this.getSessionCount();

    return {
      isHealthy: totalSessions < this.capabilities.maxConcurrentSessions,
      lastChecked: now,
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: activeSessions.length,
        totalSessions,
        averageLatency: 0, // Subclasses should implement
        successRate: 1.0, // Subclasses should implement
        uptime: this.isInitialized ? Date.now() - this.initializationTime : 0,
      },
      dependencies: {},
    };
  }

  /**
   * Default error handling
   */
  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorRecoveryResult> {
    this.logger.error(
      `Protocol error in ${context.operation || 'unknown'}:`,
      error
    );

    const startTime = Date.now();
    let recovered = false;
    let strategy = 'none';

    // Basic error recovery strategies
    if (this.isStreamError(error)) {
      strategy = 'stream-restart';
      recovered = await this.attemptStreamRestart(context);
    } else if (this.isConnectionError(error)) {
      strategy = 'reconnection';
      recovered = await this.attemptReconnection(context);
    } else if (this.isSessionError(error)) {
      strategy = 'session-restart';
      recovered = await this.attemptSessionRestart(context);
    }

    return {
      recovered,
      strategy,
      attempts: 1,
      duration: Date.now() - startTime,
      error: recovered ? undefined : error.message,
    };
  }

  protected isStreamError(error: Error): boolean {
    return (
      error.message.includes('stream') || error.message.includes('destroyed')
    );
  }

  protected isConnectionError(error: Error): boolean {
    return (
      error.message.includes('connection') || error.message.includes('connect')
    );
  }

  protected isSessionError(error: Error): boolean {
    return (
      error.message.includes('session') || error.message.includes('process')
    );
  }

  protected async attemptReconnection(
    _context: ErrorContext
  ): Promise<boolean> {
    // Subclasses can override this for protocol-specific reconnection logic
    return false;
  }

  protected async attemptSessionRestart(
    context: ErrorContext
  ): Promise<boolean> {
    if (context.sessionId) {
      return await this.recoverSession(context.sessionId);
    }
    return false;
  }

  protected async attemptStreamRestart(
    context: ErrorContext
  ): Promise<boolean> {
    // For stream errors, usually need to recreate the session
    if (context.sessionId) {
      return await this.recoverSession(context.sessionId);
    }
    return false;
  }

  /**
   * Default session recovery
   */
  async recoverSession(sessionId: string): Promise<boolean> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return false;
      }

      // Close existing session
      await this.closeSession(sessionId);

      // Recreate session with same options
      const _newSession = await this.createSession({
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        env: session.env,
        consoleType: session.type,
        streaming: session.streaming,
      });

      this.logger.info(`Session ${sessionId} recovered successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to recover session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Default resource usage implementation
   */
  getResourceUsage(): ResourceUsage {
    return {
      memory: {
        used: process.memoryUsage().heapUsed,
        available: process.memoryUsage().heapTotal,
        peak: process.memoryUsage().heapUsed,
      },
      cpu: {
        usage: 0, // Would need OS-specific implementation
        load: [],
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.getActiveSessions().length,
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0,
      },
      sessions: {
        active: this.getActiveSessions().length,
        total: this.getSessionCount(),
        peak: this.getSessionCount(),
      },
    };
  }

  /**
   * Default cleanup implementation
   */
  async cleanup(): Promise<void> {
    this.logger.info(`Cleaning up ${this.type} protocol`);

    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(
      sessionIds.map((id) =>
        this.closeSession(id).catch((err) =>
          this.logger.error(`Failed to close session ${id}:`, err)
        )
      )
    );

    // Clear all data
    this.sessions.clear();
    this.outputBuffers.clear();
    this.sessionTypes.clear();
    this.sessionStates.clear();

    // Remove all listeners
    this.removeAllListeners();

    this.isInitialized = false;
  }
}
