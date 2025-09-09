import { EventEmitter } from 'events';
import { Socket } from 'net';
import { Logger } from '../utils/logger.js';
import { 
  ConsoleSession, 
  SessionOptions, 
  ConsoleOutput,
  TelnetConnectionOptions,
  TelnetSessionState,
  TelnetCommand,
  TelnetOption
} from '../types/index.js';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';

export class TelnetProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'telnet' as const;
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  
  private logger: Logger;
  private sessions: Map<string, TelnetSession> = new Map();
  private isInitialized = false;

  constructor() {
    super();
    this.logger = new Logger('TelnetProtocol');
    
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

    this.healthStatus = {
      isHealthy: true,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: 0,
        totalSessions: 0,
        averageLatency: 0,
        successRate: 1.0,
        uptime: 0,
      },
      dependencies: {
        telnet: {
          available: true,
          version: '1.0',
        },
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    this.logger.info('Initializing Telnet protocol');
    this.isInitialized = true;
    this.emit('initialized');
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const telnetOptions = options.telnetOptions;
    if (!telnetOptions) {
      throw new Error('Telnet options are required');
    }

    const sessionId = `telnet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session: TelnetSession = {
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

    this.sessions.set(sessionId, session);

    try {
      await this.connectSession(session);
      
      const consoleSession: ConsoleSession = {
        id: sessionId,
        type: 'telnet',
        status: 'running',
        createdAt: new Date(),
        lastActivity: new Date(),
        executionState: 'idle',
        command: options.command || '',
        args: options.args || [],
        cwd: telnetOptions.initialDirectory || '/',
        env: options.environment || {},
        environment: options.environment || {},
        activeCommands: new Map(),
        telnetOptions
      };

      this.emit('sessionCreated', consoleSession);
      return consoleSession;
    } catch (error) {
      this.sessions.delete(sessionId);
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
        this.emit('sessionClosed', session.id);
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
          this.emit('sessionOutput', {
            sessionId: session.id,
            data: textData,
            timestamp: new Date()
          });
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.state.isConnected || !session.socket) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    const telnetCommand: TelnetCommand = {
      id: `cmd-${Date.now()}`,
      command,
      timestamp: new Date(),
      status: 'pending'
    };

    session.state.commandQueue.push(telnetCommand);

    try {
      // Send command with carriage return + line feed
      session.socket.write(command + '\r\n');
      session.state.lastActivity = new Date();
      telnetCommand.status = 'executing';

      // For telnet, we don't wait for specific output, just send the command
      telnetCommand.status = 'completed';
      
      // IProtocol.executeCommand returns void, output should be retrieved via getOutput
    } catch (error) {
      telnetCommand.status = 'failed';
      throw error;
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.state.isConnected || !session.socket) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    session.socket.write(input);
    session.state.lastActivity = new Date();
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    // Telnet protocol doesn't buffer output internally
    // Output is emitted via events and should be captured by the consumer
    return '';
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Attempted to close non-existent session: ${sessionId}`);
      return;
    }

    if (session.socket) {
      session.socket.destroy();
    }

    this.sessions.delete(sessionId);
    this.emit('sessionClosed', sessionId);
    this.logger.info(`Closed telnet session: ${sessionId}`);
  }

  async listSessions(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  async getSessionStatus(sessionId: string): Promise<'running' | 'stopped' | 'error'> {
    const session = this.sessions.get(sessionId);
    if (!session) return 'stopped';
    return session.state.isConnected ? 'running' : 'stopped';
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.metrics.activeSessions = this.sessions.size;
    return { ...this.healthStatus };
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Telnet protocol');
    
    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));
    
    this.isInitialized = false;
    this.removeAllListeners();
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