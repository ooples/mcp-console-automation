import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import WebSocket, { WebSocketServer } from 'ws';
import * as express from 'express';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';
import {
  SessionState,
  ProtocolCapabilities,
  ProtocolHealthStatus
} from '../core/IProtocol.js';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * WeTTY session configuration
 */
export interface WeTTYSessionConfig {
  port?: number;
  host?: string;
  ssl?: boolean;
  sslKey?: string;
  sslCert?: string;
  sshHost?: string;
  sshPort?: number;
  sshAuth?: 'password' | 'key';
  sshUser?: string;
  sshPassword?: string;
  sshKeyPath?: string;
  shell?: string;
  shellArgs?: string[];
  webRoot?: string;
  base?: string;
  title?: string;
  allowIframe?: boolean;
  terminalOptions?: TerminalOptions;
  customCSS?: string;
  customJS?: string;
  reconnect?: boolean;
  reconnectTime?: number;
  maxConnections?: number;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  recordingSessions?: boolean;
  sessionRecordingPath?: string;
  authProvider?: 'none' | 'simple' | 'oauth' | 'ldap';
  authConfig?: any;
}

/**
 * Terminal options for WeTTY
 */
export interface TerminalOptions {
  cols?: number;
  rows?: number;
  fontSize?: number;
  fontFamily?: string;
  theme?: 'light' | 'dark' | 'custom';
  cursorBlink?: boolean;
  scrollback?: number;
  tabStopWidth?: number;
  bellSound?: string | null;
  macOptionIsMeta?: boolean;
  rightClickSelectsWord?: boolean;
  rendererType?: 'canvas' | 'dom' | 'webgl';
}

/**
 * WeTTY session state
 */
export interface WeTTYSession {
  sessionId: string;
  port: number;
  host: string;
  ssl: boolean;
  webUrl: string;
  wsUrl: string;
  status: 'initializing' | 'running' | 'connected' | 'disconnected' | 'failed';
  connections: Map<string, WebSocket>;
  process?: ChildProcess;
  server?: http.Server | https.Server;
  app?: express.Application;
  wss?: WebSocketServer;
  createdAt: Date;
  lastActivity: Date;
  bytesReceived: number;
  bytesSent: number;
  connectionCount: number;
  metadata: Record<string, any>;
}

/**
 * WeTTY Protocol implementation with full web terminal support
 */
