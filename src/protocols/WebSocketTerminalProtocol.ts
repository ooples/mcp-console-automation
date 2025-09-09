import WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { performance } from 'perf_hooks';

import {
  WebSocketTerminalConnectionOptions,
  WebSocketTerminalSessionState,
  WebSocketTerminalMessage,
  WebSocketFileTransfer,
  WebSocketMultiplexSession,
  WebSocketTerminalCapabilities,
  WebSocketTerminalProtocolConfig,
  ConsoleOutput,
  ConsoleEvent,
  ConsoleSession
} from '../types/index.js';

export class WebSocketTerminalProtocol extends EventEmitter {
  private sessions: Map<string, WebSocketTerminalSession> = new Map();
  private config: WebSocketTerminalProtocolConfig;
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private pingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private latencyMeasurements: Map<string, number[]> = new Map();
  private persistenceStore: Map<string, any> = new Map();
  
  constructor(config?: Partial<WebSocketTerminalProtocolConfig>) {
    super();
    this.config = this.createDefaultConfig(config);
    this.setupEventHandlers();
  }

  private createDefaultConfig(config?: Partial<WebSocketTerminalProtocolConfig>): WebSocketTerminalProtocolConfig {
    return {
      defaultProtocol: 'xterm',
      defaultPort: 80,
      connectionTimeout: 30000,
      readTimeout: 5000,
      writeTimeout: 5000,
      maxRetries: 5,
      retryDelay: 1000,
      exponentialBackoff: true,
      maxRetryDelay: 30000,
      pingInterval: 30000,
      pongTimeout: 5000,
      keepAliveEnabled: true,
      maxBufferSize: 1024 * 1024, // 1MB
      flushInterval: 100,
      enableBuffering: true,
      defaultCols: 80,
      defaultRows: 24,
      defaultEncoding: 'utf8',
      defaultTerminalType: 'xterm',
      allowInsecure: false,
      requireAuthentication: false,
      maxAuthAttempts: 3,
      sessionTimeout: 3600000, // 1 hour
      enableFileTransfer: true,
      enableMultiplexing: true,
      enableSessionPersistence: true,
      enableLatencyCompensation: true,
      enableCompression: true,
      logLevel: 'info',
      enableProtocolLogging: false,
      enablePerformanceLogging: false,
      popularTerminals: {
        wetty: {
          url: 'ws://localhost:3000/wetty/socket.io/?EIO=3&transport=websocket',
          protocol: 'wetty',
          terminalType: 'xterm',
          encoding: 'utf8'
        },
        ttyd: {
          url: 'ws://localhost:7681/ws',
          protocol: 'ttyd',
          terminalType: 'xterm',
          encoding: 'utf8',
          protocolOptions: {
            ttyd: {
              enableReconnect: true,
              enableZmodem: true,
              rendererType: 'canvas'
            }
          }
        },
        gotty: {
          url: 'ws://localhost:8080/ws',
          protocol: 'gotty',
          terminalType: 'xterm',
          encoding: 'utf8',
          protocolOptions: {
            gotty: {
              enableReconnect: true,
              enableWrite: true
            }
          }
        },
        vscode: {
          url: 'ws://localhost:8080/terminals/{id}',
          protocol: 'vscode-terminal',
          terminalType: 'xterm',
          encoding: 'utf8',
          authType: 'bearer',
          protocolOptions: {
            vscode: {
              workspaceId: '',
              instanceId: '',
              sessionToken: ''
            }
          }
        },
        cloud9: {
          url: 'ws://localhost:8081/socket.io/?EIO=4&transport=websocket',
          protocol: 'cloud9-terminal',
          terminalType: 'xterm',
          encoding: 'utf8',
          authType: 'custom',
          protocolOptions: {
            cloud9: {
              workspaceId: '',
              environmentId: '',
              region: 'us-east-1'
            }
          }
        },
        gitpod: {
          url: 'wss://gitpod.io/api/gitpod/v1/terminal/listen/{workspaceId}',
          protocol: 'gitpod-terminal',
          terminalType: 'xterm',
          encoding: 'utf8',
          authType: 'bearer',
          protocolOptions: {
            gitpod: {
              workspaceId: '',
              instanceId: '',
              supervisorToken: ''
            }
          }
        }
      },
      ...config
    };
  }

  private setupEventHandlers(): void {
    this.on('session_created', this.handleSessionCreated.bind(this));
    this.on('session_closed', this.handleSessionClosed.bind(this));
    this.on('message_received', this.handleMessageReceived.bind(this));
    this.on('error', this.handleError.bind(this));
  }

