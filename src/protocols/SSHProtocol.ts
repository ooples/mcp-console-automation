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
import { randomBytes } from 'node:crypto';

const quoteShellArgument = (value: string) =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'"'"'`)}'`;

/**
 * Builds the line sent to the remote shell. `command` is a shell command line and is sent as
 * written, so `cd /srv && ls; echo done` keeps its operators; quoting it turned the whole line
 * into one program name ("No such file or directory"). Only `args` are quoted, which keeps
 * their boundaries intact.
 */
export function buildRemoteCommand(command: string, args?: string[]): string {
  return [command, ...(args ?? []).map(quoteShellArgument)].join(' ');
}

/**
 * A per-command marker that reports the command's real exit status. The terminal echoes the
 * command line back, and that echo contains the printf format (`%d`), never the rendered
 * `<nonce>_<status>` text, so only the actual output can match.
 */
export function createCompletionMarker(nonce = randomBytes(8).toString('hex')): {
  suffix: string;
  parse: (output: string) => number | undefined;
} {
  const pattern = new RegExp(`__MCP_DONE_${nonce}_(\\d+)__`);
  return {
    suffix: `; printf '\\n__MCP_DONE_%s_%d__\\n' ${nonce} "$?"`,
    parse: (output: string) => {
      const match = pattern.exec(output);
      return match ? Number(match[1]) : undefined;
    },
  };
}

// CSI (ESC [ ... final), OSC (ESC ] ... BEL or ESC \), and other two-byte escapes.
const ESCAPE_SEQUENCES =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
const COMPLETION_MARKER = /__MCP_DONE_[0-9a-f]+_\d+__/;

/**
 * Reduces a one-shot command's interactive-shell transcript to what the command printed.
 * One-shot commands run in a login shell with a terminal, so the raw stream also holds the
 * login banner (MOTD), the echoed command line (often twice), prompts and terminal escape
 * sequences. The command's own output is exactly what lies between the last echo of the
 * command line (it ends with the marker's `"$?"`) and the rendered completion marker.
 * Without a marker (for example after a timeout) only the escape sequences are removed.
 */
export function extractOneShotOutput(raw: string): string {
  // A lone \r is the terminal moving the cursor, not output; drop it rather than make a line.
  const text = raw.replace(ESCAPE_SEQUENCES, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
  const marker = COMPLETION_MARKER.exec(text);
  if (!marker) return text;
  const beforeMarker = text.slice(0, marker.index);
  const echoEnd = beforeMarker.lastIndexOf('"$?"');
  const start = echoEnd < 0 ? 0 : beforeMarker.indexOf('\n', echoEnd) + 1;
  return beforeMarker.slice(start).replace(/\n$/, '');
}

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
        // SSHAdapter treats `privateKey` as a filesystem PATH (uses `ssh -i`
        // for key auth). Accept `privateKeyPath` as an alias so key-only
        // callers authenticate instead of failing with "authentication
        // methods failed".
        privateKey:
          options.sshOptions.privateKey ||
          (options.sshOptions as any).privateKeyPath,
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
            privateKey:
              session.sshOptions.privateKey ||
              (session.sshOptions as any).privateKeyPath,
            strictHostKeyChecking: session.sshOptions.strictHostKeyChecking,
            timeout: this.capabilities.defaultTimeout,
          };
          await adapter.connect(sshOptions);
        }
      }

      const fullCommand = buildRemoteCommand(command, args);

      if (sessionState.isOneShot) {
        // The remote side is an interactive shell, so "the command finished" is only knowable
        // from the shell itself. Append a marker that prints the real exit status and complete
        // the session when it arrives; ConsoleManager's timeout still bounds a hung command.
        const marker = createCompletionMarker();
        let received = '';
        const onData = (data: string) => {
          received = (received + data).slice(-4096);
          const exitCode = marker.parse(received);
          if (exitCode !== undefined) {
            adapter.off('data', onData);
            this.markSessionComplete(sessionId, exitCode);
          }
        };
        adapter.on('data', onData);
        await adapter.sendCommand(`${fullCommand}${marker.suffix}`);
      } else {
        await adapter.sendCommand(fullCommand);
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