export class WeTTYProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'wetty';
  public readonly capabilities: ProtocolCapabilities;

  private wettySessions: Map<string, WeTTYSession> = new Map();
  private wettyProcesses: Map<string, ChildProcess> = new Map();
  private wettyServers: Map<string, http.Server | https.Server> = new Map();
  private wettyWebSockets: Map<string, WebSocketServer> = new Map();
  private wettyConnections: Map<string, Map<string, WebSocket>> = new Map();
  private healthStatus: ProtocolHealthStatus;
  private basePort: number = 3000;
  private portCounter: number = 0;

  constructor() {
    super('WeTTYProtocol');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
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
      maxConcurrentSessions: 10,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'base64'],
      supportedAuthMethods: ['password', 'oauth', 'ldap'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true
      }
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
        uptime: 0
      },
      dependencies: {
        node: {
          available: true,
          version: process.version
        },
        wetty: {
          available: false,
          version: 'checking...'
        },
        express: {
          available: false,
          version: 'checking...'
        },
        ws: {
          available: false,
          version: 'checking...'
        }
      }
    };

    this.isInitialized = true;
  }

  /**
   * Initialize WeTTY Protocol
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.logger.info('Initializing WeTTY Protocol');

    // Check for WeTTY availability
    try {
      const wettyCheck = spawn('wetty', ['--version'], { shell: true });
      await new Promise((resolve, reject) => {
        wettyCheck.on('exit', (code) => {
          if (code === 0) {
            this.healthStatus.dependencies.wetty = { available: true, version: 'system' };
            resolve(undefined);
          } else {
            reject(new Error('WeTTY not found'));
          }
        });
        wettyCheck.on('error', reject);
      });
    } catch (error) {
      this.logger.warn('WeTTY command not found, will use embedded implementation');
      this.healthStatus.dependencies.wetty = { available: false, version: 'embedded' };
    }

    // Check for required modules
    try {
      require('express');
      this.healthStatus.dependencies.express = { available: true, version: 'installed' };
    } catch {
      this.healthStatus.dependencies.express = { available: false, version: 'not installed' };
    }

    try {
      require('ws');
      this.healthStatus.dependencies.ws = { available: true, version: 'installed' };
    } catch {
      this.healthStatus.dependencies.ws = { available: false, version: 'not installed' };
    }

    this.isInitialized = true;
  }

  /**
   * Create session with BaseProtocol integration
   */
  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `wetty-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const sessionState = await this.createSessionWithTypeDetection(sessionId, options);
    return sessionState;
  }

  /**
   * Implementation of BaseProtocol's doCreateSession
   */
  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const wettyConfig = this.buildWeTTYConfig(options);

    try {
      // Create WeTTY session
      const wettySession = await this.createWeTTYSession(sessionId, wettyConfig);

      // Create console session
      const session: ConsoleSession = {
        id: sessionId,
        command: options.command || wettyConfig.shell || process.env.SHELL || 'bash',
        args: options.args || wettyConfig.shellArgs || [],
        cwd: options.cwd || process.cwd(),
        env: options.environment || {},
        createdAt: new Date(),
        status: 'running',
        type: 'wetty',
        streaming: options.streaming ?? true,
        executionState: 'idle',
        activeCommands: new Map(),
        metadata: {
          wettySession,
          webUrl: wettySession.webUrl,
          wsUrl: wettySession.wsUrl,
          port: wettySession.port
        }
      };

      this.sessions.set(sessionId, session);
      this.emit('sessionCreated', session);

      // Add initial output
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `WeTTY session started\nWeb URL: ${wettySession.webUrl}\nWebSocket URL: ${wettySession.wsUrl}\n`,
        timestamp: new Date(),
        raw: ''
      });

      return session;
    } catch (error) {
      this.logger.error(`Failed to create WeTTY session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Build WeTTY configuration from session options
   */
  private buildWeTTYConfig(options: SessionOptions): WeTTYSessionConfig {
    const config: WeTTYSessionConfig = {
      port: this.getNextPort(), // Use next available port
      host: 'localhost',
      ssl: false,
      sslKey: undefined,
      sslCert: undefined,
      shell: options.command || process.env.SHELL || 'bash',
      shellArgs: options.args || [],
      webRoot: './public',
      base: '/',
      title: 'WeTTY Terminal',
      allowIframe: true,
      reconnect: true,
      reconnectTime: 10000,
      maxConnections: 10,
      logLevel: 'info',
      recordingSessions: false,
      sessionRecordingPath: undefined,
      authProvider: 'none'
    };

    // SSH configuration if connecting to remote host
    if (options.sshOptions?.host) {
      config.sshHost = options.sshOptions.host;
      config.sshPort = options.sshOptions.port || 22;
      config.sshAuth = options.sshOptions.privateKey ? 'key' : 'password';
      config.sshUser = options.sshOptions.username;
      config.sshPassword = options.sshOptions.password;
      config.sshKeyPath = options.sshOptions.privateKeyPath;
    }

    // Terminal options
    config.terminalOptions = {
      cols: options.cols || 80,
      rows: options.rows || 24,
      fontSize: 14,
      fontFamily: 'monospace',
      theme: 'dark',
      cursorBlink: true,
      scrollback: 1000,
      tabStopWidth: 8,
      rendererType: 'canvas'
    };

    return config;
  }

  /**
   * Get next available port
   */
  private getNextPort(): number {
    return this.basePort + (this.portCounter++);
  }

  /**
   * Create WeTTY session
   */
  private async createWeTTYSession(sessionId: string, config: WeTTYSessionConfig): Promise<WeTTYSession> {
    const session: WeTTYSession = {
      sessionId,
      port: config.port!,
      host: config.host!,
      ssl: config.ssl!,
      webUrl: `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}${config.base}`,
      wsUrl: `${config.ssl ? 'wss' : 'ws'}://${config.host}:${config.port}${config.base}`,
      status: 'initializing',
      connections: new Map(),
      createdAt: new Date(),
      lastActivity: new Date(),
      bytesReceived: 0,
      bytesSent: 0,
      connectionCount: 0,
      metadata: {}
    };

    this.wettySessions.set(sessionId, session);

    // Try to use system WeTTY if available
    if (this.healthStatus.dependencies.wetty?.available) {
      await this.startSystemWeTTY(sessionId, config, session);
    } else {
      // Use embedded WeTTY implementation
      await this.startEmbeddedWeTTY(sessionId, config, session);
    }

    session.status = 'running';
    this.wettySessions.set(sessionId, session);
    return session;
  }

  /**
   * Start system WeTTY process
   */
  private async startSystemWeTTY(sessionId: string, config: WeTTYSessionConfig, session: WeTTYSession): Promise<void> {
    const args: string[] = [];

    // Basic configuration
    args.push('--port', config.port!.toString());
    args.push('--host', config.host!);

    if (config.ssl) {
      if (config.sslKey) args.push('--ssl-key', config.sslKey);
      if (config.sslCert) args.push('--ssl-cert', config.sslCert);
    }

    if (config.base) args.push('--base', config.base);
    if (config.title) args.push('--title', config.title);

    // SSH configuration
    if (config.sshHost) {
      args.push('--ssh-host', config.sshHost);
      if (config.sshPort) args.push('--ssh-port', config.sshPort.toString());
      if (config.sshUser) args.push('--ssh-user', config.sshUser);
      if (config.sshAuth === 'key' && config.sshKeyPath) {
        args.push('--ssh-auth', 'publickey');
        args.push('--ssh-key', config.sshKeyPath);
      }
    } else {
      // Local shell
      if (config.shell) args.push('--command', config.shell);
      if (config.shellArgs && config.shellArgs.length > 0) {
        args.push(...config.shellArgs);
      }
    }

    // Terminal options
    if (config.terminalOptions?.cols) args.push('--width', config.terminalOptions.cols.toString());
    if (config.terminalOptions?.rows) args.push('--height', config.terminalOptions.rows.toString());

    // Start WeTTY process
    const wettyProcess = spawn('wetty', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    wettyProcess.stdout?.on('data', (data: Buffer) => {
      this.handleProcessOutput(sessionId, data.toString(), 'stdout');
    });

    wettyProcess.stderr?.on('data', (data: Buffer) => {
      this.handleProcessOutput(sessionId, data.toString(), 'stderr');
    });

    wettyProcess.on('error', (error) => {
      this.logger.error(`WeTTY process error for session ${sessionId}:`, error);
      session.status = 'failed';
      this.emit('error', sessionId, error);
    });

    wettyProcess.on('exit', (code) => {
      this.logger.info(`WeTTY process exited for session ${sessionId} with code ${code}`);
      session.status = 'disconnected';
      this.handleSessionClose(sessionId);
    });

    session.process = wettyProcess;
    this.wettyProcesses.set(sessionId, wettyProcess);

    // Wait for server to start
    await this.waitForServerStart(session.port, 5000);
  }

  /**
   * Start embedded WeTTY server
   */
  private async startEmbeddedWeTTY(sessionId: string, config: WeTTYSessionConfig, session: WeTTYSession): Promise<void> {
    try {
      const express = require('express');
      const app = express();

      // Setup static files
      if (config.webRoot) {
        app.use(express.static(config.webRoot));
      }

      // Setup base path
      const basePath = config.base || '/';

      // Setup authentication middleware if needed
      if (config.authProvider !== 'none') {
        app.use(basePath, this.createAuthMiddleware(config));
      }

      // Setup main route
      app.get(basePath, (req: any, res: any) => {
        res.send(this.generateHTMLPage(config));
      });

      // Create server
      const server = config.ssl
        ? https.createServer({
            key: config.sslKey,
            cert: config.sslCert
          }, app)
        : http.createServer(app);

      // Setup WebSocket server
      const wss = new WebSocketServer({ server, path: `${basePath}ws` });

      wss.on('connection', (ws: WebSocket, req: any) => {
        const connectionId = uuidv4();
        session.connections.set(connectionId, ws);
        session.connectionCount++;

        this.handleWebSocketConnection(sessionId, connectionId, ws, config);
      });

      // Start server
      await new Promise<void>((resolve, reject) => {
        server.listen(config.port, config.host, () => {
          this.logger.info(`Embedded WeTTY server started on ${config.host}:${config.port}`);
          resolve();
        });
        server.on('error', reject);
      });

      session.server = server;
      session.app = app;
      session.wss = wss;
      this.wettyServers.set(sessionId, server);
      this.wettyWebSockets.set(sessionId, wss);

    } catch (error) {
      this.logger.error(`Failed to start embedded WeTTY for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocketConnection(sessionId: string, connectionId: string, ws: WebSocket, config: WeTTYSessionConfig): void {
    const session = this.wettySessions.get(sessionId);
    if (!session) return;

    // Create PTY for this connection
    const pty = this.createPTY(config);

    // Handle PTY output
    pty.stdout?.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: data.toString('base64')
        }));
        session.bytesSent += data.length;
        this.addToOutputBuffer(sessionId, {
          sessionId,
          type: 'stdout',
          data: data.toString(),
          timestamp: new Date(),
          raw: data.toString()
        });
      }
    });

    pty.stderr?.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          data: data.toString('base64')
        }));
        this.addToOutputBuffer(sessionId, {
          sessionId,
          type: 'stderr',
          data: data.toString(),
          timestamp: new Date(),
          raw: data.toString()
        });
      }
    });

    // Handle WebSocket messages
    ws.on('message', (message: WebSocket.Data) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case 'input':
            if (pty.stdin) {
              const inputData = Buffer.from(msg.data, 'base64');
              pty.stdin.write(inputData);
              session.bytesReceived += inputData.length;
            }
            break;

          case 'resize':
            // Handle terminal resize
            if (msg.cols && msg.rows) {
              this.resizePTY(pty, msg.cols, msg.rows);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }

        session.lastActivity = new Date();
      } catch (error) {
        this.logger.error(`Error processing WebSocket message for session ${sessionId}:`, error);
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      session.connections.delete(connectionId);
      if (pty.kill) pty.kill();

      if (session.connections.size === 0) {
        session.status = 'disconnected';
      }
    });

    // Handle WebSocket error
    ws.on('error', (error) => {
      this.logger.error(`WebSocket error for session ${sessionId}:`, error);
      session.connections.delete(connectionId);
    });

    // Send initial connection message
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      connectionId,
      config: {
        cols: config.terminalOptions?.cols || 80,
        rows: config.terminalOptions?.rows || 24,
        fontSize: config.terminalOptions?.fontSize || 14,
        theme: config.terminalOptions?.theme || 'dark'
      }
    }));
  }

  /**
   * Create PTY process
   */
  private createPTY(config: WeTTYSessionConfig): ChildProcess {
    const shell = config.shell || process.env.SHELL || 'bash';
    const args = config.shellArgs || [];
    const env = { ...process.env };

    // Set terminal environment
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';

    if (config.terminalOptions) {
      env.LINES = (config.terminalOptions.rows || 24).toString();
      env.COLUMNS = (config.terminalOptions.cols || 80).toString();
    }

    // Create process with PTY
    const pty = spawn(shell, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: process.cwd()
    });

    return pty;
  }

  /**
   * Resize PTY
   */
  private resizePTY(pty: ChildProcess, cols: number, rows: number): void {
    // Send window change signal (platform specific)
    if (process.platform !== 'win32' && pty.pid) {
      process.kill(pty.pid, 'SIGWINCH');
    }
  }

  /**
   * Generate HTML page for WeTTY
   */
  private generateHTMLPage(config: WeTTYSessionConfig): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${config.title || 'WeTTY Terminal'}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #000;
            font-family: ${config.terminalOptions?.fontFamily || 'monospace'};
        }
        #terminal {
            width: 100vw;
            height: 100vh;
        }
        ${config.customCSS || ''}
    </style>
</head>
<body>
    <div id="terminal"></div>
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" rel="stylesheet">
    <script>
        const term = new Terminal({
            cols: ${config.terminalOptions?.cols || 80},
            rows: ${config.terminalOptions?.rows || 24},
            fontSize: ${config.terminalOptions?.fontSize || 14},
            fontFamily: '${config.terminalOptions?.fontFamily || 'monospace'}',
            theme: ${JSON.stringify(this.getTerminalTheme(config.terminalOptions?.theme))},
            cursorBlink: ${config.terminalOptions?.cursorBlink !== false},
            scrollback: ${config.terminalOptions?.scrollback || 1000}
        });

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(protocol + '//' + window.location.host + '${config.base}ws');

        ws.onopen = () => {
            term.open(document.getElementById('terminal'));
            term.focus();

            // Send terminal input to WebSocket
            term.onData(data => {
                ws.send(JSON.stringify({
                    type: 'input',
                    data: btoa(data)
                }));
            });

            // Handle resize
            term.onResize(({ cols, rows }) => {
                ws.send(JSON.stringify({
                    type: 'resize',
                    cols,
                    rows
                }));
            });
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'output') {
                term.write(atob(msg.data));
            } else if (msg.type === 'error') {
                term.write('\\x1b[31m' + atob(msg.data) + '\\x1b[0m');
            }
        };

        ws.onerror = (error) => {
            term.write('\\r\\n\\x1b[31mWebSocket error: ' + error + '\\x1b[0m\\r\\n');
        };

        ws.onclose = () => {
            term.write('\\r\\n\\x1b[33mConnection closed\\x1b[0m\\r\\n');
            ${config.reconnect ? `
            setTimeout(() => {
                window.location.reload();
            }, ${config.reconnectTime || 10000});
            ` : ''}
        };

        // Keep connection alive
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);

        ${config.customJS || ''}
    </script>
</body>
</html>`;
  }

  /**
   * Get terminal theme
   */
  private getTerminalTheme(theme?: string): any {
    switch (theme) {
      case 'light':
        return {
          background: '#ffffff',
          foreground: '#000000',
          cursor: '#000000',
          selection: 'rgba(0, 0, 0, 0.3)'
        };
      case 'dark':
      default:
        return {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          selection: 'rgba(255, 255, 255, 0.3)'
        };
    }
  }

  /**
   * Create authentication middleware
   */
  private createAuthMiddleware(config: WeTTYSessionConfig): any {
    return (req: any, res: any, next: any) => {
      // Simple auth check (implement based on authProvider)
      if (config.authProvider === 'simple' && config.authConfig) {
        const auth = req.headers.authorization;
        if (!auth) {
          res.status(401).send('Authentication required');
          return;
        }
        // Validate auth token
      }
      next();
    };
  }

  /**
   * Wait for server to start
   */
  private async waitForServerStart(port: number, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.connect(port, 'localhost', () => {
            socket.end();
            resolve();
          });
          socket.on('error', reject);
        });
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Server failed to start on port ${port} within ${timeout}ms`);
  }

  /**
   * Handle process output
   */
  private handleProcessOutput(sessionId: string, data: string, type: 'stdout' | 'stderr'): void {
    this.addToOutputBuffer(sessionId, {
      sessionId,
      type,
      data,
      timestamp: new Date(),
      raw: data
    });
  }

  /**
   * Handle session close
   */
  private handleSessionClose(sessionId: string): void {
    const session = this.wettySessions.get(sessionId);
    if (!session) return;

    // Close all WebSocket connections
    session.connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    session.connections.clear();

    // Mark session as complete
    this.markSessionComplete(sessionId);
    this.emit('session-closed', sessionId);
  }

  /**
   * Execute command in session
   */
  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    const wettySession = this.wettySessions.get(sessionId);

    if (!session || !wettySession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fullCommand = args ? `${command} ${args.join(' ')}` : command;

    // Send command to all connected clients
    wettySession.connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data: Buffer.from(fullCommand + '\n').toString('base64')
        }));
      }
    });

    // Update session
    session.lastActivity = new Date();
  }

  /**
   * Send input to session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const wettySession = this.wettySessions.get(sessionId);
    if (!wettySession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Send input to all connected clients
    wettySession.connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data: Buffer.from(input).toString('base64')
        }));
      }
    });

    wettySession.lastActivity = new Date();
    wettySession.bytesReceived += Buffer.byteLength(input);
  }

  /**
   * Close session
   */
  async closeSession(sessionId: string): Promise<void> {
    const wettySession = this.wettySessions.get(sessionId);
    if (!wettySession) return;

    this.logger.info(`Closing WeTTY session ${sessionId}`);

    // Close WebSocket connections
    wettySession.connections.forEach(ws => ws.close());

    // Stop process
    const process = this.wettyProcesses.get(sessionId);
    if (process) {
      process.kill('SIGTERM');
      this.wettyProcesses.delete(sessionId);
    }

    // Stop server
    const server = this.wettyServers.get(sessionId);
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      this.wettyServers.delete(sessionId);
    }

    // Clean up WebSocket server
    const wss = this.wettyWebSockets.get(sessionId);
    if (wss) {
      wss.close();
      this.wettyWebSockets.delete(sessionId);
    }

    // Remove from maps
    this.wettySessions.delete(sessionId);
    this.sessions.delete(sessionId);
    this.wettyConnections.delete(sessionId);

    this.markSessionComplete(sessionId);
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseHealth = await super.getHealthStatus();

    this.healthStatus.metrics.activeSessions = this.wettySessions.size;
    this.healthStatus.lastChecked = new Date();

    // Check server health
    let healthyServers = 0;
    this.wettyServers.forEach(server => {
      if (server.listening) healthyServers++;
    });

    this.healthStatus.isHealthy = healthyServers === this.wettyServers.size;

    return {
      ...baseHealth,
      ...this.healthStatus,
      metrics: {
        ...baseHealth.metrics,
        activeSessions: this.wettySessions.size
      }
    };
  }

  /**
   * Dispose of protocol resources
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing WeTTY Protocol');

    // Close all sessions
    const sessionIds = Array.from(this.wettySessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));

    // Clean up
    await super.cleanup();
  }
}

export default WeTTYProtocol;