  /**
   * Create a new WebSocket terminal session
   */
  async createSession(sessionId: string, options: WebSocketTerminalConnectionOptions): Promise<WebSocketTerminalSession> {
    try {
      this.log('info', `Creating WebSocket terminal session: ${sessionId}`);
      
      // Validate options
      await this.validateConnectionOptions(options);
      
      // Create session state
      const sessionState = this.createSessionState(sessionId, options);
      
      // Create WebSocket terminal session
      const session = new WebSocketTerminalSession(sessionId, options, sessionState, this.config);
      
      // Setup session event handlers
      this.setupSessionEventHandlers(session);
      
      // Store session
      this.sessions.set(sessionId, session);
      
      // Connect to WebSocket
      await session.connect();
      
      this.emit('session_created', { sessionId, session });
      
      return session;
    } catch (error) {
      this.log('error', `Failed to create session ${sessionId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get existing session
   */
  getSession(sessionId: string): WebSocketTerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Close session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.disconnect();
      this.sessions.delete(sessionId);
      
      // Clean up timers
      const reconnectTimer = this.reconnectTimers.get(sessionId);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        this.reconnectTimers.delete(sessionId);
      }
      
      const pingInterval = this.pingIntervals.get(sessionId);
      if (pingInterval) {
        clearInterval(pingInterval);
        this.pingIntervals.delete(sessionId);
      }
      
      this.emit('session_closed', { sessionId });
    }
  }

  /**
   * Send data to terminal
   */
  async sendData(sessionId: string, data: string | Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    await session.sendData(data);
  }

  /**
   * Resize terminal
   */
  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    await session.resize(cols, rows);
  }

  /**
   * Upload file to terminal
   */
  async uploadFile(sessionId: string, localPath: string, remotePath: string, protocol?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    return await session.uploadFile(localPath, remotePath, protocol);
  }

  /**
   * Download file from terminal
   */
  async downloadFile(sessionId: string, remotePath: string, localPath: string, protocol?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    return await session.downloadFile(remotePath, localPath, protocol);
  }

  /**
   * Get terminal capabilities
   */
  getCapabilities(): WebSocketTerminalCapabilities {
    return {
      supportedProtocols: ['xterm', 'wetty', 'ttyd', 'gotty', 'vscode-terminal', 'cloud9-terminal', 'gitpod-terminal'],
      supportedEncodings: ['utf8', 'ascii', 'binary', 'base64'],
      supportedTerminalTypes: ['xterm', 'vt100', 'vt220', 'ansi', 'linux', 'screen', 'tmux'],
      binaryFrames: true,
      textFrames: true,
      compression: this.config.enableCompression,
      fragmentation: true,
      extensions: ['permessage-deflate', 'x-webkit-deflate-frame'],
      colorSupport: true,
      unicodeSupport: true,
      mouseSupport: true,
      clipboardSupport: true,
      fileTransferSupport: this.config.enableFileTransfer,
      multiplexingSupport: this.config.enableMultiplexing,
      authMethods: ['none', 'basic', 'bearer', 'cookie', 'query', 'custom'],
      sslSupport: true,
      proxySupport: true,
      maxConnections: 100,
      maxMessageSize: this.config.maxBufferSize,
      maxSessions: 50,
      maxFileSize: 100 * 1024 * 1024, // 100MB
      protocolVersion: '1.0',
      clientVersion: '1.0.0'
    };
  }

  /**
   * Create multiplex session
   */
  async createMultiplexSession(parentSessionId: string, title?: string): Promise<string> {
    const parentSession = this.sessions.get(parentSessionId);
    if (!parentSession) {
      throw new Error(`Parent session ${parentSessionId} not found`);
    }
    
    return await parentSession.createMultiplexSession(title);
  }

  /**
   * Switch multiplex session
   */
  async switchMultiplexSession(parentSessionId: string, multiplexSessionId: string): Promise<void> {
    const parentSession = this.sessions.get(parentSessionId);
    if (!parentSession) {
      throw new Error(`Parent session ${parentSessionId} not found`);
    }
    
    await parentSession.switchMultiplexSession(multiplexSessionId);
  }

  private async validateConnectionOptions(options: WebSocketTerminalConnectionOptions): Promise<void> {
    if (!options.url) {
      throw new Error('WebSocket URL is required');
    }
    
    if (!options.url.startsWith('ws://') && !options.url.startsWith('wss://')) {
      throw new Error('Invalid WebSocket URL protocol');
    }
    
    if (options.url.startsWith('ws://') && !this.config.allowInsecure) {
      throw new Error('Insecure WebSocket connections are not allowed');
    }
  }

  private createSessionState(sessionId: string, options: WebSocketTerminalConnectionOptions): WebSocketTerminalSessionState {
    return {
      connectionState: 'disconnected',
      sessionId,
      webSocketUrl: options.url,
      protocol: typeof options.protocol === 'string' ? options.protocol : options.protocol?.[0],
      reconnectCount: 0,
      terminalSize: {
        cols: options.cols || this.config.defaultCols,
        rows: options.rows || this.config.defaultRows
      },
      currentEncoding: options.encoding || this.config.defaultEncoding,
      readyState: WebSocket.WebSocket.CLOSED,
      inputBuffer: [],
      outputBuffer: [],
      bufferSize: 0,
      activeTransfers: new Map(),
      transferQueue: [],
      multiplexSessions: new Map(),
      isMasterSession: true,
      statistics: {
        messagesReceived: 0,
        messagesSent: 0,
        bytesReceived: 0,
        bytesSent: 0,
        reconnections: 0,
        errors: 0,
        avgLatency: 0,
        maxLatency: 0,
        minLatency: Infinity
      },
      errorHistory: []
    };
  }

  private setupSessionEventHandlers(session: WebSocketTerminalSession): void {
    session.on('connected', () => {
      this.emit('session_connected', { sessionId: session.sessionId });
      this.startPingInterval(session.sessionId);
    });
    
    session.on('disconnected', () => {
      this.emit('session_disconnected', { sessionId: session.sessionId });
      this.stopPingInterval(session.sessionId);
    });
    
    session.on('reconnecting', () => {
      this.emit('session_reconnecting', { sessionId: session.sessionId });
    });
    
    session.on('data', (data: string | Buffer) => {
      this.emit('data', { sessionId: session.sessionId, data });
    });
    
    session.on('error', (error: Error) => {
      this.emit('error', { sessionId: session.sessionId, error });
    });
    
    session.on('file_transfer_progress', (transfer: WebSocketFileTransfer) => {
      this.emit('file_transfer_progress', { sessionId: session.sessionId, transfer });
    });
    
    session.on('multiplex_session_created', (multiplexSession: WebSocketMultiplexSession) => {
      this.emit('multiplex_session_created', { sessionId: session.sessionId, multiplexSession });
    });
  }

  private startPingInterval(sessionId: string): void {
    if (!this.config.keepAliveEnabled) return;
    
    const interval = setInterval(async () => {
      const session = this.sessions.get(sessionId);
      if (session) {
        await session.ping();
      } else {
        clearInterval(interval);
      }
    }, this.config.pingInterval);
    
    this.pingIntervals.set(sessionId, interval);
  }

  private stopPingInterval(sessionId: string): void {
    const interval = this.pingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(sessionId);
    }
  }

  private handleSessionCreated(event: { sessionId: string; session: WebSocketTerminalSession }): void {
    this.log('info', `Session created: ${event.sessionId}`);
  }

  private handleSessionClosed(event: { sessionId: string }): void {
    this.log('info', `Session closed: ${event.sessionId}`);
  }

  private handleMessageReceived(event: { sessionId: string; message: WebSocketTerminalMessage }): void {
    if (this.config.enableProtocolLogging) {
      this.log('debug', `Message received from ${event.sessionId}: ${JSON.stringify(event.message)}`);
    }
  }

  private handleError(event: { sessionId: string; error: Error }): void {
    this.log('error', `Session error ${event.sessionId}: ${event.error.message}`);
  }

  private log(level: string, message: string): void {
    if (this.shouldLog(level)) {
      console.log(`[WebSocketTerminalProtocol:${level.toUpperCase()}] ${message}`);
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug', 'trace'];
    const currentLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): WebSocketTerminalSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.log('info', 'Cleaning up WebSocket terminal protocol');
    
    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));
    
    // Clear all timers
    this.reconnectTimers.forEach(timer => clearTimeout(timer));
    this.pingIntervals.forEach(interval => clearInterval(interval));
    
    // Clear maps
    this.sessions.clear();
    this.reconnectTimers.clear();
    this.pingIntervals.clear();
    this.latencyMeasurements.clear();
    this.persistenceStore.clear();
    
    this.removeAllListeners();
  }
}

/**
 * WebSocket Terminal Session Class
 */
class WebSocketTerminalSession extends EventEmitter {
  public readonly sessionId: string;
  private options: WebSocketTerminalConnectionOptions;
  private state: WebSocketTerminalSessionState;
  private config: WebSocketTerminalProtocolConfig;
  private webSocket?: WebSocket;
  private reconnectTimeout?: NodeJS.Timeout;
  private authAttempts = 0;
  private isAuthenticated = false;
  private messageQueue: WebSocketTerminalMessage[] = [];
  private sequenceNumber = 0;
  private fragmentBuffer: Map<string, Buffer[]> = new Map();

  constructor(
    sessionId: string,
    options: WebSocketTerminalConnectionOptions,
    state: WebSocketTerminalSessionState,
    config: WebSocketTerminalProtocolConfig
  ) {
    super();
    this.sessionId = sessionId;
    this.options = options;
    this.state = state;
    this.config = config;
  }

  /**
   * Connect to WebSocket terminal
   */
  async connect(): Promise<void> {
    try {
      this.state.connectionState = 'connecting';
      this.emit('connecting');
      
      // Create WebSocket connection
      await this.createWebSocketConnection();
      
      // Authenticate if required
      if (this.options.authType && this.options.authType !== 'none') {
        await this.authenticate();
      }
      
      // Send initial setup messages
      await this.sendInitialSetup();
      
      this.state.connectionState = 'connected';
      this.state.connectedAt = new Date();
      this.emit('connected');
      
    } catch (error) {
      this.state.connectionState = 'failed';
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket terminal
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    
    if (this.webSocket) {
      this.webSocket.terminate();
      this.webSocket = undefined;
    }
    
    this.state.connectionState = 'disconnected';
    this.emit('disconnected');
  }

  /**
   * Send data to terminal
   */
  async sendData(data: string | Buffer): Promise<void> {
    if (this.state.connectionState !== 'connected') {
      throw new Error('Session not connected');
    }
    
    const message: WebSocketTerminalMessage = {
      type: 'data',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: data,
      encoding: typeof data === 'string' ? 'utf8' : 'binary'
    };
    
    await this.sendMessage(message);
  }

  /**
   * Resize terminal
   */
  async resize(cols: number, rows: number): Promise<void> {
    if (this.state.connectionState !== 'connected') {
      throw new Error('Session not connected');
    }
    
    this.state.terminalSize = { cols, rows };
    
    const message: WebSocketTerminalMessage = {
      type: 'resize',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: { cols, rows }
    };
    
    await this.sendMessage(message);
  }

  /**
   * Send ping message
   */
  async ping(): Promise<void> {
    if (this.state.connectionState !== 'connected') {
      return;
    }
    
    this.state.lastPingTime = new Date();
    
    const message: WebSocketTerminalMessage = {
      type: 'ping',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: performance.now()
    };
    
    await this.sendMessage(message);
  }

  /**
   * Upload file to terminal
   */
  async uploadFile(localPath: string, remotePath: string, protocol?: string): Promise<string> {
    if (!this.config.enableFileTransfer) {
      throw new Error('File transfer is disabled');
    }
    
    const transferId = randomBytes(16).toString('hex');
    const fileStats = await fs.stat(localPath);
    
    const transfer: WebSocketFileTransfer = {
      transferId,
      sessionId: this.sessionId,
      direction: 'upload',
      localPath,
      remotePath,
      fileSize: fileStats.size,
      transferredBytes: 0,
      progress: 0,
      speed: 0,
      status: 'queued',
      protocol: (protocol || this.options.fileTransfer?.protocol || 'http') as any,
      startTime: new Date(),
      chunks: []
    };
    
    this.state.activeTransfers.set(transferId, transfer);
    
    try {
      await this.performFileTransfer(transfer);
      return transferId;
    } catch (error) {
      transfer.status = 'failed';
      transfer.error = (error as Error).message;
      throw error;
    }
  }

  /**
   * Download file from terminal
   */
  async downloadFile(remotePath: string, localPath: string, protocol?: string): Promise<string> {
    if (!this.config.enableFileTransfer) {
      throw new Error('File transfer is disabled');
    }
    
    const transferId = randomBytes(16).toString('hex');
    
    const transfer: WebSocketFileTransfer = {
      transferId,
      sessionId: this.sessionId,
      direction: 'download',
      localPath,
      remotePath,
      fileSize: 0, // Will be determined during transfer
      transferredBytes: 0,
      progress: 0,
      speed: 0,
      status: 'queued',
      protocol: (protocol || this.options.fileTransfer?.protocol || 'http') as any,
      startTime: new Date(),
      chunks: []
    };
    
    this.state.activeTransfers.set(transferId, transfer);
    
    try {
      await this.performFileTransfer(transfer);
      return transferId;
    } catch (error) {
      transfer.status = 'failed';
      transfer.error = (error as Error).message;
      throw error;
    }
  }

  /**
   * Create multiplex session
   */
  async createMultiplexSession(title?: string): Promise<string> {
    if (!this.config.enableMultiplexing) {
      throw new Error('Multiplexing is disabled');
    }
    
    const multiplexSessionId = randomBytes(16).toString('hex');
    
    const multiplexSession: WebSocketMultiplexSession = {
      sessionId: multiplexSessionId,
      parentSessionId: this.sessionId,
      title,
      active: false,
      createdAt: new Date(),
      lastActivity: new Date(),
      terminalSize: { ...this.state.terminalSize },
      cursorPosition: { x: 0, y: 0 },
      scrollPosition: 0,
      sharedScreen: false,
      participants: []
    };
    
    this.state.multiplexSessions?.set(multiplexSessionId, multiplexSession);
    
    const message: WebSocketTerminalMessage = {
      type: 'multiplex',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: {
        action: 'create',
        multiplexSessionId,
        title
      }
    };
    
    await this.sendMessage(message);
    
    this.emit('multiplex_session_created', multiplexSession);
    
    return multiplexSessionId;
  }

  /**
   * Switch multiplex session
   */
  async switchMultiplexSession(multiplexSessionId: string): Promise<void> {
    const multiplexSession = this.state.multiplexSessions?.get(multiplexSessionId);
    if (!multiplexSession) {
      throw new Error(`Multiplex session ${multiplexSessionId} not found`);
    }
    
    // Deactivate current session
    this.state.multiplexSessions?.forEach(session => {
      session.active = false;
    });
    
    // Activate target session
    multiplexSession.active = true;
    multiplexSession.lastActivity = new Date();
    
    const message: WebSocketTerminalMessage = {
      type: 'multiplex',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: {
        action: 'switch',
        multiplexSessionId
      }
    };
    
    await this.sendMessage(message);
  }

  private async createWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsOptions: any = {
          headers: this.options.headers || {}
        };
        
        // Add authentication headers
        if (this.options.authType === 'basic' && this.options.username && this.options.password) {
          const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString('base64');
          wsOptions.headers['Authorization'] = `Basic ${auth}`;
        } else if (this.options.authType === 'bearer' && this.options.token) {
          wsOptions.headers['Authorization'] = `Bearer ${this.options.token}`;
        }
        
        // Add cookies
        if (this.options.cookies) {
          wsOptions.headers['Cookie'] = Object.entries(this.options.cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
        }
        
        // SSL options
        if (this.options.ssl?.enabled) {
          wsOptions.ca = this.options.ssl.ca;
          wsOptions.cert = this.options.ssl.cert;
          wsOptions.key = this.options.ssl.key;
          wsOptions.passphrase = this.options.ssl.passphrase;
          wsOptions.rejectUnauthorized = this.options.ssl.rejectUnauthorized !== false;
        }
        
        // Create WebSocket
        this.webSocket = new WebSocket.WebSocket(
          this.options.url,
          this.options.protocol,
          wsOptions
        );
        
        this.webSocket.on('open', () => {
          this.state.readyState = WebSocket.WebSocket.OPEN;
          this.isAuthenticated = this.options.authType === 'none' || !this.options.authType;
          resolve();
        });
        
        this.webSocket.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });
        
        this.webSocket.on('close', (code: number, reason: string) => {
          this.state.readyState = WebSocket.WebSocket.CLOSED;
          this.handleClose(code, reason);
        });
        
        this.webSocket.on('error', (error: Error) => {
          this.state.readyState = WebSocket.WebSocket.CLOSED;
          reject(error);
        });
        
        this.webSocket.on('pong', (data: Buffer) => {
          this.handlePong(data);
        });
        
        // Set connection timeout
        const timeout = setTimeout(() => {
          this.webSocket?.terminate();
          reject(new Error('Connection timeout'));
        }, this.config.connectionTimeout);
        
        this.webSocket.on('open', () => clearTimeout(timeout));
        this.webSocket.on('error', () => clearTimeout(timeout));
        
      } catch (error) {
        reject(error);
      }
    });
  }

  private async authenticate(): Promise<void> {
    if (!this.options.authType || this.options.authType === 'none') {
      this.isAuthenticated = true;
      return;
    }
    
    this.authAttempts++;
    
    if (this.authAttempts > this.config.maxAuthAttempts) {
      throw new Error('Maximum authentication attempts exceeded');
    }
    
    const authMessage: WebSocketTerminalMessage = {
      type: 'auth',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: this.createAuthData()
    };
    
    await this.sendMessage(authMessage);
    
    // Wait for authentication response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 5000);
      
      const handler = (success: boolean) => {
        clearTimeout(timeout);
        if (success) {
          this.isAuthenticated = true;
          resolve();
        } else {
          reject(new Error('Authentication failed'));
        }
      };
      
      this.once('auth_success', () => handler(true));
      this.once('auth_failure', () => handler(false));
    });
  }

  private createAuthData(): any {
    switch (this.options.authType) {
      case 'basic':
        return {
          method: 'basic',
          username: this.options.username,
          password: this.options.password
        };
      case 'bearer':
        return {
          method: 'bearer',
          token: this.options.token
        };
      case 'cookie':
        return {
          method: 'cookie',
          cookies: this.options.cookies
        };
      case 'query':
        return {
          method: 'query',
          apiKey: this.options.apiKey
        };
      case 'custom':
        return {
          method: 'custom',
          ...this.options.customAuth
        };
      default:
        return {};
    }
  }

  private async sendInitialSetup(): Promise<void> {
    // Send terminal type and size
    const setupMessage: WebSocketTerminalMessage = {
      type: 'control',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: {
        action: 'setup',
        terminalType: this.options.terminalType || this.config.defaultTerminalType,
        encoding: this.options.encoding || this.config.defaultEncoding,
        size: this.state.terminalSize,
        protocolOptions: this.options.protocolOptions
      }
    };
    
    await this.sendMessage(setupMessage);
  }

  private async sendMessage(message: WebSocketTerminalMessage): Promise<void> {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.WebSocket.OPEN) {
      this.messageQueue.push(message);
      return;
    }
    
    try {
      let data: string | Buffer;
      
      if (message.encoding === 'binary' && Buffer.isBuffer(message.data)) {
        data = message.data;
      } else {
        data = JSON.stringify(message);
      }
      
      // Handle compression
      if (this.options.compression && message.compressed) {
        // Implement compression logic here
      }
      
      this.webSocket.send(data);
      this.state.statistics.messagesSent++;
      this.state.statistics.bytesSent += data.length;
      
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      this.state.statistics.messagesReceived++;
      this.state.statistics.bytesReceived += this.getDataLength(data);
      this.state.lastActivity = new Date();
      
      let message: WebSocketTerminalMessage;
      
      if (Buffer.isBuffer(data)) {
        // Handle Buffer data
        if (this.isTerminalData(data)) {
          message = {
            type: 'data',
            sessionId: this.sessionId,
            timestamp: new Date(),
            data: data,
            encoding: 'binary'
          };
        } else {
          // Try to parse as JSON
          message = JSON.parse(data.toString());
        }
      } else if (data instanceof ArrayBuffer) {
        // Handle ArrayBuffer data
        const buffer = Buffer.from(data);
        if (this.isTerminalData(buffer)) {
          message = {
            type: 'data',
            sessionId: this.sessionId,
            timestamp: new Date(),
            data: buffer,
            encoding: 'binary'
          };
        } else {
          // Try to parse as JSON
          message = JSON.parse(buffer.toString());
        }
      } else if (Array.isArray(data)) {
        // Handle Buffer array data
        const combinedBuffer = Buffer.concat(data);
        if (this.isTerminalData(combinedBuffer)) {
          message = {
            type: 'data',
            sessionId: this.sessionId,
            timestamp: new Date(),
            data: combinedBuffer,
            encoding: 'binary'
          };
        } else {
          // Try to parse as JSON
          message = JSON.parse(combinedBuffer.toString());
        }
      } else if (typeof data === 'string') {
        // Handle string data
        try {
          message = JSON.parse(data);
        } catch {
          // Raw terminal data
          message = {
            type: 'data',
            sessionId: this.sessionId,
            timestamp: new Date(),
            data: data,
            encoding: 'utf8'
          };
        }
      } else {
        // Fallback for other data types (should never happen with current WebSocket.Data types)
        const dataStr = String(data);
        try {
          message = JSON.parse(dataStr);
        } catch {
          message = {
            type: 'data',
            sessionId: this.sessionId,
            timestamp: new Date(),
            data: dataStr,
            encoding: 'utf8'
          };
        }
      }
      
      this.processMessage(message);
      
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private processMessage(message: WebSocketTerminalMessage): void {
    switch (message.type) {
      case 'data':
        this.emit('data', message.data);
        break;
        
      case 'pong':
        this.handlePong(message.data);
        break;
        
      case 'auth':
        this.handleAuthResponse(message.data);
        break;
        
      case 'control':
        this.handleControlMessage(message.data);
        break;
        
      case 'file':
        this.handleFileMessage(message.data);
        break;
        
      case 'multiplex':
        this.handleMultiplexMessage(message.data);
        break;
        
      case 'resize':
        // Handle resize acknowledgment
        break;
        
      default:
        // Custom message handler
        const customHandler = this.options.messageHandlers?.[message.type];
        if (customHandler) {
          customHandler(message.data);
        }
        break;
    }
    
    this.emit('message_received', message);
  }

  private getDataLength(data: WebSocket.Data): number {
    if (typeof data === 'string') {
      return data.length;
    } else if (Buffer.isBuffer(data)) {
      return data.length;
    } else if (data instanceof ArrayBuffer) {
      return data.byteLength;
    } else if (Array.isArray(data)) {
      return data.reduce((total, buffer) => total + buffer.length, 0);
    } else {
      // Fallback for any other type (should never happen with current WebSocket.Data types)
      return String(data).length;
    }
  }

  private isTerminalData(data: Buffer): boolean {
    // Simple heuristic to detect terminal data vs protocol messages
    // Check for common terminal escape sequences or control characters
    const str = data.toString('ascii', 0, Math.min(100, data.length));
    return /[\x00-\x1f\x7f-\xff]/.test(str) && !str.startsWith('{');
  }

  private handlePong(data: any): void {
    this.state.lastPongTime = new Date();
    
    if (typeof data === 'number') {
      const now = performance.now();
      const latency = now - data;
      this.updateLatencyStats(latency);
    }
  }

  private updateLatencyStats(latency: number): void {
    this.state.latency = latency;
    this.state.statistics.maxLatency = Math.max(this.state.statistics.maxLatency, latency);
    this.state.statistics.minLatency = Math.min(this.state.statistics.minLatency, latency);
    
    // Calculate rolling average
    if (!this.state.statistics.avgLatency) {
      this.state.statistics.avgLatency = latency;
    } else {
      this.state.statistics.avgLatency = (this.state.statistics.avgLatency * 0.9) + (latency * 0.1);
    }
  }

  private handleAuthResponse(data: any): void {
    if (data.success) {
      this.emit('auth_success');
    } else {
      this.emit('auth_failure');
    }
  }

  private handleControlMessage(data: any): void {
    switch (data.action) {
      case 'resize_ack':
        // Handle resize acknowledgment
        break;
      case 'capabilities':
        // Handle server capabilities
        break;
      default:
        break;
    }
  }

  private handleFileMessage(data: any): void {
    const transfer = this.state.activeTransfers.get(data.transferId);
    if (transfer) {
      this.processFileTransferMessage(transfer, data);
    }
  }

  private handleMultiplexMessage(data: any): void {
    switch (data.action) {
      case 'created':
        // Multiplex session created acknowledgment
        break;
      case 'switched':
        // Session switch acknowledgment
        break;
      case 'data':
        // Data from specific multiplex session
        this.emit('multiplex_data', data);
        break;
      default:
        break;
    }
  }

  private handleClose(code: number, reason: string): void {
    this.state.connectionState = 'disconnected';
    this.emit('disconnected', { code, reason });
    
    // Attempt reconnection if enabled
    if (this.shouldReconnect()) {
      this.scheduleReconnect();
    }
  }

  private shouldReconnect(): boolean {
    return (
      this.state.reconnectCount < (this.options.maxRetries || this.config.maxRetries) &&
      this.state.connectionState !== 'failed'
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    let delay = this.options.retryDelay || this.config.retryDelay;
    
    if (this.options.exponentialBackoff !== false && this.config.exponentialBackoff) {
      delay = Math.min(delay * Math.pow(2, this.state.reconnectCount), this.config.maxRetryDelay);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    try {
      this.state.connectionState = 'reconnecting';
      this.state.reconnectCount++;
      this.emit('reconnecting');
      
      await this.connect();
      
      // Flush queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          await this.sendMessage(message);
        }
      }
      
      this.state.statistics.reconnections++;
      
    } catch (error) {
      this.handleError(error as Error);
      
      if (this.shouldReconnect()) {
        this.scheduleReconnect();
      } else {
        this.state.connectionState = 'failed';
      }
    }
  }

  private async performFileTransfer(transfer: WebSocketFileTransfer): Promise<void> {
    transfer.status = 'transferring';
    
    try {
      switch (transfer.protocol) {
        case 'http':
          await this.performHttpFileTransfer(transfer);
          break;
        case 'zmodem':
          await this.performZmodemTransfer(transfer);
          break;
        case 'xmodem':
        case 'ymodem':
        case 'kermit':
          await this.performSerialProtocolTransfer(transfer);
          break;
        default:
          throw new Error(`Unsupported transfer protocol: ${transfer.protocol}`);
      }
      
      transfer.status = 'completed';
      transfer.endTime = new Date();
      transfer.progress = 100;
      
    } catch (error) {
      transfer.status = 'failed';
      transfer.error = (error as Error).message;
      throw error;
    } finally {
      this.emit('file_transfer_progress', transfer);
    }
  }

  private async performHttpFileTransfer(transfer: WebSocketFileTransfer): Promise<void> {
    // Implementation for HTTP-based file transfer over WebSocket
    const chunkSize = this.options.fileTransfer?.chunkSize || 64 * 1024; // 64KB chunks
    
    if (transfer.direction === 'upload') {
      const fileData = await fs.readFile(transfer.localPath);
      const totalChunks = Math.ceil(fileData.length / chunkSize);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileData.length);
        const chunk = fileData.subarray(start, end);
        
        const message: WebSocketTerminalMessage = {
          type: 'file',
          sessionId: this.sessionId,
          timestamp: new Date(),
          sequenceNumber: this.sequenceNumber++,
          data: {
            transferId: transfer.transferId,
            action: 'upload_chunk',
            chunkIndex: i,
            totalChunks,
            chunk: chunk.toString('base64')
          }
        };
        
        await this.sendMessage(message);
        
        transfer.transferredBytes = end;
        transfer.progress = (end / transfer.fileSize) * 100;
        
        this.emit('file_transfer_progress', transfer);
        
        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } else {
      // Download implementation
      const message: WebSocketTerminalMessage = {
        type: 'file',
        sessionId: this.sessionId,
        timestamp: new Date(),
        sequenceNumber: this.sequenceNumber++,
        data: {
          transferId: transfer.transferId,
          action: 'download_start',
          remotePath: transfer.remotePath
        }
      };
      
      await this.sendMessage(message);
    }
  }

  private async performZmodemTransfer(transfer: WebSocketFileTransfer): Promise<void> {
    // Implementation for ZMODEM protocol
    // This is a simplified version - full ZMODEM implementation would be more complex
    
    const initMessage: WebSocketTerminalMessage = {
      type: 'file',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: {
        transferId: transfer.transferId,
        action: 'zmodem_init',
        direction: transfer.direction,
        localPath: transfer.localPath,
        remotePath: transfer.remotePath
      }
    };
    
    await this.sendMessage(initMessage);
  }

  private async performSerialProtocolTransfer(transfer: WebSocketFileTransfer): Promise<void> {
    // Implementation for XMODEM/YMODEM/Kermit protocols
    throw new Error(`${transfer.protocol} protocol not yet implemented`);
  }

  private processFileTransferMessage(transfer: WebSocketFileTransfer, data: any): void {
    switch (data.action) {
      case 'chunk_received':
        // Update progress
        transfer.transferredBytes += data.chunkSize;
        transfer.progress = (transfer.transferredBytes / transfer.fileSize) * 100;
        this.emit('file_transfer_progress', transfer);
        break;
        
      case 'download_chunk':
        // Handle received download chunk
        this.processDownloadChunk(transfer, data);
        break;
        
      case 'transfer_complete':
        transfer.status = 'completed';
        transfer.endTime = new Date();
        transfer.progress = 100;
        this.emit('file_transfer_progress', transfer);
        break;
        
      case 'transfer_error':
        transfer.status = 'failed';
        transfer.error = data.error;
        this.emit('file_transfer_progress', transfer);
        break;
    }
  }

  private async processDownloadChunk(transfer: WebSocketFileTransfer, data: any): Promise<void> {
    // Reconstruct file from chunks
    const chunk = Buffer.from(data.chunk, 'base64');
    
    if (!transfer.chunks[data.chunkIndex]) {
      transfer.chunks[data.chunkIndex] = {
        index: data.chunkIndex,
        size: chunk.length,
        acknowledged: true
      };
    }
    
    // Write chunk to temporary buffer or file
    // Implementation would depend on specific requirements
    
    transfer.transferredBytes += chunk.length;
    transfer.progress = (transfer.transferredBytes / transfer.fileSize) * 100;
    
    this.emit('file_transfer_progress', transfer);
    
    // Send acknowledgment
    const ackMessage: WebSocketTerminalMessage = {
      type: 'file',
      sessionId: this.sessionId,
      timestamp: new Date(),
      sequenceNumber: this.sequenceNumber++,
      data: {
        transferId: transfer.transferId,
        action: 'chunk_ack',
        chunkIndex: data.chunkIndex
      }
    };
    
    await this.sendMessage(ackMessage);
  }

  private handleError(error: Error): void {
    this.state.statistics.errors++;
    this.state.lastError = error.message;
    this.state.errorHistory.push({
      timestamp: new Date(),
      error: error.message,
      code: (error as any).code
    });
    
    // Keep only last 10 errors
    if (this.state.errorHistory.length > 10) {
      this.state.errorHistory.shift();
    }
    
    this.emit('error', error);
  }
}

export default WebSocketTerminalProtocol;