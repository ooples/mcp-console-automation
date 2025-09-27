import { Socket } from 'net';
import { BaseProtocol } from '../core/BaseProtocol.js';
import { ProtocolCapabilities, SessionState } from '../core/IProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleOutput,
  TelnetConnectionOptions,
  TelnetSessionState,
  TelnetCommand,
  TelnetOption,
  ConsoleType
} from '../types/index.js';

export class TelnetProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'telnet';
  public readonly capabilities: ProtocolCapabilities;

  private telnetSessions: Map<string, TelnetSession> = new Map();

  constructor() {
    super('TelnetProtocol');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: false,
      supportsWorkingDirectory: false,
      supportsSignals: false,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 5,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'ascii'],
      supportedAuthMethods: ['password'],
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

    this.logger.info('Initializing Telnet protocol with session management fixes');
    this.isInitialized = true;
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `telnet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Use session management fixes from BaseProtocol
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const telnetOptions = options.telnetOptions;
    if (!telnetOptions) {
      throw new Error('Telnet options are required');
    }

    const telnetSession: TelnetSession = {
      id: sessionId,
      socket: null,
      state: {
        sessionId,
        connectionState: 'disconnected',
        isConnected: false,
        host: telnetOptions.host,
        port: telnetOptions.port || 23,
        commandHistory: [],
        commandQueue: [],
        lastActivity: new Date(),
        bufferSize: 4096,
        encoding: 'utf-8',
        lineEnding: '\r\n',
        timeout: 30000,
        retryCount: 0,
        options: new Map()
      },
      options: telnetOptions,
      buffer: Buffer.alloc(0)
    };

    this.telnetSessions.set(sessionId, telnetSession);

    try {
      // For persistent sessions, connect immediately
      // For one-shot sessions, connect on command execution
      if (!sessionState.isOneShot) {
        await this.connectSession(telnetSession);
      }

      const consoleSession: ConsoleSession = {
        id: sessionId,
        type: this.type,
        status: sessionState.isOneShot ? 'initializing' : 'running',
        createdAt: new Date(),
        lastActivity: new Date(),
        executionState: 'idle',
        command: options.command || '',
        args: options.args || [],
        cwd: telnetOptions.initialDirectory || '/',
        env: options.env || {},
        activeCommands: new Map(),
        telnetOptions,
        streaming: options.streaming ?? false
      };

      this.sessions.set(sessionId, consoleSession);
      this.outputBuffers.set(sessionId, []);

      this.logger.info(`Telnet session ${sessionId} created (${sessionState.isOneShot ? 'one-shot' : 'persistent'})`);
      return consoleSession;

    } catch (error) {
      this.logger.error(`Failed to create Telnet session: ${error}`);

      // Cleanup on failure
      this.telnetSessions.delete(sessionId);
      throw error;
    }
  }

  private async connectSession(session: TelnetSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      session.socket = socket;

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${session.state.host}:${session.state.port}`));
      }, session.options.timeout || 10000);

      socket.connect(session.state.port, session.state.host, () => {
        clearTimeout(timeout);
        session.state.isConnected = true;
        session.state.lastActivity = new Date();
        this.logger.info(`Connected to ${session.state.host}:${session.state.port}`);
        
        // Send initial telnet negotiations
        this.sendTelnetCommand(session, 255, 253, 1); // IAC DO ECHO
        this.sendTelnetCommand(session, 255, 253, 3); // IAC DO SUPPRESS_GO_AHEAD
        
        resolve();
      });

      socket.on('data', (data: Buffer) => {
        session.buffer = Buffer.concat([session.buffer, data]);
        this.processTelnetData(session);
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error(`Socket error for session ${session.id}:`, error);
        session.state.isConnected = false;
        reject(error);
      });

      socket.on('close', () => {
        session.state.isConnected = false;
        this.logger.info(`Session ${session.id} disconnected`);
        this.markSessionComplete(session.id, 0);
      });
    });
  }

  private processTelnetData(session: TelnetSession): void {
    let buffer = session.buffer;
    let processed = 0;

    while (processed < buffer.length) {
      if (buffer[processed] === 255) { // IAC (Interpret As Command)
        if (processed + 2 < buffer.length) {
          const command = buffer[processed + 1];
          const option = buffer[processed + 2];
          
          this.handleTelnetCommand(session, command, option);
          processed += 3;
        } else {
          break; // Incomplete command, wait for more data
        }
      } else {
        // Regular data
        const start = processed;
        while (processed < buffer.length && buffer[processed] !== 255) {
          processed++;
        }
        
        const textData = buffer.slice(start, processed).toString('utf8');
        if (textData.length > 0) {
          const output: ConsoleOutput = {
            sessionId: session.id,
            type: 'stdout',
            data: textData,
            timestamp: new Date(),
            raw: textData,
          };

          this.addToOutputBuffer(session.id, output);
        }
      }
    }

    session.buffer = buffer.slice(processed);
    session.state.lastActivity = new Date();
  }

  private handleTelnetCommand(session: TelnetSession, command: number, option: number): void {
    switch (command) {
      case 251: // WILL
        this.logger.debug(`Received WILL ${option}`);
        // Respond with DO or DONT
        this.sendTelnetCommand(session, 255, 253, option); // DO
        break;
      case 252: // WONT
        this.logger.debug(`Received WONT ${option}`);
        break;
      case 253: // DO
        this.logger.debug(`Received DO ${option}`);
        // Respond with WILL or WONT
        this.sendTelnetCommand(session, 255, 251, option); // WILL
        break;
      case 254: // DONT
        this.logger.debug(`Received DONT ${option}`);
        break;
      default:
        this.logger.debug(`Unknown telnet command: ${command} ${option}`);
    }
  }

  private sendTelnetCommand(session: TelnetSession, iac: number, command: number, option: number): void {
    if (session.socket && session.state.isConnected) {
      const buffer = Buffer.from([iac, command, option]);
      session.socket.write(buffer);
    }
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const telnetSession = this.telnetSessions.get(sessionId);
    const sessionState = await this.getSessionState(sessionId);

    if (!telnetSession) {
      throw new Error(`Telnet session ${sessionId} not found`);
    }

    try {
      // For one-shot sessions, connect first if not already connected
      if (sessionState.isOneShot && !telnetSession.state.isConnected) {
        await this.connectSession(telnetSession);
      }

      if (!telnetSession.state.isConnected || !telnetSession.socket) {
        throw new Error(`Session ${sessionId} is not connected`);
      }

      // Build full command
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;

      const telnetCommand: TelnetCommand = {
        id: `cmd-${Date.now()}`,
        command: fullCommand,
        timestamp: new Date(),
        status: 'pending'
      };

      telnetSession.state.commandQueue.push(telnetCommand);

      // Send command with carriage return + line feed
      telnetSession.socket.write(fullCommand + '\r\n');
      telnetSession.state.lastActivity = new Date();
      telnetCommand.status = 'executing';

      // For one-shot sessions, mark as complete after command is sent
      if (sessionState.isOneShot) {
        setTimeout(() => {
          this.markSessionComplete(sessionId, 0);
        }, 1000); // Give time for output to be captured
      }

      telnetCommand.status = 'completed';

    } catch (error) {
      this.logger.error(`Failed to execute Telnet command: ${error}`);
      throw error;
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const telnetSession = this.telnetSessions.get(sessionId);
    if (!telnetSession) {
      throw new Error(`Telnet session ${sessionId} not found`);
    }

    if (!telnetSession.state.isConnected || !telnetSession.socket) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    telnetSession.socket.write(input);
    telnetSession.state.lastActivity = new Date();
  }

  async closeSession(sessionId: string): Promise<void> {
    const telnetSession = this.telnetSessions.get(sessionId);

    if (telnetSession) {
      if (telnetSession.socket) {
        telnetSession.socket.destroy();
      }
      this.telnetSessions.delete(sessionId);
    }

    // Remove from base class tracking
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);

    this.emit('sessionClosed', sessionId);
    this.logger.info(`Closed telnet session: ${sessionId}`);
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Telnet protocol');

    // Close all telnet sessions
    const sessionIds = Array.from(this.telnetSessions.keys());
    for (const sessionId of sessionIds) {
      const telnetSession = this.telnetSessions.get(sessionId);
      if (telnetSession?.socket) {
        telnetSession.socket.destroy();
      }
    }

    this.telnetSessions.clear();

    await this.cleanup();
  }
}

interface TelnetSession {
  id: string;
  socket: Socket | null;
  state: TelnetSessionState;
  options: TelnetConnectionOptions;
  buffer: Buffer;
}

export default TelnetProtocol;