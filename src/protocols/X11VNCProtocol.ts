import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ProtocolCapabilities,
  ProtocolHealthStatus,
  SessionState,
} from '../core/IProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput,
} from '../types/index.js';

/**
 * X11VNC server configuration
 */
interface X11VNCConfig {
  display?: string;
  port?: number;
  password?: string;
  passwordFile?: string;
  viewOnly?: boolean;
  shared?: boolean;
  forever?: boolean;
  loop?: boolean;
  allowLocal?: boolean;
  ssl?: boolean;
  sslOnly?: boolean;
  sslCertFile?: string;
  sslKeyFile?: string;
  stunnel?: boolean;
  httpPort?: number;
  httpDir?: string;
  scale?: string;
  geometry?: string;
  cursor?: boolean;
  noCursor?: boolean;
  arrow?: boolean;
  fixScreen?: boolean;
  noRepeat?: boolean;
  speeds?: string;
  wait?: number;
  defer?: number;
  readTimeout?: number;
  acceptMode?: 'once' | 'prompt' | 'gone';
  gone?: string;
  users?: string;
  clipboardFile?: string;
  noClipboard?: boolean;
  selectionSend?: boolean;
  selectionRecv?: boolean;
  logFile?: string;
  ultraDSM?: boolean;
  msLogon?: string;
  noxdamage?: boolean;
  xkb?: boolean;
  skipKeycodes?: string;
  modtweak?: boolean;
  xrandr?: string;
  padGeom?: string;
  rotate?: string;
  reflect?: string;
  id?: string;
  sid?: string;
  dpms?: boolean;
  noxfixes?: boolean;
  alphacut?: number;
  alphafrac?: number;
  alpharemove?: boolean;
  noalphablend?: boolean;
  nocursorshape?: boolean;
  noremoteresize?: boolean;
  noserverdpms?: boolean;
  noultraext?: boolean;
  chatWindow?: boolean;
  guiTray?: boolean;
  rfbAuth?: string;
  permitFileTransfer?: boolean;
  tightVNC?: boolean;
  ultraVNC?: boolean;
  findDisplay?: boolean;
  create?: boolean;
  env?: Record<string, string>;
  xvfb?: boolean;
  xdummy?: boolean;
  xvnc?: boolean;
  x11vncPath?: string;
}

/**
 * X11VNC session state
 */
interface X11VNCSession extends ConsoleSession {
  config: X11VNCConfig;
  serverProcess?: ChildProcess;
  vncPort?: number;
  httpPort?: number;
  passwordFile?: string;
  logFile?: string;
  isServerRunning: boolean;
  clientConnections: Set<string>;
  displayServer?: 'x11' | 'xvfb' | 'xdummy' | 'xvnc';
  virtualDisplay?: string;
  xvfbProcess?: ChildProcess;
  performanceMetrics?: {
    fps: number;
    bandwidth: number;
    latency: number;
    quality: number;
  };
}

/**
 * X11VNC Protocol Implementation
 * Provides VNC server functionality for X11 displays with comprehensive configuration
 */
