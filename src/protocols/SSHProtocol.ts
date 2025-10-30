import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  SSHAdapter,
  SSHOptions,
  createSSHSession,
  createSSHSessionWithHandlers,
} from '../core/SSHAdapter.js';
import { ProtocolCapabilities, SessionState } from '../core/IProtocol.js';
import {
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
  SSHConnectionOptions,
  ConsoleType,
} from '../types/index.js';

/**
 * SSH Protocol implementation for secure remote shell access
 * Uses the robust SSHAdapter for actual SSH connections with retry/recovery
 */
export class SSHProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'ssh';
  public readonly capabilities: ProtocolCapabilities;

  private connectionPool: Map<string, SSHAdapter> = new Map();
  private sessionAdapters: Map<string, SSHAdapter> = new Map();

  constructor() {
    super('SSHProtocol');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: true,
      supportsPortForwarding: true,
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
      maxConcurrentSessions: 20,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'ascii', 'binary'],
      supportedAuthMethods: ['password', 'publickey', 'keyboard-interactive'],
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

    // SSH functionality available through SSHAdapter
    this.isInitialized = true;
    this.logger.info('SSH protocol initialized with session management fixes');
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      throw new Error('Protocol not initialized');
    }

    const sessionId = `ssh-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Use session management fixes from BaseProtocol
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    // CRITICAL DEBUG: Track execution flow
    const debugLog = (msg: string) => {
      try {
        console.error(`[SSH-DEBUG] ${msg}`);
      } catch (e) {
        // Ignore debug errors
      }
    };

    debugLog('=== SSHProtocol.doCreateSession CALLED ===');
    debugLog(`sessionId: ${sessionId}`);
    debugLog(`sessionState.isOneShot: ${sessionState.isOneShot}`);
    debugLog(`options.command: "${options.command}"`);
    debugLog(`options.args: ${JSON.stringify(options.args)}`);
    debugLog(`has sshOptions: ${!!options.sshOptions}`);

    try {
      // Validate SSH options
      if (!options.sshOptions) {
        debugLog('ERROR: No SSH options provided!');
        throw new Error('SSH connection options required');
      }

      // Convert to SSHAdapter options
      const sshOptions: SSHOptions = {
        host: options.sshOptions.host,
        port: options.sshOptions.port,
        username: options.sshOptions.username,
        password: options.sshOptions.password,
        privateKey: options.sshOptions.privateKey,
        strictHostKeyChecking: options.sshOptions.strictHostKeyChecking,
        timeout: options.timeout || this.capabilities.defaultTimeout,
      };

      // Create SSH adapter for this session with immediate handler setup
      // This pattern eliminates race conditions by ensuring handlers are attached atomically
      const adapter = createSSHSessionWithHandlers(
        sshOptions,
        sessionId,
        (adapter) => this.setupAdapterHandlers(sessionId, adapter)
      );

      // Store adapter after handlers are guaranteed to be set up
      this.sessionAdapters.set(sessionId, adapter);

      // SSH always needs connection, regardless of one-shot or persistent
      debugLog(
        `CONNECTING for ${sessionState.isOneShot ? 'one-shot' : 'persistent'} session`
      );
      debugLog(
        `SSH Options: ${JSON.stringify({
          host: sshOptions.host,
          hasPassword: !!sshOptions.password,
          hasPrivateKey: !!sshOptions.privateKey,
        })}`
      );
      await adapter.connect(sshOptions);
      debugLog('>>> adapter.connect() COMPLETED <<<');

      const session: ConsoleSession = {
        id: sessionId,
        command: options.command || 'ssh',
        args: options.args || [],
        cwd: options.cwd || '~',
        env: options.env || {},
        createdAt: new Date(),
        status: sessionState.isOneShot ? 'initializing' : 'running',
        type: this.type,
        streaming: options.streaming ?? false,
        sshOptions: options.sshOptions,
        executionState: 'idle',
        activeCommands: new Map(),
        lastActivity: new Date(),
        pid: undefined, // SSH sessions don't have local PIDs
      };

      this.sessions.set(sessionId, session);
      this.outputBuffers.set(sessionId, []);

      debugLog(
        `SSH session ${sessionId} created successfully (${sessionState.isOneShot ? 'one-shot' : 'persistent'})`
      );
      this.logger.info(
        `SSH session ${sessionId} created (${sessionState.isOneShot ? 'one-shot' : 'persistent'})`
      );
      return session;
    } catch (error) {
      try {
        console.error(`[SSH-DEBUG] ERROR in doCreateSession: ${error}`);
        console.error(`[SSH-DEBUG] Error stack: ${(error as Error).stack}`);
      } catch (e) {
        // Ignore debug errors
      }
      this.logger.error(`Failed to create SSH session: ${error}`);

      // Cleanup on failure
      const adapter = this.sessionAdapters.get(sessionId);
      if (adapter) {
        adapter.destroy();
        this.sessionAdapters.delete(sessionId);
      }

      throw error;
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const adapter = this.sessionAdapters.get(sessionId);
    const sessionState = await this.getSessionState(sessionId);

    if (!adapter) {
      throw new Error(`SSH adapter for session ${sessionId} not found`);
    }

    try {
      // For one-shot sessions, connect first if not already connected
      if (sessionState.isOneShot && !adapter.isActive()) {
        const session = this.sessions.get(sessionId);
        if (session?.sshOptions) {
          const sshOptions: SSHOptions = {
            host: session.sshOptions.host,
            port: session.sshOptions.port,
            username: session.sshOptions.username,
            password: session.sshOptions.password,
            privateKey: session.sshOptions.privateKey,
            strictHostKeyChecking: session.sshOptions.strictHostKeyChecking,
            timeout: this.capabilities.defaultTimeout,
          };
          await adapter.connect(sshOptions);
        }
      }

      // Build full command
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;

      // Send command via SSH adapter
      await adapter.sendCommand(fullCommand);

      // For one-shot sessions, mark as complete when command is sent
      if (sessionState.isOneShot) {
        setTimeout(() => {
          this.markSessionComplete(sessionId, 0);
        }, 1000); // Give time for output to be captured
      }

      this.emit('commandExecuted', {
        sessionId,
        command: fullCommand,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to execute SSH command: ${error}`);
      throw error;
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const adapter = this.sessionAdapters.get(sessionId);

    if (!adapter) {
      throw new Error(`SSH adapter for session ${sessionId} not found`);
    }

    try {
      // Check if this is a password input
      if (input.includes('\n') && !input.trim().includes(' ')) {
        await adapter.sendPassword(input.trim());
      } else {
        await adapter.sendCommand(input);
      }

      this.emit('inputSent', { sessionId, input, timestamp: new Date() });
    } catch (error) {
      this.logger.error(`Failed to send SSH input: ${error}`);
      throw error;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const adapter = this.sessionAdapters.get(sessionId);

    if (adapter) {
      adapter.destroy();
      this.sessionAdapters.delete(sessionId);
    }

    // Remove from base class tracking
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);

    this.emit('sessionClosed', sessionId);
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing SSH protocol');

    // Close all SSH adapters
    for (const sessionId of this.sessionAdapters.keys()) {
      const adapter = this.sessionAdapters.get(sessionId);
      if (adapter) {
        adapter.destroy();
      }
    }

    this.sessionAdapters.clear();
    this.connectionPool.clear();

    await this.cleanup();
  }

  /**
   * Setup event handlers for SSH adapter with error-safe patterns
   */
  private setupAdapterHandlers(sessionId: string, adapter: SSHAdapter): void {
    // CRITICAL: All handlers must be synchronous and error-safe
    // Use try-catch to prevent handler errors from breaking the adapter

    adapter.on('data', (data: string) => {
      try {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data,
          timestamp: new Date(),
          raw: data,
        };

        this.addToOutputBuffer(sessionId, output);
      } catch (error) {
        this.logger.error(
          `Error handling SSH data for session ${sessionId}:`,
          error
        );
      }
    });

    adapter.on('error', (error: string) => {
      try {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: error,
          timestamp: new Date(),
          raw: error,
        };

        this.addToOutputBuffer(sessionId, output);
      } catch (handlerError) {
        this.logger.error(
          `Error handling SSH error for session ${sessionId}:`,
          handlerError
        );
        // Log original error too in case handler fails
        this.logger.error(`Original SSH error:`, error);
      }
    });

    adapter.on('close', (code: number) => {
      try {
        this.markSessionComplete(sessionId, code);
      } catch (error) {
        this.logger.error(
          `Error handling SSH close for session ${sessionId}:`,
          error
        );
      }
    });

    adapter.on('connected', () => {
      try {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'running';
          session.executionState = 'idle';
        }
      } catch (error) {
        this.logger.error(
          `Error handling SSH connected for session ${sessionId}:`,
          error
        );
      }
    });

    adapter.on('error-recovered', (data) => {
      try {
        this.logger.info(
          `SSH session ${sessionId} error recovered: ${JSON.stringify(data)}`
        );
      } catch (error) {
        this.logger.error(
          `Error logging SSH recovery for session ${sessionId}:`,
          error
        );
      }
    });

    adapter.on('degradation-enabled', (data) => {
      try {
        this.logger.warn(
          `SSH session ${sessionId} degraded mode: ${JSON.stringify(data)}`
        );
      } catch (error) {
        this.logger.error(
          `Error logging SSH degradation for session ${sessionId}:`,
          error
        );
      }
    });

    // CRITICAL: Add handler for new safety events from improved SSHAdapter
    adapter.on('connection-failed', (data) => {
      try {
        this.logger.error(
          `SSH session ${sessionId} connection failed: ${JSON.stringify(data)}`
        );
        // Mark session as failed so it can be cleaned up
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'failed';
        }
      } catch (error) {
        this.logger.error(
          `Error handling SSH connection failure for session ${sessionId}:`,
          error
        );
      }
    });

    adapter.on('connection-restored', (data) => {
      try {
        this.logger.info(
          `SSH session ${sessionId} connection restored: ${JSON.stringify(data)}`
        );
        // Update session status
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'running';
          session.executionState = 'idle';
        }
      } catch (error) {
        this.logger.error(
          `Error handling SSH connection restoration for session ${sessionId}:`,
          error
        );
      }
    });
  }
}