export class X11VNCProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'x11vnc';
  public readonly capabilities: ProtocolCapabilities = {
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
    supportsPTY: false,
    maxConcurrentSessions: 10,
    defaultTimeout: 30000,
    supportedEncodings: [
      'utf-8',
      'raw',
      'tight',
      'zlib',
      'hextile',
      'zrle',
      'ultra',
    ],
    supportedAuthMethods: [
      'none',
      'vnc',
      'unix',
      'tls',
      'vencrypt',
      'sasl',
      'md5',
      'rfb',
    ],
    platformSupport: {
      windows: false,
      linux: true,
      macos: true,
      freebsd: true,
    },
  };

  private x11vncSessions: Map<string, X11VNCSession> = new Map();
  private availablePorts: Set<number> = new Set();
  private usedPorts: Set<number> = new Set();
  private defaultConfig: Partial<X11VNCConfig> = {
    display: ':0',
    port: 5900,
    shared: true,
    forever: true,
    noxdamage: true,
    xkb: true,
    defer: 10,
    wait: 10,
  };

  constructor() {
    super('X11VNCProtocol');
    this.initializePortPool();
  }

  private initializePortPool(): void {
    for (let port = 5900; port <= 5910; port++) {
      this.availablePorts.add(port);
    }
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing X11VNC protocol');

    try {
      await this.checkDependencies();
      await this.detectDisplayServers();
      this.isInitialized = true;
      this.logger.info('X11VNC protocol initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize X11VNC protocol:', error);
      throw error;
    }
  }

  private async checkDependencies(): Promise<void> {
    const dependencies: Record<string, boolean> = {};

    // Check for x11vnc
    try {
      await this.executeSystemCommand('x11vnc', ['-version']);
      dependencies.x11vnc = true;
    } catch {
      dependencies.x11vnc = false;
      this.logger.warn('x11vnc not found in PATH');
    }

    // Check for Xvfb (virtual framebuffer)
    try {
      await this.executeSystemCommand('Xvfb', ['-help']);
      dependencies.xvfb = true;
    } catch {
      dependencies.xvfb = false;
    }

    // Check for Xdummy
    try {
      await this.executeSystemCommand('Xdummy', ['-version']);
      dependencies.xdummy = true;
    } catch {
      dependencies.xdummy = false;
    }

    // Check for TigerVNC
    try {
      await this.executeSystemCommand('vncserver', ['-version']);
      dependencies.tigervnc = true;
    } catch {
      dependencies.tigervnc = false;
    }

    // Store dependencies for later use
    (this as any)._dependencies = dependencies;
  }

  private async detectDisplayServers(): Promise<string[]> {
    const displays: string[] = [];

    // Check for X11 displays
    try {
      const result = await this.executeSystemCommand('ls', ['/tmp/.X11-unix/']);
      const matches = result.match(/X(\d+)/g);
      if (matches) {
        displays.push(...matches.map((m) => `:${m.substring(1)}`));
      }
    } catch {
      this.logger.debug('No X11 displays found in /tmp/.X11-unix/');
    }

    // Check DISPLAY environment variable
    const envDisplay = process.env.DISPLAY;
    if (envDisplay && !displays.includes(envDisplay)) {
      displays.push(envDisplay);
    }

    this.logger.info(`Detected displays: ${displays.join(', ') || 'none'}`);
    return displays;
  }

  /**
   * Create a new session
   */
  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = this.generateSessionId();
    const sessionState: SessionState = {
      sessionId: sessionId,
      status: 'initializing',
      isOneShot: this.isOneShotCommand(options),
      isPersistent: !this.isOneShotCommand(options),
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    return this.doCreateSession(sessionId, options, sessionState);
  }

  private generateSessionId(): string {
    return `x11vnc-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const config = this.parseX11VNCOptions(options);

    const session: X11VNCSession = {
      id: sessionId,
      type: 'x11vnc',
      status: 'initializing',
      command: options.command || 'x11vnc',
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      createdAt: new Date(),
      streaming: options.streaming ?? true,
      config,
      isServerRunning: false,
      clientConnections: new Set(),
      executionState: 'idle',
      activeCommands: new Map(),
    };

    this.x11vncSessions.set(sessionId, session);
    this.sessions.set(sessionId, session);

    try {
      // Start X11VNC server
      await this.startX11VNCServer(sessionId, session);

      session.status = 'running';
      sessionState.status = 'running';

      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `X11VNC server started on port ${session.vncPort}\n`,
        timestamp: new Date(),
      });

      return session;
    } catch (error) {
      session.status = 'stopped';
      session.exitCode = 1;
      sessionState.status = 'stopped';
      throw error;
    }
  }

  private parseX11VNCOptions(options: SessionOptions): X11VNCConfig {
    const config: X11VNCConfig = { ...this.defaultConfig };

    // Parse from args if provided
    if (options.args) {
      const args = options.args;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];

        switch (arg) {
          case '-display':
            config.display = nextArg;
            i++;
            break;
          case '-rfbport':
            config.port = parseInt(nextArg);
            i++;
            break;
          case '-passwd':
            config.password = nextArg;
            i++;
            break;
          case '-passwdfile':
            config.passwordFile = nextArg;
            i++;
            break;
          case '-viewonly':
            config.viewOnly = true;
            break;
          case '-shared':
            config.shared = true;
            break;
          case '-forever':
            config.forever = true;
            break;
          case '-loop':
            config.loop = true;
            break;
          case '-localhost':
            config.allowLocal = true;
            break;
          case '-ssl':
            config.ssl = true;
            break;
          case '-sslonly':
            config.sslOnly = true;
            break;
          case '-stunnel':
            config.stunnel = true;
            break;
          case '-httpport':
            config.httpPort = parseInt(nextArg);
            i++;
            break;
          case '-httpdir':
            config.httpDir = nextArg;
            i++;
            break;
          case '-scale':
            config.scale = nextArg;
            i++;
            break;
          case '-geometry':
          case '-geom':
            config.geometry = nextArg;
            i++;
            break;
          case '-nocursor':
            config.noCursor = true;
            break;
          case '-cursor':
            config.cursor = true;
            break;
          case '-arrow':
            config.arrow = true;
            break;
          case '-fixscreen':
            config.fixScreen = true;
            break;
          case '-norepeat':
            config.noRepeat = true;
            break;
          case '-speeds':
            config.speeds = nextArg;
            i++;
            break;
          case '-wait':
            config.wait = parseInt(nextArg);
            i++;
            break;
          case '-defer':
            config.defer = parseInt(nextArg);
            i++;
            break;
          case '-noxdamage':
            config.noxdamage = true;
            break;
          case '-xkb':
            config.xkb = true;
            break;
          case '-create':
            config.create = true;
            break;
          case '-xvfb':
            config.xvfb = true;
            break;
          case '-xdummy':
            config.xdummy = true;
            break;
        }
      }
    }

    // Parse from environment variables
    if (options.env) {
      if (options.env.X11VNC_DISPLAY)
        config.display = options.env.X11VNC_DISPLAY;
      if (options.env.X11VNC_PORT)
        config.port = parseInt(options.env.X11VNC_PORT);
      if (options.env.X11VNC_PASSWORD)
        config.password = options.env.X11VNC_PASSWORD;
    }

    return config;
  }

  private async startX11VNCServer(
    sessionId: string,
    session: X11VNCSession
  ): Promise<void> {
    const config = session.config;

    // Allocate port
    session.vncPort = await this.allocatePort(config.port);

    // Create virtual display if needed
    if (config.create || config.xvfb || config.xdummy) {
      await this.createVirtualDisplay(session);
    }

    // Build command arguments
    const args: string[] = [];

    // Display
    args.push('-display', config.display || session.virtualDisplay || ':0');

    // Port
    args.push('-rfbport', session.vncPort.toString());

    // Authentication
    if (config.password) {
      // Create temporary password file
      session.passwordFile = path.join('/tmp', `x11vnc_${sessionId}.pwd`);
      await fs.writeFile(session.passwordFile, config.password, {
        mode: 0o600,
      });
      args.push('-rfbauth', session.passwordFile);
    } else if (config.passwordFile) {
      args.push('-rfbauth', config.passwordFile);
    } else {
      args.push('-nopw'); // No password
    }

    // Options
    if (config.viewOnly) args.push('-viewonly');
    if (config.shared) args.push('-shared');
    if (config.forever) args.push('-forever');
    if (config.loop) args.push('-loop');
    if (config.allowLocal) args.push('-localhost');
    if (config.ssl) {
      args.push('-ssl');
      if (config.sslCertFile)
        args.push('-ssldir', path.dirname(config.sslCertFile));
    }
    if (config.sslOnly) args.push('-sslonly');
    if (config.httpPort) {
      args.push('-httpport', config.httpPort.toString());
      session.httpPort = config.httpPort;
    }
    if (config.httpDir) args.push('-httpdir', config.httpDir);
    if (config.scale) args.push('-scale', config.scale);
    if (config.geometry) args.push('-geometry', config.geometry);
    if (config.noCursor) args.push('-nocursor');
    else if (config.cursor) args.push('-cursor', 'most');
    if (config.arrow) args.push('-arrow');
    if (config.fixScreen) args.push('-fixscreen');
    if (config.noRepeat) args.push('-norepeat');
    if (config.speeds) args.push('-speeds', config.speeds);
    if (config.wait) args.push('-wait', config.wait.toString());
    if (config.defer) args.push('-defer', config.defer.toString());
    if (config.noxdamage) args.push('-noxdamage');
    if (config.xkb) args.push('-xkb');
    if (config.noClipboard) args.push('-noclipboard');

    // Performance tuning
    args.push('-ncache', '10'); // Client-side caching
    args.push('-ncache_cr'); // Cache cursor rendering

    // Logging
    if (config.logFile || (this.logger as any).level === 'debug') {
      session.logFile =
        config.logFile || path.join('/tmp', `x11vnc_${sessionId}.log`);
      args.push('-o', session.logFile);
      args.push('-verbose');
    }

    // Start x11vnc process
    const x11vncPath = config.x11vncPath || 'x11vnc';
    session.serverProcess = spawn(x11vncPath, args, {
      cwd: session.cwd,
      env: session.env,
      detached: false,
    });

    session.isServerRunning = true;

    // Handle process output
    session.serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      this.parseX11VNCOutput(sessionId, output);
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: output,
        timestamp: new Date(),
      });
    });

    session.serverProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      this.parseX11VNCOutput(sessionId, output);
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stderr',
        data: output,
        timestamp: new Date(),
      });
    });

    session.serverProcess.on('exit', (code, signal) => {
      session.isServerRunning = false;
      session.exitCode = code ?? undefined;
      session.status = 'stopped';
      this.cleanupSession(sessionId);

      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `X11VNC server exited with code ${code} (signal: ${signal})\n`,
        timestamp: new Date(),
      });
    });

    // Wait for server to be ready
    await this.waitForServerReady(sessionId, session);
  }

  private async createVirtualDisplay(session: X11VNCSession): Promise<void> {
    const displayNum = Math.floor(Math.random() * 100) + 10;
    session.virtualDisplay = `:${displayNum}`;

    const geometry = session.config.geometry || '1920x1080';
    const depth = '24';

    if (session.config.xvfb !== false) {
      // Try Xvfb first
      try {
        const xvfbArgs = [
          session.virtualDisplay,
          '-screen',
          '0',
          `${geometry}x${depth}`,
          '-ac', // Disable access control
          '+extension',
          'GLX',
          '+render',
          '-noreset',
        ];

        session.xvfbProcess = spawn('Xvfb', xvfbArgs, {
          env: session.env,
          detached: false,
        });

        session.displayServer = 'xvfb';
        session.config.display = session.virtualDisplay;

        // Wait for Xvfb to start
        await new Promise((resolve) => setTimeout(resolve, 1000));

        this.logger.info(`Created Xvfb display ${session.virtualDisplay}`);
        return;
      } catch (error) {
        this.logger.warn('Failed to start Xvfb:', error);
      }
    }

    if (session.config.xdummy) {
      // Try Xdummy
      try {
        const xdummyArgs = [session.virtualDisplay];
        session.xvfbProcess = spawn('Xdummy', xdummyArgs, {
          env: session.env,
          detached: false,
        });

        session.displayServer = 'xdummy';
        session.config.display = session.virtualDisplay;

        await new Promise((resolve) => setTimeout(resolve, 1000));

        this.logger.info(`Created Xdummy display ${session.virtualDisplay}`);
        return;
      } catch (error) {
        this.logger.warn('Failed to start Xdummy:', error);
      }
    }

    throw new Error('Failed to create virtual display');
  }

  private parseX11VNCOutput(sessionId: string, output: string): void {
    const session = this.x11vncSessions.get(sessionId);
    if (!session) return;

    // Parse connection events
    if (output.includes('Got connection from')) {
      const match = output.match(/Got connection from (.+)/);
      if (match) {
        session.clientConnections.add(match[1]);
        this.emit('client-connected', { sessionId, client: match[1] });
      }
    }

    if (output.includes('Client gone')) {
      const match = output.match(/Client (.+) gone/);
      if (match) {
        session.clientConnections.delete(match[1]);
        this.emit('client-disconnected', { sessionId, client: match[1] });
      }
    }

    // Parse performance metrics
    if (output.includes('fb read rate:')) {
      const match = output.match(/fb read rate:\s*([\d.]+)/);
      if (match) {
        if (!session.performanceMetrics) {
          session.performanceMetrics = {
            fps: 0,
            bandwidth: 0,
            latency: 0,
            quality: 100,
          };
        }
        session.performanceMetrics.fps = parseFloat(match[1]);
      }
    }
  }

  private async waitForServerReady(
    sessionId: string,
    session: X11VNCSession,
    timeout: number = 10000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (!session.isServerRunning) {
        throw new Error('X11VNC server failed to start');
      }

      // Check if port is listening
      const isListening = await this.isPortListening(session.vncPort!);
      if (isListening) {
        this.logger.info(`X11VNC server ready on port ${session.vncPort}`);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('X11VNC server startup timeout');
  }

  private async isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const client = new net.Socket();

      client.once('connect', () => {
        client.destroy();
        resolve(true);
      });

      client.once('error', () => {
        resolve(false);
      });

      client.connect(port, 'localhost');
    });
  }

  private async allocatePort(preferredPort?: number): Promise<number> {
    if (preferredPort && this.availablePorts.has(preferredPort)) {
      this.availablePorts.delete(preferredPort);
      this.usedPorts.add(preferredPort);
      return preferredPort;
    }

    // Find next available port
    for (const port of this.availablePorts) {
      const inUse = await this.isPortListening(port);
      if (!inUse) {
        this.availablePorts.delete(port);
        this.usedPorts.add(port);
        return port;
      }
    }

    // If all preset ports are used, find a random one
    return this.findRandomPort();
  }

  private async findRandomPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  private async executeSystemCommand(
    command: string,
    args: string[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
      let output = '';
      let error = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        error += data.toString();
      });

      process.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(error || `Command failed with code ${code}`));
        }
      });
    });
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const session = this.x11vncSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // X11VNC server commands
    if (command === 'refresh') {
      // Send refresh signal to x11vnc
      if (session.serverProcess) {
        session.serverProcess.kill('SIGUSR1');
      }
    } else if (command === 'disconnect-clients') {
      // Disconnect all clients
      session.clientConnections.clear();
      if (session.serverProcess) {
        session.serverProcess.kill('SIGUSR2');
      }
    } else if (command === 'get-info') {
      // Get server information
      const info = {
        display: session.config.display,
        port: session.vncPort,
        httpPort: session.httpPort,
        clients: Array.from(session.clientConnections),
        performance: session.performanceMetrics,
        uptime: Date.now() - session.createdAt.getTime(),
      };

      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: JSON.stringify(info, null, 2) + '\n',
        timestamp: new Date(),
      });
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    // X11VNC doesn't accept input directly - it's a VNC server
    // Input would come from VNC clients
    this.logger.warn('Direct input not supported for X11VNC server sessions');
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.x11vncSessions.get(sessionId);
    if (!session) {
      return;
    }

    // Stop X11VNC server
    if (session.serverProcess && !session.serverProcess.killed) {
      session.serverProcess.kill('SIGTERM');

      // Wait a bit, then force kill if needed
      setTimeout(() => {
        if (session.serverProcess && !session.serverProcess.killed) {
          session.serverProcess.kill('SIGKILL');
        }
      }, 2000);
    }

    // Stop virtual display if we created one
    if (session.xvfbProcess && !session.xvfbProcess.killed) {
      session.xvfbProcess.kill('SIGTERM');
    }

    // Cleanup temporary files
    await this.cleanupSession(sessionId);

    // Return port to pool
    if (session.vncPort) {
      this.usedPorts.delete(session.vncPort);
      this.availablePorts.add(session.vncPort);
    }

    session.status = 'stopped';
    this.x11vncSessions.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.x11vncSessions.get(sessionId);
    if (!session) return;

    // Remove password file
    if (session.passwordFile) {
      try {
        await fs.unlink(session.passwordFile);
      } catch (error) {
        this.logger.debug(`Failed to remove password file: ${error}`);
      }
    }

    // Remove log file if in production
    if (session.logFile && (this.logger as any).level !== 'debug') {
      try {
        await fs.unlink(session.logFile);
      } catch (error) {
        this.logger.debug(`Failed to remove log file: ${error}`);
      }
    }
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing X11VNC protocol');

    // Close all sessions
    const sessionIds = Array.from(this.x11vncSessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));

    await this.cleanup();
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    // Add X11VNC-specific health checks
    const x11vncAvailable =
      ((this as any)._dependencies as any)?.x11vnc || false;
    const hasDisplayServer =
      ((this as any)._dependencies as any)?.xvfb ||
      ((this as any)._dependencies as any)?.xdummy ||
      false;

    return {
      ...baseStatus,
      isHealthy: this.isInitialized && x11vncAvailable,
      warnings: [
        ...baseStatus.warnings,
        !x11vncAvailable ? 'x11vnc not available' : null,
        !hasDisplayServer
          ? 'No virtual display server available (Xvfb/Xdummy)'
          : null,
      ].filter(Boolean) as string[],
    };
  }
}

export default X11VNCProtocol;
